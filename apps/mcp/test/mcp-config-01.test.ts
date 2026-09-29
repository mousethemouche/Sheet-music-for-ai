/**
 * MCP-CONFIG-01: the MCP server's configuration is validated at start and
 * fails safely (MCP_SERVER.md §7, AUTH_MCP_OAUTH.md §4).
 *
 * - A complete environment gives the canonical resource and the defaults
 *   (resource-bound audience, port 3001, no browser origin, no proxy).
 * - Missing or invalid variables are all reported by NAME; no value (a
 *   database password, a URL) appears in the error.
 * - The interim audience is only the exact explicit value; anything else is
 *   refused, never a fallback to a weaker check.
 */
import { describe, expect, it } from 'vitest';
import { McpConfigError, loadMcpConfig } from '../src/config';

const VALID = {
  MCP_PUBLIC_URL: 'HTTPS://MCP.Example.com/mcp',
  SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  DATABASE_URL: 'postgresql://server_role:db-password-123@db.example.com:6543/postgres',
};

function problemsOf(env: Record<string, string>): readonly string[] {
  try {
    loadMcpConfig(env);
  } catch (error) {
    if (error instanceof McpConfigError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('Expected McpConfigError');
}

describe('MCP-CONFIG-01 a complete environment', () => {
  it('gives the canonical resource and safe defaults', () => {
    expect(loadMcpConfig(VALID)).toEqual({
      publicUrl: 'https://mcp.example.com/mcp',
      supabaseUrl: VALID.SUPABASE_URL,
      databaseUrl: VALID.DATABASE_URL,
      allowedOrigins: [],
      audienceMode: 'resource',
      trustProxyHops: 0,
      port: 3001,
    });
  });

  it('reads the optional variables', () => {
    expect(
      loadMcpConfig({
        ...VALID,
        MCP_ALLOWED_ORIGINS: 'https://app.example.com, http://localhost:5173',
        MCP_AUTH_AUDIENCE_MODE: 'interim-authenticated',
        MCP_TRUST_PROXY_HOPS: '1',
        PORT: '8080',
        MCP_VIEW_HTML_PATH: 'dist/view/index.html',
      }),
    ).toMatchObject({
      allowedOrigins: ['https://app.example.com', 'http://localhost:5173'],
      audienceMode: 'interim-authenticated',
      trustProxyHops: 1,
      port: 8080,
      viewHtmlPath: 'dist/view/index.html',
    });
  });
});

describe('MCP-CONFIG-01 invalid environments fail by variable name, without values', () => {
  it('lists every missing required variable', () => {
    expect(problemsOf({ MCP_PUBLIC_URL: ' ' })).toEqual([
      'MCP_PUBLIC_URL is required.',
      'SUPABASE_URL is required.',
      'DATABASE_URL is required.',
    ]);
  });

  it.each([
    { name: 'DATABASE_URL', value: 'mysql://root:db-password-123@db.example.com/scores' },
    { name: 'MCP_PUBLIC_URL', value: 'http://mcp.example.com/mcp' },
    { name: 'MCP_PUBLIC_URL', value: 'https://mcp.example.com/api/mcp' },
    { name: 'MCP_PUBLIC_URL', value: 'https://mcp.example.com/mcp?tenant=secret-tenant' },
    { name: 'SUPABASE_URL', value: 'https://abcdefghijklmnop.supabase.co/auth/v1' },
    { name: 'MCP_ALLOWED_ORIGINS', value: 'https://app.example.com/,*' },
    { name: 'PORT', value: '80a' },
    { name: 'MCP_TRUST_PROXY_HOPS', value: '-1' },
  ])('refuses $name=$value naming only the variable', ({ name, value }) => {
    let thrown: unknown;
    try {
      loadMcpConfig({ ...VALID, [name]: value });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(McpConfigError);
    const { problems, message } = thrown as McpConfigError;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^${name} `));
    expect(message).not.toContain(value);
    expect(message).not.toContain('db-password-123');
  });

  it.each(['authenticated', 'RESOURCE', 'none', 'interim'])(
    'refuses MCP_AUTH_AUDIENCE_MODE=%s instead of falling back',
    (mode) => {
      expect(problemsOf({ ...VALID, MCP_AUTH_AUDIENCE_MODE: mode })).toEqual([
        'MCP_AUTH_AUDIENCE_MODE must be one of: resource, interim-authenticated.',
      ]);
    },
  );
});
