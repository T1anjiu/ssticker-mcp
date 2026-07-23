import BetterSqlite3, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { count, eq } from "drizzle-orm";
import * as sqliteVec from "sqlite-vec";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCENES } from "../domain/scenes.js";
import type {
  ChannelCapabilityProfile,
  Feedback,
  Outcome,
  Platform,
  PolicyProfile,
  ReasonCode,
  StickerDecision,
  StickerRecord,
  StickerStatus,
  VariantRecord
} from "../domain/types.js";
import { bufferToFloat32, escapeFtsQuery, float32ToBuffer, hammingDistanceHex64, newId, nowIso, safeJsonParse } from "../utils.js";
import { MIGRATIONS } from "./migrations.js";
import * as schema from "./schema.js";

export interface CreateStickerRecord extends Omit<StickerRecord, "id" | "created_at" | "updated_at"> {
  scenes: Array<{ id: string; weight: number }>;
  tags: string[];
}

export interface DecisionEventInput {
  decision: StickerDecision;
  requestId: string;
  sessionHash: string;
  channelProfile: string;
  turnIndex?: number;
  expiresAt: string;
}

export interface RecentSentRecord {
  decision_id: string;
  sticker_id: string;
  turn_index: number | null;
  sent_at: string;
  feedback: Feedback | null;
}

export interface JobRecord {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface DashboardStats {
  total_stickers: number;
  active_stickers: number;
  active_variants: number;
  pending_review: number;
  failed_jobs: number;
  decisions_24h: number;
  send_decisions_24h: number;
  sent_24h: number;
  failed_outcomes_24h: number;
  vector_enabled: boolean;
}

export interface ListStickerOptions {
  query?: string;
  status?: StickerStatus;
  limit?: number;
  offset?: number;
}

export type SearchIndexSlot = "a" | "b";

export interface SearchIndexStatus {
  active_slot: SearchIndexSlot;
  generation: number;
  updated_at: string;
}

export interface SearchIndexEntry {
  stickerId: string;
  title: string;
  altText: string;
  tags: string;
  scenes: string;
  tones: string;
  model: string;
  contentHash: string;
  vector: Float32Array;
}

export class SStickerDatabase {
  readonly sqlite: SqliteDatabase;
  readonly orm: BetterSQLite3Database<typeof schema>;
  readonly databasePath: string;
  vectorEnabled = false;
  private activeSearchSlot: SearchIndexSlot = "a";
  private searchGeneration = 1;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    mkdirSync(dirname(databasePath), { recursive: true });
    const databaseExisted = existsSync(databasePath);
    this.sqlite = new BetterSqlite3(databasePath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("busy_timeout = 5000");
    this.sqlite.pragma("synchronous = NORMAL");
    this.orm = drizzle(this.sqlite, { schema });
    this.migrate(databaseExisted);
    const searchIndex = this.searchIndexStatus();
    this.activeSearchSlot = searchIndex.active_slot;
    this.searchGeneration = searchIndex.generation;
    this.initializeVectorExtension();
  }

  initialize(channelProfiles: ChannelCapabilityProfile[], policyProfiles: PolicyProfile[]): void {
    const timestamp = nowIso();
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare("INSERT OR IGNORE INTO workspaces(id, name, created_at) VALUES ('default', 'Default workspace', ?)").run(timestamp);
      const sceneStatement = this.sqlite.prepare(`
        INSERT INTO scenes(id, label_zh, label_en, definition_json, enabled, updated_at)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(id) DO UPDATE SET
          label_zh=excluded.label_zh,
          label_en=excluded.label_en,
          definition_json=excluded.definition_json,
          updated_at=excluded.updated_at
      `);
      for (const scene of SCENES) {
        sceneStatement.run(scene.id, scene.label_zh, scene.label_en, JSON.stringify(scene), timestamp);
      }
      const policyStatement = this.sqlite.prepare(`
        INSERT INTO policy_profiles(id, version, profile_json, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET version=excluded.version, profile_json=excluded.profile_json, updated_at=excluded.updated_at
        WHERE excluded.version > policy_profiles.version
      `);
      for (const profile of policyProfiles) {
        policyStatement.run(profile.id, profile.version, JSON.stringify(profile), timestamp);
      }
      const channelStatement = this.sqlite.prepare(`
        INSERT INTO channel_profiles(id, platform, version, profile_json, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET platform=excluded.platform, version=excluded.version, profile_json=excluded.profile_json, updated_at=excluded.updated_at
        WHERE excluded.version > channel_profiles.version
      `);
      for (const profile of channelProfiles) {
        channelStatement.run(profile.id, profile.platform, profile.version, JSON.stringify(profile), timestamp);
      }
    });
    transaction();
  }

  close(): void {
    this.sqlite.close();
  }

  health(): { database: "ok"; migrations: number; vector: boolean; workspaces: number; index_generation: number } {
    const row = this.sqlite.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
    const workspaceCount = this.orm.select({ value: count() }).from(schema.workspaces).get()?.value ?? 0;
    return { database: "ok", migrations: row.version, vector: this.vectorEnabled, workspaces: workspaceCount, index_generation: this.searchGeneration };
  }

  searchIndexStatus(): SearchIndexStatus {
    const row = this.sqlite.prepare("SELECT active_slot, generation, updated_at FROM search_index_state WHERE id = 1").get() as SearchIndexStatus | undefined;
    if (!row || !["a", "b"].includes(row.active_slot)) {
      throw new Error("Search index state is missing or invalid");
    }
    return row;
  }

  listScenes(): typeof SCENES {
    const rows = this.orm.select().from(schema.scenes).where(eq(schema.scenes.enabled, true)).all();
    return rows.map((row) => safeJsonParse(row.definitionJson, SCENES.find((item) => item.id === row.id)!));
  }

  getPolicyProfile(id = "default"): PolicyProfile {
    const row = this.sqlite.prepare("SELECT profile_json FROM policy_profiles WHERE id = ?").get(id) as { profile_json: string } | undefined;
    if (!row) {
      throw new Error(`Unknown policy profile: ${id}`);
    }
    return JSON.parse(row.profile_json) as PolicyProfile;
  }

  updatePolicyProfile(profile: PolicyProfile, actor: string): void {
    const timestamp = nowIso();
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`
        INSERT INTO policy_profiles(id, version, profile_json, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET version=excluded.version, profile_json=excluded.profile_json, updated_at=excluded.updated_at
      `).run(profile.id, profile.version, JSON.stringify(profile), timestamp);
      this.insertAudit(actor, "policy.update", "policy", profile.id, profile);
    })();
  }

  getChannelProfile(id: string): ChannelCapabilityProfile {
    const row = this.sqlite.prepare("SELECT profile_json FROM channel_profiles WHERE id = ?").get(id) as { profile_json: string } | undefined;
    if (!row) {
      throw new Error(`Unknown channel profile: ${id}`);
    }
    return JSON.parse(row.profile_json) as ChannelCapabilityProfile;
  }

  listChannelProfiles(): ChannelCapabilityProfile[] {
    const rows = this.sqlite.prepare("SELECT profile_json FROM channel_profiles ORDER BY platform, id").all() as Array<{ profile_json: string }>;
    return rows.map((row) => JSON.parse(row.profile_json) as ChannelCapabilityProfile);
  }

  findStickerBySha256(sha: string, workspaceId = "default"): StickerRecord | null {
    const row = this.sqlite.prepare("SELECT * FROM stickers WHERE workspace_id = ? AND sha256 = ?").get(workspaceId, sha) as StickerRow | undefined;
    return row ? mapSticker(row) : null;
  }

  findStickerByExternalId(externalId: string, workspaceId = "default"): StickerRecord | null {
    const row = this.sqlite.prepare("SELECT * FROM stickers WHERE workspace_id = ? AND external_id = ?").get(workspaceId, externalId) as StickerRow | undefined;
    return row ? mapSticker(row) : null;
  }

  findNearDuplicateByPerceptualHash(perceptualHash: string, maxDistance = 4, workspaceId = "default"): { sticker: StickerRecord; distance: number } | null {
    const rows = this.sqlite.prepare("SELECT * FROM stickers WHERE workspace_id = ? AND perceptual_hash IS NOT NULL")
      .all(workspaceId) as StickerRow[];
    let closest: { sticker: StickerRecord; distance: number } | null = null;
    for (const row of rows) {
      const distance = hammingDistanceHex64(perceptualHash, row.perceptual_hash ?? "");
      if (distance <= maxDistance && (!closest || distance < closest.distance)) {
        closest = { sticker: mapSticker(row), distance };
      }
    }
    return closest;
  }

  getSticker(id: string): StickerRecord | null {
    const row = this.sqlite.prepare("SELECT * FROM stickers WHERE id = ?").get(id) as StickerRow | undefined;
    return row ? mapSticker(row) : null;
  }

  createSticker(input: CreateStickerRecord, id = newId()): StickerRecord {
    const timestamp = nowIso();
    const record: StickerRecord = { id, created_at: timestamp, updated_at: timestamp, ...input };
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`
        INSERT INTO stickers(
          id, workspace_id, external_id, title, alt_text_json, status, safety, license, source, attribution,
          pack, audience, intensity, tones_json, sha256, perceptual_hash, original_storage_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.workspace_id,
        record.external_id,
        record.title,
        JSON.stringify(record.alt_text),
        record.status,
        record.safety,
        record.license,
        record.source,
        record.attribution,
        record.pack,
        record.audience,
        record.intensity,
        JSON.stringify(record.tones),
        record.sha256,
        record.perceptual_hash,
        record.original_storage_key,
        record.created_at,
        record.updated_at
      );
      this.replaceAssociations(record.id, input.scenes, input.tags);
      this.refreshFts(record.id);
    })();
    return record;
  }

  updateSticker(
    id: string,
    changes: Partial<Pick<StickerRecord, "title" | "alt_text" | "status" | "safety" | "license" | "source" | "attribution" | "pack" | "audience" | "intensity" | "tones">>,
    associations: { scenes?: Array<{ id: string; weight: number }>; tags?: string[] } = {},
    actor = "system"
  ): StickerRecord {
    const existing = this.getSticker(id);
    if (!existing) {
      throw new Error(`Sticker not found: ${id}`);
    }
    const updated: StickerRecord = { ...existing, ...changes, updated_at: nowIso() };
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`
        UPDATE stickers SET title=?, alt_text_json=?, status=?, safety=?, license=?, source=?, attribution=?, pack=?, audience=?, intensity=?, tones_json=?, updated_at=?
        WHERE id=?
      `).run(
        updated.title,
        JSON.stringify(updated.alt_text),
        updated.status,
        updated.safety,
        updated.license,
        updated.source,
        updated.attribution,
        updated.pack,
        updated.audience,
        updated.intensity,
        JSON.stringify(updated.tones),
        updated.updated_at,
        id
      );
      if (associations.scenes || associations.tags) {
        this.replaceAssociations(
          id,
          associations.scenes ?? this.getStickerScenes(id).map((scene) => ({ id: scene.id, weight: scene.weight })),
          associations.tags ?? this.getStickerTags(id)
        );
      }
      this.refreshFts(id);
      this.insertAudit(actor, "sticker.update", "sticker", id, { changes, associations });
    })();
    return updated;
  }

  listStickers(options: ListStickerOptions = {}): { items: StickerRecord[]; total: number } {
    const limit = Math.min(options.limit ?? 50, 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (options.status) {
      conditions.push("status = ?");
      parameters.push(options.status);
    }
    if (options.query) {
      conditions.push("(title LIKE ? OR external_id LIKE ? OR alt_text_json LIKE ?)");
      const query = `%${options.query}%`;
      parameters.push(query, query, query);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countRow = this.sqlite.prepare(`SELECT COUNT(*) AS total FROM stickers ${where}`).get(...parameters) as { total: number };
    const rows = this.sqlite.prepare(`SELECT * FROM stickers ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...parameters, limit, offset) as StickerRow[];
    return { items: rows.map(mapSticker), total: countRow.total };
  }

  deleteSticker(id: string, actor = "system"): void {
    this.sqlite.transaction(() => {
      const row = this.sqlite.prepare("SELECT rowid FROM stickers WHERE id = ?").get(id) as { rowid: number } | undefined;
      this.sqlite.prepare("DELETE FROM sticker_fts WHERE sticker_id = ?").run(id);
      this.sqlite.prepare("DELETE FROM sticker_fts_next WHERE sticker_id = ?").run(id);
      if (row && this.vectorEnabled) {
        this.sqlite.prepare("DELETE FROM sticker_vectors WHERE rowid = ?").run(BigInt(row.rowid));
        this.sqlite.prepare("DELETE FROM sticker_vectors_next WHERE rowid = ?").run(BigInt(row.rowid));
      }
      this.sqlite.prepare("DELETE FROM search_embeddings WHERE sticker_id = ?").run(id);
      this.sqlite.prepare("DELETE FROM stickers WHERE id = ?").run(id);
      this.insertAudit(actor, "sticker.delete", "sticker", id, {});
    })();
  }

  addVariant(variant: VariantRecord): void {
    this.sqlite.prepare(`
      INSERT INTO variants(id, sticker_id, name, mime_type, delivery_kind, width, height, duration_ms, bytes, sha256, storage_key, platforms_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sticker_id, name) DO UPDATE SET
        id=excluded.id, mime_type=excluded.mime_type, delivery_kind=excluded.delivery_kind, width=excluded.width,
        height=excluded.height, duration_ms=excluded.duration_ms, bytes=excluded.bytes, sha256=excluded.sha256,
        storage_key=excluded.storage_key, platforms_json=excluded.platforms_json, created_at=excluded.created_at
    `).run(
      variant.id,
      variant.sticker_id,
      variant.name,
      variant.mime_type,
      variant.delivery_kind,
      variant.width,
      variant.height,
      variant.duration_ms,
      variant.bytes,
      variant.sha256,
      variant.storage_key,
      JSON.stringify(variant.platforms),
      variant.created_at
    );
  }

  getVariant(id: string): VariantRecord | null {
    const row = this.sqlite.prepare("SELECT * FROM variants WHERE id = ?").get(id) as VariantRow | undefined;
    return row ? mapVariant(row) : null;
  }

  getStickerVariants(stickerId: string): VariantRecord[] {
    const rows = this.sqlite.prepare("SELECT * FROM variants WHERE sticker_id = ? ORDER BY bytes ASC").all(stickerId) as VariantRow[];
    return rows.map(mapVariant);
  }

  getStickerScenes(stickerId: string): Array<{ id: string; weight: number }> {
    return this.sqlite.prepare("SELECT scene_id AS id, weight FROM sticker_scenes WHERE sticker_id = ? ORDER BY weight DESC").all(stickerId) as Array<{ id: string; weight: number }>;
  }

  getStickerTags(stickerId: string): string[] {
    const rows = this.sqlite.prepare(`
      SELECT tags.name FROM sticker_tags JOIN tags ON tags.id = sticker_tags.tag_id WHERE sticker_tags.sticker_id = ? ORDER BY tags.name
    `).all(stickerId) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  searchStickerIdsByText(query: string, limit = 50): Array<{ id: string; score: number }> {
    const ftsQuery = escapeFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }
    const table = this.ftsTable(this.activeSearchSlot);
    const rows = this.sqlite.prepare(`
      SELECT sticker_id AS id, bm25(${table}, 0, 5, 3, 2, 2, 1) AS rank
      FROM ${table}
      WHERE ${table} MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `).all(ftsQuery, limit) as Array<{ id: string; rank: number }>;
    if (rows.length === 0) {
      return [];
    }
    const worst = Math.max(...rows.map((row) => Math.abs(row.rank)), 1);
    return rows.map((row) => ({ id: row.id, score: Math.max(0, 1 - Math.abs(row.rank) / (worst + 1)) }));
  }

  findStickerIdsByScene(sceneId: string, limit = 50): Array<{ id: string; score: number }> {
    return this.sqlite.prepare(`
      SELECT ss.sticker_id AS id, ss.weight AS score
      FROM sticker_scenes ss
      JOIN stickers s ON s.id = ss.sticker_id
      WHERE ss.scene_id = ? AND s.status = 'active' AND s.safety = 'safe'
      ORDER BY ss.weight DESC, s.updated_at DESC
      LIMIT ?
    `).all(sceneId, limit) as Array<{ id: string; score: number }>;
  }

  countActiveStickers(): number {
    const row = this.sqlite.prepare("SELECT COUNT(*) AS count FROM stickers WHERE status = 'active' AND safety = 'safe'").get() as { count: number };
    return row.count;
  }

  listActiveStickers(limit?: number): StickerRecord[] {
    const rows = limit === undefined
      ? this.sqlite.prepare("SELECT * FROM stickers WHERE status = 'active' AND safety = 'safe' ORDER BY updated_at DESC").all() as StickerRow[]
      : this.sqlite.prepare("SELECT * FROM stickers WHERE status = 'active' AND safety = 'safe' ORDER BY updated_at DESC LIMIT ?").all(limit) as StickerRow[];
    return rows.map(mapSticker);
  }

  getActiveStickersByIds(ids: string[]): StickerRecord[] {
    const uniqueIds = [...new Set(ids)].slice(0, 100);
    if (uniqueIds.length === 0) {
      return [];
    }
    const placeholders = uniqueIds.map(() => "?").join(",");
    const rows = this.sqlite.prepare(`SELECT * FROM stickers WHERE status = 'active' AND safety = 'safe' AND id IN (${placeholders})`)
      .all(...uniqueIds) as StickerRow[];
    return rows.map(mapSticker);
  }

  upsertEmbedding(stickerId: string, model: string, contentHash: string, vector: Float32Array): void {
    const timestamp = nowIso();
    const buffer = float32ToBuffer(vector);
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`
        INSERT INTO embeddings(sticker_id, model, dimensions, content_hash, vector, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(sticker_id) DO UPDATE SET model=excluded.model, dimensions=excluded.dimensions,
          content_hash=excluded.content_hash, vector=excluded.vector, updated_at=excluded.updated_at
      `).run(stickerId, model, vector.length, contentHash, buffer, timestamp);
      this.sqlite.prepare(`
        INSERT INTO search_embeddings(sticker_id, slot, model, dimensions, content_hash, vector, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sticker_id, slot) DO UPDATE SET model=excluded.model, dimensions=excluded.dimensions,
          content_hash=excluded.content_hash, vector=excluded.vector, updated_at=excluded.updated_at
      `).run(stickerId, this.activeSearchSlot, model, vector.length, contentHash, buffer, timestamp);
      if (this.vectorEnabled && vector.length === 384) {
        const row = this.sqlite.prepare("SELECT rowid FROM stickers WHERE id = ?").get(stickerId) as { rowid: number } | undefined;
        if (row) {
          const vectorRowId = BigInt(row.rowid);
          const table = this.vectorTable(this.activeSearchSlot);
          this.sqlite.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(vectorRowId);
          this.sqlite.prepare(`INSERT INTO ${table}(rowid, embedding) VALUES (?, ?)`).run(vectorRowId, buffer);
        }
      }
    })();
  }

  getEmbedding(stickerId: string): Float32Array | null {
    const row = this.sqlite.prepare("SELECT vector FROM search_embeddings WHERE sticker_id = ? AND slot = ?")
      .get(stickerId, this.activeSearchSlot) as { vector: Buffer } | undefined;
    return row ? bufferToFloat32(row.vector) : null;
  }

  searchStickerIdsByVector(query: Float32Array, limit = 50): Array<{ id: string; score: number }> {
    if (!this.vectorEnabled || query.length !== 384) {
      return [];
    }
    try {
      const table = this.vectorTable(this.activeSearchSlot);
      const rows = this.sqlite.prepare(`
        SELECT stickers.id AS id, ${table}.distance AS distance
        FROM ${table}
        JOIN stickers ON stickers.rowid = ${table}.rowid
        WHERE ${table}.embedding MATCH ? AND k = ?
        ORDER BY ${table}.distance
      `).all(float32ToBuffer(query), limit) as Array<{ id: string; distance: number }>;
      return rows.map((row) => ({ id: row.id, score: Math.max(0, Math.min(1, 1 - row.distance * row.distance / 4)) }));
    } catch {
      return [];
    }
  }

  beginSearchIndexBuild(): { slot: SearchIndexSlot; generation: number } {
    const slot: SearchIndexSlot = this.activeSearchSlot === "a" ? "b" : "a";
    const ftsTable = this.ftsTable(slot);
    const vectorTable = this.vectorTable(slot);
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`DELETE FROM ${ftsTable}`).run();
      this.sqlite.prepare("DELETE FROM search_embeddings WHERE slot = ?").run(slot);
      if (this.vectorEnabled) {
        this.sqlite.prepare(`DELETE FROM ${vectorTable}`).run();
      }
    })();
    return { slot, generation: this.searchGeneration + 1 };
  }

  stageSearchIndexEntry(slot: SearchIndexSlot, entry: SearchIndexEntry): void {
    if (slot === this.activeSearchSlot) {
      throw new Error("Cannot stage a search index into the active slot");
    }
    const buffer = float32ToBuffer(entry.vector);
    const timestamp = nowIso();
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`INSERT INTO ${this.ftsTable(slot)}(sticker_id, title, alt_text, tags, scenes, tones) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(entry.stickerId, entry.title, entry.altText, entry.tags, entry.scenes, entry.tones);
      this.sqlite.prepare(`
        INSERT INTO search_embeddings(sticker_id, slot, model, dimensions, content_hash, vector, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(entry.stickerId, slot, entry.model, entry.vector.length, entry.contentHash, buffer, timestamp);
      if (this.vectorEnabled && entry.vector.length === 384) {
        const row = this.sqlite.prepare("SELECT rowid FROM stickers WHERE id = ?").get(entry.stickerId) as { rowid: number } | undefined;
        if (row) {
          this.sqlite.prepare(`INSERT INTO ${this.vectorTable(slot)}(rowid, embedding) VALUES (?, ?)`)
            .run(BigInt(row.rowid), buffer);
        }
      }
    })();
  }

  commitSearchIndexBuild(slot: SearchIndexSlot, generation: number): SearchIndexStatus {
    if (slot === this.activeSearchSlot || generation <= this.searchGeneration) {
      throw new Error("Search index build is stale or targets the active slot");
    }
    const updatedAt = nowIso();
    this.sqlite.prepare("UPDATE search_index_state SET active_slot = ?, generation = ?, updated_at = ? WHERE id = 1")
      .run(slot, generation, updatedAt);
    this.activeSearchSlot = slot;
    this.searchGeneration = generation;
    return { active_slot: slot, generation, updated_at: updatedAt };
  }

  abortSearchIndexBuild(slot: SearchIndexSlot): void {
    if (slot === this.activeSearchSlot) {
      return;
    }
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`DELETE FROM ${this.ftsTable(slot)}`).run();
      this.sqlite.prepare("DELETE FROM search_embeddings WHERE slot = ?").run(slot);
      if (this.vectorEnabled) {
        this.sqlite.prepare(`DELETE FROM ${this.vectorTable(slot)}`).run();
      }
    })();
  }

  saveDecision(input: DecisionEventInput): void {
    const { decision } = input;
    this.sqlite.prepare(`
      INSERT INTO decision_events(
        id, request_id, session_hash, action, scene_id, confidence, reason_codes_json, policy_json,
        sticker_id, variant_id, channel_profile, decision_json, turn_index, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision.decision_id,
      input.requestId,
      input.sessionHash,
      decision.action,
      decision.scene.id,
      decision.scene.confidence,
      JSON.stringify(decision.reason_codes),
      JSON.stringify(decision.policy),
      decision.asset?.sticker_id ?? null,
      decision.asset?.variant_id ?? null,
      input.channelProfile,
      JSON.stringify(decision),
      input.turnIndex ?? null,
      nowIso(),
      input.expiresAt
    );
  }

  getDecisionByRequestId(requestId: string): StickerDecision | null {
    const row = this.sqlite.prepare("SELECT decision_json FROM decision_events WHERE request_id = ? AND expires_at > ?")
      .get(requestId, nowIso()) as { decision_json: string } | undefined;
    return row ? JSON.parse(row.decision_json) as StickerDecision : null;
  }

  getDecision(id: string): { decision: StickerDecision; session_hash: string } | null {
    const row = this.sqlite.prepare("SELECT decision_json, session_hash FROM decision_events WHERE id = ? AND expires_at > ?")
      .get(id, nowIso()) as { decision_json: string; session_hash: string } | undefined;
    return row ? { decision: JSON.parse(row.decision_json) as StickerDecision, session_hash: row.session_hash } : null;
  }

  recordOutcome(input: { outcomeEventId: string; decisionId: string; outcome: Outcome; feedback?: Feedback; failureCode?: string }): { duplicate: boolean } {
    const existing = this.sqlite.prepare("SELECT 1 FROM outcomes WHERE outcome_event_id = ?").get(input.outcomeEventId);
    if (existing) {
      return { duplicate: true };
    }
    this.sqlite.prepare(`
      INSERT INTO outcomes(id, outcome_event_id, decision_id, outcome, feedback, failure_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(newId(), input.outcomeEventId, input.decisionId, input.outcome, input.feedback ?? null, input.failureCode ?? null, nowIso());
    return { duplicate: false };
  }

  recentSent(sessionHash: string, limit: number): RecentSentRecord[] {
    return this.sqlite.prepare(`
      SELECT d.id AS decision_id, d.sticker_id, d.turn_index, o.created_at AS sent_at, o.feedback
      FROM outcomes o
      JOIN decision_events d ON d.id = o.decision_id
      WHERE d.session_hash = ? AND o.outcome = 'sent' AND d.sticker_id IS NOT NULL
      ORDER BY o.created_at DESC
      LIMIT ?
    `).all(sessionHash, limit) as RecentSentRecord[];
  }

  cleanupExpiredEvents(timestamp = nowIso()): number {
    const result = this.sqlite.prepare("DELETE FROM decision_events WHERE expires_at < ?").run(timestamp);
    this.sqlite.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(timestamp);
    return result.changes;
  }

  recoverInterruptedJobs(): number {
    const result = this.sqlite.prepare("UPDATE jobs SET status = 'queued', error = 'Recovered after an interrupted worker', updated_at = ? WHERE status = 'running'")
      .run(nowIso());
    return result.changes;
  }

  createJob(type: string, payload: Record<string, unknown>): JobRecord {
    const timestamp = nowIso();
    const job: JobRecord = {
      id: newId(),
      type,
      status: "queued",
      payload,
      result: null,
      error: null,
      attempts: 0,
      created_at: timestamp,
      updated_at: timestamp
    };
    this.sqlite.prepare(`
      INSERT INTO jobs(id, type, status, payload_json, result_json, error, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, ?)
    `).run(job.id, job.type, job.status, JSON.stringify(payload), timestamp, timestamp);
    return job;
  }

  claimNextJob(): JobRecord | null {
    return this.sqlite.transaction(() => {
      const row = this.sqlite.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get() as JobRow | undefined;
      if (!row) {
        return null;
      }
      const timestamp = nowIso();
      const result = this.sqlite.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'").run(timestamp, row.id);
      if (result.changes === 0) {
        return null;
      }
      return mapJob({ ...row, status: "running", attempts: row.attempts + 1, updated_at: timestamp });
    })();
  }

  completeJob(id: string, result: Record<string, unknown>): void {
    this.sqlite.prepare("UPDATE jobs SET status = 'completed', result_json = ?, error = NULL, updated_at = ? WHERE id = ?").run(JSON.stringify(result), nowIso(), id);
  }

  failJob(id: string, error: string, retry: boolean): void {
    this.sqlite.prepare("UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?").run(retry ? "queued" : "failed", error.slice(0, 4000), nowIso(), id);
  }

  listJobs(limit = 100): JobRecord[] {
    const rows = this.sqlite.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(Math.min(limit, 500)) as JobRow[];
    return rows.map(mapJob);
  }

  dashboardStats(): DashboardStats {
    const row = this.sqlite.prepare(`
      SELECT
        (SELECT COUNT(*) FROM stickers) AS total_stickers,
        (SELECT COUNT(*) FROM stickers WHERE status = 'active') AS active_stickers,
        (SELECT COUNT(*) FROM variants v JOIN stickers s ON s.id = v.sticker_id WHERE s.status = 'active') AS active_variants,
        (SELECT COUNT(*) FROM stickers WHERE status IN ('draft','reviewed')) AS pending_review,
        (SELECT COUNT(*) FROM jobs WHERE status = 'failed') AS failed_jobs,
        (SELECT COUNT(*) FROM decision_events WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')) AS decisions_24h,
        (SELECT COUNT(*) FROM decision_events WHERE action = 'send' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')) AS send_decisions_24h,
        (SELECT COUNT(*) FROM outcomes WHERE outcome = 'sent' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')) AS sent_24h,
        (SELECT COUNT(*) FROM outcomes WHERE outcome IN ('failed','rejected') AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')) AS failed_outcomes_24h
    `).get() as Omit<DashboardStats, "vector_enabled">;
    return { ...row, vector_enabled: this.vectorEnabled };
  }

  listDecisions(limit = 100): Array<{
    id: string;
    action: "send" | "skip";
    scene_id: string;
    confidence: number;
    reason_codes: ReasonCode[];
    sticker_id: string | null;
    channel_profile: string;
    created_at: string;
    outcome: Outcome | null;
    feedback: Feedback | null;
  }> {
    const rows = this.sqlite.prepare(`
      SELECT d.id, d.action, d.scene_id, d.confidence, d.reason_codes_json, d.sticker_id, d.channel_profile, d.created_at,
        (SELECT outcome FROM outcomes WHERE decision_id = d.id ORDER BY created_at DESC LIMIT 1) AS outcome,
        (SELECT feedback FROM outcomes WHERE decision_id = d.id ORDER BY created_at DESC LIMIT 1) AS feedback
      FROM decision_events d ORDER BY d.created_at DESC LIMIT ?
    `).all(Math.min(limit, 500)) as Array<{
      id: string; action: "send" | "skip"; scene_id: string; confidence: number; reason_codes_json: string;
      sticker_id: string | null; channel_profile: string; created_at: string; outcome: Outcome | null; feedback: Feedback | null;
    }>;
    return rows.map(({ reason_codes_json, ...row }) => ({ ...row, reason_codes: JSON.parse(reason_codes_json) as ReasonCode[] }));
  }

  createAdminToken(name: string, hash: string, prefix: string): string {
    const id = newId();
    this.sqlite.prepare("INSERT INTO admin_tokens(id, name, hash, prefix, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)").run(id, name, hash, prefix, nowIso());
    return id;
  }

  listActiveAdminTokens(): Array<{ id: string; name: string; hash: string; prefix: string }> {
    return this.sqlite.prepare("SELECT id, name, hash, prefix FROM admin_tokens WHERE revoked_at IS NULL ORDER BY created_at").all() as Array<{ id: string; name: string; hash: string; prefix: string }>;
  }

  revokeAdminToken(id: string): boolean {
    const result = this.sqlite.prepare("UPDATE admin_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(nowIso(), id);
    this.sqlite.prepare("DELETE FROM admin_sessions WHERE token_id = ?").run(id);
    return result.changes > 0;
  }

  createAdminSession(tokenId: string, sessionHash: string, csrfHash: string, expiresAt: string): string {
    const id = newId();
    this.sqlite.prepare("INSERT INTO admin_sessions(id, token_id, session_hash, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, tokenId, sessionHash, csrfHash, expiresAt, nowIso());
    return id;
  }

  getAdminSession(sessionHash: string): { id: string; token_id: string; csrf_hash: string; expires_at: string } | null {
    const row = this.sqlite.prepare(`
      SELECT s.id, s.token_id, s.csrf_hash, s.expires_at
      FROM admin_sessions s JOIN admin_tokens t ON t.id = s.token_id
      WHERE s.session_hash = ? AND s.expires_at > ? AND t.revoked_at IS NULL
    `).get(sessionHash, nowIso()) as { id: string; token_id: string; csrf_hash: string; expires_at: string } | undefined;
    return row ?? null;
  }

  revokeAdminSession(sessionHash: string): void {
    this.sqlite.prepare("DELETE FROM admin_sessions WHERE session_hash = ?").run(sessionHash);
  }

  private migrate(databaseExisted: boolean): void {
    this.sqlite.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    const appliedVersions = (this.sqlite.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version);
    const latestSupported = Math.max(...MIGRATIONS.map((migration) => migration.version), 0);
    const latestApplied = Math.max(...appliedVersions, 0);
    if (latestApplied > latestSupported) {
      this.sqlite.close();
      throw new Error(`Database schema version ${latestApplied} is newer than this ssticker build supports (${latestSupported})`);
    }
    const applied = new Set(appliedVersions);
    const pending = MIGRATIONS.filter((migration) => !applied.has(migration.version));
    if (pending.length === 0) {
      return;
    }
    if (databaseExisted) {
      this.sqlite.pragma("wal_checkpoint(TRUNCATE)");
      copyFileSync(this.databasePath, `${this.databasePath}.backup-${Date.now()}`);
    }
    for (const migration of pending) {
      this.sqlite.transaction(() => {
        this.sqlite.exec(migration.sql);
        this.sqlite.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, nowIso());
      })();
    }
  }

  private initializeVectorExtension(): void {
    try {
      sqliteVec.load(this.sqlite);
      this.sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS sticker_vectors USING vec0(embedding float[384])");
      this.sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS sticker_vectors_next USING vec0(embedding float[384])");
      this.vectorEnabled = true;
    } catch {
      this.vectorEnabled = false;
    }
  }

  private replaceAssociations(stickerId: string, scenes: Array<{ id: string; weight: number }>, tags: string[]): void {
    this.sqlite.prepare("DELETE FROM sticker_scenes WHERE sticker_id = ?").run(stickerId);
    const sceneStatement = this.sqlite.prepare("INSERT INTO sticker_scenes(sticker_id, scene_id, weight) VALUES (?, ?, ?)");
    for (const scene of scenes) {
      sceneStatement.run(stickerId, scene.id, scene.weight);
    }
    this.sqlite.prepare("DELETE FROM sticker_tags WHERE sticker_id = ?").run(stickerId);
    const tagStatement = this.sqlite.prepare("INSERT OR IGNORE INTO tags(id, name) VALUES (?, ?)");
    const joinStatement = this.sqlite.prepare("INSERT INTO sticker_tags(sticker_id, tag_id) VALUES (?, ?)");
    for (const tag of [...new Set(tags.map((value) => value.trim()).filter(Boolean))]) {
      const tagId = `tag:${tag.toLowerCase()}`;
      tagStatement.run(tagId, tag);
      joinStatement.run(stickerId, tagId);
    }
  }

  private refreshFts(stickerId: string): void {
    const sticker = this.getSticker(stickerId);
    if (!sticker) {
      return;
    }
    const scenes = this.getStickerScenes(stickerId).map((item) => item.id).join(" ");
    const tags = this.getStickerTags(stickerId).join(" ");
    const table = this.ftsTable(this.activeSearchSlot);
    this.sqlite.prepare(`DELETE FROM ${table} WHERE sticker_id = ?`).run(stickerId);
    this.sqlite.prepare(`INSERT INTO ${table}(sticker_id, title, alt_text, tags, scenes, tones) VALUES (?, ?, ?, ?, ?, ?)`).run(
      stickerId,
      sticker.title,
      Object.values(sticker.alt_text).join(" "),
      tags,
      scenes,
      sticker.tones.join(" ")
    );
  }

  private ftsTable(slot: SearchIndexSlot): "sticker_fts" | "sticker_fts_next" {
    return slot === "a" ? "sticker_fts" : "sticker_fts_next";
  }

  private vectorTable(slot: SearchIndexSlot): "sticker_vectors" | "sticker_vectors_next" {
    return slot === "a" ? "sticker_vectors" : "sticker_vectors_next";
  }

  private insertAudit(actor: string, action: string, entityType: string, entityId: string, details: unknown): void {
    this.sqlite.prepare("INSERT INTO audit_events(id, actor, action, entity_type, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      newId(), actor, action, entityType, entityId, JSON.stringify(details), nowIso()
    );
  }
}

interface StickerRow {
  id: string;
  workspace_id: string;
  external_id: string;
  title: string;
  alt_text_json: string;
  status: StickerStatus;
  safety: StickerRecord["safety"];
  license: string;
  source: string;
  attribution: string;
  pack: string;
  audience: StickerRecord["audience"];
  intensity: number;
  tones_json: string;
  sha256: string;
  perceptual_hash: string | null;
  original_storage_key: string;
  created_at: string;
  updated_at: string;
}

interface VariantRow {
  id: string;
  sticker_id: string;
  name: string;
  mime_type: string;
  delivery_kind: VariantRecord["delivery_kind"];
  width: number;
  height: number;
  duration_ms: number | null;
  bytes: number;
  sha256: string;
  storage_key: string;
  platforms_json: string;
  created_at: string;
}

interface JobRow {
  id: string;
  type: string;
  status: JobRecord["status"];
  payload_json: string;
  result_json: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

function mapSticker(row: StickerRow): StickerRecord {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    external_id: row.external_id,
    title: row.title,
    alt_text: safeJsonParse<Record<string, string>>(row.alt_text_json, {}),
    status: row.status,
    safety: row.safety,
    license: row.license,
    source: row.source,
    attribution: row.attribution,
    pack: row.pack,
    audience: row.audience,
    intensity: row.intensity,
    tones: safeJsonParse<string[]>(row.tones_json, []),
    sha256: row.sha256,
    perceptual_hash: row.perceptual_hash,
    original_storage_key: row.original_storage_key,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapVariant(row: VariantRow): VariantRecord {
  return {
    id: row.id,
    sticker_id: row.sticker_id,
    name: row.name,
    mime_type: row.mime_type,
    delivery_kind: row.delivery_kind,
    width: row.width,
    height: row.height,
    duration_ms: row.duration_ms,
    bytes: row.bytes,
    sha256: row.sha256,
    storage_key: row.storage_key,
    platforms: safeJsonParse<Platform[]>(row.platforms_json, []),
    created_at: row.created_at
  };
}

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    payload: safeJsonParse(row.payload_json, {}),
    result: row.result_json ? safeJsonParse(row.result_json, {}) : null,
    error: row.error,
    attempts: row.attempts,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}


