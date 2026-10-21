import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Every tool answers with machine-readable data plus a short human-readable summary. */
export function toolResult<T extends Record<string, unknown>>(
  structured: T,
  text: string,
): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
