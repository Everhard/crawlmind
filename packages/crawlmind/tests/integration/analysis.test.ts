import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CrawlSummary, Engine, Issue } from '../../src/core/index.js';
import { crawlAndWait, createTestEngine } from '../helpers/engine.js';
import { startFixtureSites } from '../helpers/fixture-server.js';

describe('analysis of the fixture site', () => {
  let sites: Awaited<ReturnType<typeof startFixtureSites>>;
  let engine: Engine;
  let crawlId: string;
  let summary: CrawlSummary;
  let issues: Map<string, Issue>;
  const p = (path: string) => `${sites.site.origin}${path}`;
  const urls = (checkId: string) =>
    engine.audit
      .issueItems(crawlId, checkId, { limit: 100, offset: 0 })
      .items.items.map((i) => i.url.replace(sites.site.origin, ''));

  beforeAll(async () => {
    sites = await startFixtureSites();
    engine = createTestEngine();
    crawlId = (await crawlAndWait(engine, { url: sites.site.origin })).crawlId;
    summary = engine.audit.summary(crawlId, 100);
    issues = new Map(
      engine.audit.issues(crawlId, { limit: 100, offset: 0 }).items.map((i) => [i.id, i]),
    );
  });

  afterAll(async () => {
    await engine.close();
    await sites.close();
  });

  it('summarizes the crawl', () => {
    expect(summary.totals.status['4xx']).toBeGreaterThanOrEqual(2);
    expect(summary.totals.status['5xx']).toBe(1);
    expect(summary.totals.status.blocked).toBe(1);
    expect(summary.totals.htmlPages).toBeGreaterThan(10);
    expect(summary.ttfbMs.median).toBeGreaterThan(0);
    expect(summary.issueCounts.critical).toBeGreaterThan(0);
    // Most severe first
    const order = summary.topIssues.map((i) => i.severity);
    expect(order.indexOf('critical')).toBeLessThan(order.lastIndexOf('info'));
  });

  it('every issue follows the shared schema', () => {
    for (const issue of issues.values()) {
      expect(issue.examples.length).toBeLessThanOrEqual(5);
      expect(issue.count).toBeGreaterThanOrEqual(issue.examples.length);
      expect(issue.recommendation).not.toBe('');
    }
  });

  it('finds error pages', () => {
    expect(urls('pages.http_4xx')).toEqual(
      expect.arrayContaining(['/missing', '/gone-from-sitemap']),
    );
    expect(urls('pages.http_5xx')).toEqual(['/server-error']);
  });

  it('finds broken internal links with source and anchor', () => {
    const items = engine.audit.issueItems(crawlId, 'links.broken_internal', {
      limit: 100,
      offset: 0,
    }).items.items;
    expect(items).toContainEqual({
      url: p('/'),
      detail: `→ ${p('/missing')} (404) "missing page"`,
    });
    expect(items.some((i) => i.detail?.includes('/server-error (500)'))).toBe(true);
  });

  it('finds broken external links but not bot-blocked ones', () => {
    const details = engine.audit
      .issueItems(crawlId, 'links.broken_external', { limit: 100, offset: 0 })
      .items.items.map((i) => i.detail);
    expect(details).toEqual([expect.stringContaining('/gone (404)')]);
  });

  it('finds redirect chains, loops and links to redirects', () => {
    expect(urls('redirects.chain')).toEqual(['/old-page']);
    expect(urls('redirects.loop')).toEqual(['/loop-a']);
    expect(issues.get('links.to_redirect')?.examples[0]?.detail).toContain('/old-page (301 →');
  });

  it('finds sitemap problems', () => {
    expect(urls('sitemap.orphan')).toEqual(['/orphan', '/noindex-page']);
    expect(urls('sitemap.noindex')).toEqual(['/noindex-page']);
    expect(urls('sitemap.non_200')).toEqual(['/gone-from-sitemap']);
  });

  it('finds content problems', () => {
    expect(urls('titles.duplicate').sort()).toEqual(['/dup-1', '/dup-2']);
    expect(urls('content.thin')).toEqual(['/thin']);
  });

  it('finds link hygiene problems', () => {
    expect(issues.get('links.internal_nofollow')?.examples[0]?.detail).toContain('/dup-2');
    expect(issues.get('anchors.generic')?.examples.map((e) => e.detail)).toContain(
      `"click here" → ${p('/dup-2')}`,
    );
  });

  it('computes link metrics and PageRank', () => {
    const home = engine.audit.page(crawlId, p('/'));
    expect(home.metrics?.clickDepth).toBe(0);
    expect(home.metrics?.inlinks).toBeGreaterThan(10);

    const top = engine.audit.topPages(crawlId, 'pagerank', { limit: 3, offset: 0 }).items;
    expect(top[0]?.pagerankScore).toBe(100);
    expect(top.map((t) => t.url)).toContain(p('/'));

    const post2 = engine.audit.page(crawlId, p('/blog/post-2'));
    expect(post2.metrics?.clickDepth).toBe(2);
    // Redirecting URLs sit at the depth of their target.
    expect(engine.audit.page(crawlId, p('/old-page')).redirectChain).toHaveLength(3);
  });

  it('lists inlinks and outlinks with placement', () => {
    const inlinks = engine.audit.links(crawlId, p('/about'), {
      direction: 'in',
      limit: 100,
      offset: 0,
    });
    // Links to /about directly and via the /old-page redirect.
    expect(inlinks.items.some((l) => l.target === p('/old-page'))).toBe(true);
    expect(new Set(inlinks.items.map((l) => l.placement))).toEqual(
      new Set(['nav', 'footer', 'main']),
    );

    const content = engine.audit.links(crawlId, p('/about'), {
      direction: 'in',
      excludeNavFooter: true,
      limit: 100,
      offset: 0,
    });
    expect(content.items.every((l) => l.placement === 'main')).toBe(true);

    const out = engine.audit.links(crawlId, p('/'), { direction: 'out', limit: 100, offset: 0 });
    expect(out.items.find((l) => l.target === p('/missing'))?.targetStatus).toBe(404);
  });

  it('runs read-only SQL', async () => {
    const res = await engine.query.run(
      `SELECT COUNT(*) AS n FROM pages WHERE crawl_id = '${crawlId}'`,
    );
    expect(res.rows[0]?.n).toBe(summary.totals.pages);
    await expect(engine.query.run('DELETE FROM pages')).rejects.toThrow(/Only SELECT/);
    await expect(engine.query.run('SELECT 1; DELETE FROM pages')).rejects.toThrow();
    await expect(engine.query.run('WITH x AS (SELECT 1) DELETE FROM pages')).rejects.toThrow(
      /read-only/,
    );
    expect(await engine.query.run('SELECT * FROM pages', 2)).toMatchObject({
      rowCount: 2,
      truncated: true,
    });
  });

  it('explains when a crawl is still running', () => {
    const crawl = engine.crawls.start({
      url: sites.site.origin,
      allowPrivateNetworks: true,
      delayMs: 100,
    });
    expect(() => engine.audit.summary(crawl.crawlId)).toThrow(/still running/);
    engine.crawls.cancel(crawl.crawlId);
  });
});
