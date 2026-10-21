import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CHECKS, CHECKS_BY_ID, describeError, type CheckInfo } from '../core/index.js';
import type { ToolContext } from './context.js';
import { describeSummary } from './format.js';

function checkMarkdown(check: CheckInfo): string {
  return [
    `# ${check.title}`,
    '',
    `- **ID:** \`${check.id}\``,
    `- **Severity:** ${check.severity}`,
    '',
    '## Why it matters',
    '',
    check.why,
    '',
    '## How to fix',
    '',
    check.fix,
  ].join('\n');
}

export function registerResources(server: McpServer, { engine }: ToolContext): void {
  server.registerResource(
    'check',
    new ResourceTemplate('crawlmind://checks/{id}', {
      list: () => ({
        resources: CHECKS.map((c) => ({
          uri: `crawlmind://checks/${c.id}`,
          name: c.id,
          title: c.title,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      title: 'Check documentation',
      description: 'Why each Crawlmind check matters and how to fix what it finds.',
      mimeType: 'text/markdown',
    },
    (uri, { id }) => {
      const check = CHECKS_BY_ID.get(String(id));
      const text = check ? checkMarkdown(check) : `Unknown check "${String(id)}".`;
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );

  server.registerResource(
    'crawl-summary',
    new ResourceTemplate('crawlmind://crawls/{id}/summary', {
      list: () => ({
        resources: engine.store
          .listCrawls({ limit: 20, offset: 0 })
          .items.filter((c) => c.status !== 'running')
          .map((c) => ({
            uri: `crawlmind://crawls/${c.crawlId}/summary`,
            name: `${c.crawlId} ${c.site}`,
            title: `Crawl ${c.crawlId} of ${c.site}`,
            mimeType: 'text/plain',
          })),
      }),
    }),
    {
      title: 'Crawl summary',
      description: 'Key numbers and top issues of a crawl.',
      mimeType: 'text/plain',
    },
    (uri, { id }) => {
      let text: string;
      try {
        text = describeSummary(engine.audit.summary(String(id)));
      } catch (error) {
        text = describeError(error);
      }
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
    },
  );
}
