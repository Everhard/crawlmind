import { describe, expect, it, vi } from 'vitest';
import { parsePsiResponse, PsiClient } from '../../src/core/speed/psi.js';
import { psiFixture } from '../helpers/psi.js';

describe('parsePsiResponse', () => {
  it('extracts lab and field metrics', () => {
    expect(
      parsePsiResponse('https://x.example/', 'mobile', psiFixture({ score: 0.42, lcp: 4200 })),
    ).toEqual({
      url: 'https://x.example/',
      strategy: 'mobile',
      performanceScore: 42,
      lcpMs: 4200,
      cls: 0.12,
      tbtMs: 350,
      fcpMs: 1800,
      totalBytes: 2_400_000,
      field: { scope: 'url', overall: 'SLOW', lcpMs: 3900, cls: 0.15, inpMs: 280, fcpMs: 2100 },
    });
  });

  it('falls back to origin field data and tolerates missing parts', () => {
    const body = {
      lighthouseResult: {},
      originLoadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2000 } } },
    };
    const r = parsePsiResponse('https://x.example/', 'desktop', body);
    expect(r.performanceScore).toBeNull();
    expect(r.field).toMatchObject({ scope: 'origin', lcpMs: 2000 });
  });
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('PsiClient', () => {
  it('sends strategy, category and key', async () => {
    const fetch = vi.fn(async () => json(200, psiFixture()));
    await new PsiClient({ apiKey: 'k', fetch }).run('https://x.example/a', 'mobile');
    const url = new URL(String((fetch.mock.calls[0] as unknown[])[0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      url: 'https://x.example/a',
      strategy: 'mobile',
      category: 'performance',
      key: 'k',
    });
  });

  it('retries 429 and 5xx with backoff', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(429, { error: { message: 'Quota' } }))
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, psiFixture()));
    const result = await new PsiClient({ fetch, backoffMs: 1 }).run('https://x.example/', 'mobile');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.performanceScore).toBe(75);
  });

  it('explains the keyless quota', async () => {
    const fetch = vi.fn(async () => json(429, { error: { message: 'Quota exceeded' } }));
    await expect(
      new PsiClient({ fetch, backoffMs: 1, retries: 1 }).run('https://x.example/', 'mobile'),
    ).rejects.toThrow(/quota exceeded/i);
  });

  it('does not retry an exhausted daily quota', async () => {
    const fetch = vi.fn(async () =>
      json(429, { error: { message: "Quota exceeded for 'Queries per day'" } }),
    );
    await expect(
      new PsiClient({ fetch, backoffMs: 1 }).run('https://x.example/', 'mobile'),
    ).rejects.toThrow(/quota/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry client errors', async () => {
    const fetch = vi.fn(async () => json(400, { error: { message: 'Invalid URL' } }));
    await expect(
      new PsiClient({ fetch, backoffMs: 1 }).run('https://x.example/', 'mobile'),
    ).rejects.toThrow(/400 Invalid URL/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
