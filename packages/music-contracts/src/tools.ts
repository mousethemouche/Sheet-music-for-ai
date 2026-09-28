/**
 * Inputs and outputs of the five product tools (APPLICATION_LAYER.md §7).
 *
 * Every input object is closed: an unknown field (for example an `ownerId` or
 * a `confirmed` flag) is rejected, never ignored. The authenticated user is
 * never part of an input; it comes from the verified request context.
 *
 * The music payloads (`score` of create_score, `operations` of edit_score) are
 * validated by music-domain, which reports detailed ScoreSpec/ScoreOperations
 * errors; these schemas only check the envelope around them.
 */
import { z } from 'zod';
import {
  type DraftArtifact,
  type SavedArtifact,
  type ScoreArtifact,
  draftArtifactSchema,
  pageInfoSchema,
  revisionSchema,
  savedArtifactSchema,
  scoreArtifactSchema,
  scoreIdSchema,
  scoreSummarySchema,
} from './artifacts';
import { PAYLOAD_LIMITS } from './limits';
import {
  libraryTagsSchema,
  libraryTitleSchema,
  searchTextSchema,
  tagFiltersSchema,
} from './metadata';

/** Fields of a ScoreSpec that the server assigns on creation. */
const SERVER_ASSIGNED_FIELDS = ['id', 'revision'] as const;

// ---------------------------------------------------------------------------
// create_score
// ---------------------------------------------------------------------------

export const createScoreInputSchema = z.strictObject({
  score: z
    .record(z.string(), z.unknown())
    .superRefine((score, context) => {
      for (const field of SERVER_ASSIGNED_FIELDS) {
        if (Object.hasOwn(score, field)) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `Omit "${field}": the server assigns the score ID and revision.`,
          });
        }
      }
    })
    .meta({
      description:
        'A ScoreSpec v1 document without "id" and "revision" (SCORESPEC_V1_SEMANTICS.md). Inner IDs are kept as given.',
    }),
});

export const createScoreOutputSchema = z.strictObject({ artifact: draftArtifactSchema });

// ---------------------------------------------------------------------------
// edit_score
// ---------------------------------------------------------------------------

export const editScoreInputSchema = z.strictObject({
  scoreId: scoreIdSchema,
  expectedRevision: revisionSchema,
  operations: z.array(z.unknown()).meta({
    description: `ScoreOperations v1 (SCORE_OPERATIONS_V1.md), 1-${PAYLOAD_LIMITS.operationsPerEdit}, applied in order as one atomic edit.`,
  }),
});

export const editScoreOutputSchema = z.strictObject({ artifact: scoreArtifactSchema });

// ---------------------------------------------------------------------------
// save_score
// ---------------------------------------------------------------------------

/**
 * The explicit save action. It carries no consent flag: a flag written by the
 * model would prove nothing. Consent is the human approving this call.
 */
export const saveScoreInputSchema = z.strictObject({
  scoreId: scoreIdSchema,
  expectedRevision: revisionSchema,
  title: libraryTitleSchema,
  tags: libraryTagsSchema.default([]),
});

export const SAVE_OUTCOMES = ['saved', 'already_saved'] as const;
export type SaveOutcome = (typeof SAVE_OUTCOMES)[number];

export const saveScoreOutputSchema = z.strictObject({
  outcome: z.enum(SAVE_OUTCOMES),
  artifact: savedArtifactSchema,
});

// ---------------------------------------------------------------------------
// get_score
// ---------------------------------------------------------------------------

export const getScoreInputSchema = z.strictObject({ scoreId: scoreIdSchema });

export const getScoreOutputSchema = z.strictObject({ artifact: scoreArtifactSchema });

// ---------------------------------------------------------------------------
// search_scores
// ---------------------------------------------------------------------------

export const searchScoresInputSchema = z.strictObject({
  query: searchTextSchema.optional(),
  tags: tagFiltersSchema.default([]),
  limit: z.int().min(1).max(PAYLOAD_LIMITS.pageSizeMax).default(PAYLOAD_LIMITS.pageSizeDefault),
  offset: z.int().min(0).max(PAYLOAD_LIMITS.pageOffsetMax).default(0),
});

export const searchScoresOutputSchema = z.strictObject({
  items: z.array(scoreSummarySchema),
  page: pageInfoSchema,
});

// ---------------------------------------------------------------------------
// Types and the tool table
// ---------------------------------------------------------------------------

/** What a caller sends (before normalization and defaults). */
export type CreateScoreInput = z.input<typeof createScoreInputSchema>;
export type EditScoreInput = z.input<typeof editScoreInputSchema>;
export type SaveScoreInput = z.input<typeof saveScoreInputSchema>;
export type GetScoreInput = z.input<typeof getScoreInputSchema>;
export type SearchScoresInput = z.input<typeof searchScoresInputSchema>;

/** A parsed, normalized input. */
export type CreateScoreCommand = z.output<typeof createScoreInputSchema>;
export type EditScoreCommand = z.output<typeof editScoreInputSchema>;
export type SaveScoreCommand = z.output<typeof saveScoreInputSchema>;
export type GetScoreQuery = z.output<typeof getScoreInputSchema>;
export type SearchScoresQuery = z.output<typeof searchScoresInputSchema>;

export interface CreateScoreOutput {
  readonly artifact: DraftArtifact;
}
export interface EditScoreOutput {
  readonly artifact: ScoreArtifact;
}
export interface SaveScoreOutput {
  readonly outcome: SaveOutcome;
  readonly artifact: SavedArtifact;
}
export interface GetScoreOutput {
  readonly artifact: ScoreArtifact;
}
export type SearchScoresOutput = z.output<typeof searchScoresOutputSchema>;

/** The five product tools and their contracts, keyed by tool name. */
export const TOOL_CONTRACTS = {
  create_score: { input: createScoreInputSchema, output: createScoreOutputSchema },
  edit_score: { input: editScoreInputSchema, output: editScoreOutputSchema },
  save_score: { input: saveScoreInputSchema, output: saveScoreOutputSchema },
  get_score: { input: getScoreInputSchema, output: getScoreOutputSchema },
  search_scores: { input: searchScoresInputSchema, output: searchScoresOutputSchema },
} as const;

export type ToolName = keyof typeof TOOL_CONTRACTS;
