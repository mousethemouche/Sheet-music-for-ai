/// <reference types="node" />
/**
 * The View's stylesheet carries its own copy of the design tokens (a separate
 * single-file build cannot import the web app's). This keeps that copy equal
 * to the source of truth, apps/web/src/styles/tokens.css
 * (docs/architecture/DESIGN_SYSTEM.md §1): same values in light and dark, a
 * dark override wherever the web has one, and the same `--smp-*` mapping of
 * the ScorePlayer's chrome. Read as text: the files are CSS, not modules.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const VIEW_CSS = read('../src/view.css');
const WEB_TOKENS = read('../../../web/src/styles/tokens.css');

/** The body of the first rule whose prelude is exactly `selector`, searched from `from`. */
function ruleBody(css: string, selector: string, from = 0): string {
  const start = css.indexOf(`${selector} {`, from);
  if (start === -1) {
    throw new Error(`No "${selector}" rule`);
  }
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  throw new Error(`Unclosed "${selector}" rule`);
}

/** `--prefix-*` declarations of a rule body, values with collapsed whitespace. */
function declarations(body: string, prefix: string): Map<string, string> {
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Map<string, string>();
  for (const [, name = '', value = ''] of withoutComments.matchAll(
    new RegExp(`(--${prefix}-[\\w-]+)\\s*:\\s*([^;]+);`, 'g'),
  )) {
    found.set(name, value.replace(/\s+/g, ' ').trim());
  }
  return found;
}

const webLight = declarations(ruleBody(WEB_TOKENS, ':root'), 'ui');
const webDark = declarations(
  ruleBody(WEB_TOKENS, ':root', WEB_TOKENS.indexOf('@media (prefers-color-scheme: dark)')),
  'ui',
);
const viewLight = declarations(ruleBody(VIEW_CSS, '.sv'), 'ui');
const viewDark = declarations(ruleBody(VIEW_CSS, '.sv.sv--dark'), 'ui');

const entries = (map: Map<string, string>): [string, string][] => [...map.entries()].sort();
const pick = (map: Map<string, string>, names: Iterable<string>): [string, string][] =>
  [...names].sort().map((name) => [name, map.get(name) ?? '(missing)']);

describe('View tokens', () => {
  it('parses both stylesheets', () => {
    expect(viewLight.size).toBeGreaterThan(20);
    expect(viewDark.size).toBeGreaterThan(10);
    expect(webDark.get('--ui-text')).toBe('#f4f4f5');
  });

  it('declares light tokens with the web values', () => {
    expect(entries(viewLight)).toEqual(pick(webLight, viewLight.keys()));
  });

  it('overrides in dark exactly the tokens the web overrides, with the web values', () => {
    const overridden = [...viewLight.keys()].filter((name) => webDark.has(name));
    expect(entries(viewDark)).toEqual(pick(webDark, overridden));
  });

  it('maps every ScorePlayer variable to the same token as the web app', () => {
    const webMapping = declarations(WEB_TOKENS.slice(WEB_TOKENS.lastIndexOf(':root {')), 'smp');
    const viewMapping = declarations(VIEW_CSS, 'smp');
    expect(webMapping.size).toBe(18);
    expect(entries(viewMapping)).toEqual(entries(webMapping));
  });
});
