/**
 * CREATE-01 (issue #8): CreateScore turns a valid score into the owner's
 * initial DRAFT artifact. Injected ID, clock and principal give an exactly
 * predictable result; inner IDs and content are kept; the TTL comes from the
 * shared expiry policy; the permanent library is never written.
 */
import { cloneFixture, frozen, RICH_WIRE_FIXTURE } from '@sheet-music/test-fixtures';
import { describe, expect, it } from 'vitest';
import { ALICE, MINUTE, expectOk, makeHarness, scorePayload } from './support/harness';

describe('CREATE-01 CreateScore builds the initial draft', () => {
  it('assigns the generated ID and revision 1 and keeps every inner ID and field as given', async () => {
    const harness = makeHarness({ ids: ['scr_0001'] });
    const input = frozen({ score: scorePayload(RICH_WIRE_FIXTURE) });

    const output = expectOk(await harness.createScore.execute(ALICE, input));

    // RICH_WIRE_FIXTURE is canonical, so the stored score is the fixture with the server identity.
    const expectedSpec = { ...cloneFixture(RICH_WIRE_FIXTURE), id: 'scr_0001', revision: 1 };
    expect(output.artifact).toEqual({
      state: 'draft',
      scoreId: 'scr_0001',
      revision: 1,
      score: expectedSpec,
      createdAt: '2026-09-28T12:00:00.000Z',
      updatedAt: '2026-09-28T12:00:00.000Z',
      expiresAt: '2026-10-05T12:00:00.000Z',
    });
  });

  it('stores exactly one draft for the principal and never writes to the permanent library', async () => {
    const harness = makeHarness({ ids: ['scr_0001'] });

    expectOk(await harness.createScore.execute(ALICE, { score: scorePayload(RICH_WIRE_FIXTURE) }));

    expect(harness.store.calls).toEqual([{ method: 'drafts.create', owner: 'user-a' }]);
    expect(harness.store.draftCount).toBe(1);
    expect(harness.store.savedCount).toBe(0);
    expect(harness.store.draftOf('user-a', 'scr_0001')).toEqual({
      spec: { ...cloneFixture(RICH_WIRE_FIXTURE), id: 'scr_0001', revision: 1 },
      createdAt: new Date('2026-09-28T12:00:00.000Z'),
      updatedAt: new Date('2026-09-28T12:00:00.000Z'),
      expiresAt: new Date('2026-10-05T12:00:00.000Z'),
    });
  });

  it('takes the expiry from the injected policy, not from a formula of its own', async () => {
    const harness = makeHarness({ ids: ['scr_0002'], ttlMs: 90 * MINUTE });

    const output = expectOk(
      await harness.createScore.execute(ALICE, { score: scorePayload(RICH_WIRE_FIXTURE) }),
    );

    expect(output.artifact.expiresAt).toBe('2026-09-28T13:30:00.000Z');
    expect(harness.store.draftOf('user-a', 'scr_0002')?.expiresAt).toEqual(
      new Date('2026-09-28T13:30:00.000Z'),
    );
  });
});
