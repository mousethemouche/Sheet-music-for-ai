/**
 * LIB-UI-02 (issue #15): library search. Text, tag filters, removing a filter,
 * clearing and "Show more" send the GET /scores contract parameters
 * (`query`, repeated `tags`, `offset`); the latest search always wins over a
 * late response of an older one; requests are aborted when superseded, on
 * unmount and on sign-out. There is no debounce: a search runs on submit.
 * Matching semantics are #9's (DB-02), not the UI's.
 */
import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deferred, type Deferred } from '../../test/support/fakeAuth';
import {
  FakeHttp,
  type RecordedRequest,
  json,
  listBody,
  location,
  renderLibrary,
  summary,
} from './support';

/** The contract parameters of a GET /scores request. */
function params(request: RecordedRequest | undefined) {
  if (request === undefined) throw new Error('missing request');
  const search = request.url.searchParams;
  return {
    keys: [...new Set(search.keys())].sort(),
    query: search.get('query'),
    tags: search.getAll('tags'),
    offset: search.get('offset'),
  };
}

const SCALES = summary({ scoreId: 'scr_scales', title: 'Scale study', tags: ['scales'] });
const WARM_UP = summary({ scoreId: 'scr_warm', title: 'Warm-up', tags: ['warm-up', 'scales'] });

/** Answers every request later, in whatever order the test resolves them. */
function manualHttp(): { http: FakeHttp; replies: Deferred<Response>[] } {
  const http = new FakeHttp();
  const replies: Deferred<Response>[] = [];
  http.respond = () => {
    const reply = deferred<Response>();
    replies.push(reply);
    return reply.promise;
  };
  return { http, replies };
}

async function answer(reply: Deferred<Response> | undefined, response: Response): Promise<void> {
  if (reply === undefined) throw new Error('missing reply');
  await act(async () => {
    reply.resolve(response);
    await reply.promise;
  });
}

describe('LIB-UI-02 search parameters', () => {
  it('sends the query, repeated tags, a removed tag and a cleared search as contract parameters', async () => {
    const http = new FakeHttp();
    http.respond = () => json(200, listBody([SCALES, WARM_UP]));
    const { user } = renderLibrary({ http });
    await screen.findByRole('link', { name: 'Scale study' });
    expect(params(http.last)).toEqual({ keys: [], query: null, tags: [], offset: null });

    const box = await screen.findByRole('searchbox', { name: 'Search titles and tags' });
    await user.type(box, '  Bach  ');
    await user.keyboard('{Enter}');
    await screen.findByRole('button', { name: 'Clear search' });
    expect(params(http.last)).toEqual({ keys: ['query'], query: 'Bach', tags: [], offset: null });

    const firstItem = screen.getByRole('link', { name: 'Scale study' }).closest('li')!;
    await user.click(within(firstItem).getByRole('button', { name: 'Filter by tag scales' }));
    expect(params(http.last)).toEqual({
      keys: ['query', 'tags'],
      query: 'Bach',
      tags: ['scales'],
      offset: null,
    });

    // An active filter cannot be added twice; another tag is appended in order.
    await screen.findByRole('link', { name: 'Warm-up' });
    const secondItem = screen.getByRole('link', { name: 'Warm-up' }).closest('li')!;
    expect(within(secondItem).getByRole('button', { name: 'Filter by tag scales' })).toBeDisabled();
    await user.click(within(secondItem).getByRole('button', { name: 'Filter by tag warm-up' }));
    expect(params(http.last).tags).toEqual(['scales', 'warm-up']);

    await user.click(screen.getByRole('button', { name: 'Remove tag filter scales' }));
    expect(params(http.last)).toEqual({
      keys: ['query', 'tags'],
      query: 'Bach',
      tags: ['warm-up'],
      offset: null,
    });

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(params(http.last)).toEqual({ keys: [], query: null, tags: [], offset: null });
    expect(box).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    expect(http.requests.every((request) => request.url.pathname === '/scores')).toBe(true);
  });

  it('asks for the next page at nextOffset with the same search and appends it', async () => {
    const http = new FakeHttp();
    http.respond = (request) =>
      request.url.searchParams.get('offset') === '2'
        ? json(200, listBody([summary({ scoreId: 'scr_c', title: 'Third' })], { offset: 2 }))
        : json(200, listBody([SCALES, WARM_UP], { total: 3, nextOffset: 2 }));
    const { user } = renderLibrary({ http });

    await user.type(
      await screen.findByRole('searchbox', { name: 'Search titles and tags' }),
      'study',
    );
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Showing 2 of 3 matching scores.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByRole('link', { name: 'Third' })).toBeInTheDocument();
    expect(params(http.last)).toEqual({
      keys: ['offset', 'query'],
      query: 'study',
      tags: [],
      offset: '2',
    });
    const list = screen.getByRole('list', { name: 'Saved scores' });
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Scale study', 'Warm-up', 'Third']);
    expect(screen.getByRole('status')).toHaveTextContent('Showing 3 of 3 matching scores.');
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });
});

describe('LIB-UI-02 request ordering and cleanup', () => {
  it('never lets a late response of an older search replace the latest one', async () => {
    const { http, replies } = manualHttp();
    const { user } = renderLibrary({ http });
    const box = await screen.findByRole('searchbox', { name: 'Search titles and tags' });

    await user.type(box, 'old');
    await user.keyboard('{Enter}');
    await user.clear(box);
    await user.type(box, 'new');
    await user.keyboard('{Enter}');
    expect(http.requests.map((request) => request.url.searchParams.get('query'))).toEqual([
      null,
      'old',
      'new',
    ]);
    // Superseded requests were aborted.
    expect(http.requests.map((request) => request.signal?.aborted)).toEqual([true, true, false]);

    await answer(
      replies[2],
      json(200, listBody([summary({ scoreId: 'scr_new', title: 'New hit' })])),
    );
    expect(screen.getByRole('link', { name: 'New hit' })).toBeInTheDocument();

    // The older answers arrive late (this HTTP layer ignores aborts): nothing changes.
    await answer(
      replies[1],
      json(200, listBody([summary({ scoreId: 'scr_old', title: 'Old hit' })])),
    );
    await answer(replies[0], json(200, listBody([])));
    expect(screen.getByRole('link', { name: 'New hit' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Old hit' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Your library is empty/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 1 matching score.');
  });

  it('aborts the pending request on unmount and ignores its late response', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const { http, replies } = manualHttp();
    const { unmount } = renderLibrary({ http });
    await screen.findByText('Loading your library…');
    // The loading text shows before the token is read and the request sent.
    await vi.waitFor(() => expect(http.requests).toHaveLength(1));
    const [request] = http.requests;

    unmount();

    expect(request?.signal?.aborted).toBe(true);
    await answer(replies[0], json(200, listBody([SCALES])));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('aborts the pending request when the user signs out', async () => {
    const { http } = manualHttp();
    const { user, port } = renderLibrary({ http });
    await screen.findByText('Loading your library…');
    // The loading text shows before the token is read and the request sent.
    await vi.waitFor(() => expect(http.requests).toHaveLength(1));
    const [request] = http.requests;
    let abortedWhenSessionEnded: boolean | undefined;
    const providerSignOut = port.signOut.getMockImplementation();
    port.signOut.mockImplementation(() => {
      abortedWhenSessionEnded = request?.signal?.aborted;
      return providerSignOut!();
    });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(abortedWhenSessionEnded).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    // The guard's `/login?next=...` redirect may land first; sign-out then replaces it.
    await vi.waitFor(() => expect(location()).toBe('/login'));
  });
});
