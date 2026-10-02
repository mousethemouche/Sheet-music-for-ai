/**
 * AUTH-UI-03 (issue #25): password reset from the emailed link (valid, expired
 * and invalid links, a recovery session that ended), the return path kept
 * through sign-in (external, protocol-relative and javascript: targets
 * rejected), and the OAuth consent page (authorization_id kept through
 * sign-in, approve/deny by keyboard, unusable requests refused).
 */
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuthRedirectResult, AuthResult, OAuthAuthorizationState } from '../auth/authPort';
import {
  ALICE,
  FakeAuthPort,
  PASSWORD,
  fail,
  ok,
  renderApp,
  sessionOf,
  signInAs,
} from './support/fakeAuth';

const location = () => screen.getByTestId('location').textContent;

describe('AUTH-UI-03 password reset link', () => {
  it('lets a valid recovery link set a new password, by keyboard', async () => {
    const port = new FakeAuthPort(sessionOf(ALICE));
    port.getRedirectResult.mockResolvedValue({ kind: 'password-recovery' });
    const { user } = renderApp({ port, path: '/reset-password' });

    expect(screen.getByRole('status')).toHaveTextContent('Checking your reset link…');
    const newPassword = await screen.findByLabelText('New password');
    act(() => newPassword.focus());
    await user.keyboard('a new long password');
    await user.tab();
    expect(screen.getByLabelText('Confirm new password')).toHaveFocus();
    await user.keyboard('a new long password{Enter}');

    expect(await screen.findByRole('status')).toHaveTextContent('Your password has been changed.');
    expect(port.updatePassword).toHaveBeenCalledWith('a new long password');
    expect(screen.getByRole('link', { name: 'Continue to your library' })).toHaveAttribute(
      'href',
      '/library',
    );
  });

  it.each<{ name: string; result: AuthRedirectResult; heading: string }>([
    {
      name: 'an expired link',
      result: { kind: 'link-error', reason: 'expired' },
      heading: 'Reset link expired',
    },
    {
      name: 'an invalid or used link',
      result: { kind: 'link-error', reason: 'invalid' },
      heading: 'Reset link not valid',
    },
    { name: 'no recovery link at all', result: { kind: 'none' }, heading: 'Reset link not valid' },
  ])('offers a new link instead of the form for $name', async ({ result, heading }) => {
    const port = new FakeAuthPort(null);
    port.getRedirectResult.mockResolvedValue(result);
    const { user } = renderApp({ port, path: '/reset-password' });

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Send a new reset link' }));
    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('turns a recovery session that ended meanwhile into the expired state', async () => {
    const port = new FakeAuthPort(sessionOf(ALICE));
    port.getRedirectResult.mockResolvedValue({ kind: 'password-recovery' });
    port.updatePassword.mockResolvedValueOnce(fail('session-missing'));
    const { user } = renderApp({ port, path: '/reset-password' });

    await user.type(await screen.findByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('heading', { name: 'Reset link expired' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send a new reset link' })).toBeInTheDocument();
  });
});

describe('AUTH-UI-03 return path after sign-in', () => {
  // Rejected targets point at /phish so that a partly effective check (for
  // example one keeping the path of an external URL) is visible.
  it.each<{ name: string; next: string; expected: string }>([
    {
      name: 'an in-app path with query',
      next: '/library?view=recent',
      expected: '/library?view=recent',
    },
    { name: 'an absolute external URL', next: 'https://evil.example/phish', expected: '/library' },
    { name: 'a protocol-relative URL', next: '//evil.example/phish', expected: '/library' },
    { name: 'a javascript: URL', next: 'javascript:alert(document.cookie)', expected: '/library' },
    { name: 'a backslash host', next: '/\\evil.example/phish', expected: '/library' },
    { name: 'a tab before the host', next: '/\t/evil.example/phish', expected: '/library' },
    {
      name: 'dot segments that collapse to //host',
      next: '/..//evil.example/phish',
      expected: '/library',
    },
    { name: 'a path without leading slash', next: 'phish', expected: '/library' },
  ])('after $name lands on $expected', async ({ next, expected }) => {
    const port = new FakeAuthPort(null);
    const { user } = renderApp({
      port,
      path: `/login?${new URLSearchParams({ next }).toString()}`,
    });

    await screen.findByRole('heading', { name: 'Sign in' });
    await signInAs(user, ALICE);

    expect(await screen.findByRole('heading', { name: 'Your library' })).toBeInTheDocument();
    expect(location()).toBe(expected);
  });
});

describe('AUTH-UI-03 OAuth consent', () => {
  const CONSENT: OAuthAuthorizationState = {
    kind: 'consent-required',
    request: {
      authorizationId: 'auth-123',
      clientName: 'Example AI',
      clientUri: 'https://ai.example',
      redirectUri: 'https://ai.example/callback',
      scopes: ['openid', 'email', 'custom:scores'],
    },
  };

  it('keeps the authorization request through sign-in and shows client and scopes', async () => {
    const port = new FakeAuthPort(null);
    port.getOAuthAuthorization.mockResolvedValue(ok(CONSENT));
    const { user } = renderApp({ port, path: '/oauth/consent?authorization_id=auth-123' });

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(location()).toBe('/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dauth-123');
    expect(port.getOAuthAuthorization).not.toHaveBeenCalled();

    await signInAs(user, ALICE);

    expect(
      await screen.findByRole('heading', { name: 'Allow Example AI to use your account?' }),
    ).toBeInTheDocument();
    expect(location()).toBe('/oauth/consent?authorization_id=auth-123');
    expect(port.getOAuthAuthorization).toHaveBeenCalledWith('auth-123');
    expect(screen.getByText(`Signed in as ${ALICE.email}.`)).toBeInTheDocument();
    const scopes = screen.getByRole('list', { name: 'Requested permissions' });
    expect(scopes).toHaveTextContent('Confirm who you are');
    expect(scopes).toHaveTextContent('See your email address');
    expect(scopes).toHaveTextContent('custom:scores');
  });

  it.each([
    {
      decision: 'approve' as const,
      button: 'Allow',
      redirectUrl: 'https://ai.example/callback?code=c1&state=s1',
    },
    {
      decision: 'deny' as const,
      button: 'Deny',
      redirectUrl: 'https://ai.example/callback?error=access_denied&state=s1',
    },
  ])('records a keyboard $decision once and returns to the client', async (testCase) => {
    const port = new FakeAuthPort(sessionOf(ALICE));
    port.getOAuthAuthorization.mockResolvedValue(ok(CONSENT));
    port.decideOAuthAuthorization.mockResolvedValue(ok({ redirectUrl: testCase.redirectUrl }));
    const { user, leaveApp } = renderApp({
      port,
      path: '/oauth/consent?authorization_id=auth-123',
    });

    const button = await screen.findByRole('button', { name: testCase.button });
    act(() => button.focus());
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('status')).toHaveTextContent('Returning to the application…');
    expect(port.decideOAuthAuthorization).toHaveBeenCalledTimes(1);
    expect(port.decideOAuthAuthorization).toHaveBeenCalledWith('auth-123', testCase.decision);
    expect(leaveApp).toHaveBeenCalledWith(testCase.redirectUrl);
  });

  it('continues to the client without asking again when consent was already given', async () => {
    const port = new FakeAuthPort(sessionOf(ALICE));
    port.getOAuthAuthorization.mockResolvedValue(
      ok({ kind: 'redirect', redirectUrl: 'https://ai.example/callback?code=c2' }),
    );
    const { leaveApp } = renderApp({ port, path: '/oauth/consent?authorization_id=auth-123' });

    expect(await screen.findByText('Returning to the application…')).toHaveAttribute(
      'role',
      'status',
    );
    expect(leaveApp).toHaveBeenCalledWith('https://ai.example/callback?code=c2');
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  });

  const INVALID =
    'This authorization request is invalid or has expired. Go back to the application and connect again.';

  it.each<{ name: string; path: string; details: AuthResult<OAuthAuthorizationState> }>([
    {
      name: 'a missing authorization_id',
      path: '/oauth/consent',
      details: ok(CONSENT),
    },
    {
      name: 'an unknown or expired authorization_id',
      path: '/oauth/consent?authorization_id=gone',
      details: fail('not-found'),
    },
    {
      name: 'a javascript: redirect from the provider',
      path: '/oauth/consent?authorization_id=auth-123',
      details: ok({ kind: 'redirect', redirectUrl: 'javascript:alert(1)' }),
    },
  ])('refuses $name without leaving the app', async ({ path, details }) => {
    const port = new FakeAuthPort(sessionOf(ALICE));
    port.getOAuthAuthorization.mockResolvedValue(details);
    const { leaveApp } = renderApp({ port, path });

    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID);
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    expect(leaveApp).not.toHaveBeenCalled();
  });
});
