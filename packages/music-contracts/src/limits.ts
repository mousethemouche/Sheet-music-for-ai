/**
 * Payload limits of the transport-neutral contracts (APPLICATION_LAYER.md §8).
 *
 * The request-body cap is enforced by the HTTP/MCP middleware (#24) before any
 * JSON parsing. The other values are enforced by the schemas in this package.
 * Music limits (bars, staves, annotations, operations per edit) stay in
 * music-domain and are only mirrored here so #24 can read one table.
 */
import { MVP_LIMITS, OPERATION_LIMITS } from '@sheet-music/music-domain';

export const PAYLOAD_LIMITS = {
  /**
   * Largest accepted JSON request body, in bytes (512 KiB). The rich wire
   * fixture (4 two-hand bars with chords, tuplets and every layer) is 5.7 kB,
   * so a 32-bar score of that density is about 46 kB and even four times
   * denser stays under 200 kB. Bodies above the cap are rejected (413) before
   * parsing, so no validation work is spent on them.
   */
  requestBodyBytes: 524_288,
  /** Library title, in Unicode code points after normalization. */
  titleLength: MVP_LIMITS.titleLength,
  /** Tags per saved score, after normalization and de-duplication. */
  tags: MVP_LIMITS.tags,
  /** One tag, in Unicode code points after normalization. */
  tagLength: MVP_LIMITS.tagLength,
  /** Free-text search, in Unicode code points after normalization. */
  searchQueryLength: 200,
  /** Tag filters in one search. */
  searchTags: MVP_LIMITS.tags,
  pageSizeDefault: 20,
  pageSizeMax: 50,
  /** Largest pagination offset; deeper pages need a narrower search. */
  pageOffsetMax: 10_000,
  /** Operations in one edit_score call (validated by the domain, mirrored for #24). */
  operationsPerEdit: OPERATION_LIMITS.operationsPerEdit,
} as const;

export type PayloadLimits = typeof PAYLOAD_LIMITS;
