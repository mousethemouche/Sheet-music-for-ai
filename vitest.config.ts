import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';
import type { BrowserCommandContext } from 'vitest/node';

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
 * Cross-app acceptance suites (tests/acceptance, docs/testing/ACCEPTANCE.md)
 * are integration files; the public-surface inventory check
 * (tools/inventory) is a unit file.
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

// Node side of the MCP-UI harness (#11), loaded on first use of the `mcpUi`
// browser command through the project's module runner (nothing is imported
// from it here).
const MCP_UI_HARNESS = fileURLToPath(
  new URL('./apps/mcp/test/mcp-ui/harness-server.ts', import.meta.url),
);
interface McpUiHarness {
  handleMcpUiCommand(context: BrowserCommandContext, request: unknown): Promise<unknown>;
}

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
          include: [`${SOURCES}/*.test.ts`, 'tools/inventory/*.test.ts'],
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
          include: [`${SOURCES}/*.int.test.{ts,tsx}`, 'tests/**/*.int.test.{ts,tsx}'],
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
            commands: {
              mcpUi: async (context, request: unknown) =>
                (await context.project.import<McpUiHarness>(MCP_UI_HARNESS)).handleMcpUiCommand(
                  context,
                  request,
                ),
            },
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
      {
        // Opt-in release project (docs/release/RELEASE_CHECKLIST.md): no
        // package script selects it (`--project cloud` does; so does a bare
        // `vitest run`). Its suites against the deployed apps and the
        // Supabase project skip unless CLOUD_E2E=1; the release tooling's own
        // tests need no network, and the CI `quality` job runs only those
        // (`--project cloud tests/cloud/support tools/release`).
        test: {
          name: 'cloud',
          environment: 'node',
          include: ['tests/cloud/**/*.test.ts', 'tools/release/**/*.test.ts'],
          exclude: IGNORED,
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
