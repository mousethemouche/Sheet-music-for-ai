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
import {
  type PlayerView,
  PlayerController,
  isAudioUnavailable,
  isPlayable,
} from './player-controller';
import { PALETTES } from './theme';
import type { ScorePlayerProps, ScorePlayerTheme } from './types';

const TEMPO_PERCENT = {
  min: Math.round(TEMPO_MULTIPLIER_RANGE.min * 100),
  max: Math.round(TEMPO_MULTIPLIER_RANGE.max * 100),
  step: 5,
};

export function ScorePlayer({ artifact, ports, theme = 'light' }: ScorePlayerProps): ReactElement {
  const [controller] = useState(() => new PlayerController());
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
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
      ? placeAnnotations(renderedScore.annotations, layout)
      : [];
  const title = score?.metadata.title;
  const problems = describeProblems(view, audioUnavailable);

  return (
    <section
      aria-label={title === undefined ? 'Score player' : `Score player: ${title}`}
      style={rootStyle(theme)}
    >
      <div ref={scrollRef} style={SCROLL_STYLE}>
        <div
          ref={targetRef}
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
                <p
                  key={label.annotationId}
                  style={{ ...LABEL_STYLE, paddingLeft: label.indent, color: label.color }}
                >
                  {label.text}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Playback controls" style={CONTROLS_STYLE}>
        <button
          type="button"
          disabled={!playing && !playable}
          onClick={playing ? controller.pause : controller.play}
          style={buttonStyle(!playing && !playable)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <label style={FIELD_STYLE}>
          Tempo
          <input
            type="range"
            min={TEMPO_PERCENT.min}
            max={TEMPO_PERCENT.max}
            step={TEMPO_PERCENT.step}
            value={tempoPercent}
            aria-valuetext={tempoText}
            disabled={!settingsEnabled}
            onChange={(event) => {
              controller.setTempo(Number(event.currentTarget.value) / 100);
            }}
          />
        </label>
        {/* Visual readout; assistive technology reads the slider's aria-valuetext. */}
        <span aria-hidden="true">{tempoText}</span>
        <label style={FIELD_STYLE}>
          <input
            type="checkbox"
            checked={playback?.loop ?? false}
            disabled={!settingsEnabled}
            onChange={(event) => {
              controller.setLoop(event.currentTarget.checked);
            }}
          />
          Loop
        </label>
      </div>
      <p role="status" style={STATUS_STYLE}>
        {describeStatus(view, playable, audioUnavailable)}
      </p>
      <div role="alert" style={ALERT_STYLE}>
        {problems.map((problem) => (
          <p key={problem} style={{ margin: 0 }}>
            {problem}
          </p>
        ))}
        {audioUnavailable && (
          <button type="button" onClick={controller.retryAudio} style={buttonStyle(false)}>
            Retry audio
          </button>
        )}
      </div>
    </section>
  );
}

function describeStatus(view: PlayerView, playable: boolean, audioUnavailable: boolean): string {
  const state = view.playback?.state;
  if (view.score === null) {
    return 'No score to play';
  }
  if (state === 'playing') {
    return 'Playing';
  }
  if (state === 'paused') {
    return 'Paused';
  }
  if (audioUnavailable) {
    return 'Audio unavailable';
  }
  if (playable) {
    return 'Ready';
  }
  return view.renderFailed ? 'Notation unavailable' : 'Loading';
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

function rootStyle(theme: ScorePlayerTheme): CSSProperties {
  const palette = PALETTES[theme];
  const variables: Record<`--smp-${string}`, string> = {
    '--smp-surface': palette.surface,
    '--smp-ink': palette.ink,
    '--smp-muted': palette.muted,
    '--smp-accent': palette.accent,
    '--smp-danger': palette.danger,
  };
  return {
    ...(variables as CSSProperties),
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
    color: 'var(--smp-ink)',
    background: 'var(--smp-surface)',
  };
}

function overlayStyle(width: number, height: number): CSSProperties {
  return { position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none' };
}

function buttonStyle(disabled: boolean): CSSProperties {
  return {
    minWidth: 72,
    minHeight: 36,
    padding: '0 16px',
    borderRadius: 18,
    border: '1px solid var(--smp-accent)',
    background: 'var(--smp-accent)',
    color: 'var(--smp-surface)',
    font: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

const SCROLL_STYLE: CSSProperties = { position: 'relative', overflowX: 'auto', width: '100%' };

const LABEL_STYLE: CSSProperties = {
  margin: 0,
  fontSize: '0.875rem',
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
  pointerEvents: 'auto',
};

const CONTROLS_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px 16px',
};

const FIELD_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  accentColor: 'var(--smp-accent)',
};

const STATUS_STYLE: CSSProperties = { margin: 0, color: 'var(--smp-muted)', fontSize: '0.875rem' };

const ALERT_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  color: 'var(--smp-danger)',
  fontSize: '0.875rem',
};
