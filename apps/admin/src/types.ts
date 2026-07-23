export type PageId = "overview" | "catalog" | "uploads" | "scenes" | "decisions" | "system";
export type StickerStatus = "draft" | "reviewed" | "active" | "disabled" | "blocked";

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

export interface Sticker {
  id: string;
  external_id: string;
  title: string;
  alt_text: Record<string, string>;
  status: StickerStatus;
  safety: "safe" | "sensitive" | "blocked";
  license: string;
  source: string;
  attribution: string;
  pack: string;
  audience: "direct" | "group" | "any";
  intensity: number;
  tones: string[];
  sha256: string;
  perceptual_hash: string | null;
  updated_at: string;
  thumbnail_url?: string | null;
}

export interface Variant {
  id: string;
  name: string;
  mime_type: string;
  delivery_kind: string;
  width: number;
  height: number;
  duration_ms: number | null;
  bytes: number;
  platforms: string[];
  download_url: string;
}

export interface StickerDetail {
  sticker: Sticker;
  scenes: Array<{ id: string; weight: number }>;
  tags: string[];
  variants: Variant[];
}

export interface SceneDefinition {
  id: string;
  label_zh: string;
  label_en: string;
  description_zh: string;
  description_en: string;
  default_tones: string[];
  default_intensity: number;
  keywords_zh: string[];
  keywords_en: string[];
}

export interface PolicyProfile {
  id: string;
  version: number;
  auto_threshold: number;
  explicit_threshold: number;
  scene_threshold: number;
  margin_threshold: number;
  direct_cooldown_seconds: number;
  direct_turn_gap: number;
  group_cooldown_seconds: number;
  group_message_gap: number;
  recent_duplicate_window: number;
  event_ttl_hours: number;
}

export interface Job {
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

export interface DecisionSummary {
  id: string;
  action: "send" | "skip";
  scene_id: string;
  confidence: number;
  reason_codes: string[];
  sticker_id: string | null;
  channel_profile: string;
  created_at: string;
  outcome: string | null;
  feedback: string | null;
}

export interface SystemInfo {
  health: { database: string; migrations: number; vector: boolean; workspaces: number; index_generation: number };
  config: {
    host: string;
    port: number;
    data_dir: string;
    auth_mode: string;
    embedding_provider: string;
    model_id: string;
    llm_configured: boolean;
  };
  profiles: Array<{ id: string; platform: string; version: number; verified_at: string; accepted: unknown[] }>;
}
