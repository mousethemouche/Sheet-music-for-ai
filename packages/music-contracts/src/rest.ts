/**
 * DTOs of the read-only saved-library HTTP routes (#21, APPLICATION_LAYER.md §7).
 *
 *   GET /scores?query=&tags=&tags=&limit=&offset=  -> ListScoresResponse
 *   GET /scores/:id                                -> SavedScoreResponse
 *
 * Query-string values arrive as strings (a repeated `tags` key as an array);
 * listScoresQuerySchema converts them to the search_scores input, so both
 * transports apply the same normalization, bounds and defaults.
 */
import { z } from 'zod';
import { savedArtifactSchema, scoreIdSchema } from './artifacts';
import { type SearchScoresInput, searchScoresInputSchema, searchScoresOutputSchema } from './tools';

const queryInteger = z
  .string()
  .regex(/^[0-9]{1,9}$/, { error: 'Must be a non-negative integer.' })
  .transform(Number);

export const listScoresQuerySchema = z
  .strictObject({
    query: z.string().optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    limit: queryInteger.optional(),
    offset: queryInteger.optional(),
  })
  .transform(({ query, tags, limit, offset }): SearchScoresInput => ({
    ...(query === undefined ? {} : { query }),
    ...(tags === undefined ? {} : { tags: typeof tags === 'string' ? [tags] : tags }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  }))
  .pipe(searchScoresInputSchema);

export const listScoresResponseSchema = searchScoresOutputSchema;

export const savedScoreParamsSchema = z.strictObject({ id: scoreIdSchema });

/** The full saved score: drafts are never served by the HTTP library routes. */
export const savedScoreResponseSchema = savedArtifactSchema;

export type ListScoresQuery = z.input<typeof listScoresQuerySchema>;
export type ListScoresResponse = z.output<typeof listScoresResponseSchema>;
export type SavedScoreParams = z.output<typeof savedScoreParamsSchema>;
