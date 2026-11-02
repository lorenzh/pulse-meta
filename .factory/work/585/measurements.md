# #585 plan: measurements (2026-11-02)

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
- Experiment: skipping the POLL_MS, `PULSE_STATUS_LOGO` and `PULSE_LOG_LEVEL` spawn tests (keeping the invalid URL and the occupied PORT) gives 1.97 1.97 1.97 1.96 1.96, median 1.97 s, with 0 fail and 98.47 % line coverage.

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
