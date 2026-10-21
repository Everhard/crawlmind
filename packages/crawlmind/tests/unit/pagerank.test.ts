import { describe, expect, it } from 'vitest';
import { pageRank } from '../../src/core/analysis/pagerank.js';

const sum = (a: Float64Array) => a.reduce((x, y) => x + y, 0);

describe('pageRank', () => {
  it('is uniform on a cycle', () => {
    const ranks = pageRank([[1], [2], [0]]);
    for (const r of ranks) expect(r).toBeCloseTo(1 / 3, 6);
  });

  it('favours pages with more inlinks and always sums to 1', () => {
    // 0 is linked from everyone; 3 is a dangling node.
    const ranks = pageRank([[1], [0], [0, 3], []]);
    expect(sum(ranks)).toBeCloseTo(1, 9);
    expect(ranks[0]).toBeGreaterThan(ranks[1] as number);
    expect(ranks[0]).toBeGreaterThan(ranks[3] as number);
  });

  it('matches the textbook example', () => {
    // A→B, A→C, B→C, C→A, D→C (damping 0.85)
    const ranks = pageRank([[1, 2], [2], [0], [2]]);
    expect(ranks[2]).toBeCloseTo(0.3941, 3);
    expect(ranks[0]).toBeCloseTo(0.3725, 3);
    expect(ranks[1]).toBeCloseTo(0.1958, 3);
    expect(ranks[3]).toBeCloseTo(0.0375, 3);
  });

  it('handles empty graphs', () => {
    expect(pageRank([])).toHaveLength(0);
  });
});
