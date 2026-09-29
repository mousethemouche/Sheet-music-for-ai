#!/usr/bin/env node
/**
 * Extracts preset 000:000 "Grand Piano" from MuseScore's "MS Basic.sf3"
 * (v0.2.0) into a one-preset SF3 file, keeping every sample's original Ogg
 * Vorbis data byte for byte (no decoding, no re-encoding).
 *
 * Usage (from the repository root):
 *   node assets/soundfonts/piano/scripts/extract-grand-piano.mjs "<path to MS Basic.sf3>"
 *
 * The source must be the exact upstream file (its SHA-256 is checked); see
 * docs/assets/SOUNDFONT.md for where to get it. The output is written next to
 * manifest.json and is reproducible: the same source and the same
 * spessasynth_core version give the same bytes.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_SHA256 = '5ea2375e8bd7d8e71def1036978c1621e85b66934169b6a2744b27b9b3c2d99c';
const SPESSASYNTH_CORE_VERSION = '4.3.22';
const PATCH = { bankMSB: 0, bankLSB: 0, program: 0, name: 'Grand Piano' };
const OUTPUT_NAME = 'ms-basic-grand-piano.sf3';

const here = dirname(fileURLToPath(import.meta.url));
const assetDir = join(here, '..');
const repoRoot = join(assetDir, '..', '..', '..');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fail(message) {
  console.error(`extract-grand-piano: ${message}`);
  process.exit(1);
}

/** The pinned spessasynth_core, resolved from the adapter package that declares it. */
async function loadSpessaSynthCore() {
  const adapterManifest = join(repoRoot, 'packages', 'playback-spessasynth', 'package.json');
  const require = createRequire(adapterManifest);
  const entry = require.resolve('spessasynth_core');
  const packageJson = JSON.parse(readFileSync(join(dirname(entry), '..', 'package.json'), 'utf8'));
  if (packageJson.version !== SPESSASYNTH_CORE_VERSION) {
    fail(`expected spessasynth_core ${SPESSASYNTH_CORE_VERSION}, found ${packageJson.version}`);
  }
  return import(pathToFileURL(entry).href);
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function isGrandPiano(preset) {
  return (
    !preset.isGMGSDrum &&
    preset.bankMSB === PATCH.bankMSB &&
    preset.bankLSB === PATCH.bankLSB &&
    preset.program === PATCH.program
  );
}

function uniqueSamples(preset) {
  const samples = new Set();
  for (const zone of preset.zones) {
    for (const instrumentZone of zone.instrument.zones) samples.add(instrumentZone.sample);
  }
  return [...samples];
}

const sourcePath = process.argv[2];
if (!sourcePath) fail('usage: extract-grand-piano.mjs "<path to MS Basic.sf3>"');

const sourceBytes = readFileSync(sourcePath);
if (sha256(sourceBytes) !== SOURCE_SHA256) {
  fail(`${sourcePath} is not MS Basic.sf3 v0.2.0 (SHA-256 ${SOURCE_SHA256})`);
}

const { BasicSoundBank, SoundBankLoader } = await loadSpessaSynthCore();
const source = SoundBankLoader.fromArrayBuffer(toArrayBuffer(sourceBytes));
const sourcePreset = source.presets.find(isGrandPiano);
if (!sourcePreset || sourcePreset.name !== PATCH.name) {
  fail(`preset 000:000 "${PATCH.name}" not found in the source`);
}
const sourceSamples = uniqueSamples(sourcePreset);

const bank = new BasicSoundBank();
bank.soundBankInfo = {
  ...source.soundBankInfo,
  name: 'MS Basic Grand Piano',
  comment:
    'Preset 000:000 "Grand Piano" extracted unchanged from MuseScore\'s MS Basic.sf3 v0.2.0. ' +
    'Released under the MIT license; see LICENSE.md and NOTICE.md.',
};
bank.clonePreset(sourcePreset);
bank.flush();

// clonePreset merges samples and instruments by name: prove nothing was merged
// or decompressed on the way.
if (bank.samples.length !== sourceSamples.length) {
  fail(`expected ${sourceSamples.length} samples, cloned ${bank.samples.length}`);
}
if (!bank.samples.every((sample) => sample.isCompressed)) {
  fail('a sample lost its Ogg Vorbis data while cloning');
}

const output = new Uint8Array(
  bank.writeSF2({ software: `spessasynth_core ${SPESSASYNTH_CORE_VERSION}` }),
);
const outputPath = join(assetDir, OUTPUT_NAME);
writeFileSync(outputPath, output);

// Read the written file back as a player would.
const startedAt = performance.now();
const written = SoundBankLoader.fromArrayBuffer(toArrayBuffer(output));
const parseMs = performance.now() - startedAt;
const writtenPreset = written.presets.find(isGrandPiano);
if (written.presets.length !== 1 || !writtenPreset) {
  fail('the written file does not hold exactly the Grand Piano preset');
}

console.log(
  JSON.stringify(
    {
      file: basename(outputPath),
      sizeBytes: output.byteLength,
      sha256: sha256(output),
      presets: written.presets.length,
      instruments: written.instruments.length,
      samples: written.samples.length,
      parseMs: Math.round(parseMs * 10) / 10,
    },
    null,
    2,
  ),
);
