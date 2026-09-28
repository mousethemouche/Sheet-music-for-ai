/**
 * MCP server composition (docs/architecture/MCP_SERVER.md). The server is an
 * inbound adapter over the music-application use cases (ADR-003): it never
 * calls the REST app and holds no music rule. One server is built per HTTP
 * request (stateless Streamable HTTP), so it keeps no state between calls.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ToolDependencies, registerScoreTools } from './tools';
import { type ViewResourceConfig, registerScoreView } from './view-resource';

export const SERVER_INFO = { name: 'sheet-music-for-ai', version: '0.0.0' } as const;

export interface McpServerDependencies extends ToolDependencies {
  readonly config: ViewResourceConfig;
}

export function createMcpServer(deps: McpServerDependencies): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerScoreTools(server, deps);
  registerScoreView(server, deps.config);
  return server;
}
