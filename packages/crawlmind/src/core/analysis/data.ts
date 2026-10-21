import type { DB } from '../storage/db.js';

/** A page row as the analysis needs it. */
export interface PageData {
  id: number;
  url: string;
  finalUrl: string | null;
  status: number | null;
  fetchError: string | null;
  isHtml: boolean;
  inSitemap: boolean;
  blockedByRobots: boolean;
  redirectCount: number;
  ttfbMs: number | null;
  htmlBytes: number | null;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  canonical: string | null;
  noindex: boolean;
  wordCount: number | null;
  mixedContent: string[];
}

export interface LinkData {
  sourceId: number;
  targetUrl: string;
  anchor: string;
  nofollow: boolean;
  isInternal: boolean;
  placement: string;
}

export interface ExternalData {
  status: number | null;
  error: string | null;
}

export interface CrawlData {
  startUrl: string;
  pages: PageData[];
  byUrl: Map<string, PageData>;
  byId: Map<number, PageData>;
  links: LinkData[];
  external: Map<string, ExternalData>;
}

const NOINDEX = /\b(noindex|none)\b/i;

interface PageRow {
  id: number;
  url: string;
  final_url: string | null;
  status: number | null;
  fetch_error: string | null;
  content_type: string | null;
  in_sitemap: number;
  blocked_by_robots: number;
  redirect_count: number;
  ttfb_ms: number | null;
  html_bytes: number | null;
  title: string | null;
  meta_description: string | null;
  h1_json: string | null;
  canonical: string | null;
  meta_robots: string | null;
  x_robots_tag: string | null;
  word_count: number | null;
  mixed_content_json: string | null;
}

export function loadCrawlData(db: DB, crawlId: string): CrawlData {
  const { start_url: startUrl } = db
    .prepare('SELECT start_url FROM crawls WHERE id = ?')
    .get(crawlId) as { start_url: string };

  const pages = (
    db.prepare('SELECT * FROM pages WHERE crawl_id = ? ORDER BY id').all(crawlId) as PageRow[]
  ).map((row): PageData => ({
    id: row.id,
    url: row.url,
    finalUrl: row.final_url,
    status: row.status,
    fetchError: row.fetch_error,
    isHtml: /\b(text\/html|application\/xhtml\+xml)\b/i.test(row.content_type ?? ''),
    inSitemap: row.in_sitemap === 1,
    blockedByRobots: row.blocked_by_robots === 1,
    redirectCount: row.redirect_count,
    ttfbMs: row.ttfb_ms,
    htmlBytes: row.html_bytes,
    title: row.title,
    metaDescription: row.meta_description,
    h1: row.h1_json ? (JSON.parse(row.h1_json) as string[]) : [],
    canonical: row.canonical,
    noindex: NOINDEX.test(row.meta_robots ?? '') || NOINDEX.test(row.x_robots_tag ?? ''),
    wordCount: row.word_count,
    mixedContent: row.mixed_content_json ? (JSON.parse(row.mixed_content_json) as string[]) : [],
  }));

  const links: LinkData[] = [];
  const linkRows = db
    .prepare(
      `SELECT source_page_id, target_url, anchor, nofollow, is_internal, placement
       FROM links WHERE crawl_id = ?`,
    )
    .raw()
    .iterate(crawlId) as IterableIterator<[number, string, string, number, number, string]>;
  for (const [sourceId, targetUrl, anchor, nofollow, isInternal, placement] of linkRows) {
    links.push({
      sourceId,
      targetUrl,
      anchor,
      nofollow: nofollow === 1,
      isInternal: isInternal === 1,
      placement,
    });
  }

  const external = new Map<string, ExternalData>();
  for (const row of db
    .prepare('SELECT url, status, error FROM external_links WHERE crawl_id = ?')
    .all(crawlId) as { url: string; status: number | null; error: string | null }[]) {
    external.set(row.url, { status: row.status, error: row.error });
  }

  return {
    startUrl,
    pages,
    byUrl: new Map(pages.map((p) => [p.url, p])),
    byId: new Map(pages.map((p) => [p.id, p])),
    links,
    external,
  };
}

/** A 200 HTML page. */
export const isOkHtml = (p: PageData): boolean => p.status === 200 && p.isHtml;

/** A 200 HTML page that asks to be indexed under its own URL. */
export const isIndexable = (p: PageData): boolean =>
  isOkHtml(p) && !p.noindex && (p.canonical === null || p.canonical === p.url);

export const isRedirect = (p: PageData): boolean => p.redirectCount > 0;

export const isErrorPage = (p: PageData): boolean =>
  !p.blockedByRobots && (p.fetchError !== null || (p.status !== null && p.status >= 400));
