import type { CrawlInfo, CrawlProgress, CrawlStatusReport } from '../core/index.js';

/** Plain-text renderings for AI clients: short, factual, with the next step. */
export function describeCrawl(crawl: CrawlInfo): string {
  const duration = crawl.durationMs === null ? '' : ` in ${(crawl.durationMs / 1000).toFixed(1)} s`;
  return `Crawl ${crawl.crawlId} of ${crawl.site}: ${crawl.status}, ${crawl.pagesCrawled} pages${duration}.`;
}

export function describeProgress(progress: CrawlProgress): string {
  if (progress.phase === 'external')
    return `Checking external links (${progress.externalChecked} done).`;
  return `${progress.phase}: ${progress.pagesCrawled}/${progress.maxPages} pages, ${progress.pagesQueued} discovered, ${progress.errors} errors.`;
}

export function describeStatus(report: CrawlStatusReport): string {
  const { crawl, progress } = report;
  if (crawl.status === 'running' && progress) {
    return `Crawl ${crawl.crawlId} is still running. ${describeProgress(progress)} Call get_crawl_status with wait_seconds to wait for it.`;
  }
  const next =
    crawl.status === 'completed' || crawl.status === 'cancelled'
      ? ' Next: get_summary for the results.'
      : crawl.error
        ? ` Error: ${crawl.error}`
        : '';
  return `${describeCrawl(crawl)}${next}`;
}
