/**
 * ScoreRenderer fake that follows RENDER_PLAYBACK_PORTS.md §2: calls settle
 * in call order, a rejected call keeps the last good rendering, width 0 draws
 * nothing, bands are reserved above systems holding annotated notes, and the
 * playback highlight is a separate layer over the engraved colors.
 *
 * Its geometry is a fixed grid (one bar = 200 px), so tests can check our own
 * layout arithmetic; it proves nothing about real font or engraving metrics.
 */
import type { ScoreSpec } from '@sheet-music/music-domain';
import {
  type LayoutMap,
  type NoteLayout,
  type RenderOptions,
  type RenderResult,
  type ScoreRenderer,
  type SystemLayout,
  RenderError,
} from '@sheet-music/renderer-core';

export interface RenderCall {
  readonly method: 'render' | 'update' | 'resize';
  readonly score: ScoreSpec;
  readonly options: RenderOptions;
}

const MARGIN = 20;
const BAR_WIDTH = 200;
const FIRST_NOTE_OFFSET = 20;
const NOTE_STEP = 40;
const STAFF_HEIGHT = 40;
const STAFF_SPACING = 30;
const SYSTEM_GAP = 24;

const EMPTY_LAYOUT: LayoutMap = { width: 0, height: 0, systems: [], notes: new Map() };

/** Fixed-grid layout: `floor((width - 40) / 200)` bars per system (at least one). */
export function fakeLayout(score: ScoreSpec, options: RenderOptions): LayoutMap {
  const width = Math.max(options.width, 2 * MARGIN + BAR_WIDTH);
  const barsPerSystem = Math.max(1, Math.floor((width - 2 * MARGIN) / BAR_WIDTH));
  const barCount = score.staves[0]?.measures.length ?? 0;
  const annotated = new Set(score.annotations.flatMap((annotation) => annotation.noteIds));
  const systems: SystemLayout[] = [];
  const notes = new Map<string, NoteLayout>();
  let y = 0;
  for (let first = 0; first < barCount; first += barsPerSystem) {
    const systemId = `system-${systems.length}`;
    const last = Math.min(first + barsPerSystem, barCount);
    const staffWidth = (last - first) * BAR_WIDTH;
    const systemNotes: { note: NoteLayout; staffIndex: number; member: number }[] = [];
    score.staves.forEach((staff, staffIndex) => {
      staff.measures.slice(first, last).forEach((measure, column) => {
        for (const voice of measure.voices) {
          voice.events.forEach((event, eventIndex) => {
            const ids =
              event.type === 'note'
                ? [event.id]
                : event.type === 'chord'
                  ? event.notes.map((member) => member.id)
                  : [];
            ids.forEach((noteId, member) => {
              systemNotes.push({
                staffIndex,
                member,
                note: {
                  noteId,
                  systemId,
                  staffId: staff.id,
                  measureId: measure.id,
                  bounds: {
                    x: MARGIN + column * BAR_WIDTH + FIRST_NOTE_OFFSET + eventIndex * NOTE_STEP,
                    y: 0,
                    width: 10,
                    height: 8,
                  },
                },
              });
            });
          });
        }
      });
    });
    const bandHeight = systemNotes.some(({ note }) => annotated.has(note.noteId))
      ? options.annotationBandHeight
      : 0;
    const top = y + bandHeight;
    const staves = score.staves.map((staff, staffIndex) => ({
      staffId: staff.id,
      bounds: {
        x: MARGIN,
        y: top + STAFF_SPACING / 2 + staffIndex * (STAFF_HEIGHT + STAFF_SPACING),
        width: staffWidth,
        height: STAFF_HEIGHT,
      },
    }));
    for (const { note, staffIndex, member } of systemNotes) {
      const staffTop = staves[staffIndex]?.bounds.y ?? top;
      notes.set(note.noteId, {
        ...note,
        bounds: { ...note.bounds, y: staffTop + 16 - member * 6 },
      });
    }
    const systemHeight = score.staves.length * (STAFF_HEIGHT + STAFF_SPACING);
    systems.push({
      systemId,
      index: systems.length,
      measureIds: score.staves[0]?.measures.slice(first, last).map((m) => m.id) ?? [],
      staves,
      bounds: { x: MARGIN, y: top, width: staffWidth, height: systemHeight },
      annotationBand: { x: MARGIN, y, width: staffWidth, height: bandHeight },
    });
    y = top + systemHeight + SYSTEM_GAP;
  }
  return { width, height: Math.max(0, y - SYSTEM_GAP), systems, notes };
}

interface QueuedCall {
  readonly call: RenderCall;
  readonly resolve: (result: RenderResult) => void;
  readonly reject: (error: RenderError) => void;
}

export class FakeScoreRenderer implements ScoreRenderer {
  /** `manual`: calls stay pending until settleNext()/failNext(). */
  mode: 'auto' | 'manual' = 'auto';
  /** Calls for which this returns true are rejected. */
  failWhen: ((call: RenderCall) => boolean) | null = null;

  readonly calls: RenderCall[] = [];
  /** Score and options of the last successful engraving (positive width). */
  displayed: { readonly score: ScoreSpec; readonly options: RenderOptions } | null = null;
  /** Layout of the last successful engraving. */
  layout: LayoutMap = EMPTY_LAYOUT;
  highlight: ReadonlySet<string> = new Set();
  destroyed = false;
  /** Calls received after destroy(): a correct player sends none. */
  readonly callsAfterDestroy: string[] = [];

  private target: HTMLElement | null = null;
  private latest: { score: ScoreSpec; options: RenderOptions } | null = null;
  private readonly queue: QueuedCall[] = [];

  get pendingCount(): number {
    return this.queue.length;
  }

  render(score: ScoreSpec, target: HTMLElement, options: RenderOptions): Promise<RenderResult> {
    if (this.destroyed || this.target !== null) {
      this.noteMisuse('render');
      return Promise.reject(new RenderError('fake: render after mount or destroy'));
    }
    this.target = target;
    return this.enqueue({ method: 'render', score, options });
  }

  update(score: ScoreSpec, options?: RenderOptions): Promise<RenderResult> {
    const previous = this.latest;
    if (this.destroyed || this.target === null || previous === null) {
      this.noteMisuse('update');
      return Promise.reject(new RenderError('fake: update before render or after destroy'));
    }
    return this.enqueue({ method: 'update', score, options: options ?? previous.options });
  }

  resize(width: number): Promise<RenderResult> {
    const previous = this.latest;
    if (this.destroyed || this.target === null || previous === null) {
      this.noteMisuse('resize');
      return Promise.reject(new RenderError('fake: resize before render or after destroy'));
    }
    return this.enqueue({
      method: 'resize',
      score: previous.score,
      options: { ...previous.options, width },
    });
  }

  setPlaybackHighlight(noteIds: readonly string[]): void {
    if (this.destroyed) {
      this.callsAfterDestroy.push('setPlaybackHighlight');
      return;
    }
    this.highlight = new Set(noteIds);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.target?.replaceChildren();
    for (const queued of this.queue.splice(0)) {
      queued.reject(new RenderError('fake: destroyed'));
    }
  }

  /** Color a written note is drawn in now (§2.6), or undefined when it is not displayed. */
  colorOf(noteId: string): string | undefined {
    const shown = this.displayed;
    if (shown === null || !this.layout.notes.has(noteId)) {
      return undefined;
    }
    if (this.highlight.has(noteId)) {
      return shown.options.theme.playbackHighlight;
    }
    const annotation = shown.score.annotations.find((a) => a.noteIds.includes(noteId));
    return annotation?.color ?? shown.options.theme.ink;
  }

  settleNext(): void {
    const queued = this.queue.shift();
    if (queued === undefined) {
      throw new Error('fake: no pending renderer call');
    }
    if (this.failWhen?.(queued.call) === true) {
      queued.reject(new RenderError('fake: engraving failed'));
      return;
    }
    queued.resolve({ layoutMap: this.apply(queued.call) });
  }

  failNext(): void {
    const queued = this.queue.shift();
    if (queued === undefined) {
      throw new Error('fake: no pending renderer call');
    }
    queued.reject(new RenderError('fake: engraving failed'));
  }

  private enqueue(call: RenderCall): Promise<RenderResult> {
    this.calls.push(call);
    this.latest = { score: call.score, options: call.options };
    return new Promise<RenderResult>((resolve, reject) => {
      this.queue.push({ call, resolve, reject });
      if (this.mode === 'auto') {
        queueMicrotask(() => {
          if (this.queue.length > 0) {
            this.settleNext();
          }
        });
      }
    });
  }

  private apply(call: RenderCall): LayoutMap {
    if (call.options.width === 0) {
      return EMPTY_LAYOUT;
    }
    const layout = fakeLayout(call.score, call.options);
    this.displayed = { score: call.score, options: call.options };
    this.layout = layout;
    const drawing = document.createElement('p');
    drawing.textContent = `${call.score.id} revision ${call.score.revision}`;
    this.target?.replaceChildren(drawing);
    return layout;
  }

  private noteMisuse(method: string): void {
    if (this.destroyed) {
      this.callsAfterDestroy.push(method);
    }
  }
}
