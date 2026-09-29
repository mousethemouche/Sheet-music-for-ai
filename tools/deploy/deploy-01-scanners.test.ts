/**
 * DEPLOY-01 scanners (issue #16): the client-output checks of
 * deploy-01.int.test.ts pass when nothing is found, so these cases prove each
 * scanner and route matcher does find what it looks for.
 */
import { describe, expect, it } from 'vitest';
import { sourceMatches } from './local-vercel';
import {
  LIBRARY_LOOPBACK_URLS,
  findWorkletPath,
  parseCsp,
  secretFindings,
  unexpectedLoopbackUrls,
} from './verify-deployment';

describe('DEPLOY-01 secret scanner', () => {
  it.each([
    ['service-role name', 'role:"service_role"', 'service_role'],
    ['Supabase secret key', 'key="sb_secret_AbCdEf0123456789"', 'Supabase secret key'],
    [
      'legacy JWT key',
      'k="eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlMDEy"',
      'JWT',
    ],
    ['service key variable', 'env.SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE*'],
    ['private key', '-----BEGIN EC PRIVATE KEY-----\nMHcC', 'private key'],
    ['Postgres URL', 'u="postgresql://login:pw@db.example.test:6543/postgres"', 'Postgres URL'],
  ])('finds a %s', (_label, text, name) => {
    expect(secretFindings(text)).toEqual([name]);
  });

  it('finds a canary value from the build environment', () => {
    expect(secretFindings('x="canary-value-1"', ['canary-value-1'])).toEqual(['canary']);
  });

  it('ignores what a public bundle legitimately holds', () => {
    const publicCode = [
      'e.startsWith(`sb_publishable_`)||e.startsWith(`sb_secret_`)',
      'key:"sb_publishable_AbCdEf0123456789"',
      'font:"data:font/woff2;base64,ZxsI24KqzVcd2gKc6kCcr+MjsjFmMjrguc6DC1pCeyJa4jE1NKLi"',
    ].join(';');
    expect(secretFindings(publicCode, [''])).toEqual([]);
  });
});

describe('DEPLOY-01 loopback URL scanner', () => {
  it('reports configured loopback URLs with their port and path', () => {
    const text =
      'a="http://localhost:3000";b=`http://127.0.0.1:54321/auth/v1`;c="http://[::1]:5173/x";d="http://localhost/api"';
    expect(unexpectedLoopbackUrls(text)).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:54321/auth/v1',
      'http://[::1]:5173/x',
      'http://localhost/api',
    ]);
  });

  it('allows only the exact library constants', () => {
    expect([...LIBRARY_LOOPBACK_URLS]).toEqual(['http://localhost', 'http://localhost:9999']);
    expect(unexpectedLoopbackUrls('new URL(`http://localhost`);u=`http://localhost:9999`')).toEqual(
      [],
    );
    // A hostname list (the web app's loopback check) is not a URL.
    expect(unexpectedLoopbackUrls('new Set([`localhost`,`127.0.0.1`,`[::1]`])')).toEqual([]);
  });
});

describe('DEPLOY-01 parsers and route matching', () => {
  it('parses CSP directives into source lists', () => {
    const csp = parseCsp(
      "default-src 'self'; connect-src 'self' https://a.example ;frame-ancestors 'none'",
    );
    expect(csp.get('connect-src')).toEqual(["'self'", 'https://a.example']);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('script-src')).toBeUndefined();
  });

  it('finds the hashed worklet path in a bundle', () => {
    expect(findWorkletPath('u=new URL(`/assets/spessasynth_processor.min-Do8nRWPC.js`,x)')).toBe(
      '/assets/spessasynth_processor.min-Do8nRWPC.js',
    );
    expect(findWorkletPath('no worklet here')).toBeUndefined();
  });

  it('matches vercel.json sources as anchored path patterns', () => {
    expect(sourceMatches('/((?!assets/).*)', '/library')).toBe(true);
    expect(sourceMatches('/((?!assets/).*)', '/assets/index.js')).toBe(false);
    expect(sourceMatches('/assets/(.*)\\.sf3', '/assets/soundfonts/piano/a.sf3')).toBe(true);
    expect(sourceMatches('/assets/(.*)\\.sf3', '/assets/a.sf3.txt')).toBe(false);
    expect(sourceMatches('/(.*)', '/')).toBe(true);
  });
});
