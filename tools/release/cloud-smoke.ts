/**
 * Release cloud smoke runner (docs/release/RELEASE_CHECKLIST.md, step 7).
 *
 *   CLOUD_E2E=1 <variables> node tools/release/cloud-smoke.ts [--out <report.json>]
 *
 * Runs the opt-in `cloud` Vitest project (tests/cloud: AUTH-UI-I01 #25 and
 * OAUTH-04 #26) against the deployed apps and the Supabase project named by
 * the environment, then prints an evidence block for docs/release/EVIDENCE.md:
 * date, commit, hosts (origins only), and every test with its status, first
 * failure line and recorded observations. Secrets are redacted from
 * everything it prints. The report files are written outside the repository
 * (default: the OS temporary directory), never committed.
 *
 * Node 24 runs this file directly (type stripping): it imports no local
 * TypeScript module. The pure functions are exported for its unit test.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Variables both suites need (values come from the runner's environment only). */
export const REQUIRED_VARIABLES = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'WEB_BASE_URL',
  'API_BASE_URL',
  'MCP_URL',
  'CLOUD_E2E_EMAIL',
] as const;

/** One of these holds the server-only admin key. */
export const ADMIN_KEY_VARIABLES = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

/** Origins recorded as the tested hosts. */
const HOST_VARIABLES = ['WEB_BASE_URL', 'API_BASE_URL', 'MCP_URL', 'SUPABASE_URL'] as const;

type Env = Readonly<Record<string, string | undefined>>;

/** Names (never values) of what is missing before a cloud run may start. */
export function missingVariables(env: Env): string[] {
  const missing: string[] = [];
  if (env['CLOUD_E2E'] !== '1') missing.push('CLOUD_E2E=1');
  for (const name of REQUIRED_VARIABLES) {
    if (!env[name]?.trim()) missing.push(name);
  }
  if (!ADMIN_KEY_VARIABLES.some((name) => env[name]?.trim())) {
    missing.push(ADMIN_KEY_VARIABLES.join(' or '));
  }
  return missing;
}

const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // JWTs (access, refresh-as-JWT, ID tokens, legacy service_role keys).
  [/eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g, '[redacted-jwt]'],
  // Supabase API keys.
  [/sb_(?:secret|publishable)_[\w-]+/g, '[redacted-key]'],
  // Credentials after an auth scheme; the parameters of a challenge stay readable.
  [
    /\b(Bearer|Basic)\s+(?!(?:resource_metadata|error|error_description|realm|scope)=)[\w.~+/=-]+/gi,
    '$1 [redacted]',
  ],
  // Query or form parameters and JSON fields that carry credentials.
  [
    /\b(access_token|refresh_token|id_token|provider_token|code|code_verifier|token|token_hash|authorization_id|password|client_secret|apikey)=[^&\s"'#]+/gi,
    '$1=[redacted]',
  ],
  [
    /"(access_token|refresh_token|id_token|provider_token|code_verifier|token|password|client_secret|action_link|hashed_token|email_otp)"\s*:\s*"[^"]*"/gi,
    '"$1":"[redacted]"',
  ],
];

/** Removes anything that looks like a credential from text meant for logs or evidence. */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}

/** The origin of a URL value, or a note that it is unset or unparsable (never the raw value). */
export function originOf(value: string | undefined): string {
  if (!value?.trim()) return '(unset)';
  try {
    return new URL(value).origin;
  } catch {
    return '(not a URL)';
  }
}

interface ReportTest {
  readonly fullName: string;
  readonly status: string;
  readonly duration?: number | null;
  readonly failureMessages: readonly string[];
  readonly meta?: { readonly evidence?: Readonly<Record<string, string>> };
}

interface ReportFile {
  readonly name: string;
  readonly assertionResults: readonly ReportTest[];
}

/** The part of Vitest's JSON report this tool reads. */
export interface VitestJsonReport {
  readonly testResults: readonly ReportFile[];
}

export interface RunFacts {
  readonly date: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly hosts: Readonly<Record<string, string>>;
}

/** Files of the suites against real services; the project's other files are the tooling's self-tests. */
const CLOUD_SUITE_FILE = /\.cloud\.test\.ts$/;

const cell = (text: string): string =>
  redactSecrets(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function counts(tests: readonly ReportTest[]): string {
  const count = (status: string) => tests.filter((test) => test.status === status).length;
  return `${tests.length} total, ${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped`;
}

/**
 * Markdown evidence block of one cloud run: facts, counts, then one row per
 * cloud-suite test (status, first failure line, recorded observations, or
 * why a step was blocked). The tooling's self-tests are only counted.
 */
export function evidenceMarkdown(report: VitestJsonReport, facts: RunFacts): string {
  const suites = report.testResults.filter((file) => CLOUD_SUITE_FILE.test(file.name));
  const suiteTests = suites.flatMap((file) => file.assertionResults);
  const selfTests = report.testResults
    .filter((file) => !CLOUD_SUITE_FILE.test(file.name))
    .flatMap((file) => file.assertionResults);
  const lines = [
    `Cloud smoke run ${facts.date}`,
    '',
    `- Commit: \`${facts.commit}\`${facts.dirty ? ' (working tree has uncommitted changes)' : ''}`,
    ...Object.entries(facts.hosts).map(([name, origin]) => `- ${name}: ${origin}`),
    `- Cloud suite tests: ${counts(suiteTests)}`,
    `- Tooling self-tests: ${counts(selfTests)}`,
    '',
    '| Test | Status | Detail |',
    '| --- | --- | --- |',
  ];
  for (const test of suiteTests) {
    const failure = test.failureMessages[0]?.split('\n')[0] ?? '';
    const evidence = Object.entries(test.meta?.evidence ?? {}).map(
      ([key, value]) => `${key}: ${value}`,
    );
    const detail = [failure, ...evidence].filter((part) => part !== '').join('; ');
    lines.push(`| ${cell(test.fullName)} | ${test.status} | ${cell(detail)} |`);
  }
  return `${lines.join('\n')}\n`;
}

function git(args: readonly string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function main(argv: readonly string[]): number {
  const missing = missingVariables(process.env);
  if (missing.length > 0) {
    console.error(`Refusing to start the cloud smoke. Missing: ${missing.join(', ')}.`);
    return 2;
  }
  const outIndex = argv.indexOf('--out');
  const out =
    outIndex >= 0 && argv[outIndex + 1]
      ? String(argv[outIndex + 1])
      : join(tmpdir(), `sheet-music-cloud-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const run = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      '--project',
      'cloud',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${out}`,
    ],
    { stdio: 'inherit', env: process.env },
  );
  let report: VitestJsonReport;
  try {
    report = JSON.parse(readFileSync(out, 'utf8')) as VitestJsonReport;
  } catch {
    console.error('The Vitest JSON report was not written; see the output above.');
    return run.status ?? 1;
  }
  const facts: RunFacts = {
    date: new Date().toISOString(),
    commit: git(['rev-parse', 'HEAD']) || '(unknown)',
    dirty: git(['status', '--porcelain']) !== '',
    hosts: Object.fromEntries(HOST_VARIABLES.map((name) => [name, originOf(process.env[name])])),
  };
  const markdown = evidenceMarkdown(report, facts);
  writeFileSync(`${out}.md`, markdown);
  console.log(`\n${markdown}\nEvidence written to ${out}.md`);
  console.log(
    `The raw report ${out} is not redacted (failure messages may quote one-time links): delete it once the evidence is copied.`,
  );
  return run.status ?? 1;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
