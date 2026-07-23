import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRuntime } from '../src/runtime.js';
import { newId, sha256 } from '../src/utils.js';
import { generateDemoCatalog } from './fixtures.js';

const root = process.cwd();
const stateDirectory = resolve(root, '.tmp-benchmark');
const targetSize = integerEnv('SSTICKER_BENCHMARK_CATALOG_SIZE', 50000, 27, 50000);
const iterations = integerEnv('SSTICKER_BENCHMARK_ITERATIONS', 300, 20, 100000);
await rm(stateDirectory, { recursive: true, force: true });
const demo = await generateDemoCatalog(root);
const runtime = createRuntime({
  cwd: root,
  env: {
    ...process.env,
    SSTICKER_DATA_DIR: stateDirectory,
    SSTICKER_EMBEDDING_PROVIDER: 'hash',
    SSTICKER_SIGNING_SECRET: 'benchmark-signing-secret-with-at-least-thirty-two-bytes',
    SSTICKER_SESSION_SECRET: 'benchmark-session-secret-with-at-least-thirty-two-bytes',
    SSTICKER_PUBLIC_BASE_URL: 'http://127.0.0.1:3377',
    SSTICKER_AUTH_MODE: 'none',
    SSTICKER_LOG_LEVEL: 'silent'
  }
});

try {
  const imported = await runtime.catalog.importPath(demo.manifestPath);
  for (const item of imported.items) {
    if (item.sticker_id) runtime.catalog.reviewSticker(item.sticker_id, true, 'benchmark');
  }
  const templates = runtime.database.listActiveStickers();
  if (templates.length === 0) throw new Error('Demo catalog did not import active stickers');
  const templateScenes = new Map();
  const templateTags = new Map();
  for (const template of templates) {
    const scene = runtime.database.getStickerScenes(template.id)[0];
    if (scene) templateScenes.set(template.id, scene);
    templateTags.set(template.id, runtime.database.getStickerTags(template.id));
  }
  const templateVariant = runtime.database.getStickerVariants(templates[0].id)[0];
  if (!templateVariant) throw new Error('Demo catalog is missing a base variant');


  type SeedRow = {
    id: string;
    document: string;
    title: string;
    altText: Record<string, string>;
    tones: string[];
    pack: string;
    sha256: string;
    intensity: number;
    perceptualHash: string | null;
    originalStorageKey: string;
    scene: { id: string; weight: number };
    tags: string[];
  };
  const seedRows: SeedRow[] = [];
  for (let index = templates.length; index < targetSize; index += 1) {
    const template = templates[index % templates.length];
    const scene = templateScenes.get(template.id);
    const tags = templateTags.get(template.id);
    const id = newId();
    const title = template.title + ' ' + String(index).padStart(5, '0');
    const document = title + ' ' + Object.values(template.alt_text).join(' ') + ' ' + tags.join(' ') + ' ' + scene.id + ' ' + template.tones.join(' ');
    seedRows.push({
      id: id,
      document: document,
      title: title,
      altText: template.alt_text,
      tones: template.tones,
      pack: 'benchmark-' + (index % 20),
      sha256: sha256('benchmark-source-' + index),
      intensity: template.intensity,
      perceptualHash: template.perceptual_hash,
      originalStorageKey: template.original_storage_key,
      scene: scene,
      tags: tags
    });
  }
  const seedStarted = performance.now();
  const vectors = await runtime.embedding.embedBatch(seedRows.map(function(row){ return row.document; }));
  const variantCreatedAt = new Date().toISOString();
  for (let index = 0; index < seedRows.length; index += 1) {
    const seed = seedRows[index];
    const stickerRecord = runtime.database.createSticker({
      workspace_id: 'default',
      external_id: 'benchmark-' + String(index).padStart(5, '0'),
      title: seed.title,
      alt_text: seed.altText,
      status: 'active',
      safety: 'safe',
      license: 'CC0-1.0',
      source: 'synthetic benchmark row',
      attribution: 'ssticker benchmark',
      pack: seed.pack,
      audience: 'any',
      intensity: seed.intensity,
      tones: seed.tones,
      sha256: seed.sha256,
      perceptual_hash: seed.perceptualHash,
      original_storage_key: seed.originalStorageKey,
      scenes: [seed.scene],
      tags: seed.tags
    }, seed.id);
    const stickerId = stickerRecord.id;
    runtime.database.addVariant({
      id: newId(),
      sticker_id: stickerId,
      name: 'benchmark-compatible',
      mime_type: templateVariant.mime_type,
      delivery_kind: templateVariant.delivery_kind,
      width: templateVariant.width,
      height: templateVariant.height,
      duration_ms: templateVariant.duration_ms,
      bytes: templateVariant.bytes,
      sha256: templateVariant.sha256,
      storage_key: templateVariant.storage_key,
      platforms: templateVariant.platforms,
      created_at: variantCreatedAt
    });
    runtime.database.upsertEmbedding(stickerId, vectors[index].model, String(seed.document.length), vectors[index].vector);
  }
  const seedMs = performance.now() - seedStarted;

  const queries = [
    ['zh-CN', C(21704, 21704, 22826, 22909, 31505, 20102)],
    ['zh-CN', C(35874, 35874, 20320, 24110, 20102, 22823, 24537)],
    ['en', 'I am so excited'],
    ['zh-CN', C(36825, 20063, 22826, 31163, 35856, 20102)],
    ['en', 'good night and sleep well'],
    ['zh-CN', C(25105, 30495, 30340, 24456, 32047)],
    ['en', 'you can do it'],
    ['zh-CN', C(23436, 20840, 19981, 26126, 30333, 20026, 20160, 20040)]
  ];
  for (let index = 0; index < queries.length; index += 1) await recommend(index, queries[index][0], queries[index][1]);

  const durations = [];
  let errors = 0;
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const requestStartedAt = performance.now();
    const pick = queries[index % queries.length];
    try {
      await recommend(index + queries.length, pick[0], pick[1]);
    } catch {
      errors += 1;
    }
    durations.push(performance.now() - requestStartedAt);
  }
  const elapsedMs = performance.now() - startedAt;
  durations.sort(function(a, b){ return a - b; });
  const report = {
    catalog_size: runtime.database.countActiveStickers(),
    vector_enabled: runtime.database.vectorEnabled,
    iterations: iterations,
    seed_ms: Math.round(seedMs),
    errors: errors,
    error_rate: round(errors / iterations),
    throughput_qps: round(iterations / (elapsedMs / 1000)),
    latency_ms: {
      p50: round(percentile(durations, 0.5)),
      p95: round(percentile(durations, 0.95)),
      p99: round(percentile(durations, 0.99)),
      max: round(durations[durations.length - 1])
    },
    targets: {
      p95_lte_250ms: percentile(durations, 0.95) <= 250,
      p99_lte_500ms: percentile(durations, 0.99) <= 500,
      error_rate_lt_0_1_percent: errors / iterations < 0.001
    }
  };
  process.stdout.write(JSON.stringify(report, null, 2) + String.fromCharCode(10));
  if (Object.values(report.targets).some(function(p){ return !p; })) process.exitCode = 2;

  async function recommend(index, locale, text) {
    return runtime.decisions.recommend({
      request_id: 'benchmark-' + index + '-' + newId(),
      session_id: 'benchmark-session-' + index,
      mode: 'auto',
      channel: { platform: 'generic', profile: 'generic', conversation_type: index % 4 === 0 ? 'group' : 'direct' },
      locale: locale,
      messages: [{ role: 'user', text: text }],
      context: { turn_index: 100 }
    });
  }
} finally {
  runtime.close();
  await rm(stateDirectory, { recursive: true, force: true });
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] || 0;
}

function integerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(name + ' invalid');
  return value;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function C(...codes) { return String.fromCharCode(...codes); }


