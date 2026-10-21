import { describe, expect, it } from 'vitest';
import { countWords, extractPage } from '../../src/core/crawler/extract.js';

const html = `<!doctype html>
<html lang="uk">
<head>
  <title>  Test   page </title>
  <meta name="description" content="A page">
  <meta name="robots" content="NOINDEX, follow">
  <link rel="canonical" href="/canonical">
  <link rel="stylesheet" href="http://cdn.example.com/a.css">
  <script src="/app.js"></script>
</head>
<body>
  <header><a href="/">Logo</a></header>
  <nav><a href="/about">About</a></nav>
  <div class="breadcrumbs"><a href="/blog">Blog</a></div>
  <main>
    <h1>Hello</h1>
    <article><header><a href="/author">Author</a></header>
      <p>Слова і words-with-dashes here. <a href="/post?utm_source=x#c" rel="nofollow ugc">read more</a></p>
      <a href="/img"><img src="http://example.com/i.png" alt="Picture"></a>
    </article>
  </main>
  <aside><a href="/related">Related</a></aside>
  <div class="site-footer"><a href="/terms">Terms</a></div>
  <a href="mailto:x@y.z">mail</a> <a href="#top">top</a> <a href="javascript:void(0)">js</a>
  <a href="/loose">Loose</a>
</body>
</html>`;

describe('extractPage', () => {
  const page = extractPage(html, 'https://example.com/dir/page');

  it('reads head metadata', () => {
    expect(page.title).toBe('Test page');
    expect(page.metaDescription).toBe('A page');
    expect(page.metaRobots).toBe('noindex, follow');
    expect(page.canonical).toBe('https://example.com/canonical');
    expect(page.lang).toBe('uk');
    expect(page.h1).toEqual(['Hello']);
    expect(page.scriptsCount).toBe(1);
    expect(page.stylesheetsCount).toBe(1);
  });

  it('finds mixed content on https pages', () => {
    expect(page.mixedContent).toEqual(['http://cdn.example.com/a.css', 'http://example.com/i.png']);
  });

  it('extracts crawlable links with placement, anchors and rel', () => {
    const byUrl = Object.fromEntries(
      page.links.map((l) => [l.url.replace('https://example.com', ''), l]),
    );
    expect(Object.keys(byUrl)).toEqual([
      '/',
      '/about',
      '/blog',
      '/author',
      '/post',
      '/img',
      '/related',
      '/terms',
      '/loose',
    ]);
    expect(byUrl['/']?.placement).toBe('header');
    expect(byUrl['/about']?.placement).toBe('nav');
    expect(byUrl['/blog']?.placement).toBe('nav');
    expect(byUrl['/author']?.placement).toBe('main');
    expect(byUrl['/post']).toMatchObject({
      placement: 'main',
      anchor: 'read more',
      rel: 'nofollow ugc',
      nofollow: true,
    });
    expect(byUrl['/img']?.anchor).toBe('Picture');
    expect(byUrl['/related']?.placement).toBe('other');
    expect(byUrl['/terms']?.placement).toBe('footer');
    expect(byUrl['/loose']?.placement).toBe('other');
  });

  it('counts words of the main content only', () => {
    expect(page.wordCount).toBe(
      countWords('Hello Author Слова і words-with-dashes here. read more'),
    );
  });

  it('respects <base href>', () => {
    const withBase = extractPage(
      '<base href="https://cdn.example.com/x/"><a href="y">Y</a>',
      'https://example.com/',
    );
    expect(withBase.links[0]?.url).toBe('https://cdn.example.com/x/y');
  });
});

describe('text cleaning', () => {
  it('drops terminal escape sequences and bidi overrides from crawled text', () => {
    const page = extractPage(
      '<title>Evil\u001b[2J\u001b]0;pwned\u0007 title\u202e</title><a href="/x">a\u009bb</a>',
      'https://example.com/',
    );
    expect(page.title).toBe('Evil[2J]0;pwned title');
    expect(page.links[0]?.anchor).toBe('ab');
  });
});
