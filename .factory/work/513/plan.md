# Spec #513: API reads after each ingest re-aggregate all of today's results

Source: audit `audits/performance/2026-10-31-api.md`, finding `performance-api-2026-10-31-2` (P2), report PR #511. Issue review: `.factory/work/513/issue-review.md`.

Base: pulse-api `main` at `21e7bdc`. It already contains #512 (child #516, api PR #66: `uptime_daily`, uptime backfill, cold-read bench phase, `extraTodayRows`). Line numbers below are from `21e7bdc`.

## Goal

Reads after an accepted result cost about the same at the end of a UTC day as at its start. Today's uptime tally and today's latency percentiles are kept per check in memory. They are built once from `results` and then updated after each committed insert. Reads no longer re-read all of today's rows after every ingest. Responses stay byte-identical: percentiles stay exact.

## Current behavior (verified in `.repos/api` at `21e7bdc`)

- **Cache.** `invalidate()` (`src/service.ts:437-440`) replaces the whole read cache on every `ingest` (`:948`), on `upsertChecks` (`:927`) and on a retention delete that removed rows (`:1155`). Under the bench load (30 POST/s) almost every read misses the cache.
- **Today's uptime.** `uptimeOf` (`:822-854`) runs `tallyResults(id, today*DAY_MS, t)` (`:831`) on every uncached read. That is the `dailyUptime` statement (`:531-536`): `SUM(status != 'down')`, `COUNT(*)`, all locations, `late` rows included, `timestamp <= now`. Callers are `computeUptime` (`/uptime`, and `/components*` through `getUptime`) and `sloDays` (`:911-912`: `/checks` `slo`, `/components` `slo`, `/metrics` budget gauges in `src/start.ts:163-174`).
- **Today's latency.** `latencyOf` (`:902-908`) runs `rollupOfDay(checkId, today)`. That is `dayLatencies` (`:551-555`): every `latency_ms` with `status != 'down'` in `[midnight, next midnight)`, so rows up to 60 s in the future are included, and `ORDER BY latency_ms`. Then `summarizeLatencies` takes nearest-rank p50 and p95 (`src/latency.ts:19-29`). Callers are `/latency` and `/checks/:id/latency`.
- **Writers of `results` while the process runs.** Only `storeSample` inside `ingest` inserts (`:406-432`, `:497-500`). `deleteExpired` (`:573-581`) deletes only rows before the retention cutoff, a UTC midnight at least 89 days ago (`src/retention.ts:16-18`), so it never touches today. The dedupe migration (`src/migrations.ts:56`) runs at open. A restore replaces the file only while the API is stopped (`docs/operation.md:105-109`). So an in-memory structure that is built from `results` once per process and then fed by committed ingests matches the query.
- **Bench.** The load seed is 20 checks x 30 days x 1/min at location `default` (`bench/seed.ts`, `bench/run.ts:132`). At the 02:17 UTC nightly that is about 137 rows per check of today. `p95_get_checks_ms` (392) and `p95_get_latency_ms` (53) are reported, not gating (`bench/budgets.json`, `bench/README.md:23-26`).

## Decisions

1. **In memory, not stored.** Today's state is kept in memory per process. `uptime_daily` and `latency_daily` keep #512's invariant "today is never stored". So `fillUptimeDay`, `missingUptimeDays`, `loadClosedDays`, `fillLatencyRollupDay` and #512's tests and `bench/uptime-parity.ts` stay valid unchanged. A stored row for today would need a second write path for rows stamped after now, and it would change those invariants for no read gain: the in-memory build costs one indexed range query per check, which is what every read costs today.
2. **Exact percentiles.** `latency_ms` is a fractional `REAL` (`src/db.ts:39`). Exact nearest-rank needs every value of the day. Memory is 8 bytes per non-`down` result of today per HTTP check. At the bench's end-of-day density (20 checks x 25,920) that is 4.1 MB, at most 8.3 MB with capacity doubling, against `peak_rss_mib` 115. For a deployment it is `locations x 86,400,000 / intervalMs x 8 B` per HTTP check: 207 KB per check at 3 locations x 10 s. The responses stay byte-identical, the documented nearest-rank semantics stay (`contract/src/schema.ts:652`, api `docs/concepts.md:107`), and the parity check stays strict. A sketch would add a stated error to a contract-documented statistic. That cost is only justified when memory is unacceptable, and it is not.
3. **Cache invalidation stays as it is.** The recompute after an ingest becomes cheap. Every ingest still clears the whole cache, so "a result is visible right after it is accepted" (`docs/rest-api.md:201`) still holds.
4. **The end-of-day case gets its own bench phase, not a denser load seed.** In the load phase, side A (old code) at 518,400 rows of today would need about 350-420 ms of CPU per `GET /checks` at 10 requests per second. The single-threaded api then saturates: requests queue for the whole 80 s and the run measures the backlog, not the route. That is why the load seed and its budgets stay unchanged. A new phase `eod` seeds the end-of-day density and measures each read right after one ingest, in a fixed number of sequential cycles. It runs nightly in every round on both sides, after the cold-read phase. It adds one gating CPU metric, so a regression shows as `FAIL`.

## Scope

- api: today's uptime tally and latency array in memory, updated after commit. Unit tests. Bench phase `eod` with metrics and budgets, a standalone `bench/eod-read.ts`, a parity script `bench/today-parity.ts`, and doc updates.

## Non-goals

- No change to retention, to `uptime_daily` / `latency_daily` contents, to the closed-day backfills, or to any public response shape or value.
- No change to the read cache's TTL or invalidation rules.
- The rollover write of yesterday's `latency_daily` row stays as it is: it is computed from `results` by `fillRollups` / the backfill once per check and day. It is not written from the in-memory array.
- No change to the load phase seed, load rates or their budgets.

## Required behavior (api)

### Today's state

A per-check record, keyed by check id. It has no type or active filter, like the queries.

- `uptime`: `{ day, good, total }`. It counts **every** stored row of the check with `timestamp` in `[day*DAY_MS, (day+1)*DAY_MS)`: all locations and statuses, `late` included. `good` counts `status != 'down'`.
- `latency`: `{ day, values }`. `values` is an ascending `Float64Array` (with a length and spare capacity) of `latency_ms` of every stored row of the check with `status != 'down'` in the same range.

**Build (lazy, per kind).**
- `uptimeOf` builds `uptime` for a check when there is none or its `day != today`. It uses one statement: `SELECT SUM(status != 'down') AS good, COUNT(*) AS total FROM results WHERE check_id = ? AND timestamp >= ? AND timestamp < ?` with `(today*DAY_MS, (today+1)*DAY_MS)`. A `NULL` sum is 0.
- `latencyOf` builds `latency` the same way from the existing `dayLatencies` statement.
- `GET /checks`, `GET /uptime`, `/components*` and `/metrics` never build `latency`. Ingest never builds anything: it only updates records that exist.

**Read.**
- Today's uptime tally at time `t` is `uptime` minus the rows of the check in `(t, (today+1)*DAY_MS)`. That is the same statement with bounds `(t + 1, (today+1)*DAY_MS)`. It is a range of at most 60 s (`src/server.ts:94-98`) on the index `results_by_check (check_id, timestamp DESC, id DESC)` (`src/db.ts:46`). This keeps "results … after now are ignored" (`docs/rest-api.md:168`).
- A result of `total == 0` is treated exactly like the missing `fresh.get(today)` entry today: `uptime: null`, `results: 0`.
- Today's latency rollup is `{ p50Ms: nearestRank(values, 50), p95Ms: nearestRank(values, 95), count: length }`. `nearestRank` / `summarizeLatencies` in `src/latency.ts` accept `ArrayLike<number>` and keep their rank rule `max(1, ceil(p*n/100))`.

**Update after commit.**
- `ingest` collects, for each row that `storeSample` stored (`changes > 0`), the triple `(day of the stored timestamp, status, latency_ms)`. The stored timestamp is `at - 1` (`:426-428`), so a generated sample moved across midnight belongs to its new day.
- After `transaction()` returns, the triples are applied in the same place as `trackLocation` (`:1024`):
  - `uptime.good += status != 'down'` and `uptime.total += 1` when a record exists and its `day` equals the triple's day.
  - The value is inserted into `latency.values` at its sorted position (binary search, then `copyWithin`; grow capacity by doubling) when a record exists, its `day` matches and `status != 'down'`.
  - Triples of any other day are dropped: closed days go to `uptime_daily` as now, and a row of the next day is in `results` when that day's record is built.
- A rolled-back transaction applies nothing. A repeat (`changes == 0`) applies nothing.

**Day rollover and lifecycle.**
- A record whose `day != today` at a read is rebuilt. At the first build of a new day, records of older days of all checks are dropped, which releases the memory.
- `upsertChecks` does not touch the records: a check removed and added again on the same day keeps one record, and its rows are counted once, as by the query.
- A check that changes type keeps its record.

**Invariant, documented in code.** Only `ingest` writes today's rows while the process runs. A future writer of `results` must update or drop the records.

### Unchanged

- The cache (`cached`, `invalidate`), the closed-day paths, `fillRollups`, `fillUptimeDay`, `fillLatencyRollupDay`, retention, and every response shape.
- `listChecks` still reads `latestPerLocation` per check. That cost does not depend on today's row count.

### Tests (`bun test`)

Small data only: at most a few thousand rows per test, so `test_cpu_s` (4.1 s) holds. New files `src/today.test.ts` (sorted array, pure) and `src/service.today.test.ts`. They prove:

1. **Parity with the full query** after a mixed sequence on one check and two locations. The sequence has `up`, `degraded`, `down`, a late row for today, a repeated sample (`ingest` returns `false`), a generated sample that collides and moves by 1 ms, and a row stamped `now + 30000`. Expected values come from a second `createService` on the same file whose first read builds from `results`. The test also asserts literal counts: the expected `results` of today and `count` are written out in the test.
2. **Future row:** right after ingesting a row stamped `now + 30000`, today's `results` in `getUptime()` does not include it, while `getLatency()` `count` does (the latency range is `[midnight, next midnight)`, as now). After the clock passes the stamp, `results` includes it.
3. **Rollback:** a test trigger `CREATE TRIGGER … BEFORE UPDATE ON checks BEGIN SELECT RAISE(ABORT, 'x'); END` makes `ingest` throw after `storeSample`. The trigger is dropped, then `getUptime()` and `getLatency()` equal their values before the failed ingest.
4. **Rollover:** clock at 23:59:30. A result stamped 00:00:10 of the next day is accepted with the 60 s skew. At 23:59:40, today excludes it from both. After the clock moves to 00:01, today is a new day: `results` 1 and `count` 1. Yesterday's closed-day values equal a fresh service's values.
5. **Restart:** a new service on the same file returns the same JSON as the old one after ingests.
6. **No re-read after ingest:** build with one read, ingest one result, then delete today's rows up to `now` directly with `db.run("DELETE FROM results WHERE check_id = ? AND timestamp <= ?")`, bypassing the service. Today's `results` and `count` still equal the built values + 1. The full query would return about 0, so a wrong implementation fails.
7. **Laziness:** after `getUptime()` and `listChecks()` only, the latency record of no check exists (assert through a test-only accessor, or through a spy on `dayLatencies` that is not called).
8. **Sorted array:** inserting values in random order (fixed seed) yields `nearestRank` equal to sorting a plain array, including ties, `0` and fractional values. Example: `[10, 20, 30, 40]` gives p50 20 and p95 40, written literally.

### Bench (`bench/`)

**Seed of the phase.** The 1x load seed of the side (`.bench/seed/<side>/pulse.db`) is copied into the run directory. Then `extraTodayRows` (`bench/cold.ts`) adds rows at `sim1` and `sim2` until today holds at least `EOD_TODAY_ROWS = 518_400` rows: 20 checks x 25,920. That is 3 locations (`default`, `sim1`, `sim2`) x one per 10 s x 86,400 s, compressed into `[midnight, now]`. The insert is the one in `bench/cold-read.ts:152-175`, moved to a shared helper in `bench/cold.ts` or `bench/eod.ts`.

**Near midnight.** When the UTC time at seeding is before 00:10:00, the phase logs `eod: waiting until 00:10 UTC so today's rows fit` and waits. If the UTC day changes between seeding and the last cycle, the phase logs it and repeats once from seeding. A second change is a harness error (exit 2).

**Checks file of the phase.** The bench checks (`bench/fixtures.ts` `checksFileJson`) plus two components, `first` (checks 0-9) and `second` (checks 10-19). They are the same as `bench/uptime-parity.ts:63-66`, so `/components*` do real work.

**Procedure** (`runEodReads(target, log)` in `bench/eod.ts`, used by `bench/stack.ts` through `composeTarget` and by `bench/eod-read.ts` through a child-process target, like the cold-read phase):

1. Start the api only, wait for `/readyz`. Send one warm read of each measured route: `GET /checks`, `/uptime`, `/latency`, `/checks/bench-0/latency` (first id of `checkIds()`), `/components`, `/components/uptime`. Then wait for the settle rule of `bench/cold.ts` (`isSettled`, max 300 s).
2. Read the api CPU time. Run `EOD_CYCLES = 20` cycles. Each cycle sends one `POST /results` with the token of `benchTokens().simulated[1]` (location `sim1`), check `ids[i % 20]`, `timestamp: Date.now()` (strictly increasing, +1 when equal), `status: "up"`, `latencyMs: 5 + i`, and expects `204` as `bench/load.ts:219`. Then it sends the six routes one after another and records the wall time of each. Every response must be `200` (a route that A lacks: see below). Read the CPU time again.
3. Emit:
   - `eod_get_checks_ms`, `eod_get_uptime_ms`, `eod_get_latency_ms`, `eod_get_check_latency_ms`, `eod_get_components_ms` and `eod_get_components_uptime_ms`: the nearest-rank p95 of the 20 samples of that route, which is the 19th smallest. Reported.
   - `eod_read_cpu_ms`: the api CPU time in ms over the 20 cycles (the POSTs included), rounded. Gating.
   - The log: the UTC time, the rows of today, and the api `VmRSS` after the cycles.

**Routes A lacks.** Add `/components` and `/components/uptime` to `OPTIONAL_ROUTES` (`bench/load.ts:48-51`) with the api commit that added `GET /components/uptime`. The implementer finds it with `git log --diff-filter=A` / `git log -S '"/components/uptime"' -- src/server.ts` on a full clone and cites it. The load phase keeps requesting only its four streams. In the phase, a route missing on A is not requested on A, and its metric is `not available on A` through the existing `missingOnA` path (`bench/run.ts:191-196`). The latency routes use the same mechanism.

**Wiring.** `bench/run.ts` runs the phase after the cold-read phase per round and side (`bench/run.ts:200-203`) in its own run directory `run-eod/<side>`. It adds the seven keys to `EMITTED_METRICS.api` (`bench/compare.ts:38-56`) and their entries to `bench/budgets.json`.

**`bench/eod-read.ts`.** Usage: `bun bench/eod-read.ts --api <worktree> [--seed-with <worktree>] [--today-rows 518400] [--cycles 20] [--checks-limit-ms 392] [--latency-limit-ms 53]`. It runs the phase without Docker, like `bench/cold-read.ts`: it seeds a temp 1x database with this `bench/seed.ts`, adds today's rows, runs `bun <api>/src/main.ts` as a child process, and reads CPU and `VmRSS` from `/proc/<pid>`. It prints one JSON object with the seven metrics, the median of each route, `vm_rss_mib`, `utc_start`, `seed_now_ms`, `today_rows`. It exits `1` when `eod_get_checks_ms >= --checks-limit-ms` or `eod_get_latency_ms >= --latency-limit-ms`, and `2` on an error.

**`bench/today-parity.ts`.** Usage: `bun bench/today-parity.ts <worktree A> <worktree B> <seed db> <now ms>`. `<seed db>` is a 1x seed made with `bun bench/seed.ts <A> <db> 1 <now>`. `<now>` must be at least 10 min after a UTC midnight. The script copies the seed once per side and adds the 518,400 rows of today at `now` to each copy. It loads `src/db.ts`, `src/service.ts` and `src/components.ts` of each worktree, as `bench/uptime-parity.ts:48-59` does. Each side gets a mutable clock `now()` and the same inputs, and the script writes one JSON output per step:
1. first read (build path);
2. after a fixed ingest sequence: `up`, `degraded`, `down`, a late row for today, a repeat, a generated sample (`ingest(r, true)`) on an occupied timestamp, and a row stamped `now + 30000`;
3. a new service on the same file (restart);
4. the clock advanced by 40 s (the future row now counts in uptime);
5. one ingest stamped 10 s after the next UTC midnight while the clock is still before it, then the clock moved to the next UTC midnight + 60 s (rollover).

Each output is the JSON of these:
- `listChecks()` in full (incl. `slo` and `locations`)
- `getUptime()`
- `getLatency()`
- `getCheckLatency(id)` for every HTTP check
- `componentsUptime(COMPONENTS, uptime)`
- `componentsWithState(…)` with the arguments `src/server.ts:644-655` passes
- `componentBudgets(COMPONENTS, getSloDays)`

The script prints the sha256 of every output and exits `1` when a B output differs from A's output of the same step. Exit `2` means an error.

`bench/selftest/check-eod.ts` (added to `bench:selftest` in `package.json:18`) covers the pure parts:
- The p95 of 20 samples is the 19th smallest: `[1..20]` gives 19.
- The near-midnight wait decision: 00:09:59 waits, 00:10:00 does not.
- The limit check of `eod-read.ts`: 392 exits `1`, 391.9 does not.
- The checks file of the phase has 2 components with 10 checks each.

## Performance impact

Metrics of `bench/budgets.json` (api) that the change can move:

- `eod_get_checks_ms`, `eod_get_latency_ms`, `eod_get_uptime_ms`, `eod_get_check_latency_ms`, `eod_get_components_ms`, `eod_get_components_uptime_ms` (new, reported) and `eod_read_cpu_ms` (new, gating). Expected:
  - on A (`21e7bdc`): `GET /checks` about 344-418 ms and `GET /latency` about 419-529 ms (audit numbers), so `eod_read_cpu_ms` is around 20 x (0.9-1.2 s) ≈ 20 s;
  - on B: each read near its bench-seed value (`GET /checks` about 4 ms, `GET /latency` about 5 ms) plus 20 small range queries per read, and `eod_read_cpu_ms` well under 1 s.

  Budgets are B medians of the hosted A/B run + 30 %, rounded up. This deviates from the "A median" rule in `bench/README.md:78`, because A is the code being fixed; the README says so. The budgets of `eod_get_checks_ms` and `eod_get_latency_ms` are at most 392 and 53.
- `cold_get_uptime_ms` and `cold_read_cpu_ms`: down. The cold `GET /uptime` reuses today's tally that the cold `GET /checks` built, instead of scanning today again. `cold_get_checks_ms`: unchanged. It runs one whole-day aggregate per check, the same scan as now, plus the small future range. No budget moves.
- `p95_get_checks_ms`, `p95_get_latency_ms`, `p95_get_check_latency_ms`, `load_cpu_s`: slightly down, because the load seed has only about 137 rows per check of today at 02:17 UTC. Within noise. No budget moves.
- `peak_rss_mib`: up by less than 1 MiB in the load phase (about 140 rows x 20 checks x 8 B plus the records). Expected +4-9 MiB in the `eod` phase, logged as `VmRSS`, not a budget.
- `startup_cpu_ms`, `idle_rss_mib`, `startup_wall_ms`, `image_mb`, `rps`, `p95_post_results_ms`: unchanged. The build is lazy, and ingest adds at most a binary search and one `copyWithin` of up to 25,920 doubles.
- `test_cpu_s`: up by at most 0.3 s from the new small tests. It stays under 4.1.
- The bench run gets longer, by about 20 s per A run (20 cycles at about 1 s) plus seeding (about 3 s) and settle per run. The implementer updates the "plan on" time in `bench/README.md` with the measured duration. `bench.yml` keeps `timeout-minutes: 90` (`.github/workflows/bench.yml:32`).

Measure with:
- `bun bench/eod-read.ts --api <A worktree at 21e7bdc>` and `--api <B worktree>` on one machine;
- `bun bench/cold-read.ts --api <worktree> --density 10 --today-rows 288000` for A and B;
- the hosted A/B: `gh workflow run bench.yml -f a=21e7bdc -f b=<branch>` (inputs `a`, `b`: `.github/workflows/bench.yml:8`, `bench/README.md:61`).

## Security impact

Security impact: no
The change is internal aggregation in `src/service.ts` and `src/latency.ts` plus bench scripts and docs. It touches no route, auth, parser, probe client, file write path, dependency, Dockerfile or CI workflow.

## Rollout order

One repository: only pulse-api changes. Its HTTP responses are byte-identical, so the status page, probes and notify on any pin keep working.

## Counterexamples

- **Future rows.** Today's uptime excludes rows with `timestamp > now`. Today's latency includes them, because its range is `[midnight, next midnight)`, as at `21e7bdc`. A tally that just adds every ingest shows `results` +1 right after a result stamped `now + 30000`. The counterexample test 2 and parity step 2 reject that.
- **Uptime statistic.** For a check and UTC day `d` at time `t`, the sample set is every stored row of the check, any location, `late` included, with `d*86400000 <= timestamp <= min(t, (d+1)*86400000 - 1)`. `uptime = good / total * 100` with `good = count(status != 'down')`, unrounded. `null` with `results: 0` when `total = 0`. Example: 3 `up`, 1 `degraded`, 1 `down` gives 80. A rule that drops `degraded` or `late` is wrong.
- **Window uptime.** The 90- and 30-day `uptime` / `availability` sum `good` and `total` over the days. Per-day percentages are never averaged. Example: day 1 has 1 of 1 good and day 2 has 0 of 3. Result-weighted that is 25; averaging the days would give 50, which is wrong.
- **Latency statistic.** For a check and UTC day `d`, the sample set is `latency_ms` of every stored row with `status != 'down'` (`up` and `degraded`, any location, `late` included) and `d*86400000 <= timestamp < (d+1)*86400000`. Percentile `p` is nearest-rank: the value at 1-based index `max(1, ceil(p*n/100))` of the ascending values, no interpolation, no rounding. `null` for `n = 0`. Examples: `[10, 20, 30, 40]` gives p50 20 and p95 40. `[1..20]` gives p95 19. Percentiles of locations or days are never averaged or merged; each is computed from its sample set. A `down` result with `latencyMs: 9999` must not change p95.
- **Repeats.** A re-sent sample (`changes = 0`) counts zero times. An implementation that bumps before checking `changes` counts it twice.
- **Generated samples.** A heartbeat expiry sample stored at `at + k` (`:411-425`) counts once, in the day of its stored timestamp. A sample generated at `23:59:59.999` that moves to `00:00:00.000` belongs to the next day, not today.
- **Rollback.** An ingest whose transaction rolls back after the insert, for example a failing `updateState`, changes no tally. An implementation that bumps inside the transaction fails test 3.
- **Restart.** After a restart the first read builds from `results`. An implementation that starts from zero and counts only ingests seen since start shows `results` near 0 at the first read after a restart. Parity step 3 rejects that.
- **Rollover.** At the first read after UTC midnight, today must not carry yesterday's counts. Yesterday's `uptime_daily` row is filled from `results` as now. Test 4 and parity step 5 reject a record that keeps `day` stale.
- **Re-added check.** A check removed and re-added on the same day counts its rows once. Resetting or doubling the record on `upsertChecks` is wrong.
- **Stale cache.** A read right after an accepted result shows that result: `results` +1 for a past-or-now stamp. Selective invalidation that keeps `uptime` cached across an ingest is wrong.
- **Bench p95.** The p95 of 20 samples is the 19th smallest, not the mean of the top two and not the max.

## Contract fields

No new contract fields, routes, response keys, env variables or config keys. New names are bench metric keys and files in pulse-api only:

- `eod_get_checks_ms`, `eod_get_uptime_ms`, `eod_get_latency_ms`, `eod_get_check_latency_ms`, `eod_get_components_ms`, `eod_get_components_uptime_ms`, `eod_read_cpu_ms`
- `EOD_TODAY_ROWS`, `EOD_CYCLES`, `runEodReads`
- `bench/eod.ts`, `bench/eod-read.ts`, `bench/today-parity.ts`, `bench/selftest/check-eod.ts`, `src/today.ts`, `src/today.test.ts`, `src/service.today.test.ts`

Searches, each run in this planning run with no output:
- `grep -rn -i 'eod' .repos/contract/src .repos/config --include=*.ts --include=*.json -l`
- `grep -rn -E 'eod_|eod-read|today-parity|runEodReads|EOD_' .repos/contract/src .repos/config .repos/api/src .repos/api/bench`
- `ls .repos/api/src/today.ts .repos/api/bench/eod.ts` reports no such file.

## Repository: api

Files:
- `src/service.ts`: today's records, build, read, update after commit
- `src/today.ts` (new): sorted `Float64Array` with insert, plus the record types
- `src/latency.ts`: `nearestRank` / `summarizeLatencies` accept `ArrayLike<number>`
- `src/today.test.ts` (new), `src/service.today.test.ts` (new)
- `bench/eod.ts` (new): phase constants, seed helper, `runEodReads`, p95, limit and wait helpers
- `bench/eod-read.ts` (new)
- `bench/today-parity.ts` (new)
- `bench/cold.ts`, `bench/cold-read.ts`: share the today-rows insert helper
- `bench/fixtures.ts`: checks file of the phase with two components
- `bench/load.ts`: `OPTIONAL_ROUTES` adds `/components` and `/components/uptime`
- `bench/stack.ts`: `runEodStack`
- `bench/run.ts`: run the phase and add its samples
- `bench/compare.ts`: `EMITTED_METRICS.api` adds the seven keys
- `bench/budgets.json`: seven entries
- `bench/selftest/check-eod.ts` (new)
- `package.json`: `bench:selftest` runs `check-eod.ts`
- `bench/README.md`, `docs/concepts.md`, `docs/operation.md`, `docs/rest-api.md`

Behavior change: yes
Reads compute today from an in-memory, incrementally updated state instead of re-reading today's results, and the bench gains a gating phase.

### Behavior

As in "Required behavior (api)" above. If `main` already keeps today's state incrementally, request a hold instead of a review.

### Docs

- `docs/concepts.md:100`: replace "Today is computed from the results at every read (after the 5 s cache)." The new text says: today's tally is kept per check in memory, built from today's results at the first read in a process or a new UTC day, then updated after every stored result; results stamped after now are left out at read time.
- `docs/concepts.md:109`: the same for latency. The sorted latencies of today are kept per HTTP check, so the percentiles stay exact nearest-rank. The first latency read of a process or day reads today's results once.
- `docs/operation.md:49`: replace "Today's part grows with the UTC hour …" with the build-once cost, the measured end-of-day numbers per route (A and B from `eod-read.ts`), and the memory note: 8 bytes per non-`down` result of today per HTTP check, 4.1 MB at 20 checks x 25,920.
- `docs/rest-api.md:199-201`: the invalidation rules stay. Add that recomputing after an ingest no longer re-reads today's results.
- `bench/README.md`:
  - the metrics table gets the seven rows;
  - a new section "The end-of-day phase" covers the seed, procedure, near-midnight rule, `eod-read.ts` and `today-parity.ts`;
  - line 45: the first cold read still builds today's tally from the results, so `cold_read_cpu_ms` still grows with the UTC hour, but the cold `GET /uptime` reuses it;
  - the "plan on" duration;
  - in "Changing a budget" / "Initial budgets": the `eod_*` budgets come from B medians and why.

### Tool facts (verified)

- Runtime Bun 1.4.0: `package.json:9` (`engines.bun`), `package.json:35` (`packageManager`). CI installs Bun 1.4.0 (`.github/workflows/ci.yml:25-27`). The pinned `check.yml` does the same (`lorenzh/pulse-config` `.github/workflows/check.yml@51e95b0`, lines 22-24).
- Tests: `bun test` (`package.json:15`). Coverage is on, with a line threshold of 0.8 (`bunfig.toml:2-3`), so the new code in `src/today.ts` and `src/service.ts` needs test coverage.
- Lint: `biome check . && pulse-eslint .` (`package.json:16`), Biome `2.6.3` (`package.json:23`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. At the pinned ref `51e95b0` (`package.json:24`) its `files.includes` is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures` (lines 10-17), with line width 100 (line 23). So `bench/` and `src/` are linted. The pinned file is identical to the config clone.
- Typecheck: `bun node_modules/typescript7/bin/tsc --noEmit` (`package.json:14`).
- CI:
  - `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` (`ci.yml:17`). At that ref it runs install, `bun run lint`, `bun run typecheck` and `bun run test` (pinned `check.yml` lines 25-38, identical to the clone).
  - `bench-selftest` runs `bun run bench:selftest` and `docker compose -f bench/compose.bench.yaml config --quiet` (`ci.yml:29-30`).
  - `compose-e2e` runs `bash scripts/compose-e2e.sh` (`ci.yml:55`).

### Acceptance evidence (in the PR)

1. **End-of-day reads, fail on A, pass on B.** On one machine:
   - `bun bench/eod-read.ts --api <worktree at 21e7bdc>` exits `1`;
   - `bun bench/eod-read.ts --api <B worktree>` exits `0`, with `eod_get_checks_ms < 392` and `eod_get_latency_ms < 53`;
   - both at `today_rows >= 518400` (literal limits from the issue).

   Both JSON outputs go in the PR. The hosted run is also linked: `gh workflow run bench.yml -f a=21e7bdc -f b=<branch>`, with the table showing B's `eod_get_checks_ms` and `eod_get_latency_ms` medians under 392 and 53. If the implementer cannot dispatch the workflow, the PR says so, and a person runs it before the merge.
2. **Flat cost.** The PR gives per-route B numbers from `eod-read.ts` at `--today-rows 0` and at `--today-rows 518400`, for all six routes. Each p95 at 518,400 is below 2x its value at 0 + 5 ms.
3. **Parity.** `bun bench/today-parity.ts <21e7bdc worktree> <B worktree> <seed> <now>` exits `0`. Its output, the sha256 per step and side, goes in the PR. A and B are independent builds of the same inputs. The PR also shows one deliberate failure: the same command with B's future-row subtraction disabled locally exits `1`.
4. **Cold reads do not regress.** `bun bench/cold-read.ts --api <B> --density 10 --today-rows 288000` gives `cold_read_cpu_ms <= 390`, `cold_get_checks_ms <= 200` and `cold_get_uptime_ms <= 190` (literals from `bench/budgets.json` at `21e7bdc`). A and B outputs go in the PR.
5. **Budgets.** `bench/budgets.json` has the seven new entries, each with its measured B median in the PR. `eod_read_cpu_ms` has `gating: true`. `eod_get_checks_ms` is at most 392 and `eod_get_latency_ms` at most 53. `bun run bench:selftest` passes (`check-budgets.ts` requires an entry per emitted metric).
6. **Memory.** `vm_rss_mib` of A and B from `eod-read.ts`. B is at most 15 MiB above A.
7. **Unit tests.** Tests 1-8 above pass. The `bun test` CPU time is reported and stays under 4.1 s.
8. **CI.** `check`, `bench-selftest`, `docker` and `compose-e2e` are green.
