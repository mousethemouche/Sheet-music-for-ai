/**
 * Integration harness of apps/api (docs/testing/HARNESS.md): the production
 * bootstrap `createApiApp` (request protection, session verifier built from
 * the Supabase project URL, auth and per-owner rate-limit guards, contract
 * pipes, exception filter, shared use cases) listening on a loopback port.
 *
 * - Identity comes from a served test issuer: pass `issuer.projectUrl` as
 *   `supabaseUrl`, exactly where production passes SUPABASE_URL. No test
 *   identity or always-allow guard exists.
 * - Stores are the caller's (Postgres adapters over a test database), seen
 *   through `countingStores` so a test can prove that a rejected request did
 *   no work.
 * - Log lines are captured, parsed, instead of printed.
 *
 * Reusable by FLOW-01/ACCESS-01 (#18): `startApi({ supabaseUrl, stores })`.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PostgresPersistence } from '@sheet-music/persistence-postgres';
import { createLogger } from '@sheet-music/server-common';
import { type ApiAppOptions, type ApiStores, createApiApp } from '../../src/app';

export interface RunningApi {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  readonly url: string;
  readonly app: NestExpressApplication;
  /** Every log line the app wrote, parsed. */
  readonly logs: Record<string, unknown>[];
  /** Log lines of one request, by its `x-correlation-id`. */
  logsOf(correlationId: string | undefined): Record<string, unknown>[];
  close(): Promise<void>;
}

export type StartApiOptions = Omit<ApiAppOptions, 'logger'>;

export async function startApi(options: StartApiOptions): Promise<RunningApi> {
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    production: true,
    write: (line) => logs.push(JSON.parse(line) as Record<string, unknown>),
  });
  const app = await createApiApp({ ...options, logger });
  await app.listen(0, '127.0.0.1');
  const server: Server = app.getHttpServer();
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    app,
    logs,
    logsOf: (correlationId) => logs.filter((line) => line['correlationId'] === correlationId),
    close: () => app.close(),
  };
}

export interface StoreCalls {
  savedGet: number;
  savedSearch: number;
  savedUpdate: number;
  rateLimitHits: number;
}

/** The API stores with call counters; every call is forwarded unchanged. */
export interface CountingStores extends ApiStores {
  readonly calls: Readonly<StoreCalls>;
  /** A copy of the counters, to compare before and after a request. */
  snapshot(): StoreCalls;
}

export function countingStores(inner: ApiStores): CountingStores {
  const calls: StoreCalls = { savedGet: 0, savedSearch: 0, savedUpdate: 0, rateLimitHits: 0 };
  return {
    calls,
    snapshot: () => ({ ...calls }),
    saved: {
      get: (owner, id) => {
        calls.savedGet += 1;
        return inner.saved.get(owner, id);
      },
      search: (owner, query) => {
        calls.savedSearch += 1;
        return inner.saved.search(owner, query);
      },
      update: (owner, saved, expectedRevision) => {
        calls.savedUpdate += 1;
        return inner.saved.update(owner, saved, expectedRevision);
      },
    },
    rateLimits: {
      hit: (key, windowMs, now) => {
        calls.rateLimitHits += 1;
        return inner.rateLimits.hit(key, windowMs, now);
      },
    },
  };
}

/** The API's stores over a Postgres persistence, counted. */
export function apiStores(persistence: PostgresPersistence): CountingStores {
  return countingStores({ saved: persistence.saved, rateLimits: persistence.rateLimits });
}
