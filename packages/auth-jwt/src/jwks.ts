/**
 * Remote JSON Web Key Set with bounded caching and refresh (AUTH_MCP_OAUTH.md §3.2).
 *
 * Built on jose's remote JWKS resolver:
 * - the set is fetched on first use and cached for `cacheMaxAgeMs`;
 * - a token whose `kid` is unknown triggers at most ONE refetch per
 *   `cooldownMs` (key rotation is picked up, a flood of forged `kid`s is not
 *   amplified into a flood of fetches); concurrent refetches share one request;
 * - each fetch times out after `timeoutMs`, never follows redirects and must
 *   answer 200 with a JWKS; a failure makes verification report
 *   `KEYS_UNAVAILABLE` (503), never a successful or anonymous result.
 */
import {
  type FetchImplementation,
  type RemoteJWKSetOptions,
  createRemoteJWKSet,
  customFetch,
} from 'jose';
import type { KeySource } from './verifier';
import { requireServerUrl } from './urls';

export interface RemoteJwksOptions {
  /** How long a fetched key set is used without refetching. Default 10 minutes. */
  readonly cacheMaxAgeMs?: number;
  /** Minimum time between two refetches caused by unknown `kid`s. Default 30 seconds. */
  readonly cooldownMs?: number;
  /** Fetch timeout. Default 5 seconds. */
  readonly timeoutMs?: number;
  /** Replaces the global fetch (tests). */
  readonly fetch?: FetchImplementation;
}

/**
 * Supabase caches its JWKS endpoint for 10 minutes at the edge; a rotated key
 * is published as a standby key before it signs anything, so a 10-minute
 * cache plus a 30-second unknown-kid refetch picks it up without downtime.
 */
export const DEFAULT_JWKS_CACHE_MAX_AGE_MS = 600_000;
export const DEFAULT_JWKS_COOLDOWN_MS = 30_000;
export const DEFAULT_JWKS_TIMEOUT_MS = 5_000;

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer number of milliseconds.`);
  }
  return value;
}

export function createRemoteJwks(
  jwksUrl: string | URL,
  options: RemoteJwksOptions = {},
): KeySource {
  const url = requireServerUrl(String(jwksUrl), 'jwksUrl');
  const joseOptions: RemoteJWKSetOptions = {
    cacheMaxAge: positiveInteger(
      options.cacheMaxAgeMs ?? DEFAULT_JWKS_CACHE_MAX_AGE_MS,
      'cacheMaxAgeMs',
    ),
    cooldownDuration: positiveInteger(options.cooldownMs ?? DEFAULT_JWKS_COOLDOWN_MS, 'cooldownMs'),
    timeoutDuration: positiveInteger(options.timeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS, 'timeoutMs'),
  };
  if (options.fetch !== undefined) {
    joseOptions[customFetch] = options.fetch;
  }
  return createRemoteJWKSet(url, joseOptions);
}
