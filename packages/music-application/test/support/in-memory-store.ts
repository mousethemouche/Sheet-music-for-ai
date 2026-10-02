/**
 * TEST DOUBLES ONLY: in-memory implementations of the repository and promotion
 * ports, a settable clock and a scripted ID generator. They follow the port
 * contracts of src/ports.ts (owner scoping, compare-and-swap, atomic
 * promotion) so the use cases can be exercised without a database. Production
 * storage is the Postgres adapter (#9/#22); nothing here is exported by the
 * package.
 */
import type {
  Clock,
  IdGenerator,
  PromotionOutcome,
  PromotionRequest,
  SavedScore,
  SavedScorePage,
  SavedScoreQuery,
  SavedScoreRepository,
  ScoreDraft,
  ScoreDraftRepository,
  ScoreId,
  ScorePromotion,
  UserId,
  WriteOutcome,
} from '../../src/index';

export type StoreMethod =
  | 'drafts.create'
  | 'drafts.get'
  | 'drafts.update'
  | 'drafts.delete'
  | 'saved.get'
  | 'saved.update'
  | 'saved.search'
  | 'promotion.promote';

export const WRITE_METHODS: readonly StoreMethod[] = [
  'drafts.create',
  'drafts.update',
  'drafts.delete',
  'saved.update',
  'promotion.promote',
];

export interface StoreCall {
  readonly method: StoreMethod;
  readonly owner: UserId;
}

const key = (owner: UserId, id: ScoreId): string => `${owner}\u0000${id}`;

export class InMemoryScoreStore {
  private readonly draftRows = new Map<string, ScoreDraft>();
  private readonly savedRows = new Map<string, SavedScore>();

  /** Every port call, in order. */
  readonly calls: StoreCall[] = [];
  /** Methods that reject with the given error instead of running. */
  readonly failures = new Map<StoreMethod, unknown>();
  /** Runs inside a method just before its effect, to simulate a concurrent writer. */
  readonly interference = new Map<StoreMethod, () => void>();
  /** Queries received by `search`, and the page it returns (no matching logic in the double). */
  readonly searchQueries: { readonly owner: UserId; readonly query: SavedScoreQuery }[] = [];
  searchPage: SavedScorePage = { items: [], total: 0 };

  readonly drafts: ScoreDraftRepository = {
    create: (owner, draft) =>
      this.run('drafts.create', owner, () => {
        const id = key(owner, draft.spec.id);
        if (this.draftRows.has(id)) {
          throw new Error('duplicate draft id');
        }
        this.draftRows.set(id, draft);
      }),
    get: (owner, id) =>
      this.run('drafts.get', owner, () => this.draftRows.get(key(owner, id)) ?? null),
    update: (owner, draft, expectedRevision) =>
      this.run('drafts.update', owner, () =>
        this.compareAndSwap(this.draftRows, key(owner, draft.spec.id), draft, expectedRevision),
      ),
    delete: (owner, id) =>
      this.run('drafts.delete', owner, () => {
        this.draftRows.delete(key(owner, id));
      }),
  };

  readonly saved: SavedScoreRepository = {
    get: (owner, id) =>
      this.run('saved.get', owner, () => this.savedRows.get(key(owner, id)) ?? null),
    update: (owner, saved, expectedRevision) =>
      this.run('saved.update', owner, () =>
        this.compareAndSwap(this.savedRows, key(owner, saved.spec.id), saved, expectedRevision),
      ),
    search: (owner, query) =>
      this.run('saved.search', owner, () => {
        this.searchQueries.push({ owner, query });
        return this.searchPage;
      }),
  };

  readonly promotion: ScorePromotion = {
    promote: (owner, request) =>
      this.run('promotion.promote', owner, () => this.promote(owner, request)),
  };

  putDraft(owner: UserId, draft: ScoreDraft): void {
    this.draftRows.set(key(owner, draft.spec.id), draft);
  }

  putSaved(owner: UserId, saved: SavedScore): void {
    this.savedRows.set(key(owner, saved.spec.id), saved);
  }

  removeDraft(owner: UserId, id: ScoreId): void {
    this.draftRows.delete(key(owner, id));
  }

  draftOf(owner: UserId, id: ScoreId): ScoreDraft | undefined {
    return this.draftRows.get(key(owner, id));
  }

  savedOf(owner: UserId, id: ScoreId): SavedScore | undefined {
    return this.savedRows.get(key(owner, id));
  }

  get draftCount(): number {
    return this.draftRows.size;
  }

  get savedCount(): number {
    return this.savedRows.size;
  }

  /** Write methods that were called (whether or not they changed anything). */
  writeCalls(): StoreMethod[] {
    return this.calls
      .filter((call) => WRITE_METHODS.includes(call.method))
      .map((call) => call.method);
  }

  private async run<T>(method: StoreMethod, owner: UserId, effect: () => T): Promise<T> {
    this.calls.push({ method, owner });
    await Promise.resolve();
    if (this.failures.has(method)) {
      throw this.failures.get(method);
    }
    this.interference.get(method)?.();
    return effect();
  }

  private compareAndSwap<T extends { readonly spec: { readonly revision: number } }>(
    rows: Map<string, T>,
    rowKey: string,
    next: T,
    expectedRevision: number,
  ): WriteOutcome {
    const current = rows.get(rowKey);
    if (current === undefined || current.spec.revision !== expectedRevision) {
      return 'stale';
    }
    rows.set(rowKey, next);
    return 'updated';
  }

  private promote(owner: UserId, request: PromotionRequest): PromotionOutcome {
    const rowKey = key(owner, request.id);
    const draft = this.draftRows.get(rowKey);
    if (
      draft === undefined ||
      draft.expiresAt.getTime() <= request.now.getTime() ||
      draft.spec.revision !== request.expectedRevision
    ) {
      return { status: 'stale' };
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
    return { status: 'promoted', saved };
  }
}

/** A clock that only moves when the test moves it. */
export class TestClock implements Clock {
  private current: number;

  constructor(start: Date) {
    this.current = start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date): void {
    this.current = instant.getTime();
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}

/** Issues the given IDs in order, then fails the test if more are requested. */
export class ScriptedIds implements IdGenerator {
  private readonly pending: string[];

  constructor(...ids: string[]) {
    this.pending = [...ids];
  }

  newScoreId(): string {
    const next = this.pending.shift();
    if (next === undefined) {
      throw new Error('ScriptedIds: no ID left');
    }
    return next;
  }
}
