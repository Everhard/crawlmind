import { gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';
import { CRAWL_LIMITS } from '../config/limits.js';
import { logger } from '../logger.js';
import type { Fetcher } from './fetcher.js';
import { decodeHtml } from './fetcher.js';
import { normalizeUrl } from './url.js';

export interface SitemapEntry {
  url: string;
  priority: number | null;
}

export interface ParsedSitemap {
  /** Child sitemaps when the document is a sitemap index. */
  sitemaps: string[];
  urls: SitemapEntry[];
}

export function parseSitemap(xml: string, baseUrl: string): ParsedSitemap {
  const $ = cheerio.load(xml, { xml: true });
  const sitemaps: string[] = [];
  const urls: SitemapEntry[] = [];

  $('sitemapindex > sitemap > loc').each((_, el) => {
    const url = normalizeUrl($(el).text(), baseUrl);
    if (url) sitemaps.push(url);
  });
  $('urlset > url').each((_, el) => {
    const node = $(el);
    const url = normalizeUrl(node.children('loc').first().text(), baseUrl);
    if (!url) return;
    const priority = Number.parseFloat(node.children('priority').first().text());
    urls.push({ url, priority: Number.isFinite(priority) ? priority : null });
  });
  return { sitemaps, urls };
}

function bodyToXml(body: Buffer, contentType: string | undefined): string {
  const gzipped = body[0] === 0x1f && body[1] === 0x8b;
  return decodeHtml(gzipped ? gunzipSync(body) : body, contentType);
}

/**
 * Collect page URLs from sitemaps: the ones listed in robots.txt plus `/sitemap.xml`,
 * following sitemap indexes. `accept` filters URLs (e.g. to the crawled site).
 */
export async function collectSitemapUrls(
  origin: string,
  robotsSitemaps: string[],
  fetcher: Fetcher,
  accept: (url: string) => boolean,
  signal?: AbortSignal,
): Promise<Map<string, SitemapEntry>> {
  const queue = [...robotsSitemaps, new URL('/sitemap.xml', origin).toString()];
  const visited = new Set<string>();
  const found = new Map<string, SitemapEntry>();

  while (queue.length > 0 && visited.size < CRAWL_LIMITS.maxSitemaps) {
    if (signal?.aborted) break;
    const sitemapUrl = normalizeUrl(queue.shift() ?? '');
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    const result = await fetcher.fetchWithRedirects(sitemapUrl, { signal, readBody: () => true });
    const res = result.final;
    if (!res || res.status !== 200 || !res.body) continue;

    let parsed: ParsedSitemap;
    try {
      parsed = parseSitemap(bodyToXml(res.body, res.headers['content-type']), sitemapUrl);
    } catch {
      logger.warn(`Could not parse sitemap ${sitemapUrl}`);
      continue;
    }
    queue.push(...parsed.sitemaps);
    for (const entry of parsed.urls) {
      if (found.size >= CRAWL_LIMITS.maxSitemapUrls) return found;
      if (accept(entry.url) && !found.has(entry.url)) found.set(entry.url, entry);
    }
  }
  return found;
}
