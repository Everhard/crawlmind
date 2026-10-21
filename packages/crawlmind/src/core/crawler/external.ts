import { CRAWL_LIMITS } from '../config/limits.js';
import type { Fetcher } from './fetcher.js';
import { sleep } from './throttle.js';

export interface ExternalStatus {
  status: number | null;
  error: string | null;
  finalUrl: string | null;
}

/** Status codes after which a HEAD answer is not trusted and GET is tried. */
const RETRY_WITH_GET = new Set([400, 403, 405, 406, 429, 501]);

/**
 * Checks external link targets: HEAD first, GET (without reading the body) when the
 * server rejects HEAD. Limits concurrency overall and per host; caches by URL.
 */
export class ExternalChecker {
  private readonly cache = new Map<string, ExternalStatus>();

  constructor(
    private readonly fetcher: Fetcher,
    private readonly perHost: number = CRAWL_LIMITS.externalPerHostConcurrency,
    private readonly total: number = CRAWL_LIMITS.externalConcurrency,
  ) {}

  async checkOne(url: string, signal?: AbortSignal): Promise<ExternalStatus> {
    const cached = this.cache.get(url);
    if (cached) return cached;

    let result = await this.fetcher.fetchWithRedirects(url, { method: 'HEAD', signal });
    const headStatus = result.final?.status;
    if (!result.final || (headStatus !== undefined && RETRY_WITH_GET.has(headStatus))) {
      const viaGet = await this.fetcher.fetchWithRedirects(url, { method: 'GET', signal });
      if (viaGet.final || !result.final) result = viaGet;
    }
    const last = result.hops.at(-1);
    const status: ExternalStatus = {
      status: result.final?.status ?? null,
      error: result.error,
      finalUrl: last && last.url !== url ? last.url : null,
    };
    this.cache.set(url, status);
    return status;
  }

  /** Check many URLs; `onResult` fires as each one finishes. */
  async checkAll(
    urls: string[],
    onResult: (url: string, status: ExternalStatus) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const byHost = new Map<string, string[]>();
    for (const url of urls) {
      const host = new URL(url).host;
      const list = byHost.get(host) ?? [];
      list.push(url);
      byHost.set(host, list);
    }
    const active = new Map<string, number>();
    let running = 0;

    const nextUrl = (): { host: string; url: string } | null => {
      for (const [host, list] of byHost) {
        if (list.length > 0 && (active.get(host) ?? 0) < this.perHost) {
          return { host, url: list.shift() as string };
        }
      }
      return null;
    };
    const pending = () => [...byHost.values()].some((list) => list.length > 0);

    const worker = async () => {
      while (!signal?.aborted) {
        const next = nextUrl();
        if (!next) {
          if (!pending() || running === 0) return;
          await sleep(10, signal);
          continue;
        }
        active.set(next.host, (active.get(next.host) ?? 0) + 1);
        running++;
        try {
          onResult(next.url, await this.checkOne(next.url, signal));
        } finally {
          active.set(next.host, (active.get(next.host) ?? 1) - 1);
          running--;
        }
      }
    };
    await Promise.all(Array.from({ length: this.total }, worker));
  }
}
