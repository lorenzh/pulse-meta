# Performance audit: pulse-api (2026-10-31)

## Scope

- Issue: lorenzh/pulse-meta#503, periodic performance audit of `main` of pulse-api.
- Earlier runs: one Factory alert comment says that an earlier `run-state` job failed. That run left no report, so this report is new.
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-api | `11f555598831ef61f13de40bef5f2da620230c97` | `main`. Built, run, benched, profiled and tested in a temporary copy. |
| pulse-api (bench side A) | `8ea397ce160c7fcb8e9ba39ebfc1bd5f1d6b451d` | `bench/baseline.json` api SHA, used as side A of the local A/B |
| pulse-status | `3f80bda9d7ed17127a43bcf51b71cd1e05add9b0` | `src/poller.ts`: the routes and poll interval it reads from the API |
| pulse-notify | `584eabd05abcadc8f5a1035307e2c09a7a84c933` | `src/config.ts`: poll interval |
| pulse-meta | `395368d67da4bf969c3160c60c1345b26f1e9b8c` | this repository |

- Nightly bench that was read: run [41067380495](https://github.com/lorenzh/pulse-api/actions/runs/41067380495). It is the newest completed `bench.yml` run on `main` (`workflow_dispatch`, 2026-10-30T13:56Z, head `c282ae36190a9d22bc4a0f91e396cfc3a0da26d2`, conclusion `failure` because status and contract failed the budgets of that time). Artifact `bench-out`, api table, side B: `startup_cpu_ms` 240 ms, `load_cpu_s` 21.61 s, `idle_rss_mib` 67.17 MiB, `peak_rss_mib` 87.73 MiB, `test_cpu_s` 2.20 s, `p95_get_checks_ms` 301 ms, `p95_post_results_ms` 239 ms. It has no latency-route rows. Every api row was `ok`.
- Why the audit measured again: that run is 41 commits behind `main` (`git log c282ae3..11f5555 | wc -l` = 41). Since then the F8 latency history (#56) and the startup CPU fix (#62) were merged, the budgets were recalibrated (`7fc49c6`), and `test_cpu_s` was raised (`66a4430`). `gh run list --workflow bench.yml --event schedule` returned `[]`, so no nightly run exists for the current `main`. The audit ran one A/B, see item 3.
- Machine: GitHub-hosted runner with 4 vCPU and 16 GB RAM, Docker 28.0.4, Compose v2.38.2, Bun 1.4.0 (SQLite 3.53.2), sqlite3 CLI 3.45.1. All measurements ran in one temporary copy (`mktemp -d`) on 127.0.0.1. Numbers are comparable within this report only. The hosted nightly gives other absolute values (for example `load_cpu_s` 21.61 s there and 5.96 s here).
- Results: 3 findings: 2 `P2` and 1 `P3`. 2 are issue candidates and 1 is a note. The review raised finding 3 from `P3` to `P2`: cold reads exceeded the status proxy's 4000 ms timeout (see the finding). No item is blocked. The review removed a fourth finding, `performance-api-2026-10-31-1` (`P2`, a disk flush per ingest), because it did not reproduce (see Review). The ids of the other findings are unchanged.

## Checklist

### 1. Queries: `EXPLAIN QUERY PLAN` for every query on the request path and at startup: `checked`

Method:

- A preload (`bun --preload capture.ts src/main.ts`, kept outside the repository) wrapped `Database.prototype.prepare/query/run/exec` of `bun:sqlite`. It recorded every SQL text that ran and its first `src/` call site.
- The API ran on a copy of the 1x bench seed (20 checks, 864,000 results, the shape of `bench/seed.ts`). The config held the 20 bench checks, one heartbeat check, two components and one maintenance window.
- A driver script sent one request to every route in `docs/rest-api.md`:
  - `POST /results` with up and down results from two locations, which opened and resolved one incident;
  - every public `GET`, including the variants of `/incidents` and `/manual-incidents` and `/checks/:id/results?before=`;
  - `GET /probe/checks` and both heartbeat methods;
  - `GET /admin/config`, `POST /admin/checks` and `DELETE /admin/checks` (a hot reload);
  - every manual-incident write.

  Every answer was 2xx.
- The capture covered startup, the retention run at start, the latency backfill and heartbeat ticks.
- `bun explain.ts capture.json cap.db` then ran `EXPLAIN QUERY PLAN` on the same database for each of the 51 DML statements. Exit code 0.

Result: no statement scans `results`. Every read of `results` is a `SEARCH` on `results_by_check`, `results_by_sample` or `results_by_time`. The retention `DELETE` is a `SEARCH` by `results_by_time` with an `EXISTS` on `results_by_sample`. These lines are flagged:

| Statement (call site) | When | Plan | Rows it touches |
| --- | --- | --- | --- |
| `SELECT latency_ms FROM results WHERE check_id = ? AND timestamp >= ? AND timestamp < ? AND status != 'down' ORDER BY latency_ms` (`dayLatencies`, `src/service.ts:521`) | `GET /latency` (once per HTTP check per uncached request), `GET /checks/:id/latency`, latency backfill | `SEARCH results USING INDEX results_by_check (check_id=? AND timestamp>? AND timestamp<?)`, `USE TEMP B-TREE FOR ORDER BY` | all of today's results of the check, sorted again on each request |
| `SELECT CAST(timestamp / 86400000 AS INTEGER) AS day, SUM(status != 'down') AS good, COUNT(*) AS total FROM results WHERE check_id = ? AND timestamp >= ? AND timestamp <= ? GROUP BY day` (`dailyUptime`, `src/service.ts:515`) | `GET /uptime`, `GET /checks` (the `slo` of every check with a target), `GET /components`, `GET /components/uptime` | `SEARCH results USING INDEX results_by_check (...)`, `USE TEMP B-TREE FOR GROUP BY` | today's results, because closed days are tallied once in memory. On the first read after a start, the whole 30- or 90-day window. |
| `SELECT * FROM incidents [WHERE ...] ORDER BY (resolved_at IS NOT NULL), opened_at DESC, id DESC [LIMIT ?]` (`listIncidents`, `src/service.ts:1099`), 5 variants | `GET /incidents` (every `status`, `since` and `limit` variant), `GET /components` (open incidents) | `SCAN incidents`, `USE TEMP B-TREE FOR ORDER BY` | the whole `incidents` table. Automatic incidents are never deleted (`docs/concepts.md`, Retention). |
| `SELECT * FROM manual_incidents WHERE resolved_at IS NULL ORDER BY created_at DESC, id DESC` and the resolved variant (`src/manual-incidents.ts:103-108`) | `GET /manual-incidents`, `GET /components` | `SCAN manual_incidents`, `USE TEMP B-TREE FOR ORDER BY` | all manual incidents. Resolved ones are deleted after the retention window. |
| newest result per location (`NEWEST_PER_LOCATION_SQL`, `src/service.ts:119`) | startup, once | `SCAN locs`, `USE TEMP B-TREE FOR GROUP BY`. Every access to `results` is a `SEARCH ... results_by_sample`. | one row per (check, location) pair, not per result |
| locations of a check (`locationsOf`, `src/service.ts:498`) | `GET /checks` | `SCAN locs` (the recursive CTE). `results` is read by `SEARCH ... results_by_sample`. | one row per location |
| `SELECT ... FROM checks WHERE active = 1 [AND type = ...] ORDER BY rowid`, `UPDATE checks SET active = 0`, `clearOptions`, `resetInactiveState` (`src/service.ts:461-474, 719, 787, 795, 972, 992, 1005`) | `GET /checks`, `/uptime`, `/latency`, `/components`, `/metrics`, `/probe/checks`, heartbeat tick, startup and every config load | `SCAN checks` | one row per check ever configured (21 here) |
| `SELECT i.check_id AS id FROM incidents i JOIN checks c ON c.id = i.check_id WHERE i.resolved_at IS NULL AND c.active = 0` (`openInactive`, `src/service.ts:477`) | startup and every config load | `SCAN i` | the whole `incidents` table |
| `DELETE FROM latency_daily WHERE day < ?`, `DELETE FROM latency_daily WHERE check_id NOT IN (SELECT id FROM checks)`, `DELETE FROM manual_incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?` | retention at start and then hourly | `SCAN latency_daily`, `SCAN manual_incidents` | at most checks x 90 rollup rows |
| `SELECT 1 FROM sqlite_master LIMIT 1` (`src/db.ts:113`) | startup | `SCAN sqlite_master` | stops at the first row |

Item 3 measures the two temporary B-trees over `results` and the scan of `incidents`. They are findings 2, 3 and 4.

### 2. Startup: CPU profile (`bun --cpu-prof`) with the top functions by self time: `checked`

- Bench (item 3), `startup_cpu_ms`: side B (`main`) 205 ms (rounds 210 and 200), side A (baseline `8ea397c`) 540 ms (540 and 540). Budget 325 ms (gating): `ok`. The startup fix of #62 removed 62 %. Nightly reference (`c282ae3`, before F8): 240 ms.
- Bench `startup_wall_ms` (reported only): B 1434 ms, A 1749 ms, budget 618 ms. Without Docker, after a `sync`, the API answered `/readyz` 84 to 153 ms after the spawn in 6 runs. Most of the bench wall time is therefore container start on this runner. Notes only.
- Local CPU time at the first `200` of `/readyz` (utime + stime from `/proc/<pid>/stat`, 10 ms resolution), without the profiler: 1x seed 120, 110 and 100 ms. With 100,000 incidents: 110, 100 and 100 ms.
- Profile: `bun --cpu-prof --cpu-prof-interval=100 src/main.ts` on a copy of the seed, with `SIGTERM` right after the first `200` of `/readyz`. 3 runs per data size, exit code 0. CPU at ready under the profiler: 1x 150, 140 and 140 ms; 10x 140, 130 and 140 ms. The startup CPU does not grow with the data. Self time summed over the 3 runs of 1x (392.7 ms sampled, 1073 samples; `bun prof.ts s1-r{1,2,3}.cpuprofile`):

| Self time | Share | Function |
| --- | --- | --- |
| 40.4 ms | 10.3 % | `node:fs` module (load) |
| 37.9 ms | 9.6 % | native `run` of `bun:sqlite` (`db.run`: `BEGIN IMMEDIATE`, the schema script, `COMMIT`, `PRAGMA`s in `openDb`/`migrate`) |
| 22.3 ms | 5.7 % | `_onceWrap` `node:events` |
| 18.9 ms | 4.8 % | `setName` `node:fs` |
| 16.8 ms | 4.3 % | `startLatencyRollup` `src/latency-rollup.ts:60` |
| 14.6 ms | 3.7 % | `isServerConfig` `bun:main` |
| 10.0 ms | 2.6 % | native code under `node:_http_client` |
| 8.8 ms | 2.2 % | native code under `node:http` |
| 6.2 ms | 1.6 % | native code under `zod/v4/core/schemas.js:1199` |
| 5.5 ms | 1.4 % | `init` `zod/v4/core/core.js:50` |
| 5.4 ms | 1.4 % | `DurationFormat` under `pulse-kit/dist/format-duration.js:2` |

  At 10x the top entry is the same native `bun:sqlite` `run` (46.6 ms, 11.9 %). Module loading follows. No SQL query of the request path appears in the startup profile.
- No finding. The cold first reads after startup are finding 3.

### 3. Costs that grow with data: the repository's bench, or a local A/B with a larger data set: `checked`

**Bench A/B.** `timeout 30m bun bench/run.ts --a 8ea397ce160c7fcb8e9ba39ebfc1bd5f1d6b451d --b 11f555598831ef61f13de40bef5f2da620230c97 --rounds 2`, run in the copy: 2 rounds per side, A B A B. Exit code 1. The only failing row is outside this scope: `[bench] FAIL regression: status test_cpu_s`, 1.49 s to 1.87 s. Before that, a first attempt with `--a c282ae3` (the last benched `main`) stopped with exit code 2 (harness error) before any comparison, see Notes. The api table (medians of 2):

| Metric | A `8ea397c` | B `11f5555` | B per round | Budget | Kind | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `startup_cpu_ms` | 540 ms | 205 ms | 210, 200 | 325 ms | gating | ok |
| `load_cpu_s` | 5.96 s | 5.96 s | 6.04, 5.88 | 28.1 s | gating | ok |
| `idle_rss_mib` | 73.19 MiB | 75.38 MiB | 75.50, 75.25 | 88 MiB | gating | ok |
| `peak_rss_mib` | 93.70 MiB | 99.90 MiB | 99.17, 100.62 | 115 MiB | gating | ok |
| `test_cpu_s` | 2.38 s | 2.46 s | 2.45, 2.46 | 4.1 s | gating | ok |
| `startup_wall_ms` | 1749 ms | 1434 ms | 1786, 1082 | 618 ms | reported | over budget (see item 2) |
| `p95_get_checks_ms` | 140 ms | 161 ms | 84, 239 | 392 ms | reported | |
| `p95_post_results_ms` | 133 ms | 160 ms | 78, 243 | 312 ms | reported | |
| `p95_get_latency_ms` | 165 ms | 129 ms | 75, 183 | 53 ms | reported | over budget on A and B; cause not established, see Review |
| `p95_get_check_latency_ms` | 163 ms | 127 ms | 70, 184 | 55 ms | reported | over budget on A and B; cause not established, see Review |
| `rps` | 43.04 | 43.02 | | 40 | reported | |
| `image_mb` | 95.21 MB | 95.25 MB | | 124 MB | reported | |

**Local data growth.** A script started `bun src/main.ts` on a fresh copy of a seeded database (`sync` after the copy). It waited for the `latency rollup: backfill done` line. Then it timed each read route 30 times, each right after one `POST /results`, because an ingest clears the read cache, as it does under the bench load. 3 server runs per data set, exit code 0. Data sets:

- 1x: the bench seed (20 checks, 30 days, 1 result per minute, 864,000 rows).
- 10x: the same 20 checks and 30 days with 10 results per minute (8,640,000 rows, 1.6 GB).
- End of day: 1x plus 8,640 results for each of 3 locations in today's elapsed UTC time. That is 25,920 results per check today, the number that 3 locations at a 10 s interval produce in a full UTC day. Two layouts were measured: contiguous per check (one `INSERT` per check and location), and interleaved across checks like live ingest (one cross-join `INSERT`, measured with `curl -w %{time_total}`).
- 1x plus 100,000 resolved incidents.

The measurements ran around 06:08 to 06:34 UTC, so the 1x and 10x seeds held about 370 and 3,700 results per check for today.

| Cost (median of 3 runs) | 1x | 10x | end of day, contiguous | end of day, interleaved | 1x + 100k incidents |
| --- | --- | --- | --- | --- | --- |
| CPU at first `/readyz` 200 | 100-120 ms | 130-140 ms (profiler; 1x under the profiler 140-150) | 100 ms | - | 100-110 ms |
| latency backfill, 1780 rollup days: CPU | 760-800 ms | 3,540-3,640 ms | - | - | - |
| latency backfill: wall (yields per day) | 4.3-11.0 s | 8.4-13.6 s | 4.7-8.4 s | 6.7-7.8 s | 7.2-10.2 s |
| first `GET /checks` after start (30-day SLO, cold) | 206.7 ms | 2,354.4 ms | 455.2 ms | 608-612 ms | - |
| first `GET /uptime` after start (rest of 90 days, cold) | 211.0 ms | 2,412.2 ms | 461.8 ms | 615-619 ms | - |
| `GET /checks` after an ingest | 3.1 ms | 18.6 ms | 195.5 ms | 344.7 ms | 3.5 ms |
| `GET /uptime` after an ingest | 2.6 ms | 17.9 ms | 193.9 ms | 341.4 ms | 2.9 ms |
| `GET /latency` after an ingest | 3.8 ms | 26.2 ms | 266.3 ms | 424.0 ms | 4.2 ms |
| `GET /checks/c0/latency` after an ingest | 0.4 ms | 1.4 ms | 13.2 ms | - | 0.4 ms |
| `GET /components` | 2.5 ms | 17.8 ms | 194.1 ms | - | 6.5 ms |
| `GET /components/uptime` | 2.4 ms | 17.7 ms | 194.0 ms | 341.0 ms | 2.8 ms |
| `GET /incidents?status=open` | 0.2 ms | 0.2 ms | 0.2 ms | - | 3.7 ms |
| `GET /incidents?status=resolved` | 0.2 ms | 0.2 ms | 0.2 ms | - | 8.2 ms |
| `GET /checks/c0/results` | 0.3 ms | 0.3 ms | 0.3 ms | - | 0.4 ms |
| RSS at ready / after the reads | 60 / 91-95 MiB | 60 / 90-91 MiB | 60-61 / 86-89 MiB | - | 63 / 88-92 MiB |

How the costs scale:

- Every route that aggregates `results` (`/checks`, `/uptime`, `/latency`, `/components`, `/components/uptime`) grows linearly with the number of results of the current UTC day. Across the day, every 25,920 results per check add about 340 ms per request on the interleaved layout. The per-request cost is never cached under load, because each ingest clears the cache (`src/service.ts:422`, `880`). This is finding 2.
- The first `GET /checks` and the first `GET /uptime` after a start grow with the whole 30- and 90-day history: about 0.27 µs per stored result. This is finding 3.
- `GET /incidents` and `GET /components` grow with the number of automatic incidents ever opened. This is finding 4.
- `/checks/:id/results`, `POST /results`, startup CPU and RSS do not grow with the data.
- The latency backfill grows linearly (CPU about 4.6x for 10x the rows). It yields after every (check, day), so no request waits for more than one day of one check. No finding.
- The ingest commit cost does not depend on the data size.

### 4. Memory over time: RSS after N minutes of steady load, against the RSS at the start: `checked`

- Command: `timeout 540 bun mem.ts <api copy> <1x seed dir> 5`, exit code 0. It starts `bun src/main.ts` on a copy of the 1x seed and waits 15 s, which is past the latency backfill. Then it runs the bench load rates of `bench/load.ts` open loop for N = 5 minutes: 30 `POST /results` (3 probe tokens, 20 checks), 10 `GET /checks`, 1 `GET /uptime`, 1 `GET /latency` and 1 `GET /checks/:id/latency` per second. 12,880 requests, 0 failed. `VmRSS` and `VmHWM` come from `/proc/<pid>/status` every 30 s.
- RSS at the start: 65.4 MiB (59.4 MiB at ready). Under load: 79.4, 81.6, 81.9, 84.4, 89.7, 86.3, 84.2, 81.9, 88.0 and 88.6 MiB at +30 ... +300 s. 30 s after the load: 77.4 MiB. `VmHWM` 92.4 MiB. CPU 30.04 s in 300 s of load, which is 6.0 s per minute and matches the bench `load_cpu_s` of 5.96 s.
- RSS rose by 14 to 24 MiB in the first minute and then moved within 79 to 90 MiB with no steady growth. It fell to 77.4 MiB once the load stopped.
- Budgets: idle 65.4 MiB against `idle_rss_mib` 88 MiB; peak 92.4 MiB against `peak_rss_mib` 115 MiB. The bench gave 75.38 and 99.90 MiB. No finding for memory.

### 5. Tests: CPU time per test file; the slowest files: `checked`

- Whole suite: `/usr/bin/time -f '%U %S %e' bun test`, 3 runs, exit code 0 (`390 pass, 0 fail`, 54 files). CPU 2.50 s (2.08 + 0.42), 2.44 s and 2.53 s. Budget `test_cpu_s` 4.1 s: `ok`. Bench B 2.46 s.
- Per file: `/usr/bin/time -f '%U %S %e' bun test ./<file>` for each of the 54 files, 3 runs. Exit code 0 for 7 files. The other 47 exit with code 1 only because of the 80 % coverage threshold of `bunfig.toml` on a one-file run; all of their tests pass. Medians of user + sys CPU:

| File | CPU (median of 3) |
| --- | --- |
| `src/uptime.test.ts` | 0.57 s |
| `src/main.test.ts` | 0.53 s |
| `src/config-admin.test.ts` | 0.44 s |
| `src/start.test.ts` | 0.34 s |
| `src/server.manual-incidents.test.ts` | 0.24 s |
| `src/slo.test.ts` | 0.20 s |
| `src/latency.test.ts` | 0.18 s |
| `src/server.test.ts` | 0.17 s |
| `src/start.audit-log.test.ts` | 0.16 s |
| `src/server.heartbeat.test.ts` | 0.14 s |

  The fastest files (`state`, `docs-claims`, `db`) take 0.01 to 0.02 s. The per-file sum is 6.54 s, against 2.5 s for the suite in one process, because every file run repeats Bun startup and module loading. No finding.

### 6. pulse-website only: JS and CSS size against the budget; Lighthouse of Home and Hosted: `not applicable`

The scope of this audit is pulse-api. It serves JSON and has no JS or CSS bundle and no web pages.

## Issue candidates

### performance-api-2026-10-31-2 (P2): uncached reads re-aggregate all of today's results; by the end of a UTC day each status-page read takes 0.34 to 0.42 s

- Location: `src/service.ts:838` (`latencyOf` sorts today's latencies again with `rollupOfDay(checkId, today)`), `src/service.ts:521` (`dayLatencies`, `USE TEMP B-TREE FOR ORDER BY`) and `src/service.ts:765` (`dailyUptime` for today, `USE TEMP B-TREE FOR GROUP BY`). The cache is cleared on every ingest (`src/service.ts:880`, documented in `docs/rest-api.md`, Read cache).
- Command:
  1. `bun bench/seed.ts . <dir>/pulse.db` and the bench fixtures for the checks and tokens files.
  2. `sqlite3 <dir>/pulse.db < eod.sql`. The SQL adds 8,640 results for each of 3 locations (`sim0`..`sim2`) per check, spread over today's elapsed UTC time. That is 25,920 results per check today, which 3 locations at a 10 s interval produce in a full UTC day:

     ```sql
     INSERT INTO results (check_id, timestamp, status, status_code, latency_ms, location, attempts)
     WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 8639),
       d(sod, step) AS (SELECT (unixepoch() / 86400) * 86400000, ((unixepoch() % 86400) * 1000 - 60000) / 8640),
       l(loc, o) AS (VALUES ('sim0', 0), ('sim1', 1), ('sim2', 2))
     SELECT c.id, d.sod + l.o + n.i * d.step, 'up', 200, 5 + ((n.i * 7) % 300), l.loc, 1 FROM checks c, l, n, d;
     ```

  3. Start `PORT=3995 PULSE_DB=... PULSE_CHECKS_FILE=... PULSE_TOKENS_FILE=... bun src/main.ts` and wait for `backfill done`.
  4. 30 times per route: one `curl -X POST /results`, then `curl -w '%{time_total}' GET <route>`.

  3 server runs. Exit code 0.
- Excerpt:

```
results today per check: 26313
GET /checks after an ingest: n=30 median 344.2 ms p95 348.6 ms
GET /uptime after an ingest: n=30 median 341.2 ms p95 344.8 ms
GET /latency after an ingest: n=30 median 419.1 ms p95 426.6 ms
GET /components/uptime after an ingest: n=30 median 341.0 ms p95 346.0 ms
(1x seed, 391 results per check today: /checks 3.6 ms, /uptime 3.0 ms, /latency 4.7 ms, /components/uptime 2.9 ms)
```

- Value: median `GET /latency` 424.0 ms and median `GET /checks` 344.7 ms. Medians of the 3 runs: `/latency` 427.3, 419.1 and 424.0 ms; `/checks` 356.3, 344.2 and 344.7 ms. When each check's rows are stored contiguously, the values are 266.3 and 195.5 ms (item 3). The difference comes from the live, interleaved layout of the rows.
- Repetitions: 3 server runs x 30 requests per route.
- Baseline: the 1x bench seed (391 results per check today): 4.7 ms for `/latency` and 3.6 ms for `/checks`.
- Budget: `p95_get_latency_ms` 53 ms (reported): one unloaded request takes 8 times the budget. `p95_get_checks_ms` 392 ms (reported): one unloaded request takes 88 % of the budget.
- Why it matters: the cost rises linearly from 00:00 UTC to the end of the day. The status page polls `/checks`, `/components` and `/components/uptime` every 5 s by default (`pulse-status` `src/poller.ts:326-340`; `/uptime` and, when enabled, `/latency` are read at lines 229 and 250). With 6 ingests per second, every poll misses the cache, so the API's one thread is busy for about 1 s of every 5 s for one status page. Ingests and other reads wait meanwhile.
- Review reproduction (`audit-review`, commit `11f5555`, another runner): the report's `eod.sql`, run unchanged on a copy of the 1x seed, gives 26,323 results for `c0` today. The rows are interleaved across checks (rowid order `c0/sim0 c1/sim0 c10/sim0 ...`). The checks file holds the bench fixtures plus two components of 10 checks each. Then `bun reads.ts <api copy> <db> <cfg> 3995 30`: start, wait for `backfill done`, then 30 times per route one `POST /results` and one timed `GET`. 3 server runs, exit code 0 each. Medians of the 3 runs: `/checks` 417.1, 417.4 and 418.5 ms; `/uptime` 418.7, 415.2 and 416.8 ms; `/latency` 528.8, 529.1 and 522.5 ms; `/components` 417.9, 418.3 and 418.9 ms; `/components/uptime` 417.2, 419.9 and 418.1 ms. On the 1x seed (613 results per check today), 2 runs: `/checks` 4.0 and 4.1 ms, `/latency` 5.4 and 5.5 ms, `/components/uptime` 3.4 and 3.5 ms. The deviation reproduces. It is about 20 % above the audit's values on this runner (the whole test suite also took 3.45 s of CPU here, against 2.5 s). At this density, one unloaded `GET /checks` (417 ms) is also over the `p95_get_checks_ms` budget of 392 ms.
- Fix direction: keep running per-day aggregates instead of reading them again, for example a running good/total count for today, as the closed days already have, and today's latency percentiles from a bounded or incremental structure. Alternatively, let an ingest invalidate only what it changes. A bench seed with today's density, in `bench/seed.ts`, would make the cost visible.

### performance-api-2026-10-31-3 (P2): the first `GET /checks` and the first `GET /uptime` after a start read the whole 30- and 90-day window in one synchronous call

- Location: `src/service.ts:757` (`uptimeOf`: after a start, `closedTallies` is empty, so `firstRead` is the first day of the window and one `dailyUptime` query aggregates all of it).
- Command: the growth script of item 3: a fresh copy of the seeded database, start, wait for the backfill, then the first request to each route. 3 runs per data set, exit code 0. Also the `curl` reproduction of finding 2: `cold GET /checks`.
- Excerpt: `1x: /checks max 206.2, 209.9, 206.7 ms; /uptime max 210.9, 211.0, 214.6 ms` and `10x: /checks max 2356.0, 2352.2, 2354.4 ms; /uptime max 2414.6, 2408.4, 2412.2 ms` (the maximum of each run is its first, cold request; the later requests take 18.6 and 17.9 ms). The `curl` reproduction gave `cold GET /checks 200 0.208754 s` (1x) and `cold GET /checks 200 0.608469 s` (1x plus a full day at 3 locations).
- Value: 2,354.4 ms for the first `GET /checks` at 10x, then 2,412.2 ms for the first `GET /uptime`.
- Repetitions: 3 runs per data set.
- Baseline: 206.7 ms and 211.0 ms at 1x.
- Budget: `p95_get_checks_ms` 392 ms (reported). This is one request per start, so the bench p95 does not show it.
- Why it matters: the call runs on the API's only thread. After every restart, all requests wait behind it, including the probes' `POST /results`: about 4.8 s at 10x the bench data. The bench seed covers 30 days, so a 90-day history at the default retention gives longer stalls.
- Fix direction: build the closed-day tallies in batches with yields after the start, as the latency backfill does, or store them per day like `latency_daily`.
- Review spot check (`bun reads.ts`, as for finding 2, exit code 0): the first `GET /checks` and the first `GET /uptime` took 277.4/271.2 ms and 284.7/275.8 ms at 1x (2 runs). At the end-of-day density they took 754.9/746.3, 759.7/753.5 and 755.1/773.0 ms (3 runs). At 10x (8,640,000 rows: the 1x seed plus 9 more results per minute, added with `sqlite3`) they took 3,373.1 and 3,447.4 ms, after which `GET /checks` took 29.9 ms (1 run). The growth holds.
- Review re-measurement (cold reads against the status proxy timeout, commit `11f5555`): the bench seed plus one day of 20 checks × 3 locations × 10 s samples. After a start, one cold `GET /checks` and one cold `GET /uptime` ran concurrently through `curl`; then the same requests ran cached. Command: `timeout 90 bun tmp/cold-timeout.ts`, exit code 1, 2 repetitions. Excerpt: `run 1: /uptime curl exit 28, 4002 ms, 0 bytes received`, `run 2: /uptime curl exit 28, 4003 ms, 0 bytes received`, `AssertionError: cold public reads exceed the status proxy default 4000 ms timeout`. Cached, the same requests took 5 to 21 ms. pulse-status (`3f80bda`) gives up on pulse-api after 4000 ms by default: `src/server.ts:71` (`DEFAULT_UPSTREAM_TIMEOUT_MS = 4000`), `src/settings.ts:71` (`PULSE_STATUS_UPSTREAM_TIMEOUT_MS` fallback 4000), `docs/configuration.md:17` and `docs/operation.md:138` (the proxy then answers `502` `API unreachable`). So after a restart at the bench's own density, the status page's first poll fails with a `502`. Absolute timings depend on the host. The severity rises to `P2`.

## Notes

- **performance-api-2026-10-31-4 (P3, note): `GET /incidents` and `GET /components` scan and sort the whole `incidents` table.**
  - Location: `src/service.ts:1099`. The only index is `incidents_check_id` (`src/db.ts:56`), and automatic incidents are never deleted.
  - Measurement: growth script, 1x plus 100,000 resolved incidents, 3 runs.
  - Results: `/incidents?status=resolved` went from 0.2 to 8.2 ms (medians 8.1, 8.2, 8.2), `/incidents?status=open` from 0.2 to 3.7 ms, and `/components` from 2.5 to 6.5 ms. Startup CPU did not change (100-110 ms).
  - Assessment: realistic incident counts are far lower, so this is a corner case. A partial index on open incidents and an index on `opened_at` would remove the scan.
  - Review spot check: `EXPLAIN QUERY PLAN` of the `status=open` and `status=resolved` variants gives `SCAN incidents` and `USE TEMP B-TREE FOR ORDER BY`, as reported. The 1x seed got 100,000 resolved incidents (`sqlite3 ... INSERT INTO incidents ... WITH RECURSIVE`, one per second over 28 hours, 20 days ago). With them, `GET /incidents?status=resolved` (default limit 1000) took a median of 80.5 ms (p95 82.5 ms, n = 30, 1 run). The same query directly in `bun:sqlite` took 78.8 to 81.6 ms (5 runs). `GET /components` took 8.4 ms, against 3.5 ms without the incidents. The growth holds. The review's value is 10 times the audit's 8.2 ms; the incident rows the two used differ. It stays `P3`: it needs 100,000 incidents.
- **Bench harness, side A older than `8ea397c`.** `timeout 30m bun bench/run.ts --a c282ae36190a9d22bc4a0f91e396cfc3a0da26d2 --b 11f5555... --rounds 2` ended with exit code 2 and `bench: api was not ready within 120 s`. The failure log shows `pulse-api: /config/checks.json: unknown key "availabilityTarget" in checks[0]`. `bench/fixtures.ts:12` writes `availabilityTarget` for every check, and an API before F8 rejects that key. `OPTIONAL_ROUTES` handles only the routes. The default side A (`bench/baseline.json`, `8ea397c`) is not affected. The audit counted this attempt as harness setup, not as a comparison, and then ran the A/B with A = `8ea397c`.
- **No nightly bench of the current `main`.** `bench.yml` exists since 2026-10-30T13:55Z (`gh api .../workflows/bench.yml`: `state: active`). `gh run list --workflow bench.yml --event schedule` returned no run. The only completed run on `main` is the manual run 41067380495. A budget breach on `main` therefore stays unseen until someone starts a run by hand.
- **Outside the scope (pulse-status).** The A/B reported `status test_cpu_s` 1.49 s (A) against 1.87 s (B), `FAIL regression`, under the status budget of 2.40 s. It is a status repository change and was not examined further.
- `startup_wall_ms` (1434 ms on B) is over its reported budget of 618 ms in the local Docker run. Without Docker the API was ready 84 to 153 ms after the spawn. This is container start on this runner, not API work. Not a finding.
- `GET /checks` (`computeChecks`), `/uptime`, `/latency`, `/metrics` and `/probe/checks` call `db.prepare(...)` on every uncached request instead of reusing a prepared statement (`src/service.ts:719, 787, 795, 972, 992, 1005`). The cost was not measured on its own and is small next to finding 2.
- The latency backfill after a start (1,780 rollup days for 20 checks) took 4.3 to 11.0 s wall and about 0.78 s CPU at 1x, and 8.4 to 13.6 s wall and about 3.6 s CPU at 10x. Each (check, day) is its own batch with a yield after it.
- Method caveats:
  - Local numbers come from one runner and do not compare with the hosted nightly.
  - The 10x startup CPU of the growth script (170 ms) was inflated by the writeback of the freshly copied 1.6 GB file. Only the profiler runs, which ran after a `sync`, are used for 10x startup.
  - The capture for item 1 ran during the first bench attempt, which failed before its first measurement. Nothing CPU-heavy ran during the A/B that this report uses.
- Cleanup: every API instance was stopped with `SIGTERM` (log line `stopped`). The bench removed its Compose stacks. The 8 `pulse-bench-*` images, the temporary copy, the seeds, the downloaded artifacts and `/dev/shm/audit503` were deleted at the end of the run.

## Review

`audit-review` re-ran the findings in a copy of pulse-api at `11f555598831ef61f13de40bef5f2da620230c97`, the `HEAD` of the clone. The runner had 4 vCPU and 16 GB, Bun 1.4.0 and SQLite 3.53.2. The root file system (ext4) is mounted with `nobarrier,data=writeback`. The scripts and data were kept under `mktemp -d` and deleted at the end. The review did not run the Docker bench A/B: a run takes longer than one foreground command may, and this state starts no background tasks. Its own measurements below replace it.

### Removed: performance-api-2026-10-31-1 (was `P2`, a synchronous disk flush per ingest)

The finding said that each `POST /results` commit, with the rollback journal and the default `synchronous` (FULL), blocks the event loop on a disk flush. It said this lifts the p95 of every route to about 180-250 ms at the bench rates, against 1.9-15.3 ms on tmpfs. That did not reproduce.

- The defaults hold: `bun:sqlite` on the seeded file gives `PRAGMA synchronous` = 2 and `journal_mode` = `delete`, and `src/` sets neither.
- Command: `timeout 200 bun load.ts <api copy> <db> <seed dir> <port> 60`. It starts `bun src/main.ts` on a copy of the 1x bench seed (`bun bench/seed.ts`, 864,000 rows) and waits for `backfill done`. Then it runs the `bench/load.ts` rates open loop for 60 s: 30 `POST /results` from 3 probe tokens, 10 `GET /checks`, 1 `GET /uptime`, 1 `GET /latency` and 1 `GET /checks/c0/latency` per second. Exit code 0 in every run, 0 failed requests.

```
disk, run 1:  POST /results p50 2.0 ms p95 2.9 ms | GET /checks p95 9.0 ms | GET /uptime p95 13.6 ms | GET /latency p95 23.2 ms | GET /checks/c0/latency p95 23.9 ms | cpu 7.50 s
disk, run 2:  POST /results p50 2.1 ms p95 3.2 ms | GET /checks p95 9.9 ms | GET /uptime p95 12.7 ms | GET /latency p95 19.5 ms | GET /checks/c0/latency p95 20.0 ms | cpu 7.57 s
tmpfs:        POST /results p50 1.0 ms p95 1.2 ms | GET /checks p95 7.8 ms | GET /uptime p95 11.9 ms | GET /latency p95 19.2 ms | GET /checks/c0/latency p95 19.8 ms | cpu 7.27 s
disk while a 6 GB file was written back in parallel (dd, no sync):
              POST /results p50 1.8 ms p95 4.9 ms | GET /checks p95 10.7 ms | GET /uptime p95 277.0 ms | GET /latency p95 284.9 ms | GET /checks/c0/latency p95 285.6 ms
```

- `strace -f -c -e trace=fsync,fdatasync,unlink,unlinkat` on the API during 20 s of the same load: 9,520 `fsync` and 2,380 `unlink` calls. That is 4 `fsync` per commit and the deletion of the journal. The `fsync` calls took 27 µs on average, 0.26 s in total. (strace slows the API down, so the latencies of that run are not used.)
- Result: the flush per ingest exists. On this disk it adds about 1 ms to the `POST /results` median, and nothing measurable to the reads: disk and tmpfs p95 are within 0.3 ms for `GET /latency` (19.5 against 19.2 ms). Every route stays far within its budget. The audit's 180-250 ms did not reproduce on an idle disk. Even with heavy writeback in parallel, only a few stalls appeared: `POST /results` p95 stayed at 4.9 ms. The cost depends on the `fsync` latency of the disk. This review cannot show it as a finding on a disk with a slow flush.
- The bench A/B values `p95_get_latency_ms` 129 ms and `p95_get_check_latency_ms` 127 ms stay in item 3 as the audit measured them. They are over their reported budgets on both A and B. Their cause in the Docker bench stack is not established: the same rates without Docker gave 19-24 ms here.

### Reproduced and spot-checked

- performance-api-2026-10-31-2 (`P2`): reproduced. The values are in the finding: `GET /checks` 417 ms and `GET /latency` 529 ms after an ingest at the end-of-day density, against 4.0 and 5.4 ms at 1x. The severity stays. The case is the bench's own load: 3 locations, a 10 s interval (as `checks.example.json` uses) and 20 checks. Every status-page poll pays it after any ingest. At the end of the day, one unloaded `GET /checks` is over `p95_get_checks_ms`, and `GET /latency` is 10 times `p95_get_latency_ms`.
- performance-api-2026-10-31-3 (`P2`, raised from `P3`): the spot check and the re-measurement are in the finding. 1x 0.28 s, 10x 3.4 s for the first `GET /checks`. With one day of bench-density data, concurrent cold `GET /checks` and `GET /uptime` exceeded the status proxy's default 4000 ms timeout in both repetitions (4002 and 4003 ms, 0 bytes), so the first status-page poll after a restart fails.
- performance-api-2026-10-31-4 (`P3`): the spot check is in the note. The plan holds; the review measured a larger cost (80.5 ms) than the audit did (8.2 ms).
- Item 1: `EXPLAIN QUERY PLAN` of `dayLatencies`, `dailyUptime` and both `listIncidents` variants gives the plans of the table.
- Item 5: `/usr/bin/time bun test`, exit code 0: 390 pass, CPU 2.90 + 0.55 s (budget 4.1 s). `src/uptime.test.ts` 0.79 s, `src/main.test.ts` 0.75 s and `src/state.test.ts` 0.02 s, the same order as in the table.
