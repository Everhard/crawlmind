import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION, type Engine } from '../../src/core/index.js';
import { createServer } from '../../src/mcp/server.js';
import { HashingEmbedder } from '../helpers/embedder.js';
import { createTestEngine } from '../helpers/engine.js';
import { startFixtureSites } from '../helpers/fixture-server.js';

describe('MCP server', () => {
  let engine: Engine;
  let client: Client;
  let sites: Awaited<ReturnType<typeof startFixtureSites>>;
  let crawlId = '';

  beforeAll(async () => {
    sites = await startFixtureSites();
    engine = createTestEngine({ embedder: new HashingEmbedder() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([
      createServer({ engine, allowPrivateNetworks: true }).connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
    await engine.close();
    await sites.close();
  });

  it('lists its tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'ping',
        'start_crawl',
        'get_crawl_status',
        'cancel_crawl',
        'list_crawls',
        'get_summary',
        'get_issues',
        'get_page',
        'get_links',
        'get_top_pages',
        'query_data',
        'get_templates',
        'measure_templates',
        'suggest_links',
        'find_cannibalization',
      ]),
    );
  });

  it('answers ping', async () => {
    const result = await client.callTool({ name: 'ping', arguments: {} });
    expect(result.structuredContent).toEqual({ ok: true, version: VERSION });
  });

  it('runs a crawl in the background and reports progress while waiting', async () => {
    const started = await client.callTool({
      name: 'start_crawl',
      arguments: {
        url: sites.site.origin,
        allowPrivateNetworks: true,
        delayMs: 0,
        checkExternalLinks: false,
      },
    });
    crawlId = (started.structuredContent as { crawl: { crawlId: string } }).crawl.crawlId;
    expect(crawlId).toMatch(/^[0-9a-f]{8}$/);

    const progress: number[] = [];
    let status = 'running';
    while (status === 'running') {
      const res = await client.callTool(
        { name: 'get_crawl_status', arguments: { crawl_id: crawlId, wait_seconds: 5 } },
        undefined,
        { onprogress: (p) => progress.push(p.progress), resetTimeoutOnProgress: true },
      );
      status = (res.structuredContent as { crawl: { status: string } }).crawl.status;
    }
    expect(status).toBe('completed');
    expect(progress.length).toBeGreaterThan(0);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);

    const list = await client.callTool({ name: 'list_crawls', arguments: {} });
    expect((list.structuredContent as { total: number }).total).toBe(1);
  });

  it('summarizes and lists issues of the crawl', async () => {
    const summary = await client.callTool({
      name: 'get_summary',
      arguments: { crawl_id: crawlId },
    });
    expect(summary.isError).toBeFalsy();
    const text = JSON.stringify(summary.content);
    expect(text).toContain('Broken internal links');
    expect(text).toContain('Fix:');

    const critical = await client.callTool({
      name: 'get_issues',
      arguments: { crawl_id: crawlId, severity: 'critical' },
    });
    const issues = (critical.structuredContent as { issues: { severity: string }[] }).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'critical')).toBe(true);

    const broken = await client.callTool({
      name: 'get_issues',
      arguments: { crawl_id: crawlId, check_id: 'links.broken_internal', limit: 2 },
    });
    const sc = broken.structuredContent as { urls: unknown[]; total: number };
    expect(sc.urls).toHaveLength(2);
    expect(sc.total).toBeGreaterThan(2);
    expect(JSON.stringify(broken.content)).toMatch(/more; use offset 2/);
  });

  it('answers page, links, top pages and SQL questions', async () => {
    const page = await client.callTool({
      name: 'get_page',
      arguments: { crawl_id: crawlId, url: `${sites.site.origin}/` },
    });
    expect((page.structuredContent as { page: { status: number } }).page.status).toBe(200);

    const links = await client.callTool({
      name: 'get_links',
      arguments: { crawl_id: crawlId, url: `${sites.site.origin}/about`, exclude_nav_footer: true },
    });
    expect(links.isError).toBeFalsy();

    const top = await client.callTool({
      name: 'get_top_pages',
      arguments: { crawl_id: crawlId, by: 'pagerank', limit: 3 },
    });
    expect((top.structuredContent as { items: unknown[] }).items).toHaveLength(3);

    const sql = await client.callTool({
      name: 'query_data',
      arguments: {
        sql: `SELECT status, COUNT(*) AS n FROM pages WHERE crawl_id = '${crawlId}' GROUP BY status`,
      },
    });
    expect((sql.structuredContent as { rowCount: number }).rowCount).toBeGreaterThan(2);

    const write = await client.callTool({
      name: 'query_data',
      arguments: { sql: 'DROP TABLE pages' },
    });
    expect(write.isError).toBe(true);
  });

  it('lists templates', async () => {
    const res = await client.callTool({ name: 'get_templates', arguments: { crawl_id: crawlId } });
    const items = (res.structuredContent as { items: { label: string; pageCount: number }[] })
      .items;
    expect(items.find((t) => t.label === '/blog/*')?.pageCount).toBe(3);
    expect(JSON.stringify(res.content)).toContain('measure_templates');
  });

  it('suggests links and offers the linking plan prompt', async () => {
    const res = await client.callTool({
      name: 'suggest_links',
      arguments: { crawl_id: crawlId, min_similarity: 0.1, limit: 3 },
    });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { items: unknown[] }).items.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.content)).toContain('Paragraph:');

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('internal_linking_plan');
    const prompt = await client.getPrompt({
      name: 'internal_linking_plan',
      arguments: { url: 'https://example.com' },
    });
    expect(JSON.stringify(prompt.messages)).toContain('suggest_links');
  });

  it('serves check docs and crawl summaries as resources', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('crawlmind://checks/links.broken_internal');
    expect(resources.map((r) => r.uri)).toContain(`crawlmind://crawls/${crawlId}/summary`);

    const doc = await client.readResource({ uri: 'crawlmind://checks/redirects.chain' });
    expect(JSON.stringify(doc.contents)).toContain('How to fix');

    const summary = await client.readResource({ uri: `crawlmind://crawls/${crawlId}/summary` });
    expect(JSON.stringify(summary.contents)).toContain('Issues:');
  });

  it('returns actionable errors', async () => {
    const res = await client.callTool({
      name: 'get_crawl_status',
      arguments: { crawl_id: 'nope' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/list_crawls/);

    const bad = await client.callTool({
      name: 'start_crawl',
      arguments: { url: 'ftp://example.com' },
    });
    expect(bad.isError).toBe(true);
  });
});

describe('MCP private network gate', () => {
  it('refuses allowPrivateNetworks unless the operator enabled it', async () => {
    const engine = createTestEngine();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([
      createServer({ engine, allowPrivateNetworks: false }).connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const res = await client.callTool({
      name: 'start_crawl',
      arguments: { url: 'http://127.0.0.1:9/', allowPrivateNetworks: true },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/CRAWLMIND_ALLOW_PRIVATE_NETWORKS/);
    expect(engine.store.listCrawls({ limit: 1, offset: 0 }).total).toBe(0);
    await client.close();
    await engine.close();
  });
});
