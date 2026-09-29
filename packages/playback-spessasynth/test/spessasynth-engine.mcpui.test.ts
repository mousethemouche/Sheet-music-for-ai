/**
 * Real adapter check (issue #6, shared with #23 ASSET-02 and hosted later by
 * MCP-UI-01): the pinned SpessaSynth worklet and the chosen piano SoundFont
 * load in Chromium without a gesture, sound after a real click, move the
 * position with the audio clock, stop, sound again, and release their audio
 * resources. Plus the adapter's own error mapping for assets that cannot
 * load. The output is only measured as a peak level (sounding or silent), no
 * waveform or audio-byte comparison.
 */
import { type PlaybackEngine, compilePlaybackPlan } from '@sheet-music/playback-core';
import { F01, parseFixture } from '@sheet-music/test-fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import soundFontPath from '../../../assets/soundfonts/piano/ms-basic-grand-piano.sf3?url';
import { SPESSASYNTH_PROCESSOR_URL, createSpessaSynthEngine } from '../src';

const absolute = (path: string): string => new URL(path, location.href).href;
// The worklet the package root hands to apps (resolved like an app would).
const workletModuleUrl = absolute(SPESSASYNTH_PROCESSOR_URL);
const soundFontUrl = absolute(soundFontPath);

/** Peak sample levels: a playing piano measured 0.009-0.05 here, its reverb tail < 0.001 after 200 ms. */
const AUDIBLE = 0.005;
const SILENT = 0.0005;

/** Peak level of the synthesizer's outputs, read through an analyser tapped onto its node. */
function tapSynthesizerOutput(connect: {
  mock: { calls: unknown[][]; contexts: unknown[] };
}): () => number {
  const index = connect.mock.calls.findIndex(([target]) => target instanceof AudioDestinationNode);
  const node = connect.mock.contexts[index] as AudioNode;
  const analyser = new AnalyserNode(node.context, { fftSize: 2048 });
  for (let output = 0; output < node.numberOfOutputs; output += 1) {
    node.connect(analyser, output);
  }
  const samples = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(samples);
    return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
  };
}

describe('SpessaSynth engine in Chromium', () => {
  let engine: PlaybackEngine | undefined;
  let button: HTMLButtonElement | undefined;

  afterEach(() => {
    engine?.destroy();
    button?.remove();
    vi.restoreAllMocks();
  });

  it('loads before a gesture, plays after a click, progresses, stops and releases resources', async () => {
    const close = vi.spyOn(AudioContext.prototype, 'close');
    const connect = vi.spyOn(AudioNode.prototype, 'connect');
    const current = createSpessaSynthEngine({ soundFont: { url: soundFontUrl }, workletModuleUrl });
    engine = current;
    const plan = compilePlaybackPlan(parseFixture(F01));

    await expect(current.load(plan)).resolves.toEqual({ status: 'loaded', loadId: 1 });
    expect(current.getSnapshot()).toMatchObject({ state: 'ready', plan });
    const level = tapSynthesizerOutput(connect);

    const positions: number[] = [];
    current.subscribePosition((tick) => positions.push(tick));
    let played: Promise<void> | undefined;
    button = document.createElement('button');
    button.textContent = 'Play';
    button.addEventListener('click', () => {
      played = current.play();
    });
    document.body.append(button);
    const play = async (): Promise<void> => {
      await userEvent.click(button ?? document.body);
      await played;
      expect(current.getSnapshot().state).toBe('playing');
    };

    await play();
    // Past the second quarter (960 ticks = 0.5 s at 120 bpm), still inside the 3840-tick bar.
    await expect.poll(() => positions.at(-1) ?? 0, { timeout: 5_000 }).toBeGreaterThan(960);
    expect(
      positions.every((tick, index) => index === 0 || tick >= (positions[index - 1] ?? 0)),
    ).toBe(true);
    await expect.poll(level, { timeout: 2_000 }).toBeGreaterThan(AUDIBLE);

    current.stop();
    expect(current.getSnapshot().state).toBe('ready');
    expect(positions.at(-1)).toBe(0);
    const stoppedAt = positions.length;
    await expect.poll(level, { timeout: 3_000 }).toBeLessThan(SILENT);
    expect(positions).toHaveLength(stoppedAt);

    // A second run after stop sounds again (stop moves playback to a fresh channel).
    await play();
    await expect.poll(level, { timeout: 2_000 }).toBeGreaterThan(AUDIBLE);
    await expect.poll(() => positions.at(-1) ?? 0, { timeout: 5_000 }).toBeGreaterThan(960);

    current.stop();
    current.destroy();
    expect(current.getSnapshot().state).toBe('destroyed');
    expect(close).toHaveBeenCalledTimes(1);
  }, 30_000);

  it.each([
    // The SoundFont is fetched before any audio context exists.
    {
      name: 'SoundFont URL not found',
      soundFont: { url: absolute('/missing/piano.sf3') },
      worklet: workletModuleUrl,
      contexts: 0,
    },
    {
      name: 'worklet module not found',
      soundFont: { url: soundFontUrl },
      worklet: absolute('/missing/processor.js'),
      contexts: 1,
    },
    {
      name: 'SoundFont bytes that are not a SoundFont',
      soundFont: { bytes: new ArrayBuffer(64) },
      worklet: workletModuleUrl,
      contexts: 1,
    },
  ])(
    '$name: load rejects ASSET_LOAD_FAILED and closes what it opened',
    async ({ soundFont, worklet, contexts }) => {
      const close = vi.spyOn(AudioContext.prototype, 'close');
      const current = createSpessaSynthEngine({ soundFont, workletModuleUrl: worklet });
      engine = current;
      await expect(current.load(compilePlaybackPlan(parseFixture(F01)))).rejects.toMatchObject({
        name: 'PlaybackError',
        code: 'ASSET_LOAD_FAILED',
      });
      expect(current.getSnapshot()).toMatchObject({
        state: 'error',
        error: { code: 'ASSET_LOAD_FAILED' },
      });
      expect(close).toHaveBeenCalledTimes(contexts);
      if ('bytes' in soundFont) {
        // The injected buffer is copied, never transferred.
        expect(soundFont.bytes.byteLength).toBe(64);
      }
    },
    30_000,
  );
});
