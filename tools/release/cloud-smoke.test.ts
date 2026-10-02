/**
 * The release cloud smoke runner's own decisions: when it refuses to start,
 * what it redacts, and the evidence block it prints. No network, no Vitest
 * child process: runs in the opt-in `cloud` project, with or without cloud
 * variables.
 */
import { describe, expect, it } from 'vitest';
import {
  type VitestJsonReport,
  evidenceMarkdown,
  missingVariables,
  originOf,
  redactSecrets,
} from './cloud-smoke';

const COMPLETE_ENV = {
  CLOUD_E2E: '1',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  SUPABASE_SECRET_KEY: 'sb_secret_example',
  WEB_BASE_URL: 'https://web.example.org',
  API_BASE_URL: 'https://api.example.org',
  MCP_URL: 'https://mcp.example.org/mcp',
  CLOUD_E2E_EMAIL: 'smoke@sink.example.org',
};

describe('cloud smoke: refusing to start', () => {
  it('starts when the opt-in and every variable are present', () => {
    expect(missingVariables(COMPLETE_ENV)).toEqual([]);
  });

  it('accepts the legacy service_role key instead of the secret key', () => {
    expect(
      missingVariables({
        ...COMPLETE_ENV,
        SUPABASE_SECRET_KEY: undefined,
        SUPABASE_SERVICE_ROLE_KEY: 'legacy',
      }),
    ).toEqual([]);
  });

  it('names what is missing, never a value, including the opt-in itself', () => {
    expect(
      missingVariables({
        ...COMPLETE_ENV,
        CLOUD_E2E: 'true',
        MCP_URL: ' ',
        SUPABASE_SECRET_KEY: '',
      }),
    ).toEqual(['CLOUD_E2E=1', 'MCP_URL', 'SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY']);
  });
});

describe('cloud smoke: redaction', () => {
  it.each([
    [
      'a JWT',
      'token eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl here',
      'token [redacted-jwt] here',
    ],
    ['a secret key', 'apikey sb_secret_AbC-123_x', 'apikey [redacted-key]'],
    ['a publishable key', 'sb_publishable_Zz9', '[redacted-key]'],
    [
      'a bearer credential',
      'Authorization: Bearer abc.def-ghi',
      'Authorization: Bearer [redacted]',
    ],
    [
      'a callback URL with a code',
      'http://127.0.0.1:53682/callback?code=0f1e2d&state=s1',
      'http://127.0.0.1:53682/callback?code=[redacted]&state=s1',
    ],
    [
      'a consent URL and a verify link',
      'https://web.example.org/oauth/consent?authorization_id=a1b2 https://x.supabase.co/auth/v1/verify?token=t1&type=signup#access_token=eyJ',
      'https://web.example.org/oauth/consent?authorization_id=[redacted] https://x.supabase.co/auth/v1/verify?token=[redacted]&type=signup#access_token=[redacted]',
    ],
    [
      'form parameters',
      'refresh_token=r1&code_verifier=v1&client_secret=c1',
      'refresh_token=[redacted]&code_verifier=[redacted]&client_secret=[redacted]',
    ],
    [
      'JSON credential fields',
      '{"access_token":"a1","action_link":"https://x/verify?token=t","password":"p"}',
      '{"access_token":"[redacted]","action_link":"[redacted]","password":"[redacted]"}',
    ],
  ])('removes %s', (_case, input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('keeps challenge parameters, error codes and envelope codes readable', () => {
    const text =
      'Bearer resource_metadata="https://mcp.example.org/.well-known/oauth-protected-resource/mcp", error="invalid_token"; error_code=email_address_not_authorized; {"code":"UNAUTHENTICATED"}';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('cloud smoke: evidence block', () => {
  const report: VitestJsonReport = {
    testResults: [
      {
        name: '/repo/tests/cloud/oauth-04-provider.cloud.test.ts',
        assertionResults: [
          {
            fullName: 'OAUTH-04 token exchange',
            status: 'passed',
            duration: 812,
            failureMessages: [],
            meta: { evidence: { 'refresh token rotated': 'yes', expires_in: '3600' } },
          },
          {
            fullName: 'OAUTH-04 audience | hook',
            status: 'failed',
            failureMessages: [
              'Error: aud lacks the MCP resource for token eyJhbGciOiJFUzI1NiJ9.eyJhIjoxfQ.sig\n    at stack line',
            ],
          },
          {
            fullName: 'OAUTH-04 MCP accepts the token',
            status: 'skipped',
            failureMessages: [],
            meta: { evidence: { skipped: 'blocked: "token" failed in "token exchange"' } },
          },
        ],
      },
      {
        name: '/repo/tests/cloud/support/cloud-support.test.ts',
        assertionResults: [
          { fullName: 'cloud gate: opt-in is off', status: 'passed', failureMessages: [] },
          { fullName: 'OAuth client pieces PKCE', status: 'passed', failureMessages: [] },
        ],
      },
    ],
  };
  const markdown = evidenceMarkdown(report, {
    date: '2026-09-29T10:00:00.000Z',
    commit: 'abc1234',
    dirty: true,
    hosts: { WEB_BASE_URL: 'https://web.example.org', MCP_URL: 'https://mcp.example.org' },
  });

  it('records the commit, a dirty tree, the hosts and the counts of suites and self-tests apart', () => {
    expect(markdown).toContain('- Commit: `abc1234` (working tree has uncommitted changes)');
    expect(markdown).toContain('- WEB_BASE_URL: https://web.example.org');
    expect(markdown).toContain('- MCP_URL: https://mcp.example.org');
    expect(markdown).toContain('- Cloud suite tests: 3 total, 1 passed, 1 failed, 1 skipped');
    expect(markdown).toContain('- Tooling self-tests: 2 total, 2 passed, 0 failed, 0 skipped');
  });

  it('lists each cloud-suite test with its status, observations and redacted first failure line', () => {
    expect(markdown).toContain(
      '| OAUTH-04 token exchange | passed | refresh token rotated: yes; expires_in: 3600 |',
    );
    expect(markdown).toContain(
      '| OAUTH-04 audience \\| hook | failed | Error: aud lacks the MCP resource for token [redacted-jwt] |',
    );
    expect(markdown).toContain(
      '| OAUTH-04 MCP accepts the token | skipped | skipped: blocked: "token" failed in "token exchange" |',
    );
    expect(markdown).not.toContain('at stack line');
    expect(markdown).not.toContain('PKCE');
  });
});

describe('cloud smoke: hosts', () => {
  it.each([
    ['https://mcp.example.org/mcp?x=1', 'https://mcp.example.org'],
    [undefined, '(unset)'],
    ['not a url', '(not a URL)'],
  ])('records %s as %s', (value, expected) => {
    expect(originOf(value)).toBe(expected);
  });
});
