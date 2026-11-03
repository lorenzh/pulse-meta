# Performance audit: pulse-notify (2026-11-03)

## Scope

- Issue: lorenzh/pulse-meta#677, periodic performance audit of `main` of pulse-notify.
- Earlier runs: the issue has only the Factory claim comment. No earlier performance report of notify exists, so this report is new.
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-notify | `3f120cc0efcf80fd68c5974dd603b9b4d1ae000c` | `main`. Installed (`bun install --frozen-lockfile`), run, profiled and tested in a temporary copy. |
| pulse-api | `2d4a6b23d532e66ad30840a778ac21ab465647dc` | `bench/budgets.json`, `bench/README.md`, `bench/load.ts`, `bench/seed.ts`, `bench/fixtures/` (read only) |
| pulse-meta | `ef3473ddc1284dc312d497b320c554a206c841b3` | this repository |

- Nightly bench that was read: run [41612366764](https://github.com/lorenzh/pulse-api/actions/runs/41612366764). It is the newest completed `bench.yml` run on `main` (`schedule`, 2026-11-03T09:36Z, api head `c9e23af16e95494311cdbc8cc57f1f94c75b3af7`, conclusion `success`). Side A of notify is `v0.1.0`. Side B is notify `main` at 09:37Z: `757e78f27cfdbb89109c216dcba829158ea7b5c3`. Notify table of artifact `bench-out` (medians of 5 rounds):

| Metric | A (`v0.1.0`) | B (`757e78f`) | B rounds | Budget | Kind | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `startup_cpu_ms` | 250 ms | 270 ms | 260, 270, 280, 270, 270 | 455 ms | gating | ok |
| `load_cpu_s` | 0.08 s | 0.09 s | 0.09, 0.10, 0.09, 0.10, 0.09 | 0.5 s | gating | ok |
| `idle_rss_mib` | 67.41 MiB | 69.73 MiB | 69.73 to 70.34 | 86 MiB | gating | ok |
| `peak_rss_mib` | 67.54 MiB | 69.82 MiB | 69.07 to 70.30 | 86 MiB | gating | ok |
| `test_cpu_s` | 1.37 s | 2.33 s | 2.35, 2.33, 2.33, 2.33, 2.25 | 3.4 s | gating | ok |
| `startup_wall_ms` | 663 ms | 827 ms | 599 to 940 | 978 ms | reported | |
| `image_mb` | 96.97 MB | 97.15 MB | | 126 MB | reported | |

- Why the bench A/B was not run again: `main` is 2 commits ahead of side B (`gh api repos/lorenzh/pulse-notify/compare/757e78f...3f120cc`: `ahead_by` 2). The only change in `src/` is `src/ledger.ts` +13 -3, a closed-ledger guard on each mutation. Every notify row is `ok` and below its budget. Nothing suggested a deviation, so the bench numbers stand for `main`. The local measurements below cover what the bench does not measure (see finding 2).
- Machine: GitHub-hosted runner with 4 vCPU and 16 GB RAM, Bun 1.4.0 (bundled SQLite 3.53.2), Linux. Everything ran on 127.0.0.1 in temporary copies (`mktemp -d`), against a fake pulse-api and a local webhook receiver. No shared or production system was contacted. CPU time comes from `/proc/<pid>/stat` (utime + stime, 10 ms resolution) and memory from `/proc/<pid>/status` (`VmRSS`, `VmHWM`). The numbers are comparable within this report. The bench measures inside a container. Here the process ran on the host, so absolute values differ (for example `startup_cpu_ms` 270 ms in the bench and 100-120 ms here).
- Helpers (not committed, kept outside the repository):
  - `fakeapi.ts`: a fake pulse-api. It serves `/incidents`, `/checks` (20 checks) and `/manual-incidents` with the header `x-pulse-contract: 1`. Open incidents come first, then the newest. Like the api default, it caps the list at 1000.
  - `sink.ts`: a webhook receiver. It answers 200 on `/ok` and 400 on `/fail`.
  - `capture.ts`: a `bun:sqlite` preload that records every SQL text and its `src/` call site.
  - `explain.ts`: runs `EXPLAIN QUERY PLAN` for every recorded statement.
  - `grow.ts`: starts `bun src/index.ts` on a fresh copy of a ledger. It reads CPU and memory at the first `200` of `/readyz`, 5 s later, and after a window of polls.
  - `ledgercost.ts`: times `new Ledger()`, `pending()`, `entries()` and `prune()` on a copy of a ledger.
  - `mem.ts`: samples RSS every 30 s for N minutes.
  - `prof.ts` and `prof-anc.ts`: sum the self time of `.cpuprofile` files.
- Data sets. The ledgers were made by the service itself on its first poll; 100x adds rows through the `Ledger` class:
  - 1x: a feed of 100 resolved incidents and 5 manual incidents. 3 channels: `hook` (webhook), `remind` (webhook, `remindEverySeconds` 3600) and `file`. The ledger has 630 entries.
  - 10x: a feed of 1000 resolved incidents, the most `GET /incidents` returns without parameters (`docs/rest-api.md` of pulse-api: "Default 1000"). The same 3 channels. The ledger has 6,030 entries (0.48 MB).
  - 100x: the 10x feed. The ledger has 66,030 entries (4.9 MB): the 10x ledger plus 20,000 settled entries per channel inside the 30-day retention (`bun addrows.ts <copy> seed-100x.db 20000 hook,remind,file`). That is about 10,000 incidents per channel in 30 days.
- Results: 3 findings, all `P3`. 2 are issue candidates and 1 is a note. No `P1` or `P2`. No item is blocked.

## Checklist

### 1. Queries: `EXPLAIN QUERY PLAN` for every query on the request path and at startup: `checked`

Method:

- `timeout 400 bash capture-run.sh <notify copy> <dir>` ran `bun --preload capture.ts src/index.ts` (`PULSE_NOTIFY_POLL_MS=1000`) through every ledger path. Exit code 0.
  - A fresh start with 4 channels (`hook`, `remind` with `remindEverySeconds` 60, `file`, and `bad`, which posts to a 400 receiver). That covers seeding, claims, `delivered`, reminders, the permanent failure (`failed`) and the first prune.
  - 150 s of polls with a new incident every 10 s that resolves after 90 s, and one `GET /metrics`.
  - `SIGTERM`, which runs `flush()`, then `failed list` and `failed resend --all` on the stopped service.
  - A restart with changed check and component filters and reminders off (`setRemindersFrom`, the routing reseed, the resend of pending keys).
  - A start on a JSON ledger of format 2 (the migration).
- The capture recorded 20 distinct statements, all from `src/ledger.ts`. `grep -n -E '"(SELECT|INSERT|UPDATE|DELETE|PRAGMA)' src/*.ts` finds one more, `UPDATE entries SET recipients = ?` (`setRecipients`, email channels only), which was added by hand.
- `bun explain.ts capture.jsonl <copy of the run's state.db> "UPDATE entries SET recipients = ? WHERE channel_id = ? AND key = ?"` ran the plans on the ledger of that run (948 entries). Exit code 0.

Result: one set of statements is flagged, the two whole-table reads at startup. No statement uses `USE TEMP B-TREE`. The HTTP endpoints of the ops server (`/healthz`, `/readyz`, `/metrics`) run no SQL. The poll loop writes only on a change and reads from the in-memory mirror.

| Statement (call site) | When | Plan |
| --- | --- | --- |
| `SELECT * FROM channels ORDER BY rowid` (`loadRows`, `src/ledger.ts:292`) | startup (`#validate`, read-only connection), also the CLI | `SCAN channels` (flagged) |
| `SELECT * FROM entries ORDER BY rowid` (`loadRows`, `src/ledger.ts:297`) | startup, also the CLI | `SCAN entries` (flagged). `ORDER BY rowid` needs no sort. |
| `UPDATE channels SET reminders_from / manual_from / check_routing / component_routing = ? WHERE id = ?` (`src/ledger.ts:569`, `606`) | seed, routing change, reminder mark | `SEARCH channels USING INDEX sqlite_autoindex_channels_1 (id=?)` |
| `DELETE FROM entries WHERE channel_id = ? AND key = ?` (`src/ledger.ts:637`) | claim of a newer reminder, prune | `SEARCH entries USING INDEX sqlite_autoindex_entries_1 (channel_id=? AND key=?)` |
| `UPDATE entries SET status = ?, at = ? [, payload = NULL, recipients = NULL] WHERE channel_id = ? AND key = ?` (`settle`, `src/ledger.ts:683`) | each delivery outcome | `SEARCH entries USING INDEX sqlite_autoindex_entries_1 (channel_id=? AND key=?)` |
| `UPDATE entries SET status = 'pending', at = ?, recipients = ? WHERE ...` (`resend`, `src/ledger.ts:762`), `UPDATE entries SET recipients = ? WHERE ...` (`setRecipients`, `src/ledger.ts:707`, static only) | CLI resend, email recipients | `SEARCH entries USING INDEX sqlite_autoindex_entries_1 (channel_id=? AND key=?)` |
| `INSERT OR IGNORE INTO channels (id)`, `INSERT INTO entries (...) VALUES` (seeded, pending), `INSERT INTO channels/entries` of the migration (`src/ledger.ts:350-354`, `579`, `609`, `655`) | seed, claim, migration | no plan rows (plain insert) |
| `PRAGMA user_version`, `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = FULL`, `PRAGMA wal_checkpoint(TRUNCATE)`, the schema script | startup, shutdown (`flush`) | not DML |

The two scans read the whole ledger into memory once per start. That is the design (`src/ledger.ts:406-411`: "Reads come from a mirror loaded at open"). Their cost grows with the ledger: `new Ledger()` takes 0.9, 3.9 and 35.9 ms at 630, 6,030 and 66,030 entries (item 3). The memory the mirror holds is finding 1.

### 2. Startup: CPU profile (`bun --cpu-prof`) with the top functions by self time: `checked`

- Bench: `startup_cpu_ms` B 270 ms (rounds 260 to 280), budget 455 ms (gating): `ok`. A (`v0.1.0`) 250 ms.
- Local CPU at the first `200` of `/readyz`, without the profiler, 3 runs each (`bun grow.ts ...`, exit code 0): 1x 120, 120 and 120 ms; 10x 130, 140 and 130 ms; 100x 250, 220 and 220 ms. With the bench config (one file channel, empty ledger): 110, 100 and 120 ms. Wall time to ready: 92-96 ms (1x), 101-107 ms (10x), 156-166 ms (100x).
- Profile: `timeout 120 bun grow.ts <copy> seed-<n>.db config3.json <api> prof-<n> 3 30 5000 <dir>` runs `bun --cpu-prof --cpu-prof-interval=100 src/index.ts`. It sends `SIGTERM` right after the first `200` of `/readyz`. 3 runs per data size, exit code 0. CPU at ready under the profiler: 1x 160, 160 and 160 ms; 100x 290, 290 and 290 ms.
- Self time summed over the 3 runs of 1x (`bun prof.ts 16 prof-1x-r*.cpuprofile`: 1024 samples, 352.6 ms sampled):

| Self time | Share | Function (as Bun names the frame) |
| --- | --- | --- |
| 66.7 ms | 18.9 % | `createConvenienceMethod` `node:zlib:357` (built-in module setup at import) |
| 60.4 ms | 17.1 % | `anonymous` (native, no source) |
| 26.8 ms | 7.6 % | `node:http` module |
| 25.2 ms | 7.1 % | `_onceWrap` `node:events:242` |
| 9.0 ms | 2.5 % | `@lazy` (built-in module loader) |
| 7.4 ms | 2.1 % | `toString` |
| 5.0 ms | 1.4 % | `DurationFormat` (pulse-kit) |
| 4.1 ms | 1.2 % | `node:dns` module |
| 3.5 ms | 1.0 % | `init` `zod/v4/core/core.js:50` |
| 3.5 ms | 1.0 % | `symbolToStringify` `node:os:125` |
| 3.0 ms | 0.9 % | module `@lorenzh/pulse-contract/dist/schema.js:1` |

  The time goes to the nearest file frame of each sample (`bun prof-anc.ts`) as follows: no file frame (runtime and built-in modules) 59.1 %, `zod` 14.5 %, `@lorenzh/pulse-kit` 12.5 %, `src/index.ts` 3.7 %, `src/ledger.ts` 3.4 %, `@lorenzh/pulse-contract` 2.0 %, `nodemailer` 1.6 %. At 1x, startup is module loading.
- 100x (2155 samples, 600.9 ms sampled): `all` (native `Statement.all` of `bun:sqlite`) 129.9 ms (21.6 %), `anonymous` 60.4 ms, `loadRows` `src/ledger.ts:290` 48.1 ms (8.0 %), `defineProperty` 45.4 ms, `readEntryRow` `src/ledger.ts:281` 23.8 ms, `Uint32Array` 22.6 ms, `isStatus` `src/ledger.ts:145` 22.4 ms, `pending` `src/ledger.ts:717` 18.7 ms (called by `#resendPending`, `src/notifier.ts:281`). By file: `src/ledger.ts` 257.7 ms (42.9 %), which is 86 ms per start.
- No startup finding: every value is below the 455 ms budget. The part that grows with the ledger belongs to finding 1.

### 3. Costs that grow with data: the repository's bench, or a local A/B with a larger data set: `checked`

notify has no bench of its own. The pulse-api bench gives notify an api with no incidents (finding 2). So this item is a local A/B over the data sets of the Scope.

**Poll and startup cost by data size.** Each run: `timeout 200 bun grow.ts <copy> seed-<n>.db config3.json <fake api> <n> 3 30 1000`. It starts on a fresh copy of the ledger (`sync` after the copy) with `PULSE_NOTIFY_POLL_MS=1000`. It reads CPU at ready and 5 s later, then measures CPU over a 30 s window (30 polls) of a steady feed with no new events. 3 runs per data set, exit code 0, no error log lines.

| Cost (3 runs) | 1x (100 incidents, 630 entries) | 10x (1000 incidents, 6,030 entries) | 100x (1000 incidents, 66,030 entries) |
| --- | --- | --- | --- |
| CPU at first `/readyz` 200 | 120, 120, 120 ms | 130, 140, 130 ms | 250, 220, 220 ms |
| CPU per poll (30 polls) | 6.33, 6.00, 6.00 ms | 13.33, 13.33, 13.67 ms | 20.33, 20.00, 19.67 ms |
| RSS at ready | 63.1-63.3 MiB | 68.4-69.2 MiB | 107.2-107.4 MiB |
| RSS after the window | 74.7-74.8 MiB | 78.2-81.0 MiB | 103.8-113.3 MiB |
| `VmHWM` | 74.9-75.3 MiB | 85.1-86.1 MiB | 119.9-124.1 MiB |

**Ledger calls by size.** `timeout 300 bun ledgercost.ts <copy> seed-<n>.db 5`, exit code 0, median of 5:

| Call | 630 entries | 6,030 entries | 66,030 entries |
| --- | --- | --- | --- |
| `new Ledger()` (validate and load) | 0.9 ms | 3.9 ms | 35.9 ms |
| `pending()` x 3 (one per channel, as each poll does) | 0.16 ms | 0.51 ms | 1.99 ms |
| `entries("remind")` (per reminder staleness check) | 0.02 ms | 0.18 ms | 0.79 ms |
| `prune()` with nothing to remove | 0.1 ms | 0.3 ms | 2.2 ms |
| RSS after `new Ledger()`, minus before | 3.7 MiB | 10.2 MiB | 48.9 MiB |
| JS heap after `new Ledger()`, minus before | 0.2 MiB | 1.7 MiB | 16.2 MiB |

**Bench case against a full feed.** This used the bench's own notify config (one `file` channel, `bench/fixtures/notify.json`), the default poll of 5 s and an empty ledger. It measured a 60 s window like `load_cpu_s`. `timeout 300 bun grow.ts <copy> - config-bench.json <api> <label> 3 60 5000`, 3 runs per side, exit code 0:

| | feed of 0 incidents (as in the bench) | feed of 1000 incidents |
| --- | --- | --- |
| CPU in the 60 s window | 100, 100, 120 ms | 230, 230, 220 ms |
| `VmHWM` | 65.4, 65.4, 65.3 MiB | 78.4, 78.3, 78.5 MiB |
| CPU at ready | 110, 100, 120 ms | 120, 110, 110 ms |

The local 0-incident side matches the bench B values (`load_cpu_s` 0.09 s; `peak_rss_mib` 69.82 MiB in the container).

How the costs scale:

- The feed is at most 1000 incidents, because notify calls `GET /incidents` without `limit` and the api caps the default page at 1000. At 1000 incidents (any install whose api holds 1000 incidents, which are never deleted) one poll costs about twice as much as at 100 incidents (13.3 against 6.0 ms). Load CPU is 2.3 times the bench case and peak RSS is 13 MiB higher. The bench does not see this: finding 2.
- At a fixed feed, the poll cost and the memory grow with the number of ledger entries. From 6,030 to 66,030 entries a poll costs 6.7 ms more, RSS at ready is 38 MiB higher, and `VmHWM` is 35 MiB higher. Memory is finding 1 and the per-poll part is finding 3.
- The ledger has no fixed bound. `prune` keeps every key younger than `PULSE_NOTIFY_STATE_RETENTION_DAYS` (30) and every key of an incident still in the feed (`src/ledger.ts:776-827`). So its size follows the incident rate times 30 days, times the number of channels.
- Startup CPU grows by about 1.6 µs per entry (130-140 ms at 6,030 and 220-250 ms at 66,030). The 100x value is still below the 455 ms budget.
- With the default 5 s poll, the 100x case costs 0.37 s of CPU per minute under churn (item 4), below the `load_cpu_s` budget of 0.5 s.

### 4. Memory over time: RSS after N minutes of steady load, against the RSS at the start: `checked`

- Command: `timeout 420 bun mem.ts <copy> seed-<n>.db config-mem.json http://127.0.0.1:18313 mem-<n> 5 <port>`, for 10x and 100x at the same time against one fake api. Exit code 0 for both.
- N = 5 minutes. The load:
  - default settings (`PULSE_NOTIFY_POLL_MS` 5000);
  - a feed of 1000 incidents with a new incident every 10 s, which resolves after 90 s;
  - 3 channels: `hook` (webhook), `remind` (webhook, `remindEverySeconds` 60) and `file`;
  - 183 notifications delivered per run (opened, resolved, reminders), 0 error lines.
- RSS sampled every 30 s:

| t (s) | 0 | 30 | 60 | 90 | 120 | 150 | 180 | 210 | 240 | 270 | 300 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10x RSS (MiB) | 69.7 | 77.3 | 76.7 | 79.2 | 77.4 | 78.0 | 78.6 | 78.7 | 80.8 | 81.5 | 81.0 |
| 10x `VmHWM` (MiB) | 69.7 | 81.5 | 82.3 | 83.1 | 83.1 | 83.1 | 83.1 | 83.1 | 83.1 | 83.2 | 84.5 |
| 100x RSS (MiB) | 107.0 | 102.6 | 102.3 | 103.0 | 103.7 | 102.7 | 104.0 | 105.4 | 105.4 | 106.5 | 106.1 |
| 100x `VmHWM` (MiB) | 107.0 | 123.0 | 123.0 | 123.0 | 123.0 | 123.0 | 123.0 | 123.0 | 123.0 | 123.0 | 123.0 |

- CPU in the 300 s: 10x 1170 ms (0.23 s per minute), 100x 1850 ms (0.37 s per minute). Budget `load_cpu_s` 0.5 s per 60 s.
- 10x: RSS rose by 7.6 MiB in the first 30 s and then by 3.7 MiB over the next 4.5 minutes (77.3 to 81.0 MiB). Five minutes do not show whether that growth goes on; no leak is shown. `VmHWM` 84.5 MiB is 98 % of the `peak_rss_mib` budget of 86 MiB (finding 2).
- 100x: RSS stayed between 102.3 and 107.0 MiB, with no growth beyond the start. That is above `idle_rss_mib` 86 MiB, and `VmHWM` 123.0 MiB is above `peak_rss_mib` 86 MiB (finding 1).

### 5. Tests: CPU time per test file; the slowest files: `checked`

- Whole suite: `/usr/bin/time -f '%U %S %e' timeout 600 bun test`, 3 runs, exit code 0 (`375 pass, 0 fail`, 38 files). CPU 2.56 s (1.77 + 0.79), 2.54 s and 2.49 s. Wall 7.19, 6.43 and 4.63 s. Budget `test_cpu_s` 3.4 s: `ok`. Bench B 2.33 s. The bench A (`v0.1.0`) was 1.37 s, so B is +70.5 % but within the budget.
- Per file: `/usr/bin/time -f '%U %S %e' timeout 120 bun test ./<file>` for each of the 38 files, 3 runs. Exit code 0 for 7 files. The other 31 exit with code 1 only because of the 80 % line coverage threshold of `bunfig.toml` on a one-file run; every test passes (`0 fail` in every run). Medians of user + sys CPU, the 10 slowest:

| File | CPU (median of 3) | Wall (median) |
| --- | --- | --- |
| `test/index.test.ts` | 0.43 s | 0.27 s |
| `test/notifier.test.ts` | 0.38 s | 0.44 s |
| `test/email-smtp.test.ts` | 0.37 s | 1.13 s |
| `test/permanent.test.ts` | 0.33 s | 0.35 s |
| `test/channels.test.ts` | 0.29 s | 0.62 s |
| `test/reminders.test.ts` | 0.28 s | 0.42 s |
| `test/api-hostile.test.ts` | 0.28 s | 0.40 s |
| `test/routing-change.test.ts` | 0.27 s | 0.26 s |
| `test/security-review.test.ts` | 0.27 s | 0.24 s |
| `test/feeds.test.ts` | 0.25 s | 0.26 s |

  The other 28 files take 0.01 to 0.23 s each. The per-file medians add up to 5.80 s, because each run pays the Bun start and the coverage report again. `test/email-smtp.test.ts` has the longest wall time (1.13 s at 0.37 s CPU): it talks to a local SMTP stub.
- No finding: the suite is at 75 % of its budget.

### 6. pulse-website only: JS and CSS size against the budget; Lighthouse of Home and Hosted: `not applicable`

pulse-notify is a background service with no web pages.

## Issue candidates

### performance-notify-2026-11-03-1 (P3): the whole ledger is held in memory; at 66,030 entries RSS is 102-113 MiB and the peak 120-124 MiB, above both 86 MiB budgets

- Location: `src/ledger.ts:297` (`loadRows` reads `SELECT * FROM entries` with `.all()`). The mirror is `#channels` at `src/ledger.ts:421`: one `Map` entry and one object per ledger entry, kept for the life of the process.
- Command: `timeout 200 bun grow.ts <notify copy> seed-100x.db config3.json http://127.0.0.1:18312 100x 3 30 1000` and the same for `seed-10x.db`. Also `timeout 420 bun mem.ts ... seed-100x.db ... 5` and `timeout 300 bun ledgercost.ts <copy> seed-<n>.db 5`. Exit code 0 for all.
- Output excerpt:

  ```
  {"label":"10x","run":2,"ready_cpu_ms":140,"ready_rss_mib":68.4,"end_rss_mib":78.3,"hwm_mib":85.1,...}
  {"label":"100x","run":1,"ready_cpu_ms":250,"ready_rss_mib":107.4,"end_rss_mib":103.8,"hwm_mib":124.1,...}
  {"label":"100x","run":2,"ready_cpu_ms":220,"ready_rss_mib":107.3,"end_rss_mib":113.3,"hwm_mib":120.7,...}
  {"label":"100x","run":3,"ready_cpu_ms":220,"ready_rss_mib":107.2,"end_rss_mib":113.2,"hwm_mib":119.9,...}
  mem-100x (5 min): rss 107.0 ... 106.1, hwm 123.0
  ledgercost 66,030 entries: open 35.9 ms, rss delta 48.9 MiB, heap delta 16.2 MiB (6,030: 3.9 ms, 10.2 MiB, 1.7 MiB)
  ```

- Value: RSS at ready 107.3 MiB (median), `VmHWM` 120.7 MiB (median). Repetitions: 3 runs, plus one 5-minute run (`VmHWM` 123.0 MiB).
- Baseline: the 10x ledger (6,030 entries, same feed and channels) gives 68.4-69.2 MiB at ready and 85.1-86.1 MiB `VmHWM`. Bench B gives 69.73 and 69.82 MiB.
- Budget: `idle_rss_mib` 86 MiB and `peak_rss_mib` 86 MiB (gating). Startup CPU 220-250 ms is within `startup_cpu_ms` 455 ms.
- Why `P3`: memory and startup time grow linearly with the number of entries kept within 30 days, about 0.65 MiB of RSS per 1,000 entries ((107.3 - 68.8) MiB / 60,000 entries at ready; 48.9 - 10.2 MiB right after `new Ledger()`). The budgets are crossed only with a large ledger: about 22,000 entries per channel, which is some 11,000 incidents in 30 days. Nothing breaks, but a container with a tight memory limit at that size would be at risk.
- Direction: read the rows with `.iterate()` instead of `.all()`, so the whole result is not built at once. Keep less per settled entry, or look settled keys up in SQLite by primary key instead of mirroring them. On the poll path, settled entries are read by `has()` (detection), `entries()` and `#olderReminders` (reminders) and `prune()`.

### performance-notify-2026-11-03-2 (P3): the nightly bench runs notify with no incidents, so its gating notify metrics do not cover the feed work; with the default page of 1000 incidents, load CPU is 2.3 times higher and peak RSS 13 MiB higher, close to the 86 MiB budget

- Location: pulse-api `bench/load.ts:213` (every posted result is `status: "up"`) and `bench/fixtures/target.mjs:2` ("answers 200 \"ok\" on every path"). `bench/seed.ts` writes only `results` rows, no incidents. On the notify side, `src/api.ts:181` reads and validates the whole `GET /incidents` page on every poll.
- Command: `grep -n 'status: "up"' bench/load.ts; head -2 bench/fixtures/target.mjs` in pulse-api (exit code 0). Then `timeout 300 bun grow.ts <notify copy> - config-bench.json http://127.0.0.1:<port> <feed0|feed1000> 3 60 5000` with the bench notify config (one `file` channel) and a fake api that serves 0 or 1000 incidents. Exit code 0.
- Output excerpt:

  ```
  213:          status: "up",
  // Trivial check target of the bench stack: answers 200 "ok" on every path.
  {"label":"feed0","run":1,"window_s":60,"window_cpu_ms":100,"hwm_mib":65.4,...}
  {"label":"feed0","run":3,"window_s":60,"window_cpu_ms":120,"hwm_mib":65.3,...}
  {"label":"feed1000","run":1,"window_s":60,"window_cpu_ms":230,"hwm_mib":78.4,...}
  {"label":"feed1000","run":3,"window_s":60,"window_cpu_ms":220,"hwm_mib":78.5,...}
  ```

- Value: 230 ms of CPU per 60 s window (median) and `VmHWM` 78.4 MiB (median), with a feed of 1000 incidents. Repetitions: 3 runs per side.
- Baseline: the bench case (feed of 0 incidents) gives 100 ms (100, 100, 120) and 65.4 MiB. Bench B gives `load_cpu_s` 0.09 s and `peak_rss_mib` 69.82 MiB.
- Budget: `load_cpu_s` 0.5 s and `peak_rss_mib` 86 MiB (gating). With 3 channels and a 6,030-entry ledger, `VmHWM` was 85.1, 85.2 and 86.1 MiB (item 3) and 84.5 MiB after 5 minutes (item 4). That is 98-100 % of the budget, a level the bench never reaches.
- Why `P3`: no behavior breaks and every value is within the budget. But the gate measures an idle poller. A regression in feed parsing, validation or detection would pass the nightly bench and show up only in installs with incidents.
- Direction: let the bench api hold incidents, for example a seed of 1000 incidents or a probe target that fails some checks. Then notify's `load_cpu_s` and `peak_rss_mib` include the feed, and the notify budgets can be set again from that run.

## Notes

- **Finding performance-notify-2026-11-03-3 (P3, not a candidate): each poll walks every ledger entry once per channel.** `#rebuildLegacyPending` (`src/notifier.ts:697-699`) calls `ledger.pending()` for each channel on every poll, and `pending()` (`src/ledger.ts:717-729`) loops over all entries of all channels. So the cost is channels x entries per poll. Measured with `timeout 300 bun ledgercost.ts <copy> seed-<n>.db 5`, exit code 0: 3 calls take 0.16, 0.51 and 1.99 ms at 630, 6,030 and 66,030 entries (median of 5). The whole poll costs 19.67-20.33 ms at 66,030 entries against 13.33-13.67 ms at 6,030 entries (`grow.ts`, 3 runs x 30 polls, same feed). `pending()` explains about 1.5 ms of that 6.7 ms. The rest was not attributed; a larger heap is a likely cause, but that was not measured. Budget `load_cpu_s` 0.5 s: at the default 5 s poll the 100x case uses 0.37 s per minute (item 4). `GET /metrics` (`src/index.ts:185`) and each reminder staleness check (`ledger.entries()`, `src/notifier.ts:247`, 0.79 ms at 66,030 entries) walk the entries too.
- The feed size is bounded on the notify side: `GET /incidents` without parameters returns at most 1000 incidents. On the api side, each of these polls (every 5 s per notify instance) runs the `SCAN incidents` with `USE TEMP B-TREE FOR ORDER BY` that `audits/performance/api.md` reports as its finding 4. That cost belongs to the api and was not measured again here.
- The two startup scans of item 1 are the intended full load; they are not a separate finding.
- Bench `startup_cpu_ms` (270 ms) and local CPU at ready (100-120 ms with the bench config) differ because the bench measures PID 1 inside a container from `compose up`. Compare only within one setting.
- `test_cpu_s` went from 1.37 s (A, `v0.1.0`) to 2.33 s (B) in the nightly, +70.5 %. It is within the 3.4 s budget, whose floor was set for this spread (pulse-api `bench/README.md`, "Temporary test floors").
- The SQL capture saw the first prune with nothing to remove. A prune that removes entries runs the same `DELETE ... WHERE channel_id = ? AND key = ?` (a `SEARCH`), once per key in one transaction.
