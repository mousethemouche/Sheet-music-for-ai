import type { JSX } from 'react';

/**
 * Shell of the MCP Apps View. The host bridge, payload parsing and the shared
 * ScorePlayer are wired in #11 (see docs/testing/MCP_UI_TEST_PROCESS.md).
 */
export function ScoreView(): JSX.Element {
  return (
    <main>
      <h1>Sheet Music for AI</h1>
    </main>
  );
}
