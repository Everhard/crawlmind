import { Option, type Command } from 'commander';
import type { PsiMeasurement, PsiStrategy, TemplateInfo } from '../../core/index.js';
import type { CliContext } from '../context.js';
import {
  displayUrl,
  formatDuration,
  formatNumber,
  terminalWidth,
  truncateMiddle,
} from '../ui/format.js';
import { createProgressLine } from '../ui/progress.js';
import { renderTable } from '../ui/table.js';
import type { Theme } from '../ui/theme.js';
import { hint, resolveCrawlId } from './audit.js';

const crawlOption = () => new Option('-C, --crawl <id>', 'crawl id (default: the latest)');
const intArg = (v: string) => Number.parseInt(v, 10);

function scoreColor(theme: Theme, score: number | null): string {
  if (score === null) return '—';
  const text = String(score);
  return score >= 90 ? theme.c.green(text) : score >= 50 ? theme.c.yellow(text) : theme.c.red(text);
}

function lcpColor(theme: Theme, ms: number | null): string {
  if (ms === null) return '—';
  const text = `${(ms / 1000).toFixed(1)} s`;
  return ms <= 2500 ? theme.c.green(text) : ms <= 4000 ? theme.c.yellow(text) : theme.c.red(text);
}

function measurementFor(t: TemplateInfo, strategy: PsiStrategy): PsiMeasurement | undefined {
  return t.measurements.find((m) => m.strategy === strategy && !m.error);
}

function renderTemplates(
  ctx: CliContext,
  items: TemplateInfo[],
  site: string,
  strategy: PsiStrategy,
): string {
  const width = terminalWidth();
  return renderTable(
    ctx.theme,
    ['ID', 'Template', 'Pages', 'Share', 'TTFB p50', 'TTFB p90', 'Score', 'LCP', 'Example'],
    items.map((t) => {
      const m = measurementFor(t, strategy);
      return [
        ctx.theme.c.dim(String(t.templateId)),
        ctx.theme.c.bold(truncateMiddle(t.label, 32)),
        formatNumber(t.pageCount),
        `${t.sharePercent}%`,
        formatDuration(t.ttfbMedianMs),
        formatDuration(t.ttfbP90Ms),
        scoreColor(ctx.theme, m?.performanceScore ?? null),
        lcpColor(ctx.theme, m?.field?.lcpMs ?? m?.lcpMs ?? null),
        ctx.theme.c.dim(
          truncateMiddle(displayUrl(t.representatives[0] ?? '', site), Math.max(20, width - 88)),
        ),
      ];
    }),
    ['right', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'left'],
  );
}

export function registerSpeedCommands(program: Command, getContext: () => CliContext): void {
  program
    .command('templates')
    .description('Page templates (URL pattern + DOM structure) with timing and PageSpeed results')
    .addOption(crawlOption())
    .addOption(
      new Option('--strategy <s>', 'which PageSpeed results to show')
        .choices(['mobile', 'desktop'])
        .default('mobile'),
    )
    .option('-l, --limit <n>', 'rows to show', intArg, 30)
    .action((opts: { crawl?: string; strategy: PsiStrategy; limit: number }) => {
      const ctx = getContext();
      const crawlId = resolveCrawlId(ctx, opts.crawl);
      const site = ctx.engine.crawls.requireCrawl(crawlId).site;
      const page = ctx.engine.speed.templates(crawlId, { limit: opts.limit, offset: 0 });
      if (ctx.json) return ctx.printJson(page);
      if (page.items.length === 0) {
        ctx.out('  No templates: the crawl has no 200 HTML pages.');
        return;
      }
      ctx.out(renderTemplates(ctx, page.items, site, opts.strategy));
      if (page.total > page.items.length)
        ctx.out(
          ctx.theme.c.dim(`\n  ${page.total - page.items.length} smaller templates not shown`),
        );
      if (!page.items.some((t) => t.measurements.length))
        hint(ctx, `crawlmind speed${opts.crawl ? ` -C ${crawlId}` : ''}`);
    });

  program
    .command('speed')
    .description('Run PageSpeed Insights on representatives of the largest templates')
    .addOption(crawlOption())
    .addOption(
      new Option('--strategy <s>', 'device to emulate')
        .choices(['mobile', 'desktop'])
        .default('mobile'),
    )
    .option('-t, --templates <n>', 'how many of the largest templates', intArg, 5)
    .option('--ids <ids>', 'comma-separated template ids instead', (v) =>
      v.split(',').map((x) => Number.parseInt(x, 10)),
    )
    .addOption(
      new Option('--per-template <n>', 'pages per template').choices(['1', '2']).default('1'),
    )
    .option('--force', 'measure again even if results exist')
    .action(
      async (opts: {
        crawl?: string;
        strategy: PsiStrategy;
        templates: number;
        ids?: number[];
        perTemplate: string;
        force?: boolean;
      }) => {
        const ctx = getContext();
        const crawlId = resolveCrawlId(ctx, opts.crawl);
        const site = ctx.engine.crawls.requireCrawl(crawlId).site;
        const { c } = ctx.theme;
        if (!process.env.PSI_API_KEY && !ctx.json) {
          process.stderr.write(
            c.dim('  No PSI_API_KEY set: running one request at a time on the shared quota.\n'),
          );
        }
        const line = createProgressLine(ctx.theme, 'Starting PageSpeed Insights');
        const controller = new AbortController();
        const onSigint = () => controller.abort();
        process.once('SIGINT', onSigint);
        try {
          const results = await ctx.engine.speed.measure(crawlId, {
            strategy: opts.strategy,
            templateIds: opts.ids,
            maxTemplates: opts.templates,
            perTemplate: Number(opts.perTemplate),
            force: Boolean(opts.force),
            signal: controller.signal,
            onProgress: (done, total, url) =>
              line.update(
                `PageSpeed Insights ${c.bold(`${done}/${total}`)}  ${c.dim(truncateMiddle(displayUrl(url, site), 60))}`,
              ),
          });
          line.succeed(`Measured ${results.length} template(s) (${opts.strategy})`);
          if (ctx.json) return ctx.printJson({ results });
          ctx.out();
          ctx.out(
            renderTemplates(
              ctx,
              results.map((r) => r.template),
              site,
              opts.strategy,
            ),
          );
          ctx.out();
          for (const r of results) ctx.out(`  ${c.dim(ctx.theme.sym.arrow)} ${r.insight}`);
        } catch (error) {
          line.fail('PageSpeed Insights failed');
          throw error;
        } finally {
          process.off('SIGINT', onSigint);
        }
      },
    );
}
