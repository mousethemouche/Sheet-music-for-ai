import type { JSX } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import type { AuthPort } from './auth/authPort';
import { AuthProvider } from './auth/AuthProvider';
import { ForgotPasswordPage } from './auth/ForgotPasswordPage';
import { OAuthConsentPage, type LeaveApp } from './auth/OAuthConsentPage';
import type { PrivateStateRegistry } from './auth/privateState';
import { DEFAULT_RETURN_PATH } from './auth/redirects';
import { RequireAuth } from './auth/RequireAuth';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { SignInPage } from './auth/SignInPage';
import { SignUpPage } from './auth/SignUpPage';
import { LibraryPage } from './library/LibraryPage';
import { ScorePage } from './library/ScorePage';
import type { LibraryServices } from './library/services';
import { CreditsPage } from './player/CreditsPage';
import { AppShell } from './shell/AppShell';
import { NotFoundPage } from './shell/NotFoundPage';

export interface AppProps {
  readonly auth: AuthPort;
  readonly privateState: PrivateStateRegistry;
  readonly leaveApp: LeaveApp;
  /** Saved-library API client and shared player (real adapters in main.tsx, fakes in tests). */
  readonly library: LibraryServices;
}

/**
 * Standalone web app: routes and session. The caller provides the router
 * (BrowserRouter in main.tsx, MemoryRouter in tests). The saved-score library
 * (#15) and the shared ScorePlayer (#7) are composed here.
 */
export function App(props: AppProps): JSX.Element {
  return (
    <AuthProvider port={props.auth} privateState={props.privateState}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate replace to={DEFAULT_RETURN_PATH} />} />
          <Route path="login" element={<SignInPage />} />
          <Route path="signup" element={<SignUpPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="about" element={<CreditsPage credits={props.library.player.credits} />} />
          <Route element={<RequireAuth />}>
            <Route path="library" element={<LibraryPage scores={props.library.scores} />} />
            <Route
              path="scores/:scoreId"
              element={<ScorePage scores={props.library.scores} player={props.library.player} />}
            />
            <Route path="oauth/consent" element={<OAuthConsentPage leaveApp={props.leaveApp} />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
