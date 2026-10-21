import Table from 'cli-table3';
import type { Theme } from './theme.js';

export type Align = 'left' | 'right' | 'center';

/** A borderless table with a dimmed header, in the style of `gh` and `vercel`. */
export function renderTable(
  theme: Theme,
  head: string[],
  rows: (string | number)[][],
  align: Align[] = [],
): string {
  const table = new Table({
    head: head.map((h) => theme.c.dim(h)),
    colAligns: align,
    chars: {
      top: '',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: ' ',
      'left-mid': '',
      mid: '',
      'mid-mid': '',
      right: '',
      'right-mid': '',
      middle: '  ',
    },
    style: { head: [], border: [], 'padding-left': 0, 'padding-right': 0 },
  });
  for (const row of rows) table.push(row.map(String));
  return table.toString();
}

/** Aligned `label  value` lines. */
export function renderFields(theme: Theme, fields: [string, string][]): string {
  const width = Math.max(...fields.map(([label]) => label.length));
  return fields
    .map(([label, value]) => `  ${theme.c.dim(label.padEnd(width))}  ${value}`)
    .join('\n');
}
