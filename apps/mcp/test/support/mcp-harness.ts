/**
 * Integration harness: the real Express app with the production request
 * protection (mcpRequestProtection), MCP server, use cases, logger and
 * transports on a loopback port, with in-memory stores (or the stores a test
 * passes) and a fixed test identity injected where the auth middleware of #26
 * will sit. Log lines are captured, not printed.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createLogger } from '@sheet-music/server-common';
import type { RequestHandler } from 'express';
import { MCP_PATH, createMcpHttpApp } from '../../src/app';
import { principalFromAuthInfo } from '../../src/principal';
import { type McpRequestProtectionOptions, mcpRequestProtection } from '../../src/protection';
import { createMcpServer } from '../../src/server';
import { type ScoreStores, createMcpUseCases } from '../../src/use-cases';
import type { ViewResourceConfig } from '../../src/view-resource';
import { InMemoryScoreStores } from './in-memory-stores';

export const TEST_USER_ID = 'user-a';

/** Stands in for the verified-token middleware of #26. */
const testIdentity: RequestHandler = (req, _res, next) => {
  const auth: AuthInfo = {
    token: 'test-token',
    clientId: 'test-client',
    scopes: [],
    extra: { userId: TEST_USER_ID },
  };
  (req as typeof req & { auth?: AuthInfo }).auth = auth;
  next();
};

export interface RunningMcpServer<Stores extends ScoreStores = InMemoryScoreStores> {
  readonly url: URL;
  readonly stores: Stores;
  /** Every log line the server wrote, parsed. */
  readonly logs: Record<string, unknown>[];
  /** How many MCP servers were built, i.e. how many requests reached the transport. */
  readonly serversCreated: () => number;
  close(): Promise<void>;
}

export interface McpServerOptions<Stores extends ScoreStores> {
  readonly stores?: Stores;
  readonly protection?: McpRequestProtectionOptions;
}

/** Starts the app on a loopback port; without `options.stores`, over fresh in-memory stores. */
export async function startMcpServer<Stores extends ScoreStores = InMemoryScoreStores>(
  config: ViewResourceConfig,
  options: McpServerOptions<Stores> = {},
): Promise<RunningMcpServer<Stores>> {
  // Stores defaults to InMemoryScoreStores exactly when no stores are passed.
  const stores = options.stores ?? (new InMemoryScoreStores() as ScoreStores as Stores);
  const useCases = createMcpUseCases(stores);
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    production: true,
    write: (line) => logs.push(JSON.parse(line) as Record<string, unknown>),
  });
  let serversCreated = 0;
  const app = createMcpHttpApp({
    protection: mcpRequestProtection(options.protection),
    middleware: [testIdentity],
    createServer: () => {
      serversCreated += 1;
      return createMcpServer({
        useCases,
        resolvePrincipal: principalFromAuthInfo,
        logger,
        config,
      });
    },
  });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: new URL(`http://127.0.0.1:${port}${MCP_PATH}`),
    stores,
    logs,
    serversCreated: () => serversCreated,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** An initialized SDK client (initialize request + initialized notification). */
export async function connectClient(url: URL): Promise<Client> {
  const client = new Client({ name: 'sheet-music-test-client', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url));
  return client;
}
