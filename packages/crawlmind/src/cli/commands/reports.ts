import { Option, type Command } from 'commander';
import {
  CrawlmindError,
  type CrawlDiff,
  type DiffList,
  type ReportFormat,
} from '../../core/index.js';
import type { CliContext } from '../context.js';
import { displayUrl, formatNumber, terminalWidth, truncateMiddle } from '../ui/format.js';
import { severityBadge } from '../ui/issues.js';
import { resolveCrawlId } from './audit.js';

/** The two most recent finished crawls of the latest crawled site. */
function latestPair(ctx: CliContext): [string, string] {
  const latest = ctx.engine.crawls.requireCrawl(ctx.engine.audit.latestCrawlId());
  const crawls = ctx.engine.store
    .listCrawls({ site: latest.site, limit: 20, offset: 0 })
    .items.filter((c) => c.status === 'completed' || c.status === 'cancelled');
  if (crawls.length < 2) {
    throw new CrawlmindError(
      'not_found',
      `Only one finished crawl of ${latest.site}.`,
      'Crawl it again to compare.',
    );
  }
  return [(crawls[1] as { crawlId: string }).crawlId, (crawls[0] as { crawlId: string }).crawlId];
}

function printDiff(ctx: CliContext, d: CrawlDiff): void {
  const { c, sym } = ctx.theme;
  const site = d.after.site;
  const width = terminalWidth() - 8;
  ctx.out(
    `${c.bold(new URL(site).host)}  ${c.dim(`${d.before.crawlId} (${d.before.startedAt.slice(0, 10)}, ${d.before.pagesCrawled} pages)`)} ${c.dim(sym.arrow)} ${c.dim(`${d.after.crawlId} (${d.after.startedAt.slice(0, 10)}, ${d.after.pagesCrawled} pages)`)}`,
  );
  if (d.warning) ctx.out(c.yellow(`  ${sym.warn} ${d.warning}`));

  const section = <T>(
    title: string,
    list: DiffList<T>,
    color: (s: string) => string,
    line: (x: T) => string,
  ) => {
    if (list.total === 0) return;
    ctx.out(`\n  ${color(c.bold(title))} ${c.dim(formatNumber(list.total))}`);
    for (const x of list.items.slice(0, 10)) ctx.out(`    ${truncateMiddle(line(x), width)}`);
    if (list.total > 10)
      ctx.out(c.dim(`    … ${formatNumber(list.total - 10)} more (use --json for all)`));
  };
  const u = (url: string) => displayUrl(url, site);
  section(
    'New errors',
    d.newErrors,
    c.red,
    (x) => `${u(x.url)}  ${x.before ?? 'new'} ${sym.arrow} ${x.after}`,
  );
  section(
    'New broken links',
    d.newBrokenLinks,
    c.red,
    (x) => `${u(x.source)}  ${x.detail.replaceAll(site, '')}`,
  );
  section(
    'TTFB regressions',
    d.ttfbRegressions,
    c.yellow,
    (x) => `${u(x.url)}  ${Math.round(x.beforeMs)} ${sym.arrow} ${Math.round(x.afterMs)} ms`,
  );
  section(
    'Lost inlinks',
    d.inlinksLost,
    c.yellow,
    (x) => `${u(x.url)}  ${x.before} ${sym.arrow} ${x.after}`,
  );
  section(
    'Title changes',
    d.titleChanges,
    c.cyan,
    (x) => `${u(x.url)}  "${x.before ?? ''}" ${sym.arrow} "${x.after ?? ''}"`,
  );
  section(
    'Canonical changes',
    d.canonicalChanges,
    c.cyan,
    (x) => `${u(x.url)}  ${x.before ?? 'none'} ${sym.arrow} ${x.after ?? 'none'}`,
  );
  section(
    'Fixed errors',
    d.fixedErrors,
    c.green,
    (x) => `${u(x.url)}  ${x.before} ${sym.arrow} ${x.after}`,
  );
  section(
    'Fixed broken links',
    d.fixedBrokenLinks,
    c.green,
    (x) => `${u(x.source)}  ${x.detail.replaceAll(site, '')}`,
  );
  section(
    'Gained inlinks',
    d.inlinksGained,
    c.green,
    (x) => `${u(x.url)}  ${x.before} ${sym.arrow} ${x.after}`,
  );
  section('Pages added', d.pagesAdded, c.cyan, u);
  section('Pages removed', d.pagesRemoved, c.cyan, u);
  const changed =
    d.issueCounts.length > 0 ||
    [
      d.newErrors,
      d.fixedErrors,
      d.newBrokenLinks,
      d.fixedBrokenLinks,
      d.inlinksLost,
      d.inlinksGained,
      d.ttfbRegressions,
      d.titleChanges,
      d.canonicalChanges,
      d.pagesAdded,
      d.pagesRemoved,
    ].some((l) => l.total > 0);
  if (!changed) ctx.out(`\n  ${c.green(sym.ok)} No differences.`);
  if (d.issueCounts.length) {
    ctx.out(`\n  ${c.bold('Issue counts')}`);
    for (const x of d.issueCounts) {
      const delta = x.after - x.before;
      const shown = delta > 0 ? c.red(`+${delta}`) : c.green(String(delta));
      ctx.out(
        `    ${severityBadge(ctx.theme, x.severity)} ${x.title}  ${x.before} ${sym.arrow} ${x.after} ${shown}`,
      );
    }
  }
}

export function registerReportCommands(program: Command, getContext: () => CliContext): void {
  program
    .command('diff')
    .description('Compare two crawls of a site (default: the two latest)')
    .argument('[before]', 'older crawl id')
    .argument('[after]', 'newer crawl id')
    .option('-l, --limit <n>', 'items per section in JSON', (v) => Number.parseInt(v, 10), 50)
    .action((before: string | undefined, after: string | undefined, opts: { limit: number }) => {
      const ctx = getContext();
      if ((before && !after) || (!before && after)) {
        throw new CrawlmindError(
          'invalid_input',
          'Give both crawl ids, or none to compare the two latest.',
        );
      }
      const [a, b] = before && after ? [before, after] : latestPair(ctx);
      const diff = ctx.engine.compare(a, b, opts.limit);
      if (ctx.json) return ctx.printJson(diff);
      printDiff(ctx, diff);
    });

  program
    .command('report')
    .description('Write an HTML or Markdown report of a crawl')
    .argument('[crawl]', 'crawl id (default: the latest)')
    .addOption(
      new Option('-f, --format <format>', 'report format').choices(['html', 'md']).default('html'),
    )
    .option(
      '-o, --output <file>',
      'file to write (default: ~/.crawlmind/reports/<site>-<crawl>.html)',
    )
    .option('--overwrite', 'replace the file if it exists')
    .action(
      (
        crawl: string | undefined,
        opts: { format: 'html' | 'md'; output?: string; overwrite?: boolean },
      ) => {
        const ctx = getContext();
        const format: ReportFormat = opts.format === 'md' ? 'markdown' : 'html';
        const result = ctx.engine.exportReport(resolveCrawlId(ctx, crawl), {
          format,
          path: opts.output,
          overwrite: opts.overwrite,
        });
        if (ctx.json) return ctx.printJson(result);
        ctx.out(
          `  ${ctx.theme.c.green(ctx.theme.sym.ok)} Wrote ${result.path} ${ctx.theme.c.dim(`(${Math.round(result.bytes / 1024)} KB)`)}`,
        );
      },
    );
}
