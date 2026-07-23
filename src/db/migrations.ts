export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE stickers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        alt_text_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft','reviewed','active','disabled','blocked')),
        safety TEXT NOT NULL CHECK(safety IN ('safe','sensitive','blocked')),
        license TEXT NOT NULL,
        source TEXT NOT NULL,
        attribution TEXT NOT NULL,
        pack TEXT NOT NULL,
        audience TEXT NOT NULL CHECK(audience IN ('direct','group','any')),
        intensity REAL NOT NULL CHECK(intensity >= 0 AND intensity <= 1),
        tones_json TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        perceptual_hash TEXT,
        original_storage_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, external_id),
        UNIQUE(workspace_id, sha256)
      );
      CREATE TABLE variants (
        id TEXT PRIMARY KEY,
        sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        delivery_kind TEXT NOT NULL CHECK(delivery_kind IN ('sticker','image','animation')),
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        duration_ms INTEGER,
        bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        platforms_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(sticker_id, name)
      );
      CREATE TABLE scenes (
        id TEXT PRIMARY KEY,
        label_zh TEXT NOT NULL,
        label_en TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sticker_scenes (
        sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
        scene_id TEXT NOT NULL REFERENCES scenes(id),
        weight REAL NOT NULL CHECK(weight >= 0 AND weight <= 1),
        PRIMARY KEY(sticker_id, scene_id)
      );
      CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE sticker_tags (
        sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY(sticker_id, tag_id)
      );
      CREATE TABLE embeddings (
        sticker_id TEXT PRIMARY KEY REFERENCES stickers(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        vector BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE policy_profiles (id TEXT PRIMARY KEY, version INTEGER NOT NULL, profile_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE channel_profiles (id TEXT PRIMARY KEY, platform TEXT NOT NULL, version INTEGER NOT NULL, profile_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE decision_events (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        session_hash TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('send','skip')),
        scene_id TEXT NOT NULL,
        confidence REAL NOT NULL,
        reason_codes_json TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        sticker_id TEXT REFERENCES stickers(id),
        variant_id TEXT REFERENCES variants(id),
        channel_profile TEXT NOT NULL,
        decision_json TEXT NOT NULL,
        turn_index INTEGER,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX decision_events_session_created_idx ON decision_events(session_hash, created_at DESC);
      CREATE INDEX decision_events_expires_idx ON decision_events(expires_at);
      CREATE TABLE outcomes (
        id TEXT PRIMARY KEY,
        outcome_event_id TEXT NOT NULL UNIQUE,
        decision_id TEXT NOT NULL REFERENCES decision_events(id) ON DELETE CASCADE,
        outcome TEXT NOT NULL CHECK(outcome IN ('sent','skipped','failed','rejected')),
        feedback TEXT CHECK(feedback IN ('positive','negative','neutral')),
        failure_code TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX outcomes_decision_created_idx ON outcomes(decision_id, created_at DESC);
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
        payload_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE admin_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hash TEXT NOT NULL,
        prefix TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE admin_sessions (
        id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL REFERENCES admin_tokens(id),
        session_hash TEXT NOT NULL UNIQUE,
        csrf_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE sticker_fts USING fts5(sticker_id UNINDEXED, title, alt_text, tags, scenes, tones, tokenize='unicode61');
    `
  },
  {
    version: 2,
    name: "atomic_search_index_slots",
    sql: `
      CREATE TABLE search_index_state (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        active_slot TEXT NOT NULL CHECK(active_slot IN ('a','b')),
        generation INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO search_index_state(id, active_slot, generation, updated_at)
      VALUES (1, 'a', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      CREATE TABLE search_embeddings (
        sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
        slot TEXT NOT NULL CHECK(slot IN ('a','b')),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        vector BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(sticker_id, slot)
      );
      INSERT INTO search_embeddings(sticker_id, slot, model, dimensions, content_hash, vector, updated_at)
      SELECT sticker_id, 'a', model, dimensions, content_hash, vector, updated_at FROM embeddings;
      CREATE VIRTUAL TABLE sticker_fts_next USING fts5(sticker_id UNINDEXED, title, alt_text, tags, scenes, tones, tokenize='unicode61');
    `
  }
];
