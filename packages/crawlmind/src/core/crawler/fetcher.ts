import type { Readable } from 'node:stream';
import * as zlib from 'node:zlib';
import { Agent, request, type Dispatcher } from 'undici';
import { CRAWL_LIMITS } from '../config/limits.js';
import { CrawlmindError, describeError } from '../errors.js';
import { USER_AGENT } from '../version.js';
import { assertPublicHost, guardedLookup } from './net-guard.js';
import { normalizeUrl } from './url.js';

export interface FetcherOptions {
  allowPrivateNetworks: boolean;
  timeoutMs?: number;
  maxBodyBytes?: number;
  userAgent?: string;
}

export interface FetchResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  /** Time until response headers arrived. */
  ttfbMs: number;
  /** Time until the body was fully read (or until headers, when the body is skipped). */
  totalMs: number;
  body: Buffer | null;
  truncated: boolean;
}

export interface RedirectHop {
  url: string;
  status: number;
}

export interface FetchResult {
  /** Every response in the chain, starting with the requested URL. The last one is final. */
  hops: RedirectHop[];
  final: FetchResponse | null;
  error: string | null;
  redirectLoop: boolean;
  tooManyRedirects: boolean;
}

export interface RequestOptions {
  method?: 'GET' | 'HEAD';
  signal?: AbortSignal;
  /** Decide from headers whether to download the body. Defaults to never. */
  readBody?: (status: number, headers: Record<string, string>) => boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function flattenHeaders(raw: Dispatcher.ResponseData['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/**
 * HTTP client for the crawler: manual redirects, timeouts, body size cap,
 * timing, and SSRF protection on every connection.
 */
export class Fetcher {
  private readonly dispatcher: Agent;
  private readonly options: Required<FetcherOptions>;

  constructor(options: FetcherOptions) {
    this.options = {
      timeoutMs: CRAWL_LIMITS.requestTimeoutMs,
      maxBodyBytes: CRAWL_LIMITS.maxBodyBytes,
      userAgent: USER_AGENT,
      ...options,
    };
    this.dispatcher = new Agent({
      connections: 32,
      connect: options.allowPrivateNetworks ? {} : { lookup: guardedLookup },
    });
  }

  /** One request, no redirect following. Throws on network errors. */
  async fetchOnce(url: string, opts: RequestOptions = {}): Promise<FetchResponse> {
    const target = new URL(url);
    if (!this.options.allowPrivateNetworks) assertPublicHost(target.hostname);

    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const started = performance.now();
    const method = opts.method ?? 'GET';

    let res: Dispatcher.ResponseData;
    try {
      res = await request(target, {
        method,
        dispatcher: this.dispatcher,
        signal,
        headers: {
          'user-agent': this.options.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-encoding': ACCEPT_ENCODING,
        },
      });
    } catch (error) {
      if (timeout.aborted)
        throw new CrawlmindError('network', `Timed out after ${this.options.timeoutMs} ms`);
      throw unwrapNetworkError(error);
    }

    const ttfbMs = performance.now() - started;
    // A late abort (e.g. the timeout firing after we stopped reading) must not become an
    // unhandled stream error.
    res.body.on('error', () => undefined);
    const headers = flattenHeaders(res.headers);
    const wantBody = method === 'GET' && (opts.readBody?.(res.statusCode, headers) ?? false);

    if (!wantBody) {
      await res.body.dump().catch(() => undefined);
      return {
        url,
        status: res.statusCode,
        headers,
        ttfbMs,
        totalMs: ttfbMs,
        body: null,
        truncated: false,
      };
    }

    // The size cap applies to the decompressed HTML.
    const body = decodedBody(res.body, headers['content-encoding']);
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    try {
      for await (const chunk of body) {
        const buf = chunk as Buffer;
        if (size + buf.length > this.options.maxBodyBytes) {
          chunks.push(buf.subarray(0, this.options.maxBodyBytes - size));
          size = this.options.maxBodyBytes;
          truncated = true;
          body.destroy();
          res.body.destroy();
          break;
        }
        chunks.push(buf);
        size += buf.length;
      }
    } catch (error) {
      if (timeout.aborted)
        throw new CrawlmindError('network', `Timed out after ${this.options.timeoutMs} ms`);
      throw unwrapNetworkError(error);
    }

    return {
      url,
      status: res.statusCode,
      headers,
      ttfbMs,
      totalMs: performance.now() - started,
      body: Buffer.concat(chunks, size),
      truncated,
    };
  }

  /** Follow redirects manually, recording every hop. Never throws. */
  async fetchWithRedirects(url: string, opts: RequestOptions = {}): Promise<FetchResult> {
    const hops: RedirectHop[] = [];
    const seen = new Set<string>();
    let current = url;

    for (let i = 0; i <= CRAWL_LIMITS.maxRedirects; i++) {
      if (seen.has(current)) {
        return {
          hops,
          final: null,
          error: 'Redirect loop',
          redirectLoop: true,
          tooManyRedirects: false,
        };
      }
      seen.add(current);

      let response: FetchResponse;
      try {
        response = await this.fetchOnce(current, opts);
      } catch (error) {
        return {
          hops,
          final: null,
          error: describeError(error),
          redirectLoop: false,
          tooManyRedirects: false,
        };
      }
      hops.push({ url: current, status: response.status });

      const location = response.headers.location;
      if (!REDIRECT_STATUSES.has(response.status) || !location) {
        return { hops, final: response, error: null, redirectLoop: false, tooManyRedirects: false };
      }
      const next = normalizeUrl(location, current);
      if (!next) {
        return {
          hops,
          final: response,
          error: `Unfollowable redirect to ${location}`,
          redirectLoop: false,
          tooManyRedirects: false,
        };
      }
      current = next;
    }
    return {
      hops,
      final: null,
      error: 'Too many redirects',
      redirectLoop: false,
      tooManyRedirects: true,
    };
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
  }
}

// zstd support arrived in Node 22.15; only advertise it where it exists.
const hasZstd =
  typeof (zlib as { createZstdDecompress?: unknown }).createZstdDecompress === 'function';
const ACCEPT_ENCODING = hasZstd ? 'gzip, deflate, br, zstd' : 'gzip, deflate, br';

/** Undo Content-Encoding. */
function decodedBody(raw: Readable, encoding: string | undefined): Readable {
  const value = encoding?.trim().toLowerCase();
  const decoder =
    value === 'gzip' || value === 'x-gzip'
      ? zlib.createGunzip()
      : value === 'deflate'
        ? zlib.createInflate()
        : value === 'br'
          ? zlib.createBrotliDecompress()
          : value === 'zstd' && hasZstd
            ? zlib.createZstdDecompress()
            : null;
  if (!decoder) return raw;
  raw.on('error', (error) => decoder.destroy(error));
  return raw.pipe(decoder);
}

function unwrapNetworkError(error: unknown): Error {
  if (error instanceof CrawlmindError) return error;
  // undici wraps connection errors; the useful part is usually in `cause`.
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof CrawlmindError) return cause;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return new CrawlmindError('network', code ? `${code}: ${cause.message}` : cause.message);
  }
  return new CrawlmindError('network', describeError(error));
}

/** Decode an HTML body using the charset from headers or `<meta charset>`, falling back to UTF-8. */
export function decodeHtml(body: Buffer, contentType: string | undefined): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  const head = body.subarray(0, 2048).toString('latin1');
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta, 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // Unknown label: try the next candidate.
    }
  }
  return body.toString('utf8');
}
