import * as z from "zod/v4";
import { CONVERSATION_TYPES, DECISION_MODES, PLATFORMS, REASON_CODES } from "./types.js";

const boundedId = z.string().min(1).max(128);
const localeSchema = z.string().min(2).max(35).default("zh-CN");

export const ConversationAttachmentSchema = z.object({
  kind: z.enum(["image", "sticker", "audio", "video", "file"]),
  mime_type: z.string().max(127).optional(),
  alt_text: z.string().max(1000).optional()
});

export const ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant", "other"]),
  text: z.string().max(4000),
  timestamp: z.iso.datetime({ offset: true }).optional(),
  attachments: z.array(ConversationAttachmentSchema).max(8).optional()
});

export const ChannelRequestSchema = z.object({
  platform: z.enum(PLATFORMS),
  profile: boundedId,
  conversation_type: z.enum(CONVERSATION_TYPES)
});

export const RecommendStickerInputSchema = z.object({
  request_id: boundedId,
  session_id: z.string().min(1).max(256),
  mode: z.enum(DECISION_MODES),
  channel: ChannelRequestSchema,
  locale: localeSchema,
  messages: z.array(ConversationMessageSchema).min(1).max(20),
  context: z.object({
    bot_mentioned: z.boolean().optional(),
    reply_to_bot: z.boolean().optional(),
    participant_count: z.number().int().min(1).max(100000).optional(),
    turn_index: z.number().int().min(0).optional()
  }).optional(),
  preferences: z.object({
    tone_allow: z.array(boundedId).max(32).optional(),
    tone_block: z.array(boundedId).max(32).optional(),
    max_intensity: z.number().min(0).max(1).optional(),
    packs: z.array(boundedId).max(32).optional()
  }).optional()
}).superRefine((value, ctx) => {
  const characterCount = value.messages.reduce((total, message) => {
    const attachmentText = message.attachments?.reduce((sum, item) => sum + (item.alt_text?.length ?? 0), 0) ?? 0;
    return total + message.text.length + attachmentText;
  }, 0);
  if (characterCount > 12000) {
    ctx.addIssue({
      code: "custom",
      message: "Conversation content must not exceed 12,000 characters",
      path: ["messages"]
    });
  }
});

export const SearchStickersInputSchema = z.object({
  query: z.string().min(1).max(2000),
  channel: ChannelRequestSchema,
  locale: localeSchema,
  scene_ids: z.array(boundedId).max(16).optional(),
  tones: z.array(boundedId).max(16).optional(),
  packs: z.array(boundedId).max(16).optional(),
  limit: z.number().int().min(1).max(10).default(5)
});

export const GetStickerAssetInputSchema = z.object({
  sticker_id: boundedId,
  channel: ChannelRequestSchema,
  locale: localeSchema
});

export const ReportStickerOutcomeInputSchema = z.object({
  decision_id: boundedId,
  outcome_event_id: boundedId,
  outcome: z.enum(["sent", "skipped", "failed", "rejected"]),
  feedback: z.enum(["positive", "negative", "neutral"]).optional(),
  failure_code: z.string().min(1).max(128).optional()
});

export const AssetVariantSchema = z.object({
  variant_id: z.string(),
  sticker_id: z.string(),
  title: z.string(),
  alt_text: z.record(z.string(), z.string()),
  delivery_kind: z.enum(["sticker", "image", "animation"]),
  mime_type: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  duration_ms: z.number().int().nullable(),
  bytes: z.number().int(),
  sha256: z.string(),
  resource_uri: z.string(),
  download_url: z.string(),
  expires_at: z.string(),
  channel_hint: z.object({
    adapter: z.string(),
    method: z.string(),
    fallback_method: z.string().optional()
  })
});

export const StickerDecisionSchema = z.object({
  decision_id: z.string(),
  action: z.enum(["send", "skip"]),
  scene: z.object({
    id: z.string(),
    confidence: z.number(),
    tone: z.array(z.string()),
    intensity: z.number()
  }),
  reason_codes: z.array(z.enum(REASON_CODES)),
  policy: z.object({
    profile: z.string(),
    version: z.number().int(),
    threshold: z.number(),
    cooldown_active: z.boolean(),
    cooldown_remaining_seconds: z.number().int()
  }),
  asset: AssetVariantSchema.optional()
});

export const SearchResultSchema = z.object({
  results: z.array(z.object({
    sticker_id: z.string(),
    title: z.string(),
    alt_text: z.record(z.string(), z.string()),
    score: z.number(),
    scene_ids: z.array(z.string()),
    tones: z.array(z.string()),
    reason_codes: z.array(z.enum(REASON_CODES)),
    asset: AssetVariantSchema
  }))
});

export const OutcomeResultSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean(),
  decision_id: z.string()
});

export const ManifestItemSchema = z.object({
  external_id: boundedId,
  file: z.string().min(1).max(1024),
  title: z.string().min(1).max(256),
  alt_text: z.record(z.string(), z.string().min(1).max(1000)),
  scenes: z.array(z.object({ id: boundedId, weight: z.number().min(0).max(1) })).max(16),
  tags: z.array(boundedId).max(64).default([]),
  tone: z.array(boundedId).max(16).default([]),
  intensity: z.number().min(0).max(1).default(0.5),
  audience: z.enum(["direct", "group", "any"]).default("any"),
  safety: z.enum(["safe", "sensitive", "blocked"]).default("safe"),
  license: z.string().max(256).default(""),
  source: z.string().max(2048).default(""),
  attribution: z.string().max(1000).default(""),
  pack: boundedId.default("default"),
  channel_overrides: z.record(z.string(), z.unknown()).optional()
});

export const CatalogManifestSchema = z.object({
  manifest_version: z.literal(1),
  items: z.array(ManifestItemSchema).min(1)
});

export type RecommendInputParsed = z.infer<typeof RecommendStickerInputSchema>;
