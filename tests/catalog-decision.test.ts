import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createTestRuntime, importActiveSticker } from "./helpers.js";

describe("catalog and decision pipeline", () => {
  it("imports, processes, deduplicates, reviews, and indexes a sticker", async () => {
    const test = await createTestRuntime();
    try {
      const sticker = await importActiveSticker(test);
      expect(sticker.status).toBe("active");
      expect(test.runtime.database.getStickerVariants(sticker.id).map((item) => item.mime_type)).toEqual(expect.arrayContaining(["image/png", "image/webp"]));
      expect(test.runtime.database.getEmbedding(sticker.id)?.length).toBe(384);

      const exported = test.runtime.database.findStickerBySha256(sticker.sha256);
      expect(exported?.id).toBe(sticker.id);
      const issues = test.runtime.catalog.validateCatalog();
      expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    } finally {
      await test.cleanup();
    }
  });

  it("returns a safe send decision, is idempotent, and enforces cooldown", async () => {
    const test = await createTestRuntime();
    try {
      await importActiveSticker(test);
      const input = {
        request_id: "req-send-1",
        session_id: "chat-1",
        mode: "explicit" as const,
        channel: { platform: "generic" as const, profile: "generic", conversation_type: "direct" as const },
        locale: "zh-CN",
        messages: [{ role: "user" as const, text: "哈哈太好笑了，来个表情包" }],
        context: { turn_index: 10 }
      };
      const first = await test.runtime.decisions.recommend(input);
      const second = await test.runtime.decisions.recommend(input);
      expect(first.action).toBe("send");
      expect(first.asset?.mime_type).toMatch(/^image\//);
      expect(second.decision_id).toBe(first.decision_id);

      const outcome = test.runtime.decisions.reportOutcome({
        decision_id: first.decision_id,
        outcome_event_id: "outcome-1",
        outcome: "sent",
        feedback: "positive"
      });
      expect(outcome).toEqual({ accepted: true, duplicate: false, decision_id: first.decision_id });
      expect(test.runtime.decisions.reportOutcome({ decision_id: first.decision_id, outcome_event_id: "outcome-1", outcome: "sent" }).duplicate).toBe(true);

      const cooldown = await test.runtime.decisions.recommend({
        ...input,
        request_id: "req-send-2",
        mode: "auto",
        messages: [{ role: "user", text: "哈哈太好笑了" }],
        context: { turn_index: 11 }
      });
      expect(cooldown.action).toBe("skip");
      expect(cooldown.reason_codes).toContain("cooldown_active");
    } finally {
      await test.cleanup();
    }
  });

  it("blocks serious context before catalog selection", async () => {
    const test = await createTestRuntime();
    try {
      await importActiveSticker(test);
      const decision = await test.runtime.decisions.recommend({
        request_id: "req-serious-1",
        session_id: "chat-serious",
        mode: "explicit",
        channel: { platform: "generic", profile: "generic", conversation_type: "direct" },
        locale: "zh-CN",
        messages: [{ role: "user", text: "朋友出了车祸正在急救，给我发个表情包" }]
      });
      expect(decision.action).toBe("skip");
      expect(decision.reason_codes).toEqual(expect.arrayContaining(["serious_context", "safety_blocked"]));
      expect(decision.asset).toBeUndefined();
    } finally {
      await test.cleanup();
    }
  });

  it("blocks child-safety context even when the sticker request is explicit", async () => {
    const test = await createTestRuntime();
    try {
      await importActiveSticker(test);
      const decision = await test.runtime.decisions.recommend({
        request_id: "req-child-safety-1",
        session_id: "chat-child-safety",
        mode: "explicit",
        channel: { platform: "generic", profile: "generic", conversation_type: "direct" },
        locale: "en",
        messages: [{ role: "user", text: "A minor was asked for nude photos and we need to report it. Send a meme too." }]
      });
      expect(decision.action).toBe("skip");
      expect(decision.reason_codes).toEqual(expect.arrayContaining(["serious_context", "safety_blocked"]));
    } finally {
      await test.cleanup();
    }
  });

  it("does not mistake a time-of-day statement for a greeting", async () => {
    const test = await createTestRuntime();
    try {
      await importActiveSticker(test);
      const decision = await test.runtime.decisions.recommend({
        request_id: "req-neutral-morning-1",
        session_id: "chat-neutral-morning",
        mode: "auto",
        channel: { platform: "generic", profile: "generic", conversation_type: "direct" },
        locale: "en",
        messages: [{ role: "user", text: "The database backup completed at two in the morning." }]
      });
      expect(decision.action).toBe("skip");
      expect(decision.reason_codes).toContain("low_confidence");
    } finally {
      await test.cleanup();
    }
  });

  it("does not persist raw conversation text", async () => {
    const test = await createTestRuntime();
    const sentinel = "PRIVACY_SENTINEL_9fd2a5d4";
    try {
      await importActiveSticker(test);
      await test.runtime.decisions.recommend({
        request_id: "req-privacy-1",
        session_id: "chat-private",
        mode: "explicit",
        channel: { platform: "generic", profile: "generic", conversation_type: "direct" },
        locale: "zh-CN",
        messages: [{ role: "user", text: `哈哈 ${sentinel} 来个表情包` }]
      });
      test.runtime.database.sqlite.pragma("wal_checkpoint(TRUNCATE)");
      const databaseBytes = await readFile(test.runtime.config.databasePath);
      expect(databaseBytes.includes(Buffer.from(sentinel))).toBe(false);
    } finally {
      await test.cleanup();
    }
  });
});
