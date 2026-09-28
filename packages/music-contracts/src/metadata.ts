/**
 * Library metadata and search text: normalization and bounds
 * (APPLICATION_LAYER.md §7). Shared by save_score, search_scores and
 * GET /scores so every transport stores and matches the same values.
 *
 * Normalization of one text value:
 *   1. Unicode NFC (composed and decomposed accents become identical);
 *   2. every run of whitespace (spaces, tabs, line breaks) becomes one space;
 *   3. leading and trailing spaces are removed.
 * Case is preserved. Lengths count Unicode code points after normalization.
 * Remaining control characters (U+0000-U+001F, U+007F-U+009F) are rejected:
 * they have no meaning in a title or tag, and PostgreSQL cannot store U+0000.
 */
import { z } from 'zod';
import { PAYLOAD_LIMITS } from './limits';

const CONTROL_CHARACTER = /\p{Cc}/u;

export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function codePointLength(value: string): number {
  return [...value].length;
}

/** A normalized, non-blank, bounded single-line text. */
function boundedText(label: string, max: number) {
  return z
    .string()
    .transform(normalizeText)
    .pipe(
      z
        .string()
        .refine((value) => value.length > 0, { error: `${label} must not be empty or blank.` })
        .refine((value) => !CONTROL_CHARACTER.test(value), {
          error: `${label} must not contain control characters.`,
        })
        .refine((value) => codePointLength(value) <= max, {
          error: `${label} has at most ${max} characters.`,
          params: { detail: 'TEXT_TOO_LONG' },
        }),
    );
}

/**
 * Removes tags that repeat an earlier tag, ignoring case
 * (`String.prototype.toLowerCase`); the first spelling and the order are kept.
 */
export function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(tag);
    }
  }
  return kept;
}

/** One free-form tag: normalized, 1-40 characters, no fixed taxonomy. */
export const libraryTagSchema = boundedText('A tag', PAYLOAD_LIMITS.tagLength);

function tagList(max: number) {
  return z
    .array(libraryTagSchema)
    .transform(dedupeTags)
    .pipe(
      z.array(z.string()).refine((tags) => tags.length <= max, {
        error: `At most ${max} different tags are allowed.`,
        params: { detail: 'TOO_MANY_ITEMS' },
      }),
    );
}

/** Library title of a saved score: required, normalized, 1-120 characters. */
export const libraryTitleSchema = boundedText('The title', PAYLOAD_LIMITS.titleLength);

/** Free-form tags of a saved score: normalized, de-duplicated ignoring case, 0-16. */
export const libraryTagsSchema = tagList(PAYLOAD_LIMITS.tags);

/** Tag filters of a search: same normalization as stored tags, 0-16. */
export const tagFiltersSchema = tagList(PAYLOAD_LIMITS.searchTags);

/**
 * Free-text search: normalized, at most 200 characters. A blank query means
 * "no text filter" and parses to `undefined`.
 */
export const searchTextSchema = z
  .string()
  .transform(normalizeText)
  .pipe(
    z
      .string()
      .refine((value) => !CONTROL_CHARACTER.test(value), {
        error: 'The search text must not contain control characters.',
      })
      .refine((value) => codePointLength(value) <= PAYLOAD_LIMITS.searchQueryLength, {
        error: `The search text has at most ${PAYLOAD_LIMITS.searchQueryLength} characters.`,
        params: { detail: 'TEXT_TOO_LONG' },
      })
      .transform((value) => (value === '' ? undefined : value)),
  );
