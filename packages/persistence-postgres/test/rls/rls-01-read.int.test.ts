/**
 * RLS-01 read (issue #27): with the real migrations and the real limited
 * roles, the server's user path (role score_owner, DATABASE.md §3.1) reads
 * only the drafts and saved scores of the owner it names; another owner, or
 * no owner, sees nothing by exact ID, by listing, by counting or through
 * planner statistics. The Supabase API roles a Data API or GraphQL request
 * runs as (anon, and authenticated even with the owner's own token) cannot
 * read the score tables at all, and cannot switch to score_owner. Also pins
 * the reviewed policies, grants and role attributes, so a new policy, grant
 * or membership cannot widen access unnoticed.
 */
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asAnon,
  asScoreOwner,
  asUser,
  createTestDatabase,
  seedTestUsers,
  withRole,
  type TestDatabase,
} from '../../testing';
import { A, B, seedScores } from './dataset';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedTestUsers(db.admin);
  await seedScores(db.admin);
  await db.admin.query('analyze public.score_drafts, public.scores');
});

afterAll(async () => {
  await db?.close();
});

type Table = 'score_drafts' | 'scores';
type Caller = 'A' | 'B' | 'user path without owner';

function readAs<T extends object>(caller: Caller, sql: string, values: unknown[] = []) {
  const work = async (client: PoolClient) => (await client.query<T>(sql, values)).rows;
  switch (caller) {
    case 'A':
      return asScoreOwner(db.admin, A, work);
    case 'B':
      return asScoreOwner(db.admin, B, work);
    case 'user path without owner':
      return withRole(db.admin, 'score_owner', {}, work);
  }
}

const API_ROLES = ['anon', 'authenticated', 'service_role'] as const;

describe('RLS-01 policies and grants', () => {
  it('enables (without forcing) row level security on both score tables', async () => {
    const { rows } = await db.admin.query(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
       where oid in ('public.score_drafts'::regclass, 'public.scores'::regclass) order by relname`,
    );
    expect(rows).toEqual([
      { relname: 'score_drafts', relrowsecurity: true, relforcerowsecurity: false },
      { relname: 'scores', relrowsecurity: true, relforcerowsecurity: false },
    ]);
  });

  it('has exactly the reviewed own-row policies, all for score_owner and keyed on the owner setting', async () => {
    const own = '(( SELECT private.current_owner_id() AS current_owner_id) = owner_user_id)';
    const { rows } = await db.admin.query(
      `select tablename, policyname, cmd, permissive, roles::text[] as roles, qual, with_check
       from pg_policies where schemaname in ('public', 'private') order by tablename, policyname`,
    );
    const policy = (
      tablename: Table,
      policyname: string,
      cmd: string,
      qual: string | null,
      withCheck: string | null,
    ) => ({
      tablename,
      policyname,
      cmd,
      permissive: 'PERMISSIVE',
      roles: ['score_owner'],
      qual,
      with_check: withCheck,
    });
    expect(rows).toEqual([
      policy('score_drafts', 'score_drafts_delete_own', 'DELETE', own, null),
      policy('score_drafts', 'score_drafts_insert_own', 'INSERT', null, own),
      policy('score_drafts', 'score_drafts_select_own', 'SELECT', own, null),
      policy('score_drafts', 'score_drafts_update_own', 'UPDATE', own, own),
      policy('scores', 'scores_insert_own', 'INSERT', null, own),
      policy('scores', 'scores_select_own', 'SELECT', own, null),
      policy('scores', 'scores_update_own', 'UPDATE', own, own),
    ]);
  });

  const DRAFT_UPDATABLE = [
    'score_spec',
    'score_spec_version',
    'revision',
    'updated_at',
    'expires_at',
  ];
  const SAVED_UPDATABLE = ['score_spec', 'score_spec_version', 'revision', 'updated_at'];
  const NONE = { privileges: [], updatableColumns: [] };

  it.each([
    {
      role: 'score_owner',
      table: 'public.score_drafts',
      expected: {
        privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        updatableColumns: DRAFT_UPDATABLE,
      },
    },
    {
      role: 'score_owner',
      table: 'public.scores',
      expected: { privileges: ['SELECT', 'INSERT', 'UPDATE'], updatableColumns: SAVED_UPDATABLE },
    },
    { role: 'score_owner', table: 'private.rate_limit_windows', expected: NONE },
    { role: 'authenticated', table: 'public.score_drafts', expected: NONE },
    { role: 'authenticated', table: 'public.scores', expected: NONE },
    { role: 'authenticated', table: 'private.rate_limit_windows', expected: NONE },
    { role: 'anon', table: 'public.score_drafts', expected: NONE },
    { role: 'anon', table: 'public.scores', expected: NONE },
    { role: 'anon', table: 'private.rate_limit_windows', expected: NONE },
    { role: 'service_role', table: 'public.score_drafts', expected: NONE },
    { role: 'service_role', table: 'public.scores', expected: NONE },
    { role: 'service_role', table: 'private.rate_limit_windows', expected: NONE },
    { role: 'public', table: 'public.score_drafts', expected: NONE },
    { role: 'public', table: 'public.scores', expected: NONE },
    { role: 'public', table: 'private.rate_limit_windows', expected: NONE },
  ])(
    'grants $role exactly the reviewed privileges on $table',
    async ({ role, table, expected }) => {
      // Column-level grants count too: a single granted column is a privilege.
      const { rows } = await db.admin.query<{ privileges: string[]; updatableColumns: string[] }>(
        `select
         array(
           select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
             with ordinality as t(p, n)
           where case when p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                      then has_any_column_privilege($1, $2::regclass, p)
                      else has_table_privilege($1, $2::regclass, p) end
           order by n
         ) as "privileges",
         array(
           select attname::text from pg_attribute
           where attrelid = $2::regclass and attnum > 0 and not attisdropped
             and has_column_privilege($1, $2::regclass, attnum, 'UPDATE')
           order by attnum
         ) as "updatableColumns"`,
        [role, table],
      );
      expect(rows[0]).toEqual(expected);
    },
  );

  it('keeps score_owner unable to log in, without elevated attributes, and a member of no role', async () => {
    const { rows } = await db.admin.query(
      `select rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication,
              array(select m.roleid::regrole::text from pg_auth_members m where m.member = r.oid) as member_of
       from pg_roles r where rolname = 'score_owner'`,
    );
    expect(rows).toEqual([
      {
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        member_of: [],
      },
    ]);
  });

  it('lets no Supabase API role switch to score_owner', async () => {
    // `authenticator` (PostgREST's login role) exists on Supabase only.
    const { rows } = await db.admin.query<{ role: string; member: boolean }>(
      `select rolname as role, pg_has_role(oid, 'score_owner', 'MEMBER') as member
       from pg_roles where rolname = any($1) order by rolname`,
      [[...API_ROLES, 'authenticator']],
    );
    expect(
      rows.filter((row) => API_ROLES.includes(row.role as (typeof API_ROLES)[number])),
    ).toEqual(API_ROLES.map((role) => ({ role, member: false })));
    expect(rows.filter((row) => row.member)).toEqual([]);
  });
});

describe('RLS-01 reads by exact ID', () => {
  it.each([
    { caller: 'A', table: 'score_drafts', id: 'scr_draft_a1', expected: ['scr_draft_a1'] },
    { caller: 'A', table: 'scores', id: 'scr_saved_a1', expected: ['scr_saved_a1'] },
    { caller: 'B', table: 'score_drafts', id: 'scr_draft_b1', expected: ['scr_draft_b1'] },
    { caller: 'B', table: 'scores', id: 'scr_saved_b1', expected: ['scr_saved_b1'] },
    { caller: 'A', table: 'score_drafts', id: 'scr_draft_b1', expected: [] },
    { caller: 'A', table: 'scores', id: 'scr_saved_b1', expected: [] },
    { caller: 'B', table: 'score_drafts', id: 'scr_draft_a1', expected: [] },
    { caller: 'B', table: 'scores', id: 'scr_saved_a1', expected: [] },
    { caller: 'user path without owner', table: 'score_drafts', id: 'scr_draft_a1', expected: [] },
    { caller: 'user path without owner', table: 'scores', id: 'scr_saved_a1', expected: [] },
  ] satisfies { caller: Caller; table: Table; id: string; expected: string[] }[])(
    '$caller reading $table $id sees $expected',
    async ({ caller, table, id, expected }) => {
      const rows = await readAs<{ id: string }>(
        caller,
        `select id from public.${table} where id = $1`,
        [id],
      );
      expect(rows.map((row) => row.id)).toEqual(expected);
    },
  );

  it.each([
    { caller: "a Data API request with A's own token", table: 'score_drafts', id: 'scr_draft_a1' },
    { caller: "a Data API request with A's own token", table: 'scores', id: 'scr_saved_a1' },
    { caller: 'an anonymous Data API request', table: 'score_drafts', id: 'scr_draft_a1' },
    { caller: 'an anonymous Data API request', table: 'scores', id: 'scr_saved_a1' },
  ] satisfies { caller: string; table: Table; id: string }[])(
    '$caller reading $table $id is denied',
    async ({ caller, table, id }) => {
      const work = (client: PoolClient) =>
        client.query(`select id from public.${table} where id = $1`, [id]);
      await expect(
        caller === 'an anonymous Data API request'
          ? asAnon(db.admin, work)
          : asUser(db.admin, A, work),
      ).rejects.toMatchObject({ code: '42501', message: `permission denied for table ${table}` });
    },
  );
});

describe('RLS-01 lists, counts and aggregates', () => {
  it.each([
    { caller: 'A', table: 'score_drafts', expected: ['scr_draft_a1'] },
    { caller: 'A', table: 'scores', expected: ['scr_saved_a1', 'scr_saved_a2'] },
    { caller: 'B', table: 'score_drafts', expected: ['scr_draft_b1', 'scr_draft_b2'] },
    { caller: 'B', table: 'scores', expected: ['scr_saved_b1'] },
    { caller: 'user path without owner', table: 'score_drafts', expected: [] },
    { caller: 'user path without owner', table: 'scores', expected: [] },
  ] satisfies { caller: Caller; table: Table; expected: string[] }[])(
    '$caller listing $table sees only $expected, and counts that many',
    async ({ caller, table, expected }) => {
      const listed = await readAs<{ id: string }>(
        caller,
        `select id from public.${table} order by id`,
      );
      const counted = await readAs<{ n: number }>(
        caller,
        `select count(*)::int as n from public.${table}`,
      );
      expect(listed.map((row) => row.id)).toEqual(expected);
      expect(counted).toEqual([{ n: expected.length }]);
    },
  );

  it.each([
    { caller: 'A', predicate: `title ilike '%monk%'`, expected: 0 },
    { caller: 'B', predicate: `title ilike '%monk%'`, expected: 1 },
    { caller: 'A', predicate: `tags @> array['blues']`, expected: 0 },
    { caller: 'B', predicate: `tags @> array['blues']`, expected: 1 },
    { caller: 'A', predicate: `'jazz' = any (tags)`, expected: 1 },
    { caller: 'B', predicate: `'jazz' = any (tags)`, expected: 1 },
  ] satisfies { caller: Caller; predicate: string; expected: number }[])(
    '$caller counting saved scores where $predicate gets $expected',
    async ({ caller, predicate, expected }) => {
      const rows = await readAs<{ n: number }>(
        caller,
        `select count(*)::int as n from public.scores where ${predicate}`,
      );
      expect(rows).toEqual([{ n: expected }]);
    },
  );

  it('hides planner statistics (most common titles, IDs, owners) from the user path', async () => {
    const statsQuery = `select count(*)::int as n from pg_stats
      where schemaname = 'public' and tablename in ('score_drafts', 'scores')`;
    const visibleToAdmin = await db.admin.query<{ n: number }>(statsQuery);
    expect(visibleToAdmin.rows[0]?.n).toBeGreaterThan(0);
    await expect(readAs<{ n: number }>('A', statsQuery)).resolves.toEqual([{ n: 0 }]);
  });

  it('exposes no view or materialized view over the score tables', async () => {
    const { rows } = await db.admin.query(
      `select schemaname, viewname from pg_views where schemaname in ('public', 'private')
       union all
       select schemaname, matviewname from pg_matviews where schemaname in ('public', 'private')`,
    );
    expect(rows).toEqual([]);
  });
});
