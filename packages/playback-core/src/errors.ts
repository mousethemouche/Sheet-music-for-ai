/**
 * Errors of the playback engine port (RENDER_PLAYBACK_PORTS.md §4.4):
 * - ASSET_LOAD_FAILED: the SoundFont or the audio module could not be fetched or decoded;
 * - PLAYBACK_FAILED: the synthesizer or audio output failed to start or stopped working;
 * - INVALID_ARGUMENT: a malformed plan, seek tick or tempo multiplier; nothing changed.
 * The message is for logs; the UI shows its own text.
 */
export type PlaybackErrorCode = 'PLAYBACK_FAILED' | 'ASSET_LOAD_FAILED' | 'INVALID_ARGUMENT';

export class PlaybackError extends Error {
  override readonly name = 'PlaybackError';
  readonly code: PlaybackErrorCode;

  constructor(code: PlaybackErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}
