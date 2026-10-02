/**
 * Minimal MCP Apps host of the MCP-UI suite, running in the Chromium test
 * page, adapted from the pinned reference host (ext-apps 1.7.5
 * examples/basic-host, src/implementation.ts):
 *
 * - a real MCP client (pinned SDK, Streamable HTTP from the browser, bearer
 *   token of the local test issuer) discovers the tools and the `ui://`
 *   resource and calls the tools;
 * - the View resource is read with resources/read, and mounted in the
 *   sandbox proxy iframe (own origin) whose CSP is built from the resource's
 *   `_meta.ui.csp` (the host passes it as `?csp=`);
 * - the OFFICIAL AppBridge (host side) connects to it over PostMessageTransport,
 *   sends the HTML with `sendSandboxResourceReady`, and relays the real tool
 *   input and results.
 *
 * The host records sanitized bridge events (method-level facts, IDs and
 * revisions, never a token or a score document) for the assertions.
 */
import {
  AppBridge,
  type McpUiHostContext,
  type McpUiResourceCsp,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const HOST_INFO = { name: 'sheet-music-mcp-ui-test-host', version: '0.0.0' } as const;

const SANDBOX_PROXY_READY = 'ui/notifications/sandbox-proxy-ready';

/** Sanitized bridge events, in the order the host saw them. */
export type BridgeEvent =
  | { readonly type: 'initialized'; readonly app: string | undefined }
  | { readonly type: 'size-changed'; readonly width?: number; readonly height?: number }
  | { readonly type: 'open-link'; readonly url: string }
  | { readonly type: 'log'; readonly level: string }
  | { readonly type: 'request-teardown' }
  | { readonly type: 'tool-input'; readonly tool: string }
  | {
      readonly type: 'tool-result';
      readonly tool: string;
      readonly isError: boolean;
      readonly scoreId?: string;
      readonly revision?: number;
    }
  | { readonly type: 'teardown-answered' }
  | { readonly type: 'closed' };

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not happen within ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export interface McpHost {
  readonly client: Client;
  /** Errors the MCP client reported without failing a call (e.g. its optional GET stream). */
  readonly clientErrors: readonly string[];
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

/** Connects the host's MCP client (initialize + initialized) with the bearer token. */
export async function connectHost(mcpUrl: string, token: string): Promise<McpHost> {
  const client = new Client(HOST_INFO);
  const clientErrors: string[] = [];
  client.onerror = (error) => clientErrors.push(error.message);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return {
    client,
    clientErrors,
    callTool: async (name, args) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
    close: () => client.close(),
  };
}

export interface UiResource {
  readonly mimeType: string | undefined;
  readonly html: string;
  /** Content-level `_meta.ui.csp` (the listing-level one is the fallback, as in basic-host). */
  readonly csp: McpUiResourceCsp | undefined;
}

interface UiMeta {
  readonly ui?: { readonly csp?: McpUiResourceCsp };
}

/** resources/read of a `ui://` resource, the way basic-host reads it. */
export async function readUiResource(client: Client, uri: string): Promise<UiResource> {
  const { contents } = await client.readResource({ uri });
  const content = contents[0];
  if (contents.length !== 1 || content === undefined || !('text' in content)) {
    throw new Error(`Expected one text content for ${uri}`);
  }
  const listing = (await client.listResources()).resources.find((resource) => resource.uri === uri);
  const csp = (content._meta as UiMeta | undefined)?.ui?.csp ?? (listing?._meta as UiMeta)?.ui?.csp;
  return { mimeType: content.mimeType, html: content.text, csp };
}

export interface HostedView {
  readonly bridge: AppBridge;
  /** The sandbox proxy iframe (outer frame) in the host page. */
  readonly frame: HTMLIFrameElement;
  readonly events: readonly BridgeEvent[];
  /** The full host context the host last set. */
  readonly hostContext: () => McpUiHostContext;
  /** First delivery of a tool call: its complete input, then its result (MCP Apps order). */
  deliverToolCall(
    tool: string,
    args: Record<string, unknown>,
    result: CallToolResult,
  ): Promise<void>;
  /** A later result for the same View (a newer revision or a rejected edit). */
  deliverResult(tool: string, result: CallToolResult): Promise<void>;
  /** Replaces the host context; the bridge notifies the View of the changed fields. */
  setHostContext(context: McpUiHostContext): void;
  /** `ui/resource-teardown`, awaiting the View's answer. */
  teardown(): Promise<void>;
  /** Closes the bridge and removes the iframe; safe to call more than once. */
  dispose(): Promise<void>;
}

export interface MountOptions {
  readonly client: Client;
  readonly resource: UiResource;
  readonly sandboxUrl: string;
  readonly hostContext: McpUiHostContext;
  readonly width: number;
  readonly height: number;
}

function summarize(tool: string, result: CallToolResult): BridgeEvent {
  const artifact = (
    result.structuredContent as { artifact?: { scoreId?: unknown; revision?: unknown } } | undefined
  )?.artifact;
  return {
    type: 'tool-result',
    tool,
    isError: result.isError === true,
    ...(typeof artifact?.scoreId === 'string' ? { scoreId: artifact.scoreId } : {}),
    ...(typeof artifact?.revision === 'number' ? { revision: artifact.revision } : {}),
  };
}

/**
 * Loads the sandbox proxy with the resource CSP, connects the AppBridge to it,
 * sends the View HTML and resolves once the View sent `ui/notifications/initialized`.
 */
export async function mountView(options: MountOptions): Promise<HostedView> {
  const events: BridgeEvent[] = [];
  const frame = document.createElement('iframe');
  frame.setAttribute('data-testid', 'mcp-ui-sandbox');
  frame.title = 'Score view sandbox';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  frame.style.cssText = `display: block; width: ${options.width}px; height: ${options.height}px; border: 0;`;

  const proxyReady = new Promise<void>((resolve) => {
    const onMessage = ({ source, data }: MessageEvent): void => {
      if (
        source === frame.contentWindow &&
        (data as { method?: unknown })?.method === SANDBOX_PROXY_READY
      ) {
        window.removeEventListener('message', onMessage);
        resolve();
      }
    };
    window.addEventListener('message', onMessage);
  });
  const url = new URL(options.sandboxUrl);
  if (options.resource.csp !== undefined) {
    url.searchParams.set('csp', JSON.stringify(options.resource.csp));
  }
  frame.src = url.href;
  document.body.append(frame);

  let hostContext = options.hostContext;
  const capabilities = options.client.getServerCapabilities();
  const bridge = new AppBridge(
    options.client,
    HOST_INFO,
    {
      openLinks: {},
      serverTools: capabilities?.tools,
      serverResources: capabilities?.resources,
      logging: {},
    },
    { hostContext },
  );
  bridge.onsizechange = ({ width, height }) => {
    events.push({ type: 'size-changed', width, height });
  };
  bridge.onopenlink = ({ url: link }) => {
    events.push({ type: 'open-link', url: link });
    return Promise.resolve({});
  };
  bridge.onloggingmessage = ({ level }) => {
    events.push({ type: 'log', level });
  };
  bridge.onrequestteardown = () => {
    events.push({ type: 'request-teardown' });
  };
  bridge.onclose = () => {
    events.push({ type: 'closed' });
  };
  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => {
      events.push({ type: 'initialized', app: bridge.getAppVersion()?.name });
      resolve();
    };
  });

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    disposed = true;
    await bridge.close().catch(() => undefined);
    frame.remove();
  };

  try {
    await withTimeout(proxyReady, 10_000, 'The sandbox proxy readiness');
    const target = frame.contentWindow;
    if (target === null) {
      throw new Error('The sandbox proxy has no window.');
    }
    await bridge.connect(new PostMessageTransport(target, target));
    await bridge.sendSandboxResourceReady({
      html: options.resource.html,
      ...(options.resource.csp === undefined ? {} : { csp: options.resource.csp }),
    });
    await withTimeout(initialized, 15_000, 'The View initialization');
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    bridge,
    frame,
    events,
    hostContext: () => hostContext,
    deliverToolCall: async (tool, args, result) => {
      await bridge.sendToolInput({ arguments: args });
      events.push({ type: 'tool-input', tool });
      await bridge.sendToolResult(result);
      events.push(summarize(tool, result));
    },
    deliverResult: async (tool, result) => {
      await bridge.sendToolResult(result);
      events.push(summarize(tool, result));
    },
    setHostContext: (context) => {
      hostContext = context;
      bridge.setHostContext(context);
    },
    teardown: async () => {
      await withTimeout(bridge.teardownResource({}), 10_000, 'The View teardown answer');
      events.push({ type: 'teardown-answered' });
    },
    dispose,
  };
}

export { RESOURCE_MIME_TYPE };
