/**
 * Imperative core of the ScorePlayer: owns one renderer and one engine per
 * attached session and applies the decisions of RENDER_PLAYBACK_PORTS.md §5
 * (highlight sync, P-01 revision replacement). React reads it as an external
 * store (`subscribe` / `getSnapshot`), so no async callback ever sets React
 * state directly and nothing runs after `detach`.
 *
 * Decisions:
 * - Accepting: an artifact is shown only if `validateScoreSpec` accepts its
 *   score and the score's id/revision equal the artifact's. It replaces the
 *   current score when it is a higher revision of it, or another score (the
 *   host switched scores, which may be a score shown earlier) unless it is
 *   older than a revision of that score this player already accepted: a
 *   stale result. Invalid, duplicate and older artifacts change nothing but
 *   the notice.
 * - P-01: on replacement, `engine.stop()` (synchronous silence), clear the
 *   highlight, then `renderer.update` and `engine.load` in parallel. Nothing
 *   ever calls `play()` except the user's Play action.
 * - Play is enabled only when the accepted revision is both displayed (the
 *   renderer's last successful call at a positive width drew it; width 0
 *   draws nothing) and loaded (it is the engine's committed plan). So old
 *   audio never sounds under new notation, and a failed or hidden update
 *   never lets the new plan sound under the old notation.
 * - The renderer is always driven with `update(score, fullOptions)` after the
 *   first `render`, so every call states exactly what it must show, whatever
 *   earlier calls did. Results are applied in call order; a failed latest call
 *   keeps the last good layout and sets `renderFailed` until a later call
 *   succeeds (any resize, theme or band change retries with the latest score).
 */
import { type ScoreSpec, validateScoreSpec } from '@sheet-music/music-domain';
import type { PlaybackEngine, PlaybackPlan, PlaybackSnapshot } from '@sheet-music/playback-core';
import type { LayoutMap, RenderOptions, ScoreRenderer } from '@sheet-music/renderer-core';
import { RENDER_THEMES } from './theme';
import type { ScorePlayerArtifact, ScorePlayerPorts, ScorePlayerTheme } from './types';

/** Immutable; replaced on every change (useSyncExternalStore contract). */
export interface PlayerView {
  /** Latest accepted canonical score. */
  readonly score: ScoreSpec | null;
  /** Score of the renderer's last successful call at a positive width: what the notation shows. */
  readonly renderedScore: ScoreSpec | null;
  /** Layout of the renderer's last successful call (empty while hidden). */
  readonly layout: LayoutMap | null;
  /** The renderer's latest call was rejected; the last good rendering stays. */
  readonly renderFailed: boolean;
  /** The latest artifact was invalid and was not applied. */
  readonly updateRejected: boolean;
  /** Engine snapshot; null while no engine is attached. */
  readonly playback: PlaybackSnapshot | null;
  /** The latest load could not start: the plan did not compile or load() rejected. */
  readonly loadFailed: boolean;
  /** The latest play() was rejected. */
  readonly playFailed: boolean;
  /** Tallest measured annotation stack in CSS px (rounded up): the band height requested. */
  readonly bandHeight: number;
}

const INITIAL_VIEW: PlayerView = {
  score: null,
  renderedScore: null,
  layout: null,
  renderFailed: false,
  updateRejected: false,
  playback: null,
  loadFailed: false,
  playFailed: false,
  bandHeight: 0,
};

const DETACHED: Partial<PlayerView> = {
  renderedScore: null,
  layout: null,
  renderFailed: false,
  playback: null,
  loadFailed: false,
  playFailed: false,
};

const NO_NOTES: readonly string[] = [];

interface Session {
  readonly ports: ScorePlayerPorts;
  readonly renderer: ScoreRenderer;
  readonly engine: PlaybackEngine;
  readonly target: HTMLElement;
  readonly unsubscribes: (() => void)[];
  mounted: boolean;
  renderSeq: number;
  appliedSeq: number;
  loadSeq: number;
  highlight: readonly string[];
}

/** True when Play may start the accepted revision (see the module comment). */
export function isPlayable({ score, renderedScore, playback }: PlayerView): boolean {
  if (score === null || renderedScore !== score || playback === null || playback.plan === null) {
    return false;
  }
  return (
    (playback.state === 'ready' || playback.state === 'paused') &&
    playback.plan.scoreId === score.id &&
    playback.plan.revision === score.revision
  );
}

export function isAudioUnavailable(view: PlayerView): boolean {
  return view.loadFailed || view.playback?.state === 'error';
}

function acceptableScore(artifact: ScorePlayerArtifact): ScoreSpec | null {
  const result = validateScoreSpec(artifact.score);
  if (!result.ok) {
    return null;
  }
  const score = result.value;
  return score.id === artifact.scoreId && score.revision === artifact.revision ? score : null;
}

/** See the module comment; `accepted` holds the highest accepted revision of each score ID. */
function replaces(
  next: ScoreSpec,
  current: ScoreSpec | null,
  accepted: ReadonlyMap<string, number>,
): boolean {
  if (current === null) {
    return true;
  }
  if (next.id === current.id) {
    return next.revision > current.revision;
  }
  return next.revision >= (accepted.get(next.id) ?? 0);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export class PlayerController {
  private view: PlayerView = INITIAL_VIEW;
  private readonly listeners = new Set<() => void>();
  private session: Session | null = null;
  private width = 0;
  private theme: ScorePlayerTheme = 'light';
  /** Highest revision accepted for each score ID shown by this player. */
  private readonly accepted = new Map<string, number>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): PlayerView => this.view;

  /** Creates this mount's renderer and engine and shows the accepted score, if any. */
  attach(target: HTMLElement, ports: ScorePlayerPorts): void {
    this.detach();
    const session: Session = {
      ports,
      renderer: ports.createRenderer(),
      engine: ports.createPlaybackEngine(),
      target,
      unsubscribes: [],
      mounted: false,
      renderSeq: 0,
      appliedSeq: 0,
      loadSeq: 0,
      highlight: NO_NOTES,
    };
    this.session = session;
    session.unsubscribes.push(
      session.engine.subscribe(() => this.onEngineChange(session)),
      session.engine.subscribePosition((tick) => this.onPosition(session, tick)),
    );
    this.patch({ ...DETACHED, playback: session.engine.getSnapshot() });
    const score = this.view.score;
    if (score !== null) {
      this.requestRender(session);
      this.load(session, score);
    }
  }

  /** Destroys the renderer and engine; later port callbacks are ignored. */
  detach(): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    this.session = null;
    for (const unsubscribe of session.unsubscribes) {
      unsubscribe();
    }
    session.engine.destroy();
    session.renderer.destroy();
    this.patch(DETACHED);
  }

  receive(artifact: ScorePlayerArtifact): void {
    const score = acceptableScore(artifact);
    if (score === null) {
      this.patch({ updateRejected: true });
      return;
    }
    if (!replaces(score, this.view.score, this.accepted)) {
      this.patch({ updateRejected: false });
      return;
    }
    this.accepted.set(score.id, Math.max(score.revision, this.accepted.get(score.id) ?? 0));
    this.patch({ score, updateRejected: false });
    const session = this.session;
    if (session !== null) {
      // P-01: silence first, then show and load the new revision at tick 0.
      session.engine.stop();
      this.setHighlight(session, NO_NOTES);
      this.requestRender(session);
      this.load(session, score);
    }
  }

  /** Available width in CSS px; 0 means hidden. */
  setWidth(width: number): void {
    const next = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    if (next !== this.width) {
      this.width = next;
      this.rerender();
    }
  }

  setTheme(theme: ScorePlayerTheme): void {
    if (theme !== this.theme) {
      this.theme = theme;
      this.rerender();
    }
  }

  /** Measured height of the tallest annotation stack; a change re-engraves with that band. */
  setBandHeight(height: number): void {
    const next = Math.ceil(height);
    if (next === this.view.bandHeight) {
      return;
    }
    this.patch({ bandHeight: next });
    if ((this.view.score?.annotations.length ?? 0) > 0) {
      this.rerender();
    }
  }

  /** Call directly from the click/key handler (user gesture, no await before play()). */
  readonly play = (): void => {
    const session = this.session;
    if (session === null || !isPlayable(this.view)) {
      return;
    }
    const started = session.engine.play();
    this.patch({ playFailed: false });
    started.then(
      () => undefined,
      () => {
        if (this.session === session) {
          this.patch({ playFailed: true });
        }
      },
    );
  };

  readonly pause = (): void => {
    this.session?.engine.pause();
  };

  /** Local only: never a new score or revision. */
  readonly setTempo = (multiplier: number): void => {
    try {
      this.session?.engine.setTempoMultiplier(multiplier);
    } catch {
      // INVALID_ARGUMENT: nothing changed; the control keeps showing the engine's value.
    }
  };

  /** Local only: never a new score or revision. */
  readonly setLoop = (enabled: boolean): void => {
    this.session?.engine.setLoop(enabled);
  };

  readonly retryAudio = (): void => {
    const session = this.session;
    const score = this.view.score;
    if (session !== null && score !== null) {
      this.load(session, score);
    }
  };

  private rerender(): void {
    if (this.session !== null) {
      this.requestRender(this.session);
    }
  }

  private requestRender(session: Session): void {
    const score = this.view.score;
    if (score === null) {
      return;
    }
    const options: RenderOptions = {
      width: this.width,
      theme: RENDER_THEMES[this.theme],
      annotationBandHeight: score.annotations.length > 0 ? this.view.bandHeight : 0,
    };
    const seq = ++session.renderSeq;
    const call = session.mounted
      ? session.renderer.update(score, options)
      : session.renderer.render(score, session.target, options);
    session.mounted = true;
    call.then(
      ({ layoutMap }) => {
        if (this.session !== session || seq <= session.appliedSeq) {
          return;
        }
        session.appliedSeq = seq;
        this.patch({
          layout: layoutMap,
          // Width 0 draws nothing: the hidden target still holds the previous drawing.
          renderedScore: options.width > 0 ? score : this.view.renderedScore,
          ...(seq === session.renderSeq ? { renderFailed: false } : {}),
        });
      },
      () => {
        if (this.session === session && seq === session.renderSeq) {
          this.patch({ renderFailed: true });
        }
      },
    );
  }

  private load(session: Session, score: ScoreSpec): void {
    const token = ++session.loadSeq;
    let plan: PlaybackPlan;
    try {
      plan = session.ports.compilePlaybackPlan(score);
    } catch {
      this.patch({ loadFailed: true });
      return;
    }
    this.patch({ loadFailed: false });
    // Superseded outcomes are ignored: the snapshot carries the committed plan.
    session.engine.load(plan).then(
      () => undefined,
      () => {
        if (this.session === session && token === session.loadSeq) {
          this.patch({ loadFailed: true });
        }
      },
    );
  }

  private onEngineChange(session: Session): void {
    if (this.session !== session) {
      return;
    }
    const playback = session.engine.getSnapshot();
    if (playback.state !== 'playing' && playback.state !== 'paused') {
      this.setHighlight(session, NO_NOTES);
    }
    this.patch({ playback });
  }

  private onPosition(session: Session, tick: number): void {
    if (this.session !== session) {
      return;
    }
    const { state, plan } = session.engine.getSnapshot();
    const active =
      plan !== null && (state === 'playing' || state === 'paused')
        ? session.ports.activeNoteIds(plan, tick)
        : NO_NOTES;
    this.setHighlight(session, active);
  }

  private setHighlight(session: Session, noteIds: readonly string[]): void {
    if (!sameIds(noteIds, session.highlight)) {
      session.highlight = noteIds;
      session.renderer.setPlaybackHighlight(noteIds);
    }
  }

  private patch(changes: Partial<PlayerView>): void {
    const keys = Object.keys(changes) as (keyof PlayerView)[];
    if (keys.every((key) => changes[key] === this.view[key])) {
      return;
    }
    this.view = { ...this.view, ...changes };
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
