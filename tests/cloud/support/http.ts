/**
 * HTTP helpers of the cloud suites. Failure descriptions carry the status and
 * the provider's error code and message only, redacted, so no token, key or
 * link ever reaches a test report.
 */
import { redactSecrets } from '../../../tools/release/cloud-smoke';

export interface HttpResult {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

export async function request(url: string, init: RequestInit = {}): Promise<HttpResult> {
  const response = await fetch(url, { redirect: 'manual', ...init });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function asObject(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${what} is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function stringField(
  object: Readonly<Record<string, unknown>>,
  key: string,
  what: string,
): string {
  const field = object[key];
  if (typeof field !== 'string' || field === '') throw new Error(`${what} has no "${key}" string`);
  return field;
}

/**
 * `HTTP <status>` plus the error code and message fields of a JSON error body
 * (`key: value`, never `key=value`, which the redaction would take for a
 * credential parameter), redacted and bounded.
 */
export function problemOf(status: number, text: string): string {
  const body = parseJson(text);
  const parts = [`HTTP ${status}`];
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const fields = body as Record<string, unknown>;
    for (const key of ['error_code', 'code', 'error', 'msg', 'message', 'error_description']) {
      const field = fields[key];
      if (typeof field === 'string' || typeof field === 'number')
        parts.push(`${key}: ${String(field)}`);
    }
  }
  return redactSecrets(parts.join('; ')).slice(0, 300);
}

export function problem(result: HttpResult): string {
  return problemOf(result.status, result.text);
}
