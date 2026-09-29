/**
 * Shared set-up for the UI-01..05 component tests: fake ports, a controllable
 * ResizeObserver, a text-metrics stub and a mount helper. Every driver of a
 * fake runs inside act() so React sees each change the way a browser would.
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import type { PlaybackCompiler } from '@sheet-music/playback-core';
import { bar, cloneFixture, frozen, note, score, staff, voice } from '@sheet-music/test-fixtures';
import { act, render, screen } from '@testing-library/react';
import { type UserEvent, userEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { vi } from 'vitest';
import {
  type ScorePlayerArtifact,
  type ScorePlayerPorts,
  type ScorePlayerTheme,
  ScorePlayer,
} from '../src';
import { FakePlaybackEngine } from './fakes/fake-engine';
import { compileFakePlan, fakeActiveNoteIds } from './fakes/fake-plan';
import { FakeScoreRenderer } from './fakes/fake-renderer';

/** One bar C4-E4-G4-C5 quarters with the sustain pedal held over the whole bar. */
export const PEDALLED: ScoreSpecInput = frozen(
  score({
    id: 'ui-pedal',
    staves: [
      staff('ui-rh', 'right', [
        bar('ui-m1', 1, [
          voice('ui-rh-v1', [
            note('ui-n1', 'C4', 'quarter'),
            note('ui-n2', 'E4', 'quarter'),
            note('ui-n3', 'G4', 'quarter'),
            note('ui-n4', 'C5', 'quarter'),
          ]),
        ]),
      ]),
    ],
    pedal: [{ id: 'ui-p1', type: 'sustain', startEventId: 'ui-n1', endEventId: 'ui-n4' }],
  }),
);

/** A fresh artifact for `input` (optionally changed), shaped like a ScoreArtifact. */
export function artifactOf(
  input: ScoreSpecInput,
  changes: Partial<ScoreSpecInput> = {},
): ScorePlayerArtifact {
  const spec = { ...cloneFixture(input), ...changes };
  return { scoreId: spec.id, revision: spec.revision, score: spec };
}

// --- ResizeObserver -------------------------------------------------------

/**
 * jsdom has no ResizeObserver. This one reports `width` for every observed
 * element, synchronously on observe() (a browser reports the initial size
 * too) and on setWidth().
 */
export function installResizeObserver(initialWidth: number): {
  readonly observerCount: number;
  setWidth(width: number): void;
} {
  let width = initialWidth;
  const active = new Set<FakeResizeObserver>();
  class FakeResizeObserver {
    private readonly targets: Element[] = [];
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.targets.push(target);
      active.add(this);
      this.notify();
    }
    unobserve(): void {}
    disconnect(): void {
      active.delete(this);
      this.targets.length = 0;
    }
    notify(): void {
      const entries = this.targets.map(
        (target) => ({ target, contentRect: { width } }) as unknown as ResizeObserverEntry,
      );
      this.callback(entries, this);
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return {
    get observerCount() {
      return active.size;
    },
    setWidth(next: number) {
      width = next;
      for (const observer of [...active]) {
        observer.notify();
      }
    },
  };
}

// --- Text metrics -----------------------------------------------------------

export const LINE_HEIGHT = 20;
export const CHAR_WIDTH = 8;

/** Lines a label of `text` takes in `width` px under the fake metrics. */
export function linesFor(text: string, width: number): number {
  return Math.max(1, Math.ceil((text.length * CHAR_WIDTH) / width));
}

/**
 * jsdom does no layout. Give each annotation stack (the absolutely positioned
 * elements anchored with `bottom`) the height its labels would wrap to with a
 * fixed 8 px character and 20 px line. This checks our band arithmetic only,
 * never real font geometry (that is MCP-UI-01's real browser).
 */
export function installTextMetrics(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = Number.parseFloat(this.style.width);
    let height = 0;
    if (this.style.bottom !== '') {
      for (const label of this.children) {
        const indent = Number.parseFloat((label as HTMLElement).style.paddingLeft) || 0;
        height += linesFor(label.textContent, width - indent) * LINE_HEIGHT;
      }
    }
    const w = Number.isFinite(width) ? width : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: height, width: w, height } as DOMRect;
  });
}

// --- Mounting -----------------------------------------------------------------

export interface MountOptions {
  readonly width?: number;
  readonly theme?: ScorePlayerTheme;
  readonly strict?: boolean;
  readonly setupRenderer?: (renderer: FakeScoreRenderer) => void;
  readonly setupEngine?: (engine: FakePlaybackEngine) => void;
  readonly compile?: PlaybackCompiler;
}

export interface Player {
  readonly user: UserEvent;
  readonly renderers: readonly FakeScoreRenderer[];
  readonly engines: readonly FakePlaybackEngine[];
  /** The live (latest created) renderer and engine. */
  readonly renderer: FakeScoreRenderer;
  readonly engine: FakePlaybackEngine;
  readonly viewport: ReturnType<typeof installResizeObserver>;
  show(artifact: ScorePlayerArtifact): Promise<void>;
  setTheme(theme: ScorePlayerTheme): Promise<void>;
  resize(width: number): Promise<void>;
  /** Runs a fake driver (clock, load completion...) inside act, then lets promises settle. */
  drive(action: () => void): Promise<void>;
  unmount(): void;
}

/** Lets every queued promise callback run, inside act. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function mountPlayer(
  artifact: ScorePlayerArtifact,
  options: MountOptions = {},
): Promise<Player> {
  const viewport = installResizeObserver(options.width ?? 600);
  const renderers: FakeScoreRenderer[] = [];
  const engines: FakePlaybackEngine[] = [];
  const ports: ScorePlayerPorts = {
    createRenderer: () => {
      const renderer = new FakeScoreRenderer();
      options.setupRenderer?.(renderer);
      renderers.push(renderer);
      return renderer;
    },
    createPlaybackEngine: () => {
      const engine = new FakePlaybackEngine();
      options.setupEngine?.(engine);
      engines.push(engine);
      return engine;
    },
    compilePlaybackPlan: options.compile ?? compileFakePlan,
    activeNoteIds: fakeActiveNoteIds,
  };
  let current = artifact;
  let theme = options.theme ?? 'light';
  const element = () => {
    const player = <ScorePlayer artifact={current} ports={ports} theme={theme} />;
    return options.strict === true ? <StrictMode>{player}</StrictMode> : player;
  };
  const view = render(element());
  await settle();

  const latest = <T,>(items: readonly T[]): T => {
    const item = items.at(-1);
    if (item === undefined) {
      throw new Error('no port instance was created');
    }
    return item;
  };
  return {
    user: userEvent.setup(),
    renderers,
    engines,
    get renderer() {
      return latest(renderers);
    },
    get engine() {
      return latest(engines);
    },
    viewport,
    async show(next) {
      current = next;
      view.rerender(element());
      await settle();
    },
    async setTheme(next) {
      theme = next;
      view.rerender(element());
      await settle();
    },
    async resize(width) {
      act(() => {
        viewport.setWidth(width);
      });
      await settle();
    },
    async drive(action) {
      act(action);
      await settle();
    },
    unmount: () => {
      view.unmount();
    },
  };
}

// --- Queries --------------------------------------------------------------------

export const ui = {
  playToggle: () => screen.getByRole('button', { name: /^(Play|Pause)$/ }),
  tempo: () => screen.getByRole('slider', { name: 'Tempo' }),
  loop: () => screen.getByRole<HTMLInputElement>('checkbox', { name: 'Loop' }),
  status: () => screen.getByRole('status'),
  alert: () => screen.getByRole('alert'),
  notation: () => screen.getByRole('img', { name: /^Music notation/ }),
};
