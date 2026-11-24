# Performance audit: pulse-api (2026-11-24)

## Scope

- Audit date: 2026-11-24 (UTC). Issue: lorenzh/pulse-meta#984, periodic performance audit of `main` of pulse-api.
- Earlier runs of this issue: none. The issue comments hold only the Factory claim of this run. This report replaces the audit of 2026-10-31 (#503). Its findings were measured again on the commit below, not copied; see Notes for their status.
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-api | `8959e0469a7b7a16e2329e968a7c42e176d287c6` | `main`. Installed (`bun install --frozen-lockfile`), run, profiled and tested in a temporary copy. |
| pulse-kit (dependency of pulse-api) | `c6d2cba7d90c981b884dcac2a9288dd9eccad8b5` | the version pinned in pulse-api's `package.json`, as installed under `node_modules`: `dist/index.js`, `dist/format-duration.js` |
| pulse-status | `f220fbc27a2d733e583aba63e5949062f29d9861` | `src/poller.ts`, `src/settings.ts`: which API routes the status page polls, and how often |
| pulse-console | `b6c737d49ba7e3fe734c332304cb908d7f820804` | `src/check-read.ts`: the console reads `GET /checks/:id/location-uptime` |
| pulse-meta | `65b03892e525f495b338965dee780f35a440e0f7` | this repository |

- Nightly bench that was read: run [45394568321](https://github.com/lorenzh/pulse-api/actions/runs/45394568321) of `bench.yml`. It is the newest completed run on `main`: `schedule`, created 2026-11-24T12:32:55Z. Conclusion `failure`, because of the `test_cpu_s` budgets of probe, status and notify (finding 3). Side A is api `v0.1.1` and side B is `main`. Both resolve to `8959e04`, the examined commit, with 5 rounds per side. Every api row is `ok` or `reported`. The api medians of side B are in item 3. The api rows of the 7 runs before it were also read; they are in item 3 and finding 5.
- Why no A/B was run: the nightly run measured exactly the examined commit, with 5 rounds per side, and no api metric deviates from its budget or its baseline. Side A, the same commit, differs by at most 7 % on the gating rows. The exception is `cold_read_cpu_ms`: 40 against 30 ms, one 10 ms CPU tick. The local measurements below agree with it. The checklist items without a bench metric were measured locally, without Docker.
- Machine of the local measurements: GitHub-hosted runner, 4 vCPU (Intel Xeon 6975P-C), 15.7 GB RAM, Bun 1.4.0, SQLite 3.53.2 (from `bun:sqlite`). All runs used one temporary copy (`mktemp -d`) and `127.0.0.1`. The numbers compare within this report, not with the hosted nightly: for example startup CPU is 110-120 ms here and 250 ms in the nightly's container.
- Results: 5 findings: 1 `P2` and 4 `P3`. 4 are issue candidates (1-4) and 1 is a note (5). No item is blocked.

## Checklist

### 1. Queries: `EXPLAIN QUERY PLAN` for every query on the request path and at startup: `checked`

Method:

- A preload, `capture.ts`, was kept outside the repository. It wrapped `prepare`, `query`, `run` and `exec` of `bun:sqlite`'s `Database.prototype` and recorded each SQL text with its first non-test `src/` call site.
- `CAPTURE_OUT=... bun test --preload capture.ts` ran pulse-api's own test suite: exit code 0, `928 pass, 0 fail`, 100 files. Its route tests start the real server and drive it over HTTP (`docs/development.md`, Test). The capture also holds statements of the startup, both backfills, retention, the heartbeat evaluator, the backup and the migrations.
- Coverage cross-check: `grep` found 131 call sites of `db.prepare/query/run/exec` in `src/*.ts` outside tests. The capture reached all 131, within 3 lines of the call. It recorded 206 (statement, call site) pairs.
- `bun explain.ts capture.jsonl <1x seed> explain.json` then ran `EXPLAIN QUERY PLAN` for each of the 162 distinct DML statements, on the 1x bench seed made by `bun bench/seed.ts . <db>` (20 checks, 864,000 results, schema of this commit). Exit code 0, 0 errors. 72 statements have a `SCAN` or a `USE TEMP B-TREE`.
- The app never runs `ANALYZE`, so the plans do not depend on the data.

Result: every read of `results` on the request path is a `SEARCH` on `results_by_check` or `results_by_sample`. The retention delete is a `SEARCH r USING INDEX results_by_time` with an `EXISTS` on `results_by_sample`. The flagged statements, grouped by where they run:

| Statement (call site) | When it runs | Plan | Rows it touches |
| --- | --- | --- | --- |
| `SELECT * FROM incidents [WHERE resolved_at IS [NOT] NULL \| (opened_at >= ? OR resolved_at >= ? OR resolved_at IS NULL)] ORDER BY (resolved_at IS NOT NULL), opened_at DESC, id DESC [LIMIT ?]` (`listIncidents`, `src/service.ts:1458`), 7 variants | `GET /incidents` (every variant). The status page sends `?status=open` and `?status=resolved` on every poll. `GET /components` reads the open ones. | `SCAN incidents`, `USE TEMP B-TREE FOR ORDER BY` | the whole `incidents` table. Automatic incidents are never deleted. **Finding 4.** |
| `SELECT location, SUM(status != 'down'), COUNT(*) FROM results WHERE check_id = ? AND timestamp >= ? AND timestamp <= ? GROUP BY location` (`locationTally`, `src/service.ts:638`) | `GET /checks/:id/location-uptime`: today on every uncached request (`src/service.ts:1044`), and a closed day whose location rows are incomplete | `SEARCH results USING INDEX results_by_check (...)`, `USE TEMP B-TREE FOR GROUP BY` | all of today's results of the check. **Finding 1.** |
| `SELECT CAST(timestamp / 86400000 AS INTEGER) AS day, SUM(...), COUNT(*) ... GROUP BY day` (`dailyUptime`, `src/service.ts:604`) | the read path for closed days that have no `uptime_daily` row (`loadClosedDays`, `src/service.ts:909`): after each UTC midnight, and on the first start without stored tallies. Also the hourly uptime backfill, with yields. | `SEARCH results USING INDEX results_by_check (...)`, `USE TEMP B-TREE FOR GROUP BY` | every result of the missing days. **Finding 2.** |
| `SELECT latency_ms FROM results WHERE check_id = ? AND timestamp >= ? AND timestamp < ? AND status != 'down' ORDER BY latency_ms` (`dayLatencies`, `src/service.ts:647`) | `fillRollups` for closed days without a `latency_daily` row (`src/service.ts:1131`): after each UTC midnight. `todayRollup`: once per check per process and day. The hourly latency backfill. | `SEARCH results USING INDEX results_by_check (...)`, `USE TEMP B-TREE FOR ORDER BY` | all results of the day, sorted. **Finding 2.** |
| `SELECT ... FROM audit_log [WHERE target_id = ? \| actor_token_id = ? \| action = ? \| target_kind = ? \| at >= ?] ORDER BY id DESC LIMIT ?` (`src/audit-log.ts:125`) | `GET /admin/audit` and `/admin/audit/export` with a filter (admin only) | `SCAN audit_log` (walks rowid order until `LIMIT` matches). The variant with `at >= ? AND at < ?` uses `SEARCH audit_log_by_at` plus `USE TEMP B-TREE FOR ORDER BY`. | up to the whole `audit_log`: "Entries are never deleted" (`docs/rest-api.md:603`). Not measured; see Notes. |
| `manual_incidents` reads and the retention delete (`src/manual-incidents.ts:189-223`) | `GET /manual-incidents`, `GET /components`, admin routes, retention | `SCAN manual_incidents`, `USE TEMP B-TREE FOR ORDER BY` | bounded: resolved ones are deleted after the retention window, and drafts are capped at 100 |
| `resend_commands` / `resend_requests` (`src/runtime-store.ts:204, 239, 251, 272, 278, 300, 301`) | resend routes and notify's claim | `SCAN`, `USE TEMP B-TREE FOR ORDER BY` | bounded: 1,000 commands and 10,000 request ids (`docs/rest-api.md:593`) |
| `SELECT ... FROM checks WHERE active = 1 [AND type = ...] ORDER BY rowid` (`src/service.ts:848, 1068, 1081, 1289, 1309, 1322`) and the token, check-definition, maintenance-definition, notify-channel and settings reads (`src/token-store.ts:164, 170, 304, 347`, `src/token-import.ts:43, 50`, `src/check-store.ts:144`, `src/maintenance-store.ts:85, 92`, `src/runtime-store.ts:73, 86, 117`, `src/audit-log.ts:197`) | per uncached read, `/probe/checks`, heartbeat tick, token auth reload, admin routes | `SCAN <table>`, some with `USE TEMP B-TREE FOR ORDER BY` | one row per configured check, token, definition or channel |
| newest result per location (`NEWEST_PER_LOCATION_SQL`, `src/service.ts:681`) and `locationsOf` (`src/service.ts:583`) | startup once, and `GET /checks` | `SCAN locs` (the recursive CTE), `USE TEMP B-TREE FOR GROUP BY`. Every access to `results` is a `SEARCH ... results_by_sample`. | one row per (check, location) |
| `clearOptions`, `deactivateAll`, `resetInactiveState`, `resolveInactiveIncidents`, `openInactive` (`src/service.ts:545-561`) | startup and every config load | `SCAN checks`. `openInactive`: `SCAN i` (incidents). | `checks`; `openInactive` reads all of `incidents` once per load |
| retention of the rollup tables (`src/service.ts:620, 621, 643, 644, 659, 660`) | retention at start and then hourly | `SCAN uptime_daily`, `SCAN uptime_location_daily`, `SCAN latency_daily` | at most checks x 90 rows (x locations) |
| `SELECT 1 FROM sqlite_master LIMIT 1` (`src/db.ts:124`); `countDuplicates` (`src/db.ts:108`) and migration 2 (`DELETE ... NOT IN (SELECT MIN(id) ... GROUP BY ...)`) | startup; the last two only when a file below schema step 2 is upgraded | `SCAN sqlite_master`; `SCAN results [USING COVERING INDEX]` | `sqlite_master` stops at the first row. The migration scans run once per upgrade. |
| `SELECT COUNT(*) FROM results` etc. (`countRows`, `src/backup.ts:165`) | the backup command (`bun run backup`), not the server | `SCAN results USING COVERING INDEX results_by_time` | all results, once per backup |

### 2. Startup: CPU profile (`bun --cpu-prof`) with the top functions by self time: `checked`

- Nightly 45394568321, `startup_cpu_ms`: B 250 ms (rounds 240-250), A 250 ms. Budget 325 ms (gating): `ok`. `startup_wall_ms` B 426 ms against a reported budget of 618 ms.
- Local CPU at the first `200` of `/readyz`, from utime + stime in `/proc/<pid>/stat` (10 ms resolution), without the profiler: `bun ready-cpu.ts <api> <dir> <1x seed> 10`, 4 rounds of 10 starts, exit code 0. 1x: round medians 120, 110, 110 and 110 ms (values 110-130 ms), wall medians 88-90 ms. 10x (`bench/cold-read.ts`, 8,640,000 rows): 120 ms in all 3 starts. **The startup CPU does not grow with the data.**
- Profile: `bun prof.ts <api> <dir> <seed> <label> 3`. It runs `bun --cpu-prof --cpu-prof-interval=100 --cpu-prof-dir=<dir> src/main.ts` and sends `SIGTERM` at the first `200` of `/readyz`. 3 runs per data size, exit code 0 each. CPU at ready under the profiler: 1x 150, 140 and 150 ms; 10x 140, 140 and 150 ms. Self time over the 3 runs of 1x (1,091 samples, 332.8 ms sampled):

| Self time | Share | Function |
| --- | --- | --- |
| 67.7 ms | 20.3 % | native code with no JS caller (module loading, runtime) |
| 47.6 ms | 14.3 % | `DurationFormat` (native), under `findFormatter` `@lorenzh/pulse-kit/dist/format-duration.js:2` |
| 23.7 ms | 7.1 % | module body of `@lorenzh/pulse-kit/dist/address-guard.js` |
| 10.3 ms | 3.1 % | `Socket` `node:net` |
| 10.1 ms | 3.0 % | zod-generated code under `zod/v4/core/schemas.js:1199` (schema compile) |
| 7.8 ms | 2.4 % | `runChecks` `zod/v4/core/schemas.js:34` |
| 7.7 ms | 2.3 % | `push` (native) under `src/config.ts:356` |
| 5.3 ms | 1.6 % | `init` `zod/v4/core/core.js:50` |
| 3.5 ms | 1.0 % | `toISOString` under `timeOf` `pulse-kit/dist/logger.js:69` |
| 3.2 ms | 1.0 % | `pulse-kit/dist/run-service.js:36` |
| 2.3 ms | 0.7 % | `prepare` (native) under `createService` `src/service.ts:405` |

  At 10x (1,105 samples, 329.1 ms): `DurationFormat` 70.1 ms (21.3 %), native root 67.5 ms (20.5 %), zod schema code 17.9 ms (5.4 %). No SQL statement and no `src/` function has more than 1 % self time.
- Check of the two pulse-kit entries. pulse-api never calls `formatDuration` or the address guard. It imports the `@lorenzh/pulse-kit` barrel, which loads every module. Two local A/Bs on a second copy, 2 rounds x 10 starts per side, CPU at ready without the profiler:
  - `formatDuration` built lazily (no `Intl.DurationFormat` at import): means 118 / 115 ms on `main` against 120 / 116 ms.
  - `dist/index.js` cut to the modules pulse-api uses: 115 / 116 ms against 116 / 116 ms.

  Neither changes the startup CPU. In a bare `bun` process the first `new Intl.DurationFormat("en", {style: "narrow"})` takes 1.0-1.3 ms (5 runs), so the profiler's weight on `DurationFormat` is a sampling artifact. No finding.

### 3. Costs that grow with data: the repository's bench, or a local A/B with a larger data set: `checked`

**Nightly bench**, run 45394568321, api, B medians of 5 rounds (A is the same commit):

| Metric | B | A | Budget | Kind | Verdict |
| --- | --- | --- | --- | --- | --- |
| `startup_cpu_ms` | 250 ms | 250 ms | 325 ms | gating | ok |
| `load_cpu_s` | 3.17 s | 3.41 s | 28.1 s | gating | ok |
| `idle_rss_mib` | 80.29 MiB | 80.68 MiB | 88 MiB | gating | ok |
| `peak_rss_mib` | 101.32 MiB | 100.68 MiB | 115 MiB | gating | ok |
| `test_cpu_s` | 7.25 s | 7.52 s | 9.2 s | gating | ok |
| `cold_read_cpu_ms` (10x seed) | 30 ms | 40 ms | 390 ms | gating | ok |
| `eod_read_cpu_ms` (518,400 rows today) | 360 ms | 370 ms | 598 ms | gating | ok |
| `p95_get_checks_ms` / `p95_post_results_ms` | 5.00 / 2.79 ms | 4.92 / 2.89 ms | 392 / 312 ms | reported | |
| `p95_get_latency_ms` / `p95_get_check_latency_ms` | 5.90 / 5.35 ms | 6.04 / 5.07 ms | 53 / 55 ms | reported | |
| `cold_get_checks_ms` / `cold_get_uptime_ms` / `cold_concurrent_ms` | 23 / 3 / 27 ms | 23 / 3 / 27 ms | 200 / 190 / 390 ms | reported | |
| `eod_get_checks_ms` / `_uptime_` / `_latency_` / `_check_latency_` / `_components_` / `_components_uptime_ms` | 2 / 2 / 3 / 1 / 3 / 2 ms | 3 / 2 / 3 / 1 / 3 / 2 ms | 7 / 3 / 7 / 2 / 4 / 3 ms | reported | |
| `rps` / `image_mb` / `startup_wall_ms` | 43.04 / 96.21 MB / 426 ms | 43.04 / 96.21 MB / 401 ms | 40 / 124 MB / 618 ms | reported | |

The 7 earlier nightly runs on the same commit (2026-11-17 to 2026-11-23) give B values in the same range: `startup_cpu_ms` 240-260, `test_cpu_s` 7.15-8.02, `eod_read_cpu_ms` 360-380, `p95_get_latency_ms` 5.31-6.20. The exception is run 44283365279, where the whole runner was about 33 % slower (finding 5).

**Local runs of the bench's own phases without Docker** (exit code 0 each):

- `bun bench/eod-read.ts --api .`, 2 runs, 518,420 and 518,400 rows of today: p95 `/checks` 2 and 2 ms, `/uptime` 2 and 1, `/latency` 3 and 2, `/checks/c0/latency` 1 and 1, `/components` 2 and 3, `/components/uptime` 1 and 2 ms. `eod_read_cpu_ms` 340 and 300 ms. `VmRSS` 107.9 and 109.7 MiB.
- `bun bench/cold-read.ts --api . --density 10 --today-rows 288000`, 1 run (8,640,000 rows, 288,000 of them today): `cold_get_checks_ms` 48, `cold_get_uptime_ms` 2, `cold_read_cpu_ms` 50, `cold_concurrent_ms` 50 ms. The bench does not gate its warm start: the first reads on the freshly seeded file, which has no stored day tallies, took `warm_get_checks_ms` 1852 and `warm_get_uptime_ms` 1828 ms (finding 2).

**Local growth runs**, `bun grow.ts <api> <dir> <1x seed> <midnight|today|incidents> <runs>`, exit code 0 each. Each run starts `bun src/main.ts` on a fresh copy of the database (after a WAL checkpoint and a `sync`), with the bench fixtures `eodChecksFileJson()` and `tokensFileJson()`. Dense days are added interleaved across checks, as live ingest stores them. Per check, 3 locations `sim0..sim2` x 8,640 results are spread over the day. That is 25,920 results per check and day, the count of 3 locations at a 10 s interval, and 518,400 rows for 20 checks.

| Cost | Small data | Large data | Growth |
| --- | --- | --- | --- |
| `GET /checks/c0/location-uptime` after an ingest (3 runs x 30) | 0.5 ms median (1,077 rows of today for `c0`) | 12.7 ms median in all 3 runs, p95 13.1-13.3 ms (26,997 rows of today) | linear in today's rows, on every uncached request. **Finding 1.** |
| the same route's query alone (`locationTally` for `c0` today, 20 times, `bun loctally.ts`) | 0.17 ms | 12.34 ms | the whole difference of the route |
| `/checks/c0/latency`, `/checks`, `/uptime`, `/latency` after an ingest (3 runs x 30) | 0.3-0.4 / 1.0-1.2 / 0.8-0.9 / 1.4 ms | 0.3 / 1.2 / 0.8-0.9 / 1.4 ms | none: today's tally and latencies are kept in memory |
| first `GET /checks`, `GET /latency` after a start, yesterday's day rows stored (3 runs) | - | `/checks` 7.5-10.7 ms, `/latency` 11.6-14.7 ms, read CPU 40-60 ms | baseline for the next row |
| the same, yesterday's rows in `uptime_daily`, `latency_daily` and `uptime_location_daily` removed, which is the state after a UTC midnight (3 runs) | - | `/checks` 246.8-249.7 ms, `/latency` 329.8-334.5 ms, `/checks/c0/location-uptime` 14.0-14.6 ms (1.5-1.6 stored), read CPU 630-640 ms | linear in yesterday's rows x checks. **Finding 2.** |
| `GET /incidents?status=resolved` (default limit 1000; 30 requests per run) | 0.2 ms (no incidents, 3 runs) | 5.9 ms with 10,000 resolved incidents (2 runs); 53.2-53.4 ms with 100,000 (3 runs) | about 0.52 µs per stored incident, on every status-page poll. **Finding 4.** |
| `GET /incidents`, `?status=open`, `GET /components` | 0.1 / 0.2 / 0.5 ms | 10k: 5.7 / 0.4 / 0.7 ms; 100k: 52.3-52.5 / 2.7-2.9 / 3.0 ms | linear in incidents |
| CPU at ready | 110-120 ms (1x) | 120 ms (10x) | none |
| RSS after the reads | 99.7-101.3 MiB (1x) | 112.8-114.4 MiB (518,400 rows today) | grows with today's rows: today's latencies are held in memory (`src/today.ts`) and cleared at the UTC day change |

How the costs scale:

- Since the audit of 2026-10-31, `GET /checks`, `/uptime`, `/latency`, `/checks/:id/latency`, `/components` and `/components/uptime` no longer grow with today's rows, and the cold reads after a restart no longer grow with the 30- and 90-day history. The bench gates both (`eod_*`, `cold_*`).
- `GET /checks/:id/location-uptime` still re-reads today's results after every ingest (finding 1).
- The first reads after each UTC midnight re-read all of yesterday's results for every check in one synchronous call. The first start on a file without stored day tallies re-reads the whole window (finding 2).
- `GET /incidents` and `GET /components` grow with the number of automatic incidents ever opened (finding 4).
- Startup CPU, `POST /results`, `/checks/:id/results` and the reads in the first bullet do not grow with the data.

### 4. Memory over time: RSS after N minutes of steady load, against the RSS at the start: `checked`

- Command: `timeout 540 bun mem.ts <api> <dir> <1x seed> 5`, exit code 0.
  - It starts `bun src/main.ts` on a copy of the 1x bench seed and waits for both backfill lines and 5 s more.
  - Then it runs an open-loop load for N = 5 minutes. Per second: 30 `POST /results` (3 probe tokens, 20 checks), 10 `GET /checks`, 1 each of `GET /uptime`, `GET /latency` and `GET /checks/:id/latency` (the rates of `bench/load.ts`). Also 1 each of `GET /components`, `GET /components/uptime` and `GET /checks/:id/location-uptime`, the status page and console reads.
  - 13,792 requests, 0 failed. `VmRSS` and `VmHWM` were read from `/proc/<pid>/status` every 30 s.
- RSS at ready: 65.5 MiB. At the start of the load: 72.3 MiB.
- Under load: 94.3, 92.4, 91.0, 93.9, 93.8, 90.1, 90.9, 93.5 and 91.2 MiB at +30 ... +270 s, and 91.7 MiB at the end. 30 s after the load: 86.5 MiB. `VmHWM` 101.9 MiB.
- CPU 9.88 s in 5 min, 1.98 s per minute.
- RSS rose by 22 MiB in the first 30 s. After that it moved between 90.1 and 94.3 MiB with no upward trend.
- Budgets: start 72.3 MiB against `idle_rss_mib` 88 MiB; peak 101.9 MiB against `peak_rss_mib` 115 MiB. Nightly: 80.29 and 101.32 MiB. No finding.

### 5. Tests: CPU time per test file; the slowest files: `checked`

- Whole suite: `/usr/bin/time bun test`, 3 runs, exit code 0 (`928 pass, 0 fail`, 100 files). CPU (user + sys) 7.11 s, 7.00 s and 7.04 s. Wall 6.28-6.37 s. Budget `test_cpu_s` 9.2 s: `ok`. Nightly B 7.25 s.
- Per file: `/usr/bin/time -f '%U %S %e' bun test <file>` for each of the 100 files, 3 passes. 14 files exit with code 0. The other 86 exit with code 1 only because of the 80 % line-coverage threshold of `bunfig.toml` on a one-file run: `./src/config-admin.test.ts` gives `62 pass, 0 fail` and `All files ... 61.78` % lines. No test failed in any run. Medians of user + sys:

| File | CPU (median of 3) | Runs |
| --- | --- | --- |
| `src/config-admin.test.ts` | 0.93 s | 0.93, 0.93, 0.93 |
| `src/server.notify-channels.test.ts` | 0.83 s | 0.83, 0.83, 0.82 |
| `src/server.maintenance-admin.test.ts` | 0.65 s | 0.65, 0.66, 0.64 |
| `src/main.test.ts` | 0.62 s | 0.61, 0.62, 0.62 |
| `src/server.resend.test.ts` | 0.61 s | 0.62, 0.61, 0.58 |
| `src/uptime.test.ts` | 0.58 s | 0.58, 0.58, 0.57 |
| `src/security-review.test.ts` | 0.49 s | 0.48, 0.50, 0.49 |
| `src/server.status-settings.test.ts` | 0.48 s | 0.47, 0.48, 0.48 |
| `src/server.manual-incidents.private.test.ts` | 0.44 s | 0.44, 0.44, 0.44 |
| `src/start.test.ts` | 0.41 s | 0.41, 0.41, 0.42 |

  The fastest files (`effective-maintenance`, `token-scopes`, `compose-moved`) take 0.00-0.01 s. The per-file sum is 18.12 s, against 7.0 s for the suite in one process, because each file run repeats Bun startup, module loading and the coverage report. No finding.

### 6. pulse-website only: JS and CSS size against the budget; Lighthouse of Home and Hosted: `not applicable`

The scope of this audit is pulse-api. It serves JSON and has no JS or CSS bundle and no web pages.

## Issue candidates

### performance-api-2026-11-24-1 (P2): `GET /checks/:id/location-uptime` re-reads all of today's results after every ingest, against the documented read cache

- Location: `src/service.ts:1044`. `locationUptimeOf` calls `locationTallies(id, today * DAY_MS, t)`, which runs `locationTally` (`src/service.ts:638`, `SEARCH results USING INDEX results_by_check`, `USE TEMP B-TREE FOR GROUP BY`) over the check's results of today.
- Documented behavior: `docs/rest-api.md:244` names `GET /checks/:id/location-uptime` among the cached routes. It says: "Recomputing after an ingest does not re-read today's results: today's uptime and latency are kept in memory and updated with each stored result." Every ingest clears the cache, so with probes reporting, nearly every request recomputes. The console reads the route for its check view (pulse-console `src/check-read.ts:249-251`).
- Command: `timeout 600 bun grow.ts <api copy> <dir> <1x seed> today 3`, exit code 0.
  - It copies the 1x bench seed twice. One copy gets 3 locations x 8,640 results per check for today, spread from 00:00 UTC to now and interleaved across checks: 518,400 rows, 26,997 for `c0`.
  - Then 3 server runs per copy. Each starts the API, waits for both backfill lines, sends one warm read and then 30 cycles of one `POST /results` (token `sim1`) and one timed `GET /checks/c0/location-uptime`.
  - Check: `bun loctally.ts <db>` runs the route's query alone 20 times on each copy.
- Excerpt:

```
dense: added 518400 rows of today; c0 today rows 26997; 1x c0 today rows 1077
1x run 1: /checks/c0/location-uptime median 0.5 p95 0.8 ms (cpu 50 ms/30 cycles); /checks/c0/latency median 0.3 p95 0.4 ms
dense run 1: /checks/c0/location-uptime median 12.7 p95 13.1 ms (cpu 420 ms/30 cycles); /checks/c0/latency median 0.3 p95 0.4 ms
dense run 2: /checks/c0/location-uptime median 12.7 p95 13.2 ms (cpu 420 ms/30 cycles)
dense run 3: /checks/c0/location-uptime median 12.7 p95 13.3 ms (cpu 420 ms/30 cycles)
today-1x.db: c0 rows today 1077, locationTally median 0.17 ms (n=20)
today-dense.db: c0 rows today 26997, locationTally median 12.34 ms (n=20)
```

- Value: 12.7 ms median per request (p95 13.1-13.3 ms), and 420 ms of API CPU per 30 cycles against 50 ms.
- Repetitions: 3 server runs x 30 requests per data set. The query alone ran 20 times per data set.
- Baseline: 0.5 ms with 1,077 rows of today for the check (1x seed at 18:00 UTC). On the same dense data, `GET /checks/c0/latency`, which keeps today in memory, stays at 0.3 ms.
- Budget: none for this route. The end-of-day phase of the bench does not request it (`bench/eod.ts` `EOD_ROUTES`). The nearest per-check end-of-day budget is `eod_get_check_latency_ms` 2 ms (reported).
- Severity: `P2` because the documented property does not hold at the bench's own density (20 checks, 3 locations, 10 s). The cost grows linearly through the UTC day. The absolute cost per request is small: 12.7 ms for one check.
- Fix direction: keep today's per-location good/total counts in the in-memory today state and update them on ingest, as `todayTally` does for the whole check. Add the route to the end-of-day bench phase. Or narrow the sentence in `docs/rest-api.md:244`.

### performance-api-2026-11-24-2 (P3): the first reads after each UTC midnight re-read all of yesterday's results in one synchronous request

- Location:
  - At the day change, `startDay` (`src/service.ts:501-505`) drops yesterday's in-memory tally and latencies (`dropOlderDays`) without storing them.
  - The next read finds no `uptime_daily` row for yesterday. `uptimeOf` -> `loadClosedDays` (`src/service.ts:952`, `909`) then runs `dailyUptime` (`src/service.ts:604`, `USE TEMP B-TREE FOR GROUP BY`) over the whole day for every check.
  - `latencyOf` -> `fillRollups` (`src/service.ts:1141`, `1131`) runs `dayLatencies` (`src/service.ts:647`, `USE TEMP B-TREE FOR ORDER BY`) for every HTTP check.
  - The hourly backfills (`src/uptime-rollup.ts`, `src/latency-rollup.ts`) fill the same days with a yield after each (check, day). They run every 3,600,000 ms from the process start, so a status page that polls every 5 s almost always reaches the read path first.
- Command: `timeout 600 bun grow.ts <api copy> <dir> <1x seed> midnight 3`, exit code 0.
  - It copies the 1x bench seed and adds, for yesterday, 3 locations x 8,640 results per check, interleaved (518,400 rows; `c0` then has 27,360 rows yesterday).
  - It starts the API, waits for both backfill lines and stops it, so every closed day is stored.
  - It makes two copies. `stored` keeps all day rows. In `missing`, the rows of yesterday are deleted from `uptime_daily` (20), `latency_daily` (20) and `uptime_location_daily` (80): this is the state of a running process right after 00:00 UTC.
  - 3 runs per copy: start, and at the first `200` of `/readyz` one timed request each to `/checks`, `/uptime`, `/latency`, `/components/uptime` and `/checks/c0/location-uptime`. The API CPU before and after them comes from `/proc`.
  - The `stored` copy pays the same restart costs, so the difference is the fill of yesterday.
- Excerpt:

```
stored run 1: ready 88 ms; /checks 10.7 ms, /uptime 2.0 ms, /latency 11.6 ms, /components/uptime 0.6 ms, /checks/c0/location-uptime 1.5 ms; read cpu 50 ms
stored run 3: ready 95 ms; /checks 7.5 ms, /uptime 2.2 ms, /latency 13.7 ms, /components/uptime 0.9 ms, /checks/c0/location-uptime 1.6 ms; read cpu 40 ms
missing run 1: ready 95 ms; /checks 247.7 ms, /uptime 2.6 ms, /latency 332.9 ms, /components/uptime 1.0 ms, /checks/c0/location-uptime 14.6 ms; read cpu 630 ms
missing run 2: ready 95 ms; /checks 246.8 ms, /uptime 2.7 ms, /latency 334.5 ms, /components/uptime 1.2 ms, /checks/c0/location-uptime 14.4 ms; read cpu 640 ms
missing run 3: ready 88 ms; /checks 249.7 ms, /uptime 2.8 ms, /latency 329.8 ms, /components/uptime 1.0 ms, /checks/c0/location-uptime 14.0 ms; read cpu 630 ms
```

- Value: 332.9 ms (median of 3 runs) for the first `GET /latency` and 247.7 ms for the first `GET /checks`. API CPU 630-640 ms for the five first reads, against 40-60 ms.
- Repetitions: 3 runs per copy.
- Baseline: the `stored` copy: 7.5-10.7 ms for `/checks` and 11.6-14.7 ms for `/latency`.
- Budget: `p95_get_latency_ms` 53 ms and `p95_get_checks_ms` 392 ms (both reported). This is one request per route and day, so no p95 of the bench shows it. The end-of-day phase starts after the backfills and never crosses midnight (`bench/eod.ts`).
- The same path on a start without stored day tallies, for example the first start after an upgrade to a release with `uptime_daily`: the warm start of `bench/cold-read.ts --density 10 --today-rows 288000` (1 run, exit code 0) gave `warm_get_checks_ms` 1852 and `warm_get_uptime_ms` 1828. The first `GET /uptime` (90-day window) re-reads from its oldest missing day, so it reads the 30 days that the `GET /checks` before it had just stored once more.
- Why it matters: the API has one thread. At 00:00 UTC, the first status poll (`/checks`, `/components`, `/components/uptime` and more, sent together, pulse-status `src/poller.ts:374-389`; every 5 s by default, `src/settings.ts:193`) and the first latency read stall ingests and other reads for about 0.6 s of CPU at the bench's density. The cost scales with checks x results per day.
- Severity: `P3`. It happens once a day and stays far under the status proxy's 4,000 ms timeout at this density. No documented limit is broken.
- Fix direction: at the day change, store yesterday's in-memory tally and latency figures as its `uptime_daily` and `latency_daily` rows. Or let the read path take only stored days and leave the missing ones to the yielding backfill, started at the day change. Add a midnight case to the bench.

### performance-api-2026-11-24-3 (P3): the nightly bench has failed on every scheduled run since 2026-11-04, so an api regression would not change its result

- Location: `bench/budgets.json:143` (probe `test_cpu_s` 2.3 s), `bench/budgets.json:180` (status `test_cpu_s` 3.4 s) and `bench/budgets.json:217` (notify `test_cpu_s` 3.4 s). The nightly workflow is `.github/workflows/bench.yml` of pulse-api.
- Command: `gh run list --repo lorenzh/pulse-api --workflow bench.yml --branch main --limit 40 --json databaseId,headSha,event,conclusion,createdAt`, exit code 0. Then `gh run download <id> --name bench-out` for the 8 newest runs and a read of `table.json` and `samples.json` (`shas.a`, `shas.b`).
- Excerpt:

```
2026-11-24T12:32:55Z schedule failure 8959e04 45394568321
... (every schedule run from 2026-11-04 to 2026-11-24: failure; 21 runs)
2026-11-03T09:36:18Z schedule success c9e23af 41612366764
45394568321 A=B for api/probe/status/notify: True {'probe': (2.63, 2.57, 2.3, 'FAIL budget'), 'status': (4.24, 4.15, 3.4, 'FAIL budget'), 'notify': (5.51, 5.36, 3.4, 'FAIL budget')}
44067927242 A=B for api/probe/status/notify: True {'probe': (2.53, 2.54, 2.3, 'FAIL budget'), 'status': (4.01, 4.02, 3.4, 'FAIL budget'), 'notify': (5.18, 5.18, 3.4, 'FAIL budget')}
```

  (tuple: A median, B median, budget, verdict)
- Value: in run 45394568321, notify `test_cpu_s` 5.36 s, status 4.15 s and probe 2.57 s (B medians).
- Repetitions: 5 rounds per side in each of 8 runs (2026-11-17 to 2026-11-24). All 8 fail the same three rows.
- Baseline: side A of the same runs, the same commits (`92f55df`, `f220fbc`, `6f4efe1`): 5.51, 4.24 and 2.63 s.
- Budget: 3.4, 3.4 and 2.3 s. B is 58 %, 22 % and 12 % over them.
- Why it matters: side A and side B run identical code, so these rows report stale budgets, not regressions. The workflow concludes `failure` every night anyway. A new api `FAIL budget` or `FAIL regression` row does not change the conclusion or the notification. A breach is only seen when someone reads the table. `bench/README.md` says "Re-set the budgets from the first nightly runs".
- Severity: `P3`. It costs no user anything, but it disables the nightly signal that the budgets exist for.
- Fix direction: re-set the three `test_cpu_s` budgets from the nightly A medians, with the documented method (A median plus headroom, or the spread rule of the "Temporary test floors" section). Or report per service, so one service's stale budget does not hide another service's breach.

### performance-api-2026-11-24-4 (P3): `GET /incidents` scans and sorts the whole `incidents` table, and the status page requests it on every poll

- Location: `src/service.ts:1447-1460` (`listIncidents`: `SCAN incidents`, `USE TEMP B-TREE FOR ORDER BY` in all 7 variants). The only index is `incidents_check_id` (`src/db.ts:56`). Automatic incidents are never deleted (`docs/concepts.md:83-89` lists what retention deletes). pulse-status sends `GET /incidents?status=open` and `GET /incidents?status=resolved`, with no `since`, on every poll (`src/poller.ts:375, 381`, `getResolved` at `300-304`; every 5,000 ms by default, `src/settings.ts:193`). From the resolved list it keeps only the incidents of its resolved window.
- Command: `timeout 600 bun grow.ts <api copy> <dir> <1x seed> incidents 3` and `INCIDENTS=10000 ... incidents 2`, exit code 0. The copy of the 1x seed gets 10,000 or 100,000 resolved incidents (one per second, starting 20 days ago). After the backfills, 30 timed requests per route.
- Excerpt:

```
1x run 1: /incidents?status=resolved median 0.2 p95 0.4 ms; /incidents?status=open median 0.2 p95 0.7 ms; /incidents median 0.1 p95 0.4 ms; /components median 0.5 p95 1.7 ms
1x+10k run 1: /incidents?status=resolved median 5.9 p95 6.7 ms; /incidents?status=open median 0.4 p95 0.8 ms; /incidents median 5.7 p95 6.1 ms; /components median 0.7 p95 2.1 ms
1x+100k run 1: /incidents?status=resolved median 53.2 p95 54.0 ms; /incidents?status=open median 2.9 p95 3.2 ms; /incidents median 52.3 p95 53.3 ms; /components median 3.0 p95 4.2 ms
1x+100k run 3: /incidents?status=resolved median 53.2 p95 54.2 ms; /incidents?status=open median 2.7 p95 3.1 ms; /incidents median 52.5 p95 53.1 ms; /components median 3.0 p95 3.5 ms
```

- Value: 53.2 ms median for `GET /incidents?status=resolved` with 100,000 incidents (medians of the 3 runs: 53.2, 53.4 and 53.2 ms). 5.9 ms with 10,000.
- Repetitions: 3 runs (100k) and 2 runs (10k), 30 requests per route each.
- Baseline: 0.2 ms with no incidents.
- Budget: none for this route.
- Why it matters: the cost grows by about 0.52 µs per incident ever opened, with no upper bound, and is paid on every status poll, every 5 s per status instance. The route is not in the read cache.
- Severity: `P3`. It needs a long-lived installation with many incidents, for example a check that flaps for months. The audit of 2026-10-31 noted the same plan (`performance-api-2026-10-31-4`); this run measured it again.
- Fix direction: a partial index on open incidents and an index on `(resolved_at)` or `(opened_at)` that matches the `ORDER BY`. Let the status page send `since`, or add a retention for old resolved automatic incidents.

## Notes

- **performance-api-2026-11-24-5 (P3, note): on a slow hosted runner, the api's gating budgets `startup_cpu_ms` and `test_cpu_s` fail with no code change.**
  - Run 44283365279 (2026-11-18, `schedule`) compared `8959e04` with itself. Command: `gh run download 44283365279 --repo lorenzh/pulse-api --name bench-out`, then a read of `table.json` and `samples.json`; exit code 0.
  - `startup_cpu_ms`: A rounds 320, 330, 320, 320, 330 ms; B rounds 330, 320, 330, 330, 330 ms; B median 330 ms against the budget of 325 ms: `FAIL budget`.
  - `test_cpu_s`: A 9.53-9.66 s and B 9.46-9.62 s; B median 9.49 s against 9.2 s: `FAIL budget`.
  - The 7 other runs of the same commit gave 240-260 ms and 7.15-8.02 s. kit `test_cpu_s` also failed in that run, so the whole runner was slower.
  - In 1 of 8 nightly runs, the gating budgets did not hold the hosted runner's spread for identical code. Value 330 ms, 5 rounds, baseline A 320 ms, budget 325 ms.
  - A rule that compares B with A of the same run would not have failed. Finding 3 hides it today.
- **Status of the findings of 2026-10-31**, measured again on `8959e04`:
  - `performance-api-2026-10-31-2` (end-of-day reads): fixed. Today's tally and latencies are kept in memory (`src/today.ts`). The nightly gives `eod_get_*` 1-3 ms, and locally `bench/eod-read.ts` gives 1-3 ms. The exception is `/checks/:id/location-uptime`, which is finding 1.
  - `performance-api-2026-10-31-3` (cold reads after a start): fixed for restarts. The nightly gives `cold_get_checks_ms` 23 ms, and locally the 10x seed gives 48 ms. The first start without stored tallies still reads the whole window, see finding 2.
  - `performance-api-2026-10-31-4` (incidents scan): unchanged, now finding 4.
- `audit_log` reads with a filter (`src/audit-log.ts:125`) scan the table, which is never pruned. The route is admin-only and paged. It was not measured; a note, not a finding.
- `computeChecks` (`src/service.ts:848`), `activeCheckIds` (`1068`), `httpCheckIds` (`1081`), `listCheckStates` (`1289`), `listProbeChecks` (`1309`) and `listHeartbeats` (`1322`) still call `db.prepare(...)` on each call instead of reusing a prepared statement. Not measured on its own. `GET /checks` after an ingest takes 1.0-1.2 ms in total.
- RSS grows with today's rows: 99.7-101.3 MiB after the reads at 1x, and 112.8-114.4 MiB with 518,400 rows of today (`grow.ts today`). `bench/eod-read.ts` gave `VmRSS` 107.9 and 109.7 MiB. Today's latencies are held as `Float64Array`s that double their capacity (`src/today.ts`) and are dropped at the UTC day change. `peak_rss_mib` (115 MiB) is measured in the 1x load phase, so it does not cover the end of the day. No budget is broken, so this is a note.
- The test suite grew from 390 tests in 54 files (2.46 s CPU, bench of 2026-10-31) to 928 tests in 100 files (7.0 s). That is 6.3 and 7.6 ms of CPU per test, so the growth follows the number of tests. The budget was raised to 9.2 s.
- The nightly is scheduled for 02:17 UTC (`bench/README.md`), but the 8 runs read were created between 08:49 and 12:32 UTC. The cold-read phase therefore measures a mid-day tally of today (`bench/README.md`: `cold_read_cpu_ms` grows with the UTC hour). The local run with 288,000 rows of today, the late-day size, gave 50 ms against the budget of 390 ms.
- Method caveats: the local numbers come from one runner without Docker and do not compare with the hosted nightly. `grow.ts` inserts the dense days interleaved across checks, as live ingest does. `bench/cold.ts` `addTodayRows` inserts them per check.
- Cleanup: every API instance was stopped with `SIGTERM` (exit code 0). No Docker container or image was created. The copies, seeds, profiles, downloaded artifacts and scripts under `/tmp` were deleted at the end of the run.
