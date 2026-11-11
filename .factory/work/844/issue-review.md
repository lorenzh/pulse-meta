# Issue review: #844

Reviewed 2026-11-08. Outcome: transition to `plan`. No question blocks specification.

## Scope and earlier decisions

This is a follow-up to merged #570 (status child #809, pulse-status PR #67), not a redesign of live settings. Its feedback requirement remains: report after every apply attempt and at least every 60 seconds (`.factory/work/570/plan.md:340–345`). The issue supplies independent-review evidence of 62000 ms between report starts with 60000 ms polling and one-second requests.

Only `status` is an implementation target. The notify twin belongs to #824. “Fix both the same way” means the same timing, serialization and shutdown principles across those issues; it does not authorize a second notify implementation here. No new cross-repository dependency is needed for the status fix. Do not change contract, api, kit, config, browser polling, endpoints, public responses, report content or settings precedence/validation. No dependency or tooling change is necessary.

The supplied issue comments record a design that passed plan-review, followed by a newer manager correction to scope enforcement. Carry forward the reviewed timing, shutdown, regression, documentation and performance decisions. **The newest manager requirement supersedes the earlier approval of working-tree-to-base scope checks.** Regenerate the plan and task acceptance accordingly; do not copy those obsolete checks.

There was no `.factory/work/844/` directory, plan or task file in this checkout before this review. Prior-run summaries in the issue are decision history, not proof that their artifacts exist here.

## Inspected evidence

All target inspection was read-only. Meta instructions and README, `.factory/prompts/preamble.md`, `.factory/prompts/issue-review.md`, and the relevant #570 feedback requirement were read. No target file was changed.

| Source | Observed behavior or instruction |
| --- | --- |
| status clone at `bcd83dad0975954b687ce89fc8ad369ba3a94e8a` | Implementation context for this review. Record the actual implementation base again before editing in the build state. |
| `status/src/settings-poll.ts:16–19,196–204` | Each read/report has a 5000 ms timeout; heartbeat constant is 60000 ms. `tick()` awaits `pollOnce()` and only then arms `min(pollMs, 60000)`. |
| `status/src/settings-poll.ts:103–153,177–194` | Each token-bearing poll reads the database, reloads the local files, resolves/applies, then awaits a report. ETag, 304, older-api 404 and last-good failure behavior already exist. |
| `status/src/settings-poll.ts:155–174` | Report uses `requestJson`, has its own timeout, and receives no caller abort signal. It records `at` at report creation. |
| `status/src/settings-poll.ts:43–48,206–214` | `pollNow` directly calls `pollOnce`; it can race the timer or another manual call. `stop()` is synchronous, aborts the last read controller and clears the stored timer. It neither cancels a report nor guards continuation of a stopped read before local apply/report. |
| `status/src/settings.ts:15–19,203–208` | Settings-poll default is 15000 ms, minimum 1000 ms; 60000 and 120000 ms are accepted. This is separate from the browser/API `POLL_MS`. |
| `status/src/start.ts:147–167`, `status/src/main.ts` | Production already injects fetch, clock and timers. `startPolling()` returns synchronous cleanup that calls `poll.stop()`; main shuts down via that cleanup. Preserve these interfaces. |
| `status/src/settings-poll.test.ts` | Existing suite checks settings, readiness, token handling and reports. It uses real local HTTP and a fixed `now`; it suppresses background callbacks and drives `pollNow`. It does not measure successive background report starts. |
| `status/README.md:34`, `status/docs/configuration.md:25–34` | README currently promises reads every configured interval. Configuration docs also promise a report after every attempt and at least every 60 s. Both need accurate timing text in the same change. |
| `status/AGENTS.md` | Requires injected time/fetch, red/green regression evidence, no private exports solely for tests, README updates when behavior changes, and `bun run check`. Do not weaken tooling or coverage. |
| `status/package.json`, `status/bunfig.toml`, `status/.github/workflows/ci.yml` | Bun 1.4.0; check runs lint, typecheck and tests; test line coverage threshold is 80%. Status pins contract `1b5e7d3e268372a6241db05ae30272eab7299b10` and config `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. |
| contract clone at status's exact contract pin, `src/client.ts:155–211,303–341` | Both JSON helpers support injected timeout scheduling and caller cancellation. Timeout covers headers/body. The wrapper races interruption even if fetch ignores its signal, cancels its timeout, and aborts its own controller in cleanup. No contract change is needed. |
| notify clone `5a44c5a3de1764faa04b6cd3762f2c2be4c58430`, `src/index.ts:835–914` | Its channel loop has a separate report heartbeat armed again after report completion, and tracks in-flight heartbeat promises for shutdown. This corroborates the defect class; it does not supply the status implementation. |

Tooling limitation: config clone HEAD is `bc870498cc8e2539a132ce2aac35a09db1deabd8`, not status's pin. Attempts to read the pinned workflow/object locally failed because that revision is unavailable in this clone. Status also has no installed `node_modules`. Thus the current config checkout must not be asserted identical to the pin, as earlier comments did for an earlier run. Plan/build must inspect the pinned dependency when available. This does not prevent specifying the source fix and `bun run check` from status's own instructions/scripts.

## Open points resolved as assumptions or planning requirements

1. **Meaning of heartbeat.** Measure the start of the outgoing report fetch, not timer callbacks, report completion, body timestamps alone or successful arrival at the api. A failed report attempt counts as a start; preserve error handling. Reports remain token-dependent and follow completed apply attempts even when the snapshot is unchanged or rejected. Successful delivery cannot be guaranteed while the api is unavailable.

2. **HTTP time and deadlines.** Merely changing the timer to `tickStart + 60000` fixes constant-latency drift, but does not prove the report bound when the next settings read is slower than the previous one. Keep the reviewed D1 design or an equivalently proven design. With a token, use the earlier of `pollStart + min(pollMs, 60000)` and `reportStart + 54000`, and arm with `max(0, due - now)` after the serial operation finishes. The 6000 ms lead is the existing 5000 ms settings timeout plus 1000 ms margin; it may remain internal. The next settings request can consume its full timeout and still start the next report within 59000 ms of the prior report. This bound concerns bounded HTTP operations with a responsive clock/event loop, not a process suspended indefinitely. Do not change the timeouts to meet it.

3. **Two timing bounds.** For ordinary automatic token-bearing cycles above 54000 ms polling, read-start spacing is `min(pollMs, 60000, 54000 + previous read duration)` under the injected-clock model. A read begins at most 54000 ms after the previous report began. These are different bounds. Read starts can be 54000–59000 ms apart, not “at most/about/every 54 s.” At `pollMs=55000` with 4000 ms reads, spacing stays 55000 ms and read-minus-previous-report is 51000 ms. Above 54000 ms the poller **can be faster** than configured; it is not always faster. At/below 54000 ms do not schedule reads faster than configured except for explicitly requested manual polls.

4. **One execution lane.** Serialization applies to timer polls, manual `pollNow()` calls, settings reads, applies and reports together. Preserve `pollNow(): Promise<void>` completion semantics; at most one follow-up poll may wait/coalesce. A due timer while work runs must not start parallel work or create an unbounded catch-up queue. Specify whether manual requests share a queued completion promise. Re-arm from a coherent anchor after manual work so an old timer cannot start a second lane.

5. **No report anchor.** Preserve the initial immediate poll. Without a token, no remote reads or reports occur and local reads retain the existing `min(pollMs, 60000)` cap. If a poll sends no report, use its start as the fallback scheduling anchor rather than an indefinitely stale report deadline. A failed poll must not create a zero-delay spin. No-token `pollMs=120000` is necessary to expose accidental removal of the cap; a token-bearing test alone cannot prove this because the report deadline masks it.

6. **Shutdown gaps.** “As today” is an intent to retain tracking, not evidence that all operations already cancel. Use one poll-scoped abort controller for both read and report, plus stop guards before continuation/apply/report/re-arm. Preserve synchronous `stop()` and unchanged start/main wiring. Cancel pending scheduling and in-flight HTTP; let resulting promises settle. A stopped/queued or later `pollNow()` resolves without starting work. Test read and report phases separately, and a queued manual call at stop. No apply, report or timer may be started after stop.

7. **Latency model.** Inject both `now`/timers and fetch; advance to each due callback and flush asynchronous continuations. Do not jump the fake clock directly to a horizon and run all callbacks at that final timestamp. Make fetch record starts/ends and observe aborts; include pending/slow body or request timeout paths. Use valid contract answers so failures exercise scheduling rather than parsing. Assert nonzero event counts and several complete gaps; an empty list must not pass the heartbeat assertion.

8. **Documentation and exclusive scope.** Both plan and task `Files:` must name exactly `README.md`, `docs/configuration.md`, `src/settings-poll.ts`, `src/settings-poll.heartbeat.test.ts`. The new test name is absent in the inspected source. README must explicitly state that report starts stay at most 60 seconds apart whatever the HTTP time is, with the existing request timeout context. Correct the configured-interval claim and describe possible earlier reads accurately in both docs. Leave `src/settings-poll.test.ts`, runtime settings/report construction, settings parsing, start/main, public code, package pins/lockfile and tooling unchanged. Any need to broaden this scope must first be reconciled in the spec, not silently accepted in the task.

9. **Request rate and CPU.** Deadline scheduling removes the old delay after HTTP completion. With two 4000 ms requests at default 15000 ms polling, old poll starts are 23000 ms apart and new starts 15000 ms apart: 53.3% more reads/reports. Around `pollMs=10000` with both requests timing out, rate can double. At larger intervals the heartbeat lead can also exceed the configured rate: up to `60000/54000` at 60000, or `120000/54000` relative to a 120000 setting. These are upper ratios reached with fast reads, not inevitable ratios with slow reads. Document additional local CPU/file work, api load and reduced completion-time back-off. A fast local benchmark and test CPU do not measure this operational effect. Preserve the prior delayed-response measurement requirements below.

## Derived acceptance checks for plan and tasks

### Timing regression and negative evidence

Add `src/settings-poll.heartbeat.test.ts` using `startSettingsPoll` and existing public names available on the implementation base. Do not import a new `REPORT_LEAD_MS` export: a red run must fail on behavior, not a missing export. Use literal expected timing values independent of the implementation formula.

- Run the six required combinations: `pollMs` 15000 and 60000, each with settings and report request latency 0, 1000 and 4000 ms. Exercise the real automatic loop over several reports. Each adjacent report fetch start gap is at most 60000 ms; active reads/reports together never exceed one. Check minimum automatic read gaps of 15000 and 54000 respectively.
- Old-code expectation for equal request latencies: report gaps of 15000/17000/23000 ms at the default, and 60000/62000/68000 ms at 60000 polling. The positive-latency 60000 cases must fail the old code. The zero-latency and default controls need not fail.
- Vary read latency across cycles (especially fast then 4000 ms, and fast then the full 5000 ms timeout) with success, rejection and recovery. Assert all report gaps remain bounded. This must reject a simple tick-start-only fix that still allows a slow next read to push the report past the deadline.
- Cover a slow/timed-out report and `pollMs=120000` with a token. Assert heartbeat, serialization and continued progress. The token-bearing 120000 test protects the heartbeat, not the `min(pollMs, 60000)` cap by itself.
- Without a token, `pollMs=60000` and 120000 must both read local files at exactly 0, 60000, 120000, 180000, 240000 and 300000 ms; no fetch at all. Removing the cap must fail the 120000 case.
- Carry forward the six exact timing cases from earlier review. For 60000 polling, read durations 0, 1000, 4000 and 5000 ms (timeout for the last) give read gaps 54000, 55000, 58000 and 59000 ms; each next read starts 54000 ms after the preceding report start. At 120000 polling with 4000 ms reads, expect 58000/54000 ms. At 55000 polling with 4000 ms reads, expect 55000/51000 ms. With immediate report responses the old read gaps are 60000, 61000, 64000, 65000, 64000 and 59000 ms respectively. The last case also rejects dropping the configured-poll cap in the token path.
- Verify timer/manual and manual/manual serialization, bounded queued work, correct `pollNow()` completion and scheduling after manual work. Verify no spin if no report was sent.
- Stop while idle, during a settings read, during a report, with a queued `pollNow()`, and before a later manual call. Verify cancellation/settlement, no post-stop apply/report/re-arm, and no outstanding owned timers after continuations settle. Preserve synchronous `stop()`.

Show the new regression against the exact recorded base and the fix. A disposable base worktree in the later implementation environment keeps red-run source restoration out of the implementation index/working tree. Copy only the new test there, install the same pinned dependencies and record failing test names/timing assertions. Compilation, import, dependency or environment errors are not red evidence. Existing tests remain unchanged and pass on the fix; `bun run check` passes with the pinned Bun/tooling and normal coverage gates.

### Documentation and runtime evidence

- Review the README/configuration diff for the report-start guarantee, the timeout context, corrected read timing and “can be faster” wording. Reject promises that reads are always faster above 54000 ms or are at most/about/every 54 s apart. Avoid using grep alone as proof of correct meaning.
- Before handoff, exercise the real service with `bun start` against a local delayed fake api. Preserve the prior measurement: compare base and branch at 15000 ms polling over a 300 s window with each settings/report response delayed 4000 ms. Expect roughly 14 ±1 vs 20 ±1 settings reads, and branch process CPU no more than 300 ms above base using a comparable user+system CPU measurement. If noisy, investigate/report rather than silently dropping the gate.
- A second delayed run at 60000 ms polling must show report-start gaps 68000 ±50 ms on base and 58000 ±50 ms on branch, branch read gaps 58000 ±50 ms, and each branch read 54000 ±50 ms after the previous report. Record multiple gaps. Use a stable local environment and report timing noise; deterministic injected-clock assertions remain the exact timing proof. The local server/measurement helper is temporary evidence, not a fifth committed target file.

### Scope acceptance: commits, index and working tree separately

Record `BASE=$(git rev-parse HEAD)` **before any implementation edit** and retain its actual SHA in completion evidence. Do not reset BASE after committing the fix. Run final scope checks after the final implementation commit. All of the following are required, combined so that any failure fails acceptance:

1. `git diff --name-only "$BASE" HEAD` equals exactly this sorted list, with no missing or additional path:

   ```text
   README.md
   docs/configuration.md
   src/settings-poll.heartbeat.test.ts
   src/settings-poll.ts
   ```

2. `git diff --exit-code "$BASE" HEAD -- <protected files>` exits 0. The plan/task must enumerate protected paths explicitly, including `src/runtime-settings.ts`, `src/runtime-settings.test.ts`, `src/settings-poll.test.ts`, `src/settings.ts`, `src/settings.test.ts`, `src/start.ts`, `src/main.ts`, `package.json`, `bun.lock`, `AGENTS.md`, the existing lint/typecheck/test configuration and `.github/workflows/`. Include other existing files excluded by the four-file scope where useful; the exact committed path list above covers the entire tracked repository.
3. `git diff --name-only --cached` is empty: nothing staged after the final commit.
4. `git diff --name-only` is empty: nothing unstaged after the final commit.
5. `git status --porcelain` is empty, including untracked files. Keep disposable fixtures outside the implementation checkout. Where Factory provides a context clone directory, use its established exclusion and still inspect all implementation paths; never exclude the allowed/protected files or add a new ignore rule to pass.
6. `git diff --check "$BASE" HEAD` passes. This whitespace check supplements the scope gates.

Do not replace these with `git diff "$BASE"`, `git diff --exit-code "$BASE" -- <files>`, or a comparison against the index alone. The first two inspect working-tree content and can miss forbidden staged or committed content when the worktree has been restored to BASE.

The acceptance procedure must prove its own behavior in a disposable fixture repository. Start with a clean BASE containing allowed and protected files; commit changes to exactly the four allowed paths and show the complete checker passes. Then exercise independent scenarios, resetting to that allowed commit between them:

| Forbidden state | Required reason for checker failure |
| --- | --- |
| Modify a protected file only in the worktree | Unstaged diff and status are nonempty. |
| Modify and stage a protected file | Cached diff and status are nonempty. |
| Commit a protected-file change | BASE-to-HEAD exact file list and protected-path diff fail, even though status is clean. |
| Modify and stage a protected file, then `git restore --source "$BASE" --worktree -- <file>` | Cached diff, unstaged diff and status detect the staged change and inverse worktree change, even though both obsolete BASE-to-worktree checks pass. |
| Commit a protected-file change, then restore only its worktree to BASE | Committed scope/protected checks and unstaged/status checks fail, even though obsolete BASE-to-worktree checks pass. |
| Leave an untracked file | Status check fails even when all diff checks pass. |

Record checker exit status for the passing control and every failing scenario, including the restored-worktree trick from the manager review. Do not commit these deliberate forbidden changes to the actual implementation. Fixture execution and implementation red/green runs are requirements for later states, not tests claimed performed in this issue-review state.

## Review disposition and validation limits

No blocking product question remains. The spec can target status alone, preserve the reviewed design and its known rate trade-off, and add the latest complete scope acceptance. Nonblocking planning work is to make serialization/anchor/stop transitions explicit, inspect pinned tooling, and turn the checks above into concrete task acceptance without repeating prior contradictions.

This state inspected source and instructions; it did not run target implementation tests, the slow-api measurement or the scope fixture. No labels or provider comments were changed. The artifact is retained under `.factory/work/844/` for later states.
