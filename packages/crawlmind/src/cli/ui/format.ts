/** Small, dependency-free formatters for terminal output. */

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return iso.slice(0, 10);
}

/** Shorten long text in the middle, keeping both ends readable. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** Show internal URLs as paths relative to the site; leave others untouched. */
export function displayUrl(url: string, site?: string): string {
  if (site && url.startsWith(site)) return url.slice(site.length) || '/';
  return url;
}

export function terminalWidth(): number {
  return process.stdout.columns || 100;
}
