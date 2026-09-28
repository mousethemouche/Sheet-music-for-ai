import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Code with React: shared player UI, standalone web app and the MCP Apps View.
const REACT_SOURCES = [
  'packages/score-ui/**/*.{ts,tsx}',
  'apps/web/src/**/*.{ts,tsx}',
  'apps/mcp/view/**/*.{ts,tsx}',
];

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/test-results/**',
    '**/playwright-report/**',
    // Deliberately violates the architecture rules; see tools/architecture.
    'tools/architecture/fixtures/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: REACT_SOURCES,
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
  },
]);
