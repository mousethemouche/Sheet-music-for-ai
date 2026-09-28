/**
 * TEST DOUBLES ONLY: minimal in-memory score stores that follow the port
 * contracts (owner scoping, compare-and-swap, atomic promotion), so the MCP
 * protocol tests run the real use cases without a database. The Postgres
 * stores replace them in the tool-behavior suites (#12-#14).
 */
import type {
  PromotionOutcome,
  SavedScore,
  ScoreDraft,
  ScoreId,
  UserId,
  WriteOutcome,
} from '@sheet-music/music-application';
import type { ScoreStores } from '../../src/use-cases';

const key = (owner: UserId, id: ScoreId): string => `${owner}\u0000${id}`;

function compareAndSwap<T extends { readonly spec: { readonly revision: number } }>(
  rows: Map<string, T>,
  rowKey: string,
  next: T,
  expectedRevision: number,
): WriteOutcome {
  if (rows.get(rowKey)?.spec.revision !== expectedRevision) {
    return 'stale';
  }
  rows.set(rowKey, next);
  return 'updated';
}

export class InMemoryScoreStores implements ScoreStores {
  private readonly draftRows = new Map<string, ScoreDraft>();
  private readonly savedRows = new Map<string, SavedScore>();

  get draftCount(): number {
    return this.draftRows.size;
  }

  get savedCount(): number {
    return this.savedRows.size;
  }

  readonly drafts: ScoreStores['drafts'] = {
    create: (owner, draft) => {
      const rowKey = key(owner, draft.spec.id);
      if (this.draftRows.has(rowKey)) {
        return Promise.reject(new Error('duplicate draft id'));
      }
      this.draftRows.set(rowKey, draft);
      return Promise.resolve();
    },
    get: (owner, id) => Promise.resolve(this.draftRows.get(key(owner, id)) ?? null),
    update: (owner, draft, expectedRevision) =>
      Promise.resolve(
        compareAndSwap(this.draftRows, key(owner, draft.spec.id), draft, expectedRevision),
      ),
    delete: (owner, id) => {
      this.draftRows.delete(key(owner, id));
      return Promise.resolve();
    },
  };

  readonly saved: ScoreStores['saved'] = {
    get: (owner, id) => Promise.resolve(this.savedRows.get(key(owner, id)) ?? null),
    update: (owner, saved, expectedRevision) =>
      Promise.resolve(
        compareAndSwap(this.savedRows, key(owner, saved.spec.id), saved, expectedRevision),
      ),
    // Search semantics belong to the Postgres store (#9); these tests never search.
    search: () => Promise.reject(new Error('search is not supported by this test double')),
  };

  readonly promotion: ScoreStores['promotion'] = {
    promote: (owner, request): Promise<PromotionOutcome> => {
      const rowKey = key(owner, request.id);
      const draft = this.draftRows.get(rowKey);
      if (
        draft === undefined ||
        draft.expiresAt.getTime() <= request.now.getTime() ||
        draft.spec.revision !== request.expectedRevision
      ) {
        return Promise.resolve({ status: 'stale' });
      }
      const saved: SavedScore = {
        spec: draft.spec,
        title: request.title,
        tags: [...request.tags],
        createdAt: request.now,
        updatedAt: request.now,
      };
      this.savedRows.set(rowKey, saved);
      this.draftRows.delete(rowKey);
      return Promise.resolve({ status: 'promoted', saved });
    },
  };
}
