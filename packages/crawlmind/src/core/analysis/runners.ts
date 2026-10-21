import { isGenericAnchor } from '../config/generic-anchors.js';
import { THRESHOLDS } from '../config/thresholds.js';
import type { IssueExample } from './checks.js';
import {
  isErrorPage,
  isIndexable,
  isOkHtml,
  isRedirect,
  type CrawlData,
  type LinkData,
  type PageData,
} from './data.js';
import { resolveTarget, type PageMetrics } from './graph.js';

export interface CheckContext {
  data: CrawlData;
  metrics: Map<number, PageMetrics>;
  thinContentWords: number;
}

type Runner = (ctx: CheckContext) => IssueExample[];

const statusText = (p: PageData): string => p.fetchError ?? String(p.status);

/** External statuses that usually mean "bot blocked", not "page gone". */
const UNVERIFIABLE = new Set([401, 403, 429, 999]);

function isBrokenExternal(status: number | null, error: string | null): boolean {
  if (status === null) return error !== null;
  if (UNVERIFIABLE.has(status)) return false;
  return status >= 400;
}

/** One example per distinct (source, target) pair. */
function linkExamples(
  ctx: CheckContext,
  predicate: (link: LinkData) => string | null,
): IssueExample[] {
  const seen = new Set<string>();
  const out: IssueExample[] = [];
  for (const link of ctx.data.links) {
    const detail = predicate(link);
    if (detail === null) continue;
    const key = `${link.sourceId} ${link.targetUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = ctx.data.byId.get(link.sourceId) as PageData;
    out.push({ url: source.url, detail });
  }
  return out;
}

const anchorText = (link: LinkData) => (link.anchor ? ` "${link.anchor.slice(0, 80)}"` : '');

function duplicates(
  ctx: CheckContext,
  value: (p: PageData) => string | null | undefined,
  label: string,
): IssueExample[] {
  const groups = new Map<string, PageData[]>();
  for (const page of ctx.data.pages) {
    if (!isIndexable(page)) continue;
    const v = value(page)?.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), page]);
  }
  const out: IssueExample[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const shown = (value(group[0] as PageData) ?? '').slice(0, 100);
    for (const page of group) {
      out.push({ url: page.url, detail: `${label} "${shown}" shared by ${group.length} pages` });
    }
  }
  return out;
}

const pagesWhere = (ctx: CheckContext, fn: (p: PageData) => string | null): IssueExample[] =>
  ctx.data.pages.flatMap((page) => {
    const detail = fn(page);
    return detail === null ? [] : [{ url: page.url, detail }];
  });

export const RUNNERS: Record<string, Runner> = {
  'pages.http_4xx': (ctx) =>
    pagesWhere(ctx, (p) =>
      p.status !== null && p.status >= 400 && p.status < 500 ? String(p.status) : null,
    ),

  'pages.http_5xx': (ctx) =>
    pagesWhere(ctx, (p) => (p.status !== null && p.status >= 500 ? String(p.status) : null)),

  'pages.fetch_failed': (ctx) =>
    pagesWhere(ctx, (p) =>
      p.fetchError && !/redirect/i.test(p.fetchError) && p.status === null ? p.fetchError : null,
    ),

  'links.broken_internal': (ctx) =>
    linkExamples(ctx, (link) => {
      if (!link.isInternal) return null;
      const target = resolveTarget(ctx.data, link.targetUrl);
      if (!target || !isErrorPage(target)) return null;
      return `→ ${link.targetUrl} (${statusText(target)})${anchorText(link)}`;
    }),

  'links.broken_external': (ctx) =>
    linkExamples(ctx, (link) => {
      if (link.isInternal) return null;
      const ext = ctx.data.external.get(link.targetUrl);
      if (!ext || !isBrokenExternal(ext.status, ext.error)) return null;
      return `→ ${link.targetUrl} (${ext.status ?? ext.error})${anchorText(link)}`;
    }),

  'redirects.loop': (ctx) =>
    pagesWhere(ctx, (p) => (p.fetchError && /redirect/i.test(p.fetchError) ? p.fetchError : null)),

  'redirects.chain': (ctx) =>
    pagesWhere(ctx, (p) =>
      p.redirectCount > 1 ? `${p.redirectCount} hops → ${p.finalUrl}` : null,
    ),

  'links.to_redirect': (ctx) =>
    linkExamples(ctx, (link) => {
      if (!link.isInternal) return null;
      const target = ctx.data.byUrl.get(link.targetUrl);
      if (!target || !isRedirect(target) || target.fetchError) return null;
      return `→ ${link.targetUrl} (${target.status} → ${target.finalUrl})${anchorText(link)}`;
    }),

  'sitemap.orphan': (ctx) =>
    pagesWhere(ctx, (p) =>
      p.inSitemap && isOkHtml(p) && ctx.metrics.get(p.id)?.inlinks === 0
        ? 'no internal links point here'
        : null,
    ),

  'sitemap.noindex': (ctx) =>
    pagesWhere(ctx, (p) => (p.inSitemap && isOkHtml(p) && p.noindex ? 'noindex' : null)),

  'sitemap.non_200': (ctx) =>
    pagesWhere(ctx, (p) =>
      p.inSitemap && !p.blockedByRobots && p.status !== 200
        ? p.finalUrl
          ? `${p.status} → ${p.finalUrl}`
          : statusText(p)
        : null,
    ),

  'canonical.non_200': (ctx) =>
    pagesWhere(ctx, (p) => {
      if (!isOkHtml(p) || !p.canonical || p.canonical === p.url) return null;
      const target = resolveTarget(ctx.data, p.canonical);
      return target && isErrorPage(target)
        ? `canonical ${p.canonical} returns ${statusText(target)}`
        : null;
    }),

  'canonical.redirect': (ctx) =>
    pagesWhere(ctx, (p) => {
      if (!isOkHtml(p) || !p.canonical || p.canonical === p.url) return null;
      const target = ctx.data.byUrl.get(p.canonical);
      return target && isRedirect(target)
        ? `canonical ${p.canonical} redirects to ${target.finalUrl}`
        : null;
    }),

  'canonical.other_page': (ctx) =>
    pagesWhere(ctx, (p) => {
      if (!isOkHtml(p) || !p.canonical || p.canonical === p.url) return null;
      const target = resolveTarget(ctx.data, p.canonical);
      if (target && (isErrorPage(target) || isRedirect(target))) return null; // reported above
      return `canonical → ${p.canonical}`;
    }),

  'titles.missing': (ctx) =>
    pagesWhere(ctx, (p) => (isIndexable(p) && !p.title ? 'no <title>' : null)),

  'titles.duplicate': (ctx) => duplicates(ctx, (p) => p.title, 'title'),

  'meta_description.missing': (ctx) =>
    pagesWhere(ctx, (p) => (isIndexable(p) && !p.metaDescription ? 'no meta description' : null)),

  'meta_description.duplicate': (ctx) => duplicates(ctx, (p) => p.metaDescription, 'description'),

  'h1.missing': (ctx) =>
    pagesWhere(ctx, (p) => (isIndexable(p) && p.h1.length === 0 ? 'no <h1>' : null)),

  'h1.duplicate': (ctx) => duplicates(ctx, (p) => p.h1[0], 'H1'),

  'content.thin': (ctx) =>
    pagesWhere(ctx, (p) =>
      isIndexable(p) && p.wordCount !== null && p.wordCount < ctx.thinContentWords
        ? `${p.wordCount} words (threshold ${ctx.thinContentWords})`
        : null,
    ),

  'depth.deep': (ctx) =>
    pagesWhere(ctx, (p) => {
      const depth = ctx.metrics.get(p.id)?.clickDepth;
      return isIndexable(p) && depth != null && depth > THRESHOLDS.deepPageDepth
        ? `${depth} clicks`
        : null;
    }),

  'speed.slow_ttfb': (ctx) =>
    pagesWhere(ctx, (p) =>
      isOkHtml(p) && p.ttfbMs !== null && p.ttfbMs > THRESHOLDS.slowTtfbMs
        ? `TTFB ${Math.round(p.ttfbMs)} ms`
        : null,
    ),

  'speed.large_html': (ctx) =>
    pagesWhere(ctx, (p) =>
      p.htmlBytes !== null && p.htmlBytes > THRESHOLDS.largeHtmlBytes
        ? `${(p.htmlBytes / 1024 / 1024).toFixed(1)} MB`
        : null,
    ),

  'security.mixed_content': (ctx) =>
    pagesWhere(ctx, (p) =>
      p.mixedContent.length
        ? `${p.mixedContent.length} http resource(s), e.g. ${p.mixedContent[0]}`
        : null,
    ),

  'links.internal_nofollow': (ctx) =>
    linkExamples(ctx, (link) =>
      link.isInternal && link.nofollow ? `→ ${link.targetUrl}${anchorText(link)}` : null,
    ),

  'anchors.generic': (ctx) =>
    linkExamples(ctx, (link) =>
      link.isInternal && isGenericAnchor(link.anchor)
        ? `"${link.anchor}" → ${link.targetUrl}`
        : null,
    ),

  'anchors.empty': (ctx) =>
    linkExamples(ctx, (link) => (link.isInternal && !link.anchor ? `→ ${link.targetUrl}` : null)),
};
