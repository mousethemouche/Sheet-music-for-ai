/**
 * LIB-UI-01 (issue #15): display and states of the library. Loading, the
 * user's saved summaries, a genuinely empty library, a search without match
 * and a failed request are distinct, accessible states; a failure is never
 * shown as an empty library. 401 leads to a new sign-in, 404 on a score is
 * recoverable, outages offer a retry. Titles and tags are rendered as text.
 * The app's real API client runs over a fake HTTP layer, so the Bearer token,
 * the status mapping and the error-envelope parsing (use-case and transport
 * codes) are the production ones.
 */
import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALICE,
  FakeAuthPort,
  TEST_ACCESS_TOKEN,
  deferred,
  sessionOf,
  signInAs,
} from '../../test/support/fakeAuth';
import {
  API_BASE_URL,
  FakeHttp,
  SCORE_ID,
  errorBody,
  installResizeObserver,
  json,
  listBody,
  location,
  renderLibrary,
  savedBody,
  summary,
} from './support';

const EMPTY_TEXT = /Your library is empty/;
const NO_MATCH_TEXT = 'No saved scores match your search.';

const status = () => screen.getByRole('status');

describe('LIB-UI-01 library states', () => {
  it('shows a loading state, then the own saved summaries with title, tags and date', async () => {
    const http = new FakeHttp();
    const response = deferred<Response>();
    http.respond = () => response.promise;
    renderLibrary({ http });

    expect(await screen.findByText('Loading your library…')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Saved scores' })).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();

    await act(async () => {
      response.resolve(
        json(
          200,
          listBody([
            summary({
              scoreId: SCORE_ID,
              title: 'C major warm-up',
              tags: ['warm-up', 'beginner'],
              updatedAt: '2026-09-27T10:00:00.000Z',
            }),
            summary({ scoreId: 'scr_second', title: 'Blues in F', tags: [] }),
          ]),
        ),
      );
      await response.promise;
    });

    const list = screen.getByRole('list', { name: 'Saved scores' });
    const items = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.parentElement === list);
    expect(items).toHaveLength(2);
    const first = within(items[0]!);
    expect(first.getByRole('link', { name: 'C major warm-up' })).toHaveAttribute(
      'href',
      `/scores/${SCORE_ID}`,
    );
    expect(first.getByRole('button', { name: 'Filter by tag warm-up' })).toHaveTextContent(
      'warm-up',
    );
    expect(first.getByRole('button', { name: 'Filter by tag beginner' })).toBeInTheDocument();
    expect(items[0]!.querySelector('time')).toHaveAttribute('datetime', '2026-09-27T10:00:00.000Z');
    expect(within(items[1]!).getByRole('link', { name: 'Blues in F' })).toBeInTheDocument();
    expect(status()).toHaveTextContent('Showing 2 of 2 saved scores.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // The one request: GET /scores with the session's Bearer token, no cookie, not cached.
    expect(http.requests).toHaveLength(1);
    const [request] = http.requests;
    expect(request?.method).toBe('GET');
    expect(request?.url.href).toBe(`${API_BASE_URL}/scores`);
    expect(request?.authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(request?.credentials).toBe('omit');
    expect(request?.cache).toBe('no-store');
  });

  it('renders titles and tags as text, never as markup', async () => {
    const http = new FakeHttp();
    const title = '<img src=x onerror="alert(1)">Bach';
    const tag = '<b>bold</b>';
    http.respond = () => json(200, listBody([summary({ scoreId: SCORE_ID, title, tags: [tag] })]));
    const { container } = renderLibrary({ http });

    expect(await screen.findByRole('link', { name: title })).toHaveTextContent(title);
    expect(screen.getByRole('button', { name: `Filter by tag ${tag}` })).toHaveTextContent(tag);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('tells a genuinely empty library apart from a search without match', async () => {
    const http = new FakeHttp();
    http.respond = () => json(200, listBody([]));
    const { user } = renderLibrary({ http });

    expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument();
    expect(status()).toHaveTextContent(EMPTY_TEXT);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search titles and tags' }), 'fugue');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(NO_MATCH_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Saved scores' })).not.toBeInTheDocument();
  });

  const failures = [
    {
      name: '503 DEPENDENCY_UNAVAILABLE',
      reply: () => json(503, errorBody('DEPENDENCY_UNAVAILABLE')),
      message: /temporarily unavailable/,
      reference: 'corr-1234',
    },
    {
      name: 'no response (network failure)',
      reply: () => Promise.reject(new TypeError('Failed to fetch')),
      message: /temporarily unavailable/,
      reference: null,
    },
    {
      name: '429 RATE_LIMITED (transport code)',
      reply: () => json(429, errorBody('RATE_LIMITED'), { 'Retry-After': '30' }),
      message: /Too many requests/,
      reference: 'corr-1234',
    },
    {
      name: '403 FORBIDDEN_ORIGIN (transport code)',
      reply: () => json(403, errorBody('FORBIDDEN_ORIGIN', 'corr-origin')),
      message: /could not be loaded/,
      reference: 'corr-origin',
    },
    {
      name: '500 INTERNAL',
      reply: () => json(500, errorBody('INTERNAL')),
      message: /could not be loaded/,
      reference: 'corr-1234',
    },
    {
      name: '200 with a body that breaks the contract',
      reply: () => json(200, { items: [{ scoreId: SCORE_ID }], page: {} }),
      message: /could not be loaded/,
      reference: null,
    },
  ];

  it.each(failures)(
    '$name is a failure with a retry, never an empty library',
    async ({ reply, message, reference }) => {
      const http = new FakeHttp();
      http.respond = reply;
      const { user } = renderLibrary({ http });

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(alert).not.toHaveTextContent('Server message');
      if (reference === null) expect(alert).not.toHaveTextContent('Reference');
      else expect(within(alert).getByText(reference)).toBeInTheDocument();
      expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Saved scores' })).not.toBeInTheDocument();

      http.respond = () =>
        json(200, listBody([summary({ scoreId: SCORE_ID, title: 'Recovered' })]));
      await user.click(within(alert).getByRole('button', { name: 'Try again' }));

      expect(await screen.findByRole('link', { name: 'Recovered' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(http.to('/scores')).toHaveLength(2);
    },
  );

  it('asks for a new sign-in on 401 and shows the library again afterwards', async () => {
    const http = new FakeHttp();
    http.respond = () => json(401, errorBody('UNAUTHENTICATED'));
    const { user, port } = renderLibrary({ http });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your session has expired. Sign in again to continue.');
    expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Sign in again' }));

    expect(port.signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    // The guard's `/login?next=...` redirect may land first; sign-out then replaces it.
    await vi.waitFor(() => expect(location()).toBe('/login'));

    http.respond = () => json(200, listBody([summary({ scoreId: SCORE_ID, title: 'Back again' })]));
    await signInAs(user, ALICE);

    expect(await screen.findByRole('link', { name: 'Back again' })).toBeInTheDocument();
    expect(location()).toBe('/library');
  });

  it('asks for a new sign-in without sending a request when the session has no token', async () => {
    const http = new FakeHttp();
    const port = new FakeAuthPort(sessionOf(ALICE));
    port.getAccessToken.mockResolvedValue(null);
    renderLibrary({ http, port });

    expect(await screen.findByRole('alert')).toHaveTextContent('Your session has expired');
    expect(http.requests).toHaveLength(0);
  });

  it('shows an outage, not a sign-in request, when the session cannot be renewed', async () => {
    const http = new FakeHttp();
    const port = new FakeAuthPort(sessionOf(ALICE));
    port.getAccessToken.mockRejectedValue(new Error('auth provider unreachable'));
    renderLibrary({ http, port });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/temporarily unavailable/);
    expect(within(alert).queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
    expect(http.requests).toHaveLength(0);
  });
});

describe('LIB-UI-01 saved score states', () => {
  beforeEach(() => {
    installResizeObserver();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers a missing or foreign score with a recoverable not-found', async () => {
    const http = new FakeHttp();
    http.respond = (request) =>
      request.url.pathname === '/scores'
        ? json(200, listBody([summary({ scoreId: SCORE_ID, title: 'Still here' })]))
        : json(404, errorBody('NOT_FOUND'));
    const { user } = renderLibrary({ http, path: '/scores/scr_missing' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This score is not in your library.');
    expect(http.requests.map((request) => request.url.pathname)).toEqual(['/scores/scr_missing']);

    await user.click(within(alert).getByRole('link', { name: 'Back to your library' }));

    expect(await screen.findByRole('link', { name: 'Still here' })).toBeInTheDocument();
    expect(location()).toBe('/library');
  });

  it('treats an ID that cannot exist as not found, without a request', async () => {
    const http = new FakeHttp();
    renderLibrary({ http, path: `/scores/${encodeURIComponent('<script>')}` });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This score is not in your library.',
    );
    expect(http.requests).toHaveLength(0);
  });

  it('offers a retry when the score cannot be loaded for now', async () => {
    const http = new FakeHttp();
    http.respond = () => json(503, errorBody('DEPENDENCY_UNAVAILABLE'));
    const { user } = renderLibrary({ http, path: `/scores/${SCORE_ID}` });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/temporarily unavailable/);

    http.respond = () => json(200, savedBody({ title: 'Loaded on retry' }));
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Loaded on retry' })).toBeInTheDocument();
    expect(http.to(`/scores/${SCORE_ID}`)).toHaveLength(2);
  });
});
