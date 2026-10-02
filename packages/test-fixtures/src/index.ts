/**
 * @sheet-music/test-fixtures
 *
 * Canonical ScoreSpec fixtures (F01-F11 catalogue and one rich wire fixture,
 * see docs/testing/TEST_PLAN.md §4) with independent numeric oracles, the
 * scores ChatGPT created in production (regression fixtures), and
 * F12: users A/B, a test clock, deterministic score IDs and a
 * draft/saved/expired/tied-timestamp scenario as plain data
 * (docs/testing/HARNESS.md).
 */
export * from './builders';
export * from './catalog';
export * from './boundaries';
export * from './rich';
export * from './chatgpt';
export * from './oracles';
export * from './f12';
export { parseFixture } from './parse';
