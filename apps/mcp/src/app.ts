/**
 * HTTP surface of the MCP server (docs/architecture/MCP_SERVER.md §1):
 * stateless Streamable HTTP on `POST /mcp`, JSON responses, no sessions,
 * plus the public routes the composition root mounts (OAuth protected
 * resource metadata, static View assets).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isJsonContentType } from '@modelcontextprotocol/sdk/shared/mediaType.js';
import { PAYLOAD_LIMITS } from '@sheet-music/music-contracts';
import { type Logger, internalError, sendError } from '@sheet-music/server-common';
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
   * Runs first for EVERY method on `/mcp`, in order. Production passes
   * correlation, Origin policy and CORS preflight, body cap, per-IP rate
   * limit, bearer authentication and the per-owner rate limit (#19, #24,
   * #26). A request it answers (403, 204 preflight, 411/413, 429, 401, 503)
   * never reaches the 405 fallback or the transport.
   */
  readonly protection?: readonly RequestHandler[];
  /** `GET` route of the RFC 9728 metadata document (public). */
  readonly metadata?: { readonly path: string; readonly handler: RequestHandler };
  /**
   * Public static assets of the View, mounted at the root before `/mcp`; it
   * answers only its own paths (`createViewAssetsRouter` serves `/assets/*`).
   */
  readonly assets?: RequestHandler;
  /** Express `trust proxy` hop count (0: the socket address is the client). */
  readonly trustProxyHops?: number;
  /**
   * Largest JSON-RPC body read, in bytes (default
   * PAYLOAD_LIMITS.requestBodyBytes); a larger body is answered 413 before parsing.
   */
  readonly maxRequestBodyBytes?: number;
  /**
   * Receives `mcp.request` (debug) for every POST that reaches the transport,
   * `mcp.bad_request` (warn) for every POST answered 400, and unexpected errors.
   */
  readonly logger?: Logger;
}

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/**
 * Every `/mcp` answer that got past the protection slot is for one
 * authenticated principal (tools/call results carry library data): no cache
 * may store or reuse it, and it is never sniffed as another type. The same
 * policy as the API's protected routes.
 */
const privateAnswer: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.appendHeader('Vary', 'Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};

const UNSUPPORTED_MEDIA_TYPE = 'Unsupported Media Type: Content-Type must be application/json';

/**
 * Why a POST was answered 400: what `readJsonRpcMessage` refused, or what the
 * SDK transport reported to its `onerror` before answering 400 (a value that
 * is not a JSON-RPC message, an `MCP-Protocol-Version` it does not support).
 */
type BadRequestReason =
  | 'parse_error'
  | 'empty_body'
  | 'batch'
  | 'invalid_jsonrpc'
  | 'unsupported_protocol_version'
  | 'transport_error';

/** Classifies a transport error by the SDK's message, which is never logged itself. */
function transportReason(error: Error): BadRequestReason {
  if (error.message.includes('Unsupported protocol version')) {
    return 'unsupported_protocol_version';
  }
  if (error.message.includes('Invalid JSON-RPC message')) {
    return 'invalid_jsonrpc';
  }
  return error.message.includes('Parse error') ? 'parse_error' : 'transport_error';
}

const RPC_METHOD = /^[A-Za-z0-9_/.-]{1,64}$/;
const PROTOCOL_VERSION = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Logs a 400 answer (`mcp.bad_request`, warn) with what is safe to know: the
 * reason, the JSON-RPC `method` and the `MCP-Protocol-Version` header, each
 * kept only when it has the expected shape (`other` otherwise, absent when
 * the request has none). Never the body, the params or another header.
 */
function logBadRequest(logger: Logger | undefined, req: Request, reason: BadRequestReason): void {
  const body: unknown = req.body;
  const method =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as { readonly method?: unknown }).method
      : undefined;
  const version = req.headers['mcp-protocol-version'];
  logger?.warn('mcp.bad_request', {
    reason,
    ...(method === undefined
      ? {}
      : { rpcMethod: typeof method === 'string' && RPC_METHOD.test(method) ? method : 'other' }),
    ...(version === undefined
      ? {}
      : {
          protocolVersion:
            typeof version === 'string' && PROTOCOL_VERSION.test(version) ? version : 'other',
        }),
  });
}

/** HTTP status of a body-parser failure (`http-errors`), or undefined for anything else. */
function bodyErrorStatus(error: unknown): number | undefined {
  const status =
    typeof error === 'object' && error !== null
      ? (error as { status?: unknown }).status
      : undefined;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Reads the POST body once, before the transport, which then receives it as
 * `parsedBody` and never reads the stream itself. It refuses what the MCP
 * transport of this server does not serve:
 * - a Content-Type other than JSON: 415, as the SDK answers it;
 * - malformed JSON: 400 JSON-RPC parse error (-32700), never a crash;
 * - a JSON-RPC batch (an array): 400 Invalid Request (-32600). MCP removed
 *   batching in protocol 2025-06-18, and the pinned SDK transport would
 *   still run up to 100 messages of one request, each one a tool call the
 *   per-owner rate limit counted as a single request (ERRORS_AND_SECURITY.md
 *   §3.3). One POST is therefore at most one JSON-RPC message.
 * The body cap of the protection slot already refused a declared body over
 * the limit; the parser enforces the same limit on what it reads.
 */
function readJsonRpcMessage(maxBytes: number, logger: Logger | undefined): RequestHandler {
  const parse = express.json({ limit: maxBytes, strict: false, inflate: false, type: () => true });
  return (req, res, next) => {
    if (!isJsonContentType(req.headers['content-type'])) {
      jsonRpcError(res, 415, -32000, UNSUPPORTED_MEDIA_TYPE);
      return;
    }
    parse(req, res, (error?: unknown) => {
      if (error !== undefined) {
        const status = bodyErrorStatus(error);
        if (status === 413) {
          jsonRpcError(res, 413, -32000, `Payload Too Large: the limit is ${maxBytes} bytes.`);
        } else if (status === 415) {
          jsonRpcError(res, 415, -32000, UNSUPPORTED_MEDIA_TYPE);
        } else if (status === 400) {
          logBadRequest(logger, req, 'parse_error');
          jsonRpcError(res, 400, -32700, 'Parse error: Invalid JSON');
        } else {
          next(error);
        }
        return;
      }
      const body: unknown = req.body;
      if (body === undefined) {
        logBadRequest(logger, req, 'empty_body');
        jsonRpcError(res, 400, -32700, 'Parse error: Invalid JSON');
      } else if (Array.isArray(body)) {
        logBadRequest(logger, req, 'batch');
        jsonRpcError(res, 400, -32600, 'Invalid Request: JSON-RPC batches are not supported.');
      } else {
        next();
      }
    });
  };
}

/**
 * One server/transport pair per POST, closed when the response ends. The
 * transport gets the one message `readJsonRpcMessage` parsed; a JSON value
 * that is not a JSON-RPC message is its 400 parse error (-32700), an
 * unsupported `MCP-Protocol-Version` its 400 (-32000), both logged with the
 * reason its `onerror` reported.
 */
function handleMcpPost(options: McpHttpAppOptions): RequestHandler {
  const maxRequestBodySize = options.maxRequestBodyBytes ?? PAYLOAD_LIMITS.requestBodyBytes;
  return async (req: Request, res: Response): Promise<void> => {
    options.logger?.debug('mcp.request');
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
    let transportError: BadRequestReason | undefined;
    // Set before connect, which chains the handler already in place.
    transport.onerror = (error) => {
      transportError = transportReason(error);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    if (res.statusCode === 400) {
      logBadRequest(options.logger, req, transportError ?? 'transport_error');
    }
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

/**
 * Last resort for anything thrown or rejected in the HTTP layer (a bug, or
 * an error a guard did not expect): the shared 500 INTERNAL envelope of every
 * other HTTP failure, with the request's correlation ID and `no-store` /
 * `nosniff` (server-common `sendError`); the thrown value is only logged.
 * JSON-RPC error bodies stay for what the transport itself answers.
 */
function unexpectedError(logger: Logger | undefined): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    logger?.error('http.unhandled_error', { error });
    if (res.headersSent) {
      // Too late for an answer: Express's default handler closes the connection.
      next(error);
      return;
    }
    sendError(res, internalError(error));
  };
}

export function createMcpHttpApp(options: McpHttpAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxyHops ?? 0);
  if (options.metadata !== undefined) {
    app.get(options.metadata.path, options.metadata.handler);
  }
  if (options.assets !== undefined) {
    app.use(options.assets);
  }
  if (options.protection !== undefined && options.protection.length > 0) {
    app.all(MCP_PATH, ...options.protection);
  }
  app.all(MCP_PATH, privateAnswer);
  app.post(
    MCP_PATH,
    readJsonRpcMessage(
      options.maxRequestBodyBytes ?? PAYLOAD_LIMITS.requestBodyBytes,
      options.logger,
    ),
    handleMcpPost(options),
  );
  app.all(MCP_PATH, methodNotAllowed);
  app.use(unexpectedError(options.logger));
  return app;
}
