import { analyzeCrawl } from './analysis/analyze.js';
import { AuditService } from './analysis/audit.js';
import { QueryRunner } from './analysis/query.js';
import { CrawlManager } from './crawl-manager.js';
import { PsiClient, type PsiClientOptions } from './speed/psi.js';
import { SpeedService } from './speed/service.js';
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
  speed: SpeedService;
  close(): Promise<void>;
}

export interface EngineOptions {
  dbPath?: string;
  /** PageSpeed Insights client options; the API key defaults to env PSI_API_KEY. */
  psi?: PsiClientOptions;
  /** Let measure_templates run for private sites (only useful with a mocked PSI client). */
  allowPrivatePsiTargets?: boolean;
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
  const psi = new PsiClient({ apiKey: process.env.PSI_API_KEY || undefined, ...options.psi });
  return {
    db,
    dbPath,
    store,
    crawls,
    audit,
    query,
    speed: new SpeedService(db, audit, psi, options.allowPrivatePsiTargets),
    async close() {
      await crawls.shutdown();
      query.close();
      db.close();
    },
  };
}
