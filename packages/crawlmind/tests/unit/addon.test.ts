import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addonEntry,
  installTransformersPackage,
  npmCommand,
  npmInstallArgs,
  TRANSFORMERS_PACKAGE,
  TRANSFORMERS_RANGE,
  type Spawner,
} from '../../src/core/embeddings/addon.js';
import { CrawlmindError } from '../../src/core/index.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  peerDependencies: Record<string, string>;
};

/** Writes a minimal ESM package where npm would put transformers.js. */
function writeStubPackage(addons: string): void {
  const dir = join(addons, 'node_modules', '@huggingface', 'transformers');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: TRANSFORMERS_PACKAGE,
      type: 'module',
      exports: { node: { import: { default: './dist/transformers.node.mjs' } } },
    }),
  );
  writeFileSync(join(dir, 'dist', 'transformers.node.mjs'), 'export const stub = true;\n');
}

/** A spawner that runs nothing: it calls `effect` with the cwd and exits with `code`. */
function fakeSpawner(code: number, effect?: (cwd: string) => void, stderr = ''): Spawner {
  return ((_command: string, _args: string[], options: { cwd: string }) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => {
      effect?.(options.cwd);
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
    });
    return child;
  }) as unknown as Spawner;
}

describe('embeddings add-on', () => {
  let home: string;
  const previousHome = process.env.CRAWLMIND_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'crawlmind-addon-'));
    process.env.CRAWLMIND_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.CRAWLMIND_HOME;
    else process.env.CRAWLMIND_HOME = previousHome;
  });

  it('installs the same version range as the peer dependency', () => {
    expect(pkg.peerDependencies[TRANSFORMERS_PACKAGE]).toBe(TRANSFORMERS_RANGE);
    expect(npmInstallArgs()).toEqual(
      expect.arrayContaining([
        'install',
        '--prefix',
        '.',
        `${TRANSFORMERS_PACKAGE}@${TRANSFORMERS_RANGE}`,
      ]),
    );
  });

  it('runs npm through the current Node binary when npm-cli.js is known', () => {
    const cli = join(home, 'npm-cli.js');
    writeFileSync(cli, '');
    expect(npmCommand({ npm_execpath: cli }, '/nowhere/bin/node', 'linux')).toEqual({
      command: '/nowhere/bin/node',
      args: [cli],
      shell: false,
    });
  });

  it('falls back to npm on PATH', () => {
    expect(npmCommand({}, '/nowhere/bin/node', 'linux')).toEqual({
      command: 'npm',
      args: [],
      shell: false,
    });
    expect(npmCommand({}, 'C:\\nowhere\\node.exe', 'win32').command).toBe('npm.cmd');
  });

  it('finds and imports a package installed into the add-ons folder', async () => {
    const addons = join(home, 'addons');
    expect(addonEntry(addons)).toBeNull();
    writeStubPackage(addons);
    const entry = addonEntry(addons);
    expect(entry).toMatch(/transformers\.node\.mjs$/);
    const mod = (await import(entry as string)) as { stub: boolean };
    expect(mod.stub).toBe(true);
  });

  it('installs into ~/.crawlmind/addons', async () => {
    let cwd = '';
    const messages: string[] = [];
    await installTransformersPackage(
      (m) => messages.push(m),
      fakeSpawner(0, (dir) => {
        cwd = dir;
        writeStubPackage(dir);
      }),
    );
    expect(cwd).toBe(join(home, 'addons'));
    expect(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))).toMatchObject({
      private: true,
    });
    expect(messages[0]).toContain('Installing');
  });

  it('reports npm failures with the manual install hint', async () => {
    const error = await installTransformersPackage(
      undefined,
      fakeSpawner(1, undefined, 'npm ERR! network unreachable\n'),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CrawlmindError);
    expect((error as CrawlmindError).describe()).toMatch(
      /exit code 1.*network unreachable.*npm install -g/s,
    );
  });

  it('fails when npm succeeds but the package is missing', async () => {
    await expect(installTransformersPackage(undefined, fakeSpawner(0))).rejects.toThrow(
      /not found afterwards/,
    );
  });
});
