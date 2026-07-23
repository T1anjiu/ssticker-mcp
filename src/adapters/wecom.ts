import { createHash } from "node:crypto";
import type { AssetVariant, ChannelAdapter, DeliveryContext, DeliveryOutcome } from "../domain/types.js";
import { downloadVerifiedAsset, responseJson } from "./common.js";

export interface WeComWebhookAdapterOptions {
  webhookUrl: string;
}

export class WeComWebhookAdapter implements ChannelAdapter {
  readonly profileId = "wecom-webhook";

  constructor(private readonly options: WeComWebhookAdapterOptions) {}

  async deliver(action: AssetVariant, _context: DeliveryContext): Promise<DeliveryOutcome> {
    try {
      const buffer = await downloadVerifiedAsset(action, 2 * 1024 * 1024);
      const response = await fetch(this.options.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          msgtype: "image",
          image: {
            base64: buffer.toString("base64"),
            md5: createHash("md5").update(buffer).digest("hex")
          }
        }),
        signal: AbortSignal.timeout(10_000)
      });
      const body = await responseJson(response);
      const errcode = typeof body.errcode === "number" ? body.errcode : response.ok ? 0 : response.status;
      return errcode === 0 ? { outcome: "sent" } : { outcome: "failed", failure_code: `wecom_${errcode}` };
    } catch (error) {
      return { outcome: "failed", failure_code: error instanceof Error ? "wecom_asset_or_network" : "wecom_unknown" };
    }
  }
}
