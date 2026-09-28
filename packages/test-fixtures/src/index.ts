/**
 * @sheet-music/test-fixtures
 *
 * Canonical ScoreSpec fixtures (F01-F11 catalogue and one rich wire fixture,
 * see docs/testing/TEST_PLAN.md §4) with independent numeric oracles.
 * F12 (users/drafts) belongs to #18.
 */
export * from './builders';
export * from './catalog';
export * from './boundaries';
export * from './rich';
export * from './oracles';
export { parseFixture } from './parse';
