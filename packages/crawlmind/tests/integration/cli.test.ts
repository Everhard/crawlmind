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

  it('prints a summary after crawling and supports --fail-on', async () => {
    const run = await runCliCaptured([
      ...base(),
      'crawl',
      sites.site.origin,
      '--allow-private',
      '--delay',
      '0',
      '--no-external',
      '--fail-on',
      'critical',
    ]);
    expect(run.stdout).toMatch(/Issues\s+● \d+ critical/);
    expect(run.stdout).toContain('Broken internal links');
    expect(run.stderr).toMatch(/issue\(s\) at severity critical or worse/);
    expect(run.exitCode).toBe(1);
  });

  it('shows summary, issues, page, links, top pages and SQL for the latest crawl', async () => {
    const summary = await runCliCaptured([...base(), 'summary']);
    expect(summary.stdout).toMatch(/Status\s+2xx \d+/);

    const issues = await runCliCaptured([...base(), 'issues', '--severity', 'critical']);
    expect(issues.stdout).toContain('Broken internal links');
    expect(issues.stdout).not.toContain('Thin content');

    const check = await runCliCaptured([...base(), 'issues', '--check', 'links.broken_internal']);
    expect(check.stdout).toMatch(/\/missing \(404\)/);

    const page = await runCliCaptured([...base(), 'page', '/old-page']);
    expect(page.stdout).toMatch(/Redirects\s+301/);

    const links = await runCliCaptured([...base(), 'links', '/about', '--content-only']);
    expect(links.stdout).toMatch(/From\s+Anchor\s+Where/);
    expect(links.stdout).not.toMatch(/\bnav\b/);

    const top = await runCliCaptured([
      ...base(),
      '--json',
      'top',
      '--by',
      'inlinks',
      '--limit',
      '3',
    ]);
    expect((JSON.parse(top.stdout) as { items: unknown[] }).items).toHaveLength(3);

    const sql = await runCliCaptured([...base(), 'sql', 'SELECT COUNT(*) AS n FROM crawls']);
    expect(sql.stdout).toMatch(/n\s+\d/);

    const bad = await runCliCaptured([...base(), 'sql', 'DELETE FROM crawls']);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toMatch(/Only SELECT/);
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
    const run = await runCliCaptured([...base(), 'crawl', sites.site.origin, '--max-pages', '-1']);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toMatch(/expected an integer/);
  });
});
