// @ts-check
/**
 * Architecture rules (CI-02, ADR-003/004/005). Run with `pnpm check:arch`.
 *
 * Paths are matched after resolution, so a rule catches a forbidden package
 * however it is reached: bare, deep (`react/jsx-runtime`), type-only
 * (`import type`), re-exported (`export ... from`), dynamically imported, or
 * under an alias name that resolves to the same package directory. Unresolved
 * bare specifiers are matched too. Inward packages have an allow-list of the
 * workspace packages they may import (ADR-003 diagram), module cycles are
 * errors, and production code never imports devDependencies.
 * tools/architecture/forbidden-fixture.test.ts proves the rules reject a
 * deliberately forbidden fixture.
 */

/** An npm package, as a resolved node_modules path or as an unresolved bare specifier. */
const npm = (/** @type {string[]} */ ...names) =>
  `(^|node_modules/)(@types/)?(${names.join('|')})(/|$)`;

/** A workspace package, by source path or by package name. */
const workspace = (/** @type {string[]} */ ...names) =>
  `^(packages/(${names.join('|')})/|@sheet-music/(${names.join('|')})(/|$))`;

/** Files inside the given workspace package directories. */
const inPackages = (/** @type {string[]} */ ...names) => `^packages/(${names.join('|')})/`;

/** Any workspace package or app, by source path or by package name. */
const ANY_WORKSPACE = '^(apps|packages)/|^@sheet-music/';

/** Tests (package-level `test/` directories, `*.test.ts(x)` of every category) and app build configs. */
const NOT_PRODUCTION = '(^|/)test/|\\.test\\.tsx?$|^apps/[^/]+/vite[^/]*\\.config\\.ts$';

// Testing Library's React renderer is React too.
const REACT = ['react', 'react-dom', 'react-router', 'react-router-dom', '@testing-library/react'];
const NEST = ['@nestjs/[^/]+'];
const MCP_SDK = ['@modelcontextprotocol/[^/]+'];
const POSTGRES = ['pg', 'pg-[^/]+'];
const SUPABASE = ['@supabase/[^/]+'];
const VEXFLOW = ['vexflow'];
const SPESSASYNTH = ['spessasynth[^/]*'];
const HTTP_SERVER = ['express'];
const JWT = ['jose'];

/** Libraries the music core must never know about (ADR-003 "Forbidden imports"). */
const CORE_FORBIDDEN = npm(
  ...REACT,
  ...NEST,
  ...MCP_SDK,
  ...POSTGRES,
  ...SUPABASE,
  ...VEXFLOW,
  ...SPESSASYNTH,
  ...HTTP_SERVER,
  ...JWT,
);

/** Packages that hold concrete infrastructure; only apps compose them. */
const ADAPTERS = [
  'renderer-vexflow',
  'playback-spessasynth',
  'persistence-postgres',
  'auth-jwt',
  'server-common',
];

/** Packages that point inward (domain, application, ports, shared UI, fixtures). */
const INWARD = [
  'music-domain',
  'music-contracts',
  'music-application',
  'renderer-core',
  'playback-core',
  'score-ui',
  'test-fixtures',
];

/**
 * ADR-003 dependency diagram: the only workspace packages each inward package
 * may import besides itself (music-domain imports none, see its own rule).
 * Their tests may also import the fixture catalogue (production code may not,
 * see test-fixtures-only-in-tests).
 */
const ALLOWED_WORKSPACE_DEPENDENCIES = {
  'music-contracts': ['music-domain'],
  'music-application': ['music-domain', 'music-contracts'],
  'renderer-core': ['music-domain'],
  'playback-core': ['music-domain'],
  'score-ui': ['music-domain', 'renderer-core', 'playback-core'],
};

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-stays-pure',
      comment:
        'ADR-003: music-domain must not depend on React, NestJS, MCP, Postgres, Supabase, VexFlow, SpessaSynth, Express or jose.',
      severity: 'error',
      from: { path: inPackages('music-domain') },
      to: { path: CORE_FORBIDDEN },
    },
    {
      name: 'domain-has-no-workspace-dependencies',
      comment:
        'ADR-003: music-domain is the innermost layer and depends on no other workspace package.',
      severity: 'error',
      from: { path: inPackages('music-domain') },
      to: { path: ANY_WORKSPACE, pathNot: inPackages('music-domain') },
    },
    ...Object.entries(ALLOWED_WORKSPACE_DEPENDENCIES).map(([name, allowed]) => ({
      name: `${name}-allowed-workspace-dependencies`,
      comment: `ADR-003: ${name} depends only on ${allowed.join(', ')} among workspace packages (no outward or sideways edge).`,
      severity: /** @type {const} */ ('error'),
      from: { path: inPackages(name) },
      to: {
        path: ANY_WORKSPACE,
        pathNot: [inPackages(name), workspace(...allowed, 'test-fixtures')],
      },
    })),
    {
      name: 'application-stays-pure',
      comment:
        'ADR-003/005: music-application uses neutral ports; no UI, transport, persistence, auth, renderer or synth library.',
      severity: 'error',
      from: { path: inPackages('music-application') },
      to: { path: CORE_FORBIDDEN },
    },
    {
      name: 'contracts-stay-transport-neutral',
      comment: 'ADR-003: music-contracts holds transport-neutral schemas/DTOs only.',
      severity: 'error',
      from: { path: inPackages('music-contracts') },
      to: { path: CORE_FORBIDDEN },
    },
    {
      name: 'renderer-core-no-vexflow',
      comment: 'ADR-004: the renderer port knows no concrete engraving library.',
      severity: 'error',
      from: { path: inPackages('renderer-core') },
      to: { path: npm(...VEXFLOW) },
    },
    {
      name: 'playback-core-no-spessasynth',
      comment: 'ADR-004: the playback port and timeline compiler know no concrete synthesizer.',
      severity: 'error',
      from: { path: inPackages('playback-core') },
      to: { path: npm(...SPESSASYNTH) },
    },
    {
      name: 'score-ui-no-concrete-media',
      comment:
        'ADR-004: score-ui uses renderer/playback ports; apps inject the VexFlow/SpessaSynth adapters.',
      severity: 'error',
      from: { path: inPackages('score-ui') },
      to: {
        path: [
          npm(...VEXFLOW, ...SPESSASYNTH),
          workspace('renderer-vexflow', 'playback-spessasynth'),
        ],
      },
    },
    {
      name: 'renderer-independent-of-playback',
      comment: 'ADR-004: rendering and playback are independent projections of ScoreSpec.',
      severity: 'error',
      from: { path: inPackages('renderer-core', 'renderer-vexflow') },
      to: { path: [workspace('playback-core', 'playback-spessasynth'), npm(...SPESSASYNTH)] },
    },
    {
      name: 'playback-independent-of-renderer',
      comment: 'ADR-004: rendering and playback are independent projections of ScoreSpec.',
      severity: 'error',
      from: { path: inPackages('playback-core', 'playback-spessasynth') },
      to: { path: [workspace('renderer-core', 'renderer-vexflow'), npm(...VEXFLOW)] },
    },
    {
      name: 'vexflow-only-in-its-adapter',
      comment:
        'ADR-004: replacing VexFlow must only touch packages/renderer-vexflow and composition wiring.',
      severity: 'error',
      from: { pathNot: inPackages('renderer-vexflow') },
      to: { path: npm(...VEXFLOW) },
    },
    {
      name: 'spessasynth-only-in-its-adapter',
      comment:
        'ADR-004: replacing SpessaSynth must only touch packages/playback-spessasynth and composition wiring.',
      severity: 'error',
      from: { pathNot: inPackages('playback-spessasynth') },
      to: { path: npm(...SPESSASYNTH) },
    },
    {
      name: 'mcp-sdk-only-in-mcp-app',
      comment:
        'ADR-003: only the MCP inbound adapter (apps/mcp) knows the MCP SDK / MCP Apps packages.',
      severity: 'error',
      from: { pathNot: '^apps/mcp/' },
      to: { path: npm(...MCP_SDK) },
    },
    {
      name: 'react-only-in-ui-code',
      comment:
        'ADR-003/004: React lives in score-ui, the web app and the MCP View only (component tests run there).',
      severity: 'error',
      from: { pathNot: '^(packages/score-ui/|apps/web/|apps/mcp/view/)' },
      to: { path: npm(...REACT) },
    },
    {
      name: 'supabase-client-only-in-web',
      comment:
        'ADR-005: the Supabase SDK is the web auth adapter; servers verify JWTs through auth-jwt.',
      severity: 'error',
      from: { pathNot: '^apps/web/' },
      to: { path: npm(...SUPABASE) },
    },
    {
      name: 'inward-never-imports-adapters',
      comment: 'ADR-003: dependencies point inward; only apps (composition roots) import adapters.',
      severity: 'error',
      from: { path: inPackages(...INWARD) },
      to: { path: workspace(...ADAPTERS) },
    },
    {
      name: 'packages-never-import-apps',
      comment: 'ADR-003: apps compose packages, never the reverse.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(apps/|@sheet-music/(web|api|mcp)(/|$))' },
    },
    {
      name: 'apps-never-import-other-apps',
      comment: 'ADR-003: each app is its own composition root; MCP is not a proxy to the REST app.',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^(apps/|@sheet-music/(web|api|mcp)(/|$))', pathNot: '^apps/$1/' },
    },
    {
      name: 'browser-code-no-server-infrastructure',
      comment:
        'ADR-005: browser bundles (web, MCP View, score-ui) never contain server infrastructure or server-only secrets.',
      severity: 'error',
      from: { path: '^(apps/web/src/|apps/mcp/view/|packages/score-ui/)' },
      to: {
        path: [
          workspace('persistence-postgres', 'auth-jwt', 'server-common'),
          npm(...NEST, ...POSTGRES, ...HTTP_SERVER, ...JWT),
        ],
      },
    },
    {
      name: 'mcp-view-isolated-from-mcp-server',
      comment:
        'The View is bundled into a sandboxed iframe: it must not pull MCP server code, and vice versa.',
      severity: 'error',
      from: { path: '^apps/mcp/view/' },
      to: { path: '^apps/mcp/src/' },
    },
    {
      name: 'mcp-server-isolated-from-mcp-view',
      comment: 'The server serves the built View HTML; it never imports View source.',
      severity: 'error',
      from: { path: '^apps/mcp/src/' },
      to: { path: '^apps/mcp/view/' },
    },
    {
      name: 'test-fixtures-only-in-tests',
      comment: 'The fixture catalogue is test data: production code never imports it.',
      severity: 'error',
      from: { path: '^(apps|packages)/', pathNot: [NOT_PRODUCTION, inPackages('test-fixtures')] },
      to: { path: workspace('test-fixtures') },
    },
    {
      name: 'no-dev-dependencies-in-production',
      comment:
        'Production code never imports devDependencies (test tooling, build tools), its own or the root ones; tests and app build configs may.',
      severity: 'error',
      from: { path: '^(apps|packages)/', pathNot: NOT_PRODUCTION },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['npm'] },
    },
    {
      name: 'no-circular',
      comment: 'ADR-003: dependencies point one way; a cycle between modules defeats the layering.',
      severity: 'error',
      from: { path: '^(apps|packages)/' },
      to: { circular: true },
    },
    {
      name: 'no-unresolvable-imports',
      comment: 'An import that cannot be resolved hides its real target from every other rule.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-undeclared-dependencies',
      comment:
        'npm imports must be declared in the package manifest (or the root one for shared test tooling).',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Only the workspace's own build output. A broader pattern would also drop
    // every npm dependency whose entry point sits under dist/ (vitest, vite,
    // @testing-library/react, @supabase/supabase-js...) and hide it from every rule.
    exclude: { path: '^(apps|packages)/[^/]+/(dist|coverage)/' },
    // Keep type-only imports/exports in the graph: exposed types are dependencies too.
    tsPreCompilationDeps: true,
    // Declared = nearest package.json merged with the root one (shared test tooling).
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
      extensions: ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    },
    skipAnalysisNotInRules: true,
  },
};
