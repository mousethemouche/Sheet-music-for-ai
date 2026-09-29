import { Button } from '@sheet-music/ui/components/button';
import { useState, type FormEvent, type JSX } from 'react';
import { Link } from 'react-router';
import { STANDALONE_LINK } from '../shell/classes';
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
          <Button asChild size="block">
            <Link to="/login">Back to sign in</Link>
          </Button>
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
          <Link className={STANDALONE_LINK} to="/login">
            Back to sign in
          </Link>
        </p>
      }
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
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
        <Button type="submit" variant="default" size="block" disabled={pending}>
          {pending ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthCard>
  );
}
