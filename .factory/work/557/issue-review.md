# Issue review: #557 — probe scheduler and retry edge cases

## Disposition and evidence

Ready for `plan`. There is no question that requires a person to decide before the feature can be specified. The nonblocking choices and recommended assumptions below must become explicit in the spec.

Reviewed the issue and its comments on 2026-11-02: [#557](https://github.com/lorenzh/pulse-meta/issues/557). The only comment is the Factory claim for this run; there are no earlier decisions or additional requirements.

Read the meta instructions and README, probe instructions, source, relevant tests, operator docs and CI, plus supporting contract, kit, API and deploy files in the read-only clones. Probe HEAD is `271401b71e950787a6b767426e98c1b8402a436e`, newer than the issue's `50ec9ca` reference. The findings remain visible in the inspected source:

| Item | Current behavior and evidence |
| --- | --- |
| HTTP retries | `probe/src/check.ts:151-161` uses `check.retries` without checking the HTTP method. The same loop serves TCP, DNS and domain checks; TLS takes a separate path. HTTP defaults to GET. |
| Buffer age | `probe/src/settings.ts:79` uses kit `readMs` without an explicit maximum, which defaults to 2,147,483,647 ms. `api/src/server.ts:45,105` rejects timestamps strictly older than 604,800,000 ms; `api/src/server.validation.test.ts` explicitly accepts the exact seven-day boundary. `probe/src/buffer.ts:45` already expires results strictly older than its configured maximum, by result timestamp. |
| First run | `probe/src/scheduler.ts:75` calls `tick` immediately for every added or replaced entry. Later scheduling uses the monotonic clock and waits for the run and result handler to finish. |
| Repeated skips | `probe/src/client.ts:231,289` logs missing/invalid header-env skips and invalid-check skips on each successful load. Only the missing wire-version warning currently has deduplication (`warnedAbsent`, scoped by logger identity). |
| Replacement and shutdown | Scheduler removal clears a pending timer and suppresses obsolete results, but never aborts a running check. `check-scheduler.ts` passes only the global shutdown signal to `runCheck`. TLS options have no cancellation signal; both default TLS and guarded TLS use a timeout alone. Default TCP and DNS attach abort listeners without checking an already-aborted signal before creating work. |

Supporting snapshots: API `90f605555c31bd112bedd5a8f3f26ffb4afa5050`, kit `739188a87a177c0e8b5a8938e3f54c2bdaf19df4` (also probe's kit pin), deploy `15812a0870d2bc461e38b30d83fcbd1877a5f0c7`.

## Scope and constraints

- Expected implementation target: **probe**, including its tests, README and `docs/configuration.md`. The five requirements fit its existing modules and injected dependencies. API already enforces the required age; the contract already permits the relevant methods and retry settings; kit `readMs` already accepts a narrower maximum.
- Preserve HTTP retry counting, delay, interval budget and early success behavior for GET/HEAD. Preserve TCP, DNS and domain retries and TLS's existing single attempt. The method restriction concerns monitored HTTP requests. Result delivery to the API has its own retry policy and remains necessary because `POST /results` is idempotent.
- Keep wire schemas, API endpoints, private-address policy, header host binding and secret-safe logging intact. No new runtime dependency or public jitter setting is needed on the evidence inspected.
- The work must include every supported active check type: HTTP, TLS, TCP, DNS and domain. Heartbeats are silently filtered by the client and have no scheduled run.
- Spec and review artifacts stay in meta. Context clones remain read-only.

## Nonblocking open points and proposed assumptions

### 1. What does “only GET and HEAD” mean?

Treat an omitted HTTP method as GET, and use the configured original method to decide retry eligibility. All other supported HTTP methods, including PUT, DELETE and OPTIONS, make one attempt even when `retries` is configured. A POST redirected to GET does not acquire retry eligibility. Keep accepting such check configurations; document that `retries` and `retryDelayMs` have no effect on these methods and warn that requests can have side effects.

The plan should update the retry section and the HTTP method documentation together. Its tests should include a failing non-GET/HEAD request and GET/HEAD controls, rather than disabling the common retry loop for every non-HTTP type.

### 2. Does “cap” mean reject or clamp, and is seven days inclusive?

Recommended assumption: accept integer ages from 1 through **604,800,000 ms inclusive**, retain the default of 3,600,000 ms, and reject larger values through the existing named `StartupError` / exit-2 settings path. This follows the existing configuration validation convention. Update the existing test that currently accepts 2,147,483,647 ms and the documented range.

Buffer expiration already uses the right strict comparison. Preserve its timestamp-based age and test the boundary with an injected clock. This cap aligns the configured retention with the API window; network delay and differences between host clocks still affect whether a result arriving exactly at the boundary is accepted.

### 3. What jitter bound and lifecycle apply?

The issue gives no distribution or numerical bound. Recommended planning default: independently sample a whole-millisecond first-run delay `0 <= delay < min(intervalMs, 1000)` using an injected random source. This spreads ordinary startup bursts while bounding additional startup latency below one second, including for hourly domain checks. The plan may choose another explicit small bound and explain it; avoid leaving “bounded” unquantified.

Apply the initial delay to entries created at startup, added by reload, or replaced after a configuration change. An unchanged entry retains its existing schedule and initial delay. Subsequent runs keep the existing interval measured from the previous start and the existing no-overlap behavior. Removing, replacing or stopping an entry must cancel its pending initial timer. Tests must inject randomness and time; they must not rely on sampled delays happening to differ or on wall-clock timing.

### 4. What is “once per check”?

Recommended assumption: one skip warning per check ID for the lifetime of one probe/client run, shared by startup and subsequent reloads. Repeated rejection, a different rejection reason, or recovery followed by another rejection for that ID does not produce another skip warning during that lifetime. A separate probe instance starts with fresh warning state. Deduplication affects logging only: every reload still validates checks and resolves headers, and a corrected check becomes runnable.

Cover both skip paths: invalid checks with readable IDs and HTTP checks skipped for invalid/missing header-env values. Define a deterministic, secret-safe fallback for malformed records without an ID in the plan; they must remain skippable and must not abort loading. Do not retain raw payloads, header values or bodies as warning keys. Heartbeats remain silent. The host-binding denial warning describes a check that runs and reports down; it is a separate diagnostic from the two skip paths.

### 5. How far must cancellation propagate?

Use the scheduler's existing equality decision as the definition of “changed”: a deep change to the normalized `ProbeCheck` replaces its entry; an equal reload leaves it running. Give entries cancellation ownership so replacement, removal and scheduler stop abort their work. Combine that cancellation with process shutdown, and propagate it through the check scheduler, each attempt, retry waits, transport guards and default transports. Check for cancellation before starting work and after a retry wait. A changed check must not wait out a retry delay or start another attempt.

TLS requires an abort-capable connection option and propagation through `runTlsCheck` and `createCheckGuard`, including guarded address resolution and connection fallback. Preserve its timeout budget and SNI behavior. TCP/DNS must handle a signal that was already aborted before entry, and must clean up sockets/resolvers/listeners on cancellation during work. HTTP and domain must also stop before starting network work when shutdown has already happened.

Retain suppression of obsolete results: an aborted old generation cannot reach `onResult` or the result buffer after replacement/removal/stop. Preserve no overlap, and state how the replacement starts relative to the old run settling. Expected cancellation should not be logged as an unexpected check error. Results whose posting had already started before replacement are a separate completed-run concern; this feature does not require retracting accepted or buffered results.

**Shared domain bootstrap needs explicit care.** `check-domain.ts:133-165` shares a bootstrap request by URL; its lifetime currently uses the first caller's `deps.signal`. Passing a new per-check signal into that same role would let one replaced domain check abort another check's shared bootstrap. Keep the shared request bounded by its timeout and process shutdown, let individual waiters cancel independently, and prevent an already-cancelled check from initiating a refresh. Preserve cache and single-flight behavior. Include a concurrent-domain cancellation control in validation.

### 6. Where and against what does `compose-e2e` run?

Probe CI (`probe/.github/workflows/ci.yml`) runs shared checks and Docker checks on amd64 and arm64. The Compose test lives in **deploy**, at `e2e/compose-e2e.sh`, and deploy CI's `full` job invokes it. It selects its own Compose files, refuses service `build` keys and runs `up --pull missing`. `deploy/common/services.yaml` pins published images by version and digest. A green run of those unchanged pins alone cannot demonstrate this probe change.

The plan must define candidate-image validation. A feasible approach is to build the candidate probe image and run the existing script in a disposable deploy fixture, changing only that fixture's probe image reference to the local candidate tag, retaining the other pinned images and the script's assertions. Record the tested probe commit/image identity. Keep the read-only deploy clone untouched. A production image release/pin update is a separate release step; no persistent deploy change is needed solely to run this validation. If the plan instead adds reusable candidate-image support, it must explicitly scope a deploy target and its acceptance checks.

## Derived acceptance check

The feature is accepted when all five behaviors have regression coverage against the probe baseline, the changed probe passes its existing CI, and the existing Compose E2E completes using the candidate probe image. “One test per item” is a minimum of five regression groups; the last item contains distinct replacement and shutdown failures and needs both covered.

| Requirement | Observable regression and controls |
| --- | --- |
| GET/HEAD retries only | Configure retries, return a failing response, and assert a non-GET/HEAD method causes exactly one attempt, no retry sleep and `attempts: 1`. Cover all supported excluded methods with table-driven cases. GET, omitted method and HEAD retain retry behavior, delay and attempt count; a redirected original POST still gets one attempt. Preserve non-HTTP retry controls. |
| Seven-day cap | Settings accept 604,800,000 and reject 604,800,001 with a one-line error naming `PULSE_BUFFER_MAX_AGE_MS`; default remains one hour. With fake time, buffered results older than the configured limit are dropped as `too_old` before replay, and the exact boundary retains its existing eligibility. |
| Initial jitter | With controlled random values, equal-interval checks get the corresponding bounded initial delays and do not all run immediately. Advance fake time to verify first executions and subsequent intervals. Unchanged sync retains timers; addition/replacement uses a fresh delay; removal/stop cancels pending starts; slow runs still do not overlap. |
| One skip warning | Reuse one client warning scope across initial load and multiple reloads containing a missing/invalid header-env check and an invalid check with an ID. Each ID produces one skip line while valid checks continue. Recovery makes the check runnable, later rejection stays quiet within that scope, different IDs warn independently, and a new scope can warn again. Verify secrets are absent and malformed ID-less records follow the specified fallback. |
| Changed runs and shutdown | Hold a run open, sync a changed check with the same ID, and observe its signal abort, prompt settlement/cleanup, no obsolete result, and execution of the new settings. Equal sync does not abort; removal and stop do. For each active type, an already-aborted shutdown starts no request/socket/lookup; abort during an in-flight operation ends it and releases resources. Abort during retry sleep prevents another attempt. Exercise guarded TLS signal propagation as well as ordinary transports, and cancel one domain waiter without breaking a second waiter sharing bootstrap; shutdown still ends shared work. |

Regression assertions must demonstrate the reported behavior failing on the inspected probe baseline before implementation and passing after it. Existing tests that assume immediate runs or allow the old buffer maximum must be updated to the specified behavior. Use injected clocks, timers, random values and hand-written transport fakes; use loopback fixtures when testing real transport cleanup. A fake that simply implements the desired abort behavior does not by itself prove the default TCP/DNS/TLS transport bug is fixed.

Implementation handoff evidence must include `bun install --frozen-lockfile`, `bun run check`, the existing probe Docker CI gates, a `bun run start` exercise of changed behavior as required by probe instructions, and candidate-image `bash e2e/compose-e2e.sh` ending with `==> All checks passed`. Record commands, relevant commit/image identities and any environmental block accurately; do not treat a skipped gate or an unchanged published image as candidate validation.

## Review validation

This state performed source and test inspection and read the live issue/comments. It made no product changes and ran no product tests or Compose stack. The regression executions and CI/E2E gates above are acceptance work for the later implementation, not results claimed by this review.
