import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScoreView } from './ScoreView';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <ScoreView />
  </StrictMode>,
);
