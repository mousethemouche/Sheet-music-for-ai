/**
 * Reusable score player (#7): notation, pedagogical annotation overlay and
 * playback controls over the ADR-004 ports. Used by the standalone web app
 * and the MCP View, which inject the concrete renderer and engine.
 *
 * Never autoplays; only the user's Play starts audio. Tempo and loop are local
 * engine settings: they never produce a score, a revision or a save.
 */
import { TEMPO_MULTIPLIER_RANGE } from '@sheet-music/playback-core';
import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { placeAnnotations } from './annotation-layout';
import { placePlaybackBands } from './playback-band';
import {
  type PlayerView,
  PlayerController,
  isAudioUnavailable,
  isPlayable,
} from './player-controller';
import { PLAYER_CSS, STYLESHEET_HREF, STYLESHEET_PRECEDENCE } from './styles';
import { PALETTES } from './theme';
import type { ScorePlayerProps } from './types';

const TEMPO_PERCENT = {
  min: Math.round(TEMPO_MULTIPLIER_RANGE.min * 100),
  max: Math.round(TEMPO_MULTIPLIER_RANGE.max * 100),
  step: 5,
};

export function ScorePlayer({
  artifact,
  ports,
  theme = 'light',
  controlsPosition = 'bottom',
}: ScorePlayerProps): ReactElement {
  const [controller] = useState(() => new PlayerController());
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [overflow, setOverflow] = useState<Overflow>(NO_OVERFLOW);
  const scrollRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { createRenderer, createPlaybackEngine, compilePlaybackPlan, activeNoteIds } = ports;

  // Effect order matters: width and theme are known before the first render call.
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    controller.setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        controller.setWidth(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [controller]);

  useEffect(() => {
    controller.setTheme(theme);
  }, [controller, theme]);

  useEffect(() => {
    const target = targetRef.current;
    if (target === null) {
      return;
    }
    controller.attach(target, {
      createRenderer,
      createPlaybackEngine,
      compilePlaybackPlan,
      activeNoteIds,
    });
    return () => {
      controller.detach();
    };
  }, [controller, createRenderer, createPlaybackEngine, compilePlaybackPlan, activeNoteIds]);

  useEffect(() => {
    controller.receive(artifact);
  }, [controller, artifact]);

  // Second pass of the annotation band (RENDER_PLAYBACK_PORTS.md §2.7): the
  // renderer never measures overlay text, so report the tallest wrapped stack.
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (overlay === null || overlay.children.length === 0) {
      return;
    }
    let tallest = 0;
    for (const stack of overlay.children) {
      tallest = Math.max(tallest, stack.getBoundingClientRect().height);
    }
    controller.setBandHeight(tallest);
  });

  // Which sides of the notation are scrolled out of view: the sheet shows a
  // fade there, the cue that it scrolls sideways (a thin scrollbar is
  // invisible on touch screens). Measured after every render and on scroll.
  const measureOverflow = (): void => {
    const element = scrollRef.current;
    if (element !== null) {
      const next = overflowOf(element);
      setOverflow((current) =>
        current.start === next.start && current.end === next.end ? current : next,
      );
    }
  };
  useLayoutEffect(measureOverflow);

  const { score, renderedScore, layout, playback } = view;
  const playing = playback?.state === 'playing';
  const playable = isPlayable(view);
  const audioUnavailable = isAudioUnavailable(view);
  const settingsEnabled = playback !== null && playback.state !== 'destroyed';
  const tempoPercent = Math.round((playback?.tempoMultiplier ?? 1) * 100);
  const tempoText =
    score === null
      ? `${tempoPercent}%`
      : `${tempoPercent}% (${Math.round((score.tempo.bpm * tempoPercent) / 100)} BPM)`;
  const bands =
    layout !== null && renderedScore !== null
      ? placeAnnotations(renderedScore.annotations, layout, view.width)
      : [];
  const playbackBands =
    layout !== null && renderedScore !== null ? placePlaybackBands(view.highlight, layout) : [];
  const ink = PALETTES[theme].ink;
  const title = score?.metadata.title;
  const problems = describeProblems(view, audioUnavailable);
  const status = describeStatus(view, playable, audioUnavailable);
  const tempoFill = (tempoPercent - TEMPO_PERCENT.min) / (TEMPO_PERCENT.max - TEMPO_PERCENT.min);

  const sheet = (
    <div
      className="smp-sheet"
      data-blank={renderedScore === null ? '' : undefined}
      data-overflow-start={overflow.start ? '' : undefined}
      data-overflow-end={overflow.end ? '' : undefined}
    >
      <div ref={scrollRef} className="smp-scroll" style={SCROLL_STYLE} onScroll={measureOverflow}>
        {/* Behind the notation (painted first): where playback is. Decorative. */}
        <div aria-hidden="true" style={overlayStyle(layout?.width ?? 0, layout?.height ?? 0)}>
          {playbackBands.map(({ systemId, bounds }) => (
            <div
              key={systemId}
              className="smp-playback-band"
              data-playback-band=""
              style={{
                position: 'absolute',
                left: bounds.x,
                top: bounds.y,
                width: bounds.width,
                height: bounds.height,
              }}
            />
          ))}
        </div>
        <div
          ref={targetRef}
          className="smp-notation"
          role="img"
          aria-label={title === undefined ? 'Music notation' : `Music notation: ${title}`}
        />
        <div ref={overlayRef} style={overlayStyle(layout?.width ?? 0, layout?.height ?? 0)}>
          {bands.map(({ systemId, band, width, labels }) => (
            <div
              key={systemId}
              style={{
                position: 'absolute',
                left: band.x,
                width,
                bottom: (layout?.height ?? 0) - (band.y + band.height),
                // Shown only once the renderer reserved enough room: text never covers the staff.
                visibility: view.bandHeight <= band.height ? 'visible' : 'hidden',
              }}
            >
              {labels.map((label) => (
                // The text is in the paper's ink (readable on it whatever the
                // teaching color); the swatch carries the teaching color.
                <p
                  key={label.annotationId}
                  className="smp-annotation"
                  style={{ ...LABEL_STYLE, paddingLeft: label.indent, color: ink }}
                >
                  <span
                    aria-hidden="true"
                    className="smp-annotation-swatch"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.text}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const controls = (
    <>
      <div role="group" aria-label="Playback controls" className="smp-controls">
        <button
          type="button"
          className="smp-button smp-button--primary"
          disabled={!playing && !playable}
          onClick={playing ? controller.pause : controller.play}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <div className="smp-tempo">
          <label className="smp-field">
            <span>Tempo</span>
            <input
              type="range"
              className="smp-range"
              min={TEMPO_PERCENT.min}
              max={TEMPO_PERCENT.max}
              step={TEMPO_PERCENT.step}
              value={tempoPercent}
              aria-valuetext={tempoText}
              disabled={!settingsEnabled}
              onChange={(event) => {
                controller.setTempo(Number(event.currentTarget.value) / 100);
              }}
              style={fillStyle(tempoFill)}
            />
          </label>
          {/* Visual readout; assistive technology reads the slider's aria-valuetext. */}
          <span aria-hidden="true" className="smp-tempo-value">
            {tempoText}
          </span>
        </div>
        <label className="smp-field">
          <input
            type="checkbox"
            className="smp-switch"
            checked={playback?.loop ?? false}
            disabled={!settingsEnabled}
            onChange={(event) => {
              controller.setLoop(event.currentTarget.checked);
            }}
          />
          <span>Loop</span>
        </label>
      </div>
      <p role="status" className="smp-status" data-state={status.state}>
        <span aria-hidden="true" className="smp-status-dot" />
        {status.text}
      </p>
      <div role="alert" className="smp-alert">
        {problems.map((problem) => (
          <p key={problem}>{problem}</p>
        ))}
        {audioUnavailable && (
          <button
            type="button"
            className="smp-button smp-button--secondary"
            onClick={controller.retryAudio}
          >
            Retry audio
          </button>
        )}
      </div>
    </>
  );

  const classes = ['smp-player'];
  if (theme === 'dark') classes.push('smp-player--dark');
  if (controlsPosition === 'top') classes.push('smp-player--controls-top');

  return (
    <section
      aria-label={title === undefined ? 'Score player' : `Score player: ${title}`}
      className={classes.join(' ')}
    >
      {/* Hoisted to <head> by React and shared by every player (styles.ts). */}
      <style href={STYLESHEET_HREF} precedence={STYLESHEET_PRECEDENCE}>
        {PLAYER_CSS}
      </style>
      {controlsPosition === 'top' ? (
        <>
          {controls}
          {sheet}
        </>
      ) : (
        <>
          {sheet}
          {controls}
        </>
      )}
    </section>
  );
}

/** Decorative: the button's accessible name is its text. */
function PlayIcon(): ReactElement {
  return (
    <svg className="smp-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.37v9.26a.87.87 0 0 0 1.33.74l7.2-4.63a.87.87 0 0 0 0-1.48l-7.2-4.63A.87.87 0 0 0 5 3.37z" />
    </svg>
  );
}

function PauseIcon(): ReactElement {
  return (
    <svg className="smp-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="2.5" width="3" height="11" rx="0.75" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="0.75" />
    </svg>
  );
}

/** What the status dot shows next to the status text. */
type StatusState = 'idle' | 'loading' | 'playing' | 'problem';

function describeStatus(
  view: PlayerView,
  playable: boolean,
  audioUnavailable: boolean,
): { readonly text: string; readonly state: StatusState } {
  const state = view.playback?.state;
  if (view.score === null) {
    return { text: 'No score to play', state: 'idle' };
  }
  if (state === 'playing') {
    return { text: 'Playing', state: 'playing' };
  }
  if (state === 'paused') {
    return { text: 'Paused', state: 'idle' };
  }
  if (audioUnavailable) {
    return { text: 'Audio unavailable', state: 'problem' };
  }
  if (playable) {
    return { text: 'Ready', state: 'idle' };
  }
  return view.renderFailed
    ? { text: 'Notation unavailable', state: 'problem' }
    : { text: 'Loading', state: 'loading' };
}

function describeProblems(view: PlayerView, audioUnavailable: boolean): string[] {
  const problems: string[] = [];
  if (view.updateRejected) {
    problems.push(
      view.score === null
        ? 'This score is invalid and cannot be shown.'
        : `The latest score update is invalid and was not applied. Showing revision ${view.score.revision}.`,
    );
  }
  if (view.renderFailed) {
    problems.push(
      view.renderedScore === null
        ? 'The notation could not be drawn.'
        : `The notation could not be updated. Showing revision ${view.renderedScore.revision}.`,
    );
  }
  if (audioUnavailable) {
    problems.push('Audio is unavailable.');
  }
  if (view.playFailed) {
    problems.push('Audio could not start. Press Play to try again.');
  }
  return problems;
}

/** Sides of the notation scrolled out of view. */
interface Overflow {
  readonly start: boolean;
  readonly end: boolean;
}

const NO_OVERFLOW: Overflow = { start: false, end: false };

function overflowOf(element: HTMLElement): Overflow {
  const hidden = element.scrollWidth - element.clientWidth;
  if (hidden <= 1) {
    return NO_OVERFLOW;
  }
  return { start: element.scrollLeft > 1, end: element.scrollLeft < hidden - 1 };
}

function overlayStyle(width: number, height: number): CSSProperties {
  return { position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none' };
}

/** How much of the slider track is filled (0..1), read by the stylesheet. */
function fillStyle(fraction: number): CSSProperties {
  const percent = Math.min(1, Math.max(0, fraction)) * 100;
  return { '--_smp-fill': `${percent}%` } as CSSProperties;
}

// Inline: the controller measures this element's width and the overlay is
// positioned in its coordinate space (no padding or border here).
const SCROLL_STYLE: CSSProperties = { position: 'relative', overflowX: 'auto', width: '100%' };

const LABEL_STYLE: CSSProperties = {
  margin: 0,
  fontSize: '0.875rem',
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
  pointerEvents: 'auto',
};
