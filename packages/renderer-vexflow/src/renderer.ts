/**
 * The VexFlow ScoreRenderer (RENDER_PLAYBACK_PORTS.md §2): lifecycle, call
 * ordering, failure containment and the playback highlight layer.
 */
import type { ScoreSpec } from '@sheet-music/music-domain';
import {
  type LayoutMap,
  RenderError,
  type RenderOptions,
  type RenderResult,
  type ScoreRenderer,
  type ScoreRendererFactory,
} from '@sheet-music/renderer-core';
import { prepareScore } from './build';
import { type Engraving, engrave } from './engrave';
import { loadBundledFonts } from './fonts';

export interface VexFlowRendererOptions {
  /**
   * Makes the engraving fonts usable in the target's document; resolves when
   * they are ready and rejects when they cannot load. Default:
   * `loadBundledFonts` (fonts embedded in VexFlow, no network).
   */
  readonly loadFonts?: () => Promise<void>;
}

/** The factory an app injects into score-ui; one renderer per mounted player. */
export function createVexFlowRendererFactory(
  options: VexFlowRendererOptions = {},
): ScoreRendererFactory {
  const loadFonts = options.loadFonts ?? loadBundledFonts;
  return () => new VexFlowScoreRenderer(loadFonts);
}

function hiddenLayout(): LayoutMap {
  return { width: 0, height: 0, systems: [], notes: new Map() };
}

function checkOptions(options: RenderOptions): void {
  if (!Number.isFinite(options.width) || options.width < 0) {
    throw new RenderError('RenderOptions.width must be a finite number >= 0.');
  }
  if (!Number.isFinite(options.annotationBandHeight) || options.annotationBandHeight < 0) {
    throw new RenderError('RenderOptions.annotationBandHeight must be a finite number >= 0.');
  }
  const { ink, playbackHighlight } = options.theme;
  if (
    typeof ink !== 'string' ||
    ink === '' ||
    typeof playbackHighlight !== 'string' ||
    playbackHighlight === ''
  ) {
    throw new RenderError('RenderOptions.theme needs ink and playbackHighlight colors.');
  }
}

function asRenderError(error: unknown): RenderError {
  if (error instanceof RenderError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new RenderError(`Engraving failed: ${detail}`, { cause: error });
}

class VexFlowScoreRenderer implements ScoreRenderer {
  private target: HTMLElement | undefined;
  private destroyed = false;
  /** Score and options of the last successful call. */
  private score: ScoreSpec | undefined;
  private options: RenderOptions | undefined;
  private engraving: Engraving | undefined;
  private highlighted: ReadonlySet<string> = new Set();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly loadFonts: () => Promise<void>) {}

  render(score: ScoreSpec, target: HTMLElement, options: RenderOptions): Promise<RenderResult> {
    if (this.destroyed || this.target !== undefined) {
      const reason = this.destroyed ? 'destroyed' : 'already mounted';
      return this.enqueue(() => Promise.reject(new RenderError(`The renderer is ${reason}.`)));
    }
    this.target = target;
    return this.enqueue(() => this.apply(score, options));
  }

  update(score: ScoreSpec, options?: RenderOptions): Promise<RenderResult> {
    return this.enqueue(() => {
      const next = options ?? this.options;
      if (next === undefined) {
        throw new RenderError('update() needs options: nothing was rendered yet.');
      }
      return this.apply(score, next);
    });
  }

  resize(width: number): Promise<RenderResult> {
    return this.enqueue(() => {
      if (this.score === undefined || this.options === undefined) {
        throw new RenderError('resize() needs a score: nothing was rendered yet.');
      }
      return this.apply(this.score, { ...this.options, width });
    });
  }

  setPlaybackHighlight(noteIds: readonly string[]): void {
    if (this.destroyed) {
      return;
    }
    const next = new Set(noteIds);
    for (const noteId of this.highlighted) {
      if (!next.has(noteId)) {
        this.engraving?.noteheads.get(noteId)?.style.removeProperty('fill');
      }
    }
    this.highlighted = next;
    this.paintHighlight();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.engraving?.svg.remove();
    this.engraving = undefined;
    this.highlighted = new Set();
    this.target = undefined;
  }

  /** Runs `task` after every earlier call has settled; every rejection is a RenderError. */
  private enqueue(task: () => Promise<RenderResult>): Promise<RenderResult> {
    const run = this.queue.then(task).catch((error: unknown) => {
      throw asRenderError(error);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private checkMounted(): HTMLElement {
    if (this.destroyed) {
      throw new RenderError('The renderer is destroyed.');
    }
    if (this.target === undefined) {
      throw new RenderError('render() must be called first.');
    }
    return this.target;
  }

  private async apply(score: ScoreSpec, options: RenderOptions): Promise<RenderResult> {
    this.checkMounted();
    checkOptions(options);
    if (options.width === 0) {
      // Hidden target: keep what is displayed; the next positive width engraves.
      this.score = score;
      this.options = options;
      return { layoutMap: hiddenLayout() };
    }
    await this.loadFonts();
    const target = this.checkMounted();
    let created: SVGSVGElement | undefined;
    try {
      const engraving = engrave(prepareScore(score), target, options, (svg) => {
        created = svg;
      });
      this.engraving?.svg.remove();
      this.engraving = engraving;
      this.score = score;
      this.options = options;
      this.paintHighlight();
      return { layoutMap: engraving.layoutMap };
    } catch (error) {
      created?.remove();
      throw error;
    }
  }

  private paintHighlight(): void {
    const color = this.options?.theme.playbackHighlight;
    if (color === undefined) {
      return;
    }
    for (const noteId of this.highlighted) {
      this.engraving?.noteheads.get(noteId)?.style.setProperty('fill', color);
    }
  }
}
