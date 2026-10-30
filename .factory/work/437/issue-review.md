# Issue review #437: api startup CPU tripled since the F8 latency rollup backfill

Target: api only. No contract, kit or status change. The responses of `/latency`, `/checks/:id/latency`, `slo` on `/checks` and `/components`, and `/metrics` keep their shape and values.

## Current behavior (api `main` 352ec49)

- `src/latency-rollup.ts` `startLatencyRollup` schedules the first run with `setTimeout(run, 0)` before `server.listen` in `src/start.ts`. Then it runs again every hour (`LATENCY_ROLLUP_INTERVAL_MS`, which tests shorten through `retentionIntervalMs`).
- One run is `fillAllRollups`. It calls `service.fillLatencyRollups(id)` once per active HTTP check and calls `sleep(0)` between checks. A check is one synchronous SQLite transaction over all its missing closed days. That is 89 days per check on an empty table, about 85 ms per check on the bench fixture, during which no request is served.
- The backfill is already incremental. `fillRollups` in `src/service.ts` computes only the closed days in the 90-day window that have no `latency_daily` row. Empty days get a `count: 0` row, so on a complete table a run writes 0 days. A restart on the same UTC day therefore does no rollup work apart from one `SELECT` per check.
- The read path already fills days on demand. `latencyOf` calls `fillRollups`, which computes and stores every missing closed day of the checks it reads (`INSERT OR IGNORE`), and computes today live. So a read during a backfill is already correct. On an empty table the first cold `GET /latency` computes all 1 780 days inside that one request.
- SLO (`sloDays` / `uptimeOf`) reads only `results`, never `latency_daily`, so the backfill cannot change it.
- `p50_ms` and `p95_ms` are `REAL`, so a stored rollup equals the one computed on the fly.
- Logging: one line per run, `latency rollup: stored N days`, and only when N > 0. There is no start line and no duration.

## How the bench measures it (`bench/stack.ts`, `bench/README.md`)

- Each round copies a freshly seeded DB: 20 checks, 30 days of 1-minute results, and an empty `latency_daily`. Every bench start therefore backfills 20 × 89 = 1 780 days, which is the log line quoted in the issue. **Making the backfill incremental cannot move the bench numbers. Only moving the backfill out of the startup measurement can.**
- `startup_cpu_ms` is read by `docker exec … cat /proc/1/stat` after the first `200` of `/readyz`. Any backfill CPU spent before that `docker exec` returns is counted, even if `/readyz` itself never waited. Starting the backfill right after `listen`, as it does today, is not enough. It has to start clearly later than the CPU sample.
- After the sample come: probe, status and notify start, then 30 s idle (`idle_rss_mib` is sampled at the end), then 20 s warm-up, then the 60 s measured window (`load_cpu_s`). The backfill should finish inside the idle 30 s. If it runs into the measured window, `load_cpu_s` gets worse and the acceptance check fails.

## Open points (for the spec, none blocking)

1. **Start trigger.** The issue offers "after the server is ready, in small batches" or "on first use per check". A pure lazy fill would move the 1 780-day compute into the first `GET /latency` of the bench warm-up. That gives a slow first request and does not fill rollups for checks nobody reads. Recommendation: keep the background runner and the existing read fallback. Start the first run only after `listen` succeeded, with a delay of a few seconds (a named constant, injectable for tests). Keep the hourly cadence after that.
2. **Batch size and pacing.** Today the unit is a whole check (89 days in one transaction). The spec should set a small unit, for example one day per transaction with a yield to the event loop after each batch. Pacing must stay bounded: 1 780 batches with, say, a 50 ms sleep each would take about 90 s and run into the bench load window. Yield with `sleep(0)` or `setImmediate`-like pacing, not long sleeps. The whole fixture backfill should end well inside the 30 s idle phase.
3. **Read during a backfill.** Two choices are both correct: keep the current fallback (a read computes and stores the missing days of the checks it reads), or compute without storing. Recommendation: keep the current fallback. `INSERT OR IGNORE` already makes the runner and a read writing the same day harmless. The spec should state that the backfill skips days that a read already stored.
4. **Logging "once".** Our reading of the request: the first (startup) run logs one start line and one end line, with days computed and duration in ms, also when it computed 0 days. Hourly runs keep the single line and only log when they wrote days (add the duration there too). No per-batch logging. Measuring duration needs an injected `now` in `LatencyRollupDeps`.
5. **Shutdown.** `stop()` must still end within one batch, and the start delay must be cancelled. With smaller batches this gets faster, not slower. The existing shutdown tests have to keep passing.
6. **"First SLO read ~0.4 s".** This is a request-path cost of SLO on `GET /checks`, not startup work. Nothing at startup reads SLO before the bench's CPU sample. It is out of scope here. The SLO test only asserts that SLO values do not change while a backfill runs.
7. **Docs.** `docs/operation.md` (and `docs/concepts.md` if it mentions it) describes the startup backfill. Update the text to say the backfill starts after readiness, the batching, and the log lines.
8. **Bench budgets.** No change to `bench/budgets.json`. The goal is to get back under the existing 325 ms budget, not to raise it.

## Assumptions

- The pre-F8 values (~250 ms CPU, ~475 ms wall) are the reference for "back near". Passing means B is under the 325 ms gating budget and not a regression against A.
- Late results for an already rolled-up closed day still do not change the rollup (F8 rule, unchanged). The "identical before, during and after" test therefore posts no results for closed days between its reads.
- "Restart with complete rollups computes 0 days" holds for a restart on the same UTC day. After midnight, one new closed day per check is expected work. The test fixes the clock.
- Retention of rollups and the hourly interval stay as they are.

## Derived acceptance check

1. Unit and service tests in api (`bun run check` green, with fake clock and timers):
   - Startup: no rollup work runs before the server listens and `/readyz` answers 200. The first run starts only after the configured delay (fake `setTimeout`).
   - Incremental: start on a DB whose `latency_daily` is complete for the window, with the same UTC day → the run computes 0 days (asserted from the return value or log line, and no `INSERT`).
   - Batching: one batch never covers more than the configured unit (for example one day), and the runner yields between batches.
   - Correctness: inject a slow, controllable backfill that is paused halfway. `GET /latency`, `GET /checks/:id/latency`, and the `slo` on `GET /checks` / `GET /components` are deep-equal before the backfill, while it is paused, and after it ends (cache cleared between reads).
   - Logging: the startup run logs exactly one start line and one end line with the days computed and the duration.
   - Shutdown during the delay or during a batch ends cleanly. The DB closes only after the batch in progress.
2. Bench A/B (A = api main 8ea397c or later, B = the PR): `startup_cpu_ms` B ≤ 325 ms (near ~250 ms). `startup_wall_ms` near ~475 ms. `load_cpu_s`, `idle_rss_mib` and `peak_rss_mib` not FAIL. The api log of a bench round shows the backfill start and end lines, with 1 780 days, before the load window.
