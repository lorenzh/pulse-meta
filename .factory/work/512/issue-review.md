# Issue review: #512 API: first reads after a start scan the whole 30- and 90-day window

Source: audit `audits/performance/2026-10-31-api.md`, finding `performance-api-2026-10-31-3` (P2), report PR #511 (merged). Follow-up #513 (today's per-ingest re-aggregation) is open and starts after this one.
Target: `api` only. Inspected at pulse-api `11f5555` (`.repos/api`, `HEAD`).

## Current behavior (verified in the clone)

- `src/service.ts:750` `uptimeOf(id, windowDays)`: closed-day tallies live only in the in-memory map `closedTallies` (`src/service.ts:420`). After a start the map is empty, so `firstRead` is the window's first day and one `dailyUptime` query (`src/service.ts:515`, `GROUP BY day` over `results`) aggregates the whole window in one synchronous call.
- Three read paths use `uptimeOf`: `GET /uptime` (90 days, `computeUptime`), `GET /checks` (`addSlos` -> `sloDays`, 30 days, only checks with `availabilityTarget`) and `GET /components/uptime` / component `availability` (via `getSloDays` and the uptime days). All three must use the new source.
- Tally rule today (must stay identical): `good = SUM(status != 'down')`, `total = COUNT(*)`, all locations, late results included (`late` column is not filtered), maintenance not subtracted, `degraded` counts as up. Results after `now` are excluded (`timestamp <= t`). A closed day without results is a `{0, 0}` entry (`uptime: null`, `results: 0`).
- Invalidation today: `storeSample` (`src/service.ts:414`) deletes the in-memory entry of the result's day when a row is inserted, so a late result for a closed day is counted on the next read. Late results can reach at most 7 days back (`MAX_RESULT_AGE_MS`).
- Retention: `deleteExpiredResults` never deletes inside the 90-day window (minimum `PULSE_RETENTION_DAYS` = `UPTIME_DAYS` = 90, cutoff before the window's first day), so stored closed-day tallies in the window are never invalidated by retention.
- Latency precedent: `latency_daily` (`src/db.ts:75`, `CREATE TABLE IF NOT EXISTS`, no `user_version` step), background backfill in `src/latency-rollup.ts` (5 s after listen, one (check, day) per batch, `sleep(0)` after each, hourly afterwards, two log lines on the first run), and `fillRollups` on read for days still missing. Retention deletes its rows with the same cutoff and for gone checks (`deleteExpiredLatency`).
- `/readyz` (`src/server.ts:327`): `200` when not shutting down and `SELECT 1` works. It does not wait for the latency backfill. Compose and the image `HEALTHCHECK` gate on it.
- Bench: `bench/seed.ts` seeds 20 checks x 30 days x 1/min = 864 000 rows by raw `INSERT INTO results` with the worktree's own `src/db.ts`/`service.ts`; it writes no `latency_daily` rows. `bench/load.ts` runs a 60 s load; no metric measures the first request after a start. Wall-clock metrics are reported only (`bench/README.md`: "Only CPU time and memory gate"). A self-test requires a `bench/budgets.json` entry for every emitted metric.
- Docs that describe this: `docs/operation.md:43` ("the first `GET /checks` after start that builds `slo` values takes about 0.4 s"), `:32` and `:45` (latency table and backfill), `:77` (retention of rollups), `:196` (`/readyz`); `docs/concepts.md:95-112` (Uptime, latency history, availability). `src/docs-claims.test.ts` pins some doc sentences.

## Open points for the plan

1. **Stored table vs. in-memory build after the start (the issue lets the plan pick).** Analysis to carry into the plan:
   - An in-memory build after the start repeats on every start (2.4-3.4 s CPU at 10x). Until it finishes, a read either scans the missing days itself (the cold cost that exists today) or waits for the build, which is still seconds. So it cannot meet the goal that "the first public reads after an API start answer in the same order of time as later reads".
   - A stored per-day table (for example `uptime_daily(check_id, day, good, total)`, like `latency_daily`) costs the full scan once per database, not once per start. After that a restart reads at most 90 rows per check plus today.
   - Assumption: the plan chooses the stored table. It should say this and give the reason above.
2. **The first start after the upgrade.** A file from an older release (and the bench seed) has no tally rows. The plan must choose one of these and document it in `docs/operation.md`:
   (a) a background backfill after listen, in yielding batches like the latency one. During it, reads fill missing days on demand, so they are correct but slow, once per database;
   (b) a fill before listen, which makes startup longer once, with `/readyz` unreachable until it is done;
   (c) reads compute missing days only from the results, without storing them, until the backfill has stored them.
   It must state the `/readyz` semantics explicitly (the issue requires this). Suggested: `/readyz` does not wait, the routes answer correctly during the backfill, and this matches the latency backfill. Either way the answers must be identical before, during and after the backfill. A test like `latency.test.ts` "http: responses are identical before, during and after the backfill" should cover it.
3. **Late results for a closed day.** Uptime counts late results (`docs/concepts.md:50`), unlike `latency_daily`, which ignores them. The stored row must change in the same transaction as the insert: either increment `good`/`total`, or delete the row so it is recomputed. A row that does not exist yet must not be created with only the late result in it (that gives a partial tally). A repeated sample (`changes = 0`) must change nothing. Generated heartbeat `down` samples go through `storeSample` too.
4. **Day rollover.** Today is never stored. The plan decides when yesterday gets its row: on the first read after midnight (one day per check, cheap) and/or by the hourly run. Results stamped up to 60 s in the future must not land in a closed row early.
5. **Retention and gone checks.** Delete rows before the cutoff day and rows of checks that no longer exist, as `deleteExpiredLatency` does. Removed or deactivated checks keep their results and their rows stay valid. A check that becomes active again must not be counted twice.
6. **Schema step.** The plan picks between `CREATE TABLE IF NOT EXISTS` (as `latency_daily`; no `user_version` bump; an older release still opens the file) and a numbered migration (`src/migrations.ts`; an older release then refuses the file). With `IF NOT EXISTS`, an older release that runs on the file and stores late results leaves stale rows when the new release starts again. The plan states which risk it accepts and documents it in `docs/operation.md` (Upgrades/Backup: the table can be rebuilt from `results`).
7. **The bench at 10x density.** Making the whole load run at 10x would move every existing api metric and budget (`startup_cpu_ms`, RSS, `load_cpu_s`) and add about 1.6 GB per side, plus seeding time, to the nightly run. Suggested: a separate cold-read phase with its own 10x seed (8.64 M rows; the 1x seed plus 9 more results per minute, as the audit review did), so the 1x load metrics stay comparable. The plan decides:
   - whether the phase seeds tally rows (with the seed calling the worktree's service when it has the method) or starts, waits for the backfill-done log line(s), restarts and then measures. Side A (baseline `8ea397c`) has no such method;
   - the metric names (for example `cold_get_checks_ms`, `cold_get_uptime_ms`, and maybe a gating `cold_read_cpu_ms` from the API's CPU time across the cold requests, because wall-clock metrics only report under the bench rules);
   - the budgets added to `bench/budgets.json` and the README rows. If the issue's "a regression shows in the nightly bench" is to mean a `FAIL` verdict and not just a reported number, a CPU-based metric is needed.
   - The audit notes that `bench.yml` has had no scheduled run on `main` so far. That is outside this issue, but the PR should not claim nightly coverage it cannot show.
8. **`bun test` budget.** `test_cpu_s` is budgeted at 4.1 s. The 10x timing check cannot live in `bun test`, so it is a bench phase or a script under `bench/`. Unit tests cover correctness: stored equals recomputed, late result updates, no full-window query on a restart with stored rows (for example a query spy or an `EXPLAIN`/row-count bound), retention and orphan cleanup.
9. **#513 boundary.** Today stays computed from `results` at every uncached read, as now. Do not add per-ingest incremental tallies for today here, and do not change the read cache or invalidation beyond what the stored closed days need.
10. **Docs to update.** `docs/operation.md`: the startup/cold-read timings at `:43`, a section for the new table and its backfill (log lines, schema/upgrade note), retention of its rows, and the `/readyz` statement. `docs/concepts.md`: Uptime (closed days stored once, late results still counted) and the availability line. `bench/README.md`: the cold-read phase, its metrics and its seed. Keep `src/docs-claims.test.ts` passing.

## Assumptions

- "Uptime values for 24 h, 7 d, 30 d and 90 d" means the API outputs that these windows come from: the full JSON bodies of `GET /uptime` (90 days and the 90-day `uptime`), `GET /components/uptime`, and the `slo` (30-day `availability`) in `GET /checks`, compared byte for byte on the same database file at the same clock. The last 1 and 7 days are slices of the same `days` arrays.
- "After a start" in the 400 ms criterion means the start of a database that has already been opened once by the new release, with its one-time backfill finished. This is the normal restart. The audit's own method also waited for the backfill before the first request. The first start after the upgrade is reported separately as a number and is not held to 400 ms.
- 400 ms is per request, measured from the client right after the first `200` of `/readyz`. Both the sequential and the concurrent (`/checks` + `/uptime` together) case are reported, because the concurrent case exceeded the status proxy's 4000 ms.
- The 10x seed is 20 checks x 30 days x 10 results per minute (8.64 M rows), as in the audit review. 90 days of history at 10x is not required.
- No contract (`pulse-contract`) change: the response shapes stay the same.

## Derived acceptance check

On pulse-api with the change, using a 10x seed (8.64 M results, 20 checks, 30 days):
1. Start the API on the seed, wait for the backfill-done log line(s), then stop it with `SIGTERM`.
2. Start it again. Right after the first `200` of `/readyz`, send the first `GET /checks` and the first `GET /uptime`, once one after the other and once at the same time. Each answers `200` in under 400 ms on the bench runner. The same script on `11f5555` fails (about 2.4-3.4 s each, or over 4000 ms when concurrent). Both outputs go in the PR.
3. On one database file at a fixed clock, the JSON of `GET /uptime`, `GET /components/uptime` and `GET /checks` (`slo`) is identical between `11f5555` and the change, and also during the first backfill. The diff output goes in the PR.
4. The bench gets a cold-read phase or metrics at the 10x density, with entries in `bench/budgets.json`. The PR reports startup and cold-read numbers at 1x and 10x and the budgets that move.
5. CI green, `compose-e2e` green, `bun test` CPU within `test_cpu_s`.
