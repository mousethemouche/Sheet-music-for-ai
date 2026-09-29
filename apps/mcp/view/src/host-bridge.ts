/**
 * Wiring between the MCP Apps host (official ext-apps `App`, postMessage to
 * the parent frame) and the View store. Listeners are registered before the
 * handshake so no tool result is missed. The View calls no server tool.
 */
import {
  type App,
  type McpUiHostContext,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { flushSync } from 'react-dom';
import type { ViewStore, ViewTheme } from './view-state';

const px = (value: number | undefined): string => (value === undefined ? '' : `${value}px`);

/**
 * Selects the design tokens of `theme` for the whole document: the
 * `.light` / `.dark` class that @sheet-music/ui's theme.css keys its tokens
 * and `color-scheme` on. The iframe's color scheme must match the host's, or
 * the browser paints an opaque backdrop behind the View.
 */
export function applyThemeClass(
  theme: ViewTheme,
  element: HTMLElement = document.documentElement,
): void {
  element.classList.toggle('dark', theme === 'dark');
  element.classList.toggle('light', theme !== 'dark');
}

/**
 * Applies the host context the View uses: theme (the `data-theme` and
 * `color-scheme` of ext-apps, plus the token class), host style variables and
 * fonts, display mode, and the container size (fixed or maximum width/height).
 * The player follows the root's width (its own ResizeObserver).
 */
export function applyHostContext(context: McpUiHostContext, root: HTMLElement): void {
  if (context.theme !== undefined) {
    applyDocumentTheme(context.theme);
    applyThemeClass(context.theme);
  }
  if (context.styles?.variables !== undefined) {
    applyHostStyleVariables(context.styles.variables, root);
  }
  if (context.styles?.css?.fonts !== undefined) {
    applyHostFonts(context.styles.css.fonts);
  }
  if (context.displayMode !== undefined) {
    root.dataset['displayMode'] = context.displayMode;
  }
  const size = context.containerDimensions;
  if (size !== undefined) {
    root.style.width = px('width' in size ? size.width : undefined);
    root.style.maxWidth = px('maxWidth' in size ? size.maxWidth : undefined);
    root.style.height = px('height' in size ? size.height : undefined);
    root.style.maxHeight = px('maxHeight' in size ? size.maxHeight : undefined);
  }
}

/**
 * Connects the View to its host (default transport: postMessage to the
 * parent frame) for the lifetime of the document.
 *
 * Create the App with `autoResize: false`: the View starts the size
 * notifications itself after the handshake, because the App keeps no handle
 * to stop them and teardown must.
 *
 * Teardown (`ui/resource-teardown`): the score is unmounted synchronously,
 * so the player's engine is destroyed (audio silenced, AudioContext closed)
 * and its renderer released before the host receives the answer; then every
 * listener and the size observer are removed, so nothing the host sends
 * afterwards reaches the View. The View leaves its side of the transport
 * open: the answer must still be posted, and the host closes the bridge
 * when it removes the iframe (closing it here would also make a size
 * notification the App already scheduled for the next frame reject).
 */
export function connectToHost(
  app: App,
  store: ViewStore,
  root: HTMLElement,
  transport?: Transport,
): void {
  let stopSizeNotifications: (() => void) | undefined;
  let detached = false;

  const onToolResult = (result: unknown): void => store.dispatch({ type: 'tool-result', result });
  const onToolCancelled = (): void => store.dispatch({ type: 'tool-cancelled' });
  const onHostContext = (): void => {
    const context = app.getHostContext();
    if (context === undefined) {
      return;
    }
    applyHostContext(context, root);
    if (context.theme !== undefined) {
      store.dispatch({ type: 'host-theme', theme: context.theme });
    }
  };
  const detach = (): void => {
    if (detached) {
      return;
    }
    detached = true;
    app.removeEventListener('toolresult', onToolResult);
    app.removeEventListener('toolcancelled', onToolCancelled);
    app.removeEventListener('hostcontextchanged', onHostContext);
    stopSizeNotifications?.();
  };

  app.addEventListener('toolresult', onToolResult);
  app.addEventListener('toolcancelled', onToolCancelled);
  app.addEventListener('hostcontextchanged', onHostContext);
  app.onteardown = () => {
    flushSync(() => store.dispatch({ type: 'teardown' }));
    detach();
    return {};
  };

  app.connect(transport).then(
    () => {
      if (detached) {
        return;
      }
      stopSizeNotifications = app.setupSizeChangedNotifications();
      onHostContext();
      store.dispatch({ type: 'connected' });
    },
    () => store.dispatch({ type: 'connection-failed' }),
  );
}
