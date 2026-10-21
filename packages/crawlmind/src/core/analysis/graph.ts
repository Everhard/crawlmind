import { isOkHtml, type CrawlData, type PageData } from './data.js';
import { pageRank } from './pagerank.js';

export interface PageMetrics {
  inlinks: number;
  uniqueInlinks: number;
  /** Inlinks placed in the main content (not nav, header or footer). */
  mainInlinks: number;
  outlinks: number;
  externalOutlinks: number;
  uniqueAnchors: number;
  clickDepth: number | null;
  pagerank: number | null;
}

/**
 * Resolve a link target to the page it lands on: the page itself, or the final page of its
 * redirect chain when that page was crawled.
 */
export function resolveTarget(data: CrawlData, url: string): PageData | undefined {
  const page = data.byUrl.get(url);
  if (page?.finalUrl) return data.byUrl.get(page.finalUrl) ?? page;
  return page;
}

/** Inlinks, outlinks, click depth and PageRank for every page of a crawl. */
export function computeMetrics(data: CrawlData): Map<number, PageMetrics> {
  const metrics = new Map<number, PageMetrics>();
  for (const page of data.pages) {
    metrics.set(page.id, {
      inlinks: 0,
      uniqueInlinks: 0,
      mainInlinks: 0,
      outlinks: 0,
      externalOutlinks: 0,
      uniqueAnchors: 0,
      clickDepth: null,
      pagerank: null,
    });
  }

  const sources = new Map<number, Set<number>>();
  const anchors = new Map<number, Set<string>>();
  // Click graph (all links) and PageRank graph (followed links between 200 HTML pages).
  const clickEdges = new Map<number, Set<number>>();
  const rankEdges = new Map<number, Set<number>>();

  for (const link of data.links) {
    const source = metrics.get(link.sourceId);
    if (!source) continue;
    if (!link.isInternal) {
      source.externalOutlinks++;
      continue;
    }
    source.outlinks++;
    const target = resolveTarget(data, link.targetUrl);
    if (!target || target.id === link.sourceId) continue;
    const m = metrics.get(target.id) as PageMetrics;
    m.inlinks++;
    if (link.placement === 'main') m.mainInlinks++;
    addTo(sources, target.id, link.sourceId);
    if (link.anchor) addTo(anchors, target.id, link.anchor.toLowerCase());
    addTo(clickEdges, link.sourceId, target.id);
    const sourcePage = data.byId.get(link.sourceId) as PageData;
    if (!link.nofollow && isOkHtml(sourcePage) && isOkHtml(target))
      addTo(rankEdges, link.sourceId, target.id);
  }
  for (const [id, set] of sources) (metrics.get(id) as PageMetrics).uniqueInlinks = set.size;
  for (const [id, set] of anchors) (metrics.get(id) as PageMetrics).uniqueAnchors = set.size;

  // Click depth: breadth-first from the start page. Redirect hops do not count as clicks.
  const start = resolveTarget(data, data.startUrl);
  if (start) {
    const queue: number[] = [start.id];
    (metrics.get(start.id) as PageMetrics).clickDepth = 0;
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i] as number;
      const depth = (metrics.get(id) as PageMetrics).clickDepth as number;
      for (const next of clickEdges.get(id) ?? []) {
        const m = metrics.get(next) as PageMetrics;
        if (m.clickDepth === null) {
          m.clickDepth = depth + 1;
          queue.push(next);
        }
      }
    }
    // A redirecting URL sits at the depth of the page it lands on.
    for (const page of data.pages) {
      if (!page.finalUrl) continue;
      const final = data.byUrl.get(page.finalUrl);
      const m = metrics.get(page.id) as PageMetrics;
      if (final && m.clickDepth === null) m.clickDepth = metrics.get(final.id)?.clickDepth ?? null;
    }
  }

  // PageRank over 200 HTML pages.
  const nodes = data.pages.filter(isOkHtml);
  const index = new Map(nodes.map((p, i) => [p.id, i]));
  const outLinks = nodes.map((p) =>
    [...(rankEdges.get(p.id) ?? [])].map((id) => index.get(id) as number),
  );
  const ranks = pageRank(outLinks);
  nodes.forEach((p, i) => {
    (metrics.get(p.id) as PageMetrics).pagerank = ranks[i] as number;
  });

  return metrics;
}

function addTo<V>(map: Map<number, Set<V>>, key: number, value: V): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}
