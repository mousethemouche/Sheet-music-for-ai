/**
 * Converts zod issues into safe DomainErrorDetails (SCORESPEC_V1_SEMANTICS.md §14).
 *
 * zod issues are created without `reportInput`, so they never carry input
 * values; unknown keys (the only input-controlled path segments) are sanitized.
 */
import type { z } from 'zod';
import {
  type DomainErrorDetail,
  type ErrorPath,
  type LimitDetailCode,
  errorDetail,
} from './errors';
import { LIMIT_MARKER, type LimitKind } from './schema';

type Issue = z.ZodError['issues'][number];

const SAFE_KEY = /^[A-Za-z0-9_$-]{1,64}$/;

const LIMIT_CODES: Readonly<Record<LimitKind, LimitDetailCode>> = {
  staves: 'TOO_MANY_STAVES',
  measures: 'TOO_MANY_MEASURES',
  annotations: 'TOO_MANY_ANNOTATIONS',
  items: 'TOO_MANY_ITEMS',
  text: 'TEXT_TOO_LONG',
};

const LIMIT_MESSAGES: Readonly<Record<LimitKind, (max: number) => string>> = {
  staves: (max) => `A score has at most ${max} staves in MVP v1.`,
  measures: (max) =>
    `A score has at most ${max} bars in MVP v1; split longer music into several scores.`,
  annotations: (max) => `A score has at most ${max} teaching annotations in MVP v1.`,
  items: (max) => `At most ${max} items are allowed here in MVP v1.`,
  text: (max) => `At most ${max} characters are allowed here in MVP v1.`,
};

const LIMIT_PATTERN = new RegExp(
  `^${LIMIT_MARKER}:(staves|measures|annotations|items|text):(\\d+)$`,
);

function safeSegment(segment: PropertyKey): string | number {
  if (typeof segment === 'number') {
    return segment;
  }
  if (typeof segment === 'string' && SAFE_KEY.test(segment)) {
    return segment;
  }
  return '<invalid-key>';
}

function parseLimit(message: string): { kind: LimitKind; max: number } | undefined {
  const match = LIMIT_PATTERN.exec(message);
  if (match === null) {
    return undefined;
  }
  return { kind: match[1] as LimitKind, max: Number(match[2]) };
}

export function schemaIssueDetails(issues: readonly Issue[]): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  for (const issue of issues) {
    const path: ErrorPath = issue.path.map(safeSegment);
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        details.push(
          errorDetail(
            'UNKNOWN_FIELD',
            [...path, safeSegment(key)],
            'Unknown field. ScoreSpec v1 objects are closed: layout coordinates, renderer or audio-engine objects and other extra fields are not accepted.',
          ),
        );
      }
      continue;
    }
    const limit = parseLimit(issue.message);
    if (limit !== undefined) {
      details.push(
        errorDetail(LIMIT_CODES[limit.kind], path, LIMIT_MESSAGES[limit.kind](limit.max)),
      );
    } else if (path.length === 1 && path[0] === 'version') {
      details.push(
        errorDetail('UNSUPPORTED_VERSION', path, 'Only ScoreSpec version 1 is supported.'),
      );
    } else {
      details.push(
        errorDetail(
          issue.code === 'invalid_type' ? 'INVALID_TYPE' : 'INVALID_VALUE',
          path,
          issue.message,
        ),
      );
    }
  }
  return details;
}
