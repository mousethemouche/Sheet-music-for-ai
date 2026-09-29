/**
 * #15: the library API base URL. Requests carry the user's access token, so a
 * build pointing at plain http (outside a loopback host) or at a URL with
 * embedded credentials must refuse to start instead of leaking tokens.
 */
import { describe, expect, it } from 'vitest';
import { readApiConfig } from '../config';

describe('readApiConfig', () => {
  it.each([
    { value: 'https://api.example.com', baseUrl: 'https://api.example.com' },
    { value: ' https://api.example.com/v1/ ', baseUrl: 'https://api.example.com/v1' },
    { value: 'http://localhost:3000', baseUrl: 'http://localhost:3000' },
    { value: 'http://127.0.0.1:3000/', baseUrl: 'http://127.0.0.1:3000' },
    { value: 'http://[::1]:3000', baseUrl: 'http://[::1]:3000' },
  ])('accepts $value', ({ value, baseUrl }) => {
    expect(readApiConfig({ VITE_API_BASE_URL: value })).toEqual({ ok: true, config: { baseUrl } });
  });

  it.each([
    { name: 'a missing value', value: undefined },
    { name: 'a relative path', value: '/api' },
    { name: 'plain http to a remote host', value: 'http://api.example.com' },
    { name: 'embedded credentials', value: 'https://user:secret@api.example.com' },
    { name: 'a query string', value: 'https://api.example.com/?key=1' },
    { name: 'a fragment', value: 'https://api.example.com/#x' },
    { name: 'another scheme', value: 'ftp://api.example.com' },
  ])('refuses $name without echoing it', ({ value }) => {
    const result = readApiConfig({ VITE_API_BASE_URL: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).not.toContain('secret');
  });
});
