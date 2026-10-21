import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import type { AuditService } from '../analysis/audit.js';
import { CrawlmindError } from '../errors.js';
import { dataDir } from '../paths.js';
import type { SpeedService } from '../speed/service.js';
import { collectReportData } from './data.js';
import { renderHtmlReport } from './html.js';
import { renderMarkdownReport } from './markdown.js';

export type ReportFormat = 'html' | 'markdown';

const EXTENSIONS: Record<ReportFormat, string[]> = {
  html: ['.html', '.htm'],
  markdown: ['.md', '.markdown'],
};

export interface ExportResult {
  path: string;
  format: ReportFormat;
  bytes: number;
}

/**
 * Write a report file. The path must end in an extension matching the format and, unless
 * `overwrite` is set, must not exist yet, so a report can never replace an unrelated file.
 * Without a path, reports go to ~/.crawlmind/reports.
 */
export function exportReport(
  audit: AuditService,
  speed: SpeedService,
  crawlId: string,
  opts: { format: ReportFormat; path?: string; overwrite?: boolean },
): ExportResult {
  const crawl = audit.requireAnalyzed(crawlId);
  const ext = EXTENSIONS[opts.format][0] as string;
  let target: string;
  if (opts.path) {
    target = resolve(opts.path);
    if (!EXTENSIONS[opts.format].includes(extname(target).toLowerCase())) {
      throw new CrawlmindError(
        'invalid_input',
        `A ${opts.format} report path must end in ${EXTENSIONS[opts.format].join(' or ')}.`,
      );
    }
    if (!existsSync(dirname(target)) || !statSync(dirname(target)).isDirectory()) {
      throw new CrawlmindError('invalid_input', `Directory ${dirname(target)} does not exist.`);
    }
  } else {
    const dir = join(dataDir(), 'reports');
    mkdirSync(dir, { recursive: true });
    // `host:port` is not a valid file name everywhere.
    const host = new URL(crawl.site).host.replace(/[^a-z0-9.-]+/gi, '-');
    target = join(dir, `${host}-${crawl.crawlId}${ext}`);
  }
  if (existsSync(target) && !opts.overwrite) {
    throw new CrawlmindError(
      'invalid_input',
      `${target} already exists.`,
      'Pass overwrite=true to replace it.',
    );
  }

  const data = collectReportData(audit, speed, crawlId);
  const content = opts.format === 'html' ? renderHtmlReport(data) : renderMarkdownReport(data);
  writeFileSync(target, content, 'utf8');
  return { path: target, format: opts.format, bytes: Buffer.byteLength(content) };
}
