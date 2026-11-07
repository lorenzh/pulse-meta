# Issue review: #844

Reviewed 2026-11-07. Outcome: transition to `plan`. No question blocks the spec.

## Evidence and prior decisions

- Read meta `AGENTS.md`, `README.md`, `.factory/prompts/issue-review.md`, the status and notify instructions, and the relevant parts of the #570 plan. Target repositories remain read-only.
- Read [#844 and its comments](https://github.com/lorenzh/pulse-meta/issues/844). Its only comment is the current Factory claim; there are no earlier decisions to carry forward.
- Read [#824 and its comments](https://github.com/lorenzh/pulse-meta/issues/824). It is a separate open notify heartbeat feature, currently in issue-review, with only a Factory claim comment. There is no approved or merged fix to copy yet.
- Inspected status HEAD `469a6cec495d541ab393a23637fe1fbc72f74a42` and notify HEAD `5a44c5a3de1764faa04b6cd3762f2c2be4c58430` in `.repos/`.
- Status `src/settings-poll.ts:196-205`: the immediate first `tick()` awaits the settings read, local resolution/application and report, then schedules another tick after `min(pollMs, 60000)`. Both HTTP durations therefore accumulate in the interval. `SETTINGS_TIMEOUT_MS` is 5000 for each request.
- Status `src/settings.ts:19,205-209`: the settings poll default is 15000 ms, the floor is 1000 ms, and 60000 ms is accepted. This is `PULSE_STATUS_SETTINGS_POLL_MS`, not the unrelated public/API polling setting `POLL_MS`.
- Status `src/settings-poll.test.ts:78-112`: existing tests inject a fixed clock and record timer delays without running the background callbacks; they subsequently drive `pollNow()`. They do not test recurring report-start gaps.
- Status `src/settings-poll.ts:207-215`: `pollNow` calls `pollOnce` directly, bypassing background serialization. `stop()` clears the pending tick timer and aborts the settings-read controller, but the report does not receive that signal. A stopped read can also continue into the remaining cycle. Thus shutdown protection is incomplete in this baseline, despite the issue's wording "as today".
- Status `src/start.ts:135-172` wires the poller and calls its synchronous `stop()`. `src/main.ts:58-66` calls that polling stop function during service shutdown. Any choice to await work must be propagated through these callers; cancellation can preserve their synchronous signatures.
- Notify `src/index.ts:840-912` has separate poll and heartbeat timers. Its heartbeat rearms after report completion, and reports from the two paths are not mutually serialized. Its stop awaits tracked poll/report promises; `test/channel-loop.review.test.ts:92` protects in-flight heartbeat shutdown. This is relevant context for #824, not an existing corrected implementation.
- #570 plan Decision 5 and its status section require reports after every apply attempt and at least every 60 s. Status `docs/configuration.md:32` already documents that promise, request timeouts, last-good settings, and no remote requests without a token.

## Open points and scope assumptions

1. **Target ownership.** #844 targets status only. "Fix both the same way" means use the same deadline-based scheduling principle as the separately owned #824 notify fix. Do not duplicate notify work, rebuild #570, add a shared scheduler package, or create a dependency on an unmerged #824 implementation. Recheck #824 when planning for any newly recorded decisions; each feature can proceed independently.

2. **Measure actual report starts.** A report start is the invocation of injected fetch for `PUT /service/status/report`, regardless of eventual success, rather than response completion or a tick callback. Every adjacent pair of starts must satisfy the bound during normal timed operation. The first poll remains immediate, and every completed apply attempt still reports. Heartbeats must not depend on settings changes or successful settings responses.

3. **Variable latency needs explicit treatment.** Rearming with `max(0, tickStart + min(pollMs, 60000) - now())` removes completion-time drift and passes the requested fixed-latency matrix, but alone does not prove the full requirement. For example, successive settings reads taking 0 and 4000 ms can put reports 64000 ms apart even with ticks 60000 ms apart. The plan must account for the actual last report start and the bounded settings-read time, or use a separately scheduled heartbeat with coordinated access to the same request lane. Reserve enough time before a report deadline for any preceding settings read, or otherwise arrange the work so that read cannot push the report past its deadline. Add a varying-latency check; do not weaken acceptance to tick-start spacing.

4. **Bounded operation and overdue ticks.** "Whatever the HTTP time" includes slow successes, failures and timeouts under the existing 5000 ms per-request timeout. It cannot guarantee a real-time bound while the event loop is suspended or a dependency ignores cancellation indefinitely. In exceptional overdue execution, honor the explicit skip-or-wait rule: keep at most one cycle/request active, resume without unbounded catch-up work, and never overlap to recover a missed deadline. Preserve timeout values and the accepted settings range; do not solve the defect by rejecting 60000 ms polling.

5. **Serialization includes explicit polling.** Interpret "never run two at once" across timer callbacks, any separate heartbeat, and the exported `pollNow()` entry point. A settings read and its report remain sequential. Joining an active cycle or queuing a bounded follow-up is an implementation choice; preserve `pollNow()`'s promise that it resolves after the relevant poll and report finish. A stopped poller must not start work through either entry point.

6. **Shutdown is a requirement, not an assumption about baseline correctness.** Track and clear every introduced scheduling timer, cancel or await whichever settings/report request is active, and prevent a settling request or queued callback from applying, reporting or rearming after stop. Since the report currently lacks caller cancellation, the plan must explicitly cover it. If shutdown becomes asynchronous, update the service wiring as well. Keep this repair within the poller lifecycle rather than expanding to unrelated service shutdown behavior.

7. **Compatibility.** Preserve report payload construction, authentication, methods/URLs, redirects, timeout/size limits, ETag and readiness behavior, precedence, rejection/last-good settings, local reloads, public responses, and the no-token path. No contract, api, kit, config or deployment change is required by the inspected evidence. Retain the existing cap that makes reporting possible even when the configured poll interval exceeds 60000 ms. Deadline enforcement may require earlier work; do not introduce unrelated polling-setting changes.

## Derived acceptance

Use the real exported `startSettingsPoll`, an injected clock, injected timers and abort-aware fake fetch; no external network or wall-clock delays. Execute scheduled background callbacks in due-time order and drain their async continuations before advancing to the next deadline. Include request timeout timers and their cancellation in the fake clock, so the test cannot pass by ignoring scheduled work.

### Required six-case regression

For each `pollMs` in `{60000, DEFAULT_SETTINGS_POLL_MS (15000)}` and each request latency in `{0, 1000, 4000}` ms:

- Give both settings GET and report PUT that latency, with valid successful responses. Record every report's fetch start independently of its response completion. Verify the configured default remains 15000 ms.
- Run long enough to observe at least three report starts and consecutive intervals, including completion of slow requests. Require the report count explicitly, so an absent or stopped heartbeat cannot pass vacuously.
- Assert every adjacent start gap is at most 60000 ms and at most one settings/report request is active at any instant. Do not assert only a scheduled delay or report body's timestamp.
- Stop and verify timers/work are cleaned up.

The source-derived old-code expectations below are not an executed reproduction:

| Poll interval | Per-request latency | Old report-start gap | Expected old result |
| --- | --- | --- | --- |
| 60000 | 0 | 60000 | Pass control |
| 60000 | 1000 | 62000 | Fail heartbeat bound |
| 60000 | 4000 | 68000 | Fail heartbeat bound |
| 15000 | 0 | 15000 | Pass control |
| 15000 | 1000 | 17000 | Pass control |
| 15000 | 4000 | 23000 | Pass control |

Implementation evidence must run the new regression on the old implementation and show the latency-induced assertion failures, then run it on the fix and pass all six cases. The controls are expected to pass on both versions; installation/type errors are not red-test evidence.

### Additional lifecycle and timing checks

- Vary settings-read and report latency between successive cycles, including a fast read followed by a 4000 ms read at `pollMs = 60000`; actual report-start gaps still stay within 60000 ms. Cover slow report completion separately from slow settings reads.
- Hold a request open across a due tick with a short accepted poll interval, invoke `pollNow()` while work is active, and verify serialization, bounded pending work, and continued progress. Include a poll interval above 60000 to protect the existing heartbeat cap.
- Exercise settings failure/timeout and report failure/timeout; reports continue after apply attempts and through subsequent deadlines, with no overlapping request. Existing last-good settings and rejection behavior remain intact.
- Stop while idle with a pending timer, during a settings GET, and during a report PUT. Observe cancellation or completed awaiting as appropriate; advancing the fake clock or settling an old request afterwards must not start another read, apply or report, or rearm a timer. Repeated stop remains harmless.
- Preserve no-token local reload and readiness behavior with zero service requests. Retain the existing settings/report tests and the public response regression suites.
- In pulse-status, `bun run check` passes (lint, typecheck and tests). Follow its required red/green workflow and startup verification. Record baseline/candidate SHAs and executed commands in build evidence.

## Review limits

This state changes only this review artifact. No target files were changed, dependencies installed, or implementation tests run; the target dependency directory is absent. The timing table is derived from inspected control flow, and the issue's injected-clock failure remains reported evidence until reproduced in build.

Initial missing guessed source paths were resolved by inspecting the actual modules (`contract/src/client.ts`, `kit/src/settings.ts`, and notify's loop in `src/index.ts`). Managed environment-status tooling and `/etc/codex/network-policy.json` are unavailable; no environment readiness is inferred. Read-only GitHub issue/comment calls succeeded. No provider labels or comments were changed.
