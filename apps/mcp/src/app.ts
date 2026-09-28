/**
 * HTTP surface of the MCP server (docs/architecture/MCP_SERVER.md §1):
 * stateless Streamable HTTP on `POST /mcp`, JSON responses, no sessions.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PAYLOAD_LIMITS } from '@sheet-music/music-contracts';
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

export const MCP_PATH = '/mcp';

export interface McpHttpAppOptions {
  /** Builds a fresh server for one request; nothing is shared between requests. */
  readonly createServer: () => McpServer;
  /**
   * Runs first for EVERY method on `/mcp`, in order: correlation, Origin
   * policy and CORS preflight, body cap, per-IP rate limit (#19, #24; see
   * `mcpRequestProtection`). A request it answers (403 origin, 204 preflight,
   * 411/413 body, 429) never reaches the 405 fallback or the transport.
   */
  readonly protection?: readonly RequestHandler[];
  /**
   * Runs before `POST /mcp` only, after `protection`, in order:
   * authentication (#26) and the per-owner rate limit. An auth middleware
   * sets `req.auth` (SDK `AuthInfo`), which tool handlers receive as
   * `extra.authInfo`.
   */
  readonly middleware?: readonly RequestHandler[];
  /**
   * Largest JSON-RPC body read by the transport, in bytes (default
   * PAYLOAD_LIMITS.requestBodyBytes); a larger body is answered 413 before parsing.
   */
  readonly maxRequestBodyBytes?: number;
}

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/**
 * One server/transport pair per POST, closed when the response ends. The
 * transport reads and parses the body itself: malformed JSON or a non
 * JSON-RPC body is a 400 parse error (-32700), never a crash.
 */
function handleMcpPost(options: McpHttpAppOptions): RequestHandler {
  const maxRequestBodySize = options.maxRequestBodyBytes ?? PAYLOAD_LIMITS.requestBodyBytes;
  return async (req: Request, res: Response): Promise<void> => {
    const server = options.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };
}

/**
 * GET (standalone SSE stream) and DELETE (session end) have no meaning
 * without sessions; every method but POST is 405 with `Allow: POST`.
 */
const methodNotAllowed: RequestHandler = (_req, res) => {
  res.set('Allow', 'POST');
  jsonRpcError(res, 405, -32000, 'Method not allowed.');
};

/** Last resort: an unexpected failure is a generic JSON-RPC internal error. */
const internalError: ErrorRequestHandler = (_error, _req, res, next) => {
  if (res.headersSent) {
    next(_error);
    return;
  }
  jsonRpcError(res, 500, -32603, 'Internal error.');
};

export function createMcpHttpApp(options: McpHttpAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  if (options.protection !== undefined && options.protection.length > 0) {
    app.all(MCP_PATH, ...options.protection);
  }
  app.post(MCP_PATH, ...(options.middleware ?? []), handleMcpPost(options));
  app.all(MCP_PATH, methodNotAllowed);
  app.use(internalError);
  return app;
}
