// @vitest-environment jsdom
/**
 * REN-05: the fonts the adapter vendors (src/font-data, written by
 * scripts/vendor-fonts.mjs) are byte for byte the ones the pinned VexFlow
 * ships, whose glyph metrics and layout defaults are tuned for them. Read
 * through VexFlow's public `vexflow/bravura` entry: it registers each font as
 * a `FontFace` with a `url(data:font/woff2;...;base64,...)` source, recorded
 * here. After a VexFlow upgrade this fails until the script is run again.
 */
import { beforeAll, expect, it, vi } from 'vitest';
import { ACADEMICO_BOLD_WOFF2, ACADEMICO_REGULAR_WOFF2 } from '../src/font-data/academico';
import { BRAVURA_WOFF2 } from '../src/font-data/bravura';

const WOFF2_DATA_URL = 'url(data:font/woff2;charset=utf-8;base64,';

/** The source of each face VexFlow registers, by "family weight". */
const registered = new Map<string, string>();

class RecordingFontFace {
  constructor(family: string, source: string, descriptors: FontFaceDescriptors = {}) {
    registered.set(`${family} ${descriptors.weight ?? 'normal'}`, source);
  }

  load(): Promise<this> {
    return Promise.resolve(this);
  }
}

beforeAll(async () => {
  vi.stubGlobal('FontFace', RecordingFontFace);
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: () => undefined } });
  await import('vexflow/bravura');
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
});

it.each([
  { face: 'Bravura normal', vendored: BRAVURA_WOFF2 },
  { face: 'Academico normal', vendored: ACADEMICO_REGULAR_WOFF2 },
  { face: 'Academico bold', vendored: ACADEMICO_BOLD_WOFF2 },
])('REN-05 vendors $face byte for byte as the pinned VexFlow ships it', ({ face, vendored }) => {
  const source = registered.get(face) ?? '';
  const upstream = source.startsWith(WOFF2_DATA_URL)
    ? source.slice(WOFF2_DATA_URL.length, source.lastIndexOf(')'))
    : source;

  // Compared as a summary: a failing diff of two 300 kB base64 strings is unreadable.
  expect({ base64Length: upstream.length, identical: upstream === vendored }).toEqual({
    base64Length: vendored.length,
    identical: true,
  });
});
