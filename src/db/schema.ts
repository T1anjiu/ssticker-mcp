import { blob, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull()
});

export const stickers = sqliteTable("stickers", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  altTextJson: text("alt_text_json").notNull(),
  status: text("status").notNull(),
  safety: text("safety").notNull(),
  license: text("license").notNull(),
  source: text("source").notNull(),
  attribution: text("attribution").notNull(),
  pack: text("pack").notNull(),
  audience: text("audience").notNull(),
  intensity: real("intensity").notNull(),
  tonesJson: text("tones_json").notNull(),
  sha256: text("sha256").notNull(),
  perceptualHash: text("perceptual_hash"),
  originalStorageKey: text("original_storage_key").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => [
  uniqueIndex("stickers_workspace_external_unique").on(table.workspaceId, table.externalId),
  uniqueIndex("stickers_workspace_sha_unique").on(table.workspaceId, table.sha256)
]);

export const variants = sqliteTable("variants", {
  id: text("id").primaryKey(),
  stickerId: text("sticker_id").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  deliveryKind: text("delivery_kind").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  durationMs: integer("duration_ms"),
  bytes: integer("bytes").notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull(),
  platformsJson: text("platforms_json").notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [uniqueIndex("variants_sticker_name_unique").on(table.stickerId, table.name)]);

export const scenes = sqliteTable("scenes", {
  id: text("id").primaryKey(),
  labelZh: text("label_zh").notNull(),
  labelEn: text("label_en").notNull(),
  definitionJson: text("definition_json").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  updatedAt: text("updated_at").notNull()
});

export const stickerScenes = sqliteTable("sticker_scenes", {
  stickerId: text("sticker_id").notNull(),
  sceneId: text("scene_id").notNull(),
  weight: real("weight").notNull()
}, (table) => [primaryKey({ columns: [table.stickerId, table.sceneId] })]);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique()
});

export const stickerTags = sqliteTable("sticker_tags", {
  stickerId: text("sticker_id").notNull(),
  tagId: text("tag_id").notNull()
}, (table) => [primaryKey({ columns: [table.stickerId, table.tagId] })]);

export const embeddings = sqliteTable("embeddings", {
  stickerId: text("sticker_id").primaryKey(),
  model: text("model").notNull(),
  dimensions: integer("dimensions").notNull(),
  contentHash: text("content_hash").notNull(),
  vector: blob("vector", { mode: "buffer" }).notNull(),
  updatedAt: text("updated_at").notNull()
});

export const policyProfiles = sqliteTable("policy_profiles", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  profileJson: text("profile_json").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const channelProfiles = sqliteTable("channel_profiles", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  version: integer("version").notNull(),
  profileJson: text("profile_json").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const decisionEvents = sqliteTable("decision_events", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().unique(),
  sessionHash: text("session_hash").notNull(),
  action: text("action").notNull(),
  sceneId: text("scene_id").notNull(),
  confidence: real("confidence").notNull(),
  reasonCodesJson: text("reason_codes_json").notNull(),
  policyJson: text("policy_json").notNull(),
  stickerId: text("sticker_id"),
  variantId: text("variant_id"),
  channelProfile: text("channel_profile").notNull(),
  decisionJson: text("decision_json").notNull(),
  turnIndex: integer("turn_index"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull()
});

export const outcomes = sqliteTable("outcomes", {
  id: text("id").primaryKey(),
  outcomeEventId: text("outcome_event_id").notNull().unique(),
  decisionId: text("decision_id").notNull(),
  outcome: text("outcome").notNull(),
  feedback: text("feedback"),
  failureCode: text("failure_code"),
  createdAt: text("created_at").notNull()
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  payloadJson: text("payload_json").notNull(),
  resultJson: text("result_json"),
  error: text("error"),
  attempts: integer("attempts").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detailsJson: text("details_json").notNull(),
  createdAt: text("created_at").notNull()
});

export const adminTokens = sqliteTable("admin_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
  prefix: text("prefix").notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at")
});

export const adminSessions = sqliteTable("admin_sessions", {
  id: text("id").primaryKey(),
  tokenId: text("token_id").notNull(),
  sessionHash: text("session_hash").notNull().unique(),
  csrfHash: text("csrf_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull()
});
