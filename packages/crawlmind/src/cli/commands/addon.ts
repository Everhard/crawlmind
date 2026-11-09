import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import {
  ADDON_SIZE_NOTE,
  addonsDir,
  CrawlmindError,
  MANUAL_INSTALL_HINT,
  type EmbeddingsStatus,
} from '../../core/index.js';
import type { CliContext } from '../context.js';
import { createProgressLine } from '../ui/progress.js';

/** Install the add-on with a progress line; model download progress is shown too. */
export async function installAddon(ctx: CliContext): Promise<EmbeddingsStatus> {
  const line = createProgressLine(ctx.theme, 'Installing the embeddings add-on');
  ctx.modelProgress = (event) => {
    if (event.status === 'progress' && event.file && event.progress !== undefined) {
      line.update(
        `Downloading model ${ctx.theme.c.dim(event.file)} ${Math.round(event.progress)}%`,
      );
    }
  };
  try {
    const status = await ctx.engine.embeddings.install((message) => line.update(message));
    line.succeed('Embeddings add-on installed');
    return status;
  } catch (error) {
    line.fail('Embeddings add-on was not installed');
    throw error;
  } finally {
    ctx.modelProgress = null;
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * Before `suggest` or `cannibalization`: if the add-on is missing, offer to install it in an
 * interactive terminal. In scripts and with --json, fail with the hint instead of prompting.
 */
export async function ensureAddon(ctx: CliContext): Promise<void> {
  if (ctx.engine.embeddings.status().installed) return;
  const interactive = !ctx.json && Boolean(process.stdin.isTTY && process.stderr.isTTY);
  const missing = 'This command needs the embeddings add-on, which is not installed.';
  if (!interactive) {
    throw new CrawlmindError(
      'invalid_input',
      missing,
      `Run \`crawlmind addon install\`. ${MANUAL_INSTALL_HINT}`,
    );
  }
  process.stderr.write(`${missing}\nIt runs locally (${ADDON_SIZE_NOTE}).\n`);
  if (!(await confirm('Install it now? [Y/n] '))) {
    throw new CrawlmindError('invalid_input', 'The embeddings add-on was not installed.');
  }
  await installAddon(ctx);
}

export function registerAddonCommands(program: Command, getContext: () => CliContext): void {
  const addon = program
    .command('addon')
    .description('Manage the optional embeddings add-on (link suggestions, cannibalization)');

  addon
    .command('status')
    .description('Show whether the embeddings add-on is installed')
    .action(() => {
      const ctx = getContext();
      const status = ctx.engine.embeddings.status();
      if (ctx.json) return ctx.printJson(status);
      const { c, sym } = ctx.theme;
      if (!status.installed) {
        ctx.out(`  ${c.yellow(sym.warn)} Embeddings add-on is not installed.`);
        ctx.out(`\n  ${c.dim('Next')}  crawlmind addon install`);
        return;
      }
      const where =
        status.source === 'addon'
          ? addonsDir()
          : status.source === 'peer'
            ? 'next to Crawlmind'
            : 'custom';
      ctx.out(`  ${c.green(sym.ok)} Embeddings add-on is installed ${c.dim(`(${where})`)}.`);
    });

  addon
    .command('install')
    .description(`Install the embeddings add-on (${ADDON_SIZE_NOTE})`)
    .action(async () => {
      const ctx = getContext();
      const before = ctx.engine.embeddings.status();
      const status = before.installed ? before : await installAddon(ctx);
      if (ctx.json) return ctx.printJson(status);
      if (before.installed) {
        ctx.out(`  ${ctx.theme.c.green(ctx.theme.sym.ok)} Embeddings add-on is already installed.`);
      }
    });
}
