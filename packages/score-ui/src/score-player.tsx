/**
 * Reusable score player (#7): notation, pedagogical annotation overlay and
 * playback controls over the ADR-004 ports. Used by the standalone web app
 * and the MCP View, which inject the concrete renderer and engine.
 *
 * Never autoplays; only the user's Play starts audio. Tempo and loop are local
 * engine settings: they never produce a score, a revision or a save.
 *
 * Styling (docs/architecture/DESIGN_SYSTEM.md §4): @sheet-music/ui controls
 * and Tailwind classes over the shared tokens. The host compiles them: it
 * imports `@sheet-music/ui/styles/theme.css` and scans this package's
 * sources (`@source`). The `theme` prop is also a class on the player
 * (`light` / `dark`), which re-scopes the tokens, so the chrome follows the
 * prop whatever the page's theme. Geometry the controller and the tests read
 * (scroll container, overlays, label indents and colors) stays inline.
 */
import { TEMPO_MULTIPLIER_RANGE } from '@sheet-music/playback-core';
import { Alert } from '@sheet-music/ui/components/alert';
import { Button } from '@sheet-music/ui/components/button';
import { Label } from '@sheet-music/ui/components/label';
import { Slider } from '@sheet-music/ui/components/slider';
import { Spinner } from '@sheet-music/ui/components/spinner';
import { Switch } from '@sheet-music/ui/components/switch';
import { cn } from '@sheet-music/ui/lib/utils';
import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useId,
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
  const tempoLabelId = useId();
  const loopId = useId();
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
  const { paper, ink } = PALETTES[theme];
  const title = score?.metadata.title;
  const problems = describeProblems(view, audioUnavailable);
  const status = describeStatus(view, playable, audioUnavailable);

  const sheet = (
    <div
      className={SHEET_CLASSES}
      style={paperStyle(paper)}
      data-blank={renderedScore === null ? '' : undefined}
      data-overflow-start={overflow.start ? '' : undefined}
      data-overflow-end={overflow.end ? '' : undefined}
    >
      <div
        ref={scrollRef}
        data-player-viewport=""
        className="[scrollbar-color:var(--input)_transparent] [scrollbar-width:thin]"
        style={SCROLL_STYLE}
        onScroll={measureOverflow}
      >
        {/* Behind the notation (painted first): where playback is. Decorative. */}
        <div aria-hidden="true" style={overlayStyle(layout?.width ?? 0, layout?.height ?? 0)}>
          {playbackBands.map(({ systemId, bounds }) => (
            <div
              key={systemId}
              className="rounded-md bg-primary-soft shadow-[inset_0_0_0_1px_var(--primary-border)]"
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
        {/* Positioned, so it paints above the playback band that precedes it. */}
        <div
          ref={targetRef}
          className="relative [&>svg]:block"
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
                  className="flex items-baseline gap-1.5 font-medium"
                  style={{ ...LABEL_STYLE, paddingLeft: label.indent, color: ink }}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block size-2 shrink-0 rounded-full"
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

  // The controls bar, the status line and the problems move together
  // (controlsPosition); the player's gap separates them from the sheet.
  const controls = (
    <div className="flex min-w-0 flex-col">
      <div
        role="group"
        aria-label="Playback controls"
        className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border bg-muted py-2 pr-4 pl-2"
      >
        <Button
          variant="default"
          className="min-w-26"
          disabled={!playing && !playable}
          onClick={playing ? controller.pause : controller.play}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          {playing ? 'Pause' : 'Play'}
        </Button>
        {/* Grows, which pushes Loop to the end of the bar. */}
        <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* Names the slider's thumb (the role="slider" element). */}
            <span
              id={tempoLabelId}
              className={cn(
                'inline-flex h-10 shrink-0 items-center text-sm font-medium',
                !settingsEnabled && 'cursor-not-allowed opacity-50',
              )}
            >
              Tempo
            </span>
            <Slider
              className="w-56 min-w-20 flex-[0_1_14rem]"
              min={TEMPO_PERCENT.min}
              max={TEMPO_PERCENT.max}
              step={TEMPO_PERCENT.step}
              value={[tempoPercent]}
              disabled={!settingsEnabled}
              onValueChange={([percent = tempoPercent]) => {
                controller.setTempo(percent / 100);
              }}
              thumbProps={{ 'aria-labelledby': tempoLabelId, 'aria-valuetext': tempoText }}
            />
          </div>
          {/* Visual readout; assistive technology reads the slider's aria-valuetext. */}
          <span
            aria-hidden="true"
            className="min-w-26 text-sm whitespace-nowrap text-muted-foreground tabular-nums"
          >
            {tempoText}
          </span>
        </div>
        <div className="flex h-10 items-center gap-2.5">
          <Switch
            id={loopId}
            checked={playback?.loop ?? false}
            disabled={!settingsEnabled}
            onCheckedChange={controller.setLoop}
          />
          {/* A 40 px tall target that toggles the switch. */}
          <Label htmlFor={loopId} className="h-10 cursor-pointer">
            Loop
          </Label>
        </div>
      </div>
      <p
        role="status"
        className="mt-2 flex min-h-5 items-center gap-2 text-sm text-muted-foreground"
        data-state={status.state}
      >
        {status.state === 'loading' ? (
          <Spinner size="sm" className="size-3" />
        ) : (
          <span
            aria-hidden="true"
            data-state={status.state}
            className="size-2 shrink-0 rounded-full bg-input data-[state=playing]:bg-primary data-[state=problem]:bg-destructive"
          />
        )}
        {status.text}
      </p>
      {/* Always in the tree (the live region); boxed only when it has content. */}
      <Alert
        role="alert"
        variant="error"
        className="flex-col gap-2 px-3 py-2.5 not-empty:mt-3 empty:border-0 empty:p-0"
      >
        {problems.map((problem) => (
          <p key={problem}>{problem}</p>
        ))}
        {audioUnavailable && (
          <Button variant="outline" size="sm" onClick={controller.retryAudio}>
            Retry audio
          </Button>
        )}
      </Alert>
    </div>
  );

  return (
    <section
      aria-label={title === undefined ? 'Score player' : `Score player: ${title}`}
      className={cn(theme, 'flex min-w-0 flex-col gap-3 text-foreground')}
    >
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
    <svg className="size-4 fill-current" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.37v9.26a.87.87 0 0 0 1.33.74l7.2-4.63a.87.87 0 0 0 0-1.48l-7.2-4.63A.87.87 0 0 0 5 3.37z" />
    </svg>
  );
}

function PauseIcon(): ReactElement {
  return (
    <svg className="size-4 fill-current" viewBox="0 0 16 16" aria-hidden="true">
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

/** The notation paper of the theme, also as `--paper` for the side fades. */
function paperStyle(paper: string): CSSProperties {
  return { backgroundColor: paper, '--paper': paper } as CSSProperties;
}

/**
 * The notation paper. No horizontal padding or border: the notation takes the
 * player's full width (the renderer keeps its own 12 px margins; the edge is
 * an inset shadow). `data-blank`: faint staff lines while nothing is drawn.
 * `data-overflow-start|end`: a fade to the paper on each side that hides
 * notation, the cue that it scrolls sideways (a thin scrollbar is invisible
 * on touch screens).
 */
const SHEET_CLASSES = [
  'relative overflow-hidden rounded-xl py-2 shadow-[inset_0_0_0_1px_var(--border)]',
  'data-blank:min-h-30 data-blank:bg-[image:repeating-linear-gradient(to_bottom,var(--border)_0_1px,transparent_1px_10px)] data-blank:bg-[length:calc(100%_-_48px)_41px] data-blank:bg-center data-blank:bg-no-repeat',
  'before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:z-1 before:hidden before:w-8 before:bg-linear-to-l before:from-transparent before:to-(--paper) data-overflow-start:before:block',
  'after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-1 after:hidden after:w-8 after:bg-linear-to-r after:from-transparent after:to-(--paper) data-overflow-end:after:block',
].join(' ');

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
