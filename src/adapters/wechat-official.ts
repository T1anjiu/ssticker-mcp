import type { AssetVariant, ChannelAdapter, DeliveryContext, DeliveryOutcome } from "../domain/types.js";
import { downloadVerifiedAsset, responseJson } from "./common.js";

export interface WeChatOfficialAccountAdapterOptions {
  getAccessToken: () => Promise<string>;
  apiBaseUrl?: string;
}

export class WeChatOfficialAccountAdapter implements ChannelAdapter {
  readonly profileId = "wechat-official-account";
  private readonly baseUrl: string;

  constructor(private readonly options: WeChatOfficialAccountAdapterOptions) {
    this.baseUrl = (options.apiBaseUrl ?? "https://api.weixin.qq.com").replace(/\/$/, "");
  }

  async deliver(action: AssetVariant, context: DeliveryContext): Promise<DeliveryOutcome> {
    try {
      const accessToken = await this.options.getAccessToken();
      const mediaId = await this.uploadTemporaryMedia(action, accessToken);
      const response = await fetch(`${this.baseUrl}/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ touser: context.target_id, msgtype: "image", image: { media_id: mediaId } }),
        signal: AbortSignal.timeout(10_000)
      });
      const body = await responseJson(response);
      const errcode = typeof body.errcode === "number" ? body.errcode : response.ok ? 0 : response.status;
      return errcode === 0 ? { outcome: "sent", platform_message_id: typeof body.msgid === "number" ? String(body.msgid) : undefined } : { outcome: "failed", failure_code: `wechat_${errcode}` };
    } catch {
      return { outcome: "failed", failure_code: "wechat_asset_or_network" };
    }
  }

  private async uploadTemporaryMedia(action: AssetVariant, accessToken: string): Promise<string> {
    const buffer = await downloadVerifiedAsset(action, 10 * 1024 * 1024);
    const form = new FormData();
    form.set("media", new Blob([new Uint8Array(buffer)], { type: action.mime_type }), `${action.sticker_id}.${action.mime_type === "image/png" ? "png" : "jpg"}`);
    const response = await fetch(`${this.baseUrl}/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=image`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(15_000)
    });
    const body = await responseJson(response);
    if (!response.ok || typeof body.media_id !== "string") {
      throw new Error(`Temporary media upload failed with HTTP ${response.status}`);
    }
    return body.media_id;
  }
}
