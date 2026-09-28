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
import type { ViewStore } from './view-state';

const px = (value: number | undefined): string => (value === undefined ? '' : `${value}px`);

/**
 * Applies the host context the View uses: theme, host style variables and
 * fonts, display mode, and the container size (fixed or maximum width/height).
 */
export function applyHostContext(context: McpUiHostContext, root: HTMLElement): void {
  if (context.theme !== undefined) {
    applyDocumentTheme(context.theme);
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

/** Connects the View to its host; returns the disconnect function. */
export function connectToHost(app: App, store: ViewStore, root: HTMLElement): () => void {
  const onToolResult = (result: unknown): void => store.dispatch({ type: 'tool-result', result });
  const onToolCancelled = (): void => store.dispatch({ type: 'tool-cancelled' });
  const onHostContext = (): void => {
    const context = app.getHostContext();
    if (context !== undefined) {
      applyHostContext(context, root);
    }
  };
  app.addEventListener('toolresult', onToolResult);
  app.addEventListener('toolcancelled', onToolCancelled);
  app.addEventListener('hostcontextchanged', onHostContext);
  // Unmounting the score stops its audio before the host removes the iframe.
  app.onteardown = () => {
    store.dispatch({ type: 'teardown' });
    return {};
  };

  app.connect().then(
    () => {
      onHostContext();
      store.dispatch({ type: 'connected' });
    },
    () => store.dispatch({ type: 'connection-failed' }),
  );

  return () => {
    app.removeEventListener('toolresult', onToolResult);
    app.removeEventListener('toolcancelled', onToolCancelled);
    app.removeEventListener('hostcontextchanged', onHostContext);
    void app.close();
  };
}
