#!/usr/bin/env node
import { createProgram } from './cli/program.js';

const program = createProgram({
  // Lazy import keeps the MCP SDK out of regular CLI startup.
  runMcpServer: () => import('./mcp/index.js').then((m) => m.runMcpServer()),
});

await program.parseAsync(process.argv);
