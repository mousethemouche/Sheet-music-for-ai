import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { createPrivateStateRegistry } from './auth/privateState';
import { createSupabaseWebAuth } from './auth/supabaseAuthAdapter';
import { readWebAuthConfig } from './config';
import { ConfigurationErrorPage } from './shell/ConfigurationErrorPage';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}
const root = createRoot(container);

const config = readWebAuthConfig(import.meta.env);
if (config.ok) {
  // Created once per page load, before rendering: the adapter must see the
  // emailed-link parameters before the client removes them from the URL.
  const auth = createSupabaseWebAuth(config.config, window.location);
  const privateState = createPrivateStateRegistry();
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App
          auth={auth}
          privateState={privateState}
          leaveApp={(url) => window.location.assign(url)}
        />
      </BrowserRouter>
    </StrictMode>,
  );
} else {
  root.render(<ConfigurationErrorPage problem={config.problem} />);
}
