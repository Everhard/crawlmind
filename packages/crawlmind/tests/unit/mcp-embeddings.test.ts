import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EmbeddingsAddon, EmbeddingsStatus, Engine } from '../../src/core/index.js';
import { createServer } from '../../src/mcp/server.js';
import { HashingEmbedder } from '../helpers/embedder.js';
import { crawlAndWait, createTestEngine } from '../helpers/engine.js';
import { startFixtureSites } from '../helpers/fixture-server.js';

/** An add-on that starts out missing; `install` only flips the flag. */
class FakeAddon implements EmbeddingsAddon {
  installed = false;
  installs = 0;
  status(): EmbeddingsStatus {
    return this.installed
      ? { installed: true, source: 'addon' }
      : { installed: false, source: null };
  }
  async install(onProgress?: (message: string) => void): Promise<EmbeddingsStatus> {
    this.installs++;
    onProgress?.('Installing…');
    this.installed = true;
    return this.status();
  }
}

async function connect(
  engine: Engine,
  answer?: () => ElicitResult,
): Promise<{ client: Client; asked: string[] }> {
  const asked: string[] = [];
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'test', version: '0.0.0' },
    { capabilities: answer ? { elicitation: {} } : {} },
  );
  if (answer) {
    client.setRequestHandler(ElicitRequestSchema, (request) => {
      asked.push(request.params.message);
      return answer();
    });
  }
  await Promise.all([
    createServer({ engine, allowPrivateNetworks: true }).connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, asked };
}

describe('embeddings add-on over MCP', () => {
  let engine: Engine;
  let addon: FakeAddon;
  let sites: Awaited<ReturnType<typeof startFixtureSites>>;
  let crawlId = '';
  const clients: Client[] = [];

  beforeAll(async () => {
    sites = await startFixtureSites();
    addon = new FakeAddon();
    engine = createTestEngine({ embedder: new HashingEmbedder(), embeddingsAddon: addon });
    crawlId = (await crawlAndWait(engine, { url: sites.site.origin, checkExternalLinks: false }))
      .crawlId;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
    addon.installed = false;
    addon.installs = 0;
  });

  afterAll(async () => {
    await engine.close();
    await sites.close();
  });

  const suggest = (client: Client) =>
    client.callTool({ name: 'suggest_links', arguments: { crawl_id: crawlId } });

  it('asks the user, installs, and then answers the original request', async () => {
    const { client, asked } = await connect(engine, () => ({
      action: 'accept',
      content: { install: true },
    }));
    clients.push(client);
    const result = await suggest(client);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('Install it now?');
    expect(addon.installs).toBe(1);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toHaveProperty('items');

    await suggest(client);
    expect(asked).toHaveLength(1); // installed now, no second question
  });

  it('does not install when the user declines', async () => {
    const { client } = await connect(engine, () => ({ action: 'decline' }));
    clients.push(client);
    const result = await client.callTool({
      name: 'find_cannibalization',
      arguments: { crawl_id: crawlId },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('chose not to install');
    expect(addon.installs).toBe(0);
  });

  it('points clients without elicitation to install_embeddings', async () => {
    const { client } = await connect(engine);
    clients.push(client);
    const result = await suggest(client);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('install_embeddings');
    expect(addon.installs).toBe(0);

    const ping = await client.callTool({ name: 'ping', arguments: {} });
    expect(ping.structuredContent).toMatchObject({ embeddings: 'missing' });

    const installed = await client.callTool({ name: 'install_embeddings', arguments: {} });
    expect(installed.structuredContent).toEqual({ installed: true, source: 'addon' });
    expect(addon.installs).toBe(1);

    const again = await client.callTool({ name: 'install_embeddings', arguments: {} });
    expect(JSON.stringify(again.content)).toContain('already installed');
    expect(addon.installs).toBe(1);
    expect((await suggest(client)).isError).toBeFalsy();
  });

  it('marks install_embeddings as a non-read-only, open-world tool', async () => {
    const { client } = await connect(engine);
    clients.push(client);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'install_embeddings');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});
