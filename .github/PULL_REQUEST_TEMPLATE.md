---
name: Pull request
about: Open a pull request against ssticker-mcp
---

### What

One-paragraph description of the change.

### Why

What problem does this solve? Link the issue (`Closes #NNN`) if there is one.

### How

A short list of code paths touched, useful for reviewers. Reference
`CONTRIBUTING.md` for the freeze list - if this PR touches any of those
modules, call it out in the description.

### Quality gates

- [ ] `pnpm run typecheck` passes.
- [ ] `pnpm run lint` passes.
- [ ] `pnpm run test` passes (24 / 24).
- [ ] `pnpm run test:e2e` passes (Playwright + axe).
- [ ] `pnpm run eval` passes all five quality gates.
- [ ] `pnpm run licenses:check` passes (or `licenses:generate` was run and `THIRD-PARTY-NOTICES.md` is included in this PR).
- [ ] `pnpm run compose:check` passes if `compose*.yaml` was touched.
      `THIRD-PARTY-NOTICES.md` is included in this PR).
- [ ] No real conversations, screenshots, or platform tokens are committed.

### Risk

What could regress? What did you do to mitigate? If the change affects
reason code semantics, scene scoring, or signed URLs, list the eval cases that
exercised the new behaviour.

### Changelog

- [ ] CHANGELOG.md has an entry under "Unreleased".
