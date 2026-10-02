# Continuous integration and merge checks

Issue #17 (CI-01..CI-06). The workflow is `.github/workflows/ci.yml`; the
test categories and ownership come from [TEST_PLAN.md](TEST_PLAN.md), the
cross-app suites from [ACCEPTANCE.md](ACCEPTANCE.md).

## 1. Jobs

| Check name (job)                                                         | Runs when                                                  | What it runs                                                                                                                                                       | Covers                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `Detect code changes` (`changes`)                                        | always                                                     | decides `code` and `mcp_ui` from the changed files (§2)                                                                                                            | TEST_PLAN §8                 |
| `Documentation format` (`docs`)                                          | documentation-only change                                  | frozen install, `prettier --check .`                                                                                                                               | cheap docs changes           |
| `Typecheck, lint, build, unit/component tests, architecture` (`quality`) | any code change                                            | frozen install, `pnpm typecheck`, `tsc -p tests/acceptance/tsconfig.json`, `tsc -p tests/cloud/tsconfig.json`, `pnpm lint`, `pnpm build` (web, api, mcp independently), `pnpm test`, the release tooling's offline tests (`vitest run --project cloud tests/cloud/support tools/release`), `pnpm check:arch` | CI-01, CI-02, CI-04 manifest, release tooling |
| `Integration (Postgres)` (`integration`)                                 | any code change                                            | `pnpm test:integration` (every `*.int.test.ts`: apps, packages, `tests/acceptance`) against a `postgres:15` service, one worker, files serially                    | CI-03, CI-04 surface         |
| `Deployment configuration (DEPLOY-01)` (`deploy`)                        | any code change                                            | frozen install, `pnpm check:deploy` (each Vercel project built with its `vercel.json` command, client output scanned, serverless entries served locally) against a `postgres:15` service | DEPLOY-01 (#16)              |
| `MCP-UI integration (Chromium)` (`mcp-ui`)                               | a change the suite depends on, a manual run, a release tag | frozen install, Playwright Chromium, `pnpm build`, `pnpm test:mcp-ui` (every `*.mcpui.test.ts`), one browser worker, `postgres:15` service                         | CI-05                        |

- Real failures fail the job; no step is `continue-on-error`. No test is
  skipped today (`.skip`, `.todo`, `skipIf`), and a skipped test is not
  coverage; Vitest refuses `.only` when `CI` is set. The cloud suites of
  `tests/cloud` (AUTH-UI-I01, OAUTH-04), which skip without `CLOUD_E2E=1`,
  are typechecked but not run: they need the deployed apps (release only,
  RELEASE_CHECKLIST.md step 7).
- Integration, deploy and MCP-UI each get their own throwaway Postgres
  container (one database stack per job). Test files run one at a time in one worker
  (`vitest.config.ts`) and each closes its apps, servers and pools.
- `pnpm test:integration` / `pnpm test:mcp-ui` are called as
  `pnpm exec vitest run --project <p>` with an extra JUnit reporter, so a
  failure can upload its report (§4).

## 2. What triggers what (CI-05)

- **Documentation-only** change (every file under `docs/` or `*.md`): only
  `Documentation format`. No build, no database, no browser.
- **Any other change**: `quality`, `integration` and `deploy`. Shared
  contracts, auth, migrations and the lockfile therefore always run every
  dependent integration suite, and a change that breaks a Vercel build or
  a serverless entry fails before a release.
- **MCP-UI** runs when a changed non-Markdown file is under `apps/mcp/`,
  `packages/` (every workspace package reaches the MCP server or the View:
  contracts, domain, renderer, playback, score-ui, auth, persistence,
  fixtures), `assets/` (SoundFont), `supabase/` (migrations), or is
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`,
  `vitest.config.ts`, `tsconfig.json`, `tsconfig.base.json`, `.nvmrc` or the
  workflow itself. A change confined to `apps/web`, `apps/api`, `tests/`,
  `tools/` or lint configuration does not start the browser.
- **Pre-release / full run**: a pushed `v*` tag, a manual run
  (`workflow_dispatch`) or an unknown diff base runs every job, MCP-UI
  included (TEST_PLAN §8: full integration including MCP-UI before release).

## 3. Required merge checks (manual GitHub setting)

A workflow existing is not proof that anything is enforced. Branch
protection is a repository setting that only a maintainer can change; this
change does NOT configure it. On `main`, configure (Settings > Rules >
Rulesets, or Branches > Branch protection rules):

1. Require a pull request before merging, with one approving review.
2. Require status checks to pass, and require branches to be up to date.
3. Required checks (exact names as GitHub lists them after one run):
   - `Detect code changes`
   - `Documentation format`
   - `Typecheck, lint, build, unit/component tests, architecture`
   - `Integration (Postgres)`
   - `Deployment configuration (DEPLOY-01)`
   - `MCP-UI integration (Chromium)`
4. Block force pushes and deletions of `main`.

Notes:

- A job skipped by its condition reports success, so requiring all six is
  safe: a documentation-only PR passes with `quality`/`integration`/`deploy`/`mcp-ui`
  skipped, and a code PR passes with `Documentation format` skipped.
- `Detect code changes` must be required too: if it failed, the jobs that
  depend on it would be skipped, and a skipped required check counts as
  passing.
- Renaming a job changes its check name; update the rule in the same change.
- Until the rule is configured, record it as unverified in release notes.

## 4. Test data, secrets and artifacts (CI-06)

- **No secret is used.** The workflow reads no repository secret, and its
  token is `contents: read`. The Postgres credentials are those of a
  throwaway service container. Tokens come from the local test issuer
  (`@sheet-music/auth-jwt/testing`), keys generated in memory per run. No
  Supabase cloud project, production database, real tester account, paid
  LLM call or email is reached from CI.
- **Artifacts on failure only** (`if: failure()`, kept 7 days):
  `integration-report` (JUnit XML of the integration run) and
  `mcp-ui-report` (JUnit XML and Vitest's failure screenshots under
  `__screenshots__/`). They contain test names, assertion messages, stack
  traces and screenshots of test fixtures: no secret, no user data. Logs of
  the apps under test go to the test harness, never to an artifact, and are
  redacted by server-common anyway.
- **No automatic acceptance.** The suites use no snapshot or reference
  images; no job runs Vitest with `-u`, and Vitest writes no new snapshot in
  CI. A changed expectation is a reviewed code change.
- **Dependency upgrades are reviewed changes.** Versions are exact pins in
  the `pnpm-workspace.yaml` catalog; `pnpm install --frozen-lockfile` fails
  on any drift. A lockfile change runs every job, MCP-UI included. No bot
  merges upgrades.

## 5. Not covered by CI

- The target-host compatibility smoke (TEST_PLAN §8, MCP_UI_TEST_PROCESS):
  a real MCP host with the real Supabase OAuth flow is a manual release
  check; CI does not prove it.
- Deployment (#16) and the real Supabase project: CI proves the deployment
  configuration locally (DEPLOY-01), never a deployment (DEPLOY-02 is a
  release step).

## 6. Checking the workflow locally

`actionlint .github/workflows/ci.yml` (with `shellcheck` on the `PATH`, it
also checks the `run:` scripts). The same commands as CI:

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm exec tsc -p tests/acceptance/tsconfig.json && pnpm exec tsc -p tests/cloud/tsconfig.json
pnpm lint && pnpm build && pnpm test
pnpm exec vitest run --project cloud tests/cloud/support tools/release && pnpm check:arch
pnpm test:integration          # TEST_DATABASE_URL, databases named sheet_music_* only
pnpm check:deploy              # same server; database sheet_music_test_deploy
pnpm exec playwright install chromium && pnpm test:mcp-ui
```
