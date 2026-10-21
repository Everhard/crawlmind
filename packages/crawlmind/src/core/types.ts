import type { LinkPlacement } from './schemas.js';

/** A fetched (or attempted) URL as stored in the database. */
export interface PageRecord {
  url: string;
  finalUrl: string | null;
  status: number | null;
  fetchError: string | null;
  contentType: string | null;
  depth: number | null;
  inSitemap: boolean;
  sitemapPriority: number | null;
  blockedByRobots: boolean;
  redirectCount: number;
  ttfbMs: number | null;
  downloadMs: number | null;
  htmlBytes: number | null;
  truncated: boolean;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  canonical: string | null;
  metaRobots: string | null;
  xRobotsTag: string | null;
  lang: string | null;
  wordCount: number | null;
  contentHash: string | null;
  scriptsCount: number | null;
  stylesheetsCount: number | null;
  mixedContent: string[];
  domSignature: Uint32Array | null;
  contentExcerpt: string | null;
  paragraphs: string[];
}

export interface LinkRecord {
  targetUrl: string;
  anchor: string;
  rel: string;
  nofollow: boolean;
  isInternal: boolean;
  placement: LinkPlacement;
}

export interface RedirectHopRecord {
  url: string;
  status: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

/** An empty page record for `url`; callers fill in what they know. */
export function emptyPage(url: string): PageRecord {
  return {
    url,
    finalUrl: null,
    status: null,
    fetchError: null,
    contentType: null,
    depth: null,
    inSitemap: false,
    sitemapPriority: null,
    blockedByRobots: false,
    redirectCount: 0,
    ttfbMs: null,
    downloadMs: null,
    htmlBytes: null,
    truncated: false,
    title: null,
    metaDescription: null,
    h1: [],
    canonical: null,
    metaRobots: null,
    xRobotsTag: null,
    lang: null,
    wordCount: null,
    contentHash: null,
    scriptsCount: null,
    stylesheetsCount: null,
    mixedContent: [],
    domSignature: null,
    contentExcerpt: null,
    paragraphs: [],
  };
}
