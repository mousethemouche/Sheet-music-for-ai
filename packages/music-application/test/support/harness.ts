/**
 * Test wiring: the real use cases and the real expiry policy over the
 * in-memory test doubles, plus shared principals, instants and fixtures.
 */
import type { ScoreSpec, ScoreSpecInput } from '@sheet-music/music-domain';
import { cloneFixture, frozen, parseFixture } from '@sheet-music/test-fixtures';
import {
  type AppResult,
  type ApplicationError,
  type AuthenticatedPrincipal,
  type SavedScore,
  type ScoreDraft,
  CreateScore,
  EditScore,
  GetSavedScore,
  GetScore,
  SaveScore,
  SearchScores,
  createDraftExpiryPolicy,
} from '../../src/index';
import { InMemoryScoreStore, ScriptedIds, TestClock } from './in-memory-store';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** 2026-09-28T12:00:00.000Z */
export const T0 = new Date(Date.UTC(2026, 8, 28, 12, 0, 0));

export const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);
export const iso = (offsetMs: number): string => at(offsetMs).toISOString();

export const ALICE: AuthenticatedPrincipal = frozen({ userId: 'user-a' });
export const BOB: AuthenticatedPrincipal = frozen({ userId: 'user-b' });

export interface HarnessOptions {
  readonly ttlMs?: number;
  readonly ids?: readonly string[];
  readonly start?: Date;
}

export function makeHarness(options: HarnessOptions = {}) {
  const store = new InMemoryScoreStore();
  const clock = new TestClock(options.start ?? T0);
  const expiry = createDraftExpiryPolicy(options.ttlMs);
  const ids = new ScriptedIds(...(options.ids ?? ['score-1']));
  const ports = {
    drafts: store.drafts,
    saved: store.saved,
    promotion: store.promotion,
    clock,
    expiry,
    ids,
  };
  return {
    store,
    clock,
    createScore: new CreateScore(ports),
    editScore: new EditScore(ports),
    saveScore: new SaveScore(ports),
    getScore: new GetScore(ports),
    getSavedScore: new GetSavedScore(ports),
    searchScores: new SearchScores(ports),
  };
}

/** A mutable copy of a fixture without the server-assigned `id` and `revision` (create_score payload). */
export function scorePayload(fixture: ScoreSpecInput): Record<string, unknown> {
  const content = cloneFixture(fixture) as Record<string, unknown>;
  delete content['id'];
  delete content['revision'];
  return content;
}

/** A canonical stored ScoreSpec: `fixture` under another ID and revision. */
export function storedSpec(fixture: ScoreSpecInput, id: string, revision: number): ScoreSpec {
  return parseFixture({ ...cloneFixture(fixture), id, revision });
}

export function draftRow(
  spec: ScoreSpec,
  times: { createdAt: Date; updatedAt?: Date; expiresAt: Date },
): ScoreDraft {
  return {
    spec,
    createdAt: times.createdAt,
    updatedAt: times.updatedAt ?? times.createdAt,
    expiresAt: times.expiresAt,
  };
}

export function savedRow(
  spec: ScoreSpec,
  fields: { title: string; tags: readonly string[]; createdAt: Date; updatedAt?: Date },
): SavedScore {
  return {
    spec,
    title: fields.title,
    tags: fields.tags,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt ?? fields.createdAt,
  };
}

export function expectOk<T>(result: AppResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected success, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

export function expectError<T>(result: AppResult<T>): ApplicationError {
  if (result.ok) {
    throw new Error(`Expected an error, got ${JSON.stringify(result.value)}`);
  }
  return result.error;
}
