import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createEngine, logger } from '../core/index.js';
import { createServer } from './server.js';

export { createServer } from './server.js';
export type { ToolContext } from './context.js';

/** Start the MCP server over stdio. Resolves once the transport is connected. */
export async function runMcpServer(): Promise<void> {
  const engine = createEngine();
  const server = createServer({ engine });
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    await engine.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await server.connect(transport);
  // Exit when the client disconnects (set after connect, which installs its own handler).
  server.server.onclose = () => void shutdown();
  logger.info(`MCP server listening on stdio (database: ${engine.dbPath})`);
}
