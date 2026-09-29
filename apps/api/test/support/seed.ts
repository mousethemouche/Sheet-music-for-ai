/**
 * Seeds library data through the production Postgres adapters (the same
 * write path as create_score + save_score): a draft is created, then
 * promoted, so a saved row has `createdAt = updatedAt = at`.
 */
import type { PostgresPersistence } from '@sheet-music/persistence-postgres';
import { F01, cloneFixture, parseFixture } from '@sheet-music/test-fixtures';

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function seedDraft(
  persistence: PostgresPersistence,
  owner: string,
  draft: { readonly id: string; readonly at: Date },
): Promise<void> {
  const spec = parseFixture({ ...cloneFixture(F01), id: draft.id, revision: 1 });
  await persistence.drafts.create(owner, {
    spec,
    createdAt: draft.at,
    updatedAt: draft.at,
    expiresAt: new Date(draft.at.getTime() + DRAFT_TTL_MS),
  });
}

export async function seedSaved(
  persistence: PostgresPersistence,
  owner: string,
  saved: {
    readonly id: string;
    readonly title: string;
    readonly tags: readonly string[];
    readonly at: Date;
  },
): Promise<void> {
  await seedDraft(persistence, owner, saved);
  const outcome = await persistence.promotion.promote(owner, {
    id: saved.id,
    expectedRevision: 1,
    title: saved.title,
    tags: saved.tags,
    now: saved.at,
  });
  if (outcome.status !== 'promoted') {
    throw new Error(`Seeding saved score ${saved.id} failed: ${outcome.status}.`);
  }
}
