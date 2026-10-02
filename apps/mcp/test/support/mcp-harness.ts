/**
 * Boot helper of the apps/mcp integration suites, reusable by FLOW-01 and
 * ACCESS-01 (#18): the PRODUCTION composition (`createMcpApp`: request
 * protection, both rate limits, the bearer guard, the MCP server, tools, use
 * cases and the given stores) on a loopback port, authenticated against a
 * local test issuer served over loopback HTTP. Nothing is bypassed: every
 * request needs a token minted by that issuer and checked by the production
 * verifier through the production JWKS key source.
 *
 * MCP_PUBLIC_URL is the real listening URL (`http://127.0.0.1:<port>/mcp`),
 * so the challenge's `resource_metadata` and the metadata document point at
 * this server. Log lines are captured, not printed.
 */
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  type ServedTestIssuer,
  type TokenOptions,
  startTestIssuer,
} from '@sheet-music/auth-jwt/testing';
import type { Clock, IdGenerator } from '@sheet-music/music-application';
import { createLogger } from '@sheet-music/server-common';
import { MCP_PATH } from '../../src/app';
import { type McpStores, createMcpApp } from '../../src/composition';
import type { AudienceMode } from '../../src/config';
import type { McpRateLimitRules } from '../../src/protection';

/** Limits no functional suite reaches; SEC-03 passes its own small rules. */
export const GENEROUS_RATE_LIMITS: McpRateLimitRules = {
  perIp: { name: 'mcp-ip', limit: 1_000_000, windowMs: 60_000 },
  perOwner: { name: 'mcp-owner', limit: 1_000_000, windowMs: 60_000 },
};

/** A stand-in View document with the asset-origin injection point of view/index.html. */
export const PLACEHOLDER_VIEW_HTML =
  '<!doctype html><meta name="sheet-music-asset-origin" content="" /><title>View</title>';

export interface StartMcpAppOptions {
  /** The app's stores; usually `backend.persistence` (support/backend.ts). */
  readonly stores: McpStores;
  readonly viewHtml?: string;
  /** Default: a fresh served issuer, stopped by `close()`. */
  readonly issuer?: ServedTestIssuer;
  readonly allowedOrigins?: readonly string[];
  readonly audienceMode?: AudienceMode;
  /** Use-case and rate-limit time (tokens always use system time). Default: system. */
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  /** Default GENEROUS_RATE_LIMITS. */
  readonly rateLimits?: McpRateLimitRules;
}

export type LogLine = Readonly<Record<string, unknown>>;

export interface RunningMcpApp {
  /** `http://127.0.0.1:<port>/mcp`, also the configured MCP_PUBLIC_URL and resource. */
  readonly url: URL;
  readonly origin: string;
  readonly resource: string;
  readonly metadataUrl: string;
  readonly issuer: ServedTestIssuer;
  /** Every log line the app wrote, parsed, in order. */
  readonly logs: LogLine[];
  /** How many requests reached the MCP transport (`mcp.request` log lines). */
  transportRequests(): number;
  /** An MCP access token of `userId` for this resource (aud + client_id as the Supabase hook sets them). */
  token(userId: string, options?: TokenOptions): Promise<string>;
  /** An initialized SDK client sending `Authorization: Bearer <token>`. */
  connect(token: string): Promise<Client>;
  close(): Promise<void>;
}

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address() as AddressInfo);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

export async function startMcpApp(options: StartMcpAppOptions): Promise<RunningMcpApp> {
  const ownsIssuer = options.issuer === undefined;
  const issuer = options.issuer ?? (await startTestIssuer());
  const server = createServer();
  const logs: LogLine[] = [];
  try {
    const { port } = await listen(server);
    const origin = `http://127.0.0.1:${port}`;
    const composed = createMcpApp({
      config: {
        publicUrl: `${origin}${MCP_PATH}`,
        supabaseUrl: issuer.projectUrl,
        allowedOrigins: options.allowedOrigins ?? [],
        audienceMode: options.audienceMode ?? 'resource',
        trustProxyHops: 0,
      },
      stores: options.stores,
      viewHtml: options.viewHtml ?? PLACEHOLDER_VIEW_HTML,
      logger: createLogger({
        level: 'debug',
        production: true,
        write: (line) => logs.push(JSON.parse(line) as LogLine),
      }),
      rateLimits: options.rateLimits ?? GENEROUS_RATE_LIMITS,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.ids === undefined ? {} : { ids: options.ids }),
    });
    server.on('request', composed.app);
    return {
      url: new URL(composed.resource),
      origin,
      resource: composed.resource,
      metadataUrl: composed.metadataUrl,
      issuer,
      logs,
      transportRequests: () => logs.filter((line) => line['event'] === 'mcp.request').length,
      token: (userId, tokenOptions) => issuer.mcpToken(userId, composed.resource, tokenOptions),
      connect: async (token) => {
        const client = new Client({ name: 'sheet-music-test-client', version: '0.0.0' });
        await client.connect(
          new StreamableHTTPClientTransport(new URL(composed.resource), {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
          }),
        );
        return client;
      },
      close: async () => {
        await closeServer(server);
        if (ownsIssuer) {
          await issuer.stop();
        }
      },
    };
  } catch (error) {
    await closeServer(server).catch(() => undefined);
    if (ownsIssuer) {
      await issuer.stop();
    }
    throw error;
  }
}
