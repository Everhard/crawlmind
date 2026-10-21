export type ErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'crawl_running'
  | 'crawl_not_running'
  | 'blocked_address'
  | 'network'
  | 'internal';

/**
 * An error meant to be shown to a person or an AI client. `hint` says what to do next.
 */
export class CrawlmindError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'CrawlmindError';
    this.code = code;
    this.hint = hint;
  }

  /** Message plus hint, ready to display. */
  describe(): string {
    return this.hint ? `${this.message} ${this.hint}` : this.message;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof CrawlmindError) return error.describe();
  if (error instanceof Error) return error.message;
  return String(error);
}
