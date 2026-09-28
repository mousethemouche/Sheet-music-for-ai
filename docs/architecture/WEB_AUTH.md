# Web authentication

Browser side of ADR-005 in `apps/web` (issue #25): sign-up, sign-in, sign-out,
session restoration, password recovery, the protected-route guard and the
consent page of the Supabase OAuth 2.1 server used by remote MCP hosts (#26).
Token verification on the servers is #26 (`packages/auth-jwt`); this page covers
only the web app.

## Layout

| Path                              | Role                                                                       |
| --------------------------------- | -------------------------------------------------------------------------- |
| `src/auth/authPort.ts`            | Neutral `AuthPort` and result types. Pages depend on nothing else.         |
| `src/auth/supabaseAuthAdapter.ts` | The only module importing `@supabase/supabase-js`.                         |
| `src/auth/AuthProvider.tsx`       | Session state (`useAuth()`), account-change rules, sign-out.               |
| `src/auth/privateState.ts`        | Registry of per-account state (audio, caches) cleared on sign-out/switch.  |
| `src/auth/RequireAuth.tsx`        | Guard for private routes.                                                  |
| `src/auth/redirects.ts`           | Safe return path and OAuth redirect checks.                                |
| `src/auth/*Page.tsx`, `forms.tsx` | Pages and shared form pieces.                                              |
| `src/shell/`                      | App frame, library placeholder (replaced by #15), not-found, config error. |
| `src/config.ts`, `src/main.tsx`   | Environment validation and composition root.                               |
| `src/test/`                       | Component/unit tests and the fake `AuthPort` (`support/fakeAuth.tsx`).     |

`App` takes `{ auth, privateState, leaveApp }` and expects a router around it
(`BrowserRouter` in `main.tsx`, `MemoryRouter` in tests).

## Environment

Both variables are compiled into the public bundle (`apps/web/.env.example`):

| Variable                        | Value                                                                |
| ------------------------------- | -------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://<project-ref>.supabase.co` (http allowed for a local stack) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key `sb_publishable_...`                                 |

`readWebAuthConfig` refuses any key without the `sb_publishable_` prefix
(secret `sb_secret_...`, service-role or legacy JWT keys), and the app then
renders a configuration error instead of starting. The message never echoes the
key. Scanning the built bundle for secrets is #16.

## Routes

| Route                                  | Access    | Behaviour                                                                                            |
| -------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `/`                                    | public    | Redirects to `/library`.                                                                             |
| `/login?next=<path>`                   | public    | Sign-in; when signed in, goes to the safe `next` (default `/library`). Explains expired email links. |
| `/signup?next=<path>`                  | public    | Sign-up; confirmation-required shows "Check your email" and is NOT a session.                        |
| `/forgot-password`                     | public    | Recovery request; same answer whether or not the address has an account.                             |
| `/reset-password`                      | public    | Target of the recovery email: new password when the link is valid, otherwise "request a new link".   |
| `/library`                             | protected | Placeholder until #15.                                                                               |
| `/oauth/consent?authorization_id=<id>` | protected | OAuth 2.1 consent (client, scopes, Allow/Deny).                                                      |
| `*`                                    | public    | Not found.                                                                                           |

Protected routes render only "Checking your session…" until the provider has
answered once (no private-content flash, no premature redirect). Without a
session they redirect to `/login?next=<path+query>`, so the OAuth
`authorization_id` survives sign-in (and sign-up: the confirmation email returns
to `/login?next=...`).

`safeReturnPath` keeps only same-origin relative paths after browser-style URL
normalization: absolute URLs, `//host`, `javascript:`, backslash, tab and
dot-segment tricks that resolve to another origin fall back to `/library`.

## `AuthPort`

| Method                                                           | Result                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `getSession()`                                                   | `AuthSession \| null` (`{ user: { id, email } }`, no tokens)                                                       |
| `onChange(listener)`                                             | Unsubscribe function. Changes: `signed-in`, `signed-out`, `password-recovery`, `token-refreshed`, `user-updated`   |
| `getRedirectResult()`                                            | `none`, `password-recovery` or `link-error` (`expired` \| `invalid`) for the emailed link this page load came from |
| `signUp({ email, password, confirmationPath })`                  | `signed-in` or `confirmation-required`                                                                             |
| `signIn({ email, password })`                                    | `void`                                                                                                             |
| `signOut()`                                                      | ok once this device holds no session                                                                               |
| `requestPasswordReset({ email, resetPath })`                     | `void`                                                                                                             |
| `updatePassword(password)`                                       | `void`                                                                                                             |
| `getOAuthAuthorization(authorizationId)`                         | `consent-required` (client name/URI, redirect URI, scopes) or `redirect`                                           |
| `decideOAuthAuthorization(authorizationId, 'approve' \| 'deny')` | `{ redirectUrl }` back to the OAuth client                                                                         |

Every operation returns `{ ok: true, value } | { ok: false, error }` with a
neutral `AuthErrorCode` (`invalid-credentials`, `email-not-confirmed`,
`invalid-email`, `weak-password`, `same-password`, `session-missing`,
`not-found`, `rate-limited`, `network`, `unavailable`, `unknown`). Pages show
fixed messages (`messages.ts`); provider messages never reach the UI.
Paths passed to the port are resolved against the app origin by the adapter,
which refuses any path that would leave it.

The future library (#15) will need the access token for `GET /scores`; it adds
a `getAccessToken()` method to the port then, rather than reading the SDK.

## Session and private state

- The provider's first answer comes from `getSession()`, unless a change was
  pushed meanwhile: a pushed change is newer, so a late restore is ignored.
- `token-refreshed`/`user-updated` only renew the current account. One for
  another account (a late refresh after a switch) is ignored.
- Whenever the account changes (A -> B, or A -> signed out) the provider runs
  `privateState.clearAll()`. Explicit sign-out runs it first, then calls the
  provider.
- Private features register with the registry from `useAuth().privateState`:
  `const unregister = privateState.register(() => { player.stop(); cache.clear(); })`.
  Cleanups are synchronous and idempotent. Features should also key their data
  by `user.id` and drop responses that arrive after the user changed.

## Supabase behaviour relied on

- Implicit flow (`flowType: 'implicit'`, `detectSessionInUrl`): emailed links
  carry the session in the URL fragment, so a confirmation or recovery link
  also works when opened in another browser (PKCE would need the verifier
  stored by the requesting browser). The adapter reads the link's parameters
  before the SDK clears them: `type=recovery` enables the reset form,
  `error_code=otp_expired` is "expired", other errors are "invalid".
- With email confirmation enabled, `signUp` returns no session, also for an
  already registered address (the provider does not reveal it).
- `signOut({ scope: 'local' })` ends this browser's session only; MCP hosts
  connected through OAuth keep their own sessions. Already issued access tokens
  are stateless and stay valid until they expire (#26); sign-out does not claim
  otherwise.
- OAuth consent uses `auth.oauth.getAuthorizationDetails / approveAuthorization /
denyAuthorization` with `skipBrowserRedirect: true`; the page navigates
  itself (`leaveApp`) after refusing `javascript:`, `data:`, `vbscript:`,
  `blob:`, `file:` and `about:` URLs. https, loopback and native-app custom
  schemes are allowed because MCP clients register them.

## Project configuration (cloud phase, not applied yet)

To be set on the Supabase project when the app is deployed (#16/#26):

- Authentication > URL Configuration: Site URL = the web app origin; Redirect
  URLs include `<origin>/**` (sign-in with `?next=` and `/reset-password`), plus
  `http://localhost:5173/**` for local development.
- Email confirmation enabled; minimum password length at least 8 (the UI checks 8).
- OAuth Server enabled with Authorization Path `/oauth/consent`.
- Hosting rewrites every app route to `index.html` so deep links such as
  `/oauth/consent` and `/reset-password` load the SPA (#16).

## Tests

| ID / file                                                   | Covers                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| AUTH-UI-01 `src/test/auth-ui-01-forms.test.tsx`             | Valid submissions, required input, one request while pending, safe errors, confirmation-required, no enumeration             |
| AUTH-UI-02 `src/test/auth-ui-02-session.test.tsx`           | No flash while restoring, guard redirect and return, sign-out/switch clearing, late restore/refresh ignored, unsubscribe     |
| AUTH-UI-03 `src/test/auth-ui-03-recovery-redirect.test.tsx` | Valid/expired/invalid reset links, return-path table, OAuth consent through sign-in, keyboard approve/deny, refused requests |
| `src/test/supabase-auth-adapter.test.tsx`                   | Real supabase-js with a fake HTTP layer mapped to neutral results (sign-up, errors, emailed links, OAuth)                    |
| `src/test/config.test.ts`                                   | Publishable key only                                                                                                         |

AUTH-UI-I01 (a real provider flow with a mail sink: sign-up confirmation,
sign-in, library, refresh/sign-out, reset and old-password rejection) is
deferred to the cloud phase and shared with the #16/#26 release smoke. The
tests above do not prove provider configuration.
