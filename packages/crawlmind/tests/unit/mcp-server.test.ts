import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION, type Engine } from '../../src/core/index.js';
import { createServer } from '../../src/mcp/server.js';
import { createTestEngine } from '../helpers/engine.js';
import { startFixtureSites } from '../helpers/fixture-server.js';

describe('MCP server', () => {
  let engine: Engine;
  let client: Client;
  let sites: Awaited<ReturnType<typeof startFixtureSites>>;

  beforeAll(async () => {
    sites = await startFixtureSites();
    engine = createTestEngine();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([
      createServer({ engine }).connect(serverTransport),
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
    const crawlId = (started.structuredContent as { crawl: { crawlId: string } }).crawl.crawlId;
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
