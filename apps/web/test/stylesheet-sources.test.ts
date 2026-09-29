/// <reference types="node" />
/**
 * The web stylesheet has the classes of every source it must scan
 * (DESIGN_SYSTEM.md §4, REPO_LAYOUT.md "CSS and the design system").
 *
 * Tailwind compiles src/styles/app.css in the web's Vite build from the
 * sources app.css and theme.css list with `@source`: this app, the
 * ScorePlayer (packages/score-ui) and the ui components. A source missing
 * from that list builds without error and leaves its classes unstyled, while
 * every role and name still works, and jsdom computes no styles. So this
 * builds app.css with the web's own Vite configuration and checks that a
 * class used by one source only reached the CSS. (The View has the same
 * guard in MCP-UI-01, on computed styles.)
 *
 * This file sits outside src/ on purpose: app.css scans src/, and the class
 * names written below would otherwise be found here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { beforeAll, describe, expect, test } from 'vitest';

const REPOSITORY = fileURLToPath(new URL('../../..', import.meta.url));
const WEB = join(REPOSITORY, 'apps/web');

/** What the web stylesheet scans, each with a class that only it uses. */
const SOURCES = [
  { source: 'apps/web/src', className: 'max-w-[1088px]' },
  { source: 'packages/score-ui/src', className: 'shadow-[inset_0_0_0_1px_var(--border)]' },
  { source: 'packages/ui/src/components', className: 'w-[34px]' },
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

/** Directories (of SOURCES) whose files contain `className`. */
function sourcesUsing(className: string): string[] {
  return SOURCES.filter(({ source }) =>
    sourceFiles(join(REPOSITORY, source)).some((file) =>
      readFileSync(file, 'utf8').includes(className),
    ),
  ).map(({ source }) => source);
}

/** The selector Tailwind writes for a class: `[`, `(`, `%`... escaped. */
function selectorOf(className: string): string {
  return `.${className.replace(/[^\w-]/g, (character) => `\\${character}`)}`;
}

/** app.css built alone, with the plugins of apps/web/vite.config.ts, in memory. */
async function buildWebStylesheet(): Promise<string> {
  const result = await build({
    root: WEB,
    configFile: join(WEB, 'vite.config.ts'),
    mode: 'production',
    logLevel: 'silent',
    build: {
      write: false,
      rolldownOptions: { input: join(WEB, 'src/styles/app.css') },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const stylesheets = outputs.flatMap((output) =>
    'output' in output
      ? output.output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'))
      : [],
  );
  const [stylesheet] = stylesheets;
  if (stylesheets.length !== 1 || stylesheet?.type !== 'asset') {
    throw new Error(`app.css built into ${stylesheets.length} stylesheets, expected 1`);
  }
  return typeof stylesheet.source === 'string'
    ? stylesheet.source
    : new TextDecoder().decode(stylesheet.source);
}

let css = '';

beforeAll(async () => {
  css = await buildWebStylesheet();
}, 60_000);

describe('web stylesheet sources', () => {
  test.each(SOURCES)('has a class only $source uses: $className', ({ source, className }) => {
    // The class proves this source was scanned only if no other source uses it.
    expect(sourcesUsing(className)).toEqual([source]);
    expect(css).toContain(selectorOf(className));
  });
});
