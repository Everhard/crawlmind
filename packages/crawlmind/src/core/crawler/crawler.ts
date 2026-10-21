import type { CrawlOptions, CrawlProgress } from '../schemas.js';
import type { CrawlStore } from '../storage/crawl-store.js';
import { emptyPage, type LinkRecord, type PageRecord } from '../types.js';
import { ExternalChecker } from './external.js';
import { extractPage } from './extract.js';
import { decodeHtml, Fetcher, type FetchResponse } from './fetcher.js';
import { loadRobots, type RobotsRules } from './robots.js';
import { collectSitemapUrls, type SitemapEntry } from './sitemap.js';
import { HostThrottle, sleep } from './throttle.js';
import { isInternalUrl, normalizeUrl } from './url.js';

export interface RunCrawlParams {
  crawlId: string;
  options: CrawlOptions;
  store: CrawlStore;
  signal?: AbortSignal;
  onProgress?: (progress: CrawlProgress) => void;
}

export interface CrawlStats {
  pagesCrawled: number;
  errors: number;
  externalChecked: number;
  cancelled: boolean;
}

interface QueueItem {
  url: string;
  /** Link depth from the start URL; null for URLs only known from sitemaps. */
  depth: number | null;
}

const isHtml = (headers: Record<string, string>) =>
  /\b(text\/html|application\/xhtml\+xml)\b/i.test(headers['content-type'] ?? '');

/**
 * Breadth-first crawl of one site. Pages discovered through links are crawled before
 * sitemap-only URLs. Results are written to the store as they arrive, so a cancelled
 * crawl keeps everything fetched so far.
 */
export async function runCrawl(params: RunCrawlParams): Promise<CrawlStats> {
  const { crawlId, options, store, signal } = params;
  const startUrl = normalizeUrl(options.url);
  if (!startUrl) throw new Error(`Invalid start URL: ${options.url}`);
  const rootHost = new URL(startUrl).hostname;
  const internal = (url: string) => isInternalUrl(url, rootHost, options.includeSubdomains);

  const fetcher = new Fetcher({ allowPrivateNetworks: options.allowPrivateNetworks });
  const throttle = new HostThrottle(options.delayMs);
  const progress: CrawlProgress = {
    pagesCrawled: 0,
    pagesQueued: 0,
    maxPages: options.maxPages,
    errors: 0,
    externalChecked: 0,
    currentUrl: null,
    phase: 'starting',
  };
  const report = () => params.onProgress?.({ ...progress });

  try {
    // robots.txt and sitemaps
    progress.phase = 'sitemaps';
    report();
    const robots: RobotsRules = await loadRobots(new URL(startUrl).origin, fetcher, signal);
    store.setRobotsStatus(crawlId, robots.status);
    if (options.respectRobots && robots.crawlDelayMs) {
      throttle.setDelay(Math.max(options.delayMs, robots.crawlDelayMs));
    }
    const sitemap: Map<string, SitemapEntry> = await collectSitemapUrls(
      new URL(startUrl).origin,
      robots.sitemaps,
      fetcher,
      internal,
      signal,
    );

    // Queues: link-discovered URLs first, then sitemap-only URLs.
    const linkQueue: QueueItem[] = [];
    const sitemapQueue: QueueItem[] = [];
    const seen = new Set<string>();
    const enqueue = (url: string, depth: number | null, fromSitemap = false) => {
      if (seen.has(url)) return;
      seen.add(url);
      (fromSitemap ? sitemapQueue : linkQueue).push({ url, depth });
      progress.pagesQueued++;
    };
    enqueue(startUrl, 0);
    for (const url of sitemap.keys()) enqueue(url, null, true);

    let active = 0;
    let reserved = 0; // fetches started, to enforce maxPages exactly

    const withSitemapInfo = (page: PageRecord): PageRecord => {
      const entry = sitemap.get(page.url);
      return entry ? { ...page, inSitemap: true, sitemapPriority: entry.priority } : page;
    };

    const savePage = (
      page: PageRecord,
      hops: { url: string; status: number }[],
      links: LinkRecord[],
    ) => {
      store.savePage(crawlId, withSitemapInfo(page), hops, links);
      if (page.fetchError || (page.status !== null && page.status >= 400)) progress.errors++;
    };

    /** Store an HTML (or other) response under `url`; returns internal links to follow. */
    const recordResponse = (url: string, depth: number | null, res: FetchResponse): string[] => {
      const page: PageRecord = {
        ...emptyPage(url),
        status: res.status,
        contentType: res.headers['content-type'] ?? null,
        depth,
        ttfbMs: round(res.ttfbMs),
        downloadMs: round(res.totalMs),
        xRobotsTag: res.headers['x-robots-tag'] ?? null,
      };
      if (!res.body || !isHtml(res.headers)) {
        savePage(page, [], []);
        return [];
      }
      const html = decodeHtml(res.body, res.headers['content-type']);
      const data = extractPage(html, url);
      const links: LinkRecord[] = data.links.map((link) => ({
        targetUrl: link.url,
        anchor: link.anchor,
        rel: link.rel,
        nofollow: link.nofollow,
        isInternal: internal(link.url),
        placement: link.placement,
      }));
      savePage(
        {
          ...page,
          htmlBytes: res.body.length,
          truncated: res.truncated,
          title: data.title,
          metaDescription: data.metaDescription,
          h1: data.h1,
          canonical: data.canonical,
          metaRobots: data.metaRobots,
          lang: data.lang,
          wordCount: data.wordCount,
          contentHash: data.contentHash,
          scriptsCount: data.scriptsCount,
          stylesheetsCount: data.stylesheetsCount,
          mixedContent: data.mixedContent,
          domSignature: data.domSignature,
          contentExcerpt: data.contentExcerpt,
          paragraphs: data.paragraphs,
        },
        [],
        links,
      );
      return links.filter((l) => l.isInternal).map((l) => l.targetUrl);
    };

    const processItem = async ({ url, depth }: QueueItem) => {
      progress.currentUrl = url;
      if (options.respectRobots && !robots.isAllowed(url)) {
        savePage({ ...emptyPage(url), depth, blockedByRobots: true }, [], []);
        reserved--; // nothing was fetched, so it does not count against maxPages
        return;
      }

      await throttle.wait(new URL(url).host, signal);
      const result = await fetcher.fetchWithRedirects(url, {
        signal,
        readBody: (status, headers) => status === 200 && isHtml(headers),
      });
      if (signal?.aborted) return;
      progress.pagesCrawled++;

      let discovered: string[] = [];
      if (result.hops.length <= 1 && result.final) {
        discovered = recordResponse(url, depth, result.final);
      } else {
        // Redirected (or failed before any response): store the chain under the requested URL.
        const last = result.hops.at(-1);
        savePage(
          {
            ...emptyPage(url),
            depth,
            status: result.hops[0]?.status ?? null,
            // Only a chain that ended on a response has a final URL (not loops or errors).
            finalUrl: result.final && last && last.url !== url ? last.url : null,
            fetchError: result.error,
            redirectCount: Math.max(0, result.hops.length - 1),
          },
          result.hops,
          [],
        );
        // The final page of an internal redirect is a page of the site in its own right.
        if (last && result.final && internal(last.url) && !seen.has(last.url)) {
          seen.add(last.url);
          if (reserved < options.maxPages) {
            reserved++;
            progress.pagesCrawled++;
            discovered = recordResponse(last.url, depth, result.final);
          }
        }
      }

      const childDepth = depth === null ? null : depth + 1;
      if (childDepth === null || childDepth <= options.maxDepth) {
        for (const link of discovered) enqueue(link, childDepth);
      }
      store.setPagesCrawled(crawlId, progress.pagesCrawled);
      report();
    };

    progress.phase = 'crawling';
    report();
    const worker = async () => {
      while (!signal?.aborted && reserved < options.maxPages) {
        const item = linkQueue.shift() ?? sitemapQueue.shift();
        if (!item) {
          if (active === 0) return;
          await sleep(15, signal);
          continue;
        }
        reserved++;
        active++;
        try {
          await processItem(item);
        } finally {
          active--;
        }
      }
    };
    await Promise.all(Array.from({ length: options.concurrency }, worker));
    progress.currentUrl = null;

    if (options.checkExternalLinks && !signal?.aborted) {
      progress.phase = 'external';
      report();
      const checker = new ExternalChecker(fetcher);
      await checker.checkAll(
        store.externalTargets(crawlId),
        (url, status) => {
          store.saveExternalLink(crawlId, url, status);
          progress.externalChecked++;
          progress.currentUrl = url;
          report();
        },
        signal,
      );
      progress.currentUrl = null;
    }

    store.setPagesCrawled(crawlId, progress.pagesCrawled);
    return {
      pagesCrawled: progress.pagesCrawled,
      errors: progress.errors,
      externalChecked: progress.externalChecked,
      cancelled: signal?.aborted ?? false,
    };
  } finally {
    await fetcher.close();
  }
}

const round = (ms: number) => Math.round(ms * 10) / 10;
