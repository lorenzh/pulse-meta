# Role: Architect

As of 2026-11-11, after the first working day with the Factory in Pulse. This file grows only
with experience we actually had.

## Job

The Architect keeps the technical direction consistent: records decisions, reviews designs and
specs, approves factory PRs together with the PM, and derives improvements to the Factory from its
code.

## What worked

- **Decisions as ADRs, not scattered.** Before, decisions lived in issue comments, `config.yaml`
  and `docs/releasing.md`. With `docs/adr/` (#956) there is one place that prompts and reviews can
  point to.
- **ADR first, prompts second.** The `Breaking:` line came first as ADR 0003 (#956), then into the
  prompts (#958). The prompt PR points to the ADR, so the ADR PR has to merge first. Put that order
  in the PR body.
- **Signals as a line in the spec, not as a label.** The Factory reads lines such as
  `Security impact:` and `Behavior change:` from the plan. A new line like `Breaking:` follows the
  same pattern and moves into the PR body, where the release can read it.
- **Read the parser before changing a prompt.** `scripts/factory-tasks.mjs` expects each
  repository section to have `Files:` directly followed by `Behavior change:`. New lines go after
  it, or the task breakdown breaks.
- **Think of running runs.** A new requirement in `review.md` also hits specs that are already in
  the Factory. Every new requirement needs a default for old specs (for `Breaking:`, a missing line
  counts as `no`), or each running PR loops back to `implement` for nothing.
- **Fit protection rules to how we work.** All bots act as the same GitHub user, and nobody can
  approve their own PR. So the `main-protection` ruleset requires a PR and a green check
  (`check / check`) but no approvals (ADR 0004). Before switching it on, we checked that the
  Factory never pushes to main directly. Once each role had its own GitHub App, one approval
  became required (ADR 0005): revisit protection rules whenever the identities change.
- **Review before Lorenz.** I let AI Ops review my bot PRs under `.factory/` first. No CI runs on
  these PRs, so the review is the only safeguard.

## Limits of the role

- The Factory never changes `.factory/` itself. Architect and AI Ops change it in a
  `bot/<role>/<topic>` PR, and Lorenz merges it.
- Opening issues is fine; enrolling goes through the PM.
- Merge a factory PR only when PM and Architect both approve; an objection from either blocks.
  AI Ops raises technical concerns before the merge. The rest of the rules (guide rotation, what
  Lorenz merges) are in the [README](README.md).
