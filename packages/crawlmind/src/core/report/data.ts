import type { AuditService, CrawlSummary, TopPage } from '../analysis/audit.js';
import type { Issue } from '../analysis/checks.js';
import type { SpeedService, TemplateInfo } from '../speed/service.js';

/** Everything a report shows, gathered once so HTML and Markdown render the same content. */
export interface ReportData {
  generatedAt: string;
  summary: CrawlSummary;
  /** Every issue, most severe first, with up to `examplesPerIssue` examples. */
  issues: Issue[];
  underlinked: TopPage[];
  topPages: TopPage[];
  slowestPages: TopPage[];
  templates: TemplateInfo[];
}

export const REPORT_LIMITS = { examplesPerIssue: 10, pages: 10, templates: 15 } as const;

export function collectReportData(
  audit: AuditService,
  speed: SpeedService,
  crawlId: string,
): ReportData {
  const summary = audit.summary(crawlId, 0);
  const all = audit.issues(crawlId, { limit: 1000, offset: 0 }).items;
  const issues = all.map((issue) => ({
    ...issue,
    examples: audit.issueItems(crawlId, issue.id, {
      limit: REPORT_LIMITS.examplesPerIssue,
      offset: 0,
    }).items.items,
  }));
  const page = { limit: REPORT_LIMITS.pages, offset: 0 };
  return {
    generatedAt: new Date().toISOString(),
    summary,
    issues,
    underlinked: audit.topPages(crawlId, 'underlinked', page).items,
    topPages: audit.topPages(crawlId, 'pagerank', page).items,
    slowestPages: audit.topPages(crawlId, 'ttfb', page).items,
    templates: speed.templates(crawlId, { limit: REPORT_LIMITS.templates, offset: 0 }).items,
  };
}
