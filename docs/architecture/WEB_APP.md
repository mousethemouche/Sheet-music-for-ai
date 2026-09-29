# Web app: saved library and standalone player

The saved-score library of `apps/web` (issue #15, US-E3/F1/F2/F3) and the
standalone ScorePlayer wiring: real VexFlow renderer and SpessaSynth engine
behind `@sheet-music/score-ui`, and the playback assets served from the web
origin. Authentication is [WEB_AUTH.md](WEB_AUTH.md) (#25); the HTTP routes the
library reads are APPLICATION_LAYER.md §7.2 (#21).

## Layout

| Path                                 | Role                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `src/api/config.ts`                  | `readApiConfig`: validates `VITE_API_BASE_URL`                                               |
| `src/api/scoresApi.ts`               | `createScoresApi`: typed, read-only client of `GET /scores` and `GET /scores/:id`            |
| `src/library/LibraryPage.tsx`        | `/library`: own saved summaries, text and tag search, "Show more"                            |
| `src/library/ScorePage.tsx`          | `/scores/:scoreId`: one saved score in the shared ScorePlayer, its metadata and stable ID    |
| `src/library/ApiFailureAlert.tsx`    | Failure messages and recovery actions (sign in again, back to library, try again)            |
| `src/library/privateState.ts`        | `useSignedInUser`, `usePrivateCleanup` (registry of WEB_AUTH.md)                             |
| `src/library/services.ts`            | `LibraryServices = { scores, player }`, the `library` prop of `App`                          |
| `src/player/webPlayer.ts`            | `createWebPlayer`: stable ScorePlayer ports, `stopAudio()`, sound credits                    |
| `src/player/browserPlayer.ts`        | `createBrowserPlayer`: binds VexFlow and SpessaSynth; imported only by `main.tsx`            |
| `src/player/assetPaths.ts`           | `PIANO_ASSET_PATH`, shared by the Vite config and the player                                 |
| `src/player/CreditsPage.tsx`         | `/about`: SoundFont attribution with links to the published license and notice               |
| `vite.config.ts`                     | `pianoSoundFont` plugin: serves (dev) and emits (build) the SoundFont directory              |
| `src/library/test/`, `src/api/test/` | LIB-UI-01..03, the API config and access-token tests, fakes (`support.tsx`, `fakePlayer.ts`) |

`main.tsx` is the composition root. It builds the API client (Bearer token
from `AuthPort.getAccessToken`) and the browser player once per page load and
passes them to `App` as `library`. Tests pass the same `App` a real API client
over a fake `fetch` and the real `createWebPlayer` over fake renderer/engine
factories, so no test loads VexFlow or SpessaSynth.

## Routes added

| Route              | Access    | Behaviour                                                                            |
| ------------------ | --------- | ------------------------------------------------------------------------------------ |
| `/library`         | protected | The library (replaces the #25 placeholder; keeps "Your library" and "Signed in as"). |
| `/scores/:scoreId` | protected | One saved score. Only saved scores: drafts are never served by the HTTP routes.      |
| `/about`           | public    | About and credits, linked from the footer of every page and from the score page.     |

## API client (`createScoresApi`)

- Read-only: `listScores(search, signal)` and `getSavedScore(id, signal)`. The
  web app never writes a score; saving stays the MCP `save_score` tool, so
  opening or browsing can never save anything implicitly.
- Every request: `GET`, `Authorization: Bearer <access token>`,
  `Accept: application/json`, `credentials: 'omit'` (no cookie) and
  `cache: 'no-store'` (a private response must not sit in the browser cache,
  which is not keyed by user). No token (no session) answers
  `unauthenticated` without sending anything.
- Query string of `GET /scores` (`listScoresQuerySchema`): `query` only when
  the trimmed text is not blank, one `tags` parameter per tag filter in order,
  `offset` only when above 0, `limit` never (server default 20). The server
  does the normalization (APPLICATION_LAYER.md §8).
- Success bodies are parsed with `listScoresResponseSchema` and
  `savedScoreResponseSchema`; `getSavedScore` also requires the answered
  `scoreId` to be the one asked for. Anything else (a draft, an extra field,
  a non-ISO date, a non-object `score`, non-JSON) is a `failed` result: never
  an empty page and never a mounted player. The ScoreSpec itself is validated
  by the ScorePlayer (`validateScoreSpec`, #7).
- Error bodies are parsed with `errorEnvelopeSchema`, which accepts the
  use-case and the transport codes (`FORBIDDEN_ORIGIN`, `LENGTH_REQUIRED`,
  `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`). The UI decides on the HTTP status;
  the envelope only contributes its code and correlation ID. Its message is
  never shown.

| Status / event                       | Kind              | UI                                                                      |
| ------------------------------------ | ----------------- | ----------------------------------------------------------------------- |
| 401, or no session token             | `unauthenticated` | "Sign in again": ends the local session; the guard returns to this page |
| 404                                  | `not-found`       | score: "not in your library" + "Back to your library"; list: retry      |
| 502, 503, 504, no response           | `unavailable`     | "temporarily unavailable" + "Try again"                                 |
| token renewal cannot reach Supabase  | `unavailable`     | same; not a sign-in request                                             |
| 429                                  | `rate-limited`    | "Too many requests" + "Try again"                                       |
| 400                                  | `rejected`        | search: shorten it or remove tag filters                                |
| other (403, 500...), contract breach | `failed`          | "could not be loaded/opened" + "Try again"                              |

A correlation ID, when the response carries one, is shown as "Reference". A
cross-origin response header is only readable if the API exposes it
(`Access-Control-Expose-Headers: x-correlation-id`); error envelopes carry it
anyway.

`AuthPort.getAccessToken()` is the one addition to the auth port (announced
in WEB_AUTH.md): the Supabase adapter returns `session.access_token` from
`getSession()` (which renews an expired token), null without a session, and
rejects when a renewal could not reach the provider.

## Library page

- States are distinct and accessible: one `role="status"` line (loading,
  "Showing N of M saved/matching scores.", "Your library is empty...", "No
  saved scores match your search.") and a `role="alert"` block for failures.
  A failure never shows the empty or no-match text.
- Each summary: the title as a link to `/scores/<id>`, "Updated <date>"
  (`<time datetime>`), and each tag as a "Filter by tag X" button. Titles and
  tags are React text, never markup.
- Search runs on submit (no debounce). Tag buttons add an AND filter (not
  twice, at most 16, the contract bound); active filters are listed with
  "Remove tag filter X"; "Clear search" resets text and tags. The input caps
  the text at 200 characters.
- "Show more" requests `offset = page.nextOffset` with the same search and
  appends the page (an item already shown is kept once).
- Latest request wins: every new search, retry or page aborts the previous
  request and ignores its response even if it still arrives. Unmounting
  aborts too.

## Score page

- The route ID is checked with `scoreIdSchema` first: an ID that cannot exist
  is answered as not found, without a request.
- One `GET /scores/:id`; the SavedArtifact goes unchanged to ONE `ScorePlayer`
  (its `scoreId`, `revision` and `score`). The player never autoplays.
- Shows title, tags, saved and updated dates, revision and the stable score
  ID with how to use it: give it to the AI to keep working on the score
  (edits of a saved score update it in place, APPLICATION_LAYER.md §5.2).
- The view is keyed by user and score ID: opening another score, or another
  account signing in, replaces the player (the old renderer and engine are
  destroyed).

## Private state

The library keeps no cache beyond the mounted page: summaries and the open
score live in component state, keyed by the user ID, and requests use
`cache: 'no-store'`. With the registry of WEB_AUTH.md:

- the library page registers "abort the in-flight list request";
- the score page registers `player.stopAudio()` (every live engine `stop()`s
  at once: notes and pedal released, a pending play cancelled) and "abort the
  in-flight score request".

Sign-out runs them before the provider sign-out; the guard then unmounts the
page, which destroys the player's engine. An account switch remounts the
pages for the new user.

## Player wiring and playback assets

`createBrowserPlayer({ href, basePath })`, called once in `main.tsx`:

- renderer: `createVexFlowRendererFactory()` (fonts embedded as `data:` URLs,
  nothing fetched);
- engine: `createSpessaSynthEngine({ soundFont: { url }, workletModuleUrl })`
  with `url = <origin><base>assets/soundfonts/piano/ms-basic-grand-piano.sf3`
  (`resolvePianoAssetUrl`) and `workletModuleUrl` =
  `SPESSASYNTH_PROCESSOR_URL` resolved against the page;
- credits: `PIANO_SOUNDFONT.attribution` with the published `LICENSE.txt` and
  `NOTICE.txt` URLs.

The Vite plugin `pianoSoundFont` publishes `assets/soundfonts/piano/` (the
`.sf3`, `LICENSE.txt` and `NOTICE.txt`, unhashed, as SOUNDFONT.md §2 and §6
require): the dev server answers those three paths from the repository
directory, and the build emits them to `dist/assets/soundfonts/piano/` after
checking the `.sf3` size and SHA-256 against `manifest.json` (the build fails
otherwise). The worklet processor needs no step: its `?url` import in
`playback-spessasynth` makes Vite emit `dist/assets/spessasynth_processor.min-<hash>.js`
(393 KB, far above the inlining limit).

Hosting (#16) must:

- serve `/assets/soundfonts/piano/*` with a long immutable cache
  (`Cache-Control: public, max-age=31536000, immutable`): the content is fixed
  by its SHA-256, and each opened score's engine fetches the 8.76 MiB file by
  URL, so without it the browser may download it again. Hashed `/assets/*` files can use the same header;
- rewrite app routes (`/library`, `/scores/*`, `/about`) to `index.html`;
- if it sets a CSP: `connect-src` the API origin, the Supabase project and
  `'self'` (SoundFont fetch); `script-src 'self'` covers the worklet module;
  `font-src data:` for the embedded engraving fonts.

## Environment

`apps/web/.env.example`; every value is compiled into the public bundle.

| Variable                        | Value                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | WEB_AUTH.md                                                                                          |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | WEB_AUTH.md                                                                                          |
| `VITE_API_BASE_URL`             | https URL of apps/api (http only for localhost, 127.0.0.1, [::1]), no credentials, query or fragment |

An invalid `VITE_API_BASE_URL` renders the configuration error page instead
of the app (bearer tokens must not travel over plain http). The API must list
the web origin in `API_ALLOWED_ORIGINS`.

## Tests

| ID / file                                              | Covers                                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIB-UI-01 `src/library/test/lib-ui-01-states.test.tsx` | loading, summaries, safe text, empty vs no match, 503/network/429/403/500/contract breach as retryable failures, 401 re-sign-in, no token, renewal outage, score 404/invalid ID/503 |
| LIB-UI-02 `src/library/test/lib-ui-02-search.test.tsx` | query, repeated tags, remove, clear, Show more offset; late older response ignored; abort on supersede, unmount and sign-out                                                        |
| LIB-UI-03 `src/library/test/lib-ui-03-open.test.tsx`   | open fetches once, one player on the canonical content, GET only, stable ID, invalid shapes refused before mounting, audio stopped before sign-out, score switch, credits           |
| `src/api/test/api-config.test.ts`                      | https-only API base URL                                                                                                                                                             |
| `src/api/test/supabase-access-token.test.ts`           | `getAccessToken` on real supabase-js (fake HTTP): null, access token, null after sign-out                                                                                           |

Reused, not repeated: ScorePlayer behaviour (UI-01..05, #7), renderer and
engine adapters (#5/#6, `spessasynth-engine.mcpui.test.ts`), sign-out and
account-switch clearing (AUTH-UI-02, #25), route ownership and the real API
contract (FLOW-01/ACCESS-01, #18/#21: add the web client's parser assertions
to that setup, not a second lifecycle).

Build checks (not automated): `dist/` holds the `.sf3` (SHA-256 equal to the
manifest), `LICENSE.txt`, `NOTICE.txt` and the processor (byte-identical to
`spessasynth_lib@4.3.14`), and no secret key or JWT. A throwaway Playwright
run (stubbed API, seeded session) of the dev server and of `vite preview`
rendered a saved rich fixture with the real VexFlow renderer, reached
"Ready" (SoundFont and worklet loaded from the web origin) and "Playing"
after a click, with no console error. Listening quality remains ASSET-03
(human review, SOUNDFONT.md §5).
