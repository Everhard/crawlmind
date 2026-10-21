import { InvalidArgumentError, type Command } from 'commander';
import {
  CRAWL_DEFAULTS,
  CRAWL_LIMITS,
  type CrawlInfo,
  type CrawlProgress,
} from '../../core/index.js';
import type { CliContext } from '../context.js';
import {
  displayUrl,
  formatDuration,
  formatNumber,
  terminalWidth,
  truncateMiddle,
} from '../ui/format.js';
import { createProgressLine } from '../ui/progress.js';
import { renderFields } from '../ui/table.js';

function intOption(min: number, max: number) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new InvalidArgumentError(`expected an integer from ${min} to ${max}`);
    }
    return n;
  };
}

interface CrawlCommandOptions {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  delay: number;
  subdomains?: boolean;
  external: boolean;
  robots: boolean;
  allowPrivate?: boolean;
}

export function registerCrawlCommand(program: Command, getContext: () => CliContext): void {
  program
    .command('crawl')
    .description('Crawl a website and store the results locally')
    .argument('<url>', 'start URL, e.g. https://example.com')
    .option(
      '-n, --max-pages <n>',
      'maximum pages to fetch',
      intOption(1, CRAWL_LIMITS.maxPages),
      CRAWL_DEFAULTS.maxPages,
    )
    .option(
      '-d, --max-depth <n>',
      'maximum link depth',
      intOption(0, CRAWL_LIMITS.maxDepth),
      CRAWL_DEFAULTS.maxDepth,
    )
    .option(
      '-c, --concurrency <n>',
      'parallel requests',
      intOption(1, CRAWL_LIMITS.concurrency),
      CRAWL_DEFAULTS.concurrency,
    )
    .option(
      '--delay <ms>',
      'delay between requests to one host',
      intOption(0, CRAWL_LIMITS.delayMs),
      CRAWL_DEFAULTS.delayMs,
    )
    .option('--subdomains', 'treat subdomains as part of the site')
    .option('--no-external', 'skip checking external links')
    .option('--no-robots', 'ignore robots.txt')
    .option('--allow-private', 'allow localhost and private network addresses')
    .action(async (url: string, opts: CrawlCommandOptions) => {
      const ctx = getContext();
      const crawl = ctx.engine.crawls.start({
        url,
        maxPages: opts.maxPages,
        maxDepth: opts.maxDepth,
        concurrency: opts.concurrency,
        delayMs: opts.delay,
        includeSubdomains: Boolean(opts.subdomains),
        checkExternalLinks: opts.external,
        respectRobots: opts.robots,
        allowPrivateNetworks: Boolean(opts.allowPrivate),
      });
      const finished = await followCrawl(ctx, crawl);
      if (ctx.json) ctx.printJson(ctx.engine.crawls.status(finished.crawlId));
      else printCrawlResult(ctx, finished);
      if (finished.status === 'failed') process.exitCode = 1;
    });
}

/** Show live progress on stderr until the crawl ends. Ctrl+C cancels, twice quits. */
async function followCrawl(ctx: CliContext, crawl: CrawlInfo): Promise<CrawlInfo> {
  const { c, sym } = ctx.theme;
  const spinner = createProgressLine(ctx.theme, `Starting crawl of ${crawl.site}`);
  const startedAt = Date.now();
  let cancelling = false;

  const onSigint = () => {
    if (cancelling) process.exit(130);
    cancelling = true;
    ctx.engine.crawls.cancel(crawl.crawlId);
    spinner.update('Cancelling… keeping pages fetched so far (Ctrl+C again to quit)');
  };
  process.on('SIGINT', onSigint);

  const render = (p: CrawlProgress) => {
    if (cancelling) return;
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = elapsed > 0 ? (p.pagesCrawled / elapsed).toFixed(1) : '0.0';
    const errors = p.errors > 0 ? c.red(`${p.errors} errors`) : c.dim('0 errors');
    let text: string;
    switch (p.phase) {
      case 'starting':
      case 'sitemaps':
        text = `Reading robots.txt and sitemaps of ${crawl.site}`;
        break;
      case 'external':
        text = `Checking external links ${c.dim(sym.dot)} ${formatNumber(p.externalChecked)} checked`;
        break;
      case 'analyzing':
        text = 'Analyzing';
        break;
      default:
        text = `${c.bold(formatNumber(p.pagesCrawled))}${c.dim(`/${formatNumber(p.maxPages)}`)} pages ${c.dim(sym.dot)} ${errors} ${c.dim(sym.dot)} ${rate} pages/s`;
    }
    if (p.currentUrl) {
      const room = Math.max(10, terminalWidth() - stripAnsi(text).length - 8);
      text += `  ${c.dim(truncateMiddle(displayUrl(p.currentUrl, crawl.site), room))}`;
    }
    spinner.update(text);
  };

  try {
    await ctx.engine.crawls.waitFor(crawl.crawlId, Number.POSITIVE_INFINITY, render);
  } finally {
    process.off('SIGINT', onSigint);
  }

  const done = ctx.engine.crawls.requireCrawl(crawl.crawlId);
  const summary = `${formatNumber(done.pagesCrawled)} pages in ${formatDuration(done.durationMs)}`;
  if (done.status === 'completed') spinner.succeed(`Crawled ${summary}`);
  else if (done.status === 'cancelled') spinner.warn(`Cancelled after ${summary}`);
  else spinner.fail(`Crawl failed: ${done.error ?? 'unknown error'}`);
  return done;
}

function printCrawlResult(ctx: CliContext, crawl: CrawlInfo): void {
  const { c } = ctx.theme;
  const statusColor =
    crawl.status === 'completed' ? c.green : crawl.status === 'cancelled' ? c.yellow : c.red;
  ctx.out();
  ctx.out(
    renderFields(ctx.theme, [
      ['Crawl', c.bold(crawl.crawlId)],
      ['Site', crawl.site],
      ['Status', statusColor(crawl.status)],
      ['Pages', formatNumber(crawl.pagesCrawled)],
      ['Duration', formatDuration(crawl.durationMs)],
    ]),
  );
  ctx.out();
  ctx.out(`  ${c.dim('Next')}  crawlmind crawls --site ${crawl.site}`);
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
