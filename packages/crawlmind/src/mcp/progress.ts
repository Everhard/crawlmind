import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { CrawlProgress } from '../core/index.js';

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const MIN_INTERVAL_MS = 500;

/**
 * Turns crawl progress into MCP progress notifications when the client sent a progress
 * token. Notifications are throttled and `progress` only ever increases, as the spec requires.
 */
export function crawlProgressNotifier(
  extra: ToolExtra,
): ((progress: CrawlProgress) => void) | undefined {
  const token = extra._meta?.progressToken;
  if (token === undefined) return undefined;

  let last = -1;
  let lastSentAt = 0;
  return (p) => {
    const value = p.pagesCrawled + p.externalChecked;
    const now = Date.now();
    const final = p.phase === 'done';
    if (value <= last && !final) return;
    if (now - lastSentAt < MIN_INTERVAL_MS && !final) return;
    last = Math.max(last, value);
    lastSentAt = now;
    const message =
      p.phase === 'external'
        ? `Checking external links: ${p.externalChecked} checked`
        : `${p.phase}: ${p.pagesCrawled}/${p.maxPages} pages, ${p.errors} errors`;
    void extra
      .sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken: token,
          progress: last,
          ...(p.phase === 'crawling' ? { total: p.maxPages } : {}),
          message,
        },
      })
      .catch(() => undefined);
  };
}
