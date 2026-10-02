/**
 * Deep redaction of log fields (issue #19, ERRORS_AND_SECURITY.md §2).
 *
 * Returns a bounded, JSON-safe copy; the input is never mutated:
 * - a property whose name looks like a credential (authorization, cookie,
 *   password, secret, token, api key, JWT, private key, database URL,
 *   connection string, DSN, credential) is replaced by "[REDACTED]" whatever
 *   its value;
 * - inside every string (including error messages and stacks): JWTs, Bearer
 *   credentials, Supabase secret keys, the whole userinfo of a URL (up to the
 *   last `@` before the host, so a raw `@` in a password cannot split it),
 *   secret query parameters (OAuth `code` included), and the value of
 *   `name=value` pairs (libpq keyword DSNs, form bodies) and JSON
 *   `"name": "value"` members whose name looks like a credential are masked;
 * - Error instances become { name, message, code?, stack? (not in
 *   production), cause? };
 * - depth, array length and string length are bounded and cycles are cut.
 * Copies are null-prototype objects: a key such as "__proto__" stays plain
 * data and can never change a prototype.
 */

export const REDACTED = '[REDACTED]';

export interface RedactOptions {
  /** Drop stack traces (production). */
  readonly production: boolean;
}

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;

const SENSITIVE_KEY_PARTS = [
  'authorization',
  'cookie',
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'jwt',
  'privatekey',
  'databaseurl',
  'connectionstring',
  'dsn',
  'credential',
];

/** Short names that mean a password only as a whole name (as substrings they match too much). */
const SENSITIVE_EXACT_NAMES: ReadonlySet<string> = new Set(['pass', 'pwd']);

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function isSensitiveName(name: string): boolean {
  return isSensitiveKey(name) || SENSITIVE_EXACT_NAMES.has(name.toLowerCase());
}

type Replacement = string | ((match: string, ...groups: string[]) => string);

const STRING_RULES: readonly (readonly [RegExp, Replacement])[] = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, `$1 ${REDACTED}`],
  [/\bsb_secret_[A-Za-z0-9_-]+/g, REDACTED],
  // Userinfo up to the LAST `@` before the path: URL parsers (and so pg) take
  // the last `@` as the delimiter, so a raw `@` may be part of the password.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi, `$1${REDACTED}@`],
  // `code` is the OAuth authorization code of a callback URL.
  [
    /([?&](?:password|pass|pwd|sslpassword|token|access_token|refresh_token|id_token|apikey|api_key|key|secret|client_secret|code)=)[^&\s#]*/gi,
    `$1${REDACTED}`,
  ],
  // JSON member inside a string: "password":"...", "refresh_token": "...".
  [
    /"((?:[^"\\]|\\.){1,64})"(\s*:\s*)"(?:[^"\\]|\\.)*"/g,
    (match, name: string, colon: string) =>
      isSensitiveName(name) ? `"${name}"${colon}"${REDACTED}"` : match,
  ],
  // name=value pair: libpq keyword DSN (password=..., password='...'), form or env dumps.
  [
    /\b([A-Za-z][\w.-]{0,63})(\s*=\s*)('[^']*'|"[^"]*"|[^\s&;,'"]+)/g,
    (match, name: string, equals: string) =>
      isSensitiveName(name) ? `${name}${equals}${REDACTED}` : match,
  ],
];

export function redactString(value: string): string {
  const bounded =
    value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
  return STRING_RULES.reduce(
    (text, [pattern, replacement]) =>
      typeof replacement === 'string'
        ? text.replace(pattern, replacement)
        : text.replace(pattern, replacement),
    bounded,
  );
}

function redactError(
  error: Error,
  options: RedactOptions,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  out['name'] = redactString(error.name);
  out['message'] = redactString(error.message);
  const code: unknown = (error as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') {
    out['code'] = typeof code === 'string' ? redactString(code) : code;
  }
  if (!options.production && error.stack !== undefined) {
    out['stack'] = redactString(error.stack);
  }
  if (error.cause !== undefined) {
    out['cause'] = walk(error.cause, options, depth + 1, seen);
  }
  return out;
}

function walk(
  value: unknown,
  options: RedactOptions,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  switch (typeof value) {
    case 'string':
      return redactString(value);
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'undefined':
      return undefined;
    case 'symbol':
    case 'function':
      return `[${typeof value}]`;
    default:
      break;
  }
  if (value === null) {
    return null;
  }
  const object = value as object;
  if (depth >= MAX_DEPTH) {
    return '[Truncated]';
  }
  if (seen.has(object)) {
    return '[Circular]';
  }
  seen.add(object);
  try {
    if (object instanceof Error) {
      return redactError(object, options, depth, seen);
    }
    if (object instanceof Date) {
      return Number.isNaN(object.getTime()) ? 'Invalid Date' : object.toISOString();
    }
    if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer) {
      return `[binary ${object.byteLength} bytes]`;
    }
    if (Array.isArray(object)) {
      const items = object
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item: unknown) => walk(item, options, depth + 1, seen));
      return object.length > MAX_ARRAY_ITEMS
        ? [...items, `[${object.length - MAX_ARRAY_ITEMS} more]`]
        : items;
    }
    if (object instanceof Map || object instanceof Set) {
      return `[${object.constructor.name} of ${object.size}]`;
    }
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, item] of Object.entries(object)) {
      out[redactString(key)] = isSensitiveKey(key)
        ? REDACTED
        : walk(item, options, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(object);
  }
}

/** A redacted, bounded, JSON-safe copy of `value`. */
export function redact(value: unknown, options: RedactOptions): unknown {
  return walk(value, options, 0, new WeakSet());
}
