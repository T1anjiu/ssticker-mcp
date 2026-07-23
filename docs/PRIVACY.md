# Privacy

ssticker-mcp is designed to minimise what it learns about the actual chat. The default rules below are enforced in code and tested.

## What we never persist

- Raw conversation text or attachments. Messages live only in the request handler and are released as soon as the decision returns.
- The plaintext session_id. We HMAC it with the server secret and store only the digest alongside the decision event.
- API keys, OAuth tokens, or any adapter credentials. Those live only in the adapter process.

## What we do persist (anonymous, TTL-bound)

- decision_events: request_id, action, scene_id, confidence, reason_codes, policy snapshot, channel profile id, optional sticker_id / variant_id, turn_index, expires_at (TTL = policy.event_ttl_hours, default 24h).
- outcomes: outcome_event_id, decision_id, outcome, feedback, failure_code, created_at. Used only for session-scoped suppression and aggregate metrics.
- audit_events: actor, action, entity_type, entity_id, details, created_at. Never includes raw messages.

## Redaction in logs

pino is configured with explicit redact paths: `messages`, `session_id`, `req.headers.authorization`, `download_url`, `apiKey`, `token`. The default log level is `info`; switch to `silent` for fully silent mode or `debug` only when investigating.

## LLM calls

When the optional OpenAI-compatible classifier is enabled, only the conversation text (never attachments, session ids, or signed URLs) is sent. The classifier prompt asks for a structured scene id, tones, intensity, and a serious flag - no identifiers.

## Asset URLs

`/assets/v1/{variant_id}` requires a HMAC-SHA256 signature that is valid for at most 5 minutes. URLs do not reveal sticker titles, original filenames, or disk paths. Expired URLs return 403.

## How to verify

- Sentinel tests inject unique markers into conversations and assert that the marker never appears in the SQLite database, log files, /metrics output, or any error stack trace.
- Decision log query API returns scene id, reason codes, timestamps, and aggregated feedback only - never the conversation text.

## Reporting

If you find a privacy regression, please open an issue with the marker pattern (no actual conversation) so the sentinel test can be extended.
