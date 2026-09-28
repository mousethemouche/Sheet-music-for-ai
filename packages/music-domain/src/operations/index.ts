/**
 * ScoreOperations v1: the typed mutation contract of ADR-002
 * (docs/architecture/SCORE_OPERATIONS_V1.md).
 */
export { applyScoreEdit } from './apply';
export {
  type BarContent,
  type ScoreEdit,
  type ScoreEditInput,
  type ScoreOperation,
  type ScoreOperationInput,
  type ScoreOperationType,
  type TransposeTarget,
  OPERATION_LIMITS,
  SCORE_OPERATION_TYPES,
  barContentSchema,
  scoreEditSchema,
  scoreOperationSchema,
} from './schema';
export { type Interval, chooseInterval, transposePitch, transposePitchClass } from './spelling';
