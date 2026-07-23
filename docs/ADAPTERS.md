# Channel Adapter SDK

ssticker-mcp only decides send/skip and selects an asset. The actual platform API call is performed by a channel adapter that lives outside this repository (or in src/adapters/*.ts as a reference implementation).

## Interface

```ts
import type { ChannelAdapter, AssetVariant, DeliveryContext, DeliveryOutcome } from "ssticker-mcp/adapters";

class MyAdapter implements ChannelAdapter {
  readonly profileId = "my-channel";
  async deliver(action: AssetVariant, context: DeliveryContext): Promise<DeliveryOutcome> {
    // download action.download_url, call platform API, map errors
    return { outcome: "sent", platform_message_id: "..." };
  }
}
```

## Data shapes

- AssetVariant: contains download_url (5-minute HMAC), mime_type, delivery_kind (sticker / image / animation), width / height / duration_ms, channel_hint.method plus optional fallback_method, and alt_text keyed by locale.
- DeliveryContext: { conversation_id, target_id, reply_to_message_id? }. The original session_id is never sent to the adapter.
- DeliveryOutcome: { outcome: "sent" | "skipped" | "failed" | "rejected", platform_message_id?, failure_code? }.

## Failure and reporting

- Platform 4xx / 5xx, network errors, timeouts: return outcome: "failed" with failure_code.
- Business-level rejection (e.g. group rule filtered): return outcome: "rejected".
- After delivery, call MCP tool report_sticker_outcome with the same outcome_event_id for idempotency.

## Credentials

- All credentials (bot tokens, app secrets, webhook URLs) are loaded only by the adapter process. Recommended naming: SSTICKER_ADAPTER_<id>_<KEY>.
- The MCP service itself never receives or persists these variables.

## Reference implementations

- Telegram Bot: src/adapters/telegram.ts - sendSticker / sendAnimation / sendPhoto.
- QQ Official Bot: src/adapters/qq.ts - SDK calls to postMessage with image / sticker.
- WeCom group webhook: src/adapters/wecom.ts - markdown / image webhook.
- WeChat Official Account: src/adapters/wechat-official.ts - sendCustomImage customer-service message.

## Channel capabilities

Channel limits are declared in profiles/channel-profiles.json. Each accepted[] entry specifies the supported mime_type / delivery_kind, size and dimension caps, duration caps, and the preferred method + fallback_method.

Edit profiles/channel-profiles.json to customise defaults. The repository ships five: generic, telegram-bot, qq-official, wecom-webhook, wechat-official-account.

## Testing

`pnpm run test` runs tests/adapters.test.ts, which covers every reference adapter with mocks and payload snapshots.
