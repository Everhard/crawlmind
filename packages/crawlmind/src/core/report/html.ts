import type { TopPage } from '../analysis/audit.js';
import type { Issue, Severity } from '../analysis/checks.js';
import type { TemplateInfo } from '../speed/service.js';
import { VERSION } from '../version.js';
import type { ReportData } from './data.js';

const REPO = 'https://github.com/Everhard/crawlmind';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const e = escapeHtml;
const num = (n: number) => n.toLocaleString('en-US');
const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v).toLocaleString('en-US')} ms`);

function path(url: string, site: string): string {
  return url.startsWith(site) ? url.slice(site.length) || '/' : url;
}

/** Link to a crawled URL, shown relative to the site. Only http(s) URLs become links. */
function urlLink(url: string, site: string): string {
  const label = e(path(url, site));
  return /^https?:\/\//i.test(url)
    ? `<a href="${e(url)}" rel="nofollow noopener">${label}</a>`
    : label;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Notice',
};

const CSS = `
:root{--bg:#fff;--fg:#1a1d21;--muted:#5f6b76;--line:#e3e7eb;--card:#f6f8fa;--accent:#2457d6;
--critical:#c62828;--warning:#b26a00;--info:#3a6ea5;--good:#2e7d32}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--fg:#e6e9ec;--muted:#9aa5b1;--line:#2a3038;
--card:#181c22;--accent:#7aa2ff;--critical:#ff6b6b;--warning:#f0b429;--info:#7cb0e8;--good:#6ccf7b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 16px 48px}
a{color:var(--accent);text-decoration:none;overflow-wrap:anywhere}a:hover{text-decoration:underline}
h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px}h3{font-size:16px;margin:0}
.muted{color:var(--muted)}.small{font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card b{display:block;font-size:24px;line-height:1.2}
.card.critical b{color:var(--critical)}.card.warning b{color:var(--warning)}.card.info b{color:var(--info)}
.issue{border:1px solid var(--line);border-radius:10px;margin:10px 0;background:var(--bg)}
.issue summary{cursor:pointer;list-style:none;padding:12px 16px;display:flex;gap:12px;align-items:center}
.issue summary::-webkit-details-marker{display:none}
.issue .body{padding:0 16px 14px}
.count{margin-left:auto;font-weight:600;white-space:nowrap}
.badge{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.badge.critical{color:var(--critical)}.badge.warning{color:var(--warning)}.badge.info{color:var(--info)}
ul.examples{margin:8px 0 0;padding-left:18px}ul.examples li{margin:3px 0}
.detail{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.fix{margin:10px 0 0;padding:8px 12px;background:var(--card);border-radius:8px;font-size:14px}
.table{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:600px;font-size:14px}
td:first-child{min-width:220px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--muted);background:var(--card)}tr:last-child td{border-bottom:0}
td.n,th.n{text-align:right;white-space:nowrap}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
@media (max-width:600px){h1{font-size:22px}.issue summary{flex-wrap:wrap}.count{margin-left:0}}
`;

function issueBlock(issue: Issue, site: string, open: boolean): string {
  const rest = issue.count - issue.examples.length;
  return `<details class="issue"${open ? ' open' : ''}>
<summary><span class="badge ${issue.severity}">${SEVERITY_LABEL[issue.severity]}</span><h3>${e(issue.title)}</h3><span class="count">${num(issue.count)}</span></summary>
<div class="body">
<ul class="examples">${issue.examples
    .map(
      (x) =>
        `<li>${urlLink(x.url, site)}${x.detail ? `<div class="detail">${e(x.detail.replaceAll(site, ''))}</div>` : ''}</li>`,
    )
    .join('')}${rest > 0 ? `<li class="muted">… and ${num(rest)} more</li>` : ''}</ul>
<p class="fix"><strong>Fix:</strong> ${e(issue.recommendation)} <span class="muted small">(${e(issue.id)})</span></p>
</div></details>`;
}

function pageTable(pages: TopPage[], site: string): string {
  if (pages.length === 0) return '<p class="muted">None.</p>';
  return `<div class="table"><table><thead><tr><th>Page</th><th class="n">PageRank</th><th class="n">Inlinks</th><th class="n">In content</th><th class="n">Depth</th><th class="n">TTFB</th></tr></thead><tbody>${pages
    .map(
      (p) =>
        `<tr><td>${urlLink(p.url, site)}${p.title ? `<div class="detail">${e(p.title)}</div>` : ''}</td><td class="n">${p.pagerankScore ?? '—'}</td><td class="n">${num(p.inlinks)}</td><td class="n">${num(p.mainInlinks)}</td><td class="n">${p.clickDepth ?? '—'}</td><td class="n">${ms(p.ttfbMs)}</td></tr>`,
    )
    .join('')}</tbody></table></div>`;
}

function templateTable(templates: TemplateInfo[], site: string): string {
  if (templates.length === 0) return '<p class="muted">No templates.</p>';
  return `<div class="table"><table><thead><tr><th>Template</th><th class="n">Pages</th><th class="n">TTFB p50</th><th class="n">TTFB p90</th><th class="n">Mobile score</th><th class="n">LCP</th><th>Example</th></tr></thead><tbody>${templates
    .map((t) => {
      const m = t.measurements.find((x) => x.strategy === 'mobile' && !x.error);
      const lcp = m?.field?.lcpMs ?? m?.lcpMs ?? null;
      return `<tr><td><strong>${e(t.label)}</strong></td><td class="n">${num(t.pageCount)}</td><td class="n">${ms(t.ttfbMedianMs)}</td><td class="n">${ms(t.ttfbP90Ms)}</td><td class="n">${m?.performanceScore ?? '—'}</td><td class="n">${lcp === null ? '—' : `${(lcp / 1000).toFixed(1)} s`}</td><td>${t.representatives[0] ? urlLink(t.representatives[0], site) : '—'}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}

/** A self-contained HTML report: inline CSS, no scripts, readable on phones, light and dark. */
export function renderHtmlReport(data: ReportData): string {
  const { summary: s } = data;
  const site = s.crawl.site;
  const host = new URL(site).host;
  const t = s.totals;
  const date = s.crawl.startedAt.slice(0, 10);
  const firstOpen = data.issues.filter((i) => i.severity === 'critical').length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>SEO audit: ${e(host)} (${e(date)})</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>SEO audit: ${e(host)}</h1>
<div class="muted">${urlLink(site, '')} · crawled ${e(date)} · ${num(s.crawl.pagesCrawled)} pages · crawl <code>${e(s.crawl.crawlId)}</code></div>
</header>

<section class="cards">
<div class="card critical"><b>${num(s.issueCounts.critical)}</b>critical issues</div>
<div class="card warning"><b>${num(s.issueCounts.warning)}</b>warnings</div>
<div class="card info"><b>${num(s.issueCounts.info)}</b>notices</div>
<div class="card"><b>${num(t.indexablePages)}</b>indexable of ${num(t.htmlPages)} HTML pages</div>
<div class="card"><b>${ms(s.ttfbMs.median)}</b>median TTFB (p90 ${ms(s.ttfbMs.p90)})</div>
<div class="card"><b>${num(t.internalLinks)}</b>internal links</div>
</section>

<p class="muted small">Status codes: 2xx ${num(t.status['2xx'])} · 3xx ${num(t.status['3xx'])} · 4xx ${num(t.status['4xx'])} · 5xx ${num(t.status['5xx'])} · failed ${num(t.status.failed)} · blocked by robots.txt ${num(t.status.blocked)} · deepest page ${t.maxClickDepth ?? '—'} clicks</p>

<h2>Issues</h2>
${data.issues.length ? data.issues.map((issue, i) => issueBlock(issue, site, i < Math.max(1, firstOpen))).join('\n') : '<p>No issues found.</p>'}

<h2>Important pages that need more links</h2>
<p class="muted">High PageRank or sitemap priority, but few links from page content.</p>
${pageTable(data.underlinked, site)}

<h2>Speed by template</h2>
<p class="muted">Pages grouped by URL pattern and layout. Fixing a slow template fixes every page that uses it.</p>
${templateTable(data.templates, site)}

<h2>Strongest pages (internal PageRank)</h2>
${pageTable(data.topPages, site)}

<h2>Slowest pages (TTFB)</h2>
${pageTable(data.slowestPages, site)}

<footer>Generated by <a href="${REPO}">Crawlmind</a> ${e(VERSION)} on ${e(data.generatedAt.slice(0, 16).replace('T', ' '))} UTC.</footer>
</main>
</body>
</html>
`;
}
