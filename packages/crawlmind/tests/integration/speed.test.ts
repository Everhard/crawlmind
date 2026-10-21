import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../../src/core/index.js';
import { crawlAndWait, createTestEngine } from '../helpers/engine.js';
import { startFixtureSites } from '../helpers/fixture-server.js';
import { psiFixture } from '../helpers/psi.js';

describe('templates and PageSpeed Insights', () => {
  let sites: Awaited<ReturnType<typeof startFixtureSites>>;
  let engine: Engine;
  let crawlId: string;
  const fetch = vi.fn(
    async () => new Response(JSON.stringify(psiFixture({ score: 0.42, lcp: 4200 }))),
  );

  beforeAll(async () => {
    sites = await startFixtureSites();
    engine = createTestEngine({ psi: { fetch, backoffMs: 1 }, allowPrivatePsiTargets: true });
    crawlId = (await crawlAndWait(engine, { url: sites.site.origin, checkExternalLinks: false }))
      .crawlId;
  });

  afterAll(async () => {
    await engine.close();
    await sites.close();
  });

  it('groups blog posts into one template', () => {
    const templates = engine.speed.templates(crawlId, { limit: 50, offset: 0 }).items;
    const blog = templates.find((t) => t.pattern === '/blog/*');
    expect(blog?.pageCount).toBe(3);
    expect(blog?.representatives.length).toBe(2);
    expect(blog?.ttfbMedianMs).toBeGreaterThan(0);
    expect(templates[0]?.pageCount).toBe(Math.max(...templates.map((t) => t.pageCount)));
    // Every 200 HTML page belongs to exactly one template.
    const total = templates.reduce((sum, t) => sum + t.pageCount, 0);
    expect(total).toBe(engine.audit.summary(crawlId).totals.htmlPages);
  });

  it('measures representatives and reuses stored results', async () => {
    const blog = engine.speed
      .templates(crawlId, { limit: 50, offset: 0 })
      .items.find((t) => t.pattern === '/blog/*');
    const results = await engine.speed.measure(crawlId, {
      strategy: 'mobile',
      templateIds: [blog?.templateId as number],
      maxTemplates: 5,
      perTemplate: 2,
      force: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results[0]?.template.measurements).toHaveLength(2);
    expect(results[0]?.insight).toBe(
      '3 pages use template /blog/* with mobile LCP 3.9 s (real-user, needs improvement), score 42, CLS 0.12. Fixing this one template improves all of them.',
    );

    await engine.speed.measure(crawlId, {
      strategy: 'mobile',
      templateIds: [blog?.templateId as number],
      maxTemplates: 5,
      perTemplate: 2,
      force: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refuses private sites without the test override', async () => {
    const strict = createTestEngine();
    const id = (
      await crawlAndWait(strict, { url: sites.site.origin, maxPages: 2, checkExternalLinks: false })
    ).crawlId;
    await expect(
      strict.speed.measure(id, {
        strategy: 'mobile',
        maxTemplates: 1,
        perTemplate: 1,
        force: false,
      }),
    ).rejects.toThrow(/cannot reach/);
    await strict.close();
  });
});
