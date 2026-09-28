# Application layer and transport contracts

Use cases, ports and shared contracts of issues #8 (CreateScore), #10
(SaveScore, GetScore, SearchScores), the EditScore orchestration used by #13,
the expiry policy unit of #22 (DRAFT-01), and the transport-neutral contracts
shared by MCP (#11-#14) and HTTP (#21). ADR-003, ADR-005 and ADR-006 remain the
decision records; this page fixes what they leave open.

| Package                      | Holds                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/music-contracts`   | zod schemas and types: tool inputs/outputs, HTTP DTOs, artifacts, error envelope, limits |
| `packages/music-application` | use cases, neutral ports, draft expiry policy, application errors                        |

Dependencies point inward: `music-application -> music-contracts -> music-domain`.
Neither package imports NestJS, the MCP SDK, `pg`, Supabase, `jose`, React or a
media library (`pnpm check:arch` enforces it).

## 1. Calling a use case

```ts
const result = await editScore.execute(principal, input);
// result: { ok: true, value: EditScoreOutput } | { ok: false, error: ApplicationError }
```

- `principal` is the `AuthenticatedPrincipal` (`{ userId }`) that the inbound
  auth adapter built from a verified token (#26) or web session (#25). It is a
  separate argument, never a field of `input`.
- `input` is the untrusted request body (`unknown`). Each use case parses it
  with its music-contracts schema, so an adapter cannot forget validation and
  every transport gets the same `INVALID_INPUT` details.
- Order of checks: principal (`UNAUTHENTICATED`), then input (`INVALID_INPUT`),
  then state. Nothing touches storage before both pass.
- Expected failures are returned, never thrown. A bug may still throw; the
  transports turn that into `INTERNAL` (#19).

## 2. Identity and ownership

- `UserId` is the stable auth subject. A missing principal, or one whose
  `userId` is not a non-blank string, is `UNAUTHENTICATED`.
- Every input object is closed (`strictObject`): `ownerId`, `userId`,
  `confirmed` or any other extra field is `INVALID_INPUT` / `UNKNOWN_FIELD`,
  never silently ignored.
- Every repository and promotion call receives the owner. Another user's row
  behaves exactly like a missing one, so a foreign ID and a missing ID produce
  the same `NOT_FOUND` error, byte for byte.

## 3. Ports

All ports live in `music-application/src/ports.ts`.

### 3.1 Conventions

- Expected outcomes are values: `null` for a missing row, `'stale'` for a lost
  compare-and-swap, `{ status: 'stale' }` for a promotion with no matching draft.
- An infrastructure failure rejects the promise. The use cases map any
  rejection to `DEPENDENCY_UNAVAILABLE`, except `StoredScoreUnreadableError`
  (a stored score this build cannot read, such as an unsupported ScoreSpec
  version), which maps to `INTERNAL`. The original error is kept as a
  non-enumerable `cause` for server logs (#19) and is never serialized.
- There is no in-memory fallback and no retry inside the use cases.

### 3.2 Records

| Type                | Fields                                                      | Notes                                                        |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| `ScoreDraft`        | `spec`, `createdAt`, `updatedAt`, `expiresAt`               | ID and revision are `spec.id` / `spec.revision`              |
| `SavedScore`        | `spec`, `title`, `tags`, `createdAt`, `updatedAt`           | `createdAt` = time the score entered the library (promotion) |
| `SavedScoreSummary` | `id`, `title`, `tags`, `revision`, `createdAt`, `updatedAt` | search results, no score content                             |

- **Library title and tags are not ScoreSpec metadata.** They are the
  `scores.title` / `scores.tags` columns of ADR-005/006. `spec.metadata.title`
  and `spec.metadata.tags` stay the document's own fields, edited only by
  `set_title` / `set_tags`. Saving never rewrites the ScoreSpec, which is why
  the revision does not change on promotion.
- `spec` is always a canonical ScoreSpec returned by `validateScoreSpec` or
  `applyScoreEdit`. Adapters validate what they read back (and upgrade older
  versions, ADR-006) before returning it.
- Drafts and saved scores share one ID space (promotion keeps the ID).

### 3.3 `Clock`, `IdGenerator`, `DraftExpiryPolicy`

- `Clock.now()` is read once per request.
- `IdGenerator.newScoreId()` must return a unique ID matching the ScoreSpec ID
  pattern (for example `scr_` + UUID). An ID that breaks the pattern is
  `INTERNAL` and nothing is stored.
- `createDraftExpiryPolicy(ttlMs = 7 days)`:
  - `expiresAt(writtenAt) = writtenAt + ttlMs`, where `writtenAt` is the latest
    successful write (creation or edit);
  - `isExpired(expiresAt, now)` is `now >= expiresAt`: live one millisecond
    before, expired exactly at `expiresAt`;
  - access is blocked from `expiresAt` on, whether or not cleanup has deleted
    the row;
  - the TTL must be a positive safe integer of milliseconds (`RangeError`
    otherwise). A changed TTL applies from each draft's next successful write;
    stored `expiresAt` values are not recomputed.

### 3.4 `ScoreDraftRepository`

| Method                                   | Contract                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `create(owner, draft)`                   | insert; rejects on any failure, including an ID collision                                |
| `get(owner, id)`                         | the owner's row, expired or not (the use case decides), or `null`                        |
| `update(owner, draft, expectedRevision)` | replace only if the owner's row is still at `expectedRevision`; `'updated'` or `'stale'` |
| `delete(owner, id)`                      | idempotent delete (for adapters and cleanup; no use case deletes drafts directly)        |

`update` must be a single conditional write
(`... WHERE owner = $1 AND id = $2 AND revision = $3`). `'stale'` covers every
reason no row matched: another edit won, the draft was promoted, or cleanup
removed it. The DRAFT-03 cleanup must re-check `expires_at` when it deletes, so
a draft refreshed after being selected survives (#22).

`update` takes no instant and does not re-check `expires_at`. EditScore
decides liveness once, at the request instant `now` (§4), which is the edit's
logical time. An `expires_at > now` predicate on the write would change
nothing: only a successful write changes `expires_at`, and it also increments
the revision, so a row still at `expectedRevision` carries the `expires_at`
that was live at `now`. The consequence is deliberate: an edit resolved just
before `expiresAt` may commit a few milliseconds after it and renews the draft
to `policy.expiresAt(now)` as usual, while a read in that window reports
`NOT_FOUND`. If cleanup deleted the row first, the write is `'stale'`
(`REVISION_CONFLICT`), never a phantom success.

### 3.5 `SavedScoreRepository`

- `get(owner, id)`, and `update(owner, saved, expectedRevision)` with the same
  compare-and-swap contract as drafts.
- `search(owner, query)` returns `{ items, total }` for one page of the
  owner's saved scores only (never drafts). Query and semantics:

| Field    | Meaning                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------- |
| `text?`  | normalized free text (§7); matches when it is a case-insensitive substring of the title or of any one tag |
| `tags`   | normalized tag filters; a score matches when it carries every one of them, compared case-insensitively    |
| `limit`  | page size, 1-50 (default 20)                                                                              |
| `offset` | 0-10000 (default 0)                                                                                       |

Order: `updatedAt` descending, then `id` ascending, so ties are stable across
pages. `total` counts all matches of the owner. User text must reach SQL as
bound parameters, with `%`, `_` and `\` escaped for `LIKE`/`ILIKE` (DB-02,
#9). #9 may refine matching (for example accent folding) but must update
this table.

### 3.6 `ScorePromotion`

`promote(owner, { id, expectedRevision, title, tags, now })` runs in ONE
transaction:

1. find the owner's draft `id` that is live at `now` (`expires_at > now`) and at
   `expectedRevision`, locking it;
2. insert the saved score: same ID, same ScoreSpec (same revision), the given
   normalized title and tags, `createdAt = updatedAt = now`;
3. delete the draft;
4. return `{ status: 'promoted', saved }`.

If no such draft exists it returns `{ status: 'stale' }` and changes nothing.
Any failure rolls back and rejects, and the draft stays intact (DRAFT-04, #22).

## 4. Resolving a score ID

`get_score` and `edit_score` accept the ID of a draft or of a saved score:

1. look up the owner's saved score; if found, use it;
2. otherwise look up the owner's draft; use it if it is live at `now`;
3. otherwise `NOT_FOUND`.

**If both exist** (impossible after a correct promotion, so an adapter fault),
the saved score wins: the user-approved state is never shadowed, and the stray
draft stays invisible until it expires. A get or edit that races with a
promotion can see neither row and report `NOT_FOUND`; retrying resolves it.

`GetSavedScore` (for `GET /scores/:id`) only does step 1: an own draft is
`NOT_FOUND` there.

## 5. Use cases

### 5.1 CreateScore (`create_score`, #8)

1. Input `{ score }`: `score` is a JSON object; `id` and `revision` must be
   absent because the server assigns them (`INVALID_INPUT` at
   `["score", "id"]` otherwise).
2. The use case builds `{ ...score, id: newScoreId(), revision: 1 }` and runs
   `validateScoreSpec`. Domain errors keep their code and details; their paths
   get the `["score", ...]` prefix so they point into the request.
3. It stores a draft with `createdAt = updatedAt = now` and
   `expiresAt = policy.expiresAt(now)`. It never writes a saved score.
4. It returns `{ artifact: DraftArtifact }`.

Every inner ID (staves, bars, voices, events, notes, spans, annotations) is
kept exactly as the client gave it; the output is the canonical ScoreSpec
(clefs filled, colors canonical). A store failure is `DEPENDENCY_UNAVAILABLE`
and nothing is kept in memory. Create is not idempotent: a retry after a lost
response creates a second draft, and the orphan expires.

### 5.2 EditScore (`edit_score`, #13)

1. Input `{ scoreId, expectedRevision, operations }`. The operations are
   validated by the domain (ScoreOperations v1, 1-64).
2. Resolve the ID (§4) at `now`.
3. `applyScoreEdit(current, { expectedRevision, operations })`. Domain errors
   pass through unchanged (`REVISION_CONFLICT`, `INVALID_OPERATION`,
   `TARGET_NOT_FOUND`, `SCORE_VALIDATION_FAILED` with
   `ANNOTATION_COLOR_CONFLICT`, `MVP_LIMIT_EXCEEDED`); paths point into the
   command or the resulting document, as SCORE_OPERATIONS_V1.md §8 defines.
4. Compare-and-swap at the loaded revision:
   - draft: new spec, `updatedAt = now`, `expiresAt = policy.expiresAt(now)`;
   - saved: new spec, `updatedAt = now`; title, tags and `createdAt` unchanged;
     no draft is created.
5. A `'stale'` write is `REVISION_CONFLICT` (`REVISION_MISMATCH` at
   `["expectedRevision"]`, `ids: [scoreId]`); the concurrent state is kept.

A failed edit writes nothing, so the revision and the TTL stay as they were.
Only step 4 renews a draft's TTL.

### 5.3 SaveScore (`save_score`, #10/#14)

Input `{ scoreId, expectedRevision, title, tags? }`, normalized as in §7.

1. If the owner already has a saved score with this ID, apply the replay rule
   below.
2. Load the owner's draft: missing or expired is `NOT_FOUND`; a different
   revision is `REVISION_CONFLICT`, naming the current revision.
3. Call `promote(...)`. `promoted` returns
   `{ outcome: 'saved', artifact: SavedArtifact }`.
4. `stale` means the draft changed after step 2. Re-read the saved score: if a
   concurrent save won, apply the replay rule; otherwise `REVISION_CONFLICT`.
5. A promotion failure is `DEPENDENCY_UNAVAILABLE`, and the draft is intact.

**Replay rule (frozen contract).** Saving an ID that is already saved:

| Stored saved score vs request                     | Result                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| same revision, same title, same tags (same order) | success, `outcome: 'already_saved'`, the stored artifact, no write   |
| anything else                                     | `ALREADY_SAVED`, message names the current revision, nothing written |

A save never creates a second library entry and never overwrites the title,
tags or content of an existing one. Library metadata cannot be changed in MVP
(no metadata route exists, #21).

**Consent.** Calling SaveScore is the save request. The contract has no
`confirmed` flag: a flag written by the model proves nothing (#10, #14), and
the strict schema rejects one. The human's approval is enforced where the
human is: the host's tool-approval flow or UI, checked in the target-host
release check. The application does not pretend to verify it.

### 5.4 GetScore and GetSavedScore (`get_score`, `GET /scores/:id`)

- GetScore resolves the ID (§4) and returns `{ artifact: ScoreArtifact }`.
- GetSavedScore returns `{ artifact: SavedArtifact }` or `NOT_FOUND` for
  anything that is not a saved score, including an own draft.
- Reads write nothing: no promotion, no TTL renewal, no revision change.
- An unreadable stored score is `INTERNAL`; a store outage is
  `DEPENDENCY_UNAVAILABLE`.

### 5.5 SearchScores (`search_scores`, `GET /scores`)

- Input `{ query?, tags?, limit?, offset? }`. A blank `query` means no text
  filter. The repository receives the normalized `SavedScoreQuery` (§3.5).
- Output `{ items: ScoreSummary[], page: { limit, offset, total, nextOffset } }`.
  `nextOffset = offset + items.length` when the page is not empty and more
  matches remain, otherwise `null`.
- No match is a successful empty page. A store failure is
  `DEPENDENCY_UNAVAILABLE`, never an empty page.

## 6. Errors

`ApplicationError = { code, message, details, cause? }`. The transports add a
correlation ID and serialize the music-contracts envelope
`{ code, message, details?, correlationId? }` (`cause` is non-enumerable and
never serialized). Details have the domain shape
`{ code, path, message, ids? }`; messages never quote free text from the
request.

| Code                      | Origin                                               | Suggested HTTP (#19) |
| ------------------------- | ---------------------------------------------------- | -------------------- |
| `INVALID_INPUT`           | contract schema: shape, bounds, unknown fields       | 400                  |
| `SCORE_VALIDATION_FAILED` | domain: ScoreSpec rules, including P-03              | 400                  |
| `MVP_LIMIT_EXCEEDED`      | domain: every problem is an MVP limit                | 400                  |
| `INVALID_OPERATION`       | domain: malformed or inapplicable edit command       | 400                  |
| `TARGET_NOT_FOUND`        | domain: an operation targets a missing element       | 400                  |
| `UNAUTHENTICATED`         | no valid principal                                   | 401                  |
| `NOT_FOUND`               | missing, foreign or expired score                    | 404                  |
| `REVISION_CONFLICT`       | stale `expectedRevision` or lost compare-and-swap    | 409                  |
| `ALREADY_SAVED`           | save of an already saved score that is not a replay  | 409                  |
| `DEPENDENCY_UNAVAILABLE`  | a port rejected (store outage)                       | 503                  |
| `INTERNAL`                | unreadable stored score, invalid generated ID, a bug | 500                  |

Input detail codes: `INVALID_TYPE`, `INVALID_VALUE`, `UNKNOWN_FIELD`,
`TEXT_TOO_LONG`, `TOO_MANY_ITEMS` (paths point into the request).
`REVISION_CONFLICT` raised by the application uses `REVISION_MISMATCH` at
`["expectedRevision"]` with `ids: [scoreId]`, like the domain.

**An expired draft is `NOT_FOUND`, not a distinct `DRAFT_EXPIRED`.** The answer
is the same before and after physical cleanup, the same as for a foreign or
missing ID, and it reveals no timing. The message says that unsaved drafts
expire and that the score can be created again, which is the only useful
action either way.

`DEPENDENCY_UNAVAILABLE` does not promise that nothing changed: a write whose
acknowledgement was lost may have committed. Its message asks the client to
reload before retrying an edit or a save; the compare-and-swap then turns a
duplicate retry into `REVISION_CONFLICT` instead of a double edit.

## 7. Contracts (`music-contracts`)

### 7.1 Tools

`TOOL_CONTRACTS` maps each tool name to `{ input, output }` schemas. Every
schema must stay convertible to a JSON Schema object with `z.toJSONSchema`
(inputs with `io: 'input'`, outputs with `io: 'output'`), because MCP
discovery publishes them; the #11 discovery test exercises that. Transforms
are therefore only used in input schemas.

| Tool            | Input                                         | Output                                      |
| --------------- | --------------------------------------------- | ------------------------------------------- |
| `create_score`  | `{ score }` (ScoreSpec without id/revision)   | `{ artifact: DraftArtifact }`               |
| `edit_score`    | `{ scoreId, expectedRevision, operations }`   | `{ artifact: ScoreArtifact }`               |
| `save_score`    | `{ scoreId, expectedRevision, title, tags? }` | `{ outcome, artifact: SavedArtifact }`      |
| `get_score`     | `{ scoreId }`                                 | `{ artifact: ScoreArtifact }`               |
| `search_scores` | `{ query?, tags?, limit?, offset? }`          | `{ items: ScoreSummary[], page: PageInfo }` |

- `ScoreArtifact` is `DraftArtifact | SavedArtifact`, discriminated by
  `state`. Both carry `scoreId`, `revision` (equal to `score.id` and
  `score.revision`), the canonical `score` and ISO-8601 UTC timestamps; a draft
  adds `expiresAt`, a saved score adds `title` and `tags`.
- The wire schemas check the envelope only. `score` and `operations` are typed
  as a JSON object / array and validated by music-domain, which reports the
  detailed ScoreSpec/ScoreOperations errors. For discovery, #11/#12 may attach
  the ScoreSpec JSON Schema (`z.toJSONSchema(scoreSpecSchema, { io: 'input' })`
  converts; the output mode does not, because of the color transform) as
  documentation, but should not let the SDK pre-validate `score` with it:
  that would replace the domain's structured details with SDK messages.
- Outputs are closed objects with a `type: object` root, as MCP
  `outputSchema`/`structuredContent` requires.

### 7.2 HTTP (`GET /scores`, `GET /scores/:id`)

- `listScoresQuerySchema` parses the query string (`query`, repeatable `tags`,
  `limit`, `offset` as decimal strings; unknown parameters rejected) into the
  `search_scores` input, so both transports share normalization, bounds and
  defaults. Response: `ListScoresResponse` (same shape as the tool output).
- `savedScoreParamsSchema` validates `{ id }`; the response is the
  `SavedArtifact` itself (`savedScoreResponseSchema`). Drafts are never served
  by the HTTP routes.

### 7.3 Payload limits (`PAYLOAD_LIMITS`, reused by #24)

| Limit                             | Value             | Enforced by                    |
| --------------------------------- | ----------------- | ------------------------------ |
| request body                      | 512 KiB           | HTTP/MCP middleware (#24), 413 |
| library title                     | 1-120             | `save_score` schema            |
| tags per saved score / tag length | 0-16 / 40         | `save_score` schema            |
| search text                       | 0-200             | `search_scores` schema         |
| tag filters                       | 0-16              | `search_scores` schema         |
| page size (default) / max offset  | 1-50 (20) / 10000 | `search_scores` schema         |
| operations per edit               | 1-64              | music-domain (mirrored)        |

Text lengths count Unicode code points after normalization. The body cap
comes from measurement: the rich wire fixture (4 two-hand bars with every
notation layer) is 5.7 kB, so a 32-bar score of that density is about 46 kB.
Music limits (bars, staves, annotations...) stay in `MVP_LIMITS` of the domain.

## 8. Library metadata normalization

Applied to titles, tags, tag filters and search text:

1. Unicode NFC;
2. every whitespace run (spaces, tabs, line breaks) becomes one space;
3. trim.

Then:

- title: required, 1-120 code points;
- tags: each 1-40 code points; duplicates are removed ignoring case
  (`toLowerCase`), keeping the first spelling and the order; at most 16
  remain (counted after de-duplication); zero tags is valid; there is no
  taxonomy;
- remaining control characters (U+0000-U+001F, U+007F-U+009F) are rejected:
  they mean nothing in a title or tag and PostgreSQL cannot store U+0000;
- case is preserved in storage; matching is case-insensitive (§3.5).

## 9. Tests

Unit tests, `packages/music-application/test/`, over in-memory test doubles in
`test/support/` (not exported by the package) and the real expiry policy:

| Test      | File                                        | Covers                                                                               |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| CREATE-01 | `create-01-create-score.test.ts`            | generated ID, revision 1, inner IDs kept, policy TTL, draft only                     |
| CREATE-02 | `create-02-create-score-rejections.test.ts` | domain/limit rejections, malformed envelopes, principal, store failure, bad ID       |
| LIB-01    | `lib-01-save-preconditions.test.ts`         | promotion, blocked preconditions, replay rule, concurrent save/edit, failure         |
| LIB-02    | `lib-02-reads.test.ts`                      | draft/saved resolution, saved wins, foreign = missing, saved-only get, search        |
| LIB-03    | `lib-03-metadata.test.ts`                   | normalization and bounds of title and tags                                           |
| DRAFT-01  | `draft-01-expiry.test.ts`                   | policy, exact boundary, renewal only on successful edits, access blocked pre-cleanup |
| EDIT      | `edit-score.test.ts`                        | draft and saved paths, domain rejections, lost CAS, store failure, owner, input      |

Reused, not repeated here: ScoreSpec and operation rules (#2/#3), real
compare-and-swap and search semantics (DB-02/03, #9), cleanup and promotion
races on the real database (DRAFT-02..04, #22), route wiring and owner
isolation (FLOW-01/ACCESS-01, #18), direct RLS (#27), error-to-status mapping
(#19), request limits (#24).
