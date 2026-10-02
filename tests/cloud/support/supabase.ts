/**
 * The Supabase Auth HTTP calls of the cloud suites.
 *
 * Admin calls use the server-only key from the runner's environment
 * (`sb_secret_...` in the `apikey` header; a legacy service_role JWT also as
 * Bearer). They only create, read and delete the suites' own synthetic users
 * and OAuth clients. `generate_link` returns the confirmation or recovery
 * link to the caller and sends no mail, so no mailbox is read.
 *
 * Public calls (password and refresh grants) use the publishable key, like
 * the web app.
 */
import type { CloudConfig } from './env';
import { type HttpResult, asObject, parseJson, problem, request, stringField } from './http';

export function adminHeaders(adminKey: string): Record<string, string> {
  return adminKey.startsWith('sb_secret_')
    ? { apikey: adminKey }
    : { apikey: adminKey, authorization: `Bearer ${adminKey}` };
}

function admin(config: CloudConfig, path: string, init: RequestInit = {}): Promise<HttpResult> {
  return request(`${config.issuer}/admin${path}`, {
    ...init,
    headers: {
      ...adminHeaders(config.adminKey),
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });
}

function expectStatus(result: HttpResult, expected: readonly number[], what: string): void {
  if (!expected.includes(result.status)) throw new Error(`${what} failed: ${problem(result)}`);
}

/** What an Auth error code of a mail-sending call means for this release setup. */
export function mailProblemHint(errorCode: string | undefined): string {
  switch (errorCode) {
    case 'email_address_not_authorized':
      return 'the project still sends mail with the default SMTP service, which only mails team members: configure custom SMTP (RELEASE_CHECKLIST.md step 2)';
    case 'email_address_invalid':
      return 'Supabase refuses the domain of CLOUD_E2E_EMAIL: use a mail-sink mailbox on a real domain';
    case 'over_email_send_rate_limit':
      return 'the project email rate limit is reached: wait for the window to pass or raise the limit';
    default:
      return 'see the Auth logs of the project for this request';
  }
}

/** The error_code of a JSON error body, if any. */
export function errorCodeOf(text: string): string | undefined {
  const body = parseJson(text);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const code = (body as Record<string, unknown>)['error_code'];
  return typeof code === 'string' ? code : undefined;
}

export interface GeneratedLink {
  readonly userId: string;
  /** The Auth verify URL; opening it confirms or recovers and redirects to `redirectTo`. */
  readonly actionLink: string;
  /** What Auth will redirect to: the requested URL when allow-listed, the Site URL otherwise. */
  readonly redirectTo: string;
}

export async function generateLink(
  config: CloudConfig,
  link: {
    readonly type: 'signup' | 'recovery';
    readonly email: string;
    readonly password?: string;
    readonly redirectTo: string;
  },
): Promise<GeneratedLink> {
  const result = await admin(config, '/generate_link', {
    method: 'POST',
    body: JSON.stringify({
      type: link.type,
      email: link.email,
      ...(link.password === undefined ? {} : { password: link.password }),
      redirect_to: link.redirectTo,
    }),
  });
  expectStatus(result, [200], `generate_link (${link.type})`);
  // The response is the user merged with the link fields (not nested).
  const body = asObject(parseJson(result.text), 'generate_link response');
  return {
    userId: stringField(body, 'id', 'generate_link response'),
    actionLink: stringField(body, 'action_link', 'generate_link response'),
    redirectTo: stringField(body, 'redirect_to', 'generate_link response'),
  };
}

export async function createConfirmedUser(
  config: CloudConfig,
  email: string,
  password: string,
): Promise<string> {
  const result = await admin(config, '/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  expectStatus(result, [200, 201], 'admin create user');
  return stringField(asObject(parseJson(result.text), 'admin user'), 'id', 'admin user');
}

export async function emailConfirmedAt(
  config: CloudConfig,
  userId: string,
): Promise<string | null> {
  const result = await admin(config, `/users/${encodeURIComponent(userId)}`);
  expectStatus(result, [200], 'admin get user');
  const confirmed = asObject(parseJson(result.text), 'admin user')['email_confirmed_at'];
  return typeof confirmed === 'string' && confirmed !== '' ? confirmed : null;
}

/** The ID of the user with exactly this email, found through the admin list filter. */
export async function findUserId(config: CloudConfig, email: string): Promise<string | null> {
  const result = await admin(config, `/users?filter=${encodeURIComponent(email)}&per_page=50`);
  expectStatus(result, [200], 'admin list users');
  const users = asObject(parseJson(result.text), 'admin user list')['users'];
  if (!Array.isArray(users)) return null;
  for (const user of users as unknown[]) {
    const fields = asObject(user, 'admin user');
    if (fields['email'] === email.toLowerCase() && typeof fields['id'] === 'string')
      return fields['id'];
  }
  return null;
}

/** Deletes the user; their drafts and saved scores go with it (on delete cascade). */
export async function deleteUser(config: CloudConfig, userId: string): Promise<void> {
  expectStatus(
    await admin(config, `/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    [200, 204, 404],
    'admin delete user',
  );
}

export async function registerOAuthClientAsAdmin(
  config: CloudConfig,
  client: { readonly name: string; readonly redirectUri: string; readonly confidential: boolean },
): Promise<{ readonly id: string; readonly secret: string | null }> {
  const result = await admin(config, '/oauth/clients', {
    method: 'POST',
    body: JSON.stringify({
      client_name: client.name,
      redirect_uris: [client.redirectUri],
      token_endpoint_auth_method: client.confidential ? 'client_secret_basic' : 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  });
  expectStatus(result, [200, 201], 'admin register OAuth client');
  const body = asObject(parseJson(result.text), 'OAuth client');
  const secret = body['client_secret'];
  return {
    id: stringField(body, 'client_id', 'OAuth client'),
    secret: typeof secret === 'string' ? secret : null,
  };
}

export async function deleteOAuthClient(config: CloudConfig, clientId: string): Promise<void> {
  expectStatus(
    await admin(config, `/oauth/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' }),
    [200, 204, 404],
    'admin delete OAuth client',
  );
}

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

function publicAuth(config: CloudConfig, path: string, body: unknown): Promise<HttpResult> {
  return request(`${config.issuer}${path}`, {
    method: 'POST',
    headers: {
      apikey: config.publishableKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/** A first-party web session, as supabase-js gets it on sign-in (no client_id, aud "authenticated"). */
export async function passwordSession(
  config: CloudConfig,
  email: string,
  password: string,
): Promise<SessionTokens> {
  const result = await publicAuth(config, '/token?grant_type=password', { email, password });
  expectStatus(result, [200], 'password sign-in');
  return sessionTokens(result);
}

export function refreshGrant(config: CloudConfig, refreshToken: string): Promise<HttpResult> {
  return publicAuth(config, '/token?grant_type=refresh_token', { refresh_token: refreshToken });
}

export function sessionTokens(result: HttpResult): SessionTokens {
  const body = asObject(parseJson(result.text), 'token response');
  return {
    accessToken: stringField(body, 'access_token', 'token response'),
    refreshToken: stringField(body, 'refresh_token', 'token response'),
  };
}
