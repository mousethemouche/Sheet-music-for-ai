/**
 * The sandbox proxy of the MCP-UI test host: the outer iframe of the MCP Apps
 * double-iframe architecture, served from its own loopback origin (the spec
 * requires the host and the sandbox to have different origins).
 *
 * Adapted from the pinned reference host of @modelcontextprotocol/ext-apps
 * 1.7.5 (MIT), examples/basic-host: `buildCspHeader` of serve.ts (the CSP of
 * the proxy page is built from the resource's `_meta.ui.csp`, passed by the
 * host as `?csp=<JSON>`, and set as an HTTP header, which the View document
 * inherits) and the relay of src/sandbox.ts (the proxy writes the View HTML
 * into an inner `allow-scripts allow-same-origin` iframe with
 * `document.write`, then forwards every JSON-RPC message between the host and
 * the View). Differences: the expected host origin is configured instead of
 * read from the referrer, the inner frame is named (VIEW_FRAME_NAME) so the
 * harness can find it, the proxy installs a read-only audio probe on the
 * inner window before writing the View, and it records the View's state at
 * the moment it relays the answer to `ui/resource-teardown` (test-host
 * instrumentation, below).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { VIEW_FRAME_NAME } from './protocol';

/** The resource CSP fields a host maps to directives (McpUiResourceCsp). */
interface ResourceCsp {
  readonly connectDomains?: readonly string[];
  readonly resourceDomains?: readonly string[];
  readonly frameDomains?: readonly string[];
  readonly baseUriDomains?: readonly string[];
}

const PROXY_PATH = '/sandbox.html';

/** Drops entries that could inject a directive, a keyword or a second source (basic-host). */
function sanitizeCspDomains(domains: unknown): string[] {
  if (!Array.isArray(domains)) {
    return [];
  }
  return domains.filter(
    (domain): domain is string => typeof domain === 'string' && !/[;\r\n'" ]/.test(domain),
  );
}

/** basic-host's CSP construction, directive for directive. */
export function buildCspHeader(csp: ResourceCsp | undefined): string {
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains).join(' ');
  const connectDomains = sanitizeCspDomains(csp?.connectDomains).join(' ');
  const frameDomains = sanitizeCspDomains(csp?.frameDomains).join(' ') || null;
  const baseUriDomains = sanitizeCspDomains(csp?.baseUriDomains).join(' ') || null;
  return [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    frameDomains === null ? "frame-src 'none'" : `frame-src ${frameDomains}`,
    "object-src 'none'",
    baseUriDomains === null ? "base-uri 'none'" : `base-uri ${baseUriDomains}`,
  ].join('; ');
}

/**
 * The proxy page. Its script is inline (allowed by `'unsafe-inline'` above).
 *
 * The audio probe wraps the inner window's `AudioNode.prototype.connect`
 * before the View is written (document.write keeps that window): a node
 * connected to the destination also feeds an AnalyserNode, and
 * `window.__mcpUiAudio()` returns each such node's context state and output
 * peak. It changes nothing the View does, like the spy of the
 * playback-spessasynth Chromium check.
 *
 * The teardown record: when the View posts the answer to the host's
 * `ui/resource-teardown` request, the proxy reads the View document and the
 * audio probe synchronously, before forwarding that answer, and keeps the
 * result as `window.__mcpUiTeardownAnswer` of the View frame, so the suite
 * can tell what was already released when the host got the answer.
 */
function proxyPage(hostOrigin: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light dark" />
    <title>MCP-UI test sandbox proxy</title>
    <style>
      html, body { margin: 0; height: 100vh; width: 100vw; background-color: transparent; }
      body { display: flex; flex-direction: column; }
      * { box-sizing: border-box; }
      iframe { background-color: transparent; border: 0; padding: 0; overflow: hidden; flex-grow: 1; color-scheme: inherit; }
    </style>
  </head>
  <body>
    <script type="module">
      const HOST_ORIGIN = ${JSON.stringify(hostOrigin)};
      const OWN_ORIGIN = window.location.origin;
      const RESOURCE_READY = 'ui/notifications/sandbox-resource-ready';
      const PROXY_READY = 'ui/notifications/sandbox-proxy-ready';

      if (window.self === window.top) {
        throw new Error('The sandbox proxy only runs in an iframe.');
      }
      let topReachable = false;
      try {
        void window.top.location.href;
        topReachable = true;
      } catch {
        // Expected: the top frame is cross-origin.
      }
      if (topReachable) {
        throw new Error('The sandbox is not isolated from the top frame.');
      }

      const inner = document.createElement('iframe');
      inner.name = ${JSON.stringify(VIEW_FRAME_NAME)};
      inner.title = 'Score view';
      inner.style = 'width:100%; height:100%; border:none;';
      inner.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
      document.body.appendChild(inner);

      function installAudioProbe(view) {
        const connect = view.AudioNode.prototype.connect;
        const taps = [];
        view.AudioNode.prototype.connect = function (destination, ...rest) {
          const result = connect.call(this, destination, ...rest);
          if (destination instanceof view.AudioDestinationNode && !taps.some((tap) => tap.node === this)) {
            const analyser = new view.AnalyserNode(this.context, { fftSize: 2048 });
            for (let output = 0; output < this.numberOfOutputs; output += 1) {
              connect.call(this, analyser, output);
            }
            taps.push({ node: this, analyser, samples: new Float32Array(analyser.fftSize) });
          }
          return result;
        };
        view.__mcpUiAudio = () =>
          taps.map(({ node, analyser, samples }) => {
            analyser.getFloatTimeDomainData(samples);
            let peak = 0;
            for (const sample of samples) {
              peak = Math.max(peak, Math.abs(sample));
            }
            return { state: node.context.state, peak };
          });
      }

      const TEARDOWN = 'ui/resource-teardown';
      let teardownRequestId;

      function recordTeardownAnswer(view) {
        const doc = view.document;
        view.__mcpUiTeardownAnswer = {
          mounted: doc.querySelector('[data-testid="score-mount"]') !== null,
          player: doc.querySelector('section[aria-label^="Score player"]') !== null,
          audioStates: typeof view.__mcpUiAudio === 'function'
            ? view.__mcpUiAudio().map((tap) => tap.state)
            : [],
        };
      }

      window.addEventListener('message', (event) => {
        if (event.source === window.parent) {
          if (event.origin !== HOST_ORIGIN) {
            console.error('[sandbox] message from an unexpected origin', event.origin);
            return;
          }
          if (event.data && event.data.method === TEARDOWN) {
            teardownRequestId = event.data.id;
          }
          if (event.data && event.data.method === RESOURCE_READY) {
            const { html, sandbox } = event.data.params;
            if (typeof sandbox === 'string') {
              inner.setAttribute('sandbox', sandbox);
            }
            if (typeof html === 'string') {
              installAudioProbe(inner.contentWindow);
              const doc = inner.contentDocument;
              doc.open();
              doc.write(html);
              doc.close();
            }
          } else if (inner.contentWindow) {
            inner.contentWindow.postMessage(event.data, '*');
          }
        } else if (event.source === inner.contentWindow) {
          if (event.origin !== OWN_ORIGIN) {
            console.error('[sandbox] message from the view with an unexpected origin', event.origin);
            return;
          }
          const data = event.data;
          if (
            teardownRequestId !== undefined &&
            data &&
            data.id === teardownRequestId &&
            ('result' in data || 'error' in data)
          ) {
            recordTeardownAnswer(inner.contentWindow);
          }
          window.parent.postMessage(data, HOST_ORIGIN);
        }
      });

      window.parent.postMessage({ jsonrpc: '2.0', method: PROXY_READY, params: {} }, HOST_ORIGIN);
    </script>
  </body>
</html>
`;
}

function parseCsp(value: string | null): ResourceCsp | undefined {
  if (value === null) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    // Every field is optional and sanitized again by buildCspHeader.
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export interface SandboxProxyOptions {
  /** The only origin the proxy accepts messages from and posts to (the host page). */
  readonly hostOrigin: string;
  /** Receives the CSP header of every proxy page served. */
  readonly onServe: (policy: string) => void;
}

/** Request handler of the sandbox origin: `GET /sandbox.html?csp=...`, anything else 404. */
export function sandboxProxyHandler(
  options: SandboxProxyOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://sandbox.invalid');
    if (req.method !== 'GET' || url.pathname !== PROXY_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const policy = buildCspHeader(parseCsp(url.searchParams.get('csp')));
    options.onServe(policy);
    res
      .writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': policy,
        'cache-control': 'no-cache, no-store, must-revalidate',
      })
      .end(proxyPage(options.hostOrigin));
  };
}

export { PROXY_PATH as SANDBOX_PROXY_PATH };
