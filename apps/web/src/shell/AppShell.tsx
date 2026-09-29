import { Button } from '@sheet-music/ui/components/button';
import { cn } from '@sheet-music/ui/lib/utils';
import { useState, type JSX } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { usePendingAction } from '../auth/forms';
import { authErrorMessage } from '../auth/messages';
import { Alert } from './Alert';
import { CONTAINER, TEXT_LINK } from './classes';

/** A failed account action, shown on the page where it happened. */
interface AccountError {
  readonly path: string;
  readonly message: string;
}

/** App frame: product name, account navigation, the current page and the credits link. */
export function AppShell(): JSX.Element {
  const { pathname } = useLocation();
  const [accountError, setAccountError] = useState<AccountError | null>(null);
  const onAccountError = (message: string | null) =>
    setAccountError(message === null ? null : { path: pathname, message });
  return (
    <>
      <header className="sticky top-0 z-10 h-14 flex-none border-b bg-header backdrop-blur-[8px] backdrop-saturate-[1.8]">
        <div className={cn(CONTAINER, 'flex h-full items-center gap-4')}>
          <Link
            to="/"
            className="inline-flex min-h-10 items-center gap-2 rounded-md font-semibold tracking-tight whitespace-nowrap"
          >
            <span
              className="inline-grid size-6 place-items-center rounded-md bg-primary text-[15px] leading-none text-primary-foreground"
              aria-hidden="true"
            >
              ♪
            </span>
            Sheet Music for AI
          </Link>
          <AccountNav onError={onAccountError} />
        </div>
      </header>
      <main className="flex-[1_0_auto] pt-8 pb-12">
        <div className={CONTAINER}>
          {/* In the flow above the page, never over it; it stays with the page it belongs to. */}
          {accountError !== null && accountError.path === pathname && (
            <Alert tone="error" className="mb-6" onDismiss={() => setAccountError(null)}>
              {accountError.message}
            </Alert>
          )}
          <Outlet />
        </div>
      </main>
      <footer className="flex-none border-t py-6 text-sm text-muted-foreground">
        <div className={CONTAINER}>
          <Link
            to="/about"
            className={cn(
              TEXT_LINK,
              // Touch screens: a 40 px tall target that takes no more room in the flow.
              'hover:text-foreground max-sm:-my-3 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center',
            )}
          >
            About and credits
          </Link>
        </div>
      </footer>
    </>
  );
}

function AccountNav(props: { onError: (message: string | null) => void }): JSX.Element | null {
  const { onError } = props;
  const { state, signOut } = useAuth();
  const navigate = useNavigate();
  const { pending, run } = usePendingAction();
  // A saved score belongs to the Library section (the link is not the current page).
  const inScore = useMatch('/scores/:scoreId') !== null;
  // Pages that already show the account's email, or the header's own action.
  const onLibrary = useMatch('/library') !== null;
  const onConsent = useMatch('/oauth/consent') !== null;
  const onSignIn = useMatch('/login') !== null;
  const onSignUp = useMatch('/signup') !== null;

  if (state.status === 'restoring') return null;
  if (state.status === 'signed-out') {
    const both = !onSignIn && !onSignUp;
    return (
      <nav aria-label="Account" className={NAV}>
        <div className={HEADER_END}>
          {!onSignIn && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Sign in</Link>
            </Button>
          )}
          {!onSignUp && (
            <Button
              asChild
              size="sm"
              // Phones: the sign-in page links to account creation; the brand keeps its room.
              className={both ? 'max-[440px]:hidden' : undefined}
            >
              <Link to="/signup">Create account</Link>
            </Button>
          )}
        </div>
      </nav>
    );
  }

  const onSignOut = () =>
    void run(async () => {
      onError(null);
      const result = await signOut();
      if (result.ok) await navigate('/login', { replace: true });
      else onError(authErrorMessage(result.error));
    });

  return (
    <nav aria-label="Account" className={NAV}>
      <NavLink
        to="/library"
        // A saved score belongs to the Library section: same look as the current page.
        className={cn(NAV_LINK, inScore && 'bg-muted text-foreground')}
      >
        Library
      </NavLink>
      <div className={HEADER_END}>
        {!onLibrary && !onConsent && (
          <span className="hidden max-w-[28ch] truncate text-sm text-muted-foreground min-[561px]:block">
            {state.user.email}
          </span>
        )}
        <Button size="sm" disabled={pending} onClick={onSignOut}>
          {pending ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </nav>
  );
}

/** The one "Account" nav: Library next to the brand, the account at the end. */
const NAV = 'flex min-w-0 flex-auto items-center gap-1';

const HEADER_END = 'ml-auto flex min-w-0 items-center gap-3';

/** 32 px (40 px on phones); react-router's NavLink sets aria-current="page" on the current page. */
const NAV_LINK =
  'inline-flex h-10 items-center rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors duration-120 ease-standard hover:bg-accent hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground sm:h-8';
