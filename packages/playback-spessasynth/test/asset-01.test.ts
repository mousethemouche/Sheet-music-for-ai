/**
 * ASSET-01 (#23): the selected piano SoundFont, its hash, license and required
 * notices are recorded and present; a missing file or notice, or a wrong
 * configured path, fails with a message naming it. The manifest API is
 * imported through the package root, as apps do.
 */
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkSoundFontAsset,
  PIANO_SOUNDFONT,
  PIANO_SOUNDFONT_DIRECTORY,
  resolvePianoAssetUrl,
  type AssetFileReader,
  type SoundFontAssetManifest,
} from '../src';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ASSET_DIR = join(REPO_ROOT, PIANO_SOUNDFONT_DIRECTORY);

function readerFor(dir: string): AssetFileReader {
  return async (path) => {
    try {
      return new Uint8Array(await readFile(join(dir, path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('ASSET-01 recorded piano asset', () => {
  it('the configured directory holds the manifest the adapter exports', async () => {
    const onDisk: unknown = JSON.parse(await readFile(join(ASSET_DIR, 'manifest.json'), 'utf8'));

    expect(onDisk).toEqual(PIANO_SOUNDFONT);
  });

  it('the SoundFont file has the recorded size and SHA-256', async () => {
    const bytes = await readFile(join(ASSET_DIR, PIANO_SOUNDFONT.file));

    expect(bytes.byteLength).toBe(PIANO_SOUNDFONT.sizeBytes);
    expect(sha256(bytes)).toBe(PIANO_SOUNDFONT.sha256);
  });

  it('the license file is the full MIT text and the notice file credits the authors', async () => {
    const license = await readFile(join(ASSET_DIR, PIANO_SOUNDFONT.license.file), 'utf8');
    const notice = await readFile(join(ASSET_DIR, PIANO_SOUNDFONT.license.notice), 'utf8');

    expect(PIANO_SOUNDFONT.license.spdx).toBe('MIT');
    expect(license).toContain('Permission is hereby granted, free of charge');
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(notice).toContain('Frank Wen');
    expect(notice).toContain('S. Christian Collins');
  });

  it('the checked-in asset directory passes the asset check', async () => {
    await expect(checkSoundFontAsset(PIANO_SOUNDFONT, readerFor(ASSET_DIR))).resolves.toEqual([]);
  });
});

describe('ASSET-01 configured URL', () => {
  it.each([
    {
      name: 'base with a trailing slash',
      base: 'https://cdn.example.test/assets/',
      file: undefined,
      expected: 'https://cdn.example.test/assets/ms-basic-grand-piano.sf3',
    },
    {
      name: 'base without a trailing slash is still a directory',
      base: 'https://cdn.example.test/assets',
      file: undefined,
      expected: 'https://cdn.example.test/assets/ms-basic-grand-piano.sf3',
    },
    {
      name: 'license published next to the SoundFont',
      base: 'https://app.example.test/mcp/view/',
      file: 'LICENSE.txt',
      expected: 'https://app.example.test/mcp/view/LICENSE.txt',
    },
  ])('$name', ({ base, file, expected }) => {
    expect(resolvePianoAssetUrl(base, file)).toBe(expected);
  });

  it('rejects a relative base URL, naming it', () => {
    expect(() => resolvePianoAssetUrl('assets/')).toThrow(
      'Asset base URL must be an absolute URL, got "assets/"',
    );
  });
});

describe('ASSET-01 incomplete asset directory (temporary copy)', () => {
  const temporaryDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
  });

  async function copyAssetDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'asset-01-'));
    temporaryDirs.push(dir);
    const files = [
      'manifest.json',
      PIANO_SOUNDFONT.file,
      PIANO_SOUNDFONT.license.file,
      PIANO_SOUNDFONT.license.notice,
    ];
    await Promise.all(files.map((file) => cp(join(ASSET_DIR, file), join(dir, file))));
    return dir;
  }

  async function editManifest(
    dir: string,
    edit: (manifest: SoundFontAssetManifest) => SoundFontAssetManifest,
  ): Promise<void> {
    const path = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8')) as SoundFontAssetManifest;
    await writeFile(path, JSON.stringify(edit(manifest)));
  }

  async function editText(path: string, edit: (text: string) => string): Promise<void> {
    await writeFile(path, edit(await readFile(path, 'utf8')));
  }

  const FRANK_WEN_NOTICE = 'FluidR3 (original version) by Frank Wen Copyright (c) 2000-02';

  it.each([
    {
      name: 'SoundFont file deleted',
      damage: (dir: string) => rm(join(dir, 'ms-basic-grand-piano.sf3')),
      expected: (): string[] => ['SoundFont file "ms-basic-grand-piano.sf3" is missing'],
    },
    {
      name: 'manifest points to a wrong SoundFont path',
      damage: (dir: string) => editManifest(dir, (m) => ({ ...m, file: 'piano.sf3' })),
      expected: (): string[] => ['SoundFont file "piano.sf3" is missing'],
    },
    {
      name: 'SoundFont file truncated',
      damage: (dir: string) => truncate(join(dir, 'ms-basic-grand-piano.sf3'), 1024),
      expected: (): string[] => [
        'SoundFont file "ms-basic-grand-piano.sf3" is 1024 bytes, manifest says 9182098',
      ],
    },
    {
      name: 'SoundFont bytes changed at the same size',
      damage: async (dir: string) => {
        const path = join(dir, 'ms-basic-grand-piano.sf3');
        const bytes = await readFile(path);
        bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 0xff;
        await writeFile(path, bytes);
      },
      expected: async (dir: string) => {
        const actual = sha256(await readFile(join(dir, 'ms-basic-grand-piano.sf3')));
        return [
          `SoundFont file "ms-basic-grand-piano.sf3" has SHA-256 ${actual}, manifest says ${PIANO_SOUNDFONT.sha256}`,
        ];
      },
    },
    {
      name: 'license file deleted',
      damage: (dir: string) => rm(join(dir, 'LICENSE.txt')),
      expected: (): string[] => ['License file "LICENSE.txt" is missing'],
    },
    {
      name: 'license text edited',
      damage: (dir: string) => editText(join(dir, 'LICENSE.txt'), (text) => `${text}\nExtra.\n`),
      expected: async (dir: string) => {
        const actual = sha256(await readFile(join(dir, 'LICENSE.txt')));
        return [
          `License file "LICENSE.txt" has SHA-256 ${actual}, manifest says ${PIANO_SOUNDFONT.license.sha256}`,
        ];
      },
    },
    {
      name: 'notice file deleted',
      damage: (dir: string) => rm(join(dir, 'NOTICE.txt')),
      expected: (): string[] => ['Notice file "NOTICE.txt" is missing'],
    },
    {
      name: 'required notice removed from the notice file',
      damage: (dir: string) =>
        editText(join(dir, 'NOTICE.txt'), (text) => text.replace(FRANK_WEN_NOTICE, '')),
      expected: (): string[] => [
        `Notice file "NOTICE.txt" lacks required notice "${FRANK_WEN_NOTICE}"`,
      ],
    },
    {
      name: 'required notice removed from the attribution',
      damage: (dir: string) =>
        editManifest(dir, (m) => ({
          ...m,
          attribution: m.attribution.replace(FRANK_WEN_NOTICE, 'FluidR3 by Frank Wen'),
        })),
      expected: (): string[] => [`Attribution lacks required notice "${FRANK_WEN_NOTICE}"`],
    },
  ])('$name fails clearly', async ({ damage, expected }) => {
    const dir = await copyAssetDir();
    await damage(dir);
    const manifest = JSON.parse(
      await readFile(join(dir, 'manifest.json'), 'utf8'),
    ) as SoundFontAssetManifest;

    const problems = await checkSoundFontAsset(manifest, readerFor(dir));

    expect(problems).toEqual(await expected(dir));
  });
});
