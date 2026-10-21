import { THRESHOLDS } from '../config/thresholds.js';
import type { CrawlOptions } from '../schemas.js';
import { buildTemplates } from '../speed/templates.js';
import type { DB } from '../storage/db.js';
import { CHECKS } from './checks.js';
import { isIndexable, loadCrawlData } from './data.js';
import { computeMetrics } from './graph.js';
import { RUNNERS } from './runners.js';

export interface AnalysisResult {
  pages: number;
  issues: number;
}

/**
 * Run every check and compute link metrics for a crawl, replacing earlier results.
 * Safe to re-run (e.g. after changing thresholds).
 */
export function analyzeCrawl(db: DB, crawlId: string): AnalysisResult {
  const data = loadCrawlData(db, crawlId);
  const metrics = computeMetrics(data);
  const { options_json } = db
    .prepare('SELECT options_json FROM crawls WHERE id = ?')
    .get(crawlId) as {
    options_json: string;
  };
  const options = JSON.parse(options_json) as Partial<CrawlOptions>;
  const ctx = {
    data,
    metrics,
    thinContentWords: options.thinContentWords ?? THRESHOLDS.thinContentWords,
  };

  const insertMetric = db.prepare(
    `INSERT INTO page_metrics (page_id, crawl_id, indexable, inlinks, unique_inlinks, main_inlinks,
       outlinks, external_outlinks, unique_anchors, click_depth, pagerank)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertIssue = db.prepare(
    `INSERT INTO issues (crawl_id, check_id, severity, count) VALUES (?, ?, ?, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO issue_items (crawl_id, check_id, url, detail) VALUES (?, ?, ?, ?)`,
  );

  let issueCount = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM page_metrics WHERE crawl_id = ?').run(crawlId);
    db.prepare('DELETE FROM issues WHERE crawl_id = ?').run(crawlId);
    db.prepare('DELETE FROM issue_items WHERE crawl_id = ?').run(crawlId);

    for (const page of data.pages) {
      const m = metrics.get(page.id);
      if (!m) continue;
      insertMetric.run(
        page.id,
        crawlId,
        isIndexable(page) ? 1 : 0,
        m.inlinks,
        m.uniqueInlinks,
        m.mainInlinks,
        m.outlinks,
        m.externalOutlinks,
        m.uniqueAnchors,
        m.clickDepth,
        m.pagerank,
      );
    }

    for (const check of CHECKS) {
      const items = RUNNERS[check.id]?.(ctx) ?? [];
      if (items.length === 0) continue;
      issueCount++;
      insertIssue.run(crawlId, check.id, check.severity, items.length);
      for (const item of items) insertItem.run(crawlId, check.id, item.url, item.detail ?? null);
    }

    db.prepare('UPDATE crawls SET analyzed_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      crawlId,
    );
  })();
  buildTemplates(db, crawlId);

  return { pages: data.pages.length, issues: issueCount };
}
