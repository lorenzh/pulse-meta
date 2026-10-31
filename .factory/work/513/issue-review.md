# Issue review: #513 API: reads after each ingest re-aggregate all of today's results

Source: audit `audits/performance/2026-10-31-api.md`, finding `performance-api-2026-10-31-2` (P2), report PR #511.
Target: `api` only. The issue was verified on pulse-api `11f5555`. This review inspected pulse-api `main` at `21e7bdc` (`.repos/api`, `HEAD`), which already contains #512 (child #516, api PR #66: `uptime_daily`, uptime backfill, cold-read bench phase). The line numbers in the issue are from `11f5555` and have moved. The ones below are from `21e7bdc`.

## Current behavior (verified in the clone)

- **Read cache** (`src/service.ts:97`, `:437-456`). There is one map, `cache`, with a 5 s TTL (`CACHE_TTL_MS`), and its key includes the active maintenance windows. `invalidate()` replaces the whole map. Four places call it:
  - `upsertChecks` (`:927`)
  - every `ingest` (`:948`), which covers `POST /results`, heartbeat pings and generated expiry samples
  - `deleteExpiredResults` when it deleted rows (`:1155`)

  Under the bench load (30 POST/s) almost every read misses the cache.
- **Today's uptime tally.** `uptimeOf` (`:822-854`) calls `tallyResults(id, today*DAY_MS, t)` (`:831`). That is the `dailyUptime` `GROUP BY day` query over `results` (`:531`): `SUM(status != 'down')`, `COUNT(*)`, all locations, `late` rows included, `timestamp <= now`. It runs for every check on every uncached read. Closed days come from `closedTallies` and `uptime_daily` (from #512). `storeSample` (`:406-432`) bumps `uptime_daily` for a stored closed day (`:429`). Today never has a row.
- **Today's latency.** `latencyOf` (`:902-908`) calls `rollupOfDay(checkId, today)`. That is `dayLatencies` (`:551`): every `latency_ms` of today with `status != 'down'`, sorted. The day range is `[midnight, next midnight)`, so a row stamped up to 60 s in the future is already counted, unlike uptime. `late` rows are included. `summarizeLatencies` takes nearest-rank p50 and p95 (`src/latency.ts:19-29`). `latency_ms` is `REAL` (`src/db.ts:39`). The probe sends `monotonic()` differences (`probe/src/check.ts:107`), so the values are fractional and not bounded to a small set. Closed days come from `latency_daily`.
- **Who reads today.** More paths than the five routes in the issue read today:
  - `GET /checks`: `addSlos` calls `sloDays` → `uptimeOf(id, 30)`, which is cached per check under `slo:<id>` (`:911-923`). Every bench check has `availabilityTarget`.
  - `GET /uptime`: `computeUptime`.
  - `GET /latency` and `GET /checks/:id/latency`: `latencyOf`. The latter is measured by the bench (`p95_get_check_latency_ms`, budget 55).
  - `GET /components`: `getUptime` plus `getSloDays`.
  - `GET /components/uptime`: `getUptime`.
  - `GET /metrics`: `listChecks` and `componentBudgets(…, getSloDays)` (`src/start.ts:163-174`).
- **Other writers to `results`.**
  - `bench/seed.ts` and `bench/cold-read.ts` (`extraTodayRows`) insert rows straight into the file before the API starts.
  - Migrations dedupe rows.
  - A restored backup replaces the file.

  So any in-memory structure must be built from `results` at least once per process. It cannot rely only on ingests seen since the start.
- **Retention.** `PULSE_RETENTION_DAYS >= 90` (`src/retention.ts:8-11`), and the cutoff is a UTC midnight. Retention never deletes today's rows.
- **Ingest atomicity.** `ingest` runs in `transaction()`. In-memory side effects already wait for the commit (`trackLocation` after the transaction, `:1024`). A rolled-back result must not change an in-memory tally.
- **Bench.**
  - The load seed (`bench/seed.ts`) is 20 checks x 30 days x 1/min at location `default`. That is at most 1,440 rows per check today, and about 137 at the nightly cron 02:17 UTC.
  - The load phase sends 10 `GET /checks`, 1 `GET /uptime`, 1 `GET /latency` and 1 `GET /checks/:id/latency` per second, with 30 `POST /results` per second (`bench/load.ts`). `GET /components*` is not measured.
  - #512 added `extraTodayRows` (`bench/cold.ts`) and `--today-rows` in `bench/cold-read.ts`. They spread a target number of today's rows between UTC midnight and the seed's `now` at locations `sim1` and `sim2`, so a run at any hour can measure a late-day tally. This feature can reuse that helper.
  - Gating metrics are CPU and RSS: `load_cpu_s` 28.1, `peak_rss_mib` 115, `cold_read_cpu_ms` 390 (floor 30). The p95 wall metrics are reported only. `p95_get_checks_ms` (392) and `p95_get_latency_ms` (53) are **not gating**.
- **Docs that describe today's computation or the cache.** These must change:
  - `docs/concepts.md:100` and `:109`: "Today is computed from the results at every read (after the 5 s cache)."
  - `docs/operation.md:49`: "Today's part grows with the UTC hour …"
  - `docs/rest-api.md:199-201`: the "Read cache" section.
  - `bench/README.md:33`, `:35` and `:45`: the seed shape, and "`cold_read_cpu_ms` grows with the UTC hour".

  `src/docs-claims.test.ts` pins no sentence about today or the cache.

## Open points for the plan

1. **Selective invalidation alone does not reach the goal.**
   - `/checks`, `/uptime`, `/latency`, `/components*` and `/metrics` cover every active check. With results arriving for some check every ~33 ms, keeping per-check cache entries only moves the scan to the next read of that check.
   - What fixes it is an incremental or stored aggregate of today. Cache invalidation can stay as it is: the recompute becomes cheap.
   - Assumption: the plan keeps "a result is visible right after it is accepted" (`docs/rest-api.md:201`) and does not return stale answers after an ingest.
2. **Today's uptime tally: in memory or stored.** The plan picks one of these and states why:
   - (a) An in-memory `{good, total}` per check for today. It is built from `results` on first use in a process (one indexed scan of today) and then bumped after each committed insert.
   - (b) A `uptime_daily` row for today, bumped in the ingest transaction like the closed days.

   Constraints either way:
   - **Rows stamped after `now`.** Today's tally excludes rows with `timestamp > now` (`docs/rest-api.md:168`, "Results … after now are ignored"). A result may be up to `min(interval, 60 s)` ahead (`src/server.ts:94-104`). The plan keeps this, for example by subtracting the rows of `(now, next midnight)` with a small indexed range query, or by holding future rows until their time. Otherwise the parity check fails.
   - **Option (b) and existing code.** (b) breaks the invariant "today is never stored" that these rely on: `fillUptimeDay` (`:1140`), `missingUptimeDays`, `loadClosedDays`, and #512's tests and parity script. The plan lists what changes. The issue says to build on #512 "where it fits".
   - **Which results count.** Generated samples whose `at` moved across midnight (`:426-428`), repeats (`changes = 0`) and late results count exactly as the query counts them now.
3. **Today's latency percentiles: exact or approximate.** The issue lets the plan pick and requires it to say which, and why.
   - Exact nearest-rank needs every value of the day, because `latency_ms` is a fractional `REAL`. Suggested: an exact sorted array (for example a `Float64Array` with binary insertion) per HTTP check for today, built on first use from `dayLatencies` and updated after each committed insert of a non-`down` row.
   - Memory at the bench's end-of-day density is about 25,920 x 20 x 8 B ≈ 4 MB. That lies within `peak_rss_mib` 115, but the plan should measure it.
   - An exact structure keeps the parity check byte for byte. A quantile sketch (bounded, with a stated relative error) is the alternative only if the plan finds memory unacceptable. Then the stated error goes into `docs/concepts.md` and into the comparison.
   - Note: the contract says the percentiles are nearest-rank (`contract/src/schema.ts:652`). An approximation changes documented semantics, not the response shape.
4. **Building the structures on the first read after a start.** A per-process build of today repeats #512's cold cost for today. `cold_read_cpu_ms` (gating, 390 ms) and `cold_get_checks_ms` (200) were set with `--today-rows 288000`.
   - The build must stay lazy per route. `GET /checks` and `GET /uptime` must not also build the latency arrays, or the cold `GET /checks` gets slower and #512's budgets regress.
   - Alternatively, the plan stores today (option 2b) so a restart builds nothing.
   - The plan states the expected effect on the cold metrics.
5. **Day rollover.** At the first read or ingest after UTC midnight, today's structure becomes yesterday. Late results for yesterday must still reach `uptime_daily` exactly as now.
   - Yesterday's `latency_daily` row may be written from the in-memory array. It must equal what `rollupOfDay` would store: same rows, so late results that arrive before the write are counted, as now.
   - The rest of the old structure is released. Rows up to 60 s in the future may belong to the next day. They count toward the next day's structure, not today's.
6. **Check lifecycle.** Today's state is keyed by check id, like the query, and does not filter by type or active state.
   - A check that is removed and added again in the same day must not be counted twice.
   - A check that changes to or from `http` keeps matching the query (latency covers all non-`down` rows of the id today, whatever their type).
   - `upsertChecks` does not reset the structures.
7. **Bench seed at end-of-day density.** "A full UTC day at 3 locations x 10 s" means 25,920 rows per check today. The bench runs on the real clock: the nightly cron 17 2 is at 02:17 UTC, and the API has no clock injection. So a real full day of timestamps cannot exist at run time.
   - Suggested: the load seed (`bench/seed.ts`, through an option or by default in `run.ts`) adds today's rows up to 25,920 per check with `extraTodayRows`. That compresses them into `[midnight, now]`, as #512's `--today-rows` does.
   - The plan says whether the extra rows go into the load seed, which moves `load_cpu_s`, `peak_rss_mib`, `startup_cpu_ms` and the p95 metrics on both sides, or into a separate phase with new metrics. The acceptance criterion names the existing `p95_get_checks_ms` and `p95_get_latency_ms` budgets, so the load seed is the direct reading.
   - Every budget that moves is re-derived by the rule in `bench/README.md:76-78` (A median + ~30 %) and reported in the PR.
   - Near 00:00 UTC the span `[midnight, now]` may be too short for the rows per series, and `extraTodayRows` throws. The plan handles a run that starts just after midnight: skip with a log line, or use the previous day's span.
8. **What "fails on the current code" can show.** The p95 metrics do not gate, so a nightly `FAIL` only comes from a gating metric.
   - The acceptance criterion asks for "under budget on the bench runner, fails on current code (output in the PR)". A reported metric that is over budget on A and under on B satisfies that.
   - The plan decides whether to add a gating CPU-based metric, for example the API's CPU time over N `GET /checks` + `GET /latency` right after one ingest, so a regression shows as `FAIL`. This mirrors #512's `cold_read_cpu_ms`.
   - If it adds a metric, it adds an entry in `bench/budgets.json` (the self-test requires one) and a README row.
9. **Parity of responses.** All read paths that use today go into the comparison: `GET /checks` (including `slo`), `/uptime`, `/latency`, `/checks/:id/latency`, `/components`, `/components/uptime`, and the budget gauges of `/metrics`.
   - The comparison needs a fixed `now` and one database file, like `bench/uptime-parity.ts`, which can be extended or used as the model.
   - It also covers these sequences: after a series of ingests (incremental path), after a restart (build path), with a row stamped in the future, with a late row for today, and across a midnight rollover.
10. **Unit tests and `test_cpu_s`.** `bun test` is budgeted at 4.1 s CPU, so the end-of-day timing check belongs in `bench/`, not `bun test`. Unit tests cover correctness:
    - the incremental values equal the full query after mixed ingests, including down, degraded, late, repeated, future and generated samples
    - a rolled-back ingest changes nothing
    - midnight rollover
    - restart rebuild
    - no full scan of today on a read after an ingest, for example a query or row-count spy, or a check that `dailyUptime` and `dayLatencies` are not called for today
11. **Docs.** Update the files listed under "Current behavior". The cache section in `docs/rest-api.md` stays true if invalidation is unchanged; otherwise rewrite it. `docs/operation.md` gets new end-of-day numbers and the memory note, if the plan keeps state in memory. Update `bench/README.md` for the seed change and any new metric.

## Assumptions

- No contract change: the response shapes stay the same (non-goal), and exact percentiles keep the documented nearest-rank semantics.
- "End-of-day density" means 25,920 results per check today: 3 locations x one result per 10 s x 86,400 s. The audit says 20 checks, the bench's own load. Time compression into the elapsed part of today, as in #512, counts as "end of day" for the bench.
- "After an ingest" means a read right after one accepted `POST /results`, so the cache is cleared. The load phase does this all the time.
- The budgets in the acceptance criterion are those in `bench/budgets.json` at `21e7bdc`: `p95_get_checks_ms` 392 and `p95_get_latency_ms` 53. If the plan moves them because the seed changed, the PR shows the end-of-day B median under the old values, and A over them, before any new budget applies.
- Exact percentiles are the default. An approximation is acceptable only with a stated bound and a reason in the plan.
- Retention and closed-day storage (`uptime_daily`, `latency_daily`) stay as #512 left them, except for the rollover write in point 5, if the plan chooses it.

## Derived acceptance check

On pulse-api with the change, at 20 checks with 25,920 results per check today (the bench load seed plus `extraTodayRows`, or `--today-rows 518400` total):
1. After one `POST /results`, one `GET /checks` and one `GET /latency` each answer `200` well under 392 ms and 53 ms. Under the bench load, `p95_get_checks_ms` < 392 and `p95_get_latency_ms` < 53 on the bench runner. The same script or bench run on `21e7bdc` (A) shows `GET /checks` ≈ 350-420 ms and `GET /latency` ≈ 420-530 ms, at or over budget. Both outputs go in the PR.
2. Read cost after an ingest stays flat as today's rows grow. The PR reports per-route numbers at ~0 and at 25,920 rows per check today, for `/checks`, `/uptime`, `/latency`, `/checks/:id/latency`, `/components` and `/components/uptime`.
3. On one database file at a fixed clock, the JSON of these is identical between `21e7bdc` and the change:
   - `GET /checks` (with `slo`)
   - `/uptime`
   - `/latency`
   - `/checks/:id/latency`
   - `/components`
   - `/components/uptime`
   - the `/metrics` budget gauges

   It is identical after incremental ingests, after a restart, and across midnight, or within the stated percentile error if the plan chooses an approximation. The comparison output goes in the PR.
4. #512's cold-read metrics do not regress beyond their budgets: `cold_read_cpu_ms` 390, `cold_get_checks_ms` 200, `cold_get_uptime_ms` 190.
5. `bench/budgets.json` and `bench/README.md` list every budget that moves, with A and B medians. The docs listed above describe the new behavior.
6. CI green, `compose-e2e` green, `bun test` CPU within `test_cpu_s`.
