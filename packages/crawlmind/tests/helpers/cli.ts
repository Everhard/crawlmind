import { vi } from 'vitest';
import { runCli } from '../../src/cli/program.js';

export interface CliRun {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run the CLI in-process and capture its output. */
export async function runCliCaptured(args: string[]): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    await runCli({ runMcpServer: async () => undefined }, ['node', 'crawlmind', ...args]);
    return { stdout, stderr, exitCode: Number(process.exitCode ?? 0) };
  } finally {
    out.mockRestore();
    err.mockRestore();
    process.exitCode = previousExitCode;
  }
}
