import { normalizeUrl } from '../crawler/url.js';
import { CrawlmindError } from '../errors.js';
import type { CrawlManager } from '../crawl-manager.js';
import type { CrawlInfo, LinkPlacement } from '../schemas.js';
import type { DB } from '../storage/db.js';
import type { Paginated } from '../types.js';
import { analyzeCrawl } from './analyze.js';
import {
  CHECKS_BY_ID,
  SEVERITY_ORDER,
  type Issue,
  type IssueExample,
  type Severity,
} from './checks.js';

export interface CrawlSummary {
  crawl: CrawlInfo;
  totals: {
    pages: number;
    htmlPages: number;
    indexablePages: number;
    status: {
      '2xx': number;
      '3xx': number;
      '4xx': number;
      '5xx': number;
      failed: number;
      blocked: number;
    };
    internalLinks: number;
    externalLinks: number;
    externalChecked: number;
    maxClickDepth: number | null;
  };
  ttfbMs: { median: number | null; p90: number | null; average: number | null };
  issueCounts: Record<Severity, number>;
  topIssues: Issue[];
}

export interface PageDetails {
  url: string;
  finalUrl: string | null;
  status: number | null;
  fetchError: string | null;
  contentType: string | null;
  inSitemap: boolean;
  blockedByRobots: boolean;
  indexable: boolean | null;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  canonical: string | null;
  metaRobots: string | null;
  xRobotsTag: string | null;
  lang: string | null;
  wordCount: number | null;
  ttfbMs: number | null;
  downloadMs: number | null;
  htmlBytes: number | null;
  scriptsCount: number | null;
  stylesheetsCount: number | null;
  redirectChain: { url: string; status: number }[];
  metrics: {
    inlinks: number;
    uniqueInlinks: number;
    mainInlinks: number;
    outlinks: number;
    externalOutlinks: number;
    uniqueAnchors: number;
    clickDepth: number | null;
    pagerankScore: number | null;
  } | null;
  issues: { id: string; severity: Severity; title: string; detail: string | null }[];
}

export interface LinkRow {
  source: string;
  target: string;
  anchor: string;
  rel: string;
  placement: LinkPlacement;
  internal: boolean;
  /** HTTP status of the target, when known. */
  targetStatus: number | null;
}

export type TopPagesBy = 'pagerank' | 'inlinks' | 'depth' | 'ttfb' | 'underlinked';

export interface TopPage {
  url: string;
  title: string | null;
  status: number | null;
  pagerankScore: number | null;
  inlinks: number;
  mainInlinks: number;
  clickDepth: number | null;
  ttfbMs: number | null;
  inSitemap: boolean;
}

interface IssueRow {
  check_id: string;
  severity: Severity;
  count: number;
}

/**
 * Read API over analyzed crawls. Both the MCP tools and the CLI commands call it, so they
 * always agree on what a crawl contains.
 */
export class AuditService {
  constructor(
    private readonly db: DB,
    private readonly crawls: CrawlManager,
  ) {}

  /** The crawl, analyzed. Analyzes crawls that stopped before analysis (e.g. interrupted). */
  requireAnalyzed(crawlId: string): CrawlInfo {
    const crawl = this.crawls.requireCrawl(crawlId);
    if (crawl.status === 'running') {
      const progress = this.crawls.status(crawlId).progress;
      const done = progress ? `: ${progress.pagesCrawled}/${progress.maxPages} pages` : '';
      throw new CrawlmindError(
        'crawl_running',
        `Crawl ${crawlId} is still running${done}.`,
        'Call get_crawl_status with wait_seconds to wait for it.',
      );
    }
    const row = this.db.prepare('SELECT analyzed_at FROM crawls WHERE id = ?').get(crawlId) as {
      analyzed_at: string | null;
    };
    if (!row.analyzed_at) analyzeCrawl(this.db, crawlId);
    return crawl;
  }

  /** Most recent finished crawl, for front ends that default to "the last one". */
  latestCrawlId(site?: string): string {
    const row = this.db
      .prepare(
        `SELECT id FROM crawls WHERE status != 'running' AND (@site IS NULL OR site = @site)
         ORDER BY started_at DESC, rowid DESC LIMIT 1`,
      )
      .get({ site: site ?? null }) as { id: string } | undefined;
    if (!row) {
      throw new CrawlmindError(
        'not_found',
        'No finished crawls yet.',
        'Start one with crawlmind crawl <url>.',
      );
    }
    return row.id;
  }

  summary(crawlId: string, topIssues = 10): CrawlSummary {
    const crawl = this.requireAnalyzed(crawlId);
    const db = this.db;
    const count = (sql: string) => (db.prepare(sql).get(crawlId) as { n: number }).n;

    const status = db
      .prepare(
        `SELECT
           SUM(status BETWEEN 200 AND 299) AS s2, SUM(status BETWEEN 300 AND 399) AS s3,
           SUM(status BETWEEN 400 AND 499) AS s4, SUM(status >= 500) AS s5,
           SUM(status IS NULL AND blocked_by_robots = 0) AS failed, SUM(blocked_by_robots) AS blocked,
           SUM(status = 200 AND content_type LIKE '%html%') AS html, COUNT(*) AS total
         FROM pages WHERE crawl_id = ?`,
      )
      .get(crawlId) as Record<
      's2' | 's3' | 's4' | 's5' | 'failed' | 'blocked' | 'html' | 'total',
      number | null
    >;

    const ttfbs = (
      db
        .prepare(
          `SELECT ttfb_ms FROM pages WHERE crawl_id = ? AND status = 200 AND ttfb_ms IS NOT NULL
           ORDER BY ttfb_ms`,
        )
        .all(crawlId) as { ttfb_ms: number }[]
    ).map((r) => r.ttfb_ms);

    const issues = this.issueRows(crawlId);
    const issueCounts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
    for (const row of issues) issueCounts[row.severity] += row.count;

    return {
      crawl,
      totals: {
        pages: status.total ?? 0,
        htmlPages: status.html ?? 0,
        indexablePages: count(
          'SELECT COUNT(*) AS n FROM page_metrics WHERE crawl_id = ? AND indexable = 1',
        ),
        status: {
          '2xx': status.s2 ?? 0,
          '3xx': status.s3 ?? 0,
          '4xx': status.s4 ?? 0,
          '5xx': status.s5 ?? 0,
          failed: status.failed ?? 0,
          blocked: status.blocked ?? 0,
        },
        internalLinks: count(
          'SELECT COUNT(*) AS n FROM links WHERE crawl_id = ? AND is_internal = 1',
        ),
        externalLinks: count(
          'SELECT COUNT(DISTINCT target_url) AS n FROM links WHERE crawl_id = ? AND is_internal = 0',
        ),
        externalChecked: count('SELECT COUNT(*) AS n FROM external_links WHERE crawl_id = ?'),
        maxClickDepth: (
          db
            .prepare('SELECT MAX(click_depth) AS n FROM page_metrics WHERE crawl_id = ?')
            .get(crawlId) as {
            n: number | null;
          }
        ).n,
      },
      ttfbMs: {
        median: percentile(ttfbs, 0.5),
        p90: percentile(ttfbs, 0.9),
        average: ttfbs.length ? round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : null,
      },
      issueCounts,
      topIssues: issues.slice(0, topIssues).map((row) => this.toIssue(crawlId, row)),
    };
  }

  /** Issues, most severe first, each with up to 5 examples. */
  issues(
    crawlId: string,
    opts: { severity?: Severity; limit: number; offset: number },
  ): Paginated<Issue> {
    this.requireAnalyzed(crawlId);
    const rows = this.issueRows(crawlId).filter(
      (r) => !opts.severity || r.severity === opts.severity,
    );
    return {
      items: rows
        .slice(opts.offset, opts.offset + opts.limit)
        .map((row) => this.toIssue(crawlId, row)),
      total: rows.length,
      offset: opts.offset,
      limit: opts.limit,
    };
  }

  /** All affected URLs of one check, paginated. */
  issueItems(
    crawlId: string,
    checkId: string,
    opts: { limit: number; offset: number },
  ): { issue: Omit<Issue, 'examples'>; items: Paginated<IssueExample> } {
    this.requireAnalyzed(crawlId);
    const check = CHECKS_BY_ID.get(checkId);
    if (!check) {
      throw new CrawlmindError(
        'invalid_input',
        `Unknown check "${checkId}".`,
        'Read the crawlmind://checks resources or call get_issues without check_id for valid ids.',
      );
    }
    const total = (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM issue_items WHERE crawl_id = ? AND check_id = ?')
        .get(crawlId, checkId) as { n: number }
    ).n;
    const items = this.db
      .prepare(
        `SELECT url, detail FROM issue_items WHERE crawl_id = ? AND check_id = ?
         ORDER BY id LIMIT ? OFFSET ?`,
      )
      .all(crawlId, checkId, opts.limit, opts.offset) as { url: string; detail: string | null }[];
    return {
      issue: {
        id: check.id,
        severity: check.severity,
        title: check.title,
        count: total,
        recommendation: check.recommendation,
      },
      items: {
        items: items.map((r) => (r.detail ? { url: r.url, detail: r.detail } : { url: r.url })),
        total,
        offset: opts.offset,
        limit: opts.limit,
      },
    };
  }

  page(crawlId: string, url: string): PageDetails {
    this.requireAnalyzed(crawlId);
    const normalized = normalizeUrl(url) ?? url;
    const row = this.db
      .prepare(
        `SELECT p.*, m.indexable, m.inlinks, m.unique_inlinks, m.main_inlinks, m.outlinks,
                m.external_outlinks, m.unique_anchors, m.click_depth, m.pagerank
         FROM pages p LEFT JOIN page_metrics m ON m.page_id = p.id
         WHERE p.crawl_id = ? AND p.url = ?`,
      )
      .get(crawlId, normalized) as Record<string, unknown> | undefined;
    if (!row) {
      throw new CrawlmindError(
        'not_found',
        `${normalized} is not part of crawl ${crawlId}.`,
        'Check the URL (scheme, trailing slash) or use get_top_pages to list crawled pages.',
      );
    }
    const maxRank = this.maxPageRank(crawlId);
    const hops = this.db
      .prepare('SELECT url, status FROM redirect_hops WHERE page_id = ? ORDER BY hop_index')
      .all(row.id as number) as { url: string; status: number }[];
    const issues = (
      this.db
        .prepare(
          'SELECT check_id, detail FROM issue_items WHERE crawl_id = ? AND url = ? ORDER BY id',
        )
        .all(crawlId, normalized) as { check_id: string; detail: string | null }[]
    ).flatMap((item) => {
      const check = CHECKS_BY_ID.get(item.check_id);
      return check
        ? [{ id: check.id, severity: check.severity, title: check.title, detail: item.detail }]
        : [];
    });
    issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    const n = (key: string) => (row[key] as number | null) ?? null;
    return {
      url: row.url as string,
      finalUrl: row.final_url as string | null,
      status: n('status'),
      fetchError: row.fetch_error as string | null,
      contentType: row.content_type as string | null,
      inSitemap: row.in_sitemap === 1,
      blockedByRobots: row.blocked_by_robots === 1,
      indexable: row.indexable === null || row.indexable === undefined ? null : row.indexable === 1,
      title: row.title as string | null,
      metaDescription: row.meta_description as string | null,
      h1: row.h1_json ? (JSON.parse(row.h1_json as string) as string[]) : [],
      canonical: row.canonical as string | null,
      metaRobots: row.meta_robots as string | null,
      xRobotsTag: row.x_robots_tag as string | null,
      lang: row.lang as string | null,
      wordCount: n('word_count'),
      ttfbMs: n('ttfb_ms'),
      downloadMs: n('download_ms'),
      htmlBytes: n('html_bytes'),
      scriptsCount: n('scripts_count'),
      stylesheetsCount: n('stylesheets_count'),
      redirectChain: hops,
      metrics:
        row.inlinks === null || row.inlinks === undefined
          ? null
          : {
              inlinks: n('inlinks') ?? 0,
              uniqueInlinks: n('unique_inlinks') ?? 0,
              mainInlinks: n('main_inlinks') ?? 0,
              outlinks: n('outlinks') ?? 0,
              externalOutlinks: n('external_outlinks') ?? 0,
              uniqueAnchors: n('unique_anchors') ?? 0,
              clickDepth: n('click_depth'),
              pagerankScore: score(n('pagerank'), maxRank),
            },
      issues,
    };
  }

  links(
    crawlId: string,
    url: string,
    opts: {
      direction: 'in' | 'out';
      placement?: LinkPlacement;
      excludeNavFooter?: boolean;
      limit: number;
      offset: number;
    },
  ): Paginated<LinkRow> {
    this.page(crawlId, url); // validates the URL and gives a helpful error
    const normalized = normalizeUrl(url) ?? url;
    const where =
      opts.direction === 'in'
        ? `l.crawl_id = @crawlId AND (l.target_url = @url OR l.target_url IN
             (SELECT url FROM pages WHERE crawl_id = @crawlId AND final_url = @url))
           AND s.url != @url`
        : `l.crawl_id = @crawlId AND s.url = @url`;
    const filters = [
      opts.placement ? 'l.placement = @placement' : null,
      opts.excludeNavFooter ? `l.placement NOT IN ('nav', 'header', 'footer')` : null,
    ].filter(Boolean);
    const clause = [where, ...filters].join(' AND ');
    const params = { crawlId, url: normalized, placement: opts.placement ?? null };
    const from = `FROM links l JOIN pages s ON s.id = l.source_page_id
      LEFT JOIN pages t ON t.crawl_id = l.crawl_id AND t.url = l.target_url
      LEFT JOIN external_links e ON e.crawl_id = l.crawl_id AND e.url = l.target_url`;
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${clause}`).get(params) as { n: number }
    ).n;
    const rows = this.db
      .prepare(
        `SELECT s.url AS source, l.target_url AS target, l.anchor, l.rel, l.placement, l.is_internal,
                COALESCE(t.status, e.status) AS target_status
         ${from} WHERE ${clause} ORDER BY l.id LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: opts.limit, offset: opts.offset }) as {
      source: string;
      target: string;
      anchor: string;
      rel: string;
      placement: LinkPlacement;
      is_internal: number;
      target_status: number | null;
    }[];
    return {
      items: rows.map((r) => ({
        source: r.source,
        target: r.target,
        anchor: r.anchor,
        rel: r.rel,
        placement: r.placement,
        internal: r.is_internal === 1,
        targetStatus: r.target_status,
      })),
      total,
      offset: opts.offset,
      limit: opts.limit,
    };
  }

  /**
   * Rank pages. `underlinked` lists important pages (high PageRank or sitemap priority ≥ 0.8)
   * that get few links from main content, most important first.
   */
  topPages(
    crawlId: string,
    by: TopPagesBy,
    opts: { limit: number; offset: number },
  ): Paginated<TopPage> {
    this.requireAnalyzed(crawlId);
    const maxRank = this.maxPageRank(crawlId);
    const base = `FROM pages p JOIN page_metrics m ON m.page_id = p.id
      WHERE p.crawl_id = @crawlId AND p.status = 200 AND p.content_type LIKE '%html%'`;
    const order: Record<TopPagesBy, { where: string; order: string }> = {
      pagerank: { where: '', order: 'm.pagerank DESC' },
      inlinks: { where: '', order: 'm.inlinks DESC, m.pagerank DESC' },
      depth: {
        where: 'AND m.click_depth IS NOT NULL',
        order: 'm.click_depth DESC, m.pagerank DESC',
      },
      ttfb: { where: 'AND p.ttfb_ms IS NOT NULL', order: 'p.ttfb_ms DESC' },
      underlinked: {
        where: `AND m.indexable = 1 AND m.main_inlinks < 3 AND (
          COALESCE(p.sitemap_priority, 0) >= 0.8 OR m.pagerank >= (
            SELECT pagerank FROM page_metrics WHERE crawl_id = @crawlId AND pagerank IS NOT NULL
            ORDER BY pagerank DESC LIMIT 1 OFFSET (
              SELECT COUNT(*) / 4 FROM page_metrics WHERE crawl_id = @crawlId AND pagerank IS NOT NULL))
        )`,
        order: '(m.pagerank + COALESCE(p.sitemap_priority, 0) / 100.0) / (1 + m.main_inlinks) DESC',
      },
    };
    const { where, order: orderBy } = order[by];
    const params = { crawlId, limit: opts.limit, offset: opts.offset };
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n ${base} ${where}`).get(params) as { n: number }
    ).n;
    const rows = this.db
      .prepare(
        `SELECT p.url, p.title, p.status, p.ttfb_ms, p.in_sitemap, m.pagerank, m.inlinks, m.main_inlinks,
                m.click_depth
         ${base} ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`,
      )
      .all(params) as {
      url: string;
      title: string | null;
      status: number | null;
      ttfb_ms: number | null;
      in_sitemap: number;
      pagerank: number | null;
      inlinks: number;
      main_inlinks: number;
      click_depth: number | null;
    }[];
    return {
      items: rows.map((r) => ({
        url: r.url,
        title: r.title,
        status: r.status,
        pagerankScore: score(r.pagerank, maxRank),
        inlinks: r.inlinks,
        mainInlinks: r.main_inlinks,
        clickDepth: r.click_depth,
        ttfbMs: r.ttfb_ms,
        inSitemap: r.in_sitemap === 1,
      })),
      total,
      offset: opts.offset,
      limit: opts.limit,
    };
  }

  private issueRows(crawlId: string): IssueRow[] {
    const rows = this.db
      .prepare('SELECT check_id, severity, count FROM issues WHERE crawl_id = ?')
      .all(crawlId) as IssueRow[];
    return rows.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count,
    );
  }

  private toIssue(crawlId: string, row: IssueRow): Issue {
    const check = CHECKS_BY_ID.get(row.check_id);
    const examples = this.db
      .prepare(
        'SELECT url, detail FROM issue_items WHERE crawl_id = ? AND check_id = ? ORDER BY id LIMIT 5',
      )
      .all(crawlId, row.check_id) as { url: string; detail: string | null }[];
    return {
      id: row.check_id,
      severity: row.severity,
      title: check?.title ?? row.check_id,
      count: row.count,
      examples: examples.map((e) => (e.detail ? { url: e.url, detail: e.detail } : { url: e.url })),
      recommendation: check?.recommendation ?? '',
    };
  }

  private maxPageRank(crawlId: string): number | null {
    return (
      this.db
        .prepare('SELECT MAX(pagerank) AS n FROM page_metrics WHERE crawl_id = ?')
        .get(crawlId) as {
        n: number | null;
      }
    ).n;
  }
}

/** PageRank as 0–100 relative to the strongest page of the crawl. */
function score(rank: number | null, max: number | null): number | null {
  if (rank === null || !max) return null;
  return Math.round((rank / max) * 1000) / 10;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return round(sorted[index] as number);
}

const round = (n: number) => Math.round(n * 10) / 10;
