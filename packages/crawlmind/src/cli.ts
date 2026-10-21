#!/usr/bin/env node
import { runCli } from './cli/program.js';

await runCli({
  // Lazy import keeps the MCP SDK out of regular CLI startup.
  runMcpServer: () => import('./mcp/index.js').then((m) => m.runMcpServer()),
});
