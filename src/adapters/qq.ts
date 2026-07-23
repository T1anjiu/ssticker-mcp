import type { AssetVariant, ChannelAdapter, DeliveryContext, DeliveryOutcome } from "../domain/types.js";
import { downloadVerifiedAsset, responseJson } from "./common.js";

export interface QqOfficialAdapterOptions {
  accessToken: string;
  targetType: "channel" | "group" | "user";
  appId?: string;
  apiBaseUrl?: string;
}

export class QqOfficialAdapter implements ChannelAdapter {
  readonly profileId = "qq-official";
  private readonly baseUrl: string;

  constructor(private readonly options: QqOfficialAdapterOptions) {
    this.baseUrl = (options.apiBaseUrl ?? "https://api.sgroup.qq.com").replace(/\/$/, "");
  }

  async deliver(action: AssetVariant, context: DeliveryContext): Promise<DeliveryOutcome> {
    try {
      const media = await this.uploadMedia(action, context.target_id);
      const endpoint = this.messageEndpoint(context.target_id);
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: this.headers("application/json"),
        body: JSON.stringify({
          msg_type: 7,
          media: { file_info: media.file_info },
          ...(context.reply_to_message_id ? { msg_id: context.reply_to_message_id } : {})
        }),
        signal: AbortSignal.timeout(10_000)
      });
      const body = await responseJson(response);
      return response.ok
        ? { outcome: "sent", platform_message_id: typeof body.id === "string" ? body.id : undefined }
        : { outcome: "failed", failure_code: `qq_${response.status}` };
    } catch (error) {
      return { outcome: "failed", failure_code: error instanceof Error ? `qq_${normalizeCode(error.message)}` : "qq_unknown" };
    }
  }

  private async uploadMedia(action: AssetVariant, targetId: string): Promise<{ file_info: string }> {
    const buffer = await downloadVerifiedAsset(action, 10 * 1024 * 1024);
    const endpoint = this.fileEndpoint(targetId);
    const form = new FormData();
    form.set("file_type", "1");
    form.set("srv_send_msg", "false");
    form.set("file_data", new Blob([new Uint8Array(buffer)], { type: action.mime_type }), `${action.sticker_id}.${extensionFor(action.mime_type)}`);
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(15_000)
    });
    const body = await responseJson(response);
    if (!response.ok || typeof body.file_info !== "string") {
      throw new Error(`upload_${response.status}`);
    }
    return { file_info: body.file_info };
  }

  private headers(contentType?: string): Record<string, string> {
    return {
      authorization: `QQBot ${this.options.accessToken}`,
      ...(this.options.appId ? { "x-union-appid": this.options.appId } : {}),
      ...(contentType ? { "content-type": contentType } : {})
    };
  }

  private fileEndpoint(targetId: string): string {
    return this.options.targetType === "group" ? `/v2/groups/${encodeURIComponent(targetId)}/files`
      : this.options.targetType === "user" ? `/v2/users/${encodeURIComponent(targetId)}/files`
      : `/channels/${encodeURIComponent(targetId)}/files`;
  }

  private messageEndpoint(targetId: string): string {
    return this.options.targetType === "group" ? `/v2/groups/${encodeURIComponent(targetId)}/messages`
      : this.options.targetType === "user" ? `/v2/users/${encodeURIComponent(targetId)}/messages`
      : `/channels/${encodeURIComponent(targetId)}/messages`;
  }
}

function extensionFor(mimeType: string): string {
  return mimeType === "image/png" ? "png" : mimeType === "image/gif" ? "gif" : "jpg";
}

function normalizeCode(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 64);
}
