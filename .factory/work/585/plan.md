# Spec #585: probe and status test CPU over budget, accepted test growth in notify and api

## Goal

Make the hosted nightly `Bench` on api `main` pass again, with #617 merged, without weakening a gate:

- probe: lower `test_cpu_s` under its current 2.3 s budget by removing child-process tests that only repeat startup checks already covered in-process.
- status: cut the avoidable cost of its process-level tests. A bad setting must exit without loading the server modules, as `src/main.ts:23` already says, and two duplicate spawn tests go. Then re-set the stale status budget from its A median by the normal rule.
- notify and api: record the accepted test-suite growth in `bench/budgets.json` with a bounded, temporary `floor`, so the regression rule stays armed.

This follows the two owner decisions in the issue comments:
- First decision: no release tags, no large `thresholdPct`, probe budget unchanged, floors for notify and api.
- Second decision (after #592): status gets one production refactor through Factory, which is the only production code change. The status budget is re-set by the `bench/README.md` rule because `v0.1.0` itself measures above 2.4 s. Status gets no floor and no `thresholdPct`, unless the bounded fallback in the api section applies.

## Evidence this spec builds on

Measurements are in `.factory/work/585/measurements.md` (GitHub-hosted runner, AMD EPYC 7763, Bun 1.4.0, `bun run test` CPU read like `runCommand` in `bench/measure.ts:52-71`). Local medians match hosted medians within 0.05 s.

- **Probe cause.** pulse-probe PR #44 (#493) raised probe test CPU from 2.04 to 3.66 s. #603 (PR #49) and #599 (PR #50) raised it to 4.40 s on `main` `8260148`. `src/main.test.ts` spawns 22 `bun src/main.ts` children at about 0.16 s CPU each, mostly for module loading. Real timers are not the cause. With 15 of those spawns skipped, the suite measured 2.00 s (5 samples 2.01 2.00 2.00 1.99 1.99), with 0 failures and 99.23 % line coverage.
- **Status is not noise, and its budget is stale.** `v0.1.0` measured 2.41 s locally and 2.42-2.45 s hosted, already above the 2.4 s budget. `main` `0a4768d` measured 2.46 s, and every hosted B median (2.44, 2.46, 2.47 s) is above 2.4.
- **Status after #592.** `main` is now `d352e06` (#592, pulse-status PR #63). It measured 2.84 s in the second plan run. About 0.67 s of in-process growth comes from 64 new tests that #554 announced (second owner decision, researcher A). That growth is accepted. The avoidable part is spawn cost. `src/settings.ts:11` imports `MAX_UPSTREAM_TIMEOUT_MS` from `./server.ts`, so a child that exits on a bad setting still loads and transpiles the whole server graph. That contradicts the comment at `src/main.ts:23`.
- **Status fix measured (third plan run, `measurements.md`, "status import fix").** The fix moves the two constants (`src/server.ts:74-77`) to a module that imports only `@lorenzh/pulse-kit`, and removes the POLL_MS and `PULSE_STATUS_LOGO` spawn tests. One bad-setting child then transpiles 3 files instead of 95, and its CPU drops from 0.12 to 0.045 s (warm cache). The full suite went from 3.14 / 3.12 s on `main` (two sessions) to 2.72 / 2.64 s, with 474 pass and 0 fail. That runner measured `main` at 3.12-3.14 s instead of 2.84 s, so it ran about 10 % slower. On the plan's scale (× 2.84 / main median), that is 2.46 / 2.40 s. Without the shared transpiler cache, the suite measured 2.64 / 2.67 s, the same within noise.
- **Nightly 41421625359** (api `main` `a768211`, 2026-11-02; A = `v0.1.0` for every repository): from `table.json` of the run artifact, A / B medians of `test_cpu_s`:

  | Repository | A | B | Budget | Verdict |
  | --- | --- | --- | --- | --- |
  | api | 3.756 | 3.925 | 4.1 | ok |
  | probe | 3.691 | 4.416 | 2.3 | FAIL regression |
  | status | 2.416 | 2.463 | 2.4 | FAIL budget |
  | notify | 1.816 | 2.217 | 2.3 | FAIL regression |
  | kit | 0.506 | 0.672 | 0.7 | ok |

  No other gating row failed.
- **#617** (pulse-api part of #561) adds about 0.8 s api test CPU: the owner measured A/B 3.86 → 4.66 s on `9307271`. On 2026-11-02, #617 is open with `factory/complete`, and its branch `factory/617-api-api-hashed-scoped-admin-and-probe-tokens-wit` is not merged.
- **The rule.** `judge` in `bench/compare.ts:181-188` (api) returns `FAIL regression` when `b - a > max(a * pct / 100, floor)`, before it looks at the budget. So a higher budget alone cannot fix a regression row. `floor` is an existing optional budget key (`bench/compare.ts:40`, parsed at `:124-137`), already used for `test_cpu_s` of contract (2) and config (3) in `bench/budgets.json`.

## Scope

- probe: remove 14 duplicate spawn tests from `src/main.test.ts` and add one in-process EISDIR case to `src/token.test.ts`.
- status: move `BROWSER_TIMEOUT_MARGIN_MS` and `MAX_UPSTREAM_TIMEOUT_MS` from `src/server.ts` to a new leaf module `src/upstream-timeout.ts`. Remove 2 duplicate spawn tests from `src/main.startup.test.ts`, and remove its shared transpiler cache if the PR measurement shows the cache saves nothing.
- api: `bench/budgets.json` (`notify.test_cpu_s`, `api.test_cpu_s`, `status.test_cpu_s`) and `bench/README.md`, with hosted bench runs as evidence.

## Non-goals

- No release tags in any repository. A tag is a release decision, outside this issue.
- No change of probe, kit, contract or config budgets. No change of `thresholdPct` anywhere.
- No production code change except the status constant move. It changes no behavior, message, exit code or exported value. No change of `bench/*.ts`, `bench.yml` or any CI file.
- No change of the notify test suite. Its growth comes from in-process tests of four accepted features (#588, #594, #605, #607) and has no spawn hotspot.
- No change of the status in-process tests that #592 added. Their growth is accepted.
- No lowering of the 80 % line coverage threshold (`bunfig.toml` `[test]` in probe and status), and no `test.skip`: duplicate tests are deleted, and the tests that stay run.

## Required behavior

1. Probe `bun run test` keeps every behavior assertion it had, either in-process or in a remaining spawn test. It spawns 8 children of `bun src/main.ts` instead of 22. Its hosted `test_cpu_s` B median is at most 2.3 s.
2. Status behaves exactly as before: the same settings limits (`PULSE_STATUS_UPSTREAM_TIMEOUT_MS` at most 2147481647), the same page `data-timeout-ms`, the same messages and exit codes. A start with a bad setting no longer loads `src/server.ts`. Status `bun run test` keeps every behavior assertion it had, and it spawns 3 children instead of 5.
3. `bench/budgets.json` in api:
   - `notify.test_cpu_s` becomes `{ "budget": 2.5, "unit": "s", "gating": true, "floor": 0.6 }`.
   - `api.test_cpu_s` gets `budget` and `floor`, computed by the rules under Counterexamples from a hosted run that includes #617.
   - `status.test_cpu_s` gets `budget` = round-up-0.1(A × 1.3) from the same run, with no floor, unless the bounded fallback in the api section applies.
   - `gating` stays `true` for all three.
4. `bench/README.md` in api records the notify and api floors as temporary. It gives the measurement they come from and the rule that removes them: the first api PR after the next `v*` tag of that repository (notify or api) removes that repository's `test_cpu_s` floor and re-sets its budget from the new A median plus 30 %, rounded up to 0.1 s. It records the status budget as a normal re-set, not a temporary one. If the status fallback applies, the README records the status floor as temporary by the same removal rule.
5. With all three changes merged and #617 merged, the full hosted `Bench` passes: exit code 0, no `FAIL` row, no harness error.

## Performance impact

Metrics of `bench/budgets.json` in api that can move. Only `test_cpu_s` moves measurably.
- The status refactor changes the module graph of a successful start only by one 6-line module, so status `startup_cpu_ms`, `startup_wall_ms`, idle and peak RSS and image size do not move measurably.
- No load path, proxy or request code changes, so p95 latency and requests per second do not move.

| Metric | Direction | Size | Measured how |
| --- | --- | --- | --- |
| probe `test_cpu_s` | down | 4.40 → about 2.16 s (15 cut spawns measured 2.00 s; this spec keeps one more, about +0.16 s) | 5 local runs of the command below on `main` and on the branch, then hosted |
| status `test_cpu_s` | down | 2.84 → about 2.40-2.46 s on the plan's scale (measured 3.12-3.14 → 2.64-2.72 s on a runner about 10 % slower) | the same, plus the transpiled file count of one bad-setting child |
| status `startup_cpu_ms` | none measurable | one extra 6-line module | not measured; the hosted run reports it |
| notify `test_cpu_s` | value unchanged; verdict changes from `FAIL regression` to `ok` through the new floor | — | hosted run |
| api `test_cpu_s` | value set by #617 (+0.8 s), not by this spec; verdict stays `ok` through the new budget and floor | — | hosted run |

Local CPU of one `bun run test`, the same quantity as `bench/measure.ts:69-70` (user + system, waited children included, `cpuTime` in microseconds). Run it 5 times in the repository and take the median (3rd smallest of 5):

```sh
bun -e 'const p = Bun.spawn(["bun", "run", "test"], { stdout: "ignore", stderr: "ignore" }); const code = await p.exited; const u = p.resourceUsage(); console.log(code, ((Number(u.cpuTime.user) + Number(u.cpuTime.system)) / 1e6).toFixed(2))'
```

A local number is a guide only. Acceptance comes from the hosted runs.

**Status scale.** Runner speed varies by about 10 % between sessions on the same CPU model: `main` `d352e06` measured 2.84 s in the second plan run and 3.12-3.14 s in the third. So a status branch median is judged on the plan's scale. Measure `main` and the branch in the same session, alternating runs (main, branch, main, branch, …), 5 samples each. Then the scaled branch median = branch median × 2.84 / main median, rounded to 0.01 s. 2.84 s is the `main` median of the second plan run (`measurements.md`).

## Security impact

Security impact: no
Only tests, budget data, docs and one status constant move change. No error text, dependency, Dockerfile or CI file changes.
- The status move keeps the constants' values and names. The literal checks in `src/settings.test.ts:63-67` (2147481647) and `src/server.test.ts:207-223` (`data-timeout-ms`) pin them.
- Each removed spawn test checks a startup message that an in-process test already asserts, including the absence of the token.
- Probe keeps one process-level token-content test, which checks stdout and stderr for the token (`startupLine`, `src/main.test.ts:196-197`). It also keeps one bad-setting test, which today checks only stderr (`src/main.test.ts:84`). The probe task adds a stdout assertion to that test, so both kept tests check that no secret reaches stdout or stderr.
- Status keeps its `PULSE_API_URL` redaction spawn test (`src/main.startup.test.ts:58-62`). `assertOneLine` checks there that stdout is empty (`:44`).

## Rollout order

1. probe and status, in parallel. Probe is test-only. Status moves two constants between its own modules, and no other repository imports them (`grep -rn MAX_UPSTREAM_TIMEOUT_MS` finds only `src/server.ts` and `src/settings.ts`; `bench/conditional.ts:16` imports only `createStatusServer`). Older pins of other repositories do not matter.
2. #617 (api, part of #561) merges. This is outside this spec. The api child must not start its measurement before that.
3. api: budgets and README. It needs the merged probe and status changes and the merged #617, because its hosted run measures `main` of every repository.

The bench resolves the refs: B = `main` of every repository, A = the newest `v*` tag (`bench/refs.ts:36-67`). Lower probe and status values on B can only improve their rows, because improvements never fail (`bench/compare.ts:180`). The status row still fails its old 2.4 s budget until the api step merges, so the nightly stays red until then. That is expected. After fan-out, a person links the api child as natively "blocked by" #617, so `factory-unblock.yml` starts it only once both are closed. The api task also checks this itself (see its section).

## Counterexamples

- **Rounding up to 0.1 s** is `Math.ceil(x * 10 - 1e-9) / 10`. 4.888 → 4.9, not 4.8 or 5.0. 4.9 exactly → 4.9, not 5.0. 1.101 → 1.2. Rounding to the nearest value (4.84 → 4.8) is wrong.
- **Median** is the median of the 5 per-round samples of one side in one hosted run, as computed by `median` in `bench/measure.ts:23` and written to `table.json`. For 5 samples, it is the 3rd smallest. It is never a mean of samples, and never a median of medians from two runs.
- **api budget** = round-up-0.1(A median × 1.3), with A = api `test_cpu_s` A median of run R1 (below). A = 3.76 gives 4.888 → 4.9. That rounded value is both the prescribed value and the cap. 4.9 is above the unrounded 4.888 only by the rounding, and it is allowed. Any value above round-up-0.1(A × 1.3) is wrong, for example 5.0 for A = 3.76. So is a value below it, for example 4.8 (rounded down). Using B instead of A (4.66 × 1.3 = 6.06 → 6.1) is wrong: the owner rejected 6.1.
- **api floor** = round-up-0.1(B median − A median + 0.2), from the same run R1. A 3.76 and B 4.66 give 1.1. A floor computed from two different runs (A from one run, B from another) is wrong.
- **Regression rule for notify** with floor 0.6: A 1.82, B 2.27 → limit max(0.182, 0.6) = 0.6, B − A = 0.45, so `ok`. A 1.82, B 2.45 → B − A = 0.63 > 0.6, so `FAIL regression` even though B ≤ 2.5. A floor so large that it can never fire (for example 5) breaks the "gate stays armed" rule.
- **Budget check for notify**: B 2.51 → `FAIL budget`, even when B − A ≤ 0.6.
- **Probe removal**: removing the `invalid UTF-8` token-file spawn test is wrong. It is the only test that reads the file through the real `readFileSync(path, "utf8")` (`src/main.ts:36`) and then checks that the decoded content is not printed. In-process tests pass strings.
- **Status removal**: removing the `PULSE_LOG_LEVEL` spawn test is wrong. `src/main.ts:8-15` reads the log level in its own `try`/`catch`, before `startFromEnv`. No in-process test reaches that branch, and `grep -rn PULSE_LOG_LEVEL src/*.test.ts` finds only `src/main.startup.test.ts:83-86` (on `d352e06`).
- **Status leaf module**: a new module that imports `./server.ts`, `./start.ts` or any module that imports them is wrong, because the bad-setting child would still load the server graph. So is a re-export of the constants from `src/server.ts` that `settings.ts` keeps importing. `settings.ts` must import them from `./upstream-timeout.ts`. Changing the value is wrong too: `MAX_UPSTREAM_TIMEOUT_MS` stays `MAX_TIMER_DELAY_MS - 2000` = 2147481647, so `PULSE_STATUS_UPSTREAM_TIMEOUT_MS=2147481648` still exits 2 and 2147481647 still starts.
- **Transpiled file count**: one bad-setting child, run with `PORT=0` and `PULSE_API_URL=not-a-url-secret` and an empty directory as `BUN_RUNTIME_TRANSPILER_CACHE_PATH`. The count is the number of files in that directory after the child exits. `main` `d352e06` gives 95 and the fixed branch 3 (both measured in the third plan run). A count above 10 means the server graph still loads.
- **Status scale**: a branch median of 2.64 s with a same-session `main` median of 3.12 s scales to 2.64 × 2.84 / 3.12 = 2.40 s, which passes the 2.55 s limit. Comparing the raw 2.64 s against 2.55 s is wrong. So is subtracting the difference (2.64 − 0.28) instead of scaling, or comparing against a `main` median from another session.
- **Status hold rule** (api task): with R1 status A 2.42 s, the limit is max(2.42 × 0.1, 0.2) − 0.05 = 0.192 s. B 2.60 gives B − A = 0.18, so the task goes on. B 2.62 gives 0.20 > 0.192, so the fallback applies. Testing `B > 2.4` is wrong now, because `v0.1.0` itself is above 2.4.
- **Status budget**: R1 A 2.42 gives round-up-0.1(3.146) = 3.2. Keeping 2.4 is wrong: A alone exceeds it. Taking B instead of A is wrong too.
- **Status fallback bounds**: floor = round-up-0.1(B − A + 0.2), with an upper bound of 0.5. A 2.42 and B 2.65 give 0.43 → 0.5, which is allowed. A 2.42 and B 2.75 give 0.53 → 0.6, which is above the bound, so the task holds. A budget above 3.2 also holds.
- **Shared transpiler cache**: the cache stays only if it saves CPU. Measure 5 samples with it and 5 without, in the same session and alternating. Remove it when the median without it is at most 0.05 s above the median with it. Third plan run: 2.72 / 2.64 s with it, 2.64 / 2.67 s without, so it is expected to go.
- **Measured SHA**: a log line `B: {"probe":"main",…}` (`bench/run.ts:237`) names a branch, not a commit. It is not evidence that B contained a given commit. Neither is the run's `head_sha`, which is the api workflow checkout, not the separately cloned api B worktree (`bench/run.ts:106-118`).
- **`test.skip` instead of deletion** is wrong. Skipped tests leave dead code, and the issue review rules out skipping costly tests.

## Contract fields

No new contract or config names. `floor` and `budget` are existing keys of the bench budget schema (`bench/compare.ts:39-40`, `:124`). No route, env variable or type is added.

One new file name, local to status: `src/upstream-timeout.ts`. It exports the two existing constant names, `BROWSER_TIMEOUT_MARGIN_MS` and `MAX_UPSTREAM_TIMEOUT_MS`, under the same names. Searches in the third plan run:
- `grep -rn 'upstream-timeout\|MAX_UPSTREAM_TIMEOUT_MS\|BROWSER_TIMEOUT_MARGIN_MS' .repos/contract/src .repos/config`: no match.
- `ls .repos/status/src/upstream-timeout.ts`: no such file.
- In status, `grep -rn 'MAX_UPSTREAM_TIMEOUT_MS\|BROWSER_TIMEOUT_MARGIN_MS'` finds only `src/server.ts:75,77,705,766` and `src/settings.ts:11,75`.

## Repository: probe

Files: `src/main.test.ts`, `src/token.test.ts`.

Behavior change: no
Tests only: duplicate process-level tests are removed, and one in-process case is added.

Tool facts (verified):
- `bun run test` is `bun test` (`package.json:15`). `bun run check` is `bun run lint && bun run typecheck && bun run test` (`package.json:19`). `lint` is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:16`). `typecheck` is `tsc --noEmit` from `typescript7` (`package.json:14`, pinned `npm:typescript@7.0.2` at `:27`). Bun 1.4.0 (`package.json:8` `packageManager`, `:9-11` `engines`). Biome 2.6.3 (`package.json:22`).
- `bunfig.toml:1-4` `[test]`: `coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`, `coveragePathIgnorePatterns` for test files.
- `biome.json:2` only `extends` `@lorenzh/pulse-config/biome.json`. `@lorenzh/pulse-config` is pinned to `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:23`). `biome.json` read at that pin with `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=04108fa…"` is identical to the config clone.
- CI `.github/workflows/ci.yml:17-18`: job `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. At that pin, `check.yml:16` runs on `ubuntu-24.04`, `:22-24` sets up Bun 1.4.0, `:25-26` runs `bun install --frozen-lockfile`, `:27-28` `bun run lint`, `:29-30` `bun run typecheck` and `:37-38` `bun run test`. The build steps (`:31-36`) run only with `inputs.build`, which probe does not set. The file read with `gh api "repos/lorenzh/pulse-config/contents/.github/workflows/check.yml?ref=04108fa…"` is identical to the config clone, whose `main` is that same SHA. CI also has a `docker` job (`ci.yml:19-75`) that tests files are not in the image; this task does not touch it.

Change in `src/main.test.ts` (`main` `8260148`):
- Bad-setting loop (lines 65-86): keep only the `PULSE_API_URL` entry. Delete the `PULSE_PROBE_TOKEN`, `PULSE_LOCATION`, `PULSE_CHECKS_RELOAD_MS`, `PULSE_LOG_LEVEL`, `PULSE_HEALTH_PORT` and `PULSE_PROBE_BLOCK_PRIVATE_RANGES` entries. They are covered in-process by `src/settings.test.ts:36-55`, `:68-78` and `:138-147`. The kept test still checks exit 2, one `pulse-probe: …PULSE_API_URL` line, and that `tok-secret` is not in stderr (`:80-84`). Add `assert.ok(!r.stdout().includes("tok-secret"))`, because today it does not check stdout. Then it covers both streams like `startupLine` (`:196-197`). Write it as a single `test` or as a one-entry loop.
- Delete the tests at lines 223, 231, 236, 244 and 260: both token variables, no token variable, empty file, multi-line file, and directory (EISDIR). They are covered by `src/token.test.ts:72-79`, `:81-96`, `:106-113`, `:115-123` and `src/settings.test.ts:92-112`. EISDIR gets the new in-process case below.
- Token-content loop (lines 267-283): keep only the `invalid UTF-8` entry. Delete `a NUL byte` and `UTF-16 with a BOM and no newline`. They are covered by `NOT_PRINTABLE` in `src/token.test.ts:149-173` (a NUL byte, two replacement characters U+FFFD as left by UTF-8 decoding of invalid bytes or a UTF-16 BOM, and a U+FEFF).
- Delete the test at line 285, `PULSE_PROBE_TOKEN` with a non-ASCII character. It is covered by `src/token.test.ts:167-172` (inside the `NOT_PRINTABLE` loop).
- Keep unchanged: the occupied health port test (line 88), the SIGTERM test (115), healthz/metrics/shutdown (129), the token-file success test (204), the missing token file test with ENOENT (252), and the private-ranges end-to-end test (293). With the two kept loop entries, that is 8 spawns.
- Remove helpers or imports that are no longer used, so lint passes. `startupLine` and `tokenFile` stay in use.

Change in `src/token.test.ts`: add one case next to the ENOENT case (lines 125-131). A `failingReader` that throws a `FakeFsError` with code `"EISDIR"` and a message that contains `SENTINEL`, called with `PULSE_PROBE_TOKEN_FILE: "/dir"` must give exactly `PULSE_PROBE_TOKEN_FILE=/dir: cannot read (EISDIR)` through `startupMessage`, which also checks that `SENTINEL` is absent.

Checks:
- `bun run check` passes.
- The `bun test` summary reports 0 fail and 0 skip, and line coverage of at least 80 % (the bunfig threshold; it was 99.23 % with 15 cuts).
- `src/main.test.ts` starts the literal 8 children of `bun src/main.ts`, one per remaining test (6 single tests plus one entry in each of the two loops). The PR lists them.

Completion evidence in the PR body: 5 CPU samples and the median of the Performance impact command, on `main` `8260148` (or the current `main` SHA) and on the branch head, with SHAs, CPU model and Bun version. The expected branch median is about 2.16 s, and it must be at most 2.20 s on an EPYC 7763-class runner, to keep a margin under the 2.3 s budget. If the branch median is above 2.20 s, request a `needs-input` hold with the samples instead of cutting more tests or asking for a higher budget. Also list each deleted test and its in-process twin (file:line).

## Repository: status

Files: `src/upstream-timeout.ts` (new), `src/server.ts`, `src/settings.ts`, `src/main.startup.test.ts`, `docs/development.md`.

Behavior change: no
A pure refactor (two constants move to a leaf module, with the same values) plus the removal of two duplicate tests. No message, exit code, limit or served byte changes.

Tool facts (verified):
- `bun run test` is `bun test` (`package.json:14`). `bun run check` is `bun run lint && bun run typecheck && bun run test` (`package.json:19`). `typecheck` also checks `e2e` (`package.json:13`). Bun 1.4.0 (`package.json:8-10` `engines`, `:38` `packageManager`). Biome 2.6.3 (`package.json:23`).
- `bunfig.toml:1-4` `[test]`: coverage on, line threshold 0.8.
- `biome.json:2` `extends` `@lorenzh/pulse-config/biome.json`, with the config pinned to `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). At that pin, `biome.json` is identical to the config clone.
- CI `.github/workflows/ci.yml:17-18` uses `check.yml@04108fa…`, the same file and steps as cited for probe (`check.yml:16-38` at the pin, identical to the clone).
- CI job `a11y` (`ci.yml:51-68`) runs on `ubuntu-24.04`, sets up Bun 1.4.0 (`:60-62`), runs `bun install --frozen-lockfile` (`:63-64`), installs Chromium with `bunx playwright install --with-deps chromium` (`:65-66`), and runs `bun run check:a11y` (`:67-68`), which is `bun e2e/run.ts` (`package.json:18`, Playwright 1.64.1 at `:28`). This task changes no `e2e` file, so `a11y` must just stay green. Locally, it needs that Chromium install first.

Line numbers are for `main` `d352e06`. Follow `AGENTS.md`: kebab-case file names, named exports, a module named after its job, relative imports with `.ts`.

Change 1, the leaf module (the owner's one exception to "no production code change"):
- Create `src/upstream-timeout.ts`. It imports only `MAX_TIMER_DELAY_MS` from `@lorenzh/pulse-kit` and nothing from `./`. It holds the two constants with their comments, moved unchanged from `src/server.ts:74-77`: `BROWSER_TIMEOUT_MARGIN_MS = 2000` and `MAX_UPSTREAM_TIMEOUT_MS = MAX_TIMER_DELAY_MS - BROWSER_TIMEOUT_MARGIN_MS`.
- `src/server.ts`: delete lines 74-77, and import both constants from `./upstream-timeout.ts`. Drop `MAX_TIMER_DELAY_MS` from the pulse-kit import (line 13) if nothing else in the file uses it (today, only line 77 does). Uses at lines 705 and 766 stay.
- `src/settings.ts:11`: import `MAX_UPSTREAM_TIMEOUT_MS` from `./upstream-timeout.ts` instead of `./server.ts`. After that, `src/settings.ts` imports nothing that reaches `src/server.ts`, and the comment at `src/main.ts:23` holds.
- Do not re-export the constants from `src/server.ts`. No other file imports them (Contract fields).
- `docs/development.md`: in "Code layout" (lines 14-33), add one line for `src/upstream-timeout.ts`. It holds the proxy's upper timeout and the browser margin, and imports no server code so that a bad setting exits without the server modules.
- No new test is needed for this pure move. The literals in `src/settings.test.ts:63-67` (2147481647 accepted, 2147481648 rejected with the exact message) and `src/server.test.ts:207-223` (`data-timeout-ms="6000"`, `"3500"`, `"2147483647"`) must pass unchanged.

Change 2, `src/main.startup.test.ts`:
- Delete `POLL_MS below 1000 prints one line and exits 2` (lines 73-76). It is covered by `src/start.test.ts:74-81` and `src/settings.test.ts:44-60`, both of which assert the exact message `POLL_MS: must be an integer from 1000 to 2147483647`.
- Delete `an http PULSE_STATUS_LOGO prints one line and exits 2` (lines 78-81). It is covered by `src/start.test.ts:83-89` (`PULSE_STATUS_LOGO: URL must use https`).
- Keep unchanged, with their exit status, one-line output and redaction assertions: the invalid `PULSE_API_URL` test (58-62, the value is not printed, stdout empty through `assertOneLine` at 44), the occupied `PORT` test (64-71) and the `PULSE_LOG_LEVEL` test (83-86). The `PULSE_LOG_LEVEL` test is the only test of the `readLogLevel` `catch` in `src/main.ts:8-15`.
- Shared transpiler cache (lines 16-18, 25, 55): measure it as defined under Counterexamples, after changes 1 and 2. Remove it when it saves nothing by that rule, together with the imports only it uses (`mkdtempSync`, `rmSync`, `tmpdir`, `join`). Otherwise keep it. The PR states which, with both sets of samples.

Checks:
- `bun run check` passes, with 0 fail, 0 skip and line coverage of at least 80 % (`bunfig.toml:3`). The third plan run gave 474 pass, 0 fail.
- `src/main.startup.test.ts` holds the literal 3 tests.
- `grep -n "server.ts\|start.ts" src/settings.ts src/upstream-timeout.ts` finds no import.
- CI `a11y` stays green. This task changes no `e2e` file, but the page's `data-timeout-ms` must not change.

Completion evidence in the PR body:
- The transpiled file count (Counterexamples) on `main` and on the branch head. The expected values are 95 and 3. The branch count must be at most 10.
- 5 CPU samples per side of the Performance impact command on `main` and on the branch head, alternating in one session, with SHAs, CPU model and Bun version. Also the scaled branch median (Performance impact, "Status scale").
- The cache samples and the cache decision.
- The scaled branch median must be at most 2.55 s (the owner's limit). It measured 2.40-2.46 s in the third plan run. If it is above 2.55 s, request a `needs-input` hold with the samples. Do not cut more tests.

## Repository: api

Files: `bench/budgets.json`, `bench/README.md`.

Behavior change: yes
Bench gate data changes: the notify, api and status `test_cpu_s` verdicts move from failing (or about to fail) to passing.

Tool facts (verified):
- `bun run bench:selftest` runs eight `bench/selftest/check-*.ts` scripts, including `check-budgets.ts` (`package.json:18`). CI job `bench-selftest` (`.github/workflows/ci.yml:20-33`) sets up Bun 1.4.0 (`:28-30`) and runs `bun install --frozen-lockfile` (`:31`), `bun run bench:selftest` (`:32`) and `docker compose -f bench/compose.bench.yaml config --quiet` (`:33`).
- `bun run check` is `bun run lint && bun run typecheck && bun run test` (`package.json:20`). Bun 1.4.0 (`package.json:8-10` `engines`, `:35` `packageManager`). The shared check runs through `check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`ci.yml:17-18`, pin also in `package.json:24`), the same file and steps as cited for probe (`check.yml:16-38` at the pin, identical to the clone).
- `Bench` (`.github/workflows/bench.yml`) runs on `ubuntu-24.04` (`:31`) with Bun 1.4.0 (`:39-41`). It has `workflow_dispatch` inputs `a`, `b` and `others` (`:7-20`). It runs `bun bench/run.ts` from the workflow checkout (`:36-38`, `:43-53`) and uploads `bench-out/` as the artifact `bench-out` (`:54-59`). So the budgets of the dispatched branch apply. The api B side is the `b` input (default `main`, `bench/run.ts:81`), and `others` would pin every other repository on both sides (`bench/refs.ts:60-62`), so it is not used here.
- Ref handling: without `others`, every non-api repository gets A = the newest `v*` tag and B = `"main"` (`bench/refs.ts:63-66`). `run.ts` logs the refs as given, `A: {…}` and `B: {…}` (`bench/run.ts:236-237`), and writes them unresolved to `samples.json` (`:256`). Each worktree is made by `git fetch origin <ref>` and `git worktree add --detach … FETCH_HEAD` (`bench/run.ts:106-118`), and the resolved SHA is never logged. A full commit SHA works as a ref: `git fetch origin <sha>` is the same call that `containsCommit` uses (`bench/refs.ts:88`).
- The budget schema allows `budget`, `unit`, `gating`, `thresholdPct` and `floor` (`bench/compare.ts:35-41`, parsed at `:122-146`). `judge` is in `bench/compare.ts:181-188`, with the defaults 10 % and `s` floor 0.2 (`:103-104`).

Preconditions. Check them before any change. If one fails, request a `needs-input` hold that names it:
- #617 is closed, and its api pull request is merged into pulse-api `main` (`gh issue view 617 --repo lorenzh/pulse-meta`, and the merge commit is an ancestor of `origin/main`). The owner decided: if #617 has not merged when probe and status are done, stop and ask.
- The probe and status children of this spec are merged to their `main` branches.

Measurement provenance. `run.ts` logs and stores only the refs as given (`main`, a tag), never the resolved SHA (Tool facts above). The workflow run's `head_sha` is the api checkout that supplies the budgets and harness, not the api B worktree. So each hosted run R below establishes its measured SHAs like this. It needs no file change, and anyone can repeat it afterwards with the GitHub API:
- **api B: pin it.** Before the dispatch, read `API_B=$(git ls-remote https://github.com/lorenzh/pulse-api.git refs/heads/main | cut -f1)`, a full 40-character SHA. Check that it contains #617: `gh api repos/lorenzh/pulse-api/compare/<#617 merge commit>...$API_B --jq .status` prints `ahead` or `identical`. Dispatch with `-f b=$API_B`. The run log line `[bench] B: {"api":"<API_B>",…}` (`bench/run.ts:237`) then names the measured api B commit literally.
- **probe, status, notify, contract, kit, config B (`main`): bracket it.** Right before the dispatch, record `PRE[r] = git ls-remote https://github.com/lorenzh/pulse-<r>.git refs/heads/main`. Right after the run concludes, record `POST[r]` the same way. Each B worktree is fetched between those two moments. Accept the run only if, for every repository, `POST[r] == PRE[r]`, or `gh api repos/lorenzh/pulse-<r>/compare/$PRE...$POST --jq .status` prints `ahead`, meaning `main` only moved forward. Then the measured B is `PRE[r]`, or a commit between `PRE[r]` and `POST[r]` that contains `PRE[r]`. For probe and status, `PRE[r]` must contain the merge commit of this spec's child: `gh api repos/lorenzh/pulse-<r>/compare/<child merge commit>...$PRE --jq .status` prints `ahead` or `identical`. If any repository moved in another way (`diverged`, `behind`), the measured SHA is unknown. Discard the run and repeat it once. If it happens again, hold.
- **A sides** are `v*` tags, named literally in the log line `A: {…}` (`bench/run.ts:236`). Record each tag's commit with `git ls-remote --tags https://github.com/lorenzh/pulse-<r>.git '<tag>^{}'`.

Steps:
1. **R1, the measurement run.** Do the provenance steps, then dispatch `Bench` on api `main` with the pinned api B: `gh workflow run bench.yml --repo lorenzh/pulse-api --ref main -f b=$API_B`. It is expected to fail on notify and api. From R1's `table.json` (artifact `bench-out`), read the `test_cpu_s` A and B medians of api, notify, probe and status.
2. Stop with a `needs-input` hold, giving R1's numbers, if any of these hold:
   - probe B > 2.3. Do not raise that budget.
   - notify B > 2.5, or notify B − A > 0.6. In that case the owner's literals do not fit.
   - api round-up-0.1(A × 1.3) < B + 0.1, which leaves under 0.1 s of budget margin. The budget is exactly round-up-0.1(A × 1.3). Never set a higher value to make room.
   - Any other gating row fails.
   - The provenance check fails twice.
   2a. **Status** (the owner's rule; it replaces the old `status B > 2.4` hold). Let A and B be R1's status `test_cpu_s` medians and L = max(A × 0.1, 0.2) − 0.05.
   - B − A ≤ L, and B + 0.1 ≤ round-up-0.1(A × 1.3): the normal path. Status gets a new budget and no floor (step 3).
   - B − A > L: the owner has already decided the answer to this hold, so do not stop for it. Apply the bounded fallback instead: `floor` = round-up-0.1(B − A + 0.2) and `budget` = round-up-0.1(A × 1.3). Hold with R1's status samples if the floor is above 0.5, the budget is above 3.2, or B + 0.1 > budget. State "status fallback floor applied" at the top of the PR body.
   - B + 0.1 > round-up-0.1(A × 1.3) on the normal path: hold with the samples.
3. Edit `bench/budgets.json`:
   - `notify.test_cpu_s`: `"budget": 2.5`, add `"floor": 0.6`.
   - `api.test_cpu_s`: `"budget"` = round-up-0.1(R1 A × 1.3), add `"floor"` = round-up-0.1(R1 B − R1 A + 0.2), both computed as defined in Counterexamples. With A 3.76 and B 4.66, that gives 4.9 and 1.1.
   - `status.test_cpu_s`: `"budget"` = round-up-0.1(R1 status A × 1.3), about 3.2 (A 2.42 gives 3.146 → 3.2). Add no `floor` and no `thresholdPct` on the normal path. Add `"floor"` only on the fallback path of step 2a.
   - Leave every other entry byte-for-byte unchanged.
4. Edit `bench/README.md`:
   - Add a paragraph "Temporary test floors" under "Initial budgets". It gives R1's run link and A/B medians for notify and api, the formulas and results above, and why: accepted test growth from #588, #594, #605 and #607 in notify, and from #561/#617 in api, against the `v0.1.0` A side; release tags are a separate owner decision. It also gives the removal rule from Required behavior 4.
   - Add one sentence on the status budget: it is re-set from R1's status A median by the rule in "Changing a budget" (`bench/README.md:100`), because `v0.1.0` measured above the old 2.4 s budget. Give A and the arithmetic. This re-set is not temporary.
   - On the fallback path only, list the status floor in "Temporary test floors" with its arithmetic and the same removal rule (the next status `v*` tag).
   - Keep the contract and config floor text unchanged.
5. **R2, the verification run.** Push the branch. Repeat the provenance steps with a fresh `API_B` (api `main`, not the branch: the branch differs from `main` only in the two bench files, which the workflow checkout supplies). Dispatch `gh workflow run bench.yml --repo lorenzh/pulse-api --ref <branch> -f b=$API_B`. R2's `head_sha` must equal the branch head that holds the new `budgets.json`. R2 must conclude `success`, with exit 0 and every gating row `ok`. Status B in R2 must also satisfy the step 2a condition of the path taken. If it fails, request a `needs-input` hold with the failing rows. Do not widen a value beyond the rules above.

Checks: `bun run check`, `bun run bench:selftest` and `docker compose -f bench/compose.bench.yaml config --quiet` pass. `git diff --stat` touches only the two files.

Completion evidence in the PR body: the R1 and R2 run links and, per run, the provenance record:
- `API_B` with the log line that shows it, and the `compare` status against the #617 merge commit.
- `PRE` and `POST` of the six other repositories with their `compare` statuses, the `compare` status of the probe and status child merge commits against `PRE`, and the A tags with their commits.
- R2's `head_sha`.
Also a table of A / B medians and verdicts of every `test_cpu_s` row in R2. Also the arithmetic for the api values and the status budget, which status path step 2a took (normal or fallback), and the risk below about kit.

## Risks

- **Thin margins.** probe at about 2.16 s against 2.3, and api at about 4.66 against 4.9. Status has room against its new budget (about 2.45 against 3.2). Its regression room is only about 0.13-0.20 s until the next status tag (A 2.42, limit 0.242). The 0.05 s hold margin of step 2a keeps R1 from merging a value at the edge. Runner speed varied by up to 40 % between hosted runs on the same SHAs (kit 0.32 against 0.45-0.51 s, `measurements.md`). A fast-runner R1 would give a low api budget. The step-2 margin rule and R2 catch that before merge. A slow-runner nightly can still fail after merge. Then a person decides; this spec gives no automatic widening.
- **kit** `test_cpu_s` B was 0.672 against 0.7 in nightly 41421625359. It is outside this spec. If it fails R2, the api task holds instead of changing it.
- **#617 timing.** The api child cannot finish until #617 merges. Fan-out does not link #617, so a person adds the native "blocked by" after fan-out. The precondition check covers it if that step is missed.
- **#628** (`LEFTHOOK` in config hook tests) affects local bench runs on Factory runners, not the hosted job. Use hosted runs for the api evidence.

## Acceptance evidence

1. probe PR: `bun run check` green in CI. 5 local CPU samples with a branch median ≤ 2.20 s (literal) and a `main` median for comparison. 8 spawn tests (literal count). Coverage ≥ 80 % (bunfig threshold).
2. status PR: `bun run check` and `a11y` green. The bad-setting child transpiles at most 10 files (literal; `main` 95, measured 3). 5 alternating CPU samples per side, with a scaled branch median ≤ 2.55 s (the owner's literal; scale factor 2.84 s from `measurements.md`, `main` measured in the same session). 3 tests in `src/main.startup.test.ts` (literal). The cache decision with its samples.
3. api PR: R1 and R2 links with their provenance records. The measured api B is the literal `API_B` in the log, and the measured other B commits are bracketed by `PRE` and `POST` and checked with the GitHub compare API, a source independent of the bench output. R2 concluded `success`. probe B ≤ 2.3, the unchanged literal in `budgets.json`, which this spec does not touch. notify floor 0.6 and budget 2.5 (owner literals). api budget and floor, and the status budget, derived from R1, a run independent of the file under test, with the arithmetic shown. Status B − A within the step 2a limit, computed from R1's own medians and the owner's formula, or the fallback floor within the owner's bounds (0.5, 3.2).
4. Feature acceptance: the first hosted nightly `Bench` on api `main` after the api PR merges concludes `success`, with #617 merged. The person who merges posts its run link and the `test_cpu_s` A/B medians on #585.
