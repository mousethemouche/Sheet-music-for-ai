/**
 * Engraving of a prepared score into an SVG element, and the neutral
 * LayoutMap measured from what was drawn (RENDER_PLAYBACK_PORTS.md §2.4-2.7).
 *
 * 1. Every bar is built on placeholder staves to measure its minimum width,
 *    with the room some onsets need (short pedal spans, voices moved aside;
 *    see `barRoom`).
 * 2. Bars are broken into systems that fit the width (greedy), then justified.
 * 3. Every system is built and drawn once on provisional staves, into a
 *    scratch group that is then removed, to measure the real ink of each
 *    staff's notation and of each label row. `planVertical` stacks the rows
 *    outward from their staff (`ROWS_ABOVE`, `ROWS_BELOW`), each clear of the
 *    measured ink before it, and each staff below the lowest row of the one
 *    above.
 * 4. Each system is rebuilt on its final staves and drawn into its own group,
 *    every row on its planned line.
 * 5. Systems are stacked from their measured ink bounds, leaving the
 *    annotation band above each system that holds an annotated note.
 *
 * Noteheads are located with VexFlow's own geometry (tight glyph metrics);
 * ink is measured from the drawn SVG, text from its glyph metrics.
 */
import {
  type ScoreSpec,
  type TimeSignature,
  compareFractions,
  fractionsEqual,
} from '@sheet-music/music-domain';
import type {
  Bounds,
  LayoutMap,
  NoteLayout,
  RenderTheme,
  SystemLayout,
} from '@sheet-music/renderer-core';
import {
  Barline,
  BarlineType,
  Curve,
  Element as VexElement,
  Modifier,
  PedalMarking,
  SVGContext,
  Stave,
  StaveConnector,
  StaveModifierPosition,
  type StaveNote,
  StaveTie,
} from 'vexflow/core';
import {
  type BarGlyphs,
  type EventGlyph,
  type NoteGlyph,
  type PreparedScore,
  RELEASE_GAP,
  buildBar,
  pedalMarksWidth,
} from './build';
import { keySignatureSpec, meterText, scaleDegreeText } from './notation';

export interface EngraveOptions {
  /** Available width in CSS px (> 0). */
  readonly width: number;
  readonly theme: RenderTheme;
  readonly annotationBandHeight: number;
}

export interface Engraving {
  /** The new SVG root, appended to the container. */
  readonly svg: SVGSVGElement;
  readonly layoutMap: LayoutMap;
  /** The notehead glyph element of each written note (playback highlight target). */
  readonly noteheads: ReadonlyMap<string, SVGElement>;
}

/** VexFlow's staff space, in px. */
const SPACE = 10;
const STAFF_HEIGHT = 4 * SPACE;
/** VexFlow stave headroom above the top line (Stave option spaceAboveStaffLn). */
const STAVE_HEADROOM = 4 * SPACE;
const MARGIN = 12;
/** Extra left room for the grand-staff brace. */
const BRACE_ROOM = 16;
/** Space after the last note of a bar. */
const BAR_END_PADDING = 12;
/** Natural bar width = VexFlow minimum x SPACING_FACTOR + NOTE_ROOM. */
const SPACING_FACTOR = 1.4;
const NOTE_ROOM = 16;
/** The last system is justified only when it is at least this full. */
const JUSTIFY_LAST_RATIO = 0.6;
const SYSTEM_GAP = 24;
/** Clearance between the lowest ink of a staff (its label rows included) and the highest ink of the next staff. */
const STAFF_GAP = 12;
/** Room kept above a staff's top line and below its bottom line, even with nothing drawn there. */
const STAFF_ROOM_ABOVE = 1.5 * SPACE;
const STAFF_ROOM_BELOW = SPACE;
/** Clearance between a staff's notation and its nearest label row, and between two rows. */
const ROW_GAP = SPACE / 2;
const TOP_MARGIN = 8;
const BOTTOM_MARGIN = 8;
const LABEL_FONT = 'Academico';
const DEGREE_FONT_SIZE = 11;
const SWING_FONT_SIZE = 12;
const HAIRPIN_HEIGHT = 10;
/** Gap between a hairpin and a dynamic mark written at its start or right after its end. */
const HAIRPIN_MARK_GAP = 6;
/** Gap a hairpin keeps before the next event of its staff or the bar line. */
const HAIRPIN_END_GAP = 6;
/** A dynamic mark's baseline, below the line its row's hairpins are centered on. */
const MARK_BASELINE = 6;
/** Horizontal clearance between two scale degrees on one row. */
const DEGREE_GAP = 3;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface BarMeasure {
  readonly content: number;
  readonly showMeter: boolean;
  readonly beginStart: number;
  readonly beginContinued: number;
  /** Minimum widths at some onsets of this bar, by event (see `barRoom`). */
  readonly room: ReadonlyMap<string, number>;
}

interface SystemPlan {
  readonly index: number;
  readonly bars: readonly number[];
  /** Width of each bar's staves, in order. */
  readonly barWidths: readonly number[];
}

/** A span (slur, hairpin, pedal) located by its end events. */
interface Span {
  readonly id: string;
  readonly staffIndex: number;
  readonly startSystem: number;
  readonly endSystem: number;
}

/**
 * Label rows, in order outward from their staff. Below a staff: scale
 * degrees name single notes, so they stay next to them, as fingerings (drawn
 * with the notes) do; then the staff's dynamics and hairpins; then the
 * sustain pedal, the outermost performance mark under its staff; then the
 * Roman numerals, analysis rather than performance, on one uninterrupted line
 * at the bottom of the system. Above the top staff: chord symbols, then the
 * swing indication.
 */
const ROWS_ABOVE = ['chord-symbols', 'swing'] as const;
const ROWS_BELOW = ['scale-degrees', 'dynamics', 'pedal', 'roman-numerals'] as const;
type RowKind = (typeof ROWS_ABOVE)[number] | (typeof ROWS_BELOW)[number];

/** One row of labels of one staff on one system. */
interface LabelRow {
  readonly kind: RowKind;
  readonly staffIndex: number;
  /**
   * Sub-row, 0 nearest the staff: dynamic marks sharing an onset (level 0
   * also holds the hairpins), and scale degrees that would touch, take
   * successive rows.
   */
  readonly level: number;
}

const rowKey = (row: LabelRow): string => `${row.staffIndex}:${row.kind}:${row.level}`;
const isAbove = (row: LabelRow): boolean => (ROWS_ABOVE as readonly RowKind[]).includes(row.kind);

/** Vertical ink extent relative to an anchor (a staff's top line, a row's line), in px. */
interface Extent {
  readonly top: number;
  readonly bottom: number;
}

/** Vertical layout of one system, in its local coordinates. */
interface SystemVertical {
  /** y of each staff's top line. */
  readonly topLines: readonly number[];
  /** y of each row's line (text baseline; for dynamics, the hairpin center line), by `rowKey`. */
  readonly rowLines: ReadonlyMap<string, number>;
}

/**
 * Stacks one system from measured ink. Each row sits ROW_GAP beyond the ink
 * of its staff's notation or of the previous row on its side; the rows of a
 * staff span the whole system, so labels of one kind share a line. Each
 * staff sits STAFF_GAP below the lowest row of the staff above. `notation`
 * is the ink of each staff relative to its top line, `rowInk` that of each
 * row relative to its line (a row without one is not placed).
 */
function planVertical(
  rows: readonly LabelRow[],
  notation: readonly (Extent | undefined)[],
  rowInk: ReadonlyMap<string, Extent>,
): SystemVertical {
  const topLines: number[] = [];
  const rowLines = new Map<string, number>();
  let previousBottom: number | undefined;
  notation.forEach((ink, staffIndex) => {
    // Relative to this staff's top line until the staff is placed.
    let top = Math.min(ink?.top ?? 0, -STAFF_ROOM_ABOVE);
    let bottom = Math.max(ink?.bottom ?? STAFF_HEIGHT, STAFF_HEIGHT + STAFF_ROOM_BELOW);
    const lines = new Map<string, number>();
    for (const row of rows) {
      const extent = rowInk.get(rowKey(row));
      if (row.staffIndex !== staffIndex || extent === undefined) {
        continue;
      }
      if (isAbove(row)) {
        const line = top - ROW_GAP - extent.bottom;
        lines.set(rowKey(row), line);
        top = line + extent.top;
      } else {
        const line = bottom + ROW_GAP - extent.top;
        lines.set(rowKey(row), line);
        bottom = line + extent.bottom;
      }
    }
    const topLine = previousBottom === undefined ? 0 : previousBottom + STAFF_GAP - top;
    topLines.push(topLine);
    for (const [key, line] of lines) {
      rowLines.set(key, topLine + line);
    }
    previousBottom = topLine + bottom;
  });
  return { topLines, rowLines };
}

function meterEquals(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function union(a: Box | undefined, b: Box): Box {
  if (a === undefined) {
    return b;
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function decorateStave(
  stave: Stave,
  score: ScoreSpec,
  staffIndex: number,
  systemStart: boolean,
  meter: TimeSignature | undefined,
): Stave {
  const staff = score.staves[staffIndex];
  if (systemStart && staff !== undefined) {
    stave.addClef(staff.clef);
    const fifths = score.keySignature?.fifths ?? 0;
    if (fifths !== 0) {
      stave.addKeySignature(keySignatureSpec(fifths));
    }
  }
  if (meter !== undefined) {
    stave.addTimeSignature(meterText(meter));
  }
  return stave;
}

/** Width of clef, key and meter signs at the start of a bar (widest staff). */
function beginWidth(
  prepared: PreparedScore,
  barIndex: number,
  systemStart: boolean,
  showMeter: boolean,
): number {
  const meter = showMeter ? prepared.index.bars[barIndex]?.timeSignature : undefined;
  return Math.max(
    ...prepared.score.staves.map((_, staffIndex) => {
      const stave = decorateStave(
        new Stave(0, 0, 10_000),
        prepared.score,
        staffIndex,
        systemStart,
        meter,
      );
      return stave.getNoteStartX() - stave.getX();
    }),
  );
}

/** How far the ink of a stave's end barline reaches left of the stave's end (a final barline's does). */
function endBarlineInset(stave: Stave): number {
  const [barline] = stave.getModifiers(StaveModifierPosition.END, Barline.CATEGORY);
  return -Math.min(0, barline?.getLayoutMetrics()?.xMin ?? 0);
}

/** x where the ink of a stave's end barline starts. */
function barlineLeft(stave: Stave): number {
  return stave.getX() + stave.getWidth() - endBarlineInset(stave);
}

/**
 * Where a pedal release written at the end of `end` is right-aligned, before
 * RELEASE_GAP: the next event of its voice (where the "Ped." of a pedal
 * change starts), else the bar line at `barEnd`.
 */
function releaseAnchor(end: StaveNote, barEnd: number): number {
  const voiceNotes = end.getVoice().getTickables();
  return voiceNotes[voiceNotes.indexOf(end) + 1]?.getAbsoluteX() ?? barEnd;
}

function measureBars(prepared: PreparedScore): BarMeasure[] {
  const { score, index } = prepared;
  const placeholders = (barIndex: number): Stave[] =>
    score.staves.map(() => {
      const stave = new Stave(0, 0, 10_000);
      if (barIndex === index.bars.length - 1) {
        stave.setEndBarType(BarlineType.END);
      }
      return stave;
    });
  /** Bars where some onset may need room (see `barRoom`): a pedal starts, or a staff has 3+ voices. */
  const roomBars = new Set(
    (score.pedal ?? []).map((pedal) => index.location(pedal.startEventId)?.measureIndex),
  );
  index.bars.forEach((_, barIndex) => {
    if (score.staves.some((staff) => (staff.measures[barIndex]?.voices.length ?? 0) >= 3)) {
      roomBars.add(barIndex);
    }
  });
  return index.bars.map((bar, barIndex) => {
    const glyphs = buildBar(prepared, barIndex, placeholders(barIndex));
    let content = glyphs.formatter.preCalculateMinTotalWidth([...glyphs.voices]);
    const room = roomBars.has(barIndex)
      ? barRoom(
          prepared,
          buildBar(prepared, barIndex, placeholders(barIndex)),
          content * SPACING_FACTOR + NOTE_ROOM,
        )
      : new Map<string, number>();
    if (room.size > 0) {
      const roomy = buildBar(prepared, barIndex, placeholders(barIndex), room);
      content = roomy.formatter.preCalculateMinTotalWidth([...roomy.voices]);
    }
    const previous = index.bars[barIndex - 1];
    const showMeter =
      previous === undefined || !meterEquals(previous.timeSignature, bar.timeSignature);
    return {
      content,
      showMeter,
      beginStart: beginWidth(prepared, barIndex, true, showMeter),
      beginContinued: beginWidth(prepared, barIndex, false, showMeter),
      room,
    };
  });
}

/**
 * Minimum widths some onsets of a bar need beyond what VexFlow reserves, by
 * event, found by formatting a fresh build (`glyphs`) at the bar's natural
 * width (the room then holds at any wider width, see `buildBar`):
 * - a pedal span too short for its "Ped." and release marks (one or a few
 *   short notes) gets their width after its start event. The release ends
 *   RELEASE_GAP before the end of the span (`releaseAnchor`): the next event
 *   of the end event's voice, or the bar line; a span ending in a later bar
 *   needs its room before this bar line;
 * - a glyph moved aside by `separateVoices` gets room up to its new right edge.
 */
function barRoom(prepared: PreparedScore, glyphs: BarGlyphs, width: number): Map<string, number> {
  glyphs.formatter.format([...glyphs.voices], width);
  const room = separateVoices(glyphs);
  const starts = new Map(
    glyphs.staves.flatMap((staff) => staff.events.map((event) => [event.eventId, event.note])),
  );
  const need = pedalMarksWidth();
  for (const pedal of prepared.score.pedal ?? []) {
    const start = starts.get(pedal.startEventId);
    if (start === undefined) {
      continue;
    }
    const stave = start.checkStave();
    const barEnd = stave.getNoteStartX() + width + BAR_END_PADDING - endBarlineInset(stave);
    const end = starts.get(pedal.endEventId);
    const releaseEnd = end === undefined ? barEnd : releaseAnchor(end, barEnd);
    if (releaseEnd - start.getAbsoluteX() < need) {
      room.set(pedal.startEventId, Math.max(need, room.get(pedal.startEventId) ?? 0));
    }
  }
  return room;
}

/** Clearance between the glyphs of voices moved aside, in px. */
const VOICE_GAP = 2;

/** A drawn notehead or rest: x in px, y in VexFlow staff lines (0.5 per step). */
interface GlyphBox {
  readonly left: number;
  readonly right: number;
  readonly low: number;
  readonly high: number;
}

function glyphBox(note: StaveNote): GlyphBox {
  const x = note.getAbsoluteX() + note.getXShift();
  const left = x - note.getLeftDisplacedHeadPx();
  const right = x + note.getGlyphWidth() + note.getRightDisplacedHeadPx();
  const lines = note.getKeyProps().map((props) => props.line);
  if (note.isRest()) {
    // As VexFlow's own voice formatting: the rest glyph around its key line.
    const metrics = note.noteHeads[0]?.getTextMetrics();
    const line = lines[0] ?? 0;
    return {
      left,
      right,
      low: line - (metrics?.actualBoundingBoxDescent ?? 0) / SPACE,
      high: line + (metrics?.actualBoundingBoxAscent ?? 0) / SPACE,
    };
  }
  return { left, right, low: Math.min(...lines) - 0.5, high: Math.max(...lines) + 0.5 };
}

const collide = (a: GlyphBox, b: GlyphBox): boolean =>
  a.left < b.right && b.left < a.right && a.low < b.high && b.low < a.high;

/**
 * VexFlow keeps apart the noteheads and rests of at most three voices
 * starting together on one staff. Where three or more start together, a
 * glyph that still touches one of an earlier voice moves right past it.
 * Returns, per moved event, the width its onset needs from its x.
 */
function separateVoices(glyphs: BarGlyphs): Map<string, number> {
  const room = new Map<string, number>();
  for (const staff of glyphs.staves) {
    const onsets: EventGlyph[][] = [];
    for (const event of staff.events) {
      const group = onsets.at(-1);
      if (group?.[0] !== undefined && fractionsEqual(group[0].onset, event.onset)) {
        group.push(event);
      } else {
        onsets.push([event]);
      }
    }
    for (const group of onsets) {
      const drawn = group.filter(({ note }) => note.renderOptions.draw !== false);
      if (drawn.length < 3) {
        continue;
      }
      const placed: GlyphBox[] = [];
      for (const { eventId, note } of drawn) {
        let box = glyphBox(note);
        let hits = placed.filter((other) => collide(box, other));
        const moved = hits.length > 0;
        while (hits.length > 0) {
          const clear = Math.max(...hits.map((other) => other.right)) + VOICE_GAP;
          note.setXShift(note.getXShift() + clear - box.left);
          box = glyphBox(note);
          hits = placed.filter((other) => collide(box, other));
        }
        if (moved) {
          room.set(eventId, box.right - note.getAbsoluteX() + VOICE_GAP);
        }
        placed.push(box);
      }
    }
  }
  return room;
}

const naturalWidth = (bar: BarMeasure): number => bar.content * SPACING_FACTOR + NOTE_ROOM;

function barNeed(bar: BarMeasure, systemStart: boolean): number {
  return (systemStart ? bar.beginStart : bar.beginContinued) + naturalWidth(bar) + BAR_END_PADDING;
}

/** Greedy line breaking, then justification of every system but a short last one. */
function planSystems(bars: readonly BarMeasure[], available: number): SystemPlan[] {
  const lines: number[][] = [];
  let current: number[] = [];
  let used = 0;
  bars.forEach((bar, barIndex) => {
    const need = barNeed(bar, current.length === 0);
    if (current.length > 0 && used + need > available) {
      lines.push(current);
      current = [];
      used = 0;
    }
    used += barNeed(bar, current.length === 0);
    current.push(barIndex);
  });
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.map((barIndexes, index) => {
    const measures = barIndexes.map((barIndex) => bars[barIndex] as BarMeasure);
    const need = measures.reduce((sum, bar, position) => sum + barNeed(bar, position === 0), 0);
    const natural = measures.reduce((sum, bar) => sum + naturalWidth(bar), 0);
    const isLast = index === lines.length - 1;
    const extra =
      !isLast || need >= JUSTIFY_LAST_RATIO * available ? Math.max(0, available - need) : 0;
    return {
      index,
      bars: barIndexes,
      barWidths: measures.map(
        (bar, position) =>
          barNeed(bar, position === 0) + (natural > 0 ? (extra * naturalWidth(bar)) / natural : 0),
      ),
    };
  });
}

/** Line for VexFlow text notes (TextNote, TextDynamics), drawn at `stave.getYForLine(line - 3)`. */
function textNoteLine(baseline: number, stave: Stave): number {
  return (baseline - stave.getYForLine(0)) / SPACE + 3;
}

/** Line for a PedalMarking, whose text is drawn at `stave.getYForBottomText(line + 3)`. */
function pedalLine(baseline: number, stave: Stave): number {
  return (baseline - stave.getYForBottomText(0)) / SPACE - 3;
}

type TextMeasurer = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function textMeasurer(): TextMeasurer {
  const context = VexElement.getTextMeasurementCanvas()?.getContext('2d');
  if (context === null || context === undefined) {
    throw new Error('No canvas is available to measure text.');
  }
  return context;
}

const GRAPHICS = new Set(['path', 'rect', 'line', 'circle', 'ellipse', 'polyline', 'polygon']);

/** Union of the ink of everything drawn inside `root` (text from its glyph metrics). */
function inkBounds(root: SVGGElement, measurer: TextMeasurer): Box | undefined {
  let box: Box | undefined;
  for (const element of Array.from(root.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    let part: Box | undefined;
    if (tag === 'text') {
      const style = getComputedStyle(element);
      measurer.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = measurer.measureText(element.textContent ?? '');
      const x = Number(element.getAttribute('x'));
      const y = Number(element.getAttribute('y'));
      part = {
        x: x - metrics.actualBoundingBoxLeft,
        y: y - metrics.actualBoundingBoxAscent,
        width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
        height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
      };
    } else if (GRAPHICS.has(tag) && element.getAttribute('opacity') !== '0') {
      // Pointer rectangles (opacity 0) are hit areas, not ink.
      const bbox = (element as SVGGraphicsElement).getBBox();
      part = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
    }
    const finite =
      part !== undefined && [part.x, part.y, part.width, part.height].every(Number.isFinite);
    if (part !== undefined && finite && (part.width > 0 || part.height > 0)) {
      box = union(box, part);
    }
  }
  return box;
}

function verticalInk(root: SVGGElement, measurer: TextMeasurer): Extent | undefined {
  const box = inkBounds(root, measurer);
  return box === undefined ? undefined : { top: box.y, bottom: box.y + box.height };
}

function boxOf(note: StaveNote, index: number): Box {
  const head = note.noteHeads[index];
  if (head === undefined) {
    throw new Error(`No notehead at index ${index}`);
  }
  const box = head.getBoundingBox();
  return { x: box.getX(), y: box.getY(), width: box.getW(), height: box.getH() };
}

function translated(box: Box, dy: number): Bounds {
  return {
    x: box.x,
    y: box.y + dy,
    width: Math.max(0, box.width),
    height: Math.max(0, box.height),
  };
}

/** Groups VexFlow opened inside `root`, by element ID (VexFlow prefixes its IDs with `vf-`). */
function groupsById(root: Element): Map<string, SVGElement> {
  return new Map(
    Array.from(root.querySelectorAll<SVGElement>('g[id]')).map((group) => [group.id, group]),
  );
}

function openLabelGroup(
  ctx: SVGContext,
  className: string,
  data: Readonly<Record<string, string>>,
): void {
  const group = ctx.openGroup(className);
  for (const [name, value] of Object.entries(data)) {
    group.setAttribute(`data-${name}`, value);
  }
}

/** One bar of a system, built on its staves (one per ScoreSpec staff). */
interface BuiltBar {
  readonly glyphs: BarGlyphs;
  readonly staves: readonly Stave[];
}

/** A system built and formatted on its staves, ready to draw. */
interface BuiltSystem {
  readonly plan: SystemPlan;
  readonly bars: readonly BuiltBar[];
  /** The system's events, by ID. */
  readonly events: ReadonlyMap<string, StaveNote>;
  /** The system's events of each staff, by onset. */
  readonly staffEvents: readonly (readonly StaveNote[])[];
  /** The system's written notes, by ID. */
  readonly notes: ReadonlyMap<string, NoteGlyph>;
  /**
   * The sub-row of each scale degree of the system, by label ID (see
   * `degreeRowsOf`). Call it once the notes are drawn: VexFlow sets a
   * notehead's box when it draws it.
   */
  readonly degreeRows: () => ReadonlyMap<string, number>;
}

/**
 * The events a span is drawn between on one system: its own ends on the
 * systems that hold them, the system's edge events of its staff otherwise.
 */
function spanEnds(
  item: Span,
  built: BuiltSystem,
  start: StaveNote | undefined,
  end: StaveNote | undefined,
): { readonly from: StaveNote; readonly to: StaveNote } | undefined {
  const edge = built.staffEvents[item.staffIndex] ?? [];
  const system = built.plan.index;
  const from = system === item.startSystem ? start : edge[0];
  const to = system === item.endSystem ? end : edge[edge.length - 1];
  return from === undefined || to === undefined ? undefined : { from, to };
}

/**
 * Engraves `prepared` into a new SVG appended to `container`. Throws on any
 * engraving failure; the caller removes a partial SVG.
 */
export function engrave(
  prepared: PreparedScore,
  container: HTMLElement,
  options: EngraveOptions,
  onSvgCreated: (svg: SVGSVGElement) => void,
): Engraving {
  const { score, index } = prepared;
  const ink = options.theme.ink;
  const grandStaff = score.staves.length > 1;
  const leftEdge = MARGIN + (grandStaff ? BRACE_ROOM : 0);
  const measures = measureBars(prepared);
  const minimumWidth = leftEdge + MARGIN + Math.max(...measures.map((bar) => barNeed(bar, true)));
  const width = Math.ceil(Math.max(options.width, minimumWidth));
  const plans = planSystems(measures, width - leftEdge - MARGIN);

  const systemOfBar = new Map<number, number>();
  for (const plan of plans) {
    for (const barIndex of plan.bars) {
      systemOfBar.set(barIndex, plan.index);
    }
  }
  const systemOf = (id: string): number => {
    const location = index.location(id);
    return location === undefined ? -1 : (systemOfBar.get(location.measureIndex) ?? -1);
  };
  const staffOf = (id: string): number => index.location(id)?.staffIndex ?? 0;
  const span = (id: string, startId: string, endId: string): Span => ({
    id,
    staffIndex: staffOf(startId),
    startSystem: systemOf(startId),
    endSystem: systemOf(endId),
  });
  const slurs = (score.slurs ?? []).map((slur) => ({
    ...slur,
    ...span(slur.id, slur.startNoteId, slur.endNoteId),
  }));
  const hairpins = (score.dynamics ?? []).flatMap((dynamic) =>
    dynamic.type === 'hairpin'
      ? [{ ...dynamic, ...span(dynamic.id, dynamic.startEventId, dynamic.endEventId) }]
      : [],
  );
  const pedals = (score.pedal ?? []).map((pedal) => ({
    ...pedal,
    ...span(pedal.id, pedal.startEventId, pedal.endEventId),
  }));
  const touches = (item: Span, system: number): boolean =>
    item.startSystem <= system && system <= item.endSystem;
  const swing = score.playbackFeel?.type === 'swing' ? score.playbackFeel : undefined;

  const ctx = new SVGContext(container);
  const svg = ctx.svg;
  onSvgCreated(svg);
  svg.style.display = 'block';
  svg.setAttribute('fill', ink);
  svg.setAttribute('stroke', ink);
  ctx.setFillStyle(ink);
  ctx.setStrokeStyle(ink);

  const degreeWidth = (text: string): number => {
    ctx.save();
    ctx.setFont(LABEL_FONT, DEGREE_FONT_SIZE);
    const { width } = ctx.measureText(text);
    ctx.restore();
    return width;
  };

  /**
   * The sub-row of each scale degree of a system (labels are centered under
   * their notehead): left to right, a label takes the first row of its staff,
   * 0 nearest the staff, where it clears by DEGREE_GAP the labels placed on
   * it before. At one onset the top note comes first, so labels sounding
   * together (a chord's members, voices of one staff) stack in the order of
   * their notes, the top note's nearest the staff.
   */
  const degreeRowsOf = (notes: ReadonlyMap<string, NoteGlyph>): Map<string, number> => {
    const labels = (score.scaleDegrees ?? []).flatMap((label) => {
      const glyph = notes.get(label.noteId);
      if (glyph === undefined) {
        return [];
      }
      const head = boxOf(glyph.note, glyph.index);
      const half = degreeWidth(scaleDegreeText(label)) / 2;
      return [
        {
          id: label.id,
          staffIndex: glyph.staffIndex,
          onsetX: glyph.note.getAbsoluteX(),
          line: glyph.note.getKeyProps()[glyph.index]?.line ?? 0,
          left: head.x + head.width / 2 - half,
          right: head.x + head.width / 2 + half,
        },
      ];
    });
    labels.sort((a, b) => a.staffIndex - b.staffIndex || a.onsetX - b.onsetX || b.line - a.line);
    const rows = new Map<string, number>();
    const rowEnds = new Map<number, number[]>();
    for (const label of labels) {
      const ends = rowEnds.get(label.staffIndex) ?? [];
      const free = ends.findIndex((end) => end + DEGREE_GAP <= label.left);
      const row = free < 0 ? ends.length : free;
      ends[row] = label.right;
      rowEnds.set(label.staffIndex, ends);
      rows.set(label.id, row);
    }
    return rows;
  };

  /** Builds and formats a system on staves whose top lines are at `topLines` (local y). */
  const buildSystem = (plan: SystemPlan, topLines: readonly number[]): BuiltSystem => {
    let degreeRows: Map<string, number> | undefined;
    let x = leftEdge;
    const systemEvents: EventGlyph[] = [];
    const notes = new Map<string, NoteGlyph>();
    const bars = plan.bars.map((barIndex, position): BuiltBar => {
      const barWidth = plan.barWidths[position] ?? 0;
      const meter =
        measures[barIndex]?.showMeter === true ? index.bars[barIndex]?.timeSignature : undefined;
      const staves = score.staves.map((_, staffIndex) => {
        const stave = new Stave(x, (topLines[staffIndex] ?? 0) - STAVE_HEADROOM, barWidth);
        decorateStave(stave, score, staffIndex, position === 0, meter);
        if (barIndex === index.bars.length - 1) {
          stave.setEndBarType(BarlineType.END);
        }
        stave.setDefaultLedgerLineStyle({ strokeStyle: ink, lineWidth: 1.4 });
        return stave;
      });
      const glyphs = buildBar(prepared, barIndex, staves, measures[barIndex]?.room);
      const noteStartX = Math.max(...staves.map((stave) => stave.getNoteStartX()));
      for (const stave of staves) {
        stave.setNoteStartX(noteStartX);
      }
      const justify = (staves[0]?.getNoteEndX() ?? noteStartX) - noteStartX - BAR_END_PADDING;
      glyphs.formatter.format([...glyphs.voices], justify);
      separateVoices(glyphs);
      systemEvents.push(...glyphs.staves.flatMap((staff) => staff.events));
      for (const glyph of glyphs.notes) {
        notes.set(glyph.noteId, glyph);
      }
      x += barWidth;
      return { glyphs, staves };
    });
    return {
      plan,
      bars,
      events: new Map(systemEvents.map((event) => [event.eventId, event.note])),
      staffEvents: score.staves.map((_, staffIndex) =>
        systemEvents
          .filter((event) => event.staffIndex === staffIndex)
          .sort((a, b) => compareFractions(a.onset, b.onset))
          .map((event) => event.note),
      ),
      notes,
      degreeRows: () => (degreeRows ??= degreeRowsOf(notes)),
    };
  };

  /**
   * Each hairpin's part on every system it crosses, left to right: from its
   * start event (after a mark on it) or the system's first event, to the end
   * of its end event (before the next event, a mark written right after it
   * and the bar line) or of the system.
   */
  const hairpinParts = (built: readonly BuiltSystem[]): Map<string, OpenedPart[]> =>
    new Map(
      hairpins.map((hairpin) => {
        const parts: HairpinPart[] = [];
        for (let system = hairpin.startSystem; system <= hairpin.endSystem; system += 1) {
          const on = built[system];
          const ends =
            on === undefined
              ? undefined
              : spanEnds(
                  hairpin,
                  on,
                  on.events.get(hairpin.startEventId),
                  on.events.get(hairpin.endEventId),
                );
          if (on === undefined || ends === undefined) {
            break;
          }
          const { from, to } = ends;
          const nextOnStaff = (on.staffEvents[hairpin.staffIndex] ?? []).find(
            (candidate) => candidate.getAbsoluteX() > to.getAbsoluteX() + 1,
          );
          const endX =
            Math.min(nextOnStaff?.getAbsoluteX() ?? Infinity, barlineLeft(to.checkStave())) -
            HAIRPIN_END_GAP;
          // A hairpin starting on a dynamic mark starts after it.
          const markWidth =
            system === hairpin.startSystem
              ? markLabelWidth(on.bars, hairpin.startEventId, prepared)
              : 0;
          const x0 = from.getAbsoluteX() + (markWidth > 0 ? markWidth + HAIRPIN_MARK_GAP : 0);
          // One ending before a dynamic mark (the common "< f") stops short of the mark's ink.
          const markLeft = nextMarkLeft(on.bars, hairpin.staffIndex, to.getAbsoluteX());
          const x1 = Math.min(
            Math.max(to.getModifierStartXY(Modifier.Position.BELOW, 0).x, endX),
            markLeft - HAIRPIN_MARK_GAP,
          );
          // Never shorter than it is open, nor reversed.
          parts.push({ system, x0, x1: Math.max(x1, x0 + HAIRPIN_HEIGHT) });
        }
        return [hairpin.id, openings(parts, hairpin.direction)];
      }),
    );

  /** The label rows a system has, each staff's in order outward (see ROWS_ABOVE, ROWS_BELOW). */
  const rowsOf = (built: BuiltSystem): LabelRow[] => {
    const system = built.plan.index;
    return score.staves.flatMap((_, staffIndex): LabelRow[] => {
      const staffBars = built.bars.flatMap(({ glyphs }) => glyphs.staves[staffIndex] ?? []);
      const present: Readonly<Record<RowKind, number>> = {
        'chord-symbols': staffBars.some((staff) => staff.chordSymbols.length > 0) ? 1 : 0,
        swing: staffIndex === 0 && system === 0 && swing !== undefined ? 1 : 0,
        // One row per sub-row of scale degrees (see `degreeRowsOf`).
        'scale-degrees': Math.max(
          0,
          ...(score.scaleDegrees ?? []).flatMap((label) =>
            built.notes.get(label.noteId)?.staffIndex === staffIndex
              ? [(built.degreeRows().get(label.id) ?? 0) + 1]
              : [],
          ),
        ),
        // One row per level of dynamic marks; level 0 also holds the hairpins.
        dynamics: Math.max(
          0,
          ...staffBars.flatMap((staff) => staff.dynamics.map((mark) => mark.row + 1)),
          hairpins.some((item) => item.staffIndex === staffIndex && touches(item, system)) ? 1 : 0,
        ),
        // Pedal marks sit on the systems where a span starts ("Ped.") and ends (release).
        pedal: pedals.some(
          (item) =>
            item.staffIndex === staffIndex &&
            (item.startSystem === system || item.endSystem === system),
        )
          ? 1
          : 0,
        'roman-numerals': staffBars.some((staff) => staff.romanNumerals.length > 0) ? 1 : 0,
      };
      return [...ROWS_ABOVE, ...ROWS_BELOW].flatMap((kind) =>
        Array.from({ length: present[kind] }, (_, level) => ({ kind, staffIndex, level })),
      );
    });
  };

  /** Draws one staff of a system: staves, notes and their modifiers, beams, tuplets, ties, slurs. */
  const drawNotation = (built: BuiltSystem, staffIndex: number): void => {
    for (const { glyphs, staves } of built.bars) {
      staves[staffIndex]?.setContext(ctx).draw();
      const staff = glyphs.staves[staffIndex];
      if (staff === undefined) {
        continue;
      }
      for (const event of staff.events) {
        event.note.setStemStyle({ strokeStyle: ink, fillStyle: ink });
      }
      for (const voice of staff.musicVoices) {
        voice.draw(ctx, staff.stave);
      }
      for (const beam of staff.beams) {
        beam.setContext(ctx).draw();
      }
      for (const { tuplet } of staff.tuplets) {
        tuplet.setContext(ctx).draw();
      }
    }

    // A tie split by a system break is drawn on both systems, from or to the edge.
    for (const tie of index.ties) {
      const from = built.notes.get(tie.from.id);
      const to = built.notes.get(tie.to.id);
      if ((from ?? to)?.staffIndex !== staffIndex) {
        continue;
      }
      const notes =
        from !== undefined && to !== undefined
          ? {
              firstNote: from.note,
              lastNote: to.note,
              firstIndexes: [from.index],
              lastIndexes: [to.index],
            }
          : from !== undefined
            ? { firstNote: from.note, firstIndexes: [from.index], lastIndexes: [from.index] }
            : to !== undefined
              ? { lastNote: to.note, firstIndexes: [to.index], lastIndexes: [to.index] }
              : undefined;
      if (notes === undefined) {
        continue;
      }
      openLabelGroup(ctx, 'tie', { 'tie-from': tie.from.id, 'tie-to': tie.to.id });
      new StaveTie(notes).setContext(ctx).draw();
      ctx.closeGroup();
    }

    for (const slur of slurs) {
      if (slur.staffIndex !== staffIndex || !touches(slur, built.plan.index)) {
        continue;
      }
      const ends = spanEnds(
        slur,
        built,
        built.notes.get(slur.startNoteId)?.note,
        built.notes.get(slur.endNoteId)?.note,
      );
      if (ends === undefined) {
        continue;
      }
      openLabelGroup(ctx, 'slur', { 'slur-id': slur.id });
      new Curve(ends.from, ends.to, {}).setContext(ctx).draw();
      ctx.closeGroup();
    }
  };

  /** Draws one label row of a system on its line (see `SystemVertical.rowLines`). */
  const drawRow = (
    built: BuiltSystem,
    row: LabelRow,
    line: number,
    parts: ReadonlyMap<string, readonly OpenedPart[]>,
  ): void => {
    const { staffIndex } = row;
    const staffBars = built.bars.flatMap(({ glyphs }) => glyphs.staves[staffIndex] ?? []);
    switch (row.kind) {
      case 'chord-symbols':
        for (const { id, note } of staffBars.flatMap((staff) => staff.chordSymbols)) {
          openLabelGroup(ctx, 'chord-symbol', { 'harmony-id': id });
          note.setLine(textNoteLine(line, note.checkStave())).setContext(ctx).draw();
          ctx.closeGroup();
        }
        return;
      case 'roman-numerals':
        for (const { id, note } of staffBars.flatMap((staff) => staff.romanNumerals)) {
          openLabelGroup(ctx, 'roman-numeral', { 'harmony-id': id });
          note.setLine(textNoteLine(line, note.checkStave())).setContext(ctx).draw();
          ctx.closeGroup();
        }
        return;
      case 'dynamics':
        for (const { id, note, row: level } of staffBars.flatMap((staff) => staff.dynamics)) {
          if (level !== row.level) {
            continue;
          }
          openLabelGroup(ctx, 'dynamic', { 'dynamic-id': id });
          note
            .setLine(textNoteLine(line + MARK_BASELINE, note.checkStave()))
            .setContext(ctx)
            .draw();
          ctx.closeGroup();
        }
        if (row.level > 0) {
          return;
        }
        for (const hairpin of hairpins) {
          const part = parts.get(hairpin.id)?.find((item) => item.system === built.plan.index);
          if (hairpin.staffIndex !== staffIndex || part === undefined) {
            continue;
          }
          openLabelGroup(ctx, 'hairpin', { 'dynamic-id': hairpin.id });
          drawWedge(ctx, part, line, ink);
          ctx.closeGroup();
        }
        return;
      case 'pedal':
        for (const pedal of pedals) {
          const depress = built.plan.index === pedal.startSystem;
          const release = built.plan.index === pedal.endSystem;
          // A system the pedal only crosses: nothing is written, the pedal stays down.
          const ends =
            pedal.staffIndex === staffIndex && (depress || release)
              ? spanEnds(
                  pedal,
                  built,
                  built.events.get(pedal.startEventId),
                  built.events.get(pedal.endEventId),
                )
              : undefined;
          if (ends === undefined) {
            continue;
          }
          openLabelGroup(ctx, 'pedal', { 'pedal-id': pedal.id });
          const marking = new PedalPart(ends.from, ends.to, depress, release);
          marking.setLine(pedalLine(line, ends.from.checkStave()));
          marking.renderOptions.color = ink;
          marking.setContext(ctx).draw();
          ctx.closeGroup();
        }
        return;
      case 'scale-degrees':
        for (const label of score.scaleDegrees ?? []) {
          const glyph = built.notes.get(label.noteId);
          if (
            glyph?.staffIndex !== staffIndex ||
            (built.degreeRows().get(label.id) ?? 0) !== row.level
          ) {
            continue;
          }
          const box = boxOf(glyph.note, glyph.index);
          const text = scaleDegreeText(label);
          openLabelGroup(ctx, 'scale-degree', {
            'scale-degree-id': label.id,
            'note-id': label.noteId,
          });
          ctx.setFont(LABEL_FONT, DEGREE_FONT_SIZE);
          const textWidth = ctx.measureText(text).width;
          ctx.fillText(text, box.x + box.width / 2 - textWidth / 2, line);
          ctx.closeGroup();
        }
        return;
      case 'swing':
        openLabelGroup(ctx, 'swing', {});
        ctx.setFont(LABEL_FONT, SWING_FONT_SIZE, 'bold');
        ctx.fillText(
          swing?.displayText ?? 'Swing',
          built.bars[0]?.staves[0]?.getX() ?? leftEdge,
          line,
        );
        ctx.closeGroup();
        return;
    }
  };

  const measurer = textMeasurer();

  // Measure: every system on provisional staves (top lines at 0), each
  // staff's notation and each row (on line 0) drawn in a scratch group of its
  // own, then measured together once everything is drawn.
  const provisionalLines = score.staves.map(() => 0);
  const provisional = plans.map((plan) => buildSystem(plan, provisionalLines));
  const provisionalParts = hairpinParts(provisional);
  const scratch = ctx.openGroup('measure');
  const probes = provisional.map((built) => {
    const probe = (draw: () => void): SVGGElement => {
      const group = ctx.openGroup('probe');
      draw();
      ctx.closeGroup();
      return group;
    };
    const notation = score.staves.map((_, staffIndex) =>
      probe(() => {
        drawNotation(built, staffIndex);
      }),
    );
    // After the notes are drawn (see `BuiltSystem.degreeRows`).
    const rows = rowsOf(built);
    return {
      rows,
      notation,
      rowProbes: rows.map(
        (row) =>
          [
            rowKey(row),
            probe(() => {
              drawRow(built, row, 0, provisionalParts);
            }),
          ] as const,
      ),
    };
  });
  ctx.closeGroup();
  const layouts = probes.map(({ rows, notation, rowProbes }) => {
    // A row whose ink cannot be measured (only zero-size shapes) still gets its line.
    const rowInk = new Map<string, Extent>(
      rowProbes.map(([key, group]) => [key, verticalInk(group, measurer) ?? { top: 0, bottom: 0 }]),
    );
    const notationInk = notation.map((group) => verticalInk(group, measurer));
    return { rows, vertical: planVertical(rows, notationInk, rowInk) };
  });
  scratch.remove();

  // Build and draw every system on its final staves, rows on their lines.
  const built = plans.map((plan, position) =>
    buildSystem(plan, layouts[position]?.vertical.topLines ?? provisionalLines),
  );
  const parts = hairpinParts(built);
  const noteheads = new Map<string, SVGElement>();
  const drawn = built.map((system, position) => {
    const { plan, bars } = system;
    const layout = layouts[position];
    const group = ctx.openGroup('system');
    group.setAttribute('data-system-index', String(plan.index));

    score.staves.forEach((_, staffIndex) => {
      drawNotation(system, staffIndex);
    });
    if (grandStaff) {
      bars.forEach(({ glyphs, staves }, barPosition) => {
        const top = staves[0];
        const bottom = staves[staves.length - 1];
        if (top === undefined || bottom === undefined) {
          return;
        }
        const connect = (
          type: 'brace' | 'singleLeft' | 'singleRight' | 'boldDoubleRight',
        ): void => {
          new StaveConnector(top, bottom).setType(type).setContext(ctx).draw();
        };
        if (barPosition === 0) {
          connect('brace');
          connect('singleLeft');
        }
        connect(glyphs.barIndex === index.bars.length - 1 ? 'boldDoubleRight' : 'singleRight');
      });
    }
    for (const row of layout?.rows ?? []) {
      const line = layout?.vertical.rowLines.get(rowKey(row));
      if (line !== undefined) {
        drawRow(system, row, line, parts);
      }
    }

    const drawnGroups = groupsById(group);
    const notes: { readonly glyph: NoteGlyph; readonly box: Box }[] = [];
    for (const { glyphs } of bars) {
      for (const glyph of glyphs.notes) {
        const head = glyph.note.noteHeads[glyph.index];
        const headGroup =
          head === undefined ? undefined : drawnGroups.get(`vf-${String(head.getAttribute('id'))}`);
        const glyphText = Array.from(headGroup?.children ?? []).find(
          (child) => child.tagName.toLowerCase() === 'text',
        );
        if (headGroup === undefined || !(glyphText instanceof SVGElement)) {
          throw new Error(`Notehead of ${glyph.noteId} was not drawn`);
        }
        headGroup.setAttribute('data-note-id', glyph.noteId);
        noteheads.set(glyph.noteId, glyphText);
        notes.push({ glyph, box: boxOf(glyph.note, glyph.index) });
      }
    }
    ctx.closeGroup();

    const firstStaves = bars[0]?.staves ?? [];
    const lastStaves = bars[bars.length - 1]?.staves ?? [];
    const stavesBox = (staffIndex: number): Box => {
      const first = firstStaves[staffIndex];
      const last = lastStaves[staffIndex];
      const x0 = first?.getX() ?? leftEdge;
      const top = first?.getYForLine(0) ?? 0;
      return {
        x: x0,
        y: top,
        width: (last === undefined ? x0 : last.getX() + last.getWidth()) - x0,
        height: (first?.getYForLine(4) ?? top) - top,
      };
    };
    const staffBoxes = score.staves.map((_, staffIndex) => stavesBox(staffIndex));
    const allStaves = staffBoxes.reduce<Box | undefined>(
      (box, part) => union(box, part),
      undefined,
    );
    return {
      plan,
      group,
      staffBoxes,
      notes,
      ink: inkBounds(group, measurer) ?? allStaves ?? { x: leftEdge, y: 0, width: 0, height: 0 },
      annotated: notes.some(({ glyph }) => prepared.colors.has(glyph.noteId)),
    };
  });

  // Stack systems top to bottom from their measured ink.
  const systemLayouts: SystemLayout[] = [];
  const notes = new Map<string, NoteLayout>();
  let cursor = TOP_MARGIN;
  let right = width;
  for (const system of drawn) {
    const band = system.annotated ? options.annotationBandHeight : 0;
    const top = cursor + band;
    const dy = top - system.ink.y;
    system.group.setAttribute('transform', `translate(0,${dy})`);
    const systemId = `system-${system.plan.index}`;
    const stavesUnion = system.staffBoxes.reduce<Box | undefined>(
      (box, part) => union(box, part),
      undefined,
    );
    const stavesX = stavesUnion?.x ?? leftEdge;
    const stavesWidth = stavesUnion?.width ?? 0;
    systemLayouts.push({
      systemId,
      index: system.plan.index,
      measureIds: system.plan.bars.map((barIndex) => index.bars[barIndex]?.id ?? ''),
      staves: system.staffBoxes.map((box, staffIndex) => ({
        staffId: score.staves[staffIndex]?.id ?? '',
        bounds: translated(box, dy),
      })),
      bounds: translated(system.ink, dy),
      annotationBand: { x: stavesX, y: top - band, width: Math.max(0, stavesWidth), height: band },
    });
    for (const { glyph, box } of system.notes) {
      notes.set(glyph.noteId, {
        noteId: glyph.noteId,
        systemId,
        staffId: score.staves[glyph.staffIndex]?.id ?? '',
        measureId: glyph.measureId,
        bounds: translated(box, dy),
      });
    }
    // Ink may reach into the right margin (a justified barline's stroke ends
    // half a pixel past it): the surface grows only for ink past its edge.
    right = Math.max(right, Math.ceil(system.ink.x + system.ink.width));
    cursor = top + system.ink.height + SYSTEM_GAP;
  }
  const height = Math.ceil(cursor - SYSTEM_GAP + BOTTOM_MARGIN);
  svg.setAttribute('width', String(right));
  svg.setAttribute('height', String(height));
  svg.style.width = `${right}px`;
  svg.style.height = `${height}px`;

  return {
    svg,
    layoutMap: { width: right, height, systems: systemLayouts, notes },
    noteheads,
  };
}

/** A hairpin's part on one system, with its opening (px) at both ends. */
interface HairpinPart {
  readonly system: number;
  readonly x0: number;
  readonly x1: number;
}

interface OpenedPart extends HairpinPart {
  readonly open0: number;
  readonly open1: number;
}

/**
 * Openings along the whole hairpin, in proportion to the drawn length: a
 * crescendo opens from a point to HAIRPIN_HEIGHT, a diminuendo closes to a
 * point, and a part continued on the next system ends where that one starts.
 */
function openings(
  parts: readonly HairpinPart[],
  direction: 'crescendo' | 'diminuendo',
): OpenedPart[] {
  const lengths = parts.map((part) => Math.max(0, part.x1 - part.x0));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const openingAt = (fraction: number): number =>
    HAIRPIN_HEIGHT * (direction === 'crescendo' ? fraction : 1 - fraction);
  let before = 0;
  return parts.map((part, index) => {
    const start = total > 0 ? before / total : index / parts.length;
    before += lengths[index] ?? 0;
    const end =
      index === parts.length - 1 ? 1 : total > 0 ? before / total : (index + 1) / parts.length;
    return { ...part, open0: openingAt(start), open1: openingAt(end) };
  });
}

/** Draws a hairpin part: two lines meeting at the point, or two open lines for a continued part. */
function drawWedge(ctx: SVGContext, part: OpenedPart, center: number, ink: string): void {
  const { x0, x1, open0, open1 } = part;
  ctx.save();
  ctx.setStrokeStyle(ink);
  ctx.setLineWidth(1);
  ctx.beginPath();
  if (open0 === 0) {
    ctx.moveTo(x1, center - open1 / 2);
    ctx.lineTo(x0, center);
    ctx.lineTo(x1, center + open1 / 2);
  } else if (open1 === 0) {
    ctx.moveTo(x0, center - open0 / 2);
    ctx.lineTo(x1, center);
    ctx.lineTo(x0, center + open0 / 2);
  } else {
    ctx.moveTo(x0, center - open0 / 2);
    ctx.lineTo(x1, center - open1 / 2);
    ctx.moveTo(x0, center + open0 / 2);
    ctx.lineTo(x1, center + open1 / 2);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * A pedal span's marks on one system: "Ped." at its start event on the system
 * where it starts, the release on the system where it ends, ending
 * RELEASE_GAP before the next event of the end event's voice or the bar line
 * (PedalMarking would end it on them, touching the "Ped." of a pedal change).
 */
class PedalPart extends PedalMarking {
  constructor(from: StaveNote, to: StaveNote, depress: boolean, release: boolean) {
    super([from, to]);
    this.setType(PedalMarking.type.TEXT);
    if (!depress) {
      this.depressText = '';
    }
    if (!release) {
      this.releaseText = '';
    }
  }

  override drawText(): void {
    const ctx = this.checkContext();
    const [from, to] = this.notes;
    if (from !== undefined && this.depressText !== '') {
      const y = from.checkStave().getYForBottomText(this.line + 3);
      ctx.fillText(this.depressText, from.getAbsoluteX(), y);
    }
    if (to !== undefined && this.releaseText !== '') {
      const stave = to.checkStave();
      const right = releaseAnchor(to, barlineLeft(stave)) - RELEASE_GAP;
      const width = ctx.measureText(this.releaseText).width;
      ctx.fillText(this.releaseText, right - width, stave.getYForBottomText(this.line + 3));
    }
  }
}

/**
 * Left edge of the ink of the first dynamic mark of the row hairpins share
 * (level 0) on a staff after `x`, or Infinity.
 */
function nextMarkLeft(
  bars: readonly { readonly glyphs: BarGlyphs }[],
  staffIndex: number,
  x: number,
): number {
  let left = Number.POSITIVE_INFINITY;
  for (const { glyphs } of bars) {
    for (const { note, row } of glyphs.staves[staffIndex]?.dynamics ?? []) {
      if (row === 0 && note.getAbsoluteX() > x + 1) {
        left = Math.min(left, note.getAbsoluteX() - note.getTextMetrics().actualBoundingBoxLeft);
      }
    }
  }
  return left;
}

function markLabelWidth(
  bars: readonly { readonly glyphs: BarGlyphs }[],
  eventId: string,
  prepared: PreparedScore,
): number {
  const markId = prepared.markByEvent.get(eventId)?.id;
  if (markId === undefined) {
    return 0;
  }
  for (const { glyphs } of bars) {
    for (const staff of glyphs.staves) {
      const label = staff.dynamics.find((dynamic) => dynamic.id === markId);
      if (label !== undefined) {
        return label.note.getWidth();
      }
    }
  }
  return 0;
}
