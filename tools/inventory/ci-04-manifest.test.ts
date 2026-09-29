/**
 * CI-04 (#17), manifest half: every entry of the reviewed public-surface
 * manifest points at existing test files that name the covering tests, with
 * at least one integration-level test per entry; and the comparison used by
 * tests/acceptance/ci-04-exposed-surface.int.test.ts fails on an unlisted or
 * a stale entry. Runs without a database (unit project).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type ExposedSurface,
  PUBLIC_SURFACE,
  SURFACE_GROUPS,
  type SurfaceManifest,
  referenceProblems,
  surfaceProblems,
} from './inventory';

const REPO_ROOT = new URL('../../', import.meta.url);

function readRepoFile(file: string): string | undefined {
  try {
    return readFileSync(new URL(file, REPO_ROOT), 'utf8');
  } catch {
    return undefined;
  }
}

function emptyExposed(): Record<(typeof SURFACE_GROUPS)[number], string[]> {
  return {
    'mcp.tools': [],
    'mcp.resources': [],
    'mcp.resourceTemplates': [],
    'mcp.prompts': [],
    'mcp.http': [],
    'api.http': [],
  };
}

function manifestWith(
  group: (typeof SURFACE_GROUPS)[number],
  entries: SurfaceManifest[typeof group],
) {
  const manifest: Record<string, SurfaceManifest[typeof group]> = {};
  for (const name of SURFACE_GROUPS) {
    manifest[name] = name === group ? entries : {};
  }
  return manifest as SurfaceManifest;
}

describe('CI-04 the reviewed manifest', () => {
  it('references, for every entry, existing test files that name their tests, one of them integration-level', () => {
    expect(referenceProblems(PUBLIC_SURFACE, readRepoFile)).toEqual([]);
  });

  it('lists the five product tools and the two protected saved routes', () => {
    expect(Object.keys(PUBLIC_SURFACE['mcp.tools']).sort()).toEqual([
      'create_score',
      'edit_score',
      'get_score',
      'save_score',
      'search_scores',
    ]);
    expect(Object.keys(PUBLIC_SURFACE['api.http'])).toEqual(
      expect.arrayContaining(['GET /scores', 'GET /scores/:id']),
    );
  });
});

describe('CI-04 the checks fail when they must', () => {
  const INT_TEST = 'apps/mcp/test/mcp-create-score.int.test.ts';
  const UNIT_TEST = 'apps/mcp/test/mcp-config-01.test.ts';

  it('reports an exposed entry missing from the manifest, and a listed entry no longer exposed', () => {
    const manifest = manifestWith('mcp.tools', {
      create_score: { tests: [{ file: INT_TEST, ids: ['MCP-CREATE-01'] }] },
      retired_tool: { tests: [{ file: INT_TEST, ids: ['MCP-CREATE-01'] }] },
    });
    const exposed: ExposedSurface = {
      ...emptyExposed(),
      'mcp.tools': ['create_score', 'delete_score'],
    };

    expect(surfaceProblems(manifest, exposed)).toEqual([
      'mcp.tools "delete_score": exposed but not in the manifest',
      'mcp.tools "retired_tool": in the manifest but not exposed',
    ]);
  });

  it('accepts a manifest equal to the exposed surface', () => {
    const manifest = manifestWith('api.http', {
      'GET /health': { tests: [{ file: INT_TEST, ids: ['MCP-CREATE-01'] }] },
    });

    expect(surfaceProblems(manifest, { ...emptyExposed(), 'api.http': ['GET /health'] })).toEqual(
      [],
    );
  });

  it.each([
    {
      case: 'no reference at all',
      tests: [],
      problem: 'api.http "GET /x": no test reference',
    },
    {
      case: 'a test file that does not exist',
      tests: [{ file: 'apps/api/test/gone.int.test.ts', ids: ['GONE-01'] }],
      problem: 'api.http "GET /x": apps/api/test/gone.int.test.ts does not exist',
    },
    {
      case: 'a test ID the file does not contain',
      tests: [{ file: INT_TEST, ids: ['MCP-CREATE-99'] }],
      problem: `api.http "GET /x": ${INT_TEST} does not contain MCP-CREATE-99`,
    },
    {
      case: 'a reference naming no test',
      tests: [{ file: INT_TEST, ids: [] }],
      problem: `api.http "GET /x": ${INT_TEST} names no test ID`,
    },
    {
      case: 'a file that is not a test',
      tests: [
        { file: INT_TEST, ids: ['MCP-CREATE-01'] },
        { file: 'apps/mcp/src/app.ts', ids: ['MCP_PATH'] },
      ],
      problem: 'api.http "GET /x": apps/mcp/src/app.ts is not a test file',
    },
    {
      case: 'unit tests only',
      tests: [{ file: UNIT_TEST, ids: ['MCP-CONFIG-01'] }],
      problem: 'api.http "GET /x": no integration-level (*.int.test / *.mcpui.test) reference',
    },
  ])('rejects an entry with $case', ({ tests, problem }) => {
    const manifest = manifestWith('api.http', { 'GET /x': { tests } });

    expect(referenceProblems(manifest, readRepoFile)).toEqual([problem]);
  });
});
