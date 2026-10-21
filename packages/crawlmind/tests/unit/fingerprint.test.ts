import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { minHash, signatureSimilarity, skeletonPaths } from '../../src/core/speed/fingerprint.js';
import { groupTemplates } from '../../src/core/speed/templates.js';

const article = (title: string, paragraphs: number) =>
  `<body><header><nav><a>Home</a></nav></header><main><article><h1>${title}</h1>${'<p>text</p>'.repeat(paragraphs)}<aside><ul><li>x</li></ul></aside></article></main><footer><p>c</p></footer></body>`;
const listing = `<body><header><nav><a>Home</a></nav></header><main><section><div class="grid"><div class="card"><img><h3>a</h3><span>$1</span><button>Buy</button></div></div><form><select><option>x</option></select><input></form><table><tr><td>1</td></tr></table></section></main><footer><p>c</p></footer></body>`;

const sig = (html: string) => minHash(skeletonPaths(cheerio.load(html)));

describe('DOM fingerprint', () => {
  it('ignores text and attributes', () => {
    const paths = skeletonPaths(
      cheerio.load('<body><div id="a" class="b">hi<p>there</p></div><script>x</script></body>'),
    );
    expect([...paths]).toEqual(['body>div', 'body>div>p']);
  });

  it('is similar for pages of one template and different across templates', () => {
    expect(signatureSimilarity(sig(article('A', 3)), sig(article('B', 9)))).toBe(1);
    expect(signatureSimilarity(sig(article('A', 3)), sig(listing))).toBeLessThan(0.6);
  });
});

describe('groupTemplates', () => {
  it('splits one URL pattern by layout', () => {
    const page = (id: number, url: string, html: string) => ({
      id,
      url,
      ttfbMs: 100,
      downloadMs: 120,
      htmlBytes: 1000,
      wordCount: 300,
      signature: sig(html),
    });
    const groups = groupTemplates([
      page(1, 'https://x.example/p/1', article('a', 2)),
      page(2, 'https://x.example/p/2', article('b', 5)),
      page(3, 'https://x.example/p/3', listing),
      page(4, 'https://x.example/', listing),
    ]);
    expect(groups.map((g) => [g.pattern, g.variant, g.pages.map((p) => p.id)])).toEqual([
      ['/p/*', 1, [1, 2]],
      ['/', 1, [4]],
      ['/p/*', 2, [3]],
    ]);
  });
});
