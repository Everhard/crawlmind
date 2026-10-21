import { CrawlmindError } from '../errors.js';
import { openReadonlyDatabase, type DB } from '../storage/db.js';

export const QUERY_LIMITS = { defaultRows: 100, maxRows: 1000 } as const;

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

/** Short schema overview for people and AI clients writing queries. */
export const QUERY_SCHEMA_HINT = [
  'crawls(id, site, start_url, status, started_at, finished_at, pages_crawled)',
  'pages(id, crawl_id, url, final_url, status, fetch_error, content_type, depth, in_sitemap, sitemap_priority, blocked_by_robots, redirect_count, ttfb_ms, download_ms, html_bytes, title, meta_description, h1_json, canonical, meta_robots, x_robots_tag, lang, word_count, content_hash, scripts_count, stylesheets_count, mixed_content_json, template_id)',
  'links(id, crawl_id, source_page_id, target_url, anchor, rel, nofollow, is_internal, placement)',
  'redirect_hops(page_id, hop_index, url, status)',
  'external_links(crawl_id, url, status, error, final_url)',
  'page_metrics(page_id, crawl_id, indexable, inlinks, unique_inlinks, main_inlinks, outlinks, external_outlinks, unique_anchors, click_depth, pagerank)',
  'issues(crawl_id, check_id, severity, count)',
  'issue_items(id, crawl_id, check_id, url, detail)',
].join('\n');

/**
 * Runs user-supplied SELECT statements on a separate read-only connection
 * (`readonly` open mode plus `PRAGMA query_only`), one statement at a time, with a row cap.
 */
export class QueryRunner {
  private readonlyDb: DB | null = null;

  constructor(
    private readonly dbPath: string,
    /** Used only for in-memory databases, which cannot be opened twice. */
    private readonly fallback: DB,
  ) {}

  run(sql: string, limit: number = QUERY_LIMITS.defaultRows): QueryResult {
    const text = sql.trim().replace(/;\s*$/, '');
    if (!/^(select|with)\b/i.test(text)) {
      throw new CrawlmindError(
        'invalid_input',
        'Only SELECT (or WITH … SELECT) queries are allowed.',
      );
    }
    if (/\b(attach|detach|pragma|vacuum)\b/i.test(text)) {
      throw new CrawlmindError(
        'invalid_input',
        'ATTACH, DETACH, PRAGMA and VACUUM are not allowed.',
      );
    }
    const db = this.connection();
    let stmt;
    try {
      stmt = db.prepare(text); // better-sqlite3 rejects multiple statements here
    } catch (error) {
      throw new CrawlmindError(
        'invalid_input',
        `SQL error: ${(error as Error).message}`,
        `Tables:\n${QUERY_SCHEMA_HINT}`,
      );
    }
    if (!stmt.reader || !stmt.readonly) {
      throw new CrawlmindError(
        'invalid_input',
        'Only read-only statements that return rows are allowed.',
      );
    }
    const cap = Math.min(Math.max(1, limit), QUERY_LIMITS.maxRows);
    const rows: Record<string, unknown>[] = [];
    let truncated = false;
    try {
      for (const row of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
        if (rows.length >= cap) {
          truncated = true;
          break;
        }
        rows.push(row);
      }
    } catch (error) {
      throw new CrawlmindError('invalid_input', `SQL error: ${(error as Error).message}`);
    }
    return { columns: stmt.columns().map((c) => c.name), rows, rowCount: rows.length, truncated };
  }

  close(): void {
    this.readonlyDb?.close();
    this.readonlyDb = null;
  }

  private connection(): DB {
    if (this.dbPath === ':memory:') return this.fallback;
    this.readonlyDb ??= openReadonlyDatabase(this.dbPath);
    return this.readonlyDb;
  }
}
