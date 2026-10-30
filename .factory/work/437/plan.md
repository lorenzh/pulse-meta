# Spec #437: api startup CPU tripled since the F8 latency rollup backfill

## Goal

Bring api startup CPU back within the gating budget (`startup_cpu_ms` <= 325 ms on the bench fixture, near the pre-F8 ~250 ms) without losing the latency rollups. The closed-day backfill of `latency_daily` must start clearly after the server listens. It must run in small batches that yield to requests, and it must log one start line and one end line. `/latency`, `/checks/:id/latency`, `slo` and `/metrics` keep their shape and values.

## Current behavior (api `main` 352ec49)

- `src/latency-rollup.ts` `startLatencyRollup` schedules the first run with `setTimeout(run, 0)`. `src/start.ts` creates the runner before `server.listen`, so the first run starts right after listen. Later runs come every `LATENCY_ROLLUP_INTERVAL_MS` (1 h; tests shorten it through `retentionIntervalMs`).
- `fillAllRollups` calls `service.fillLatencyRollups(id)` once per active HTTP check, with `sleep(0)` between checks. `fillRollups` in `src/service.ts` computes **all** missing closed days of one check (up to 89) in **one** synchronous transaction. On the bench fixture that is about 85 ms per check, during which no request is served.
- The backfill is already incremental. Only closed days in the 90-day window without a `latency_daily` row are computed. Empty days get a `count: 0` row.
- The read path already fills missing days. `latencyOf` → `fillRollups` stores every missing closed day of the read check (`INSERT OR IGNORE`) and computes today live.
- SLO (`sloDays` / `uptimeOf`) reads only `results`, never `latency_daily`.
- Logging: `latency rollup: stored N days`, only when N > 0. There is no start line and no duration.
- Bench (`bench/stack.ts`): every round copies a fresh seed with an empty `latency_daily` (20 checks × 89 days = 1 780 days). It reads `/proc/1/stat` CPU via `docker exec` right after the first `/readyz` 200. Then it starts probe, status and notify, waits `IDLE_S` = 30 s (idle RSS sample), runs `WARMUP_S` = 20 s of warm-up and then the 60 s measured window (`load_cpu_s`).

So incrementality alone cannot move the bench. The work has to move out of the startup sample, and it must still end before the load window.

## Scope

Target: `api` only.

1. Start the rollup runner only after `server.listen` succeeded, and run its first run after a start delay `LATENCY_ROLLUP_START_DELAY_MS = 5_000`. The delay is exported from `src/latency-rollup.ts` and injectable as `startDelayMs` in `LatencyRollupDeps`. Hourly runs follow as today. The next run is scheduled `intervalMs` after a run ends.
2. Batch unit: **one (check, day) per transaction**. After every batch the runner yields with `await deps.sleep(0)`. There are no longer sleeps. On the bench fixture the whole backfill (about 1.7 s of compute plus 1 780 yields) ends a few seconds after the delay, well inside the 30 s idle phase.
3. Incremental: per check, the runner first lists the missing closed days (one `SELECT`). It computes only those. Before computing a day, it skips the day if a row exists by now, because a read may have stored it meanwhile. A run on a complete table computes and writes 0 days.
4. Keep the read fallback unchanged. A read computes and stores the missing closed days of the checks it reads, and computes today live. Responses are therefore correct before, during and after the backfill.
5. Logging, with duration from an injected `now` in `LatencyRollupDeps`:
   - First run (the startup backfill), always, also with 0 days:
     `latency rollup: backfill started (<C> checks)` and then
     `latency rollup: backfill done, stored <N> days in <D> ms`.
   - Hourly runs: one line `latency rollup: stored <N> days in <D> ms`, only when N > 0.
   - A failure keeps `latency rollup failed: <message>` and does not log a "done" line for that run. No per-batch lines.
   - `<D>` = `now()` at the end minus `now()` at the start of the run, rounded with `Math.round`, integer ms.
6. Shutdown: `stop()` cancels the pending start delay or interval timer. It resolves after the batch in progress (at most one (check, day)), so the DB is closed only after that batch. The listen-failure path no longer needs to stop the runner, because the runner is not created before listen succeeds. Shutdown before listen and shutdown during the delay both end cleanly.
7. Docs: `docs/operation.md` and `docs/concepts.md` describe the new start (delay after listen, one day per batch, yields, log lines). Remove the claim "a backfill at start".

## Non-goals

- No change to the cost of the first SLO read on `GET /checks` (~0.4 s on 1 M results). That is request-path work, not startup work.
- No change to `bench/budgets.json`, `bench/baseline.json` or the bench harness.
- No change to the rollup rules (closed days are stored once, a late result for a closed day does not change it, retention cutoff, 90-day window, nearest-rank percentiles, `REAL` columns).
- No new environment variable, route, metric or response field.
- No change in contract, kit, status, probe, notify, config or website.

## Required behavior (api)

- `startLatencyRollup(deps)` schedules its first run with `deps.setTimeout(run, deps.startDelayMs ?? LATENCY_ROLLUP_START_DELAY_MS)`, never with 0. `src/start.ts` calls `startLatencyRollup` only after the `server.listen` promise resolved, and passes `now: deps.now`. Tests may pass `startDelayMs`.
- Service API (`src/service.ts`, `Service` interface). Replace `fillLatencyRollups(checkId): number` with:
  - `missingLatencyDays(checkId: string): number[]`: the closed days (`day < today`, today = `dayOf(now())` at the call) in the 90-day window without a row, ascending.
  - `fillLatencyRollupDay(checkId: string, day: number): boolean`: if a row for (check, day) exists, or if `day >= dayOf(now())`, it returns `false` and computes nothing. Otherwise it computes `rollupOfDay`, stores it with `INSERT OR IGNORE` and returns `true` when a row was inserted. It is one synchronous statement pair, so no request can interleave.
  - The read path (`latencyOf` / `fillRollups`) stays as it is.
- `fillAllRollups(deps, isStopped)` loops over `listLatencyCheckIds()`, then over `missingLatencyDays(id)`. It calls `fillLatencyRollupDay` once per day and then `await deps.sleep(0)`. It checks `isStopped()` before every batch and returns the number of days written. It returns `{ checks, written }`, or the runner counts checks itself. The implementer chooses, as long as the log lines above hold.
- The runner's first run is the "backfill" run for the logs. Every later run is "hourly".

## Risks

- **Backfill runs into the load window.** If the start delay plus the backfill exceeded about 50 s after `/readyz`, `load_cpu_s` would rise. With a 5 s delay and about 2–4 s of work this does not happen. The bench log shows the end line with its timestamp, so the implementer checks it.
- **Backfill too early.** If the delay were shorter than the time the bench needs to read CPU after `/readyz` (`docker exec`, about 100–300 ms), CPU would still be counted. 5 s leaves a wide margin.
- **Per-day transactions are slower in total.** 1 780 small transactions instead of 20 large ones cost a commit each. On SQLite (WAL or rollback in the container) this adds a few ms per hundred. That is acceptable, because it happens off the startup sample and is under 1 s in total.
- **Read during the backfill.** A cold `GET /latency` during the delay or the backfill still computes the missing days of all checks inside that request, as today. That is correct but slow once. It is accepted, and in the bench nobody reads it before the warm-up.
- **Midnight during a run.** `missingLatencyDays` uses the today of its call. A day that closes during the run is picked up by the next run, or by a read. `fillLatencyRollupDay` refuses `day >= today`, so the current day is never stored.
- **Timers in tests.** `start.test.ts` and other tests with real timers would now see the first run 5 s later. Tests that relied on the old immediate start must inject `startDelayMs: 0` or drive a fake `setTimeout`.

## Performance impact

Metrics of `bench/budgets.json` (`api`) that this change moves:

- `startup_cpu_ms` (gating): **down**, from ~740–750 ms to about the pre-F8 ~250 ms (must be <= 325 ms). The backfill no longer runs before the CPU sample.
- `startup_wall_ms` (reported): **down**, from ~1650 ms to near ~475 ms (budget reference 618 ms). The event loop is free while the bench polls `/readyz`.
- `load_cpu_s` (gating): **unchanged**. The backfill ends inside the 30 s idle phase, before the measured window.
- `idle_rss_mib` and `peak_rss_mib` (gating): **unchanged** within noise. The same rows are computed. Per-day batches hold fewer result rows in memory at once, so the peak can only drop.
- `test_cpu_s` (gating): about unchanged. A few added tests use in-memory DBs and fake timers, so expect under +0.1 s.
- `p95_get_latency_ms`, `p95_get_check_latency_ms`, `p95_get_checks_ms`, `p95_post_results_ms`, `rps` (reported): unchanged, because the table is full before the load window. `image_mb`: unchanged.

How to measure: run a local A/B `bun bench/run.ts --a <api main sha> --b <branch sha>` in the api repository (see `bench/README.md`). Compare `startup_cpu_ms` and `startup_wall_ms` of B against A and the budgets. Check that `load_cpu_s`, `idle_rss_mib` and `peak_rss_mib` are not FAIL. Then check in the api log of a B round that `backfill done, stored 1780 days` appears before the load window starts (about 50 s after ready).

## Security impact

Security impact: no. The change only moves and splits internal background work. The new log lines carry only counts and a duration, with no check ids, URLs or other external data. It touches no route, auth, parser, file write, dependency, Dockerfile or CI.

## Rollout order

One repository: only `api` changes. No route, response or contract type changes, so status, probe and notify on any pin keep working.

## Counterexamples

- **Start delay.** A runner that calls `setTimeout(run, 0)`, or that runs any `fillLatencyRollupDay` before `server.listen` resolved, is wrong. A test with a fake `setTimeout` must see the first timer at `startDelayMs` (default 5 000) and **zero** service fill calls before that timer fires.
- **Runner created before listen.** If listen fails (port in use), no rollup timer may be pending, and the startup error still rejects as today.
- **Batch size.** A runner that calls the old per-check fill (89 days in one transaction) is wrong. A test with a spy service must see one `fillLatencyRollupDay` call per (check, day) and one `sleep(0)` after each call. For example, 2 checks × 89 missing days give 178 fill calls and 178 yields.
- **Incremental.** Seed a DB, run a full backfill, then start a new runner on the same DB with the same `now` (same UTC day). The run must call `fillLatencyRollupDay` 0 times. The row count of `latency_daily` must stay the same, and the end line must be `latency rollup: backfill done, stored 0 days in <D> ms`. A runner that recomputes existing days and relies on `INSERT OR IGNORE` to drop them is wrong, because it would still compute 178 days.
- **Restart after midnight.** The same DB with `now` one day later must compute exactly 1 new day per check (the newly closed day). It must not compute 0, and it must not compute 89.
- **Read stored a day first.** If a read stores day d while the runner is paused before d, `fillLatencyRollupDay(check, d)` must return `false` without computing. The final `written` excludes d, and the table has exactly one row for (check, d).
- **Today.** `fillLatencyRollupDay(check, today)` must return `false` and store nothing, also when results exist for today.
- **Identical responses.** The test fixture has at least 2 HTTP checks. They have results on several closed days with different latencies, a closed day with only `down` results (`p50Ms`/`p95Ms` null, count 0), and results today. One HTTP check has an availability target, so it carries `slo`. Reads go through HTTP: `GET /latency`, `GET /checks/a/latency`, `GET /checks` (the `slo` of the target check) and `GET /components` if the fixture has a component. They are taken (1) on a fresh DB before any backfill, (2) with the backfill paused halfway (an injected `sleep` that blocks after k = half of the batches), and (3) after the backfill ended. All three snapshots must be `deepEqual`. Between reads the injected clock advances by 6 s (more than the 5 s `CACHE_TTL_MS`, same UTC day), so the cache does not hide a difference. No results for closed days are posted between reads. For snapshot (1), use a second, identical DB, or read with `latency_daily` emptied afterwards, so that the backfill in (2) and (3) still has work. Check that at least one batch ran before (2) and at least one ran after it.
- **Statistics (unchanged rules, must stay identical).** Per check and UTC day `[day*86400000, (day+1)*86400000)`, the sample set is the `latency_ms` of the results with `status != 'down'` (the unchanged `dayLatencies` query of `rollupOfDay`). `p50Ms`/`p95Ms` are nearest-rank (`nearestRank`, rank = ceil(p/100 × n), 1-based, on ascending values), with no interpolation and no rounding beyond what `summarizeLatencies` does today. `count` = number of samples. The rollup of a day is computed only from that day's samples, never as an average of other percentiles. A batched implementation that merged per-hour percentiles would be wrong.
- **Logging.** The first run logs exactly 2 lines (start and done), in this order, also with 0 days. An hourly run with 0 days logs nothing. An hourly run with N > 0 logs exactly 1 line. `<D>` is an integer, for example `in 1234 ms` with an injected clock that advances by 1 234 ms. `in 1234.0 ms` and `in 1.234 s` are wrong.
- **Shutdown.** `stop()` during the start delay: the timer is cleared, no fill call happens afterwards, and `stop()` resolves at once. `stop()` while a batch is blocked in the injected `sleep`: after the sleep resolves, no further fill call happens, the run ends, and `stop()` resolves. The DB closes only after `stop()` resolved (existing shutdown order in `start.ts`).

## Contract fields

No new names in contract or config. The new names are internal to the api:

- `LATENCY_ROLLUP_START_DELAY_MS`, `startDelayMs`, `missingLatencyDays`, `fillLatencyRollupDay` are TypeScript identifiers inside `src/` of the api.
- `grep -rn 'LATENCY_ROLLUP_START_DELAY_MS\|startDelayMs\|missingLatencyDays\|fillLatencyRollupDay' .repos/contract/src .repos/config/src` gives no hits.
- `grep -rn 'backfill' .repos/contract/src .repos/config/src` gives no hits.

No route, response field, environment variable or metric is added or renamed.

## Repository: api

Files:
- `src/latency-rollup.ts`: start delay constant and dep, `now` dep, per-day batches, start/done/hourly log lines.
- `src/service.ts`: `missingLatencyDays` and `fillLatencyRollupDay` on `Service`, replacing `fillLatencyRollups`. The read path stays unchanged.
- `src/start.ts`: create the runner after `server.listen` succeeded, and pass `now`. Remove `latencyRollup.stop()` from the listen-failure path. Shutdown still awaits `latencyRollup.stop()` before closing the DB.
- `src/latency.test.ts`: update the existing runner and `fillAllRollups` tests to the new API, delay and log lines, and add the tests below.
- `src/start.test.ts`: adjust any test that depends on the immediate first run, and add the "no rollup work before listen" test.
- `docs/operation.md`, `docs/concepts.md`: describe the delayed, batched, incremental backfill and its log lines. Keep the 1 M results timing note, worded as background work after start.

Behavior: as in "Scope" and "Required behavior" above.

Checks (all with `bun:test`, in-memory DB, fake `setTimeout`/`sleep`/`now`):
1. The first timer is at `startDelayMs` (default `LATENCY_ROLLUP_START_DELAY_MS` = 5 000). No fill call happens before it fires. In `start.ts`, no rollup timer exists before listen resolves.
2. Batching: one `fillLatencyRollupDay` per (check, day), with a `sleep(0)` after each. 2 checks with an empty table give 178 calls and 178 yields.
3. Incremental restart on a complete table, same UTC day: 0 fill calls, row count unchanged, log `latency rollup: backfill done, stored 0 days in <D> ms`. After midnight: exactly 1 day per check.
4. Read during a paused backfill stores a day. The runner then skips it (`false`), the total rows are 89 per HTTP check, and there are no duplicates.
5. Identical responses before, during (paused) and after the backfill for `/latency`, `/checks/:id/latency`, `slo` on `/checks` (and `/components` if present), as in "Counterexamples".
6. Logging: the start line, then the done line with count and integer ms duration from the injected clock. An hourly run with 0 days logs nothing. An hourly run with N > 0 logs one `stored N days in D ms` line.
7. Shutdown during the delay and during a paused batch, as in "Counterexamples". The existing shutdown tests still pass.
8. `fillLatencyRollupDay(check, today)` returns `false` and stores nothing.

Completion evidence:
- `bun run check` is green (lint, types, tests). `test_cpu_s` is within budget.
- Bench A/B in the PR (A = api main, B = the branch) shows `startup_cpu_ms` B <= 325 ms (near ~250 ms) and `startup_wall_ms` near ~475 ms. `load_cpu_s`, `idle_rss_mib` and `peak_rss_mib` are not FAIL.
- The PR description quotes the api log lines of a bench round: `latency rollup: backfill started (20 checks)` and `latency rollup: backfill done, stored 1780 days in <D> ms`. Both appear before the load window.
