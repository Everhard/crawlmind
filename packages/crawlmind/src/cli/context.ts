import { createEngine, type Engine } from '../core/index.js';
import { createTheme, type Theme } from './ui/theme.js';

export interface GlobalOptions {
  json?: boolean;
  color?: boolean;
  home?: string;
}

/** Per-invocation state shared by commands: output mode, theme, and a lazily opened engine. */
export class CliContext {
  readonly json: boolean;
  readonly theme: Theme;
  private engineInstance: Engine | null = null;

  constructor(options: GlobalOptions) {
    if (options.home) process.env.CRAWLMIND_HOME = options.home;
    this.json = Boolean(options.json);
    const colorAllowed = options.color !== false && !process.env.NO_COLOR;
    this.theme = createTheme(
      colorAllowed && (Boolean(process.env.FORCE_COLOR) || Boolean(process.stdout.isTTY)),
    );
  }

  get engine(): Engine {
    this.engineInstance ??= createEngine();
    return this.engineInstance;
  }

  /** Write to stdout (results). Progress and diagnostics go to stderr. */
  out(text = ''): void {
    process.stdout.write(`${text}\n`);
  }

  printJson(data: unknown): void {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }

  async close(): Promise<void> {
    await this.engineInstance?.close();
  }
}
