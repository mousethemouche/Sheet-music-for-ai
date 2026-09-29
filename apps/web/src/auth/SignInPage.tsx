import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { Alert } from '../shell/Alert';
import { AuthCard } from './AuthCard';
import type { AuthRedirectResult } from './authPort';
import { useAuth } from './AuthProvider';
import { FormError, TextField, emailError, usePendingAction } from './forms';
import { authErrorMessage, linkErrorMessage } from './messages';
import { safeReturnPath, withReturnPath } from './redirects';
import { SessionRestoring } from './RequireAuth';

interface FieldErrors {
  email?: string | undefined;
  password?: string | undefined;
}

export function SignInPage(): JSX.Element {
  const { state, port } = useAuth();
  const [searchParams] = useSearchParams();
  const returnPath = safeReturnPath(searchParams.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const linkError = useLinkError();
  const { pending, run } = usePendingAction();

  if (state.status === 'restoring') return <SessionRestoring />;
  if (state.status === 'signed-in') return <Navigate replace to={returnPath} />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    const errors: FieldErrors = {
      email: emailError(address),
      password: password ? undefined : 'Enter your password.',
    };
    setFieldErrors(errors);
    if (errors.email || errors.password) return;
    void run(async () => {
      setError(null);
      const result = await port.signIn({ email: address, password });
      // Success needs no navigation here: the session change re-renders this
      // page as a redirect to the return path.
      if (!result.ok) setError(authErrorMessage(result.error));
    });
  };

  return (
    <AuthCard
      titleId="sign-in-title"
      title="Sign in"
      subtitle="Open your library of saved scores."
      links={
        <>
          <p>
            <Link className="ui-link" to="/forgot-password">
              Forgot your password?
            </Link>
          </p>
          <p>
            No account yet?{' '}
            <Link className="ui-link" to={withReturnPath('/signup', returnPath)}>
              Create an account
            </Link>
          </p>
        </>
      }
    >
      {linkError && <Alert tone="error">{linkError}</Alert>}
      <form noValidate onSubmit={submit} className="ui-form">
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
        />
        <FormError message={error} />
        <button
          type="submit"
          className="ui-button ui-button--primary ui-button--block"
          disabled={pending}
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  );
}

/** Emailed confirmation links return to sign-in; an expired or used link is explained there. */
function useLinkError(): string | null {
  const { port } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void port.getRedirectResult().then((result: AuthRedirectResult) => {
      if (active && result.kind === 'link-error') setMessage(linkErrorMessage(result.reason));
    });
    return () => {
      active = false;
    };
  }, [port]);
  return message;
}
