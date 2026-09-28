/**
 * OAUTH-03 (issue #26): the trusted UserId is the verified `sub` and nothing
 * else. Email, user_metadata, app_metadata and look-alike claims cannot
 * redefine it, and two users never share a principal. That a request body
 * cannot name the owner is enforced by the closed input schemas of the use
 * cases (music-application, `UNKNOWN_FIELD`); route-level cross-user
 * isolation is ACCESS-01 (#18).
 */
import { createLocalJWKSet } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAccessTokenVerifier } from '../src/index';
import {
  ISSUER,
  type SigningKey,
  T0,
  USER_A,
  USER_B,
  claims,
  sign,
  signingKey,
} from './support/tokens';

let key: SigningKey;

beforeAll(async () => {
  key = await signingKey('key-1');
});

function verifier() {
  return createAccessTokenVerifier({
    issuer: ISSUER,
    audiences: ['authenticated'],
    client: { kind: 'oauth' },
    keys: createLocalJWKSet({ keys: [key.publicJwk] }),
    now: () => T0,
  });
}

async function principalOf(token: string) {
  const result = await verifier().verify(token);
  if (!result.ok) {
    throw new Error(`expected an accepted token, got ${result.reason}`);
  }
  return result.principal;
}

describe('OAUTH-03 identity from the verified subject only', () => {
  it('resolves tokens of users A and B, verified concurrently, to their own principals', async () => {
    const [a, b] = await Promise.all([
      principalOf(await sign(key, claims({ sub: USER_A, email: 'a@example.test' }))),
      principalOf(await sign(key, claims({ sub: USER_B, email: 'b@example.test' }))),
    ]);

    expect(a).toEqual({ userId: USER_A });
    expect(b).toEqual({ userId: USER_B });
  });

  it('ignores email, metadata and look-alike claims that name another user', async () => {
    const token = await sign(
      key,
      claims({
        sub: USER_A,
        email: 'b@example.test',
        user_id: USER_B,
        userId: USER_B,
        owner_id: USER_B,
        user_metadata: { sub: USER_B, userId: USER_B, email: 'b@example.test' },
        app_metadata: { userId: USER_B, provider: 'email' },
      }),
    );

    const principal = await principalOf(token);

    expect(principal).toEqual({ userId: USER_A });
    expect(Object.keys(principal)).toEqual(['userId']);
  });

  it('keeps the same UserId when the email changes', async () => {
    const before = await principalOf(await sign(key, claims({ email: 'old@example.test' })));
    const after = await principalOf(await sign(key, claims({ email: 'new@example.test' })));

    expect(after).toEqual(before);
  });

  it('returns a frozen principal that a handler cannot rewrite', async () => {
    const principal = await principalOf(await sign(key));

    expect(Object.isFrozen(principal)).toBe(true);
    expect(() => {
      (principal as { userId: string }).userId = USER_B;
    }).toThrow(TypeError);
  });
});
