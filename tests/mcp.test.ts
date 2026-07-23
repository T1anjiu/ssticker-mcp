import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createSStickerMcpServer } from "../src/mcp/server.js";
import { createTestRuntime } from "./helpers.js";

describe("MCP contract", () => {
  it("lists all tools and resources and returns structured skip output", async () => {
    const test = await createTestRuntime();
    const server = createSStickerMcpServer(test.runtime);
    const client = new Client({ name: "ssticker-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["get_sticker_asset", "recommend_sticker", "report_sticker_outcome", "search_stickers"]);
      const templates = await client.listResourceTemplates();
      expect(templates.resourceTemplates.map((template) => template.uriTemplate)).toEqual(expect.arrayContaining(["ssticker://stickers/{sticker_id}", "ssticker://policies/{profile}"]));
      const scenes = await client.readResource({ uri: "ssticker://scenes" });
      expect(scenes.contents[0]?.mimeType).toBe("application/json");

      const result = await client.callTool({
        name: "recommend_sticker",
        arguments: {
          request_id: "mcp-request-1",
          session_id: "mcp-session-1",
          mode: "auto",
          channel: { platform: "generic", profile: "generic", conversation_type: "direct" },
          locale: "zh-CN",
          messages: [{ role: "user", text: "普通的一句话" }]
        }
      });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({ action: "skip", reason_codes: ["catalog_empty"] });
    } finally {
      await client.close();
      await server.close();
      await test.cleanup();
    }
  });
});
