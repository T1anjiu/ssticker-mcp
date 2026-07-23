# Changelog

All notable changes to ssticker-mcp are tracked here. Versions follow
[SemVer](https://semver.org/). Until 1.0, releases are pre-1.0 and the public
MCP contract (`recommend_sticker`, `search_stickers`, `get_sticker_asset`,
`report_sticker_outcome`, the three `ssticker://` resources, and reason_codes)
is frozen between minor bumps.

## Unreleased

Nothing yet.

## 0.1.0-alpha.0 (2026-07-20)

First public alpha. Covers the runnable skeleton for phases 0-6 of the project
plan and ships the full public release process (LICENSE, NOTICE, third-party
notices, security policy, code of conduct, contributing guide, multi-arch
container build, dependabot).

### Scope

This release is alpha. Production deploys must:

- terminate TLS at a reverse proxy in front of the service;
- set `SSTICKER_AUTH_MODE=oidc` plus `SSTICKER_OIDC_*` per the production
  compose file;
- regenerate `SSTICKER_SIGNING_SECRET` and `SSTICKER_SESSION_SECRET` to
  >=32 random bytes each;
- pre-download the embedding model with `ssticker models pull` and verify
  the `intfloat/multilingual-e5-small` model card licensing.

Out of scope for 0.1 (deliberately):

- direct platform send calls inside the MCP service (credentials stay in the
  adapter process);
- real-time web search or AI-generated stickers;
- personal WeChat / OneBot adapters;
- TGS / WebM / APNG native pipelines;
- multi-tenant billing, horizontal scaling, persistent user profiles;
- auto-publishing of unreviewed assets.

### Added

- MCP server implementing Model Context Protocol `2025-11-25`, with both
  Streamable HTTP (`POST /mcp`) and stdio transports.
- Four tools (`recommend_sticker`, `search_stickers`, `get_sticker_asset`,
  `report_sticker_outcome`) and three resources (`ssticker://scenes`,
  `ssticker://stickers/{id}`, `ssticker://policies/{profile}`), all returning
  `outputSchema`-validated `structuredContent` plus a text fallback for older
  clients.
- Bilingual scene taxonomy (27 scenes) with stable IDs, Chinese + English
  labels, keyword lists, and explicit negative keywords.
- Hybrid retrieval: SQLite FTS5 keyword recall + `sqlite-vec` vector recall
  with reciprocal rank fusion. Default local embedding
  `intfloat/multilingual-e5-small` (384d), with a deterministic hash fallback
  for offline / degraded operation.
- Optional OpenAI-compatible LLM classifier that activates only at ambiguous
  confidence, with a 1.5s timeout and graceful fallback.
- Media pipeline: Sharp for PNG / JPEG / WebP, ffmpeg for GIF. Produces
  `image`, `sticker`, and `animation` variants per channel profile.
- Channel Adapter SDK plus four reference adapters: Telegram Bot API, QQ
  Official Bot, WeCom group webhook, WeChat Official Account customer-service.
  Credentials live only in the adapter process.
- React + Vite operations console with Argon2id admin token login, CSRF
  cookies, sticker catalog browsing, upload, review, scene and policy editing,
  decision log, system status, responsive layout, and axe-grade accessibility.
- Auth service supporting loopback development (`none`) and OIDC/JWKS for
  production with RFC 9728 Protected Resource Metadata. Refuses to bind a
  non-loopback address without OIDC unless `SSTICKER_ALLOW_INSECURE_REMOTE`
  is set explicitly.
- HMAC-SHA256 signed asset URLs with a five-minute TTL and 403 on expired
  signatures.
- IP and subject rate limits, per-event audit trail, structured pino logs
  with explicit redaction of `messages`, `session_id`, `download_url`,
  `apiKey`, and `token`.
- Decision and outcome events with TTL-bound retention (default 24h);
  outcome feedback only affects session-scoped suppression and aggregate
  metrics, never silently rewrites global ranking.
- CLI commands: `init`, `models pull`, `catalog import|validate|review|export`,
  `index rebuild`, `serve`, `mcp --stdio`, `admin token create|revoke`,
  `backup create|restore`, `doctor`.
- 460-case bilingual evaluation corpus with five quality gates.
- 50k-sticker benchmark harness reporting p50 / p95 / p99 latency, error rate,
  and throughput.
- Docker Compose deployment (development `compose.yaml` and production
  `compose.prod.yaml`) plus a multi-arch (`linux/amd64,linux/arm64`) container
  workflow with Trivy scanning and SBOM.
- English and Chinese READMEs, dedicated adapter / deployment / privacy
  documentation, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
  issue and pull-request templates, and dependabot configuration.
- `NOTICE` plus an auto-generated `THIRD-PARTY-NOTICES.md` validated against
  `pnpm-lock.yaml` by `pnpm run licenses:check`.

### Test gates

- `pnpm run typecheck`: passes.
- `pnpm run lint`: passes.
- `pnpm run test`: 24 / 24 unit + integration tests passing (added
  `tests/mcp-http.test.ts` for HTTP MCP end-to-end).
- `pnpm run test:e2e`: 2 / 2 Playwright tests passing (desktop + mobile
  Chromium with axe a11y).
- `pnpm run eval`: all five quality gates pass on this release
  (serious wrong auto-sends 0; precision@1 100%; explicit recall@5 100%;
  compatible-variant coverage 100%; ordinary wrong auto-sends 0).
- `pnpm run benchmark`: 50k stickers, p95 ~ 130ms, p99 ~ 138ms, error rate
  0%, throughput ~ 8 QPS sustained.
- `pnpm run licenses:check`: pass against the current lockfile.

### CI

- `verify` job: install with frozen lockfile, `licenses:check`, `check`
  (lint + typecheck + test + build), and `eval`.
- `audit` job: `pnpm audit --prod --audit-level=high` blocks merges on
  new high-severity advisories.
- `windows-smoke` job: build, unit tests, and the eval gate on
  `windows-latest` so PowerShell contributors reproduce the documented
  commands.
- `admin-e2e` job: Playwright + axe on Ubuntu, with `playwright-report`
  uploaded on failure.
- `container` workflow: multi-arch build + push to GHCR on tag, with
  OCI metadata, Trivy HIGH/CRITICAL gating, and SBOM.

### Notes

- The benchmark script was hardened so `runtime.database.createSticker`
  returns the full record while the seed loop extracts `.id` explicitly.
  This removes the silent `RangeError: Too few parameter values` that
  affected earlier runs.
- Admin navigation links received explicit `aria-label` so screen readers
  can identify them when the sidebar collapses to icons on mobile
  breakpoints.
- Login screen button label changed from `??` to `?????` to match the e2e
  selector and convey the action more clearly.
- README configuration tables previously rendered `SSTICKER_PUBLIC_BASE_URL`
  defaults as a PowerShell-internal host string in some renderers; the
  defaults are now explicit (`http://127.0.0.1:3377`) and the doc stresses
  that non-loopback deploys must override them.
