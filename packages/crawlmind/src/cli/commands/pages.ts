import { Option, type Command } from 'commander';
import type { LinkPlacement, TopPagesBy } from '../../core/index.js';
import type { CliContext } from '../context.js';
import {
  displayUrl,
  formatDuration,
  formatNumber,
  terminalWidth,
  truncateMiddle,
} from '../ui/format.js';
import { severityBadge } from '../ui/issues.js';
import { renderFields, renderTable } from '../ui/table.js';
import { resolveCrawlId } from './audit.js';

const crawlOption = () => new Option('-C, --crawl <id>', 'crawl id (default: the latest)');
const intArg = (v: string) => Number.parseInt(v, 10);

/** Accept full URLs or paths relative to the crawled site. */
function absolute(ctx: CliContext, crawlId: string, url: string): string {
  return /^https?:\/\//i.test(url)
    ? url
    : new URL(url, ctx.engine.crawls.requireCrawl(crawlId).site).toString();
}

function statusColor(ctx: CliContext, status: number | null): string {
  const { c } = ctx.theme;
  if (status === null) return c.red('—');
  if (status >= 400) return c.red(String(status));
  if (status >= 300) return c.yellow(String(status));
  return c.green(String(status));
}

export function registerPageCommands(program: Command, getContext: () => CliContext): void {
  program
    .command('page')
    .description('Everything known about one URL')
    .argument('<url>', 'URL or path, e.g. /pricing')
    .addOption(crawlOption())
    .action((url: string, opts: { crawl?: string }) => {
      const ctx = getContext();
      const crawlId = resolveCrawlId(ctx, opts.crawl);
      const page = ctx.engine.audit.page(crawlId, absolute(ctx, crawlId, url));
      if (ctx.json) return ctx.printJson(page);
      const { c } = ctx.theme;
      const m = page.metrics;
      const fields: [string, string][] = [
        ['URL', c.bold(page.url)],
        [
          'Status',
          `${statusColor(ctx, page.status)}${page.fetchError ? `  ${c.red(page.fetchError)}` : ''}${page.blockedByRobots ? c.yellow('  blocked by robots.txt') : ''}`,
        ],
      ];
      if (page.redirectChain.length > 1) {
        fields.push([
          'Redirects',
          page.redirectChain.map((h) => `${h.status} ${h.url}`).join(c.dim(' → ')),
        ]);
      }
      if (page.indexable !== null)
        fields.push(['Indexable', page.indexable ? c.green('yes') : c.yellow('no')]);
      if (page.title !== null) fields.push(['Title', page.title]);
      if (page.metaDescription)
        fields.push(['Description', truncateMiddle(page.metaDescription, terminalWidth() - 18)]);
      if (page.h1.length) fields.push(['H1', page.h1.join(c.dim(' | '))]);
      if (page.canonical)
        fields.push(['Canonical', page.canonical === page.url ? c.dim('self') : page.canonical]);
      if (page.metaRobots) fields.push(['Robots', page.metaRobots]);
      if (page.wordCount !== null) fields.push(['Words', formatNumber(page.wordCount)]);
      if (page.ttfbMs !== null) {
        fields.push([
          'Speed',
          `TTFB ${formatDuration(page.ttfbMs)}, download ${formatDuration(page.downloadMs)}, ${formatNumber(page.htmlBytes ?? 0)} bytes`,
        ]);
      }
      if (m) {
        fields.push([
          'Inlinks',
          `${formatNumber(m.inlinks)} from ${formatNumber(m.uniqueInlinks)} pages, ${formatNumber(m.mainInlinks)} in content`,
        ]);
        fields.push([
          'Outlinks',
          `${formatNumber(m.outlinks)} internal, ${formatNumber(m.externalOutlinks)} external`,
        ]);
        fields.push([
          'Depth',
          m.clickDepth === null ? c.yellow('not reachable by links') : `${m.clickDepth} clicks`,
        ]);
        if (m.pagerankScore !== null) fields.push(['PageRank', `${m.pagerankScore} / 100`]);
      }
      fields.push(['Sitemap', page.inSitemap ? 'listed' : c.dim('not listed')]);
      ctx.out(renderFields(ctx.theme, fields));
      if (page.issues.length) {
        ctx.out('');
        for (const issue of page.issues) {
          const detail = issue.detail ? c.dim(`  ${issue.detail}`) : '';
          ctx.out(`  ${severityBadge(ctx.theme, issue.severity)} ${issue.title}${detail}`);
        }
      }
    });

  program
    .command('links')
    .description('Inlinks (default) or outlinks of a URL')
    .argument('<url>', 'URL or path')
    .addOption(crawlOption())
    .option('--out', 'show outlinks instead of inlinks')
    .option('--content-only', 'skip links in nav, header and footer')
    .addOption(
      new Option('--placement <where>', 'only links in this part of the page').choices([
        'nav',
        'header',
        'footer',
        'main',
        'other',
      ]),
    )
    .option('-l, --limit <n>', 'rows to show', intArg, 50)
    .option('--offset <n>', 'rows to skip', intArg, 0)
    .action(
      (
        url: string,
        opts: {
          crawl?: string;
          out?: boolean;
          contentOnly?: boolean;
          placement?: LinkPlacement;
          limit: number;
          offset: number;
        },
      ) => {
        const ctx = getContext();
        const crawlId = resolveCrawlId(ctx, opts.crawl);
        const site = ctx.engine.crawls.requireCrawl(crawlId).site;
        const direction = opts.out ? 'out' : 'in';
        const page = ctx.engine.audit.links(crawlId, absolute(ctx, crawlId, url), {
          direction,
          placement: opts.placement,
          excludeNavFooter: opts.contentOnly,
          limit: opts.limit,
          offset: opts.offset,
        });
        if (ctx.json) return ctx.printJson(page);
        const { c } = ctx.theme;
        if (page.total === 0) {
          ctx.out(
            direction === 'in' ? '  No internal links point here.' : '  No links on this page.',
          );
          return;
        }
        const width = terminalWidth();
        const head =
          direction === 'in' ? ['From', 'Anchor', 'Where'] : ['To', 'Anchor', 'Where', 'Status'];
        ctx.out(
          renderTable(
            ctx.theme,
            head,
            page.items.map((l) => {
              const row = [
                truncateMiddle(
                  displayUrl(direction === 'in' ? l.source : l.target, site),
                  Math.floor(width * 0.45),
                ),
                truncateMiddle(l.anchor || c.dim('(empty)'), Math.floor(width * 0.3)) +
                  (l.rel ? c.dim(` ${l.rel}`) : ''),
                l.placement,
              ];
              return direction === 'out' ? [...row, statusColor(ctx, l.targetStatus)] : row;
            }),
          ),
        );
        const shown = opts.offset + page.items.length;
        ctx.out(
          c.dim(
            `\n  ${formatNumber(page.total)} ${direction === 'in' ? 'inlinks' : 'outlinks'}${page.total > shown ? `, more with --offset ${shown}` : ''}`,
          ),
        );
      },
    );

  program
    .command('top')
    .description('Rank pages by PageRank, inlinks, depth or TTFB; "underlinked" finds link targets')
    .addOption(crawlOption())
    .addOption(
      new Option('--by <metric>', 'ranking')
        .choices(['pagerank', 'inlinks', 'depth', 'ttfb', 'underlinked'])
        .default('pagerank'),
    )
    .option('-l, --limit <n>', 'rows to show', intArg, 20)
    .action((opts: { crawl?: string; by: TopPagesBy; limit: number }) => {
      const ctx = getContext();
      const crawlId = resolveCrawlId(ctx, opts.crawl);
      const site = ctx.engine.crawls.requireCrawl(crawlId).site;
      const page = ctx.engine.audit.topPages(crawlId, opts.by, { limit: opts.limit, offset: 0 });
      if (ctx.json) return ctx.printJson(page);
      if (page.items.length === 0) {
        ctx.out(
          opts.by === 'underlinked' ? '  No important pages lack internal links.' : '  No pages.',
        );
        return;
      }
      ctx.out(
        renderTable(
          ctx.theme,
          ['#', 'Page', 'PageRank', 'Inlinks', 'In content', 'Depth', 'TTFB'],
          page.items.map((p, i) => [
            ctx.theme.c.dim(String(i + 1)),
            truncateMiddle(displayUrl(p.url, site), Math.floor(terminalWidth() * 0.45)),
            p.pagerankScore ?? '—',
            formatNumber(p.inlinks),
            formatNumber(p.mainInlinks),
            p.clickDepth ?? '—',
            formatDuration(p.ttfbMs),
          ]),
          ['right', 'left', 'right', 'right', 'right', 'right', 'right'],
        ),
      );
    });
}
