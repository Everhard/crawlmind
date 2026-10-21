import type { Command } from 'commander';
import { QUERY_LIMITS, QUERY_SCHEMA_HINT } from '../../core/index.js';
import type { CliContext } from '../context.js';
import { terminalWidth, truncateMiddle } from '../ui/format.js';
import { renderTable } from '../ui/table.js';

export function registerSqlCommand(program: Command, getContext: () => CliContext): void {
  program
    .command('sql')
    .description('Run a read-only SELECT against the crawl database')
    .argument('[query]', 'SQL SELECT statement')
    .option(
      '-l, --limit <n>',
      'maximum rows',
      (v) => Number.parseInt(v, 10),
      QUERY_LIMITS.defaultRows,
    )
    .option('--schema', 'print the tables and columns')
    .action((query: string | undefined, opts: { limit: number; schema?: boolean }) => {
      const ctx = getContext();
      if (opts.schema || !query) {
        ctx.out(QUERY_SCHEMA_HINT);
        return;
      }
      const result = ctx.engine.query.run(query, opts.limit);
      if (ctx.json) return ctx.printJson(result);
      const cell = Math.max(
        12,
        Math.floor((terminalWidth() - 2) / Math.max(1, result.columns.length)) - 2,
      );
      ctx.out(
        renderTable(
          ctx.theme,
          result.columns,
          result.rows.map((row) =>
            result.columns.map((col) => truncateMiddle(String(row[col] ?? ''), cell)),
          ),
        ),
      );
      ctx.out(
        ctx.theme.c.dim(
          `\n  ${result.rowCount} row(s)${result.truncated ? `, truncated at ${opts.limit}` : ''}`,
        ),
      );
    });
}
