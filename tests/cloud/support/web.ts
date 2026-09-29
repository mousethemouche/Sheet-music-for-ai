/**
 * Driving the deployed web app in headless Chromium (Playwright). Pages are
 * reached through their accessible names, the way a user reads them. The
 * browser session is read only where a step must compare tokens, and a token
 * is never printed: comparisons are made on booleans.
 */
import { type Browser, type BrowserContext, type Page, type Response, chromium } from 'playwright';

export const STEP_TIMEOUT_MS = 30_000;

export function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

/** supabase-js's default localStorage key: `sb-<first label of the project host>-auth-token`. */
export function sessionStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0] ?? ''}-auth-token`;
}

export interface StoredSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch seconds. */
  readonly expiresAt: number;
}

export async function readStoredSession(page: Page, key: string): Promise<StoredSession | null> {
  const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
  if (raw === null) return null;
  const session = JSON.parse(raw) as Record<string, unknown>;
  const { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt } = session;
  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresAt !== 'number'
  ) {
    throw new Error('The stored supabase-js session does not have the expected shape');
  }
  return { accessToken, refreshToken, expiresAt };
}

/** Whether supabase-js holds a session in this page's storage (a boolean, safe to assert on). */
export async function hasStoredSession(page: Page, key: string): Promise<boolean> {
  return (
    (await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key)) !== null
  );
}

/** Makes the stored access token look expired, so the next page load must refresh it. */
export async function expireStoredSession(page: Page, key: string): Promise<void> {
  await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) throw new Error('no stored session');
    const session = JSON.parse(raw) as Record<string, unknown>;
    session['expires_at'] = Math.floor(Date.now() / 1000) - 60;
    window.localStorage.setItem(storageKey, JSON.stringify(session));
  }, key);
}

/** Fills and submits the sign-in form of the current page. */
export async function submitSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signIn(
  page: Page,
  webBaseUrl: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`${webBaseUrl}/login`);
  await submitSignIn(page, email, password);
}

export async function signOut(page: Page, webBaseUrl: string): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(`${webBaseUrl}/login`, { timeout: STEP_TIMEOUT_MS });
}

export async function waitForHeading(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('heading', { name }).waitFor({ timeout: STEP_TIMEOUT_MS });
}

/** The next `GET <api>/scores` (the library list) answered to this page. */
export function nextScoresList(page: Page, apiBaseUrl: string): Promise<Response> {
  const listUrl = `${apiBaseUrl}/scores`;
  return page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().split('?')[0] === listUrl,
    { timeout: STEP_TIMEOUT_MS },
  );
}

/** The next response of an Auth endpoint (`<issuer><path>`, any query) for this method. */
export function nextAuthResponse(
  page: Page,
  issuer: string,
  method: string,
  path: string,
): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && response.url().split('?')[0] === `${issuer}${path}`,
    { timeout: STEP_TIMEOUT_MS },
  );
}

/**
 * Captures navigations to the OAuth client's redirect URI (a loopback URL
 * nothing listens on): the browser gets a stub page, the step gets the URL
 * with its code or error.
 */
export async function captureRedirects(
  context: BrowserContext,
  redirectUri: string,
): Promise<{ next(): Promise<URL> }> {
  const target = new URL(redirectUri);
  const received: URL[] = [];
  let wake: (() => void) | undefined;
  await context.route(
    (url) => url.origin === target.origin && url.pathname === target.pathname,
    async (route) => {
      received.push(new URL(route.request().url()));
      wake?.();
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'OAuth redirect received.',
      });
    },
  );
  return {
    async next() {
      const deadline = Date.now() + STEP_TIMEOUT_MS;
      while (received.length === 0) {
        if (Date.now() > deadline) throw new Error('No navigation to the OAuth redirect URI');
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 250);
        });
      }
      return received.shift() as URL;
    },
  };
}
