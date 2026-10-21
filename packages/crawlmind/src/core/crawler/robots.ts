import robotsParserModule from 'robots-parser';
import { CRAWL_LIMITS } from '../config/limits.js';
import { describeError } from '../errors.js';
import { logger } from '../logger.js';
import type { Fetcher } from './fetcher.js';
import { decodeHtml } from './fetcher.js';

// robots-parser is CommonJS with an ESM-style d.ts: at runtime the default import is the function.
const robotsParser = robotsParserModule as unknown as typeof robotsParserModule.default;

/** The token matched against `User-agent:` lines. */
export const ROBOTS_AGENT = 'CrawlmindBot';

export interface RobotsRules {
  /** HTTP status of /robots.txt, or null on network error. */
  status: number | null;
  isAllowed(url: string): boolean;
  /** Crawl-delay for our agent in ms (capped), or null. */
  crawlDelayMs: number | null;
  sitemaps: string[];
}

const allowAll = (status: number | null): RobotsRules => ({
  status,
  isAllowed: () => true,
  crawlDelayMs: null,
  sitemaps: [],
});

export function parseRobots(robotsUrl: string, contents: string, status = 200): RobotsRules {
  const robots = robotsParser(robotsUrl, contents);
  const delay = robots.getCrawlDelay(ROBOTS_AGENT);
  return {
    status,
    isAllowed: (url) => robots.isAllowed(url, ROBOTS_AGENT) ?? true,
    crawlDelayMs:
      typeof delay === 'number' && delay > 0
        ? Math.min(delay * 1000, CRAWL_LIMITS.maxRobotsCrawlDelayMs)
        : null,
    sitemaps: robots.getSitemaps(),
  };
}

/**
 * Fetch and parse robots.txt for an origin. A missing or unreachable robots.txt
 * allows everything (the status is kept so it can be reported).
 */
export async function loadRobots(
  origin: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<RobotsRules> {
  const robotsUrl = new URL('/robots.txt', origin).toString();
  const result = await fetcher.fetchWithRedirects(robotsUrl, { signal, readBody: () => true });
  if (!result.final) {
    logger.warn(`robots.txt unavailable: ${result.error ?? 'unknown error'}`);
    return allowAll(null);
  }
  const { status, body, headers } = result.final;
  if (status !== 200 || !body) return allowAll(status);
  try {
    return parseRobots(robotsUrl, decodeHtml(body, headers['content-type']), status);
  } catch (error) {
    logger.warn(`robots.txt could not be parsed: ${describeError(error)}`);
    return allowAll(status);
  }
}
