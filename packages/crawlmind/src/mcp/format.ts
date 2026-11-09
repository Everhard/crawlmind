import type {
  CrawlInfo,
  CrawlProgress,
  CrawlStatusReport,
  CrawlSummary,
  Issue,
  LinkRow,
  PageDetails,
  Paginated,
  TopPage,
  TopPagesBy,
} from '../core/index.js';

/** Plain-text renderings for AI clients: short, factual, with the next step. */
export function describeCrawl(crawl: CrawlInfo): string {
  const duration = crawl.durationMs === null ? '' : ` in ${(crawl.durationMs / 1000).toFixed(1)} s`;
  return `Crawl ${crawl.crawlId} of ${crawl.site}: ${crawl.status}, ${crawl.pagesCrawled} pages${duration}.`;
}

export function describeProgress(progress: CrawlProgress): string {
  if (progress.phase === 'external')
    return `Checking external links (${progress.externalChecked} done).`;
  const limit = progress.maxPages > 0 ? `/${progress.maxPages}` : '';
  return `${progress.phase}: ${progress.pagesCrawled}${limit} pages, ${progress.pagesQueued} discovered, ${progress.errors} errors.`;
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

/** "N more; use offset X." when a page does not show everything. */
export function more(page: Paginated<unknown>): string {
  const shown = page.offset + page.items.length;
  return page.total > shown ? `\n…${page.total - shown} more; use offset ${shown}.` : '';
}

export function describeIssue(issue: Issue): string {
  const examples = issue.examples
    .map((e) => `  - ${e.url}${e.detail ? ` — ${e.detail}` : ''}`)
    .join('\n');
  return `[${issue.severity}] ${issue.title} (${issue.id}): ${issue.count}\n${examples}\n  Fix: ${issue.recommendation}`;
}

export function describeSummary(s: CrawlSummary): string {
  const t = s.totals;
  const lines = [
    describeCrawl(s.crawl),
    `Pages: ${t.pages} (${t.htmlPages} HTML, ${t.indexablePages} indexable). Status: 2xx ${t.status['2xx']}, 3xx ${t.status['3xx']}, 4xx ${t.status['4xx']}, 5xx ${t.status['5xx']}, failed ${t.status.failed}, blocked by robots ${t.status.blocked}.`,
    `Links: ${t.internalLinks} internal, ${t.externalLinks} external targets. Max click depth: ${t.maxClickDepth ?? 'n/a'}.`,
    `TTFB: median ${s.ttfbMs.median ?? 'n/a'} ms, p90 ${s.ttfbMs.p90 ?? 'n/a'} ms.`,
    `Issues: ${s.issueCounts.critical} critical, ${s.issueCounts.warning} warnings, ${s.issueCounts.info} notices.`,
    '',
    ...s.topIssues.map(describeIssue),
  ];
  if (s.topIssues.length) lines.push('', 'Use get_issues with check_id for every affected URL.');
  return lines.join('\n');
}

export function describePage(p: PageDetails): string {
  const m = p.metrics;
  const lines = [
    `${p.url}: ${p.status ?? p.fetchError ?? 'not fetched'}${p.blockedByRobots ? ' (blocked by robots.txt)' : ''}${p.indexable === false ? ', not indexable' : ''}`,
    p.redirectChain.length > 1
      ? `Redirects: ${p.redirectChain.map((h) => `${h.url} (${h.status})`).join(' → ')}`
      : null,
    p.title !== null ? `Title: ${p.title}` : null,
    p.h1.length ? `H1: ${p.h1.join(' | ')}` : null,
    p.canonical && p.canonical !== p.url ? `Canonical: ${p.canonical}` : null,
    p.metaRobots ? `Meta robots: ${p.metaRobots}` : null,
    p.wordCount !== null ? `Words: ${p.wordCount}` : null,
    p.ttfbMs !== null
      ? `TTFB ${Math.round(p.ttfbMs)} ms, download ${Math.round(p.downloadMs ?? 0)} ms, ${p.htmlBytes ?? 0} bytes`
      : null,
    m
      ? `Links: ${m.inlinks} inlinks (${m.uniqueInlinks} pages, ${m.mainInlinks} from main content), ${m.outlinks} internal and ${m.externalOutlinks} external outlinks. Click depth ${m.clickDepth ?? 'unreachable'}, PageRank score ${m.pagerankScore ?? 'n/a'}.`
      : null,
    p.inSitemap ? 'Listed in the sitemap.' : null,
    p.issues.length
      ? `Issues:\n${p.issues.map((i) => `- [${i.severity}] ${i.title}${i.detail ? ` — ${i.detail}` : ''}`).join('\n')}`
      : 'No issues.',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export function describeLinks(
  url: string,
  direction: 'in' | 'out',
  page: Paginated<LinkRow>,
): string {
  if (page.total === 0)
    return direction === 'in' ? `No internal links point to ${url}.` : `${url} has no links.`;
  const rows = page.items.map((l) => {
    const other = direction === 'in' ? l.source : l.target;
    const status = l.targetStatus && l.targetStatus !== 200 ? ` [${l.targetStatus}]` : '';
    return `- ${other}${status} "${l.anchor}" (${l.placement}${l.rel ? `, rel=${l.rel}` : ''})`;
  });
  return `${page.total} ${direction === 'in' ? 'inlinks to' : 'outlinks from'} ${url}:\n${rows.join('\n')}${more(page)}`;
}

export function describeTopPages(by: TopPagesBy, page: Paginated<TopPage>): string {
  if (page.total === 0)
    return by === 'underlinked' ? 'No important pages lack internal links.' : 'No pages.';
  const rows = page.items.map(
    (p, i) =>
      `${page.offset + i + 1}. ${p.url} — PR ${p.pagerankScore ?? 'n/a'}, ${p.inlinks} inlinks (${p.mainInlinks} in content), depth ${p.clickDepth ?? '—'}, TTFB ${p.ttfbMs === null ? '—' : `${Math.round(p.ttfbMs)} ms`}`,
  );
  return `Pages by ${by}:\n${rows.join('\n')}${more(page)}`;
}
