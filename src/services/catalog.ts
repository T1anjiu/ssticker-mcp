import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import type { SStickerDatabase } from "../db/database.js";
import { CatalogManifestSchema, ManifestItemSchema } from "../domain/schemas.js";
import type { CatalogManifest, CatalogManifestItem, StickerRecord } from "../domain/types.js";
import { newId, sha256 } from "../utils.js";
import type { EmbeddingProvider } from "./embedding.js";
import { MediaService } from "./media.js";

export interface ImportItemResult {
  external_id: string;
  status: "imported" | "duplicate" | "validated" | "failed";
  sticker_id?: string;
  message?: string;
}

export interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  failed: number;
  items: ImportItemResult[];
}

export interface CatalogValidationIssue {
  sticker_id: string;
  severity: "error" | "warning";
  code: string;
  message: string;
}

export class CatalogService {
  constructor(
    private readonly database: SStickerDatabase,
    private readonly media: MediaService,
    private readonly embedding: EmbeddingProvider
  ) {}

  async importPath(path: string, dryRun = false): Promise<ImportResult> {
    const absolute = resolve(path);
    if (!existsSync(absolute)) {
      throw new Error(`Import path does not exist: ${absolute}`);
    }
    const extension = extname(absolute).toLowerCase();
    if ([".yaml", ".yml", ".json", ".jsonl"].includes(extension)) {
      const manifest = await this.readManifest(absolute);
      return this.importManifest(manifest, dirname(absolute), dryRun);
    }
    const files = await collectSupportedImages(absolute);
    const items: CatalogManifestItem[] = files.map((file) => {
      const title = basename(file, extname(file));
      return {
        external_id: slugify(relative(absolute, file)),
        file: relative(absolute, file),
        title,
        alt_text: { "zh-CN": title, en: title },
        scenes: [],
        tags: [],
        tone: [],
        intensity: 0.5,
        audience: "any",
        safety: "safe",
        license: "",
        source: "",
        attribution: "",
        pack: "default"
      };
    });
    if (items.length === 0) {
      throw new Error(`No supported images found in ${absolute}`);
    }
    return this.importManifest({ manifest_version: 1, items }, absolute, dryRun);
  }

  async importManifest(manifest: CatalogManifest, baseDirectory: string, dryRun = false): Promise<ImportResult> {
    const parsed = CatalogManifestSchema.parse(manifest);
    const results: ImportItemResult[] = [];
    for (const item of parsed.items) {
      try {
        const result = await this.importItem(item, baseDirectory, dryRun);
        results.push(result);
      } catch (error) {
        results.push({
          external_id: item.external_id,
          status: "failed",
          message: error instanceof Error ? error.message : "Unknown import error"
        });
      }
    }
    return summarize(results);
  }

  async importItem(rawItem: CatalogManifestItem, baseDirectory: string, dryRun = false): Promise<ImportItemResult> {
    const item = ManifestItemSchema.parse(rawItem);
    const filePath = resolveWithin(baseDirectory, item.file);
    const inspected = await this.media.inspect(filePath);
    const duplicate = this.database.findStickerBySha256(inspected.sha256);
    if (duplicate) {
      return { external_id: item.external_id, status: "duplicate", sticker_id: duplicate.id, message: `Matches ${duplicate.external_id}` };
    }
    const nearDuplicate = this.database.findNearDuplicateByPerceptualHash(inspected.perceptualHash);
    const externalDuplicate = this.database.findStickerByExternalId(item.external_id);
    if (externalDuplicate) {
      throw new Error(`external_id already exists: ${item.external_id}`);
    }
    if (dryRun) {
      return {
        external_id: item.external_id,
        status: "validated",
        message: nearDuplicate ? `Visually similar to ${nearDuplicate.sticker.external_id} (perceptual distance ${nearDuplicate.distance})` : undefined
      };
    }

    const stickerId = newId();
    const processed = await this.media.process(filePath, stickerId, inspected);
    const completeMetadata = Boolean(item.license.trim() && item.alt_text["zh-CN"]?.trim() && item.alt_text.en?.trim());
    try {
      const sticker = this.database.createSticker({
        workspace_id: "default",
        external_id: item.external_id,
        title: item.title,
        alt_text: item.alt_text,
        status: completeMetadata ? "reviewed" : "draft",
        safety: item.safety,
        license: item.license,
        source: item.source,
        attribution: item.attribution,
        pack: item.pack ?? "default",
        audience: item.audience,
        intensity: item.intensity,
        tones: item.tone,
        sha256: inspected.sha256,
        perceptual_hash: inspected.perceptualHash,
        original_storage_key: processed.originalStorageKey,
        scenes: item.scenes,
        tags: item.tags
      }, stickerId);
      for (const variant of processed.variants) {
        this.database.addVariant(variant);
      }
      await this.indexSticker(sticker, item);
      return {
        external_id: item.external_id,
        status: "imported",
        sticker_id: sticker.id,
        message: nearDuplicate ? `Visually similar to ${nearDuplicate.sticker.external_id} (perceptual distance ${nearDuplicate.distance}); manual review required` : undefined
      };
    } catch (error) {
      await this.media.cleanup(stickerId);
      if (this.database.getSticker(stickerId)) {
        this.database.deleteSticker(stickerId);
      }
      throw error;
    }
  }

  reviewSticker(id: string, approved: boolean, actor: string): StickerRecord {
    const sticker = this.database.getSticker(id);
    if (!sticker) {
      throw new Error(`Sticker not found: ${id}`);
    }
    if (approved) {
      const issues = this.validateSticker(sticker);
      const errors = issues.filter((issue) => issue.severity === "error");
      if (errors.length > 0) {
        throw new Error(errors.map((issue) => issue.message).join("; "));
      }
    }
    return this.database.updateSticker(id, { status: approved ? "active" : "blocked" }, {}, actor);
  }

  setStickerStatuses(ids: string[], status: "active" | "disabled", actor: string): Array<{ sticker_id: string; status: "updated" | "failed"; message?: string }> {
    return [...new Set(ids)].map((id) => {
      try {
        if (status === "active") {
          this.reviewSticker(id, true, actor);
        } else {
          const sticker = this.database.getSticker(id);
          if (!sticker) {
            throw new Error(`Sticker not found: ${id}`);
          }
          this.database.updateSticker(id, { status: "disabled" }, {}, actor);
        }
        return { sticker_id: id, status: "updated" as const };
      } catch (error) {
        return { sticker_id: id, status: "failed" as const, message: error instanceof Error ? error.message : "Unknown status update error" };
      }
    });
  }

  validateCatalog(): CatalogValidationIssue[] {
    const { items } = this.database.listStickers({ limit: 200, offset: 0 });
    const issues: CatalogValidationIssue[] = [];
    let offset = 0;
    let batch = items;
    while (batch.length > 0) {
      for (const sticker of batch) {
        issues.push(...this.validateSticker(sticker));
      }
      offset += batch.length;
      batch = this.database.listStickers({ limit: 200, offset }).items;
    }
    return issues;
  }

  async rebuildIndex(): Promise<{ indexed: number; degraded: number; generation: number }> {
    const stickers = this.database.listActiveStickers();
    const build = this.database.beginSearchIndexBuild();
    let degraded = 0;
    try {
      for (const sticker of stickers) {
        const scenes = this.database.getStickerScenes(sticker.id);
        const tags = this.database.getStickerTags(sticker.id);
        const indexed = await this.buildIndexEntry(sticker, { scenes, tags });
        this.database.stageSearchIndexEntry(build.slot, indexed.entry);
        if (indexed.degraded) {
          degraded += 1;
        }
      }
      this.database.commitSearchIndexBuild(build.slot, build.generation);
      return { indexed: stickers.length, degraded, generation: build.generation };
    } catch (error) {
      this.database.abortSearchIndexBuild(build.slot);
      throw error;
    }
  }

  async reindexSticker(stickerId: string): Promise<{ degraded: boolean }> {
    const sticker = this.database.getSticker(stickerId);
    if (!sticker) {
      throw new Error(`Sticker not found: ${stickerId}`);
    }
    return this.indexSticker(sticker, {
      scenes: this.database.getStickerScenes(sticker.id),
      tags: this.database.getStickerTags(sticker.id)
    });
  }

  async exportManifest(path: string): Promise<void> {
    const all: CatalogManifestItem[] = [];
    let offset = 0;
    while (true) {
      const page = this.database.listStickers({ limit: 200, offset });
      for (const sticker of page.items) {
        all.push({
          external_id: sticker.external_id,
          file: sticker.original_storage_key,
          title: sticker.title,
          alt_text: sticker.alt_text,
          scenes: this.database.getStickerScenes(sticker.id),
          tags: this.database.getStickerTags(sticker.id),
          tone: sticker.tones,
          intensity: sticker.intensity,
          audience: sticker.audience,
          safety: sticker.safety,
          license: sticker.license,
          source: sticker.source,
          attribution: sticker.attribution,
          pack: sticker.pack
        });
      }
      offset += page.items.length;
      if (offset >= page.total) {
        break;
      }
    }
    await mkdir(dirname(resolve(path)), { recursive: true });
    await writeFile(path, YAML.stringify({ manifest_version: 1, items: all }), "utf8");
  }

  private async indexSticker(sticker: StickerRecord, item: Pick<CatalogManifestItem, "scenes" | "tags">): Promise<{ degraded: boolean }> {
    const indexed = await this.buildIndexEntry(sticker, item);
    this.database.upsertEmbedding(sticker.id, indexed.entry.model, indexed.entry.contentHash, indexed.entry.vector);
    return { degraded: indexed.degraded };
  }

  private async buildIndexEntry(sticker: StickerRecord, item: Pick<CatalogManifestItem, "scenes" | "tags">) {
    const document = [
      sticker.title,
      ...Object.values(sticker.alt_text),
      ...item.tags,
      ...item.scenes.map((scene) => scene.id),
      ...sticker.tones
    ].join(" \n");
    const embedded = await this.embedding.embed(`passage: ${document}`);
    return {
      degraded: embedded.degraded,
      entry: {
        stickerId: sticker.id,
        title: sticker.title,
        altText: Object.values(sticker.alt_text).join(" "),
        tags: item.tags.join(" "),
        scenes: item.scenes.map((scene) => scene.id).join(" "),
        tones: sticker.tones.join(" "),
        model: embedded.model,
        contentHash: sha256(document),
        vector: embedded.vector
      }
    };
  }

  private validateSticker(sticker: StickerRecord): CatalogValidationIssue[] {
    const issues: CatalogValidationIssue[] = [];
    if (!sticker.license.trim()) {
      issues.push(issue(sticker.id, "error", "license_missing", "License is required before activation"));
    }
    if (!sticker.alt_text["zh-CN"]?.trim() || !sticker.alt_text.en?.trim()) {
      issues.push(issue(sticker.id, "error", "alt_text_missing", "Both zh-CN and en alternative text are required"));
    }
    if (sticker.safety !== "safe") {
      issues.push(issue(sticker.id, "error", "safety_not_safe", "Only safety=safe stickers can be activated"));
    }
    if (this.database.getStickerVariants(sticker.id).length === 0) {
      issues.push(issue(sticker.id, "error", "variant_missing", "At least one processed variant is required"));
    }
    if (this.database.getStickerScenes(sticker.id).length === 0) {
      issues.push(issue(sticker.id, "warning", "scene_missing", "Sticker has no scene assignments"));
    }
    return issues;
  }

  private async readManifest(path: string): Promise<CatalogManifest> {
    const content = await readFile(path, "utf8");
    if (extname(path).toLowerCase() === ".jsonl") {
      const items = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as CatalogManifestItem);
      return CatalogManifestSchema.parse({ manifest_version: 1, items });
    }
    return CatalogManifestSchema.parse(YAML.parse(content));
  }
}

async function collectSupportedImages(root: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...await collectSupportedImages(path));
    } else if (entry.isFile() && [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extname(entry.name).toLowerCase())) {
      found.push(path);
    }
  }
  return found.sort();
}

function resolveWithin(baseDirectory: string, requested: string): string {
  if (requested.includes("\0")) {
    throw new Error("File path contains a null byte");
  }
  const base = resolve(baseDirectory);
  const target = resolve(base, requested);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error(`Manifest file escapes its base directory: ${requested}`);
  }
  return target;
}

function slugify(value: string): string {
  const slug = value.normalize("NFKC").replace(/\\/g, "/").replace(/\.[^.]+$/, "").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase();
  return slug.slice(0, 128) || newId();
}

function summarize(items: ImportItemResult[]): ImportResult {
  return {
    total: items.length,
    imported: items.filter((item) => item.status === "imported").length,
    duplicates: items.filter((item) => item.status === "duplicate").length,
    failed: items.filter((item) => item.status === "failed").length,
    items
  };
}

function issue(stickerId: string, severity: CatalogValidationIssue["severity"], code: string, message: string): CatalogValidationIssue {
  return { sticker_id: stickerId, severity, code, message };
}
