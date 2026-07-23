import BetterSqlite3 from "better-sqlite3";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { SStickerDatabase } from "../src/db/database.js";
import type { CatalogManifestItem } from "../src/domain/types.js";
import { loadProfiles } from "../src/profiles.js";
import { createTestRuntime, importActiveSticker } from "./helpers.js";

describe("database lifecycle", () => {
  it("preserves an operator policy when bundled defaults are loaded again", async () => {
    const test = await createTestRuntime();
    try {
      const current = test.runtime.database.getPolicyProfile("default");
      test.runtime.database.updatePolicyProfile({ ...current, version: 2, auto_threshold: 0.84 }, "test");
      const profiles = loadProfiles(process.cwd());
      test.runtime.database.initialize(profiles.channels, profiles.policies);
      expect(test.runtime.database.getPolicyProfile("default")).toMatchObject({ version: 2, auto_threshold: 0.84 });
    } finally {
      await test.cleanup();
    }
  });

  it("builds an inactive search index and flips generations atomically", async () => {
    const test = await createTestRuntime();
    try {
      const sticker = await importActiveSticker(test);
      const before = test.runtime.database.searchIndexStatus();
      const rebuilt = await test.runtime.catalog.rebuildIndex();
      const after = test.runtime.database.searchIndexStatus();
      expect(after.active_slot).not.toBe(before.active_slot);
      expect(after.generation).toBe(before.generation + 1);
      expect(rebuilt).toMatchObject({ indexed: 1, generation: after.generation });
      expect(test.runtime.database.searchStickerIdsByText("happy").map((item) => item.id)).toContain(sticker.id);
    } finally {
      await test.cleanup();
    }
  });

  it("refuses a database created by a newer application schema", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "ssticker-newer-schema-"));
    const databasePath = resolve(directory, "ssticker.sqlite");
    try {
      const sqlite = new BetterSqlite3(databasePath);
      sqlite.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
      sqlite.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (99, 'future', ?)").run(new Date().toISOString());
      sqlite.close();
      expect(() => new SStickerDatabase(databasePath)).toThrow(/newer than this ssticker build supports/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports perceptually similar media without silently discarding it", async () => {
    const test = await createTestRuntime();
    try {
      await importActiveSticker(test);
      const sourceDirectory = resolve(test.directory, "near-duplicate");
      await mkdir(sourceDirectory, { recursive: true });
      const file = resolve(sourceDirectory, "similar.png");
      await sharp({ create: { width: 96, height: 96, channels: 4, background: { r: 150, g: 174, b: 55, alpha: 1 } } })
        .png({ compressionLevel: 1 })
        .toFile(file);
      const item: CatalogManifestItem = {
        external_id: "happy-cat-similar",
        file: "similar.png",
        title: "相似的开心小猫",
        alt_text: { "zh-CN": "视觉相似的开心小猫", en: "A visually similar happy cat" },
        scenes: [{ id: "joy", weight: 1 }],
        tags: ["开心", "cat"],
        tone: ["cute"],
        intensity: 0.6,
        audience: "any",
        safety: "safe",
        license: "CC0-1.0",
        source: "test fixture",
        attribution: "ssticker tests",
        pack: "test"
      };
      const result = await test.runtime.catalog.importManifest({ manifest_version: 1, items: [item] }, sourceDirectory);
      expect(result.items[0]).toMatchObject({ status: "imported" });
      expect(result.items[0]?.message).toMatch(/Visually similar/);
    } finally {
      await test.cleanup();
    }
  });
});
