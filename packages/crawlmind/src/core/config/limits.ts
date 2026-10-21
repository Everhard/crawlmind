/** Crawl defaults and hard limits. Kept in one place so docs and schemas agree. */
export const CRAWL_DEFAULTS = {
  maxPages: 500,
  maxDepth: 10,
  concurrency: 4,
  delayMs: 250,
  includeSubdomains: false,
  checkExternalLinks: true,
  respectRobots: true,
  allowPrivateNetworks: false,
} as const;

export const CRAWL_LIMITS = {
  maxPages: 10_000,
  maxDepth: 50,
  concurrency: 16,
  delayMs: 10_000,
  requestTimeoutMs: 15_000,
  maxBodyBytes: 5 * 1024 * 1024,
  maxRedirects: 10,
  maxSitemaps: 50,
  maxSitemapUrls: 50_000,
  externalPerHostConcurrency: 2,
  externalConcurrency: 8,
  maxRobotsCrawlDelayMs: 10_000,
} as const;
