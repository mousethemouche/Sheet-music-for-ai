/**
 * The only error a ScoreRenderer rejects with (RENDER_PLAYBACK_PORTS.md §2.3).
 * The message is for logs; the UI shows its own text. The original library
 * error, if any, is the `cause`.
 */
export class RenderError extends Error {
  override readonly name = 'RenderError';
  readonly code = 'RENDER_FAILED';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export type RenderErrorCode = RenderError['code'];
