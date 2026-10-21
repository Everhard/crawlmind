import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '../../src/core/index.js';
import { HashingEmbedder } from '../helpers/embedder.js';
import { crawlAndWait, createTestEngine } from '../helpers/engine.js';
import { serve, type FixtureServer } from '../helpers/fixture-server.js';

const page = (
  title: string,
  body: string,
  links = '',
) => `<!doctype html><html lang="en"><head><title>${title}</title></head>
<body><nav><a href="/">Home</a></nav><main><h1>${title}</h1>${body}${links}</main></body></html>`;

const running = (extra: string) =>
  `<p>Running shoes need cushioning and a stable heel. ${extra} Choosing running shoes depends on your stride, the surface and the distance you plan to run each week.</p>
   <p>Unrelated paragraph about our shop opening hours, delivery options and payment methods for every order.</p>`;

const ROUTES = {
  '/': {
    body: page(
      'Sports guides',
      '<p>Welcome to our guides about sports, equipment, food and training plans for every level of athlete.</p>',
      '<a href="/shoes">Shoes</a> <a href="/pasta">Pasta</a> <a href="/marathon">Marathon</a> <a href="/shoes-beginners">Beginners</a>',
    ),
  },
  '/shoes': {
    body: page('Best running shoes', running('Cushioned running shoes protect the knees.')),
  },
  '/shoes-beginners': {
    body: page(
      'Best running shoes for beginners',
      running('Beginners should start with cushioned running shoes.'),
    ),
  },
  '/marathon': {
    body: page(
      'Marathon training plan',
      `<p>A marathon training plan builds weekly distance slowly. Long runs on Sunday matter, and good running shoes with cushioning prevent injuries during the long runs.</p>
       <p>Rest days and sleep help the body adapt to the marathon training load.</p>`,
    ),
  },
  '/pasta': {
    body: page(
      'Pasta carbonara recipe',
      '<p>Carbonara needs eggs, pecorino, guanciale and black pepper. Cook the pasta al dente and mix quickly off the heat so the eggs stay creamy.</p>',
    ),
  },
};

describe('link suggestions and cannibalization', () => {
  let site: FixtureServer;
  let engine: Engine;
  let embedder: HashingEmbedder;
  let crawlId: string;

  beforeAll(async () => {
    site = await serve('127.0.0.1', ROUTES, () => ({}));
    embedder = new HashingEmbedder();
    engine = createTestEngine({ embedder });
    crawlId = (await crawlAndWait(engine, { url: site.origin, checkExternalLinks: false })).crawlId;
  });

  afterAll(async () => {
    await engine.close();
    await site.close();
  });

  it('suggests linking related pages from the best paragraph', async () => {
    const result = await engine.links.suggest(crawlId, {
      targetUrl: `${site.origin}/shoes`,
      limit: 5,
      offset: 0,
      minSimilarity: 0.2,
    });
    const sources = result.items.map((s) => s.sourceUrl.replace(site.origin, ''));
    expect(sources[0]).toBe('/shoes-beginners');
    expect(sources).toContain('/marathon');
    expect(sources).not.toContain('/pasta');
    expect(sources).not.toContain('/'); // already links to /shoes

    const marathon = result.items.find((s) => s.sourceUrl.endsWith('/marathon'));
    expect(marathon?.paragraph).toMatch(/running shoes/);
    expect(marathon?.anchorCandidates[0]).toMatch(/running shoes/i);
    expect(marathon?.targetTitle).toBe('Best running shoes');
  });

  it('ranks suggestions for the whole site and stores vectors', async () => {
    const callsBefore = embedder.calls;
    const all = await engine.links.suggest(crawlId, { limit: 50, offset: 0, minSimilarity: 0.2 });
    expect(all.total).toBeGreaterThan(1);
    expect(all.items.every((s) => s.sourceUrl !== s.targetUrl)).toBe(true);
    const scores = all.items.map((s) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // Page vectors were cached by the first call; only paragraphs may still be embedded.
    expect(embedder.calls - callsBefore).toBeLessThanOrEqual(1);
  });

  it('finds cannibalizing pages', async () => {
    const pairs = await engine.links.cannibalization(crawlId, {
      limit: 10,
      offset: 0,
      minSimilarity: 0.6,
    });
    expect(pairs.items).toHaveLength(1);
    expect(
      [pairs.items[0]?.urlA, pairs.items[0]?.urlB].map((u) => u?.replace(site.origin, '')).sort(),
    ).toEqual(['/shoes', '/shoes-beginners']);
    expect(pairs.items[0]?.sharedTerms).toEqual(expect.arrayContaining(['runni', 'shoes']));
  });

  it('rejects non-indexable targets', async () => {
    await expect(
      engine.links.suggest(crawlId, { targetUrl: `${site.origin}/nope`, limit: 5, offset: 0 }),
    ).rejects.toThrow(/not an indexable/);
  });
});
