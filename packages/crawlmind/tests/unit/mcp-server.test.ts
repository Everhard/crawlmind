import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/core/index.js';
import { createServer } from '../../src/mcp/server.js';

describe('MCP server', () => {
  it('lists and answers the ping tool', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('ping');

    const result = await client.callTool({ name: 'ping', arguments: {} });
    expect(result.structuredContent).toEqual({ ok: true, version: VERSION });

    await client.close();
  });
});
