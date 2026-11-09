import { z } from 'zod';
import { CRAWL_DEFAULTS, CRAWL_LIMITS } from './config/limits.js';
import { THRESHOLDS } from './config/thresholds.js';

const httpUrl = z
  .string()
  .trim()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an absolute http(s) URL');

export const crawlOptionsShape = {
  url: httpUrl.describe('Start URL, e.g. https://example.com'),
  maxPages: z
    .number()
    .int()
    .min(0)
    .default(CRAWL_DEFAULTS.maxPages)
    .describe(
      `Maximum pages to fetch (default ${CRAWL_DEFAULTS.maxPages}). 0 means no limit: ` +
        'large sites can then take hours, so use it only when the user asks for the whole site.',
    ),
  maxDepth: z
    .number()
    .int()
    .min(0)
    .max(CRAWL_LIMITS.maxDepth)
    .default(CRAWL_DEFAULTS.maxDepth)
    .describe('Maximum link depth from the start URL'),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(CRAWL_LIMITS.concurrency)
    .default(CRAWL_DEFAULTS.concurrency),
  delayMs: z
    .number()
    .int()
    .min(0)
    .max(CRAWL_LIMITS.delayMs)
    .default(CRAWL_DEFAULTS.delayMs)
    .describe('Delay between requests to the same host'),
  includeSubdomains: z.boolean().default(CRAWL_DEFAULTS.includeSubdomains),
  checkExternalLinks: z.boolean().default(CRAWL_DEFAULTS.checkExternalLinks),
  respectRobots: z.boolean().default(CRAWL_DEFAULTS.respectRobots),
  thinContentWords: z
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(THRESHOLDS.thinContentWords)
    .describe('Pages with fewer words of main content are reported as thin'),
  allowPrivateNetworks: z
    .boolean()
    .default(CRAWL_DEFAULTS.allowPrivateNetworks)
    .describe('Allow crawling localhost and private network addresses'),
};

export const CrawlOptionsSchema = z.object(crawlOptionsShape);

/** Fully resolved crawl options (defaults applied). */
export type CrawlOptions = z.output<typeof CrawlOptionsSchema>;
/** Crawl options as accepted from callers (defaults optional). */
export type CrawlOptionsInput = z.input<typeof CrawlOptionsSchema>;

export const LinkPlacementSchema = z.enum(['nav', 'header', 'footer', 'main', 'other']);
export type LinkPlacement = z.infer<typeof LinkPlacementSchema>;

export const CrawlStatusSchema = z.enum([
  'running',
  'completed',
  'cancelled',
  'failed',
  'interrupted',
]);
export type CrawlStatus = z.infer<typeof CrawlStatusSchema>;

export const CrawlProgressSchema = z.object({
  pagesCrawled: z.number().int(),
  pagesQueued: z.number().int(),
  maxPages: z.number().int(),
  errors: z.number().int(),
  externalChecked: z.number().int(),
  currentUrl: z.string().nullable(),
  phase: z.enum(['starting', 'sitemaps', 'crawling', 'external', 'analyzing', 'done']),
});
export type CrawlProgress = z.infer<typeof CrawlProgressSchema>;

export const CrawlInfoSchema = z.object({
  crawlId: z.string(),
  site: z.string(),
  startUrl: z.string(),
  status: CrawlStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  pagesCrawled: z.number().int(),
  error: z.string().nullable(),
  options: CrawlOptionsSchema,
});
export type CrawlInfo = z.infer<typeof CrawlInfoSchema>;

export const PaginationShape = {
  limit: z.number().int().min(1).max(200).default(20),
  offset: z.number().int().min(0).default(0),
};
