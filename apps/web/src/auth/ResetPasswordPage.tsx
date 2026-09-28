import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { Link } from 'react-router';
import type { AuthRedirectResult } from './authPort';
import { useAuth } from './AuthProvider';
import { FormError, TextField, newPasswordError, usePendingAction } from './forms';
import { authErrorMessage } from './messages';

type Phase = 'checking' | 'ready' | 'expired' | 'invalid' | 'done';

interface FieldErrors {
  password?: string | undefined;
  confirmation?: string | undefined;
}

/**
 * Target of the emailed recovery link. The form is offered only when this page
 * load came from a valid recovery link; an expired or invalid link, or a
 * recovery session that ended meanwhile, leads to requesting a new link.
 */
export function ResetPasswordPage(): JSX.Element {
  const { port } = useAuth();
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = usePendingAction();

  useEffect(() => {
    let active = true;
    void port.getRedirectResult().then((result) => {
      if (active) setPhase(phaseFor(result));
    });
    return () => {
      active = false;
    };
  }, [port]);

  if (phase === 'checking') return <p role="status">Checking your reset link…</p>;

  if (phase === 'expired' || phase === 'invalid') {
    return (
      <section aria-labelledby="reset-title">
        <h1 id="reset-title">
          {phase === 'expired' ? 'Reset link expired' : 'Reset link not valid'}
        </h1>
        <p role="alert">
          {phase === 'expired'
            ? 'This password reset link has expired.'
            : 'This password reset link is invalid or was already used.'}{' '}
          Ask for a new one to choose your password.
        </p>
        <p>
          <Link to="/forgot-password">Send a new reset link</Link>
        </p>
      </section>
    );
  }

  if (phase === 'done') {
    return (
      <section aria-labelledby="reset-title">
        <h1 id="reset-title">Password changed</h1>
        <p role="status">Your password has been changed.</p>
        <p>
          <Link to="/library">Continue to your library</Link>
        </p>
      </section>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const errors: FieldErrors = {
      password: newPasswordError(password),
      confirmation: confirmation === password ? undefined : 'The passwords do not match.',
    };
    setFieldErrors(errors);
    if (errors.password || errors.confirmation) return;
    void run(async () => {
      setError(null);
      const result = await port.updatePassword(password);
      if (result.ok) setPhase('done');
      else if (result.error === 'session-missing') setPhase('expired');
      else setError(authErrorMessage(result.error));
    });
  };

  return (
    <section aria-labelledby="reset-title">
      <h1 id="reset-title">Choose a new password</h1>
      <form noValidate onSubmit={submit}>
        <TextField
          label="New password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
        />
        <TextField
          label="Confirm new password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={setConfirmation}
          error={fieldErrors.confirmation}
        />
        <FormError message={error} />
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}

function phaseFor(result: AuthRedirectResult): Phase {
  if (result.kind === 'password-recovery') return 'ready';
  return result.kind === 'link-error' && result.reason === 'expired' ? 'expired' : 'invalid';
}
