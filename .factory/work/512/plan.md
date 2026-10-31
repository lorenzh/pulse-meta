# Spec #512: API: first reads after a start scan the whole 30- and 90-day window

Source: performance audit `audits/performance/2026-10-31-api.md`, finding `performance-api-2026-10-31-3` (P2), report PR #511. Issue review: `.factory/work/512/issue-review.md`. All code facts below were read in pulse-api `11f5555` (`.repos/api`, `HEAD`).

## Goal

After an API restart, the first `GET /checks` and the first `GET /uptime` take about as long as later reads. On the 10x bench density (8.64 M results) each one answers in under 400 ms. That keeps them well below the status proxy's 4000 ms upstream timeout (pulse-status `src/server.ts:71`).

## Scope

One repository: `api`.

- Store the per-day uptime tallies of closed days in a new table `uptime_daily`. Today they live only in the in-memory map `closedTallies` (`src/service.ts:420`), which is empty after every start.
- Fill the table once per database: a background backfill after listen, plus a fill on read for the days that are still missing.
- Keep the table correct when late results arrive, at day rollover, under retention, and when checks are removed.
- Add a cold-read phase at 10x density to `bench/`, with new metrics and budgets. Add a standalone cold-read script and a parity script for the acceptance evidence.
- Update the docs.

## Non-goals

- No change to the pulse-status timeout (`DEFAULT_UPSTREAM_TIMEOUT_MS`).
- Today's tally is still computed from `results` on every uncached read, as now (`dailyUptime`, `src/service.ts:515`). Per-ingest incremental tallies for today belong to #513. The 5 s read cache (`cached`, `src/service.ts:425-439`) and its invalidation on every ingest, config change and retention delete stay as they are.
- No change to response shapes, so no contract change.
- No change to `latency_daily`, its backfill, or its log lines.
- No change to `/readyz` semantics.
- No change to `.github/workflows/*.yml`.

## Decisions (open points of the issue review)

1. **Stored table, not a build in memory after the start.** A build in memory repeats on every start (2.4-3.4 s CPU at 10x). Until it finishes, a read either scans the missing days itself, which is the cold cost we have today, or waits for the build. So it cannot reach the goal. A stored `uptime_daily(check_id, day, good, total)` costs the full scan once per database. After that, a restart reads at most 90 small rows per check plus today's results.
2. **First start after the upgrade: background backfill after listen (option a), with a fill on read.** This works like the latency backfill. `/readyz` does not wait for it. While it runs, a read that finds closed days without a row computes them from `results` and stores them in one transaction, so every answer is correct and identical before, during and after the backfill. The cost of the first start after the upgrade is today's cold cost, once per database. It is documented and reported, but not held to 400 ms.
3. **Late results change the stored row in the same transaction.** When `storeSample` inserts a row (`changes > 0`), it runs `UPDATE uptime_daily SET good = good + ?, total = total + 1 WHERE check_id = ? AND day = ?`. Here `good` is `1` unless the status is `down`, and `day` is the UTC day of the timestamp of the successful insert. In `storeSample` (`src/service.ts:395-416`) `at += 1` runs after every insert, also the successful one, so after the loop `at` is one past the stored timestamp. The day is `dayOf(at - 1)` after the loop (or a `stored` variable set before the increment), never `dayOf(at)` and never `dayOf(result.timestamp)`. For a non-generated sample `at - 1` equals `result.timestamp`. The UPDATE never creates a row. For today or a future day no row exists, so it changes nothing. A repeated sample (`changes = 0`) changes nothing. The in-memory entry of that same day (`dayOf(at - 1)`) is dropped, so the next read loads it again from the table. Today the drop uses `dayOf(result.timestamp)` (`src/service.ts:414`); it only differs for a generated sample shifted across midnight, and the new code uses the stored day for both the UPDATE and the drop.
4. **Day rollover.** Rows exist only for days `< dayOf(now())` at the time they are written. Yesterday gets its row on the first read after midnight (one day per check), or from the hourly backfill run, whichever comes first. A result stamped up to 60 s in the future (`MAX_FUTURE_SKEW_MS`, `src/server.ts:39`) belongs to a day that has no row yet, so it is counted when that day is filled from `results`, never twice.
5. **Retention and gone checks.** `deleteExpiredUptime(cutoff)` deletes rows with `day < dayOf(cutoff)` and rows whose `check_id` is not in `checks`, like `deleteExpiredLatency` (`src/service.ts:1055`). Retention calls it in the same place as the latency rollups (`deleteLatencyRollups?.(cutoff)` at `src/retention.ts:50`; the cutoff is computed at `:47`), and `src/start.ts:207` passes the dependency. The cutoff never falls inside the 90-day window (`PULSE_RETENTION_DAYS` >= 90, `src/retention.ts:8-14`). Removed or deactivated checks keep their rows. No result can be ingested for an inactive check (`getActiveCheck`, defined at `src/service.ts:467`, used by ingest at `:882`), so a check that becomes active again has correct rows and is not counted twice.
6. **Schema: numbered migration step 3, not `CREATE TABLE IF NOT EXISTS`.** Unlike `latency_daily`, uptime counts late results (`docs/concepts.md:50`). Suppose the file were opened by an older release: it would store late results without updating the rows, and the rows would be wrong when the new release starts again. Step 3 (`CREATE TABLE uptime_daily ...`, empty, no fill) makes an older release refuse the file with `SchemaVersionError`. That matches the documented rule "Downgrades are not supported: restore the backup" (`docs/operation.md:26`). The cost we accept: on the upgrade start, `migrate` runs `PRAGMA foreign_key_check` over the whole file (`src/db.ts`, `checkForeignKeys = !fresh && current < steps.length`), once, before listen. The PR reports that time at 1x and 10x.
7. **Bench: a separate cold-read phase with its own 10x seed.** The 1x load, its metrics and its budgets stay comparable. Wall-clock metrics are reported only, so the phase also emits a gating CPU metric (`cold_read_cpu_ms`). Then a regression gives `FAIL`. Because `bench.yml` has had no scheduled run on `main` so far, the PR must not claim nightly coverage that it cannot show. It shows a `workflow_dispatch` run.
8. **`bun test` stays small.** The 10x timing check lives in `bench/`, not in `bun test`. Unit tests cover correctness on small data sets. `test_cpu_s` must stay within its budget of 4.1 s.

## Required behavior (api)

### Table and schema

- `src/migrations.ts`: append step 3:
  ```sql
  CREATE TABLE uptime_daily (
    check_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    good INTEGER NOT NULL,
    total INTEGER NOT NULL,
    PRIMARY KEY (check_id, day)
  );
  ```
  `SCHEMA_VERSION` (`src/migrations.ts:64`) becomes 3. Released steps 1 and 2 are not edited. `SCHEMA` (version 0) in `src/db.ts` is not changed.
- `day` is `Math.floor(timestamp / DAY_MS)`, the same bucket as `dailyUptime` (`CAST(timestamp / 86400000 AS INTEGER)`) and `dayOf` (`src/latency.ts:31`).
- A row means: the complete tally of that closed UTC day, from all results stored for the check with `day*DAY_MS <= timestamp < (day+1)*DAY_MS`, all locations, late results included, maintenance not subtracted. `good = count(status != 'down')`, `total = count(*)`. A closed day without results is stored as `good = 0, total = 0`.

### Service (`src/service.ts`)

- `uptimeOf(id, windowDays)` reads the closed days `firstDay .. today-1` from the in-memory map. The map is now a read-through cache over `uptime_daily`. On a miss it loads the check's stored rows of the window with one indexed `SELECT ... WHERE check_id = ? AND day >= ? AND day < ?`. Closed days still without a row are computed from `results` with one range query (`dailyUptime` over `[firstMissing*DAY_MS, today*DAY_MS)`) and stored with `INSERT OR IGNORE` in one transaction, with a `{0, 0}` row for a day without results. Today is still computed from `results` with `timestamp <= now` at every uncached read, exactly as now.
- The output must be byte for byte the same as at `11f5555` for the same database and clock: same `days` order and dates, `uptime` as `good/total*100` unrounded and `null` for `total = 0`, `results = total`, and window `uptime` as `sum(good)/sum(total)*100` over the window.
- New service methods (internal, not in the contract):
  - `listUptimeCheckIds(): string[]`: the active checks of every type, in `rowid` order.
  - `missingUptimeDays(checkId): number[]`: closed days of the 90-day window (`UPTIME_DAYS`) without a row, ascending.
  - `fillUptimeDay(checkId, day): boolean`: computes and stores one closed day. It returns `false` without computing when `day >= dayOf(now())` or a row exists.
  - `deleteExpiredUptime(cutoff): number`: see Decision 5.
- `storeSample` applies Decision 3 inside the ingest transaction.

### Backfill runner (`src/uptime-rollup.ts`, new)

- Same structure as `src/latency-rollup.ts`: a start delay of 5 s after listen, then hourly. One `(check, day)` per batch with `await sleep(0)` after each. It stops between batches when stopped. The implementer may share code with `latency-rollup.ts`, but the latency log lines stay exactly as they are.
- Log lines. The first run logs both, also when nothing is stored:
  - `uptime rollup: backfill started (<N> checks)`
  - `uptime rollup: backfill done, stored <D> days in <MS> ms`

  An hourly run logs `uptime rollup: stored <D> days in <MS> ms` only when it stored days. A failed run logs `uptime rollup failed: <message>`.
- `src/start.ts` creates it after listen, next to `startLatencyRollup` (`src/start.ts:313-322`). Shutdown stops it and waits for the batch in progress before `db.close()`, together with `retention.stop()` and `latencyRollup.stop()` (`src/start.ts:328`).

### `/readyz`

Unchanged: `200` when `SELECT 1` works and the API is not shutting down (`src/server.ts:327`, `docs/operation.md:196`). It does not wait for the uptime backfill. Routes answer correctly while the backfill runs (fill on read).

### Retention (`src/retention.ts`, `src/start.ts`)

`CleanupDeps` gets `deleteUptimeRollups?: (cutoff) => number`, called next to `deleteLatencyRollups`. `start.ts` passes `service.deleteExpiredUptime`.

### Bench

- `bench/seed.ts` usage becomes `bun bench/seed.ts <api worktree> <output db path> [density] [now ms]`. Today it takes `Date.now()` internally (`bench/seed.ts:37`) and prints only the row count (`:53`). The optional third argument is the density `n` in results per minute per check (default 1). The optional fourth argument is the seed's `now` in ms since the epoch (default `Date.now()`); all row timestamps are computed from it, and it is also passed to `createService`. The final line becomes `seeded <N> results (check interval <ms> ms, density <n>, now <now ms>)`, so a caller always learns the `now` that was used. No caller parses the old line (`bench/run.ts:117` uses `runChecked` only). With density 1 the rows are unchanged: the same 864 000 rows and values as today, so the 1x load stays comparable. With `n > 1`, each check gets `n` results per minute at location `default`, at `now - k*60000 - j*(60000/n)` for `j = 0..n-1`. The `j = 0` rows are exactly the 1x rows. Every extra row (`j >= 1`) whose index `(k*n + j)` is divisible by 97 has status `down`; the others are `up`, so the uptime values are not all 100. For 20 checks, 30 days and `n = 10` that is 8 640 000 rows.
- The cold-read phase (`bench/cold.ts`, new, used by `bench/stack.ts` or `bench/run.ts`) runs once per round and side, after the 1x stack run. It uses only the `api` service of `compose.bench.yaml` and a fresh copy of the side's 10x seed (`.bench/seed/<side>/pulse-10x.db`). The seed is made once per side in `prepareSide` (`bench/run.ts:105-125`) by the harness's `bench/seed.ts` with that side's api worktree as first argument, so with that side's own `src/db.ts` and `src/service.ts`. The phase logs the UTC time of each cold read and the number of today's rows of the seed (`20 x n x` minutes since UTC midnight), because the cost of today's tally depends on it (Risks).
  1. Warm start: `up -d --no-build api`, wait for `/readyz`, send one `GET /checks` and one `GET /uptime`. Then wait until the API's CPU time (`/proc/1/stat` in the container, `bench/measure.ts`) grows by less than 20 ms over 2 s, at most 300 s. That makes the procedure the same on A (no uptime backfill) and B.
  2. Cold sequential: `docker compose restart api` (SIGTERM). At the first `200` of `/readyz`, read the API's CPU time, send `GET /checks` and, after it answers, `GET /uptime`, then read the CPU time again. Emit `cold_get_checks_ms` and `cold_get_uptime_ms` (wall time per request, client side) and `cold_read_cpu_ms` (CPU difference).
  3. Cold concurrent: restart again. At the first `200` of `/readyz`, send both at once and emit `cold_concurrent_ms` (wall time until both answered).
  4. Both requests must answer `200`, and the client timeout is 30 s. Anything else fails the run like any other harness error (exit code 2).
- `bench/compare.ts`: add the four keys to `METRIC_KEYS` (`bench/compare.ts:7-21`, the source of `MetricKey`, `:22`) and to `EMITTED_METRICS.api` (`:35-48`). Without the `METRIC_KEYS` entries, `budgets.json` is rejected with `budgets.api: unknown metric "..."` (`:134-135`), and `EMITTED_METRICS` does not typecheck.
- `bench/budgets.json`: add entries for the four keys under `api`. `cold_read_cpu_ms` has `"gating": true`, the three wall-clock keys have `"gating": false`. Budget values: B median of the PR's A/B run plus about 30 % headroom, rounded up (`bench/README.md`, "Changing a budget"). That run must start after 20:00 UTC, so the budget covers the late-day size of today's tally and a nightly run at 02:17 UTC cannot fail it on hour alone. If no such run is possible, the budget covers the measured `cold_read_cpu_ms` scaled to `today_rows` = 288 000, and the PR shows the arithmetic. B is used because A is the pre-fix behavior. `cold_read_cpu_ms` gets a `floor` of at least the default 30 ms. Widen it when an A = B run shows more noise. No existing budget value changes unless the PR's A/B run shows that it must, with the numbers.
- `bench/cold-read.ts` (new, standalone, no Docker): `bun bench/cold-read.ts --api <worktree> [--seed-with <worktree>] [--density 10] [--limit-ms 400]`. It seeds a temp database by running the `bench/seed.ts` of the change (the script itself, never the old one: `11f5555`'s seed.ts has no density argument) with the `--seed-with` worktree as first argument (default: `--api`), the density, and `now = Date.now()`. So `--seed-with 11f5555` means a file with schema version 2 written by `11f5555`'s `openDb`, which is the upgrade case. It runs `bun <api>/src/main.ts` as a child process with the bench checks and tokens files (`bench/fixtures.ts`) and the env names that `bench/compose.bench.yaml` sets for the api. It then runs steps 1-3 above, reading CPU from `/proc/<pid>/stat`, and also times the warm (first) start: startup to `/readyz` and its first reads. It prints one JSON object with all numbers, plus `utc_start` (ISO time of the first cold request), `seed_now_ms` and `today_rows` (rows with `timestamp >= UTC midnight` in the seed, counted with a read-only `SELECT COUNT(*)` before the API starts), and exits `1` when `cold_get_checks_ms`, `cold_get_uptime_ms` or `cold_concurrent_ms` is `>= --limit-ms`. The limit is a literal (400) from the issue, not from the code under test.
- `bench/uptime-parity.ts` (new): `bun bench/uptime-parity.ts <worktree A> <worktree B> <seed db> <now ms>`. The seed db is made with `bun bench/seed.ts <worktree A> <seed db> <density> <seed now>` (the change's seed.ts, A's worktree, an explicit fixed `seed now`), and `<now ms>` is `seed now + 1000`, both written in the PR. For each worktree it copies the seed, opens it with that worktree's `openDb`, and creates the service with that worktree's `createService`. It uses `now = <now ms>`, the bench checks with `availabilityTarget` 99.5, and two fixed components (`c0..c9`, `c10..c19`). It writes the JSON of `getUptime()`, `componentsUptime(components, getUptime())` (`src/components.ts:70`) and `listChecks().map(c => ({ id: c.id, slo: c.slo }))`. On B it writes this three times: (1) on the copy with no rows (fill on read), (2) on a fresh copy after `fillUptimeDay` for half the checks' missing days (backfill in progress), (3) after the whole backfill and a new service instance on the same file (restart). Then, on both sides, it ingests the same late result, `{checkId: "c0", status: "down", location: "default", timestamp: <now ms> - 2 days + 30 s}`, through `ingest`, and writes the output again. It exits `1` when any B output differs by one byte from A's output of the same step. A is produced by independent code (`11f5555`), so the check can fail.
- `bench/selftest/check-cold.ts` (new): covers the pure parts of `bench/cold.ts`: the CPU settle rule, the limit check of `cold-read.ts`, and the seed row layout for `n = 1` and `n = 10` (row count per minute, the `down` rule, `j = 0` equals the 1x row), and that an explicit seed `now` gives the same timestamps on two runs and appears in the printed line. It is added to `bench:selftest` in `package.json:17`.

### Docs

- `docs/operation.md`:
  - `:21-26` (Schema): version 3 adds the empty table `uptime_daily`. The first start after the upgrade runs the foreign key check over the whole file once (give the measured time at 1x and 10x). An older release refuses the file afterwards.
  - Next to `:32`: a paragraph on `uptime_daily`. It holds good/total per check and closed UTC day, and it can be rebuilt from `results`. Deleting its rows with the API stopped is safe: the backfill and the reads fill them again.
  - `:43`: replace "the first `GET /checks` after start that builds `slo` values takes about 0.4 s" with the measured numbers. First reads after a restart take about as long as later reads (give the 1x and 10x numbers). Once per database, the first start after the upgrade has the old cost (give the numbers).
  - A paragraph on the uptime backfill: start delay, batches, hourly, the log lines above, and that `/readyz` does not wait for it while routes answer correctly during it.
  - `:77` (Retention and disk space): `uptime_daily` rows are deleted with the same cutoff and when their check is gone.
- `docs/concepts.md`:
  - Uptime (`:95-97`): closed days are stored once in `uptime_daily`. A late result for a closed day still counts: it updates the stored day in the same write. Today is computed from the results at every read. Responses are the same before, during and after the backfill.
  - Retention list (`:83-91`): the uptime rows follow the same cutoff.
  - The `availability` line (`:112`) stays true ("from the same day buckets as `GET /uptime`"); check it.
- `bench/README.md`: add the four metric rows to the table, with Gates `yes` for `cold_read_cpu_ms` and `no` for the others. Add a section "The cold-read phase" covering the 10x seed, steps 1-3, and why it is separate from the 1x load. Update "Plan on 35 minutes" with the measured run time. Describe `bench/cold-read.ts` and `bench/uptime-parity.ts`.
- `src/docs-claims.test.ts`: add a claim that `docs/operation.md` no longer contains `takes about 0.4 s` and does contain `uptime_daily`.

## Risks

- **Fill on read on the first start after the upgrade.** It has today's cold cost once per database. A status poll that arrives then can get one 502. This is accepted and documented (Decision 2).
- **Upgrade start time.** Migration step 3 triggers `PRAGMA foreign_key_check` over the whole file before listen, once. On large files `/readyz` comes later for that one start. It is measured and documented.
- **Drift between the stored rows and `results`.** Any write path to `results` other than `storeSample` would bypass the UPDATE. Today the only other writer is retention, which deletes only days before the cutoff, where rows are deleted too. The implementer greps `INSERT INTO results` and `DELETE FROM results` in `src/` and names every hit in the PR.
- **Off-by-one at day edges.** The last ms of a day must count for that day (existing test `uptime.test.ts:81`), and the new code must keep this.
- **Load CPU.** Without the in-memory cache, every uncached `GET /checks` (the cache is cleared on each of the 30 posts per second) would read 20 x 30 rows from SQLite. Keeping the in-memory map as a read-through cache keeps `load_cpu_s` where it is.
- **Bench time and disk.** Per side, a 10x seed (about 1.6 GB) plus a copy per round, and about 2-3 extra minutes per run. The workflow timeout is 90 min (`.github/workflows/bench.yml:32`). The current run is about 35 min (`bench/README.md`). If an A/B run with 5 rounds exceeds 80 min, the implementer requests a hold instead of changing the workflow.
- **Today's tally depends on the UTC hour.** Today is still computed from `results` on every uncached read (Non-goals). The 10x seed runs up to the real `now`, so today holds `20 x 10 x` minutes since UTC midnight rows: about 0 at 00:05, about 144 000 at 12:00 and up to 288 000 at 23:59. `GET /checks` (cache key `slo:*`) and `GET /uptime` (key `uptime`) each scan them, and the concurrent case scans them twice in the one thread. At the audit's rate (about 0.3-0.55 µs per row) that is roughly 85-160 ms per read late in the UTC day, against near zero at the nightly 02:17 UTC (`.github/workflows/bench.yml:5-6`). So a nightly pass shows only the near-best case, and the acceptance evidence must include a late-day run (Completion evidence 1). If a run after 20:00 UTC misses 400 ms only because of today's scan, the implementer requests a hold with the numbers instead of changing today's tally, which is #513's scope.
- **Side A has no uptime backfill.** Step 1 settles on CPU, not on a log line, so A and B follow the same procedure.

## Performance impact

The keys are those of `bench/budgets.json` in the api repository (`.repos/api/bench/budgets.json`).

| Metric | Expected direction | Rough size | Why |
|---|---|---|---|
| `startup_cpu_ms` (gating, 1x) | none | within the 30 ms floor | The 1x seed is created by the side's own `db.ts`, so it is already at version 3. No migration or foreign key check runs. The backfill starts 5 s after listen. |
| `load_cpu_s` (gating) | none or slightly down | within noise | The closed days are already cached in memory after the first read today. The added UPDATE per stored result matches no row (today's results) and costs one primary-key lookup. |
| `idle_rss_mib` (gating) | none | < 3 MiB | The backfill runs in the 30 s idle wait, like the latency one. It reads the same pages that the first read reads today. |
| `peak_rss_mib` (gating) | none | < 3 MiB | |
| `test_cpu_s` (gating) | up | +0.1 to +0.4 s, must stay <= 4.1 | New tests on small data. |
| `startup_wall_ms`, `p95_get_checks_ms`, `p95_post_results_ms`, `p95_get_latency_ms`, `p95_get_check_latency_ms`, `rps`, `image_mb` (reported) | none | | The cold read fell in the 20 s warm-up, outside the window. |
| new `cold_get_checks_ms`, `cold_get_uptime_ms` (reported) | down | 1x: from 207-285 ms to the later-read level (about 20-40 ms); 10x: from 2.35-3.45 s to < 400 ms | No full-window scan after a restart. |
| new `cold_concurrent_ms` (reported) | down | 10x: from > 4000 ms to < 400 ms | |
| new `cold_read_cpu_ms` (gating) | down | 10x: from seconds to tens or hundreds of ms | Grows with the UTC hour of the run through today's tally (Risks); the budget is set from a late-day run. |

How the implementer measures it:

- A local A/B with `bun bench/run.ts --a 11f5555 --b <branch head> --others-ref main --rounds 1`, then a `workflow_dispatch` of `bench.yml` on the PR branch (`gh workflow run bench.yml --ref <branch> -f a=11f5555 -f b=<head sha> -f others=main`). Paste both tables in the PR.
- `bun bench/cold-read.ts` at density 1 and 10 for `--api` = the change and `--api` = `11f5555`, plus `--api` = the change with `--seed-with` = `11f5555` (first start after the upgrade). Paste all outputs.

## Security impact

Security impact: no. The change adds an internal table, a background job and bench scripts. It touches no route, auth, parser at a trust boundary, probe client, log text with external data, dependency, Dockerfile or CI workflow. The new log lines carry only counts and durations.

## Rollout order

One repository: only `api` changes. Response shapes stay the same, so pulse-status, probes and notify on any pin keep working. Migration step 3 means an older api release refuses a file opened by this release, which is the documented no-downgrade rule (restore the backup).

## Counterexamples

- **Tally definition.** One check, closed day `d`, results `up`, `degraded`, `down` at location `east` and `up` at `west`. Stored row: `good = 3, total = 4`, day uptime `75`. A wrong implementation would count `degraded` as down (50), take only one location (66.67), or average per location.
- **Window uptime is result-weighted, never an average of day percentages.** Day 1 has `1/1`, day 2 has `0/3`: window uptime `25`, not `50`. An empty day (`0/0`) adds nothing and is not `0 %`.
- **Day edges.** A result at `(d+1)*DAY_MS - 1` belongs to day `d`. One at `(d+1)*DAY_MS` belongs to day `d+1`.
- **Late result for a stored closed day.** A row `{good 1440, total 1440}` for 2 days ago, then a late `down` result for that day: the row becomes `{1440, 1441}`, and `GET /uptime` shows it at once (after the cache, which the ingest clears). Leaving the row unchanged is wrong.
- **Late result for a closed day without a row.** No row may be created with `{0, 1}`. The row is created later from all results of that day.
- **Repeated sample.** A second `POST /results` with the same (check, location, timestamp) leaves the row unchanged (`changes = 0`).
- **Generated heartbeat sample shifted by +1 ms across midnight.** Day `d` is closed and has a row; a generated sample at `(d+1)*DAY_MS - 1` collides with a stored sample, so it is stored at `(d+1)*DAY_MS` (day `d+1`). Day `d`'s row stays unchanged. An implementation that uses `dayOf(result.timestamp)` increments day `d` wrongly. Conversely, with no collision the sample is stored at `(d+1)*DAY_MS - 1` and counts for day `d`; an implementation that uses `dayOf(at)` after the loop increments day `d+1` wrongly.
- **Future skew.** At `23:59:30` UTC a result stamped `00:00:20` of the next day: no row is changed, and today's answer does not count it (`timestamp > now`). After midnight it counts in the new today once `now >= 00:00:20`, and in that day's row when the day closes. It is never counted twice.
- **Restart reads the table.** Fill the rows, then delete every `results` row before today with raw SQL, then create a new service on the same file. The closed days in `GET /uptime` must be unchanged. An implementation that still scans `results` returns empty days and fails.
- **Rows only for closed days.** `fillUptimeDay(id, today)` and `fillUptimeDay(id, today + 1)` return `false` and store nothing.
- **Retention.** With a cutoff at the first day of the 90-day window, a row at `cutoffDay - 1` is deleted and a row at `cutoffDay` stays. A row of a check id that is no longer in `checks` is deleted. A row of a deactivated check (still in `checks`) stays.
- **Schema.** A version 2 file opens and gets `user_version` 3 with an empty `uptime_daily`. A version 4 file is refused with `database schema version 4 is newer than this program supports (3); downgrades are not supported`.
- **Identical answers during the backfill.** With rows for some days of some checks only, `GET /uptime`, `GET /components/uptime` and `GET /checks` must equal the answers with no rows and with all rows.
- **Cold-read limit.** 399 ms passes, 400 ms fails (`>=`). Each of the three wall metrics is checked on its own: a fast `/checks` does not excuse a slow `/uptime`.

Statistics used by the acceptance checks:

- `cold_get_checks_ms` and `cold_get_uptime_ms`: client wall time of one request, from just before `fetch` to the end of the body, in ms, rounded to an integer. One sample per run. The bench reports the median of the rounds per side (`bench/README.md`).
- `cold_concurrent_ms`: wall time from sending both requests to the end of the later body.
- `cold_read_cpu_ms`: `utime + stime` of the API process after the second body minus before the first request, in ms (10 ms resolution).
- No percentiles are involved.

## Contract fields

No contract or config names change. New names inside the api only (table, service methods, log prefix, bench metric keys, script names). No collision was found in the contract, config or api clones:

```text
$ for n in uptime_daily cold_get_checks_ms cold_get_uptime_ms cold_read_cpu_ms cold_concurrent_ms "uptime rollup" \
    missingUptimeDays fillUptimeDay deleteExpiredUptime listUptimeCheckIds deleteUptimeRollups startUptimeRollup; do
    grep -rn "$n" .repos/contract/src .repos/config .repos/api/src .repos/api/bench .repos/api/docs; done
(no output)
```

Run at spec time on the clones: no output for any name. Re-run it before the PR. `uptime-rollup.ts`, `cold.ts`, `cold-read.ts`, `uptime-parity.ts` and `check-cold.ts` do not exist in `.repos/api` (`ls src bench bench/selftest`).

## Repository: api

Files:
- `src/migrations.ts` (step 3)
- `src/service.ts` (`uptime_daily` read/fill, `storeSample` update, new methods and interface entries)
- `src/uptime-rollup.ts` (new)
- `src/start.ts` (start and stop the runner, retention dep)
- `src/retention.ts` (`deleteUptimeRollups`)
- `src/uptime.test.ts`, `src/db.migrations.test.ts`, `src/retention.test.ts`, `src/service.late.test.ts`, `src/uptime-rollup.test.ts` (new), `src/docs-claims.test.ts`
- `bench/seed.ts`, `bench/cold.ts` (new), `bench/cold-read.ts` (new), `bench/uptime-parity.ts` (new), `bench/stack.ts`, `bench/run.ts`, `bench/compare.ts`, `bench/budgets.json`, `bench/selftest/check-cold.ts` (new), `bench/README.md`
- `package.json` (`bench:selftest` script only)
- `docs/operation.md`, `docs/concepts.md`

Behavior change: yes. The first reads after a restart come from a new stored table, there is a new schema step and a new background job, and the bench gains a phase and metrics.

If the code already stores closed-day uptime tallies and reads them after a restart without a scan of the window, request a hold instead of a review.

### Tooling facts (verified)

- Runtime Bun 1.4.0: `package.json:9` (`engines.bun`) and `:34` (`packageManager`). CI installs `bun-version: 1.4.0` (`.github/workflows/ci.yml:25-27`; pinned config `check.yml:22-24`).
- Tests: `bun test` (`package.json:14`). `bunfig.toml:1-4` turns on coverage with `coverageThreshold = { lines = 0.8 }` and ignores `**/*.test.ts`, so `src/uptime-rollup.ts` and the new service code need tests that cover them. `bench/` is not under `bun test` (`bench/README.md`: "It is not part of `bun test`").
- Lint: `biome check . && pulse-eslint .` (`package.json:15`), Biome `2.6.3` (`package.json:22`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned at `51e95b0eb463b27a196a33b428607bd92443e4f0` (`package.json:23`). At that ref, `biome.json:10-17` includes `**` minus `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`, so `bench/*.ts` is linted (`lineWidth` 100, `:23`). The pinned file is identical to the config clone (`diff` empty).
- Typecheck: `bun node_modules/typescript7/bin/tsc --noEmit` (`package.json:13`).
- CI: job `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` (`ci.yml:17`), which runs Lint, Typecheck and Test (`check.yml:27-38` at that ref, identical to the clone). Job `bench-selftest` runs `bun run bench:selftest` and `docker compose -f bench/compose.bench.yaml config --quiet` (`ci.yml:19-30`). Job `compose-e2e` runs `bash scripts/compose-e2e.sh` (`ci.yml:48-55`).
- Bench workflow: `ubuntu-24.04`, `timeout-minutes: 90`, inputs `a`, `b`, `others` (`.github/workflows/bench.yml:4-32`). Not changed.

### Checks the implementer adds (bun test, small data)

1. Stored equals live: 90 days with mixed statuses, two locations, late rows and empty days. The output of `getUptime()` and `getSloDays()` with no rows, with partial rows and with all rows is `deepEqual` to an independent recomputation in the test (a plain loop over the inserted fixture rows, not the service's SQL).
2. Restart reads the table (Counterexample "Restart reads the table").
3. Late result: a stored row is incremented in the ingest transaction. Both midnight cases of the Counterexample "Generated heartbeat sample" are tested. A day without a row stays without a row. A repeated sample changes nothing. The `down` and `degraded` rules hold.
4. Rollover and future skew (Counterexamples).
5. `fillUptimeDay` refuses today and later and a stored day. `missingUptimeDays` is ascending and limited to the 90-day window.
6. Runner: the start delay, one fill per (check, day) each followed by `sleep(0)`, an hourly run, the log lines (exact text, integer ms), a failed run, and stop during the delay and during a batch. Same shape as `latency.test.ts:232-488`.
7. HTTP: `GET /uptime`, `GET /components/uptime` and `GET /checks` are identical before, during and after the backfill (as `latency.test.ts:376`).
8. Retention and orphans (Counterexample "Retention").
9. Migration: a version 2 file becomes version 3 with an empty `uptime_daily`. A newer file is refused. The existing tests use `SCHEMA_VERSION` (`src/db.migrations.test.ts:7`).
10. The existing `uptime.test.ts` cases (`:32-133`) pass unchanged.

### Completion evidence (in the PR)

1. **Cold reads at 10x, under 400 ms, and failing on the old code.** `bun bench/cold-read.ts --api <change> --density 10` exits `0`, and each of `cold_get_checks_ms`, `cold_get_uptime_ms` and `cold_concurrent_ms` is `< 400`. Because today's tally grows with the UTC hour (Risks), the PR shows at least two passing runs with their `utc_start` and `today_rows`: one with `utc_start` between 20:00 and 23:59 UTC (`today_rows >= 240 000`, the worst case within about 17 %) and one at any other hour. A pass before 20:00 UTC alone does not satisfy this check. The same command with `--api` at `11f5555` exits `1`. The expected range from the audit is 2.35-3.45 s sequential and > 4000 ms concurrent. Paste both outputs. On the bench runner: the `workflow_dispatch` run of `bench.yml` with `a=11f5555`, `b=<head>`, `others=main` shows B `< 400` for the three wall metrics, and A above 400. Link the run, give its UTC start time, and paste the api table.
2. **Identical uptime values.** `bun bench/uptime-parity.ts <11f5555 worktree> <change worktree> <seed> <now>` exits `0` on a 1x seed and on a 10x seed. Both seeds are made with the change's `bench/seed.ts` and `11f5555` as worktree argument (`bun bench/seed.ts <11f5555 worktree> <db> 1|10 <seed now>`), with an explicit `seed now` written in the PR, and the parity `now` is `seed now + 1000`. This covers 24 h and 7 d (the last 1 and 7 entries of `days`), 30 d (`slo.availability`) and 90 d (`uptime`) at all four steps. Paste the output and the `sha256sum` of each written JSON for A and B. The expected value is A's output, which comes from independent code.
3. **Numbers.** Startup (`/readyz` wall and CPU) and cold-read numbers at 1x and 10x, for a restart and for the first start after the upgrade (`--seed-with 11f5555`). Report the two `uptime rollup` log lines of that first start.
4. **Bench.** The A/B table with all api rows. Name the budgets added (the four new keys with values and the B medians they come from) and any existing budget that moved, with the reason.
5. **Write paths.** `grep -n "INSERT INTO results\|DELETE FROM results" src/*.ts` with each hit explained (Risks).
6. **CI.** `check` (lint, typecheck, test), `bench-selftest` and `compose-e2e` green. Report `bun run test` CPU time against `test_cpu_s` 4.1 s.
