import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { CrawlmindError } from '../errors.js';
import { openReadonlyDatabase, type DB } from '../storage/db.js';

export const QUERY_LIMITS = {
  defaultRows: 100,
  maxRows: 1000,
  /** Wall-clock limit; the worker running the query is terminated after it. */
  timeoutMs: 10_000,
  /** Longest string value returned; longer values are cut. */
  maxValueChars: 2000,
  /** Approximate cap on the whole result, in characters of JSON. */
  maxResultChars: 1_000_000,
} as const;

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
  'templates(id, crawl_id, pattern, variant, page_count, ttfb_median, ttfb_p90, download_median, html_bytes_median, word_count_median)',
  'psi_results(crawl_id, template_id, url, strategy, measured_at, performance_score, lcp_ms, cls, tbt_ms, fcp_ms, total_bytes, field_json, error)',
].join('\n');

/**
 * Executes the statement and collects capped rows. Runs inside a worker thread (as source
 * text, so it needs no separate bundle entry) or inline for in-memory databases.
 */
const COLLECT = `
function collect(stmt, cap, maxValueChars, maxResultChars) {
  const rows = [];
  let size = 0;
  let truncated = false;
  for (const row of stmt.iterate()) {
    if (rows.length >= cap || size > maxResultChars) { truncated = true; break; }
    for (const key of Object.keys(row)) {
      const v = row[key];
      if (typeof v === 'string' && v.length > maxValueChars) row[key] = v.slice(0, maxValueChars) + '…';
      else if (typeof v === 'bigint') row[key] = v.toString();
      else if (v instanceof Uint8Array) row[key] = '<' + v.byteLength + ' bytes>';
    }
    size += JSON.stringify(row).length;
    rows.push(row);
  }
  return { columns: stmt.columns().map((c) => c.name), rows, truncated };
}
`;

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const Database = require(workerData.driver);
${COLLECT}
try {
  const db = new Database(workerData.path, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  const stmt = db.prepare(workerData.sql);
  parentPort.postMessage({ ok: true, result: collect(stmt, workerData.cap, workerData.maxValueChars, workerData.maxResultChars) });
} catch (error) {
  parentPort.postMessage({ ok: false, message: String(error && error.message ? error.message : error) });
}
`;

type Collected = Omit<QueryResult, 'rowCount'>;
const collectInline = new Function(`${COLLECT}; return collect;`)() as (
  stmt: unknown,
  cap: number,
  maxValueChars: number,
  maxResultChars: number,
) => Collected;

/**
 * Runs user-supplied SELECT statements read-only: validated on a read-only connection, then
 * executed in a worker thread with its own read-only connection and a wall-clock timeout, so
 * a runaway query cannot block the server. Rows and values are capped.
 */
export class QueryRunner {
  private readonlyDb: DB | null = null;
  private readonly driverPath = createRequire(import.meta.url).resolve('better-sqlite3');

  constructor(
    private readonly dbPath: string,
    /** Used only for in-memory databases, which cannot be opened twice. */
    private readonly fallback: DB,
    private readonly timeoutMs: number = QUERY_LIMITS.timeoutMs,
  ) {}

  async run(sql: string, limit: number = QUERY_LIMITS.defaultRows): Promise<QueryResult> {
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
      stmt = db.prepare(text); // rejects multiple statements; preparing does not execute
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

    let collected: Collected;
    if (this.dbPath === ':memory:') {
      try {
        collected = collectInline(
          stmt,
          cap,
          QUERY_LIMITS.maxValueChars,
          QUERY_LIMITS.maxResultChars,
        );
      } catch (error) {
        throw new CrawlmindError('invalid_input', `SQL error: ${(error as Error).message}`);
      }
    } else {
      collected = await this.runInWorker(text, cap);
    }
    return { ...collected, rowCount: collected.rows.length };
  }

  private runInWorker(sql: string, cap: number): Promise<Collected> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: {
          driver: this.driverPath,
          path: this.dbPath,
          sql,
          cap,
          maxValueChars: QUERY_LIMITS.maxValueChars,
          maxResultChars: QUERY_LIMITS.maxResultChars,
        },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(
          new CrawlmindError(
            'invalid_input',
            `Query stopped after ${this.timeoutMs / 1000} s.`,
            'Filter by crawl_id, add a LIMIT, or avoid recursive queries.',
          ),
        );
      }, this.timeoutMs);
      worker.once(
        'message',
        (msg: { ok: true; result: Collected } | { ok: false; message: string }) => {
          clearTimeout(timer);
          void worker.terminate();
          if (msg.ok) resolve(msg.result);
          else reject(new CrawlmindError('invalid_input', `SQL error: ${msg.message}`));
        },
      );
      worker.once('error', (error) => {
        clearTimeout(timer);
        reject(new CrawlmindError('internal', `Query worker failed: ${error.message}`));
      });
    });
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
