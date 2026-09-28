/**
 * Score artifacts and library summaries as every transport serializes them
 * (APPLICATION_LAYER.md §7). Timestamps are ISO-8601 UTC strings.
 *
 * `score` is the canonical ScoreSpec v1 document produced by the domain. Its
 * shape is owned by music-domain (`scoreSpecSchema`); the wire schema only
 * requires a JSON object so that it stays representable as JSON Schema (MCP
 * `outputSchema`) and does not validate the music twice.
 */
import { ID_PATTERN, type ScoreSpec } from '@sheet-music/music-domain';
import { z } from 'zod';

/** A score ID as issued by the server (the ScoreSpec ID pattern). */
export const scoreIdSchema = z.string().regex(ID_PATTERN, {
  error:
    'Score IDs are 1-64 characters (letters, digits, "_", ".", ":" or "-") and start with a letter or digit.',
});

/** A score revision: an integer >= 0 (new scores start at 1). */
export const revisionSchema = z.int().min(0);

const timestampSchema = z.iso.datetime();

const scoreDocumentSchema = z
  .record(z.string(), z.unknown())
  .meta({ description: 'Canonical ScoreSpec v1 document (see SCORESPEC_V1_SEMANTICS.md).' });

/** A temporary, unsaved score: private, expires `expiresAt` unless edited. */
export const draftArtifactSchema = z.strictObject({
  state: z.literal('draft'),
  scoreId: scoreIdSchema,
  revision: revisionSchema,
  score: scoreDocumentSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  expiresAt: timestampSchema,
});

/** A score in the user's permanent library, with its confirmed title and tags. */
export const savedArtifactSchema = z.strictObject({
  state: z.literal('saved'),
  scoreId: scoreIdSchema,
  revision: revisionSchema,
  score: scoreDocumentSchema,
  title: z.string(),
  tags: z.array(z.string()),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const scoreArtifactSchema = z.discriminatedUnion('state', [
  draftArtifactSchema,
  savedArtifactSchema,
]);

/** A saved score as listed by search: no score content. */
export const scoreSummarySchema = z.strictObject({
  scoreId: scoreIdSchema,
  title: z.string(),
  tags: z.array(z.string()),
  revision: revisionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const pageInfoSchema = z.strictObject({
  limit: z.int().min(1),
  offset: z.int().min(0),
  /** Number of matches over all pages. */
  total: z.int().min(0),
  /** Offset of the next page, or null on the last page. */
  nextOffset: z.int().min(0).nullable(),
});

type WithScore<T> = Omit<T, 'score'> & { readonly score: ScoreSpec };

export type DraftArtifact = WithScore<z.output<typeof draftArtifactSchema>>;
export type SavedArtifact = WithScore<z.output<typeof savedArtifactSchema>>;
export type ScoreArtifact = DraftArtifact | SavedArtifact;
export type ScoreSummary = z.output<typeof scoreSummarySchema>;
export type PageInfo = z.output<typeof pageInfoSchema>;
