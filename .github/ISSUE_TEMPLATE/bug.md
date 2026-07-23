---
name: Bug report
about: Report something that is broken or behaves unexpectedly
title: "[bug] "
labels: ["bug", "needs-triage"]
assignees: []
---

<!-- Thanks for filing a bug. Please do NOT include real conversations, screenshots from chats, or platform API tokens. -->

### Summary

One or two sentences describing the bug.

### Reproduction

Minimal steps to reproduce. If possible, show the exact `recommend_sticker` /
`search_stickers` / `get_sticker_asset` payload (or a sanitised summary).

```json
{
  "request_id": "...",
  "mode": "auto",
  "channel": { "platform": "telegram", "profile": "telegram-bot", "conversation_type": "direct" },
  "locale": "zh-CN",
  "messages": [{ "role": "user", "text": "..." }]
}
```

### Expected

What you expected to happen (e.g. `action: "skip"`, reason `serious_context`).

### Actual

What actually happened (e.g. `action: "send"`, reason `matched`).

### Environment

- ssticker-mcp version: (e.g. `0.1.0-alpha.0`)
- Node.js version: (`node --version`)
- pnpm version: (`pnpm --version`)
- Platform: (linux / macOS / Windows)
- Deployment mode: (local / docker / compose.prod)
- Auth mode: (none / oidc, plus issuer if known)
- Optional LLM: (disabled / OpenAI / Ollama / vLLM / cloud)
- Embedding provider: (local / hash)

### Logs

Sanitised excerpts from `pino` output, with `messages`, `session_id`, and
`download_url` already redacted. If the bug is in privacy redaction itself,
mark that explicitly and follow [SECURITY.md](../SECURITY.md) instead.
