import { TRACKING_PARAMS } from '../config/tracking-params.js';

const exactTracking = new Set<string>(TRACKING_PARAMS.filter((p) => !p.endsWith('*')));
const prefixTracking = TRACKING_PARAMS.filter((p) => p.endsWith('*')).map((p) => p.slice(0, -1));

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return exactTracking.has(lower) || prefixTracking.some((prefix) => lower.startsWith(prefix));
}

/**
 * Resolve `href` against `base` and normalize it. Returns null for non-http(s) URLs
 * (mailto:, tel:, javascript:, data:, ...) and for unparseable input.
 *
 * Normalization: lowercase host and default port removal (done by WHATWG URL),
 * fragment removal, tracking parameter removal, empty `?` removal.
 * Paths and the order of the remaining query parameters are kept as written.
 */
export function normalizeUrl(href: string, base?: string | URL): string | null {
  let url: URL;
  try {
    url = new URL(href.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.username = '';
  url.password = '';
  if (url.search) {
    for (const name of [...url.searchParams.keys()]) {
      if (isTrackingParam(name)) url.searchParams.delete(name);
    }
  }
  // Also drops a bare trailing `?`.
  if (url.searchParams.size === 0) url.search = '';
  return url.toString();
}

/** Host without a leading `www.`; `example.com` and `www.example.com` are the same site. */
export function siteHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/** Decide whether `url` belongs to the crawled site rooted at `rootHost`. */
export function isInternalUrl(url: string, rootHost: string, includeSubdomains: boolean): boolean {
  let host: string;
  try {
    host = siteHost(new URL(url).hostname);
  } catch {
    return false;
  }
  const root = siteHost(rootHost);
  return host === root || (includeSubdomains && host.endsWith(`.${root}`));
}

/** `scheme://host[:port]` of a URL. */
export function originOf(url: string): string {
  return new URL(url).origin;
}

/** True for hrefs that are links in the HTML sense but never crawlable. */
export function isNonHttpHref(href: string): boolean {
  return /^\s*(mailto|tel|sms|javascript|data|ftp|file|about|blob):/i.test(href);
}
