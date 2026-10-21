import { z } from 'zod';
import {
  CrawlInfoSchema,
  IssueExampleSchema,
  IssueSchema,
  LinkPlacementSchema,
  SeveritySchema,
} from '../core/index.js';

/** Output schemas advertised to MCP clients. Nested detail objects stay open-ended. */
const paginated = <T extends z.ZodType>(item: T) => ({
  items: z.array(item),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
});

export const SummaryOutput = {
  crawl: CrawlInfoSchema,
  totals: z.looseObject({ pages: z.number(), htmlPages: z.number(), indexablePages: z.number() }),
  ttfbMs: z.object({
    median: z.number().nullable(),
    p90: z.number().nullable(),
    average: z.number().nullable(),
  }),
  issueCounts: z.record(SeveritySchema, z.number()),
  topIssues: z.array(IssueSchema),
};

/** Either a page of issues, or (with check_id) one check and a page of its affected URLs. */
export const IssuesOutput = {
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
  issues: z.array(IssueSchema).optional(),
  check: IssueSchema.omit({ examples: true }).optional(),
  urls: z.array(IssueExampleSchema).optional(),
};

export const PageOutput = {
  page: z.looseObject({
    url: z.string(),
    status: z.number().nullable(),
    title: z.string().nullable(),
  }),
};

export const LinkRowSchema = z.object({
  source: z.string(),
  target: z.string(),
  anchor: z.string(),
  rel: z.string(),
  placement: LinkPlacementSchema,
  internal: z.boolean(),
  targetStatus: z.number().nullable(),
});
export const LinksOutput = paginated(LinkRowSchema);

export const TopPageSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  status: z.number().nullable(),
  pagerankScore: z.number().nullable(),
  inlinks: z.number(),
  mainInlinks: z.number(),
  clickDepth: z.number().nullable(),
  ttfbMs: z.number().nullable(),
  inSitemap: z.boolean(),
});
export const TopPagesOutput = paginated(TopPageSchema);

export const QueryOutput = {
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().int(),
  truncated: z.boolean(),
};
