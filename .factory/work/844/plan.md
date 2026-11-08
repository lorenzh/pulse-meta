# Spec #844: status: schedule the settings report heartbeat from its start time

Issue: [#844](https://github.com/lorenzh/pulse-meta/issues/844). Issue review:
`.factory/work/844/issue-review.md`. Parent feature: #570 (child #809, merged as
lorenzh/pulse-status#67).

## Goal

pulse-status sends `PUT /service/status/report` after every settings apply attempt and, as
#570 Decision 5 requires, at least every 60 s. Today the settings poller in
`src/settings-poll.ts` waits `min(pollMs, 60000)` after a poll and its report have *finished*.
The HTTP time of the settings read and the report adds to every interval. With
`PULSE_STATUS_SETTINGS_POLL_MS=60000` and 1000 ms requests, report starts are 62000 ms apart.
The independent review of lorenzh/pulse-status#67 showed this with an injected clock
(`AssertionError: report heartbeat 62000ms exceeds 60000ms`).

This spec schedules the next poll from deadlines that are measured from the *start* of the
previous poll and of its report. It reserves time for the settings read, so that report starts
stay at most 60000 ms apart whatever the request latency is (within the existing 5000 ms
request timeout). It also serializes `pollNow()` with the background loop and makes `stop()`
cancel the report too, not only the read.

## Sources and decisions this spec applies

- Issue #844 and its comments. The only comments are Factory run notes; there are no earlier
  owner decisions.
- The issue review `.factory/work/844/issue-review.md`. It has no blocking question. This spec
  takes its seven open points as follows:
  1. **Target ownership.** Only pulse-status changes. "Fix both the same way" means the same
     principle as #824 (notify): a deadline from the start time instead of a delay after the
     end. #824 is a separate feature, in its own `plan` state at the time of this spec, with no
     merged fix. This spec does not depend on it, copies nothing from it, and adds no shared
     scheduler to pulse-kit.
  2. **A report start** is the moment the poller calls the injected `fetch` for
     `PUT /service/status/report`, whatever the answer is. The tests measure that moment, not
     the response, not a timer delay and not the `at` field of the body.
  3. **Varying latency.** A deadline from the poll start alone is not enough: a fast read and
     then a slow read can still put reports 64000 ms apart (Counterexample C2). Decision D1
     therefore also bounds the next poll start by the last report start minus a read reserve.
  4. **Overdue work.** No catch-up: at most one poll runs, at most one `pollNow()` poll waits,
     and a late timer runs one poll, not several. A suspended event loop or a fetch that
     ignores both its signal and the contract's own timeout race is outside the bound.
  5. **Serialization** covers the timer, `pollNow()` and the report. A settings read and its
     report stay sequential inside one poll.
  6. **Shutdown** is a requirement. `stop()` stays synchronous; it clears the timer and aborts
     whichever request is in flight (read or report). A request that settles after `stop()`
     applies, reports, logs and schedules nothing.
  7. **Compatibility.** Report body, endpoints, methods, headers, redirects, timeouts, size
     limits, ETag handling, readiness, precedence, last-good and rejection rules, local
     reloads, the no-token path and the public responses do not change. The accepted range of
     `PULSE_STATUS_SETTINGS_POLL_MS` (from 1000, default 15000) does not change.
- The plan-review of the first version of this spec (issue comment of 2026-11-07) found three
  defects. This version fixes them: the runtime request-rate increase and its CPU impact, with a
  measurement under delayed answers (Risks, Performance impact, completion evidence); C6 and a
  no-token `pollMs = 120000` case that protects the `min(pollMs, 60000)` cap (Counterexamples,
  test 8); `README.md:34` in scope (Scope, Repository: status).
- The plan-review of the second version (issue comment of 2026-11-08) found that the documented
  bound "reads at most about 54 s apart" contradicts D1 and run B (58 s with 4000 ms reads,
  59 s with read timeouts), and that the Risks section wrongly said the rate never exceeds the
  configured one. This version separates two bounds everywhere (D1 "Two bounds", Scope, Risks,
  the docs requirements of `Repository: status`): the **report-to-next-read bound** (the next
  read starts at most 54000 ms after the previous report start) and the **read-to-read
  spacing** (for `pollMs` above 54000: `min(pollMs, 60000, 54000 + previous read time)`, so
  54000 to 59000 ms in timer time). New test 9 checks both with literals. Risks now states that
  for `pollMs` above 54000 the poller reads more often than today's poller.
- The plan-review of the third version (issue comment of 2026-11-08) found that the spec said
  polling above 54000 ms *is* faster than configured, while D1/R8 can keep the configured rate
  (`pollMs = 55000` with 4000 ms reads gives exactly 55000 ms between reads). This version says
  "can be faster than configured" everywhere (D1 "Rate above the configured one", Risks, the
  docs requirements of `Repository: status`), states exactly when it is faster
  (`54000 + r < pollMs`, `r` = previous read time), and adds a `pollMs = 55000` case to C10 and
  test 9 that asserts the configured 55000 ms spacing with a literal.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/844`
  answered `HTTP 404` on 2026-11-07 and again on 2026-11-08, so this feature has no shared
  findings yet.
- Current code read at pulse-status `main` `469a6cec495d541ab393a23637fe1fbc72f74a42`, and
  pulse-contract `src/client.ts` at the pinned SHA `b637302363b3f147a99280e5961396e6c9f22e7a`
  (identical to the contract clone).

## Current behavior (evidence)

- `src/settings-poll.ts:196-204`: `tick()` awaits `pollOnce()` (settings read, local reread,
  resolve, apply, report) and only then calls
  `deps.setTimeout(() => void tick(), Math.min(deps.pollMs, REPORT_HEARTBEAT_MS))`.
- `src/settings-poll.ts:17,19`: `SETTINGS_TIMEOUT_MS = 5000`, `REPORT_HEARTBEAT_MS = 60_000`.
- `src/settings-poll.ts:103-125`: the read creates `abort = new AbortController()` and passes
  `abort.signal` and `schedule` (built on `deps.setTimeout`) to `fetchJson`.
- `src/settings-poll.ts:155-175`: `sendReport()` calls `requestJson` with `schedule` and
  `timeoutMs: SETTINGS_TIMEOUT_MS`, but **no signal**: `stop()` cannot cancel a report.
- `src/settings-poll.ts:177-194`: after an aborted read, `pollOnce()` goes on to reread the
  local files, apply and report.
- `src/settings-poll.ts:207-215`: `pollNow` is `pollOnce` itself, so a `pollNow()` during a
  background poll runs a second poll at the same time. `stop()` sets `isStopped`, aborts the
  read and clears the timer handle.
- pulse-contract `src/client.ts:157-213` (pinned SHA): `requestJson` and `fetchJson` accept
  `signal?: AbortSignal`; the call settles as soon as the timer fires or the caller aborts,
  "even if fetch ignores the signal" (line 177). So a read or report lasts at most
  `SETTINGS_TIMEOUT_MS` of timer time, and an abort settles it at once.
- `src/settings.ts:16,19,205-208`: `PULSE_STATUS_SETTINGS_POLL_MS` has `min: MIN_POLL_MS`
  (1000) and default `DEFAULT_SETTINGS_POLL_MS` (15000); there is no maximum.
- `src/start.ts:147-167` wires `startSettingsPoll` with real timers and calls the synchronous
  `poll.stop()` from the returned stop function; `src/main.ts:58-66` calls that on shutdown.
- `src/settings-poll.test.ts:98-99` records timer delays without running them; the existing
  tests drive `pollNow()`. No test runs the background loop or measures report starts.
- `docs/configuration.md:32` promises reports "After every attempt, and at least every 60 s".
- `README.md:34` says the server "polls pulse-api's `GET /service/status/settings` every
  `PULSE_STATUS_SETTINGS_POLL_MS` (default 15000)". Under D1 this stops being true above
  54000 ms, so the README changes too (status `AGENTS.md:87-88`: update `README.md` in the same
  change when behavior or a setting changes).

## Decisions

**D1. Next poll deadline.** When a poll ends (and the poller is not stopped and no `pollNow()`
poll waits), the poller arms one timer for the next poll with
`delay = max(0, due - now())`, where

- `pollStart` = `now()` at the start of the poll that just ended;
- `anchor` = `now()` read right before the report request of that poll; if that poll sent no
  report (it threw before it), `anchor = pollStart`;
- without a token: `due = pollStart + min(pollMs, REPORT_HEARTBEAT_MS)` (today's cap, now from
  the start instead of the end);
- with a token:
  `due = min(pollStart + min(pollMs, REPORT_HEARTBEAT_MS), anchor + REPORT_HEARTBEAT_MS - REPORT_LEAD_MS)`.

`REPORT_LEAD_MS = SETTINGS_TIMEOUT_MS + 1000` (6000): the read before the next report takes at
most `SETTINGS_TIMEOUT_MS`; the extra 1000 ms covers the synchronous local file reread, resolve
and apply, and a late timer. Hence the next report starts at most
`anchor + 60000 - 6000 + 5000 = anchor + 59000` in timer time.

Consequences that the docs state:
- With `pollMs` up to 54000 the read cadence is unchanged in the ideal case (one poll every
  `pollMs` from poll start to poll start), and no longer stretched by latency.
- **Two bounds, not one.** D1 bounds the time from a report start to the next read start; it
  does not make reads a fixed 54 s apart. The docs and tests keep the two apart:
  - *Report-to-next-read bound* (with a token): the next read starts at most 54000 ms after
    the previous report start (`due - anchor <= 54000`), so the report after it starts at most
    59000 ms after the previous one (R1).
  - *Read-to-read spacing* (with a token, `pollMs` above 54000, polls shorter than the
    interval): `nextStart - pollStart = min(pollMs, 60000, (anchor - pollStart) + 54000)`, where
    `anchor - pollStart` is the previous read time plus local work. In timer time that is
    54000 ms with instant reads, 55000 ms with 1000 ms reads, 58000 ms with 4000 ms reads and
    59000 ms when the read times out at 5000 ms; never more than `min(pollMs, 60000)` (plus
    the local work, which takes no time on the fake clock). For `54000 < pollMs < 59000` the
    spacing is between 54000 and `pollMs`.
  - So with `pollMs` above 54000 reads are **54 to 59 s apart**, depending on how long the
    previous read took, not "about every 54 s" and not "at most 54 s apart". Today the poller
    already caps the interval at 60 s after the poll end; D1 moves the deadline 6 s ahead of
    the report heartbeat. Test 9 checks both bounds with literal gaps.
- Since `anchor >= pollStart`, two poll starts are at least `min(pollMs, 54000)` apart unless a
  poll itself lasts longer than that. A poll that lasts longer than its interval is followed by
  the next poll at once (`delay = 0`), one at a time: "wait", never overlap, never catch up
  more than one poll.
- With a token the cap `min(pollMs, REPORT_HEARTBEAT_MS)` is masked by the report term:
  `anchor - pollStart` is the read time plus the local work, at most about 5000 ms, so
  `anchor + 54000 < pollStart + 60000` in practice. The cap is kept (it bounds the schedule if
  the local work ever takes longer than 1000 ms) but is only observable without a token. Test 8
  protects it there (C6, C9).
- **Request rate under a slow api.** Today the gap between poll starts is
  `min(pollMs, 60000) + d`, where `d` is the poll's duration (read + report, each up to 5000 ms).
  Under D1 it is `max(due - pollStart, d)` with
  `due - pollStart = min(min(pollMs, 60000), (anchor - pollStart) + 54000)`, which lies between
  `min(pollMs, 54000)` and `min(pollMs, 60000)`. So a slow api no longer stretches the rate by
  its own latency: for `pollMs <= 54000` reads and reports run at the configured rate (or
  back-to-back when a poll lasts longer than `pollMs`); for `pollMs` above 54000 they run
  every 54 to 59 s, which can be faster than configured (see "Rate above the configured one"
  below). Examples (both requests with the same latency `L`):

  | `pollMs` | `L` | old poll-start gap | new poll-start gap | new/old rate |
  | --- | --- | --- | --- | --- |
  | 15000 | 0 | 15000 | 15000 | 1.000 |
  | 15000 | 1000 | 17000 | 15000 | 1.133 (+13.3 %) |
  | 15000 | 4000 | 23000 | 15000 | 1.533 (+53.3 %) |
  | 10000 | 5000 (both time out) | 20000 | 10000 | 2.000 (+100 %, the largest ratio) |
  | 60000 | 0 | 60000 | 54000 | 1.111 (+11.1 %) |
  | 60000 | 4000 | 68000 | 58000 | 1.172 (+17.2 %) |

  The ratio never exceeds 2.0. For `pollMs <= 54000` it is `(pollMs + d) / max(pollMs, d)`,
  which is at most 2, reached when `d = pollMs`. For `pollMs > 54000` it is at most
  `(60000 + d) / 54000`, and `d` is at most about 11000 (two 5000 ms timeouts plus local work),
  so at most about 1.31.
  It is never more than one request in flight and never more than one poll per
  `min(pollMs, 54000)` from poll start to poll start (R4). With fast answers (`L` near 0) the
  rate is unchanged for `pollMs <= 54000`.
- **Rate above the configured one.** For `pollMs <= 54000`, two poll starts are never closer
  than `pollMs`, so the poller never reads faster than configured. For `pollMs` above 54000 it
  *can*: two read starts are `min(pollMs, 60000, 54000 + r)` apart (R8, `r` = the previous read
  time plus local work), which is faster than configured exactly when `54000 + r < pollMs`
  (or `pollMs > 60000`). It keeps the configured rate when the previous read was slow enough:
  `pollMs = 55000` with 4000 ms reads gives exactly `min(55000, 58000) = 55000` ms between
  reads (C10, test 9). It is faster after a fast read: `pollMs = 55000` with instant reads
  gives 54000 ms. The largest increase over the configured rate is reached with instant reads:
  up to `60000 / 54000 = 1.111` times at `pollMs = 60000` and up to
  `120000 / 54000 = 2.222` times at `pollMs = 120000` (and more for larger values). This is not
  new in kind: today the 60 s cap already makes `pollMs` above 60000 read about every 60 s.
  Against today's poller the increase above 54000 is at most about 1.31 times (table above).
  Above 60000 the configured value has no effect with a token (R1 needs a report at least every
  60 s, and every report follows a read); without a token it has no effect either (local reads
  every 60000 ms, R5).
- Alternative considered and rejected: arming `min(pollMs, 60000)` after the poll *end*, bounded
  only by the report deadline. It keeps today's rate under a slow api, but the issue asks to
  schedule from the start of the previous tick. `README.md:34` and `docs/configuration.md:32`
  promise a read "every `PULSE_STATUS_SETTINGS_POLL_MS`"; the start-to-start schedule delivers
  that for `pollMs <= 54000`, and the docs change states the 54 to 59 s spacing above it.

**D2. One lane.** All polls (the first poll, timer polls and `pollNow()` polls) run in one
lane: at most one poll is active at any time.
- A poll start clears the pending timer, if any.
- `pollNow()` while no poll is active starts a poll and resolves when that poll and its report
  are done.
- `pollNow()` while a poll is active waits for it and then runs one fresh poll (a fresh read,
  so callers that changed the fake api see the change). All `pollNow()` calls made while that
  fresh poll is still waiting share it. So at most one poll is active and at most one waits.
- A timer that fires while a poll is active does nothing; the active poll arms the next timer
  when it ends (D1).
- After a `pollNow()` poll the timer is armed from that poll's start and report start (D1).
- `pollNow()` keeps its signature `() => Promise<void>` and still never rejects for an error
  inside the poll (it is logged as today: `status settings poll failed`).

**D3. Shutdown.** `stop()` stays `() => void`, so `src/start.ts` and `src/main.ts` do not
change.
- Each poll has one `AbortController`; its signal goes to the settings read (`fetchJson`) and
  to the report (`requestJson`). `stop()` sets the stopped flag, clears the timer and aborts
  that controller.
- After the read returns, and before the report, the poll checks the stopped flag; when stopped
  it ends without rereading files, resolving, applying, reporting, logging a report failure or
  arming a timer.
- A stopped poller starts no poll: `pollNow()` after `stop()` resolves without a request, and a
  `pollNow()` that waits for the active poll resolves without running its fresh poll.
- A second `stop()` is harmless.

**D4. Constants.** `SETTINGS_TIMEOUT_MS` (5000) and `REPORT_HEARTBEAT_MS` (60000) keep their
names and values. `REPORT_LEAD_MS` is a new exported constant of `src/settings-poll.ts`
(exported so the test can state the bound it checks; the test still uses literal values for its
expectations, see Acceptance). The comment of `REPORT_HEARTBEAT_MS` is corrected: it is the
maximum gap between report starts.

## Scope

- pulse-status `src/settings-poll.ts`: scheduling (D1), lane (D2), shutdown (D3), constants (D4).
- New fake-clock test suite `src/settings-poll.heartbeat.test.ts`.
- `docs/configuration.md`: describe the start-to-start cadence, the two bounds of D1 (the next
  read starts at most 54 s after the previous report start; above 54000 ms reads are 54 to
  59 s apart, depending on the previous read time, and never more than the configured value,
  so they can be faster than configured) and the 60 s report bound.
- `README.md` (line 34, "Live page settings"): the read runs every
  `PULSE_STATUS_SETTINGS_POLL_MS` from start to start; above 54000 ms reads are 54 to 59 s
  apart (never more than the configured value); the report goes out after every read and at
  least every 60 s.

## Non-goals

- No change in pulse-notify: #824 owns the same defect class there.
- No change in contract, api, kit, config, console, deploy, website, probe or agent.
- No shared scheduler helper in pulse-kit.
- No change of the report body (`buildReport`), the routes, the headers, `redirect: "manual"`,
  `SETTINGS_TIMEOUT_MS`, `LOCAL_FILE_MAX_BYTES`, ETag or readiness logic, or the accepted range
  and default of `PULSE_STATUS_SETTINGS_POLL_MS`.
- No change of the browser poller (`src/poller.ts`) or the api poll (`POLL_MS`).
- No guarantee while the event loop is blocked or the process is suspended.
- `stop()` does not become asynchronous; `src/start.ts` and `src/main.ts` stay as they are.

## Required behavior

R1. With a token, for every `pollMs` in the accepted range and any read and report latency of
0 to 5000 ms (including a read or report that times out at `SETTINGS_TIMEOUT_MS`), two adjacent
report starts in normal timed operation are at most 60000 ms apart.

R2. The first poll still runs at once at start and sends a report. Every poll that reaches the
apply step sends one report after it ("after every apply attempt"), also when the read failed,
timed out or answered `304`/`404`.

R3. At no instant are two settings or report requests in flight, and at no instant are two
polls active, whatever mix of timer polls and `pollNow()` calls.

R4. Between two timer-started polls with no `pollNow()` in between, the second starts no
earlier than `min(pollMs, 54000)` after the first, unless the first lasted longer than that
(then it starts when the first ends). No poll starts in a tight loop when a poll throws before
its report.

R5. Without a token: no request to the service routes (as today), local files reread every
`min(pollMs, 60000)` from poll start to poll start; with `pollMs = 120000` that is every
60000 ms, not every 120000 ms.

R6. `stop()` while idle: the pending timer is cleared; no later request. `stop()` during the
settings read: the read's signal is aborted; no apply, no report, no timer afterwards.
`stop()` during the report: the report's signal is aborted; no timer afterwards and no
`status settings report failed` log line. `pollNow()` after `stop()` makes no request.

R7. Everything the existing suites check stays true: `src/settings-poll.test.ts`,
`src/server.runtime-settings.test.ts`, `src/server.settings-churn.test.ts` and the public
response suites pass unchanged.

R8. With a token, in timed operation without `pollNow()` and with polls shorter than their
interval: each read starts at most 54000 ms after the previous report start, and for `pollMs`
above 54000 two adjacent read starts are `min(pollMs, 60000, 54000 + r)` apart, where `r` is
the previous read's duration (local work takes no fake-clock time). This is the spacing the docs
describe (54 to 59 s), not a fixed 54 s.

## Risks

- **More settings reads for large intervals, can be faster than configured.** With `pollMs` above
  54000, reads run 54 to 59 s apart (R8) instead of about 60 s plus the poll duration today.
  With fast answers at `pollMs = 60000` that is about 11 % more
  `GET /service/status/settings` requests (54000 instead of 60000 ms), nearly all `304`.
  Against the configured value this can be *faster* than the operator asked for (whenever
  `54000 + r < pollMs`, `r` = previous read time): up to 1.111 times at `pollMs = 60000` and up
  to 2.222 times at `pollMs = 120000`; with slow reads it can equal the configured rate
  (`pollMs = 55000`, 4000 ms reads: 55000 ms) (D1, "Rate above the configured one").
  Above 60000 the configured value already has no effect today (60 s cap). With fast answers
  the default 15000 is unaffected. Documented in `docs/configuration.md` and `README.md`.
- **More reads and reports under a slow api.** Today a slow api slows the poller down: the
  latency adds to every gap. Under D1 the poller keeps the configured start-to-start rate for
  `pollMs <= 54000` and reads every 54 to 59 s above it (table in D1). At the
  default 15000 ms with 4000 ms answers that is 53.3 % more reads and reports (gap 23000 ->
  15000 ms); the worst ratio is 2.0 (`pollMs = 10000`, both requests timing out). Costs: in
  pulse-status, per extra poll one small JSON parse and contract validation (or a `304`), one
  reread of the local files, one resolve and one report body, a few ms of CPU at most; in
  pulse-api, one more settings read and one report write per extra poll. An api that is slow
  because it is overloaded gets no back-off from the latency any more. This stays bounded: one
  request at a time, and at most one poll per `min(pollMs, 54000)` from start to start (R4).
  That is never faster than the configured rate for `pollMs <= 54000`, but it can be faster
  than configured for `pollMs` above 54000 (up to one poll per 54000 ms, see the first bullet);
  the absolute rate there is still at most one read and one report per 54 s.
  Measured under delayed answers in the completion evidence (delayed-answer run).
- **Back-to-back polls.** With a small `pollMs` and slow answers, a poll may follow the
  previous one at once (D1, `delay = 0`). Each poll is still bounded by two 5000 ms timeouts, so
  the rate is at most one poll per poll duration, never parallel.
- **pollNow semantics in tests.** `pollNow()` now waits for an active background poll before it
  runs its own. Existing tests that call `pollNow()` right after `setup()` keep their read counts
  (the waiting poll is still a fresh read); the implementer runs all three suites to confirm.
- **Abort on shutdown.** A report in flight at shutdown is now cancelled instead of completed.
  The api already handles a missing report: the next start reports again.
- **Cognitive complexity.** The lane plus deadline logic must stay under the SonarJS limit of 15
  per function (`config/eslint.config.js:16` at the pinned config SHA). Split helpers
  (`nextDue`, `runPoll`) as needed, inside `src/settings-poll.ts`.

## Performance impact

The api repository's `bench/budgets.json` lists for `status`: `startup_cpu_ms`, `load_cpu_s`,
`idle_rss_mib`, `peak_rss_mib`, `test_cpu_s` (gating) and `startup_wall_ms`, `image_mb`
(reported).

- `startup_cpu_ms`, `startup_wall_ms`, `idle_rss_mib`, `peak_rss_mib`, `image_mb`: none
  expected. The poller keeps one timer and one controller; the first poll stays immediate.
- `load_cpu_s` (status budget 0.5 s): none expected in the bench. The bench runs status with
  the default 15000 ms settings poll (see `bench/compose.bench.yaml` in the api repository) and
  a local api that answers in a few ms; with `L` near 0 the read cadence in the 60 s window is
  unchanged (4 reads, 4 reports, plus at most one from timing).
- **Outside the bench: CPU under a slow api (not a budget key).** The bench does not delay the
  api's answers, so it cannot show the rate change of D1. With a slow api, pulse-status does
  more polls per minute (up to 1.533x at the default 15000 ms with 4000 ms answers, up to 2.0x
  in the worst case; table in D1). Its CPU over a time window grows with the poll count; the
  CPU per poll does not change. Expected: a few ms of CPU per poll, so at the default with
  4000 ms answers about 6 extra polls per 300 s and well under 100 ms of extra CPU per 300 s.
  pulse-api gets the same factor more settings reads and report writes from this service.
  Measured by the delayed-answer run in the completion evidence of `Repository: status`.
- `test_cpu_s` (status budget 3.4 s): up by a small amount, expected under 0.1 s. The new suite
  runs with a fake clock and no real waits.
- How to measure:
  - `test_cpu_s`: in pulse-status run `bun test` on `main` and on the branch three times each
    and compare the CPU time (`/usr/bin/time -f '%U %S' bun test`); the difference of the
    medians must stay under 0.2 s.
  - CPU under a slow api: the delayed-answer run (completion evidence of `Repository: status`),
    status against a local fake api that delays every answer by 4000 ms, on `main` and on the
    branch.
  - A full A/B is optional (about 40 minutes, Docker needed): in the api repository,
    `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main --b-ref status=<branch SHA> --service-tokens --expect-report status`
    (api `bench/README.md:76,88,100`); `load_cpu_s` and the RSS metrics of `status` must stay
    within their budgets.

## Security impact

Security impact: no
Only the timing of existing requests and their cancellation change; no route, auth, parser,
validator, header, redirect, log text, file write, dependency, Dockerfile or CI changes.

## Rollout order

One repository: only pulse-status changes. Its contract and kit pins stay as they are, and the
report it sends has the same body and route, so every api version that accepts the report today
keeps accepting it. pulse-notify (#824) is fixed independently and in any order.

## Counterexamples

Times are fake-clock milliseconds from the poller start; "latency" applies to each request.

- **C1 (old code, delay after end).** `pollMs = 60000`, latency 1000 ms. Poll 1: read 0-1000,
  report starts at 1000. Old code arms 60000 ms at 2000; poll 2 read 62000-63000, report starts
  at 63000. Gap 62000 > 60000: must fail. With latency 4000: gap 68000: must fail. With latency 0
  the old code gives 60000 and passes (control).
- **C2 (deadline from poll start only).** `pollMs = 60000`. Poll 1 read latency 0, report starts
  at 0. Next poll due at `pollStart + 60000 = 60000`; its read takes 4000 (or times out at 5000).
  Report starts at 64000 (or 65000): gap > 60000. A fix that only uses
  `pollStart + min(pollMs, 60000)` must be caught by the varying-latency test. Under D1 the next
  poll is due at `min(60000, 0 + 54000) = 54000`, report at 58000 (59000 on timeout).
- **C3 (default interval control).** `pollMs = 15000`, latency 4000: old code gives report gaps
  of 23000 and passes; the fix gives 15000. The default cases must pass on both versions.
- **C4 (overlap through pollNow).** `pollMs = 1000`, settings read held open. A `pollNow()` call
  during the held read must not start a second `GET`; the old code starts it at once (two
  requests in flight). Three `pollNow()` calls during the held read cause exactly one extra poll
  after the held one, not three.
- **C5 (tight loop).** With a token, `resolve` throws on every poll after the first. A fix that
  computes `due` from the last *successful* report start would get `delay = 0` forever. Under D1
  (`anchor = pollStart` when no report started) the polls in 120000 ms of fake time at
  `pollMs = 60000` start at 0, 54000 and 108000: 3 settings reads. The test asserts `<= 4` reads
  (a tight loop gives hundreds). The old code also passes this test (reads at 0, 60000,
  120000); it guards against a wrong fix, not the old defect.
- **C6 (interval above the heartbeat, with a token).** `pollMs = 120000`, latency 1000. Poll 1:
  read 0-1000, `anchor = 1000`, report 1000-2000. Under D1 the next poll is due at
  `min(0 + min(120000, 60000), 1000 + 54000) = 55000`; its report starts at 56000, gap 55000.
  The old code arms 60000 ms at 2000; poll 2 reads 62000-63000 and its report starts at 63000:
  gap 62000, which must fail. A fix that drops the cap
  `min(pollMs, REPORT_HEARTBEAT_MS)` gives `min(0 + 120000, 55000) = 55000`, the *same* value:
  with a token the report term masks the cap, so this case cannot detect the cap's removal. It
  only guards R1 for intervals above 60000.
- **C9 (the cap, without a token).** `token: undefined`, `pollMs = 120000`, no requests; local
  reads run synchronously at poll start. Required (R5): `readLocal` call times over 300000 ms of
  fake time are exactly `[0, 60000, 120000, 180000, 240000, 300000]`. A fix that drops
  `min(pollMs, REPORT_HEARTBEAT_MS)` gives `[0, 120000, 240000]` (gap 120000) and must fail. The
  old code gives the required list too (it applies the cap after the end, and the local poll
  takes no fake time); this case guards against a wrong fix, not the old defect.
- **C10 (the two bounds of D1).** With a token, `pollMs = 60000`, report latency 0, the same
  read latency `r` on every poll. Under D1 poll `n` starts at `n * (54000 + r)`, its report at
  `n * (54000 + r) + r`. Required: read-start gaps exactly `54000` (`r = 0`), `55000`
  (`r = 1000`), `58000` (`r = 4000`), `59000` (read held until its 5000 ms timeout); every
  read start minus the previous report start exactly `54000`. A wrong reading of the docs, "reads
  at most 54 s apart" (a fixed 54000 ms start-to-start deadline), gives read gaps of 54000 for
  every `r`, and with `r = 4000` it sends the next read 50000 ms after the previous report; the
  literal `58000` catches it. The old code gives `60000 + r` and fails too.
  Second part, the configured rate kept: `pollMs = 55000`, read latency `r = 4000`, report
  latency 0. Under D1 `due - pollStart = min(55000, 60000, 4000 + 54000) = 55000`. Required:
  read-start gaps exactly `55000` (not faster than configured), every read start minus the
  previous report start exactly `51000`. A wrong claim or implementation that always reads
  54 to 59 s apart regardless of `pollMs` (dropping `min(pollMs, ...)` with a token) gives
  `58000` and fails; the old code gives `59000` (`55000 + r`) and fails.
- **C7 (shutdown during report).** Report held open; `stop()`; then advance the fake clock by
  300000 ms and settle the held report. A wrong fix that does not pass the signal to the report
  leaves the report fetch's signal not aborted (assert `signal.aborted === true`), and a wrong
  fix that rearms after the report arms a timer (assert the fake timer queue holds no poll timer
  and no further fetch happens).
- **C8 (shutdown during read).** Read held open; `stop()`. The read's signal is aborted; no
  `apply`, no report fetch follows, even after the clock advances 300000 ms.

Statistic used by the tests: **report-start gap** = difference of the fake-clock times of two
consecutive calls of the fake `fetch` with method `PUT` and path `/service/status/report`, in
the order the calls happened. Sample set: all such gaps from the first report until the end of
the run (the run lasts until at least 4 report starts, so at least 3 gaps, are recorded). The
check is on the maximum of the gaps, compared with the literal 60000. No averages, no
percentiles, no rounding (integer milliseconds of the fake clock).

## Contract fields

No new contract names. The only new name is the internal constant `REPORT_LEAD_MS` in
pulse-status `src/settings-poll.ts`. Search, run on 2026-11-07:

```sh
grep -rn 'REPORT_LEAD_MS' .repos/contract/src .repos/config/src .repos/status/src
# no output, exit 1
```

No route, wire field, header, environment variable or setting is added or renamed.

## Repository: status

Files:
- `src/settings-poll.ts` (change)
- `src/settings-poll.heartbeat.test.ts` (new)
- `docs/configuration.md` (change)
- `README.md` (change)

Behavior change: yes
The background poll schedule, `pollNow()` serialization and the cancellation of the report on
`stop()` change.

### Tooling facts (cited)

- Bun 1.4.0: `package.json:9` (`engines.bun`) and `package.json:38` (`packageManager`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test`: `package.json:19`.
  `test` is `bun test` (`package.json:14`); `lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`); `typecheck` runs
  `tsc --noEmit` from `typescript7` on the root and `e2e` projects (`package.json:13`).
- Biome `2.6.3`: `package.json:23`. `biome.json` only `extends` `@lorenzh/pulse-config/biome.json`;
  the config pin is `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). In that
  pinned file `files.includes` is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`,
  `test/fixtures` (lines 10-17), `noNonNullAssertion` is an error except in `**/*.test.ts`
  (lines 45-46, 53-63), `noExplicitAny` is an error (line 49). The pinned file is identical to
  the config clone.
- ESLint: `eslint.config.js` extends `@lorenzh/pulse-config/eslint.config.js`; at the pinned SHA
  line 16 sets `sonarjs/cognitive-complexity` to `["error", 15]` (identical to the clone).
- Coverage: `bunfig.toml:2-3` enables coverage with a line threshold of 0.8.
- CI: `.github/workflows/ci.yml:18` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`,
  which runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test`
  (pinned `check.yml` lines 25-38, identical to the clone).

### Behavior

Implement D1-D4 in `src/settings-poll.ts`:
- Keep `SettingsPollDeps` and `SettingsPoll` unchanged (fields, types, `stop: () => void`).
- One `AbortController` per poll, its signal passed to `fetchJson` (read) and `requestJson`
  (report). Keep `redirect: "manual"`, `timeoutMs: SETTINGS_TIMEOUT_MS`, `schedule`, headers
  and `buildReport` arguments as they are.
- Record `pollStart` at the start of every poll and `anchor` right before the report request.
- Stopped checks after the read and before the report (D3).
- One lane for timer polls and `pollNow()` (D2); the timer is cleared when a poll starts and
  armed with `max(0, due - now())` when the lane is idle after a poll (D1).
- Update the comment on `REPORT_HEARTBEAT_MS` (maximum gap between report starts) and add a
  one-line comment on `REPORT_LEAD_MS` (why the read reserve exists).

Documentation keeps the two bounds of D1 apart (R8). It never says the reads are "about every
54 s", "every 54 s" or "at most 54 s apart".

`docs/configuration.md` line 32 (the paragraph on the settings read) states:
- the interval runs from the start of one read to the start of the next, so a slow api no
  longer stretches it;
- with a token, the next read starts at most 54 s after the previous report started, so the
  report after it starts at most 60 s after the previous report, even when the read takes its
  full 5000 ms timeout;
- consequence for `PULSE_STATUS_SETTINGS_POLL_MS` above 54000: reads are 54 to 59 s apart
  (54 s after a fast read, up to 59 s after a read that timed out, never more than the
  configured value), so they can be faster than the configured value: faster when 54 s plus
  the previous read time is less than it, the configured value otherwise; values from 60000
  up behave the same. The docs say "can be faster", never that reads above 54000 are always
  faster than configured.

`README.md:34` ("Live page settings"): the sentence "polls pulse-api's
`GET /service/status/settings` every `PULSE_STATUS_SETTINGS_POLL_MS` (default 15000)" gets the
qualifier that the interval runs from start to start, that above 54000 the reads are 54 to 59 s
apart (never more than the configured value, so they can be faster than it), and that the report to `PUT /service/status/report` is sent after every read and at
least every 60 s. Keep the rest of the paragraph unchanged. No other README section changes.

### Checks (new suite `src/settings-poll.heartbeat.test.ts`)

Harness, in the test file only (no new export in `src/`):
- A fake clock: `clock` starts at 0; `now()` returns `clock`; `setTimeout(fn, ms)` stores `{ id, due: clock + ms, fn }`;
  `clearTimeout(id)` removes it. A `run(untilMs)` driver repeatedly drains promise jobs (enough
  `setImmediate` rounds that no new job appears, as `settle()` in `src/settings-poll.test.ts:107`),
  then takes the earliest timer, sets `clock = due`, removes and calls it, until the earliest
  timer is later than `untilMs`. No real timers and no real network.
- A fake `fetch` that records `{ method, path, at: clock, signal }` at call time, keeps an
  in-flight counter (asserts it never exceeds 1), and answers after the configured latency via
  the fake `setTimeout`; it rejects with an `AbortError` when its signal aborts. Settings answer:
  `200`, body `{"revision": "sha256-<64 × '1'>", "settings": {}}`, `etag` `"e1"` and the wire
  header `WIRE_VERSION_HEADER: "1"` (as `src/settings-poll.test.ts:61,76-77`); later reads may
  answer `304`. Report answer: `204` with the wire header. A "hold" mode keeps a request open
  until the test releases it or its signal aborts.
- The real `startSettingsPoll` with `resolve` from `resolveSettings` and an empty file layer, as
  in `src/settings-poll.test.ts:88-102`.

Tests (expected values are literals in the test):
1. **Six-case regression.** For `pollMs` in `[60000, 15000]` and latency in `[0, 1000, 4000]`
   (same latency for read and report): run until at least 4 report starts are recorded (assert
   `reports.length >= 4`); assert the largest report-start gap is `<= 60000`; assert in-flight
   requests never exceeded 1. Rate bound (R4): the smallest gap between two settings `GET`
   starts is `>= 15000` in the 15000 cases and `>= 54000` in the 60000 cases (literals). One
   case also asserts `DEFAULT_SETTINGS_POLL_MS === 15000` and uses it for the 15000 cases. Old
   code: `60000/1000` (62000) and `60000/4000` (68000) fail; the other four pass.
2. **Varying read latency (C2).** `pollMs = 60000`, read latencies `0, 4000, 0, 4000, …` and
   report latency 0; and a second case where every second read never answers (times out at
   5000 via the contract's timer). Largest gap `<= 60000`, at least 4 reports.
3. **Slow report.** `pollMs = 60000`, read 0, report 4000 and report timeout (held until the
   5000 ms timer): largest gap `<= 60000`, never two requests in flight.
4. **Interval above the heartbeat, with a token (C6).** `pollMs = 120000`, latency 1000:
   largest gap `<= 60000`, at least 4 reports. This guards R1 only; with a token it cannot see
   the `min(pollMs, 60000)` cap (C6), test 8 does.
5. **Small interval, held request (C4).** `pollMs = 1000`, read held open at its second poll;
   call `pollNow()` three times; assert no second `GET` starts while the held one is open;
   release it; assert exactly one extra poll runs (count of `GET` = held poll + 1), all three
   `pollNow()` promises resolve after that poll's report fetch completed, and the background loop
   continues afterwards (another `GET` after the clock advances 1000 ms).
6. **No tight loop (C5).** `resolve` throws after its first two calls (the call at start and
   the first poll); `pollMs = 60000`; run 120000 ms; assert at most 4 `GET` requests.
7. **Shutdown.** (a) idle with a pending timer: `stop()`, run 300000 ms, zero new fetches, timer
   queue empty. (b) during the read (C8): signal aborted, no report fetch, `apply` count
   unchanged, timer queue empty after 300000 ms. (c) during the report (C7): report signal
   aborted, no later fetch, timer queue holds no poll timer, no log line containing
   `status settings report failed`. (d) `pollNow()` after `stop()` resolves with zero fetches;
   a second `stop()` does not throw.
8. **No token, and the cap (C9).** Two cases, `token: undefined`, `pollMs = 60000` and
   `pollMs = 120000`, each run until 300000 ms of fake time: zero fetches, and the fake-clock
   times of the `readLocal` calls equal exactly `[0, 60000, 120000, 180000, 240000, 300000]`
   (literal list) in both cases. The `120000` case fails on a fix that drops
   `min(pollMs, REPORT_HEARTBEAT_MS)` (it gives `[0, 120000, 240000]`).
9. **The two bounds of D1 (C10, R8).** With a token, `pollMs = 60000`, report latency 0, read
   latency the same on every poll; four cases: read latency `0`, `1000`, `4000`, and every read
   held until the contract's 5000 ms timeout. Run until at least 5 settings `GET` starts are
   recorded. Assert every gap between adjacent `GET` starts equals exactly the literal of its
   case: `54000`, `55000`, `58000`, `59000`. Assert every `GET` start after the first minus the
   previous report start equals exactly `54000`. One more case, `pollMs = 120000` with read
   latency `4000`: `GET`-start gaps exactly `58000` (the configured value above 60000 has no
   effect with a token). One more case, `pollMs = 55000` with read latency `4000` (C10 second
   part): `GET`-start gaps exactly `55000` (the configured rate is kept) and every `GET` start
   after the first minus the previous report start exactly `51000`. Old code: every case fails
   (`GET`-start gaps `pollMs + r`: 60000, 61000, 64000, 65000, 64000 in the `pollMs = 120000`
   case and 59000 in the `pollMs = 55000` case).

### Completion evidence

- Red: the new suite run on the old `src/settings-poll.ts` (`main` at
  `469a6cec495d541ab393a23637fe1fbc72f74a42` or the merge base) with
  `bun test src/settings-poll.heartbeat.test.ts`: the two latency cases of test 1 at
  `pollMs = 60000` fail with a gap assertion (62000 and 68000), and tests 2, 3, 4, 5, 7b, 7c
  and 7d fail (old `pollOnce` reports after an aborted read, and old `pollNow` ignores
  `stop()`), and all six cases of test 9 fail (read-start gaps 60000, 61000, 64000, 65000,
  64000 and 59000 instead of the literals); the 15000 controls and tests 6, 7a and both cases of 8 pass
  (6 and 8 guard against a wrong fix, not the old defect). A compile or install error is not
  red evidence. Record the command and the failing assertion text in the PR.
- Green: the same command passes on the branch.
- `bun run check` passes (lint, typecheck, test with the 0.8 line coverage threshold).
- `bun test src/settings-poll.test.ts src/server.runtime-settings.test.ts src/server.settings-churn.test.ts`
  passes without changes to those files (`git diff --exit-code main -- src/settings-poll.test.ts src/server.runtime-settings.test.ts src/server.settings-churn.test.ts`).
- `git diff --exit-code main -- src/start.ts src/main.ts src/runtime-settings.ts src/settings.ts`
  is empty (no change outside the poller).
- Docs keep the two bounds apart (R8):
  `grep -nE 'every 54 s|about 54 s|at most (about )?54 s apart' README.md docs/configuration.md`
  prints nothing (exit 1), and `grep -c '54 to 59 s' README.md docs/configuration.md` prints a
  count of at least 1 for each file (literal phrase from this spec), and
  `grep -c 'can be faster' docs/configuration.md` prints at least 1 (literal phrase from this
  spec; the docs never claim reads above 54000 are always faster than configured). A reviewer reads both
  sentences against D1 "Two bounds": the 54 s figure appears only as the time from a report
  start to the next read start.
- **Delayed-answer run (start check and CPU under a slow api).** A fake api, a small Bun script
  kept outside the repository (for example under `/tmp`, not committed), listens on
  `127.0.0.1`. It answers `GET /service/status/settings` with `200`, the valid body and wire
  header of the test harness and `etag: "e1"` (then `304` to `If-None-Match: "e1"`), and
  `PUT /service/status/report` with `204` and the wire header, each after a fixed delay of
  4000 ms. It logs the arrival time (ms) of every request. Start status on `main` (or the merge
  base) and on the branch with `bun start`, `PULSE_API_URL=http://127.0.0.1:<port>`,
  `PULSE_STATUS_API_TOKEN` set to a dummy value and a free `PORT`. Take the CPU time of the
  status process as `utime + stime` (fields 14 and 15 of `/proc/<pid>/stat`, clock ticks; 10 ms
  resolution) at the first settings `GET` and 300000 ms later. Expected values below are
  literals derived from the timing in D1, not from the code under test; real timers add a few
  ms per cycle, hence the ±1.
  - Run A, `PULSE_STATUS_SETTINGS_POLL_MS=15000`, 300000 ms window, three runs per side:
    settings `GET` starts in the window: `main` 14 ±1 (gap 23000), branch 20 ±1 (gap 15000);
    report `PUT` count equals the `GET` count ±1. CPU: report the median CPU ms of each side and
    the CPU ms per poll. Gate: the branch median exceeds the `main` median by at most 300 ms
    (0.1 % of one core over 300 s); expected well under 100 ms.
  - Run B, `PULSE_STATUS_SETTINGS_POLL_MS=60000`, until at least 4 report starts per side: the
    first report starts at about 4000 ms (right after the first read); report-start gaps are
    68000 ±50 on `main` and 58000 ±50 on the branch, so every branch gap is below the literal
    60000. The two bounds of D1 in the same logs: settings `GET` arrival gaps are 68000 ±50 on
    `main` and 58000 ±50 on the branch (not 54000: the read-to-read spacing includes the
    4000 ms read), and each `GET` arrival minus the previous `PUT` arrival is 64000 ±50 on
    `main` and 54000 ±50 on the branch. Stop with Ctrl-C and see a clean exit.
  Report the commands, the request logs (times), the counts and the CPU numbers in the PR.

## Acceptance evidence (feature)

- The PR in lorenzh/pulse-status shows the red run (old code fails the 60000 ms latency cases
  of the new test with a report-start gap above the literal 60000) and the green run.
- `bun run check` passes in pulse-status on the PR head; CI `check` job green.
- The existing settings-poll and runtime-settings suites pass unchanged.
- The PR shows the delayed-answer runs A and B with the literal expectations of the status
  section (A: 14 ±1 vs 20 ±1 reads in 300 s, CPU difference at most 300 ms; B: report gaps
  68000 ±50 on `main`, 58000 ±50 on the branch; on the branch read gaps 58000 ±50 and read
  minus previous report 54000 ±50).
- `README.md` and `docs/configuration.md` describe the read spacing above 54000 as "54 to
  59 s" and the 54 s figure only as the time from a report start to the next read start (grep
  check of the status section).
- No file outside `src/settings-poll.ts`, `src/settings-poll.heartbeat.test.ts`,
  `docs/configuration.md` and `README.md` changes in pulse-status.
