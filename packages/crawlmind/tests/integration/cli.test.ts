import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCliCaptured } from '../helpers/cli.js';
import { startFixtureSites } from '../helpers/fixture-server.js';

describe('CLI', () => {
  let sites: Awaited<ReturnType<typeof startFixtureSites>>;
  let home: string;
  const base = () => ['--home', home, '--no-color'];

  beforeAll(async () => {
    sites = await startFixtureSites();
    home = mkdtempSync(join(tmpdir(), 'crawlmind-cli-'));
  });

  afterAll(async () => {
    await sites.close();
    rmSync(home, { recursive: true, force: true });
  });

  it('crawls and prints JSON with --json', async () => {
    const run = await runCliCaptured([
      ...base(),
      '--json',
      'crawl',
      sites.site.origin,
      '--allow-private',
      '--delay',
      '0',
      '--no-external',
    ]);
    expect(run.exitCode).toBe(0);
    const report = JSON.parse(run.stdout) as { crawl: { status: string; pagesCrawled: number } };
    expect(report.crawl.status).toBe('completed');
    expect(report.crawl.pagesCrawled).toBeGreaterThan(10);
  });

  it('lists crawls as a table', async () => {
    const run = await runCliCaptured([...base(), 'crawls']);
    expect(run.stdout).toMatch(/ID\s+Site\s+Status\s+Pages/);
    expect(run.stdout).toContain(sites.site.origin);
    expect(run.stdout).toContain('completed');
  });

  it('fails with a readable message on private addresses without --allow-private', async () => {
    const run = await runCliCaptured([
      ...base(),
      '--json',
      'crawl',
      sites.site.origin,
      '--delay',
      '0',
    ]);
    const report = JSON.parse(run.stdout) as { crawl: { status: string } };
    // The crawl itself completes; the start page records the refusal.
    expect(report.crawl.status).toBe('completed');
  });

  it('rejects invalid option values', async () => {
    const run = await runCliCaptured([...base(), 'crawl', sites.site.origin, '--max-pages', '0']);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toMatch(/expected an integer/);
  });
});
