import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Test categories (docs/testing/TEST_PLAN.md §2) are selected by file name, so
 * discovery is disjoint:
 *
 *   unit         *.test.ts        Node, no DB, no browser        pnpm test
 *   component    *.test.tsx       jsdom + Testing Library        pnpm test
 *   integration  *.int.test.ts    real DB/API/MCP, serial        pnpm test:integration
 *   mcp-ui       *.mcpui.test.ts  Chromium via Playwright        pnpm test:mcp-ui
 *   architecture tools/architecture/*.test.ts                     pnpm check:arch
 *
 * React (and therefore *.test.tsx) is only allowed in score-ui, apps/web and
 * apps/mcp/view; `pnpm check:arch` enforces that boundary.
 */
const SOURCES = '{apps,packages}/**';
const IGNORED = [...configDefaults.exclude, '**/dist/**'];

const DEFAULT_TEST_DATABASE_URL = 'postgres://user@localhost:5432/sheet_music_test';

// Node-side projects are compiled by SWC because NestJS needs legacy decorators
// with emitDecoratorMetadata. SWC reads the nearest tsconfig.json of each file,
// so decorators are only enabled where a package opts in (apps/api).
const nodeTransform = () => swc.vite();

export default defineConfig({
  test: {
    // The scaffold has no product tests yet; each category passes empty until
    // its owning issue adds tests.
    passWithNoTests: true,
    projects: [
      {
        plugins: [nodeTransform()],
        test: {
          name: 'unit',
          environment: 'node',
          include: [`${SOURCES}/*.test.ts`],
          exclude: [...IGNORED, '**/*.int.test.ts', '**/*.mcpui.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'component',
          environment: 'jsdom',
          include: [`${SOURCES}/*.test.tsx`],
          exclude: [...IGNORED, '**/*.int.test.tsx', '**/*.mcpui.test.tsx'],
          setupFiles: ['./tools/vitest/setup-component.ts'],
        },
      },
      {
        plugins: [nodeTransform()],
        test: {
          name: 'integration',
          environment: 'node',
          include: [`${SOURCES}/*.int.test.{ts,tsx}`],
          exclude: IGNORED,
          env: {
            TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL,
          },
          // One shared test database: run files one at a time in one worker.
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'mcp-ui',
          include: [`${SOURCES}/*.mcpui.test.{ts,tsx}`],
          exclude: IGNORED,
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'architecture',
          environment: 'node',
          include: ['tools/architecture/*.test.ts'],
          exclude: IGNORED,
        },
      },
    ],
  },
});
