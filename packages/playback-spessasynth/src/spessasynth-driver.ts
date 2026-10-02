/**
 * SynthDriver over spessasynth_lib 4.3.14 (PLAYBACK_POLICY_V1.md §7): a
 * WorkletSynthesizer in an AudioContext, driven note by note. The engine
 * controller (playback-core) owns timing and hands over each note-on,
 * note-off and pedal change with an audio-clock time; SpessaSynth's own MIDI
 * sequencer is not used.
 *
 * SpessaSynth cannot cancel timed messages it has queued, so silence() moves
 * playback to another MIDI channel: the old channel is muted at once
 * (whatever is still queued on it plays silently) and all its voices are
 * killed just after its last queued message. A channel is reused only once
 * its queue has drained.
 *
 * The worklet decodes the .sf3 samples with WebAssembly and reports its
 * decoder ready once it is instantiated. A page whose CSP refuses
 * WebAssembly (no 'wasm-unsafe-eval', as in the MCP Apps spec's default
 * iframe policy) makes the processor fail silently: no message, no
 * processor error. The load therefore waits at most `decoderStartTimeoutMs`
 * for that report and then fails with ASSET_LOAD_FAILED, which the player
 * shows as "Audio unavailable" with Retry, instead of staying in Loading.
 */
import {
  PlaybackError,
  type PlaybackAssetConfig,
  type SynthDriver,
} from '@sheet-music/playback-core';
import { WorkletSynthesizer } from 'spessasynth_lib';

const SOUND_BANK_ID = 'piano';
const ERROR_LISTENER_ID = 'sheet-music-sound-bank-error';
/** General MIDI controllers. */
const MAIN_VOLUME = 7;
const SUSTAIN_PEDAL = 64;
const ALL_SOUND_OFF = 120;
/** General MIDI default channel volume. */
const DEFAULT_VOLUME = 100;
/** Channel 10 (index 9) is the General MIDI drum channel: never used. */
const PIANO_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] as const;
/** Seconds after a silenced channel's last queued message before its voices are killed and it may be reused. */
const DRAIN_SECONDS = 0.05;
/**
 * Default wait for the worklet's decoder report. Instantiating the decoder
 * takes milliseconds; the bound only has to be far above that on a slow
 * device while still ending a load that can never succeed.
 */
export const DEFAULT_DECODER_START_TIMEOUT_MS = 15_000;

export interface SpessaSynthDriverOptions {
  /** Longest wait for the worklet to report its decoder ready (default DEFAULT_DECODER_START_TIMEOUT_MS). */
  readonly decoderStartTimeoutMs?: number;
}

interface Session {
  readonly context: AudioContext;
  readonly synth: WorkletSynthesizer;
}

export class SpessaSynthDriver implements SynthDriver {
  private session: Session | undefined;
  private preparing: Promise<void> | undefined;
  private disposed = false;
  private channel: number = PIANO_CHANNELS[0];
  /** Latest time handed over on each channel. */
  private readonly lastTime = new Map<number, number>();
  private failureListener: ((error: PlaybackError) => void) | undefined;

  private readonly decoderStartTimeoutMs: number;

  constructor(
    private readonly assets: PlaybackAssetConfig,
    options: SpessaSynthDriverOptions = {},
  ) {
    this.decoderStartTimeoutMs = options.decoderStartTimeoutMs ?? DEFAULT_DECODER_START_TIMEOUT_MS;
  }

  prepare(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new PlaybackError('PLAYBACK_FAILED', 'The synthesizer was disposed.'));
    }
    if (this.session !== undefined) {
      return Promise.resolve();
    }
    this.preparing ??= this.open().finally(() => {
      this.preparing = undefined;
    });
    return this.preparing;
  }

  resume(): Promise<void> {
    const context = this.session?.context;
    if (context === undefined) {
      return Promise.reject(new PlaybackError('PLAYBACK_FAILED', 'The synthesizer is not ready.'));
    }
    return context.resume();
  }

  currentTime(): number {
    return this.session?.context.currentTime ?? 0;
  }

  noteOn(key: number, velocity: number, time: number): void {
    this.at(time)?.noteOn(this.channel, key, velocity, { time });
  }

  noteOff(key: number, time: number): void {
    this.at(time)?.noteOff(this.channel, key, { time });
  }

  sustain(down: boolean, time: number): void {
    this.at(time)?.controllerChange(this.channel, SUSTAIN_PEDAL, down ? 127 : 0, { time });
  }

  silence(): void {
    const session = this.session;
    if (session === undefined) {
      return;
    }
    const { synth, context } = session;
    const now = context.currentTime;
    const previous = this.channel;
    synth.controllerChange(previous, MAIN_VOLUME, 0);
    synth.stopAll(true);
    const last = this.lastTime.get(previous) ?? Number.NEGATIVE_INFINITY;
    if (last >= now) {
      synth.controllerChange(previous, ALL_SOUND_OFF, 0, { time: last + DRAIN_SECONDS / 2 });
    }
    this.channel = this.freeChannel(now, previous);
    synth.controllerChange(this.channel, MAIN_VOLUME, DEFAULT_VOLUME);
    synth.controllerChange(this.channel, SUSTAIN_PEDAL, 0);
  }

  onFailure(listener: (error: PlaybackError) => void): void {
    this.failureListener = listener;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const session = this.session;
    this.session = undefined;
    if (session !== undefined) {
      close(session);
    }
  }

  /** The synthesizer, after recording `time` as the latest time handed over on the current channel. */
  private at(time: number): WorkletSynthesizer | undefined {
    this.lastTime.set(this.channel, Math.max(time, this.lastTime.get(this.channel) ?? time));
    return this.session?.synth;
  }

  /** A channel whose queue has drained, preferring the next one after `previous`. */
  private freeChannel(now: number, previous: number): number {
    const start = PIANO_CHANNELS.indexOf(previous as (typeof PIANO_CHANNELS)[number]);
    const candidates = PIANO_CHANNELS.map(
      (_, offset) => PIANO_CHANNELS[(start + 1 + offset) % PIANO_CHANNELS.length] ?? previous,
    ).filter((channel) => channel !== previous);
    const drained = candidates.find(
      (channel) => (this.lastTime.get(channel) ?? Number.NEGATIVE_INFINITY) + DRAIN_SECONDS < now,
    );
    if (drained !== undefined) {
      return drained;
    }
    // Only after 14 silences within one drain window: take the channel that drained longest ago.
    return candidates.reduce((best, channel) =>
      (this.lastTime.get(channel) ?? 0) < (this.lastTime.get(best) ?? 0) ? channel : best,
    );
  }

  private async open(): Promise<void> {
    let context: AudioContext | undefined;
    let synth: WorkletSynthesizer | undefined;
    try {
      const bytes = await this.soundFontBytes();
      context = new AudioContext();
      try {
        await context.audioWorklet.addModule(this.assets.workletModuleUrl);
      } catch (cause) {
        throw new PlaybackError(
          'ASSET_LOAD_FAILED',
          'The synthesizer worklet module could not be loaded.',
          {
            cause,
          },
        );
      }
      // A processor error before the session exists fails this load instead of leaving it pending.
      let failStart: (error: PlaybackError) => void = () => undefined;
      const processorFailed = new Promise<never>((_, reject) => {
        failStart = reject;
      });
      processorFailed.catch(() => undefined);
      const created = this.createSynthesizer(context, (error) => {
        if (this.session?.synth === created) {
          this.failureListener?.(error);
        } else {
          failStart(error);
        }
      });
      synth = created;
      await Promise.race([
        addSoundBank(created, bytes, this.decoderStartTimeoutMs),
        processorFailed,
      ]);
      if (this.disposed) {
        throw new PlaybackError('PLAYBACK_FAILED', 'The synthesizer was disposed while loading.');
      }
      for (const channel of PIANO_CHANNELS) {
        synth.programChange(channel, 0);
      }
      this.session = { context, synth };
    } catch (error) {
      if (context !== undefined) {
        close({ context, synth });
      }
      throw error instanceof PlaybackError
        ? error
        : new PlaybackError('PLAYBACK_FAILED', 'The synthesizer failed to start.', {
            cause: error,
          });
    }
  }

  private createSynthesizer(
    context: AudioContext,
    onProcessorError: (error: PlaybackError) => void,
  ): WorkletSynthesizer {
    const synth = new WorkletSynthesizer(context, {
      audioNodeCreators: {
        worklet: (audioContext, name, options) => {
          const node = new AudioWorkletNode(audioContext, name, options);
          node.onprocessorerror = () => {
            onProcessorError(
              new PlaybackError('PLAYBACK_FAILED', 'The synthesizer audio processor stopped.'),
            );
          };
          return node;
        },
      },
    });
    synth.connect(context.destination);
    return synth;
  }

  /** The SoundFont bytes, copied when injected: the synthesizer transfers the buffer it receives. */
  private async soundFontBytes(): Promise<ArrayBuffer> {
    const source = this.assets.soundFont;
    try {
      if ('bytes' in source) {
        return source.bytes.slice(0);
      }
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.arrayBuffer();
    } catch (cause) {
      throw new PlaybackError('ASSET_LOAD_FAILED', 'The SoundFont could not be fetched.', {
        cause,
      });
    }
  }
}

/** `synth.isReady`, or ASSET_LOAD_FAILED once `timeoutMs` has passed without the decoder report. */
async function decoderReady(synth: WorkletSynthesizer, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new PlaybackError(
          'ASSET_LOAD_FAILED',
          'The synthesizer decoder did not start (the page may block WebAssembly).',
        ),
      );
    }, timeoutMs);
  });
  try {
    await Promise.race([synth.isReady, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** Adds the SoundFont; the worklet reports a decoding failure as an event, not a rejection. */
async function addSoundBank(
  synth: WorkletSynthesizer,
  bytes: ArrayBuffer,
  decoderStartTimeoutMs: number,
): Promise<void> {
  try {
    await decoderReady(synth, decoderStartTimeoutMs);
    await new Promise<void>((resolve, reject) => {
      synth.eventHandler.addEvent('soundBankError', ERROR_LISTENER_ID, (cause) => {
        reject(
          new PlaybackError('ASSET_LOAD_FAILED', 'The SoundFont could not be decoded.', { cause }),
        );
      });
      synth.soundBankManager.addSoundBank(bytes, SOUND_BANK_ID).then(resolve, reject);
    });
  } finally {
    synth.eventHandler.removeEvent('soundBankError', ERROR_LISTENER_ID);
  }
}

function close({
  context,
  synth,
}: {
  context: AudioContext;
  synth: WorkletSynthesizer | undefined;
}): void {
  synth?.destroy();
  context.close().catch(() => undefined);
}
