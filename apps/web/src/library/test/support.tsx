/**
 * Shared set-up of LIB-UI-01..03: a fake HTTP layer under the app's real API
 * client, contract-shaped response bodies, and the whole app rendered with a
 * fake auth port and fake player ports.
 */
import { validateScoreSpec, type ScoreSpec } from '@sheet-music/music-domain';
import { F01, cloneFixture } from '@sheet-music/test-fixtures';
import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import { createScoresApi } from '../../api/scoresApi';
import { createPrivateStateRegistry, type PrivateStateRegistry } from '../../auth/privateState';
import { ALICE, FakeAuthPort, renderApp, sessionOf } from '../../test/support/fakeAuth';
import { type FakePlayer, createFakePlayer } from './fakePlayer';

export const API_BASE_URL = 'https://api.test';

/** One request as the fake HTTP layer received it. */
export interface RecordedRequest {
  readonly url: URL;
  readonly method: string;
  readonly authorization: string | null;
  readonly cache: RequestCache | undefined;
  readonly credentials: RequestCredentials | undefined;
  readonly signal: AbortSignal | null;
}

type Responder = (request: RecordedRequest) => Response | Promise<Response>;

/**
 * Stands in for `fetch`. Answers with `respond` (a JSON page by default). It
 * deliberately does not reject on abort, so a superseded response can still
 * arrive late and the UI must ignore it on its own.
 */
export class FakeHttp {
  readonly requests: RecordedRequest[] = [];
  respond: Responder = () => json(200, listBody([]));

  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const request: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      authorization: headers.get('Authorization'),
      cache: init?.cache,
      credentials: init?.credentials,
      signal: init?.signal ?? null,
    };
    this.requests.push(request);
    return Promise.resolve(this.respond(request));
  };

  /** Requests to `path` (for example `/scores`), in order. */
  to(path: string): RecordedRequest[] {
    return this.requests.filter((request) => request.url.pathname === path);
  }

  get last(): RecordedRequest {
    const request = this.requests.at(-1);
    if (request === undefined) throw new Error('No request was sent');
    return request;
  }
}

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** An error body as server-common sends it. */
export function errorBody(code: string, correlationId = 'corr-1234'): unknown {
  return { code, message: 'Server message that the UI never shows.', correlationId };
}

export interface SummaryInput {
  readonly scoreId: string;
  readonly title: string;
  readonly tags?: readonly string[];
  readonly updatedAt?: string;
}

/** A `ScoreSummary` as GET /scores serializes it. */
export function summary(input: SummaryInput): Record<string, unknown> {
  const updatedAt = input.updatedAt ?? '2026-09-27T10:00:00.000Z';
  return {
    scoreId: input.scoreId,
    title: input.title,
    tags: [...(input.tags ?? [])],
    revision: 2,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt,
  };
}

/** A GET /scores body. */
export function listBody(
  items: readonly Record<string, unknown>[],
  page: { offset?: number; total?: number; nextOffset?: number | null } = {},
): unknown {
  const offset = page.offset ?? 0;
  return {
    items,
    page: {
      limit: 20,
      offset,
      total: page.total ?? offset + items.length,
      nextOffset: page.nextOffset ?? null,
    },
  };
}

export const SCORE_ID = 'scr_00000000-0000-4000-8000-000000000001';

/** The canonical F01 ScoreSpec saved under SCORE_ID at `revision`. */
export function savedScoreSpec(revision = 3): ScoreSpec {
  const input = { ...cloneFixture(F01), id: SCORE_ID, revision };
  const result = validateScoreSpec(input);
  if (!result.ok) throw new Error('F01 must stay a valid ScoreSpec');
  return result.value;
}

/** A GET /scores/:id body (`SavedArtifact`). */
export function savedBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const score = savedScoreSpec();
  return {
    state: 'saved',
    scoreId: score.id,
    revision: score.revision,
    score,
    title: 'C major warm-up',
    tags: ['warm-up', 'beginner'],
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

export interface LibraryApp extends ReturnType<typeof renderApp> {
  readonly http: FakeHttp;
  readonly port: FakeAuthPort;
  readonly fakePlayer: FakePlayer;
  readonly privateState: PrivateStateRegistry;
}

/**
 * Renders the app signed in as ALICE at `path`, with the real API client over
 * `http` and the real `createWebPlayer` over fake renderer and engine.
 */
export function renderLibrary(
  options: { path?: string; http?: FakeHttp; port?: FakeAuthPort } = {},
): LibraryApp {
  const http = options.http ?? new FakeHttp();
  const port = options.port ?? new FakeAuthPort(sessionOf(ALICE));
  const fakePlayer = createFakePlayer();
  const privateState = createPrivateStateRegistry();
  const scores = createScoresApi({
    baseUrl: API_BASE_URL,
    getAccessToken: () => port.getAccessToken(),
    fetch: http.fetch,
  });
  const view = renderApp({
    port,
    path: options.path ?? '/library',
    privateState,
    library: { scores, player: fakePlayer.player },
  });
  return { ...view, http, port, fakePlayer, privateState };
}

export const location = (): string | null => screen.getByTestId('location').textContent;

/** jsdom has no ResizeObserver; the ScorePlayer needs one to learn its width. */
export function installResizeObserver(width = 640): void {
  class FixedResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      const entry = { target, contentRect: { width } } as unknown as ResizeObserverEntry;
      this.callback([entry], this);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
}
