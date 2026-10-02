/**
 * The notation colors of each player theme (docs/architecture/DESIGN_SYSTEM.md
 * §5). They are JavaScript values because the renderer needs them, not CSS:
 *
 * - `paper` is the notation surface (the sheet's inline background) and `ink`
 *   the renderer's ink. They are a matched pair taken from the `theme` prop,
 *   never from host CSS, so the notation stays readable whatever the host
 *   styles.
 * - `highlight` recolors the sounding noteheads.
 *
 * They equal the `card`, `foreground` and `primary` tokens of
 * `@sheet-music/ui/styles/theme.css` in the same theme (palette-tokens test).
 * The rest of the player (controls, status, problems) is styled with those
 * tokens through Tailwind classes, re-scoped by the theme class on the player.
 */
import type { RenderTheme } from '@sheet-music/renderer-core';
import type { ScorePlayerTheme } from './types';

export interface Palette {
  readonly paper: string;
  readonly ink: string;
  readonly highlight: string;
}

export const PALETTES: Readonly<Record<ScorePlayerTheme, Palette>> = {
  light: { paper: '#ffffff', ink: '#18181b', highlight: '#4f46e5' },
  dark: { paper: '#1c1c20', ink: '#f4f4f5', highlight: '#818cf8' },
};

/** Stable objects, so an unchanged theme is the same RenderTheme. */
export const RENDER_THEMES: Readonly<Record<ScorePlayerTheme, RenderTheme>> = {
  light: { ink: PALETTES.light.ink, playbackHighlight: PALETTES.light.highlight },
  dark: { ink: PALETTES.dark.ink, playbackHighlight: PALETTES.dark.highlight },
};
