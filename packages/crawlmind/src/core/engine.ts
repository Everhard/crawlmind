import { analyzeCrawl } from './analysis/analyze.js';
import { AuditService } from './analysis/audit.js';
import { QueryRunner } from './analysis/query.js';
import { CrawlManager } from './crawl-manager.js';
import { compareCrawls, type CrawlDiff } from './diff/compare.js';
import { TransformersEmbedder, type Embedder, type ModelProgress } from './embeddings/embedder.js';
import { LinkSuggestionService } from './embeddings/suggest.js';
import { databasePath } from './paths.js';
import { exportReport, type ExportResult, type ReportFormat } from './report/export.js';
import { CrawlStore } from './storage/crawl-store.js';
import { openDatabase, type DB } from './storage/db.js';

/** Everything a front end (MCP server, CLI) needs, wired together. */
export interface Engine {
  db: DB;
  dbPath: string;
  store: CrawlStore;
  crawls: CrawlManager;
  audit: AuditService;
  query: QueryRunner;
  links: LinkSuggestionService;
  compare(beforeId: string, afterId: string, limit?: number): CrawlDiff;
  exportReport(
    crawlId: string,
    opts: {
      format: ReportFormat;
      path?: string;
      overwrite?: boolean;
      restrictToReportsDir?: boolean;
    },
  ): ExportResult;
  close(): Promise<void>;
}

export interface EngineOptions {
  dbPath?: string;
  /** Embedding model for link suggestions; default: multilingual-e5-small via transformers.js. */
  embedder?: Embedder;
  /** Download progress of the default embedding model. */
  onModelProgress?: ModelProgress;
}

export function createEngine(options: EngineOptions = {}): Engine {
  const dbPath = options.dbPath ?? databasePath();
  const db = openDatabase(dbPath);
  const store = new CrawlStore(db);
  const crawls = new CrawlManager(store);
  crawls.addPostCrawlStep((crawlId) => {
    analyzeCrawl(db, crawlId);
  });
  const query = new QueryRunner(dbPath, db);
  const audit = new AuditService(db, crawls);
  let embedder = options.embedder;
  return {
    db,
    dbPath,
    store,
    crawls,
    audit,
    query,
    links: new LinkSuggestionService(
      db,
      audit,
      () => (embedder ??= new TransformersEmbedder(undefined, options.onModelProgress)),
    ),
    compare: (beforeId, afterId, limit) => compareCrawls(db, audit, beforeId, afterId, limit),
    exportReport: (crawlId, opts) => exportReport(audit, crawlId, opts),
    async close() {
      await crawls.shutdown();
      query.close();
      db.close();
    },
  };
}
