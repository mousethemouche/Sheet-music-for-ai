/**
 * AUTH-UI-I01 (#25): the one provider-backed auth flow, through the DEPLOYED
 * web app, its API and the real Supabase project. Opt-in: runs only with
 * CLOUD_E2E=1 and the variables of support/env.ts, under `--project cloud`
 * (docs/release/RELEASE_CHECKLIST.md). It verifies our provider
 * configuration and our pages, not Supabase internals.
 *
 *   sign-up (web) -> confirmation required, no session -> unconfirmed sign-in refused
 *   -> confirm with an admin-generated link (no mailbox read) -> library
 *   -> sign-out -> sign-in -> library through GET /scores
 *   -> reload restores, an expired access token is refreshed
 *   -> sign-out ends the provider session (refresh token refused)
 *   -> recovery request (web) -> admin-generated recovery link -> new password
 *   -> new password signs in, old password refused -> user deleted
 *
 * The synthetic address is `<CLOUD_E2E_EMAIL local>+smfa-i01-<time>-<hex>@<domain>`:
 * the sign-up and recovery mails the project sends go to that mail sink,
 * never to a tester. The user (and anything it owns) is deleted in afterAll.
 * Tokens are compared as booleans and never printed.
 */
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authErrorMessage } from '../../apps/web/src/auth/messages';
import { authUiGate, readyConfig } from './support/env';
import { problemOf, request } from './support/http';
import { type SyntheticIdentity, newPassword, syntheticIdentity } from './support/identity';
import { createSteps, recordEvidence } from './support/steps';
import {
  deleteUser,
  emailConfirmedAt,
  errorCodeOf,
  findUserId,
  generateLink,
  mailProblemHint,
  refreshGrant,
} from './support/supabase';
import {
  STEP_TIMEOUT_MS,
  expireStoredSession,
  hasStoredSession,
  launchBrowser,
  nextAuthResponse,
  nextScoresList,
  readStoredSession,
  sessionStorageKey,
  signIn,
  signOut,
  waitForHeading,
} from './support/web';
import { listScoresResponseSchema } from './support/workspace';

const gate = authUiGate(process.env);

describe.skipIf(gate.kind === 'off')(
  'AUTH-UI-I01 provider-backed sign-up, session and recovery through the deployed web app',
  () => {
    if (gate.kind === 'invalid') {
      it('cloud configuration is complete', () => {
        throw new Error(gate.reason);
      });
    }
    const { step } = createSteps(
      gate.kind === 'invalid' ? 'the cloud configuration is invalid' : null,
    );
    const config = () => readyConfig(gate);

    let browser: Browser | undefined;
    let page: Page;
    let identity: SyntheticIdentity;
    let replacementPassword: string;
    let storageKey: string;
    let userId: string | undefined;

    beforeAll(async () => {
      if (gate.kind !== 'ready') return;
      identity = syntheticIdentity(gate.config.mailbox, 'i01', new Date());
      replacementPassword = newPassword();
      storageKey = sessionStorageKey(gate.config.supabaseUrl);
      browser = await launchBrowser();
      page = await (await browser.newContext()).newPage();
    });

    afterAll(async () => {
      if (gate.kind !== 'ready') return;
      await browser?.close();
      const id = userId ?? (await findUserId(gate.config, identity.email));
      if (id !== null) await deleteUser(gate.config, id);
    });

    step(
      'sign-up through the web app asks for email confirmation and opens no session',
      { provides: 'signed-up' },
      async () => {
        const { webBaseUrl, issuer } = config();
        await page.goto(`${webBaseUrl}/signup`);
        await page.getByLabel('Email').fill(identity.email);
        await page.getByLabel('Password', { exact: true }).fill(identity.password);
        const signUp = nextAuthResponse(page, issuer, 'POST', '/signup');
        await page.getByRole('button', { name: 'Create account', exact: true }).click();
        const answer = await signUp;
        if (!answer.ok()) {
          const text = await answer.text();
          throw new Error(
            `The provider refused the sign-up (${problemOf(answer.status(), text)}): ${mailProblemHint(errorCodeOf(text))}.`,
          );
        }
        await waitForHeading(page, 'Check your email');
        expect(await hasStoredSession(page, storageKey), 'a stored session').toBe(false);
      },
    );

    step('an unconfirmed account cannot sign in', { needs: ['signed-up'] }, async () => {
      const { webBaseUrl } = config();
      await signIn(page, webBaseUrl, identity.email, identity.password);
      await page
        .getByText(authErrorMessage('email-not-confirmed'))
        .waitFor({ timeout: STEP_TIMEOUT_MS });
      expect(new URL(page.url()).pathname).toBe('/login');
      expect(await hasStoredSession(page, storageKey), 'a stored session').toBe(false);
    });

    step(
      'the admin-generated confirmation link confirms the address and signs in on the web app',
      { needs: ['signed-up'], provides: 'confirmed' },
      async () => {
        const cfg = config();
        const redirectTo = `${cfg.webBaseUrl}/login?next=%2Flibrary`;
        const link = await generateLink(cfg, {
          type: 'signup',
          email: identity.email,
          password: identity.password,
          redirectTo,
        });
        userId = link.userId;
        expect(link.redirectTo, 'Auth > URL Configuration must allow the web app').toBe(redirectTo);
        const library = nextScoresList(page, cfg.apiBaseUrl);
        await page.goto(link.actionLink);
        await waitForHeading(page, 'Your library');
        // Origin and path only: a URL fragment may still hold the session tokens.
        const landed = new URL(page.url());
        expect(`${landed.origin}${landed.pathname}`).toBe(`${cfg.webBaseUrl}/library`);
        await page
          .getByText(`Signed in as ${identity.email}.`)
          .waitFor({ timeout: STEP_TIMEOUT_MS });
        expect((await library).status()).toBe(200);
        expect(await emailConfirmedAt(cfg, link.userId)).not.toBeNull();
      },
    );

    step(
      'sign-out through the web app ends the browser session',
      { needs: ['confirmed'] },
      async () => {
        const { webBaseUrl } = config();
        await signOut(page, webBaseUrl);
        expect(await hasStoredSession(page, storageKey), 'a stored session').toBe(false);
        await page.goto(`${webBaseUrl}/library`);
        await page.waitForURL(
          (url) => url.pathname === '/login' && url.searchParams.get('next') === '/library',
          { timeout: STEP_TIMEOUT_MS },
        );
      },
    );

    step(
      'sign-in with the password opens the protected library through the API',
      { needs: ['confirmed'], provides: 'signed-in' },
      async () => {
        const { webBaseUrl, apiBaseUrl } = config();
        const library = nextScoresList(page, apiBaseUrl);
        await signIn(page, webBaseUrl, identity.email, identity.password);
        await waitForHeading(page, 'Your library');
        const answer = await library;
        expect(answer.status()).toBe(200);
        expect(answer.headers()['cache-control']).toContain('no-store');
        expect(listScoresResponseSchema.parse(await answer.json()).page.total).toBe(0);
        await page
          .getByText('Your library is empty.', { exact: false })
          .waitFor({ timeout: STEP_TIMEOUT_MS });
      },
    );

    step(
      'a reload restores the session, and an expired access token is refreshed with the stored refresh token',
      { needs: ['signed-in'] },
      async (context) => {
        const { issuer, apiBaseUrl } = config();
        const before = await readStoredSession(page, storageKey);
        expect(before !== null, 'a stored session').toBe(true);
        await page.reload();
        await waitForHeading(page, 'Your library');

        await expireStoredSession(page, storageKey);
        const refresh = nextAuthResponse(page, issuer, 'POST', '/token');
        const library = nextScoresList(page, apiBaseUrl);
        await page.reload();
        expect((await refresh).status()).toBe(200);
        await waitForHeading(page, 'Your library');
        expect((await library).status()).toBe(200);
        const after = await readStoredSession(page, storageKey);
        expect(
          after !== null && after.accessToken !== before?.accessToken,
          'a new access token',
        ).toBe(true);
        expect((after?.expiresAt ?? 0) > Date.now() / 1000, 'the new token is not expired').toBe(
          true,
        );
        await recordEvidence(
          context,
          'refresh token rotated on refresh',
          after?.refreshToken !== before?.refreshToken ? 'yes' : 'no',
        );
      },
    );

    step(
      'sign-out ends the provider session: its refresh token is refused afterwards',
      { needs: ['signed-in'] },
      async (context) => {
        const cfg = config();
        const held = await readStoredSession(page, storageKey);
        if (held === null) throw new Error('No stored session before sign-out');
        await signOut(page, cfg.webBaseUrl);
        expect(await hasStoredSession(page, storageKey), 'a stored session').toBe(false);

        const refreshed = await refreshGrant(cfg, held.refreshToken);
        expect(
          refreshed.status >= 400 && refreshed.status < 500,
          problemOf(refreshed.status, refreshed.text),
        ).toBe(true);
        await recordEvidence(
          context,
          'refresh after sign-out',
          problemOf(refreshed.status, refreshed.text),
        );

        // Documented, not a defect: a stateless access token stays valid until
        // it expires (AUTH_MCP_OAUTH.md §4, WEB_AUTH.md). Recorded, not claimed otherwise.
        const stillValid = await request(`${cfg.apiBaseUrl}/scores`, {
          headers: { authorization: `Bearer ${held.accessToken}`, accept: 'application/json' },
        });
        await recordEvidence(
          context,
          'issued access token after sign-out, GET /scores',
          `HTTP ${stillValid.status}`,
        );
      },
    );

    step(
      'a password-recovery request answers without revealing the account, and the provider sends the mail',
      { needs: ['confirmed'] },
      async () => {
        const { webBaseUrl, issuer } = config();
        await page.goto(`${webBaseUrl}/forgot-password`);
        await page.getByLabel('Email').fill(identity.email);
        const recover = nextAuthResponse(page, issuer, 'POST', '/recover');
        await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
        const answer = await recover;
        if (!answer.ok()) {
          const text = await answer.text();
          throw new Error(
            `The provider did not send the recovery mail (${problemOf(answer.status(), text)}): ${mailProblemHint(errorCodeOf(text))}.`,
          );
        }
        await waitForHeading(page, 'Check your email');
        await page
          .getByText(`If an account exists for ${identity.email}, we sent it a link`, {
            exact: false,
          })
          .waitFor({ timeout: STEP_TIMEOUT_MS });
      },
    );

    step(
      'the admin-generated recovery link opens the reset form and sets a new password',
      { needs: ['confirmed'], provides: 'password-changed' },
      async () => {
        const cfg = config();
        const redirectTo = `${cfg.webBaseUrl}/reset-password`;
        const link = await generateLink(cfg, {
          type: 'recovery',
          email: identity.email,
          redirectTo,
        });
        expect(link.redirectTo, 'Auth > URL Configuration must allow /reset-password').toBe(
          redirectTo,
        );
        await page.goto(link.actionLink);
        await waitForHeading(page, 'Choose a new password');
        await page.getByLabel('New password', { exact: true }).fill(replacementPassword);
        await page.getByLabel('Confirm new password', { exact: true }).fill(replacementPassword);
        await page.getByRole('button', { name: 'Change password', exact: true }).click();
        await waitForHeading(page, 'Password changed');
        await signOut(page, cfg.webBaseUrl);
      },
    );

    step(
      'the new password signs in and the old password is refused',
      { needs: ['password-changed'] },
      async () => {
        const { webBaseUrl, apiBaseUrl } = config();
        await signIn(page, webBaseUrl, identity.email, identity.password);
        await page
          .getByText(authErrorMessage('invalid-credentials'))
          .waitFor({ timeout: STEP_TIMEOUT_MS });
        expect(await hasStoredSession(page, storageKey), 'a stored session').toBe(false);

        const library = nextScoresList(page, apiBaseUrl);
        await signIn(page, webBaseUrl, identity.email, replacementPassword);
        await waitForHeading(page, 'Your library');
        expect((await library).status()).toBe(200);
      },
    );
  },
);
