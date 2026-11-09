import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CrawlmindError } from '../errors.js';
import { logger } from '../logger.js';
import { addonsDir } from '../paths.js';

/** The optional package behind link suggestions and cannibalization. */
export const TRANSFORMERS_PACKAGE = '@huggingface/transformers';
/** Must match `peerDependencies` in package.json (a test checks this). */
export const TRANSFORMERS_RANGE = '^4.3.1';

/** Shown to people before they agree to the download. */
export const ADDON_SIZE_NOTE =
  'about 700 MB of npm packages and a 120 MB model, stored in ~/.crawlmind';

export const MANUAL_INSTALL_HINT =
  'Or install it next to Crawlmind: `npm install -g crawlmind @huggingface/transformers`, or run ' +
  '`npx -p crawlmind -p @huggingface/transformers crawlmind …` ' +
  '(MCP: `npx -y -p crawlmind-mcp -p @huggingface/transformers crawlmind-mcp`).';

const INSTALL_TIMEOUT_MS = 15 * 60_000;
const HEARTBEAT_MS = 5_000;

export type AddonSource = 'peer' | 'addon' | 'custom';

export interface EmbeddingsStatus {
  installed: boolean;
  /** `peer`: installed next to Crawlmind; `addon`: in ~/.crawlmind/addons; `custom`: injected embedder. */
  source: AddonSource | null;
}

/** Checks for and installs the embeddings add-on. Injectable so front ends can be tested. */
export interface EmbeddingsAddon {
  status(): EmbeddingsStatus;
  /** Install the package and prepare the model; resolves with the new status. */
  install(onProgress?: (message: string) => void): Promise<EmbeddingsStatus>;
}

/** The ESM entry of the package installed in the add-ons folder, if any. */
export function addonEntry(dir = addonsDir()): string | null {
  const pkgDir = join(dir, 'node_modules', ...TRANSFORMERS_PACKAGE.split('/'));
  const pkgJson = join(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as {
      main?: string;
      exports?: { node?: { import?: { default?: string } } };
    };
    const entry = join(pkgDir, pkg.exports?.node?.import?.default ?? pkg.main ?? 'index.js');
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

function peerInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve(TRANSFORMERS_PACKAGE);
    return true;
  } catch {
    return false;
  }
}

/** Where the package can be loaded from, without loading it. */
export function findTransformers(): EmbeddingsStatus {
  if (peerInstalled()) return { installed: true, source: 'peer' };
  if (addonEntry()) return { installed: true, source: 'addon' };
  return { installed: false, source: null };
}

/**
 * Import transformers.js: a regular install next to Crawlmind wins, then the add-ons folder.
 * Returns null when neither is there.
 */
export async function loadTransformers<T>(): Promise<T | null> {
  try {
    return (await import(TRANSFORMERS_PACKAGE)) as T;
  } catch {
    // not installed next to Crawlmind; try the add-ons folder
  }
  const entry = addonEntry();
  if (!entry) return null;
  return (await import(pathToFileURL(entry).href)) as T;
}

interface NpmCommand {
  command: string;
  args: string[];
  shell: boolean;
}

/**
 * How to run npm. Prefer running npm's own JS entry with the current Node binary: it needs no
 * PATH (MCP clients often start servers with a minimal one) and no shell on Windows.
 */
export function npmCommand(
  env: NodeJS.ProcessEnv = process.env,
  execPath = process.execPath,
  platform = process.platform,
): NpmCommand {
  const candidates = [
    env.npm_execpath?.endsWith('npm-cli.js') ? env.npm_execpath : undefined,
    join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows layout
    join(dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Unix
  ];
  const cli = candidates.find((p): p is string => Boolean(p) && existsSync(p as string));
  if (cli) return { command: execPath, args: [cli], shell: false };
  return platform === 'win32'
    ? { command: 'npm.cmd', args: [], shell: true }
    : { command: 'npm', args: [], shell: false };
}

/** Arguments for installing the package into the current directory (the add-ons folder). */
export function npmInstallArgs(): string[] {
  return [
    'install',
    '--prefix',
    '.',
    '--no-audit',
    '--no-fund',
    '--omit=dev',
    `${TRANSFORMERS_PACKAGE}@${TRANSFORMERS_RANGE}`,
  ];
}

export type Spawner = typeof spawn;

/** Install transformers.js into `~/.crawlmind/addons` with npm. */
export async function installTransformersPackage(
  onProgress?: (message: string) => void,
  spawner: Spawner = spawn,
): Promise<void> {
  const dir = addonsDir();
  mkdirSync(dir, { recursive: true });
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) {
    writeFileSync(
      manifest,
      `${JSON.stringify({ name: 'crawlmind-addons', private: true }, null, 2)}\n`,
    );
  }

  const npm = npmCommand();
  const args = [...npm.args, ...npmInstallArgs()];
  logger.info(`Installing ${TRANSFORMERS_PACKAGE} into ${dir}`);
  onProgress?.(`Installing ${TRANSFORMERS_PACKAGE} with npm (${ADDON_SIZE_NOTE})…`);

  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    const child = spawner(npm.command, args, {
      cwd: dir,
      shell: npm.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, npm_config_loglevel: 'error' },
      windowsHide: true,
    });
    let stderr = '';
    child.stdout?.on('data', () => undefined);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const heartbeat = setInterval(() => {
      onProgress?.(
        `Installing ${TRANSFORMERS_PACKAGE}… ${Math.round((Date.now() - started) / 1000)} s`,
      );
    }, HEARTBEAT_MS);
    const timeout = setTimeout(() => {
      child.kill();
      reject(failure('npm install timed out.'));
    }, INSTALL_TIMEOUT_MS);
    const done = () => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
    };
    child.on('error', (error) => {
      done();
      reject(failure(`Could not run npm: ${error.message}.`));
    });
    child.on('close', (code) => {
      done();
      if (code === 0) resolve();
      else reject(failure(`npm install failed (exit code ${code}). ${lastLines(stderr)}`.trim()));
    });
  });

  if (!addonEntry(dir)) throw failure('npm finished, but the package was not found afterwards.');
}

function lastLines(text: string, n = 5): string {
  return text.trim().split('\n').slice(-n).join('\n');
}

function failure(message: string): CrawlmindError {
  return new CrawlmindError(
    'internal',
    `Could not install the embeddings add-on. ${message}`,
    MANUAL_INSTALL_HINT,
  );
}
