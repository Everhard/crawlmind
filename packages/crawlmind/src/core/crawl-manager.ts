import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { runCrawl, type CrawlStats } from './crawler/crawler.js';
import { normalizeUrl } from './crawler/url.js';
import { CrawlmindError, describeError } from './errors.js';
import { logger } from './logger.js';
import {
  CrawlOptionsSchema,
  type CrawlInfo,
  type CrawlOptionsInput,
  type CrawlProgress,
} from './schemas.js';
import type { CrawlStore } from './storage/crawl-store.js';
import { USER_AGENT } from './version.js';

/** Runs after the crawl itself, before the crawl is marked completed (e.g. analysis). */
export type PostCrawlStep = (crawlId: string) => void | Promise<void>;

interface Job {
  controller: AbortController;
  progress: CrawlProgress;
  done: Promise<void>;
}

export interface CrawlStatusReport {
  crawl: CrawlInfo;
  progress: CrawlProgress | null;
}

interface ManagerEvents {
  progress: [crawlId: string, progress: CrawlProgress];
  finished: [crawlId: string, crawl: CrawlInfo];
}

function newCrawlId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Starts crawls in the background, tracks their progress, and supports cancelling.
 * Both the MCP server and the CLI use it; the CLI simply waits for the crawl to finish.
 */
export class CrawlManager extends EventEmitter<ManagerEvents> {
  private readonly jobs = new Map<string, Job>();
  private readonly postSteps: PostCrawlStep[] = [];

  constructor(private readonly store: CrawlStore) {
    super();
    const interrupted = store.markRunningAsInterrupted();
    if (interrupted > 0) logger.info(`Marked ${interrupted} unfinished crawl(s) as interrupted`);
  }

  addPostCrawlStep(step: PostCrawlStep): void {
    this.postSteps.push(step);
  }

  start(input: CrawlOptionsInput): CrawlInfo {
    const parsed = CrawlOptionsSchema.safeParse(input);
    if (!parsed.success) {
      throw new CrawlmindError('invalid_input', `Invalid crawl options: ${parsed.error.message}`);
    }
    const options = parsed.data;
    const startUrl = normalizeUrl(options.url);
    if (!startUrl) throw new CrawlmindError('invalid_input', `Not an http(s) URL: ${options.url}`);

    const crawlId = newCrawlId();
    this.store.createCrawl({
      id: crawlId,
      site: new URL(startUrl).origin,
      startUrl,
      options: { ...options, url: startUrl },
      userAgent: USER_AGENT,
    });

    const controller = new AbortController();
    const job: Job = {
      controller,
      progress: {
        pagesCrawled: 0,
        pagesQueued: 0,
        maxPages: options.maxPages,
        errors: 0,
        externalChecked: 0,
        currentUrl: null,
        phase: 'starting',
      },
      done: Promise.resolve(),
    };
    this.jobs.set(crawlId, job);

    job.done = this.execute(crawlId, { ...options, url: startUrl }, job);
    return this.store.getCrawl(crawlId) as CrawlInfo;
  }

  private async execute(crawlId: string, options: CrawlInfo['options'], job: Job): Promise<void> {
    const onProgress = (progress: CrawlProgress) => {
      job.progress = progress;
      this.emit('progress', crawlId, progress);
    };
    try {
      const stats: CrawlStats = await runCrawl({
        crawlId,
        options,
        store: this.store,
        signal: job.controller.signal,
        onProgress,
      });
      onProgress({ ...job.progress, phase: 'analyzing', currentUrl: null });
      for (const step of this.postSteps) await step(crawlId);
      this.store.finishCrawl(crawlId, stats.cancelled ? 'cancelled' : 'completed');
    } catch (error) {
      logger.error(`Crawl ${crawlId} failed`, describeError(error));
      this.store.finishCrawl(crawlId, 'failed', describeError(error));
    } finally {
      onProgress({ ...job.progress, phase: 'done', currentUrl: null });
      this.jobs.delete(crawlId);
      this.emit('finished', crawlId, this.store.getCrawl(crawlId) as CrawlInfo);
    }
  }

  isRunning(crawlId: string): boolean {
    return this.jobs.has(crawlId);
  }

  status(crawlId: string): CrawlStatusReport {
    const crawl = this.requireCrawl(crawlId);
    return { crawl, progress: this.jobs.get(crawlId)?.progress ?? null };
  }

  /**
   * Wait until the crawl finishes or `timeoutMs` passes, calling `onProgress` on updates.
   * Returns the status at that moment.
   */
  async waitFor(
    crawlId: string,
    timeoutMs: number,
    onProgress?: (progress: CrawlProgress) => void,
  ): Promise<CrawlStatusReport> {
    const job = this.jobs.get(crawlId);
    if (!job) return this.status(crawlId);

    const listener = (id: string, progress: CrawlProgress) => {
      if (id === crawlId) onProgress?.(progress);
    };
    if (onProgress) this.on('progress', listener);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        job.done,
        new Promise<void>((resolve) => {
          // Infinity means "until done"; setTimeout would treat it as 1 ms.
          if (Number.isFinite(timeoutMs)) timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.off('progress', listener);
    }
    return this.status(crawlId);
  }

  /** Request cancellation. Pages fetched so far are kept and analyzed. */
  cancel(crawlId: string): CrawlInfo {
    const job = this.jobs.get(crawlId);
    if (!job) {
      const crawl = this.requireCrawl(crawlId);
      throw new CrawlmindError(
        'crawl_not_running',
        `Crawl ${crawlId} is not running (status: ${crawl.status}).`,
      );
    }
    job.controller.abort();
    return this.requireCrawl(crawlId);
  }

  /** Cancel every running crawl and wait for them to stop. */
  async shutdown(): Promise<void> {
    const pending = [...this.jobs.values()];
    for (const job of pending) job.controller.abort();
    await Promise.all(pending.map((job) => job.done));
  }

  requireCrawl(crawlId: string): CrawlInfo {
    const crawl = this.store.getCrawl(crawlId);
    if (!crawl) {
      throw new CrawlmindError(
        'not_found',
        `No crawl with id "${crawlId}".`,
        'Call list_crawls to see existing crawls, or start_crawl to start one.',
      );
    }
    return crawl;
  }
}
