# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-11-11
- Decided by: Lorenz
- Links: [Pulse Team Log #955](https://github.com/lorenzh/pulse-meta/issues/955)

## Context

Decisions that span repositories are spread over issue comments (for example [#460](https://github.com/lorenzh/pulse-meta/issues/460)), `docs/releasing.md` and `.factory/config.yaml`. A Factory agent or a new reviewer cannot find them in one place, and old decisions get questioned again.

## Decision

Cross-repository architecture decisions are recorded in `docs/adr/`, one file per decision, with the format in [README.md](README.md). Older decisions are added as records when they are touched next.

## Consequences

- Reviews and Factory plans can link a record instead of repeating the reasoning.
- A changed decision needs a new record, so the history stays readable.
- Repository-specific decisions stay in that repository's docs.
