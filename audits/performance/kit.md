# Performance audit: pulse-kit (2026-11-06)

## Scope

- Issue: lorenzh/pulse-meta#792, periodic performance audit of `main` of pulse-kit.
- Earlier runs: the issue has only the Factory claim comment. No earlier performance report of kit exists, so this report is new.
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-kit | `536133f3e8b708179fa01feeb02395a0e1961e07` | `main` (newest commit 2026-11-04T10:25Z). Installed (`bun install --frozen-lockfile`), tested, profiled and benchmarked in a temporary copy. |
| pulse-kit (baseline A) | `6a06ec25d26d90be12eba133972b59077dd0e17d` | the kit side A of the pulse-api bench (`bench/baseline.json`). Downloaded with `gh api repos/lorenzh/pulse-kit/tarball/6a06ec2...`, installed and measured in a temporary copy. `main` is 26 commits ahead (`gh api repos/lorenzh/pulse-kit/compare/6a06ec2...536133f`: `ahead_by` 26). |
| pulse-api | `4b3e9b1dcce5f4e362c6bc1f529375181fb49f9a` | `bench/budgets.json`, `bench/README.md`, `bench/run.ts`, `bench/measure.ts`, `bench/compare.ts`, `bench/load.ts`, `bench/baseline.json`, `src/admin-auth-throttle.ts`, `src/metrics.ts` (read only) |
| pulse-probe | `9490141ef9e92044808c70bb8200db3d497d1060` | kit call sites (`grep`), read only |
| pulse-notify | `c79f0b7cb5e25ada96e6314220e69cf4f5279b32` | kit call sites (`grep`), read only |
| pulse-status | `8b6d4315fcb989a7a8d74c063ab08d97c18a7d2d` | kit call sites (`grep`), read only |
| pulse-console | `fc2c166de8237a841b5253cef99bb3fd17f85f2f` | kit pin in `package.json`, read only |
| pulse-meta | `eb740148dd23557f610c903dce2ba0dc0825e04e` | this repository |

- Nightly bench that was read: run [42195136982](https://github.com/lorenzh/pulse-api/actions/runs/42195136982). It is the newest completed `bench.yml` run on `main` (`schedule`, 2026-11-06T09:27Z, api head `4b3e9b1`, conclusion `failure`). Side A of kit is `6a06ec2`. Side B is kit `main`, which was `536133f` at that time, so side B is the examined commit. Kit table of artifact `bench-out` (medians of 5 rounds):

| Metric | A (`6a06ec2`) | B (`536133f`) | B rounds | Budget | Kind | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `test_cpu_s` | 0.52 s | 0.77 s | 0.773, 0.768, 0.806, 0.719, 0.765 | 0.7 s | gating | **FAIL regression** |
| `build_cpu_s` | 0.40 s | 0.52 s | 0.524, 0.525, 0.504, 0.517, 0.509 | 0.6 s | gating | ok |

- The bench measures no other kit metric. Kit is a library, not a service: the bench starts no kit process and has no startup, load or memory row for it.
- Why the audit measured again: `test_cpu_s` fails, so the audit suspected a deviation. It measured `bun run test` locally on A and B with the bench's own method (`bench/measure.ts`: user + system CPU of the child from `resourceUsage()`, which includes the waited `tsc` grandchild). That measurement needs no Docker. The Docker A/B (`timeout 30m bun bench/run.ts --a <sha> --b <sha> --rounds 2`) was not run. It builds and loads all seven repositories, and for kit it runs the same `bun run test` and `bun run build` as the local A/B. Side B of the nightly is already the examined commit.
- Six earlier completed `bench.yml` runs on `main` with an artifact were read as well (artifact `bench-out`, `samples.json`). Kit `main` was `536133f` in all of them. They show how the kit value depends on the runner (finding 1).
- Machine: GitHub-hosted runner with 4 vCPU and 16 GB RAM, Bun 1.4.0, Linux. Everything ran on 127.0.0.1 in temporary copies (`mktemp -d`). No shared or production system was contacted. CPU of a child comes from `Bun.spawn(...).resourceUsage()` (user + system, as in `bench/measure.ts`), cross-checked with `/usr/bin/time`. CPU and memory of a running process come from `/proc/<pid>/stat` and `/proc/<pid>/status`.
- Helpers (not committed, kept outside the repository in a temporary directory):
  - `cpu.ts <cwd> <reps> <label> -- <cmd>`: runs a command N times and prints the exit codes, the child CPU, the median and the wall time.
  - `testcpu.ts <kit> <reps>`: `cpu.ts` for `bun run test` and for `bun test test/<file>` of every test file.
  - `prof.ts <n> <files>`: sums the self time per function, and per nearest frame with a file, over `.cpuprofile` files.
  - `empty.ts`, `http-only.ts`, `builtins.ts`, `dfmt.ts`: start baselines. They import nothing, `node:http` only, the 6 built-in modules of the kit entry (`node:http`, `node:net`, `node:dns/promises`, `node:crypto`, `node:fs`, `node:path`), or only build `Intl.DurationFormat("en", { style: "narrow" })`.
  - `startup.ts <kit>`: a service-like start. It imports `dist/index.js`, reads settings, creates a logger and a registry, starts `startOpsServer` on port 0, sends one `GET /readyz`, then closes.
  - `growth.ts <kit>`: micro-benchmarks of the helpers at 3 data sizes (item 3).
  - `limiter2.ts <kit> <live keys> <step ms>`: the cost of a new failing key in `createFailureLimiter` before a backward clock step, during it, and after it (finding 2).
  - `logcmp.ts <kit>`: the logger per line against a plain `JSON.stringify` of the same line.
  - `harness.ts` and `memrun.ts <kit> <min> <s>`: a small service made of kit helpers, and a steady load with RSS samples (item 4).
- Results: 2 findings, `P2` 1 and `P3` 1. Both are issue candidates. No `P1`. No item is blocked.

## Checklist

### 1. Queries: `EXPLAIN QUERY PLAN` for every query on the request path and at startup: `not applicable`

pulse-kit runs no SQL. `grep -rn -i -E 'sqlite|SELECT |INSERT |prepare\(|\.query\(' src/` finds nothing (exit code 1). The only built-in modules that `src/` imports are `node:http`, `node:net`, `node:dns/promises`, `node:crypto`, `node:fs` and `node:path` (`grep -h -o -E 'from "node:[a-z/]+"' src/*.ts | sort | uniq -c`). No module imports `bun:sqlite`.

### 2. Startup: CPU profile (`bun --cpu-prof`) with the top functions by self time: `checked`

Kit has no startup of its own. Its startup cost is the import of the entry `@lorenzh/pulse-kit` (`dist/index.js`), which api, probe, notify and status pay at every start. The services' `startup_cpu_ms` budgets are 325 ms (api), 377 ms (probe, status) and 455 ms (notify). The bench has no kit startup metric.

CPU per process start: `bun cpu.ts . <n> <label> -- bun <script>`, exit code 0 in every run.

| Start | Runs | CPU median | Range |
| --- | --- | --- | --- |
| empty script (runtime start) | 20 | 6 ms | 5-7 ms |
| `node:http` only | 15 | 31 ms | 29-33 ms |
| the 6 built-in modules of the kit entry | 15 | 36 ms | 35-37 ms |
| A `6a06ec2`: `bun dist/index.js` | 15 | 37 ms | 36-39 ms |
| B `536133f`: `bun dist/index.js` | 15 | 44 ms | 42-45 ms |
| B: `bun src/index.ts` (unbuilt source) | 10 | 45 ms | 44-49 ms |
| A: service-like start (`startup.ts`) | 10 | 49 ms | 48-51 ms |
| B: service-like start (`startup.ts`) | 10 | 58 ms | 55-62 ms |
| `new Intl.DurationFormat("en", { style: "narrow" })` only | 20 | 8 ms | 7-9 ms |
| B: `bun dist/format-duration.js` only | 20 | 8 ms | 7-10 ms |

Profile: `bun --cpu-prof --cpu-prof-interval=100 --cpu-prof-dir=prof --cpu-prof-name=b-<i>.cpuprofile kit/dist/index.js`, 5 runs, exit code 0. `bun prof.ts 15 prof/b-*.cpuprofile`: 751 samples, 194.9 ms sampled.

| Self time (5 runs) | Share | Function (as Bun names the frame) |
| --- | --- | --- |
| 119.3 ms | 61.2 % | `anonymous` (native, no source) |
| 9.4 ms | 4.8 % | `DurationFormat` (built at import, `src/format-duration.ts:14`) |
| 5.3 ms | 2.7 % | `node:net` module |
| 5.1 ms | 2.6 % | `node:crypto` module |
| 4.0 ms | 2.1 % | `setName` `node:fs:709` |
| 3.7 ms | 1.9 % | `hideFromStack` `internal:shared:17` |
| 3.4 ms | 1.8 % | `internal:validators` module |
| 3.3 ms | 1.7 % | `node:dns` module |
| 3.2 ms | 1.6 % | `node:http` module |
| 3.0 ms | 1.6 % | `debuglog` `node:util:23` |

By nearest frame with a file: `node:http` 12.0 %, `node:_http_server` 7.9 %, `node:dns` 6.8 %, `node:fs` 6.4 %, `node:fs/promises` 5.9 %, `internal:streams/duplex` 5.3 %, `dist/format-duration.js` 5.0 %, `node:_http_client` 4.6 %. No other kit file reaches 1 %.

The service-like start (`startup.ts`, 5 profiles, 1011 samples, 304.0 ms sampled) has the same shape: `anonymous` 42.5 %, `_onceWrap` `node:events:242` 10.7 % (listen and close), `importModule` 5.5 %, `DurationFormat` 3.4 %.

Result: the kit entry costs 44 ms of CPU. 36 ms of that is built-in modules, and 31 ms is `node:http`, which every service loads anyway. Kit's own code costs about 8 ms. About 2 ms of that is the `Intl.DurationFormat` that `src/format-duration.ts:14` builds at import (8 ms against 6 ms for an empty script). From A to B the entry grew by 7 ms (37 to 44 ms) and the service-like start by 9 ms (49 to 58 ms). That comes from the new modules and their built-ins `node:dns/promises`, `node:crypto` and `node:fs` (31 ms for `node:http` alone against 36 ms for all 6). No finding: this is below 3 % of every service budget, and no budget exists for kit. Notes 1 and 2.

### 3. Costs that grow with data: the repository's bench, or a local A/B with a larger data set: `checked`

Kit has no bench of its own, and the pulse-api bench measures only `test_cpu_s` and `build_cpu_s` of kit. So this item is a local measurement of each helper whose cost depends on its input. It uses the sizes of the pulse-api bench (`bench/load.ts`: `SEED_CHECKS` 20, `PROBE_LOCATIONS` 3, `POST_RATE` 30) at 1x, 10x and 100x. Command: `timeout 600 bun growth.ts <kit B copy>`, exit code 0, plus `limiter2.ts` and `logcmp.ts` (exit code 0 in every run).

**Metrics registry, in the shape of pulse-api `src/metrics.ts`.** One collector removes all series and sets 5 `pulse_api_check_state` series and 1 budget gauge per check. There is one latency histogram series per check (8 buckets), 3 location gauges and 15 request counters. `render()` is timed 31 times after 5 warm-up renders. `recordResult` (one `inc` plus one `observe`) is timed over 7 x 100,000 calls.

| Checks | `render()` median (min-max) | Output | `recordResult` median |
| --- | --- | --- | --- |
| 20 (1x) | 0.317 ms (0.239-2.876) | 21,482 bytes, 370 lines | 488 ns |
| 200 (10x) | 2.274 ms (2.005-3.506) | 202,822 bytes, 3,430 lines | 524 ns |
| 2,000 (100x) | 28.218 ms (25.933-31.465) | 2,046,822 bytes, 34,030 lines | 561 ns |

A scrape grows linearly with the series: about 1 KB of output and 11-14 µs per check. The per-result cost stays flat. Note 3.

**Failure limiter with the pulse-api policy** (`limit` 10, `windowMs` 60,000, `maxKeys` 10,000, `src/admin-auth-throttle.ts`). `growth.ts` used 5 repetitions of 200 new keys. `limiter2.ts` used the median of 100 new keys per phase.

| Live keys | `check` of a known key | new key, clock forward | new key while the clock is behind the newest window start |
| --- | --- | --- | --- |
| 100 | | 1.83 µs | 77.12 µs |
| 1,000 | 50 ns | 0.87-0.93 µs | 174.38 µs (growth), 191.99 µs (limiter2) |
| 5,000 | | 0.48 µs | 749.4 µs |
| 9,000 | 60 ns | 0.32 µs | 936.75 µs |
| 9,800 | | 0.69-1.22 µs | 1173.93, 1214.2, 1204.09, 1339.67 µs (1.1 s step, 4 runs); 1135.52 µs (1 h step) |

After the clock passes the newest window start again, a new key costs 0.35-0.70 µs. In normal operation, cost does not grow with the key count. While the clock is behind, every new key costs time that grows with the live keys, from 77 µs at 100 keys to 1,174 µs at 9,800 keys. That is finding 2.

**Logger** (`createLogger`, `write` a no-op, median of 7 repetitions):

| Line | 1x | 10x | 100x |
| --- | --- | --- | --- |
| fields object of 10 / 100 / 1,000 keys | 9.08 µs | 77.94 µs | 975.31 µs |
| the same with plain `JSON.stringify` (`logcmp.ts`) | 0.93 µs | 5.36 µs | 96.46 µs |
| one field nested 10 / 100 / 1,000 levels | 3.01 µs | 22.74 µs | 553.6 µs |
| the same, `JSON.stringify` with a no-op replacer | 1.97 µs | 17.17 µs | 423.54 µs |

The cost grows linearly with the keys. With depth it grows faster than linear, but a no-op replacer in plain `JSON.stringify` grows the same way (1.97 to 423.54 µs). So that growth comes from the runtime, not from kit's cycle check (`src/logger.ts:49-50`). Note 4.

**Linear helpers:**

| Helper | 1x | 10x | 100x |
| --- | --- | --- | --- |
| `escapeHtml` of 10 / 100 / 1,000 KiB (11 reps) | 0.197 ms | 1.966 ms | 17.956 ms |
| `escapeLabel` of 10 / 100 / 1,000 KiB (11 reps) | 0.033 ms | 0.324 ms | 3.344 ms |
| `readJsonBody` round trip over 127.0.0.1, 111 / 1,002 / 10,020 KiB (7 reps) | 1.005 ms | 5.14 ms | 44.156 ms |
| `writeFileAtomicSync` of 50 / 500 / 5,000 KiB, with `fsync` (7 reps) | 0.867 ms | 0.828 ms | 3.294 ms |

`readBody` keeps the chunks and joins them once (`src/http.ts:56-58`), so its cost is linear. The 5,000 KiB write is about the size of the 100x notify ledger in the notify performance audit (4.9 MB). Its cost is dominated by `fsync`.

**Test and build cost by source size** (A has 10 modules and 44 tests, B has 17 modules and 174 tests). See item 5: the suite went from 0.492 s to 0.713 s, and the build from 0.390 s to 0.465 s.

### 4. Memory over time: RSS after N minutes of steady load against the RSS at the start: `checked`

Kit has no process of its own. `harness.ts` builds a small service from kit helpers, shaped like pulse-api: `startOpsServer` (`/healthz`, `/readyz`, `/metrics` with the api-shaped registry of item 3, 20 checks), and a JSON server with `readJsonBody` and `sendJson`. It also has a failure limiter with the api policy and a logger that writes to a drained stdout and stderr.

- Command: `timeout 420 bun memrun.ts <kit B copy> 5 30`, exit code 0, harness exit code 0.
- Load, N = 5 minutes, open loop, per 100 ms: 3 `POST /results` with one result each (30/s, the bench `POST_RATE`), 1 `GET /metrics` (10/s), 1 `GET /readyz` or `/healthz` (10/s), 20 failing `/admin` requests from new addresses (200/s, which fills the limiter to `maxKeys` within 50 s and then uses the overflow window), and 1 unknown path (10/s). In total 80,418 requests: 6,186 x 200, 9,279 x 202, 30,030 x 401, 31,830 x 429, 3,093 x 404, and no error. 61,860 distinct client keys. 33,123 log lines.

| Time | VmRSS | VmHWM | CPU |
| --- | --- | --- | --- |
| ready, before load | 41.31 MiB | 41.31 MiB | 0.04 s |
| 10 s into load (start value) | 67.96 MiB | 67.96 MiB | 0.64 s |
| 60 s | 73.31 MiB | 73.31 MiB | 3.44 s |
| 90 s | 72.75 MiB | 80.57 MiB | 4.66 s |
| 150 s | 73.11 MiB | 80.57 MiB | 7.13 s |
| 210 s | 73.87 MiB | 80.57 MiB | 9.35 s |
| 270 s | 71.48 MiB | 80.57 MiB | 11.78 s |
| 300 s | 71.48 MiB | 80.57 MiB | 12.88 s |
| end, after the load stopped | 69.37 MiB | 80.57 MiB | 12.90 s |

- JS heap after a forced GC (`Bun.gc(true)`, `process.memoryUsage().heapUsed`): 3.82 MB at 10 s and 3.88 MB at the end.
- Result: RSS after 5 minutes is 69.37 MiB, against 67.96 MiB at the start of the load (+1.41 MiB). From 60 s to 300 s it moves between 69.97 and 73.87 MiB with no upward trend. The limiter table stays bounded at `maxKeys`. The registry holds a fixed set of series under a fixed label set. No leak, no finding. The harness is a stand-in, so its values are not compared with a service's `idle_rss_mib` or `peak_rss_mib` budget. For reference, the notify budget is 86 MiB and the api budget 88 and 115 MiB.

### 5. Tests: CPU time per test file; name the slowest files: `checked`

Bench: `test_cpu_s` B 0.77 s, budget 0.7 s (gating): **FAIL regression** (A 0.52 s). This is finding 1.

Local A/B, `bun cpu.ts . 5 <label> -- <cmd>` in the copies of A and B, exit code 0 in every run unless stated:

| Measurement | A `6a06ec2` | B `536133f` |
| --- | --- | --- |
| `bun run test` (whole suite) | 0.492 s (0.488-0.511), 44 tests, 10 files | 0.719 s (0.701-0.752) and 0.713 s (0.704-0.714), 174 tests, 18 files |
| only `dist matches a fresh build of src` (`test/smoke.test.ts:30`) | 0.420 s (0.402-0.467) | 0.488 s (0.459-0.533) |
| everything except that test (`--test-name-pattern '^(?!dist matches)'`) | 0.106 s (0.105-0.107) | 0.251 s (0.248-0.254) |
| `bun run build` | 0.390 s (0.381-0.419) | 0.465 s (0.434-0.507) |
| `bun run typecheck` (3 runs) | | 0.655 s (0.655-0.667) |

Cross-check with `/usr/bin/time -f '%U %S'` on B, 3 runs each, exit code 0: `bun run test` 0.70, 0.73 and 0.75 s; the dist test 0.47, 0.53 and 0.47 s; the rest 0.24, 0.24 and 0.23 s.

CPU per test file on B: `timeout 600 bun testcpu.ts . 5`, 5 runs per file. Each file runs in its own process, so each value includes a fixed cost of about 0.029 s, the value of the 23-line `escape.test.ts`.

| File | CPU median (5 runs) | Exit code |
| --- | --- | --- |
| `smoke.test.ts` | **0.503 s** (0.489-0.549) | 0 |
| `failure-limiter.test.ts` | 0.083 s | 1 (coverage threshold) |
| `guarded-fetch.tls.test.ts` | 0.081 s | 1 (coverage threshold) |
| `ops-server.test.ts` | 0.073 s | 1 (coverage threshold) |
| `http.test.ts` | 0.057 s | 0 |
| `atomic-write.test.ts` | 0.055 s | 0 |
| `timer.test.ts` | 0.050 s | 1 (coverage threshold) |
| `guarded-fetch.test.ts` | 0.049 s | 1 (coverage threshold) |
| `address-guard.test.ts` | 0.040 s | 0 |
| `run-service.test.ts` | 0.034 s | 1 (coverage threshold) |
| `ip-classifier.test.ts`, `logger.test.ts`, `metrics.test.ts` | 0.033 s | 0, 1, 1 |
| `format-duration.test.ts`, `settings.test.ts` | 0.032 s | 0, 1 |
| `secret-file.test.ts` | 0.031 s | 1 (coverage threshold) |
| `is-record.test.ts` | 0.030 s | 0 |
| `escape.test.ts` | 0.029 s | 0 |

The exit code 1 of a single file is the coverage threshold of `bunfig.toml` (`lines = 0.8`), not a failing test. All 10 such files report `0 fail` (for example `logger.test.ts`: `13 pass`, `0 fail`, 42.45 % lines). Note 5.

Slowest files and tests:

1. `test/smoke.test.ts`, test `dist matches a fresh build of src` (`test/smoke.test.ts:30-49`): 0.488 s, 68 % of the suite. It runs the whole `tsc -p tsconfig.build.json` as a child (`execFileSync`), the same work as `bun run build`.
2. `test/failure-limiter.test.ts`, test `scripted run keeps every window and interval within the bound` (`:165-191`): 0.080 s for this test alone, against 0.026 s for the other 33 tests of the file (5 runs each). That is about 0.054 s, mostly the sweep `for (let s = -windowMs; s <= 180_000; s++)` with an `evaluated.filter(...)` per step (`:187-189`).
3. `test/guarded-fetch.tls.test.ts`: 0.081 s. It runs `openssl` to make a test certificate (`:31-33`).
4. `test/ops-server.test.ts`: 0.073 s (real servers on port 0).

From A to B the suite grew by 0.221 s (+45 %). The tests other than the dist test add 0.145 s (from 43 to 173 tests; 8 of the 18 files are new). The dist test adds 0.068 s, because `tsc` now compiles 17 modules instead of 10.

### 6. pulse-website only: JS and CSS size against the budget; Lighthouse of Home and Hosted: `not applicable`

This audit covers pulse-kit, a server-side helper library with no pages and no browser bundle.

## Issue candidates

### performance-kit-2026-11-06-1 (`P2`): `test_cpu_s` of kit fails its gating budget; 68 % of it is a full `tsc` build inside the test suite

- Location: `test/smoke.test.ts:30-49` (the test `dist matches a fresh build of src`). The budget is `bench/budgets.json` of pulse-api (`kit.test_cpu_s`).
- Commands:
  - Nightly: run 42195136982, artifact `bench-out`, `table.md` and `samples.json`.
  - Local, in the copies of A `6a06ec2` and B `536133f`: `bun cpu.ts . 5 <label> -- bun run test`, `-- bun test test/smoke.test.ts --test-name-pattern 'dist matches'`, `-- bun test --test-name-pattern '^(?!dist matches)'`. Child CPU comes from `resourceUsage()`, as in `bench/measure.ts`. Cross-check: `/usr/bin/time -f '%U %S' bun run test`.
- Exit code: 0 (all local runs). The nightly run ended with conclusion `failure`.
- Excerpt:

```
nightly 42195136982 | `test_cpu_s` | 0.52 s | 0.77 s | +46.4% | 0.70 s | gating | FAIL regression |
B rounds: 0.773, 0.768, 0.806, 0.719, 0.765   A rounds: 0.511, 0.525, 0.511, 0.531, 0.524
local B {"label":"full suite (bun run test)","exit":[0,0,0,0,0],"cpuMedianS":0.713,"cpuS":[0.712,0.704,0.713,0.713,0.714]}
local B {"label":"smoke: dist matches a fresh build","exit":[0,0,0,0,0],"cpuMedianS":0.488,"cpuS":[0.459,0.533,0.488,0.481,0.492]}
local B {"label":"full suite without the dist test","exit":[0,0,0,0,0],"cpuMedianS":0.251} 173 pass
local A {"label":"A full suite (bun run test)","exit":[0,0,0,0,0],"cpuMedianS":0.492} 44 pass
```

- Value: 0.768 s (nightly median of B). Locally 0.713 s and 0.719 s (two series of 5 runs).
- Baseline: A `6a06ec2` 0.524 s (nightly) and 0.492 s (local). B/A is 1.47 in the nightly and 1.45 locally.
- Budget: `test_cpu_s` 0.7 s, gating, no floor. `bench/compare.ts:185-186` marks `FAIL regression` when B - A > max(10 % of A, 0.2 s), and `FAIL budget` when B > 0.7 s.
- Runner dependence. Kit `main` was `536133f` in each of the 7 runs with an artifact among the 8 newest completed `bench.yml` runs on `main` (2026-11-05T06:27Z to 2026-11-06T09:27Z; run 42173147402 has no `bench-out`). The B median was 0.768, 0.747, 0.738, 0.676, 0.564, 0.532 and 0.465 s (runs 42195136982, 42173433280, 41986370639, 41980510751, 42056398988, 42003046407, 41993793776). B/A was 1.44 to 1.47 in each of the 4 runs where A was `6a06ec2`. So B is over the budget whenever the runner is slow enough that A is above about 0.48 s. That happened in 3 of the 7 runs. In run 42173433280 both sides are `main` (0.758 and 0.747 s), and the table gives `FAIL budget`.
- Why it matters: the gate in `bench/budgets.json` fails for the current kit `main` on realistic hosted runners: in 3 of 7 runs B was over 0.7 s, and in the newest scheduled run the gate failed. The documented `test_cpu_s` budget therefore does not hold for the current code. Most of the cost is not tests of kit behavior. The suite repeats the `bun run build` compile (0.488 s against 0.465 s for `bun run build`). The other 173 tests cost 0.251 s, 36 % of the budget. `bun run check` compiles the sources three times: `build`, `typecheck` and this test.
- Direction (for the owner): measure the dist check outside `test_cpu_s`, for example as its own CI step that compares a fresh build with `dist`, or make it cheaper. Otherwise set the budget again with the bench README rule (A median + 30 %) on the current `main`.

### performance-kit-2026-11-06-2 (`P3`): after a backward clock step, every new key in the failure limiter re-sorts the whole key table (about 1.2 ms at 9,800 keys)

- Location: `src/failure-limiter.ts:125-135`. In the `"new"` branch of `recordFailure`, `if (t < latestStart)` copies and sorts all live windows and rebuilds the map: `[...own].sort(...)`, `own.clear()`, re-insert. `latestStart` keeps the highest start ever seen (`:135`). So the branch runs for every new key until the clock passes the newest window start again, that is for the whole size of the step. The windows opened before the step stay live for the step plus `windowMs`, so the table does not shrink in that time.
- Command: `timeout 120 bun limiter2.ts <kit B copy> <live keys> <step ms>` with the api policy (`limit` 10, `windowMs` 60,000, `maxKeys` 10,000) and an injected clock. It fills the table, adds 100 new keys, steps the clock back, adds 100 new keys, moves the clock past the newest start, and adds 100 new keys. Live keys 100, 1,000, 5,000 and 9,800; at 9,800 four runs with a 1.1 s step and one with a 1 h step. Also `growth.ts` (5 repetitions x 200 new keys, a 1 s step).
- Exit code: 0.
- Excerpt:

```
{"liveKeysAtStep":1000,"stepBackMs":1100,"newKeyUsMedianBefore":0.87,"newKeyUsMedianWhileBehind":191.99,"newKeyUsMedianAfterCatchUp":0.35,"newKeysPerPhase":100}
{"liveKeysAtStep":5000,"stepBackMs":1100,"newKeyUsMedianBefore":0.48,"newKeyUsMedianWhileBehind":749.4,"newKeyUsMedianAfterCatchUp":0.39,"newKeysPerPhase":100}
{"liveKeysAtStep":9800,"stepBackMs":1100,"newKeyUsMedianBefore":1.22,"newKeyUsMedianWhileBehind":1173.93,"newKeyUsMedianAfterCatchUp":0.43,"newKeysPerPhase":100}
{"liveKeysAtStep":9800,"stepBackMs":3600100,"newKeyUsMedianBefore":0.88,"newKeyUsMedianWhileBehind":1135.52,"newKeyUsMedianAfterCatchUp":0.47,"newKeysPerPhase":100}
```

- Value: 1.2 ms per new failing key at 9,800 live keys (medians 1173.93, 1214.2, 1204.09 and 1339.67 µs in 4 runs).
- Repetitions: 100 new keys per phase, median; 4 runs at 9,800 keys, 1 run each at 100, 1,000 and 5,000 keys; `growth.ts` 5 repetitions x 200 keys (1,000 keys 174.38 µs, 9,000 keys 936.75 µs).
- Baseline: the same new key with a forward clock, 0.32-1.83 µs, and after the clock passes the newest start again, 0.35-0.70 µs. A step back is about 1,000 times slower at 9,800 keys. It grows with the live keys: 77, 192, 749 and 1,174 µs at 100, 1,000, 5,000 and 9,800 keys.
- Budget: none. Kit has no limiter metric, and pulse-api has no budget for its admin routes.
- Impact: pulse-api calls `check` and then `recordFailure` synchronously for every failed admin authentication (`src/admin-auth-throttle.ts:79-94`; the comment at `:34` says "Synchronous on purpose"). During a backward clock step, each failing client with a new key blocks the event loop for up to about 1.2 ms. That lasts as long as the step, and the table holds up to 9,999 keys (at `maxKeys` a new key goes to the overflow window and no sort runs). It needs a backward step of the wall clock (`now: Date.now`) together with many distinct failing clients, so it is a corner case. The sort exists for correctness: commit `66fb3d3` keeps the windows in start order after a backward jump, and the doc comment (`:21-24`) describes that case.
- Direction (for the owner): keep the start order without a full sort per insert. For example, insert the one new window at its position, or re-sort once per step instead of once per key.

## Notes

1. **`Intl.DurationFormat` at import** (`src/format-duration.ts:14`). It is built at module load. That costs about 2 ms of CPU per process (median 8 ms against 6 ms for an empty script, 20 runs each; 9.4 ms of 194.9 ms in the 5 import profiles). Every service that imports the kit entry pays it: `dist/index.js` re-exports `format-duration.js`. Only status (`src/render.ts`) and notify (`src/channels/message.ts`) call `formatDuration`. Building it on first use would save the 2 ms in api and probe. Below 1 % of every startup budget, so not a finding.
2. **Kit entry import cost grew from A to B**: 37 to 44 ms of CPU (+7 ms). Of that, about 5 ms comes from the built-in modules of the new helpers (`node:dns/promises`, `node:crypto`, `node:fs`). The services pin older kit commits: api `c6d2cba`, probe `739188a`, notify and status `236df21`, console `536133f`. They pay this cost when they update the pin. It is within budgets.
3. **`/metrics` render** is linear in the series: 0.317, 2.274 and 28.218 ms for 20, 200 and 2,000 checks in the api shape, with about 1 KB of output per check. The api collector drops and rebuilds all `pulse_api_check_state` and budget series at every scrape (`checkState.remove({})`, api `src/metrics.ts:137`). `Histogram.observe` allocates a new bucket array per call (`src/metrics.ts:140-142`). At 488-561 ns per recorded result, both are not worth a finding at bench sizes.
4. **Logger per line**: 8.3 µs for 10 fields against 0.93 µs for a plain `JSON.stringify` of the same line (`logcmp.ts`). Each field is serialized on its own with a replacer function, for BigInt, cycles and throwing getters (`src/logger.ts:39-56`). At the api request rate that is negligible. The faster-than-linear growth with nesting depth comes from the runtime's replacer path, not from kit.
5. **Single test files exit 1.** `bun test test/<name>.test.ts`, the "One test file" command of `AGENTS.md`, exits with code 1 for 10 of the 18 files although every test passes. The reason is the 80 % line threshold of `bunfig.toml`, applied to the files loaded by that run. This is not a performance item. It is noted because it can be mistaken for a failure when timing single files.
6. **`build_cpu_s`** is `ok`: B 0.52 s against the 0.6 s budget in the nightly (87 %), and the highest B median of the 7 runs was 0.517 s. Locally B takes 0.465 s and A 0.390 s. It grows with the number of modules, and like `test_cpu_s` it varies by runner (B medians 0.302 to 0.517 s across the 7 runs).
7. **Bench calibration (pulse-api scope).** The same kit commit gave a `test_cpu_s` B median from 0.465 to 0.768 s across 7 hosted runs, a spread of 1.65 times. The kit budget has no `floor`. The README rule sets the budget from one local A run plus 30 % (`bench/README.md:114`). With a spread like this, kit can fail the gate without a code change. Finding 1 is still a real cost increase: B/A is 1.44 to 1.47 in each of the 4 runs with A `6a06ec2`, and locally it is 1.45.
8. **Docker A/B not run.** `timeout 30m bun bench/run.ts --a 6a06ec2... --b 536133f... --rounds 2` would rebuild all seven repositories. For kit it measures the same `bun run test` and `bun run build` that item 5 measured locally on both sides. The nightly side B is already the examined commit.
9. Cleanup: the copies of A and B, the profiles and the helpers were in temporary directories outside the repository and were removed at the end. The harness was stopped with `SIGTERM` (exit code 0), and no process was left running.
