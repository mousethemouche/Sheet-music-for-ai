/**
 * @sheet-music/playback-core
 *
 * Neutral tick-based PlaybackPlan, its compiler and the playback engine port
 * (ADR-004). Contract: docs/architecture/RENDER_PLAYBACK_PORTS.md; compiler
 * and engine policy: docs/architecture/PLAYBACK_POLICY_V1.md.
 */
export {
  type ActiveNoteIdsQuery,
  type HighlightSpan,
  type PlaybackCompiler,
  type PlaybackEvent,
  type PlaybackPlan,
  type SustainPedalEvent,
  PPQ,
  TICKS_PER_WHOLE_NOTE,
} from './plan';
export { activeNoteIds, compilePlaybackPlan } from './compiler';
export { type PlaybackTicker, type SynthDriver, createPlaybackController } from './controller';
export {
  type CreatePlaybackEngine,
  type LoadOutcome,
  type PlaybackAssetConfig,
  type PlaybackEngine,
  type PlaybackEngineFactory,
  type PlaybackSnapshot,
  type PlaybackState,
  type SoundFontSource,
  type Unsubscribe,
  TEMPO_MULTIPLIER_RANGE,
} from './engine';
export { PlaybackError, type PlaybackErrorCode } from './errors';
