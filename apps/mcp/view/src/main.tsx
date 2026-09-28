import { App } from '@modelcontextprotocol/ext-apps';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { connectToHost } from './host-bridge';
import { ScoreView } from './ScoreView';
import { createViewStore } from './view-state';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

const store = createViewStore();
// The iframe lives as long as its tool call; the host tears it down.
connectToHost(
  new App({ name: 'sheet-music-score-view', version: '0.0.0' }, {}, { autoResize: true }),
  store,
  container,
);

createRoot(container).render(
  <StrictMode>
    <ScoreView store={store} />
  </StrictMode>,
);
