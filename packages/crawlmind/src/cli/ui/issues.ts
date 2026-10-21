import type { CrawlSummary, Issue, Severity } from '../../core/index.js';
import {
  displayUrl,
  formatDuration,
  formatNumber,
  terminalWidth,
  truncateMiddle,
} from './format.js';
import type { Theme } from './theme.js';

export function severityBadge(theme: Theme, severity: Severity): string {
  const { c, sym } = theme;
  if (severity === 'critical') return c.red(sym.critical);
  if (severity === 'warning') return c.yellow(sym.warn);
  return c.blue(sym.info);
}

/** An issue as a heading with its count, plus indented examples. */
export function renderIssue(theme: Theme, issue: Issue, site: string, examples = 3): string {
  const { c } = theme;
  const width = Math.min(terminalWidth(), 110);
  const head = `  ${severityBadge(theme, issue.severity)} ${c.bold(issue.title)}`;
  const count = formatNumber(issue.count);
  const pad = Math.max(2, width - issue.title.length - count.length - 6);
  const lines = [`${head}${' '.repeat(pad)}${c.bold(count)}`];
  for (const example of issue.examples.slice(0, examples)) {
    const text = `${displayUrl(example.url, site)}${example.detail ? `  ${example.detail.replaceAll(site, '')}` : ''}`;
    lines.push(`    ${c.dim(truncateMiddle(text, width - 6))}`);
  }
  if (issue.count > examples)
    lines.push(
      `    ${c.dim(`… ${formatNumber(issue.count - Math.min(examples, issue.examples.length))} more`)}`,
    );
  return lines.join('\n');
}

export function renderSummary(
  theme: Theme,
  s: CrawlSummary,
  opts: { issues?: number } = {},
): string {
  const { c, sym } = theme;
  const t = s.totals;
  const host = new URL(s.crawl.site).host;
  const dot = c.dim(` ${sym.dot} `);
  const field = (label: string, value: string) => `  ${c.dim(label.padEnd(9))}${value}`;
  const status = [
    `2xx ${formatNumber(t.status['2xx'])}`,
    `3xx ${formatNumber(t.status['3xx'])}`,
    t.status['4xx'] ? c.red(`4xx ${formatNumber(t.status['4xx'])}`) : '4xx 0',
    t.status['5xx'] ? c.red(`5xx ${formatNumber(t.status['5xx'])}`) : '5xx 0',
    t.status.failed ? c.red(`failed ${t.status.failed}`) : null,
    t.status.blocked ? `blocked ${t.status.blocked}` : null,
  ].filter(Boolean);
  const n = s.issueCounts;
  const counts = [
    c.red(`${sym.critical} ${formatNumber(n.critical)} critical`),
    c.yellow(`${sym.warn} ${formatNumber(n.warning)} ${n.warning === 1 ? 'warning' : 'warnings'}`),
    c.blue(`${sym.info} ${formatNumber(n.info)} ${n.info === 1 ? 'notice' : 'notices'}`),
  ];

  const lines = [
    `${c.bold(host)}${dot}${c.dim(`crawl ${s.crawl.crawlId}`)}${dot}${c.dim(`${formatNumber(s.crawl.pagesCrawled)} pages in ${formatDuration(s.crawl.durationMs)}`)}`,
    '',
    field(
      'Pages',
      `${formatNumber(t.pages)}${dot}${formatNumber(t.htmlPages)} HTML${dot}${formatNumber(t.indexablePages)} indexable`,
    ),
    field('Status', status.join(dot)),
    field(
      'Links',
      `${formatNumber(t.internalLinks)} internal${dot}${formatNumber(t.externalLinks)} external`,
    ),
    field(
      'TTFB',
      `median ${s.ttfbMs.median === null ? '—' : `${Math.round(s.ttfbMs.median)} ms`}${dot}p90 ${s.ttfbMs.p90 === null ? '—' : `${Math.round(s.ttfbMs.p90)} ms`}`,
    ),
    field('Issues', counts.join('  ')),
  ];
  const shown = s.topIssues.slice(0, opts.issues ?? 8);
  if (shown.length) {
    lines.push('');
    for (const issue of shown) lines.push(renderIssue(theme, issue, s.crawl.site, 2));
  }
  return lines.join('\n');
}
