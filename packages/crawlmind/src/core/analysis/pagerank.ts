export interface PageRankOptions {
  damping?: number;
  tolerance?: number;
  maxIterations?: number;
}

/**
 * PageRank by power iteration. `outLinks[i]` lists the distinct nodes that node `i` links to
 * (no self-links). Rank of dangling nodes (no outlinks) is spread evenly, so ranks always sum
 * to 1. Stops when the L1 change drops below `tolerance`.
 */
export function pageRank(outLinks: number[][], options: PageRankOptions = {}): Float64Array {
  const { damping = 0.85, tolerance = 1e-6, maxIterations = 100 } = options;
  const n = outLinks.length;
  let rank = new Float64Array(n).fill(n ? 1 / n : 0);
  if (n === 0) return rank;

  for (let iter = 0; iter < maxIterations; iter++) {
    const next = new Float64Array(n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      const targets = outLinks[i] as number[];
      const r = rank[i] as number;
      if (targets.length === 0) {
        dangling += r;
        continue;
      }
      const share = r / targets.length;
      for (const t of targets) next[t] = (next[t] as number) + share;
    }
    const base = (1 - damping) / n + (damping * dangling) / n;
    let delta = 0;
    for (let i = 0; i < n; i++) {
      const value = base + damping * (next[i] as number);
      delta += Math.abs(value - (rank[i] as number));
      next[i] = value;
    }
    rank = next;
    if (delta < tolerance) break;
  }
  return rank;
}
