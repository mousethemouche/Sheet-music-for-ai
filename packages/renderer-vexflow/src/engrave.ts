/**
 * Engraving of a prepared score into an SVG element, and the neutral
 * LayoutMap measured from what was drawn (RENDER_PLAYBACK_PORTS.md §2.4-2.7).
 *
 * 1. Every bar is built on placeholder staves to measure its minimum width
 *    and its vertical extent per staff, with the room some onsets need
 *    (short pedal spans, voices moved aside; see `barRoom`).
 * 2. Bars are broken into systems that fit the width (greedy), then justified.
 * 3. Each system gets label rows (chord symbols above the top staff; scale
 *    degrees, dynamics/hairpins, pedal and Roman numerals below their staff),
 *    is rebuilt on its final staves, formatted and drawn into its own group.
 * 4. Systems are stacked from their measured ink bounds, leaving the
 *    annotation band above each system that holds an annotated note.
 *
 * Noteheads are located with VexFlow's own geometry (tight glyph metrics);
 * system bounds are measured from the drawn SVG, text included.
 */
import {
  type Fraction,
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
  BarlineType,
  Curve,
  Element as VexElement,
  Modifier,
  PedalMarking,
  SVGContext,
  Stave,
  StaveConnector,
  type StaveNote,
  StaveTie,
  Stem,
} from 'vexflow/bravura';
import {
  type BarGlyphs,
  type EventGlyph,
  type NoteGlyph,
  type PreparedScore,
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
const STAFF_GAP = 12;
const TOP_MARGIN = 8;
const BOTTOM_MARGIN = 8;
const LABEL_FONT = 'Academico';
const DEGREE_FONT_SIZE = 11;
const SWING_FONT_SIZE = 12;
const HAIRPIN_HEIGHT = 10;
/** Distance between two rows of dynamic marks sharing an onset. */
const DYNAMIC_ROW = 20;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Vertical room a staff needs beyond its lines, in staff spaces. */
interface StaffExtent {
  readonly above: number;
  readonly below: number;
}

interface BarMeasure {
  readonly content: number;
  readonly showMeter: boolean;
  readonly beginStart: number;
  readonly beginContinued: number;
  readonly extents: readonly StaffExtent[];
  readonly hasChordSymbols: boolean;
  readonly hasRomanNumerals: boolean;
  /** Rows of dynamic marks each staff needs in this bar (absent: none). */
  readonly markRows: ReadonlyMap<number, number>;
  /** Minimum widths at some onsets of this bar, by event (see `barRoom`). */
  readonly room: ReadonlyMap<string, number>;
}

interface SystemPlan {
  readonly index: number;
  readonly bars: readonly number[];
  /** Width of each bar's staves, in order. */
  readonly barWidths: readonly number[];
}

/** Label rows of one staff of one system (y in local system coordinates). */
interface StaffRows {
  readonly topLine: number;
  readonly degreeBaseline: number;
  readonly dynamicsCenter: number;
  readonly pedalBaseline: number;
  readonly romanBaseline: number;
}

interface SystemRows {
  readonly staves: readonly StaffRows[];
  readonly chordBaseline: number;
  readonly swingBaseline: number;
}

/** A span (slur, hairpin, pedal) located by its end events. */
interface Span {
  readonly id: string;
  readonly staffIndex: number;
  readonly startSystem: number;
  readonly endSystem: number;
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

const ABOVE: number = Modifier.Position.ABOVE;
const BELOW: number = Modifier.Position.BELOW;

/** Half a notehead plus clearance, in staff spaces. */
const NOTEHEAD_CLEARANCE = 0.75;
/** Room for a slur curve on either side of the notes, in staff spaces. */
const SLUR_ROOM = 1.5;

/** How far a staff's notes and their modifiers reach beyond its lines. */
function staffExtent(glyphs: BarGlyphs, staffIndex: number, slurred: boolean): StaffExtent {
  const staff = glyphs.staves[staffIndex];
  let above = 0;
  let below = 0;
  for (const { note } of staff?.events ?? []) {
    if (note.isRest()) {
      continue;
    }
    const lines = note.getKeyProps().map((props) => props.line);
    const stemUp = note.getStemDirection() === Stem.UP;
    let top = Math.max(...lines) + (stemUp ? 3.5 : 0);
    let bottom = Math.min(...lines) - (stemUp ? 0 : 3.5);
    for (const modifier of note.getModifiers()) {
      const category = modifier.getCategory();
      if (category !== 'Articulation' && category !== 'FretHandFinger') {
        continue;
      }
      const position: number = modifier.getPosition();
      if (position === ABOVE) {
        top += 1.5;
      } else if (position === BELOW) {
        bottom -= 1.5;
      }
    }
    // VexFlow lines: 1 is the bottom line, 5 the top line.
    above = Math.max(above, top - 5 + NOTEHEAD_CLEARANCE);
    below = Math.max(below, 1 - bottom + NOTEHEAD_CLEARANCE);
  }
  if (slurred) {
    above += SLUR_ROOM;
    below += SLUR_ROOM;
  }
  for (const { below: under } of staff?.tuplets ?? []) {
    if (under) {
      below += 2;
    } else {
      above += 2;
    }
  }
  return { above, below };
}

function measureBars(prepared: PreparedScore): BarMeasure[] {
  const { score, index } = prepared;
  const slurredBars = new Set<string>();
  for (const slur of score.slurs ?? []) {
    const start = index.location(slur.startNoteId);
    const end = index.location(slur.endNoteId);
    for (
      let barIndex = start?.measureIndex ?? 0;
      barIndex <= (end?.measureIndex ?? -1);
      barIndex += 1
    ) {
      slurredBars.add(`${start?.staffIndex ?? 0}:${barIndex}`);
    }
  }
  const placeholders = (): Stave[] => score.staves.map(() => new Stave(0, 0, 10_000));
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
    let glyphs = buildBar(prepared, barIndex, placeholders());
    let content = glyphs.formatter.preCalculateMinTotalWidth([...glyphs.voices]);
    const room = roomBars.has(barIndex)
      ? barRoom(
          prepared,
          buildBar(prepared, barIndex, placeholders()),
          content * SPACING_FACTOR + NOTE_ROOM,
        )
      : new Map<string, number>();
    if (room.size > 0) {
      glyphs = buildBar(prepared, barIndex, placeholders(), room);
      content = glyphs.formatter.preCalculateMinTotalWidth([...glyphs.voices]);
    }
    const previous = index.bars[barIndex - 1];
    const showMeter =
      previous === undefined || !meterEquals(previous.timeSignature, bar.timeSignature);
    return {
      content,
      showMeter,
      beginStart: beginWidth(prepared, barIndex, true, showMeter),
      beginContinued: beginWidth(prepared, barIndex, false, showMeter),
      extents: score.staves.map((_, staffIndex) =>
        staffExtent(glyphs, staffIndex, slurredBars.has(`${staffIndex}:${barIndex}`)),
      ),
      hasChordSymbols: glyphs.staves.some((staff) => staff.chordSymbols.length > 0),
      hasRomanNumerals: glyphs.staves.some((staff) => staff.romanNumerals.length > 0),
      markRows: new Map(
        glyphs.staves.flatMap((staff) =>
          staff.dynamics.length > 0
            ? [[staff.staffIndex, 1 + Math.max(...staff.dynamics.map((mark) => mark.row))]]
            : [],
        ),
      ),
      room,
    };
  });
}

/**
 * Minimum widths some onsets of a bar need beyond what VexFlow reserves, by
 * event, found by formatting a fresh build (`glyphs`) at the bar's natural
 * width (justification only widens it):
 * - a pedal span too short for its "Ped." and release marks (one or a few
 *   short notes) gets their width after its start event. The release is
 *   right-aligned on the end of the span, as PedalMarking draws it: the next
 *   event of the end event's voice, or the bar end; a span ending in a later
 *   bar needs its room before this bar line;
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
    const barEnd = start.checkStave().getNoteStartX() + width + BAR_END_PADDING;
    const end = starts.get(pedal.endEventId);
    let releaseEnd = barEnd;
    if (end !== undefined) {
      const voiceNotes = end.getVoice().getTickables();
      releaseEnd = voiceNotes[voiceNotes.indexOf(end) + 1]?.getAbsoluteX() ?? barEnd;
    }
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

/** Row placement for one system, from its content (staff spaces) and labels. */
function planRows(
  prepared: PreparedScore,
  plan: SystemPlan,
  measures: readonly BarMeasure[],
  needs: {
    readonly degrees: ReadonlySet<number>;
    /** Rows of dynamics (marks and hairpins) per staff. */
    readonly dynamics: ReadonlyMap<number, number>;
    readonly pedal: ReadonlySet<number>;
  },
): SystemRows {
  const { score } = prepared;
  const lastStaff = score.staves.length - 1;
  const bars = plan.bars.map((barIndex) => measures[barIndex] as BarMeasure);
  const extent = (staffIndex: number): StaffExtent => ({
    above: Math.max(0, ...bars.map((bar) => bar.extents[staffIndex]?.above ?? 0)),
    below: Math.max(0, ...bars.map((bar) => bar.extents[staffIndex]?.below ?? 0)),
  });
  const hasChords = bars.some((bar) => bar.hasChordSymbols);
  const hasRoman = bars.some((bar) => bar.hasRomanNumerals);
  const hasSwing = plan.index === 0 && score.playbackFeel?.type === 'swing';

  // Above the top staff, relative to its top line (negative is higher).
  let cursor = -Math.max(1.5, extent(0).above) * SPACE;
  const chordBaseline = cursor - 4;
  if (hasChords) {
    cursor = chordBaseline - 14;
  }
  const swingBaseline = cursor - 4;
  if (hasSwing) {
    cursor = swingBaseline - 14;
  }
  let topLine = -cursor;
  const staves: StaffRows[] = [];
  score.staves.forEach((_, staffIndex) => {
    if (staffIndex > 0) {
      topLine = cursor + STAFF_GAP + Math.max(1.5, extent(staffIndex).above) * SPACE;
    }
    cursor = topLine + STAFF_HEIGHT + Math.max(1, extent(staffIndex).below) * SPACE;
    const degreeBaseline = cursor + 13;
    if (needs.degrees.has(staffIndex)) {
      cursor = degreeBaseline + 3;
    }
    const dynamicsCenter = cursor + 12;
    const dynamicRows = needs.dynamics.get(staffIndex) ?? 0;
    if (dynamicRows > 0) {
      cursor = dynamicsCenter + 8 + (dynamicRows - 1) * DYNAMIC_ROW;
    }
    const pedalBaseline = cursor + 20;
    if (needs.pedal.has(staffIndex)) {
      cursor = pedalBaseline + 8;
    }
    const romanBaseline = cursor + 15;
    if (hasRoman && staffIndex === lastStaff) {
      cursor = romanBaseline + 4;
    }
    staves.push({ topLine, degreeBaseline, dynamicsCenter, pedalBaseline, romanBaseline });
  });
  return {
    staves,
    chordBaseline: chordBaseline + topLineOf(staves),
    swingBaseline: swingBaseline + topLineOf(staves),
  };
}

const topLineOf = (staves: readonly StaffRows[]): number => staves[0]?.topLine ?? 0;

/** Line for VexFlow text notes, which draw at `stave.getYForLine(line - 3)`. */
function textNoteLine(baseline: number, topLine: number): number {
  return (baseline - topLine) / SPACE + 3;
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

interface EventPlacement {
  readonly note: StaveNote;
  readonly staffIndex: number;
  readonly system: number;
  readonly onset: Fraction;
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

  const ctx = new SVGContext(container);
  const svg = ctx.svg;
  onSvgCreated(svg);
  svg.style.display = 'block';
  svg.setAttribute('fill', ink);
  svg.setAttribute('stroke', ink);
  ctx.setFillStyle(ink);
  ctx.setStrokeStyle(ink);

  // Build and format every system on its final staves.
  const events = new Map<string, EventPlacement>();
  const noteGlyphs = new Map<string, NoteGlyph & { readonly system: number }>();
  const systems = plans.map((plan) => {
    const needs = {
      degrees: new Set<number>(),
      dynamics: new Map<number, number>(),
      pedal: new Set<number>(),
    };
    const needDynamics = (staffIndex: number, rows: number): void => {
      needs.dynamics.set(staffIndex, Math.max(rows, needs.dynamics.get(staffIndex) ?? 0));
    };
    for (const barIndex of plan.bars) {
      for (const [staffIndex, rows] of measures[barIndex]?.markRows ?? []) {
        needDynamics(staffIndex, rows);
      }
    }
    for (const label of score.scaleDegrees ?? []) {
      if (systemOf(label.noteId) === plan.index) {
        needs.degrees.add(staffOf(label.noteId));
      }
    }
    for (const hairpin of hairpins) {
      if (touches(hairpin, plan.index)) {
        needDynamics(hairpin.staffIndex, 1);
      }
    }
    for (const pedal of pedals) {
      // Pedal marks sit on the systems where the span starts ("Ped.") and ends (release).
      if (plan.index === pedal.startSystem || plan.index === pedal.endSystem) {
        needs.pedal.add(pedal.staffIndex);
      }
    }
    const rows = planRows(prepared, plan, measures, needs);
    let x = leftEdge;
    const bars = plan.bars.map((barIndex, position) => {
      const barWidth = plan.barWidths[position] ?? 0;
      const meter =
        measures[barIndex]?.showMeter === true ? index.bars[barIndex]?.timeSignature : undefined;
      const staves = score.staves.map((_, staffIndex) => {
        const stave = new Stave(
          x,
          (rows.staves[staffIndex]?.topLine ?? 0) - STAVE_HEADROOM,
          barWidth,
        );
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
      for (const staff of glyphs.staves) {
        for (const event of staff.events) {
          events.set(event.eventId, {
            note: event.note,
            staffIndex: event.staffIndex,
            system: plan.index,
            onset: event.onset,
          });
        }
      }
      for (const glyph of glyphs.notes) {
        noteGlyphs.set(glyph.noteId, { ...glyph, system: plan.index });
      }
      x += barWidth;
      return { glyphs, staves };
    });
    return { plan, rows, bars };
  });

  /** Events of one staff on one system, by onset. */
  const systemEvents = (system: number, staffIndex: number): StaveNote[] =>
    [...events.values()]
      .filter((event) => event.system === system && event.staffIndex === staffIndex)
      .sort((a, b) => compareFractions(a.onset, b.onset))
      .map((event) => event.note);
  /** The part of a span drawn on `system`, from its own ends or the system's edge events. */
  const segment = (
    item: Span,
    system: number,
    from: StaveNote,
    to: StaveNote,
  ): { from: StaveNote; to: StaveNote } => {
    const edge = systemEvents(system, item.staffIndex);
    return {
      from: system === item.startSystem ? from : (edge[0] ?? from),
      to: system === item.endSystem ? to : (edge[edge.length - 1] ?? to),
    };
  };
  const eventNote = (id: string): StaveNote | undefined => events.get(id)?.note;
  const noteOf = (noteId: string): StaveNote | undefined => noteGlyphs.get(noteId)?.note;

  /**
   * Each hairpin's part on every system it crosses, left to right: from its
   * start event (after a mark on it) or the system's first event, to the end
   * of its end event or of the system.
   */
  const hairpinParts = new Map(
    hairpins.map((hairpin) => {
      const start = eventNote(hairpin.startEventId);
      const end = eventNote(hairpin.endEventId);
      const parts: HairpinPart[] = [];
      for (let system = hairpin.startSystem; system <= hairpin.endSystem; system += 1) {
        if (start === undefined || end === undefined || system < 0) {
          break;
        }
        const { from, to } = segment(hairpin, system, start, end);
        const nextOnStaff = systemEvents(system, hairpin.staffIndex).find(
          (candidate) => candidate.getAbsoluteX() > to.getAbsoluteX() + 1,
        );
        const endX =
          Math.min(nextOnStaff?.getAbsoluteX() ?? Infinity, to.checkStave().getNoteEndX()) - 6;
        // A hairpin starting on a dynamic mark starts after it.
        const markWidth =
          system === hairpin.startSystem
            ? markLabelWidth(systems[system]?.bars ?? [], hairpin.startEventId, prepared)
            : 0;
        parts.push({
          system,
          x0: from.getAbsoluteX() + (markWidth > 0 ? markWidth + 6 : 0),
          x1: Math.max(to.getModifierStartXY(Modifier.Position.BELOW, 0).x, endX),
        });
      }
      return [hairpin.id, openings(parts, hairpin.direction)];
    }),
  );

  const measurer = textMeasurer();
  const noteheads = new Map<string, SVGElement>();
  const noteBoxes = new Map<string, Box>();
  const drawn = systems.map(({ plan, rows, bars }) => {
    const group = ctx.openGroup('system');
    group.setAttribute('data-system-index', String(plan.index));
    const annotated = new Set<string>();

    for (const { staves } of bars) {
      for (const stave of staves) {
        stave.setContext(ctx).draw();
      }
    }
    if (grandStaff) {
      bars.forEach(({ staves }, position) => {
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
        if (position === 0) {
          connect('brace');
          connect('singleLeft');
        }
        connect(
          bars[position]?.glyphs.barIndex === index.bars.length - 1
            ? 'boldDoubleRight'
            : 'singleRight',
        );
      });
    }

    for (const { glyphs } of bars) {
      for (const staff of glyphs.staves) {
        const staffRows = rows.staves[staff.staffIndex];
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
        const topLine = staffRows?.topLine ?? 0;
        for (const { id, note } of staff.chordSymbols) {
          openLabelGroup(ctx, 'chord-symbol', { 'harmony-id': id });
          note.setLine(textNoteLine(rows.chordBaseline, topLine)).setContext(ctx).draw();
          ctx.closeGroup();
        }
        for (const { id, note } of staff.romanNumerals) {
          openLabelGroup(ctx, 'roman-numeral', { 'harmony-id': id });
          note
            .setLine(textNoteLine(staffRows?.romanBaseline ?? 0, topLine))
            .setContext(ctx)
            .draw();
          ctx.closeGroup();
        }
        for (const { id, note, row } of staff.dynamics) {
          openLabelGroup(ctx, 'dynamic', { 'dynamic-id': id });
          note
            .setLine(
              textNoteLine((staffRows?.dynamicsCenter ?? 0) + 6 + row * DYNAMIC_ROW, topLine),
            )
            .setContext(ctx)
            .draw();
          ctx.closeGroup();
        }
      }
    }
    const drawnGroups = groupsById(group);
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
        noteBoxes.set(glyph.noteId, boxOf(glyph.note, glyph.index));
        if (prepared.colors.has(glyph.noteId)) {
          annotated.add(glyph.noteId);
        }
      }
    }

    for (const tie of index.ties) {
      const from = noteGlyphs.get(tie.from.id);
      const to = noteGlyphs.get(tie.to.id);
      if (
        from === undefined ||
        to === undefined ||
        (from.system !== plan.index && to.system !== plan.index)
      ) {
        continue;
      }
      openLabelGroup(ctx, 'tie', { 'tie-from': tie.from.id, 'tie-to': tie.to.id });
      const notes =
        from.system === to.system
          ? {
              firstNote: from.note,
              lastNote: to.note,
              firstIndexes: [from.index],
              lastIndexes: [to.index],
            }
          : from.system === plan.index
            ? { firstNote: from.note, firstIndexes: [from.index], lastIndexes: [from.index] }
            : { lastNote: to.note, firstIndexes: [to.index], lastIndexes: [to.index] };
      new StaveTie(notes).setContext(ctx).draw();
      ctx.closeGroup();
    }

    for (const slur of slurs) {
      const start = noteOf(slur.startNoteId);
      const end = noteOf(slur.endNoteId);
      if (start === undefined || end === undefined || !touches(slur, plan.index)) {
        continue;
      }
      const { from, to } = segment(slur, plan.index, start, end);
      openLabelGroup(ctx, 'slur', { 'slur-id': slur.id });
      new Curve(from, to, {}).setContext(ctx).draw();
      ctx.closeGroup();
    }

    for (const hairpin of hairpins) {
      const part = hairpinParts.get(hairpin.id)?.find((item) => item.system === plan.index);
      const staffRows = rows.staves[hairpin.staffIndex];
      if (part === undefined || staffRows === undefined) {
        continue;
      }
      openLabelGroup(ctx, 'hairpin', { 'dynamic-id': hairpin.id });
      drawWedge(ctx, part, staffRows.dynamicsCenter, ink);
      ctx.closeGroup();
    }

    for (const pedal of pedals) {
      const start = eventNote(pedal.startEventId);
      const end = eventNote(pedal.endEventId);
      const staffRows = rows.staves[pedal.staffIndex];
      const depress = plan.index === pedal.startSystem;
      const release = plan.index === pedal.endSystem;
      if (start === undefined || end === undefined || staffRows === undefined) {
        continue;
      }
      if (!depress && !release) {
        // A system the pedal only crosses: nothing is written, the pedal stays down.
        continue;
      }
      const { from, to } = segment(pedal, plan.index, start, end);
      const topLine = from.checkStave().getYForLine(0);
      openLabelGroup(ctx, 'pedal', { 'pedal-id': pedal.id });
      const marking = new PedalPart(from, to, depress, release);
      marking.setLine((staffRows.pedalBaseline - topLine) / SPACE - 7);
      marking.renderOptions.color = ink;
      marking.setContext(ctx).draw();
      ctx.closeGroup();
    }

    for (const label of score.scaleDegrees ?? []) {
      const glyph = noteGlyphs.get(label.noteId);
      const box = noteBoxes.get(label.noteId);
      const staffRows = glyph === undefined ? undefined : rows.staves[glyph.staffIndex];
      if (glyph?.system !== plan.index || box === undefined || staffRows === undefined) {
        continue;
      }
      const text = scaleDegreeText(label);
      openLabelGroup(ctx, 'scale-degree', { 'scale-degree-id': label.id, 'note-id': label.noteId });
      ctx.setFont(LABEL_FONT, DEGREE_FONT_SIZE);
      const textWidth = ctx.measureText(text).width;
      ctx.fillText(text, box.x + box.width / 2 - textWidth / 2, staffRows.degreeBaseline);
      ctx.closeGroup();
    }

    if (plan.index === 0 && score.playbackFeel?.type === 'swing') {
      const firstStave = bars[0]?.staves[0];
      openLabelGroup(ctx, 'swing', {});
      ctx.setFont(LABEL_FONT, SWING_FONT_SIZE, 'bold');
      ctx.fillText(
        score.playbackFeel.displayText ?? 'Swing',
        firstStave?.getX() ?? leftEdge,
        rows.swingBaseline,
      );
      ctx.closeGroup();
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
      ink: inkBounds(group, measurer) ?? allStaves ?? { x: leftEdge, y: 0, width: 0, height: 0 },
      annotated: annotated.size > 0,
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
    for (const [noteId, glyph] of noteGlyphs) {
      const box = noteBoxes.get(noteId);
      if (glyph.system !== system.plan.index || box === undefined) {
        continue;
      }
      notes.set(noteId, {
        noteId,
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
 * A pedal span's marks on one system: "Ped." on the system where it starts,
 * the release (at the end of its end event) on the system where it ends.
 */
class PedalPart extends PedalMarking {
  constructor(from: StaveNote, to: StaveNote, depress: boolean, release: boolean) {
    super([from, to]);
    this.setType(PedalMarking.type.TEXT);
    // PedalMarking writes nothing for an empty text.
    if (!depress) {
      this.depressText = '';
    }
    if (!release) {
      this.releaseText = '';
    }
  }
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
