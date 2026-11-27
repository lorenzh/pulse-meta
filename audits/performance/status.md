# Performance audit: pulse-status (2026-11-27)

## Scope

- Issue: lorenzh/pulse-meta#986, periodic performance audit of `main` of pulse-status.
- Earlier runs: the issue has only the Factory claim comment. No earlier performance report of status exists, so this report is new.
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-status | `f220fbc27a2d733e583aba63e5949062f29d9861` | `main` (also tag `v0.1.1`). Installed (`bun install --frozen-lockfile`, exit 0), run, profiled and tested in a temporary copy. |
| pulse-api | `8959e0469a7b7a16e2329e968a7c42e176d287c6` | `bench/budgets.json`, `bench/README.md`, `bench/load.ts`, `bench/stack.ts`, `bench/measure.ts`, `bench/run.ts`, `bench/compose.bench.yaml`, `docs/rest-api.md` (read only) |
| pulse-contract | pinned `96f33aaa85188c0794dedca89035f9c5500f85ee` (from the status lockfile) | `dist/client.js` (body cap), `dist/version.js` (read only, inside the installed copy) |
| pulse-meta | `65b03892e525f495b338965dee780f35a440e0f7` | this repository |

- Nightly bench that was read: run [45986105595](https://github.com/lorenzh/pulse-api/actions/runs/45986105595). It is the newest completed `bench.yml` run on `main` (`schedule`, 2026-11-27T10:55Z, api head `8959e04`, conclusion `failure`, failed step "Run the comparison"). Side A of status is `v0.1.1`, side B is `main`; both resolve to `f220fbc`, the commit examined here (`samples.json` `shas.a.status` and `shas.b.status`). Status table of artifact `bench-out` (medians of 5 rounds):

| Metric | A (`v0.1.1`) | B (`main`) | B rounds | Budget | Kind | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `startup_cpu_ms` | 240 ms | 260 ms | 270, 230, 260, 260, 230 | 377 ms | gating | ok |
| `load_cpu_s` | 0.08 s | 0.07 s | 0.08, 0.07, 0.08, 0.07, 0.04 | 0.5 s | gating | ok |
| `idle_rss_mib` | 67.57 MiB | 67.65 MiB | 67.45 to 67.88 | 82 MiB | gating | ok |
| `peak_rss_mib` | 69.98 MiB | 70.11 MiB | 69.11 to 70.62 | 85 MiB | gating | ok |
| `test_cpu_s` | 4.44 s | 4.04 s | 3.97, 4.09, 4.48, 4.04, 3.98 | 3.4 s | gating | **FAIL budget** |
| `startup_wall_ms` | 793 ms | 794 ms | 760 to 860 | 965 ms | reported | |
| `image_mb` | 96.26 MB | 96.26 MB | | 124 MB | reported | |

- The same run also fails `test_cpu_s` of probe and notify; those belong to their own audits.
- Older nightlies (artifacts of runs 45806020830, 45394568321, 45159517328, 44716002240, 44283365279 and 43843140354, 2026-11-16 to 2026-11-26) examine the same status commit `f220fbc` on both sides and all give `FAIL budget` for status `test_cpu_s` (B medians 4.53, 4.15, 4.09, 4.12, 5.39 and 5.49 s). Run 45603677189 has no `bench-out` artifact. All 15 scheduled runs since 2026-11-13 have conclusion `failure` (`gh run list --repo lorenzh/pulse-api --workflow bench.yml --branch main --limit 15`).
- Why the bench A/B was not run again: A and B already examine the same status commit, so a new A/B would compare identical status code. The one deviation (`test_cpu_s`) was measured locally instead (item 5). Every other status row is `ok`.
- Machine: GitHub-hosted runner, 4 vCPU, 15 GiB RAM, Linux, Bun 1.4.0. Everything ran on 127.0.0.1 in temporary copies (`mktemp -d`) against a local fake pulse-api. No shared or production system was contacted. Server CPU time comes from `/proc/<pid>/stat` (utime + stime, 10 ms resolution) and memory from `/proc/<pid>/status` (`VmRSS`, `VmHWM`). The bench measures inside a container (PID 1), and the status process here ran on the host, so absolute values differ (for example `startup_cpu_ms` 260 ms in the bench and 100-110 ms here). Budget comparisons of the local workloads are reference comparisons, not nightly gate results.
- Helpers (not committed, kept outside the repository and removed at the end):
  - `fakeapi.ts`: a fake pulse-api with N checks. It serves `/checks` (3 locations per check, each with an `slo`), `/uptime` and `/latency` (90 days per check, the shape of `docs/rest-api.md` of pulse-api), `/components` (N/5 components of 5 checks), `/components/uptime`, `/incidents?status=open` (N/25), `/incidents?status=resolved` (2N in the last 7 days), `/maintenance` (N/10) and `/manual-incidents` (empty), with the header `x-pulse-contract: 1`. It counts the requests per path.
  - `grow.ts`: starts `bun src/main.ts`. It reads CPU and RSS at the first `200` of `/readyz`, times a cold `GET /`, six page rebuilds (a `GET /` 2.1 s apart, after the 2 s cache period), 50 warm `GET /`, and a load window. Optional `--cpu-prof`.
  - `badge.ts`: server CPU per conditional request (`If-None-Match` with the tag of the first answer) to one path, 300 requests after 20 warm-up requests, with `PULSE_STATUS_CACHE_MS=3600000` as in `bench/conditional.ts`.
  - `mem.ts`: samples RSS and `VmHWM` every 30 s for N minutes.
  - `prof.ts`: sums the self time of `.cpuprofile` files per function and per nearest file frame.
- Load model ("10 visitors"): each visitor loads `/` once, then fetches the 10 `/api/*` paths of the browser poller every 5 s, the default `POLL_MS`. `mem.ts` also loads `/` again every minute. No `If-None-Match` is sent, so this is the cost without browser revalidation.
- Data sets: 20 checks (the pulse-api bench seed, `SEED_CHECKS = 20` in `bench/load.ts`), 200 checks (10x) and 1000 checks (50x). Two layouts: the default (`PULSE_STATUS_SHOW_CHECKS` unset, so components are shown and checks are hidden) and `PULSE_STATUS_SHOW_CHECKS=true`.
- Results: 5 findings: 1 `P2` and 4 `P3`. 4 are issue candidates and 1 is a note. No item is blocked.

## Checklist

### 1. Queries: `EXPLAIN QUERY PLAN` for every query on the request path and at startup: `not applicable`

pulse-status has no database. `grep -rn "sqlite\|bun:sqlite\|Database" src/*.ts | grep -v test` (exit 0) finds only the function name `readDatabase` in `src/settings-poll.ts:107`, which reads `GET /service/status/settings` over HTTP. No SQL runs in status. Its request path reads pulse-api over HTTP. The query plans of those api reads are part of the api audit (`audits/performance/api.md`).

The cost status puts on the api was checked once. A fresh fake api (20 checks) and `bun src/main.ts` (`PULSE_STATUS_SHOW_CHECKS=true`) got 100 concurrent `GET /` and then 30 concurrent requests each to `/api/checks`, `/api/uptime` and `/api/latency`. The fake api counted `{"/checks":2,"/incidents?status=open":1,"/maintenance":1,"/incidents?status=resolved":1,"/uptime":1,"/latency":1,"/components":1,"/components/uptime":1,"/manual-incidents":1}`: one read per path, plus the readiness poll of `/checks`. The single flight per cache period that `docs/operation.md:124` describes holds.

### 2. Startup: CPU profile (`bun --cpu-prof`) with the top functions by self time: `checked`

- Bench: `startup_cpu_ms` B 260 ms (rounds 230 to 270), budget 377 ms (gating): `ok`. `startup_wall_ms` B 794 ms, budget 965 ms (reported).
- Local CPU at the first `200` of `/readyz` without the profiler (`grow.ts`, exit 0): 100, 110 and 110 ms at 20 checks; 100, 100 and 110 ms at 200 checks; 110, 110 and 110 ms at 1000 checks. Wall time to ready: 85-92 ms. RSS at ready: 65.3-65.6 MiB (20), 65.9-66.0 MiB (200), 69.5-69.8 MiB (1000). Startup does not grow with the data. Readiness waits only for one `GET /checks` (`src/api-poll.ts`), which is not validated.
- Profile: `timeout 300 bun grow.ts <status copy> http://127.0.0.1:18320 prof-20 3 0 false 18421 <dir>` and the same with the 1000-check api. This runs `bun --cpu-prof --cpu-prof-interval=100 src/main.ts` and sends `SIGTERM` right after the first `200` of `/readyz`. 3 runs per size, exit 0. CPU at ready under the profiler: 120, 130 and 120 ms (20 checks); 130, 120 and 130 ms (1000 checks).
- Self time summed over the 3 runs at 20 checks (`timeout 60 bun prof.ts 16 prof-20-r*.cpuprofile`, exit 0: 936 samples, 278.5 ms sampled):

| Self time | Share | Function (as Bun names the frame) |
| --- | --- | --- |
| 82.2 ms | 29.5 % | `anonymous` (native, no source) |
| 19.8 ms | 7.1 % | `_onceWrap` `node:events:242` |
| 18.6 ms | 6.7 % | `node:util` module |
| 13.2 ms | 4.8 % | `DateTimeFormat` (four `Intl.DateTimeFormat` built at import, `src/ssr.ts:19-40`) |
| 5.3 ms | 1.9 % | `(anonymous)` |
| 5.0 ms | 1.8 % | `init` `zod/v4/core/core.js:50` |
| 4.6 ms | 1.7 % | `parse` |
| 4.5 ms | 1.6 % | `readBool` `@lorenzh/pulse-kit/dist/settings.js:112` |
| 4.3 ms | 1.5 % | `readRanged` `@lorenzh/pulse-kit/dist/settings.js:25` |
| 4.0 ms | 1.5 % | `readSubscriptions` `src/settings.ts:115` |
| 4.0 ms | 1.4 % | `recordPoll` `src/metrics.ts:66` |

  By nearest file frame: runtime and built-in modules (no file frame) 36.5 %, `zod` 18.8 %, `src/main.ts` 8.2 %, `@lorenzh/pulse-kit` 6.4 %, `@lorenzh/pulse-contract` 5.4 %, `src/ssr.ts` 4.8 %, `src/runtime-settings.ts` 1.9 %, `src/start.ts` 1.8 %. Startup is module loading. At 1000 checks (961 samples, 279.8 ms) the split is the same: no file frame 28.6 %, `zod` 19.5 %, `src/main.ts` 8.1 %, `@lorenzh/pulse-contract` 7.7 %, `@lorenzh/pulse-kit` 7.1 %, `src/ssr.ts` 4.7 %. `JSON.parse` of the 0.8 MB `/checks` shows as `parse` with 5.8 ms over 3 runs.
- No startup finding: every value is well below the 377 ms budget.

### 3. Costs that grow with data: the repository's bench, or a local A/B with a larger data set: `checked`

**The repository's bench.** `bench/proxy-cache.ts` and `bench/conditional.ts` use 100 checks and 90 days. A copy of each with `CHECKS = 1000` (`sed 's/^const CHECKS = 100;/const CHECKS = 1000;/'`, in the temporary copy only) is the 10x side. Command: `timeout 590 bash -c 'for i in 1 2 3; do for b in proxy-cache proxy-cache-10x conditional conditional-10x; do bun bench/$b.ts; done; done'`, then `--hidden` for `proxy-cache`. Exit 0, 3 runs each. Client and server run in one process, so `cpuMs` includes the client.

| Bench (300 requests per route) | 100 checks (3 runs) | 1000 checks (3 runs) |
| --- | --- | --- |
| `proxy-cache`: cached `GET /api/uptime` | 213, 205, 220 ms CPU; RSS 96-99 MiB | 1063, 1137, 1185 ms CPU; RSS 162-208 MiB |
| `proxy-cache --hidden` | 77, 84, 77 ms | 79, 77, 69 ms |
| `conditional` `/api/checks` (all `304`) | 69, 68, 82 ms | 77, 72, 87 ms |
| `conditional` `/feed.atom` (all `304`) | 76, 74, 86 ms | 192, 185, 191 ms |
| `conditional` `/badge/check-0.svg` (all `304`) | 517, 515, 521 ms | 4916, 3858, 4876 ms |

A cached `/api/uptime` costs in proportion to its body (4.5 MB at 1000 checks). A `304` of `/api/checks` costs the same at both sizes. A `304` of the check badge costs 9.4 times more at 10x, although its body is about 450 bytes: finding 2.

**Local A/B by data size.** Command: `timeout 590 bash -c "bun grow.ts <copy> http://127.0.0.1:18320 def-20 3 30 false 18401; ... def-200 ...; ... def-1000 ..."`, then the same with `true` (2 runs per size). Exit 0, 0 error log lines.

| Cost (default layout, 3 runs) | 20 checks, 4 components | 200 checks, 40 components | 1000 checks, 200 components |
| --- | --- | --- | --- |
| `GET /` body (no compression) | 53,281 B | 480,016 B | 1,526,457 B |
| Cold `GET /` (first render) | 30.5-30.6 ms, 50-60 ms CPU | 95.1-98.6 ms, 220-240 ms CPU | 125.3-132.6 ms, 260-270 ms CPU |
| Page rebuild after the 2 s cache period (18 samples) | median 25 ms CPU (10-40), 11.2 ms wall | median 90 ms CPU (70-100), 53.1 ms wall | median 130 ms CPU (110-170), 86.4 ms wall |
| Warm `GET /` p95 (50 requests) | 0.52, 0.55, 0.57 ms | 0.82, 0.98, 0.85 ms | 2.10, 2.30, 1.95 ms |
| 10 visitors, 610 requests in 34.5 s: CPU per 60 s | 0.75, 0.71, 0.73 s | 2.23, 2.39, 2.20 s | 2.86, 3.02, 3.09 s |
| `VmHWM` after the load | 87.9, 87.8, 88.5 MiB | 140.7, 140.8, 143.6 MiB | 178.7, 175.0, 180.8 MiB |
| Failed requests in the load | 0 | 0 | 120 of 610 (`/api/latency`, `/api/components/latency`: `502`) |

| Cost (`PULSE_STATUS_SHOW_CHECKS=true`, 2 runs) | 20 checks | 200 checks | 1000 checks |
| --- | --- | --- | --- |
| `GET /` body | 267,012 B | 2,616,442 B | 8,879,289 B |
| Cold `GET /` | 41.8-41.9 ms, 80 ms CPU | 161.6-171.0 ms, 340-350 ms CPU | 325.2-329.3 ms, 540-590 ms CPU |
| Page rebuild (12 samples) | median 30 ms CPU, 17.7 ms wall | median 155 ms CPU, 103.9 ms wall | median 365 ms CPU, 262.9 ms wall |
| Warm `GET /` p95 | 0.69, 0.64 ms | 3.74, 3.10 ms | 11.81, 10.37 ms |
| 10 visitors: CPU per 60 s | 0.71, 0.68 s | 1.90, 1.89 s | 4.11, 4.04 s |
| `VmHWM` after the load | 98.4, 96.5 MiB | 177.2, 178.1 MiB | 326.1, 326.6 MiB |
| Failed requests | 0 | 0 | 60 of 610 (`/api/latency`: `502`) |

**Conditional feed and badge requests by size.** `timeout 400 bash -c "for i in 1 2 3; do ... bun badge.ts <copy> <api> shown-<n>-r$i true 18441 300 /badge/check-1.svg /api/checks /feed.atom; bun badge.ts <copy> <api> def-<n>-r$i false 18442 300 /badge/component/comp-1.svg /api/components; done"` (exit 0). Every measured request answered `304`. Server CPU per request, 3 runs:

| Path (all `304`) | 20 checks | 200 checks | 1000 checks |
| --- | --- | --- | --- |
| `/badge/check-1.svg` | 0.57, 0.53, 0.60 ms | 3.57, 3.53, 3.53 ms | 16.23, 13.20, 17.13 ms |
| `/feed.atom` | 0.63, 0.60, 0.60 ms | 4.47, 4.57, 4.60 ms | 24.83, 24.17, 24.23 ms |
| `/badge/component/comp-1.svg` | 0.33, 0.30, 0.33 ms | 0.90, 0.90, 0.87 ms | 3.40, 3.37, 3.40 ms |
| `/api/checks` | 0.07, 0.13, 0.07 ms | 0.07, 0.13, 0.07 ms | 0.10, 0.13, 0.07 ms |
| `/api/components` | 0.07, 0.07, 0.07 ms | 0.10, 0.07, 0.10 ms | 0.07, 0.10, 0.10 ms |

How the costs scale:

- Startup does not grow with the data (item 2).
- A stored `/api/*` answer costs the same at every size (a `304` 0.07-0.13 ms). A `200` costs in proportion to its body. The proxy reads each upstream path once per cache period (item 1).
- The page grows linearly. Each shown check adds about 13 KB of HTML: its 90 bars and a 90-row "Daily values" table (21,840 `<tr>` at 200 checks shown). Each component adds about 12 KB. A rebuild runs at most once per 2 s cache period while there is traffic, and its CPU grows with the page: 25 to 130 ms (default) and 30 to 365 ms (checks shown) from 20 to 1000 checks. Peak memory grows with it: finding 5.
- The feed and the badges rebuild their answer on every request, also for a `304`. So each request costs in proportion to the number of checks and incidents: finding 2.
- At about 1000 HTTP checks, the `/latency` answer of 90 days is larger than the 5 MiB body cap. `/api/latency` and `/api/components/latency` then answer `502` and the latency charts disappear: finding 4.

### 4. Memory over time: RSS after N minutes of steady load, against the RSS at the start: `checked`

- Command: `timeout 420 bash -c "bun mem.ts <copy> http://127.0.0.1:18320 mem-20-load 5 18431 10 & bun mem.ts <copy> http://127.0.0.1:18321 mem-200-load 5 18432 10 & bun mem.ts <copy> http://127.0.0.1:18320 mem-20-idle 5 18433 0 & wait"`. Exit 0, all three status processes exited 0.
- N = 5 minutes. The load: default settings (`POLL_MS` 5000, `PULSE_STATUS_CACHE_MS` 2000, default layout) and 10 visitors (see Scope), 6,050 requests per loaded process in 5 minutes (about 20 per second), 0 failed. The idle process gets no requests, as in the nightly bench.
- RSS and `VmHWM` every 30 s (MiB):

| t (s) | 0 | 30 | 60 | 90 | 120 | 150 | 180 | 210 | 240 | 270 | 300 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20 checks, idle: RSS | 65.2 | 62.5 | 62.7 | 62.7 | 62.7 | 62.7 | 62.9 | 62.8 | 63.2 | 63.0 | 63.0 |
| 20 checks, idle: `VmHWM` | 65.2 | 64.9 | 64.9 | 64.9 | 64.9 | 64.9 | 64.9 | 64.9 | 64.9 | 64.9 | 64.9 |
| 20 checks, load: RSS | 64.9 | 84.6 | 79.5 | 82.5 | 84.6 | 81.3 | 82.8 | 84.6 | 84.3 | 82.9 | 83.4 |
| 20 checks, load: `VmHWM` | 64.9 | 86.1 | 87.2 | 87.2 | 89.4 | 89.4 | 95.5 | 95.5 | 95.5 | 95.5 | 95.5 |
| 200 checks, load: RSS | 65.4 | 105.4 | 114.0 | 104.8 | 110.3 | 114.6 | 111.6 | 112.9 | 112.8 | 116.9 | 143.8 |
| 200 checks, load: `VmHWM` | 65.4 | 140.0 | 142.5 | 147.8 | 149.1 | 149.1 | 155.0 | 155.0 | 155.0 | 155.0 | 155.0 |

- CPU in the 300 s: idle 290 ms (0.058 s per minute; bench `load_cpu_s` 0.07 s), 20 checks with load 2,730 ms (0.55 s per minute), 200 checks with load 9,740 ms (1.95 s per minute).
- 20 checks: RSS rose by 19.7 MiB in the first 30 s and then stayed between 79.5 and 84.6 MiB. No growth beyond the warm-up and no leak is shown. `VmHWM` 95.5 MiB is above the `peak_rss_mib` budget of 85 MiB, and the CPU is above the `load_cpu_s` budget of 0.5 s per 60 s. The bench does not see this, because it sends status no page traffic: finding 3.
- 200 checks: RSS stayed between 104.8 and 116.9 MiB from 30 to 270 s. The last sample is 143.8 MiB, at the same time as a page reload of the visitors (every 60 s). Five minutes do not show whether that is a lasting rise. No leak is shown.

### 5. Tests: CPU time per test file; the slowest files: `checked`

- Bench: `test_cpu_s` B 4.04 s (3.97, 4.09, 4.48, 4.04, 3.98), A 4.44 s, budget 3.4 s (gating, no floor): **FAIL budget** in the newest nightly and in every older nightly read (Scope). Finding 1.
- Whole suite: `/usr/bin/time -f 'user=%U sys=%S wall=%e exit=%x' timeout 600 bun test`, 3 runs, exit 0 (`663 pass, 0 fail`, 44 files, line coverage 98.13 %). CPU 4.13 s (3.45 + 0.68), 4.05 s and 4.06 s. Wall 3.34, 3.31 and 3.32 s. This matches bench B (4.04 s) and is 19-21 % above the budget.
- Without coverage (`bun --config=<bunfig with coverage = false> test`, 3 runs, exit 0): 4.31, 4.18 and 4.17 s. Coverage costs nothing measurable.
- Without `src/main.startup.test.ts` (`bun test <the other 43 files>`, 3 runs, exit 0, `654 pass, 0 fail`): 3.07, 2.99 and 2.94 s CPU, below the budget.
- Per file: `/usr/bin/time -f '%U %S %e %x' timeout 120 bun test ./<file>` for each of the 44 files, 3 runs. 13 files exit 0. The other 31 exit 1 only because of the 80 % line coverage gate of `bunfig.toml` on a one-file run: every run has `0 fail`, and with coverage off all 44 files exit 0. Medians of user + sys CPU, the 10 slowest:

| File | CPU (median of 3) | Wall (median) | Tests |
| --- | --- | --- | --- |
| `src/main.startup.test.ts` | 1.08 s | 0.65 s | 9, each spawns `bun src/main.ts` |
| `src/server.privacy.test.ts` | 0.98 s | 0.89 s | 42 |
| `src/server.hidden-checks.test.ts` | 0.55 s | 0.41 s | |
| `src/server.syndication.test.ts` | 0.41 s | 0.34 s | |
| `src/subscribe-routes.test.ts` | 0.41 s | 0.31 s | |
| `src/server.cache.test.ts` | 0.37 s | 0.35 s | |
| `src/server.test.ts` | 0.35 s | 0.30 s | |
| `src/subscribe-timing.test.ts` | 0.32 s | 0.26 s | |
| `src/server.runtime-settings.test.ts` | 0.32 s | 0.24 s | |
| `src/server.page-weight.test.ts` | 0.31 s | 0.22 s | |

  The other 34 files take 0.00 to 0.26 s each. The per-file medians add up to 8.40 s, because each run pays the Bun start and the coverage report again.

### 6. pulse-website only: JS and CSS size against the budget; Lighthouse of Home and Hosted: `not applicable`

This audit covers pulse-status. The Home and Hosted pages and the JS and CSS budget belong to pulse-website.

## Issue candidates

### performance-status-2026-11-27-1 (P2): status `test_cpu_s` fails its gating budget in every nightly; `src/main.startup.test.ts` alone costs 1.08 s of CPU

- Location: `src/main.startup.test.ts:18` (`run` spawns `process.execPath src/main.ts` for each of the 9 tests). The budget is in pulse-api `bench/budgets.json` (`status.test_cpu_s` 3.4 s, gating, no floor), set from `v0.1.0` (A 2.611 s, pulse-api `bench/README.md:171`).
- Command: `gh run download 45986105595 --repo lorenzh/pulse-api --name bench-out` and the same for the older runs. Then, in the status copy: `/usr/bin/time -f 'user=%U sys=%S wall=%e exit=%x' timeout 600 bun test` (3 runs), the same without `src/main.startup.test.ts`, and `/usr/bin/time ... bun test ./src/main.startup.test.ts` (3 runs). Exit 0 for all.
- Output excerpt:

  ```
  | `test_cpu_s` | 4.44 s | 4.04 s | -9.1% | 3.40 s | gating | FAIL budget |
  shas.a.status = shas.b.status = f220fbc27a2d733e583aba63e5949062f29d9861
  older nightlies, status B: 4.53, 4.15, 4.09, 4.12, 5.39, 5.49 s, all "FAIL budget"
  Ran 663 tests across 44 files. run1 user=3.45 sys=0.68 wall=3.34 exit=0
  without-startup: Ran 654 tests across 43 files. run1 user=2.53 sys=0.54 wall=2.73 exit=0
  1.08 0.65 src/main.startup.test.ts exits=[0, 0, 0] cpu=[1.07, 1.08, 1.1]
  ```

- Value: 4.04 s of CPU (bench B median); locally 4.06 s (median of 4.13, 4.05 and 4.06 s). Repetitions: 5 bench rounds, plus 3 local runs.
- Baseline: the same suite without `src/main.startup.test.ts` takes 2.94-3.07 s. Bench A of the same commit gives 4.44 s. The budget was set at A 2.611 s.
- Budget: `test_cpu_s` 3.4 s (gating).
- Why `P2`: the nightly bench is red on unchanged status code every night (7 artifacts read, 2026-11-16 to 2026-11-27). A real status regression would not change its result, so this gate gives no signal (pulse-api `bench/README.md:128-133`, "Reading a failure"). No user is affected.
- Direction: the owner decides between the two sides. One is to make the startup exit tests cheaper: fewer processes, or check the exit paths of `src/main.ts` in one child process. The suite without them is below budget. The other is to re-set the status budget from the current suite by the rule in pulse-api `bench/README.md` (A median plus 30 %).

### performance-status-2026-11-27-2 (P3): `/feed.atom` and the badges rebuild their answer on every request, also for a `304`; the cost grows with the number of checks (16 ms CPU per badge revalidation at 1000 checks)

- Location: `src/syndication.ts:306-326` (`serveBadge` reads `/api/checks` and `/api/uptime` and `JSON.parse`s both whole bodies through `parseChecks` and `uptimeOf`, `src/syndication.ts:65-73`, `192-204`), `src/syndication.ts:256-290` (`serveFeed` parses five answers and builds the whole Atom document) and `src/syndication.ts:219-233` (`sendTagged` computes the tag only after the build). The proxy stores finished `/api/*` answers with their tag (`docs/operation.md:124`), but syndication stores only their inputs.
- Command: `timeout 400 bash -c "for i in 1 2 3; do ... bun badge.ts <status copy> <fake api> <label> true 18441 300 /badge/check-1.svg /api/checks /feed.atom; bun badge.ts ... false 18442 300 /badge/component/comp-1.svg /api/components; done"` (exit 0). Also `bun bench/conditional.ts` and a copy with `CHECKS = 1000` (3 runs each, exit 0).
- Output excerpt:

  ```
  ('shown-20', '/badge/check-1.svg')   cpu per request 0.57, 0.53, 0.60 ms, 300 of 300 were 304
  ('shown-200', '/badge/check-1.svg')  3.57, 3.53, 3.53 ms
  ('shown-1000', '/badge/check-1.svg') 16.23, 13.2, 17.13 ms
  ('shown-1000', '/feed.atom')         24.83, 24.17, 24.23 ms
  ('shown-1000', '/api/checks')        0.1, 0.13, 0.07 ms
  conditional run1 /badge/check-0.svg {"requests":300,"cpuMs":517,"share304":100}   (100 checks)
  conditional-10x run1 /badge/check-0.svg {"requests":300,"cpuMs":4916,"share304":100}   (1000 checks)
  ```

- Value: 16.23 ms of server CPU per conditional check badge request at 1000 checks (median of 3 runs of 300 requests; 13.20-17.13 ms). The feed takes 24.23 ms.
- Baseline: a stored `/api/checks` `304` takes 0.07-0.13 ms at every size. The check badge takes 0.57 ms at 20 checks and 3.53 ms at 200 checks.
- Budget: no per-request budget. Reference: `load_cpu_s` 0.5 s per 60 s. At 1000 checks about 31 badge revalidations per minute use it up (0.5 s / 16.2 ms), at 200 checks about 140.
- Why `P3`: the answers stay correct and `Cache-Control: public, max-age=60` lets shared caches absorb repeats. The cost needs many checks and much badge or feed traffic, for example a badge embedded in a busy page.
- Direction: keep the finished feed and badge answers with their tag, dropped with the raw reads like the `/api/*` answers. Or keep the parsed lists per cached answer, so a request does not parse the full bodies again.

### performance-status-2026-11-27-3 (P3): the nightly bench sends status no page or proxy traffic, so its gating `load_cpu_s` and `peak_rss_mib` measure an idle poller; with 10 visitors on the bench's 20 checks both are above budget

- Location: pulse-api `bench/stack.ts:167` (`/readyz` is the only request the harness sends to status) and `bench/load.ts:4-11` (all load rates go to the api: `POST_RATE`, `GET_CHECKS_RATE`, `GET_UPTIME_RATE`, `GET_LATENCY_RATE`, `GET_CHECK_LATENCY_RATE`). `bench/compose.bench.yaml:56-59` gives status only `PULSE_API_URL` and the token file.
- Command: `grep -n "readyz\|apiBase\|baseUrl\|http://127" bench/run.ts bench/side-round.ts bench/stack.ts bench/load.ts` in pulse-api (exit 0). Then the 5-minute run of item 4 (`bun mem.ts ... 5 ... 10` against `bun mem.ts ... 5 ... 0`) and `bun grow.ts <copy> http://127.0.0.1:18320 def-20 3 30 false 18401` (exit 0).
- Output excerpt:

  ```
  bench/stack.ts:167:    const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
  mem-20-idle  cpu 0->300 290 ms   (0.058 s per min), hwm 64.9 MiB
  mem-20-load  cpu 0->300 2730 ms  (0.546 s per min), hwm [64.9, 86.1, 87.2, 87.2, 89.4, 89.4, 95.5, ...]
  def-20 run1 "load_s":34.5,"load_requests":610,"load_errors":0,"load_cpu_ms":430,"hwm_mib":87.9
  def-20 run2 "load_cpu_ms":410,"hwm_mib":87.8   run3 "load_cpu_ms":420,"hwm_mib":88.5
  ```

- Value: 0.55 s of CPU per 60 s over 5 minutes and `VmHWM` 95.5 MiB. In the 34.5 s windows the CPU is 0.71-0.75 s per 60 s and `VmHWM` 87.8-88.5 MiB. Repetitions: one 5-minute run, plus 3 short runs.
- Baseline: the same server and data without page traffic gives 0.058 s per minute and 64.9 MiB `VmHWM` locally. Bench B gives `load_cpu_s` 0.07 s and `peak_rss_mib` 70.11 MiB.
- Budget: `load_cpu_s` 0.5 s and `peak_rss_mib` 85 MiB (gating).
- Why `P3`: nothing breaks. These are local reference measurements, not a nightly failure. But the gate does not exercise what status is for (page renders, proxy answers, feed and badges), so a regression there passes the nightly.
- Direction: let the bench send status a fixed page and proxy load during the measured window, for example a few simulated visitors with the browser poller's paths. Then set the status `load_cpu_s` and `peak_rss_mib` budgets again from that run.

### performance-status-2026-11-27-4 (P3): at about 1000 HTTP checks the 90-day `/latency` answer passes the 5 MiB body cap; `/api/latency` and `/api/components/latency` answer `502` and the latency charts disappear

- Location: `src/server.ts:419-423` (`fetchRaw` calls `fetchJson` of pulse-contract without `maxBytes`, so `DEFAULT_MAX_BODY_BYTES` = 5 MiB of `dist/client.js:5` applies) and `src/server.ts:435-438` (`too-large` gives `502 invalid API response`). `src/poller.ts:272-282` treats a failed latency read as "no charts" (the last good value, none after a start), with no message on the page.
- Command: `bun grow.ts <copy> http://127.0.0.1:18322 def-1000 3 30 false 18403` and `... shown-1000 2 30 true 18413` (exit 0). Also `curl -s -w ' -> %{http_code}' http://127.0.0.1:18405/api/latency` against a server on the 1000-check fake api (exit 0).
- Output excerpt:

  ```
  {"port":18322,"checks":1000,"bytes":{..."/uptime":4553891,"/latency":5252891}}
  {"error":"invalid API response"} -> 502          (/api/latency)
  {"error":"invalid API response"} -> 502          (/api/components/latency)
  def-1000 run1..3: "load_requests":610,"load_errors":120
  shown-1000 run1..2: "load_requests":610,"load_errors":60
  ```

- Value: 5,252,891 bytes of `/latency` at 1000 checks (about 5,250 bytes per check for 90 days), against a cap of 5,242,880 bytes. The cap is reached at about 998 HTTP checks in this data shape. `/uptime` (4,553,891 bytes at 1000 checks) reaches it at about 1,150 checks; then the uptime bars go away and the check badges show `no data`. Repetitions: 3 runs (default layout) and 2 runs (checks shown); every load request to the affected paths failed.
- Baseline: 200 checks: `/latency` 1,050,491 bytes, 0 failed requests.
- Budget: none for this size. The cap is documented (`README.md:73`: "a 5 MiB body cap ... The proxy answers `502` `invalid API response` for a body above the cap"). The number of checks at which it applies is not.
- Why `P3`: it needs about 1000 HTTP checks on one status page. Below that nothing changes. The rest of the page still works.
- Direction: document the limit in checks, or let the proxy read the two history endpoints with a larger cap. A smaller answer would also work, for example fewer days or only the checks the page shows.

## Notes

- **Finding performance-status-2026-11-27-5 (P3, not a candidate): the page, its rebuild and the peak memory grow linearly with the checks and components.** Location: `src/server.ts:897-939` (`renderSections` and `renderIndex` build the whole page on each rebuild). Measured with `bun grow.ts` (item 3, exit 0, 3 and 2 runs). `GET /` is 53,281 B, 480,016 B and 1,526,457 B (default layout), and 267,012 B, 2,616,442 B and 8,879,289 B (checks shown), at 20, 200 and 1000 checks. A rebuild after each 2 s cache period takes a median of 25, 90 and 130 ms CPU (default) and 30, 155 and 365 ms (shown). `VmHWM` under 10 visitors is 87.8-88.5, 140.7-143.6 and 175.0-180.8 MiB (default), and 96.5-98.4, 177.2-178.1 and 326.1-326.6 MiB (shown). Baseline: the documented page sizes at 50 checks and 20 components (`docs/operation.md:202`: 243,043 B default and 730,602 B shown; the test guard is 1,000,000 B) and the bench B `peak_rss_mib` of 70.11 MiB. Reference budget `peak_rss_mib` 85 MiB. The driver is the 90-row "Daily values" table of each entry (21,840 `<tr>` at 200 checks shown), which the keyboard and screen reader design (`docs/operation.md`, "Keyboard and screen reader use") asks for. Status does not compress. A compressing proxy in front is the documented setup (`docs/operation.md:156-157`), and the page compresses well: 2,616,442 B to 42,551 B and 480,016 B to 9,082 B (`gzip -6`). So transfer size is not the issue; server CPU and memory per rebuild are. This is a note because the cost follows from the documented design and needs a large page.
- Startup: about 19 % of the startup CPU is the import of zod (through pulse-contract), and 4.8 % is the four `Intl.DateTimeFormat` objects that `src/ssr.ts:19-40` builds at import (about 4.4 ms per start). Neither is a finding: startup is at 27-34 % of its budget in the bench.
- The latest nightly fails for three services. Status `test_cpu_s` is one of the gating failures, beside probe and notify `test_cpu_s`. A fix in status alone does not make the nightly green.
- `bench/proxy-cache.ts` and `bench/conditional.ts` are run by hand only, not by CI or the nightly (`docs/development.md`). Their numbers above are local.
- `src/server.privacy.test.ts` is the second slowest test file (0.98 s CPU for 42 tests, 0.89 s wall). It was not profiled further.
- RSS at 200 checks rose to 143.8 MiB in the last 30 s sample of the 5-minute run (item 4). One sample does not show a leak. A longer run would tell whether RSS keeps rising.
- No `EXPLAIN QUERY PLAN` applies to status (item 1). Each poll period makes the api run the plans that `audits/performance/api.md` reports, at most once per path per `PULSE_STATUS_CACHE_MS`.
