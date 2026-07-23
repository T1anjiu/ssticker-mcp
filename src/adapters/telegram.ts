import type { AssetVariant, ChannelAdapter, DeliveryContext, DeliveryOutcome } from "../domain/types.js";
import { responseJson } from "./common.js";

export interface TelegramAdapterOptions {
  botToken: string;
  apiBaseUrl?: string;
}

export class TelegramBotAdapter implements ChannelAdapter {
  readonly profileId = "telegram-bot";
  private readonly baseUrl: string;

  constructor(private readonly options: TelegramAdapterOptions) {
    this.baseUrl = (options.apiBaseUrl ?? "https://api.telegram.org").replace(/\/$/, "");
  }

  async deliver(action: AssetVariant, context: DeliveryContext): Promise<DeliveryOutcome> {
    const method = action.channel_hint.method;
    const payload = this.payloadFor(method, action, context);
    const first = await this.call(method, payload);
    if (first.ok) {
      return { outcome: "sent", platform_message_id: readMessageId(first.body) };
    }
    const fallback = action.channel_hint.fallback_method;
    if (fallback && fallback !== method) {
      const second = await this.call(fallback, this.payloadFor(fallback, action, context));
      if (second.ok) {
        return { outcome: "sent", platform_message_id: readMessageId(second.body) };
      }
      return { outcome: "failed", failure_code: `telegram_${second.status}` };
    }
    return { outcome: "failed", failure_code: `telegram_${first.status}` };
  }

  private payloadFor(method: string, action: AssetVariant, context: DeliveryContext): Record<string, unknown> {
    const field = method === "sendSticker" ? "sticker" : method === "sendAnimation" ? "animation" : "photo";
    return {
      chat_id: context.target_id,
      [field]: action.download_url,
      ...(context.reply_to_message_id ? { reply_parameters: { message_id: Number(context.reply_to_message_id) } } : {})
    };
  }

  private async call(method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${this.baseUrl}/bot${this.options.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    });
    return { ok: response.ok, status: response.status, body: await responseJson(response) };
  }
}

function readMessageId(body: Record<string, unknown>): string | undefined {
  const result = body.result;
  if (typeof result === "object" && result !== null && "message_id" in result) {
    return String((result as { message_id: unknown }).message_id);
  }
  return undefined;
}
