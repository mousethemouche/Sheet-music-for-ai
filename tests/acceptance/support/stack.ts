/**
 * Both public applications on ONE test database, trusting ONE local issuer
 * (the stand-in Supabase project), as in production:
 *
 * - the MCP server: the production composition `createMcpApp` through
 *   apps/mcp's `startMcpApp` (request protection, rate limits, bearer guard,
 *   SDK server, tools, use cases);
 * - the HTTP API: the production Nest bootstrap `createApiApp` through
 *   apps/api's `startApi` (protection, session guard, owner limit, contract
 *   pipes, exception filter, use cases);
 * - the Postgres adapters of persistence-postgres on a fresh `sheet_music_*`
 *   database with users A and B.
 *
 * A user holds two tokens with the same `sub`: an MCP OAuth token (audience
 * = the MCP resource, `client_id`) for the MCP server, a web session token
 * (audience `authenticated`) for the API. Both are checked by the production
 * verifiers against the issuer's JWKS served over loopback HTTP. Nothing is
 * bypassed. Rate limits are raised so that no functional suite reaches them
 * (SEC-03 owns them).
 */
import {
  type McpTestBackend,
  type RunningApi,
  type RunningMcpApp,
  type ServedTestIssuer,
  type SequentialScoreIds,
  type TestClock,
  apiStores,
  openMcpTestBackend,
  startApi,
  startMcpApp,
  startTestIssuer,
} from './workspace';

/** The database of the acceptance suites; each file recreates it (files run one at a time). */
export const ACCEPTANCE_DATABASE = 'sheet_music_test_flow';

const UNREACHED = 1_000_000;

export type McpClient = Awaited<ReturnType<RunningMcpApp['connect']>>;

export interface HttpResult {
  readonly status: number;
  readonly headers: Headers;
  /** The parsed JSON body. */
  readonly body: unknown;
}

export interface AcceptanceStack {
  readonly backend: McpTestBackend;
  readonly issuer: ServedTestIssuer;
  readonly mcp: RunningMcpApp;
  readonly api: RunningApi;
  /**
   * An initialized MCP client acting as `userId`. `tools/list` has run, so
   * the SDK client checks every structuredContent against the published
   * output schema.
   */
  mcpClient(userId: string): Promise<McpClient>;
  /** `GET <path>` on the API with a session token of `userId`. */
  apiGet(userId: string, path: string): Promise<HttpResult>;
  close(): Promise<void>;
}

export interface AcceptanceStackOptions {
  /** Use-case time of the MCP server (tokens always use system time). */
  readonly clock: TestClock;
  readonly ids: SequentialScoreIds;
}

export async function startAcceptanceStack(
  options: AcceptanceStackOptions,
): Promise<AcceptanceStack> {
  const opened: { close(): Promise<void> }[] = [];
  const close = async (): Promise<void> => {
    for (const resource of opened.splice(0).reverse()) {
      await resource.close();
    }
  };
  try {
    const backend = await openMcpTestBackend(ACCEPTANCE_DATABASE);
    opened.push(backend);
    const issuer = await startTestIssuer();
    opened.push({ close: () => issuer.stop() });
    const mcp = await startMcpApp({
      stores: backend.persistence,
      issuer,
      clock: options.clock,
      ids: options.ids,
    });
    opened.push(mcp);
    const api = await startApi({
      supabaseUrl: issuer.projectUrl,
      stores: apiStores(backend.persistence),
      rateLimits: {
        perIp: { name: 'api-ip', limit: UNREACHED, windowMs: 60_000 },
        perOwner: { name: 'api-owner', limit: UNREACHED, windowMs: 60_000 },
      },
    });
    opened.push(api);

    const sessionTokens = new Map<string, string>();
    const sessionToken = async (userId: string): Promise<string> => {
      const cached = sessionTokens.get(userId);
      if (cached !== undefined) {
        return cached;
      }
      const token = await issuer.sessionToken(userId);
      sessionTokens.set(userId, token);
      return token;
    };

    return {
      backend,
      issuer,
      mcp,
      api,
      mcpClient: async (userId) => {
        const client = await mcp.connect(await mcp.token(userId));
        opened.push(client);
        await client.listTools();
        return client;
      },
      apiGet: async (userId, path) => {
        const response = await fetch(`${api.url}${path}`, {
          headers: { authorization: `Bearer ${await sessionToken(userId)}` },
        });
        return {
          status: response.status,
          headers: response.headers,
          body: await response.json(),
        };
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
