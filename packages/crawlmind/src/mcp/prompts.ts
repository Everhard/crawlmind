import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const user = (text: string) => ({
  messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
});

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'seo_audit',
    {
      title: 'SEO audit',
      description:
        'Full technical SEO audit of a site with Crawlmind, ending in a prioritized fix list.',
      argsSchema: {
        url: z.string().describe('Site to audit, e.g. https://example.com'),
        max_pages: z.string().optional().describe('Crawl size, default 500'),
      },
    },
    ({ url, max_pages }) =>
      user(
        [
          `Run a technical SEO audit of ${url} with the Crawlmind tools.`,
          `1. start_crawl with url=${url}${max_pages ? ` and maxPages=${max_pages}` : ''}; then call get_crawl_status with wait_seconds=60 until it is completed.`,
          '2. get_summary. For every critical issue and the largest warnings, call get_issues with check_id to see all affected URLs, and read crawlmind://checks/<id> when the fix is unclear.',
          '3. get_top_pages with by=underlinked, and get_templates for speed per template. If templates look slow, call measure_templates for the largest ones.',
          '4. If list_crawls shows an earlier crawl of this site, compare_crawls to report regressions.',
          '5. Write the result: a short verdict, then the top 10 fixes ordered by impact, each with the affected URLs (or the template), why it matters and the concrete change. Group fixes that share a template, menu or footer, since one change fixes all of those pages.',
          '6. Offer to export_report the full HTML report.',
        ].join('\n'),
      ),
  );

  server.registerPrompt(
    'internal_linking_plan',
    {
      title: 'Internal linking plan',
      description: 'Turn Crawlmind link suggestions into a concrete plan of links to add.',
      argsSchema: {
        url: z.string().describe('Site to plan for, e.g. https://example.com'),
        crawl_id: z
          .string()
          .optional()
          .describe('Existing crawl to use; otherwise the site is crawled'),
      },
    },
    ({ url, crawl_id }) =>
      user(
        [
          `Build an internal linking plan for ${url}.`,
          crawl_id
            ? `Use crawl ${crawl_id}.`
            : 'Find a recent completed crawl of this site with list_crawls, or start one with start_crawl and wait for it with get_crawl_status.',
          'Then:',
          '1. Call get_top_pages with by=underlinked to find important pages that lack content links.',
          '2. Call suggest_links (without target_url, then with target_url for the top 3 under-linked pages).',
          '3. Call find_cannibalization and note pages that should not both receive links for the same topic.',
          '4. Write the plan as a table: source page, target page, the exact sentence to add or edit (based on the paragraph returned), and the anchor text. Prefer the anchor candidates; keep anchors natural and descriptive, never "click here".',
          'Limit each source page to 3 new links, group rows by target, and start with the links that help the most important pages.',
        ].join('\n'),
      ),
  );
}
