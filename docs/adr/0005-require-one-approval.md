# 0005. Require one approval on `main`

- Status: Accepted
- Date: 2026-11-11
- Decided by: Lorenz
- Links: [0004](0004-protect-main.md), [#964](https://github.com/lorenzh/pulse-meta/pull/964), [#968](https://github.com/lorenzh/pulse-meta/pull/968), [factory-guides/README.md](../../factory-guides/README.md)

## Context

[0004](0004-protect-main.md) required no approvals because all bot reviews ran as the same account, and GitHub does not allow approving your own pull request. Since 2026-11-11 each Pulse bot role acts through its own GitHub App, so one bot can approve another bot's pull request. The team merge rule changed the same day: factory pull requests need the PM and the Architect, guide and report pull requests need one other bot by rotation.

## Decision

The ruleset `main-protection` in every `lorenzh/pulse-*` repository additionally requires:

- one approving review;
- a new push dismisses earlier approvals;
- the last push must be approved by someone other than its author;
- code owner review where `CODEOWNERS` assigns an owner.

Everything else in 0004 stays: no direct pushes, no force pushes, no branch deletion, admin bypass only through a pull request.

## Consequences

- Reviews are recorded as real approvals, not only as comments.
- The required count is one. The team rule (two approvals for factory pull requests) is still kept by the bots, not by GitHub.
- A bot that pushes a fix to a pull request it approved needs a fresh approval from someone else.
- Once `CODEOWNERS` (#968) is merged, changes to its owned paths wait for their owner.
