import { Option, type Command } from 'commander';
import { SEVERITY_ORDER, type Severity } from '../../core/index.js';
import type { CliContext } from '../context.js';
import { displayUrl, formatNumber, terminalWidth, truncateMiddle } from '../ui/format.js';
import { renderIssue, renderSummary, severityBadge } from '../ui/issues.js';
import { renderTable } from '../ui/table.js';

const severityOption = () =>
  new Option('-s, --severity <level>', 'only this severity').choices([
    'critical',
    'warning',
    'info',
  ]);

export function resolveCrawlId(ctx: CliContext, crawlId?: string): string {
  return crawlId ?? ctx.engine.audit.latestCrawlId();
}

export function hint(ctx: CliContext, command: string): void {
  ctx.out(`\n  ${ctx.theme.c.dim('Next')}  ${command}`);
}

/** Number of issues at `level` or worse. */
export function countAtLeast(counts: Record<Severity, number>, level: Severity): number {
  return (Object.keys(counts) as Severity[])
    .filter((s) => SEVERITY_ORDER[s] <= SEVERITY_ORDER[level])
    .reduce((sum, s) => sum + counts[s], 0);
}

export function printSummary(ctx: CliContext, crawlId: string): void {
  const summary = ctx.engine.audit.summary(crawlId);
  if (ctx.json) return ctx.printJson(summary);
  ctx.out(renderSummary(ctx.theme, summary));
  const next = summary.issueCounts.critical
    ? `crawlmind issues ${crawlId} --severity critical`
    : `crawlmind issues ${crawlId}`;
  hint(ctx, next);
}

export function registerAuditCommands(program: Command, getContext: () => CliContext): void {
  program
    .command('summary')
    .description('Key numbers and top issues of a crawl (default: the latest)')
    .argument('[crawl]', 'crawl id')
    .action((crawl?: string) => {
      const ctx = getContext();
      printSummary(ctx, resolveCrawlId(ctx, crawl));
    });

  program
    .command('issues')
    .description('Issues of a crawl; with --check, every URL affected by one check')
    .argument('[crawl]', 'crawl id (default: the latest)')
    .addOption(severityOption())
    .option('--check <id>', 'list every URL for this check, e.g. links.broken_internal')
    .option('-l, --limit <n>', 'rows to show', (v) => Number.parseInt(v, 10), 50)
    .option('--offset <n>', 'rows to skip', (v) => Number.parseInt(v, 10), 0)
    .action(
      (
        crawl: string | undefined,
        opts: { severity?: Severity; check?: string; limit: number; offset: number },
      ) => {
        const ctx = getContext();
        const crawlId = resolveCrawlId(ctx, crawl);
        const site = ctx.engine.crawls.requireCrawl(crawlId).site;
        const { c } = ctx.theme;

        if (opts.check) {
          const { issue, items } = ctx.engine.audit.issueItems(crawlId, opts.check, opts);
          if (ctx.json) return ctx.printJson({ issue, ...items });
          ctx.out(
            `  ${severityBadge(ctx.theme, issue.severity)} ${c.bold(issue.title)}  ${c.dim(`${formatNumber(issue.count)} total`)}`,
          );
          ctx.out(`  ${c.dim(issue.recommendation)}\n`);
          const width = terminalWidth();
          ctx.out(
            renderTable(
              ctx.theme,
              ['URL', 'Detail'],
              items.items.map((i) => [
                truncateMiddle(displayUrl(i.url, site), Math.floor(width * 0.4)),
                truncateMiddle((i.detail ?? '').replaceAll(site, ''), Math.floor(width * 0.55)),
              ]),
            ),
          );
          const shown = opts.offset + items.items.length;
          if (items.total > shown)
            ctx.out(c.dim(`\n  ${items.total - shown} more: --offset ${shown}`));
          return;
        }

        const page = ctx.engine.audit.issues(crawlId, {
          severity: opts.severity,
          limit: opts.limit,
          offset: opts.offset,
        });
        if (ctx.json) return ctx.printJson(page);
        if (page.items.length === 0) {
          ctx.out(
            `  ${c.green(ctx.theme.sym.ok)} No issues${opts.severity ? ` with severity ${opts.severity}` : ''}.`,
          );
          return;
        }
        ctx.out(page.items.map((issue) => renderIssue(ctx.theme, issue, site, 3)).join('\n\n'));
        hint(ctx, `crawlmind issues ${crawlId} --check ${page.items[0]?.id}`);
      },
    );
}
