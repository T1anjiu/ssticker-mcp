import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QqOfficialAdapter, TelegramBotAdapter, WeChatOfficialAccountAdapter, WeComWebhookAdapter } from "../src/adapters/index.js";
import type { AssetVariant } from "../src/domain/types.js";
import { sha256 } from "../src/utils.js";

describe("channel reference adapters", () => {
  const bytes = Buffer.from("verified-sticker-bytes");
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  const requests: string[] = [];

  beforeEach(async () => {
    requests.length = 0;
    server = createServer((request, response) => {
      requests.push(request.url ?? "");
      if (request.url === "/asset") {
        response.writeHead(200, { "content-type": "image/png", "content-length": bytes.length });
        response.end(bytes);
        return;
      }
      if (request.url?.includes("/files")) {
        request.resume();
        request.on("end", () => response.end(JSON.stringify({ file_info: "qq-file-info" })));
        return;
      }
      if (request.url?.includes("media/upload")) {
        request.resume();
        request.on("end", () => response.end(JSON.stringify({ media_id: "wechat-media" })));
        return;
      }
      if (request.url?.includes("custom/send")) {
        request.resume();
        request.on("end", () => response.end(JSON.stringify({ errcode: 0, msgid: 123 })));
        return;
      }
      request.resume();
      request.on("end", () => response.end(JSON.stringify(request.url?.startsWith("/bottoken/") ? { ok: true, result: { message_id: 42 } } : request.url === "/wecom" ? { errcode: 0 } : { id: "qq-message" })));
    });
    await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  });

  it("delivers with Telegram Bot API", async () => {
    const adapter = new TelegramBotAdapter({ botToken: "token", apiBaseUrl: baseUrl });
    const result = await adapter.deliver(action("sendSticker"), { conversation_id: "c", target_id: "chat" });
    expect(result).toEqual({ outcome: "sent", platform_message_id: "42" });
    expect(requests).toContain("/bottoken/sendSticker");
  });

  it("delivers with a WeCom webhook", async () => {
    const adapter = new WeComWebhookAdapter({ webhookUrl: `${baseUrl}/wecom` });
    expect(await adapter.deliver(action("sendImage"), { conversation_id: "c", target_id: "ignored" })).toEqual({ outcome: "sent" });
    expect(requests).toContain("/asset");
    expect(requests).toContain("/wecom");
  });

  it("uploads and sends with QQ official bot", async () => {
    const adapter = new QqOfficialAdapter({ accessToken: "access", targetType: "group", apiBaseUrl: baseUrl });
    const result = await adapter.deliver(action("postMessage"), { conversation_id: "c", target_id: "g" });
    expect(result).toEqual({ outcome: "sent", platform_message_id: "qq-message" });
    expect(requests).toEqual(expect.arrayContaining(["/asset", "/v2/groups/g/files", "/v2/groups/g/messages"]));
  });

  it("uploads and sends with a WeChat official account", async () => {
    const adapter = new WeChatOfficialAccountAdapter({ getAccessToken: async () => "wechat-token", apiBaseUrl: baseUrl });
    const result = await adapter.deliver(action("sendCustomImage"), { conversation_id: "c", target_id: "openid" });
    expect(result).toEqual({ outcome: "sent", platform_message_id: "123" });
    expect(requests.some((path) => path.includes("media/upload"))).toBe(true);
    expect(requests.some((path) => path.includes("custom/send"))).toBe(true);
  });

  function action(method: string): AssetVariant {
    return {
      variant_id: "variant-1",
      sticker_id: "sticker-1",
      title: "Test",
      alt_text: { "zh-CN": "测试", en: "test" },
      delivery_kind: "image",
      mime_type: "image/png",
      width: 32,
      height: 32,
      duration_ms: null,
      bytes: bytes.length,
      sha256: sha256(bytes),
      resource_uri: "ssticker://stickers/sticker-1",
      download_url: `${baseUrl}/asset`,
      expires_at: new Date(Date.now() + 300000).toISOString(),
      channel_hint: { adapter: "test", method }
    };
  }
});
