# Target-host check (Claude)

The one narrow check against a real MCP host, shared by #16 (external-host
check), #25 (the account and its sessions), #26 (OAUTH-04, host part), #11
(the host iframe CSP gate of MCP_UI_TEST_PROCESS.md), #14 (human approval of
the save) and #23 (ASSET-03 on the target host). TEST_PLAN.md §8: run it for
the first external release and after changes to auth, the MCP server or View,
the SDKs, the host CSP or the playback assets. It is not a per-PR recipe.

A person with an authorized Claude account runs it. An agent runs it only
with authorized access to that account; otherwise the result is recorded as
"not run: no authorized host access", never as a pass. The automated
provider part (Supabase OAuth, consent page, token audience, refresh) is the
OAUTH-04 cloud suite (RELEASE_CHECKLIST.md step 7); this page covers what
only the host can show.

## Before you start

- RELEASE_CHECKLIST.md steps 1-7 are done, and the OAUTH-04 result is known.
  Its `#2820 probe` observations say which client path works:
  - a public client works: add the connector without client credentials
    (Claude then identifies itself as a public client, through dynamic
    registration or, when the authorization server advertises it, a Client
    ID Metadata Document);
  - only a confidential client works: pre-register one (Authentication >
    OAuth Apps, confidential, redirect URI
    `https://claude.ai/api/mcp/auth_callback`) and enter its ID and secret in
    the connector's advanced settings (step 1);
  - neither works: the host check is blocked by supabase/auth#2820; record it
    and stop.
- Claude also requests `offline_access` when the authorization server's
  `scopes_supported` lists it (OAUTH-04 records that list), another trigger
  reported in supabase/auth#2820: if the probe passed but step 2 fails, look
  there first.
- A test account on the web app: sign up on `<web origin>/signup` with an
  address you control (not a tester's), and open the confirmation mail. The
  cloud suites' synthetic accounts are deleted after each run and cannot be
  reused.
- A Claude plan that allows custom connectors. On Team or Enterprise, an
  Owner adds the connector for the organization first.
- Keep the connector's tool permissions at the default "ask" behavior. Never
  choose "Always allow" for `save_score` during this check: step 6 tests the
  human approval of the save.
- Note the values of the record below before starting.

## Steps

| #   | Do                                                                                                                                                                                                                                                                                          | Expect                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Claude > Settings > Connectors > Add custom connector. Name: `Sheet Music for AI (release check)`. URL: the MCP URL exactly, path `/mcp` included. Advanced settings: empty, unless the probe requires the pre-registered confidential client.                                              | The connector is added, not yet connected.                                                                                                                                                                                                                                                                                                                           |
| 2   | Connect. In the browser tab that opens, sign in on the web app with the test account when asked. On "Allow ... to use your account?", check that the return address shown is `claude.ai`, then click **Deny**.                                                                              | Claude reports that the authorization was refused or failed; the connector stays disconnected and offers no tool.                                                                                                                                                                                                                                                    |
| 3   | Connect again and click **Allow**.                                                                                                                                                                                                                                                          | Claude shows the connector as connected, with five tools: `create_score`, `edit_score`, `get_score`, `save_score`, `search_scores`.                                                                                                                                                                                                                                  |
| 4   | New chat with the connector enabled: "Using Sheet Music for AI, write an 8-bar piano piece in C major with a slurred melody, a crescendo and chord symbols." Approve the `create_score` call. Press **Play** in the score, then **Pause**.                                                  | The score appears inline: staves, notes, the slur and the chord symbols are drawn (the engraving fonts are bundled bytes and need no `font-src`, MCP_VIEW.md §4). Play sounds within a few seconds on a cold cache (the 8.76 MiB SoundFont loads from the MCP origin; the host allows `wasm-unsafe-eval`); the playing notes are highlighted; Pause stops the sound. |
| 5   | "Transpose it up a whole step and add fingerings 1, 2, 3 to the first three notes." Approve `edit_score`. Ask for the score ID and revision if Claude does not say them. Press **Play**.                                                                                                    | Same score ID, revision 2. The score shows the new version, at the start and paused; nothing of the old version keeps sounding (P-01). Play plays the transposed version.                                                                                                                                                                                            |
| 6   | "Save it to my library as `Release host check <date>`." When the `save_score` call is presented, **decline** it. Then: "Search my library for Release host check." Also open `<web origin>/library` signed in with the test account.                                                        | The save is presented for approval before it runs (record how: the host's tool approval, or Claude asking). After declining: the search finds nothing and the web library does not list it. A save that happens without any human approval is a FAIL of the consent boundary (#10, #14).                                                                             |
| 7   | Ask to save again and **approve** it. Search the library in the chat. Reload the web library and open the score. Then, in a new chat: "Open my saved score Release host check `<date>`."                                                                                                    | Claude reports it saved with that title; the search finds it; the web library lists it and its page plays it with the same score ID; in the new chat Claude finds it (`search_scores`) and shows it (`get_score`).                                                                                                                                                   |
| 8   | ASSET-03 on the target host (RELEASE_CHECKLIST.md step 9), when the listening review is done here: "Call create_score with exactly this argument:" followed by the content of `tools/release/asset-03/f08-slur-pair.create-score.json`, then the same with `c3-c6-range.create-score.json`. | Both scores display and play; listen with the ASSET-03 sheet.                                                                                                                                                                                                                                                                                                        |
| 9   | Optional: after more than one hour (the access-token lifetime), use a tool of the connector again in the same chat.                                                                                                                                                                         | The tool works without a new consent (Claude refreshed the token). If Claude asks to reconnect, record it: refresh does not work with this host.                                                                                                                                                                                                                     |
| 10  | Remove the connector if it was added only for this check (Settings > Connectors). The saved test scores stay in the test account (the MVP has no delete flow).                                                                                                                              | -                                                                                                                                                                                                                                                                                                                                                                    |

## What to record

Copy this block into the "Target-host check" section of
[EVIDENCE.md](EVIDENCE.md):

```text
Date:                 YYYY-MM-DD
Tester:               initials
Commit deployed:      <sha> (same on web, api and mcp: check each Vercel deployment)
Hosts:                web <origin>, api <origin>, mcp <MCP URL>, Supabase project <ref>
Claude surface:       claude.ai web | Desktop (version), plan, browser and OS
Client path:          dynamic registration (public) | pre-registered confidential client
Step results:         1 pass | 2 pass | 3 pass | 4 pass | 5 pass | 6 pass (approval shown as: ...) | 7 pass | 8 ... | 9 ... | 10 -
Time to first sound:  N s (cold cache)
Notes:                anything unexpected, with the step number
Blocked / not run:    step and reason (for example supabase/auth#2820, no authorized host access)
```

Never record access or refresh tokens, authorization codes, `authorization_id`
values, cookies, client secrets, or URLs or screenshots that contain them.
Screenshots of the chat and of the score are fine.

## When a step fails

| Symptom                                                                                                                      | Look at                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Couldn't reach the MCP server"                                                                                              | The 401 challenge and the metadata document: DEPLOY-02 (`tools/deploy/verify-deployment.ts`) and OAUTH-04 step 1. Claude uses only the first `authorization_servers` entry and calls from `160.79.104.0/21`: nothing (WAF, firewall) may block that range in front of the MCP server or Supabase.                                   |
| "Authorization with the MCP server failed", or the consent page shows "This authorization request is invalid or has expired" | supabase/auth#2820 (OAUTH-04 `#2820 probe`); the client's redirect URI (`https://claude.ai/api/mcp/auth_callback` for a pre-registered client); Site URL and Authorization Path (`/oauth/consent`) in the Auth configuration.                                                                                                       |
| Connected, but every tool call fails or Claude asks to reconnect                                                             | The token audience: OAUTH-04 "aud holds the MCP resource"; the hook and its `mcp_resource` row (supabase/README.md). anthropics/claude-ai-mcp#1038 (a host enforcing audience binding) is a known report.                                                                                                                           |
| The score appears without notes or glyphs                                                                                    | The player's alert says "The notation could not be drawn." (`RENDER_FAILED`): open the DevTools of the widget frame and read the console error and any CSP violation (the View's console is not forwarded to the chat, MCP_VIEW.md §4). Fonts need no `font-src`; a `font-src` violation on `data:` means an old build is deployed. |
| The score is drawn but Play never sounds, or shows "Audio unavailable"                                                       | The host iframe CSP lacks `wasm-unsafe-eval`, or the SoundFont or worklet does not load from the MCP origin (`/assets/`, DEPLOY-02).                                                                                                                                                                                                |
| The save runs without being presented for approval                                                                           | Stop the release: the tool permission was set to "Always allow", or the host does not gate the call. Re-run step 6 with the default permission before concluding.                                                                                                                                                                   |
