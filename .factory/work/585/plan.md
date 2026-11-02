# Spec #585: probe and status test CPU over budget, accepted test growth in notify and api

> **On hold (second plan run, 2026-11-02).** Status `main` moved to `d352e06` (#592) and now measures 2.84 s. The status section below (2 cuts, budget unchanged) gives 2.65 s, which is still over the 2.4 s budget (`measurements.md`, "status after #592"). The status section and the status rows of the api task wait for the owner's decision in the issue. The review fixes (measurement provenance, budget cap, redaction evidence, tool citations) are already applied.

## Goal

Make the hosted nightly `Bench` on api `main` pass again, with #617 merged, without weakening a gate:

- probe and status: lower `test_cpu_s` under their current budgets by removing child-process tests that only repeat startup checks already covered in-process.
- notify and api: record the accepted test-suite growth in `bench/budgets.json` with a bounded, temporary `floor`, so the regression rule stays armed.

This follows the owner decision in the issue comments: no release tags, no large `thresholdPct`, no product code change, and probe and status budgets stay as they are.

## Evidence this spec builds on

Measurements are in `.factory/work/585/measurements.md` (GitHub-hosted runner, AMD EPYC 7763, Bun 1.4.0, `bun run test` CPU read like `runCommand` in `bench/measure.ts:52-71`). Local medians match hosted medians within 0.05 s.

- **Probe cause.** pulse-probe PR #44 (#493) raised probe test CPU from 2.04 to 3.66 s. #603 (PR #49) and #599 (PR #50) raised it to 4.40 s on `main` `8260148`. `src/main.test.ts` spawns 22 `bun src/main.ts` children at about 0.16 s CPU each, mostly for module loading. Real timers are not the cause. With 15 of those spawns skipped, the suite measured 2.00 s (5 samples 2.01 2.00 2.00 1.99 1.99), with 0 failures and 99.23 % line coverage.
- **Status is not noise.** `main` `0a4768d` measured 2.52 2.44 2.45 2.46 2.55 (median 2.46 s). The hosted B medians were 2.44, 2.46 and 2.47 s. Every one is above the 2.4 s budget. `src/main.startup.test.ts` spawns 5 children at about 0.16 s each. **Superseded:** on `d352e06` (#592), status measures 2.84 s, and the 2-cut plan below measures 2.65 s (`measurements.md`).
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
- status: remove 2 duplicate spawn tests from `src/main.startup.test.ts`.
- api: `bench/budgets.json` (`notify.test_cpu_s`, `api.test_cpu_s`) and `bench/README.md`, with hosted bench runs as evidence.

## Non-goals

- No release tags in any repository. A tag is a release decision, outside this issue.
- No change of probe, status, kit, contract or config budgets. No change of `thresholdPct` anywhere.
- No production code change in any repository. No change of `bench/*.ts`, `bench.yml` or any CI file.
- No change of the notify test suite. Its growth comes from in-process tests of four accepted features (#588, #594, #605, #607) and has no spawn hotspot.
- No lowering of the 80 % line coverage threshold (`bunfig.toml` `[test]` in probe and status), and no `test.skip`: duplicate tests are deleted, and the tests that stay run.

## Required behavior

1. Probe `bun run test` keeps every behavior assertion it had, either in-process or in a remaining spawn test. It spawns 8 children of `bun src/main.ts` instead of 22. Its hosted `test_cpu_s` B median is at most 2.3 s.
2. Status `bun run test` keeps every behavior assertion it had. It spawns 3 children instead of 5. Its hosted `test_cpu_s` B median is at most 2.4 s.
3. `bench/budgets.json` in api: `notify.test_cpu_s` becomes `{ "budget": 2.5, "unit": "s", "gating": true, "floor": 0.6 }`. `api.test_cpu_s` gets `budget` and `floor` computed by the rules under Counterexamples from a hosted run that includes #617. `gating` stays `true` for both.
4. `bench/README.md` in api records both floors as temporary, with the measurement they come from and the rule that removes them: the first api PR after the next `v*` tag of that repository (notify, or api) removes that repository's `test_cpu_s` floor and re-sets its budget from the new A median plus 30 %, rounded up to 0.1 s.
5. With all three changes merged and #617 merged, the full hosted `Bench` passes: exit code 0, no `FAIL` row, no harness error.

## Performance impact

Metrics of `bench/budgets.json` in api that can move. Only `test_cpu_s` moves. No other metric can move, because no service code, image or startup path changes.

| Metric | Direction | Size | Measured how |
| --- | --- | --- | --- |
| probe `test_cpu_s` | down | 4.40 → about 2.16 s (15 cut spawns measured 2.00 s; this spec keeps one more, about +0.16 s) | 5 local runs of the command below on `main` and on the branch, then hosted |
| status `test_cpu_s` | down | on `d352e06`: 2.84 → 2.65 s measured with this section's 2 cuts (it was 2.46 → about 2.13 s on `0a4768d`). Still over 2.4; pending decision | the same |
| notify `test_cpu_s` | value unchanged; verdict changes from `FAIL regression` to `ok` through the new floor | — | hosted run |
| api `test_cpu_s` | value set by #617 (+0.8 s), not by this spec; verdict stays `ok` through the new budget and floor | — | hosted run |

Local CPU of one `bun run test`, the same quantity as `bench/measure.ts:69-70` (user + system, waited children included, `cpuTime` in microseconds). Run it 5 times in the repository and take the median (3rd smallest of 5):

```sh
bun -e 'const p = Bun.spawn(["bun", "run", "test"], { stdout: "ignore", stderr: "ignore" }); const code = await p.exited; const u = p.resourceUsage(); console.log(code, ((Number(u.cpuTime.user) + Number(u.cpuTime.system)) / 1e6).toFixed(2))'
```

A local number is a guide only. Acceptance comes from the hosted runs.

## Security impact

Security impact: no
Only tests, budget data and docs change. No production code, error text, dependency, Dockerfile or CI file changes. Each removed spawn test checks a startup message that an in-process test already asserts, including the absence of the token. Probe keeps one process-level token-content test, which checks stdout and stderr for the token (`startupLine`, `src/main.test.ts:196-197`). It also keeps one bad-setting test, which today checks only stderr (`src/main.test.ts:84`). The probe task adds a stdout assertion to that test, so both kept tests check that no secret reaches stdout or stderr.

## Rollout order

1. probe and status, in parallel. Each is a test-only change in one repository, and nothing consumes it. Older pins of other repositories do not matter.
2. #617 (api, part of #561) merges. This is outside this spec. The api child must not start its measurement before that.
3. api: budgets and README. It needs the merged probe and status changes and the merged #617, because its hosted run measures `main` of every repository.

The bench resolves the refs: B = `main` of every repository, A = the newest `v*` tag (`bench/refs.ts:36-67`). Lower probe and status values on B can only improve their rows, because improvements never fail (`bench/compare.ts:180`). After fan-out, a person links the api child as natively "blocked by" #617, so `factory-unblock.yml` starts it only once both are closed. The api task also checks this itself (see its section).

## Counterexamples

- **Rounding up to 0.1 s** is `Math.ceil(x * 10 - 1e-9) / 10`. 4.888 → 4.9, not 4.8 or 5.0. 4.9 exactly → 4.9, not 5.0. 1.101 → 1.2. Rounding to the nearest value (4.84 → 4.8) is wrong.
- **Median** is the median of the 5 per-round samples of one side in one hosted run, as computed by `median` in `bench/measure.ts:23` and written to `table.json`. For 5 samples, it is the 3rd smallest. It is never a mean of samples, and never a median of medians from two runs.
- **api budget** = round-up-0.1(A median × 1.3), with A = api `test_cpu_s` A median of run R1 (below). A = 3.76 gives 4.888 → 4.9. That rounded value is both the prescribed value and the cap. 4.9 is above the unrounded 4.888 only by the rounding, and it is allowed. Any value above round-up-0.1(A × 1.3) is wrong, for example 5.0 for A = 3.76. So is a value below it, for example 4.8 (rounded down). Using B instead of A (4.66 × 1.3 = 6.06 → 6.1) is wrong: the owner rejected 6.1.
- **api floor** = round-up-0.1(B median − A median + 0.2), from the same run R1. A 3.76 and B 4.66 give 1.1. A floor computed from two different runs (A from one run, B from another) is wrong.
- **Regression rule for notify** with floor 0.6: A 1.82, B 2.27 → limit max(0.182, 0.6) = 0.6, B − A = 0.45, so `ok`. A 1.82, B 2.45 → B − A = 0.63 > 0.6, so `FAIL regression` even though B ≤ 2.5. A floor so large that it can never fire (for example 5) breaks the "gate stays armed" rule.
- **Budget check for notify**: B 2.51 → `FAIL budget`, even when B − A ≤ 0.6.
- **Probe removal**: removing the `invalid UTF-8` token-file spawn test is wrong. It is the only test that reads the file through the real `readFileSync(path, "utf8")` (`src/main.ts:36`) and then checks that the decoded content is not printed. In-process tests pass strings.
- **Status removal**: removing the `PULSE_LOG_LEVEL` spawn test is wrong. `src/main.ts:8-15` reads the log level in its own `try`/`catch`, before `startFromEnv`. No in-process test reaches that branch, and `grep -rn PULSE_LOG_LEVEL src/*.test.ts` finds only `src/main.startup.test.ts:83-86` (on `d352e06`).
- **Measured SHA**: a log line `B: {"probe":"main",…}` (`bench/run.ts:237`) names a branch, not a commit. It is not evidence that B contained a given commit. Neither is the run's `head_sha`, which is the api workflow checkout, not the separately cloned api B worktree (`bench/run.ts:106-118`).
- **`test.skip` instead of deletion** is wrong. Skipped tests leave dead code, and the issue review rules out skipping costly tests.

## Contract fields

No new names. `floor` and `budget` are existing keys of the bench budget schema (`bench/compare.ts:39-40`, `:124`), not contract or config names. No route, env variable or type is added.

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

Files: `src/main.startup.test.ts`.

Behavior change: no
Tests only: two duplicate process-level tests are removed.

Tool facts (verified):
- `bun run test` is `bun test` (`package.json:14`). `bun run check` is `bun run lint && bun run typecheck && bun run test` (`package.json:19`). `typecheck` also checks `e2e` (`package.json:13`). Bun 1.4.0 (`package.json:8-10` `engines`, `:38` `packageManager`). Biome 2.6.3 (`package.json:23`).
- `bunfig.toml:1-4` `[test]`: coverage on, line threshold 0.8.
- `biome.json:2` `extends` `@lorenzh/pulse-config/biome.json`, with the config pinned to `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). At that pin, `biome.json` is identical to the config clone.
- CI `.github/workflows/ci.yml:17-18` uses `check.yml@04108fa…`, the same file and steps as cited for probe (`check.yml:16-38` at the pin, identical to the clone).
- CI job `a11y` (`ci.yml:51-68`) runs on `ubuntu-24.04`, sets up Bun 1.4.0 (`:60-62`), runs `bun install --frozen-lockfile` (`:63-64`), installs Chromium with `bunx playwright install --with-deps chromium` (`:65-66`), and runs `bun run check:a11y` (`:67-68`), which is `bun e2e/run.ts` (`package.json:18`, Playwright 1.64.1 at `:28`). This task changes no `e2e` file, so `a11y` must just stay green. Locally, it needs that Chromium install first.

**Pending the owner's decision (see the hold note at the top).** On `d352e06`, this change measures 2.65 s, still over the 2.4 s budget. Line numbers are for `d352e06`.

Change in `src/main.startup.test.ts` (`main` `d352e06`):
- Delete `POLL_MS below 1000 prints one line and exits 2` (lines 73-76). It is covered by `src/start.test.ts:74-81` and `src/settings.test.ts:44-60`, both of which assert the exact message `POLL_MS: must be an integer from 1000 to 2147483647`.
- Delete `an http PULSE_STATUS_LOGO prints one line and exits 2` (lines 78-81). It is covered by `src/start.test.ts:83-89` (`PULSE_STATUS_LOGO: URL must use https`).
- Keep: the invalid `PULSE_API_URL` test (58, it checks that the value is not printed), the occupied `PORT` test (64) and the `PULSE_LOG_LEVEL` test (83). The `PULSE_LOG_LEVEL` test is the only test of the `readLogLevel` `catch` in `src/main.ts:8-15`. `measurements.md` lists it as covered in-process, but that is wrong. Moving it in-process would need a production change, which is out of scope.

Checks:
- `bun run check` passes, with 0 fail, 0 skip and line coverage of at least 80 %.
- The file holds the literal 3 tests.

Completion evidence in the PR body: 5 CPU samples and the median of the Performance impact command on `main` and on the branch head, with SHAs, CPU model and Bun version. The expected branch median was about 2.13 s on `0a4768d`, but it measures 2.65 s on `d352e06`. The limit of 2.25 s stands until the owner decides. If the median is higher, request a `needs-input` hold with the samples.

## Repository: api

Files: `bench/budgets.json`, `bench/README.md`.

Behavior change: yes
Bench gate data changes: two `test_cpu_s` verdicts move from failing to passing.

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
   - probe B > 2.3, or status B > 2.4. Do not raise those budgets.
   - notify B > 2.5, or notify B − A > 0.6. In that case the owner's literals do not fit.
   - api round-up-0.1(A × 1.3) < B + 0.1, which leaves under 0.1 s of budget margin. The budget is exactly round-up-0.1(A × 1.3). Never set a higher value to make room.
   - Any other gating row fails.
   - The provenance check fails twice.
3. Edit `bench/budgets.json`:
   - `notify.test_cpu_s`: `"budget": 2.5`, add `"floor": 0.6`.
   - `api.test_cpu_s`: `"budget"` = round-up-0.1(R1 A × 1.3), add `"floor"` = round-up-0.1(R1 B − R1 A + 0.2), both computed as defined in Counterexamples. With A 3.76 and B 4.66, that gives 4.9 and 1.1. Leave every other entry byte-for-byte unchanged.
4. Edit `bench/README.md`. Add a paragraph "Temporary test floors" under "Initial budgets". It gives R1's run link and A/B medians for notify and api, the formulas and results above, and why: accepted test growth from #588, #594, #605 and #607 in notify, and from #561/#617 in api, against the `v0.1.0` A side; release tags are a separate owner decision. It also gives the removal rule from Required behavior 4. Keep the contract and config floor text unchanged.
5. **R2, the verification run.** Push the branch. Repeat the provenance steps with a fresh `API_B` (api `main`, not the branch: the branch differs from `main` only in the two bench files, which the workflow checkout supplies). Dispatch `gh workflow run bench.yml --repo lorenzh/pulse-api --ref <branch> -f b=$API_B`. R2's `head_sha` must equal the branch head that holds the new `budgets.json`. R2 must conclude `success`, with exit 0 and every gating row `ok`. If it fails, request a `needs-input` hold with the failing rows. Do not widen a value beyond the rules above.

Checks: `bun run check`, `bun run bench:selftest` and `docker compose -f bench/compose.bench.yaml config --quiet` pass. `git diff --stat` touches only the two files.

Completion evidence in the PR body: the R1 and R2 run links and, per run, the provenance record:
- `API_B` with the log line that shows it, and the `compare` status against the #617 merge commit.
- `PRE` and `POST` of the six other repositories with their `compare` statuses, the `compare` status of the probe and status child merge commits against `PRE`, and the A tags with their commits.
- R2's `head_sha`.
Also a table of A / B medians and verdicts of every `test_cpu_s` row in R2. Also the arithmetic for both api values, and the risk below about kit.

## Risks

- **Thin margins.** probe at about 2.16 s against 2.3, status at about 2.13 against 2.4, api at about 4.66 against 4.9. Runner speed varied by up to 40 % between hosted runs on the same SHAs (kit 0.32 against 0.45-0.51 s, `measurements.md`). A fast-runner R1 would give a low api budget. The step-2 margin rule and R2 catch that before merge. A slow-runner nightly can still fail after merge. Then a person decides; this spec gives no automatic widening.
- **kit** `test_cpu_s` B was 0.672 against 0.7 in nightly 41421625359. It is outside this spec. If it fails R2, the api task holds instead of changing it.
- **#617 timing.** The api child cannot finish until #617 merges. Fan-out does not link #617, so a person adds the native "blocked by" after fan-out. The precondition check covers it if that step is missed.
- **#628** (`LEFTHOOK` in config hook tests) affects local bench runs on Factory runners, not the hosted job. Use hosted runs for the api evidence.

## Acceptance evidence

1. probe PR: `bun run check` green in CI. 5 local CPU samples with a branch median ≤ 2.20 s (literal) and a `main` median for comparison. 8 spawn tests (literal count). Coverage ≥ 80 % (bunfig threshold).
2. status PR (pending the owner's decision): `bun run check` and `a11y` green. 5 local CPU samples with a branch median ≤ 2.25 s (literal). 3 tests in `src/main.startup.test.ts` (literal).
3. api PR: R1 and R2 links with their provenance records. The measured api B is the literal `API_B` in the log, and the measured other B commits are bracketed by `PRE` and `POST` and checked with the GitHub compare API, a source independent of the bench output. R2 concluded `success`. probe B ≤ 2.3 and status B ≤ 2.4, the unchanged literals in `budgets.json`, which this spec does not touch. notify floor 0.6 and budget 2.5 (owner literals). api budget and floor derived from R1, a run independent of the file under test, with the arithmetic shown.
4. Feature acceptance: the first hosted nightly `Bench` on api `main` after the api PR merges concludes `success`, with #617 merged. The person who merges posts its run link and the `test_cpu_s` A/B medians on #585.
