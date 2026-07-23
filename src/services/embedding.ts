import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { AppConfig } from "../config.js";
import { normalizeVector, tokenize } from "../utils.js";

export interface EmbeddingResult {
  vector: Float32Array;
  model: string;
  degraded: boolean;
}

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: readonly string[]): Promise<EmbeddingResult[]>;
}

export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;
  readonly model = "ssticker-hash-embedding-v1";

  async embed(text: string): Promise<EmbeddingResult> {
    const vector = new Float32Array(this.dimensions);
    const tokens = tokenize(text);
    for (const token of tokens) {
      const digest = createHash("sha256").update(token).digest();
      for (let offset = 0; offset < digest.length; offset += 4) {
        const index = digest.readUInt16BE(offset) % this.dimensions;
        const sign = (digest[offset + 2] ?? 0) % 2 === 0 ? 1 : -1;
        const weight = 0.5 + (digest[offset + 3] ?? 0) / 255;
        vector[index] = (vector[index] ?? 0) + sign * weight;
      }
    }
    return { vector: normalizeVector(vector), model: this.model, degraded: true };
  }

  async embedBatch(texts: readonly string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    for (const text of texts) results.push(await this.embed(text));
    return results;
  }
}

export class LocalE5EmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;
  private extractor: ((text: string, options: Record<string, unknown>) => Promise<unknown>) | null = null;
  private initialization: Promise<void> | null = null;

  constructor(
    private readonly modelId: string,
    private readonly cacheDir: string,
    private readonly allowRemoteModels: boolean
  ) {}

  async embed(text: string): Promise<EmbeddingResult> {
    await this.ensureInitialized();
    if (!this.extractor) {
      throw new Error(`Embedding model is unavailable: ${this.modelId}`);
    }
    const output = await this.extractor(`query: ${text}`, { pooling: "mean", normalize: true });
    const values = tensorToVector(output);
    if (values.length !== this.dimensions) {
      throw new Error(`Embedding model returned ${values.length} dimensions; expected ${this.dimensions}`);
    }
    return { vector: normalizeVector(values), model: this.modelId, degraded: false };
  }

  async embedBatch(texts: readonly string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    for (const text of texts) results.push(await this.embed(text));
    return results;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.extractor) {
      return;
    }
    if (!this.initialization) {
      this.initialization = this.initialize();
    }
    await this.initialization;
  }

  private async initialize(): Promise<void> {
    const transformers = await import("@huggingface/transformers");
    transformers.env.cacheDir = this.cacheDir;
    transformers.env.allowRemoteModels = this.allowRemoteModels;
    if (!this.allowRemoteModels && !existsSync(this.cacheDir)) {
      throw new Error(`Model cache does not exist: ${this.cacheDir}`);
    }
    const pipeline = await transformers.pipeline("feature-extraction", this.modelId, { dtype: "q8" });
    this.extractor = pipeline as unknown as (text: string, options: Record<string, unknown>) => Promise<unknown>;
  }
}

export class ResilientEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;
  constructor(
    private readonly primary: EmbeddingProvider,
    private readonly fallback: EmbeddingProvider = new HashEmbeddingProvider()
  ) {}

  async embed(text: string): Promise<EmbeddingResult> {
    try {
      return await this.primary.embed(text);
    } catch {
      return this.fallback.embed(text);
    }
  }

  async embedBatch(texts: readonly string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    for (const text of texts) results.push(await this.embed(text));
    return results;
  }
}

export function createEmbeddingProvider(config: AppConfig): EmbeddingProvider {
  if (config.embeddingProvider === "hash") {
    return new HashEmbeddingProvider();
  }
  return new ResilientEmbeddingProvider(new LocalE5EmbeddingProvider(config.modelId, config.modelCacheDir, false));
}

export async function pullEmbeddingModel(config: AppConfig): Promise<void> {
  const provider = new LocalE5EmbeddingProvider(config.modelId, config.modelCacheDir, true);
  await provider.embed("query: ssticker model readiness check");
}

function tensorToVector(output: unknown): Float32Array {
  if (typeof output === "object" && output !== null && "tolist" in output && typeof (output as { tolist?: unknown }).tolist === "function") {
    const nested = (output as { tolist(): unknown }).tolist();
    const flattened = flattenNumbers(nested);
    return Float32Array.from(flattened.slice(0, 384));
  }
  if (typeof output === "object" && output !== null && "data" in output) {
    const data = (output as { data: unknown }).data;
    if (ArrayBuffer.isView(data)) {
      return Float32Array.from(Array.from(data as unknown as ArrayLike<number>).slice(0, 384));
    }
  }
  throw new Error("Embedding output did not contain a readable tensor");
}

function flattenNumbers(value: unknown): number[] {
  if (typeof value === "number") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenNumbers);
  }
  return [];
}
