import request from "supertest";
import { describe, expect, it } from "vitest";
import { createHttpApp } from "../src/http/app.js";
import { createTestRuntime, importActiveSticker } from "./helpers.js";

describe("MCP over Streamable HTTP", () => {
  it("responds to tools/list and tools/call with the same decision shape as in-process", async () => {
    const test = await createTestRuntime();
    const sticker = await importActiveSticker(test);
    const app = createHttpApp(test.runtime);
    try {
      const list = await request(app)
        .post("/mcp")
        .set("Origin", "http://127.0.0.1:3377")
        .set("MCP-Protocol-Version", "2025-11-25")
        .set("Accept", "application/json, text/event-stream")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list" })
        .expect(200);
      const toolNames = (list.body.result?.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
      expect(toolNames).toEqual(["get_sticker_asset", "recommend_sticker", "report_sticker_outcome", "search_stickers"]);

      const recommend = await request(app)
        .post("/mcp")
        .set("Origin", "http://127.0.0.1:3377")
        .set("MCP-Protocol-Version", "2025-11-25")
        .set("Accept", "application/json, text/event-stream")
        .send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "recommend_sticker",
            arguments: {
              request_id: "http-flow-1",
              session_id: "http-session-1",
              mode: "explicit",
              channel: { platform: "telegram", profile: "telegram-bot", conversation_type: "direct" },
              locale: "zh-CN",
              messages: [{ role: "user", text: "I want to send a happy sticker now" }]
            }
          }
        })
        .expect(200);
      const structured = recommend.body.result?.structuredContent as Record<string, unknown> | undefined;
      expect(structured).toMatchObject({ action: "send", reason_codes: expect.arrayContaining(["explicit_request"]) });
      const asset = (structured as { asset?: { sticker_id?: string; resource_uri?: string; download_url?: string; expires_at?: string } }).asset;
      expect(asset?.sticker_id).toBe(sticker.id);
      expect(asset?.resource_uri ?? "").toContain("ssticker://stickers/");
      expect(asset?.download_url ?? "").toMatch(/\/assets\/v1\//);
      expect(asset?.expires_at ?? "").toMatch(/T/);

      const search = await request(app)
        .post("/mcp")
        .set("Origin", "http://127.0.0.1:3377")
        .set("MCP-Protocol-Version", "2025-11-25")
        .set("Accept", "application/json, text/event-stream")
        .send({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "search_stickers",
            arguments: {
              query: "happy",
              channel: { platform: "telegram", profile: "telegram-bot", conversation_type: "direct" },
              locale: "en",
              limit: 5
            }
          }
        })
        .expect(200);
      const searchResults = (search.body.result?.structuredContent as { results: Array<{ sticker_id: string }> }).results;
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0]?.sticker_id).toBe(sticker.id);
    } finally {
      await test.cleanup();
    }
  });

  it("rejects MCP requests from disallowed origins", async () => {
    const test = await createTestRuntime();
    const app = createHttpApp(test.runtime);
    try {
      await request(app)
        .post("/mcp")
        .set("Origin", "https://attacker.example")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list" })
        .expect(403);
    } finally {
      await test.cleanup();
    }
  });
});
