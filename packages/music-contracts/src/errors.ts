/**
 * Transport-neutral error contract (APPLICATION_LAYER.md §6,
 * ERRORS_AND_SECURITY.md §1).
 *
 * Every failure a client can see is `{ code, message, details?, correlationId? }`.
 * Use cases fail with the domain codes of music-domain plus the application
 * codes below (`ErrorCode`). The HTTP layer adds the transport codes of
 * request protection, raised before any use case runs. The envelope accepts
 * both, so a client can parse every error body either transport sends.
 * Messages and details never echo free text from the request.
 */
import {
  DOMAIN_ERROR_CODES,
  type DomainErrorDetail,
  type DomainErrorDetailCode,
  type ErrorPath,
  errorDetail,
} from '@sheet-music/music-domain';
import { z } from 'zod';

/** Codes added by the application layer on top of the domain codes. */
export const APPLICATION_ERROR_CODES = [
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'ALREADY_SAVED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ApplicationErrorCode = (typeof APPLICATION_ERROR_CODES)[number];

/** Codes a use case can fail with: domain plus application codes. */
export const ERROR_CODES = [...DOMAIN_ERROR_CODES, ...APPLICATION_ERROR_CODES] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Codes of request protection (Origin policy, body cap, rate limits), sent
 * by the HTTP layer of both apps before any use case runs. Never a use-case
 * result, so they are not part of `ErrorCode`.
 */
export const TRANSPORT_ERROR_CODES = [
  'FORBIDDEN_ORIGIN',
  'LENGTH_REQUIRED',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
] as const;
export type TransportErrorCode = (typeof TRANSPORT_ERROR_CODES)[number];

/** Every code an error envelope can carry. */
export const ENVELOPE_ERROR_CODES = [...ERROR_CODES, ...TRANSPORT_ERROR_CODES] as const;
export type EnvelopeErrorCode = (typeof ENVELOPE_ERROR_CODES)[number];

/** One problem: a detail code, a JSON path into the request or document, a safe message, optional IDs. */
export type ErrorDetail = DomainErrorDetail;

export const errorDetailSchema = z.strictObject({
  code: z.string(),
  path: z.array(z.union([z.string(), z.int()])),
  message: z.string(),
  ids: z.array(z.string()).optional(),
});

/** The serialized error of every transport (MCP tool error, HTTP error body). */
export const errorEnvelopeSchema = z.strictObject({
  code: z.enum(ENVELOPE_ERROR_CODES),
  message: z.string(),
  details: z.array(errorDetailSchema).optional(),
  correlationId: z.string().optional(),
});
export type ErrorEnvelope = z.output<typeof errorEnvelopeSchema>;

/** Detail codes a schema refinement may request through `params.detail`. */
const REFINEMENT_DETAIL_CODES: ReadonlySet<string> = new Set<DomainErrorDetailCode>([
  'TEXT_TOO_LONG',
  'TOO_MANY_ITEMS',
]);

const SAFE_KEY = /^[A-Za-z0-9_$-]{1,64}$/;

function safeSegment(segment: PropertyKey): string | number {
  if (typeof segment === 'number') {
    return segment;
  }
  return typeof segment === 'string' && SAFE_KEY.test(segment) ? segment : '<invalid-key>';
}

type Issue = z.ZodError['issues'][number];

function detailCode(issue: Issue): DomainErrorDetailCode {
  switch (issue.code) {
    case 'invalid_type':
      return 'INVALID_TYPE';
    case 'too_big':
      return issue.origin === 'array' ? 'TOO_MANY_ITEMS' : 'INVALID_VALUE';
    case 'custom': {
      const requested: unknown = issue.params?.['detail'];
      return typeof requested === 'string' && REFINEMENT_DETAIL_CODES.has(requested)
        ? (requested as DomainErrorDetailCode)
        : 'INVALID_VALUE';
    }
    default:
      return 'INVALID_VALUE';
  }
}

/**
 * Converts the issues of a failed contract parse into safe error details.
 * Unknown keys are reported one by one with a sanitized path; other messages
 * come from the schemas and describe the expected shape, never the input.
 */
export function inputIssueDetails(error: z.ZodError): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  for (const issue of error.issues) {
    const path: ErrorPath = issue.path.map(safeSegment);
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        details.push(
          errorDetail(
            'UNKNOWN_FIELD',
            [...path, safeSegment(key)],
            'Unknown field: this request object is closed.',
          ),
        );
      }
      continue;
    }
    details.push(errorDetail(detailCode(issue), path, issue.message));
  }
  return details;
}
