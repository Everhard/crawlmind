import type { AuditService } from '../analysis/audit.js';
import { CHECKS_BY_ID, type Severity } from '../analysis/checks.js';
import { CrawlmindError } from '../errors.js';
import type { CrawlInfo } from '../schemas.js';
import type { DB } from '../storage/db.js';

export interface DiffList<T> {
  total: number;
  items: T[];
}

export interface StatusChange {
  url: string;
  before: number | string | null;
  after: number | string | null;
}

export interface BrokenLinkChange {
  source: string;
  target: string;
  detail: string;
}

export interface InlinkChange {
  url: string;
  before: number;
  after: number;
  delta: number;
}

export interface TtfbChange {
  url: string;
  beforeMs: number;
  afterMs: number;
  deltaMs: number;
}

export interface FieldChange {
  url: string;
  before: string | null;
  after: string | null;
}

export interface IssueCountChange {
  checkId: string;
  title: string;
  severity: Severity;
  before: number;
  after: number;
}

export interface CrawlDiff {
  before: CrawlInfo;
  after: CrawlInfo;
  /** Set when crawl sizes differ a lot, so "removed" pages may just not have been reached. */
  warning: string | null;
  pagesAdded: DiffList<string>;
  pagesRemoved: DiffList<string>;
  newErrors: DiffList<StatusChange>;
  fixedErrors: DiffList<StatusChange>;
  newBrokenLinks: DiffList<BrokenLinkChange>;
  fixedBrokenLinks: DiffList<BrokenLinkChange>;
  inlinksLost: DiffList<InlinkChange>;
  inlinksGained: DiffList<InlinkChange>;
  ttfbRegressions: DiffList<TtfbChange>;
  titleChanges: DiffList<FieldChange>;
  canonicalChanges: DiffList<FieldChange>;
  issueCounts: IssueCountChange[];
}

interface PageSnapshot {
  url: string;
  status: number | null;
  fetchError: string | null;
  blocked: boolean;
  title: string | null;
  canonical: string | null;
  ttfbMs: number | null;
  inlinks: number | null;
}

/** A TTFB regression must be at least this much slower, absolute and relative. */
const TTFB_REGRESSION = { minDeltaMs: 200, minRatio: 1.5 } as const;

const isError = (p: PageSnapshot) =>
  p.fetchError !== null || (p.status !== null && p.status >= 400);
const statusOf = (p: PageSnapshot | undefined) => (p ? (p.fetchError ?? p.status) : null);

function list<T>(items: T[], limit: number): DiffList<T> {
  return { total: items.length, items: items.slice(0, limit) };
}

/** Compare two crawls of the same site: what broke, what got fixed, what moved. */
export function compareCrawls(
  db: DB,
  audit: AuditService,
  beforeId: string,
  afterId: string,
  limit = 20,
): CrawlDiff {
  const before = audit.requireAnalyzed(beforeId);
  const after = audit.requireAnalyzed(afterId);
  if (before.site !== after.site) {
    throw new CrawlmindError(
      'invalid_input',
      `Crawls ${beforeId} (${before.site}) and ${afterId} (${after.site}) are of different sites.`,
      'Use list_crawls with site to find crawls of the same site.',
    );
  }
  // Order chronologically so "before" really is the older crawl.
  if (Date.parse(before.startedAt) > Date.parse(after.startedAt)) {
    return compareCrawls(db, audit, afterId, beforeId, limit);
  }

  const a = snapshot(db, beforeId);
  const b = snapshot(db, afterId);
  const fetched = (p: PageSnapshot) => !p.blocked && (p.status !== null || p.fetchError !== null);
  const ok = (p: PageSnapshot) => p.status === 200;

  const pagesAdded = [...b.values()].filter((p) => ok(p) && !a.get(p.url)).map((p) => p.url);
  const pagesRemoved = [...a.values()].filter((p) => ok(p) && !b.has(p.url)).map((p) => p.url);

  const newErrors: StatusChange[] = [];
  const fixedErrors: StatusChange[] = [];
  for (const p of b.values()) {
    const old = a.get(p.url);
    if (fetched(p) && isError(p) && (!old || !isError(old))) {
      newErrors.push({ url: p.url, before: statusOf(old), after: statusOf(p) });
    }
  }
  for (const p of a.values()) {
    const now = b.get(p.url);
    if (isError(p) && now && fetched(now) && !isError(now)) {
      fixedErrors.push({ url: p.url, before: statusOf(p), after: statusOf(now) });
    }
  }

  const brokenA = brokenLinks(db, beforeId);
  const brokenB = brokenLinks(db, afterId);
  const newBrokenLinks = [...brokenB.entries()].filter(([k]) => !brokenA.has(k)).map(([, v]) => v);
  // A link counts as fixed only if its source page was crawled again.
  const fixedBrokenLinks = [...brokenA.entries()]
    .filter(([k, v]) => !brokenB.has(k) && b.has(v.source))
    .map(([, v]) => v);

  const inlinkChanges: InlinkChange[] = [];
  const ttfbRegressions: TtfbChange[] = [];
  const titleChanges: FieldChange[] = [];
  const canonicalChanges: FieldChange[] = [];
  for (const p of b.values()) {
    const old = a.get(p.url);
    if (!old || !ok(old) || !ok(p)) continue;
    if (old.inlinks !== null && p.inlinks !== null && old.inlinks !== p.inlinks) {
      inlinkChanges.push({
        url: p.url,
        before: old.inlinks,
        after: p.inlinks,
        delta: p.inlinks - old.inlinks,
      });
    }
    if (old.ttfbMs !== null && p.ttfbMs !== null) {
      const delta = p.ttfbMs - old.ttfbMs;
      if (
        delta >= TTFB_REGRESSION.minDeltaMs &&
        p.ttfbMs >= old.ttfbMs * TTFB_REGRESSION.minRatio
      ) {
        ttfbRegressions.push({
          url: p.url,
          beforeMs: old.ttfbMs,
          afterMs: p.ttfbMs,
          deltaMs: Math.round(delta),
        });
      }
    }
    if ((old.title ?? '') !== (p.title ?? ''))
      titleChanges.push({ url: p.url, before: old.title, after: p.title });
    if ((old.canonical ?? '') !== (p.canonical ?? '')) {
      canonicalChanges.push({ url: p.url, before: old.canonical, after: p.canonical });
    }
  }
  const lost = inlinkChanges.filter((c) => c.delta < 0).sort((x, y) => x.delta - y.delta);
  const gained = inlinkChanges.filter((c) => c.delta > 0).sort((x, y) => y.delta - x.delta);
  ttfbRegressions.sort((x, y) => y.deltaMs - x.deltaMs);

  const counts = (id: string) =>
    new Map(
      (
        db.prepare('SELECT check_id, count FROM issues WHERE crawl_id = ?').all(id) as {
          check_id: string;
          count: number;
        }[]
      ).map((r) => [r.check_id, r.count]),
    );
  const ca = counts(beforeId);
  const cb = counts(afterId);
  const issueCounts = [...new Set([...ca.keys(), ...cb.keys()])]
    .map((checkId) => {
      const check = CHECKS_BY_ID.get(checkId);
      return {
        checkId,
        title: check?.title ?? checkId,
        severity: check?.severity ?? 'info',
        before: ca.get(checkId) ?? 0,
        after: cb.get(checkId) ?? 0,
      } satisfies IssueCountChange;
    })
    .filter((c) => c.before !== c.after)
    .sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before));

  const ratio =
    Math.min(before.pagesCrawled, after.pagesCrawled) /
    Math.max(1, before.pagesCrawled, after.pagesCrawled);
  return {
    before,
    after,
    warning:
      ratio < 0.8
        ? `The crawls differ in size (${before.pagesCrawled} vs ${after.pagesCrawled} pages); added and removed pages may only reflect crawl limits.`
        : null,
    pagesAdded: list(pagesAdded, limit),
    pagesRemoved: list(pagesRemoved, limit),
    newErrors: list(newErrors, limit),
    fixedErrors: list(fixedErrors, limit),
    newBrokenLinks: list(newBrokenLinks, limit),
    fixedBrokenLinks: list(fixedBrokenLinks, limit),
    inlinksLost: list(lost, limit),
    inlinksGained: list(gained, limit),
    ttfbRegressions: list(ttfbRegressions, limit),
    titleChanges: list(titleChanges, limit),
    canonicalChanges: list(canonicalChanges, limit),
    issueCounts,
  };
}

function snapshot(db: DB, crawlId: string): Map<string, PageSnapshot> {
  const rows = db
    .prepare(
      `SELECT p.url, p.status, p.fetch_error, p.blocked_by_robots, p.title, p.canonical, p.ttfb_ms, m.inlinks
       FROM pages p LEFT JOIN page_metrics m ON m.page_id = p.id WHERE p.crawl_id = ?`,
    )
    .all(crawlId) as {
    url: string;
    status: number | null;
    fetch_error: string | null;
    blocked_by_robots: number;
    title: string | null;
    canonical: string | null;
    ttfb_ms: number | null;
    inlinks: number | null;
  }[];
  return new Map(
    rows.map((r) => [
      r.url,
      {
        url: r.url,
        status: r.status,
        fetchError: r.fetch_error,
        blocked: r.blocked_by_robots === 1,
        title: r.title,
        canonical: r.canonical,
        ttfbMs: r.ttfb_ms,
        inlinks: r.inlinks,
      },
    ]),
  );
}

/** Broken links (internal and external) keyed by source and target. */
function brokenLinks(db: DB, crawlId: string): Map<string, BrokenLinkChange> {
  const rows = db
    .prepare(
      `SELECT url, detail FROM issue_items
       WHERE crawl_id = ? AND check_id IN ('links.broken_internal', 'links.broken_external')`,
    )
    .all(crawlId) as { url: string; detail: string | null }[];
  const out = new Map<string, BrokenLinkChange>();
  for (const row of rows) {
    // detail: `→ <target> (<status>) "anchor"`
    const target = /^→ (\S+)/.exec(row.detail ?? '')?.[1] ?? '';
    out.set(`${row.url} ${target}`, { source: row.url, target, detail: row.detail ?? '' });
  }
  return out;
}
