# Deployment

## Local development

```bash
pnpm install
pnpm run build
pnpm exec ssticker init
pnpm exec ssticker serve
```

Default binding is loopback only (`127.0.0.1:3377`). The auth mode is `none` for development; the service refuses non-loopback binding without OIDC unless `SSTICKER_ALLOW_INSECURE_REMOTE=true` is set explicitly.

## Docker Compose (single service, single volume)

```bash
docker compose up -d   # development (auth=none, loopback only)
docker compose -f compose.prod.yaml --env-file .env up -d   # production (OIDC required)
```

compose.yaml (development) mounts ./data into the container and exposes port 3377. compose.yaml is for local development only (auth=none, ALLOW_INSECURE_REMOTE=true, port 127.0.0.1:3377). For production use compose.prod.yaml: it requires SSTICKER_AUTH_MODE=oidc plus SSTICKER_OIDC_* and SSTICKER_*_SECRET, refuses to start without them, binds only to the internal Docker network, and must sit behind a TLS-terminating reverse proxy.

## Reverse proxy

`/mcp` (Streamable HTTP) and `/api/v1/admin/*` benefit from HTTP/1.1 keep-alive or HTTP/2. Helmet is on by default. Mount the `/admin` SPA behind the same TLS termination; the SPA has no additional CSP requirements because it ships only static assets.

## Production checklist

- [ ] TLS termination at the reverse proxy (Nginx, Caddy, Cloudflare, etc.).
- [ ] SSTICKER_AUTH_MODE=oidc with SSTICKER_OIDC_ISSUER, SSTICKER_OIDC_AUDIENCE, SSTICKER_OIDC_JWKS_URL.
- [ ] SSTICKER_PUBLIC_BASE_URL set to the public HTTPS URL.
- [ ] SSTICKER_ALLOWED_ORIGINS includes the public URL.
- [ ] SSTICKER_SIGNING_SECRET and SSTICKER_SESSION_SECRET regenerated (>=32 random bytes each).
- [ ] Regular `pnpm exec ssticker backup create` snapshots shipped off-host.
- [ ] Optional: pre-download the embedding model with `pnpm exec ssticker models pull` so cold starts do not fetch it.
- [ ] Optional: enable the OpenAI-compatible LLM classifier (SSTICKER_LLM_BASE_URL / _API_KEY / _MODEL).

## Backup and restore

```bash
pnpm exec ssticker backup create ./backups/snapshot-2026-07-20
pnpm exec ssticker backup restore ./backups/snapshot-2026-07-20
```

Backup writes a copy of the entire data directory plus a `backup.json` describing the snapshot. Restore moves the existing data directory aside, then copies the snapshot into place.

## Migration path to PostgreSQL / S3

The plan calls for staying on SQLite + local files up to 50k stickers and 20 QPS. Beyond that, swap the storage backend (Storage interface in src/services/storage.ts) and the database (Drizzle migrations) for PostgreSQL + pgvector + S3-compatible object storage. The MCP tool contract, the ChannelAdapter interface, and the asset URL signing scheme are unchanged, so adapters and clients do not need to change.
