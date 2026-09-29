/**
 * Engraving fonts (RENDER_PLAYBACK_PORTS.md §2.8), offline.
 *
 * VexFlow 5 draws music glyphs as SMuFL text and measures them with a canvas,
 * so layout needs the real fonts before anything is engraved. The
 * `vexflow/bravura` entry point embeds Bravura (music) and Academico (text,
 * regular and bold) as base64 WOFF2 `data:` URLs and registers them with the
 * CSS Font Loading API when it is imported; nothing is fetched from a CDN
 * (VexFlow only uses its jsDelivr `Font.HOST_URL` when a font is loaded by
 * name without a URL, which this adapter never does). The host page's CSP
 * must allow `font-src data:`.
 */
import 'vexflow/bravura';

/** CSS font shorthands of every face the adapter draws or measures with. */
const REQUIRED_FACES = ['30pt Bravura', '12pt Academico', 'bold 12pt Academico'] as const;

/**
 * Resolves once the bundled fonts are loaded in this document; rejects when
 * the Font Loading API is missing or a face fails to load or is absent.
 */
export async function loadBundledFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    throw new Error('The CSS Font Loading API is not available; engraving fonts cannot load.');
  }
  const loaded = await Promise.all(REQUIRED_FACES.map((face) => document.fonts.load(face)));
  if (loaded.some((faces) => faces.length === 0)) {
    throw new Error('A bundled engraving font is not registered in this document.');
  }
}
