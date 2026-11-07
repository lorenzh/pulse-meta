# Spec #824: notify, schedule the service report heartbeat from its start time

## Goal

Feature #570 (child #810, pulse-notify PR #47, merged) made notify send
`PUT /service/notify/report` after every channel apply attempt and at least every 60 s
(`.factory/work/570/plan.md:341`, Decision 5; notify `docs/channels.md:212`). The heartbeat part
of that rule drifts: `startChannelLoop` (notify `src/index.ts:840-913`) arms the next heartbeat
timer in the `finally` of the previous heartbeat report (`src/index.ts:887-896`), so each
heartbeat gap is 60000 ms plus the latency of the previous report. With
`PULSE_NOTIFY_CHANNELS_POLL_MS=300000` and a 4000 ms report latency the report starts are 0,
60000, 124000 ms. The default 15000 ms channel poll hides this, because every poll also reports.

This change makes notify schedule each heartbeat from the start of the previous heartbeat (fixed
rate), and makes all report requests of the channel loop run one at a time, as the issue's
constraint requires. It builds on #570 / #810: the report body, the endpoint, the poll loop, the
report after each apply attempt and the shutdown order stay as #810 delivered them; none of that
is rebuilt.

Inputs read for this spec: issue #824 and its only comment (the Factory issue-review run),
`.factory/work/824/issue-review.md`, the #570 spec, and the notify clone at
`5a44c5a3de1764faa04b6cd3762f2c2be4c58430` (equal to `main` of lorenzh/pulse-notify in this run:
`gh api repos/lorenzh/pulse-notify/commits/main --jq .sha`). Shared findings:
`gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/824` answered HTTP 404 in this
run, so there are no findings.

Revision after the first plan-review: the held-report case (Counterexample 6, test case 4) now
holds the report across two missed ticks, so it tells a coalesced follow-up from one request per
missed tick. The performance section now accounts for the higher heartbeat rate when reports are
slow.

## Current behavior (notify `5a44c5a`)

- `REPORT_HEARTBEAT_MS = 60_000` (`src/index.ts:678`).
- `report()` (`src/index.ts:847-873`) builds the body from `sync.state()` and `deps.now()` at its
  start and sends it with `sendService`; it catches and logs every failure, so it never rejects.
- `cycle()` (`src/index.ts:874-877`) runs `sync.poll()` then `report()`. `nextPoll`
  (`src/index.ts:878-886`) arms the next poll after the cycle ends.
- `nextBeat()` (`src/index.ts:887-896`) arms a `REPORT_HEARTBEAT_MS` timer; its callback starts
  `report()`, tracks it in `beats`, and calls `nextBeat()` again only in the report's `finally`.
  This is the drift.
- There is no shared in-flight guard: a poll report and a heartbeat report can run at the same
  time (issue review, "Evidence inspected").
- `start()` (`src/index.ts:898-903`) arms the poll at 0 ms and the first heartbeat at 60000 ms.
  `stop()` (`src/index.ts:904-911`) clears `isRunning`, cancels both timers, and awaits `running`
  and all `beats`. `main()` stops the loop before it closes the ledger and releases the lock.
- Every `/service/*` request has a 5000 ms timeout that also covers reading the body
  (`SERVICE_TIMEOUT_MS`, `src/api.ts:331`; `sendService` `src/api.ts:405-423`;
  `fetchWithTimeout` `src/timeout.ts`). `createChannelSync` does not pass a `schedule` into
  `ServiceOptions` (`src/index.ts:731-734`), so that timeout runs on the real `setTimeout`
  (`defaultSchedule`, `src/timeout.ts:3-6`).
- `MainDeps` (`src/index.ts:123-147`) already injects `now`, `channelSchedule` (poll and report
  heartbeat timer), `heartbeatSchedule` (lock lease), `commandSchedule` (resend poll),
  `serviceFetch` and `createNotifier`.

## Scope

- notify only: the heartbeat timer and report serialization inside `startChannelLoop`
  (`src/index.ts`), a new regression test file, and the one doc sentence that states the rule.

## Non-goals

- No change to the report body (`buildServiceReport`, `src/service-report.ts`), the endpoint
  `PUT /service/notify/report`, the ledger format (5), the channel poll cadence or its env
  variable, the 5000 ms service timeout, auth, or the resend loop.
- No new env variable, no new `MainDeps` seam, no new dependency.
- No abort of an in-flight report on shutdown: stop keeps waiting for it, as today.
- pulse-status has its own report heartbeat (`status/src/settings-poll.ts:19`, `:203`). It is not
  part of this issue and is not changed here.
- No drift correction from `now()`: the next timer is armed with a fixed `REPORT_HEARTBEAT_MS`
  delay at the start of the tick (see D1); timer lateness of the runtime is not compensated.

## Decisions

### D1: Fixed-rate heartbeat, armed at tick start

The heartbeat callback, as its first action while the loop runs, arms the next heartbeat timer
with `REPORT_HEARTBEAT_MS`, and only then starts or queues its report. The report's settlement
never arms a timer. `start()` still arms the first heartbeat at 60000 ms after start, and the poll
at 0 ms, as today. With timely timer dispatch, heartbeat ticks fall at exactly
`start + 60000·k`.

### D2: One report at a time; a collision waits, coalesced into one follow-up

The issue allows "skip or wait". This spec chooses **wait, coalesced**, for all report producers of
the channel loop (heartbeat ticks and poll cycles):

- At most one `PUT /service/notify/report` request of the loop is in flight at any time.
- A report requested while none is in flight starts at once.
- A report requested while one is in flight does not start a second request. It marks one
  follow-up report as pending (if one is not already pending) and waits for it. Every request
  that arrives while the same report is in flight shares that one follow-up.
- The follow-up starts as soon as the in-flight report settles, whether it succeeded, failed or
  timed out. It builds its body at its own start (`sync.state()`, `deps.now()`), so it carries
  the state after any apply that happened while it waited, never an older snapshot.
- A missed tick never causes more than one extra request: there is no catch-up burst, and the
  next tick stays on the D1 schedule.
- A poll cycle still awaits the report that covers it (now possibly the follow-up) before the
  next poll is armed, so the report after every apply attempt is kept.

Why not skip: skip loses the 60 s bound. Example: a poll report starts at 58000 and takes
4000 ms; the heartbeat tick at 60000 finds it in flight and skips; the next report starts at the
tick at 120000, a gap of 62000 ms. With wait, the follow-up starts at 62000.

Bound that follows (the definition the tests check): let the report starts be the fake clock
values at entry of each `PUT /service/notify/report` fetch, in order. If every report request
settles within 60000 ms (in production the 5000 ms `SERVICE_TIMEOUT_MS` ensures this), then two
consecutive starts are at most 60000 ms apart. Reason: let `T` be the first heartbeat tick after
a start `u`, so `T - 60000 <= u`. At `T` either no report is in flight, so one starts at `T`, or
`u` is in flight and the follow-up starts when `u` settles. This bound assumes timely timer
dispatch; an event-loop stall or a frozen clock in production is not covered.

### D3: Shutdown

- `stop()` keeps today's order and contract: clear the running flag, cancel the pending poll timer
  and the **current** heartbeat timer handle (the newest one armed by D1), then await the running
  poll cycle and the in-flight report.
- A follow-up that is pending but not started when `stop()` begins never starts. Its waiters
  (a heartbeat tick, a poll cycle) are released without a request, so `stop()` cannot hang on
  them.
- A heartbeat callback that runs after `stop()` began (for example an already queued timer
  callback) arms nothing and requests nothing.
- A report that settles during or after `stop()` arms nothing (follows from D1).
- `main()`'s order after the loop stop (notifier stop, ledger flush and close, lock release) is
  unchanged.

### D4: Failure

A failed report (HTTP error, network error, timeout) is logged as today (`service report failed`
with the failure kind) and releases the one-at-a-time slot. It never blocks a later tick or a
pending follow-up.

## Required behavior

- R1: Heartbeat ticks are scheduled from the start of the previous tick (D1).
- R2: The loop never has two report requests in flight (D2).
- R3: A heartbeat or poll report that finds a report in flight waits; all such requests share one
  follow-up that starts when the in-flight report settles and builds its body at its start (D2).
- R4: A report still follows every channel apply attempt (unchanged from #810).
- R5: Shutdown cancels the pending heartbeat timer, drops a not-started follow-up, waits for the
  in-flight report and the running cycle, and arms nothing afterwards (D3).
- R6: A failed report never blocks later reporting (D4).
- R7: Without a token there is still no `/service/*` call and no report.
- R8: Report body, endpoint, ledger format, channel poll and the 5000 ms service timeout are
  unchanged.

## Risks

- Holding a fake response across a fake tick works only because the `/service/*` timeout runs on
  the real `setTimeout` (`src/timeout.ts:3-6`, not wired from `MainDeps`, `src/index.ts:731-734`).
  The test releases held responses within real milliseconds, so the real 5000 ms timer never
  fires; the bun test timeout (default 5000 ms) would fail a stalled test first. Do not change the
  production timeout or add a seam to build these cases.
- Fake-time ordering: a timer due exactly when a report settles can make the test order-dependent.
  The cases below avoid equal deadlines; keep it that way when adjusting numbers.
- Cognitive complexity limit 15 per function (pinned config `eslint.config.js:16`, see the notify
  section): keep the serializer, the tick and the cycle as separate small functions.
- `test/index.test.ts` and `test/channel-loop.review.test.ts` fire heartbeat timers by delay.
  With D1 the tick arms the next `60_000` timer before its report starts; the existing test at
  `test/index.test.ts:514-581` then fires `60_000` after `stop()` and expects `false`, which holds
  because `stop()` cancels the newest handle. These tests must pass unchanged.

## Performance impact

`bench/budgets.json` of the api repository has a `notify` block with `startup_cpu_ms`,
`load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `startup_wall_ms` and `image_mb`.

- Runtime CPU (the cost behind `load_cpu_s`): up when reports are slow, because the change
  raises the heartbeat request rate. Today a heartbeat starts every `60000 + L` ms, where `L` is
  the latency of the previous heartbeat report. After the change it starts every 60000 ms. The
  heartbeat runs whatever the channel poll interval is, so this holds with the default 15000 ms
  poll too. Rate increase = `(60000 + L) / 60000 - 1`:
  - `L = 4000` ms (the issue's case): +6.7 %, 60 instead of 56.25 heartbeat reports per hour,
    +3.75 requests per hour.
  - `L = 5000` ms (upper bound, set by the 5000 ms `SERVICE_TIMEOUT_MS`, `src/api.ts:331`):
    +8.3 %, 60 instead of about 55.4 per hour, about +4.6 requests per hour.
  - `L` of a few ms (local api): below 0.01 %.
  One report builds a small body from in-memory state, serializes it and sends one HTTP request,
  roughly 1 ms of CPU or less. So the extra cost is about 5 ms of CPU per hour at most, far below
  the 10 ms resolution of a 60 s window. Poll reports are unchanged in number. Reports that
  collide now run one after the other instead of at the same time, which is the same number of
  requests. Coalescing can only remove requests.
- `load_cpu_s`: no measurable change expected. In the bench the api is local, so `L` is a few ms
  and the rate change is below 0.01 %. The bench load window is 60 s and holds at most one
  heartbeat on either side. The bench cannot exercise delayed reports, so a `bun bench/run.ts`
  A/B would show nothing about this change and is not required.
- `test_cpu_s`: up, by well under 0.5 s: one new test file that runs on fake time (no wall-clock
  sleeps; only bounded macrotask drains).
- `startup_cpu_ms`, `startup_wall_ms`, `idle_rss_mib`, `peak_rss_mib`, `image_mb`: none
  expected. Startup still arms one poll and one heartbeat timer. The loop gains one boolean and
  one shared promise, and the image gains no file or dependency.
- Measure test CPU: in notify, run `/usr/bin/time -v bun test` on `main` and on the branch and
  report "User time" + "System time" for each in the PR.
- Measure runtime with delayed reports (this measurement makes the reports slow): run notify
  from `main` and then from the branch with `bun run start`, each for 600 s of wall time,
  against the same local fake API. The fake API is a small `Bun.serve` script kept outside the
  repository, for example in a temp directory. It answers `GET /service/notify/channels` at once
  with an empty channel list and answers `PUT /service/notify/report` with `204` after 4000 ms.
  It logs the wall time at which each report request arrives. Use
  `PULSE_NOTIFY_CHANNELS_POLL_MS=300000`, a fixture token and a fresh temp state directory.
  Read the process CPU time (utime + stime from `/proc/<pid>/stat`) right after start and at
  600 s. Report for each side: the number of report requests, the list of gaps between report
  starts, and the CPU delta.
  Expected, from the 60000 ms rule and `L = 4000`, not from the code: on `main` the heartbeat
  gaps are about 64 s, and on the branch every gap is at most 61 s (60000 ms plus 1 s of
  wall-clock tolerance). The branch has the same number of heartbeat reports as `main` or one
  more. The CPU delta between the sides is within the 10 ms resolution of `/proc` (no threshold
  gates it; state it).

## Security impact

Security impact: no
The change only re-orders timers and serializes an existing request inside notify; it touches no
auth, parser, HTTP client header or redirect, file write, error or log text, dependency,
Dockerfile or CI.

## Rollout order

One repository: only notify changes. Its report body and endpoint are unchanged, so the api that
receives the reports, and older notify releases running against the same api, keep working;
deploying the new notify only makes the reports arrive on time.

## Counterexamples

Definitions used by every case: a *report start* is the fake clock value at entry of a fetch call
for `PUT .../service/notify/report`, relative to the fake clock value when `main()` is called
(`t = 0`). A *gap* is the difference of two consecutive report starts, in integer milliseconds
(the fake clock is an integer; no rounding). The *window* is `[0, end]` inclusive: timers due at
exactly `end` run. *In flight* counts report fetches that were entered and whose answer has not
yet been returned to notify.

1. Drift (the issue's bug). Poll 300000 ms, report latency 4000 ms, window `[0, 180000]`. Expected
   starts `[0, 60000, 120000, 180000]`. Old code gives `[0, 60000, 124000]` (re-arm after the
   report ends): count 3 and a gap of 64000 must fail.
2. Zero latency control. Same with 0 ms latency: `[0, 60000, 120000, 180000]`; old and new code
   both pass.
3. Double arming. An implementation that arms in the tick and also in the report's `finally`
   has two heartbeat timers after the first tick; with 4000 ms latency its starts are
   `[0, 60000, 120000, 124000, ...]`: the exact list must reject it.
4. Skip instead of wait. Poll 54000 ms, latency 4000 ms, window `[0, 100000]`: poll reports start
   at 0 and 58000; the tick at 60000 finds the 58000 report in flight. Expected starts
   `[0, 58000, 62000]`. Skip gives `[0, 58000]`; old code gives `[0, 58000, 60000]` with 2 in
   flight; both must fail.
5. Stale follow-up body. In case 4 the follow-up's report body field `at` must equal the fake
   time at its start (`62000` relative), not the tick time `60000`.
6. Catch-up burst. The heartbeat report that starts at 60000 is held until the test releases it
   at 185000. Poll is 300000, other reports have 0 ms latency, and the window is `[0, 240000]`.
   The ticks at 120000 and 180000 both find the held report in flight, so they share one
   follow-up. Each tick arms the next timer (D1), so the 240000 tick still fires. Expected starts
   are `[0, 60000, 185000, 240000]`, and the third body's `at` is 185000.
   These implementations must fail:
   - One queued request per missed tick: `[0, 60000, 185000, 185000, 240000]`, five starts.
   - Old code, which re-arms on release: the next tick is at 245000, so the window holds only
     `[0, 60000]`.
   - Skip: `[0, 60000, 240000]`.
   The release falls between ticks (185000 is not a multiple of 60000), so no deadline ties. The
   125000 ms gap from 60000 to 185000 is the documented exception: a request that outlasts a
   tick, which the 5000 ms service timeout prevents in production.
7. Failure blocks the slot. The heartbeat report at 60000 fails (fetch rejects with a network
   error, 0 ms): expected starts `[0, 60000, 120000, 180000]` and one `service report failed` log
   line for it. An implementation that does not release the slot on failure stops at
   `[0, 60000]`.
8. Shutdown with a pending follow-up. Poll 62000 ms, heartbeat report at 60000 held; the poll at
   62000 polls and requests a report, which waits. `stop()` is called at 63000; it must not
   resolve before the held response is released; after release it resolves and the report count
   stays 2 (`[0, 60000]`). Starting the follow-up during shutdown, or hanging because the poll
   cycle's wait is never released, must fail.
9. Rearm after stop. After `stop()` resolves in cases 8 and 10, no channel timer is left
   un-cancelled and advancing the fake clock to 300000 starts no report and no fetch.
10. Stop with only a pending timer: after the report at 0 settles, `stop()` at 1000 cancels the
    heartbeat timer; advancing to 300000 gives starts `[0]` only.

## Contract fields

No new names. The change adds no field, key, route, env variable or exported name; the endpoint
`service/notify/report` and the env variable `PULSE_NOTIFY_CHANNELS_POLL_MS` already exist and
stay as they are:

- `grep -rn 'notify/report' .repos/contract/src` lists the existing report body type and
  validator only (`notify-channels.ts:455`, `validate-runtime.ts:100`); nothing is added.
- `grep -rn 'PULSE_NOTIFY_CHANNELS_POLL_MS' .repos/config` finds nothing; config owns no notify
  names.

## Repository: notify

Files:
- `src/index.ts` (change: `startChannelLoop` heartbeat timer and report serialization)
- `test/report-heartbeat.test.ts` (new: regression and collision tests)
- `docs/channels.md` (change: the report sentence at line 212)

Behavior change: yes. Heartbeat reports move from end-anchored to start-anchored timing, and
reports of the channel loop no longer run at the same time.

### Tool facts (verified)

- Runtime and test runner: Bun 1.4.0 (`package.json:9` `engines.bun`, `package.json:35`
  `packageManager`), tests with `bun test` (`package.json:13`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:17`); lint
  = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`); typecheck = TypeScript
  7.0.2 `tsc --noEmit` (`package.json:12`, `package.json:27`).
- Coverage: `bunfig.toml:2-4`, line coverage at least 0.8; `test/**` is excluded from the
  measurement.
- Biome 2.6.3 (`package.json:21`); `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. At
  the pinned config `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:22`), `biome.json`
  `files.includes` (lines 10-17) covers `**` except `dist`, `node_modules`, `bun.lock`, `*.html`,
  `test/fixtures`, so the new test file is linted. The pinned file equals the config clone.
- ESLint: `eslint.config.js` extends `@lorenzh/pulse-config/eslint.config.js`; at the pinned
  config it sets `sonarjs/cognitive-complexity` to 15 (line 16).
- CI: `.github/workflows/ci.yml:18` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`,
  which runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`,
  `bun run test` on Bun 1.4.0 (pinned `check.yml:22-38`). The pinned `check.yml` equals the
  config clone.

### Behavior

Implement D1-D4 inside `startChannelLoop` in `src/index.ts`; keep the serializer beside its only
caller there (notify `AGENTS.md`, "Keep a helper beside its only caller").

- Heartbeat tick: if the loop does not run or there is no service, return. Otherwise arm the next
  heartbeat timer with `REPORT_HEARTBEAT_MS` (store its cancel handle as the current one), then
  request a report through the serializer and track the promise for `stop()`.
- Poll cycle: `await sync.poll()`, then request a report through the same serializer and await it.
- Serializer: at most one `report()` in flight; one shared pending follow-up, as in D2. The
  follow-up starts in the settlement of the in-flight report only while the loop runs; otherwise
  its waiters resolve without a request (D3).
- `stop()`: clear the running flag, cancel the poll timer and the current heartbeat handle, release
  a not-started follow-up, then await the running cycle and the in-flight report.
- Keep `report()` itself (body, `sendService` call, log text) unchanged.
- Update the doc comment above `startChannelLoop` (`src/index.ts:835-839`, which today reads "at most every" where "at least every" is meant) to say reports run one
  at a time and the heartbeat is timed from its start.
- `docs/channels.md:212`: keep the sentence and add that the 60000 ms heartbeat is timed from the
  start of the previous heartbeat, that reports never overlap, and that a report that finds one in
  flight waits and starts right after it, together with any other waiting report.

### Tests (`test/report-heartbeat.test.ts`)

Drive everything through the exported `main` with existing `MainDeps` seams, as
`test/channel-loop.review.test.ts:91-147` does:

- Env: `PULSE_NOTIFY_API_TOKEN` set, `PULSE_NOTIFY_STATE` in a fresh `mkdtemp` directory (removed
  in `finally`), `PULSE_NOTIFY_CHANNELS_POLL_MS` per case.
- `createNotifier` fake (`start(){}`, `stop: () => Promise.resolve()`), `heartbeatSchedule` and
  `commandSchedule` as no-op schedules, `logger: spyLogger()` from `test/support.ts`.
- A chronological fake scheduler for `channelSchedule` and a fake clock for `now`: each timer has a
  due time `clock + ms`; advancing to `end` repeatedly takes the earliest un-cancelled timer with
  due `<= end` (ties in arming order), sets the clock to its due time, runs it, and drains pending
  async work with a bounded loop of macrotask turns (like `until`, `test/index.test.ts:506-509`)
  before the next timer; then sets the clock to `end`. No wall-clock sleep stands for fake time.
- `serviceFetch` fake: `GET .../service/notify/channels` answers at once with
  `{ revision: "sha256-" + 64 hex, channels: [] }`; `PUT .../service/notify/report` records the
  relative fake time at entry and the parsed body, counts in-flight requests (max recorded), and
  answers `204` after the case's latency, where the latency is a fake timer on the same scheduler
  (so the response is separate from timer advancement), or holds the answer until the test
  releases it, or rejects with a `TypeError` for the failure case.
- Cases (literals from the Counterexamples section of this spec, not from the code):
  1. Zero latency, poll 300000, window `[0, 180000]`: starts `[0, 60000, 120000, 180000]`.
  2. 4000 ms latency, poll 300000, window `[0, 180000]`: starts `[0, 60000, 120000, 180000]`;
     every gap `<= 60000`; max in flight 1.
  3. Collision, poll 54000, latency 4000, window `[0, 100000]`: starts `[0, 58000, 62000]`, max in
     flight 1, the third body's `at` equals the fake clock at its start (relative 62000).
  4. Held across two ticks, poll 300000. Hold the report that starts at 60000. Advance to
     185000, so the ticks at 120000 and 180000 run while it is held. Release it, drain, then
     advance to 240000. Expected: starts `[0, 60000, 185000, 240000]` (exactly four, so a
     second request for the second missed tick fails), max in flight 1, and the third body's
     `at` equals relative 185000.
  5. Failure, poll 300000: the report at 60000 rejects; starts `[0, 60000, 120000, 180000]`, and
     the logger has a `service report failed` warning.
  6. Stop with a pending timer: zero latency, poll 300000; advance to 1000, `stop()`; advance to
     300000: starts `[0]`.
  7. Stop with an in-flight and a waiting report: poll 62000, the report at 60000 held; advance to
     63000; call `stop()`; drain; assert it has not resolved; release; await it; starts
     `[0, 60000]`; no un-cancelled channel timer left; advancing to 300000 adds no fetch.
- Assert the full list of starts (so a missing or extra report fails), not only the gaps.
- Keep `test/index.test.ts` and `test/channel-loop.review.test.ts` unchanged and passing (they
  cover the shutdown wait for an in-flight beat, poll and beat reports, timer cancel and the
  tokenless mode with 0 service calls).

### Completion evidence

- Red: with the new test file on the unchanged `src/index.ts` (`5a44c5a` or the then-current
  `main`), `bun test test/report-heartbeat.test.ts` fails case 2 (expected
  `[0, 60000, 120000, 180000]`, got `[0, 60000, 124000]`) and passes case 1. State in the PR the
  command, which cases failed, and the actual lists.
- Green: the same command passes all cases on the fix.
- `bun run check` passes, with `biome.json`, `bunfig.toml`, `eslint.config.js`, `tsconfig.json`
  and CI unchanged (`git diff --exit-code -- biome.json bunfig.toml eslint.config.js tsconfig.json .github`).
- `git diff --stat` shows only the three files in `Files:`; `src/service-report.ts`, `src/api.ts`,
  `src/ledger.ts` and `src/config.ts` are unchanged.
- The `bun test` CPU time on `main` and on the branch (see Performance impact).
- The delayed-report runtime run from Performance impact, which also serves as the
  `bun run start` smoke run that notify `AGENTS.md:82` requires. For `main` and the branch,
  state the report count, the gaps between report starts and the CPU delta over 600 s. The
  expected values are the literals of that section: about 64 s gaps on `main` and every gap
  at most 61 s on the branch. Do not publish the fixture token.

## Acceptance evidence (feature)

- The red/green record above: the new test fails on the old code (case 2: three starts instead of
  the literal four, a 64000 ms gap) and passes on the fix. The expected starts are the literals
  of this spec, derived from the 60000 ms rule of #570 Decision 5, not from the code under test.
- `bun run check` passes in pulse-notify on the PR branch and in its CI run.
