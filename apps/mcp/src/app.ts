import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';

export const MCP_PATH = '/mcp';

const SERVER_INFO = { name: 'sheet-music-for-ai', version: '0.0.0' } as const;

/**
 * Product tools and the ui:// View resource are registered here by #11-#14.
 * The MCP server is an inbound adapter over music-application use cases; it
 * never calls the REST app (ADR-003).
 */
function createMcpServer(): McpServer {
  return new McpServer(SERVER_INFO);
}

/**
 * Stateless Streamable HTTP: no session ID and no in-memory state between
 * requests (ADR-006), so every POST gets its own server/transport pair that is
 * closed with the response.
 */
async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({});
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export function createMcpHttpApp(): Express {
  const app = express();
  app.use(express.json());
  app.post(MCP_PATH, handleMcpPost);
  return app;
}
