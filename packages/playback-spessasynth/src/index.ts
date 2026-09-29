/**
 * @sheet-music/playback-spessasynth
 *
 * SpessaSynth adapter implementing the playback-core engine port. The only package
 * allowed to import SpessaSynth (ADR-004). Policy: docs/architecture/PLAYBACK_POLICY_V1.md §7.
 * The piano SoundFont asset (#23): docs/assets/SOUNDFONT.md.
 */
export { createSpessaSynthEngine } from './engine';
export {
  type AssetFileReader,
  type SoundFontAssetManifest,
  PIANO_SOUNDFONT,
  PIANO_SOUNDFONT_DIRECTORY,
  checkSoundFontAsset,
  resolvePianoAssetUrl,
} from './asset-manifest';
export { SPESSASYNTH_PROCESSOR_URL } from './worklet-url';
