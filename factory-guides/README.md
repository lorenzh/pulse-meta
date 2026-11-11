# Factory guides

How to use the factory effectively, learned on Pulse (the first real product
built with it). Each role keeps its own file; only real experience goes in,
extended in small `bot/<role>/...` PRs, merged after all three roles approve.

## Roles that have proven useful so far

| Role | Guide | Owns |
| --- | --- | --- |
| Owner | – | Sets the rules, makes product decisions, decides what the team cannot |
| Project manager | [pm.md](pm.md) | Backlog, issue format, enrolling (one meta issue at a time), unblocking `needs-input` |
| Architect | [architekt.md](architekt.md) | Design and ADRs, `.factory/` prompt changes with AI Ops |
| AI Ops | [ai-ops.md](ai-ops.md) | Workflows, scripts, repo instructions, factory failures |

Shared rules: factory PRs merge only after PM, Architect and AI Ops all
approve; `.factory/` is off-limits for the factory itself; every relevant
action is logged in the Pulse Team Log (#955).
