import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CrawlDiff, DiffList } from '../../core/index.js';
import type { ToolContext } from '../context.js';
import { safe, toolResult } from '../result.js';

const crawlId = z.string().min(1);

function section<T>(title: string, list: DiffList<T>, line: (item: T) => string): string[] {
  if (list.total === 0) return [];
  const rest = list.total - list.items.length;
  return [
    `${title} (${list.total}):`,
    ...list.items.map((x) => `- ${line(x)}`),
    ...(rest > 0 ? [`- …${rest} more`] : []),
    '',
  ];
}

export function describeDiff(d: CrawlDiff): string {
  const lines = [
    `Comparing crawl ${d.before.crawlId} (${d.before.startedAt.slice(0, 10)}, ${d.before.pagesCrawled} pages) with ${d.after.crawlId} (${d.after.startedAt.slice(0, 10)}, ${d.after.pagesCrawled} pages) of ${d.after.site}.`,
    ...(d.warning ? [`Note: ${d.warning}`] : []),
    '',
    ...section('New errors', d.newErrors, (x) => `${x.url}: ${x.before ?? 'new'} → ${x.after}`),
    ...section('Fixed errors', d.fixedErrors, (x) => `${x.url}: ${x.before} → ${x.after}`),
    ...section('New broken links', d.newBrokenLinks, (x) => `on ${x.source} ${x.detail}`),
    ...section('Fixed broken links', d.fixedBrokenLinks, (x) => `on ${x.source} ${x.detail}`),
    ...section(
      'Pages that lost inlinks',
      d.inlinksLost,
      (x) => `${x.url}: ${x.before} → ${x.after}`,
    ),
    ...section(
      'Pages that gained inlinks',
      d.inlinksGained,
      (x) => `${x.url}: ${x.before} → ${x.after}`,
    ),
    ...section(
      'TTFB regressions',
      d.ttfbRegressions,
      (x) => `${x.url}: ${Math.round(x.beforeMs)} → ${Math.round(x.afterMs)} ms`,
    ),
    ...section(
      'Title changes',
      d.titleChanges,
      (x) => `${x.url}: "${x.before ?? ''}" → "${x.after ?? ''}"`,
    ),
    ...section(
      'Canonical changes',
      d.canonicalChanges,
      (x) => `${x.url}: ${x.before ?? 'none'} → ${x.after ?? 'none'}`,
    ),
    ...section('Pages added', d.pagesAdded, (x) => x),
    ...section('Pages removed', d.pagesRemoved, (x) => x),
  ];
  if (d.issueCounts.length) {
    lines.push(
      'Issue counts:',
      ...d.issueCounts.map((c) => `- [${c.severity}] ${c.title}: ${c.before} → ${c.after}`),
    );
  }
  return lines.join('\n').trim() || 'No differences.';
}

export function registerReportTools(server: McpServer, { engine }: ToolContext): void {
  server.registerTool(
    'compare_crawls',
    {
      title: 'Compare crawls',
      description:
        'Diff two crawls of the same site (order does not matter; the older one is "before"): ' +
        'new and fixed errors and broken links, pages added and removed, pages that gained or ' +
        'lost the most inlinks, TTFB regressions, title and canonical changes, and issue counts.',
      inputSchema: {
        crawl_a: crawlId.describe('One crawl id'),
        crawl_b: crawlId.describe('The other crawl id'),
        limit: z.number().int().min(1).max(200).default(20).describe('Items per section'),
      },
      outputSchema: {
        before: z.looseObject({ crawlId: z.string() }),
        after: z.looseObject({ crawlId: z.string() }),
        warning: z.string().nullable(),
        newErrors: z.looseObject({ total: z.number() }),
        newBrokenLinks: z.looseObject({ total: z.number() }),
        issueCounts: z.array(z.looseObject({ checkId: z.string() })),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(({ crawl_a, crawl_b, limit }) => {
      const diff = engine.compare(crawl_a, crawl_b, limit);
      return toolResult(diff, describeDiff(diff));
    }),
  );

  server.registerTool(
    'export_report',
    {
      title: 'Export report',
      description:
        'Write a self-contained HTML or Markdown audit report (summary, all issues with examples, ' +
        'under-linked pages, speed by template, strongest and slowest pages) to a file. The path ' +
        'must end in .html/.md; existing files are kept unless overwrite=true. Without a path the ' +
        'report goes to ~/.crawlmind/reports.',
      inputSchema: {
        crawl_id: crawlId,
        format: z.enum(['html', 'markdown']).default('html'),
        path: z.string().optional().describe('Absolute file path, e.g. /home/me/audit.html'),
        overwrite: z.boolean().default(false),
      },
      outputSchema: { path: z.string(), format: z.enum(['html', 'markdown']), bytes: z.number() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(({ crawl_id, format, path, overwrite }) => {
      const result = engine.exportReport(crawl_id, { format, path, overwrite });
      return toolResult(
        result,
        `Wrote ${format} report (${Math.round(result.bytes / 1024)} KB) to ${result.path}`,
      );
    }),
  );
}
