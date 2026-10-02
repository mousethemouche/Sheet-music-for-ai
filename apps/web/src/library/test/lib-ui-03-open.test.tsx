/**
 * LIB-UI-03 (issue #15): opening a saved score. The selected ID is fetched
 * once from GET /scores/:id, its canonical content goes to ONE shared
 * ScorePlayer (one renderer, one engine) with no write request, and the
 * stable ID is shown for the conversation. The response adapter accepts the
 * SavedArtifact contract and refuses other shapes before any player mounts.
 * Signing out silences the player before the session ends. ScorePlayer's own
 * behaviour (controls, revisions, failures) is #7's UI-01..05, not repeated.
 */
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeHttp,
  SCORE_ID,
  errorBody,
  installResizeObserver,
  json,
  listBody,
  location,
  renderLibrary,
  savedBody,
  savedScoreSpec,
  summary,
} from './support';

beforeEach(() => {
  installResizeObserver();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const SCORE_PATH = `/scores/${SCORE_ID}`;

function without(body: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key)));
}

/** Library listing SCORE_ID, and SCORE_ID's saved artifact from `body()`. */
function libraryHttp(body: () => unknown = () => savedBody()): FakeHttp {
  const http = new FakeHttp();
  http.respond = (request) =>
    request.url.pathname === '/scores'
      ? json(
          200,
          listBody([summary({ scoreId: SCORE_ID, title: 'C major warm-up', tags: ['warm-up'] })]),
        )
      : json(200, body());
  return http;
}

describe('LIB-UI-03 open a saved score', () => {
  it('fetches the selected ID once and shows its canonical content in one player, reading only', async () => {
    const http = libraryHttp();
    const { user, fakePlayer } = renderLibrary({ http });

    await user.click(await screen.findByRole('link', { name: 'C major warm-up' }));

    expect(await screen.findByRole('heading', { name: 'C major warm-up' })).toBeInTheDocument();
    expect(location()).toBe(SCORE_PATH);
    expect(http.to(SCORE_PATH)).toHaveLength(1);
    // No implicit save: the page only ever reads.
    expect(http.requests.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      'GET /scores',
      `GET ${SCORE_PATH}`,
    ]);

    // The stable ID the user gives the AI to continue in a conversation.
    expect(screen.getByText(SCORE_ID, { selector: 'code' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Tags' })).getByText('warm-up'),
    ).toBeInTheDocument();

    // One shared player on the canonical content (F01 at revision 3), no duplicate.
    const players = await screen.findAllByRole('region', { name: /^Score player/ });
    expect(players).toHaveLength(1);
    expect(fakePlayer.renderers).toHaveLength(1);
    expect(fakePlayer.engines).toHaveLength(1);
    const canonical = savedScoreSpec();
    const engraved = fakePlayer.renderers[0]?.engraved[0];
    expect(engraved).toEqual(canonical);
    const plan = fakePlayer.engines[0]?.loads[0];
    expect({ scoreId: plan?.scoreId, revision: plan?.revision }).toEqual({
      scoreId: SCORE_ID,
      revision: 3,
    });
    // Never autoplays.
    expect(fakePlayer.engines[0]?.commands).not.toContain('play');
  });

  it('silences the playing score before the session ends on sign-out', async () => {
    const http = libraryHttp();
    const { user, port, fakePlayer } = renderLibrary({ http, path: SCORE_PATH });
    const play = await screen.findByRole('button', { name: 'Play' });
    await vi.waitFor(() => expect(play).toBeEnabled());
    await user.click(play);
    const engine = fakePlayer.engines[0]!;
    expect(engine.state).toBe('playing');

    let stateWhenSessionEnded: string | undefined;
    const providerSignOut = port.signOut.getMockImplementation();
    port.signOut.mockImplementation(() => {
      stateWhenSessionEnded = engine.state;
      return providerSignOut!();
    });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(stateWhenSessionEnded).toBe('ready');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    // The page is gone and its engine destroyed: nothing of the account remains.
    expect(screen.queryByRole('region', { name: /^Score player/ })).not.toBeInTheDocument();
    expect(engine.state).toBe('destroyed');
    // The guard's `/login?next=...` redirect may land first; sign-out then replaces it.
    await vi.waitFor(() => expect(location()).toBe('/login'));
  });

  const invalidBodies: { name: string; body: () => unknown }[] = [
    {
      name: 'a draft artifact',
      body: () => ({
        ...without(savedBody(), 'title', 'tags'),
        state: 'draft',
        expiresAt: '2026-10-04T10:00:00.000Z',
      }),
    },
    { name: 'another score ID', body: () => savedBody({ scoreId: 'scr_other' }) },
    {
      name: 'a missing title',
      body: () => without(savedBody(), 'title'),
    },
    { name: 'an unknown field', body: () => savedBody({ ownerId: 'user-b' }) },
    { name: 'a score that is not an object', body: () => savedBody({ score: 'X:1\nK:C\nCDEF' }) },
    { name: 'a timestamp that is not ISO-8601', body: () => savedBody({ updatedAt: 'yesterday' }) },
  ];

  it.each(invalidBodies)('refuses $name without mounting a player', async ({ body }) => {
    const { fakePlayer } = renderLibrary({ http: libraryHttp(body), path: SCORE_PATH });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This score could not be opened.');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Score player/ })).not.toBeInTheDocument();
    expect(fakePlayer.renderers).toHaveLength(0);
    expect(fakePlayer.engines).toHaveLength(0);
  });

  it('refuses a body that is not JSON', async () => {
    const http = new FakeHttp();
    http.respond = () => new Response('<html>proxy error page</html>', { status: 200 });
    renderLibrary({ http, path: SCORE_PATH });

    expect(await screen.findByRole('alert')).toHaveTextContent('This score could not be opened.');
    expect(screen.queryByText(/proxy error page/)).not.toBeInTheDocument();
  });

  it('replaces the player when another score is opened, leaving no engine behind', async () => {
    const otherId = 'scr_00000000-0000-4000-8000-000000000002';
    const other = savedBody({
      scoreId: otherId,
      title: 'Second score',
      score: { ...savedScoreSpec(), id: otherId },
    });
    const http = new FakeHttp();
    http.respond = (request) => {
      switch (request.url.pathname) {
        case '/scores':
          return json(200, listBody([summary({ scoreId: otherId, title: 'Second score' })]));
        case SCORE_PATH:
          return json(200, savedBody());
        case `/scores/${otherId}`:
          return json(200, other);
        default:
          return json(404, errorBody('NOT_FOUND'));
      }
    };
    const { user, fakePlayer } = renderLibrary({ http, path: SCORE_PATH });
    await screen.findByRole('heading', { name: 'C major warm-up' });

    await user.click(screen.getByRole('link', { name: 'Back to your library' }));
    await user.click(await screen.findByRole('link', { name: 'Second score' }));

    expect(await screen.findByRole('heading', { name: 'Second score' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^Score player/ })).toHaveLength(1);
    expect(fakePlayer.engines.map((engine) => engine.state === 'destroyed')).toEqual([true, false]);
    expect(fakePlayer.renderers.map((renderer) => renderer.destroyed)).toEqual([true, false]);
    expect(fakePlayer.renderers[1]?.engraved[0]?.id).toBe(otherId);
  });
});

describe('LIB-UI-03 sound credits', () => {
  it('links the score page to the piano sound attribution and its license', async () => {
    const { user } = renderLibrary({ http: libraryHttp(), path: SCORE_PATH });

    await user.click(await screen.findByRole('link', { name: 'Piano sound credits' }));

    expect(await screen.findByRole('heading', { name: 'Credits' })).toBeInTheDocument();
    expect(screen.getByText('Piano sound: test attribution.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'License (MIT)' })).toHaveAttribute(
      'href',
      'http://localhost/assets/soundfonts/piano/LICENSE.txt',
    );
    expect(screen.getByRole('link', { name: 'Notice' })).toHaveAttribute(
      'href',
      'http://localhost/assets/soundfonts/piano/NOTICE.txt',
    );
  });
});
