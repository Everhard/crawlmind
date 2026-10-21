import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  LinkPlacementSchema,
  PaginationShape,
  QUERY_LIMITS,
  QUERY_SCHEMA_HINT,
  SeveritySchema,
} from '../../core/index.js';
import type { ToolContext } from '../context.js';
import {
  describeIssue,
  describeLinks,
  describePage,
  describeSummary,
  describeTopPages,
  more,
} from '../format.js';
import { safe, toolResult } from '../result.js';
import {
  IssuesOutput,
  LinksOutput,
  PageOutput,
  QueryOutput,
  SummaryOutput,
  TopPagesOutput,
} from '../schemas.js';

const crawlId = z.string().min(1).describe('Crawl id from start_crawl or list_crawls');
const pageUrl = z.string().min(1).describe('Absolute URL of a crawled page');
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

export function registerAuditTools(server: McpServer, { engine }: ToolContext): void {
  const { audit } = engine;

  server.registerTool(
    'get_summary',
    {
      title: 'Crawl summary',
      description:
        'Key numbers of a finished crawl (pages, status codes, links, TTFB) and the top issues, ' +
        'most severe first, each with up to 5 example URLs and a recommendation.',
      inputSchema: { crawl_id: crawlId },
      outputSchema: SummaryOutput,
      annotations: readOnly,
    },
    safe(({ crawl_id }) => {
      const summary = audit.summary(crawl_id);
      return toolResult(summary, describeSummary(summary));
    }),
  );

  server.registerTool(
    'get_issues',
    {
      title: 'Issues',
      description:
        'List issues of a crawl, filtered by severity. With check_id, list every affected URL of ' +
        'that check (paginated) instead.',
      inputSchema: {
        crawl_id: crawlId,
        severity: SeveritySchema.optional(),
        check_id: z
          .string()
          .optional()
          .describe('e.g. links.broken_internal; see crawlmind://checks'),
        ...PaginationShape,
      },
      outputSchema: IssuesOutput,
      annotations: readOnly,
    },
    safe(({ crawl_id, severity, check_id, limit, offset }) => {
      if (check_id) {
        const { issue, items } = audit.issueItems(crawl_id, check_id, { limit, offset });
        const lines = items.items.map((i) => `- ${i.url}${i.detail ? ` — ${i.detail}` : ''}`);
        return toolResult(
          { total: items.total, offset, limit, check: issue, urls: items.items },
          `${issue.title} (${issue.severity}, ${issue.count}):\n${lines.join('\n')}${more(items)}\n\nFix: ${issue.recommendation}`,
        );
      }
      const page = audit.issues(crawl_id, { severity, limit, offset });
      const text = page.items.length
        ? `${page.total} issue type(s)${severity ? ` with severity ${severity}` : ''}:\n\n${page.items.map(describeIssue).join('\n\n')}${more(page)}`
        : 'No issues found.';
      return toolResult({ total: page.total, offset, limit, issues: page.items }, text);
    }),
  );

  server.registerTool(
    'get_page',
    {
      title: 'Page details',
      description:
        'Everything known about one crawled URL: status, redirect chain, metadata, timings, ' +
        'link metrics (inlinks, outlinks, click depth, PageRank score 0–100) and its issues.',
      inputSchema: { crawl_id: crawlId, url: pageUrl },
      outputSchema: PageOutput,
      annotations: readOnly,
    },
    safe(({ crawl_id, url }) => {
      const page = audit.page(crawl_id, url);
      return toolResult({ page }, describePage(page));
    }),
  );

  server.registerTool(
    'get_links',
    {
      title: 'Links of a page',
      description:
        'Inlinks (direction=in, default) or outlinks of a URL with anchor text, rel, placement ' +
        '(nav, header, footer, main, other) and target status. Inlinks include links to URLs ' +
        'that redirect to it.',
      inputSchema: {
        crawl_id: crawlId,
        url: pageUrl,
        direction: z.enum(['in', 'out']).default('in'),
        placement: LinkPlacementSchema.optional(),
        exclude_nav_footer: z
          .boolean()
          .default(false)
          .describe('Skip links in nav, header and footer (content links only)'),
        ...PaginationShape,
      },
      outputSchema: LinksOutput,
      annotations: readOnly,
    },
    safe(({ crawl_id, url, direction, placement, exclude_nav_footer, limit, offset }) => {
      const page = audit.links(crawl_id, url, {
        direction,
        placement,
        excludeNavFooter: exclude_nav_footer,
        limit,
        offset,
      });
      return toolResult(page, describeLinks(url, direction, page));
    }),
  );

  server.registerTool(
    'get_top_pages',
    {
      title: 'Top pages',
      description:
        'Rank 200 HTML pages by internal PageRank, inlinks, click depth or TTFB. ' +
        'by=underlinked lists important pages (high PageRank or sitemap priority) with few ' +
        'links from main content: the best targets for new internal links.',
      inputSchema: {
        crawl_id: crawlId,
        by: z.enum(['pagerank', 'inlinks', 'depth', 'ttfb', 'underlinked']).default('pagerank'),
        ...PaginationShape,
      },
      outputSchema: TopPagesOutput,
      annotations: readOnly,
    },
    safe(({ crawl_id, by, limit, offset }) => {
      const page = audit.topPages(crawl_id, by, { limit, offset });
      return toolResult(page, describeTopPages(by, page));
    }),
  );

  server.registerTool(
    'query_data',
    {
      title: 'Query crawl data (SQL)',
      description:
        'Run one read-only SQL SELECT against the Crawlmind SQLite database for questions the ' +
        `other tools do not answer. Always filter by crawl_id. Tables:\n${QUERY_SCHEMA_HINT}`,
      inputSchema: {
        sql: z.string().min(1).describe('A single SELECT or WITH … SELECT statement'),
        limit: z.number().int().min(1).max(QUERY_LIMITS.maxRows).default(QUERY_LIMITS.defaultRows),
      },
      outputSchema: QueryOutput,
      annotations: readOnly,
    },
    safe(async ({ sql, limit }) => {
      const result = await engine.query.run(sql, limit);
      const preview = result.rows
        .slice(0, 20)
        .map((row) => JSON.stringify(row))
        .join('\n');
      return toolResult(
        result,
        `${result.rowCount} row(s)${result.truncated ? ` (truncated at ${limit})` : ''}. Columns: ${result.columns.join(', ')}\n${preview}`,
      );
    }),
  );
}
