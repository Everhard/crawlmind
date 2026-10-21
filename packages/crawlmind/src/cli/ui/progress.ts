import ora, { type Ora } from 'ora';
import type { Theme } from './theme.js';

/** A status line on stderr: animated in a terminal, silent (except the final line) otherwise. */
export interface ProgressLine {
  update(text: string): void;
  succeed(text: string): void;
  warn(text: string): void;
  fail(text: string): void;
}

export function createProgressLine(theme: Theme, initialText: string): ProgressLine {
  const stream = process.stderr;
  // ora divides by the terminal width; some pseudo-terminals report 0 columns.
  const interactive = Boolean(stream.isTTY && stream.columns) && !process.env.CI;
  if (interactive) {
    const spinner: Ora = ora({ text: initialText, stream, discardStdin: false }).start();
    return {
      update: (text) => {
        spinner.text = text;
      },
      succeed: (text) => spinner.stopAndPersist({ symbol: theme.c.green(theme.sym.ok), text }),
      warn: (text) => spinner.stopAndPersist({ symbol: theme.c.yellow(theme.sym.warn), text }),
      fail: (text) => spinner.stopAndPersist({ symbol: theme.c.red(theme.sym.fail), text }),
    };
  }
  const line = (symbol: string, text: string) => stream.write(`${symbol} ${text}\n`);
  return {
    update: () => undefined,
    succeed: (text) => line(theme.c.green(theme.sym.ok), text),
    warn: (text) => line(theme.c.yellow(theme.sym.warn), text),
    fail: (text) => line(theme.c.red(theme.sym.fail), text),
  };
}
