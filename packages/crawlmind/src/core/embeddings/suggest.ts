import type { AuditService } from '../analysis/audit.js';
import { normalizeUrl } from '../crawler/url.js';
import { CrawlmindError } from '../errors.js';
import type { DB } from '../storage/db.js';
import type { Paginated } from '../types.js';
import type { Embedder } from './embedder.js';
import { anchorCandidates, excerptAround, jaccard, keyStems } from './text.js';
import { blobToVector, dot, vectorToBlob } from './vectors.js';

export interface LinkSuggestion {
  /** Page that should get the new link. */
  sourceUrl: string;
  sourceTitle: string | null;
  /** Page the link should point to. */
  targetUrl: string;
  targetTitle: string | null;
  /** Cosine similarity of the two pages (0–1). */
  similarity: number;
  /** The paragraph in the source that fits the target best, shortened. */
  paragraph: string;
  paragraphSimilarity: number;
  /** Phrases from that paragraph that could become the anchor. May be empty. */
  anchorCandidates: string[];
  /** Why the target is a good link target. */
  targetMainInlinks: number;
  targetPagerankScore: number | null;
  score: number;
}

export interface CannibalizationPair {
  urlA: string;
  titleA: string | null;
  urlB: string;
  titleB: string | null;
  similarity: number;
  /** Jaccard similarity of key words in title + H1. */
  titleOverlap: number;
  sharedTerms: string[];
}

export interface SuggestOptions {
  targetUrl?: string;
  limit: number;
  offset: number;
  /** Minimum page similarity for a suggestion. */
  minSimilarity?: number;
  onProgress?: (message: string) => void;
}

interface PageRow {
  id: number;
  url: string;
  title: string | null;
  h1_json: string | null;
  content_excerpt: string | null;
  sitemap_priority: number | null;
  main_inlinks: number;
  pagerank: number | null;
}

interface Candidate {
  id: number;
  url: string;
  title: string | null;
  h1: string;
  text: string;
  importance: number;
  mainInlinks: number;
  pagerankScore: number | null;
}

/** Defaults tuned for multilingual-e5-small, whose cosine similarities cluster high. */
export const SUGGEST_DEFAULTS = {
  minSimilarity: 0.82,
  sourcesPerTarget: 3,
  /** Whole-site mode looks at this many of the most link-worthy targets. */
  maxTargets: 300,
  cannibalizationSimilarity: 0.92,
  cannibalizationTitleOverlap: 0.5,
} as const;

/**
 * Internal link suggestions and keyword cannibalization from local embeddings.
 * Page vectors are computed on first use per crawl and stored; paragraph vectors only for
 * the source pages that end up in suggestions.
 */
export class LinkSuggestionService {
  constructor(
    private readonly db: DB,
    private readonly audit: AuditService,
    private readonly embedder: () => Embedder,
  ) {}

  async suggest(crawlId: string, opts: SuggestOptions): Promise<Paginated<LinkSuggestion>> {
    this.audit.requireAnalyzed(crawlId);
    const minSimilarity = opts.minSimilarity ?? SUGGEST_DEFAULTS.minSimilarity;
    const pages = this.candidates(crawlId);
    if (pages.length < 2) return { items: [], total: 0, offset: opts.offset, limit: opts.limit };
    const vectors = await this.pageVectors(crawlId, pages, opts.onProgress);

    let targets: Candidate[];
    if (opts.targetUrl) {
      const url = normalizeUrl(opts.targetUrl) ?? opts.targetUrl;
      const target = pages.find((p) => p.url === url);
      if (!target) {
        throw new CrawlmindError(
          'not_found',
          `${url} is not an indexable 200 page of crawl ${crawlId}.`,
          'Only indexable pages can be link targets; check get_page for its status.',
        );
      }
      targets = [target];
    } else {
      targets = [...pages]
        .sort((a, b) => b.importance / (1 + b.mainInlinks) - a.importance / (1 + a.mainInlinks))
        .slice(0, SUGGEST_DEFAULTS.maxTargets);
    }

    const linked = this.existingLinks(crawlId);
    const pairs: { source: Candidate; target: Candidate; similarity: number }[] = [];
    for (const target of targets) {
      const tv = vectors.get(target.id) as Float32Array;
      const best = pages
        .filter((s) => s.id !== target.id && !linked.has(`${s.id} ${target.url}`))
        .map((s) => ({ source: s, similarity: dot(vectors.get(s.id) as Float32Array, tv) }))
        .filter((c) => c.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, opts.targetUrl ? opts.offset + opts.limit : SUGGEST_DEFAULTS.sourcesPerTarget);
      for (const c of best) pairs.push({ ...c, target });
    }

    const score = (p: (typeof pairs)[number]) =>
      p.similarity * (1 + p.target.importance / (1 + p.target.mainInlinks));
    pairs.sort((a, b) => score(b) - score(a));
    const page = pairs.slice(opts.offset, opts.offset + opts.limit);

    // Paragraph-level matching only for the suggestions being returned.
    opts.onProgress?.('Matching paragraphs');
    const paragraphs = await this.paragraphVectors(
      [...new Set(page.map((p) => p.source.id))],
      opts.onProgress,
    );
    const items = page.map((p): LinkSuggestion => {
      const tv = vectors.get(p.target.id) as Float32Array;
      const own = paragraphs.get(p.source.id) ?? [];
      const bestParagraph = own
        .map((para) => ({ ...para, sim: dot(para.vector, tv) }))
        .sort((a, b) => b.sim - a.sim)[0];
      const text = bestParagraph?.text ?? p.source.text.slice(0, 280);
      const anchors = anchorCandidates(text, `${p.target.title ?? ''} ${p.target.h1}`);
      return {
        sourceUrl: p.source.url,
        sourceTitle: p.source.title,
        targetUrl: p.target.url,
        targetTitle: p.target.title,
        similarity: round(p.similarity),
        paragraph: excerptAround(text, anchors[0]),
        paragraphSimilarity: round(bestParagraph?.sim ?? 0),
        anchorCandidates: anchors,
        targetMainInlinks: p.target.mainInlinks,
        targetPagerankScore: p.target.pagerankScore,
        score: round(score(p)),
      };
    });
    return { items, total: pairs.length, offset: opts.offset, limit: opts.limit };
  }

  /** Pairs of indexable pages that are about the same thing and have similar titles/H1s. */
  async cannibalization(
    crawlId: string,
    opts: {
      limit: number;
      offset: number;
      minSimilarity?: number;
      minTitleOverlap?: number;
      onProgress?: (message: string) => void;
    },
  ): Promise<Paginated<CannibalizationPair>> {
    const minSimilarity = opts.minSimilarity ?? SUGGEST_DEFAULTS.cannibalizationSimilarity;
    const minTitleOverlap = opts.minTitleOverlap ?? SUGGEST_DEFAULTS.cannibalizationTitleOverlap;
    this.audit.requireAnalyzed(crawlId);
    const pages = this.candidates(crawlId);
    const vectors = await this.pageVectors(crawlId, pages, opts.onProgress);

    // Only compare pages that share at least one key word in title/H1 (inverted index),
    // which keeps this far below n² comparisons.
    const stems = new Map(pages.map((p) => [p.id, keyStems(`${p.title ?? ''} ${p.h1}`)]));
    const index = new Map<string, number[]>();
    pages.forEach((p, i) => {
      for (const s of stems.get(p.id) ?? []) {
        const list = index.get(s);
        if (list) list.push(i);
        else index.set(s, [i]);
      }
    });
    const seen = new Set<string>();
    const pairs: CannibalizationPair[] = [];
    for (const list of index.values()) {
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const a = pages[list[x] as number] as Candidate;
          const b = pages[list[y] as number] as Candidate;
          const key = `${a.id} ${b.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const sa = stems.get(a.id) as Set<string>;
          const sb = stems.get(b.id) as Set<string>;
          const overlap = jaccard(sa, sb);
          if (overlap < minTitleOverlap) continue;
          const similarity = dot(
            vectors.get(a.id) as Float32Array,
            vectors.get(b.id) as Float32Array,
          );
          if (similarity < minSimilarity) continue;
          pairs.push({
            urlA: a.url,
            titleA: a.title,
            urlB: b.url,
            titleB: b.title,
            similarity: round(similarity),
            titleOverlap: round(overlap),
            sharedTerms: [...sa].filter((s) => sb.has(s)),
          });
        }
      }
    }
    pairs.sort((a, b) => b.similarity - a.similarity);
    return {
      items: pairs.slice(opts.offset, opts.offset + opts.limit),
      total: pairs.length,
      offset: opts.offset,
      limit: opts.limit,
    };
  }

  /** Indexable 200 HTML pages with their link metrics. */
  private candidates(crawlId: string): Candidate[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.url, p.title, p.h1_json, p.content_excerpt, p.sitemap_priority,
                m.main_inlinks, m.pagerank
         FROM pages p JOIN page_metrics m ON m.page_id = p.id
         WHERE p.crawl_id = ? AND m.indexable = 1 ORDER BY p.id`,
      )
      .all(crawlId) as PageRow[];
    const maxRank = Math.max(0, ...rows.map((r) => r.pagerank ?? 0)) || 1;
    return rows.map((r) => {
      const h1 = r.h1_json ? (JSON.parse(r.h1_json) as string[]).join(' ') : '';
      const rank = (r.pagerank ?? 0) / maxRank;
      return {
        id: r.id,
        url: r.url,
        title: r.title,
        h1,
        text: r.content_excerpt ?? '',
        importance: Math.max(rank, r.sitemap_priority ?? 0),
        mainInlinks: r.main_inlinks,
        pagerankScore: r.pagerank === null ? null : Math.round(rank * 1000) / 10,
      };
    });
  }

  private existingLinks(crawlId: string): Set<string> {
    const set = new Set<string>();
    const rows = this.db
      .prepare(
        `SELECT DISTINCT l.source_page_id, COALESCE(t.final_url, l.target_url)
         FROM links l LEFT JOIN pages t ON t.crawl_id = l.crawl_id AND t.url = l.target_url
         WHERE l.crawl_id = ? AND l.is_internal = 1`,
      )
      .raw()
      .iterate(crawlId) as IterableIterator<[number, string]>;
    for (const [source, target] of rows) set.add(`${source} ${target}`);
    return set;
  }

  private async pageVectors(
    crawlId: string,
    pages: Candidate[],
    onProgress?: (message: string) => void,
  ): Promise<Map<number, Float32Array>> {
    const embedder = this.embedder();
    const vectors = new Map<number, Float32Array>();
    const stored = this.db
      .prepare(
        `SELECT e.page_id, e.vector FROM page_embeddings e JOIN pages p ON p.id = e.page_id
         WHERE p.crawl_id = ? AND e.model = ?`,
      )
      .all(crawlId, embedder.model) as { page_id: number; vector: Buffer }[];
    for (const row of stored) vectors.set(row.page_id, blobToVector(row.vector));

    const missing = pages.filter((p) => !vectors.has(p.id));
    const save = this.db.prepare(
      'INSERT OR REPLACE INTO page_embeddings (page_id, model, vector) VALUES (?, ?, ?)',
    );
    const chunk = 64;
    for (let i = 0; i < missing.length; i += chunk) {
      onProgress?.(`Embedding pages ${i}/${missing.length}`);
      const batch = missing.slice(i, i + chunk);
      const embedded = await embedder.embed(
        batch.map((p) => `${p.title ?? ''}\n${p.h1}\n${p.text}`),
      );
      this.db.transaction(() => {
        batch.forEach((p, j) => {
          const v = embedded[j] as Float32Array;
          vectors.set(p.id, v);
          save.run(p.id, embedder.model, vectorToBlob(v));
        });
      })();
    }
    return vectors;
  }

  private async paragraphVectors(
    pageIds: number[],
    onProgress?: (message: string) => void,
  ): Promise<Map<number, { text: string; vector: Float32Array }[]>> {
    const embedder = this.embedder();
    const out = new Map<number, { text: string; vector: Float32Array }[]>();
    if (pageIds.length === 0) return out;
    const rows = this.db
      .prepare(
        `SELECT id, page_id, text, model, embedding FROM paragraphs
         WHERE page_id IN (${pageIds.map(() => '?').join(',')}) ORDER BY page_id, idx`,
      )
      .all(...pageIds) as {
      id: number;
      page_id: number;
      text: string;
      model: string | null;
      embedding: Buffer | null;
    }[];
    const missing = rows.filter((r) => !r.embedding || r.model !== embedder.model);
    if (missing.length) {
      onProgress?.(`Embedding ${missing.length} paragraphs`);
      const vectors = await embedder.embed(missing.map((r) => r.text));
      const save = this.db.prepare('UPDATE paragraphs SET model = ?, embedding = ? WHERE id = ?');
      this.db.transaction(() => {
        missing.forEach((r, i) => {
          const v = vectors[i] as Float32Array;
          r.embedding = vectorToBlob(v);
          save.run(embedder.model, r.embedding, r.id);
        });
      })();
    }
    for (const r of rows) {
      const list = out.get(r.page_id) ?? [];
      list.push({ text: r.text, vector: blobToVector(r.embedding as Buffer) });
      out.set(r.page_id, list);
    }
    return out;
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
