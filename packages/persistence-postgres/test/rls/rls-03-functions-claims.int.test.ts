/**
 * RLS-03 exposed functions and claims (issue #27).
 *
 * - Function review: the migrations expose no function (no RPC) in `public`;
 *   the server-only functions in `private` are SECURITY INVOKER with a fixed
 *   search_path, and neither they nor their schema are usable by anon,
 *   authenticated or service_role. score_owner may only read its owner
 *   setting (private.current_owner_id).
 * - Promotion runs as a transaction on the user path (DATABASE.md), so RLS
 *   applies to it: run for A on B's draft, it promotes nothing.
 * - Only the owner the server sets for the transaction grants access on the
 *   user path: JWT claims (forged editable user metadata, a forged role, a
 *   subject left over from a Data API request) and stored user metadata grant
 *   nothing, and a Data API request gets no access whatever its claims.
 */
import type { PoolClient, QueryResult } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asAnon,
  asScoreOwner,
  asUser,
  createTestDatabase,
  seedTestUsers,
  withRole,
  type RoleSettings,
  type TestDatabase,
  type TestRole,
} from '../../testing';
import { A, B, DRAFTS, SAVED, seedScores, storedDrafts, storedSaved } from './dataset';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestUsers(db.admin);
});

beforeEach(async () => {
  await seedScores(db.admin);
  await db.admin.query(`update auth.users set raw_user_meta_data = '{}' where id = $1`, [B]);
});

afterAll(async () => {
  await db?.close();
});

describe('RLS-03 function privileges', () => {
  it('defines no function in the exposed public schema, so there is no RPC to call', async () => {
    const { rows } = await db.admin.query(
      `select p.oid::regprocedure::text as signature from pg_proc p
       where p.pronamespace = 'public'::regnamespace`,
    );
    expect(rows).toEqual([]);
  });

  it('keeps every server-only function SECURITY INVOKER, with a fixed search_path, out of client reach', async () => {
    const { rows } = await db.admin.query(
      `select p.oid::regprocedure::text as signature,
              p.prosecdef as security_definer,
              p.proconfig as settings,
              array(
                select r from unnest(array['anon', 'authenticated', 'service_role', 'public', 'score_owner']) as r
                where has_function_privilege(r, p.oid, 'EXECUTE')
              ) as executable_by
       from pg_proc p
       where p.pronamespace = 'private'::regnamespace
       order by 1`,
    );
    const serverOnly = (signature: string, executableBy: string[] = []) => ({
      signature,
      security_definer: false,
      settings: ['search_path=""'],
      executable_by: executableBy,
    });
    expect(rows).toEqual([
      serverOnly('private.cleanup_expired_drafts(timestamp with time zone,integer)'),
      serverOnly('private.current_owner_id()', ['score_owner']),
      serverOnly('private.forbid_score_identity_change()'),
      serverOnly('private.prune_rate_limit_windows(timestamp with time zone,integer)'),
      serverOnly('private.rate_limit_hit(text,bigint,timestamp with time zone)'),
    ]);
  });

  it('gives no API role any privilege on the private schema, and score_owner USAGE only', async () => {
    const { rows } = await db.admin.query(
      `select r as role, has_schema_privilege(r, 'private', 'USAGE') as usage,
              has_schema_privilege(r, 'private', 'CREATE') as create
       from unnest(array['anon', 'authenticated', 'service_role', 'public', 'score_owner']) as r`,
    );
    expect(rows).toEqual([
      ...['anon', 'authenticated', 'service_role', 'public'].map((role) => ({
        role,
        usage: false,
        create: false,
      })),
      { role: 'score_owner', usage: true, create: false },
    ]);
  });

  const PAST_EVERY_EXPIRY = '2027-01-01T00:00:00.000Z';
  const CLEANUP = {
    what: 'the expired-draft cleanup',
    sql: `select private.cleanup_expired_drafts($1, 1000)`,
    values: [PAST_EVERY_EXPIRY],
  };
  const RATE_LIMITER = {
    what: 'the rate limiter',
    sql: `select * from private.rate_limit_hit('mcp:' || $1, 60000, now())`,
    values: [A],
  };
  const PRUNE = {
    what: 'the rate-limit prune',
    sql: `select private.prune_rate_limit_windows($1, 1000)`,
    values: [PAST_EVERY_EXPIRY],
  };
  const COUNTERS = {
    what: 'the rate-limit counter table',
    sql: `select * from private.rate_limit_windows`,
    values: [],
  };
  const NO_SCHEMA = 'permission denied for schema private';

  it.each([
    { caller: "A's token", ...CLEANUP, denied: NO_SCHEMA },
    { caller: 'anonymous', ...CLEANUP, denied: NO_SCHEMA },
    { caller: "A's token", ...RATE_LIMITER, denied: NO_SCHEMA },
    { caller: 'anonymous', ...RATE_LIMITER, denied: NO_SCHEMA },
    { caller: "A's token", ...COUNTERS, denied: NO_SCHEMA },
    {
      caller: 'the user path',
      ...CLEANUP,
      denied: 'permission denied for function cleanup_expired_drafts',
    },
    {
      caller: 'the user path',
      ...RATE_LIMITER,
      denied: 'permission denied for function rate_limit_hit',
    },
    {
      caller: 'the user path',
      ...PRUNE,
      denied: 'permission denied for function prune_rate_limit_windows',
    },
    {
      caller: 'the user path',
      ...COUNTERS,
      denied: 'permission denied for table rate_limit_windows',
    },
  ] satisfies {
    caller: "A's token" | 'anonymous' | 'the user path';
    what: string;
    sql: string;
    values: unknown[];
    denied: string;
  }[])('$caller cannot use $what, and nothing changes', async ({ caller, sql, values, denied }) => {
    const work = (client: PoolClient) => client.query(sql, values);
    const call =
      caller === 'the user path'
        ? asScoreOwner(db.admin, A, work)
        : caller === "A's token"
          ? asUser(db.admin, A, work)
          : asAnon(db.admin, work);
    await expect(call).rejects.toMatchObject({ code: '42501', message: denied });
    expect(await storedDrafts(db.admin)).toEqual(DRAFTS);
    const counters = await db.admin.query(
      'select count(*)::int as n from private.rate_limit_windows',
    );
    expect(counters.rows).toEqual([{ n: 0 }]);
  });
});

describe('RLS-03 promotion on the user path', () => {
  /** The promotion statement of DATABASE.md: delete the live draft at the revision, insert it as saved. */
  const promote = (
    client: PoolClient,
    id: string,
    expectedRevision: number,
  ): Promise<QueryResult> =>
    client.query(
      `with promoted as (
         delete from public.score_drafts
         where id = $1 and revision = $2 and expires_at > $3
         returning id, owner_user_id, score_spec, score_spec_version, revision
       )
       insert into public.scores
         (id, owner_user_id, score_spec, score_spec_version, revision, title, tags, created_at, updated_at)
       select id, owner_user_id, score_spec, score_spec_version, revision, $4, $5, $3, $3 from promoted
       returning id`,
      [id, expectedRevision, new Date('2026-09-30T10:00:00.000Z'), 'Promoted', ['saved']],
    );

  it("promotes A's own live draft for A", async () => {
    const result = await asScoreOwner(db.admin, A, (client) => promote(client, 'scr_draft_a1', 1));
    expect(result.rows).toEqual([{ id: 'scr_draft_a1' }]);
    expect((await storedDrafts(db.admin)).map((row) => row.id)).toEqual([
      'scr_draft_b1',
      'scr_draft_b2',
    ]);
    expect(await storedSaved(db.admin)).toContainEqual({
      id: 'scr_draft_a1',
      owner: A,
      revision: 1,
      title: 'Promoted',
      tags: ['saved'],
    });
  });

  it("promotes nothing when A targets B's draft, and leaves B's draft and the library intact", async () => {
    const result = await asScoreOwner(db.admin, A, (client) => promote(client, 'scr_draft_b1', 2));
    expect(result.rows).toEqual([]);
    expect(await storedDrafts(db.admin)).toEqual(DRAFTS);
    expect(await storedSaved(db.admin)).toEqual(SAVED);
  });
});

describe('RLS-03 claims', () => {
  const FORGED_METADATA = {
    sub: A,
    user_id: A,
    owner_user_id: A,
    role: 'service_role',
    is_admin: true,
  };

  const userPathCases: {
    name: string;
    settings: RoleSettings;
    forgeStoredMetadata?: boolean;
  }[] = [
    {
      name: "B's user path with Data API claims naming A as subject, owner and admin",
      settings: {
        ownerId: B,
        claims: {
          sub: A,
          role: 'service_role',
          aud: 'authenticated',
          user_metadata: FORGED_METADATA,
        },
      },
    },
    {
      name: "B's user path after B stored metadata naming A in auth.users",
      settings: { ownerId: B },
      forgeStoredMetadata: true,
    },
    {
      name: "a user path without owner, with A's claims left over from a Data API request",
      settings: { claims: { sub: A, role: 'authenticated', aud: 'authenticated' } },
    },
    {
      name: 'a user path with an empty owner',
      settings: { ownerId: '' },
    },
  ];

  it.each(userPathCases)(
    "$name reads none of A's rows and changes none",
    async ({ settings, forgeStoredMetadata }) => {
      if (forgeStoredMetadata === true) {
        await db.admin.query('update auth.users set raw_user_meta_data = $2 where id = $1', [
          B,
          JSON.stringify(FORGED_METADATA),
        ]);
      }
      const visible = await withRole(db.admin, 'score_owner', settings, async (client) => {
        const drafts = await client.query<{ id: string }>(
          `select id from public.score_drafts where id = 'scr_draft_a1' or owner_user_id = $1`,
          [A],
        );
        const saved = await client.query<{ id: string }>(
          `select id from public.scores where id = 'scr_saved_a1' or owner_user_id = $1`,
          [A],
        );
        return [...drafts.rows, ...saved.rows].map((row) => row.id);
      });
      const changed = await withRole(db.admin, 'score_owner', settings, async (client) => {
        const edit = await client.query(
          `update public.score_drafts set revision = revision where id = 'scr_draft_a1'`,
        );
        const drop = await client.query(
          `delete from public.score_drafts where id = 'scr_draft_a1'`,
        );
        return (edit.rowCount ?? 0) + (drop.rowCount ?? 0);
      });
      expect(visible).toEqual([]);
      expect(changed).toBe(0);
      expect(await storedDrafts(db.admin)).toEqual(DRAFTS);
    },
  );

  it.each<{ name: string; role: TestRole; settings: RoleSettings }>([
    {
      name: "B's token with user_metadata naming A as owner and admin",
      role: 'authenticated',
      settings: {
        claims: {
          sub: B,
          role: 'authenticated',
          aud: 'authenticated',
          user_metadata: FORGED_METADATA,
        },
      },
    },
    {
      name: 'a Data API request that also sets the owner setting to A',
      role: 'authenticated',
      settings: { claims: { sub: A, role: 'authenticated' }, ownerId: A },
    },
    {
      name: "A's subject under the anon role",
      role: 'anon',
      settings: { claims: { sub: A, role: 'authenticated' } },
    },
  ])(
    '$name is denied: the role, not a claim or setting, carries the grants',
    async ({ role, settings }) => {
      await expect(
        withRole(db.admin, role, settings, (client) =>
          client.query(`select id from public.score_drafts where id = 'scr_draft_a1'`),
        ),
      ).rejects.toMatchObject({
        code: '42501',
        message: 'permission denied for table score_drafts',
      });
    },
  );
});
