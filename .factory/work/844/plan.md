# Spec #844: status: schedule the settings report heartbeat from its start time

Issue: [#844](https://github.com/lorenzh/pulse-meta/issues/844). Issue review:
`.factory/work/844/issue-review.md`. Parent feature: #570 (child #809, merged as
lorenzh/pulse-status#67). Twin issue in pulse-notify: #824 (not a dependency).

## Goal

pulse-status sends `PUT /service/status/report` after every settings apply attempt and, as
#570 requires, at least every 60 s. Today the settings poller in `src/settings-poll.ts` waits
`min(pollMs, 60000)` after a poll and its report have *finished*. The HTTP time of the settings
read and of the report adds to every interval. With `PULSE_STATUS_SETTINGS_POLL_MS=60000` and
1000 ms requests, report starts are 62000 ms apart. The independent review of
lorenzh/pulse-status#67 showed this with an injected clock
(`AssertionError: report heartbeat 62000ms exceeds 60000ms`).

This spec schedules the next poll from deadlines measured from the *start* of the previous poll
and of its report. It reserves time for the next settings read, so that report starts stay at
most 60000 ms apart whatever the request latency is (within the existing 5000 ms request
timeout). It also serializes `pollNow()` with the background loop and makes `stop()` cancel the
report too, not only the read.

## Sources and decisions this spec applies

- Issue #844, including the "Added requirements (manager decision)" section: scope checks
  compare against a recorded implementation base (so staged and committed changes are caught),
  and `README.md` is in `Files:` with the required update.
- The issue comments. They are Factory run notes. The earlier spec run went through three
  plan-review rounds and ended with a passing plan-review; its spec PR (#846, last commit
  `a5308df452e6d1e0ff8eb929bda1389eba817971`) was closed without a comment, and the issue was
  restarted. This spec carries that reviewed design forward. The corrections the reviews asked
  for are all in it:
  1. Round 1: the runtime request-rate increase under a slow api and its CPU impact, with a
     measurement under delayed answers (Risks, Performance impact, completion evidence); C6
     corrected and a no-token `pollMs = 120000` case that protects the `min(pollMs, 60000)` cap
     (C9, test 8); `README.md:34` in scope.
  2. Round 2: two bounds kept apart everywhere (D1 "Two bounds", R8, C10, test 9): the
     **report-to-next-read bound** (the next read starts at most 54000 ms after the previous
     report start) and the **read-to-read spacing** (for `pollMs` above 54000:
     `min(pollMs, 60000, 54000 + previous read time)`, so 54000 to 59000 ms). The docs never say
     "every 54 s", "about 54 s" or "at most 54 s apart".
  3. Round 3: above 54000 ms the poller *can be* faster than configured, not always
     (`pollMs = 55000` with 4000 ms reads keeps exactly 55000 ms; C10 second part, test 9).
- The issue review `.factory/work/844/issue-review.md` (no blocking question). Its open points are
  taken as follows:
  1. **Target ownership.** Only pulse-status changes. "Fix both the same way" means the same
     guarantees as #824 (deadline from start times, one lane, cancellable shutdown). #824 is a
     separate feature; this spec does not depend on it, copies no code from it, and adds no
     shared scheduler to pulse-kit.
  2. **A report start** is the moment the poller calls the injected `fetch` for
     `PUT /service/status/report`, whatever the answer is (failed and timed-out attempts count).
     The tests measure that moment, not the response, a timer delay or the `at` field.
  3. **Varying latency.** A deadline from the poll start alone is not enough: a fast read and
     then a slow read can still put reports 64000 ms apart (C2). D1 therefore also bounds the
     next poll start by the last report start minus a read reserve.
  4. **Overdue work.** No catch-up: at most one poll runs, at most one `pollNow()` poll waits, a
     late timer runs one poll. A blocked event loop, a suspended process or a clock jump is
     outside the bound.
  5. **Serialization** covers the timer, `pollNow()`, the local apply and the report.
  6. **Shutdown** is a requirement. `stop()` stays synchronous and idempotent; it clears the
     timer and aborts the request in flight (read or report). Nothing applies, reports, logs a
     report failure or re-arms after `stop()`.
  7. **Compatibility.** Report body, endpoints, methods, headers, redirects, timeouts, size
     limits, ETag handling, readiness, 404 handling, precedence, last-good and rejection rules,
     local rereads, the no-token path and the public responses do not change. The accepted range
     of `PULSE_STATUS_SETTINGS_POLL_MS` (from 1000, default 15000) does not change.
  8. **Files.** Exactly `src/settings-poll.ts`, new `src/settings-poll.heartbeat.test.ts`,
     `README.md` and `docs/configuration.md`.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/844`
  answered `HTTP 404` (Not Found) on 2026-11-08 in this run, so this feature has no shared
  findings. No question in this spec is asked in more than one repository.
- Code read at pulse-status `main` `bcd83dad0975954b687ce89fc8ad369ba3a94e8a`, and
  pulse-contract `src/client.ts` at `1b5e7d3e268372a6241db05ae30272eab7299b10`, the SHA that
  status pins in `package.json:34` and also the HEAD of the contract clone.

## Current behavior (evidence)

- `src/settings-poll.ts:196-204`: `tick()` awaits `pollOnce()` (settings read, local reread,
  resolve, apply, report) and only then calls
  `deps.setTimeout(() => void tick(), Math.min(deps.pollMs, REPORT_HEARTBEAT_MS))`.
- `src/settings-poll.ts:17,19`: `SETTINGS_TIMEOUT_MS = 5000`, `REPORT_HEARTBEAT_MS = 60_000`.
  Neither is imported by another file in `src/` (`grep -n 'REPORT_HEARTBEAT_MS\|SETTINGS_TIMEOUT_MS' src/*.ts`).
- `src/settings-poll.ts:103-125`: the read creates `abort = new AbortController()` and passes
  `abort.signal` and `schedule` (built on `deps.setTimeout`, lines 96-99) to `fetchJson`.
- `src/settings-poll.ts:155-175`: `sendReport()` calls `requestJson` with `schedule` and
  `timeoutMs: SETTINGS_TIMEOUT_MS` but **no signal**: `stop()` cannot cancel a report, and an
  aborted report would log `status settings report failed`.
- `src/settings-poll.ts:177-194`: after an aborted read, `pollOnce()` goes on to reread the
  local files, apply and report.
- `src/settings-poll.ts:206-215`: `void tick()` starts the first poll; `pollNow` is `pollOnce`
  itself, so a `pollNow()` during a background poll runs a second poll at the same time, and a
  `pollNow()` after `stop()` still makes requests. `stop()` sets `isStopped`, aborts the last
  read controller and clears the timer handle.
- pulse-contract `src/client.ts` at `1b5e7d3`: `FetchJsonOptions` has `signal?: AbortSignal`
  (line 34) and `schedule` (line 41); `RequestJsonOptions` derives from it (line 231).
  `interruptible` (lines 156-209) races the request against the timeout and the caller's
  signal: it "Settles first when the timer fires or the caller aborts, even if fetch ignores
  the signal" (line 177), and aborts its own controller in `finally` (line 207). So a read or
  report lasts at most `SETTINGS_TIMEOUT_MS` of timer time, and an abort settles it at once.
- `src/settings.ts:16,19,205-208`: `PULSE_STATUS_SETTINGS_POLL_MS` has `min: MIN_POLL_MS`
  (1000) and default `DEFAULT_SETTINGS_POLL_MS` (15000); there is no maximum.
- `src/start.ts:147-167` wires `startSettingsPoll` with real timers and calls the synchronous
  `poll.stop()` from the returned stop function; `src/main.ts:45-52` calls that on shutdown.
- `src/settings-poll.test.ts:98-99` records timer delays without running them ("The background
  loop is not run: tests drive pollNow."); line 226 asserts `timers.includes(15_000)`.
  `src/server.runtime-settings.test.ts:249` and `src/server.settings-churn.test.ts:92` pass
  `setTimeout: () => 0`. No test runs the background loop or measures report starts.
- `docs/configuration.md:32` says the server reads the settings "every
  `PULSE_STATUS_SETTINGS_POLL_MS`" and reports "After every attempt, and at least every 60 s".
- `README.md:34` says the server "polls pulse-api's `GET /service/status/settings` every
  `PULSE_STATUS_SETTINGS_POLL_MS` (default 15000)". Under D1 this stops being exact above
  54000 ms, so the README changes too (status `AGENTS.md:87-88`: update `README.md` in the same
  change when behavior or a setting changes).

## Decisions

**D1. Next poll deadline.** When a poll ends (and the poller is not stopped and no `pollNow()`
poll waits), the poller arms one timer for the next poll with `delay = max(0, due - now())`,
where

- `pollStart` = `now()` at the start of the poll that just ended;
- `anchor` = `now()` read right before the report request of that poll; if that poll sent no
  report (it threw before it), `anchor = pollStart`;
- without a token: `due = pollStart + min(pollMs, REPORT_HEARTBEAT_MS)` (today's cap, now from
  the start instead of the end);
- with a token:
  `due = min(pollStart + min(pollMs, REPORT_HEARTBEAT_MS), anchor + REPORT_HEARTBEAT_MS - REPORT_LEAD_MS)`.

`REPORT_LEAD_MS = SETTINGS_TIMEOUT_MS + 1000` (6000): the read before the next report takes at
most `SETTINGS_TIMEOUT_MS`; the extra 1000 ms covers the synchronous local reread, resolve and
apply, and a late timer. Hence the next report starts at most
`anchor + 60000 - 6000 + 5000 = anchor + 59000` in timer time.

Consequences that the docs state:
- With `pollMs` up to 54000 the read cadence is the configured one, from poll start to poll
  start, no longer stretched by latency.
- **Two bounds, not one.** D1 bounds the time from a report start to the next read start; it
  does not make reads a fixed 54 s apart. The docs and tests keep the two apart:
  - *Report-to-next-read bound* (with a token): the next read starts at most 54000 ms after the
    previous report start (`due - anchor <= 54000`), so the report after it starts at most
    59000 ms after the previous one (R1).
  - *Read-to-read spacing* (with a token, `pollMs` above 54000, polls shorter than the
    interval): `nextStart - pollStart = min(pollMs, 60000, (anchor - pollStart) + 54000)`, where
    `anchor - pollStart` is the previous read time plus local work. In timer time that is
    54000 ms with instant reads, 55000 ms with 1000 ms reads, 58000 ms with 4000 ms reads and
    59000 ms when the read times out at 5000 ms; never more than `min(pollMs, 60000)` (local
    work takes no time on the fake clock). For `54000 < pollMs < 59000` the spacing is between
    54000 and `pollMs`.
  - So with `pollMs` above 54000 reads are **54 to 59 s apart**, depending on how long the
    previous read took; not "about every 54 s" and not "at most 54 s apart". Test 9 checks both
    bounds with literal gaps.
- Since `anchor >= pollStart`, two poll starts are at least `min(pollMs, 54000)` apart unless a
  poll itself lasts longer than that. A poll that lasts longer than its interval is followed by
  the next poll at once (`delay = 0`), one at a time: wait, never overlap, never catch up more
  than one poll.
- With a token the cap `min(pollMs, REPORT_HEARTBEAT_MS)` is masked by the report term:
  `anchor - pollStart` is at most about 5000 ms, so `anchor + 54000 < pollStart + 60000` in
  practice. The cap stays (it bounds the schedule if local work ever takes longer than
  1000 ms) but is only observable without a token. Test 8 protects it there (C6, C9).
- **Request rate under a slow api.** Today the gap between poll starts is
  `min(pollMs, 60000) + d`, where `d` is the poll's duration (read + report, each up to
  5000 ms). Under D1 it is `max(due - pollStart, d)` with
  `due - pollStart = min(min(pollMs, 60000), (anchor - pollStart) + 54000)`, which lies between
  `min(pollMs, 54000)` and `min(pollMs, 60000)`. So a slow api no longer stretches the rate by
  its own latency: for `pollMs <= 54000` reads and reports run at the configured rate (or
  back-to-back when a poll lasts longer than `pollMs`); for `pollMs` above 54000 they run every
  54 to 59 s, which can be faster than configured (see "Rate above the configured one").
  Examples (both requests with the same latency `L`):

  | `pollMs` | `L` | old poll-start gap | new poll-start gap | new/old rate |
  | --- | --- | --- | --- | --- |
  | 15000 | 0 | 15000 | 15000 | 1.000 |
  | 15000 | 1000 | 17000 | 15000 | 1.133 (+13.3 %) |
  | 15000 | 4000 | 23000 | 15000 | 1.533 (+53.3 %) |
  | 10000 | 5000 (both time out) | 20000 | 10000 | 2.000 (+100 %, the largest ratio) |
  | 60000 | 0 | 60000 | 54000 | 1.111 (+11.1 %) |
  | 60000 | 4000 | 68000 | 58000 | 1.172 (+17.2 %) |

  The ratio never exceeds 2.0. For `pollMs <= 54000` it is `(pollMs + d) / max(pollMs, d)`,
  at most 2, reached when `d = pollMs`. For `pollMs > 54000` it is at most
  `(60000 + d) / 54000`, and `d` is at most about 11000 (two 5000 ms timeouts plus local work),
  so at most about 1.31. There is never more than one request in flight and never more than
  one poll per `min(pollMs, 54000)` from poll start to poll start (R4). With fast answers the
  rate is unchanged for `pollMs <= 54000`.
- **Rate above the configured one.** For `pollMs <= 54000` two timer poll starts are never
  closer than `pollMs`, so the poller never reads faster than configured. For `pollMs` above
  54000 it *can*: two read starts are `min(pollMs, 60000, 54000 + r)` apart (R8, `r` = the
  previous read time plus local work), which is faster than configured exactly when
  `54000 + r < pollMs` (or `pollMs > 60000`). It keeps the configured rate when the previous
  read was slow enough: `pollMs = 55000` with 4000 ms reads gives exactly
  `min(55000, 58000) = 55000` ms between reads (C10, test 9). It is faster after a fast read:
  `pollMs = 55000` with instant reads gives 54000 ms. The largest increase over the configured
  rate is reached with instant reads: up to `60000 / 54000 = 1.111` times at `pollMs = 60000`
  and up to `120000 / 54000 = 2.222` times at `pollMs = 120000` (more for larger values). This
  is not new in kind: today the 60 s cap already makes `pollMs` above 60000 read about every
  60 s. Against today's poller the increase above 54000 is at most about 1.31 times (table
  above). Above 60000 the configured value has no effect with a token (R1 needs a report at
  least every 60 s, and every report follows a read), nor without one (local reads every
  60000 ms, R5).
- Alternative considered and rejected: arming `min(pollMs, 60000)` after the poll *end*, bounded
  only by the report deadline. It keeps today's rate under a slow api, but the issue asks to
  schedule from the start of the previous tick. `README.md:34` and `docs/configuration.md:32`
  promise a read "every `PULSE_STATUS_SETTINGS_POLL_MS`"; the start-to-start schedule delivers
  that for `pollMs <= 54000`, and the docs change states the 54 to 59 s spacing above it.

**D2. One lane.** All polls (the first poll, timer polls and `pollNow()` polls) run in one
lane: at most one poll is active at any time.
- A poll start clears the pending poll timer, if any.
- `pollNow()` while no poll is active starts a poll and resolves when that poll and its report
  are done.
- `pollNow()` while a poll is active waits for it and then runs one fresh poll (a fresh read, so
  callers that changed the api see the change). All `pollNow()` calls made while that fresh poll
  is still waiting share it. So at most one poll is active and at most one waits.
- A timer that fires while a poll is active does nothing; the active poll arms the next timer
  when it ends (D1).
- After a `pollNow()` poll the timer is armed from that poll's start and report start (D1).
- `pollNow()` keeps its signature `() => Promise<void>` and still never rejects for an error
  inside the poll (it is logged as today: `status settings poll failed`).

**D3. Shutdown.** `stop()` stays `() => void`, so `src/start.ts` and `src/main.ts` do not
change.
- Each poll has one `AbortController`; its signal goes to the settings read (`fetchJson`) and
  to the report (`requestJson`). `stop()` sets the stopped flag, clears the poll timer and
  aborts that controller.
- After the read returns, and before the report, the poll checks the stopped flag; when stopped
  it ends without rereading files, resolving, applying, reporting, logging a report failure or
  arming a timer. A report that ends after `stop()` logs nothing and arms nothing.
- A stopped poller starts no poll: `pollNow()` after `stop()` resolves without a request, and a
  `pollNow()` that waits for the active poll resolves without running its fresh poll.
- A second `stop()` is harmless.

**D4. Constants.** `SETTINGS_TIMEOUT_MS` (5000) and `REPORT_HEARTBEAT_MS` (60000) keep their
names, values and exports. `REPORT_LEAD_MS` is a new **module-internal** constant of
`src/settings-poll.ts` (not exported). The new test imports no name that the old
`src/settings-poll.ts` lacks, so the red run on the old code fails on assertions, not on a
missing export. The comment of `REPORT_HEARTBEAT_MS` is corrected: it is the maximum gap
between report starts.

## Scope

- pulse-status `src/settings-poll.ts`: scheduling (D1), lane (D2), shutdown (D3), constants (D4).
- New fake-clock test suite `src/settings-poll.heartbeat.test.ts`.
- `docs/configuration.md` (line 32): the start-to-start cadence, the two bounds of D1 (the next
  read starts at most 54 s after the previous report start; above 54000 ms reads are 54 to
  59 s apart, depending on the previous read time, and never more than the configured value,
  so they can be faster than configured) and the 60 s report bound.
- `README.md` (line 34, "Live page settings"): report starts stay at most 60 s apart whatever
  the HTTP time is (within the 5000 ms request timeout); the read runs every
  `PULSE_STATUS_SETTINGS_POLL_MS` from start to start; above 54000 ms reads are 54 to 59 s
  apart (never more than the configured value, so they can be faster than it).

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
- No change to existing tests.

## Required behavior

R1. With a token, for every `pollMs` in the accepted range and any read and report latency of 0
to 5000 ms (including a read or report that times out at `SETTINGS_TIMEOUT_MS`), two adjacent
report starts in normal timed operation are at most 60000 ms apart.

R2. The first poll still runs at once at start and sends a report. Every poll that reaches the
apply step sends one report after it ("after every apply attempt"), also when the read failed,
timed out or answered `304`/`404`.

R3. At no instant are two settings or report requests in flight, and at no instant are two
polls active, whatever mix of timer polls and `pollNow()` calls.

R4. Between two timer-started polls with no `pollNow()` in between, the second starts no earlier
than `min(pollMs, 54000)` after the first, unless the first lasted longer than that (then it
starts when the first ends). No poll starts in a tight loop when a poll throws before its
report.

R5. Without a token: no request to the service routes (as today), local files reread every
`min(pollMs, 60000)` from poll start to poll start; with `pollMs = 120000` that is every
60000 ms, not every 120000 ms. Readiness stays true.

R6. `stop()` while idle: the pending timer is cleared; no later request. `stop()` during the
settings read: the read's signal is aborted; no local reread, no apply, no report, no timer
afterwards. `stop()` during the report: the report's signal is aborted; no timer afterwards and
no `status settings report failed` log line. `pollNow()` after `stop()` makes no request; a
`pollNow()` waiting at `stop()` resolves without a request. After every request settled, no
timer that the poller or the contract armed is left pending.

R7. Everything the existing suites check stays true: `src/settings-poll.test.ts`,
`src/server.runtime-settings.test.ts`, `src/server.settings-churn.test.ts` and the other suites
pass unchanged.

R8. With a token, in timed operation without `pollNow()` and with polls shorter than their
interval: each read starts at most 54000 ms after the previous report start, and for `pollMs`
above 54000 two adjacent read starts are `min(pollMs, 60000, 54000 + r)` apart, where `r` is the
previous read's duration (local work takes no fake-clock time). This is the spacing the docs
describe (54 to 59 s), not a fixed 54 s.

## Risks

- **More settings reads for large intervals; can be faster than configured.** With `pollMs`
  above 54000, reads run 54 to 59 s apart (R8) instead of about 60 s plus the poll duration
  today. With fast answers at `pollMs = 60000` that is about 11 % more
  `GET /service/status/settings` requests (54000 instead of 60000 ms), nearly all `304`. Against
  the configured value this can be *faster* than the operator asked for (whenever
  `54000 + r < pollMs`, `r` = previous read time): up to 1.111 times at `pollMs = 60000` and up
  to 2.222 times at `pollMs = 120000`; with slow reads it can equal the configured rate
  (`pollMs = 55000`, 4000 ms reads: 55000 ms) (D1, "Rate above the configured one"). Above 60000
  the configured value already has no effect today (60 s cap). With fast answers the default
  15000 is unaffected. Documented in `docs/configuration.md` and `README.md`.
- **More reads and reports under a slow api.** Today a slow api slows the poller down: the
  latency adds to every gap. Under D1 the poller keeps the configured start-to-start rate for
  `pollMs <= 54000` and reads every 54 to 59 s above it (table in D1). At the default 15000 ms
  with 4000 ms answers that is 53.3 % more reads and reports (gap 23000 -> 15000 ms); the worst
  ratio is 2.0 (`pollMs = 10000`, both requests timing out). Costs: in pulse-status, per extra
  poll one small JSON parse and contract validation (or a `304`), one reread of the local
  files, one resolve and one report body, a few ms of CPU at most; in pulse-api, one more
  settings read and one report write per extra poll. An api that is slow because it is
  overloaded no longer gets a latency back-off from this service. This stays bounded: one
  request at a time, and at most one poll per `min(pollMs, 54000)` from start to start (R4).
  That is never faster than the configured rate for `pollMs <= 54000`, but it can be faster
  than configured above 54000 (up to one poll per 54000 ms, first bullet). Measured under
  delayed answers in the completion evidence (delayed-answer run).
- **Back-to-back polls.** With a small `pollMs` and slow answers, a poll may follow the previous
  one at once (`delay = 0`). Each poll is still bounded by two 5000 ms timeouts, so the rate is
  at most one poll per poll duration, never parallel.
- **pollNow semantics in tests.** `pollNow()` now waits for an active background poll before it
  runs its own. Existing tests that call `pollNow()` right after `setup()` keep their read counts
  (the waiting poll is still a fresh read). `src/settings-poll.test.ts:226` still sees a
  15000 ms delay: with its fixed `now: () => 1_000`, `due - now = min(16000, 55000) - 1000`. The
  implementer runs all three suites to confirm.
- **Abort on shutdown.** A report in flight at shutdown is now cancelled instead of completed.
  The api already handles a missing report: the next start reports again.
- **Cognitive complexity.** The lane plus deadline logic must stay under the SonarJS limit of 15
  per function (pinned `eslint.config.js:16`). Split helpers (for example `nextDue`, `runPoll`)
  inside `src/settings-poll.ts`.

## Performance impact

The api repository's `bench/budgets.json` lists for `status`: `startup_cpu_ms` (377),
`load_cpu_s` (0.5), `idle_rss_mib` (82), `peak_rss_mib` (85), `test_cpu_s` (3.4) (gating) and
`startup_wall_ms` (965), `image_mb` (124) (reported). Read at api `main`
`515031b`.

- `startup_cpu_ms`, `startup_wall_ms`, `idle_rss_mib`, `peak_rss_mib`, `image_mb`: none
  expected. The poller keeps one timer and one controller; the first poll stays immediate.
- `load_cpu_s`: none expected in the bench. `bench/compose.bench.yaml:49-60` sets no
  `PULSE_STATUS_SETTINGS_POLL_MS`, so status polls every 15000 ms, against a local api that
  answers in a few ms; with `L` near 0 the read cadence in the 60 s measured window
  (`bench/README.md:10,40`) is unchanged (4 reads, 4 reports, give or take one from timing).
- **Outside the bench: CPU under a slow api (not a budget key).** The bench does not delay the
  api's answers, so it cannot show the rate change of D1. With a slow api, pulse-status does
  more polls per minute (up to 1.533x at the default 15000 ms with 4000 ms answers, up to 2.0x
  in the worst case; table in D1). Its CPU over a time window grows with the poll count; the
  CPU per poll does not change. Expected: a few ms of CPU per poll, so at the default with
  4000 ms answers about 6 extra polls per 300 s and well under 100 ms of extra CPU per 300 s.
  pulse-api gets the same factor more settings reads and report writes from this service.
  Measured by the delayed-answer run in the completion evidence of `Repository: status`.
- `test_cpu_s`: up by a small amount, expected under 0.1 s. The new suite runs on a fake clock
  with no real waits.
- How to measure:
  - `test_cpu_s`: in pulse-status run `/usr/bin/time -f '%U %S' bun test` three times on the
    recorded base and three times on the branch; the difference of the medians of user+system
    seconds must stay under 0.2 s.
  - CPU under a slow api: the delayed-answer run (completion evidence of `Repository: status`).
  - A full A/B is optional (about 40 minutes, Docker needed): in the api repository,
    `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main --b-ref status=<branch SHA> --service-tokens --expect-report status`
    (api `bench/README.md:76-77,88,100`); `load_cpu_s` and the RSS metrics of `status` must
    stay within their budgets.

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
  report starts at 1000. Old code arms 60000 ms at 2000; poll 2 reads 62000-63000, report starts
  at 63000. Gap 62000 > 60000: must fail. With latency 4000: gap 68000: must fail. With latency
  0 the old code gives 60000 and passes (control).
- **C2 (deadline from poll start only).** `pollMs = 60000`. Poll 1 read latency 0, report starts
  at 0. A fix that arms only `pollStart + min(pollMs, 60000)` starts poll 2 at 60000; its read
  takes 4000 (or times out at 5000), so the report starts at 64000 (or 65000): gap > 60000. The
  varying-latency test (test 2) must catch it. Under D1 the next poll is due at
  `min(60000, 0 + 54000) = 54000`, report at 58000 (59000 on timeout).
- **C3 (default interval control).** `pollMs = 15000`, latency 4000: the old code gives report
  gaps of 23000 and passes; the fix gives 15000. The default cases must pass on both versions.
- **C4 (overlap through pollNow).** `pollMs = 1000`, settings read held open. A `pollNow()`
  call during the held read must not start a second `GET`; the old code starts it at once (two
  requests in flight). Three `pollNow()` calls during the held read cause exactly one extra poll
  after the held one, not three.
- **C5 (tight loop).** With a token, `resolve` throws on every poll after the first. A fix that
  computes `due` from the last *successful* report start gets `delay = 0` forever. Under D1
  (`anchor = pollStart` when no report started) the polls in 120000 ms of fake time at
  `pollMs = 60000` start at 0, 54000 and 108000: 3 settings reads. The test asserts `<= 4`
  reads (a tight loop gives hundreds). The old code passes too (reads at 0, 60000, 120000); it
  guards against a wrong fix, not the old defect.
- **C6 (interval above the heartbeat, with a token).** `pollMs = 120000`, latency 1000. Poll 1:
  read 0-1000, `anchor = 1000`, report 1000-2000. Under D1 the next poll is due at
  `min(0 + min(120000, 60000), 1000 + 54000) = 55000`; its report starts at 56000, gap 55000.
  The old code arms 60000 ms at 2000; poll 2 reads 62000-63000 and its report starts at 63000:
  gap 62000, which must fail. A fix that drops the cap `min(pollMs, REPORT_HEARTBEAT_MS)` gives
  `min(0 + 120000, 55000) = 55000`, the *same* value: with a token the report term masks the
  cap, so this case cannot detect its removal. It only guards R1 for intervals above 60000.
- **C9 (the cap, without a token).** `token: undefined`, `pollMs = 120000`, no requests; local
  reads run synchronously at poll start. Required (R5): `readLocal` call times over 300000 ms of
  fake time are exactly `[0, 60000, 120000, 180000, 240000, 300000]`. A fix that drops
  `min(pollMs, REPORT_HEARTBEAT_MS)` gives `[0, 120000, 240000]` and must fail. The old code
  gives the required list too (the local poll takes no fake time); this case guards against a
  wrong fix, not the old defect.
- **C10 (the two bounds of D1).** With a token, `pollMs = 60000`, report latency 0, the same
  read latency `r` on every poll. Under D1 poll `n` starts at `n * (54000 + r)`, its report at
  `n * (54000 + r) + r`. Required: read-start gaps exactly `54000` (`r = 0`), `55000`
  (`r = 1000`), `58000` (`r = 4000`), `59000` (read held until its 5000 ms timeout); every read
  start minus the previous report start exactly `54000`. A wrong reading of the docs ("reads at
  most 54 s apart", a fixed 54000 ms start-to-start deadline) gives read gaps of 54000 for every
  `r`, and with `r = 4000` it sends the next read 50000 ms after the previous report; the
  literal `58000` catches it. The old code gives `60000 + r` and fails too.
  Second part, the configured rate kept: `pollMs = 55000`, `r = 4000`, report latency 0. Under
  D1 `due - pollStart = min(55000, 60000, 4000 + 54000) = 55000`. Required: read-start gaps
  exactly `55000`, every read start minus the previous report start exactly `51000`. An
  implementation that drops `min(pollMs, ...)` with a token gives `58000` and fails; the old
  code gives `59000` and fails.
- **C7 (shutdown during report).** Report held open; `stop()`; then advance the fake clock by
  300000 ms. A wrong fix that does not pass the signal to the report leaves the report fetch's
  signal not aborted (assert `signal.aborted === true`); a wrong fix that re-arms after the
  report leaves a poll timer pending and makes a later fetch (assert neither).
- **C8 (shutdown during read).** Read held open; `stop()`. The read's signal is aborted; no
  `readLocal`, no `apply`, no report fetch follows, even after the clock advances 300000 ms.
  The old code rereads, applies and reports after the aborted read.
- **C11 (scope check that only looks at the working tree).** The implementer commits a change
  to `src/start.ts`. `git diff --exit-code -- src/start.ts` (working tree vs index) and
  `git diff --cached --exit-code -- src/start.ts` both pass, so they are not checks.
  `git diff --exit-code <base> -- src/start.ts` fails, and `git diff --name-only <base>` lists
  `src/start.ts`; the completion evidence uses only the `<base>` forms.

Statistic used by the tests: **report-start gap** = difference of the fake-clock times of two
consecutive calls of the fake `fetch` with method `PUT` and path `/service/status/report`, in
the order the calls happened. Sample set: all such gaps from the first report until the end of
the run (the run lasts until at least 4 report starts, so at least 3 gaps). The check is on the
maximum of the gaps, compared with the literal 60000. **Read-start gap** is defined the same way
for `GET /service/status/settings`. No averages, no percentiles, no rounding (integer
milliseconds of the fake clock).

## Contract fields

No new contract names. The only new name is the module-internal constant `REPORT_LEAD_MS` in
pulse-status `src/settings-poll.ts`. Search, run on 2026-11-08 from the meta checkout:

```sh
grep -rn 'REPORT_LEAD_MS' .repos/contract/src .repos/config/src .repos/status/src
# no output, exit 1
```

No route, wire field, header, environment variable or setting is added or renamed.

## Repository: status

Files:
- `src/settings-poll.ts` (change)
- `src/settings-poll.heartbeat.test.ts` (new)
- `README.md` (change)
- `docs/configuration.md` (change)

Behavior change: yes
The background poll schedule, `pollNow()` serialization and the cancellation of the report on
`stop()` change.

### Tooling facts (cited)

- Bun 1.4.0: `package.json:9` (`engines.bun`) and `package.json:38` (`packageManager`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:19`).
  `test` is `bun test` (`package.json:14`); `lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`); `typecheck` runs
  `tsc --noEmit` from `typescript7` on the root and `e2e` projects (`package.json:13`).
- Biome `2.6.3` (`package.json:23`). `biome.json` only `extends`
  `@lorenzh/pulse-config/biome.json`; the config pin is
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). In that pinned file
  `files.includes` is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures`
  (lines 10-17), `noNonNullAssertion` is an error (line 46) except in `**/*.test.ts` and
  `**/test/**` (lines 53-63), `noExplicitAny` is an error (line 49). Read with
  `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=04108fa…"`; identical to the
  config clone.
- ESLint: `eslint.config.js` ignores `.repos/**` and extends
  `@lorenzh/pulse-config/eslint.config.js`; at the pinned SHA line 16 sets
  `sonarjs/cognitive-complexity` to `["error", 15]` (identical to the clone).
- Coverage: `bunfig.toml:2-3` enables coverage with a line threshold of 0.8 (`functions = 0`);
  `bunfig.toml:4` ignores `**/*.test.ts` for coverage.
- CI: `.github/workflows/ci.yml:17-18` job `check` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`,
  which sets up Bun 1.4.0 (pinned `check.yml:22-24`) and runs `bun install --frozen-lockfile`,
  `bun run lint`, `bun run typecheck`, `bun run test` (lines 25-30, 37-38); identical to the
  clone.

### Behavior

Implement D1-D4 in `src/settings-poll.ts`:
- Keep `SettingsPollDeps` and `SettingsPoll` unchanged (fields, types, `stop: () => void`), and
  keep the exports `SETTINGS_TIMEOUT_MS`, `REPORT_HEARTBEAT_MS` and `startSettingsPoll`.
- One `AbortController` per poll, its signal passed to `fetchJson` (read) and `requestJson`
  (report). Keep `redirect: "manual"`, `timeoutMs: SETTINGS_TIMEOUT_MS`, `schedule`, headers,
  `maxBytes`, validation and `buildReport` arguments as they are.
- Record `pollStart` at the start of every poll and `anchor` right before the report request.
- Stopped checks after the read and before the report, and no report-failure log after `stop()`
  (D3).
- One lane for the first poll, timer polls and `pollNow()` (D2); the poll timer is cleared when a
  poll starts and armed with `max(0, due - now())` when the lane is idle after a poll (D1).
- Update the comment on `REPORT_HEARTBEAT_MS` (maximum gap between report starts) and add a
  one-line comment on `REPORT_LEAD_MS` (why the read reserve exists).

Documentation keeps the two bounds of D1 apart (R8). It never says the reads are "about every
54 s", "every 54 s" or "at most 54 s apart", and never says reads above 54000 are always faster
than configured.

`docs/configuration.md` line 32 (the paragraph on the settings read) states:
- the interval runs from the start of one read to the start of the next, so a slow api no
  longer stretches it;
- with a token, the next read starts at most 54 s after the previous report started, so the
  report after it starts at most 60 s after the previous report, even when the read takes its
  full 5000 ms timeout;
- for `PULSE_STATUS_SETTINGS_POLL_MS` above 54000: reads are 54 to 59 s apart (54 s after a
  fast read, up to 59 s after a read that timed out, never more than the configured value), so
  they can be faster than the configured value: faster when 54 s plus the previous read time is
  less than it, the configured value otherwise; values from 60000 up behave the same.

`README.md:34` ("Live page settings"): the sentence "polls pulse-api's
`GET /service/status/settings` every `PULSE_STATUS_SETTINGS_POLL_MS` (default 15000)" gets the
qualifier that the interval runs from start to start and that above 54000 the reads are 54 to
59 s apart (never more than the configured value, so they can be faster than it). The clause on
`PUT /service/status/report` states that it is sent after every read and that report starts
stay at most 60 s apart whatever the HTTP time is (within the 5000 ms request timeout). Keep the
rest of the paragraph unchanged. No other README section changes.

### Checks (new suite `src/settings-poll.heartbeat.test.ts`)

The suite imports only names that exist in the base `src/settings-poll.ts`
(`startSettingsPoll`, types) and in other unchanged modules (`DEFAULT_SETTINGS_POLL_MS` from
`src/settings.ts`, `resolveSettings`/`EMPTY_FILE_LAYER` and the theme loader as
`src/settings-poll.test.ts:6-14` does). No new export in `src/`.

Harness, in the test file only:
- A fake clock: `clock` starts at 0; `now()` returns `clock`; `setTimeout(fn, ms)` stores
  `{ id, due: clock + ms, fn }` and returns `id`; `clearTimeout(id)` removes it. A
  `run(untilMs)` driver repeatedly drains promise jobs (enough `setImmediate` rounds that no new
  job appears, as `settle()` in `src/settings-poll.test.ts:107-109`), then takes the earliest
  timer, sets `clock = due`, removes and calls it, until the earliest timer is later than
  `untilMs`. No real timers, no real network, no clock change inside `fetch`.
- A fake `fetch` (with a `preconnect` property, as `src/settings-poll.ts:113` reads it) that
  records `{ method, path, at: clock, signal }` at call time, keeps an in-flight counter (the
  test asserts it never exceeds 1), and answers after the configured latency through the fake
  `setTimeout`; it rejects with an `AbortError` when its signal aborts. Settings answer: `200`,
  body `{"revision": "sha256-<64 × '1'>", "settings": {}}`, `etag` `"e1"` and the header
  `WIRE_VERSION_HEADER: "1"` (as `src/settings-poll.test.ts:61,73-78`); later reads may answer
  `304`. Report answer: `204` with the wire header (as line 52). A "hold" mode keeps a request
  open until the test releases it or its signal aborts.
- The real `startSettingsPoll` with `resolve` from `resolveSettings` and an empty file layer, as
  in `src/settings-poll.test.ts:88-102`, and a counting `readLocal` and `apply`.

Tests (expected values are literals in the test):
1. **Six-case regression.** For `pollMs` in `[60000, 15000]` and latency in `[0, 1000, 4000]`
   (same latency for read and report): run until at least 4 report starts are recorded (assert
   `reports.length >= 4`); assert the largest report-start gap is `<= 60000`; assert in-flight
   requests never exceeded 1. Rate bound (R4): the smallest read-start gap is `>= 15000` in the
   15000 cases and `>= 54000` in the 60000 cases (literals). One case asserts
   `DEFAULT_SETTINGS_POLL_MS === 15000` and the 15000 cases use it. Old code: `60000/1000`
   (62000) and `60000/4000` (68000) fail; the other four pass (controls).
2. **Varying read latency (C2).** `pollMs = 60000`, read latencies `0, 4000, 0, 4000, …` and
   report latency 0; and a second case where every second read never answers (times out at
   5000 through the contract's timer). Largest report-start gap `<= 60000`, at least 4 reports,
   in-flight never above 1.
3. **Slow report.** `pollMs = 60000`, read latency 0; one case with report latency 4000 and one
   with every report held until its 5000 ms timeout: largest gap `<= 60000`, never two requests
   in flight, and the next read still follows (recovery).
4. **Interval above the heartbeat, with a token (C6).** `pollMs = 120000`, latency 1000:
   largest gap `<= 60000`, at least 4 reports. This guards R1 only; with a token it cannot see
   the `min(pollMs, 60000)` cap (C6), test 8 does.
5. **Small interval, held request (C4).** `pollMs = 1000`, read held open at its second poll;
   call `pollNow()` three times; assert no second `GET` starts while the held one is open;
   release it; assert exactly one extra poll runs (count of `GET` = held poll + 1), all three
   `pollNow()` promises resolve after that poll's report fetch completed, and the background
   loop continues afterwards (another `GET` after the clock advances 1000 ms).
6. **No tight loop (C5).** `resolve` throws after its first two calls (the call at start and the
   first poll); `pollMs = 60000`; run 120000 ms; assert at most 4 `GET` requests.
7. **Shutdown.** (a) idle with a pending timer: `stop()`, run 300000 ms, zero new fetches, timer
   queue empty. (b) during the read (C8): signal aborted, no report fetch, `readLocal` and
   `apply` counts unchanged, timer queue empty after 300000 ms. (c) during the report (C7):
   report signal aborted, no later fetch, timer queue empty after 300000 ms, no log line
   containing `status settings report failed`. (d) with a `pollNow()` waiting behind a held
   read: `stop()`; the waiting promise resolves and no further fetch happens. (e) `pollNow()`
   after `stop()` resolves with zero fetches; a second `stop()` does not throw.
8. **No token, and the cap (C9).** Two cases, `token: undefined`, `pollMs = 60000` and
   `pollMs = 120000`, each run until 300000 ms of fake time: zero fetches, `isReady()` true, and
   the fake-clock times of the `readLocal` calls equal exactly
   `[0, 60000, 120000, 180000, 240000, 300000]` (literal list) in both cases. The `120000` case
   fails on a fix that drops `min(pollMs, REPORT_HEARTBEAT_MS)` (it gives `[0, 120000, 240000]`).
9. **The two bounds of D1 (C10, R8).** With a token, report latency 0, read latency the same on
   every poll. `pollMs = 60000`, four cases: read latency `0`, `1000`, `4000`, and every read
   held until the contract's 5000 ms timeout. Run until at least 5 `GET` starts are recorded.
   Assert every read-start gap equals exactly the literal of its case: `54000`, `55000`,
   `58000`, `59000`, and every `GET` start after the first minus the previous report start
   equals exactly `54000`. Fifth case, `pollMs = 120000` with read latency `4000`: read-start
   gaps exactly `58000`, read minus previous report exactly `54000`. Sixth case,
   `pollMs = 55000` with read latency `4000`: read-start gaps exactly `55000` and read minus
   previous report exactly `51000`. Old code: every case fails (read-start gaps `pollMs + r`:
   60000, 61000, 64000, 65000, then 64000 in the `120000` case and 59000 in the `55000` case).

### Completion evidence

- **Base.** Before changing any file, record the implementation base:
  `BASE=$(git rev-parse HEAD)` on the fresh branch (expected the `main` the task starts from,
  `bcd83dad0975954b687ce89fc8ad369ba3a94e8a` or later). Put the SHA in the PR. Every check below
  compares against `$BASE`, never against the working tree or index alone (C11).
- **Red.** Run the new suite against the base's production poller in a separate worktree
  outside the repository, so the checkout under change stays clean:
  `git worktree add /tmp/status-base "$BASE"`, copy only
  `src/settings-poll.heartbeat.test.ts` into `/tmp/status-base/src/`, then in
  `/tmp/status-base` run `bun install --frozen-lockfile` and
  `bun test src/settings-poll.heartbeat.test.ts`. Expected failures: the two positive-latency
  cases of test 1 at `pollMs = 60000` (gaps 62000 and 68000), tests 2, 3, 4, 5, 7b, 7c, 7d and
  7e (old `pollOnce` reports after an aborted read, the old report has no signal, old `pollNow`
  ignores the lane and `stop()`), and all six cases of test 9 (read-start gaps 60000, 61000,
  64000, 65000, 64000 and 59000 instead of the literals). Expected passes: the four other cases
  of test 1, tests 6, 7a and both cases of 8 (they guard against a wrong fix). A compile, import
  or install error is not red evidence. Record the command and the failing assertion texts in
  the PR, then `git worktree remove /tmp/status-base`.
- **Green.** `bun test src/settings-poll.heartbeat.test.ts` passes on the branch.
- `bun run check` passes on the branch (lint, typecheck, tests with the 0.8 line coverage
  threshold).
- `bun test src/settings-poll.test.ts src/server.runtime-settings.test.ts src/server.settings-churn.test.ts`
  passes.
- **Exclusive scope, against the base (committed, staged and unstaged changes alike).** After the
  last commit:
  - `git diff --name-only "$BASE" | sort` prints exactly these four lines (literal list from
    this spec): `README.md`, `docs/configuration.md`, `src/settings-poll.heartbeat.test.ts`,
    `src/settings-poll.ts`.
  - `git diff --exit-code "$BASE" -- src/settings-poll.test.ts src/server.runtime-settings.test.ts src/server.settings-churn.test.ts src/settings.ts src/runtime-settings.ts src/start.ts src/main.ts package.json bun.lock bunfig.toml biome.json eslint.config.js tsconfig.json AGENTS.md .github`
    exits 0.
  - `git ls-files --others --exclude-standard -- . ':!.repos'` prints nothing (no stray
    untracked file; the Factory's `.repos/` clones are excluded).
  - `git diff --check "$BASE"` prints nothing.
- **Docs keep the two bounds apart (R8).**
  `grep -nE 'every 54 s|about 54 s|at most (about )?54 s apart' README.md docs/configuration.md`
  prints nothing (exit 1); `grep -c '54 to 59 s' README.md docs/configuration.md` prints at
  least 1 for each file; `grep -c 'can be faster' docs/configuration.md` prints at least 1;
  `grep -c '60 s' README.md` prints at least 1 (literal phrases from this spec). A reviewer
  reads both changed sentences against D1 "Two bounds": the 54 s figure appears only as the time
  from a report start to the next read start, and no sentence says reads above 54000 are always
  faster than configured.
- **Delayed-answer run (start check and CPU under a slow api).** A fake api, a small Bun script
  kept outside the repository (for example under `/tmp`, not committed), listens on
  `127.0.0.1`. It answers `GET /service/status/settings` with `200`, the valid body and wire
  header of the test harness and `etag: "e1"` (then `304` to `If-None-Match: "e1"`), and
  `PUT /service/status/report` with `204` and the wire header, each after a fixed delay of
  4000 ms. It logs the arrival time (ms) of every request. Start status on the base (the
  `/tmp/status-base` worktree, before it is removed) and on the branch with `bun start`,
  `PULSE_API_URL=http://127.0.0.1:<port>`, `PULSE_STATUS_API_TOKEN` set to a dummy value and a
  free `PORT`. Take the CPU time of the status process as `utime + stime` (fields 14 and 15 of
  `/proc/<pid>/stat`, clock ticks; 10 ms resolution) at the first settings `GET` and 300000 ms
  later. Expected values are literals derived from the timing in D1, not from the code under
  test; real timers add a few ms per cycle, hence the tolerances.
  - Run A, `PULSE_STATUS_SETTINGS_POLL_MS=15000`, 300000 ms window, three runs per side:
    settings `GET` starts in the window: base 14 ±1 (gap 23000), branch 20 ±1 (gap 15000);
    report `PUT` count equals the `GET` count ±1. CPU: report the median CPU ms of each side
    and the CPU ms per poll. Gate: the branch median exceeds the base median by at most 300 ms;
    expected well under 100 ms.
  - Run B, `PULSE_STATUS_SETTINGS_POLL_MS=60000`, until at least 4 report starts per side: the
    first report arrives at about 4000 ms; report gaps are 68000 ±50 on the base and 58000 ±50
    on the branch, so every branch gap is below the literal 60000. In the same logs: settings
    `GET` arrival gaps are 68000 ±50 on the base and 58000 ±50 on the branch (not 54000: the
    read-to-read spacing includes the 4000 ms read), and each `GET` arrival minus the previous
    `PUT` arrival is 64000 ±50 on the base and 54000 ±50 on the branch. Stop with Ctrl-C and
    see a clean exit (this is the `bun start` check of status `AGENTS.md`).
  Report the commands, the request logs (times), the counts and the CPU numbers in the PR.
- `test_cpu_s` comparison of the Performance impact section (median difference under 0.2 s).

## Acceptance evidence (feature)

- The PR in lorenzh/pulse-status shows the recorded base SHA, the red run (the base fails the
  60000 ms positive-latency cases of the new test with a report-start gap above the literal
  60000, and all six test 9 cases) and the green run.
- `bun run check` passes in pulse-status on the PR head; CI `check` job green.
- The existing settings-poll, runtime-settings and settings-churn suites pass unchanged.
- The PR shows the delayed-answer runs A and B with the literal expectations of the status
  section (A: 14 ±1 vs 20 ±1 reads in 300 s, CPU difference at most 300 ms; B: report gaps
  68000 ±50 on the base, 58000 ±50 on the branch; on the branch read gaps 58000 ±50 and read
  minus previous report 54000 ±50).
- `README.md` and `docs/configuration.md` describe the read spacing above 54000 as "54 to
  59 s", the 54 s figure only as the time from a report start to the next read start, and the
  60 s bound between report starts (grep checks of the status section).
- `git diff --name-only <base>` in pulse-status lists exactly `README.md`,
  `docs/configuration.md`, `src/settings-poll.heartbeat.test.ts` and `src/settings-poll.ts`.
