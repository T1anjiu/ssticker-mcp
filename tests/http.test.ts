import request from "supertest";
import { describe, expect, it } from "vitest";
import { createHttpApp } from "../src/http/app.js";
import { createTestRuntime, importActiveSticker } from "./helpers.js";

describe("HTTP service", () => {
  it("serves health, rejects invalid origins, and uses JSON 405 errors", async () => {
    const test = await createTestRuntime();
    try {
      const app = createHttpApp(test.runtime);
      await request(app).get("/health/ready").expect(200).expect((response) => expect(response.body.status).toBe("ready"));
      await request(app).get("/mcp").expect(405).expect((response) => expect(response.body.jsonrpc).toBe("2.0"));
      await request(app).post("/mcp").set("Origin", "https://evil.example").send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }).expect(403);
      await request(app).post("/mcp").set("Origin", "http://127.0.0.1:3377").set("MCP-Protocol-Version", "1900-01-01").send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }).expect(400);
    } finally {
      await test.cleanup();
    }
  });

  it("authenticates admin sessions and enforces CSRF", async () => {
    const test = await createTestRuntime();
    try {
      const created = await test.runtime.auth.createAdminToken("test-admin");
      const agent = request.agent(createHttpApp(test.runtime));
      const login = await agent.post("/api/v1/admin/session").send({ token: created.token }).expect(200);
      const csrf = login.body.csrf_token as string;
      await agent.get("/api/v1/admin/overview").expect(200);
      await agent.patch("/api/v1/admin/policies/default").send({ auto_threshold: 0.84 }).expect(403);
      const updated = await agent.patch("/api/v1/admin/policies/default").set("X-CSRF-Token", csrf).send({ auto_threshold: 0.84 }).expect(200);
      expect(updated.body.auto_threshold).toBe(0.84);
      expect(updated.body.version).toBe(2);
    } finally {
      await test.cleanup();
    }
  });

  it("serves a valid signed processed asset and rejects expired signatures", async () => {
    const test = await createTestRuntime();
    try {
      const sticker = await importActiveSticker(test);
      const variant = test.runtime.database.getStickerVariants(sticker.id)[0]!;
      const signed = test.runtime.assets.sign(variant.id, 300, Date.now());
      const url = new URL(signed.downloadUrl);
      const app = createHttpApp(test.runtime);
      const response = await request(app).get(`${url.pathname}${url.search}`).expect(200);
      expect(response.headers["content-type"]).toBe(variant.mime_type);
      const expired = test.runtime.assets.sign(variant.id, -1, Date.now());
      const expiredUrl = new URL(expired.downloadUrl);
      await request(app).get(`${expiredUrl.pathname}${expiredUrl.search}`).expect(403);
    } finally {
      await test.cleanup();
    }
  });
});
