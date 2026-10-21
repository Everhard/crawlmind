/** Spaces out requests to the same host by at least `delayMs`, across concurrent workers. */
export class HostThrottle {
  private readonly nextSlot = new Map<string, number>();

  constructor(private delayMs: number) {}

  setDelay(delayMs: number): void {
    this.delayMs = delayMs;
  }

  async wait(host: string, signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + this.delayMs);
    if (slot > now) await sleep(slot - now, signal);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
