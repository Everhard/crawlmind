/**
 * Minimal leveled logger. It always writes to stderr: when Crawlmind runs as an
 * MCP server, stdout belongs to the JSON-RPC transport.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function envLevel(): LogLevel {
  const value = process.env.CRAWLMIND_LOG_LEVEL?.toLowerCase();
  return value && value in ORDER ? (value as LogLevel) : 'warn';
}

let current: LogLevel = envLevel();

export function setLogLevel(level: LogLevel): void {
  current = level;
}

function write(level: Exclude<LogLevel, 'silent'>, message: string, data?: unknown): void {
  if (ORDER[level] < ORDER[current]) return;
  const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  process.stderr.write(`[crawlmind] ${level}: ${message}${suffix}\n`);
}

export const logger = {
  debug: (message: string, data?: unknown) => write('debug', message, data),
  info: (message: string, data?: unknown) => write('info', message, data),
  warn: (message: string, data?: unknown) => write('warn', message, data),
  error: (message: string, data?: unknown) => write('error', message, data),
};
