# 0002. One release line, release on every merge

- Status: Accepted
- Date: 2026-11-11
- Decided by: Lorenz
- Links: [docs/releasing.md](../releasing.md), [#943](https://github.com/lorenzh/pulse-meta/issues/943), [#530](https://github.com/lorenzh/pulse-meta/issues/530)

## Context

The services had only `v0.1.0`, which points to old commits. Issues such as [#692](https://github.com/lorenzh/pulse-meta/issues/692) and [#530](https://github.com/lorenzh/pulse-meta/issues/530) waited for newer releases. Releases were manual tag pushes.

## Decision

- All `lorenzh/pulse-*` repositories share one release line: the highest `major.minor` of any stable tag. The rules are in [docs/releasing.md](../releasing.md).
- Every merge to `main` releases once all gates pass (continuous delivery, [#943](https://github.com/lorenzh/pulse-meta/issues/943)). The version comes from the tag only.
- Until #943 is built, a person tags releases by hand. For #530 the five services get `v0.1.1` from the current `main`, and the upgrade test runs from `0.1.0` to `0.1.1` with real, attested images (decisions D1-A and D2-A, confirmed by Lorenz on 2026-11-11).
- In the release workflow only the publish step gets a token with write access. Build, test and `bun install` run without write permissions (finding from the deploy security audit, [#950](https://github.com/lorenzh/pulse-meta/pull/950)).

## Consequences

- Upgrade tests always have two real releases to work with.
- A release cannot be skipped, so every merge must leave `main` releasable.
- Breaking changes need a marker before the merge, see [0003](0003-breaking-marker.md).
