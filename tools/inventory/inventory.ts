/**
 * Public-surface inventory (CI-04 of #17, HARNESS-01 of #18): a reviewed
 * manifest (public-surface.json) of every public entry point of the MCP
 * server and of the HTTP API, each pointing at the executable tests that
 * cover it. Two checks use this module:
 *
 * - tools/inventory/ci-04-manifest.test.ts (unit): every reference names an
 *   existing test file that contains the named test IDs, and every entry has
 *   at least one integration-level test;
 * - tests/acceptance/ci-04-exposed-surface.int.test.ts (integration): the
 *   manifest equals what the booted production applications expose.
 *
 * It proves that no entry point is forgotten, not that a listed one is
 * correct (docs/testing/TEST_PLAN.md §5). This file imports no application
 * code: the root tsconfig type-checks tools/** with options the apps' own
 * sources do not compile under.
 */
import { METHODS } from 'node:http';
import manifestFile from './public-surface.json';

/** Groups of entry points, one per discovery method. */
export const SURFACE_GROUPS = [
  'mcp.tools',
  'mcp.resources',
  'mcp.resourceTemplates',
  'mcp.prompts',
  'mcp.http',
  'api.http',
] as const;

export type SurfaceGroup = (typeof SURFACE_GROUPS)[number];

/** A test file (repository-relative path) and the test IDs in it that cover the entry. */
export interface TestReference {
  readonly file: string;
  readonly ids: readonly string[];
}

export interface SurfaceEntry {
  readonly tests: readonly TestReference[];
  /**
   * HTTP entries served by a mounted Express router rather than a route
   * (static files): a path the router answers, used to recognize it.
   */
  readonly mount?: string;
}

export type SurfaceManifest = Readonly<
  Record<SurfaceGroup, Readonly<Record<string, SurfaceEntry>>>
>;

/** What the running applications expose: entry keys per group. */
export type ExposedSurface = Readonly<Record<SurfaceGroup, readonly string[]>>;

/** The reviewed manifest (the JSON's shape is checked by the compiler through this annotation). */
export const PUBLIC_SURFACE: SurfaceManifest = manifestFile.surfaces;

const TEST_FILE = /\.(int\.|mcpui\.)?test\.tsx?$/;
const INTEGRATION_TEST_FILE = /\.(int|mcpui)\.test\.tsx?$/;

/**
 * Problems of the manifest's test references. `readText` returns a
 * repository file's content, or undefined when it does not exist.
 */
export function referenceProblems(
  manifest: SurfaceManifest,
  readText: (file: string) => string | undefined,
): string[] {
  const problems: string[] = [];
  for (const group of SURFACE_GROUPS) {
    for (const [key, entry] of Object.entries(manifest[group])) {
      const where = `${group} "${key}"`;
      if (entry.tests.length === 0) {
        problems.push(`${where}: no test reference`);
        continue;
      }
      if (!entry.tests.some((test) => INTEGRATION_TEST_FILE.test(test.file))) {
        problems.push(`${where}: no integration-level (*.int.test / *.mcpui.test) reference`);
      }
      for (const { file, ids } of entry.tests) {
        if (!TEST_FILE.test(file)) {
          problems.push(`${where}: ${file} is not a test file`);
          continue;
        }
        const content = readText(file);
        if (content === undefined) {
          problems.push(`${where}: ${file} does not exist`);
          continue;
        }
        if (ids.length === 0) {
          problems.push(`${where}: ${file} names no test ID`);
        }
        for (const id of ids) {
          if (!content.includes(id)) {
            problems.push(`${where}: ${file} does not contain ${id}`);
          }
        }
      }
    }
  }
  return problems;
}

/** Differences between the manifest and the exposed surface, both ways. */
export function surfaceProblems(manifest: SurfaceManifest, exposed: ExposedSurface): string[] {
  const problems: string[] = [];
  for (const group of SURFACE_GROUPS) {
    const listed = new Set(Object.keys(manifest[group]));
    const actual = new Set(exposed[group]);
    for (const key of [...actual].sort()) {
      if (!listed.has(key)) {
        problems.push(`${group} "${key}": exposed but not in the manifest`);
      }
    }
    for (const key of [...listed].sort()) {
      if (!actual.has(key)) {
        problems.push(`${group} "${key}": in the manifest but not exposed`);
      }
    }
  }
  return problems;
}

/** The `mount` probe path of every entry of a group that has one. */
export function mountProbes(entries: Readonly<Record<string, SurfaceEntry>>): Map<string, string> {
  const probes = new Map<string, string>();
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.mount !== undefined) {
      probes.set(key, entry.mount);
    }
  }
  return probes;
}

// Express 5 (router 2.x) keeps each route's path and methods, but a mounted
// middleware keeps only a matcher function, not its mount path.
interface Layer {
  readonly route?: { readonly path: unknown; readonly methods: Readonly<Record<string, boolean>> };
  readonly handle?: unknown;
  readonly matchers?: readonly ((path: string) => unknown)[];
}

function stackOf(value: unknown): readonly Layer[] | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  const stack: unknown = (value as { stack?: unknown }).stack;
  return Array.isArray(stack) ? (stack as Layer[]) : undefined;
}

function answers(stack: readonly Layer[], path: string): boolean {
  return stack.some(
    (layer) =>
      layer.matchers?.some((match) => match(path) !== false) === true ||
      answers(stackOf(layer.handle) ?? [], path),
  );
}

const ALL_METHODS = METHODS.map((method) => method.toLowerCase());

/**
 * The HTTP entries of an Express 5 app, as `METHOD path`:
 * - every route (`app.get`, `app.post`...); a route on every method
 *   (`app.all`) is `ALL path`;
 * - every mounted router (`app.use(router)`), recognized by the manifest
 *   entry whose `mount` path it answers; an unrecognized one is reported as
 *   `MOUNT <unrecognized router N>` so the comparison fails;
 * - plain middleware (protection, error handlers) is not an entry point.
 */
export function expressEntries(app: unknown, probes: ReadonlyMap<string, string>): string[] {
  const stack = stackOf((app as { router?: unknown }).router);
  if (stack === undefined) {
    throw new Error('Not an Express 5 application (no router stack).');
  }
  const entries = new Set<string>();
  let unrecognized = 0;
  for (const layer of stack) {
    if (layer.route !== undefined) {
      const { path, methods } = layer.route;
      if (typeof path !== 'string') {
        throw new Error('Only string route paths are supported by the inventory.');
      }
      if (ALL_METHODS.every((method) => methods[method] === true)) {
        entries.add(`ALL ${path}`);
      } else {
        for (const [method, enabled] of Object.entries(methods)) {
          if (enabled) {
            entries.add(`${method.toUpperCase()} ${path}`);
          }
        }
      }
      continue;
    }
    const router = stackOf(layer.handle);
    if (router === undefined) {
      continue;
    }
    const claimed = [...probes].find(([, probe]) => answers(router, probe));
    if (claimed === undefined) {
      unrecognized += 1;
      entries.add(`MOUNT <unrecognized router ${unrecognized}>`);
    } else {
      entries.add(claimed[0]);
    }
  }
  return [...entries].sort();
}
