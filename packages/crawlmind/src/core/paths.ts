import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root data directory: `~/.crawlmind`, overridable with `CRAWLMIND_HOME`. */
export function dataDir(): string {
  return process.env.CRAWLMIND_HOME || join(homedir(), '.crawlmind');
}

export function databasePath(): string {
  return join(dataDir(), 'crawlmind.db');
}

export function modelsDir(): string {
  return join(dataDir(), 'models');
}

/** Optional packages Crawlmind installs on request (the embeddings add-on). */
export function addonsDir(): string {
  return join(dataDir(), 'addons');
}
