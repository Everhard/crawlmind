import type { Command } from 'commander';
import type { CliContext } from '../context.js';
import { displayUrl, formatNumber, terminalWidth, truncateMiddle, wrapText } from '../ui/format.js';
import { createProgressLine, type ProgressLine } from '../ui/progress.js';
import { renderTable } from '../ui/table.js';
import { ensureAddon } from './addon.js';
import { resolveCrawlId } from './audit.js';

const intArg = (v: string) => Number.parseInt(v, 10);

/** Show model download and embedding progress while `task` runs. */
async function withEmbeddingProgress<T>(
  ctx: CliContext,
  task: (line: ProgressLine) => Promise<T>,
): Promise<T> {
  const line = createProgressLine(ctx.theme, 'Preparing embeddings');
  ctx.modelProgress = (event) => {
    if (event.status === 'progress' && event.file && event.progress !== undefined) {
      line.update(
        `Downloading model ${ctx.theme.c.dim(event.file)} ${Math.round(event.progress)}%`,
      );
    }
  };
  try {
    const result = await task(line);
    line.succeed('Embeddings ready');
    return result;
  } catch (error) {
    line.fail('Embeddings failed');
    throw error;
  } finally {
    ctx.modelProgress = null;
  }
}

export function registerSuggestCommands(program: Command, getContext: () => CliContext): void {
  program
    .command('suggest')
    .description('Internal links to add, found with local embeddings')
    .option('-C, --crawl <id>', 'crawl id (default: the latest)')
    .option('-t, --target <url>', 'only links pointing to this URL or path')
    .option('--min-similarity <n>', 'similarity threshold 0–1 (default 0.82)', Number.parseFloat)
    .option('-l, --limit <n>', 'suggestions to show', intArg, 20)
    .action(
      async (opts: { crawl?: string; target?: string; minSimilarity?: number; limit: number }) => {
        const ctx = getContext();
        const crawlId = resolveCrawlId(ctx, opts.crawl);
        const site = ctx.engine.crawls.requireCrawl(crawlId).site;
        const target =
          opts.target && !/^https?:/i.test(opts.target)
            ? new URL(opts.target, site).toString()
            : opts.target;
        await ensureAddon(ctx);
        const page = await withEmbeddingProgress(ctx, (line) =>
          ctx.engine.links.suggest(crawlId, {
            targetUrl: target,
            minSimilarity: opts.minSimilarity,
            limit: opts.limit,
            offset: 0,
            onProgress: (message) => line.update(message),
          }),
        );
        if (ctx.json) return ctx.printJson(page);
        const { c, sym } = ctx.theme;
        if (page.items.length === 0) {
          ctx.out('  No suggestions above the similarity threshold. Try --min-similarity 0.75.');
          return;
        }
        const width = Math.min(terminalWidth(), 120);
        ctx.out();
        for (const s of page.items) {
          ctx.out(
            `  ${c.bold(displayUrl(s.sourceUrl, site))} ${c.dim(sym.arrow)} ${c.bold(c.cyan(displayUrl(s.targetUrl, site)))}  ${c.dim(`similarity ${s.similarity} ${sym.dot} ${s.targetMainInlinks} content inlinks`)}`,
          );
          const anchor = s.anchorCandidates[0];
          for (const line of wrapText(`“${s.paragraph}”`, width - 6)) {
            const at = anchor ? line.indexOf(anchor) : -1;
            ctx.out(
              at < 0 || !anchor
                ? `    ${c.dim(line)}`
                : `    ${c.dim(line.slice(0, at))}${c.green(c.underline(anchor))}${c.dim(line.slice(at + anchor.length))}`,
            );
          }
          if (s.anchorCandidates.length) {
            ctx.out(
              `    ${c.dim('anchors:')} ${s.anchorCandidates.map((a) => `"${a}"`).join(c.dim(', '))}`,
            );
          }
          ctx.out();
        }
        ctx.out(
          c.dim(
            `  ${formatNumber(page.total)} suggestion(s)${page.total > page.items.length ? `, showing ${page.items.length}` : ''}`,
          ),
        );
      },
    );

  program
    .command('cannibalization')
    .description('Pages that compete for the same topic')
    .option('-C, --crawl <id>', 'crawl id (default: the latest)')
    .option('-l, --limit <n>', 'pairs to show', intArg, 20)
    .action(async (opts: { crawl?: string; limit: number }) => {
      const ctx = getContext();
      const crawlId = resolveCrawlId(ctx, opts.crawl);
      const site = ctx.engine.crawls.requireCrawl(crawlId).site;
      await ensureAddon(ctx);
      const page = await withEmbeddingProgress(ctx, (line) =>
        ctx.engine.links.cannibalization(crawlId, {
          limit: opts.limit,
          offset: 0,
          onProgress: (message) => line.update(message),
        }),
      );
      if (ctx.json) return ctx.printJson(page);
      if (page.items.length === 0) {
        ctx.out(`  ${ctx.theme.c.green(ctx.theme.sym.ok)} No competing pages found.`);
        return;
      }
      const half = Math.floor((terminalWidth() - 30) / 2);
      ctx.out(
        renderTable(
          ctx.theme,
          ['Page A', 'Page B', 'Similarity', 'Shared terms'],
          page.items.map((p) => [
            truncateMiddle(displayUrl(p.urlA, site), half),
            truncateMiddle(displayUrl(p.urlB, site), half),
            p.similarity,
            p.sharedTerms.join(', '),
          ]),
        ),
      );
    });
}
