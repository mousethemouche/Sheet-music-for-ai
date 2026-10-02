/**
 * AUTH-UI-01 (issue #25): sign-up, sign-in and recovery forms through the
 * neutral AuthPort. Valid submissions, required-input rejection without a
 * provider call, one request per submission while pending, fixed safe error
 * messages, confirmation-required sign-up that is not a session, and a
 * recovery request that answers the same for known and unknown addresses.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AuthErrorCode, AuthResult } from '../auth/authPort';
import {
  ALICE,
  FakeAuthPort,
  PASSWORD,
  deferred,
  fail,
  ok,
  renderApp,
  sessionOf,
  signInAs,
} from './support/fakeAuth';

const location = () => screen.getByTestId('location').textContent;

describe('AUTH-UI-01 sign-in', () => {
  it('signs in with valid credentials and continues to the requested page', async () => {
    const port = new FakeAuthPort(null);
    const { user } = renderApp({ port, path: '/login?next=%2Flibrary%3Fview%3Drecent' });

    await user.type(await screen.findByLabelText('Email'), `  ${ALICE.email}  `);
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Your library' })).toBeInTheDocument();
    expect(location()).toBe('/library?view=recent');
    expect(port.signIn).toHaveBeenCalledWith({ email: ALICE.email, password: PASSWORD });
  });

  it.each<{ name: string; result: AuthResult<void>; message: string }>([
    {
      name: 'wrong email or password',
      result: fail('invalid-credentials'),
      message: 'Incorrect email or password.',
    },
    {
      name: 'unconfirmed email',
      result: fail('email-not-confirmed'),
      message: 'Confirm your email address first: open the link we sent you, then sign in.',
    },
    {
      name: 'network failure',
      result: fail('network'),
      message: 'We could not reach the server. Check your connection and try again.',
    },
    {
      name: 'provider outage',
      result: fail('unavailable'),
      message: 'The service is temporarily unavailable. Try again later.',
    },
  ])('shows a fixed message and stays signed out on $name', async ({ result, message }) => {
    const port = new FakeAuthPort(null);
    port.signIn.mockResolvedValueOnce(result);
    const { user } = renderApp({ port, path: '/login' });

    await screen.findByLabelText('Email');
    await signInAs(user, ALICE);

    expect(await screen.findByText(message)).toHaveAttribute('role', 'alert');
    expect(location()).toBe('/login');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
});

describe('AUTH-UI-01 required input', () => {
  interface Case {
    name: string;
    path: string;
    fill: (user: UserEvent) => Promise<void>;
    submit: string;
    field: string;
    message: string;
    providerCall: (port: FakeAuthPort) => unknown[][];
  }

  const RECOVERY_LINK = (port: FakeAuthPort) =>
    port.getRedirectResult.mockResolvedValue({ kind: 'password-recovery' });

  it.each<Case>([
    {
      name: 'sign-in without email',
      path: '/login',
      fill: (user) => user.type(screen.getByLabelText('Password'), PASSWORD),
      submit: 'Sign in',
      field: 'Email',
      message: 'Enter your email address.',
      providerCall: (port) => port.signIn.mock.calls,
    },
    {
      name: 'sign-in without password',
      path: '/login',
      fill: (user) => user.type(screen.getByLabelText('Email'), ALICE.email ?? ''),
      submit: 'Sign in',
      field: 'Password',
      message: 'Enter your password.',
      providerCall: (port) => port.signIn.mock.calls,
    },
    {
      name: 'sign-up with a malformed email',
      path: '/signup',
      fill: async (user) => {
        await user.type(screen.getByLabelText('Email'), 'alice.example.com');
        await user.type(screen.getByLabelText('Password'), PASSWORD);
      },
      submit: 'Create account',
      field: 'Email',
      message: 'Enter a valid email address.',
      providerCall: (port) => port.signUp.mock.calls,
    },
    {
      name: 'sign-up with a too short password',
      path: '/signup',
      fill: async (user) => {
        await user.type(screen.getByLabelText('Email'), ALICE.email ?? '');
        await user.type(screen.getByLabelText('Password'), 'short');
      },
      submit: 'Create account',
      field: 'Password',
      message: 'Use at least 8 characters.',
      providerCall: (port) => port.signUp.mock.calls,
    },
    {
      name: 'recovery request without email',
      path: '/forgot-password',
      fill: () => Promise.resolve(),
      submit: 'Send reset link',
      field: 'Email',
      message: 'Enter your email address.',
      providerCall: (port) => port.requestPasswordReset.mock.calls,
    },
    {
      name: 'new password that does not match its confirmation',
      path: '/reset-password',
      fill: async (user) => {
        await user.type(await screen.findByLabelText('New password'), PASSWORD);
        await user.type(screen.getByLabelText('Confirm new password'), `${PASSWORD}!`);
      },
      submit: 'Change password',
      field: 'Confirm new password',
      message: 'The passwords do not match.',
      providerCall: (port) => port.updatePassword.mock.calls,
    },
  ])('rejects $name without calling the provider', async (testCase) => {
    const port = new FakeAuthPort(null);
    RECOVERY_LINK(port);
    const { user } = renderApp({ port, path: testCase.path });

    await screen.findByRole('button', { name: testCase.submit });
    await testCase.fill(user);
    await user.click(screen.getByRole('button', { name: testCase.submit }));

    const field = screen.getByLabelText(testCase.field);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(testCase.message);
    expect(testCase.providerCall(port)).toHaveLength(0);
  });
});

describe('AUTH-UI-01 pending submissions', () => {
  it.each([
    {
      name: 'sign-in',
      path: '/login',
      submit: 'Sign in',
      pendingLabel: 'Signing in…',
      hold: (port: FakeAuthPort) => {
        const answer = deferred<AuthResult<void>>();
        port.signIn.mockReturnValueOnce(answer.promise);
        return () => answer.resolve(fail('invalid-credentials'));
      },
      calls: (port: FakeAuthPort) => port.signIn.mock.calls.length,
      settled: 'Incorrect email or password.',
    },
    {
      name: 'sign-up',
      path: '/signup',
      submit: 'Create account',
      pendingLabel: 'Creating account…',
      hold: (port: FakeAuthPort) => {
        const answer = deferred<AuthResult<'confirmation-required'>>();
        port.signUp.mockReturnValueOnce(answer.promise);
        return () => answer.resolve(ok('confirmation-required'));
      },
      calls: (port: FakeAuthPort) => port.signUp.mock.calls.length,
      settled: 'Check your email',
    },
    {
      name: 'recovery request',
      path: '/forgot-password',
      submit: 'Send reset link',
      pendingLabel: 'Sending…',
      hold: (port: FakeAuthPort) => {
        const answer = deferred<AuthResult<void>>();
        port.requestPasswordReset.mockReturnValueOnce(answer.promise);
        return () => answer.resolve(ok(undefined));
      },
      calls: (port: FakeAuthPort) => port.requestPasswordReset.mock.calls.length,
      settled: 'Check your email',
    },
  ])('sends one $name request however often it is submitted', async (testCase) => {
    const port = new FakeAuthPort(null);
    const release = testCase.hold(port);
    const { user } = renderApp({ port, path: testCase.path });

    await user.type(await screen.findByLabelText('Email'), ALICE.email ?? '');
    const password = screen.queryByLabelText('Password');
    if (password) await user.type(password, PASSWORD);
    // Two clicks faster than a re-render, then Enter once the button is disabled.
    const submit = screen.getByRole('button', { name: testCase.submit });
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    await user.type(screen.getByLabelText('Email'), '{Enter}');

    expect(screen.getByRole('button', { name: testCase.pendingLabel })).toBeDisabled();
    expect(testCase.calls(port)).toBe(1);

    release();
    expect(await screen.findByText(testCase.settled)).toBeInTheDocument();
    expect(testCase.calls(port)).toBe(1);
  });
});

describe('AUTH-UI-01 sign-up', () => {
  it('treats a confirmation-required sign-up as signed out', async () => {
    const port = new FakeAuthPort(null);
    const { user } = renderApp({
      port,
      path: '/signup?next=%2Foauth%2Fconsent%3Fauthorization_id%3Da1',
    });

    await user.type(await screen.findByLabelText('Email'), ALICE.email ?? '');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      `We sent a confirmation link to ${ALICE.email}.`,
    );
    // The emailed link returns to sign-in, which then continues to the consent page.
    expect(port.signUp).toHaveBeenCalledWith({
      email: ALICE.email,
      password: PASSWORD,
      confirmationPath: '/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Da1',
    });
    // No session: the account navigation still offers sign-in, and the private
    // route still requires it.
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Go to sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('continues to the return path when the provider signs the new account in', async () => {
    const port = new FakeAuthPort(null);
    port.signUp.mockImplementationOnce(() => {
      port.emit('signed-in', sessionOf(ALICE));
      return Promise.resolve(ok('signed-in' as const));
    });
    const { user } = renderApp({ port, path: '/signup' });

    await user.type(await screen.findByLabelText('Email'), ALICE.email ?? '');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Your library' })).toBeInTheDocument();
  });
});

describe('AUTH-UI-01 password recovery request', () => {
  const NEUTRAL = (email: string) =>
    `If an account exists for ${email}, we sent it a link to choose a new password.`;

  it.each<{ name: string; email: string; result: AuthResult<void> }>([
    { name: 'an existing account', email: 'alice@example.com', result: ok(undefined) },
    { name: 'an unknown address', email: 'nobody@example.com', result: fail('not-found') },
    { name: 'an address the provider rejects', email: 'eve@example.com', result: fail('unknown') },
  ])('answers the same for $name', async ({ email, result }) => {
    const port = new FakeAuthPort(null);
    port.requestPasswordReset.mockResolvedValueOnce(result);
    const { user } = renderApp({ port, path: '/forgot-password' });

    await user.type(await screen.findByLabelText('Email'), email);
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('status')).toHaveTextContent(NEUTRAL(email));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(port.requestPasswordReset).toHaveBeenCalledWith({
      email,
      resetPath: '/reset-password',
    });
  });

  it.each<{ code: AuthErrorCode; message: string }>([
    {
      code: 'network',
      message: 'We could not reach the server. Check your connection and try again.',
    },
    { code: 'rate-limited', message: 'Too many attempts. Wait a few minutes, then try again.' },
  ])('reports a $code failure and keeps the form for a retry', async ({ code, message }) => {
    const port = new FakeAuthPort(null);
    port.requestPasswordReset.mockResolvedValueOnce(fail(code));
    const { user } = renderApp({ port, path: '/forgot-password' });

    await user.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  });
});
