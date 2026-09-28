import { createMcpHttpApp, MCP_PATH } from './app';

const DEFAULT_PORT = 3001;
const port = Number(process.env.PORT ?? DEFAULT_PORT);

createMcpHttpApp().listen(port, () => {
  console.log(`MCP server listening on http://localhost:${port}${MCP_PATH}`);
});
