/**
 * Light and dark palettes. The renderer receives `ink` and `highlight` as its
 * RenderTheme; the player's own chrome reads the same values through CSS
 * custom properties set on its root element.
 */
import type { RenderTheme } from '@sheet-music/renderer-core';
import type { ScorePlayerTheme } from './types';

interface Palette {
  readonly surface: string;
  readonly ink: string;
  readonly muted: string;
  readonly accent: string;
  readonly danger: string;
}

export const PALETTES: Readonly<Record<ScorePlayerTheme, Palette>> = {
  light: {
    surface: '#ffffff',
    ink: '#1c1c1c',
    muted: '#5f6368',
    accent: '#0b57d0',
    danger: '#b3261e',
  },
  dark: {
    surface: '#1e1f20',
    ink: '#e8eaed',
    muted: '#9aa0a6',
    accent: '#8ab4f8',
    danger: '#f2b8b5',
  },
};

/** Stable objects, so an unchanged theme is the same RenderTheme. */
export const RENDER_THEMES: Readonly<Record<ScorePlayerTheme, RenderTheme>> = {
  light: { ink: PALETTES.light.ink, playbackHighlight: PALETTES.light.accent },
  dark: { ink: PALETTES.dark.ink, playbackHighlight: PALETTES.dark.accent },
};
