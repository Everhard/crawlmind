/**
 * Group URL paths into patterns such as `/product/*` or `/blog/*` by spotting the path
 * segments that vary between pages of one template.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID = /^(?=.*\d)[0-9a-f]{8,}$/i;
const NUMBER = /^\d+$/;
const DATE = /^\d{4}-\d{2}(-\d{2})?$/;

/** Segments that look like ids or long slugs are variable on their own. */
export function isVariableSegment(segment: string): boolean {
  if (NUMBER.test(segment) || UUID.test(segment) || HEX_ID.test(segment) || DATE.test(segment))
    return true;
  const hyphens = segment.split('-').length - 1;
  return hyphens >= 4 || segment.length > 50;
}

/** Siblings with this many distinct values below the first level collapse into `*`. */
const SIBLING_CARDINALITY = 4;

const shape = (segment: string) => segment.replace(/\d+/g, '#');

export function pathSegments(url: string): string[] {
  return new URL(url).pathname.split('/').filter(Boolean).map(decodeSegment);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment).toLowerCase();
  } catch {
    return segment.toLowerCase();
  }
}

/**
 * Compute a pattern for every URL. Rules, applied level by level:
 * 1. ids, numbers, dates, uuids and long slugs become `*`;
 * 2. siblings that differ only in digits (`post-1`, `post-2`) become `*`;
 * 3. below the first level, 4+ distinct sibling values become `*`.
 */
export function urlPatterns(urls: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const items = urls.map((url) => ({ url, segments: pathSegments(url), pattern: [] as string[] }));

  const visit = (group: typeof items, depth: number) => {
    const ending = group.filter((item) => item.segments.length === depth);
    for (const item of ending) result.set(item.url, `/${item.pattern.join('/')}`);
    const rest = group.filter((item) => item.segments.length > depth);
    if (rest.length === 0) return;

    const values = new Set(rest.map((item) => item.segments[depth] as string));
    const token = new Map<string, string>();
    for (const value of values) token.set(value, isVariableSegment(value) ? '*' : value);

    const byShape = new Map<string, string[]>();
    for (const value of values) {
      if (token.get(value) === '*' || !/\d/.test(value)) continue;
      pushTo(byShape, shape(value), value);
    }
    for (const same of byShape.values())
      if (same.length >= 2) for (const v of same) token.set(v, '*');

    const literal = [...values].filter((v) => token.get(v) !== '*');
    if (depth >= 1 && literal.length >= SIBLING_CARDINALITY)
      for (const v of literal) token.set(v, '*');

    const next = new Map<string, typeof items>();
    for (const item of rest) {
      const t = token.get(item.segments[depth] as string) as string;
      item.pattern.push(t);
      pushTo(next, t, item);
    }
    for (const sub of next.values()) visit(sub, depth + 1);
  };

  visit(items, 0);
  return result;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
