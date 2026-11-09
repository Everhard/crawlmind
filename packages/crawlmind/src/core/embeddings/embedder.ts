import { CrawlmindError } from '../errors.js';
import { logger } from '../logger.js';
import { modelsDir } from '../paths.js';
import { loadTransformers, MANUAL_INSTALL_HINT } from './addon.js';

/** Turns texts into L2-normalized vectors. */
export interface Embedder {
  /** Identifies the model; stored with vectors so a model change triggers re-embedding. */
  readonly model: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export type ModelProgress = (event: { status: string; file?: string; progress?: number }) => void;

/**
 * Small multilingual sentence-embedding model (384 dimensions, ~120 MB quantized).
 * Chosen for retrieval quality across ~100 languages at CPU-friendly size; see README.
 */
export const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';
const MAX_INPUT_CHARS = 1000; // keeps inputs well under the model's 512-token window
const BATCH_SIZE = 16;

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: true },
) => Promise<{ data: Float32Array; dims: number[] }>;

/** The part of the transformers.js API we use (kept local so our types do not need the package). */
interface TransformersModule {
  env: { cacheDir: string | null };
  pipeline: (
    task: 'feature-extraction',
    model: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
}

/**
 * Local embeddings with transformers.js, loaded on first use. The package is an optional peer
 * dependency (its ONNX runtime is several hundred MB), so it is imported dynamically, either
 * from next to Crawlmind or from the add-ons folder (see addon.ts).
 */
export class TransformersEmbedder implements Embedder {
  private extractor: Promise<FeatureExtractor> | null = null;

  constructor(
    readonly model: string = DEFAULT_MODEL,
    private readonly onProgress?: ModelProgress,
  ) {}

  private load(): Promise<FeatureExtractor> {
    this.extractor ??= (async () => {
      const transformers = await loadTransformers<TransformersModule>();
      if (!transformers) {
        throw new CrawlmindError(
          'invalid_input',
          'Link suggestions need the embeddings add-on, which is not installed.',
          `Run \`crawlmind addon install\` (MCP clients: call install_embeddings). ${MANUAL_INSTALL_HINT}`,
        );
      }
      transformers.env.cacheDir = modelsDir();
      logger.info(`Loading embedding model ${this.model}`);
      const pipe = await transformers.pipeline('feature-extraction', this.model, {
        dtype: 'q8',
        progress_callback: (event: { status: string; file?: string; progress?: number }) =>
          this.onProgress?.(event),
      });
      return pipe as unknown as FeatureExtractor;
    })();
    // A failed load (e.g. no network for the first download) may be retried later.
    this.extractor.catch(() => {
      this.extractor = null;
    });
    return this.extractor;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.load();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      // e5 models expect a "passage: " prefix; using it on both sides keeps similarity symmetric.
      const batch = texts
        .slice(i, i + BATCH_SIZE)
        .map((t) => `passage: ${t.slice(0, MAX_INPUT_CHARS)}`);
      const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
      const dim = tensor.dims.at(-1) as number;
      for (let j = 0; j < batch.length; j++) out.push(tensor.data.slice(j * dim, (j + 1) * dim));
    }
    return out;
  }
}
