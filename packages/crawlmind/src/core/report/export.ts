import { existsSync, lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AuditService } from '../analysis/audit.js';
import { CrawlmindError } from '../errors.js';
import { dataDir } from '../paths.js';
import { collectReportData } from './data.js';
import { renderHtmlReport } from './html.js';
import { renderMarkdownReport } from './markdown.js';

export type ReportFormat = 'html' | 'markdown';

const EXTENSIONS: Record<ReportFormat, string[]> = {
  html: ['.html', '.htm'],
  markdown: ['.md', '.markdown'],
};

/** Where reports go by default, and the only place untrusted callers may write. */
export function reportsDir(): string {
  return join(dataDir(), 'reports');
}

/** True if `path` resolves (through any symlinked parents) to a location inside `dir`. */
export function isInsideDir(path: string, dir: string): boolean {
  mkdirSync(dir, { recursive: true });
  const parent = existsSync(dirname(path)) ? realpathSync(dirname(path)) : resolve(dirname(path));
  const rel = relative(realpathSync(dir), parent);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

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
  crawlId: string,
  opts: {
    format: ReportFormat;
    path?: string;
    overwrite?: boolean;
    /** Only allow paths inside the reports directory (for MCP clients). */
    restrictToReportsDir?: boolean;
  },
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
    if (opts.restrictToReportsDir && !isInsideDir(target, reportsDir())) {
      throw new CrawlmindError(
        'invalid_input',
        `MCP clients can only write reports inside ${reportsDir()}.`,
        'Omit path to use the default location, or have the person running the server set ' +
          'CRAWLMIND_ALLOW_REPORT_PATHS=1 to allow other paths.',
      );
    }
  } else {
    const dir = reportsDir();
    mkdirSync(dir, { recursive: true });
    // `host:port` is not a valid file name everywhere.
    const host = new URL(crawl.site).host.replace(/[^a-z0-9.-]+/gi, '-');
    target = join(dir, `${host}-${crawl.crawlId}${ext}`);
  }
  // Never follow a symlink at the target: it could point anywhere.
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new CrawlmindError(
      'invalid_input',
      `${target} is a symbolic link; refusing to write through it.`,
    );
  }
  if (existsSync(target) && !opts.overwrite) {
    throw new CrawlmindError(
      'invalid_input',
      `${target} already exists.`,
      'Pass overwrite=true to replace it.',
    );
  }

  const data = collectReportData(audit, crawlId);
  const content = opts.format === 'html' ? renderHtmlReport(data) : renderMarkdownReport(data);
  writeFileSync(target, content, 'utf8');
  return { path: target, format: opts.format, bytes: Buffer.byteLength(content) };
}
