/**
 * The workspace modules the acceptance suites use, in one place.
 *
 * tests/acceptance is not a workspace package (pnpm-workspace.yaml lists
 * apps/* and packages/*), so bare `@sheet-music/*` specifiers do not resolve
 * from here. Each package is imported through the file its package.json
 * `exports` names, which is the module the apps load (Vite resolves the
 * workspace symlinks to these same files), and the apps' own integration
 * harnesses are reused as they are (docs/testing/HARNESS.md).
 */
export { type ServedTestIssuer, startTestIssuer } from '../../../packages/auth-jwt/testing/index';
export {
  type ErrorEnvelope,
  type ScoreSummary,
  createScoreOutputSchema,
  editScoreOutputSchema,
  errorEnvelopeSchema,
  getScoreOutputSchema,
  listScoresResponseSchema,
  saveScoreOutputSchema,
  savedScoreResponseSchema,
  searchScoresOutputSchema,
} from '../../../packages/music-contracts/src/index';
export { TEST_USER_A, TEST_USER_B } from '../../../packages/persistence-postgres/testing/index';
export { createLogger } from '../../../packages/server-common/src/index';
export {
  F01,
  F12_NOW,
  RICH_WIRE_FIXTURE,
  SequentialScoreIds,
  TestClock,
  cloneFixture,
} from '../../../packages/test-fixtures/src/index';
export { type RunningApi, apiStores, startApi } from '../../../apps/api/test/support/api-harness';
export { createMcpApp } from '../../../apps/mcp/src/composition';
export { createViewAssetsRouter } from '../../../apps/mcp/src/static-assets';
export {
  type McpTestBackend,
  type RowCounts,
  type StoredDraft,
  type StoredScore,
  openMcpTestBackend,
  rowCounts,
  storedDraft,
  storedScore,
} from '../../../apps/mcp/test/support/backend';
export {
  PLACEHOLDER_VIEW_HTML,
  type RunningMcpApp,
  startMcpApp,
} from '../../../apps/mcp/test/support/mcp-harness';
export {
  callTool,
  envelopeOf,
  outputOf,
  scoreArgument,
} from '../../../apps/mcp/test/support/tool-calls';
