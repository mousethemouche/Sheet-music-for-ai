import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * DEPLOY-01 (issue #16): `pnpm check:deploy`. Its own configuration, outside
 * the root projects, because it builds every app with its vercel.json build
 * command (docs/deploy/VERCEL.md "Local checks"). It needs the local test
 * Postgres of `pnpm test:integration`: TEST_DATABASE_URL gives the server and
 * credentials, and the suite uses only its own database
 * `sheet_music_test_deploy` (docs/testing/HARNESS.md §2.1), never the one
 * TEST_DATABASE_URL names, which belongs to the persistence-postgres suites.
 */
export default defineConfig({
  test: {
    name: 'deploy',
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['tools/deploy/*.test.ts'],
    environment: 'node',
    env: {
      TEST_DATABASE_URL:
        process.env['TEST_DATABASE_URL'] ?? 'postgres://user@localhost:5432/sheet_music_test',
    },
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});
