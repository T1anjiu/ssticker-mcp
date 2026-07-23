---
name: Feature request
about: Propose a change to the MCP contract, scenes, or policies
title: "[feat] "
labels: ["enhancement", "needs-triage"]
assignees: []
---

### Problem

What user-facing problem does this solve? Who is affected (operators running
the catalog, channel adapter authors, end users of the chat bot)?

### Proposed change

Sketch the change. If it touches any of the following, please call it out
explicitly so reviewers can flag freeze implications:

- `src/mcp/` (public MCP tool/resource surface - frozen until 0.2.0).
- `src/services/decision.ts` (reason code semantics).
- `profiles/policies.json` / `profiles/channel-profiles.json`.

### Alternatives considered

What other shapes were considered? Why this one?

### Open questions

Anything that needs consensus before implementation can start.
