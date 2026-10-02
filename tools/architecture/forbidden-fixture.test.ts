import { fileURLToPath } from 'node:url';
import { cruise, type IViolation } from 'dependency-cruiser';
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * CI-02: proves the real rule set (.dependency-cruiser.cjs) rejects deliberately
 * forbidden imports. The fixture mirrors the repository layout and ships tiny
 * stub packages in its own node_modules so resolution is deterministic.
 */
const configFile = fileURLToPath(new URL('../../.dependency-cruiser.cjs', import.meta.url));
// No trailing slash: dependency-cruiser rejects a baseDir ending with a separator.
const fixtureRoot = fileURLToPath(new URL('./fixtures/forbidden', import.meta.url));

let violations: IViolation[] = [];

beforeAll(async () => {
  const options = await extractDepcruiseOptions(configFile);
  const { output } = await cruise(['packages'], { ...options, baseDir: fixtureRoot });
  if (typeof output === 'string') {
    throw new Error('Expected a structured cruise result');
  }
  violations = output.summary.violations;
});

const targetsOf = (from: string, rule: string): string[] =>
  violations.filter((v) => v.from === from && v.rule.name === rule).map((v) => v.to);

describe('architecture rules on the forbidden fixture', () => {
  it.each([
    {
      shape: 'a type-only React import in music-domain',
      from: 'packages/music-domain/src/type-only-import.ts',
      rule: 'domain-stays-pure',
      to: 'node_modules/react/index.js',
    },
    {
      shape: 'React reached through an npm alias in music-domain',
      from: 'packages/music-domain/src/aliased-import.ts',
      rule: 'domain-stays-pure',
      to: 'node_modules/react/index.js',
    },
    {
      shape: 'a VexFlow re-export from renderer-core',
      from: 'packages/renderer-core/src/reexport.ts',
      rule: 'renderer-core-no-vexflow',
      to: 'node_modules/vexflow/index.js',
    },
    {
      shape: 'an adapter reached by relative path from music-application',
      from: 'packages/music-application/src/imports-adapter.ts',
      rule: 'inward-never-imports-adapters',
      to: 'packages/renderer-vexflow/src/index.ts',
    },
    {
      shape: 'a sideways relative import from renderer-core into music-application',
      from: 'packages/renderer-core/src/imports-application.ts',
      rule: 'renderer-core-allowed-workspace-dependencies',
      to: 'packages/music-application/src/index.ts',
    },
    {
      shape: 'a devDependency (entry point under dist/) imported by production code',
      from: 'packages/music-domain/src/dev-dependency.ts',
      rule: 'no-dev-dependencies-in-production',
      to: 'node_modules/test-runner/dist/index.js',
    },
    {
      shape: 'a Radix primitive re-exported by score-ui instead of the design system',
      from: 'packages/score-ui/src/imports-radix.ts',
      rule: 'radix-only-in-ui-package',
      to: 'node_modules/radix-ui/index.js',
    },
    {
      shape: 'two modules importing each other',
      from: 'packages/music-domain/src/cycle-a.ts',
      rule: 'no-circular',
      to: 'packages/music-domain/src/cycle-b.ts',
    },
  ])('rejects $shape', ({ from, rule, to }) => {
    expect(targetsOf(from, rule)).toEqual([to]);
  });

  it('accepts domain code that only imports domain code', () => {
    const compliant = violations.filter((v) =>
      v.from.startsWith('packages/music-domain/src/compliant'),
    );
    expect(compliant).toEqual([]);
  });

  it('accepts the design system (packages/ui) importing Radix', () => {
    const designSystem = violations.filter((v) => v.from.startsWith('packages/ui/'));
    expect(designSystem).toEqual([]);
  });

  it('accepts a test importing a devDependency', () => {
    const tests = violations.filter((v) => v.from.startsWith('packages/music-domain/test/'));
    expect(tests).toEqual([]);
  });
});
