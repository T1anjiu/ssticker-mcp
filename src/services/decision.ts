import type { AppConfig } from "../config.js";
import type { SStickerDatabase } from "../db/database.js";
import { EXPLICIT_STICKER_PATTERNS, SCENES, SERIOUS_PATTERNS } from "../domain/scenes.js";
import type {
  AssetVariant,
  ChannelCapabilityProfile,
  ChannelRequest,
  PolicyProfile,
  RankedSticker,
  ReasonCode,
  RecommendStickerInput,
  SearchStickersInput,
  StickerDecision,
  StickerRecord,
  StickerSearchResult,
  VariantRecord
} from "../domain/types.js";
import { addSecondsIso, clamp, cosineSimilarity, hmacSha256, newId, roundScore, tokenize } from "../utils.js";
import type { EmbeddingProvider, EmbeddingResult } from "./embedding.js";
import { OpenAiCompatibleClassifier } from "./llm.js";
import { LocalAssetStore } from "./storage.js";
import type { MetricsService } from "./metrics.js";

interface SceneCandidate {
  id: string;
  confidence: number;
  lexical: number;
  semantic: number;
  tones: string[];
  intensity: number;
}

interface WeightedText {
  text: string;
  weight: number;
}

interface RankingContext {
  text: string;
  scene: SceneCandidate;
  queryEmbedding: EmbeddingResult;
  channel: ChannelRequest;
  preferences?: RecommendStickerInput["preferences"];
  recentStickerIds: Set<string>;
}

export class DecisionService {
  private readonly prototypeVectors = new Map<string, Float32Array>();
  private readonly llm: OpenAiCompatibleClassifier | null;

  constructor(
    private readonly config: AppConfig,
    private readonly database: SStickerDatabase,
    private readonly embedding: EmbeddingProvider,
    private readonly assets: LocalAssetStore,
    private readonly metrics?: MetricsService
  ) {
    this.llm = config.llm ? new OpenAiCompatibleClassifier(config.llm) : null;
  }

  async recommend(input: RecommendStickerInput): Promise<StickerDecision> {
    const requestStartedAt = Date.now();
    const existing = this.database.getDecisionByRequestId(input.request_id);
    if (existing) {
      return this.refreshDecisionAsset(existing, input.channel);
    }

    const text = formatConversation(input.messages);
    const sessionHash = hmacSha256(this.config.sessionSecret, input.session_id);
    const policy = this.database.getPolicyProfile("default");
    const threshold = input.mode === "explicit" ? policy.explicit_threshold : policy.auto_threshold;
    const explicitRequest = input.mode === "explicit" || EXPLICIT_STICKER_PATTERNS.some((pattern) => pattern.test(text));
    const serious = SERIOUS_PATTERNS.some((pattern) => pattern.test(text));

    if (serious) {
      this.metrics?.observeStage("policy", requestStartedAt);
      return this.persistSkip(input, sessionHash, policy, threshold, "unknown", 1, ["serious_context", "safety_blocked"]);
    }

    if (this.database.countActiveStickers() === 0) {
      this.metrics?.observeStage("policy", requestStartedAt);
      return this.persistSkip(input, sessionHash, policy, threshold, "unknown", 0, ["catalog_empty"]);
    }

    const recognitionStartedAt = Date.now();
    const queryEmbedding = await this.embedding.embed(text);
    if (queryEmbedding.degraded) {
      this.metrics?.observeModelFailure("embedding");
    }
    const scenes = await this.classifyScenes(text, queryEmbedding, weightedConversation(input.messages));
    this.metrics?.observeStage("recognition", recognitionStartedAt);
    let primaryScene = scenes[0] ?? unknownScene();
    const margin = primaryScene.confidence - (scenes[1]?.confidence ?? 0);
    let llmSerious = false;

    if (this.llm && (primaryScene.confidence >= 0.55 && primaryScene.confidence <= 0.80 || margin < 0.10)) {
      const llmStartedAt = Date.now();
      const classification = await this.llm.classify(text);
      this.metrics?.observeStage("llm", llmStartedAt);
      if (!classification) {
        this.metrics?.observeModelFailure("llm");
      }
      if (classification) {
        llmSerious = classification.serious;
        const matching = SCENES.find((scene) => scene.id === classification.scene_id);
        if (matching) {
          primaryScene = {
            id: matching.id,
            confidence: roundScore(primaryScene.id === matching.id
              ? primaryScene.confidence * 0.55 + classification.confidence * 0.45
              : classification.confidence * 0.7),
            lexical: primaryScene.id === matching.id ? primaryScene.lexical : 0,
            semantic: primaryScene.id === matching.id ? primaryScene.semantic : classification.confidence,
            tones: [...new Set([...matching.default_tones, ...classification.tones])].slice(0, 4),
            intensity: classification.intensity
          };
        }
      }
    }

    const preRetrievalPolicyStartedAt = Date.now();
    if (llmSerious) {
      this.metrics?.observeStage("policy", preRetrievalPolicyStartedAt);
      return this.persistSkip(input, sessionHash, policy, threshold, primaryScene.id, primaryScene.confidence, ["serious_context", "safety_blocked"]);
    }

    const recent = this.database.recentSent(sessionHash, Math.max(policy.recent_duplicate_window, 20));
    const cooldown = calculateCooldown(recent, input, policy);
    if (!explicitRequest && cooldown.active) {
      this.metrics?.observeStage("policy", preRetrievalPolicyStartedAt);
      return this.persistSkip(input, sessionHash, policy, threshold, primaryScene.id, primaryScene.confidence, ["cooldown_active"], cooldown.remainingSeconds);
    }

    const recentStickerIds = new Set(recent.slice(0, policy.recent_duplicate_window).map((item) => item.sticker_id));
    const retrievalStartedAt = Date.now();
    const ranked = this.rankStickers({
      text,
      scene: primaryScene,
      queryEmbedding,
      channel: input.channel,
      preferences: input.preferences,
      recentStickerIds
    });
    this.metrics?.observeStage("retrieval", retrievalStartedAt);
    const policyStartedAt = Date.now();

    if (ranked.length === 0) {
      this.metrics?.observeStage("policy", policyStartedAt);
      return this.persistSkip(input, sessionHash, policy, threshold, primaryScene.id, primaryScene.confidence, [recentStickerIds.size > 0 ? "recent_duplicate" : "no_compatible_asset"]);
    }

    const best = ranked[0]!;
    const candidateMargin = best.final_score - (ranked[1]?.final_score ?? 0);
    const reasons: ReasonCode[] = [];
    if (explicitRequest) {
      reasons.push("explicit_request");
    }
    if (queryEmbedding.degraded) {
      reasons.push("model_unavailable");
    }

    const scenePass = explicitRequest || primaryScene.confidence >= policy.scene_threshold;
    const scorePass = best.final_score >= threshold;
    const marginPass = explicitRequest || candidateMargin >= policy.margin_threshold;
    if (!scenePass || !scorePass) {
      reasons.unshift("low_confidence");
      this.metrics?.observeStage("policy", policyStartedAt);
      return this.persistSkip(input, sessionHash, policy, threshold, primaryScene.id, primaryScene.confidence, reasons);
    }
    if (!marginPass) {
      reasons.unshift("ambiguous_scene");
      this.metrics?.observeStage("policy", policyStartedAt);
      return this.persistSkip(input, sessionHash, policy, threshold, primaryScene.id, primaryScene.confidence, reasons);
    }

    reasons.unshift("matched");
    const decision = this.buildSendDecision(input, policy, threshold, primaryScene, best, reasons);
    this.database.saveDecision({
      decision,
      requestId: input.request_id,
      sessionHash,
      channelProfile: input.channel.profile,
      turnIndex: input.context?.turn_index,
      expiresAt: addSecondsIso(policy.event_ttl_hours * 3600)
    });
    this.metrics?.observeStage("policy", policyStartedAt);
    return decision;
  }

  async search(input: SearchStickersInput): Promise<StickerSearchResult[]> {
    const embedding = await this.embedding.embed(input.query);
    const scenes = await this.classifyScenes(input.query, embedding, [{ text: input.query, weight: 1 }]);
    const selectedScene = input.scene_ids?.[0]
      ? scenes.find((scene) => scene.id === input.scene_ids?.[0]) ?? { ...unknownScene(), id: input.scene_ids[0], confidence: 1 }
      : scenes[0] ?? unknownScene();
    const ranked = this.rankStickers({
      text: input.query,
      scene: selectedScene,
      queryEmbedding: embedding,
      channel: input.channel,
      preferences: { tone_allow: input.tones, packs: input.packs },
      recentStickerIds: new Set()
    });
    return ranked.slice(0, input.limit).map((candidate) => ({
      sticker_id: candidate.sticker.id,
      title: candidate.sticker.title,
      alt_text: candidate.sticker.alt_text,
      score: candidate.final_score,
      scene_ids: candidate.scene_ids,
      tones: candidate.sticker.tones,
      reason_codes: embedding.degraded ? ["matched", "model_unavailable"] : ["matched"],
      asset: this.toAsset(candidate.sticker, candidate.variant, input.channel)
    }));
  }

  getAsset(stickerId: string, channel: ChannelRequest): AssetVariant {
    const sticker = this.database.getSticker(stickerId);
    if (!sticker || sticker.status !== "active" || sticker.safety !== "safe") {
      throw new Error("Sticker is not available");
    }
    const variant = this.selectVariant(sticker.id, channel);
    if (!variant) {
      throw new Error("No compatible asset variant is available");
    }
    return this.toAsset(sticker, variant, channel);
  }

  reportOutcome(input: { decision_id: string; outcome_event_id: string; outcome: "sent" | "skipped" | "failed" | "rejected"; feedback?: "positive" | "negative" | "neutral"; failure_code?: string }): { accepted: boolean; duplicate: boolean; decision_id: string } {
    if (!this.database.getDecision(input.decision_id)) {
      throw new Error("Decision not found or expired");
    }
    const result = this.database.recordOutcome({
      outcomeEventId: input.outcome_event_id,
      decisionId: input.decision_id,
      outcome: input.outcome,
      feedback: input.feedback,
      failureCode: input.failure_code
    });
    return { accepted: true, duplicate: result.duplicate, decision_id: input.decision_id };
  }

  private async classifyScenes(text: string, queryEmbedding: EmbeddingResult, weightedText: WeightedText[]): Promise<SceneCandidate[]> {
    const segments = weightedText.map((segment) => ({
      text: segment.text.normalize("NFKC").toLowerCase(),
      weight: clamp(segment.weight)
    }));
    const candidates: SceneCandidate[] = [];
    for (const scene of SCENES) {
      let lexicalHits = 0;
      for (const keyword of [...scene.keywords_zh, ...scene.keywords_en]) {
        const normalizedKeyword = keyword.normalize("NFKC").toLowerCase();
        const recencyHit = segments.reduce((strongest, segment) => containsKeyword(segment.text, normalizedKeyword) ? Math.max(strongest, segment.weight) : strongest, 0);
        if (recencyHit > 0) {
          lexicalHits += recencyHit * (keyword.length >= 3 ? 1.2 : 1);
        }
      }
      const negative = scene.negative_keywords.some((keyword) => segments.some((segment) => containsKeyword(segment.text, keyword.normalize("NFKC").toLowerCase())));
      const lexical = negative ? 0 : clamp(lexicalHits);
      let prototype = this.prototypeVectors.get(scene.id);
      if (!prototype) {
        const prototypeText = [...scene.keywords_zh, ...scene.keywords_en, scene.description_zh, scene.description_en].join(" ");
        prototype = (await this.embedding.embed(prototypeText)).vector;
        this.prototypeVectors.set(scene.id, prototype);
      }
      const semantic = clamp((cosineSimilarity(queryEmbedding.vector, prototype) + 1) / 2);
      const confidence = roundScore(lexical * 0.65 + semantic * 0.35);
      candidates.push({
        id: scene.id,
        confidence,
        lexical,
        semantic,
        tones: scene.default_tones,
        intensity: scene.default_intensity
      });
    }
    return candidates.sort((left, right) => right.confidence - left.confidence);
  }

  private rankStickers(context: RankingContext): RankedSticker[] {
    const profile = this.database.getChannelProfile(context.channel.profile);
    if (profile.platform !== context.channel.platform && profile.platform !== "generic") {
      throw new Error(`Channel profile ${profile.id} does not match ${context.channel.platform}`);
    }
    const textResults = this.database.searchStickerIdsByText(context.text, 50);
    const vectorResults = this.database.searchStickerIdsByVector(context.queryEmbedding.vector, 50);
    const sceneResults = context.scene.id === "unknown" ? [] : this.database.findStickerIdsByScene(context.scene.id, 50);
    const textScores = new Map(textResults.map((item) => [item.id, item.score]));
    const vectorScores = new Map(vectorResults.map((item) => [item.id, item.score]));
    const fusedIds = reciprocalRankFuse([textResults, vectorResults, sceneResults], 50);
    const stickers = fusedIds.length > 0 ? this.database.getActiveStickersByIds(fusedIds) : this.database.listActiveStickers(50);
    const queryTokens = new Set(tokenize(context.text));
    const ranked: RankedSticker[] = [];

    for (const sticker of stickers) {
      if (context.recentStickerIds.has(sticker.id)) {
        continue;
      }
      if (sticker.audience !== "any" && sticker.audience !== context.channel.conversation_type) {
        continue;
      }
      if (context.preferences?.max_intensity !== undefined && sticker.intensity > context.preferences.max_intensity) {
        continue;
      }
      if (context.preferences?.packs?.length && !context.preferences.packs.includes(sticker.pack)) {
        continue;
      }
      if (context.preferences?.tone_block?.some((tone) => sticker.tones.includes(tone))) {
        continue;
      }
      const variant = this.selectVariantForProfile(sticker.id, profile);
      if (!variant) {
        continue;
      }
      const scenes = this.database.getStickerScenes(sticker.id);
      const sceneWeight = scenes.find((scene) => scene.id === context.scene.id)?.weight ?? 0;
      const tags = this.database.getStickerTags(sticker.id);
      const lexicalFallback = tags.filter((tag) => queryTokens.has(tag.toLowerCase())).length / Math.max(tags.length, 1);
      const keywordScore = clamp(Math.max(textScores.get(sticker.id) ?? 0, lexicalFallback, context.scene.lexical));
      const storedEmbedding = this.database.getEmbedding(sticker.id);
      const semanticScore = clamp(vectorScores.get(sticker.id) ?? (storedEmbedding ? (cosineSimilarity(context.queryEmbedding.vector, storedEmbedding) + 1) / 2 : 0));
      const toneAllow = context.preferences?.tone_allow;
      const targetTones = toneAllow?.length ? toneAllow : context.scene.tones;
      const toneScore = targetTones.length === 0 ? 0.5 : sticker.tones.filter((tone) => targetTones.includes(tone)).length / targetTones.length;
      const channelScore = calculateChannelScore(variant, profile);
      const freshnessScore = 1;
      const finalScore = roundScore(
        sceneWeight * 0.30 +
        semanticScore * 0.35 +
        keywordScore * 0.15 +
        clamp(toneScore) * 0.10 +
        channelScore * 0.05 +
        freshnessScore * 0.05
      );
      ranked.push({
        sticker,
        variant,
        scene_ids: scenes.map((scene) => scene.id),
        keyword_score: roundScore(keywordScore),
        semantic_score: roundScore(semanticScore),
        scene_score: roundScore(sceneWeight),
        tone_score: roundScore(toneScore),
        channel_score: roundScore(channelScore),
        freshness_score: freshnessScore,
        final_score: finalScore
      });
    }
    return ranked.sort((left, right) => right.final_score - left.final_score || left.sticker.id.localeCompare(right.sticker.id));
  }

  private selectVariant(stickerId: string, channel: ChannelRequest): VariantRecord | null {
    return this.selectVariantForProfile(stickerId, this.database.getChannelProfile(channel.profile));
  }

  private selectVariantForProfile(stickerId: string, profile: ChannelCapabilityProfile): VariantRecord | null {
    const variants = this.database.getStickerVariants(stickerId);
    const compatible = variants.flatMap((variant) => {
      if (!variant.platforms.includes(profile.platform) && !variant.platforms.includes("generic")) {
        return [];
      }
      const acceptance = profile.accepted.find((rule) =>
        rule.mime_type === variant.mime_type &&
        rule.delivery_kind === variant.delivery_kind &&
        variant.bytes <= rule.max_bytes &&
        variant.width <= rule.max_width &&
        variant.height <= rule.max_height &&
        (rule.max_duration_ms === null || (variant.duration_ms ?? 0) <= rule.max_duration_ms)
      );
      return acceptance ? [{ variant, priority: deliveryPriority(variant.delivery_kind), rule: acceptance }] : [];
    });
    compatible.sort((left, right) => right.priority - left.priority || left.variant.bytes - right.variant.bytes);
    return compatible[0]?.variant ?? null;
  }

  private toAsset(sticker: StickerRecord, variant: VariantRecord, channel: ChannelRequest): AssetVariant {
    const profile = this.database.getChannelProfile(channel.profile);
    const rule = profile.accepted.find((item) => item.mime_type === variant.mime_type && item.delivery_kind === variant.delivery_kind);
    if (!rule) {
      throw new Error("Channel profile no longer accepts the selected variant");
    }
    const signed = this.assets.sign(variant.id);
    return {
      variant_id: variant.id,
      sticker_id: sticker.id,
      title: sticker.title,
      alt_text: sticker.alt_text,
      delivery_kind: variant.delivery_kind,
      mime_type: variant.mime_type,
      width: variant.width,
      height: variant.height,
      duration_ms: variant.duration_ms,
      bytes: variant.bytes,
      sha256: variant.sha256,
      resource_uri: `ssticker://stickers/${sticker.id}`,
      download_url: signed.downloadUrl,
      expires_at: signed.expiresAt,
      channel_hint: {
        adapter: profile.id,
        method: rule.method,
        fallback_method: rule.fallback_method
      }
    };
  }

  private buildSendDecision(
    input: RecommendStickerInput,
    policy: PolicyProfile,
    threshold: number,
    scene: SceneCandidate,
    best: RankedSticker,
    reasonCodes: ReasonCode[]
  ): StickerDecision {
    return {
      decision_id: newId(),
      action: "send",
      scene: { id: scene.id, confidence: scene.confidence, tone: scene.tones, intensity: scene.intensity },
      reason_codes: uniqueReasons(reasonCodes),
      policy: {
        profile: policy.id,
        version: policy.version,
        threshold,
        cooldown_active: false,
        cooldown_remaining_seconds: 0
      },
      asset: this.toAsset(best.sticker, best.variant, input.channel)
    };
  }

  private persistSkip(
    input: RecommendStickerInput,
    sessionHash: string,
    policy: PolicyProfile,
    threshold: number,
    sceneId: string,
    confidence: number,
    reasons: ReasonCode[],
    cooldownRemainingSeconds = 0
  ): StickerDecision {
    const scene = SCENES.find((item) => item.id === sceneId);
    const decision: StickerDecision = {
      decision_id: newId(),
      action: "skip",
      scene: {
        id: sceneId,
        confidence: roundScore(confidence),
        tone: scene?.default_tones ?? [],
        intensity: scene?.default_intensity ?? 0
      },
      reason_codes: uniqueReasons(reasons),
      policy: {
        profile: policy.id,
        version: policy.version,
        threshold,
        cooldown_active: reasons.includes("cooldown_active"),
        cooldown_remaining_seconds: cooldownRemainingSeconds
      }
    };
    this.database.saveDecision({
      decision,
      requestId: input.request_id,
      sessionHash,
      channelProfile: input.channel.profile,
      turnIndex: input.context?.turn_index,
      expiresAt: addSecondsIso(policy.event_ttl_hours * 3600)
    });
    return decision;
  }

  private refreshDecisionAsset(decision: StickerDecision, channel: ChannelRequest): StickerDecision {
    if (decision.action !== "send" || !decision.asset) {
      return decision;
    }
    try {
      return { ...decision, asset: this.getAsset(decision.asset.sticker_id, channel) };
    } catch {
      return { ...decision, action: "skip", asset: undefined, reason_codes: ["no_compatible_asset"] };
    }
  }
}

function formatConversation(messages: RecommendStickerInput["messages"]): string {
  return messages.map((message) => {
    return `[${message.role}] ${messageText(message)}`.trim();
  }).join("\n");
}

function weightedConversation(messages: RecommendStickerInput["messages"]): WeightedText[] {
  return messages.map((message, index) => {
    const position = (index + 1) / messages.length;
    return { text: messageText(message), weight: 0.35 + 0.65 * position * position };
  });
}

function messageText(message: RecommendStickerInput["messages"][number]): string {
  const attachments = message.attachments?.map((item) => item.alt_text).filter(Boolean).join(" ") ?? "";
  return `${message.text} ${attachments}`.trim();
}

function reciprocalRankFuse(resultSets: Array<Array<{ id: string }>>, limit: number): string[] {
  const scores = new Map<string, number>();
  for (const results of resultSets) {
    results.forEach((result, index) => {
      scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (60 + index + 1));
    });
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

function containsKeyword(text: string, keyword: string): boolean {
  if (/^[a-z0-9_ '\-]+$/i.test(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, "i").test(text);
  }
  return text.includes(keyword);
}

function unknownScene(): SceneCandidate {
  return { id: "unknown", confidence: 0, lexical: 0, semantic: 0, tones: [], intensity: 0 };
}

function calculateCooldown(
  recent: ReturnType<SStickerDatabase["recentSent"]>,
  input: RecommendStickerInput,
  policy: PolicyProfile
): { active: boolean; remainingSeconds: number } {
  const latest = recent[0];
  if (!latest) {
    return { active: false, remainingSeconds: 0 };
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(latest.sent_at)) / 1000));
  const cooldownSeconds = input.channel.conversation_type === "group" ? policy.group_cooldown_seconds : policy.direct_cooldown_seconds;
  const requiredTurnGap = input.channel.conversation_type === "group" ? policy.group_message_gap : policy.direct_turn_gap;
  const currentTurn = input.context?.turn_index;
  const turnGap = currentTurn !== undefined && latest.turn_index !== null ? currentTurn - latest.turn_index : Number.POSITIVE_INFINITY;
  const remainingSeconds = Math.max(0, cooldownSeconds - elapsedSeconds);
  return { active: remainingSeconds > 0 || turnGap < requiredTurnGap, remainingSeconds };
}

function calculateChannelScore(variant: VariantRecord, profile: ChannelCapabilityProfile): number {
  const rule = profile.accepted.find((item) => item.mime_type === variant.mime_type && item.delivery_kind === variant.delivery_kind);
  if (!rule) {
    return 0;
  }
  const byteHeadroom = clamp(1 - variant.bytes / rule.max_bytes);
  const preferredKind = deliveryPriority(variant.delivery_kind) / 3;
  return clamp(preferredKind * 0.7 + byteHeadroom * 0.3);
}

function deliveryPriority(kind: VariantRecord["delivery_kind"]): number {
  return kind === "sticker" ? 3 : kind === "animation" ? 2 : 1;
}

function uniqueReasons(reasons: ReasonCode[]): ReasonCode[] {
  return [...new Set(reasons)];
}
