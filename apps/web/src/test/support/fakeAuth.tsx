/**
 * Test double of the neutral AuthPort, behaving like the provider where the UI
 * depends on it: a successful sign-in pushes `signed-in` before resolving and
 * sign-out pushes `signed-out`. Every method is a vi.fn, so a test can replace
 * one answer (for example with a pending promise) without re-implementing it.
 */
import { render, screen, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { JSX } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi, type Mock } from 'vitest';
import { App } from '../../App';
import type {
  AuthChange,
  AuthErrorCode,
  AuthPort,
  AuthRedirectResult,
  AuthResult,
  AuthSession,
  AuthUser,
} from '../../auth/authPort';
import type { LeaveApp } from '../../auth/OAuthConsentPage';
import { createPrivateStateRegistry, type PrivateStateRegistry } from '../../auth/privateState';

export const ALICE: AuthUser = { id: 'user-a', email: 'alice@example.com' };
export const BOB: AuthUser = { id: 'user-b', email: 'bob@example.com' };
export const PASSWORD = 'correct horse battery';

export const ok = <T,>(value: T): AuthResult<T> => ({ ok: true, value });
export const fail = <T,>(error: AuthErrorCode): AuthResult<T> => ({ ok: false, error });
export const sessionOf = (user: AuthUser): AuthSession => ({ user });

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

type Listener = (change: AuthChange, session: AuthSession | null) => void;

export class FakeAuthPort implements AuthPort {
  private readonly listeners = new Set<Listener>();
  /** Accounts that `signIn` accepts with PASSWORD. */
  private readonly accounts = new Map([ALICE, BOB].map((user) => [user.email, user]));

  constructor(restored: AuthSession | null | Promise<AuthSession | null> = null) {
    this.getSession = vi.fn<AuthPort['getSession']>(() => Promise.resolve(restored));
  }

  readonly getSession: Mock<AuthPort['getSession']>;

  readonly getRedirectResult = vi.fn<AuthPort['getRedirectResult']>(() =>
    Promise.resolve<AuthRedirectResult>({ kind: 'none' }),
  );

  readonly signIn = vi.fn<AuthPort['signIn']>(({ email, password }) => {
    const user = this.accounts.get(email);
    if (!user || password !== PASSWORD) return Promise.resolve(fail('invalid-credentials'));
    this.emit('signed-in', sessionOf(user));
    return Promise.resolve(ok(undefined));
  });

  readonly signUp = vi.fn<AuthPort['signUp']>(() =>
    Promise.resolve(ok('confirmation-required' as const)),
  );

  readonly signOut = vi.fn<AuthPort['signOut']>(() => {
    this.emit('signed-out', null);
    return Promise.resolve(ok(undefined));
  });

  readonly requestPasswordReset = vi.fn<AuthPort['requestPasswordReset']>(() =>
    Promise.resolve(ok(undefined)),
  );

  readonly updatePassword = vi.fn<AuthPort['updatePassword']>(() => Promise.resolve(ok(undefined)));

  readonly getOAuthAuthorization = vi.fn<AuthPort['getOAuthAuthorization']>(() =>
    Promise.resolve(fail('not-found')),
  );

  readonly decideOAuthAuthorization = vi.fn<AuthPort['decideOAuthAuthorization']>(() =>
    Promise.resolve(fail('not-found')),
  );

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Pushes a provider session change to every subscriber. */
  emit(change: AuthChange, session: AuthSession | null): void {
    for (const listener of [...this.listeners]) listener(change, session);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}

/** Renders the whole app at `path` inside a memory router. */
export function renderApp(options: {
  port: FakeAuthPort;
  path: string;
  privateState?: PrivateStateRegistry;
}): RenderResult & { user: UserEvent; leaveApp: Mock<LeaveApp> } {
  const leaveApp = vi.fn<LeaveApp>();
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter initialEntries={[options.path]}>
      <App
        auth={options.port}
        privateState={options.privateState ?? createPrivateStateRegistry()}
        leaveApp={leaveApp}
      />
      <CurrentLocation />
    </MemoryRouter>,
  );
  return { ...view, user, leaveApp };
}

/** Exposes the router location so tests can assert where navigation ended. */
function CurrentLocation(): JSX.Element {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

/** Fills and submits the sign-in form that is currently displayed. */
export async function signInAs(user: UserEvent, account: AuthUser): Promise<void> {
  await user.type(screen.getByLabelText('Email'), account.email ?? '');
  await user.type(screen.getByLabelText('Password'), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}
