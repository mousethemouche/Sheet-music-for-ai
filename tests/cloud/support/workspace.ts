/**
 * The workspace modules the cloud suites use, in one place.
 *
 * tests/cloud is not a workspace package, so bare `@sheet-music/*`
 * specifiers do not resolve from here (same pattern as
 * tests/acceptance/support/workspace.ts): each package is imported through
 * the file its package.json `exports` names, and the MCP raw JSON-RPC helpers
 * of the apps/mcp test harness are reused as they are.
 */
export {
  canonicalResourceUri,
  protectedResourceMetadataUrl,
  supabaseAuthEndpoints,
} from '../../../packages/auth-jwt/src/index';
export {
  createScoreOutputSchema,
  errorEnvelopeSchema,
  listScoresResponseSchema,
  saveScoreOutputSchema,
} from '../../../packages/music-contracts/src/index';
export { F01 } from '../../../packages/test-fixtures/src/index';
export {
  MCP_ACCEPT,
  type RawResponse,
  postJsonRpc,
  scoreArgument,
} from '../../../apps/mcp/test/support/tool-calls';
