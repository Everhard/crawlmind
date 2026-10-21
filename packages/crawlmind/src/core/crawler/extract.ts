import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { LinkPlacement } from '../schemas.js';
import { minHash, skeletonPaths } from '../speed/fingerprint.js';
import { isNonHttpHref, normalizeUrl } from './url.js';

export interface ExtractedLink {
  url: string;
  anchor: string;
  rel: string;
  nofollow: boolean;
  placement: LinkPlacement;
}

export interface ExtractedPage {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  canonical: string | null;
  metaRobots: string | null;
  lang: string | null;
  wordCount: number;
  contentHash: string;
  scriptsCount: number;
  stylesheetsCount: number;
  /** http:// subresources on an https page. */
  mixedContent: string[];
  links: ExtractedLink[];
  /** MinHash of the DOM skeleton, for template grouping. */
  domSignature: Uint32Array;
  /** Start of the main content, for page embeddings. */
  contentExcerpt: string;
  /** Paragraphs of the main content, for link suggestions. */
  paragraphs: string[];
}

const MAIN_SELECTOR = 'main, [role="main"], article';
const NON_CONTENT_SELECTOR =
  'nav, aside, script, style, noscript, template, svg, form, iframe, [role="navigation"], [aria-hidden="true"]';
/** Without a <main>/<article>, site headers and footers are boilerplate too. */
const BOILERPLATE_SELECTOR = `${NON_CONTENT_SELECTOR}, header, footer, [role="banner"], [role="contentinfo"]`;

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

// C0/C1 control characters (except whitespace) and bidi overrides. Crawled text is shown in
// terminals and reports, so it must not carry escape sequences or direction tricks.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** Clean text taken from a crawled page: drop unsafe characters, collapse whitespace. */
export function collapseWhitespace(text: string): string {
  return text.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
}

/**
 * Where a link sits on the page, from its nearest meaningful ancestor.
 * A `<header>`/`<footer>` inside `<article>` or `<main>` counts as content.
 */
export function classifyPlacement(el: Element, $: cheerio.CheerioAPI): LinkPlacement {
  for (const ancestor of $(el).parents().toArray()) {
    const tag = ancestor.tagName.toLowerCase();
    const role = (ancestor.attribs.role ?? '').toLowerCase();
    const hints = `${ancestor.attribs.id ?? ''} ${ancestor.attribs.class ?? ''}`.toLowerCase();

    if (tag === 'main' || tag === 'article' || role === 'main') return 'main';
    if (tag === 'nav' || role === 'navigation') return 'nav';
    if ((tag === 'header' || role === 'banner') && !insideContent(ancestor, $)) return 'header';
    if ((tag === 'footer' || role === 'contentinfo') && !insideContent(ancestor, $))
      return 'footer';
    if (tag === 'aside' || role === 'complementary') return 'other';
    if (tag === 'body') break;

    if (/\b(nav|navbar|navigation|menu|breadcrumbs?)\b/.test(hints)) return 'nav';
    if (/\b(site-)?footer\b/.test(hints)) return 'footer';
    if (/\b(site-header|masthead|header)\b/.test(hints)) return 'header';
    if (/\b(sidebar|widget)\b/.test(hints)) return 'other';
    if (/\b(content|main-content|post|entry|article)\b/.test(hints)) return 'main';
  }
  return 'other';
}

function insideContent(el: AnyNode, $: cheerio.CheerioAPI): boolean {
  return $(el).parents(MAIN_SELECTOR).length > 0;
}

/** A clone of the main content: `<main>`/`<article>` if present, otherwise the body minus boilerplate. */
function mainContentRoot($: cheerio.CheerioAPI): cheerio.Cheerio<AnyNode> {
  const main = $(MAIN_SELECTOR).first();
  const root = (main.length ? main : $('body')).clone();
  // Headers and footers inside <main>/<article> (titles, bylines) are content.
  root.find(main.length ? NON_CONTENT_SELECTOR : BOILERPLATE_SELECTOR).remove();
  return root;
}

function rootText(root: cheerio.Cheerio<AnyNode>): string {
  // Keep block boundaries so words from adjacent elements do not merge.
  root.find('p, div, li, h1, h2, h3, h4, h5, h6, td, th, br, section').after(' ');
  return collapseWhitespace(root.text());
}

/** Text of the main content. */
export function mainContentText($: cheerio.CheerioAPI): string {
  return rootText(mainContentRoot($));
}

export const PARAGRAPH_LIMITS = { minWords: 12, maxPerPage: 60, maxChars: 1200 } as const;

/** Paragraph-like blocks of the main content, long enough to hold a contextual link. */
function contentParagraphs($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>): string[] {
  const out: string[] = [];
  root.find('p, li, blockquote, dd').each((_, el) => {
    if (out.length >= PARAGRAPH_LIMITS.maxPerPage) return false;
    const node = $(el);
    // A list item or quote that wraps paragraphs is covered by those paragraphs.
    if (node.find('p, li').length > 0) return;
    const text = collapseWhitespace(node.text());
    if (countWords(text) >= PARAGRAPH_LIMITS.minWords)
      out.push(text.slice(0, PARAGRAPH_LIMITS.maxChars));
    return;
  });
  return out;
}

function attr($el: cheerio.Cheerio<Element>, name: string): string | null {
  const value = $el.attr(name);
  return value === undefined ? null : collapseWhitespace(value);
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const baseHref = $('base[href]').first().attr('href');
  const base = (baseHref && normalizeUrl(baseHref, pageUrl)) || pageUrl;
  const isHttps = pageUrl.startsWith('https:');

  const links: ExtractedLink[] = [];
  $('a[href], area[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (!href.trim() || href.trim().startsWith('#') || isNonHttpHref(href)) return;
    const url = normalizeUrl(href, base);
    if (!url) return;
    const $el = $(el);
    const text = collapseWhitespace($el.text());
    const anchor =
      text ||
      collapseWhitespace($el.find('img[alt]').first().attr('alt') ?? '') ||
      attr($el, 'aria-label') ||
      '';
    const rel = (attr($el, 'rel') ?? '').toLowerCase();
    links.push({
      url,
      anchor,
      rel,
      nofollow: /\b(nofollow|sponsored|ugc)\b/.test(rel),
      placement: classifyPlacement(el, $),
    });
  });

  const mixedContent: string[] = [];
  if (isHttps) {
    $(
      'img[src], script[src], iframe[src], video[src], audio[src], source[src], embed[src], link[rel~="stylesheet"][href]',
    ).each((_, el) => {
      const value = $(el).attr('src') ?? $(el).attr('href') ?? '';
      if (/^http:\/\//i.test(value.trim())) mixedContent.push(value.trim());
    });
  }

  const root = mainContentRoot($);
  const paragraphs = contentParagraphs($, root);
  const text = rootText(root);
  const canonicalHref = $('link[rel~="canonical"][href]').first().attr('href');
  const title = collapseWhitespace($('head > title, title').first().text());
  const robots = $('meta[name="robots" i], meta[name="crawlmindbot" i]')
    .toArray()
    .map((el) => collapseWhitespace($(el).attr('content') ?? '').toLowerCase())
    .filter(Boolean);

  return {
    title: title || null,
    metaDescription: attr($('meta[name="description" i]').first(), 'content'),
    h1: $('h1')
      .toArray()
      .map((el) => collapseWhitespace($(el).text()))
      .filter(Boolean),
    canonical: canonicalHref ? normalizeUrl(canonicalHref, base) : null,
    metaRobots: robots.length ? robots.join(', ') : null,
    lang: attr($('html').first(), 'lang'),
    wordCount: countWords(text),
    contentHash: createHash('sha1').update(text.toLowerCase()).digest('hex'),
    scriptsCount: $('script[src]').length,
    stylesheetsCount: $('link[rel~="stylesheet"]').length,
    mixedContent,
    links,
    domSignature: minHash(skeletonPaths($)),
    contentExcerpt: text.slice(0, 2000),
    paragraphs,
  };
}
