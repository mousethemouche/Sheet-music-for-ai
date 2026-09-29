import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { readApiConfig } from './api/config';
import { createScoresApi } from './api/scoresApi';
import { App } from './App';
import { createPrivateStateRegistry } from './auth/privateState';
import { createSupabaseWebAuth } from './auth/supabaseAuthAdapter';
import { readWebAuthConfig } from './config';
import { createBrowserPlayer } from './player/browserPlayer';
import { ConfigurationErrorPage } from './shell/ConfigurationErrorPage';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}
const root = createRoot(container);

const config = readWebAuthConfig(import.meta.env);
const apiConfig = readApiConfig(import.meta.env);
if (!config.ok) {
  root.render(<ConfigurationErrorPage problem={config.problem} />);
} else if (!apiConfig.ok) {
  root.render(<ConfigurationErrorPage problem={apiConfig.problem} />);
} else {
  // Created once per page load, before rendering: the adapter must see the
  // emailed-link parameters before the client removes them from the URL.
  const auth = createSupabaseWebAuth(config.config, window.location);
  const privateState = createPrivateStateRegistry();
  // Also created once: every ScorePlayer receives the same ports object.
  const library = {
    scores: createScoresApi({
      baseUrl: apiConfig.config.baseUrl,
      getAccessToken: () => auth.getAccessToken(),
    }),
    player: createBrowserPlayer({
      href: window.location.href,
      basePath: import.meta.env.BASE_URL,
    }),
  };
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App
          auth={auth}
          privateState={privateState}
          leaveApp={(url) => window.location.assign(url)}
          library={library}
        />
      </BrowserRouter>
    </StrictMode>,
  );
}
