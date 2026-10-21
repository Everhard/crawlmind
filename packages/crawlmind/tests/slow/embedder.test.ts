import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dot } from '../../src/core/embeddings/vectors.js';
import { TransformersEmbedder } from '../../src/core/index.js';

// Downloads the real model (~120 MB) on first run. Enable with RUN_SLOW=1.
describe.skipIf(!process.env.RUN_SLOW)('TransformersEmbedder (real model)', () => {
  it('embeds multilingual text with meaningful similarity', { timeout: 600_000 }, async () => {
    process.env.CRAWLMIND_HOME ??= mkdtempSync(join(tmpdir(), 'crawlmind-model-'));
    const embedder = new TransformersEmbedder();
    const [shoesEn, shoesRu, pasta] = await embedder.embed([
      'How to choose running shoes for a marathon',
      'Как выбрать беговые кроссовки для марафона',
      'Classic pasta carbonara recipe with eggs and pecorino',
    ]);
    expect(shoesEn).toHaveLength(384);
    expect(dot(shoesEn as Float32Array, shoesEn as Float32Array)).toBeCloseTo(1, 4);
    expect(dot(shoesEn as Float32Array, shoesRu as Float32Array)).toBeGreaterThan(
      dot(shoesEn as Float32Array, pasta as Float32Array),
    );
  });
});
