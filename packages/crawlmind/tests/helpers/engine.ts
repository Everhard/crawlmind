import {
  createEngine,
  type CrawlInfo,
  type CrawlOptionsInput,
  type Engine,
} from '../../src/core/index.js';

/** An engine on an in-memory database. */
export function createTestEngine(): Engine {
  return createEngine({ dbPath: ':memory:' });
}

/** Crawl a local fixture site with test-friendly defaults and wait for the result. */
export async function crawlAndWait(engine: Engine, options: CrawlOptionsInput): Promise<CrawlInfo> {
  const crawl = engine.crawls.start({ delayMs: 0, allowPrivateNetworks: true, ...options });
  await engine.crawls.waitFor(crawl.crawlId, Number.POSITIVE_INFINITY);
  return engine.crawls.requireCrawl(crawl.crawlId);
}
