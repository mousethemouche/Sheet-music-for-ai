/// <reference types="node" />
/**
 * The design tokens of src/styles/theme.css (docs/architecture/DESIGN_SYSTEM.md
 * §1), read as text: the file is CSS, not a module. Checks that
 * - every oklch value converts back to the exact hex noted beside it (the
 *   palette the AA ratios of §1 were measured on);
 * - the text and control pairs the design relies on keep WCAG 2.2 AA
 *   contrast, in the light and the dark theme (translucent surfaces are
 *   composited over the page background first);
 * - the dark theme overrides every light token, and every color token has
 *   its Tailwind color (`--color-<token>` in `@theme inline`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const THEME_CSS = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');

/** The body of the first rule whose prelude (whitespace collapsed) is exactly `selector`. */
function ruleBody(selector: string): string {
  const pattern = /([^{}]*)\{/g;
  for (let match = pattern.exec(THEME_CSS); match !== null; match = pattern.exec(THEME_CSS)) {
    // What follows the last statement (`@source ...;`) before the brace.
    const prelude = (match[1] ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(';')
      .at(-1)
      ?.replace(/\s+/g, ' ')
      .trim();
    if (prelude !== selector) continue;
    let depth = 0;
    for (let index = pattern.lastIndex - 1; index < THEME_CSS.length; index += 1) {
      if (THEME_CSS[index] === '{') depth += 1;
      if (THEME_CSS[index] === '}') depth -= 1;
      if (depth === 0) return THEME_CSS.slice(pattern.lastIndex, index);
    }
  }
  throw new Error(`No "${selector}" rule in theme.css`);
}

interface Declaration {
  readonly value: string;
  /** The `#rrggbb` a trailing comment gives for the value, if any. */
  readonly hex: string | null;
}

/** Custom property declarations of a rule body, with the hex of their trailing comment. */
function declarations(body: string): Map<string, Declaration> {
  const found = new Map<string, Declaration>();
  const pattern = /(--[\w-]+)\s*:\s*([^;]+);[ \t]*(?:\/\*\s*(#[0-9a-f]{6})\b[^*]*\*\/)?/g;
  for (const [, name = '', value = '', hex] of body.matchAll(pattern)) {
    found.set(name, { value: value.replace(/\s+/g, ' ').trim(), hex: hex ?? null });
  }
  return found;
}

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

/** `oklch(L C H)` or `oklch(L C H / A)` to 8-bit sRGB (gamut-clipped), as the browser paints it. */
function oklchToRgba(value: string): Rgba {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (match === null) {
    throw new Error(`Not an oklch() color: ${value}`);
  }
  const [lightness, chroma, hue, alpha] = [match[1], match[2], match[3], match[4] ?? '1'].map(
    Number,
  ) as [number, number, number, number];
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (linear: number): number => {
    const clipped = Math.min(1, Math.max(0, linear));
    const gamma = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(255 * gamma);
  };
  return {
    r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  };
}

const toHex = ({ r, g, b }: Rgba): string =>
  `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

/** A translucent color painted over an opaque one. */
const over = (top: Rgba, bottom: Rgba): Rgba => ({
  r: Math.round(top.r * top.alpha + bottom.r * (1 - top.alpha)),
  g: Math.round(top.g * top.alpha + bottom.g * (1 - top.alpha)),
  b: Math.round(top.b * top.alpha + bottom.b * (1 - top.alpha)),
  alpha: 1,
});

/** WCAG 2.x relative luminance and contrast ratio. */
function contrast(first: Rgba, second: Rgba): number {
  const luminance = ({ r, g, b }: Rgba): number => {
    const linear = (channel: number): number => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

const LIGHT = declarations(ruleBody(':root, .light'));
const DARK = declarations(ruleBody('.dark'));
const THEME_INLINE = declarations(ruleBody('@theme inline'));
const THEMES = { light: LIGHT, dark: DARK } as const;

const isColor = (declaration: Declaration): boolean => declaration.value.startsWith('oklch(');

/** A token of a theme as an opaque color, composited over that theme's background. */
function paint(theme: keyof typeof THEMES, token: string): Rgba {
  const tokens = THEMES[theme];
  const read = (name: string): Rgba => {
    const declaration = tokens.get(`--${name}`);
    if (declaration === undefined) throw new Error(`No --${name} in the ${theme} theme`);
    return oklchToRgba(declaration.value);
  };
  const color = read(token);
  return color.alpha === 1 ? color : over(color, read('background'));
}

describe('theme.css tokens', () => {
  test('parses both themes', () => {
    expect(LIGHT.size).toBeGreaterThan(30);
    expect(DARK.size).toBeGreaterThan(30);
    expect(LIGHT.get('--primary')?.hex).toBe('#4f46e5');
    expect(DARK.get('--primary')?.hex).toBe('#818cf8');
  });

  test.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)('every %s value noted with a hex converts back to exactly that hex', (_, tokens) => {
    const noted = [...tokens].filter(([, declaration]) => declaration.hex !== null);
    expect(noted.length).toBeGreaterThan(15);
    const converted = noted.map(([name, declaration]) => [
      name,
      toHex(oklchToRgba(declaration.value)),
    ]);
    expect(converted).toEqual(noted.map(([name, declaration]) => [name, declaration.hex]));
  });

  test('the dark theme overrides every light token except the radius', () => {
    const light = [...LIGHT.keys()].filter((name) => name !== '--radius').sort();
    expect([...DARK.keys()].sort()).toEqual(light);
  });

  test('every color token has its Tailwind color in @theme inline', () => {
    const colors = [...LIGHT].filter(([, declaration]) => isColor(declaration));
    expect(colors.length).toBeGreaterThanOrEqual(30);
    expect(
      colors.map(([name]) => [name, THEME_INLINE.get(`--color-${name.slice(2)}`)?.value]),
    ).toEqual(colors.map(([name]) => [name, `var(${name})`]));
  });

  describe.each(['light', 'dark'] as const)('%s theme contrast (WCAG 2.2 AA)', (theme) => {
    test.each([
      // Text: 4.5:1.
      ['foreground', 'background', 4.5],
      ['foreground', 'card', 4.5],
      ['foreground', 'muted', 4.5],
      ['muted-foreground', 'background', 4.5],
      ['muted-foreground', 'muted', 4.5],
      ['muted-foreground', 'card', 4.5],
      ['primary-foreground', 'primary', 4.5],
      ['primary', 'background', 4.5],
      ['primary', 'primary-soft', 4.5],
      ['destructive-text', 'background', 4.5],
      ['destructive-text', 'destructive-soft', 4.5],
      ['success-text', 'success-soft', 4.5],
      ['secondary-foreground', 'secondary', 4.5],
      ['accent-foreground', 'accent', 4.5],
      // Control boundaries and the focus ring: 3:1 (WCAG 1.4.11).
      ['input', 'card', 3],
      ['input', 'background', 3],
      ['input', 'muted', 3],
      ['ring', 'background', 3],
      ['primary', 'muted', 3],
    ])('%s on %s is at least %s:1', (text, surface, minimum) => {
      expect(contrast(paint(theme, text), paint(theme, surface))).toBeGreaterThanOrEqual(minimum);
    });
  });
});
