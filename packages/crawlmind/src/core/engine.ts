import { analyzeCrawl } from './analysis/analyze.js';
import { AuditService } from './analysis/audit.js';
import { QueryRunner } from './analysis/query.js';
import { CrawlManager } from './crawl-manager.js';
import { compareCrawls, type CrawlDiff } from './diff/compare.js';
import {
  findTransformers,
  installTransformersPackage,
  type EmbeddingsAddon,
  type EmbeddingsStatus,
} from './embeddings/addon.js';
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
  /** The optional embeddings add-on used by link suggestions and cannibalization. */
  embeddings: EmbeddingsAddon;
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
  /** Replaces the add-on check and installer (tests). */
  embeddingsAddon?: EmbeddingsAddon;
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
  const getEmbedder = (): Embedder =>
    (embedder ??= new TransformersEmbedder(undefined, options.onModelProgress));
  const embeddings =
    options.embeddingsAddon ??
    (options.embedder ? customEmbedderAddon() : defaultEmbeddingsAddon(getEmbedder));
  return {
    db,
    dbPath,
    store,
    crawls,
    audit,
    query,
    links: new LinkSuggestionService(db, audit, getEmbedder),
    embeddings,
    compare: (beforeId, afterId, limit) => compareCrawls(db, audit, beforeId, afterId, limit),
    exportReport: (crawlId, opts) => exportReport(audit, crawlId, opts),
    async close() {
      await crawls.shutdown();
      query.close();
      db.close();
    },
  };
}

/** An injected embedder needs no add-on. */
function customEmbedderAddon(): EmbeddingsAddon {
  const status: EmbeddingsStatus = { installed: true, source: 'custom' };
  return { status: () => status, install: async () => status };
}

/**
 * Installs transformers.js into ~/.crawlmind/addons, then embeds one text so the model is
 * downloaded now rather than in the middle of the first suggestion request. Concurrent calls
 * share one install.
 */
function defaultEmbeddingsAddon(getEmbedder: () => Embedder): EmbeddingsAddon {
  let running: Promise<EmbeddingsStatus> | null = null;
  return {
    status: findTransformers,
    install(onProgress) {
      running ??= (async () => {
        if (!findTransformers().installed) await installTransformersPackage(onProgress);
        onProgress?.('Preparing the embedding model (downloads about 120 MB the first time)…');
        await getEmbedder().embed(['warm-up']);
        onProgress?.('Embeddings add-on is ready.');
        return findTransformers();
      })().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
