/// <reference types="node" />
/**
 * The notation colors of each player theme (`PALETTES`, theme.ts;
 * docs/architecture/DESIGN_SYSTEM.md §5) are JavaScript values, because the
 * renderer needs them, while the rest of the player is styled with the
 * tokens of `@sheet-music/ui/styles/theme.css`. They must be the same colors:
 * paper = `card` (the elevated surface the sheet reads as), ink =
 * `foreground`, highlight = `primary`, in the light and the dark theme. The
 * oklch values of theme.css are converted to the hex the browser paints.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { PALETTES, type Palette, RENDER_THEMES } from '../src/theme';
import type { ScorePlayerTheme } from '../src/types';

/** Resolved like a host's CSS import, through the package's `exports`. */
const THEME_CSS = readFileSync(
  createRequire(import.meta.url).resolve('@sheet-music/ui/styles/theme.css'),
  'utf8',
);

/** Selector of the token block of each theme in theme.css. */
const TOKEN_BLOCKS: Readonly<Record<ScorePlayerTheme, string>> = {
  light: ':root, .light',
  dark: '.dark',
};

/** The custom properties declared by the flat rule whose selector is exactly `selector`. */
function customProperties(selector: string): Map<string, string> {
  for (const [, prelude = '', body = ''] of THEME_CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    // What follows the last comment or statement before the brace, whitespace collapsed.
    const found = prelude
      .replace(/\/\*[\s\S]*?\*\//g, ';')
      .split(';')
      .at(-1)
      ?.replace(/\s+/g, ' ')
      .trim();
    if (found === selector) {
      const declarations = body.replace(/\/\*[\s\S]*?\*\//g, '');
      return new Map(
        [...declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
          ([, name = '', value = '']) => [name, value.trim()],
        ),
      );
    }
  }
  throw new Error(`No "${selector}" rule in theme.css`);
}

/** An opaque `oklch(L C H)` as the 8-bit sRGB hex a browser paints (gamut-clipped). */
function oklchToHex(value: string): string {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (match === null) {
    throw new Error(`Not an opaque oklch() color: ${value}`);
  }
  const [lightness, chroma, hue] = [match[1], match[2], match[3]].map(Number) as [
    number,
    number,
    number,
  ];
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channel = (linear: number): string => {
    const clipped = Math.min(1, Math.max(0, linear));
    const gamma = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(255 * gamma)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${[
    channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ].join('')}`;
}

/** The painted hex of `--<token>` in a theme's token block. */
function tokenHex(theme: ScorePlayerTheme, token: string): string {
  const value = customProperties(TOKEN_BLOCKS[theme]).get(`--${token}`);
  if (value === undefined) {
    throw new Error(`No --${token} in the ${theme} tokens`);
  }
  return oklchToHex(value);
}

/** The token each notation color must equal. */
const TOKEN_OF: Readonly<Record<keyof Palette, string>> = {
  paper: 'card',
  ink: 'foreground',
  highlight: 'primary',
};

describe.each(['light', 'dark'] as const)('%s palette', (theme) => {
  test.each(Object.entries(TOKEN_OF) as [keyof Palette, string][])(
    '%s equals the --%s token',
    (entry, token) => {
      expect(PALETTES[theme][entry]).toBe(tokenHex(theme, token));
    },
  );

  test('the renderer draws in the foreground ink and highlights in the primary color', () => {
    expect(RENDER_THEMES[theme]).toEqual({
      ink: tokenHex(theme, 'foreground'),
      playbackHighlight: tokenHex(theme, 'primary'),
    });
  });
});
