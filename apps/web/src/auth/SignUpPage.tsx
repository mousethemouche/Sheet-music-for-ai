import { useState, type FormEvent, type JSX } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useAuth } from './AuthProvider';
import { FormError, TextField, emailError, newPasswordError, usePendingAction } from './forms';
import { authErrorMessage } from './messages';
import { safeReturnPath, withReturnPath } from './redirects';
import { SessionRestoring } from './RequireAuth';

interface FieldErrors {
  email?: string | undefined;
  password?: string | undefined;
}

export function SignUpPage(): JSX.Element {
  const { state, port } = useAuth();
  const [searchParams] = useSearchParams();
  const returnPath = safeReturnPath(searchParams.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  const { pending, run } = usePendingAction();

  if (state.status === 'restoring') return <SessionRestoring />;
  if (state.status === 'signed-in') return <Navigate replace to={returnPath} />;

  if (confirmationSentTo) {
    // Not a session: the account is usable only after the emailed link is opened.
    return (
      <section aria-labelledby="sign-up-title">
        <h1 id="sign-up-title">Check your email</h1>
        <p role="status">
          We sent a confirmation link to {confirmationSentTo}. Open it to activate your account,
          then sign in.
        </p>
        <p>
          <Link to={withReturnPath('/login', returnPath)}>Go to sign in</Link>
        </p>
      </section>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    const errors: FieldErrors = {
      email: emailError(address),
      password: newPasswordError(password),
    };
    setFieldErrors(errors);
    if (errors.email || errors.password) return;
    void run(async () => {
      setError(null);
      const result = await port.signUp({
        email: address,
        password,
        // The emailed link signs the user in on the sign-in page, which then
        // continues to the return path (for example a pending OAuth consent).
        confirmationPath: withReturnPath('/login', returnPath),
      });
      if (!result.ok) setError(authErrorMessage(result.error));
      else if (result.value === 'confirmation-required') setConfirmationSentTo(address);
    });
  };

  return (
    <section aria-labelledby="sign-up-title">
      <h1 id="sign-up-title">Create an account</h1>
      <form noValidate onSubmit={submit}>
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
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
        />
        <FormError message={error} />
        <button type="submit" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p>
        Already have an account? <Link to={withReturnPath('/login', returnPath)}>Sign in</Link>
      </p>
    </section>
  );
}
