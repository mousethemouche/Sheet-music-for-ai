/**
 * Access-token verification for the HTTP and MCP boundaries (ADR-005, issue #26).
 *
 * A token is accepted only when ALL of these hold (see AUTH_MCP_OAUTH.md §3):
 * - it is a compact JWS whose `alg` is in the asymmetric allow-list (never
 *   HS* or `none`), checked before any key lookup;
 * - its signature verifies with a key from the configured key source, chosen
 *   by `kid`; keys embedded in the token (`jwk`, `jku`, `x5u`) are ignored;
 * - `iss` equals the configured issuer exactly;
 * - `aud` (string or array) contains at least one configured audience;
 * - `exp` and `iat` are present; `exp`, `nbf` and `iat` are consistent with
 *   the clock, within the clock tolerance;
 * - `sub` is a non-blank, bounded identifier and `role` is `authenticated`
 *   (not anonymous);
 * - `client_id` matches the configured client binding.
 *
 * The principal comes from `sub` only. Email, user or app metadata and the
 * request body are never read. Expected failures are returned as a reason for
 * server logs; the reason never reaches the client (the challenge is generic).
 */
import type { AuthenticatedPrincipal } from '@sheet-music/music-application';
import { type JWTPayload, type JWTVerifyGetKey, errors, jwtVerify } from 'jose';

/** Resolves the verification key of a token from its protected header (`kid`, `alg`). */
export type KeySource = JWTVerifyGetKey;

/** Asymmetric JWS algorithms. Symmetric (HS*) and `none` can never be configured. */
export const ASYMMETRIC_ALGORITHMS = [
  'ES256',
  'ES384',
  'ES512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'EdDSA',
  'Ed25519',
] as const;
export type AsymmetricAlgorithm = (typeof ASYMMETRIC_ALGORITHMS)[number];

/**
 * Which kind of Supabase access token a boundary accepts:
 * - `session`: a first-party web session (supabase-js); the token must NOT
 *   carry `client_id`, so a token issued to an OAuth client is refused;
 * - `oauth`: a token issued by the Supabase OAuth 2.1 server to an OAuth
 *   client; `client_id` is required and, when `allowedClientIds` is given,
 *   must be one of them. A first-party session token is refused.
 */
export type ClientBinding =
  | { readonly kind: 'session' }
  | { readonly kind: 'oauth'; readonly allowedClientIds?: readonly string[] };

export interface AccessTokenVerifierConfig {
  /** Exact `iss`, for Supabase `https://<ref>.supabase.co/auth/v1`. */
  readonly issuer: string;
  /** Accepted audiences; the token `aud` must contain at least one of them. */
  readonly audiences: readonly string[];
  readonly client: ClientBinding;
  readonly keys: KeySource;
  /** Allowed signing algorithms. Default `['ES256']`. */
  readonly algorithms?: readonly AsymmetricAlgorithm[];
  /** Tolerated clock skew for `exp`, `nbf` and `iat`, 0-300 seconds. Default 30. */
  readonly clockToleranceSeconds?: number;
  /** Current instant; injectable for tests. Default: system time. */
  readonly now?: () => Date;
}

/** Why a token was refused. For server logs only: clients get a generic challenge. */
export type TokenRejectionReason =
  | 'MISSING_TOKEN'
  | 'MALFORMED_TOKEN'
  | 'ALGORITHM_NOT_ALLOWED'
  | 'UNKNOWN_KEY'
  | 'BAD_SIGNATURE'
  | 'WRONG_ISSUER'
  | 'WRONG_AUDIENCE'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'INVALID_CLAIMS'
  | 'CLIENT_NOT_ALLOWED'
  /** The key source failed (JWKS unreachable, timed out or malformed): a 503, not a 401. */
  | 'KEYS_UNAVAILABLE';

export type TokenVerification =
  | { readonly ok: true; readonly principal: AuthenticatedPrincipal }
  | { readonly ok: false; readonly reason: TokenRejectionReason };

export interface AccessTokenVerifier {
  /** Never throws for a bad token; a thrown error is a bug of this package or of jose. */
  verify(token: string): Promise<TokenVerification>;
}

export const DEFAULT_ALGORITHMS: readonly AsymmetricAlgorithm[] = ['ES256'];
export const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;
const MAX_CLOCK_TOLERANCE_SECONDS = 300;
/** Longer tokens are refused before any cryptographic work (Node's default header cap is 16 KiB). */
export const MAX_TOKEN_LENGTH = 16_384;
const MAX_SUBJECT_LENGTH = 255;
/** No whitespace or control characters in an identity. */
const SUBJECT = /^[^\s\p{Cc}]+$/u;
const REQUIRED_ROLE = 'authenticated';

const ALLOWED_ALGORITHM_SET: ReadonlySet<string> = new Set(ASYMMETRIC_ALGORITHMS);

/** Marks a failure of the key source itself, as opposed to a token without a matching key. */
class KeySourceFailure extends Error {
  constructor(cause: unknown) {
    super('The key source failed.', { cause });
    this.name = 'KeySourceFailure';
  }
}

function rejected(reason: TokenRejectionReason): TokenVerification {
  return { ok: false, reason };
}

function checkConfig(config: AccessTokenVerifierConfig) {
  const algorithms = config.algorithms ?? DEFAULT_ALGORITHMS;
  if (algorithms.length === 0 || algorithms.some((alg) => !ALLOWED_ALGORITHM_SET.has(alg))) {
    throw new TypeError('algorithms must be a non-empty list of asymmetric JWS algorithms.');
  }
  if (config.issuer.length === 0 || !URL.canParse(config.issuer)) {
    throw new TypeError('issuer must be an absolute URL.');
  }
  if (config.audiences.length === 0 || config.audiences.some((aud) => aud.length === 0)) {
    throw new TypeError('audiences must be a non-empty list of non-empty strings.');
  }
  const tolerance = config.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > MAX_CLOCK_TOLERANCE_SECONDS) {
    throw new RangeError(
      `clockToleranceSeconds must be an integer 0-${MAX_CLOCK_TOLERANCE_SECONDS}.`,
    );
  }
  const { client } = config;
  if (
    client.kind === 'oauth' &&
    client.allowedClientIds !== undefined &&
    (client.allowedClientIds.length === 0 || client.allowedClientIds.some((id) => id.length === 0))
  ) {
    throw new TypeError('allowedClientIds, when given, must list non-empty client IDs.');
  }
  return { algorithms: [...algorithms], tolerance };
}

function classify(error: unknown): TokenRejectionReason {
  if (error instanceof KeySourceFailure) {
    return 'KEYS_UNAVAILABLE';
  }
  if (error instanceof errors.JOSEAlgNotAllowed) {
    return 'ALGORITHM_NOT_ALLOWED';
  }
  if (
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys
  ) {
    return 'UNKNOWN_KEY';
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return 'BAD_SIGNATURE';
  }
  if (error instanceof errors.JWTExpired) {
    return 'EXPIRED';
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    switch (error.claim) {
      case 'iss':
        return 'WRONG_ISSUER';
      case 'aud':
        return 'WRONG_AUDIENCE';
      case 'nbf':
        return error.reason === 'check_failed' ? 'NOT_YET_VALID' : 'INVALID_CLAIMS';
      default:
        return 'INVALID_CLAIMS';
    }
  }
  if (
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JOSENotSupported
  ) {
    return 'MALFORMED_TOKEN';
  }
  throw error;
}

function isValidSubject(sub: unknown): sub is string {
  return typeof sub === 'string' && sub.length <= MAX_SUBJECT_LENGTH && SUBJECT.test(sub);
}

function clientAllowed(binding: ClientBinding, clientId: unknown): boolean {
  if (binding.kind === 'session') {
    return clientId === undefined;
  }
  if (typeof clientId !== 'string' || clientId.length === 0) {
    return false;
  }
  return binding.allowedClientIds === undefined || binding.allowedClientIds.includes(clientId);
}

/** Checks done after jose: time of issue, identity and client binding. */
function checkClaims(
  payload: JWTPayload,
  config: AccessTokenVerifierConfig,
  nowSeconds: number,
  tolerance: number,
): TokenVerification {
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + tolerance) {
    return rejected('NOT_YET_VALID');
  }
  if (!isValidSubject(payload.sub)) {
    return rejected('INVALID_CLAIMS');
  }
  if (payload['role'] !== REQUIRED_ROLE || payload['is_anonymous'] === true) {
    return rejected('INVALID_CLAIMS');
  }
  if (!clientAllowed(config.client, payload['client_id'])) {
    return rejected('CLIENT_NOT_ALLOWED');
  }
  return { ok: true, principal: Object.freeze({ userId: payload.sub }) };
}

export function createAccessTokenVerifier(config: AccessTokenVerifierConfig): AccessTokenVerifier {
  const { algorithms, tolerance } = checkConfig(config);
  const now = config.now ?? (() => new Date());
  const audiences = [...config.audiences];

  const keys: KeySource = async (header, token) => {
    try {
      return await config.keys(header, token);
    } catch (error) {
      if (
        error instanceof errors.JWKSNoMatchingKey ||
        error instanceof errors.JWKSMultipleMatchingKeys
      ) {
        throw error;
      }
      throw new KeySourceFailure(error);
    }
  };

  return {
    async verify(token) {
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return rejected('MALFORMED_TOKEN');
      }
      const instant = now();
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          algorithms,
          issuer: config.issuer,
          audience: audiences,
          clockTolerance: tolerance,
          currentDate: instant,
          requiredClaims: ['sub', 'exp', 'iat'],
        }));
      } catch (error) {
        return rejected(classify(error));
      }
      return checkClaims(payload, config, Math.floor(instant.getTime() / 1000), tolerance);
    },
  };
}
