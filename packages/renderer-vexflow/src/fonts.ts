/**
 * Engraving fonts (RENDER_PLAYBACK_PORTS.md §2.8), offline and outside any
 * host CSP.
 *
 * VexFlow 5 draws music glyphs as SMuFL text and measures them with a canvas,
 * so layout needs the real fonts before anything is engraved. The adapter
 * ships Bravura (music) and Academico (text, regular and bold) in
 * `./font-data`: byte for byte the WOFF2 files VexFlow 5 embeds (SIL OFL 1.1),
 * and registers them from their bytes with the CSS Font Loading API. A
 * `FontFace` built from bytes is fetched from nowhere, so neither the network
 * nor the host page's `font-src` is involved. VexFlow's own `vexflow/bravura`
 * entry registers `url(data:...)` sources instead, which a `font-src` without
 * `data:` blocks (ChatGPT's widget sandbox: no notation at all); the adapter
 * imports `vexflow/core`, which registers nothing.
 */
import { VexFlow } from 'vexflow/core';
import { ACADEMICO_BOLD_WOFF2, ACADEMICO_REGULAR_WOFF2 } from './font-data/academico';
import { BRAVURA_WOFF2 } from './font-data/bravura';

const MUSIC_FAMILY = 'Bravura';
const TEXT_FAMILY = 'Academico';

// The families VexFlow draws and measures with are exactly the ones registered below.
VexFlow.setFonts(MUSIC_FAMILY, TEXT_FAMILY);

/** The faces to register, with the descriptors VexFlow's own entry gives them. */
const BUNDLED_FACES: readonly {
  readonly family: string;
  readonly woff2Base64: string;
  readonly descriptors: FontFaceDescriptors;
}[] = [
  { family: MUSIC_FAMILY, woff2Base64: BRAVURA_WOFF2, descriptors: { display: 'block' } },
  { family: TEXT_FAMILY, woff2Base64: ACADEMICO_REGULAR_WOFF2, descriptors: { display: 'swap' } },
  {
    family: TEXT_FAMILY,
    woff2Base64: ACADEMICO_BOLD_WOFF2,
    descriptors: { display: 'swap', weight: 'bold' },
  },
];

/** CSS font shorthands of every face the adapter draws or measures with. */
const REQUIRED_FACES = [
  `30pt ${MUSIC_FAMILY}`,
  `12pt ${TEXT_FAMILY}`,
  `bold 12pt ${TEXT_FAMILY}`,
] as const;

/** The faces added to this module's document, created on first use (once per document). */
let registered: readonly FontFace[] | undefined;

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function registerBundledFaces(fonts: FontFaceSet): readonly FontFace[] {
  registered ??= BUNDLED_FACES.map(({ family, woff2Base64, descriptors }) => {
    const face = new FontFace(family, decodeBase64(woff2Base64), descriptors);
    fonts.add(face);
    return face;
  });
  return registered;
}

/**
 * Resolves once the bundled fonts are loaded in this document; rejects when
 * the Font Loading API is missing or a face fails to load or is absent.
 */
export async function loadBundledFonts(): Promise<void> {
  if (
    typeof document === 'undefined' ||
    !('fonts' in document) ||
    typeof FontFace === 'undefined'
  ) {
    throw new Error('The CSS Font Loading API is not available; engraving fonts cannot load.');
  }
  await Promise.all(registerBundledFaces(document.fonts).map((face) => face.load()));
  const loaded = await Promise.all(REQUIRED_FACES.map((face) => document.fonts.load(face)));
  if (loaded.some((faces) => faces.length === 0)) {
    throw new Error('A bundled engraving font is not registered in this document.');
  }
}
