// @vitest-environment jsdom
/**
 * REN-04: the bundled engraving fonts load whatever the host's `font-src`,
 * in jsdom with the CSS Font Loading API emulated as ChatGPT's widget sandbox
 * behaves (RENDER_PLAYBACK_PORTS.md §2.8; REN-I03 checks the real sandbox
 * CSP in Chromium).
 *
 * The minimal trigger of the 2026-10-02 production failure: a face whose
 * source is a CSS `url(...)` (VexFlow's embedded `url(data:...)` fonts) is
 * fetched under `font-src`, which allows no `data:` there, so it errors with
 * a NetworkError; `document.fonts.load` then rejects for its family and every
 * render failed with RENDER_FAILED. A face built from bytes is fetched from
 * nowhere. The adapter must register Bravura and Academico (regular, bold)
 * from their WOFF2 bytes, once per document, and engrave the ChatGPT drafts
 * with its default font loader (REN-05 checks the vendored bytes).
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import {
  CHATGPT_STELLA_16,
  CHATGPT_STELLA_REHARM_A,
  CHATGPT_STELLA_REHARM_B,
  parseFixture,
} from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type RendererModule = typeof import('../src');
type SupportModule = typeof import('./support');

/** What a face was built from: CSS `url(...)` text, or bytes (named by their signature). */
function sourceKind(source: string | BufferSource): string {
  if (typeof source === 'string') {
    return source.startsWith('url(data:') ? 'url(data:)' : 'css text';
  }
  const bytes =
    source instanceof ArrayBuffer
      ? new Uint8Array(source, 0, 4)
      : new Uint8Array(source.buffer, source.byteOffset, 4);
  return `${String.fromCharCode(...bytes)} bytes`;
}

/**
 * A FontFace as Chromium treats it in the sandbox: a CSS source is fetched
 * under `font-src`, which blocks it (no `data:`, and jsdom fetches nothing);
 * WOFF2 bytes load without a fetch.
 */
class SandboxFontFace {
  static readonly created: SandboxFontFace[] = [];
  status: FontFaceLoadStatus = 'unloaded';
  readonly weight: string;
  private loading: Promise<SandboxFontFace> | undefined;

  constructor(
    readonly family: string,
    readonly source: string | BufferSource,
    descriptors: FontFaceDescriptors = {},
  ) {
    this.weight = descriptors.weight ?? 'normal';
    SandboxFontFace.created.push(this);
  }

  load(): Promise<SandboxFontFace> {
    this.loading ??=
      sourceKind(this.source) === 'wOF2 bytes'
        ? Promise.resolve(this)
        : Promise.reject(
            new DOMException(
              'A network error occurred.',
              typeof this.source === 'string' ? 'NetworkError' : 'SyntaxError',
            ),
          );
    this.loading.then(
      () => (this.status = 'loaded'),
      () => (this.status = 'error'),
    );
    return this.loading;
  }
}

/**
 * `document.fonts` as Chromium answers `load(font)`: it loads the faces of
 * the font's family and rejects when one of them fails (an errored face
 * spoils its family), else resolves with the faces of the requested weight.
 */
class SandboxFontFaceSet {
  readonly faces = new Set<SandboxFontFace>();

  add(face: SandboxFontFace): this {
    this.faces.add(face);
    return this;
  }

  has(face: SandboxFontFace): boolean {
    return this.faces.has(face);
  }

  async load(font: string): Promise<SandboxFontFace[]> {
    const family = font.split(' ').at(-1);
    const weight = font.startsWith('bold ') ? 'bold' : 'normal';
    const ofFamily = [...this.faces].filter((face) => face.family === family);
    await Promise.all(ofFamily.map((face) => face.load()));
    return ofFamily.filter((face) => face.weight === weight);
  }
}

let renderer: RendererModule;
let support: SupportModule;

beforeAll(async () => {
  // Before the adapter is evaluated: an entry that registers fonts on import
  // (VexFlow's `vexflow/bravura`) must meet the sandbox's Font Loading API.
  vi.stubGlobal('FontFace', SandboxFontFace);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: new SandboxFontFaceSet(),
  });
  support = await import('./support');
  renderer = await import('../src');
  support.installJsdomLayoutStubs();
});

afterAll(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
});

describe('REN-04 bundled fonts under a font-src without data:', () => {
  it('registers Bravura and Academico (regular, bold) from their WOFF2 bytes, once per document', async () => {
    await renderer.loadBundledFonts();
    await renderer.loadBundledFonts();

    expect(
      SandboxFontFace.created.map((face) => [face.family, face.weight, sourceKind(face.source)]),
    ).toEqual([
      ['Bravura', 'normal', 'wOF2 bytes'],
      ['Academico', 'normal', 'wOF2 bytes'],
      ['Academico', 'bold', 'wOF2 bytes'],
    ]);
    expect(SandboxFontFace.created.map((face) => face.status)).toEqual([
      'loaded',
      'loaded',
      'loaded',
    ]);
  });

  it.each<{ name: string; input: ScoreSpecInput }>([
    { name: 'CHATGPT_STELLA_16', input: CHATGPT_STELLA_16 },
    { name: 'CHATGPT_STELLA_REHARM_A', input: CHATGPT_STELLA_REHARM_A },
    { name: 'CHATGPT_STELLA_REHARM_B', input: CHATGPT_STELLA_REHARM_B },
  ])('engraves the ChatGPT draft $name with the default font loader', async ({ input }) => {
    const score = parseFixture(input);
    const target = support.mountTarget();
    const engraver = renderer.createVexFlowRendererFactory()();
    try {
      const { layoutMap } = await engraver.render(score, target, support.OPTIONS);

      const writtenNoteIds = score.staves
        .flatMap((staff) => staff.measures)
        .flatMap((measure) => measure.voices)
        .flatMap((lane) => lane.events)
        .flatMap((event) => {
          switch (event.type) {
            case 'note':
              return [event.id];
            case 'chord':
              return event.notes.map((written) => written.id);
            default:
              return [];
          }
        });
      expect([...layoutMap.notes.keys()].sort()).toEqual(writtenNoteIds.sort());
    } finally {
      engraver.destroy();
      target.remove();
    }
  });
});
