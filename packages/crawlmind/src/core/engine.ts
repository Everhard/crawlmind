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
  close(): Promise<void>;
}

export function createEngine(options: { dbPath?: string } = {}): Engine {
  const dbPath = options.dbPath ?? databasePath();
  const db = openDatabase(dbPath);
  const store = new CrawlStore(db);
  const crawls = new CrawlManager(store);
  return {
    db,
    dbPath,
    store,
    crawls,
    async close() {
      await crawls.shutdown();
      db.close();
    },
  };
}
