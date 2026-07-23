# ssticker-mcp

[中文文档](README.zh-CN.md)

[![CI](https://img.shields.io/github/actions/workflow/status/T1anjiu/ssticker-mcp/ci.yml?branch=main&style=flat-square&logo=github&label=ci)](https://github.com/T1anjiu/ssticker-mcp/actions/workflows/ci.yml)
[![Container](https://img.shields.io/github/actions/workflow/status/T1anjiu/ssticker-mcp/container.yml?branch=main&style=flat-square&logo=docker&label=container)](https://github.com/T1anjiu/ssticker-mcp/actions/workflows/container.yml)
[![Release](https://img.shields.io/github/v/release/T1anjiu/ssticker-mcp?style=flat-square&include_prereleases&sort=semver)](https://github.com/T1anjiu/ssticker-mcp/releases)
[![License](https://img.shields.io/github/license/T1anjiu/ssticker-mcp?style=flat-square)](https://github.com/T1anjiu/ssticker-mcp/blob/main/LICENSE)
[![MCP protocol](https://img.shields.io/badge/MCP-2025--11--25-blue?style=flat-square)](https://modelcontextprotocol.io)
[![Node >= 24](https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)

> A self-hosted, context-aware MCP server that recommends safe chat stickers. When a channel (WeChat / QQ / Telegram / etc.) hands recent dialogue to the AI, the AI calls ssticker-mcp. The service identifies the scene, tone, and safety risk, then returns either a channel-compatible sticker delivery action or an explicit skip decision.

## Capabilities

- MCP: Streamable HTTP and stdio. Implements the Model Context Protocol 2025-11-25.
- 4 tools + 3 resources: recommend_sticker, search_stickers, get_sticker_asset, report_sticker_outcome plus ssticker://scenes, ssticker://stickers/{id}, ssticker://policies/{profile}.
- Bilingual scenes: scene detection, serious / sensitive regex blocking, explicit request recognition, direct / group cooldowns, recent-duplicate suppression.
- Hybrid retrieval: SQLite FTS5 keyword recall + sqlite-vec vector recall with RRF fusion. Local embedding defaults to intfloat/multilingual-e5-small, with a hash fallback for offline / degraded mode.
- Optional LLM: OpenAI-compatible classifier (Ollama, vLLM, hosted). Used only when confidence is ambiguous; timeouts / failures gracefully fall back to rule-based scoring.
- Media pipeline: Sharp for static PNG / JPEG / WebP, ffmpeg for GIF. Produces image, sticker, and animation variants per channel profile.
- Channel SDK: abstract ChannelAdapter, four reference adapters, mock + payload snapshot tests.
- Operations console: React + Vite admin UI with Argon2id admin token login, CSRF, sticker catalog, uploads, scene and policy editing, decision log, system status.
- Security: Origin checks, OIDC / JWKS (RFC 9728 Protected Resource Metadata), HMAC-SHA256 signed asset URLs, IP + subject rate limits, audit log. Non-loopback binding requires OIDC unless explicitly opted-in.
- Privacy: raw conversation never persisted; session_id is HMAC-stamped before being written; sentinel-based privacy tests verify DB, logs, metrics, and error traces contain no plaintext.

## Install

Requires Node.js 24+ and pnpm.

`ash
pnpm install
pnpm run build
`

## First run

`ash
pnpm exec ssticker init
pnpm exec ssticker models pull
pnpm exec ssticker demo:generate
pnpm exec ssticker catalog import examples/manifest.yaml
pnpm exec ssticker catalog validate
pnpm exec ssticker index rebuild
pnpm exec ssticker serve
`

Create an admin token and paste it into the login screen:

`ash
pnpm exec ssticker admin token create local-admin
`

## MCP client wiring

### Streamable HTTP (recommended)

`json
{
  "mcpServers": {
    "ssticker": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3377/mcp"
    }
  }
}
`

For non-loopback deployments switch SSTICKER_AUTH_MODE to oidc and send Bearer tokens. Protected Resource Metadata is served at GET /.well-known/oauth-protected-resource/mcp.

### stdio

`json
{
  "mcpServers": {
    "ssticker": {
      "command": "ssticker",
      "args": ["mcp", "--stdio"]
    }
  }
}
`

stdio also starts a loopback asset server so signed URLs keep working.

## Tools

| Tool | Required scope | What it returns |
| --- | --- | --- |
| recommend_sticker | ssticker.recommend | action: send|skip, scene, reason_codes, optional asset with 5-minute signed URL |
| search_stickers | ssticker.catalog.read | catalog matches (no automatic-send cooldowns applied) |
| get_sticker_asset | ssticker.catalog.read | refreshed asset with new signed URL |
| report_sticker_outcome | ssticker.feedback | { accepted, duplicate, decision_id } (idempotent on outcome_event_id) |

reason_codes semantics: matched, explicit_request, low_confidence, ambiguous_scene, serious_context, safety_blocked, cooldown_active, recent_duplicate, no_compatible_asset, catalog_empty, model_unavailable, invalid_context.

## Channel adapters

ChannelAdapter (see src/adapters/common.ts) takes an AssetVariant and a DeliveryContext and returns a DeliveryOutcome. The repo ships four reference implementations:

- src/adapters/telegram.ts - Telegram Bot API sendSticker / sendAnimation / sendPhoto.
- src/adapters/qq.ts - QQ Official Bot SDK.
- src/adapters/wecom.ts - WeCom group-bot webhook.
- src/adapters/wechat-official.ts - WeChat Official Account customer-service messages.

All credentials are loaded from adapter-only environment variables - they never enter the MCP service.

## Evaluation and benchmark

`ash
pnpm run eval       # 460 bilingual conversations, 5 quality gates
pnpm run benchmark  # 50k stickers, p95 / p99 / error rate
`

Current `pnpm run eval` results on a developer laptop (hash embedding, no LLM). The numbers below are reproducible; rerun `pnpm run eval` to verify:

- serious-context wrong auto-sends: 0
- automatic precision@1: 100%
- explicit recall@5: 100%
- compatible-variant coverage: 100%

Current pnpm run benchmark (50k stickers, 384d vectors, 300 recommendations):

- p50 ~ 118ms, p95 ~ 130ms, p99 ~ 138ms
- error rate: 0%
- throughput: ~ 8 QPS (sustained, sequential)

## Tests and quality

`ash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:e2e
pnpm run check
`

## Deployment

### Docker Compose

`ash
docker compose up -d
`

Default SSTICKER_AUTH_MODE=none is for development only. Set it to oidc plus SSTICKER_OIDC_* for any non-loopback production deploy.

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| SSTICKER_HOST / SSTICKER_PORT | Bind address | 127.0.0.1:3377 |
| SSTICKER_DATA_DIR | SQLite, assets, model cache root | ./data |
| SSTICKER_PUBLIC_BASE_URL | Public URL used inside signed URLs. **Required for non-loopback deploys.** | `http://127.0.0.1:3377` |
| SSTICKER_ALLOWED_ORIGINS | Comma-separated allowed origins | same as base URL |
| SSTICKER_AUTH_MODE | none / oidc | none |
| SSTICKER_OIDC_ISSUER / _AUDIENCE / _JWKS_URL | OIDC resource server | - |
| SSTICKER_EMBEDDING_PROVIDER | local / hash | local |
| SSTICKER_MODEL_ID | Local embedding model | intfloat/multilingual-e5-small |
| SSTICKER_LLM_BASE_URL / _API_KEY / _MODEL | Optional LLM classifier | - |
| SSTICKER_LOG_LEVEL | silent / info / debug | info |
| SSTICKER_ALLOW_INSECURE_REMOTE | Dangerous dev escape hatch | false |

See .env.example for the full list.

## Project layout

`
src/adapters/   Channel Adapter SDK + reference adapters
src/db/         Drizzle schema + SQLite + sqlite-vec
src/domain/     Types, Zod schemas, scene definitions
src/http/       Express 5 + MCP Streamable HTTP + admin API
src/mcp/        MCP tool / resource registration
src/services/   Catalog, Decision, Embedding, LLM, Media, Metrics, Auth
src/cli.ts      CLI entry
src/config.ts   Env vars and defaults
src/runtime.ts  Composition root: createRuntime()
src/utils.ts    ID, signing, vectors, hashing
apps/admin/     React + Vite operations console
profiles/       Default channel / policy configuration
examples/       Demo assets + manifest
scripts/        generate-demo / generate-eval / evaluate / benchmark / e2e-server
tests/          Vitest unit + integration
e2e/            Playwright + axe admin validation
`

## Privacy commitments

- Raw conversation is never written to SQLite, logs, /metrics, or /health responses.
- session_id is HMAC-stamped with the server secret before being written to decision events.
- pino redaction automatically strips messages, session_id, token, apiKey, and download_url.
- Feedback only affects session-scoped suppression and aggregate metrics; it never silently rewrites global ranking.
- The admin console never replays original conversations; the decision log only stores scene id, reason codes, timestamps, and feedback aggregates.

## Roadmap

0.1 alpha already covers the runnable skeleton for phases 0-6 of the plan. Follow-ups: multi-tenant + PostgreSQL / pgvector migration path (same MCP contract), TGS / WebM / APNG channel extensions, OneBot / personal WeChat plugins (out of scope for v0.1), online re-ranking with explicit user consent.

## License

Apache-2.0 for code. Imported sticker assets retain their respective licenses.
