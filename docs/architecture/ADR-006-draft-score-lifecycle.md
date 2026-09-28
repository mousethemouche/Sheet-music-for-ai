# ADR-006 — Persist unsaved score drafts with TTL

- **Status:** Accepted
- **Date:** 2026-09-28
- **Scope:** MVP v1

## Context

A generated score is a living conversational artifact. A user may create a score in one turn and modify it several turns later before ever choosing to save it to their permanent library.

The MCP/API runtime is deployed on Vercel and must be treated as stateless. In-memory state is therefore not durable across:

- separate serverless invocations;
- instance recycling;
- cold starts;
- deployments;
- horizontal scaling.

Passing the full canonical score state through every model/tool call would also create unnecessary context/payload cost for 8–32 measure scores.

The product rule remains:

> A score must not enter the user's permanent saved library without explicit confirmation.

This rule does not forbid temporary technical persistence required to maintain a conversational artifact.

## Decision

Unsaved score artifacts will be persisted server-side in a dedicated **draft store** backed by Postgres/Supabase.

Drafts:

- are owned by the authenticated user;
- are invisible from the permanent saved-score library;
- survive Vercel deployments and serverless instance recycling;
- use the canonical versioned `ScoreSpec`;
- use the same revision/optimistic-concurrency rules as saved scores;
- expire automatically via TTL;
- are promoted to permanent saved scores only after an explicit save action.

## Data model

Conceptually:

```text
score_drafts
--------------------------------
id
owner_user_id
score_spec JSONB
revision
score_spec_version
expires_at
created_at
updated_at
```

Permanent scores remain separate:

```text
scores
--------------------------------
id
owner_user_id
score_spec JSONB
revision
title
tags
created_at
updated_at
```

A draft is not returned by normal library/search queries.

## Default TTL

MVP default:

> **7 days after the latest draft update**

Each successful draft edit refreshes `expires_at`.

The TTL must be configurable, not hard-coded as a permanent domain invariant.

## Lifecycle

```text
create_score
    |
    v
draft row created
    |
    v
edit_score
    |
    v
same draft row updated + revision increment + TTL refresh
    |
    +---- no explicit save ----> expires and is deleted
    |
    v
explicit save_score
    |
    v
transactional promotion to permanent score
    |
    v
draft removed
```

## Promotion semantics

Saving a draft should preserve the same logical score identity whenever practical.

The save operation should atomically:

1. validate authenticated owner;
2. validate expected revision;
3. create/update the permanent score record using the current canonical ScoreSpec;
4. preserve the logical score ID;
5. apply title/tags confirmed by the user;
6. remove the corresponding draft record;
7. return the saved canonical artifact.

A failed promotion must not delete the draft.

## Behavior after promotion

Once the artifact is a saved score, later edits target the saved canonical artifact rather than recreating a draft by default.

The explicit-consent rule applies to **entering the permanent library**. Once an artifact is already saved, edits may update that same saved logical artifact unless the product later introduces explicit version/fork semantics.

## Version compatibility

Drafts persist across application deployments, so every persisted ScoreSpec includes its schema version.

A deployment that introduces a backward-incompatible ScoreSpec change must provide a migration/read-upgrade path before removing support for persisted older versions.

CI/release rule:

> A new application version must be able to read currently persisted ScoreSpec versions, or ship a tested migration before deployment.

Renderer/playback adapter changes do not require draft migrations unless the canonical ScoreSpec itself changes.

## Cleanup

Expired drafts are removed by a scheduled cleanup job.

The cleanup process:

- deletes only rows with `expires_at < now()`;
- is idempotent;
- does not touch permanent scores;
- may run hourly/daily depending on cost;
- must be safe if it runs concurrently with normal draft activity.

Where possible, deletion should include a revision/update-time safety condition so a recently refreshed draft is not removed based on stale selection.

## Authorization

Draft rows are private user data.

- all draft repository operations require authenticated `UserId`;
- RLS/application authorization must prevent cross-user reads and writes;
- draft IDs alone never authorize access;
- service-role credentials remain server-only.

## Repository boundary

Application code depends on a neutral draft repository port such as:

```ts
interface ScoreDraftRepository {
  create(owner: UserId, draft: ScoreDraft): Promise<ScoreDraft>
  get(owner: UserId, id: ScoreId): Promise<ScoreDraft | null>
  update(owner: UserId, draft: ScoreDraft, expectedRevision: number): Promise<ScoreDraft>
  delete(owner: UserId, id: ScoreId): Promise<void>
}
```

Supabase/Postgres is an infrastructure adapter, not part of the music domain.

## MCP implications

- `create_score` creates a server-side draft.
- `edit_score` loads and mutates that draft (or permanent score after save).
- `save_score` promotes the current draft to permanent storage.
- the model does not need to resend the full ScoreSpec on every edit.
- MCP tools must never expose draft persistence as if it were a user-visible save.

## Consequences

### Positive

- conversational scores survive deployments and serverless lifecycle;
- edit payloads remain small;
- optimistic concurrency remains server-enforced;
- permanent library consent semantics remain intact;
- multi-user isolation is straightforward;
- canonical ScoreSpec versioning handles deployment evolution.

### Costs

- one additional persistence table/repository;
- cleanup job;
- version migration discipline;
- temporary storage exists even before explicit library save.

These costs are accepted because conversational continuity is a core product requirement.

## Acceptance criteria

- [ ] create_score persists an owner-scoped draft.
- [ ] edit_score can retrieve and update it on a later independent request.
- [ ] draft survives a simulated application restart/deployment.
- [ ] successful edits refresh TTL.
- [ ] drafts never appear in permanent library/search.
- [ ] explicit save atomically promotes the artifact.
- [ ] failed save does not lose the draft.
- [ ] expired drafts are safely cleaned up.
- [ ] User A cannot access User B's drafts.
- [ ] persisted older ScoreSpec versions have tested migration/read compatibility.
