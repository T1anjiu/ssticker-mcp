# Contributing to ssticker-mcp

Thanks for your interest in ssticker. The project is in 0.1.0-alpha; the public
MCP contract (`recommend_sticker`, `search_stickers`, `get_sticker_asset`,
`report_sticker_outcome`, the three `ssticker://` resources, and reason_codes)
is **frozen until 0.2.0**. Internal modules can change freely between patches.

## Ground rules

- Be respectful. See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- Security issues do **not** go through Issues. See [SECURITY.md](./SECURITY.md).
- Do not commit real conversations, screenshots from chats, or platform API
  tokens. The CI sentinel tests will catch leaks and fail the build.

## Local setup

Requirements:

- Node.js 24 LTS (use `nvm` or `fnm` if your distro ships an older Node).
- pnpm 10 (`corepack enable && corepack prepare pnpm@10.33.2 --activate`).
- ffmpeg on `PATH` if you want to test GIF transcode locally.

```bash
git clone https://github.com/T1anjiu/ssticker-mcp
cd ssticker-mcp
pnpm install --frozen-lockfile
pnpm run build
```

## Before opening a pull request

Run the full local gate. Everything must be green before review:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:e2e        # installs Playwright chromium on first run
pnpm run eval            # 460-case bilingual evaluation corpus
pnpm run licenses:check  # fails if THIRD-PARTY-NOTICES.md drifted
pnpm run compose:check    # fails if compose.yaml / compose.prod.yaml violate the safety contract
```

You can also run the combined gate:

```bash
pnpm run check           # lint + typecheck + test + build
```

If you changed the dependency graph (added/removed/upgraded a package), run:

```bash
pnpm run licenses:generate
git add THIRD-PARTY-NOTICES.md
```

## Pull request scope

Keep PRs focused. A good rule of thumb: one PR per concern, under 400 lines of
diff excluding generated files. Split larger changes into stacked PRs.

For changes that touch any of the following, open an issue first to align on
direction before writing code:

- `src/mcp/` (the public MCP tool/resource surface).
- `src/services/decision.ts` (reason code semantics, scoring weights,
  safety blocklist).
- `src/services/policy.ts` / `profiles/policies.json` (default thresholds,
  cooldowns, event TTL).
- `profiles/channel-profiles.json` (per-platform limits and accepted formats).
- `src/db/migrations.ts` (schema changes; need a backfill plan).

## Adding a scene or a policy profile

Scenes are defined in `src/domain/scenes.ts`. Each entry needs a stable ID,
Chinese + English label and description, keyword lists, default tones, default
intensity, and explicit negative keywords. After editing:

1. Add at least 10 evaluation cases per new scene under `eval/corpus.jsonl` (use
   `pnpm run eval:generate` to seed, then hand-edit). Make sure `kind` is set
   correctly (`auto_send`, `explicit_request`, `ordinary_skip`, `serious_skip`).
2. Re-run `pnpm run eval` and confirm the five quality gates still pass.
3. Add a short note to CHANGELOG.md under "Unreleased".

Policy profiles live in `profiles/policies.json`. Bump the `version` field and
add a migration entry in the policy loader. Never change default thresholds
without an issue and a benchmark run.

## Adding a channel adapter

The SDK is `src/adapters/common.ts`. Reference implementations live in
`src/adapters/`. New adapters should:

1. Implement `ChannelAdapter` with `profileId`, `deliver()`, and an explicit
   list of accepted `delivery_kind` and `mime_type` values.
2. Add an entry to `profiles/channel-profiles.json` with verified limits
   (`verified_at` date + source).
3. Add a mock-platform test in `tests/adapters.test.ts` that asserts payload
   shape (mirrors the existing tests).
4. Update `docs/ADAPTERS.md` with the new profile id, env-var convention, and
   any platform-specific caveats.

If the adapter needs credentials, **read them only from the adapter process**.
Never add a `SSTICKER_*` env var that holds a platform token. The repo's own
service must remain credential-free.

## Commit messages and PR titles

We use Conventional Commits so CHANGELOG can be generated automatically later:

```
feat(scene): add greeting scene for Thai locale
fix(decision): preserve id for idempotent recommend requests
docs(readme): explain hash embedding fallback
test(adapters): add mock platform for QQ Official Bot
chore(deps): bump better-sqlite3 to 12.11.2
```

PR titles should follow the same convention. Squash-merge is the default; the
squash commit message must satisfy the convention.

## Release process (maintainers only)

1. Bump `version` in `package.json`. Tag `v0.1.0-alpha.1` etc.
2. Move the "Unreleased" section in CHANGELOG.md to a dated release section.
3. CI builds the multi-arch image and pushes it to GHCR.
4. Announce on Discussions.

## Code of Conduct and reporting

Violations of the [Code of Conduct](./CODE_OF_CONDUCT.md) can be reported to
`https://github.com/T1anjiu/ssticker-mcp/discussions`. Security issues: see [SECURITY.md](./SECURITY.md).
