/**
 * AUTH-UI-02 (issue #25): session restoration and per-account private state.
 * No private content (and no sign-in redirect) before the provider answers; a
 * missing session redirects to sign-in and back. Sign-out and account switches
 * stop audio and clear private caches through the registry; account B never
 * sees account A, even when A's restore or token refresh arrives late. The
 * provider subscription ends with the app.
 */
import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../auth/authPort';
import { createPrivateStateRegistry } from '../auth/privateState';
import {
  ALICE,
  BOB,
  FakeAuthPort,
  deferred,
  renderApp,
  sessionOf,
  signInAs,
} from './support/fakeAuth';

const location = () => screen.getByTestId('location').textContent;

/** Registry with an "audio player" and a "score cache" holding account data. */
function privateFeatures() {
  const privateState = createPrivateStateRegistry();
  const stopAudio = vi.fn();
  const clearScoreCache = vi.fn();
  privateState.register(stopAudio);
  privateState.register(clearScoreCache);
  return { privateState, stopAudio, clearScoreCache };
}

describe('AUTH-UI-02 session restoration', () => {
  it('shows neither private content nor a sign-in redirect while the session is restored', async () => {
    const restore = deferred<AuthSession | null>();
    const port = new FakeAuthPort(restore.promise);
    renderApp({ port, path: '/library' });

    expect(screen.getByRole('status')).toHaveTextContent('Checking your session…');
    expect(screen.queryByRole('heading', { name: 'Your library' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(location()).toBe('/library');

    restore.resolve(sessionOf(ALICE));
    await act(() => restore.promise);

    expect(screen.getByRole('heading', { name: 'Your library' })).toBeInTheDocument();
    expect(screen.getByText(`Signed in as ${ALICE.email}.`)).toBeInTheDocument();
    expect(location()).toBe('/library');
  });

  it('sends a visitor without session to sign-in and back to the requested page', async () => {
    const port = new FakeAuthPort(null);
    const { user } = renderApp({ port, path: '/library?sort=title' });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(location()).toBe('/login?next=%2Flibrary%3Fsort%3Dtitle');
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();

    await signInAs(user, ALICE);

    expect(await screen.findByRole('heading', { name: 'Your library' })).toBeInTheDocument();
    expect(location()).toBe('/library?sort=title');
  });
});

describe('AUTH-UI-02 private state', () => {
  it('stops audio and clears private caches before ending the session on sign-out', async () => {
    const port = new FakeAuthPort(sessionOf(ALICE));
    const { privateState, stopAudio, clearScoreCache } = privateFeatures();
    const order: string[] = [];
    stopAudio.mockImplementation(() => order.push('stop audio'));
    clearScoreCache.mockImplementation(() => order.push('clear score cache'));
    const providerSignOut = port.signOut.getMockImplementation();
    port.signOut.mockImplementation(() => {
      order.push('provider sign-out');
      return providerSignOut!();
    });
    const { user } = renderApp({ port, path: '/library', privateState });

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(location()).toBe('/login');
    expect(order.slice(0, 3)).toEqual(['stop audio', 'clear score cache', 'provider sign-out']);
    expect(screen.queryByText(ALICE.email ?? '')).not.toBeInTheDocument();
  });

  it('keeps the user signed in and explains when the device session could not be ended', async () => {
    const port = new FakeAuthPort(sessionOf(ALICE));
    port.signOut.mockResolvedValueOnce({ ok: false, error: 'network' });
    const { user } = renderApp({ port, path: '/library' });

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not reach the server. Check your connection and try again.',
    );
    expect(screen.getByRole('heading', { name: 'Your library' })).toBeInTheDocument();
  });

  it('clears A’s private state and shows only B when another account signs in', async () => {
    const port = new FakeAuthPort(sessionOf(ALICE));
    const { privateState, stopAudio, clearScoreCache } = privateFeatures();
    renderApp({ port, path: '/library', privateState });
    expect(await screen.findByText(`Signed in as ${ALICE.email}.`)).toBeInTheDocument();

    // For example signed in as B in another tab.
    act(() => port.emit('signed-in', sessionOf(BOB)));

    expect(screen.getByText(`Signed in as ${BOB.email}.`)).toBeInTheDocument();
    expect(screen.queryByText(ALICE.email ?? '', { exact: false })).not.toBeInTheDocument();
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(clearScoreCache).toHaveBeenCalledTimes(1);
  });

  it('ignores A’s session restore that resolves after B signed in', async () => {
    const restore = deferred<AuthSession | null>();
    const port = new FakeAuthPort(restore.promise);
    renderApp({ port, path: '/library' });

    act(() => port.emit('signed-in', sessionOf(BOB)));
    expect(screen.getByText(`Signed in as ${BOB.email}.`)).toBeInTheDocument();

    restore.resolve(sessionOf(ALICE));
    await act(() => restore.promise);

    expect(screen.getByText(`Signed in as ${BOB.email}.`)).toBeInTheDocument();
    expect(screen.queryByText(ALICE.email ?? '', { exact: false })).not.toBeInTheDocument();
  });

  it('ignores a token refresh for A that arrives after the switch to B', async () => {
    const port = new FakeAuthPort(sessionOf(ALICE));
    const { privateState, clearScoreCache } = privateFeatures();
    renderApp({ port, path: '/library', privateState });
    await screen.findByText(`Signed in as ${ALICE.email}.`);
    act(() => port.emit('signed-in', sessionOf(BOB)));

    act(() => port.emit('token-refreshed', sessionOf(ALICE)));

    expect(screen.getByText(`Signed in as ${BOB.email}.`)).toBeInTheDocument();
    expect(screen.queryByText(ALICE.email ?? '', { exact: false })).not.toBeInTheDocument();
    // Only the real switch cleared B's state holders; the stale refresh did not.
    expect(clearScoreCache).toHaveBeenCalledTimes(1);
  });

  it('releases the provider subscription when the app unmounts', async () => {
    const port = new FakeAuthPort(sessionOf(ALICE));
    const { privateState, clearScoreCache } = privateFeatures();
    const { unmount } = renderApp({ port, path: '/library', privateState });
    await screen.findByText(`Signed in as ${ALICE.email}.`);
    expect(port.subscriberCount).toBe(1);

    unmount();

    expect(port.subscriberCount).toBe(0);
    port.emit('signed-in', sessionOf(BOB));
    expect(clearScoreCache).not.toHaveBeenCalled();
  });
});
