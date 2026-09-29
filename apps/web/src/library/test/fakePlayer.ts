/**
 * Minimal ScorePlayer port fakes for the library tests (LIB-UI-03). They
 * follow RENDER_PLAYBACK_PORTS.md where the player depends on it (render
 * resolves a layout, load commits the plan and reaches `ready`, play/stop
 * move between `playing` and `ready`) and record what the page caused. The
 * ScorePlayer's own behaviour is #7's UI-01..05, not re-tested here.
 */
import type { ScoreSpec } from '@sheet-music/music-domain';
import type {
  LoadOutcome,
  PlaybackEngine,
  PlaybackPlan,
  PlaybackSnapshot,
} from '@sheet-music/playback-core';
import type {
  LayoutMap,
  RenderOptions,
  RenderResult,
  ScoreRenderer,
} from '@sheet-music/renderer-core';
import { type WebPlayer, createWebPlayer } from '../../player/webPlayer';

export class FakeRenderer implements ScoreRenderer {
  /** Scores engraved by render/update, in call order. */
  readonly engraved: ScoreSpec[] = [];
  destroyed = false;
  private current: { score: ScoreSpec; options: RenderOptions } | null = null;

  render(score: ScoreSpec, _target: HTMLElement, options: RenderOptions): Promise<RenderResult> {
    return this.engrave(score, options);
  }

  update(score: ScoreSpec, options?: RenderOptions): Promise<RenderResult> {
    return this.engrave(score, options ?? this.current?.options);
  }

  resize(width: number): Promise<RenderResult> {
    if (this.current === null) return Promise.reject(new Error('resize before render'));
    return this.engrave(this.current.score, { ...this.current.options, width });
  }

  setPlaybackHighlight(): void {}

  destroy(): void {
    this.destroyed = true;
  }

  private engrave(score: ScoreSpec, options: RenderOptions | undefined): Promise<RenderResult> {
    if (options === undefined) return Promise.reject(new Error('update before render'));
    this.current = { score, options };
    this.engraved.push(score);
    const layoutMap: LayoutMap = {
      width: options.width,
      height: 120,
      systems: [],
      notes: new Map(),
    };
    return Promise.resolve({ layoutMap });
  }
}

export class FakeEngine implements PlaybackEngine {
  /** Plans passed to load(), in order. */
  readonly loads: PlaybackPlan[] = [];
  /** Commands received, in order (stop, play, pause, destroy...). */
  readonly commands: string[] = [];
  private snapshot: PlaybackSnapshot = {
    state: 'idle',
    loadId: 0,
    plan: null,
    tempoMultiplier: 1,
    loop: false,
    error: null,
  };
  private readonly listeners = new Set<() => void>();

  get state(): PlaybackSnapshot['state'] {
    return this.snapshot.state;
  }

  getSnapshot(): PlaybackSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribePosition(): () => void {
    return () => {};
  }

  load(plan: PlaybackPlan): Promise<LoadOutcome> {
    this.commands.push('load');
    if (this.snapshot.state === 'destroyed') {
      return Promise.resolve({ status: 'superseded', loadId: this.snapshot.loadId });
    }
    this.loads.push(plan);
    const loadId = this.snapshot.loadId + 1;
    this.set({ state: 'ready', loadId, plan });
    return Promise.resolve({ status: 'loaded', loadId });
  }

  play(): Promise<void> {
    this.commands.push('play');
    if (this.snapshot.state === 'ready' || this.snapshot.state === 'paused') {
      this.set({ state: 'playing' });
    }
    return Promise.resolve();
  }

  pause(): void {
    this.commands.push('pause');
    if (this.snapshot.state === 'playing') this.set({ state: 'paused' });
  }

  stop(): void {
    this.commands.push('stop');
    if (this.snapshot.state === 'playing' || this.snapshot.state === 'paused') {
      this.set({ state: 'ready' });
    }
  }

  seek(): void {}

  setTempoMultiplier(multiplier: number): void {
    this.set({ tempoMultiplier: multiplier });
  }

  setLoop(enabled: boolean): void {
    this.set({ loop: enabled });
  }

  destroy(): void {
    this.commands.push('destroy');
    if (this.snapshot.state === 'destroyed') return;
    this.snapshot = { ...this.snapshot, state: 'destroyed', plan: null };
    this.listeners.clear();
  }

  private set(change: Partial<PlaybackSnapshot>): void {
    if (this.snapshot.state === 'destroyed') return;
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of [...this.listeners]) listener();
  }
}

export interface FakePlayer {
  readonly player: WebPlayer;
  readonly renderers: readonly FakeRenderer[];
  readonly engines: readonly FakeEngine[];
}

export const TEST_CREDITS = {
  attribution: 'Piano sound: test attribution.',
  licenseUrl: 'http://localhost/assets/soundfonts/piano/LICENSE.txt',
  noticeUrl: 'http://localhost/assets/soundfonts/piano/NOTICE.txt',
} as const;

/** The app's real `createWebPlayer` over fake renderer and engine factories. */
export function createFakePlayer(): FakePlayer {
  const renderers: FakeRenderer[] = [];
  const engines: FakeEngine[] = [];
  const player = createWebPlayer({
    createRenderer: () => {
      const renderer = new FakeRenderer();
      renderers.push(renderer);
      return renderer;
    },
    createPlaybackEngine: () => {
      const engine = new FakeEngine();
      engines.push(engine);
      return engine;
    },
    credits: TEST_CREDITS,
  });
  return { player, renderers, engines };
}
