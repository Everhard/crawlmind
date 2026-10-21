/**
 * The fixture site. `{{origin}}` and `{{external}}` in bodies are replaced with the base URLs
 * of the site server and of a second server that plays an external website.
 */
export interface Route {
  status?: number;
  headers?: Record<string, string>;
  /** File under fixtures/site/pages. */
  file?: string;
  body?: string;
  location?: string;
}

export const SITE_ROUTES: Record<string, Route> = {
  '/': { file: 'index.html' },
  '/about': { file: 'about.html' },
  '/blog/': { file: 'blog.html' },
  '/blog/post-1': { file: 'post-1.html' },
  '/blog/post-2': { file: 'post-2.html' },
  '/blog/post-3': { file: 'post-3.html' },
  '/products/': { file: 'products.html' },
  '/orphan': { file: 'orphan.html' },
  '/noindex-page': { file: 'noindex.html' },
  '/thin': { file: 'thin.html' },
  '/dup-1': { file: 'dup-1.html' },
  '/dup-2': { file: 'dup-2.html' },
  '/old-page': { status: 301, location: '/older-page' },
  '/older-page': { status: 301, location: '/about' },
  '/loop-a': { status: 302, location: '/loop-b' },
  '/loop-b': { status: 302, location: '/loop-a' },
  '/server-error': { status: 500, body: 'Internal error' },
  '/private/secret': { body: '<html><body>secret</body></html>' },
  '/file.pdf': { headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.4' },
  '/style.css': { headers: { 'content-type': 'text/css' }, body: 'body{}' },
  '/robots.txt': {
    headers: { 'content-type': 'text/plain' },
    body: 'User-agent: *\nDisallow: /private/\n\nSitemap: {{origin}}/sitemap_index.xml\n',
  },
  '/sitemap_index.xml': {
    headers: { 'content-type': 'application/xml' },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>{{origin}}/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`,
  },
  '/sitemap-pages.xml': {
    headers: { 'content-type': 'application/xml' },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{{origin}}/</loc><priority>1.0</priority></url>
  <url><loc>{{origin}}/about</loc></url>
  <url><loc>{{origin}}/orphan</loc><priority>0.8</priority></url>
  <url><loc>{{origin}}/noindex-page</loc></url>
  <url><loc>{{origin}}/gone-from-sitemap</loc></url>
</urlset>`,
  },
};

export const EXTERNAL_ROUTES: Record<string, Route> = {
  '/ok': { body: 'ok' },
  // Rejects HEAD like some real servers, so the checker must fall back to GET.
  '/head-not-allowed': { body: 'ok' },
};
