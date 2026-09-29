/**
 * The piano SoundFont asset (#23): its identity, license and required
 * notices, and where an app publishes it. The data is
 * assets/soundfonts/piano/manifest.json; docs/assets/SOUNDFONT.md records why
 * this asset was chosen.
 */
import manifestJson from '../../../assets/soundfonts/piano/manifest.json';

export interface SoundFontAssetManifest {
  /** SoundFont file name, relative to the manifest's directory. */
  readonly file: string;
  readonly format: string;
  readonly sizeBytes: number;
  /** Lowercase hex SHA-256 of the SoundFont file. */
  readonly sha256: string;
  /** The one preset the file holds. */
  readonly preset: {
    readonly bankMSB: number;
    readonly bankLSB: number;
    readonly program: number;
    readonly name: string;
  };
  /** The upstream file the asset was extracted from. */
  readonly source: {
    readonly name: string;
    readonly version: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly url: string;
    readonly provenance: string;
  };
  readonly license: {
    readonly spdx: string;
    /** Full upstream license text, unchanged, relative to the manifest's directory. */
    readonly file: string;
    readonly sha256: string;
    readonly url: string;
    /** Notice file, relative to the manifest's directory. */
    readonly notice: string;
  };
  /** Lines the license requires in every copy; each must appear in the license, the notice and `attribution`. */
  readonly requiredNotices: readonly string[];
  /** Text the app shows to credit the sound. */
  readonly attribution: string;
  readonly extraction: {
    readonly script: string;
    readonly command: string;
    readonly tool: string;
  };
}

export const PIANO_SOUNDFONT: SoundFontAssetManifest = manifestJson;

/** Repository directory holding the SoundFont, its manifest, license and notice. */
export const PIANO_SOUNDFONT_DIRECTORY = 'assets/soundfonts/piano';

/**
 * Absolute URL of a file of the piano asset directory once an app publishes
 * it under `assetBaseUrl`, which is read as a directory. Defaults to the
 * SoundFont itself.
 */
export function resolvePianoAssetUrl(
  assetBaseUrl: string,
  file: string = PIANO_SOUNDFONT.file,
): string {
  if (!URL.canParse(assetBaseUrl)) {
    throw new TypeError(`Asset base URL must be an absolute URL, got "${assetBaseUrl}"`);
  }
  const base = new URL(assetBaseUrl);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(file, base).href;
}

/** Reads a file of the asset directory by its manifest-relative path; `undefined` when absent. */
export type AssetFileReader = (path: string) => Promise<Uint8Array<ArrayBuffer> | undefined>;

/**
 * Checks an asset directory against its manifest: the SoundFont, license and
 * notice files exist, the SoundFont and license bytes match their recorded
 * size and SHA-256, and every required notice appears in the license, the
 * notice and the attribution. Returns one message per problem, empty when
 * the asset is complete.
 */
export async function checkSoundFontAsset(
  manifest: SoundFontAssetManifest,
  readFile: AssetFileReader,
): Promise<string[]> {
  const problems: string[] = [];

  const soundFont = await readFile(manifest.file);
  if (soundFont === undefined) {
    problems.push(`SoundFont file "${manifest.file}" is missing`);
  } else if (soundFont.byteLength !== manifest.sizeBytes) {
    problems.push(
      `SoundFont file "${manifest.file}" is ${soundFont.byteLength} bytes, manifest says ${manifest.sizeBytes}`,
    );
  } else {
    const digest = await sha256Hex(soundFont);
    if (digest !== manifest.sha256) {
      problems.push(
        `SoundFont file "${manifest.file}" has SHA-256 ${digest}, manifest says ${manifest.sha256}`,
      );
    }
  }

  const license = await readFile(manifest.license.file);
  if (license === undefined) {
    problems.push(`License file "${manifest.license.file}" is missing`);
  } else {
    const digest = await sha256Hex(license);
    if (digest !== manifest.license.sha256) {
      problems.push(
        `License file "${manifest.license.file}" has SHA-256 ${digest}, manifest says ${manifest.license.sha256}`,
      );
    }
    problems.push(...missingNotices(`License file "${manifest.license.file}"`, license, manifest));
  }

  const notice = await readFile(manifest.license.notice);
  if (notice === undefined) {
    problems.push(`Notice file "${manifest.license.notice}" is missing`);
  } else {
    problems.push(...missingNotices(`Notice file "${manifest.license.notice}"`, notice, manifest));
  }

  problems.push(...missingNotices('Attribution', manifest.attribution, manifest));
  return problems;
}

function missingNotices(
  where: string,
  content: Uint8Array | string,
  manifest: SoundFontAssetManifest,
): string[] {
  const text = collapseWhitespace(
    typeof content === 'string' ? content : new TextDecoder().decode(content),
  );
  return manifest.requiredNotices
    .filter((line) => !text.includes(collapseWhitespace(line)))
    .map((line) => `${where} lacks required notice "${line}"`);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
