# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

Until 1.0 is released, only the latest 0.1.x release receives security fixes. We
do not maintain backports. Pin your deployment to a specific 0.1.x patch.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security bugs.**

Open a private report at `https://github.com/T1anjiu/ssticker-mcp/security/advisories/new` (PGP key: see `.well-known/security.txt` once
the domain is live) with:

- A short title and one-paragraph description.
- Steps to reproduce, ideally with a sentinel string that does **not** contain
  real conversation text.
- The expected vs actual behaviour.
- Your assessment of impact (who can read what, what they can forge, etc.).

You will receive an acknowledgement within 3 business days, and a triage
decision within 10 business days. We aim to ship a fix within 30 days for
high-severity issues.

If you prefer, use GitHub Security Advisories: https://github.com/T1anjiu/ssticker-mcp/security/advisories/new

## What we consider in scope

- Anything that causes the MCP server to leak raw conversation text, plaintext
  session ids, signed asset URLs after expiry, or admin tokens.
- Anything that bypasses `serious_context` / `safety_blocked` reason codes and
  causes an auto-send on a context that the plan defines as sensitive.
- Origin-check / OIDC scope bypass on `/mcp` or admin endpoints.
- Path traversal, signature forgery, or rate-limit evasion on `/assets/v1/*`.
- Privilege escalation between admin scopes (`ssticker.recommend`,
  `ssticker.catalog.read`, `ssticker.feedback`, `ssticker.admin`).
- Container escape or persistent compromise via the published Docker image.

## Out of scope

- The behaviour of platform SDKs that ship as reference adapters (Telegram Bot
  API, QQ Official Bot, WeCom webhook, WeChat Official Account). File those
  upstream.
- Adapter credentials that an operator provisioned incorrectly (tokens stored
  in the wrong place, secrets committed to a chat-bot repo). We document but do
  not enforce where you keep them.
- Bugs in dependent models (`intfloat/multilingual-e5-small` tokeniser, ONNX
  Runtime). Report upstream and link from your advisory.

## Privacy sentinels

The repo ships with privacy sentinel tests that inject unique marker strings
into conversations and assert the marker never appears in SQLite, logs,
metrics, or error traces. If you find a regression please:

1. Open a security advisory as above.
2. Include the marker pattern (not the actual conversation).
3. We will add a permanent sentinel test before merging the fix.

## Hall of fame

We will credit reporters in CHANGELOG.md with their consent once a fix ships.
