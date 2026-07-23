export const PLATFORMS = ["wechat", "qq", "telegram", "generic"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CONVERSATION_TYPES = ["direct", "group"] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const DECISION_MODES = ["auto", "explicit"] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];

export const REASON_CODES = [
  "matched",
  "explicit_request",
  "low_confidence",
  "ambiguous_scene",
  "serious_context",
  "safety_blocked",
  "cooldown_active",
  "recent_duplicate",
  "no_compatible_asset",
  "catalog_empty",
  "model_unavailable",
  "invalid_context"
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type StickerStatus = "draft" | "reviewed" | "active" | "disabled" | "blocked";
export type SafetyRating = "safe" | "sensitive" | "blocked";
export type DeliveryKind = "sticker" | "image" | "animation";
export type Outcome = "sent" | "skipped" | "failed" | "rejected";
export type Feedback = "positive" | "negative" | "neutral";

export interface ConversationAttachment {
  kind: "image" | "sticker" | "audio" | "video" | "file";
  mime_type?: string;
  alt_text?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "other";
  text: string;
  timestamp?: string;
  attachments?: ConversationAttachment[];
}

export interface ChannelRequest {
  platform: Platform;
  profile: string;
  conversation_type: ConversationType;
}

export interface RecommendationContext {
  bot_mentioned?: boolean;
  reply_to_bot?: boolean;
  participant_count?: number;
  turn_index?: number;
}

export interface RecommendationPreferences {
  tone_allow?: string[];
  tone_block?: string[];
  max_intensity?: number;
  packs?: string[];
}

export interface RecommendStickerInput {
  request_id: string;
  session_id: string;
  mode: DecisionMode;
  channel: ChannelRequest;
  locale: string;
  messages: ConversationMessage[];
  context?: RecommendationContext;
  preferences?: RecommendationPreferences;
}

export interface SearchStickersInput {
  query: string;
  channel: ChannelRequest;
  locale: string;
  scene_ids?: string[];
  tones?: string[];
  packs?: string[];
  limit: number;
}

export interface SceneResult {
  id: string;
  confidence: number;
  tone: string[];
  intensity: number;
}

export interface PolicyResult {
  profile: string;
  version: number;
  threshold: number;
  cooldown_active: boolean;
  cooldown_remaining_seconds: number;
}

export interface AssetVariant {
  variant_id: string;
  sticker_id: string;
  title: string;
  alt_text: Record<string, string>;
  delivery_kind: DeliveryKind;
  mime_type: string;
  width: number;
  height: number;
  duration_ms: number | null;
  bytes: number;
  sha256: string;
  resource_uri: string;
  download_url: string;
  expires_at: string;
  channel_hint: {
    adapter: string;
    method: string;
    fallback_method?: string;
  };
}

export interface StickerDecision {
  decision_id: string;
  action: "send" | "skip";
  scene: SceneResult;
  reason_codes: ReasonCode[];
  policy: PolicyResult;
  asset?: AssetVariant;
}

export interface StickerSearchResult {
  sticker_id: string;
  title: string;
  alt_text: Record<string, string>;
  score: number;
  scene_ids: string[];
  tones: string[];
  reason_codes: ReasonCode[];
  asset: AssetVariant;
}

export interface ReportOutcomeInput {
  decision_id: string;
  outcome_event_id: string;
  outcome: Outcome;
  feedback?: Feedback;
  failure_code?: string;
}

export interface StickerRecord {
  id: string;
  workspace_id: string;
  external_id: string;
  title: string;
  alt_text: Record<string, string>;
  status: StickerStatus;
  safety: SafetyRating;
  license: string;
  source: string;
  attribution: string;
  pack: string;
  audience: "direct" | "group" | "any";
  intensity: number;
  tones: string[];
  sha256: string;
  perceptual_hash: string | null;
  original_storage_key: string;
  created_at: string;
  updated_at: string;
}

export interface VariantRecord {
  id: string;
  sticker_id: string;
  name: string;
  mime_type: string;
  delivery_kind: DeliveryKind;
  width: number;
  height: number;
  duration_ms: number | null;
  bytes: number;
  sha256: string;
  storage_key: string;
  platforms: Platform[];
  created_at: string;
}

export interface SceneDefinition {
  id: string;
  label_zh: string;
  label_en: string;
  description_zh: string;
  description_en: string;
  keywords_zh: string[];
  keywords_en: string[];
  negative_keywords: string[];
  default_tones: string[];
  default_intensity: number;
}

export interface RankedSticker {
  sticker: StickerRecord;
  variant: VariantRecord;
  scene_ids: string[];
  keyword_score: number;
  semantic_score: number;
  scene_score: number;
  tone_score: number;
  channel_score: number;
  freshness_score: number;
  final_score: number;
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

export interface ChannelCapabilityProfile {
  id: string;
  platform: Platform;
  version: number;
  verified_at: string;
  source_url: string;
  accepted: Array<{
    mime_type: string;
    delivery_kind: DeliveryKind;
    max_bytes: number;
    max_width: number;
    max_height: number;
    max_duration_ms: number | null;
    method: string;
    fallback_method?: string;
  }>;
}

export interface CatalogManifest {
  manifest_version: 1;
  items: CatalogManifestItem[];
}

export interface CatalogManifestItem {
  external_id: string;
  file: string;
  title: string;
  alt_text: Record<string, string>;
  scenes: Array<{ id: string; weight: number }>;
  tags: string[];
  tone: string[];
  intensity: number;
  audience: "direct" | "group" | "any";
  safety: SafetyRating;
  license: string;
  source: string;
  attribution: string;
  pack?: string;
  channel_overrides?: Record<string, unknown>;
}

export interface DeliveryContext {
  conversation_id: string;
  target_id: string;
  reply_to_message_id?: string;
}

export interface DeliveryOutcome {
  outcome: Outcome;
  platform_message_id?: string;
  failure_code?: string;
}

export interface ChannelAdapter {
  readonly profileId: string;
  deliver(action: AssetVariant, context: DeliveryContext): Promise<DeliveryOutcome>;
}
