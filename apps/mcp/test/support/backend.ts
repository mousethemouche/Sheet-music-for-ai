/**
 * The test database behind the MCP integration suites: a fresh
 * `sheet_music_*` database with every migration and users A/B, the
 * production Postgres adapters on it, and read-only inspection of the rows
 * through the privileged admin pool (never used to exercise the product).
 */
import {
  type PostgresPersistence,
  createPostgresPersistence,
} from '@sheet-music/persistence-postgres';
import {
  type TestDatabase,
  createTestDatabase,
  seedTestUsers,
} from '@sheet-music/persistence-postgres/testing';

/** The database of the apps/mcp integration suites (one file at a time). */
export const MCP_TEST_DATABASE = 'sheet_music_test_mcp';

export interface McpTestBackend {
  readonly db: TestDatabase;
  /** Production adapters over `db.url`: pass it as the app's stores. */
  readonly persistence: PostgresPersistence;
  close(): Promise<void>;
}

/** Recreates the database `name`, seeds users A and B, and opens the adapters. */
export async function openMcpTestBackend(name = MCP_TEST_DATABASE): Promise<McpTestBackend> {
  const db = await createTestDatabase(name);
  try {
    await seedTestUsers(db.admin);
  } catch (error) {
    await db.close();
    throw error;
  }
  const persistence = createPostgresPersistence({ connectionString: db.url });
  return {
    db,
    persistence,
    close: async () => {
      await persistence.close();
      await db.close();
    },
  };
}

export interface RowCounts {
  readonly drafts: number;
  readonly saved: number;
}

/** Draft and saved rows, of one owner or of everyone. */
export async function rowCounts(backend: McpTestBackend, owner?: string): Promise<RowCounts> {
  const { rows } = await backend.db.admin.query<{ drafts: number; saved: number }>(
    `select
       (select count(*)::int from public.score_drafts where $1::uuid is null or owner_user_id = $1) as drafts,
       (select count(*)::int from public.scores where $1::uuid is null or owner_user_id = $1) as saved`,
    [owner ?? null],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('count query returned no row');
  }
  return { drafts: row.drafts, saved: row.saved };
}

export interface StoredDraft {
  readonly owner: string;
  readonly revision: number;
  readonly spec: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

export interface StoredScore {
  readonly owner: string;
  readonly revision: number;
  readonly spec: Record<string, unknown>;
  readonly title: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Row {
  readonly owner_user_id: string;
  readonly revision: number;
  readonly score_spec: Record<string, unknown>;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The stored draft row `id`, or null. */
export async function storedDraft(
  backend: McpTestBackend,
  id: string,
): Promise<StoredDraft | null> {
  const { rows } = await backend.db.admin.query<Row & { expires_at: Date }>(
    'select owner_user_id, revision, score_spec, created_at, updated_at, expires_at from public.score_drafts where id = $1',
    [id],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : {
        owner: row.owner_user_id,
        revision: row.revision,
        spec: row.score_spec,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      };
}

/** The stored saved-score row `id`, or null. */
export async function storedScore(
  backend: McpTestBackend,
  id: string,
): Promise<StoredScore | null> {
  const { rows } = await backend.db.admin.query<Row & { title: string; tags: string[] }>(
    'select owner_user_id, revision, score_spec, title, tags, created_at, updated_at from public.scores where id = $1',
    [id],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : {
        owner: row.owner_user_id,
        revision: row.revision,
        spec: row.score_spec,
        title: row.title,
        tags: row.tags,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
}
