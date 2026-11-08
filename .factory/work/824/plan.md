# Spec #824: notify schedules the service report heartbeat from its start time

## Goal

notify must start a service report (`PUT /service/notify/report`) at least every 60000 ms while it
has a service token, as Task T2 and Decision 5 of #570 require (`.factory/work/570/plan.md:341`).
Today the next heartbeat timer is set only after the previous report request ends, so report
latency stretches every heartbeat interval. With `PULSE_NOTIFY_CHANNELS_POLL_MS=300000` and 4000 ms
report latency the starts are 0, 60000, 124000 ms. The fix anchors each heartbeat on its own start
and runs every report of the channel loop one at a time.

This repairs behavior that #570 (child #810, lorenzh/pulse-notify#47, merged) built. It does not
redo that feature: report content, endpoints, ledger format, channel polling and token handling stay
as they are.

## Evidence (notify `main` at `5a44c5a3de1764faa04b6cd3762f2c2be4c58430`)

Paths are in the notify clone.

- `src/index.ts:677-678`: `REPORT_HEARTBEAT_MS = 60_000`.
- `src/index.ts:840-911` `startChannelLoop`: `report()` (`847-873`) builds the body from
  `sync.state()`, `deps.now()` and `deps.ledger.failed()` and sends it with `sendService`.
  `cycle()` (`874-877`) runs `sync.poll()` then `report()`. `nextPoll` (`878-886`) sets the next
  poll after a cycle ends. `nextBeat` (`887-896`) sets the next heartbeat timer only in the
  `finally` of the previous report: this is the bug. Poll reports and heartbeat reports call
  `report()` independently, so today they can overlap as well.
- `src/index.ts:904-909` `stop`: sets `isRunning = false`, cancels the poll and heartbeat timers,
  awaits the running poll and the heartbeat reports. `main`'s `finish` (`213-230`) awaits this
  before the ledger flush, close and lock release.
- `src/index.ts:123-147` `MainDeps`: `now`, `channelSchedule`, `serviceFetch`, `heartbeatSchedule`,
  `commandSchedule` and `createNotifier` are injectable, so the test drives `main` without
  exporting anything new. `src/types.ts:171`: `Schedule = (fn, ms) => () => void`.
- `src/config.ts:445,447,505-508`: channel poll default 15000 ms, minimum 1000 ms, read from
  `PULSE_NOTIFY_CHANNELS_POLL_MS`.
- `src/api.ts:330-331,405-423`: every `/service/*` request has a 5000 ms timeout
  (`SERVICE_TIMEOUT_MS`). The channel loop's `ServiceOptions` carry no `schedule`, so that timeout
  is a real timer (contract `src/client.ts:184-185`). A fake fetch held for virtual minutes is
  released in real milliseconds, so the timeout does not fire in the test. No change to it.
- `test/channel-loop.review.test.ts:92-143` already tests that stop waits for an in-flight
  heartbeat; it does not check cadence. It must keep passing unchanged.
- `docs/channels.md:212` promises a report "after every poll, and at least every 60000 ms".
  `README.md:7` describes the channel poll and the report without the cadence.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/824` answered
  HTTP 404, so the feature has no findings yet.

## Scope

- notify only: `src/index.ts` (channel loop), a new `test/report-heartbeat.test.ts`,
  `docs/channels.md`, `README.md`.

## Non-goals

- No change to the report body, `buildServiceReport`, `src/service-report.ts`, the endpoints,
  `src/api.ts`, the ledger (`src/ledger.ts`) or its format, or `src/config.ts`.
- No new setting, no change of `REPORT_HEARTBEAT_MS` (stays 60000), the channel poll interval or
  its anchoring (the next poll is still set when a cycle ends), the resend command loop, or the
  tokenless behavior (no `/service/*` call without a token).
- No new dependency, no tooling, CI or shared config change, no new export for tests.

## Required behavior

- **D1 Heartbeat anchor.** When a heartbeat timer fires and the loop is running, it first sets the
  next heartbeat timer (60000 ms), then requests a report. The end of a report never sets a
  heartbeat timer. The first heartbeat timer is set in `start()` as today; the startup report
  still comes from the first poll at 0 ms.
- **D2 One report at a time.** Heartbeat reports and poll reports share one report slot. If the
  slot is free, the request starts a report at once. If a report is in flight, the request waits.
  All requests that arrive while one report is in flight share one follow-up report; there is never
  more than one follow-up, and never one report per missed tick. The follow-up starts as soon as
  the running report ends (success or failure) and builds its body at its own start, from the state
  and the clock of that moment (its `at` is its start time). A poll cycle's request resolves when
  the report it started or joined has ended, so the next poll is still set after the cycle's report
  as today.
- **Why wait, not skip** (the issue allows either): skipping can leave a gap of nearly two
  intervals (for example 62000 ms when a report takes 2000 ms across a tick). Waiting keeps every
  gap between report starts at or under 60000 ms as long as each request ends within 60000 ms,
  which the 5000 ms service timeout ensures in production.
- **D3 Shutdown.** `stop()` sets the loop to stopped, cancels the pending poll timer and the newest
  heartbeat timer, and drops a follow-up that has not started: it resolves without sending. It
  still awaits the running poll cycle and the report in flight, so `finish` keeps closing the
  ledger and freeing the lock only after them. After `stop()` no report starts and no channel-loop
  timer is set.
- **D4 Failure.** A report that fails (error answer, network error, timeout) logs the same
  `service report failed` warning as today, frees the slot and does not reject to the caller. The
  pending follow-up and the next heartbeat still run.
- **Bound statement.** "At most 60000 ms" is measured between report request starts, not
  completions or successful answers. A report held longer than 60000 ms (impossible in production
  because of the 5000 ms timeout, but possible with an injected fetch) cannot meet both the bound
  and non-overlap; non-overlap wins, one follow-up starts when it ends, and later heartbeat ticks
  keep their 60000 ms cadence. Event-loop delay is outside the guarantee.
- Keep `startChannelLoop` and its helpers within the SonarJS cognitive complexity limit of 15 per
  function (see the notify section for the citation); split a helper beside it if needed.

## Risks

- A follow-up promise that never settles when it is dropped would hang `stop()` (the poll cycle
  awaits it). D3 requires a dropped follow-up to resolve; test case 7 covers it.
- Draining asynchronous work in the fake-clock test: the report path goes through `requestJson`
  and `Response` bodies. The test must drain until no work is pending at each event, without real
  sleeps that the expected times depend on.
- Slightly more heartbeat requests when reports are slow (see Performance impact).

## Performance impact

Metrics of `bench/budgets.json` in the api clone that exist for notify: `startup_cpu_ms`,
`load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s` (gating), `startup_wall_ms`, `image_mb`
(reported).

- **Runtime request rate (not a bench metric).** With report latency L, heartbeat reports used to
  start every 60000 + L ms and now start every 60000 ms. The heartbeat rate rises by L / 60000:
  at L = 4000 about 6.7 % (56.25 to 60 per hour, 3.75 more), at L = 5000 (the most the 5000 ms
  timeout allows) about 8.3 % (about 4.6 more per hour). Poll reports and collisions change total
  counts; these are heartbeat-only estimates. The CPU cost of a few extra small JSON requests per
  hour is expected to be in the low milliseconds per hour, but this spec does not take that as
  established: the implementer measures it (below) and records it without a gating threshold.
- **`load_cpu_s`, `startup_cpu_ms`, `idle_rss_mib`, `peak_rss_mib`, `startup_wall_ms`**: no
  measurable change expected. The bench api is local, so L is a few milliseconds and the heartbeat
  rate changes by under 0.01 %; within the 60 s window at most one heartbeat fires anyway. The
  report slot adds one or two promise fields.
- **`test_cpu_s`**: rises slightly, by the seven fake-clock cases of the new test file; expected
  well under 0.5 s. Measured by the `bun test` run time before and after, recorded only.
- **`image_mb`**: none; the test file is not in the image (ci.yml checks that) and `src/` grows by
  a few lines.
- **Measurement that exercises slow reports** (the bench cannot): run the recorded base and the
  branch for 600 s each with `bun run start`, `PULSE_NOTIFY_API_TOKEN` set,
  `PULSE_NOTIFY_CHANNELS_POLL_MS=300000`, against a local fake API on `127.0.0.1` that answers the
  routes notify calls and delays every `PUT /service/notify/report` answer by 4000 ms. For each
  side record the SHA, the exact command, the report count, each report start time and the gaps
  between adjacent starts, which reports followed a channel poll, and process CPU
  (`utime + stime` from `/proc/<pid>/stat` at the end, in clock ticks converted to ms). Expected:
  heartbeat-only gaps of about 64 s on the base and every start gap at most 61 s on the branch
  (1 s wall-clock tolerance). The CPU difference is recorded, not gated. A local
  `bun bench/run.ts --a <ref> --b <ref>` A/B from the api repository is optional; it is not
  expected to show a difference.

## Security impact

Security impact: no
The change only reorders when the existing report request runs; it touches no admin route or
authentication, no parser or validator, no probe client, no file write, no error or log text, no
dependency, Dockerfile or CI.

## Rollout order

One repository: only notify changes, and the report body and endpoint stay the same, so the api
and every other service are unaffected by the order of release.

## Counterexamples

Definition used by all cases: a **report start** is the virtual-clock time at which the injected
`serviceFetch` is called with method `PUT` and a URL whose path ends in `/service/notify/report`.
The sample set is every report start in the inclusive window `[0, end]` of the case, in call
order. A **gap** is the difference between two adjacent starts of that list. The **largest gap**
is the maximum of those differences, in whole milliseconds, without rounding (the clock is
integer). **Concurrency** is the number of report fetches that have been called and whose
response has not settled; the **maximum concurrency** is its maximum over the case. No percentile
is used.

1. **Latency stretches the interval (the bug).** 4000 ms report latency, poll 300000, window
   `[0, 180000]`: a correct loop starts at `[0, 60000, 120000, 180000]`. The old code starts at
   `[0, 60000, 124000]` (largest gap 64000) and must be rejected.
2. **Overlap.** A naive fix that only moves the heartbeat timer starts the 60000 heartbeat while
   the poll report of 57000 is still in flight: maximum concurrency 2, rejected. Required: 1.
3. **Catch-up queue.** A report held from 60000 to 185000 crosses the ticks at 120000 and 180000.
   One queued request per missed tick gives `[0, 60000, 185000, 185000, 240000]`, rejected.
4. **Skip.** The same case with skipping gives `[0, 60000, 240000]`, rejected. Required:
   `[0, 60000, 185000, 240000]`.
5. **Stale body.** A follow-up that builds its body at the tick time sends `at: 120000` in the
   report that starts at 185000, rejected. Required: `at: 185000`.
6. **Shutdown.** A follow-up that starts after `stop()`, a heartbeat timer that is not cancelled,
   or a `stop()` that resolves before the in-flight report ends, are rejected.
7. **Failure.** A failed report that keeps the slot busy (no later report) or that rejects
   unhandled is rejected.
8. **Wall-clock measurement.** A branch run whose report starts are more than 61 s apart is
   rejected; a base run is not required to fail any bound, it gives the comparison.

## Contract fields

No new names. The change adds no field, key, route, setting or export; the report body and
`PUT /service/notify/report` are unchanged. Internal identifiers inside `startChannelLoop` are not
names of the contract or config.

## Repository: notify

Files:
- `src/index.ts` (change: heartbeat anchor and report slot in `startChannelLoop`, comment of
  `startChannelLoop` and `REPORT_HEARTBEAT_MS` if needed)
- `test/report-heartbeat.test.ts` (new: regression tests)
- `docs/channels.md` (change: report cadence at line 212)
- `README.md` (change: report cadence in the overview paragraph at line 7)

Behavior change: yes
Report starts change timing (60000 ms from each heartbeat start instead of from the previous end)
and reports no longer overlap.

### Tool facts (verified)

- Bun 1.4.0: `package.json:9` (`engines.bun`) and `package.json:35` (`packageManager`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:17`);
  `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`); `typecheck` =
  `bun node_modules/typescript7/bin/tsc --noEmit` (`package.json:12`); `test` = `bun test`
  (`package.json:13`). `@biomejs/biome` 2.6.3 (`package.json:21`), `@lorenzh/pulse-config` pinned at
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:22`).
- `bunfig.toml:1-4`: `[test]` with `coverage = true`, `coverageThreshold = { lines = 0.8,
  functions = 0 }`, coverage ignores `test/**`.
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. In pulse-config at the pin, `biome.json`
  lines 10-17 include `**` and exclude only `dist`, `node_modules`, `bun.lock`, `*.html` and
  `test/fixtures`, so `test/report-heartbeat.test.ts` is linted and formatted (line width 100,
  line 23).
- `eslint.config.js:1,4` uses `@lorenzh/pulse-config/eslint.config.js`; at the pin its line 16 sets
  `"sonarjs/cognitive-complexity": ["error", 15]`.
- CI: `.github/workflows/ci.yml:18` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`; at the
  pin that workflow sets up Bun 1.4.0 (line 24) and runs `bun install --frozen-lockfile` (26),
  `bun run lint` (28), `bun run typecheck` (30) and `bun run test` (38).
- The pinned `check.yml`, `biome.json`, `eslint.config.js` and `lefthook.yml` were read with
  `gh api "repos/lorenzh/pulse-config/contents/<path>?ref=04108fa…"` and are identical to the config
  clone (`main` at `bc870498cc8e2539a132ce2aac35a09db1deabd8`).

### Implementation

1. Before any edit, record the implementation base: `BASE=$(git rev-parse HEAD)` on an up-to-date
   `main` (the spec read `5a44c5a`; use the newer `main` if it moved). Put the SHA in the PR.
2. Red: write `test/report-heartbeat.test.ts` first and run `bun test test/report-heartbeat.test.ts`
   on the base. Record the output: case 2 must fail with the actual starts `[0, 60000, 124000]`;
   cases 3 and 4 must fail too (concurrency 2; starts `[0, 60000]`). Cases 1, 6 and the others may
   pass on the base.
3. Green: in `startChannelLoop` (`src/index.ts:840-911`) implement D1-D4: a report slot (the
   in-flight report and at most one shared follow-up), a heartbeat tick that sets its next timer
   before requesting, poll cycles that request through the slot, a stop that drops the follow-up
   and awaits the in-flight work. Keep `report()`'s body building and `sendService` call as they
   are; it now runs only through the slot.
4. Docs: in `docs/channels.md:212` and `README.md:7` state that with a token notify starts a report
   after every channel poll and at least every 60000 ms, measured from the start of one report to
   the start of the next, that a slow report (up to the 5000 ms service timeout) or a long
   `PULSE_NOTIFY_CHANNELS_POLL_MS` no longer stretches that interval, and that reports run one at a
   time: a report due while another is running waits for it, and all such reports are sent as one.
   Do not promise the bound for a request held longer than 60000 ms.

### Test: `test/report-heartbeat.test.ts`

Drive the exported `main` with:
- env `PULSE_NOTIFY_API_TOKEN` (a test value), `PULSE_NOTIFY_STATE` in an own `mkdtemp`
  directory (removed in `finally`), `PULSE_NOTIFY_CHANNELS_POLL_MS` as the case says;
- deps `logger: spyLogger()` (`test/support.ts`), `now` = a virtual clock starting at 0,
  `channelSchedule` = a hand-written virtual scheduler, `heartbeatSchedule: () => () => {}`,
  `commandSchedule: () => () => {}`, `createNotifier` = a no-op notifier, as in
  `test/channel-loop.review.test.ts:115-125`;
- `serviceFetch` = a fake that answers `GET …/service/notify/channels` at once with
  `{ revision: "sha256-<64 hex>", channels: [] }` and an ETag, and answers each report PUT with
  `204` after the case's latency, by setting a timer on the same virtual scheduler (latency 0
  answers at once). It records each report start (virtual time, parsed body) and tracks
  concurrency.

The test advances the virtual clock event by event: take the earliest uncancelled timer, set the
clock to its time, run it, and drain pending asynchronous work before the next event. No real
clock decides any expected time. All expected values below are literals in the test, not computed
from the code under test or from a copy of the scheduling algorithm. No two timers of a case are
due at the same time.

1. **Zero-latency control.** Poll 300000, latency 0, window `[0, 180000]`: starts exactly
   `[0, 60000, 120000, 180000]`, largest gap 60000.
2. **4000 ms latency (regression).** Poll 300000, every report latency 4000, window
   `[0, 180000]`: starts exactly `[0, 60000, 120000, 180000]`, largest gap at most 60000, maximum
   concurrency 1. Fails on the old code with `[0, 60000, 124000]`.
3. **Poll report across a tick.** Poll 53000, every report latency 4000, window `[0, 180000]`:
   starts exactly `[0, 57000, 61000, 114000, 120000, 171000, 180000]` (poll reports 0, 57000,
   114000, 171000; the 60000 tick waits for the 57000 report and starts at 61000; ticks at 120000
   and 180000 keep their cadence), maximum concurrency 1, largest gap at most 60000.
4. **Report held across two ticks.** Poll 300000; the report at 0 answers at once, the report that
   starts at 60000 is held until 185000, later reports answer at once. Window `[0, 240000]`: starts
   exactly `[0, 60000, 185000, 240000]`, maximum concurrency 1, the third report body's `at` is
   185000. Do not apply the 60000 gap assertion to this case.
5. **Failure frees the slot.** Poll 300000, latency 0, the report at 60000 answers `503` (a second
   run of the case, or a separate case, makes it reject with a `TypeError`). Window
   `[0, 180000]`: starts exactly `[0, 60000, 120000, 180000]`, the logger saw a
   `service report failed` warning, no unhandled rejection was observed (listen for
   `unhandledRejection` during the case, as `test/notifier.test.ts:337-343` does).
6. **Stop with a heartbeat timer pending.** Poll 300000, latency 0. Advance to 30000, call
   `stop()` and await it. Advance the clock to 600000: starts exactly `[0]`, no channel-loop timer
   is set after `stop()` was called, and the 60000 heartbeat timer was cancelled.
7. **Stop with a report in flight and a follow-up waiting.** Poll 300000; the report at 60000 is
   held until the test releases it. Advance to 120000 (the tick finds it in flight). Call `stop()`
   at 130000; after draining, `stop()` has not resolved. Release the held report at 140000; `stop()`
   resolves. Advance to 600000: starts exactly `[0, 60000]` (the follow-up never starts), maximum
   concurrency 1, the 180000 heartbeat timer was cancelled, no timer set after `stop()`.

Existing tests stay unchanged and pass, including `test/channel-loop.review.test.ts`,
`test/service-report.test.ts`, `test/index.test.ts` and the ledger tests.

### Checks and completion evidence

- `bun test test/report-heartbeat.test.ts` on `$BASE` (red, output recorded as in step 2) and on
  the branch (green, 7 passing cases).
- `bun run check` passes on the branch, with no change to coverage or lint config.
- **Scope against the recorded base**, run after the last commit (and again before handoff), with
  literal expected values:
  - `git diff --exit-code $BASE -- src/api.ts src/service-report.ts src/ledger.ts src/config.ts
    AGENTS.md package.json bun.lock bunfig.toml biome.json tsconfig.json eslint.config.js
    lefthook.yml .github/` and the same with `git diff --cached --exit-code $BASE -- …` both exit 0.
    These compare the base commit with the working tree and with the index, so a committed or a
    staged forbidden edit fails them.
  - `{ git diff --name-only $BASE; git diff --cached --name-only $BASE; git diff --name-only $BASE HEAD; } | sort -u`
    prints exactly these four lines:
    `README.md`, `docs/channels.md`, `src/index.ts`, `test/report-heartbeat.test.ts`.
  - `git ls-files --others --exclude-standard` prints nothing (the new test is committed; the
    fake API and measurement scripts live outside the repository, for example in `/tmp`).
  - A clean `git status` or a diff against `HEAD` alone is not accepted as this evidence.
- **Smoke and performance run** (the `bun run start` exercise that `AGENTS.md` requires): the two
  600 s runs described under Performance impact, base in a separate worktree
  (`git worktree add /tmp/notify-base $BASE`, removed afterwards) and branch, with identical
  settings and fake API. Record per side: SHA, command, report count, report start times, adjacent
  gaps, which starts followed a channel poll, and CPU ms from `/proc/<pid>/stat`. Pass condition
  on the branch: every adjacent gap between report starts is at most 61 s (literal tolerance for
  wall-clock jitter). Expected on the base: heartbeat-only gaps of about 64 s. The CPU difference
  is reported, not gated.
- PR body: `Closes lorenzh/pulse-meta#<child>`, the base SHA, the red and green outputs, the scope
  check output, the measurement table, and the known limit (a request held past 60000 ms delays
  one report; the production timeout of 5000 ms prevents that).
