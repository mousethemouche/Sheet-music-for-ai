/**
 * Composition root of the MCP Apps View (docs/architecture/MCP_VIEW.md):
 * the host bridge, the View store and the shared ScorePlayer with its
 * concrete renderer and engine.
 */
import { App } from '@modelcontextprotocol/ext-apps';
import { ScorePlayer } from '@sheet-music/score-ui';
import { type JSX, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readAssetOrigin } from './asset-origin';
import { connectToHost } from './host-bridge';
import { createPlayerPorts, playbackAssetUrls } from './player-ports';
import type { ScoreMountProps } from './score-mount';
import { ScoreView } from './ScoreView';
import { SoundCredits } from './SoundCredits';
import { INITIAL_VIEW_STATE, createViewStore } from './view-state';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

const assetOrigin = readAssetOrigin(document);
const assets = assetOrigin === null ? null : playbackAssetUrls(assetOrigin);
const ports = createPlayerPorts(assets);
// autoResize is started by connectToHost after the handshake (it must stop it on teardown).
const app = new App(
  { name: 'sheet-music-score-view', version: '0.0.0' },
  {},
  { autoResize: false },
);
const openLink = (url: string): void => {
  app.openLink({ url }).catch(() => undefined);
};

function PlayerMount({ artifact, theme }: ScoreMountProps): JSX.Element {
  return (
    <>
      <ScorePlayer artifact={artifact} ports={ports} theme={theme} />
      <SoundCredits licenseUrl={assets?.licenseUrl ?? null} openLink={openLink} />
    </>
  );
}

// Until the host sends its theme, follow the system's.
const store = createViewStore({
  ...INITIAL_VIEW_STATE,
  theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
});
// The iframe lives as long as its tool call; the host tears it down.
connectToHost(app, store, container);

createRoot(container).render(
  <StrictMode>
    <ScoreView store={store} ScoreMount={PlayerMount} />
  </StrictMode>,
);
