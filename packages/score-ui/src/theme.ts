/**
 * Light and dark palettes (docs/architecture/DESIGN_SYSTEM.md). Their values
 * are the design tokens of the web app, so the player looks the same with or
 * without a host mapping.
 *
 * - `paper` and `ink` are the notation surface and the renderer's ink: always
 *   a matched pair taken from the `theme` prop, never from host CSS, so the
 *   notation stays readable whatever a host maps.
 * - Every other entry is the default of one `--smp-*` chrome variable
 *   (CHROME_VARIABLES); a host overrides it by setting that variable on an
 *   ancestor of the player.
 */
import type { RenderTheme } from '@sheet-music/renderer-core';
import type { ScorePlayerTheme } from './types';

export interface Palette {
  readonly paper: string;
  readonly ink: string;
  readonly text: string;
  readonly muted: string;
  readonly surface: string;
  readonly elevated: string;
  readonly hover: string;
  readonly border: string;
  readonly borderControl: string;
  readonly borderStrong: string;
  readonly accent: string;
  readonly accentHover: string;
  /** Soft accent fill: the playback band behind the sounding notes. */
  readonly accentSoft: string;
  readonly onAccent: string;
  readonly danger: string;
  readonly dangerText: string;
  readonly dangerSoft: string;
}

export const PALETTES: Readonly<Record<ScorePlayerTheme, Palette>> = {
  light: {
    paper: '#ffffff',
    ink: '#18181b',
    text: '#18181b',
    muted: '#71717a',
    surface: '#f7f7f8',
    elevated: '#ffffff',
    hover: '#f4f4f5',
    border: '#e4e4e7',
    borderControl: '#d4d4d8',
    borderStrong: '#8b8b94',
    accent: '#4f46e5',
    accentHover: '#4338ca',
    accentSoft: '#eef2ff',
    onAccent: '#ffffff',
    danger: '#dc2626',
    dangerText: '#b91c1c',
    dangerSoft: '#fef2f2',
  },
  dark: {
    paper: '#1c1c20',
    ink: '#f4f4f5',
    text: '#f4f4f5',
    muted: '#a1a1aa',
    surface: '#17171a',
    elevated: '#1c1c20',
    hover: '#232328',
    border: '#2a2a30',
    borderControl: '#3a3a42',
    borderStrong: '#6b6b76',
    accent: '#818cf8',
    accentHover: '#a5b4fc',
    accentSoft: 'rgba(129, 140, 248, 0.14)',
    // White on #818cf8 is below WCAG AA (about 3:1): dark text instead.
    onAccent: '#0f0f11',
    danger: '#f87171',
    dangerText: '#fca5a5',
    dangerSoft: 'rgba(248, 113, 113, 0.12)',
  },
};

/**
 * Public chrome variables a host may set (name without the `--smp-` prefix)
 * and the palette entry that is their default. `--smp-focus` defaults to the
 * accent.
 */
export const CHROME_VARIABLES: ReadonlyArray<readonly [string, keyof Palette]> = [
  ['text', 'text'],
  ['muted', 'muted'],
  ['surface', 'surface'],
  ['elevated', 'elevated'],
  ['hover', 'hover'],
  ['border', 'border'],
  ['border-control', 'borderControl'],
  ['border-strong', 'borderStrong'],
  ['accent', 'accent'],
  ['accent-hover', 'accentHover'],
  ['accent-soft', 'accentSoft'],
  ['on-accent', 'onAccent'],
  ['danger', 'danger'],
  ['danger-text', 'dangerText'],
  ['danger-soft', 'dangerSoft'],
];

/** Stable objects, so an unchanged theme is the same RenderTheme. */
export const RENDER_THEMES: Readonly<Record<ScorePlayerTheme, RenderTheme>> = {
  light: { ink: PALETTES.light.ink, playbackHighlight: PALETTES.light.accent },
  dark: { ink: PALETTES.dark.ink, playbackHighlight: PALETTES.dark.accent },
};
