import type { Command } from 'commander';
import type { CrawlInfo } from '../../core/index.js';
import type { CliContext } from '../context.js';
import { formatAgo, formatDuration, formatNumber } from '../ui/format.js';
import { renderTable } from '../ui/table.js';
import type { Theme } from '../ui/theme.js';

export function statusLabel(theme: Theme, status: CrawlInfo['status']): string {
  const { c } = theme;
  switch (status) {
    case 'completed':
      return c.green(status);
    case 'running':
      return c.cyan(status);
    case 'cancelled':
    case 'interrupted':
      return c.yellow(status);
    default:
      return c.red(status);
  }
}

export function registerCrawlsCommand(program: Command, getContext: () => CliContext): void {
  program
    .command('crawls')
    .description('List past crawls, newest first')
    .option('--site <origin>', 'only crawls of this site, e.g. https://example.com')
    .option('--limit <n>', 'how many to show', (v) => Number.parseInt(v, 10), 20)
    .action((opts: { site?: string; limit: number }) => {
      const ctx = getContext();
      const site = opts.site ? new URL(opts.site).origin : undefined;
      const page = ctx.engine.store.listCrawls({ site, limit: opts.limit, offset: 0 });
      if (ctx.json) return ctx.printJson(page);
      if (page.items.length === 0) {
        ctx.out(`No crawls yet. Start one with ${ctx.theme.c.bold('crawlmind crawl <url>')}`);
        return;
      }
      ctx.out(
        renderTable(
          ctx.theme,
          ['ID', 'Site', 'Status', 'Pages', 'Duration', 'Started'],
          page.items.map((crawl) => [
            ctx.theme.c.bold(crawl.crawlId),
            crawl.site,
            statusLabel(ctx.theme, crawl.status),
            formatNumber(crawl.pagesCrawled),
            formatDuration(crawl.durationMs),
            formatAgo(crawl.startedAt),
          ]),
          ['left', 'left', 'left', 'right', 'right', 'left'],
        ),
      );
      if (page.total > page.items.length) {
        ctx.out(ctx.theme.c.dim(`\n  ${page.total - page.items.length} older crawl(s) not shown`));
      }
    });
}
