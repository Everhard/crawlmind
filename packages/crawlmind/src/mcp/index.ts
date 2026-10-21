import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from '../core/index.js';
import { createServer } from './server.js';

export { createServer } from './server.js';

/** Start the MCP server over stdio. Resolves once the transport is connected. */
export async function runMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await server.connect(transport);
  logger.info('MCP server listening on stdio');
}
