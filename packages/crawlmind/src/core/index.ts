export { VERSION, USER_AGENT } from './version.js';
export { logger, setLogLevel, type LogLevel } from './logger.js';
export { dataDir, databasePath, modelsDir } from './paths.js';
export { CrawlmindError, describeError, type ErrorCode } from './errors.js';
export * from './schemas.js';
export type * from './types.js';
export { CRAWL_DEFAULTS, CRAWL_LIMITS } from './config/limits.js';

export { openDatabase, openReadonlyDatabase, type DB } from './storage/db.js';
export { CrawlStore } from './storage/crawl-store.js';
export { CrawlManager, type CrawlStatusReport, type PostCrawlStep } from './crawl-manager.js';
export { createEngine, type Engine, type EngineOptions } from './engine.js';

export { normalizeUrl, isInternalUrl } from './crawler/url.js';
export { isPrivateAddress } from './crawler/net-guard.js';
export { extractPage, classifyPlacement } from './crawler/extract.js';
export { parseRobots } from './crawler/robots.js';
export { parseSitemap } from './crawler/sitemap.js';
export { Fetcher } from './crawler/fetcher.js';
export { runCrawl } from './crawler/crawler.js';

export { analyzeCrawl } from './analysis/analyze.js';
export {
  AuditService,
  type CrawlSummary,
  type PageDetails,
  type LinkRow,
  type TopPage,
  type TopPagesBy,
} from './analysis/audit.js';
export {
  CHECKS,
  CHECKS_BY_ID,
  IssueSchema,
  IssueExampleSchema,
  SeveritySchema,
  SEVERITY_ORDER,
  type CheckInfo,
  type Issue,
  type IssueExample,
  type Severity,
} from './analysis/checks.js';
export { pageRank } from './analysis/pagerank.js';
export {
  QueryRunner,
  QUERY_LIMITS,
  QUERY_SCHEMA_HINT,
  type QueryResult,
} from './analysis/query.js';
export { isGenericAnchor, GENERIC_ANCHORS } from './config/generic-anchors.js';
export { THRESHOLDS } from './config/thresholds.js';
export {
  TransformersEmbedder,
  DEFAULT_MODEL,
  type Embedder,
  type ModelProgress,
} from './embeddings/embedder.js';
export {
  LinkSuggestionService,
  SUGGEST_DEFAULTS,
  type LinkSuggestion,
  type CannibalizationPair,
  type SuggestOptions,
} from './embeddings/suggest.js';
export { anchorCandidates, keyStems } from './embeddings/text.js';
export {
  compareCrawls,
  type CrawlDiff,
  type DiffList,
  type StatusChange,
  type BrokenLinkChange,
  type InlinkChange,
  type TtfbChange,
  type FieldChange,
  type IssueCountChange,
} from './diff/compare.js';
export { collectReportData, type ReportData } from './report/data.js';
export { renderHtmlReport, escapeHtml } from './report/html.js';
export { renderMarkdownReport, escapeMarkdown } from './report/markdown.js';
export { exportReport, reportsDir, type ExportResult, type ReportFormat } from './report/export.js';
