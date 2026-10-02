import { Button } from '@sheet-music/ui/components/button';
import { Empty, EmptyContent, EmptyMedia } from '@sheet-music/ui/components/empty';
import { useState, type JSX } from 'react';
import { Link } from 'react-router';
import type { ApiFailure, ApiFailureKind } from '../api/scoresApi';
import { useAuth } from '../auth/AuthProvider';
import { usePendingAction } from '../auth/forms';
import { authErrorMessage } from '../auth/messages';
import { CODE } from '../shell/classes';
import { Icon } from '../shell/icons';

/** What failed to load: the library list or one saved score. */
export type FailedResource = 'library' | 'score';

/**
 * A failed API request, with the action that recovers from it: sign in again
 * (401), go back to the library (404 on a score), or try again (outages).
 * Messages are fixed; nothing from the response body is shown except the
 * correlation ID, as a support reference. Drawn as a centered state, like the
 * empty and no-match states: icon, the message as its title, one action.
 */
export function ApiFailureAlert(props: {
  error: ApiFailure;
  resource: FailedResource;
  onRetry: () => void;
  className?: string;
}): JSX.Element {
  const { error, resource, onRetry } = props;
  return (
    <Empty role="alert" variant="bordered" className={props.className}>
      <EmptyMedia variant="danger" aria-hidden="true">
        <Icon name="alert-circle" />
      </EmptyMedia>
      {/* The message is the state's title: body color, not red. */}
      <p className="max-w-[46ch] text-md font-semibold text-foreground">
        {failureMessage(error.kind, resource)}
      </p>
      {error.kind === 'unauthenticated' && <SignInAgain />}
      {error.kind === 'not-found' && resource === 'score' && (
        <EmptyContent>
          <Button asChild>
            <Link to="/library">Back to your library</Link>
          </Button>
        </EmptyContent>
      )}
      {retryable(error.kind, resource) && (
        <EmptyContent>
          <Button onClick={onRetry}>Try again</Button>
        </EmptyContent>
      )}
      {error.correlationId !== null && (
        <p className="text-xs">
          Reference: <code className={CODE}>{error.correlationId}</code>
        </p>
      )}
    </Empty>
  );
}

function failureMessage(kind: ApiFailureKind, resource: FailedResource): string {
  switch (kind) {
    case 'unauthenticated':
      return 'Your session has expired. Sign in again to continue.';
    case 'not-found':
      return resource === 'score'
        ? 'This score is not in your library. The link may be wrong, or the score belongs to another account.'
        : 'Your library could not be loaded.';
    case 'unavailable':
      return 'The library is temporarily unavailable. Nothing was lost: try again in a moment.';
    case 'rate-limited':
      return 'Too many requests. Wait a moment, then try again.';
    case 'rejected':
      return resource === 'library'
        ? 'This search cannot be run. Shorten the text or remove some tag filters.'
        : 'This score cannot be opened.';
    case 'failed':
      return resource === 'library'
        ? 'Your library could not be loaded.'
        : 'This score could not be opened.';
  }
}

function retryable(kind: ApiFailureKind, resource: FailedResource): boolean {
  switch (kind) {
    case 'unavailable':
    case 'rate-limited':
    case 'failed':
      return true;
    case 'not-found':
      return resource === 'library';
    case 'unauthenticated':
    case 'rejected':
      return false;
  }
}

/**
 * The API refused the session's token, so a new sign-in is needed. Ending the
 * local session first matters: the sign-in page sends a signed-in visitor
 * straight back. Once signed out, the route guard redirects to sign-in with
 * this page as the return path.
 */
function SignInAgain(): JSX.Element {
  const { signOut } = useAuth();
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const onClick = () =>
    void run(async () => {
      setError(null);
      const result = await signOut();
      if (!result.ok) setError(authErrorMessage(result.error));
    });
  return (
    <EmptyContent className="flex-col items-center">
      <Button disabled={pending} onClick={onClick}>
        Sign in again
      </Button>
      {error !== null && <p className="text-sm font-medium text-destructive-text"> {error}</p>}
    </EmptyContent>
  );
}
