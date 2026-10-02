/**
 * ENVELOPE-01 (issues #19/#24 contract gap): the shared error envelope
 * accepts every code a client can receive, so a client that validates error
 * bodies with `errorEnvelopeSchema` can read a 403/411/413/429 as well as a
 * tool error. Use-case codes (`ERROR_CODES`) stay separate from the transport
 * codes of request protection. Expected lists are copied by hand from the
 * table of ERRORS_AND_SECURITY.md §1.1; the status/disposition mapping itself
 * is ERR-01 (packages/server-common).
 */
import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_ERROR_CODES,
  ERROR_CODES,
  TRANSPORT_ERROR_CODES,
  errorEnvelopeSchema,
} from '../src/index';

const USE_CASE_CODES = [
  'INVALID_INPUT',
  'SCORE_VALIDATION_FAILED',
  'MVP_LIMIT_EXCEEDED',
  'INVALID_OPERATION',
  'TARGET_NOT_FOUND',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'REVISION_CONFLICT',
  'ALREADY_SAVED',
  'INTERNAL',
  'DEPENDENCY_UNAVAILABLE',
];
const REQUEST_PROTECTION_CODES = [
  'FORBIDDEN_ORIGIN',
  'LENGTH_REQUIRED',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
];

describe('ENVELOPE-01 code lists', () => {
  it('ERROR_CODES are exactly the use-case codes, without transport codes', () => {
    expect([...ERROR_CODES].sort()).toEqual([...USE_CASE_CODES].sort());
  });

  it('TRANSPORT_ERROR_CODES are exactly the request-protection codes', () => {
    expect([...TRANSPORT_ERROR_CODES].sort()).toEqual([...REQUEST_PROTECTION_CODES].sort());
  });

  it('ENVELOPE_ERROR_CODES are both lists, each code once', () => {
    expect([...ENVELOPE_ERROR_CODES].sort()).toEqual(
      [...USE_CASE_CODES, ...REQUEST_PROTECTION_CODES].sort(),
    );
    expect(new Set(ENVELOPE_ERROR_CODES).size).toBe(ENVELOPE_ERROR_CODES.length);
  });
});

describe('ENVELOPE-01 errorEnvelopeSchema', () => {
  it.each([...USE_CASE_CODES, ...REQUEST_PROTECTION_CODES])(
    'parses an error body with code %s',
    (code) => {
      const body = { code, message: 'A safe message.', correlationId: 'corr-envelope-01' };

      expect(errorEnvelopeSchema.parse(body)).toEqual(body);
    },
  );

  it('rejects a code outside the contract', () => {
    expect(errorEnvelopeSchema.safeParse({ code: 'TEAPOT', message: 'm' }).success).toBe(false);
  });
});
