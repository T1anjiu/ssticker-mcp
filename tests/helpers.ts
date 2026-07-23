import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";
import type { SStickerRuntime } from "../src/runtime.js";
import { createRuntime } from "../src/runtime.js";
import type { CatalogManifestItem } from "../src/domain/types.js";

export interface TestRuntime {
  runtime: SStickerRuntime;
  directory: string;
  cleanup(): Promise<void>;
}

export async function createTestRuntime(): Promise<TestRuntime> {
  const directory = await mkdtemp(resolve(tmpdir(), "ssticker-test-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SSTICKER_DATA_DIR: directory,
    SSTICKER_EMBEDDING_PROVIDER: "hash",
    SSTICKER_SIGNING_SECRET: "test-signing-secret-with-more-than-thirty-two-bytes",
    SSTICKER_SESSION_SECRET: "test-session-secret-with-more-than-thirty-two-bytes",
    SSTICKER_PUBLIC_BASE_URL: "http://127.0.0.1:3377",
    SSTICKER_ALLOWED_ORIGINS: "http://127.0.0.1:3377",
    SSTICKER_AUTH_MODE: "none",
    SSTICKER_LOG_LEVEL: "silent"
  };
  const runtime = createRuntime({ env, cwd: process.cwd() });
  return {
    runtime,
    directory,
    async cleanup() {
      runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

export async function importActiveSticker(test: TestRuntime, overrides: Partial<CatalogManifestItem> = {}) {
  const sourceDirectory = resolve(test.directory, "fixtures");
  await mkdir(sourceDirectory, { recursive: true });
  const file = resolve(sourceDirectory, `${overrides.external_id ?? "happy-cat"}.png`);
  await sharp({ create: { width: 96, height: 96, channels: 4, background: { r: 150, g: 174, b: 55, alpha: 1 } } })
    .png()
    .toFile(file);
  const item: CatalogManifestItem = {
    external_id: "happy-cat",
    file: file.split(/[\\/]/).pop()!,
    title: "开心小猫",
    alt_text: { "zh-CN": "开心挥手的小猫", en: "A happy waving cat" },
    scenes: [{ id: "joy", weight: 1 }, { id: "laughter", weight: 0.9 }],
    tags: ["开心", "happy", "cat"],
    tone: ["cute", "wholesome"],
    intensity: 0.65,
    audience: "any",
    safety: "safe",
    license: "CC0-1.0",
    source: "test fixture",
    attribution: "ssticker tests",
    pack: "test",
    ...overrides
  };
  const result = await test.runtime.catalog.importManifest({ manifest_version: 1, items: [item] }, sourceDirectory);
  const stickerId = result.items[0]?.sticker_id;
  if (!stickerId) {
    throw new Error(`Fixture import failed: ${JSON.stringify(result)}`);
  }
  test.runtime.catalog.reviewSticker(stickerId, true, "test");
  return test.runtime.database.getSticker(stickerId)!;
}
