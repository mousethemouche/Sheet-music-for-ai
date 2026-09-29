# Piano SoundFont

Issue #23 (US-B1). Which piano sound the app plays, why it may be shipped in
a commercial product, what the license requires, and what was measured.
The asset lives outside ScoreSpec and is replaceable: the adapter takes a URL
(RENDER_PLAYBACK_PORTS.md §4.6), and everything about the asset is recorded in
[`assets/soundfonts/piano/manifest.json`](../../assets/soundfonts/piano/manifest.json).

## 1. Decision

The app ships preset 000:000 **"Grand Piano"** of **MS Basic** v0.2.0, the
default SoundFont of MuseScore Studio 4, extracted unchanged into a one-preset
SF3 file.

| Field               | Value                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File                | `assets/soundfonts/piano/ms-basic-grand-piano.sf3`                                                                                                                                                                                 |
| Format              | SF3 (SoundFont 2 structure, Ogg Vorbis samples)                                                                                                                                                                                    |
| Size                | 9,182,098 bytes (8.76 MiB)                                                                                                                                                                                                         |
| SHA-256             | `c8168330092e0e808a0927943400f4a3d7204a1e063b204c4869477ec872bc1d`                                                                                                                                                                 |
| Preset              | bank MSB 0, bank LSB 0, program 0, "Grand Piano"                                                                                                                                                                                   |
| Contents            | 1 preset, 4 instruments (Piano MF-low, MF-high, FF-low, FF-high), 144 mono 44.1 kHz samples (left and right channels stored as separate samples)                                                                                   |
| Source file         | `MS Basic.sf3` v0.2.0, 51,278,610 bytes, SHA-256 `5ea2375e8bd7d8e71def1036978c1621e85b66934169b6a2744b27b9b3c2d99c`                                                                                                                |
| Source location     | [`share/sound/MS Basic.sf3`](https://github.com/musescore/MuseScore/tree/25f0d24530ad7e10243b4671519c9168fc83a545/share/sound) of `musescore/MuseScore` at commit `25f0d245…`, git blob `5be56b2fafa5eee347256cbe0d2fbfacd01702b6` |
| Copy actually used  | installed by MuseScore Studio 4.6.5 for macOS (`/Applications/MuseScore 4.app/Contents/Resources/sound/MS Basic.sf3`), byte-identical to that blob                                                                                 |
| License             | MIT, full text in `assets/soundfonts/piano/LICENSE.txt` (upstream `MS Basic_License.md`, SHA-256 `9486e6ba…f19d4`, unchanged)                                                                                                      |
| Notices             | `assets/soundfonts/piano/NOTICE.txt`, `requiredNotices` and `attribution` in the manifest                                                                                                                                          |
| Extraction          | `node assets/soundfonts/piano/scripts/extract-grand-piano.mjs "<path to MS Basic.sf3>"` with spessasynth_core 4.3.22                                                                                                               |
| Pinned download URL | `https://raw.githubusercontent.com/musescore/MuseScore/25f0d24530ad7e10243b4671519c9168fc83a545/share/sound/MS%20Basic.sf3`                                                                                                        |

Why this one:

- **Rights.** The SoundFont is MIT-licensed by its authors, which allows
  commercial use, modification and redistribution with the copyright and
  permission notice. Its piano samples are recorded upstream as public domain
  (§2).
- **Quality.** A sampled Steinway Model D with two velocity layers (MF for
  velocities 3-107, FF for 108-127) in stereo. The MS Basic changelog
  describes it as the high-quality replacement of the older FluidR3Mono
  pianos. The human listening review is still pending (§5).
- **Size and tooling.** The upstream samples are already Ogg Vorbis, so the
  extraction copies them byte for byte: no decoding, no re-encoding, no new
  dependency (spessasynth_core can decode Vorbis but has no encoder). The
  extracted file is 17.9% of the source.

The file is larger than the "a few MB" target: 8.76 MiB. Every byte belongs
to the one preset (4 instruments referenced by its 14 zones), so a smaller
file means changing the instrument (§4, fallbacks). The candidates that are
smaller today either have an unclear sample license or need re-encoding
(§3).

## 2. Legal evidence

Read from primary sources on 2026-09-28. This is a record of what the source
terms say, not legal advice; the residual risk below should be seen by the
product owner before the first commercial release.

1. **License file.** `share/sound/MS Basic_License.md` at the pinned commit
   (identical to the file installed next to `MS Basic.sf3` by MuseScore Studio
   4.6.5) says the SoundFont "is shared under the MIT license as described in
   COPYING, as was FluidR3Mono and FluidR3 before it", reproduces the MIT
   permission notice, and requires that "the acknowledgements and copyright
   notices above must be included in any derivative work". It is copied
   unchanged to `LICENSE.txt`.
2. **The file's own INFO chunk** (kept in the extracted file): comment
   "Released under the MIT license", copyright "Frank Wen 2000-02, Michael
   Cowgill 2014-17, S. Christian Collins 2018-20".
3. **Provenance of the file.** `share/sound/CMakeLists.txt` installs
   `MS Basic.sf3` and `MS Basic_License.md` side by side. The MuseScore
   application code is GPL-3.0, but the SoundFont carries its own license
   file from its authors; the GPL of the application is not relied on. The
   local copy's git blob hash equals the repository blob, so the provenance
   of the bytes used is proven, not assumed.
4. **Piano samples.** `MuseScore_General_Sample_Sources.csv` (MuseScore_General
   v0.2, from the upstream distribution at
   `ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/`) lists
   000:000 Grand Piano as the AKAI S5000 "Splendid Grand" (Steinway Model D,
   close-mic), "Samples: AKAI, edited by S. Christian Collins", "Original
   License: Public Domain (confirmed via AKAI rep.)". `MS_Basic_Changelog.md`
   adds that the author verified the public domain status "via conversation
   with AKAI in 2007". The same samples are published as public domain by
   [sfzinstruments/SplendidGrandPiano](https://github.com/sfzinstruments/SplendidGrandPiano)
   ("released as public domain in early 2000 by Akai company").
5. **Synth code license.** spessasynth_core and spessasynth_lib are
   Apache-2.0. That covers the synthesizer code only, not this asset.

Obligations:

- Ship `LICENSE.txt` and `NOTICE.txt` wherever the `.sf3` is published (same
  asset base URL, unchanged names), since the file is a copy of a substantial
  portion of the MIT-licensed work.
- Show the manifest's `attribution` text in the app's credits and link it to
  the published `LICENSE.txt`. It contains every line of
  `requiredNotices` (the upstream acknowledgements and copyright notices),
  including the two (Temple Blocks, Drumline Cymbals) whose instruments are not
  in the extracted file, because the license asks for all of them in any
  derivative work.
- Name MuseScore only as the factual source of the sound; nothing may suggest
  endorsement by MuseScore.

Residual risk: the public-domain status of the AKAI samples rests on the
upstream author's report of AKAI's confirmation and on community
redistributions; no primary AKAI document was found (the musescore.org and
musical-artifacts.com pages about it refused automated access). The CC0 Upright
Piano KW (§3) is the fallback if that is judged insufficient.

## 3. Candidates considered

| Candidate                                          | License (primary source)                                                            | Outcome                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MS Basic 000:000 Grand Piano, extracted            | MIT (`MS Basic_License.md`); samples recorded as public domain                      | **Selected.**                                                                                                                                                                                                                                    |
| MS Basic, whole file                               | same                                                                                | Rejected: 51.3 MB and 309 presets for one piano.                                                                                                                                                                                                 |
| MuseScore_General.sf3 v0.2 (38 MB, osuosl mirror)  | MIT (`MuseScore_General_License.md`, same text)                                     | Rejected: same authors, license and piano samples; an extra download for no gain over the verified MS Basic copy.                                                                                                                                |
| FluidR3Mono_GM.sf3 (MuseScore repository, 23.7 MB) | MIT (`FluidR3Mono_License.md`)                                                      | Not selected: the MS Basic changelog replaced its pianos with the Splendid Grand ones for quality and kept them only in a low-memory variant. Not downloaded or measured; fallback if size wins over quality.                                    |
| FluidR3_GM.sf2 (Frank Wen)                         | MIT                                                                                 | Rejected: PCM SF2 (no Vorbis encoder in the toolchain) and the older piano above.                                                                                                                                                                |
| GeneralUser GS v2.0.3 (S. Christian Collins)       | custom "License v2.0" in `documentation/LICENSE.txt` of `mrbumpy409/GeneralUser-GS` | Rejected: the license itself says the author "cannot be 100% sure where all of the samples originated" and that "this uncertainty may concern you if you intend to use GeneralUser GS in a commercial software product". Also a 32.3 MB PCM SF2. |
| Salamander Grand Piano V3 (Alexander Holm)         | CC BY 3.0 (FreePats page)                                                           | Rejected for now: clean license, but the SF2 download is 296 MiB of PCM; a few-MB version needs resampling, fewer velocity layers and a Vorbis encoder.                                                                                          |
| YDP Grand Piano (FreePats, Zenph Studios samples)  | CC BY 3.0 (FreePats page)                                                           | Rejected: PCM SF2 (36 MiB archive), same encoder problem.                                                                                                                                                                                        |
| Upright Piano KW (FreePats, Kawai upright)         | CC0 1.0 (FreePats page)                                                             | Not selected: an upright rather than a grand, SF2 only as PCM (the "small" SF2 is a 5.8 MiB 7z archive; unpacked size not measured). Cleanest license: first fallback if the AKAI sample provenance is judged too weak.                          |

## 4. Measured observations

Node 24.6.0 on an Apple M1, spessasynth_core 4.3.22. Browser loading is
ASSET-02 and not measured here.

| Observation                                                     | Result                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transfer size                                                   | 9,182,098 bytes; gzip -9: 8,914,557 (-2.9%); brotli -q 11: 8,533,084 (-7.1%). The Vorbis data barely compresses.                                                                                                 |
| Parse (`SoundBankLoader.fromArrayBuffer`)                       | 23-25 ms in a fresh process (3 runs), 3-6 ms warm. 1 preset found, bank 0 program 0.                                                                                                                             |
| Decode (spessasynth decodes a sample the first time it is read) | the 72 samples reachable from C3-C6: ~440 ms, 90.4 MB of Float32 PCM; all 144 samples: ~0.9 s, 200.7 MB (samples last 1.8 to 14.4 s).                                                                            |
| Equivalence with the source                                     | 33 notes over A0-C8 at velocities 30/80/120 plus a pedalled chord, rendered by `SpessaSynthProcessor` at 44.1 kHz with effects off and on: bit-identical output from `MS Basic.sf3` and from the extracted file. |
| Reproducibility                                                 | two runs of the script on two copies of the source: same SHA-256 `c8168330…bc1d`.                                                                                                                                |

Decoded memory is the notable cost: a piece spanning three octaves at both
dynamics holds about 90 MB of PCM in the synthesizer. If the ASSET-03 review
or #6 finds the load or memory unacceptable, the fallbacks in order are:

1. the same piano with only the MF layer (measured: 4.87 MB of Vorbis data,
   106 MB decoded at most), which changes the preset's velocity mapping and
   must then be listed as a modification in `NOTICE.txt`;
2. the FluidR3Mono piano (same MIT license and notices);
3. Upright Piano KW (CC0), if the sample provenance is the concern.

## 5. Acceptance status

| Check                              | Status                                                                                                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ASSET-01 manifest/build            | `packages/playback-spessasynth/test/asset-01.test.ts` (unit): manifest, size, SHA-256, license and notice files, resolver, and clear failures on a temporary copy with a missing file, wrong path or dropped notice. |
| ASSET-02 real loading              | Pending: MCP-UI-01 (#11) loads this file through #6's engine in the built View; this issue provides the file and `resolvePianoAssetUrl`.                                                                             |
| ASSET-03 listening and load review | **Pending human review.** Not done by the agents that selected the asset and integrated the engine: it needs a person listening. Until it is recorded here, #23 and the #6 sound policy are not fully accepted.      |

ASSET-03 review, to record here (date, reviewer, browser, device), in
Chromium with the real engine (for example the web app's player once #15 is
wired, or the SpessaSynth engine check of
`packages/playback-spessasynth/test/spessasynth-engine.mcpui.test.ts` run
headed):

- Play one slow and one fast fixture score at the default tempo: attack,
  sustain and release sound like a piano; no clicks, no missing or detuned
  notes across the range; soft and loud notes are distinguishable.
- Paired slurred/unmarked check (#6 sound policy): F08 bar 1 (slurred C4-F4,
  gate 1/1) against bar 2 (the same notes unmarked, gate 9/10): bar 1 sounds
  connected, bar 2 detached, both with distinct attacks.
- A C3-C6 passage: even loudness and timbre across the range.
- Note the time from the first Play to the first sound on a cold cache, and
  the tab's memory after playing a full-range piece.

## 6. Using and replacing the asset

- The root of `@sheet-music/playback-spessasynth` (from
  `src/asset-manifest.ts`) exports the typed manifest (`PIANO_SOUNDFONT`,
  whose `attribution` is the credit text the app shows), the repository
  directory (`PIANO_SOUNDFONT_DIRECTORY`),
  `resolvePianoAssetUrl(assetBaseUrl, file?)`, which reads the base URL as a
  directory and returns the absolute URL for
  `PlaybackAssetConfig.soundFont.url`, and `checkSoundFontAsset(manifest,
readFile)`, which a build can run on the files it publishes. It also exports
  `SPESSASYNTH_PROCESSOR_URL`, the pinned worklet processor for
  `workletModuleUrl` (PLAYBACK_POLICY_V1.md §7).
- Apps (#11, #15, #16) publish `ms-basic-grand-piano.sf3`, `LICENSE.txt` and
  `NOTICE.txt` together under their asset base URL. The file content is fixed
  by its SHA-256, so it can be served with a long immutable cache lifetime.
- To regenerate: get `MS Basic.sf3` from a MuseScore Studio 4 installation or
  the pinned URL above (the script checks its SHA-256 and the
  spessasynth_core version) and run the extraction command from the
  repository root. It overwrites the `.sf3` and prints its size and SHA-256.
- To replace the asset: put the new file, its license and notice in
  `assets/soundfonts/piano/`, update `manifest.json`, and rewrite §1-§5 of this
  page. ASSET-01 fails until the recorded hash, license and notices match the
  files.
