/**
 * Typed client of the saved-library HTTP API (APPLICATION_LAYER.md §7.2):
 *
 *   GET /scores?query=&tags=&tags=&limit=&offset=  -> ListScoresResponse
 *   GET /scores/:id                                -> SavedArtifact
 *
 * Read-only by design: the web app never writes a score (saving is the MCP
 * `save_score` tool, with the human's approval in the host). Every request
 * carries the current session's access token as a Bearer token, sends no
 * cookie, and asks the browser not to store the response: it is private, and
 * the HTTP cache is not keyed by user. Success bodies are parsed with the
 * music-contracts schemas and error bodies with the shared error envelope
 * (use-case and transport codes); a body that breaks the contract is a
 * failure, never an empty result.
 */
import {
  type EnvelopeErrorCode,
  type ListScoresResponse,
  errorEnvelopeSchema,
  listScoresResponseSchema,
  savedScoreResponseSchema,
} from '@sheet-music/music-contracts';

/**
 * A saved score as the API serializes it. `score` is only known to be a JSON
 * object here; the ScorePlayer validates it as a ScoreSpec before showing it.
 */
export type SavedScoreResponse = ReturnType<typeof savedScoreResponseSchema.parse>;

/** What the UI does about a failed request. */
export type ApiFailureKind =
  /** 401 or no session: the user must sign in again. */
  | 'unauthenticated'
  /** 404: missing, foreign or not a saved score (the API does not tell them apart). */
  | 'not-found'
  /** 502/503/504, no response, or the session could not be renewed: temporary, retry. */
  | 'unavailable'
  /** 429: too many requests, retry later. */
  | 'rate-limited'
  /** 400: the API refused the request itself (for example a search that is too long). */
  | 'rejected'
  /** Anything else, including a response that breaks the contract. */
  | 'failed';

export interface ApiFailure {
  readonly kind: ApiFailureKind;
  /** HTTP status, or null when no response arrived. */
  readonly status: number | null;
  /** Code of the error envelope, when the body was a valid envelope. */
  readonly code: EnvelopeErrorCode | null;
  /** Server correlation ID, for support; null when the response carried none. */
  readonly correlationId: string | null;
}

export type ApiResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiFailure };

/** A library search (`search_scores` input). Blank text and empty lists are not sent. */
export interface ScoreSearch {
  readonly query?: string;
  /** A score matches when it carries every one of these tags. */
  readonly tags?: readonly string[];
  readonly offset?: number;
  readonly limit?: number;
}

export interface ScoresApi {
  listScores(search: ScoreSearch, signal?: AbortSignal): Promise<ApiResult<ListScoresResponse>>;
  getSavedScore(scoreId: string, signal?: AbortSignal): Promise<ApiResult<SavedScoreResponse>>;
}

export interface ScoresApiOptions {
  /** Absolute API base URL without a trailing slash (see readApiConfig). */
  readonly baseUrl: string;
  /** `AuthPort.getAccessToken`: the current session's token, or null. */
  readonly getAccessToken: () => Promise<string | null>;
  /** Defaults to the browser's fetch. */
  readonly fetch?: typeof fetch;
}

export function createScoresApi(options: ScoresApiOptions): ScoresApi {
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function get<T>(
    path: string,
    parse: (body: unknown) => T | null,
    signal: AbortSignal | undefined,
  ): Promise<ApiResult<T>> {
    let token: string | null;
    try {
      token = await options.getAccessToken();
    } catch {
      return failure('unavailable', null);
    }
    if (token === null) return failure('unauthenticated', null);

    let response: Response;
    try {
      response = await send(`${options.baseUrl}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'omit',
        cache: 'no-store',
        signal: signal ?? null,
      });
    } catch {
      return failure('unavailable', null);
    }

    const body = await readJson(response);
    const headerCorrelationId = response.headers.get('x-correlation-id');
    if (response.ok) {
      const value = body === undefined ? null : parse(body);
      if (value !== null) return { ok: true, value };
      return failure('failed', response.status, null, headerCorrelationId);
    }
    const envelope = errorEnvelopeSchema.safeParse(body);
    return failure(
      kindOf(response.status),
      response.status,
      envelope.success ? envelope.data.code : null,
      (envelope.success ? envelope.data.correlationId : undefined) ?? headerCorrelationId,
    );
  }

  return {
    listScores(search, signal) {
      return get(`/scores${searchParams(search)}`, parseList, signal);
    },
    getSavedScore(scoreId, signal) {
      return get(
        `/scores/${encodeURIComponent(scoreId)}`,
        (body) => {
          const parsed = savedScoreResponseSchema.safeParse(body);
          // The API must answer with the score that was asked for.
          return parsed.success && parsed.data.scoreId === scoreId ? parsed.data : null;
        },
        signal,
      );
    },
  };
}

function parseList(body: unknown): ListScoresResponse | null {
  const parsed = listScoresResponseSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** The query string of GET /scores (`listScoresQuerySchema`): repeated `tags`, defaults omitted. */
function searchParams(search: ScoreSearch): string {
  const params = new URLSearchParams();
  const query = search.query?.trim() ?? '';
  if (query !== '') params.set('query', query);
  for (const tag of search.tags ?? []) params.append('tags', tag);
  if (search.limit !== undefined) params.set('limit', String(search.limit));
  if (search.offset !== undefined && search.offset > 0) params.set('offset', String(search.offset));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

function kindOf(status: number): ApiFailureKind {
  switch (status) {
    case 400:
      return 'rejected';
    case 401:
      return 'unauthenticated';
    case 404:
      return 'not-found';
    case 429:
      return 'rate-limited';
    case 502:
    case 503:
    case 504:
      return 'unavailable';
    default:
      return 'failed';
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function failure<T>(
  kind: ApiFailureKind,
  status: number | null,
  code: EnvelopeErrorCode | null = null,
  correlationId: string | null = null,
): ApiResult<T> {
  return { ok: false, error: { kind, status, code, correlationId } };
}
