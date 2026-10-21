import type { AuditService } from '../analysis/audit.js';
import { assertPublicHost } from '../crawler/net-guard.js';
import { CrawlmindError, describeError } from '../errors.js';
import type { DB } from '../storage/db.js';
import type { Paginated } from '../types.js';
import type { PsiClient } from './psi.js';
import { type PsiResult, type PsiStrategy } from './psi.js';

export interface PsiMeasurement extends PsiResult {
  measuredAt: string;
  error: string | null;
}

export interface TemplateInfo {
  templateId: number;
  pattern: string;
  variant: number;
  /** `pattern`, plus "(layout N)" when one pattern has several layouts. */
  label: string;
  pageCount: number;
  /** Share of the crawl's 200 HTML pages, 0–100. */
  sharePercent: number;
  ttfbMedianMs: number | null;
  ttfbP90Ms: number | null;
  downloadMedianMs: number | null;
  htmlBytesMedian: number | null;
  wordCountMedian: number | null;
  representatives: string[];
  /** Latest PageSpeed Insights results for the representatives. */
  measurements: PsiMeasurement[];
}

export interface MeasureOptions {
  strategy: PsiStrategy;
  /** Templates to measure; default: the largest `maxTemplates`. */
  templateIds?: number[];
  maxTemplates: number;
  /** Representatives measured per template (1 or 2). */
  perTemplate: number;
  /** Measure again even when a result for this crawl exists. */
  force: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, url: string) => void;
}

export interface TemplateMeasurement {
  template: TemplateInfo;
  /** One-line takeaway, e.g. "3,400 pages use /product/* with mobile LCP 4.2 s". */
  insight: string;
}

interface TemplateRow {
  id: number;
  pattern: string;
  variant: number;
  page_count: number;
  ttfb_median: number | null;
  ttfb_p90: number | null;
  download_median: number | null;
  html_bytes_median: number | null;
  word_count_median: number | null;
  representatives_json: string;
}

interface PsiRow {
  url: string;
  strategy: PsiStrategy;
  measured_at: string;
  performance_score: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  fcp_ms: number | null;
  total_bytes: number | null;
  field_json: string | null;
  error: string | null;
}

/** Thresholds Google uses for "good" Core Web Vitals and Lighthouse scores. */
const GOOD = { lcpMs: 2500, cls: 0.1, score: 90 } as const;
const POOR = { lcpMs: 4000, cls: 0.25, score: 50 } as const;

export class SpeedService {
  constructor(
    private readonly db: DB,
    private readonly audit: AuditService,
    private readonly psi: PsiClient,
    /** Tests measure local fixture sites through a mocked PSI client. */
    private readonly allowPrivateSites = false,
  ) {}

  templates(crawlId: string, opts: { limit: number; offset: number }): Paginated<TemplateInfo> {
    this.audit.requireAnalyzed(crawlId);
    const total = (
      this.db.prepare('SELECT COUNT(*) AS n FROM templates WHERE crawl_id = ?').get(crawlId) as {
        n: number;
      }
    ).n;
    const rows = this.db
      .prepare(
        'SELECT * FROM templates WHERE crawl_id = ? ORDER BY page_count DESC, id LIMIT ? OFFSET ?',
      )
      .all(crawlId, opts.limit, opts.offset) as TemplateRow[];
    const htmlPages = this.htmlPageCount(crawlId);
    return {
      items: rows.map((row) => this.toInfo(crawlId, row, htmlPages)),
      total,
      offset: opts.offset,
      limit: opts.limit,
    };
  }

  /** Run PageSpeed Insights on template representatives, reusing results already stored. */
  async measure(crawlId: string, opts: MeasureOptions): Promise<TemplateMeasurement[]> {
    const crawl = this.audit.requireAnalyzed(crawlId);
    try {
      if (!this.allowPrivateSites) assertPublicHost(new URL(crawl.site).hostname);
    } catch {
      throw new CrawlmindError(
        'invalid_input',
        `PageSpeed Insights runs on Google's servers and cannot reach ${crawl.site}.`,
        'Measure a publicly reachable site.',
      );
    }

    const rows = opts.templateIds?.length
      ? (this.db
          .prepare(
            `SELECT * FROM templates WHERE crawl_id = ? AND id IN (${opts.templateIds.map(() => '?').join(',')})
             ORDER BY page_count DESC`,
          )
          .all(crawlId, ...opts.templateIds) as TemplateRow[])
      : (this.db
          .prepare(
            'SELECT * FROM templates WHERE crawl_id = ? ORDER BY page_count DESC, id LIMIT ?',
          )
          .all(crawlId, opts.maxTemplates) as TemplateRow[]);
    if (rows.length === 0) {
      throw new CrawlmindError(
        'not_found',
        'No templates to measure.',
        'Call get_templates to list template ids.',
      );
    }

    const jobs: { templateId: number; url: string }[] = [];
    for (const row of rows) {
      const urls = (JSON.parse(row.representatives_json) as string[]).slice(
        0,
        Math.max(1, opts.perTemplate),
      );
      for (const url of urls) {
        if (!opts.force && this.latest(crawlId, url, opts.strategy)) continue;
        jobs.push({ templateId: row.id, url });
      }
    }

    // Keyless quota is small: one request at a time. With a key, two in parallel.
    const concurrency = this.psi.hasApiKey ? 2 : 1;
    let done = 0;
    let quotaError: CrawlmindError | null = null;
    const queue = [...jobs];
    const worker = async () => {
      for (
        let job = queue.shift();
        job && !opts.signal?.aborted && !quotaError;
        job = queue.shift()
      ) {
        opts.onProgress?.(done, jobs.length, job.url);
        try {
          const result = await this.psi.run(job.url, opts.strategy, opts.signal);
          this.save(crawlId, job.templateId, {
            ...result,
            measuredAt: new Date().toISOString(),
            error: null,
          });
        } catch (error) {
          if (error instanceof CrawlmindError && /quota/i.test(error.message)) quotaError = error;
          else
            this.saveError(crawlId, job.templateId, job.url, opts.strategy, describeError(error));
        }
        done++;
        opts.onProgress?.(done, jobs.length, job.url);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));

    const htmlPages = this.htmlPageCount(crawlId);
    const measured = rows.map((row) => {
      const template = this.toInfo(crawlId, row, htmlPages);
      return { template, insight: templateInsight(template, opts.strategy) };
    });
    if (quotaError && measured.every((m) => m.template.measurements.length === 0)) throw quotaError;
    return measured;
  }

  private toInfo(crawlId: string, row: TemplateRow, htmlPages: number): TemplateInfo {
    const representatives = JSON.parse(row.representatives_json) as string[];
    const measurements = representatives.flatMap((url) =>
      (['mobile', 'desktop'] as const).flatMap((strategy) => {
        const m = this.latest(crawlId, url, strategy);
        return m ? [m] : [];
      }),
    );
    return {
      templateId: row.id,
      pattern: row.pattern,
      variant: row.variant,
      label: row.variant > 1 ? `${row.pattern} (layout ${row.variant})` : row.pattern,
      pageCount: row.page_count,
      sharePercent: htmlPages ? Math.round((row.page_count / htmlPages) * 1000) / 10 : 0,
      ttfbMedianMs: row.ttfb_median,
      ttfbP90Ms: row.ttfb_p90,
      downloadMedianMs: row.download_median,
      htmlBytesMedian: row.html_bytes_median,
      wordCountMedian: row.word_count_median,
      representatives,
      measurements,
    };
  }

  private latest(crawlId: string, url: string, strategy: PsiStrategy): PsiMeasurement | null {
    const row = this.db
      .prepare(
        `SELECT * FROM psi_results WHERE crawl_id = ? AND url = ? AND strategy = ?
         ORDER BY measured_at DESC, id DESC LIMIT 1`,
      )
      .get(crawlId, url, strategy) as PsiRow | undefined;
    if (!row) return null;
    return {
      url: row.url,
      strategy: row.strategy,
      measuredAt: row.measured_at,
      performanceScore: row.performance_score,
      lcpMs: row.lcp_ms,
      cls: row.cls,
      tbtMs: row.tbt_ms,
      fcpMs: row.fcp_ms,
      totalBytes: row.total_bytes,
      field: row.field_json ? JSON.parse(row.field_json) : null,
      error: row.error,
    };
  }

  private save(crawlId: string, templateId: number, m: PsiMeasurement): void {
    this.db
      .prepare(
        `INSERT INTO psi_results (crawl_id, template_id, url, strategy, measured_at, performance_score,
           lcp_ms, cls, tbt_ms, fcp_ms, total_bytes, field_json, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crawlId,
        templateId,
        m.url,
        m.strategy,
        m.measuredAt,
        m.performanceScore,
        m.lcpMs,
        m.cls,
        m.tbtMs,
        m.fcpMs,
        m.totalBytes,
        m.field ? JSON.stringify(m.field) : null,
        m.error,
      );
  }

  private saveError(
    crawlId: string,
    templateId: number,
    url: string,
    strategy: PsiStrategy,
    error: string,
  ): void {
    this.save(crawlId, templateId, {
      url,
      strategy,
      measuredAt: new Date().toISOString(),
      performanceScore: null,
      lcpMs: null,
      cls: null,
      tbtMs: null,
      fcpMs: null,
      totalBytes: null,
      field: null,
      error,
    });
  }

  private htmlPageCount(crawlId: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM pages WHERE crawl_id = ? AND status = 200 AND content_type LIKE '%html%'`,
        )
        .get(crawlId) as { n: number }
    ).n;
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function rating(value: number, good: number, poor: number): string {
  return value <= good ? 'good' : value <= poor ? 'needs improvement' : 'poor';
}

/** The takeaway for one template, built from its first successful measurement. */
export function templateInsight(t: TemplateInfo, strategy: PsiStrategy): string {
  const pages = `${t.pageCount.toLocaleString('en-US')} page${t.pageCount === 1 ? '' : 's'}`;
  const m = t.measurements.find((x) => x.strategy === strategy && !x.error);
  if (!m) {
    const failed = t.measurements.find((x) => x.strategy === strategy && x.error);
    return failed
      ? `${t.label} (${pages}): measurement failed: ${failed.error}`
      : `${t.label} (${pages}): not measured yet.`;
  }
  const lcp = m.field?.lcpMs ?? m.lcpMs;
  const source = m.field?.lcpMs ? 'real-user' : 'lab';
  const parts = [
    lcp !== null
      ? `${strategy} LCP ${seconds(lcp)} (${source}, ${rating(lcp, GOOD.lcpMs, POOR.lcpMs)})`
      : null,
    m.performanceScore !== null ? `score ${m.performanceScore}` : null,
    m.cls !== null ? `CLS ${m.cls.toFixed(2)}` : null,
  ].filter(Boolean);
  const slow =
    (lcp !== null && lcp > GOOD.lcpMs) ||
    (m.performanceScore !== null && m.performanceScore < GOOD.score) ||
    (m.cls !== null && m.cls > GOOD.cls);
  const advice = slow && t.pageCount > 1 ? ' Fixing this one template improves all of them.' : '';
  return `${pages} use template ${t.label} with ${parts.join(', ')}.${advice}`;
}
