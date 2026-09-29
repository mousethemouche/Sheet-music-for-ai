/**
 * OAUTH-02, unit part (issue #26): the pure discovery builders the MCP app
 * mounts. Expected values are written from RFC 9728 §2/§3.1, RFC 6750 §2.1/§3
 * and the MCP authorization spec. That the metadata is actually reachable and
 * that /mcp answers 401 with this challenge is OAUTH-02 wire
 * (apps/mcp/test/oauth-02-mcp-auth.int.test.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  bearerChallenge,
  canonicalResourceUri,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  readBearerToken,
  rejectionResponse,
  supabaseAuthEndpoints,
} from '../src/index';

const METADATA_URL = 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp';

describe('OAUTH-02 protected resource metadata (RFC 9728)', () => {
  it('advertises the canonical resource, Supabase as authorization server and header-only bearer tokens', () => {
    const { issuer } = supabaseAuthEndpoints('https://test-project.supabase.co');

    expect(
      protectedResourceMetadata({
        resource: 'HTTPS://MCP.Example.test/mcp/',
        authorizationServers: [issuer],
        resourceName: 'Sheet Music for AI',
      }),
    ).toEqual({
      resource: 'https://mcp.example.test/mcp',
      authorization_servers: ['https://test-project.supabase.co/auth/v1'],
      bearer_methods_supported: ['header'],
      resource_name: 'Sheet Music for AI',
    });
  });

  it.each([
    { resource: 'https://mcp.example.test/mcp', url: METADATA_URL },
    {
      resource: 'https://mcp.example.test',
      url: 'https://mcp.example.test/.well-known/oauth-protected-resource',
    },
    {
      resource: 'http://localhost:3001/mcp',
      url: 'http://localhost:3001/.well-known/oauth-protected-resource/mcp',
    },
  ])('puts the well-known suffix between host and path for $resource', ({ resource, url }) => {
    expect(protectedResourceMetadataUrl(resource)).toBe(url);
  });

  it.each([
    'mcp.example.test/mcp',
    'http://mcp.example.test/mcp',
    'https://mcp.example.test/mcp#fragment',
    'https://mcp.example.test/mcp?tenant=a',
    'https://user:secret@mcp.example.test/mcp',
  ])('refuses %s as a resource identifier', (resource) => {
    expect(() => canonicalResourceUri(resource)).toThrow(TypeError);
  });

  it('derives the Supabase issuer and JWKS URL from the project origin', () => {
    expect(supabaseAuthEndpoints('https://test-project.supabase.co')).toEqual({
      issuer: 'https://test-project.supabase.co/auth/v1',
      jwksUrl: 'https://test-project.supabase.co/auth/v1/.well-known/jwks.json',
    });
  });
});

describe('OAUTH-02 WWW-Authenticate challenge (RFC 6750 §3)', () => {
  it('omits the error code when the request carried no token', () => {
    expect(rejectionResponse('MISSING_TOKEN', { resourceMetadataUrl: METADATA_URL })).toEqual({
      status: 401,
      wwwAuthenticate: `Bearer resource_metadata="${METADATA_URL}"`,
    });
  });

  it.each(['EXPIRED', 'WRONG_AUDIENCE', 'BAD_SIGNATURE', 'CLIENT_NOT_ALLOWED'] as const)(
    'answers %s with the same generic invalid_token challenge',
    (reason) => {
      expect(rejectionResponse(reason, { resourceMetadataUrl: METADATA_URL })).toEqual({
        status: 401,
        wwwAuthenticate: `Bearer resource_metadata="${METADATA_URL}", error="invalid_token", error_description="The access token is invalid or expired."`,
      });
    },
  );

  it('answers an unavailable key source with 503 and no challenge', () => {
    expect(rejectionResponse('KEYS_UNAVAILABLE', { resourceMetadataUrl: METADATA_URL })).toEqual({
      status: 503,
    });
  });

  it('refuses a quoted value that would break the header', () => {
    expect(() =>
      bearerChallenge({ resourceMetadataUrl: METADATA_URL, errorDescription: 'bad "quote"' }),
    ).toThrow(TypeError);
  });
});

describe('OAUTH-02 bearer token extraction (RFC 6750 §2.1)', () => {
  it.each([
    { header: undefined, expected: { ok: false, reason: 'MISSING_TOKEN' } },
    { header: 'Basic dXNlcjpwYXNz', expected: { ok: false, reason: 'MISSING_TOKEN' } },
    { header: 'Bearer', expected: { ok: false, reason: 'MALFORMED_TOKEN' } },
    { header: 'Bearer a.b.c extra', expected: { ok: false, reason: 'MALFORMED_TOKEN' } },
    { header: 'bearer aaa.bbb.ccc', expected: { ok: true, token: 'aaa.bbb.ccc' } },
  ])('reads $header', ({ header, expected }) => {
    expect(readBearerToken(header)).toEqual(expected);
  });
});
