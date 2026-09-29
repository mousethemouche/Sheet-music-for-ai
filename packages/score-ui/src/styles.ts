/**
 * The player's own stylesheet (docs/architecture/DESIGN_SYSTEM.md §4). It is
 * rendered by ScorePlayer as a React 19 hoisted `<style>` (deduplicated by
 * `href`), so the player needs no global stylesheet or bundler CSS support:
 * it looks the same in the web app and in the single-file MCP View.
 *
 * Every rule is scoped under `.smp-player` (specificity above a host's
 * element or role selectors). Colors resolve as `--_smp-<name>` =
 * `var(--smp-<name>, <palette default of the theme prop>)`: a host themes
 * the chrome by setting `--smp-<name>` on an ancestor. The notation paper
 * follows the theme prop only (it must match the renderer's ink).
 *
 * Geometry the annotation overlay and its tests rely on (positions, widths,
 * label indents and colors) stays in inline styles in score-player.tsx.
 */
import { CHROME_VARIABLES, PALETTES, type Palette } from './theme';

/** `href` of the hoisted `<style>`: one copy per document however many players. */
export const STYLESHEET_HREF = 'sheet-music-score-player';
export const STYLESHEET_PRECEDENCE = 'sheet-music';

function themeDeclarations(palette: Palette): string {
  return [
    `--_smp-paper: ${palette.paper};`,
    ...CHROME_VARIABLES.map(
      ([name, key]) => `--_smp-${name}: var(--smp-${name}, ${palette[key]});`,
    ),
    '--_smp-focus: var(--smp-focus, var(--_smp-accent));',
  ].join('\n  ');
}

export const PLAYER_CSS = `
.smp-player {
  ${themeDeclarations(PALETTES.light)}
  --_smp-radius: var(--smp-radius, 8px);
  --_smp-radius-lg: var(--smp-radius-lg, 12px);
  --_smp-duration: 120ms;
  display: block;
  min-width: 0;
  color: var(--_smp-text);
  line-height: 1.5;
}
.smp-player.smp-player--dark {
  ${themeDeclarations(PALETTES.dark)}
}

/* Notation paper. No horizontal padding or border: the notation takes the
   player's full width (the renderer keeps its own 12 px margins). */
.smp-player .smp-sheet {
  box-sizing: border-box;
  position: relative;
  padding-block: 8px;
  overflow: hidden;
  background-color: var(--_smp-paper);
  border-radius: var(--_smp-radius-lg);
  box-shadow: inset 0 0 0 1px var(--_smp-border);
}
.smp-player .smp-sheet[data-blank] {
  min-height: 7.5rem;
  background-image: repeating-linear-gradient(
    to bottom,
    var(--_smp-border) 0 1px,
    transparent 1px 10px
  );
  background-size: calc(100% - 48px) 41px;
  background-position: center;
  background-repeat: no-repeat;
}
.smp-player .smp-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--_smp-border-strong) transparent;
}
/* Positioned so it paints above the playback band that precedes it. */
.smp-player .smp-notation {
  position: relative;
}
.smp-player .smp-notation > svg {
  display: block;
}

/* Sideways scrolling cue: a fade on each side that hides notation (the
   player sets the data attributes from the scroll position). */
.smp-player .smp-sheet[data-overflow-start]::before,
.smp-player .smp-sheet[data-overflow-end]::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 1;
  width: 32px;
  pointer-events: none;
}
.smp-player .smp-sheet[data-overflow-start]::before {
  left: 0;
  background: linear-gradient(to left, transparent, var(--_smp-paper));
}
.smp-player .smp-sheet[data-overflow-end]::after {
  right: 0;
  background: linear-gradient(to right, transparent, var(--_smp-paper));
}

/* Playback band: behind the sounding notes, so the position reads by shape
   and not by the notehead's hue alone. It moves with the notes, unanimated. */
.smp-player .smp-playback-band {
  box-sizing: border-box;
  border-radius: 6px;
  background-color: var(--_smp-accent-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--_smp-accent) 30%, transparent);
}

/* Annotation labels: text in the paper's ink (set inline, AA on the paper
   whatever the teaching color), a swatch in the teaching color. */
.smp-player .smp-annotation {
  font-weight: 500;
}
.smp-player .smp-annotation-swatch {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  margin-right: 0.375rem;
  border-radius: 50%;
  vertical-align: 0.05em;
}

/* Controls above the notation (controlsPosition="top"). */
.smp-player.smp-player--controls-top .smp-controls {
  margin-top: 0;
}
.smp-player.smp-player--controls-top .smp-sheet {
  margin-top: 12px;
}

/* Controls bar. */
.smp-player .smp-controls {
  box-sizing: border-box;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
  margin-top: 12px;
  padding: 8px 16px 8px 8px;
  background-color: var(--_smp-surface);
  border: 1px solid var(--_smp-border);
  border-radius: var(--_smp-radius-lg);
}
.smp-player .smp-tempo {
  display: flex;
  flex: 1 1 16rem;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.smp-player .smp-field {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  /* The label is the touch target of the slider and the switch: 40 px tall. */
  min-height: 40px;
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--_smp-text);
  cursor: pointer;
}
/* The slider keeps its width and the readout sits right after it; the
   group's free space goes to its end, which pushes Loop to the right. */
.smp-player .smp-tempo .smp-field {
  flex: 0 1 auto;
}
.smp-player .smp-field:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.5;
}
.smp-player .smp-tempo-value {
  min-width: 6.5rem;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--_smp-muted);
}

/* Buttons. */
.smp-player .smp-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  margin: 0;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: var(--_smp-radius);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  touch-action: manipulation;
  transition:
    background-color var(--_smp-duration) ease,
    border-color var(--_smp-duration) ease,
    color var(--_smp-duration) ease;
}
.smp-player .smp-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.smp-player .smp-button--primary {
  min-width: 6.5rem;
  background-color: var(--_smp-accent);
  border-color: var(--_smp-accent);
  color: var(--_smp-on-accent);
}
.smp-player .smp-button--secondary {
  min-height: 32px;
  padding: 0 12px;
  background-color: var(--_smp-elevated);
  border-color: var(--_smp-border-control);
  color: var(--_smp-text);
}
@media (hover: hover) {
  .smp-player .smp-button--primary:hover:not(:disabled) {
    background-color: var(--_smp-accent-hover);
    border-color: var(--_smp-accent-hover);
  }
  .smp-player .smp-button--secondary:hover:not(:disabled) {
    background-color: var(--_smp-hover);
  }
}
.smp-player .smp-icon {
  flex: none;
  width: 16px;
  height: 16px;
  fill: currentColor;
}

/* Tempo slider: 4 px track filled up to the value (--_smp-fill, set inline). */
.smp-player .smp-range {
  -webkit-appearance: none;
  appearance: none;
  flex: 0 1 14rem;
  width: 14rem;
  min-width: 5rem;
  height: 40px;
  margin: 0;
  padding: 0;
  background: transparent;
  border-radius: 999px;
  cursor: pointer;
}
.smp-player .smp-range:disabled {
  cursor: not-allowed;
}
.smp-player .smp-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--_smp-accent) 0 var(--_smp-fill, 50%),
    var(--_smp-border-control) var(--_smp-fill, 50%) 100%
  );
}
.smp-player .smp-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border: 2px solid var(--_smp-accent);
  border-radius: 50%;
  background-color: var(--_smp-elevated);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
}
.smp-player .smp-range::-moz-range-track {
  height: 4px;
  border: 0;
  border-radius: 999px;
  background-color: var(--_smp-border-control);
}
.smp-player .smp-range::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background-color: var(--_smp-accent);
}
.smp-player .smp-range::-moz-range-thumb {
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  border: 2px solid var(--_smp-accent);
  border-radius: 50%;
  background-color: var(--_smp-elevated);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
}

/* Loop: a native checkbox drawn as a switch (role and keyboard unchanged). */
.smp-player .smp-switch {
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  background-color: var(--_smp-border-strong);
  cursor: pointer;
  transition: background-color var(--_smp-duration) ease;
}
.smp-player .smp-switch::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background-color: #ffffff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
  transition: transform var(--_smp-duration) ease;
}
.smp-player .smp-switch:checked {
  background-color: var(--_smp-accent);
}
.smp-player .smp-switch:checked::before {
  transform: translateX(14px);
  background-color: var(--_smp-on-accent);
}
.smp-player .smp-switch:disabled {
  cursor: not-allowed;
}

/* Keyboard focus: 2 px ring in the focus color, offset from the control. */
.smp-player .smp-button:focus-visible,
.smp-player .smp-range:focus-visible,
.smp-player .smp-switch:focus-visible {
  outline: 2px solid var(--_smp-focus);
  outline-offset: 2px;
}

/* Status line, with a state dot (a spinner while loading). */
.smp-player .smp-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
  margin: 8px 0 0;
  font-size: 0.8125rem;
  color: var(--_smp-muted);
}
.smp-player .smp-status-dot {
  box-sizing: border-box;
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--_smp-border-strong);
}
.smp-player .smp-status[data-state='playing'] .smp-status-dot {
  background-color: var(--_smp-accent);
}
.smp-player .smp-status[data-state='problem'] .smp-status-dot {
  background-color: var(--_smp-danger);
}
.smp-player .smp-status[data-state='loading'] .smp-status-dot {
  width: 12px;
  height: 12px;
  background-color: transparent;
  border: 2px solid var(--_smp-border-control);
  border-top-color: var(--_smp-accent);
  animation: smp-spin 0.8s linear infinite;
}
@keyframes smp-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Problems: always in the tree (live region), boxed only when not empty. */
.smp-player .smp-alert {
  margin: 0;
  font-size: 0.875rem;
  color: var(--_smp-danger-text);
}
.smp-player .smp-alert:not(:empty) {
  box-sizing: border-box;
  display: grid;
  justify-items: start;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  background-color: var(--_smp-danger-soft);
  border: 1px solid color-mix(in srgb, var(--_smp-danger) 35%, transparent);
  border-radius: var(--_smp-radius);
}
.smp-player .smp-alert p {
  margin: 0;
}

@media (prefers-reduced-motion: reduce) {
  .smp-player *,
  .smp-player *::before {
    transition: none !important;
    animation: none !important;
  }
}

/* Windows High Contrast and other forced palettes: native controls. */
@media (forced-colors: active) {
  .smp-player .smp-switch {
    -webkit-appearance: auto;
    appearance: auto;
    width: auto;
    height: auto;
  }
  .smp-player .smp-switch::before {
    content: none;
  }
  .smp-player .smp-range {
    -webkit-appearance: auto;
    appearance: auto;
  }
  .smp-player .smp-range::-webkit-slider-thumb {
    -webkit-appearance: auto;
    appearance: auto;
  }
}
`;
