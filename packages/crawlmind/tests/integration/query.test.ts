import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueryRunner } from '../../src/core/analysis/query.js';
import { openDatabase, type DB } from '../../src/core/storage/db.js';

describe('QueryRunner on a database file', () => {
  let dir: string;
  let db: DB;
  let runner: QueryRunner;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'crawlmind-query-'));
    const path = join(dir, 'test.db');
    db = openDatabase(path);
    db.prepare(
      `INSERT INTO crawls (id, site, start_url, options_json, status, started_at, user_agent)
       VALUES ('c1', 'https://e.com', 'https://e.com/', '{}', 'completed', '2026-01-01', 'ua')`,
    ).run();
    runner = new QueryRunner(path, db, 500);
  });

  afterAll(() => {
    runner.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns rows from a worker', async () => {
    const result = await runner.run('SELECT id, site FROM crawls');
    expect(result).toEqual({
      columns: ['id', 'site'],
      rows: [{ id: 'c1', site: 'https://e.com' }],
      rowCount: 1,
      truncated: false,
    });
  });

  it('stops runaway queries', async () => {
    const started = Date.now();
    await expect(
      runner.run(
        'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c',
      ),
    ).rejects.toThrow(/stopped after/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('caps long values', async () => {
    const result = await runner.run("SELECT printf('%.5000c', 'x') AS long");
    expect(String(result.rows[0]?.long).length).toBeLessThan(2100);
  });
});
