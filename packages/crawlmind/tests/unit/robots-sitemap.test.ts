import { describe, expect, it } from 'vitest';
import { parseRobots } from '../../src/core/crawler/robots.js';
import { parseSitemap } from '../../src/core/crawler/sitemap.js';

describe('parseRobots', () => {
  const robots = parseRobots(
    'https://example.com/robots.txt',
    [
      'User-agent: *',
      'Disallow: /private/',
      '',
      'User-agent: CrawlmindBot',
      'Disallow: /no-crawlmind',
      'Crawl-delay: 2',
      '',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\n'),
  );

  it('applies the most specific user-agent group', () => {
    expect(robots.isAllowed('https://example.com/no-crawlmind')).toBe(false);
    // Our own group replaces the * group, as robots.txt rules require.
    expect(robots.isAllowed('https://example.com/private/x')).toBe(true);
    expect(robots.isAllowed('https://example.com/ok')).toBe(true);
  });

  it('reads crawl-delay and sitemaps', () => {
    expect(robots.crawlDelayMs).toBe(2000);
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });
});

describe('parseSitemap', () => {
  it('parses url sets with priorities', () => {
    const parsed = parseSitemap(
      `<urlset><url><loc> https://example.com/a?utm_source=x </loc><priority>0.8</priority></url>
       <url><loc>https://example.com/b</loc></url></urlset>`,
      'https://example.com/sitemap.xml',
    );
    expect(parsed.urls).toEqual([
      { url: 'https://example.com/a', priority: 0.8 },
      { url: 'https://example.com/b', priority: null },
    ]);
    expect(parsed.sitemaps).toEqual([]);
  });

  it('parses sitemap indexes', () => {
    const parsed = parseSitemap(
      `<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>`,
      'https://example.com/sitemap.xml',
    );
    expect(parsed.sitemaps).toEqual(['https://example.com/s1.xml']);
  });
});
