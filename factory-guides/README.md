# Factory guides

How to use the factory effectively, learned on Pulse (the first real product
built with it). Each role keeps its own file; only real experience goes in,
extended in small `bot/<role>/...` PRs.

## Roles that have proven useful so far

| Role | Guide | Owns |
| --- | --- | --- |
| Owner | – | Sets the rules, makes product decisions, decides what the team cannot |
| Project manager | [pm.md](pm.md) | Backlog, issue format, enrolling (one meta issue at a time), unblocking `needs-input` |
| Architect | [architekt.md](architekt.md) | Design and ADRs, `.factory/` prompt changes with AI Ops |
| AI Ops | [ai-ops.md](ai-ops.md) | Workflows, scripts, repo instructions, factory failures |
| Release | – (new, reviewed after a few weeks) | Tags and releases, the `Breaking:` line, image pins in pulse-deploy |
| Security | – (new) | Audit triage, tokens, secrets, app keys |

Shared rules:

- Factory PRs merge after two approvals, PM and Architect. The `guard` check
  enforces that `.factory/` stays untouched; AI Ops joins when workflows or
  scripts change.
- Guide and report PRs need one approval from another bot, rotating in the
  order PM, Architect, AI Ops, Release, Security: the next one after the
  author reviews (skip to the one after if blocked). With six members, three
  required approvals made every small guide PR wait on the whole team.
- Bot PRs that change `.factory/` or `docs/adr/` are merged by the owner.
- `.factory/` is off-limits for the factory itself; every relevant action is
  logged in the Pulse Team Log (#955).
