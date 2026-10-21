import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CrawlInfoSchema,
  CrawlProgressSchema,
  crawlOptionsShape,
  PaginationShape,
} from '../../core/index.js';
import type { ToolContext } from '../context.js';
import { describeCrawl, describeStatus } from '../format.js';
import { crawlProgressNotifier } from '../progress.js';
import { safe, toolResult } from '../result.js';

const crawlId = z.string().min(1).describe('Crawl id returned by start_crawl or list_crawls');

const statusOutput = {
  crawl: CrawlInfoSchema,
  progress: CrawlProgressSchema.nullable(),
};

/** Upper bound for `start_crawl` with `wait: true`. */
const MAX_START_WAIT_MS = 30 * 60 * 1000;

export function registerCrawlTools(server: McpServer, { engine }: ToolContext): void {
  server.registerTool(
    'start_crawl',
    {
      title: 'Start crawl',
      description:
        'Start crawling a website in the background and return its crawl_id immediately. ' +
        'Poll with get_crawl_status (use wait_seconds to wait with progress). ' +
        'Set wait=true to keep this call open until the crawl finishes.',
      inputSchema: {
        ...crawlOptionsShape,
        wait: z
          .boolean()
          .default(false)
          .describe('Keep the request open until the crawl finishes, sending progress'),
      },
      outputSchema: statusOutput,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: false },
    },
    safe(async ({ wait, ...options }, extra) => {
      const crawl = engine.crawls.start(options);
      if (!wait) {
        const report = engine.crawls.status(crawl.crawlId);
        return toolResult(
          report,
          `Started crawl ${crawl.crawlId} of ${crawl.site} (up to ${crawl.options.maxPages} pages). ` +
            `Call get_crawl_status with crawl_id "${crawl.crawlId}" and wait_seconds to follow it.`,
        );
      }
      const report = await engine.crawls.waitFor(
        crawl.crawlId,
        MAX_START_WAIT_MS,
        crawlProgressNotifier(extra),
      );
      return toolResult(report, describeStatus(report));
    }),
  );

  server.registerTool(
    'get_crawl_status',
    {
      title: 'Crawl status',
      description:
        'Status and progress of a crawl. With wait_seconds > 0, waits up to that long for the ' +
        'crawl to finish and sends progress notifications meanwhile.',
      inputSchema: {
        crawl_id: crawlId,
        wait_seconds: z.number().int().min(0).max(60).default(0),
      },
      outputSchema: statusOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ crawl_id, wait_seconds }, extra) => {
      const report =
        wait_seconds > 0
          ? await engine.crawls.waitFor(crawl_id, wait_seconds * 1000, crawlProgressNotifier(extra))
          : engine.crawls.status(crawl_id);
      return toolResult(report, describeStatus(report));
    }),
  );

  server.registerTool(
    'cancel_crawl',
    {
      title: 'Cancel crawl',
      description: 'Stop a running crawl. Pages fetched so far are kept and analyzed.',
      inputSchema: { crawl_id: crawlId },
      outputSchema: { crawl: CrawlInfoSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(async ({ crawl_id }) => {
      const crawl = engine.crawls.cancel(crawl_id);
      return toolResult(
        { crawl },
        `Cancelling crawl ${crawl.crawlId}; it stops after in-flight requests.`,
      );
    }),
  );

  server.registerTool(
    'list_crawls',
    {
      title: 'List crawls',
      description:
        'Past and running crawls, newest first. Filter by site origin (https://example.com).',
      inputSchema: {
        site: z.string().optional().describe('Site origin, e.g. https://example.com'),
        ...PaginationShape,
      },
      outputSchema: {
        items: z.array(CrawlInfoSchema),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ site, limit, offset }) => {
      const origin = site ? safeOrigin(site) : undefined;
      const page = engine.store.listCrawls({ site: origin, limit, offset });
      const lines = page.items.map((c) => `- ${describeCrawl(c)} Started ${c.startedAt}.`);
      const more =
        page.total > offset + page.items.length
          ? `\n${page.total - offset - page.items.length} more; use offset ${offset + limit}.`
          : '';
      return toolResult(
        page,
        page.items.length
          ? `${page.total} crawl(s):\n${lines.join('\n')}${more}`
          : 'No crawls yet. Use start_crawl.',
      );
    }),
  );
}

function safeOrigin(site: string): string {
  try {
    return new URL(site).origin;
  } catch {
    return site;
  }
}
