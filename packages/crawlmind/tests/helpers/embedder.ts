import type { Embedder } from '../../src/core/index.js';
import { keyStems } from '../../src/core/index.js';

/**
 * Deterministic bag-of-stems embedder for tests: texts sharing key words get similar vectors,
 * which is enough to exercise ranking without downloading a model.
 */
export class HashingEmbedder implements Embedder {
  readonly model = 'test/hashing-512';
  calls = 0;

  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    return texts.map((text) => {
      const v = new Float32Array(512);
      for (const stem of keyStems(text)) {
        let h = 2166136261;
        for (let i = 0; i < stem.length; i++) h = Math.imul(h ^ stem.charCodeAt(i), 16777619);
        v[(h >>> 0) % 512] = (v[(h >>> 0) % 512] as number) + 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
