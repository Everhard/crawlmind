import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';

export type DB = Database.Database;

/** Open (and migrate) the Crawlmind database. Use `:memory:` in tests. */
export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/**
 * A second connection that cannot write, for user-supplied SQL. Uses a separate handle so
 * a statement can never touch the main connection's state.
 */
export function openReadonlyDatabase(path: string): DB {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version] as string;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
