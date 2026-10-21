import { CrawlmindError } from '../errors.js';
import { logger } from '../logger.js';
import { sleep } from '../crawler/throttle.js';

export type PsiStrategy = 'mobile' | 'desktop';

/** Field data (CrUX) for the URL or, when the URL has too little traffic, its origin. */
export interface PsiFieldData {
  scope: 'url' | 'origin';
  overall: string | null;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  fcpMs: number | null;
}

export interface PsiResult {
  url: string;
  strategy: PsiStrategy;
  /** Lighthouse performance score, 0–100. */
  performanceScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  totalBytes: number | null;
  field: PsiFieldData | null;
}

export interface PsiClientOptions {
  apiKey?: string;
  fetch?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
  retries?: number;
  /** Base delay for exponential backoff between retries. */
  backoffMs?: number;
}

export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

interface LighthouseAudit {
  numericValue?: number;
}
interface CruxMetric {
  percentile?: number;
}
interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, LighthouseAudit | undefined>;
  };
  loadingExperience?: CruxBlock;
  originLoadingExperience?: CruxBlock;
}
interface CruxBlock {
  overall_category?: string;
  metrics?: Record<string, CruxMetric | undefined>;
}

const audit = (r: PsiResponse, id: string) =>
  r.lighthouseResult?.audits?.[id]?.numericValue ?? null;

function field(block: CruxBlock | undefined, scope: PsiFieldData['scope']): PsiFieldData | null {
  const m = block?.metrics;
  if (!m || Object.keys(m).length === 0) return null;
  const cls = m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
  return {
    scope,
    overall: block?.overall_category ?? null,
    lcpMs: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
    // CrUX reports CLS multiplied by 100.
    cls: cls === undefined ? null : cls / 100,
    inpMs: m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    fcpMs: m.FIRST_CONTENTFUL_PAINT_MS?.percentile ?? null,
  };
}

export function parsePsiResponse(url: string, strategy: PsiStrategy, body: PsiResponse): PsiResult {
  const score = body.lighthouseResult?.categories?.performance?.score;
  return {
    url,
    strategy,
    performanceScore: typeof score === 'number' ? Math.round(score * 100) : null,
    lcpMs: audit(body, 'largest-contentful-paint'),
    cls: audit(body, 'cumulative-layout-shift'),
    tbtMs: audit(body, 'total-blocking-time'),
    fcpMs: audit(body, 'first-contentful-paint'),
    totalBytes: audit(body, 'total-byte-weight'),
    field: field(body.loadingExperience, 'url') ?? field(body.originLoadingExperience, 'origin'),
  };
}

/** PageSpeed Insights API v5 client with timeouts and retries on 429/5xx. */
export class PsiClient {
  private readonly options: Required<Omit<PsiClientOptions, 'apiKey'>> & { apiKey?: string };

  constructor(options: PsiClientOptions = {}) {
    this.options = {
      fetch: globalThis.fetch,
      endpoint: PSI_ENDPOINT,
      timeoutMs: 60_000,
      retries: 3,
      backoffMs: 2_000,
      ...options,
    };
  }

  get hasApiKey(): boolean {
    return Boolean(this.options.apiKey);
  }

  async run(url: string, strategy: PsiStrategy, signal?: AbortSignal): Promise<PsiResult> {
    const query = new URLSearchParams({ url, strategy, category: 'performance' });
    if (this.options.apiKey) query.set('key', this.options.apiKey);
    const requestUrl = `${this.options.endpoint}?${query}`;

    let lastError = 'unknown error';
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      if (attempt > 0) await sleep(this.options.backoffMs * 2 ** (attempt - 1), signal);
      if (signal?.aborted)
        throw new CrawlmindError('network', 'PageSpeed Insights request cancelled.');
      const timeout = AbortSignal.timeout(this.options.timeoutMs);
      let res: Response;
      try {
        res = await this.options.fetch(requestUrl, {
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (error) {
        lastError = timeout.aborted
          ? `timed out after ${this.options.timeoutMs / 1000} s`
          : String((error as Error).message);
        logger.debug(`PSI attempt ${attempt + 1} for ${url} failed: ${lastError}`);
        continue;
      }
      if (res.ok) return parsePsiResponse(url, strategy, (await res.json()) as PsiResponse);

      const message = await errorMessage(res);
      // A daily quota does not come back within a few seconds of backoff.
      const daily = res.status === 429 && /per day/i.test(message);
      if ((res.status === 429 && !daily) || res.status >= 500) {
        lastError = `${res.status} ${message}`;
        logger.debug(`PSI attempt ${attempt + 1} for ${url}: ${lastError}`);
        continue;
      }
      if (daily) {
        lastError = `${res.status} ${message}`;
        break;
      }
      throw new CrawlmindError(
        'network',
        `PageSpeed Insights rejected ${url}: ${res.status} ${message}`,
      );
    }
    if (/^429/.test(lastError)) {
      throw new CrawlmindError(
        'network',
        'PageSpeed Insights quota exceeded.',
        this.options.apiKey
          ? 'Wait for the quota to reset or raise it in the Google Cloud console.'
          : 'Set PSI_API_KEY (free at https://developers.google.com/speed/docs/insights/v5/get-started) for your own quota.',
      );
    }
    throw new CrawlmindError('network', `PageSpeed Insights failed for ${url}: ${lastError}`);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
