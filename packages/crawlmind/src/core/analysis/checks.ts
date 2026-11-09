import { z } from 'zod';

export const SeveritySchema = z.enum(['critical', 'warning', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export const IssueExampleSchema = z.object({ url: z.string(), detail: z.string().optional() });
export type IssueExample = z.infer<typeof IssueExampleSchema>;

/** The shared shape of every reported problem. */
export const IssueSchema = z.object({
  id: z.string(),
  severity: SeveritySchema,
  title: z.string(),
  count: z.number().int(),
  examples: z.array(IssueExampleSchema),
  recommendation: z.string(),
});
export type Issue = z.infer<typeof IssueSchema>;

export interface CheckInfo {
  id: string;
  severity: Severity;
  title: string;
  /** One sentence: what to do. */
  recommendation: string;
  /** Why it matters, for the check documentation. */
  why: string;
  /** How to fix it, in more detail. */
  fix: string;
}

/**
 * Every check Crawlmind runs. Order here is the order of the docs; reports sort by severity
 * and count.
 */
export const CHECKS: readonly CheckInfo[] = [
  {
    id: 'pages.http_4xx',
    severity: 'critical',
    title: 'Internal pages returning 4xx',
    recommendation: 'Restore these pages or redirect them, and update links that point to them.',
    why: 'Visitors and crawlers who reach these URLs hit an error. Links pointing to them waste link equity, and search engines drop them from the index.',
    fix: 'If the content moved, add a 301 redirect to its new URL. If it is gone for good, return 410 and remove internal links and sitemap entries that point to it.',
  },
  {
    id: 'pages.http_5xx',
    severity: 'critical',
    title: 'Internal pages returning 5xx',
    recommendation:
      'Find the server error behind each URL; repeated 5xx responses get pages dropped.',
    why: 'Server errors block both users and crawlers. If they persist, search engines slow down crawling the whole site and eventually drop the affected URLs.',
    fix: 'Check application and server logs for these URLs, fix the failing code or upstream service, and re-crawl to confirm.',
  },
  {
    id: 'pages.fetch_failed',
    severity: 'critical',
    title: 'Pages that could not be fetched',
    recommendation: 'Check DNS, TLS and timeouts for these URLs.',
    why: 'A request that fails without any HTTP response (DNS error, TLS error, timeout, reset connection) means the page is unreachable for everyone.',
    fix: 'Open the URL from a different network, look at the error detail, and fix the DNS record, certificate or slow backend. Crawlmind times out after 15 seconds.',
  },
  {
    id: 'links.broken_internal',
    severity: 'critical',
    title: 'Broken internal links',
    recommendation: 'Point these links to a working page or remove them.',
    why: 'Broken links frustrate visitors, leak link equity, and tell search engines the site is poorly maintained.',
    fix: 'Edit each source page listed and update the link target. When many pages share the broken link, it usually lives in a template, menu or footer.',
  },
  {
    id: 'links.broken_external',
    severity: 'warning',
    title: 'Broken external links',
    recommendation: 'Replace or remove links to external pages that no longer exist.',
    why: 'Links to dead external pages hurt user trust and the perceived quality of your content.',
    fix: 'Find a current URL for the resource (or an archived copy) and update the link. Servers that block bots (401, 403, 429, 999) are not reported as broken.',
  },
  {
    id: 'redirects.loop',
    severity: 'critical',
    title: 'Redirect loops and unfollowable redirects',
    recommendation: 'Break the loop so the URL ends on a 200 page.',
    why: 'A redirect loop never resolves: browsers show an error and crawlers give up.',
    fix: 'Follow the chain in the details, find the rule that sends the URL back to an earlier hop, and fix the redirect configuration.',
  },
  {
    id: 'redirects.chain',
    severity: 'warning',
    title: 'Redirect chains',
    recommendation: 'Redirect straight to the final URL in one hop.',
    why: 'Each extra hop adds latency and some crawlers stop following after a few hops. Link equity may be diluted along the way.',
    fix: 'Update the first redirect to point directly at the final destination, and update links to use the final URL.',
  },
  {
    id: 'links.to_redirect',
    severity: 'warning',
    title: 'Internal links pointing to redirects',
    recommendation: 'Link directly to the final URL instead of a redirecting one.',
    why: 'Every link to a redirect costs an extra request for users and crawlers and wastes crawl budget.',
    fix: 'Replace the link target with the final URL shown in the details. Fixing the template that generates the link usually fixes many pages at once.',
  },
  {
    id: 'sitemap.orphan',
    severity: 'warning',
    title: 'Orphan pages (in sitemap, no internal links)',
    recommendation: 'Link to these pages from relevant content, or remove them from the sitemap.',
    why: 'Pages with no internal links are hard for users to find and get little authority. Search engines treat them as unimportant.',
    fix: 'Add contextual links from related pages, category pages or navigation. Use suggest_links to find good source pages.',
  },
  {
    id: 'sitemap.noindex',
    severity: 'warning',
    title: 'Noindex pages listed in the sitemap',
    recommendation:
      'Remove noindex pages from the sitemap, or remove the noindex if they should rank.',
    why: 'A sitemap should list only pages you want indexed. Mixed signals waste crawl budget and confuse search engines.',
    fix: 'Decide whether each page should be indexed. Then either drop it from the sitemap or remove the noindex directive (meta robots or X-Robots-Tag).',
  },
  {
    id: 'sitemap.non_200',
    severity: 'warning',
    title: 'Sitemap URLs that do not return 200',
    recommendation: 'List only final, working URLs in the sitemap.',
    why: 'Redirects and errors in the sitemap waste crawl budget and make search engines trust the sitemap less.',
    fix: 'Replace redirected URLs with their final URLs and remove URLs that return errors. Regenerate the sitemap if it is built automatically.',
  },
  {
    id: 'canonical.non_200',
    severity: 'warning',
    title: 'Canonical points to an error page',
    recommendation: 'Point the canonical to a working, indexable URL.',
    why: 'A canonical pointing to an error page is ignored at best and can drop the page from the index at worst.',
    fix: 'Update the rel="canonical" link to the correct live URL, usually the page itself.',
  },
  {
    id: 'canonical.redirect',
    severity: 'warning',
    title: 'Canonical points to a redirect',
    recommendation: 'Use the final URL as the canonical.',
    why: 'Canonicals should name the final URL. A redirecting canonical sends mixed signals and may be ignored.',
    fix: 'Replace the canonical URL with the redirect target shown in the details.',
  },
  {
    id: 'canonical.other_page',
    severity: 'info',
    title: 'Pages canonicalized to another URL',
    recommendation: 'Check that each of these pages should really defer to its canonical.',
    why: 'A canonical to a different URL asks search engines to index that URL instead. That is correct for duplicates, wrong for unique content.',
    fix: 'If the page has unique content, make its canonical self-referencing. If it is a duplicate, also consider linking internally to the canonical URL only.',
  },
  {
    id: 'titles.missing',
    severity: 'warning',
    title: 'Missing title',
    recommendation: 'Give every indexable page a unique, descriptive <title>.',
    why: 'The title is the main headline in search results and a strong relevance signal.',
    fix: 'Add a <title> of roughly 30–60 characters that describes the page and includes its main topic.',
  },
  {
    id: 'titles.duplicate',
    severity: 'warning',
    title: 'Duplicate titles',
    recommendation: 'Make each title unique to its page.',
    why: 'Pages with the same title compete with each other and look like duplicates to search engines.',
    fix: 'Rewrite titles so each states what is specific to its page. For paginated or filtered pages, consider canonicals or noindex.',
  },
  {
    id: 'meta_description.missing',
    severity: 'info',
    title: 'Missing meta description',
    recommendation: 'Write a meta description that makes people want to click.',
    why: 'Search engines often use the meta description as the snippet. Without one they pick text from the page, which may not sell the click.',
    fix: 'Add <meta name="description"> with about 120–160 characters summarizing the page.',
  },
  {
    id: 'meta_description.duplicate',
    severity: 'info',
    title: 'Duplicate meta descriptions',
    recommendation: 'Make each meta description specific to its page.',
    why: 'Identical descriptions make different results look the same and are usually ignored.',
    fix: 'Rewrite descriptions per page, or remove the template default so search engines pick a snippet.',
  },
  {
    id: 'h1.missing',
    severity: 'warning',
    title: 'Missing H1',
    recommendation: 'Add one H1 that states the topic of the page.',
    why: 'The H1 tells users and search engines what the page is about.',
    fix: 'Add a single <h1> near the top of the main content, usually close to the title.',
  },
  {
    id: 'h1.duplicate',
    severity: 'info',
    title: 'Duplicate H1',
    recommendation: 'Use an H1 specific to each page.',
    why: 'The same H1 on many pages suggests duplicate or template-only content.',
    fix: 'Rewrite the H1 so it names what is unique about the page.',
  },
  {
    id: 'content.thin',
    severity: 'warning',
    title: 'Thin content',
    recommendation: 'Expand these pages with useful content, merge them, or noindex them.',
    why: 'Pages with little main content rarely satisfy searchers and can lower the perceived quality of the whole site.',
    fix: 'Add substance (answers, details, examples), merge near-empty pages into stronger ones with redirects, or noindex utility pages. The threshold is configurable with thinContentWords.',
  },
  {
    id: 'depth.deep',
    severity: 'warning',
    title: 'Deep pages (more than 3 clicks from the start page)',
    recommendation: 'Bring important pages within three clicks of the home page.',
    why: 'Pages buried deep in the site get crawled less often and receive less internal authority.',
    fix: 'Link to them from hub pages, categories or related content, or flatten pagination. Use get_top_pages with by=depth to find the deepest ones.',
  },
  {
    id: 'speed.slow_ttfb',
    severity: 'warning',
    title: 'Slow server response (TTFB over 800 ms)',
    recommendation: 'Speed up the server response with caching or a faster backend.',
    why: 'Time to first byte delays everything else on the page and hurts Core Web Vitals such as LCP.',
    fix: 'Add page or edge caching, optimize slow database queries, or move to faster hosting. Use get_top_pages with by=ttfb to find the slowest pages; slow pages often share one template.',
  },
  {
    id: 'speed.large_html',
    severity: 'warning',
    title: 'Very large HTML (over 1 MB)',
    recommendation: 'Reduce the HTML size: remove inline data, huge menus or embedded assets.',
    why: 'Large documents take longer to download and parse, especially on mobile, and some crawlers truncate them.',
    fix: 'Move inline scripts, styles and JSON to cached files, paginate long lists, and lazy-render large components.',
  },
  {
    id: 'security.mixed_content',
    severity: 'warning',
    title: 'Mixed content (http resources on https pages)',
    recommendation: 'Load every resource over https.',
    why: 'Browsers block or warn about insecure resources on secure pages, which can break the page and erode trust.',
    fix: 'Change the resource URLs to https (or protocol-relative), and make sure the hosts serve them over https.',
  },
  {
    id: 'links.internal_nofollow',
    severity: 'info',
    title: 'Internal links with nofollow',
    recommendation: 'Remove nofollow from internal links unless you have a specific reason.',
    why: 'Nofollow on internal links stops link equity from flowing to your own pages.',
    fix: 'Drop rel="nofollow" from internal links. To keep pages out of the index, use noindex instead.',
  },
  {
    id: 'anchors.generic',
    severity: 'info',
    title: 'Generic anchor texts',
    recommendation: 'Use anchor texts that describe the target page.',
    why: 'Anchors like "click here" or "read more" tell users and search engines nothing about the target.',
    fix: 'Rewrite the link text to name the target, e.g. "pricing for teams" instead of "click here". The list of generic phrases covers several languages.',
  },
  {
    id: 'anchors.empty',
    severity: 'info',
    title: 'Links without anchor text',
    recommendation: 'Give every link visible text, an image alt or an aria-label.',
    why: 'Links without text are invisible to screen readers and pass no topical signal.',
    fix: 'Add text, an alt attribute on the linked image, or an aria-label.',
  },
];

export const CHECKS_BY_ID: ReadonlyMap<string, CheckInfo> = new Map(CHECKS.map((c) => [c.id, c]));
