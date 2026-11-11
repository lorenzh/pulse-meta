# 0003. Mark breaking changes with a `Breaking:` line, not a label

- Status: Accepted
- Date: 2026-11-11
- Decided by: Lorenz
- Links: [docs/releasing.md](../releasing.md), [0002](0002-one-release-line.md)

## Context

The planned release line raises the major version when a pull request is breaking. `docs/releasing.md` planned a `breaking` label set by the Factory review. The Factory preamble forbids agents to set labels, and labels set after the merge have no effect, so a label is easy to forget and hard to check.

## Decision

- Each target in a Factory `plan.md` states `Breaking: yes` or `Breaking: no`. The field is required.
- The build carries it into the target pull request body as one line, `Breaking: yes` or `Breaking: no`. Pull requests made by people add the same line.
- Breaking means: documented public behavior changes in an incompatible way (an API route, a contract shape, a config key, a CLI flag, an image interface).
- The review checks the line against the diff. The release workflow reads the line from the merged pull request. A missing line counts as `no` and is reported.

## Consequences

- The decision is visible in the plan review, before any code is written.
- The Factory prompts in `.factory/` need the new field. That change goes through a `bot/<role>/<topic>` pull request, not through the Factory.
- `docs/releasing.md` refers to this record instead of the label.
