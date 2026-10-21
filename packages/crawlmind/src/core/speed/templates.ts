import type { DB } from '../storage/db.js';
import { bufferToSignature, signatureSimilarity } from './fingerprint.js';
import { urlPatterns } from './url-pattern.js';

/** Pages whose skeletons are at least this similar belong to one template. */
export const TEMPLATE_SIMILARITY = 0.8;
/** Pages measured with PageSpeed Insights per template. */
export const MAX_REPRESENTATIVES = 2;

interface TemplatePage {
  id: number;
  url: string;
  ttfbMs: number | null;
  downloadMs: number | null;
  htmlBytes: number | null;
  wordCount: number | null;
  signature: Uint32Array | null;
}

export interface TemplateGroup {
  pattern: string;
  /** 1 for the main layout of a pattern; 2, 3… when pages of one pattern use different layouts. */
  variant: number;
  pages: TemplatePage[];
}

/**
 * Group pages into templates: first by URL pattern, then, within a pattern, by DOM
 * skeleton similarity (MinHash Jaccard ≥ 0.8, greedy clustering in crawl order).
 */
export function groupTemplates(pages: TemplatePage[]): TemplateGroup[] {
  const patterns = urlPatterns(pages.map((p) => p.url));
  const byPattern = new Map<string, TemplatePage[]>();
  for (const page of pages) {
    const pattern = patterns.get(page.url) ?? '/';
    const list = byPattern.get(pattern);
    if (list) list.push(page);
    else byPattern.set(pattern, [page]);
  }

  const groups: TemplateGroup[] = [];
  for (const [pattern, list] of byPattern) {
    const clusters: { signature: Uint32Array | null; pages: TemplatePage[] }[] = [];
    for (const page of list) {
      const match = clusters.find(
        (c) =>
          (c.signature === null && page.signature === null) ||
          (c.signature !== null &&
            page.signature !== null &&
            signatureSimilarity(c.signature, page.signature) >= TEMPLATE_SIMILARITY),
      );
      if (match) match.pages.push(page);
      else clusters.push({ signature: page.signature, pages: [page] });
    }
    clusters
      .sort((a, b) => b.pages.length - a.pages.length)
      .forEach((cluster, i) => groups.push({ pattern, variant: i + 1, pages: cluster.pages }));
  }
  return groups.sort(
    (a, b) => b.pages.length - a.pages.length || a.pattern.localeCompare(b.pattern),
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function p90(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)] as number;
}

const nums = (values: (number | null)[]) => values.filter((v): v is number => v !== null);
const round = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Pages with TTFB closest to the template median: typical, not best or worst case. */
function representatives(pages: TemplatePage[], ttfbMedian: number | null): string[] {
  const ranked = [...pages].sort((a, b) => {
    if (ttfbMedian === null) return 0;
    return (
      Math.abs((a.ttfbMs ?? Infinity) - ttfbMedian) - Math.abs((b.ttfbMs ?? Infinity) - ttfbMedian)
    );
  });
  return ranked.slice(0, MAX_REPRESENTATIVES).map((p) => p.url);
}

/** Compute templates for a crawl (200 HTML pages) and store them, replacing earlier ones. */
export function buildTemplates(db: DB, crawlId: string): number {
  const rows = db
    .prepare(
      `SELECT id, url, ttfb_ms, download_ms, html_bytes, word_count, dom_signature FROM pages
       WHERE crawl_id = ? AND status = 200 AND content_type LIKE '%html%' ORDER BY id`,
    )
    .all(crawlId) as {
    id: number;
    url: string;
    ttfb_ms: number | null;
    download_ms: number | null;
    html_bytes: number | null;
    word_count: number | null;
    dom_signature: Buffer | null;
  }[];
  const groups = groupTemplates(
    rows.map((r) => ({
      id: r.id,
      url: r.url,
      ttfbMs: r.ttfb_ms,
      downloadMs: r.download_ms,
      htmlBytes: r.html_bytes,
      wordCount: r.word_count,
      signature: r.dom_signature ? bufferToSignature(r.dom_signature) : null,
    })),
  );

  const insert = db.prepare(
    `INSERT INTO templates (crawl_id, pattern, variant, page_count, ttfb_median, ttfb_p90,
       download_median, html_bytes_median, word_count_median, representatives_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const assign = db.prepare('UPDATE pages SET template_id = ? WHERE id = ?');
  db.transaction(() => {
    db.prepare('UPDATE pages SET template_id = NULL WHERE crawl_id = ?').run(crawlId);
    db.prepare('DELETE FROM templates WHERE crawl_id = ?').run(crawlId);
    for (const group of groups) {
      const ttfb = nums(group.pages.map((p) => p.ttfbMs));
      const ttfbMedian = median(ttfb);
      const htmlMedian = median(nums(group.pages.map((p) => p.htmlBytes)));
      const wordsMedian = median(nums(group.pages.map((p) => p.wordCount)));
      const templateId = Number(
        insert.run(
          crawlId,
          group.pattern,
          group.variant,
          group.pages.length,
          round(ttfbMedian),
          round(p90(ttfb)),
          round(median(nums(group.pages.map((p) => p.downloadMs)))),
          htmlMedian === null ? null : Math.round(htmlMedian),
          wordsMedian === null ? null : Math.round(wordsMedian),
          JSON.stringify(representatives(group.pages, ttfbMedian)),
        ).lastInsertRowid,
      );
      for (const page of group.pages) assign.run(templateId, page.id);
    }
  })();
  return groups.length;
}
