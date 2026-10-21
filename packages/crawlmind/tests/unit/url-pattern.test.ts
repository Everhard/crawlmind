import { describe, expect, it } from 'vitest';
import { isVariableSegment, urlPatterns } from '../../src/core/speed/url-pattern.js';

const site = (paths: string[]) => paths.map((p) => `https://shop.example${p}`);

describe('isVariableSegment', () => {
  it.each([
    '123',
    '2024-05',
    '2024-05-17',
    '550e8400-e29b-41d4-a716-446655440000',
    'a1b2c3d4e5',
    'how-to-pick-the-right-running-shoes',
  ])('treats %s as variable', (s) => expect(isVariableSegment(s)).toBe(true));
  it.each(['blog', 'products', 'about-us', 'faq'])('treats %s as literal', (s) =>
    expect(isVariableSegment(s)).toBe(false),
  );
});

describe('urlPatterns', () => {
  it('collapses ids, numbered slugs and high-cardinality siblings', () => {
    const urls = site([
      '/',
      '/about',
      '/contact',
      '/product/101',
      '/product/102',
      '/product/103',
      '/blog/post-1',
      '/blog/post-2',
      '/category/shoes',
      '/category/shirts',
      '/category/hats',
      '/category/socks',
      '/category/shoes/page/2',
      '/category/hats/page/3',
      '/docs/intro',
      '/docs/setup',
    ]);
    const patterns = urlPatterns(urls);
    const at = (path: string) => patterns.get(`https://shop.example${path}`);
    expect(at('/')).toBe('/');
    expect(at('/about')).toBe('/about');
    expect(at('/product/102')).toBe('/product/*');
    expect(at('/blog/post-2')).toBe('/blog/*');
    expect(at('/category/socks')).toBe('/category/*');
    expect(at('/category/hats/page/3')).toBe('/category/*/page/*');
    // Two distinct literal siblings stay apart.
    expect(at('/docs/intro')).toBe('/docs/intro');
  });

  it('never merges first-level sections by count alone', () => {
    const patterns = urlPatterns(site(['/a', '/b', '/c', '/d', '/e', '/f']));
    expect(new Set(patterns.values()).size).toBe(6);
  });

  it('decodes and lowercases segments', () => {
    const patterns = urlPatterns(['https://x.example/Blog/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82']);
    expect([...patterns.values()]).toEqual(['/blog/привет']);
  });
});
