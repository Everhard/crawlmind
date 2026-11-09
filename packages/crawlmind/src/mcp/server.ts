import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VERSION } from '../core/index.js';
import type { ToolContext } from './context.js';
import { toolResult } from './result.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerAuditTools } from './tools/audit.js';
import { registerCrawlTools } from './tools/crawls.js';
import { registerLinkTools } from './tools/links.js';
import { registerReportTools } from './tools/reports.js';

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: 'crawlmind', title: 'Crawlmind', version: VERSION },
    {
      instructions:
        'Crawlmind crawls websites and audits technical SEO. Typical flow: start_crawl, then ' +
        'get_crawl_status with wait_seconds until it completes, then get_summary, get_issues ' +
        '(with check_id for all affected URLs), get_page, get_links and get_top_pages. ' +
        'suggest_links and find_cannibalization use local embeddings from an optional add-on ' +
        '(install_embeddings installs it); compare_crawls diffs two crawls and ' +
        'export_report writes an HTML or Markdown report. ' +
        'crawlmind://checks/{id} explains each check.',
    },
  );

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description:
        'Check that the Crawlmind server is running; reports its version and whether the ' +
        'embeddings add-on is installed.',
      inputSchema: {},
      outputSchema: {
        ok: z.boolean(),
        version: z.string(),
        embeddings: z.enum(['installed', 'missing']),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const embeddings = ctx.engine.embeddings.status().installed ? 'installed' : 'missing';
      return toolResult(
        { ok: true, version: VERSION, embeddings },
        `Crawlmind ${VERSION} is running. Embeddings add-on: ${embeddings}.`,
      );
    },
  );

  registerCrawlTools(server, ctx);
  registerAuditTools(server, ctx);
  registerLinkTools(server, ctx);
  registerReportTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server);
  return server;
}
