/**
 * View wiring (#11): the decisions the View makes around the shared
 * ScorePlayer, driven through the real ext-apps App and the official
 * AppBridge (host side) over an in-memory transport. The real iframe,
 * postMessage, CSP and bundled player are MCP-UI-01..03; the player's own
 * behavior is score-ui (UI-01..05).
 *
 * - The host theme reaches the player and the document's token class
 *   (`.light` / `.dark`, which theme.css keys its tokens and color scheme
 *   on), and both follow host context changes.
 * - A newer revision reaches the SAME mounted player (P-01 is applied by
 *   score-ui inside one instance; a remount would lose the local tempo and
 *   loop settings and still look like P-01 from outside).
 * - Teardown releases the player (its effect cleanup, where ScorePlayer
 *   destroys its engine and renderer) before the host gets the answer, stops
 *   the size observer and stops listening to the host.
 * - The asset origin is read from the server-injected meta tag; without one
 *   the engine fails its load without any request.
 */
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { App, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { compilePlaybackPlan } from '@sheet-music/playback-core';
import { F01, parseFixture } from '@sheet-music/test-fixtures';
import { act, render, screen, waitFor } from '@testing-library/react';
import { type JSX, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSET_ORIGIN_META_NAME, readAssetOrigin } from '../src/asset-origin';
import { connectToHost } from '../src/host-bridge';
import { createPlayerPorts } from '../src/player-ports';
import type { ScoreMountProps } from '../src/score-mount';
import { ScoreView } from '../src/ScoreView';
import { createViewStore } from '../src/view-state';
import {
  FIXTURE_ID,
  FIXTURE_REVISION,
  draftArtifactJson,
  revisionArtifactJson,
  successResult,
} from './support/tool-results';

type ToolResult = Parameters<AppBridge['sendToolResult']>[0];

/** jsdom has no ResizeObserver; the App's size notifications need one. */
class RecordingResizeObserver {
  static readonly instances: RecordingResizeObserver[] = [];
  observing = 0;
  disconnected = false;
  constructor() {
    RecordingResizeObserver.instances.push(this);
  }
  observe(): void {
    this.observing += 1;
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
}

beforeEach(() => {
  RecordingResizeObserver.instances.length = 0;
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openView(hostContext: McpUiHostContext) {
  const events: string[] = [];
  const mounts: ScoreMountProps[] = [];
  let mountCount = 0;
  function RecordingMount(props: ScoreMountProps): JSX.Element {
    mounts.push(props);
    useEffect(() => {
      mountCount += 1;
      return () => {
        events.push('player released');
      };
    }, []);
    return <p>player</p>;
  }

  const [hostSide, viewSide] = InMemoryTransport.createLinkedPair();
  const send = viewSide.send.bind(viewSide);
  viewSide.send = (message: JSONRPCMessage, options) => {
    if ('result' in message) {
      events.push('answer sent');
    }
    return send(message, options);
  };
  const bridge = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {}, { hostContext });
  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve();
  });
  await bridge.connect(hostSide);

  const store = createViewStore();
  render(<ScoreView store={store} ScoreMount={RecordingMount} />);
  const app = new App({ name: 'view-under-test', version: '0.0.0' }, {}, { autoResize: false });
  connectToHost(app, store, document.createElement('div'), viewSide);
  await initialized;
  await waitFor(() => {
    expect(screen.getByTestId('score-view')).toHaveAttribute('data-connection', 'connected');
  });

  return {
    bridge,
    events,
    mounts,
    mountCount: () => mountCount,
    deliver: async (result: unknown, revision: number): Promise<void> => {
      await act(() => bridge.sendToolResult(result as ToolResult));
      await waitFor(() => {
        expect(screen.getByTestId('score-mount')).toHaveAttribute(
          'data-revision',
          String(revision),
        );
      });
    },
  };
}

describe('MCP View wiring: host theme', () => {
  it('draws the score in the host theme and follows a theme change', async () => {
    const html = document.documentElement;
    // As main.tsx leaves it on a light system, before the host's context arrives.
    html.className = 'light';
    const view = await openView({ theme: 'dark' });
    await view.deliver(successResult(draftArtifactJson()), FIXTURE_REVISION);
    expect(view.mounts.at(-1)?.theme).toBe('dark');
    expect([...html.classList]).toEqual(['dark']);

    act(() => view.bridge.setHostContext({ theme: 'light' }));

    await waitFor(() => {
      expect(screen.getByTestId('score-mount')).toHaveAttribute('data-theme', 'light');
    });
    expect(view.mounts.at(-1)?.theme).toBe('light');
    expect(html.dataset['theme']).toBe('light');
    expect([...html.classList]).toEqual(['light']);
  });
});

describe('MCP View wiring: revisions', () => {
  it('hands a newer revision to the same mounted player', async () => {
    const view = await openView({ theme: 'light' });
    await view.deliver(successResult(draftArtifactJson()), FIXTURE_REVISION);
    await view.deliver(
      successResult(revisionArtifactJson(FIXTURE_REVISION + 1)),
      FIXTURE_REVISION + 1,
    );

    expect(view.mountCount()).toBe(1);
    expect(view.events).toEqual([]);
    expect(view.mounts.at(-1)?.artifact).toMatchObject({
      scoreId: FIXTURE_ID,
      revision: FIXTURE_REVISION + 1,
    });
  });
});

describe('MCP View wiring: teardown', () => {
  it('releases the player before answering, then stops observing and listening', async () => {
    const view = await openView({ theme: 'light' });
    await view.deliver(successResult(draftArtifactJson()), FIXTURE_REVISION);
    expect(RecordingResizeObserver.instances.some(({ observing }) => observing > 0)).toBe(true);

    await act(() => view.bridge.teardownResource({}));

    expect(view.events).toEqual(['player released', 'answer sent']);
    expect(screen.queryByTestId('score-mount')).toBeNull();
    expect(screen.getByTestId('score-view')).toHaveAttribute('data-connection', 'closed');
    expect(RecordingResizeObserver.instances.every(({ disconnected }) => disconnected)).toBe(true);

    await act(() =>
      view.bridge.sendToolResult(
        successResult(revisionArtifactJson(FIXTURE_REVISION + 1)) as ToolResult,
      ),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByTestId('score-mount')).toBeNull();
    expect(view.mounts.at(-1)?.artifact.revision).toBe(FIXTURE_REVISION);
  });
});

describe('MCP View wiring: asset origin', () => {
  function documentWith(meta: string): Document {
    return new DOMParser().parseFromString(`<head>${meta}</head>`, 'text/html');
  }

  it.each([
    { content: 'https://mcp.example.com', origin: 'https://mcp.example.com' },
    { content: 'https://mcp.example.com:8443/', origin: 'https://mcp.example.com:8443' },
    { content: 'http://127.0.0.1:3001', origin: 'http://127.0.0.1:3001' },
    { content: '', origin: null },
    { content: 'not a url', origin: null },
    { content: 'javascript:alert(1)', origin: null },
    { content: 'data:text/plain,x', origin: null },
  ])('reads "$content" as $origin', ({ content, origin }) => {
    const doc = documentWith(`<meta name="${ASSET_ORIGIN_META_NAME}" content="${content}">`);
    expect(readAssetOrigin(doc)).toBe(origin);
  });

  it('reads a document without the meta tag as no origin', () => {
    expect(readAssetOrigin(documentWith(''))).toBeNull();
  });

  it('fails every load without a request when no origin is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const engine = createPlayerPorts(null).createPlaybackEngine();

    await expect(engine.load(compilePlaybackPlan(parseFixture(F01)))).rejects.toMatchObject({
      code: 'ASSET_LOAD_FAILED',
    });
    expect(engine.getSnapshot().state).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
    engine.destroy();
  });
});
