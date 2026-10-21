import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const user = (text: string) => ({
  messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
});

export function registerPrompts(server: McpServer): void {
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
