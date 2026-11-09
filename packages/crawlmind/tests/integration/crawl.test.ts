import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrawlOptionsSchema, type Engine } from '../../src/core/index.js';
import { crawlAndWait, createTestEngine } from '../helpers/engine.js';
import { startFixtureSites } from '../helpers/fixture-server.js';

type Sites = Awaited<ReturnType<typeof startFixtureSites>>;

interface PageRow {
  url: string;
  status: number | null;
  final_url: string | null;
  fetch_error: string | null;
  depth: number | null;
  in_sitemap: number;
  sitemap_priority: number | null;
  blocked_by_robots: number;
  redirect_count: number;
  title: string | null;
  meta_robots: string | null;
  ttfb_ms: number | null;
}

describe('crawler on the fixture site', () => {
  let sites: Sites;
  let engine: Engine;
  let crawlId: string;
  let pages: Map<string, PageRow>;
  const path = (url: string) => url.replace(sites.site.origin, '');

  beforeAll(async () => {
    sites = await startFixtureSites();
    engine = createTestEngine();
    const crawl = await crawlAndWait(engine, { url: sites.site.origin });
    crawlId = crawl.crawlId;
    const rows = engine.db
      .prepare('SELECT * FROM pages WHERE crawl_id = ?')
      .all(crawlId) as PageRow[];
    pages = new Map(rows.map((row) => [path(row.url), row]));
  });

  afterAll(async () => {
    await engine.close();
    await sites.close();
  });

  it('completes and records every reachable page', () => {
    expect(engine.crawls.requireCrawl(crawlId).status).toBe('completed');
    for (const p of [
      '/',
      '/about',
      '/blog/',
      '/blog/post-1',
      '/blog/post-2',
      '/blog/post-3',
      '/products/',
      '/thin',
      '/dup-1',
      '/dup-2',
    ]) {
      expect(pages.get(p)?.status, p).toBe(200);
    }
    expect(pages.get('/')?.title).toBe('Home');
    expect(pages.get('/')?.ttfb_ms).toBeGreaterThan(0);
  });

  it('normalizes discovered URLs (tracking params, fragments)', () => {
    expect([...pages.keys()].some((p) => p.includes('utm_') || p.includes('#'))).toBe(false);
  });

  it('records link depth', () => {
    expect(pages.get('/')?.depth).toBe(0);
    expect(pages.get('/blog/post-1')?.depth).toBe(1);
    expect(pages.get('/blog/post-2')?.depth).toBe(2);
  });

  it('stores redirect chains hop by hop', () => {
    const old = pages.get('/old-page');
    expect(old).toMatchObject({
      status: 301,
      redirect_count: 2,
      final_url: `${sites.site.origin}/about`,
    });
    const hops = engine.db
      .prepare(
        `SELECT h.url, h.status FROM redirect_hops h JOIN pages p ON p.id = h.page_id
         WHERE p.crawl_id = ? AND p.url = ? ORDER BY hop_index`,
      )
      .all(crawlId, `${sites.site.origin}/old-page`) as { url: string; status: number }[];
    expect(hops.map((h) => [path(h.url), h.status])).toEqual([
      ['/old-page', 301],
      ['/older-page', 301],
      ['/about', 200],
    ]);
  });

  it('detects redirect loops', () => {
    expect(pages.get('/loop-a')?.fetch_error).toBe('Redirect loop');
  });

  it('records error statuses', () => {
    expect(pages.get('/missing')?.status).toBe(404);
    expect(pages.get('/server-error')?.status).toBe(500);
    expect(pages.get('/gone-from-sitemap')?.status).toBe(404);
  });

  it('respects robots.txt', () => {
    expect(pages.get('/private/secret')?.blocked_by_robots).toBe(1);
    expect(sites.site.requests).not.toContain('GET /private/secret');
  });

  it('seeds from sitemap indexes and flags sitemap URLs', () => {
    expect(pages.get('/orphan')).toMatchObject({
      status: 200,
      in_sitemap: 1,
      sitemap_priority: 0.8,
      depth: null,
    });
    expect(pages.get('/noindex-page')?.meta_robots).toBe('noindex, follow');
    expect(pages.get('/blog/post-1')?.in_sitemap).toBe(0);
  });

  it('does not parse non-HTML responses', () => {
    const pdf = engine.db
      .prepare('SELECT content_type, html_bytes FROM pages WHERE crawl_id = ? AND url LIKE ?')
      .get(crawlId, '%/file.pdf') as { content_type: string; html_bytes: number | null };
    expect(pdf).toEqual({ content_type: 'application/pdf', html_bytes: null });
  });

  it('stores links with placement', () => {
    const counts = engine.db
      .prepare(
        `SELECT placement, COUNT(*) AS n FROM links l JOIN pages p ON p.id = l.source_page_id
         WHERE l.crawl_id = ? AND p.url = ? GROUP BY placement`,
      )
      .all(crawlId, `${sites.site.origin}/`) as { placement: string; n: number }[];
    const byPlacement = Object.fromEntries(counts.map((c) => [c.placement, c.n]));
    expect(byPlacement).toMatchObject({ header: 1, nav: 3, footer: 1 });
    expect(byPlacement.main).toBeGreaterThan(5);
  });

  it('checks external links, falling back to GET when HEAD is rejected', () => {
    const rows = engine.db
      .prepare('SELECT url, status FROM external_links WHERE crawl_id = ? ORDER BY url')
      .all(crawlId) as { url: string; status: number }[];
    const byPath = Object.fromEntries(
      rows.map((r) => [r.url.replace(sites.external.origin, ''), r.status]),
    );
    expect(byPath).toEqual({ '/gone': 404, '/head-not-allowed': 200, '/ok': 200 });
    expect(sites.external.requests).toContain('HEAD /head-not-allowed');
    expect(sites.external.requests).toContain('GET /head-not-allowed');
  });
});

describe('crawl limits and control', () => {
  let sites: Sites;
  let engine: Engine;

  beforeAll(async () => {
    sites = await startFixtureSites();
    engine = createTestEngine();
  });

  afterAll(async () => {
    await engine.close();
    await sites.close();
  });

  it('stops at maxPages', async () => {
    const crawl = await crawlAndWait(engine, {
      url: sites.site.origin,
      maxPages: 3,
      checkExternalLinks: false,
    });
    expect(crawl.status).toBe('completed');
    expect(crawl.pagesCrawled).toBe(3);
  });

  it('crawls the whole site with maxPages 0', async () => {
    const unlimited = await crawlAndWait(engine, {
      url: sites.site.origin,
      maxPages: 0,
      checkExternalLinks: false,
    });
    const large = await crawlAndWait(engine, {
      url: sites.site.origin,
      maxPages: 100_000,
      checkExternalLinks: false,
    });
    expect(unlimited.status).toBe('completed');
    expect(unlimited.pagesCrawled).toBeGreaterThan(3);
    expect(unlimited.pagesCrawled).toBe(large.pagesCrawled);
  });

  it('defaults to 1000 pages and has no upper cap', () => {
    const schema = CrawlOptionsSchema;
    expect(schema.parse({ url: 'https://example.com' }).maxPages).toBe(1000);
    expect(schema.parse({ url: 'https://example.com', maxPages: 50_000 }).maxPages).toBe(50_000);
    expect(() => schema.parse({ url: 'https://example.com', maxPages: -1 })).toThrow();
  });

  it('respects maxDepth', async () => {
    const crawl = await crawlAndWait(engine, {
      url: sites.site.origin,
      maxDepth: 0,
      checkExternalLinks: false,
    });
    const depths = engine.db
      .prepare('SELECT DISTINCT depth FROM pages WHERE crawl_id = ? AND depth IS NOT NULL')
      .all(crawl.crawlId) as { depth: number }[];
    expect(depths.map((d) => d.depth)).toEqual([0]);
  });

  it('can be cancelled and keeps partial results', async () => {
    const crawl = engine.crawls.start({
      url: sites.site.origin,
      delayMs: 200,
      allowPrivateNetworks: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    engine.crawls.cancel(crawl.crawlId);
    await engine.crawls.waitFor(crawl.crawlId, Number.POSITIVE_INFINITY);
    const done = engine.crawls.requireCrawl(crawl.crawlId);
    expect(done.status).toBe('cancelled');
    expect(done.pagesCrawled).toBeGreaterThan(0);
    expect(done.pagesCrawled).toBeLessThan(10);
  });

  it('refuses private addresses unless allowed', async () => {
    const crawl = await crawlAndWait(engine, {
      url: sites.site.origin,
      allowPrivateNetworks: false,
    });
    const start = engine.db
      .prepare('SELECT fetch_error FROM pages WHERE crawl_id = ? LIMIT 1')
      .get(crawl.crawlId) as { fetch_error: string };
    expect(start.fetch_error).toMatch(/private or local network/);
  });
});
