import { useCallback, useId, useRef, useState, type JSX } from 'react';
import { Alert } from '../shell/Alert';
import { MIN_PASSWORD_LENGTH } from './messages';

/** Labelled input whose validation message is announced and linked to it. */
export function TextField(props: {
  label: string;
  name: string;
  type: 'email' | 'password';
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
}): JSX.Element {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="ui-field">
      <label htmlFor={id} className="ui-label">
        {props.label}
      </label>
      <input
        id={id}
        className="ui-input"
        name={props.name}
        type={props.type}
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? errorId : undefined}
      />
      {props.error && (
        <span id={errorId} role="alert" className="ui-error-text">
          {props.error}
        </span>
      )}
    </div>
  );
}

export function FormError(props: { message: string | null }): JSX.Element | null {
  return props.message ? <Alert tone="error">{props.message}</Alert> : null;
}

/**
 * Runs one submission at a time: calls made while one is in flight are
 * dropped, even before React re-renders the disabled button.
 */
export function usePendingAction(): {
  pending: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
} {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);
  return { pending, run };
}

/** Required-and-plausible check only; the provider decides what it accepts. */
export function emailError(address: string): string | undefined {
  if (!address) return 'Enter your email address.';
  return /^[^\s@]+@[^\s@]+$/.test(address) ? undefined : 'Enter a valid email address.';
}

export function newPasswordError(password: string): string | undefined {
  if (!password) return 'Enter a password.';
  return password.length < MIN_PASSWORD_LENGTH
    ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    : undefined;
}
