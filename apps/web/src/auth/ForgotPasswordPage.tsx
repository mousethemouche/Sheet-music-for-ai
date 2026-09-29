import { useState, type FormEvent, type JSX } from 'react';
import { Link } from 'react-router';
import { AuthCard } from './AuthCard';
import type { AuthErrorCode } from './authPort';
import { useAuth } from './AuthProvider';
import { FormError, TextField, emailError, usePendingAction } from './forms';
import { authErrorMessage } from './messages';

/** Failures that say nothing about whether an account exists. */
const REPORTED_ERRORS: ReadonlySet<AuthErrorCode> = new Set([
  'invalid-email',
  'rate-limited',
  'network',
  'unavailable',
]);

export const RESET_PASSWORD_PATH = '/reset-password';

export function ForgotPasswordPage(): JSX.Element {
  const { port } = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { pending, run } = usePendingAction();

  if (sentTo) {
    return (
      <AuthCard
        titleId="forgot-title"
        title="Check your email"
        icon={{ name: 'mail' }}
        links={
          <Link className="ui-button ui-button--secondary ui-button--block" to="/login">
            Back to sign in
          </Link>
        }
      >
        {/* Same text whether or not the address has an account: no enumeration. */}
        <p role="status">
          If an account exists for <strong>{sentTo}</strong>, we sent it a link to choose a new
          password.
        </p>
      </AuthCard>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    const problem = emailError(address);
    setFieldError(problem);
    if (problem) return;
    void run(async () => {
      setError(null);
      const result = await port.requestPasswordReset({
        email: address,
        resetPath: RESET_PASSWORD_PATH,
      });
      if (!result.ok && REPORTED_ERRORS.has(result.error)) setError(authErrorMessage(result.error));
      else setSentTo(address);
    });
  };

  return (
    <AuthCard
      titleId="forgot-title"
      title="Reset your password"
      subtitle="Enter the email address of your account. We will send you a link to choose a new password."
      links={
        <p>
          <Link className="ui-link" to="/login">
            Back to sign in
          </Link>
        </p>
      }
    >
      <form noValidate onSubmit={submit} className="ui-form">
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={fieldError}
        />
        <FormError message={error} />
        <button
          type="submit"
          className="ui-button ui-button--primary ui-button--block"
          disabled={pending}
        >
          {pending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthCard>
  );
}
