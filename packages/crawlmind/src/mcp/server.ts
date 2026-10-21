import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VERSION } from '../core/index.js';
import { toolResult } from './result.js';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'crawlmind', title: 'Crawlmind', version: VERSION });

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Check that the Crawlmind server is running and report its version.',
      inputSchema: {},
      outputSchema: { ok: z.boolean(), version: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolResult({ ok: true, version: VERSION }, `Crawlmind ${VERSION} is running.`),
  );

  return server;
}
