/**
 * @sheet-music/auth-jwt
 *
 * Supabase access-token verification to the neutral AuthenticatedPrincipal
 * (ADR-005, issue #26), bounded remote JWKS, and the OAuth protected-resource
 * discovery used by the remote MCP server (RFC 9728, RFC 6750).
 * See docs/architecture/AUTH_MCP_OAUTH.md.
 */
export { type BearerToken, readBearerToken } from './bearer';
export {
  type BearerChallengeOptions,
  type ProtectedResourceMetadata,
  type ProtectedResourceMetadataOptions,
  type RejectionResponse,
  INVALID_TOKEN_DESCRIPTION,
  bearerChallenge,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  rejectionResponse,
} from './discovery';
export {
  type RemoteJwksOptions,
  DEFAULT_JWKS_CACHE_MAX_AGE_MS,
  DEFAULT_JWKS_COOLDOWN_MS,
  DEFAULT_JWKS_TIMEOUT_MS,
  createRemoteJwks,
} from './jwks';
export { type SupabaseAuthEndpoints, supabaseAuthEndpoints } from './supabase';
export { canonicalResourceUri } from './urls';
export {
  type AccessTokenVerifier,
  type AccessTokenVerifierConfig,
  type AsymmetricAlgorithm,
  type ClientBinding,
  type KeySource,
  type TokenRejectionReason,
  type TokenVerification,
  ASYMMETRIC_ALGORITHMS,
  DEFAULT_ALGORITHMS,
  DEFAULT_CLOCK_TOLERANCE_SECONDS,
  MAX_TOKEN_LENGTH,
  createAccessTokenVerifier,
} from './verifier';
