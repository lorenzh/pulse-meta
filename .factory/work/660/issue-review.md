# Issue review: #660 — failure limiter bound after a backward clock jump

## Disposition

Ready for `plan`; no question requires a `needs-input` hold. The issue explicitly permits either a runtime fix or a qualified guarantee. Recommend the qualification option: preserve runtime behavior, state that the interval bound is valid while `now()` does not decrease, and add a deterministic regression demonstrating why that assumption matters.

## Request and earlier decisions

- Read [#660](https://github.com/lorenzh/pulse-meta/issues/660) and all its comments. The only comment is this run's Factory claim; there are no earlier decisions choosing between the permitted options.
- Read the discussion of predecessor [#656](https://github.com/lorenzh/pulse-meta/issues/656), the available discussion of [kit PR #6](https://github.com/lorenzh/pulse-kit/pull/6), and the relevant approved spec/tasks of [#558](https://github.com/lorenzh/pulse-meta/issues/558). The earlier implementation fixed cleanup ordering after backward jumps by sorting newly inserted own windows. That fix is already in the inspected kit main and must not be redone or removed by a documentation-only resolution.
- This is a follow-up to the existing limiter, not another implementation of #558's admin authentication feature. No predecessor work needs to be recreated to specify this change.

## Verified repository context

Read meta `AGENTS.md`, `README.md`, the issue-review prompt, and kit/api `AGENTS.md`. Inspected the target clones directly; neither was edited.

| Target | Inspected HEAD | Relevant files |
| --- | --- | --- |
| kit | `c6d2cba7d90c981b884dcac2a9288dd9eccad8b5` | `src/failure-limiter.ts`, `test/failure-limiter.test.ts`, `docs/index.md`, `README.md`, `package.json`, root exports and committed `dist/` |
| api | `3fdfbe5ce8ffb8b250409856832ddfc35c9d0d60` | `src/admin-auth-throttle.ts`, `src/main.ts`, `package.json`, `docs/operation.md` |

- Kit's module comment and `docs/index.md` both promise at most `2 * (maxKeys + 1) * limit` evaluated failures in any `windowMs` interval without a clock assumption. The existing caller precondition is to record failures only following an unblocked check.
- Both `check` and `recordFailure` read the supplied clock and drop expired windows. Cleanup is irreversible: a rollback cannot restore a discarded window or its consumed budget. `latestStart` maintains cleanup ordering; it does not clamp the clock.
- Tests already cover nondecreasing traces and the factor-two bound, retry delays under rollback, and expired own windows freeing capacity after an earlier rollback. They do not pin the reported interval-bound limitation after cleanup.
- Kit is a library with no service to start. Tests belong in `test/`; changes to source comments require rebuilding and committing the corresponding generated `dist/` output under kit's instructions.
- API already consumes this kit SHA. `src/main.ts` injects `Date.now`, and `createAdminAuthThrottle` passes its supplied clock into the limiter. Its `docs/operation.md` repeats the unconditional numerical bound of 200 020 evaluated failures per 60 000 ms.

## Open points and planning assumptions

1. **Choose one permitted resolution in the spec.** Default to qualifying the guarantee because the request accepts that option and it preserves all current runtime behavior, including existing rollback cleanup tests. The qualifier applies to the interval failure-count guarantee; it must not imply the limiter throws on rollback, loses its memory bound, or stops clamping `retryAfterMs` to `1..windowMs`.
2. **Keep the time domain explicit.** An interval means a half-open epoch interval `[s, s + windowMs)` using the fake clock's raw timestamps for evaluated failures. A proposed monotonic clamp would introduce a different internal time domain. If the plan chooses a runtime fix instead, specify and verify the advertised epoch-time guarantee rather than silently counting clamped timestamps; a successful test of one trace alone is not a proof for arbitrary rollbacks. Apply any clamp consistently in both public methods, preserve behavior for nondecreasing input, and reconcile the existing rollback tests with the chosen semantics.
3. **Make the existing caller condition precise.** Use sequential attempts: check a key, immediately record one evaluated failure only if unblocked, then move to the next attempt. Keep the fake clock fixed across each pair. This change need not define concurrent outstanding checks, intervening clock changes between check and record, or invalid clock values such as NaN.
4. **Align the duplicated API promise.** Although the issue names kit as its target, the inspected API operator docs make the same incorrect unconditional claim. Recommend a narrowly scoped API documentation task qualifying that bound with the same nondecreasing-clock assumption. It needs no runtime change, kit pin bump, new API test, release, or dependency on a new kit artifact for the qualification option. This discovered duplication is a planning detail, not a blocking product decision.
5. **Documentation locations and generated files.** Update the kit module comment and limiter section in `docs/index.md` together. Add a short README note/link for the guarantee's assumption, following kit's README rule. Rebuild `dist/` rather than editing generated files by hand. Do not rewrite #558's historical approved spec as if it had originally contained the qualification.
6. **Limit scope.** Preserve exports, signatures, routing, capacity, overflow recovery, option validation, client-key normalization, and retry-delay bounds for the recommended resolution. Add no timers, I/O, dependencies, settings, or consumer code changes. No factory configuration change is needed.

## Reproduced acceptance fixture

A read-only `bun -e` probe importing the actual kit source reproduced **10** evaluated failures against the advertised **8** in `[59999, 119999)`. Use `limit = 2`, `maxKeys = 1`, `windowMs = 60000`. In the table, an attempt means an unblocked `check` immediately followed by `recordFailure`; assert that every listed attempt is admitted.

| Raw epoch ms | Operation, in order | Failures counted in `[59999, 119999)` |
| --- | --- | --- |
| 0 | Attempt `a`, then `b`: open own and overflow windows | 0 |
| 59999 | Attempt `a`, then `b`: fill both old budgets | 2 |
| 60000 | `check("cleanup")`: expire both windows; record nothing | 0 |
| 59998 | Roll back by 2 ms; `check("rollback")`; record nothing | 0 |
| 59999 | Attempt `a`, `a`, `b`, `b`: fill fresh budgets | 4 |
| 119999 | `check("cleanup")`: expire both windows; record nothing | 0 |
| 119997 | Roll back by 2 ms; attempt `a`, `a`, `b`, `b` | 4 |

This fixture uses two 2 ms rollbacks after cleanup, and advances 1 ms after the first rollback before opening windows. Do not describe it as a single rollback. The observed admitted timestamps were `[0, 0, 59999, 59999, 59999, 59999, 59999, 59999, 119997, 119997, 119997, 119997]`. Cleanup-only checks consume no budget.

## Derived acceptance check

For the recommended qualification option:

1. Kit's source module documentation and `docs/index.md` state that the factor-two interval bound is **valid while `now()` does not decrease**, alongside the existing check-before-record condition. Explain that rollback after cleanup can admit more failures when counted by raw epoch timestamps. The bound and factor two remain unchanged for a nondecreasing clock.
2. Add a fake-clock test in `test/failure-limiter.test.ts` using the fixture above. Assert the cleanup checkpoints, all admitted attempts, and exactly 10 recorded failures in the half-open interval, explicitly exceeding `2 * (1 + 1) * 2 = 8`. Name the test/comment as a documented limitation outside the assumption. A test expecting 10 is intentional for this option; it must not falsely claim that rollback now satisfies the bound.
3. Existing nondecreasing bound tests, overflow recovery, cleanup ordering and rollback retry-delay tests continue to pass without changing their expectations. No runtime behavior, exports, API, timers, I/O or dependencies change. Generated output matches source after rebuilding.
4. The matching API operator-doc bound, if included as recommended, carries the same assumption; its policy constants, implementation and kit pin remain unchanged. README notes do not introduce a stronger guarantee than the detailed docs.
5. Implementation validation includes kit `bun run check` (lint, build, typecheck and tests), generated-output consistency, and a review of the documentation against the regression trace. Follow the API's existing checks if it receives the documentation task. No new test infrastructure or product service startup is required for the kit library.

If the plan instead chooses the runtime-fix option, replace acceptance item 2 with an assertion that the documented bound holds under the same raw-epoch rollback fixture, define the clock semantics explicitly, and add compatibility evidence for nondecreasing input. Do not ship both an unchanged counterexample and an unconditional bound.

## Review validation and artifact scope

The source-level probe exited 0 with `count: 10` and `bound: 8`; no target files were written or dependencies installed. Full target checks were not run during issue review. Only this review artifact was created in meta. The initially absent `.factory/work/660` directory is created with this artifact; searches with no matches required no repository changes. No labels or provider comments were changed.
