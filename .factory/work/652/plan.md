# Spec #652: api, notify test CPU budget after the SQLite ledger

## Goal
pulse-notify#41 (SQLite ledger and per-delivery retry, feature #649) merged on 2026-11-03 04:03 UTC as `757e78f27cfdbb89109c216dcba829158ea7b5c3`. It adds about 0.6 to 1.0 s of CPU to `bun run test` in notify. The owner decision on #649 (https://github.com/lorenzh/pulse-meta/issues/649#issuecomment-6594413459) accepts that growth and asks for this follow-up. The current hosted Bench values for `notify.test_cpu_s` (api `bench/budgets.json:216-221`: budget 2.5 s, floor 0.6 s) are expected to fail on notify `main`. They must be re-set from one hosted measurement R, with fixed formulas and fixed caps, and documented as temporary.

## Scope
- Only the api repository, and in it only `bench/budgets.json` and `bench/README.md`.
- In `bench/budgets.json` only two numbers change: `notify.test_cpu_s.floor` and `notify.test_cpu_s.budget`.
- In `bench/README.md` only the notify part of "### Temporary test floors" (`bench/README.md:118-126`) changes.
- The hosted runs R (measurement), V (validation on the branch) and M (acceptance on api `main` after merge) are evidence. They do not change files.

## Non-goals
- No `thresholdPct` anywhere. No change to `unit` or `gating` of any row.
- No change to any other notify metric (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `startup_wall_ms`, `image_mb`) or to any value of api, probe, status, contract, kit or config.
- No change to `bench/baseline.json`, the harness (`bench/*.ts`), the self-tests, `.github/workflows/bench.yml`, `ci.yml`, dependencies or any code.
- No change in pulse-notify. Its tests are accepted spec work of #649 and are not cut.
- No release tag in any repository. Tags are an owner decision.
- No reporting of resolved SHAs added to the harness. SHAs are established outside it (Acceptance evidence, "Provenance").

## Required behavior
Definitions (used everywhere below):
- **Samples.** R's artifact `bench-out/samples.json` holds `{ refs, samples }` (`bench/run.ts:256`). The notify test samples are `samples.a.notify.test_cpu_s` and `samples.b.notify.test_cpu_s`, five numbers each (one per round, `bench/run.ts:244-251`, `:165-166`). Each is user plus system CPU of the whole `bun run test` with waited children, in seconds (`bench/measure.ts:68-70`, microsecond resolution).
- **Median.** `median` of `bench/measure.ts:23-31`: sort ascending; with five samples it is the 3rd smallest. Use the unrounded sample values, not the two-decimal table.
- **Integer microseconds.** Only the two raw medians are converted: `A_us = Math.round(A * 1e6)`, `B_us = Math.round(B * 1e6)`. This is exact, because each sample is an integer count of microseconds divided by 1e6 (`bench/measure.ts:68-70`), and a median of five is one of the samples. No composite expression (a sum, a difference or A × 1.3) is ever rounded to microseconds.
- **ceil0.1(x)** is x rounded up to the next multiple of 0.1 s; a value that is already a multiple of 0.1 s stays the same. Each ceiling is defined directly on integers with `ceilDiv(n, d) = (n + d − 1) / d` in BigInt (integer division, n ≥ 0, d > 0), and the result is a count of tenths of a second:
  - `floor_tenths = ceilDiv(B_us − A_us + 200000, 100000)` (that is ceil0.1(B − A + 0.2); only defined when B_us − A_us + 200000 ≥ 0, see Required 5),
  - `p_tenths = ceilDiv(13 × A_us, 1000000)` (that is ceil0.1(A × 1.3): 13 × A_us is A × 1.3 in units of 0.1 µs, so the fractional microseconds are kept),
  - `q_tenths = ceilDiv(B_us + 100000, 100000)` (that is ceil0.1(B + 0.1)),
  - `budget_tenths = max(p_tenths, q_tenths)`. The written values are `floor_tenths / 10` and `budget_tenths / 10` s; the caps are `floor_tenths ≤ 14` and `budget_tenths ≤ 32`.
  - Reference (checked with `node -e`): `const cd = (n, d) => (n + d - 1n) / d; const a = BigInt(Math.round(A * 1e6)), b = BigInt(Math.round(B * 1e6));` then `cd(b - a + 200000n, 100000n)`, `cd(13n * a, 1000000n)`, `cd(b + 100000n, 100000n)`.

1. **Precondition.** At the time of R, the newest `v*` tag of pulse-notify is `v0.1.0` (commit `c090a07811590eb158849fb9981f3c94fec74276`, a lightweight tag: `gh api repos/lorenzh/pulse-notify/git/ref/tags/v0.1.0` gives `object.type` `commit`, checked 2026-11-03), and notify `main` contains `757e78f27cfdbb89109c216dcba829158ea7b5c3`. If notify has a newer `v*` tag, the formulas of this issue do not apply (A would contain the ledger); hold with `needs-input` and name the tag.
2. **Run R.** Dispatch `bench.yml` on the api implementation branch before any file change on it: `gh workflow run bench.yml -R lorenzh/pulse-api --ref <branch> -f b=<API_B>`, where `API_B` is the full SHA of api `main` read right before the dispatch (see Provenance). Leave `a` and `others` empty: `a` defaults to `baseline` (api's newest `v*` tag, `bench/refs.ts:55-59`), and an `others` value would pin every other repository to one ref on both sides (`bench/refs.ts:60-62`), so notify A would equal notify B. Rounds are the harness default, 5 (`bench/run.ts:76`); the workflow has no rounds input (`bench.yml:8-20`).
3. **R must be complete.** R qualifies only if the job reached the table: `samples.json`, `table.json` and `table.md` are in the artifact, every sample list has five values, and the exit was 0 or 1 (`bench/run.ts:263`, via `:272`), not 2 (harness error, the `catch` at `bench/run.ts:273-275`; the file ends at line 276). A run that hits the job timeout of 90 minutes (`bench.yml:32`) is incomplete too. Provenance (Acceptance evidence) must also hold; a run whose measured SHAs it cannot establish counts as incomplete. A harness error or a missing artifact: dispatch R once more. A second incomplete run: hold with both run links.
4. **No other failing row.** In R's `table.json`, every row other than `notify` / `test_cpu_s` has a verdict that is not `FAIL regression` or `FAIL budget`. R is measured with the old budgets (the branch has no change yet), so `notify.test_cpu_s` may fail. Any other failing row: hold with R's link and that row; fix nothing else.
5. **New values.** With R's notify medians A and B, computed as in Definitions (integer `floor_tenths`, `p_tenths`, `q_tenths`):
   - `floor` = ceil0.1(B − A + 0.2) = `floor_tenths / 10`. Cap: at most 1.4 s (`floor_tenths ≤ 14`).
   - `budget` = max(ceil0.1(A × 1.3), ceil0.1(B + 0.1)) = `max(p_tenths, q_tenths) / 10`. Cap: at most 3.2 s (`budget_tenths ≤ 32`).
   - If `floor` > 1.4 or `budget` > 3.2: hold (`needs-input`) with the ten samples, both medians, the arithmetic, R's link and the SHAs. Do not write the cap instead, do not use a guessed pair (3.1 / 1.3), do not raise a cap.
   - If B_us − A_us < 200000 (B − A < 0.2 s: the floor would be close to the default 0.2 s of `bench/compare.ts:104`, or B is below A): the growth that #649 accepted did not show. Hold with the samples instead of writing the values.
6. **budgets.json.** Replace the numbers at `bench/budgets.json:217` (`"budget": 2.5`) and `:220` (`"floor": 0.6`) with the values of 5. Keep key order, `"unit": "s"`, `"gating": true` and the file's formatting (Biome, see the repository section). Every other byte of the file stays.
7. **README.** In "### Temporary test floors" (`bench/README.md:118-126`):
   - Line 120 says the values of api, notify and status come from R1. Make it say that api and status come from R1 and notify from R (keep R1's link for api and status).
   - Replace the notify bullet (line 122) with: R's link; A = notify `v0.1.0` (`c090a07`), B = notify `main` at the recorded SHA, which contains #41 (`757e78f`); the A and B medians with three decimals; the reason (accepted test work of #649 / pulse-notify#41, owner decision link); the arithmetic written out, e.g. `floor = ceil0.1(B − A + 0.2) = ceil0.1(<x>) = <f> s (cap 1.4)` and `budget = max(ceil0.1(A × 1.3), ceil0.1(B + 0.1)) = max(<p>, <q>) = <b> s (cap 3.2)`; and that both values are temporary.
   - Keep the api and status bullets unchanged. Keep the closing rule (line 126), which already says: the first api PR after the next notify `v*` tag removes notify's floor and resets its budget to ceil0.1(new A × 1.3). Its wording for api stays as is.
8. **Run V (branch validation).** After the commit with 6 and 7, dispatch `bench.yml` on the branch again in the same way as R (new `API_B`, Provenance applied again with fresh PRE and POST, including discard and one repeat, then hold). The harness reads the budgets from its own workflow checkout (`bench/run.ts:44`, `:223`), so V judges with the new values. V must be complete (as in 3) and exit 0: no failing row. V does not re-derive the values: if V fails on `notify.test_cpu_s`, hold with R's and V's samples (do not widen, do not re-run until green). If V fails on another row, hold as in 4. A harness error: one more dispatch, then hold.
9. **Run M (acceptance, after a person merges the PR).** A `Bench` run of api `main` that contains the merge commit, dispatched with default inputs (`gh workflow run bench.yml -R lorenzh/pulse-api --ref main`) after recording PRE for all seven repositories, complete, with Provenance (api B is `main` here, so api is bracketed too), and exit 0. A nightly run (02:17 UTC) counts as M only if the activity list of each repository proves exactly which `main` SHA was current at the run's start and that no push came before its `[bench] cold-read seed (b)` line; otherwise dispatch M. If M fails, hold with its samples; do not re-run until green. Its link, notify A and B medians and SHAs go into the PR as a comment. The child's build is done with V; the feature is done with M.

## Risks
- **Noise on the cap edge.** Expected values: A near 1.90 s (R1: 1.900 s), B near 2.8 to 3.2 s (R1 B 2.205 s plus 0.6 to 1.0 s). Then `floor` is about 1.1 to 1.5 s and `budget` about 2.9 to 3.3 s, so the high end of the growth hits the caps. That is a hold by design (Required 5), not a failure of the plan.
- **V fails on its own noise.** Five-sample medians of `bun run test` vary by about 0.1 to 0.3 s between hosted runs (R1 B samples of api spread 4.88 to 5.20 s). The budget keeps 0.1 s over R's B and the floor 0.2 s over R's B − A. A V failure is a hold with samples; the owner decides.
- **Refs move during a run.** notify or another `main` can move between dispatch and checkout. The harness does not log the fetched SHA (`git` output is piped, `bench/run.ts:109-118` via `runChecked`), so ancestry alone cannot name the measured commit. Provenance accepts a run only when every `main` was unchanged over the run or a push is proven to come after the B checkouts; otherwise the run is discarded and repeated once, then held (Acceptance evidence). This applies equally to R, V and M.
- **Nightly runs before the merge.** Until the PR merges, a nightly Bench on api `main` may fail only on `notify.test_cpu_s` (owner decision on #649, point 4). Another failing nightly row is a hold, not part of this change.
- **A new notify tag** between R and merge changes A. Required 1 is checked again before V; with a newer tag, hold.

## Acceptance evidence
Expected values come from literals in this spec (the formulas, the caps 1.4 and 3.2, the exit codes 0/1/2, the count of five samples, the SHAs `757e78f…` and `c090a07…`) and from run R, which is independent of the edited files: R runs before the edit, with the old budgets.

**Provenance (for each of R, V, M).** `run.ts` logs refs as given (`[bench] A: {...}`, `B: {...}`, `bench/run.ts:236-237`) and stores them unresolved in `samples.json` (`:256`); the run's `head_sha` is the workflow checkout, not the measured worktrees (`bench/run.ts:106-118`). So:
The rule is the same for R, V and M. The measured SHA of every side must be identified exactly; ancestry (PRE is an ancestor of POST) is not enough, because it does not say which commit the fetch got.
- **api B for R and V** is pinned: `API_B=$(git ls-remote https://github.com/lorenzh/pulse-api.git refs/heads/main | cut -f1)` right before the dispatch, passed as `-f b=$API_B`; the fetch of a full SHA can only give that commit, and the log line `B: {"api":"<API_B>",…}` names it. For M, `b` is left empty, so api B is `main` and is handled like the next bullet.
- **Every B side at `main`** (probe, status, notify, contract, kit, config; for M also api): record `PRE[r]` with `git ls-remote https://github.com/lorenzh/pulse-<r>.git refs/heads/main | cut -f1` right before the dispatch and `POST[r]` the same way right after the run ends. The measured B is `PRE[r]` exactly when one of these holds:
  1. `POST[r] == PRE[r]` (the ref did not change over the whole run, which contains the checkout), or
  2. independent evidence that every push to `main` during the run came after the B checkout of r: `gh api "repos/lorenzh/pulse-<r>/activity?ref=refs/heads/main&per_page=100"` lists the pushes (`before`, `after`, `timestamp`, checked to work on 2026-11-03); the first push after `PRE[r]` was read has `before == PRE[r]`, and its `timestamp` is later than the timestamp of the run-log line `[bench] cold-read seed (b)` (`gh run view <id> -R lorenzh/pulse-api --log`). That line is logged only after all B checkouts are done (`bench/run.ts:125-128` then `:136-142`).
  If neither holds for any repository (for example a push between the dispatch and that log line, or the activity list does not reach back to the dispatch), the run cannot name its measured commit: discard it, dispatch once more with fresh `PRE`, and if that run fails Provenance too, hold with both run links and the PRE/POST values.
- **notify contains #41.** For the accepted notify B, `gh api repos/lorenzh/pulse-notify/compare/757e78f27cfdbb89109c216dcba829158ea7b5c3...<PRE[notify]> --jq .status` prints `ahead` or `identical` (literal SHA from #649). Any other status: the run is not R (or V, M); hold.
- **A sides** are `v*` tags, named in the log line `A: {...}`. Record each tag's commit before the dispatch and after the run with `git ls-remote --tags https://github.com/lorenzh/pulse-<r>.git 'refs/tags/<tag>' 'refs/tags/<tag>^{}'`: the `^{}` SHA when printed (annotated), else the `refs/tags/<tag>` SHA (lightweight). Both readings must be equal and the tag in the log must be the newest `v*` tag at both times; otherwise discard and repeat once as above, then hold. Notify A must be `v0.1.0` = `c090a07811590eb158849fb9981f3c94fec74276`.
- Record the workflow checkout SHA (`gh run view <id> -R lorenzh/pulse-api --json headSha`): for R it is the branch before the edit, for V the commit with the edit, for M the merge commit or a later `main`. This SHA is the commit that `actions/checkout` builds the harness and `budgets.json` from (`bench.yml:36-38`), not a measured side.

Checks:
1. R: link, artifact link, the five A and five B samples of `notify.test_cpu_s` (unrounded), both medians, the exit code, the A/B SHAs of all seven repositories and the workflow SHA, all in the PR body. Every row other than `notify.test_cpu_s` passes (Required 4).
2. `git diff --stat origin/main` lists exactly `bench/budgets.json` and `bench/README.md`. `git diff -U0 origin/main -- bench/budgets.json` shows exactly two changed lines, the `budget` line and the `floor` line of `notify.test_cpu_s`. The new numbers equal the PR's written arithmetic from R's samples, with floor ≤ 1.4 and budget ≤ 3.2 (literals). `grep -c thresholdPct bench/budgets.json` prints `0`.
3. A reviewer recomputes the two values from R's ten samples in the artifact (not from the edited files) with the integer rule of Definitions (only A and B converted to microseconds, ceilings by `ceilDiv`) and gets the same numbers.
4. `bun run check`, `bun run bench:selftest` and `docker compose -f bench/compose.bench.yaml config --quiet` exit 0 on the branch.
5. V: complete, exit 0, link, notify medians and SHAs in the PR.
6. M (after merge): complete, exit 0 on api `main` containing the merge commit; link, notify medians and SHAs added to the PR as a comment.

## Performance impact
- `notify.test_cpu_s` (gating): the measured values do not change through this PR, because no code changes. Its gate moves: `budget` from 2.5 s to the R-derived value (expected 2.9 to 3.2 s, up), `floor` from 0.6 s to the R-derived value (expected 1.1 to 1.4 s, up). The measured growth itself, about +0.6 to +1.0 s of B against `v0.1.0`, comes from pulse-notify#41 and is already on notify `main`.
- All other metrics (startup CPU, load CPU, idle and peak RSS, build CPU, test CPU of the other services, and the reported wall-clock startup, p95 latency, rps, image size): none expected; only a JSON value and a README paragraph change, nothing that a service or test suite runs.
- How it is measured: not with a local `bun bench/run.ts --a --b` (local numbers are only comparable on one machine, `bench/README.md:79`, and notify B is always `main`, `bench/refs.ts:63-66`). It is measured by the hosted runs R, V and M of Required 2, 8 and 9.

## Security impact
Security impact: no. Only a budget number pair and documentation change; no route, parser, probe client, file write, log text, dependency, Dockerfile or CI file is touched, and the dispatched runs use the existing workflow unchanged.

## Rollout order
One repository: only pulse-api changes, and only bench data and docs that no service, package or consumer reads. pulse-notify#41 is already merged on notify `main` and needs no further change or tag. No consumer pin moves. The order inside the task is fixed: R (before the edit), edit, V, PR; then a person merges, then M.

## Counterexamples
- **Float ceil.** A = 1.88, B = 3.08: B − A + 0.2 in JavaScript floats is `1.4000000000000001`, and `Math.ceil(10 * x) / 10` gives 1.5, above the cap, so a float implementation holds wrongly. The correct floor is 1.4 (`ceilDiv(3080000 − 1880000 + 200000, 100000) = ceilDiv(1400000, 100000) = 14`), within the cap. Likewise B = 2.7: B + 0.1 is `2.8000000000000003` in floats and gives 2.9; `ceilDiv(2700000 + 100000, 100000) = 28` gives 2.8. (Both checked with `node -e`.)
- **Rounding a composite to microseconds.** A = 1.923077 s (A_us = 1923077): A × 1.3 = 2.5000001 s. Rounding the product to whole microseconds first (`Math.round(1923077 × 1.3)` = 2500000) and then taking the ceiling gives 2.5, which is wrong. The rule keeps the fraction: `ceilDiv(13 × 1923077, 1000000) = ceilDiv(25000001, 1000000) = 26`, so ceil0.1(A × 1.3) = 2.6 s. (Checked with `node -e`.)
- **Ancestry as provenance.** PRE[notify] = X before the dispatch; a merge moves notify `main` to Y while the run checks out; POST = Y, and `compare X...Y` prints `ahead`. That proves X is an ancestor of Y but not whether X or Y was measured. Without `POST == PRE` or the activity-timestamp evidence, the run is discarded (Provenance), not accepted.
- **Rounded table values.** Unrounded B 2.804 s, shown as 2.80 in the table: from the table ceil0.1(2.80 + 0.1) = 2.9, from the sample ceil0.1(2.904) = 3.0. Use the unrounded samples of `samples.json`.
- **Mean instead of median.** Samples 2.70, 2.75, 2.80, 2.85, 3.90 (one outlier): mean 3.0, median 2.80. The rule uses the median (3rd smallest), so budget = ceil0.1(2.90) = 2.9, not ceil0.1(3.10) = 3.1.
- **Cap as clamp.** R gives B = 3.15, A = 1.90: budget = max(2.5, ceil0.1(3.25) = 3.3) = 3.3 > 3.2. Writing 3.2 is wrong; hold. Same for floor: B − A = 1.25 gives ceil0.1(1.45) = 1.5 > 1.4, hold.
- **Budget alone.** Raising only `budget` and leaving `floor` 0.6 with B − A = 0.9: `judge` (`bench/compare.ts:181-188`) checks the regression rule first, 0.9 > max(0.19, 0.6), so the row still fails `FAIL regression`. Both values must change.
- **Budget from A only.** A = 1.90, B = 2.95: ceil0.1(A × 1.3) = 2.5 < B, the row fails `FAIL budget`. The max with ceil0.1(B + 0.1) = 3.1 is required.
- **`others: main`.** Pins notify A and B to `main`, so A = B and the medians differ only by noise; floor would come out near 0.2. Such a run is not R.
- **`b` only, no branch dispatch.** Dispatching on `main` with `-f b=<branch>` still reads `budgets.json` from the `main` checkout (`bench/run.ts:44`, `:223`); V must be dispatched with `--ref <branch>`.
- **Symbolic refs as evidence.** `B: {"notify":"main"}` in the log, or the run's `head_sha`, does not prove notify B contained #41. Provenance's compare check is required.
- **Re-run until green.** V fails `notify.test_cpu_s`, a second V passes, and the PR reports the second only: rejected. A gating failure of V is a hold (Required 8).
- **Other row fails.** R shows `api.test_cpu_s FAIL budget`. Raising api's budget here is wrong; hold.
- **Statistics.** Window: the five rounds of one run R, sides alternating A, B (`bench/run.ts:244-251`). Sample set: `samples.{a,b}.notify.test_cpu_s`, five values each. Percentile method: median of five = 3rd smallest after ascending sort (`bench/measure.ts:23-31`), no interpolation. Rounding: only the medians A and B become integer microseconds (exact); each formula is then rounded up to 0.1 s once, with `ceilDiv`, and no intermediate value is rounded. Medians are never averaged across runs; V and M are checks, not inputs.

## Contract fields
No new names. Only the values of the existing keys `budget` and `floor` of `notify.test_cpu_s` change; both keys already exist in api `bench/compare.ts:36-40` and `bench/budgets.json:216-221`. They are not contract or config names (`grep -rn 'test_cpu_s' .repos/contract/src .repos/config/src` prints nothing).

## Repository: api
Files:
- `bench/budgets.json`
- `bench/README.md`

Behavior change: yes. The Bench gate for `notify.test_cpu_s` changes (new budget and floor), which changes which runs pass; that is tooling behavior, not docs alone.

Tool facts (verified in the api clone at `90f605555c31bd112bedd5a8f3f26ffb4afa5050`):
- Bun 1.4.0: `package.json:8-10` (`engines`), `package.json:35` (`packageManager`); `bench.yml:39-41` and `ci.yml:28-30` set `bun-version: 1.4.0`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:20`); lint = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:16`); `bench:selftest` runs the eight `bench/selftest/check-*.ts` scripts (`package.json:18`), among them `check-budgets.ts`, which parses `budgets.json` with `parseBudgets` and checks every emitted metric has an entry (`bench/selftest/check-budgets.ts:7-10`).
- Biome 2.6.3 (`package.json:23`). `biome.json` only `extends` `@lorenzh/pulse-config/biome.json`; at the pinned ref `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`) that file includes `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures` (`biome.json:10-17`), so `bench/budgets.json` is formatted and checked by Biome (2-space indent, `biome.json:21-22`). The pinned file read with `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=04108fa…"` is identical to the config clone.
- CI: `ci.yml:17-18` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`; at that pin `check.yml:16` runs on `ubuntu-24.04`, `:22-24` Bun 1.4.0, `:25-26` `bun install --frozen-lockfile`, `:27-28` lint, `:29-30` typecheck, `:37-38` `bun run test` (build steps `:31-36` only with `inputs.build`, which api does not set). The pinned file is identical to the config clone. `ci.yml:20-33` job `bench-selftest` runs `bun run bench:selftest` and `docker compose -f bench/compose.bench.yaml config --quiet`.
- Bench workflow: `bench.yml:4-20` (nightly `17 2 * * *`, dispatch inputs `a`, `b`, `others`), `:31` `ubuntu-24.04`, `:53` `bun bench/run.ts "${args[@]}" --out bench-out`, `:54-59` uploads `bench-out` with `if: always()`.
- Harness: rounds default 5 (`bench/run.ts:76`); budgets read from the workflow checkout (`bench/run.ts:44`, `:223`); refs: api A `baseline` → newest `v*` tag, others A newest `v*` tag, B `main` (`bench/refs.ts:55-66`); worktrees by `git fetch origin <ref>` + `git worktree add --detach … FETCH_HEAD` (`bench/run.ts:106-118`); judge rule (`bench/compare.ts:181-188`), default floors `s` 0.2 (`bench/compare.ts:104`); exit 0 or 1 gating failure (`bench/run.ts:263`, returned at `:272`), exit 2 harness error (`bench/run.ts:273-275`; the file has 276 lines); the checkout's `git` output is piped, not logged (`bench/run.ts:109-118`, `runChecked` → `runCommand` with `stdout: "pipe"`, `bench/measure.ts:60-61`), so the log does not show fetched SHAs; job timeout 90 minutes (`bench.yml:32`).

Behavior:
- Follow Required behavior 1-8 in order: check the precondition, run R on the unchanged branch with Provenance, check completeness and other rows, compute the two values, hold if a cap or the B − A check trips, else edit `bench/budgets.json:217` and `:220` and the notify part of `bench/README.md:118-126`, commit, run V.
- Apply Provenance to R, V and M alike (PRE before each dispatch, POST after each run, `POST == PRE` or activity-timestamp evidence per repository, else discard and repeat once, then hold).
- Show the arithmetic as integers in the PR, e.g. `A_us = 1904000, B_us = 2836000; floor_tenths = ceilDiv(2836000 − 1904000 + 200000, 100000) = ceilDiv(1132000, 100000) = 12 → 1.2 s; p_tenths = ceilDiv(13 × 1904000, 1000000) = ceilDiv(24752000, 1000000) = 25; q_tenths = ceilDiv(2936000, 100000) = 30; budget = max(25, 30) / 10 = 3.0 s`.
- Do not edit any other line. Do not run `biome format` over other files.

Checks:
- `bun run check`, `bun run bench:selftest`, `docker compose -f bench/compose.bench.yaml config --quiet` (all exit 0).
- `git diff --stat origin/main` shows only the two files; `git diff -U0 origin/main -- bench/budgets.json` shows only the `budget` and `floor` lines of `notify.test_cpu_s`; `grep -c thresholdPct bench/budgets.json` prints `0`.
- Recompute both values from R's artifact samples (not from the edited files) and compare with the edit.

Completion evidence (PR body):
- R: run and artifact links, ten unrounded notify samples, both medians, exit code, workflow SHA, A/B SHAs of all seven repositories with the Provenance checks (PRE/POST per repository and, where they differ, the activity push and log timestamps that prove the measured SHA; notify contains `757e78f`; notify A `c090a07`; tag SHAs equal before and after), and the result of every other row (none failing).
- The arithmetic of both values with the caps.
- V: link, exit 0, notify medians, SHAs.
- A note that M (api `main` after merge) is the feature's final check and is added as a PR comment after the merge.
- On any hold: the samples, medians, arithmetic, run links and SHAs gathered so far.
