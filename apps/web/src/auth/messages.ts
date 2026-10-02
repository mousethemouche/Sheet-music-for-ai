import type { AuthErrorCode } from './authPort';

/**
 * Fixed user-facing messages. Provider messages are never shown: they can
 * reveal configuration details or whether an account exists.
 */
const MESSAGES: Record<AuthErrorCode, string> = {
  'invalid-credentials': 'Incorrect email or password.',
  'email-not-confirmed':
    'Confirm your email address first: open the link we sent you, then sign in.',
  'invalid-email': 'Enter a valid email address.',
  'weak-password': 'Choose a stronger password.',
  'same-password': 'Choose a password different from your current one.',
  'session-missing': 'Your session has ended. Sign in again.',
  'not-found': 'We could not find what you asked for.',
  'rate-limited': 'Too many attempts. Wait a few minutes, then try again.',
  network: 'We could not reach the server. Check your connection and try again.',
  unavailable: 'The service is temporarily unavailable. Try again later.',
  unknown: 'Something went wrong. Try again.',
};

export function authErrorMessage(code: AuthErrorCode): string {
  return MESSAGES[code];
}

export function linkErrorMessage(reason: 'expired' | 'invalid'): string {
  return reason === 'expired'
    ? 'This email link has expired. Sign in, or ask for a new link.'
    : 'This email link is invalid or was already used. Sign in, or ask for a new link.';
}

/** Client-side floor; the provider's password policy still applies. */
export const MIN_PASSWORD_LENGTH = 8;
