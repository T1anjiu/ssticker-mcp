import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RecommendStickerInputSchema } from "../src/domain/schemas.js";

describe("recommendation input schema", () => {
  it("accepts bounded Unicode chat content", () => {
    fc.assert(fc.property(fc.string({ maxLength: 300, unit: "grapheme" }), (text) => {
      const parsed = RecommendStickerInputSchema.safeParse({
        request_id: "request-1",
        session_id: "session-1",
        mode: "auto",
        channel: { platform: "generic", profile: "generic", conversation_type: "direct" },
        locale: "zh-CN",
        messages: [{ role: "user", text }]
      });
      expect(parsed.success).toBe(true);
    }), { numRuns: 100 });
  });

  it("rejects conversations over the aggregate privacy bound", () => {
    const parsed = RecommendStickerInputSchema.safeParse({
      request_id: "request-1",
      session_id: "session-1",
      mode: "auto",
      channel: { platform: "generic", profile: "generic", conversation_type: "direct" },
      locale: "zh-CN",
      messages: Array.from({ length: 4 }, () => ({ role: "user", text: "a".repeat(4000) }))
    });
    expect(parsed.success).toBe(false);
  });
});
