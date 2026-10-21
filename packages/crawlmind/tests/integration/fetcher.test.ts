import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fetcher } from '../../src/core/crawler/fetcher.js';

const html = `<html><body>${'<p>hello world</p>'.repeat(200)}</body></html>`;

describe('Fetcher', () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const headers = { 'content-type': 'text/html' };
      switch (req.url) {
        case '/gzip':
          res.writeHead(200, { ...headers, 'content-encoding': 'gzip' }).end(gzipSync(html));
          break;
        case '/br':
          res
            .writeHead(200, { ...headers, 'content-encoding': 'br' })
            .end(brotliCompressSync(html));
          break;
        case '/slow':
          setTimeout(() => res.writeHead(200, headers).end('late'), 2_000);
          break;
        default:
          res.writeHead(200, headers).end(html);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it.each(['/gzip', '/br', '/plain'])('decodes %s bodies', async (path) => {
    const fetcher = new Fetcher({ allowPrivateNetworks: true });
    const res = await fetcher.fetchOnce(`${origin}${path}`, { readBody: () => true });
    expect(res.body?.toString()).toBe(html);
    expect(res.ttfbMs).toBeGreaterThan(0);
    expect(res.totalMs).toBeGreaterThanOrEqual(res.ttfbMs);
    await fetcher.close();
  });

  it('caps the body size after decompression', async () => {
    const fetcher = new Fetcher({ allowPrivateNetworks: true, maxBodyBytes: 100 });
    const res = await fetcher.fetchOnce(`${origin}/gzip`, { readBody: () => true });
    expect(res.body?.length).toBe(100);
    expect(res.truncated).toBe(true);
    await fetcher.close();
  });

  it('times out slow responses', async () => {
    const fetcher = new Fetcher({ allowPrivateNetworks: true, timeoutMs: 200 });
    const result = await fetcher.fetchWithRedirects(`${origin}/slow`);
    expect(result.error).toMatch(/Timed out/);
    await fetcher.close();
  });

  it('blocks private addresses by default', async () => {
    const fetcher = new Fetcher({ allowPrivateNetworks: false });
    const result = await fetcher.fetchWithRedirects(`${origin}/plain`);
    expect(result.error).toMatch(/private or local network/);
    await fetcher.close();
  });
});
