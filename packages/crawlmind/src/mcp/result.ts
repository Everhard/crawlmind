import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describeError } from '../core/index.js';

/** Every tool answers with machine-readable data plus a short human-readable summary. */
export function toolResult<T extends object>(structured: T, text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: structured as Record<string, unknown>,
  };
}

export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Wrap a tool handler so engine errors become readable tool errors instead of protocol errors. */
export function safe<A extends unknown[]>(
  handler: (...args: A) => Promise<CallToolResult> | CallToolResult,
): (...args: A) => Promise<CallToolResult> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      return toolError(describeError(error));
    }
  };
}
