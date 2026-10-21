import { analyzeCrawl } from './analysis/analyze.js';
import { AuditService } from './analysis/audit.js';
import { QueryRunner } from './analysis/query.js';
import { CrawlManager } from './crawl-manager.js';
import { databasePath } from './paths.js';
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
  close(): Promise<void>;
}

export function createEngine(options: { dbPath?: string } = {}): Engine {
  const dbPath = options.dbPath ?? databasePath();
  const db = openDatabase(dbPath);
  const store = new CrawlStore(db);
  const crawls = new CrawlManager(store);
  crawls.addPostCrawlStep((crawlId) => {
    analyzeCrawl(db, crawlId);
  });
  const query = new QueryRunner(dbPath, db);
  return {
    db,
    dbPath,
    store,
    crawls,
    audit: new AuditService(db, crawls),
    query,
    async close() {
      await crawls.shutdown();
      query.close();
      db.close();
    },
  };
}
