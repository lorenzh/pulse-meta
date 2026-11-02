# #585 plan: measurements (2026-11-02)
<!-- Second plan run: see "status after #592" below. The earlier status numbers are for 0a4768d. Third plan run: see "status import fix". -->


Evidence that the `plan` state collected before its `needs-input` hold. A later `plan` run can reuse it, but should re-check the SHAs, because the repositories may have moved on.

## Method

- Machine: GitHub-hosted Ubuntu runner, 4 vCPU, AMD EPYC 7763, Bun 1.4.0. These are the same CPU model and Bun version as the hosted `Bench` job (`bun-version: 1.4.0`, image `ubuntu24/20261025.353`).
- Each value is the CPU time (user + system, children included) of `bun run test`, run in a fresh clone after `bun install --frozen-lockfile`. It is read through `Bun.spawn().resourceUsage()`, the same method as `bench/measure.ts::runCommand`. Each line lists every sample and its median: the middle sample of 3 or 5, unrounded except to 0.01 s.
- Local medians match the hosted medians within 0.05 s (probe v0.1.0 3.67 against 3.69 s; probe main 4.40 against 4.42 s; status 2.41/2.46 against 2.42/2.46 s; notify 1.80/2.27 against 1.82/2.22 s). So local before/after numbers can be read on the hosted scale.

## Hosted nightly `Bench` on api `main` (A = newest `v*` tag, B = `main`)

| Run | Date | probe A / B | status A / B | notify A / B | api A / B |
| --- | --- | --- | --- | --- | --- |
| 41292492988 | 2026-11-01 | 3.55 / 4.23 FAIL regression | 2.45 / 2.47 FAIL budget | 2.03 / 2.18 ok | 3.66 / 3.79 ok |
| 41421625359 | 2026-11-02 | 3.69 / 4.42 FAIL regression | 2.42 / 2.46 FAIL budget | 1.82 / 2.22 FAIL regression | 3.76 / 3.93 ok |

Budgets: probe 2.3, status 2.4, notify 2.3, api 4.1 s. A = `v0.1.0` for api, probe, status and notify.

Runner speed varies between hosted runs. Run 41184707915 (2026-10-31) measured kit at SHA `6a06ec2` as 0.32 s and config at SHA `01a57a7` as 14.96 s. Runs on 10-30, 11-01 and 11-02 measured the same SHAs as 0.45-0.51 s and 21-23 s. Budgets must cover the slower and more common runner.

## probe: cause

`bun run test`, 3 rounds per commit:

| Commit | Change | Samples | Median |
| --- | --- | --- | --- |
| `9674e518` | before #493 | 2.11 2.04 2.04 | 2.04 |
| `85720d38` | #493 probe token file (PR #44) | 3.65 3.67 3.66 | 3.66 |
| `50ec9cab` = `v0.1.0` | release CI only | 3.68 3.67 3.67 | 3.67 |
| `2a19aa3e` | #591, #587, #604 | 3.76 3.72 3.73 | 3.73 |
| `142d9b04` | #603 private ranges (PR #49) | 4.25 4.27 4.25 | 4.25 |
| `82601487` = `main` | #599 header-secret binding (PR #50) | 4.40 4.39 4.40 | 4.40 |

`bun test src/main.test.ts` on its own: 1.43 s, then 3.09 s, then 3.69 s at the same three points (before #493, after #493, `main`). One child `bun src/main.ts` that exits 2 at settings costs 0.16 s CPU (5 of 5 samples), while `bun -e 1` costs 0.01 s. The cost is module loading: on its own, `src/check.ts` takes 0.10 s and `@lorenzh/pulse-contract` 0.06 s. `src/main.test.ts` on `main` spawns 22 children. Fifteen of them only check startup error messages that `src/token.test.ts` and `src/settings.test.ts` already assert in-process: 6 of the 7 bad-setting cases, the both/none/empty/multi-line/directory token cases, the 3 token-content cases and the non-ASCII `PULSE_PROBE_TOKEN` case. Real timers are not the cause.

Experiment on `main` (`82601487`): marking those 15 tests `test.skip` gives samples 2.01 2.00 2.00 1.99 1.99, median 2.00 s, with 382 pass, 15 skip, 0 fail and 99.23 % line coverage. The kept spawns are one settings error, the occupied port, SIGTERM, healthz, the token-file success case, the missing token file (ENOENT) and the private-ranges end-to-end test.

## status: re-measured

- `v0.1.0` (`2e3067d`): 2.49 2.37 2.39 2.43 2.41, median 2.41 s.
- `main` (`0a4768d`): 2.52 2.44 2.45 2.46 2.55, median 2.46 s.
- With the hosted medians 2.47, 2.46 and 2.44 s (runs 41292492988, 41421625359, 41235464206), status `main` is above 2.4 in every measurement. That is repeatable, not noise.
- `src/main.startup.test.ts` costs 0.88 s on its own and spawns 5 children of `bun src/main.ts`, at 0.16 s each. `src/settings.test.ts` and `src/start.test.ts` already cover the POLL_MS, logo and log-level messages in-process.
- Experiment: skipping the POLL_MS, `PULSE_STATUS_LOGO` and `PULSE_LOG_LEVEL` spawn tests (keeping the invalid URL and the occupied PORT) gives 1.97 1.97 1.97 1.96 1.96, median 1.97 s, with 0 fail and 98.47 % line coverage. Correction: `PULSE_LOG_LEVEL` is not covered in-process. Its spawn test is the only test of the `readLogLevel` `catch` in `src/main.ts:8-15`.

### status after #592 (re-measured 2026-11-02, second plan run)

Status `main` moved from `0a4768d` to `d352e06` (pulse-status PR #63, #592 latency charts, merged 2026-11-02 15:20 UTC, after the last nightly 41421625359). No hosted run has measured it yet. Same machine class and method as above (AMD EPYC 7763, 4 vCPU, Bun 1.4.0, fresh copy, `bun install --frozen-lockfile`, 5 samples, median = 3rd smallest):

| `src/main.startup.test.ts` on `d352e06` | Samples | Median |
| --- | --- | --- |
| unchanged, 5 spawn tests (476 pass, 0 fail) | 2.84 2.83 2.87 2.90 2.84 | 2.84 |
| POLL_MS and `PULSE_STATUS_LOGO` removed (3 spawns: URL, PORT, log level) | 2.70 2.70 2.65 2.60 2.64 | 2.65 |
| also `PULSE_LOG_LEVEL` removed (2 spawns: URL, PORT) | 5 samples, median only recorded | 2.53 |
| all 5 spawn tests removed (0 spawns; lower bound of spawn cuts) | 5 samples, median only recorded | 2.24 |

- #592 added about 0.38 s (2.46 → 2.84 s). The diff `0a4768d...d352e06` adds in-process tests (`server.privacy.test.ts` +328 lines, `server.page-weight.test.ts` new, `server.cache.test.ts` +124, `server.syndication.test.ts` +110, `component-latency.test.ts` new). No new spawn: `src/main.startup.test.ts` is still the only test file that spawns (`grep -ln "spawn\|execPath" src/*.test.ts`).
- #592 also gave the children a shared transpiler cache (`src/main.startup.test.ts:16-28`). Since then, the first child pays for the transpile (about 0.3 s) and every further child costs about 0.1 s. So each removed spawn now saves less than the 0.16 s measured on `0a4768d`.
- Per-file CPU (`bun test ./src/<file>`, each with its own process start): `main.startup.test.ts` 0.70, `server.hidden-checks.test.ts` 0.69, `server.syndication.test.ts` 0.48, `server.privacy.test.ts` 0.46, `server.test.ts` 0.46, `server.page-weight.test.ts` 0.46, `server.cache.test.ts` 0.45 s.
- Result: with any cut that keeps a process-level test, status stays above its 2.4 s budget (2.53 s at best). Only removing every spawn test gets under it (2.24 s, a 0.16 s margin). Against hosted A `v0.1.0` 2.42 s, the regression limit is max(0.242, 0.2) = 0.242 s. So 2.84 s fails as a regression, while 2.65 s (+0.23) and 2.53 s (+0.11) pass that rule and fail only the budget.

### status import fix (third plan run, 2026-11-02)

Same CPU model (AMD EPYC 7763, 4 vCPU) and Bun 1.4.0, on a fresh copy of `d352e06` after `bun install --frozen-lockfile`. This runner was about 10 % slower than the one in the second run: it measured `main` at 3.13 s, not 2.84 s.

Variants:
- **fix**: `BROWSER_TIMEOUT_MARGIN_MS` and `MAX_UPSTREAM_TIMEOUT_MS` are moved from `src/server.ts:74-77` to a new `src/upstream-timeout.ts` that imports only `MAX_TIMER_DELAY_MS` from `@lorenzh/pulse-kit`. `src/settings.ts:11` imports from it. The POLL_MS and `PULSE_STATUS_LOGO` spawn tests are removed, and the shared transpiler cache stays.
- **fix, no cache**: the same, with the transpiler cache removed from `src/main.startup.test.ts`.

One bad-setting child (`PORT=0`, `PULSE_API_URL=not-a-url-secret`, exit 2), with an empty `BUN_RUNTIME_TRANSPILER_CACHE_PATH`. The file count is taken after each run, and CPU is user + system from `resourceUsage()`:

| Variant | Files in the cache | CPU cold / warm / warm (s) |
| --- | --- | --- |
| `main` `d352e06` | 95 | 0.181 / 0.119 / 0.118 |
| fix | 3 | 0.048 / 0.045 / 0.045 |

Full `bun run test` CPU. There were two sessions of 5 samples per variant, run in the order main, fix, no cache, main, fix, no cache. All runs exited 0.

| Variant | Session 1 | Median | Session 2 | Median |
| --- | --- | --- | --- | --- |
| `main` | 3.15 3.14 3.07 3.13 3.14 | 3.14 | 3.12 3.09 3.04 3.13 3.16 | 3.12 |
| fix | 2.72 2.72 2.74 2.72 2.75 | 2.72 | 2.64 2.64 2.64 2.65 2.66 | 2.64 |
| fix, no cache | 2.64 2.62 2.60 2.77 2.70 | 2.64 | 2.67 2.67 2.62 2.72 2.68 | 2.67 |

- On the plan's scale (× 2.84 / `main` median of the same session), fix is 2.72 × 2.84 / 3.14 = 2.46 s and 2.64 × 2.84 / 3.12 = 2.40 s. Both are under the owner's 2.55 s limit.
- The cache saves nothing measurable after the fix: no cache 2.64 / 2.67 s against 2.72 / 2.64 s.
- fix: `bun test` gave 474 pass, 0 fail, and 97.52 % function and 98.51 % line coverage (All files). `tsc --noEmit` passed for both variants. Biome is clean apart from a blank line my scratch edit left in the no-cache variant.
- Hosted estimate: status B ≈ 2.84 × 0.86 ≈ 2.44 s against A `v0.1.0` 2.42 s, so B − A ≈ 0.02 s. The api task's status limit is 0.192 s, and the new budget is round-up-0.1(2.42 × 1.3) = 3.2.

## notify: regression against v0.1.0 (not named in #585)

| Commit | Change | Samples | Median |
| --- | --- | --- | --- |
| `c090a07` = `v0.1.0` | | 1.77 1.81 1.80 1.79 1.86 | 1.80 |
| `845183b` | #594 kit timer | 1.85 2.12 1.95 1.88 1.86 | 1.88 |
| `44e4f5b` | #588 liveness, manual incident upgrade | 2.16 2.15 2.07 2.15 2.06 | 2.15 |
| `793d65d` | #607 images and CI | 2.23 2.24 2.28 2.18 2.14 | 2.23 |
| `3a0b4c8` = `main` | #605 header-secret binding | 2.09 2.16 2.34 2.27 2.32 | 2.27 |

The growth (+0.47 s, +26 %) comes from in-process tests across four features. Notify has no spawn hotspot: one entry-point spawn in `test/index.test.ts`, plus 12 light `bun -e` healthcheck children in `test/security-review.test.ts`. The regression rule `B - A > max(10 % of A, 0.2 s)` fails at +0.47 s, and B (2.18-2.27 s) is close to the 2.3 s budget.

## api: comment from #617

Per the owner's comment, #561/#617 tests take api test CPU from 3.86 to 4.66 s (A/B on `9307271`). Against `v0.1.0` (hosted A 3.66-3.76 s), that is a relative regression as well as above the 4.1 s budget. #617 is not merged; the nightly B on `a768211` is 3.93 s.
