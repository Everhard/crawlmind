import { Command, CommanderError } from 'commander';
import { describeError, VERSION } from '../core/index.js';
import { registerAuditCommands } from './commands/audit.js';
import { registerCrawlCommand } from './commands/crawl.js';
import { registerCrawlsCommand } from './commands/crawls.js';
import { registerPageCommands } from './commands/pages.js';
import { registerReportCommands } from './commands/reports.js';
import { registerSqlCommand } from './commands/sql.js';
import { registerSuggestCommands } from './commands/suggest.js';
import { CliContext, type GlobalOptions } from './context.js';

export interface ProgramDeps {
  /** Injected by the entry point so the CLI layer stays independent of the MCP layer. */
  runMcpServer: () => Promise<void>;
}

export function createProgram(deps: ProgramDeps): Command {
  let context: CliContext | null = null;
  const program = new Command()
    .name('crawlmind')
    .description('AI-native SEO audits: broken links, internal linking, crawl diffs.')
    .version(VERSION, '-v, --version')
    .option('--json', 'print machine-readable JSON to stdout')
    .option('--no-color', 'disable colors')
    .option('--home <dir>', 'data directory (default: ~/.crawlmind, env CRAWLMIND_HOME)')
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({ writeErr: (str) => process.stderr.write(str) })
    .hook('preAction', (_program, command) => {
      context = new CliContext(command.optsWithGlobals<GlobalOptions>());
    })
    .hook('postAction', async () => {
      await context?.close();
    });

  const getContext = (): CliContext => {
    if (!context) throw new Error('CLI context is not initialized');
    return context;
  };

  registerCrawlCommand(program, getContext);
  registerCrawlsCommand(program, getContext);
  registerAuditCommands(program, getContext);
  registerPageCommands(program, getContext);
  registerSuggestCommands(program, getContext);
  registerReportCommands(program, getContext);
  registerSqlCommand(program, getContext);

  program
    .command('mcp')
    .description('Start the MCP server over stdio (for Claude, Cursor and other MCP clients)')
    .action(() => deps.runMcpServer());

  return program;
}

/** Run the CLI, turning engine errors into a one-line message and exit code 1. */
export async function runCli(deps: ProgramDeps, argv = process.argv): Promise<void> {
  try {
    await createProgram(deps).parseAsync(argv);
  } catch (error) {
    // Commander already printed usage errors, help and version.
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }
    process.stderr.write(`crawlmind: ${describeError(error)}\n`);
    process.exitCode = 1;
  }
}
