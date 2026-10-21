import type { CrawlInfo, CrawlOptions, CrawlStatus } from '../schemas.js';
import type { LinkRecord, PageRecord, Paginated, RedirectHopRecord } from '../types.js';
import type { DB } from './db.js';

interface CrawlRow {
  id: string;
  site: string;
  start_url: string;
  options_json: string;
  status: CrawlStatus;
  started_at: string;
  finished_at: string | null;
  pages_crawled: number;
  error: string | null;
}

function toCrawlInfo(row: CrawlRow): CrawlInfo {
  // An interrupted crawl's finish time is when a later process noticed, not a real duration.
  const finished =
    row.finished_at && row.status !== 'interrupted' ? Date.parse(row.finished_at) : null;
  return {
    crawlId: row.id,
    site: row.site,
    startUrl: row.start_url,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: finished === null ? null : finished - Date.parse(row.started_at),
    pagesCrawled: row.pages_crawled,
    error: row.error,
    options: JSON.parse(row.options_json) as CrawlOptions,
  };
}

const b = (value: boolean): number => (value ? 1 : 0);

/** Writes and reads crawls, pages and links. */
export class CrawlStore {
  constructor(readonly db: DB) {}

  createCrawl(input: {
    id: string;
    site: string;
    startUrl: string;
    options: CrawlOptions;
    userAgent: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO crawls (id, site, start_url, options_json, status, started_at, user_agent)
         VALUES (?, ?, ?, ?, 'running', ?, ?)`,
      )
      .run(
        input.id,
        input.site,
        input.startUrl,
        JSON.stringify(input.options),
        new Date().toISOString(),
        input.userAgent,
      );
  }

  finishCrawl(id: string, status: Exclude<CrawlStatus, 'running'>, error?: string): void {
    this.db
      .prepare(`UPDATE crawls SET status = ?, finished_at = ?, error = ? WHERE id = ?`)
      .run(status, new Date().toISOString(), error ?? null, id);
  }

  setPagesCrawled(id: string, count: number): void {
    this.db.prepare(`UPDATE crawls SET pages_crawled = ? WHERE id = ?`).run(count, id);
  }

  setRobotsStatus(id: string, status: number | null): void {
    this.db.prepare(`UPDATE crawls SET robots_status = ? WHERE id = ?`).run(status, id);
  }

  /** Crawls left `running` by a previous process can never finish. */
  markRunningAsInterrupted(): number {
    return this.db
      .prepare(
        `UPDATE crawls SET status = 'interrupted', finished_at = ?,
           error = 'The process running this crawl stopped before it finished.'
         WHERE status = 'running'`,
      )
      .run(new Date().toISOString()).changes;
  }

  getCrawl(id: string): CrawlInfo | null {
    const row = this.db.prepare(`SELECT * FROM crawls WHERE id = ?`).get(id) as
      CrawlRow | undefined;
    return row ? toCrawlInfo(row) : null;
  }

  listCrawls(opts: { site?: string; limit: number; offset: number }): Paginated<CrawlInfo> {
    const where = opts.site ? `WHERE site = @site` : '';
    const params = { site: opts.site ?? null, limit: opts.limit, offset: opts.offset };
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM crawls ${where}`).get(params) as { n: number }
    ).n;
    const rows = this.db
      .prepare(
        `SELECT * FROM crawls ${where} ORDER BY started_at DESC, rowid DESC LIMIT @limit OFFSET @offset`,
      )
      .all(params) as CrawlRow[];
    return { items: rows.map(toCrawlInfo), total, offset: opts.offset, limit: opts.limit };
  }

  /** Most recent finished crawl (completed or cancelled), optionally for one site. */
  latestFinishedCrawl(site?: string): CrawlInfo | null {
    const row = this.db
      .prepare(
        `SELECT * FROM crawls
         WHERE status IN ('completed', 'cancelled') AND (@site IS NULL OR site = @site)
         ORDER BY started_at DESC, rowid DESC LIMIT 1`,
      )
      .get({ site: site ?? null }) as CrawlRow | undefined;
    return row ? toCrawlInfo(row) : null;
  }

  savePage(
    crawlId: string,
    page: PageRecord,
    hops: RedirectHopRecord[],
    links: LinkRecord[],
  ): number {
    const insertPage = this.db.prepare(
      `INSERT INTO pages (
         crawl_id, url, final_url, status, fetch_error, content_type, depth, in_sitemap,
         sitemap_priority, blocked_by_robots, redirect_count, ttfb_ms, download_ms, html_bytes,
         truncated, title, meta_description, h1_json, canonical, meta_robots, x_robots_tag, lang,
         word_count, content_hash, scripts_count, stylesheets_count, mixed_content_json, fetched_at
       ) VALUES (
         @crawlId, @url, @finalUrl, @status, @fetchError, @contentType, @depth, @inSitemap,
         @sitemapPriority, @blockedByRobots, @redirectCount, @ttfbMs, @downloadMs, @htmlBytes,
         @truncated, @title, @metaDescription, @h1Json, @canonical, @metaRobots, @xRobotsTag, @lang,
         @wordCount, @contentHash, @scriptsCount, @stylesheetsCount, @mixedContentJson, @fetchedAt
       )`,
    );
    const insertHop = this.db.prepare(
      `INSERT INTO redirect_hops (page_id, hop_index, url, status) VALUES (?, ?, ?, ?)`,
    );
    const insertLink = this.db.prepare(
      `INSERT INTO links (crawl_id, source_page_id, target_url, anchor, rel, nofollow, is_internal, placement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    return this.db.transaction(() => {
      const pageId = Number(
        insertPage.run({
          ...page,
          crawlId,
          inSitemap: b(page.inSitemap),
          blockedByRobots: b(page.blockedByRobots),
          truncated: b(page.truncated),
          h1Json: JSON.stringify(page.h1),
          mixedContentJson: JSON.stringify(page.mixedContent),
          fetchedAt: new Date().toISOString(),
        }).lastInsertRowid,
      );
      hops.forEach((hop, index) => insertHop.run(pageId, index, hop.url, hop.status));
      for (const link of links) {
        insertLink.run(
          crawlId,
          pageId,
          link.targetUrl,
          link.anchor,
          link.rel,
          b(link.nofollow),
          b(link.isInternal),
          link.placement,
        );
      }
      return pageId;
    })();
  }

  saveExternalLink(
    crawlId: string,
    url: string,
    result: { status: number | null; error: string | null; finalUrl: string | null },
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO external_links (crawl_id, url, status, error, final_url)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(crawlId, url, result.status, result.error, result.finalUrl);
  }

  countPages(crawlId: string): number {
    return (
      this.db.prepare(`SELECT COUNT(*) AS n FROM pages WHERE crawl_id = ?`).get(crawlId) as {
        n: number;
      }
    ).n;
  }

  /** Distinct external link targets of a crawl. */
  externalTargets(crawlId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT target_url AS url FROM links WHERE crawl_id = ? AND is_internal = 0`,
        )
        .all(crawlId) as { url: string }[]
    ).map((r) => r.url);
  }
}
