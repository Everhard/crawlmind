import { Command } from 'commander';
import { VERSION } from '../core/index.js';

export interface ProgramDeps {
  /** Injected by the entry point so the CLI layer stays independent of the MCP layer. */
  runMcpServer: () => Promise<void>;
}

export function createProgram(deps: ProgramDeps): Command {
  const program = new Command()
    .name('crawlmind')
    .description('AI-native SEO audits: broken links, internal linking, page speed by template.')
    .version(VERSION, '-v, --version')
    .showHelpAfterError()
    .configureOutput({ writeErr: (str) => process.stderr.write(str) });

  program
    .command('mcp')
    .description('Start the MCP server over stdio (for Claude, Cursor and other MCP clients)')
    .action(() => deps.runMcpServer());

  return program;
}
