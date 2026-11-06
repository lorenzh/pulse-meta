# Spec #761: api: update stale `test_cpu_s` bench budget

## Goal

The Bench workflow of `lorenzh/pulse-api` fails on the api `test_cpu_s` row even for unchanged
code: the api test suite has grown and the budget in `bench/budgets.json` (5.6 s) is below what
api `main` now measures. Re-set `api.test_cpu_s.budget` from measurements of today's api `main`,
so a main-vs-main run passes that row again, and document how the new value was derived.

## Decision this spec follows

The plan run first held with three options (issue comment of `lorenzh-factory`, 2026-11-06). The
owner chose **option (B)** (comment of `lorenzh`):

- Base the api `test_cpu_s` budget on current main: run the Bench workflow two or three times
  with `a=<main SHA>`, `b=<main SHA>`, `others=main` (full SHAs for `a` and `b`), take the highest
  B median, add about 10 %, round up to the next 0.1 s.
- New "Done when": one more main-vs-main `others=main` run shows api `test_cpu_s` as `ok`.
- Only `api.test_cpu_s.budget` changes in `bench/budgets.json`.
- In scope: update the api bullet of "Temporary test floors" in `bench/README.md` so it describes
  how the new value was derived and cites the runs.
- Do not touch the floor, `bench/baseline.json`, or any other service's rows. The nightly
  regression against `v0.1.0` and the other failing rows are out of scope and tracked separately.

This replaces the 6.6 s value of `.factory/work/761/issue-review.md` (open point 1), which was
based on the 2026-11-05 measurement, and replaces its acceptance check 4 (nightly
baseline-versus-main all `ok`), which the owner moved out of scope.

## Evidence (current behavior)

- api clone at `main` `4b3e9b1dcce5f4e362c6bc1f529375181fb49f9a`.
- `bench/budgets.json` lines 23-28: `"test_cpu_s": { "budget": 5.6, "unit": "s", "gating": true,
  "floor": 1.6 }` under `api`.
- `bench/compare.ts` `judge()`: a gating row fails `FAIL regression` when
  `b - a > max(a * thresholdPct / 100, floor)` (default `thresholdPct` 10, api test floor 1.6 s),
  then `FAIL budget` when `b > budget` (strictly greater). `buildRows()` uses `median()` of the
  per-round samples of each side.
- `bench/measure.ts` lines 23-32: `median()` sorts and takes the middle value; with an odd count it
  returns that sample unchanged. `bench/run.ts` line 76 defaults `--rounds` to 5, and
  `bench.yml` line 53 passes no `--rounds`, so a hosted median is the 3rd smallest of five samples,
  that is, one measured sample.
- Precision of `test_cpu_s`: `bench/measure.ts` lines 68-70 compute `cpuSeconds` as
  `(Number(usage.cpuTime.user) + Number(usage.cpuTime.system)) / 1e6` from Bun's
  `resourceUsage()` (integer microseconds). `bench/run.ts` lines 165-166 record that value
  unrounded, `bench/compare.ts` lines 213-223 keep the median unrounded, and `bench/run.ts` line 257
  writes it with `JSON.stringify` (shortest round-trip decimal). So a `b` value in `table.json` is
  an integer number of microseconds divided by 10^6, for example `5.042317`, **not** a multiple of
  0.01 s. The "resolution of 10 ms" in `bench/README.md` line 36 covers only the `/proc/1/stat`
  numbers of the running services (startup and load CPU), not `test_cpu_s`. Only `table.md`
  rounds, to two decimals (`bench/compare.ts` line 237), so the budget must not be computed from
  `table.md`.
- `bench/run.ts` lines 225-258: the harness loads `budgets.json` from its own checkout (the
  workflow's ref), resolves refs (logged as `[bench] A: …` / `[bench] B: …`), runs 5 rounds per
  side alternating A, B, and writes `table.json` (array of rows `{ service, metric, a, b, budget,
  verdict }`), `samples.json` (`{ refs, samples }`) and `table.md` to `bench-out/`, uploaded as
  the `bench-out` artifact. Exit 1 = a gating failure (tables are written), exit 2 = harness error.
- `.github/workflows/bench.yml` lines 7-20: `workflow_dispatch` inputs `a`, `b`, `others`;
  line 31 `runs-on: ubuntu-24.04`; line 53 `bun bench/run.ts "${args[@]}" --out bench-out`;
  concurrency group `bench` without cancelling, so dispatched runs queue.
- Earlier Factory children dispatched this workflow on their branches (for example run
  41586621885 on `factory/654-…`, run 41606716663 on `factory/657-…`), so a child can dispatch it.
- Recent hosted numbers for api `test_cpu_s` (from the plan hold comment, run pages on
  `lorenzh/pulse-api`): run 42056398988 (2026-11-05, a `fb6f1a5`, b `a710d16`, others=main) A
  5.88 s, B 5.92 s; run 42173433280 (2026-11-06, a `32704fd`, b `d265452`, others=main) 7.60 s and
  8.35 s; nightly 42195136982 (main `4b3e9b1`) B 8.67 s against A (`v0.1.0`) 4.17 s. The same
  runs show test CPU of unchanged repositories varying by 20-35 % between days, so runner speed
  varies. Expected new budget on these numbers: roughly 9.5-9.6 s; the real value comes only from
  the runs of this task.
- `bench/README.md` line 100 ("Changing a budget"): a budget is normally the A median plus about
  30 %. Line 123: the api bullet of "Temporary test floors" derives 5.6 s and the 1.6 s floor from
  four runs (meta #654). This feature is an owner-approved exception: B median plus about 10 %.
- Findings branch `factory/findings/761`: HTTP 404, no shared findings.

## Scope

- api repository only: one value in `bench/budgets.json`, the api bullet of "Temporary test
  floors" in `bench/README.md`, plus the hosted Bench runs that produce and confirm the value.

## Non-goals

- No change to `api.test_cpu_s.floor` (1.6), `unit`, `gating`, `thresholdPct` (absent).
- No change to any other metric of api, or to any row of probe, status, notify, contract, kit,
  config.
- No change to `bench/baseline.json`, `bench/*.ts`, `bench/selftest/`, `.github/workflows/`,
  `package.json`, tests, or product code.
- No release tag, no fix of the nightly `FAIL regression` of api `test_cpu_s` against `v0.1.0`,
  and no fix of api `startup_cpu_ms`, probe `test_cpu_s`, or the status/notify/kit rows. If those
  rows fail in any run of this task, record them in the PR; do not loosen them.
- No attempt to shrink the api test suite.

## Required behavior

1. **Measurement runs.** Read the full SHA of api `main` at the start of the task
   (`gh api repos/lorenzh/pulse-api/commits/main --jq .sha`) and call it `M`. Dispatch the Bench
   workflow on ref `main` three times (two are acceptable only if a third cannot complete; say so
   in the PR):
   `gh workflow run bench.yml -R lorenzh/pulse-api --ref main -f a=<M> -f b=<M> -f others=main`.
   All measurement runs use the same `M`. A run counts only when it completed the harness (exit 0
   or 1, a `bench-out` artifact with `table.json`); a run that exits 2 or is cancelled does not
   count and is replaced. Its `FAIL budget` on api `test_cpu_s` (against the old 5.6 s) is
   expected and does not invalidate it.
2. **Value.** From each counted run, take the `b` field of the `table.json` row with
   `service == "api"` and `metric == "test_cpu_s"` (the B median in seconds, at the full precision
   of `table.json`; never the two-decimal `table.md`). Statistic, exactly:
   - Sample set: the 5 B samples of api `test_cpu_s` of one run; its median is the 3rd smallest
     (`bench/measure.ts` `median()`), as written in `b`.
   - Convert each run's `b` to integer microseconds `u = Math.round(b * 1e6)` and check
     `Math.abs(b * 1e6 - u) < 1e-3`. If that check fails, the value is not a whole number of
     microseconds, which the harness does not produce with 5 rounds: request a hold
     (`needs-input`) with the value instead of guessing.
   - `U` is the largest `u` over the counted runs (the maximum, not the mean).
   - The budget in tenths of a second is `T = ceil(11 * U / 10^6)`, computed exactly in integers:
     `T = (11n * U + 999999n) / 1000000n` with BigInt. The budget is `T / 10` s, written as the
     JavaScript number `Number(T) / 10` prints it (for example `9.6`; `10` for `T = 100`).
   - No rounding or truncation happens before this last step: the result is the highest B median
     × 1.10 rounded up to the next 0.1 s, unchanged when that product already is a multiple of
     0.1 s.

   Reference computation, with `B` set to the largest `b` of the counted runs:
   `B=<b> bun -e 'const u = BigInt(Math.round(Number(process.env.B) * 1e6)); console.log(Number((11n * u + 999999n) / 1000000n) / 10)'`.
3. **`bench/budgets.json`.** Set `api.test_cpu_s.budget` to that value. Nothing else in the file
   changes; formatting stays as Biome writes it.
4. **`bench/README.md`.** Rewrite the api bullet of "Temporary test floors" (line 123) so it says:
   the floor 1.6 s keeps its derivation from the four runs of meta #654 (keep that text and its
   run ids); the budget was 5.6 s from that derivation and is now re-set by the owner decision in
   https://github.com/lorenzh/pulse-meta/issues/761 to ceil0.1(highest B median × 1.1) over the
   main-vs-main runs, with each run's URL, the api SHA `M`, `others=main`, each B median, the
   maximum, the calculation and the result. Mention that this is an exception to the 30 % rule of
   "Changing a budget" and that the value is temporary. Leave the notify and status bullets, the
   introductory paragraph and the closing paragraph about release tags unchanged.
5. **PR description.** Name each measurement run (URL, `a`/`b` SHA, `others`), its api
   `test_cpu_s` A and B medians (full precision from `table.json`), the maximum B median, the
   calculation and the new value. Name the pre-merge confirmation run of Required behavior 6
   (URL, branch head SHA, `a`/`b` = `M1`, the api `test_cpu_s` row). State that this follows
   option (B) of meta #761. List any other failing rows seen in those runs as out of scope. Add a
   "Post-merge acceptance" section with the command and expected verdict of Required behavior 7,
   addressed to the person who merges. Keep `Closes lorenzh/pulse-meta#<child>`.
6. **Pre-merge confirmation run (task completion).** The harness reads `budgets.json` from the
   workflow's own checkout (`bench/run.ts` line 223, `join(BENCH_DIR, "budgets.json")`), so a run
   dispatched on the task branch checks the new budget against api `main` before the merge.
   Commit the two files, push the task branch, read api `main` again as `M1` (equal to `M` unless
   main moved), and dispatch once:
   `gh workflow run bench.yml -R lorenzh/pulse-api --ref <task branch> -f a=<M1> -f b=<M1> -f others=main`.
   The branch head at dispatch must be the commit with the new budget (check `headSha` with
   `gh run view <id> --json headSha`). This run is separate from the measurement runs and is not
   used to compute the value. Its `table.json` row api `test_cpu_s` must have
   `verdict == "ok"` and `budget` equal to the new value. Precedent: the child of meta #654
   pushed `factory/654-…` and dispatched run 41586621885 on it at its PR head `8df8bf2` before it
   opened PR #80. If the verdict is not `ok`, request a hold (`needs-input`) with the row; do not
   raise the budget again on your own and do not touch the floor.
7. **Post-merge acceptance (owner, not the task).** Factory's `build` ends when the PR is opened,
   and a person merges it (meta `AGENTS.md`, "How a feature flows", steps 4-5), so the
   implementer cannot run anything after the merge. The owner's "Done when" run belongs to the
   person who merges the api PR (the repository owner `lorenzh`). The PR description hands it
   over with the exact command: after the merge, read the new api `main` full SHA `M2` and run
   `gh workflow run bench.yml -R lorenzh/pulse-api --ref main -f a=<M2> -f b=<M2> -f others=main`.
   The `table.json` row api `test_cpu_s` must show `verdict == "ok"`. The person posts the run URL
   and that row on meta #761. If it is not `ok`, that is a new issue (runner variance or a grown
   test suite), not a reopened task.

## Performance impact

No measured value moves: the change edits a budget value and documentation, not code that the
bench measures. What changes is a gate threshold:

- `api.test_cpu_s` (test CPU, gating): budget rises from 5.6 s to the value of Required behavior
  2, expected about 9.5-9.6 s (+70 %). The row's measured value stays what api `main` already
  measures (about 7.6-8.7 s in recent runs). The regression check (`B - A > max(0.1 A, 1.6 s)`) is
  unchanged.
- Startup CPU, load CPU, idle/peak RSS, build CPU, cold/eod CPU and the reported metrics
  (wall-clock startup, p95 latencies, rps, image size): none expected, no code changes.

Measured by the hosted runs of Required behavior 1, 6 and 7 (`bench.yml` on `ubuntu-24.04`), not by a
local run: the budget must match the hosted runner, and `bench/README.md` says local numbers are
comparable only on one machine.

## Security impact

Security impact: no
The change edits one number in `bench/budgets.json` and a README paragraph; it touches no admin
route, parser or validator (`parseBudgets` is unchanged), probe client, file write, log text,
dependency, Dockerfile or CI workflow.

## Rollout order

One repository: only `lorenzh/pulse-api` changes, and `bench/budgets.json` is read only by the
bench harness of that repository's own checkout. No other repository pins or reads it, and no
service behavior changes.

## Counterexamples

- **Full precision, not centiseconds.** Highest B median `7.000001` s (`U = 7000001` µs):
  `11 × 7000001 = 77000011`, `ceil(77.000011) = 78`, so the budget is 7.8 s. Truncating or
  rounding the median to centiseconds first (7.00 s, then `ceil(77.00) = 77`) gives 7.7 s, which
  is below `7.000001 × 1.1 = 7.7000011` s and therefore wrong. Likewise `9.090910` s gives
  `ceil(100.00001) = 101`, 10.1 s; truncating to 9.09 s gives `ceil(99.99) = 100`, 10 s, which is
  wrong.
- **Taking the value from `table.md` is wrong.** `table.md` prints two decimals
  (`bench/compare.ts` line 237); `7.000001` appears as `7.00` and leads to the 7.7 s error above.
- **Rounding up, exact case.** Highest B median `7` s (`U = 7000000`): `ceil(77000000 / 10^6) =
  77`, so the budget is 7.7 s. The float computation `Math.ceil(7 * 1.1 * 10) / 10` gives 7.8 s
  (`7 * 1.1` is `7.700000000000001` in JavaScript) and is wrong.
- **Rounding up, inexact case.** `8.674321` s (`U = 8674321`): `11 × 8674321 = 95417531`,
  `ceil(95.417531) = 96`, budget 9.6 s. Rounding to nearest (9.5 s) is wrong.
- **Non-integer microseconds.** A `b` of `8.6743215` (`b × 1e6` is 0.5 away from an integer)
  fails the integer check of Required behavior 2 and leads to a hold, not to a guessed value.
- **Highest, not mean.** B medians `8.351204`, `8.674321`, `8.102977` s: use `8.674321` s (budget
  9.6 s), not the mean `8.376167` s (which would give `ceil(92.137837) = 93`, 9.3 s).
- **Medians, not samples.** A run with B samples 8.1, 8.3, 8.4, 8.9, 9.4 s has B median 8.4 s (3rd
  smallest of five). Using its largest sample 9.4 s, or the mean 8.62 s, is wrong.
- **B, not A.** Use the `b` field. The README's usual rule (A median + 30 %) does not apply here.
- **Wrong runs.** A run with `a` ≠ `b`, with `others` unset (other repositories at tags vs main),
  with a short ref instead of the full SHA `M`, or a run that exited 2 does not count.
- **Nothing else moves.** A diff that also changes `api.test_cpu_s.floor` (1.6), the probe
  `test_cpu_s` budget (2.3), `bench/baseline.json`, or any other value must be rejected by the
  acceptance check below.
- **Budget comparison is strict.** In a confirmation run, a B median equal to the new budget is
  `ok` (`judge` fails only on `b > budget`); a B median 1 µs above it is `FAIL budget`.
- **Confirmation on the wrong ref.** A pre-merge confirmation dispatched on ref `main` (old
  budget 5.6 s) or on a branch head that lacks the commit with the new budget checks the old
  value and does not count; nor does a measurement run reused as the confirmation.
- **Regression check still applies.** A main-vs-main run whose `b - a` exceeds
  `max(0.1 × a, 1.6 s)` is `FAIL regression` regardless of the budget; that is runner noise and
  goes to a hold, not to a wider floor.

## Contract fields

No new names. The change sets the existing key `budget` of the existing entry `api.test_cpu_s`;
no key, metric, field or route is added or renamed (`METRIC_KEYS` in `bench/compare.ts` and
`parseBudget()` already accept it). Nothing in the contract or config clones refers to bench
budgets: `grep -rn 'test_cpu_s' .repos/contract/src .repos/config` finds no match.

## Repository: api

Files:
- `bench/budgets.json` (change: `api.test_cpu_s.budget` only)
- `bench/README.md` (change: the api bullet of "Temporary test floors")

Behavior change: yes
The gate threshold of the Bench workflow for api `test_cpu_s` changes from 5.6 s to the measured
value.

If the hosted runs show that `api.test_cpu_s.budget` on `main` already is at least the value of
Required behavior 2 (someone re-set it), request a hold instead of a review.

### Task

One final task. Follow Required behavior 1-6 above: dispatch the measurement runs, compute the
value, edit the two files, push the task branch, dispatch the pre-merge confirmation run on it,
and write the PR description with the post-merge handoff of Required behavior 7. The task ends
before the merge; Required behavior 7 is the owner's step, not part of this task. Waiting for
runs: each run takes about 40 minutes and runs queue in the `bench` concurrency group
(`.github/workflows/bench.yml` lines 25-27, no cancelling), so four runs take about three hours;
the nightly at 02:17 UTC (line 6) can queue in between.

### Tool facts

- Bun 1.4.0: `package.json` line 35 `"packageManager": "bun@1.4.0"`; `.github/workflows/bench.yml`
  and `.github/workflows/ci.yml` (`bench-selftest` job) pin `bun-version: 1.4.0`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json` line 20);
  `lint` = `biome check . && pulse-eslint . && pulse-workflows` (line 16); Biome
  `@biomejs/biome` 2.6.3 (line 23).
- `biome.json` only `extends` `@lorenzh/pulse-config/biome.json`. At the pinned config ref
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json` devDependency, `ci.yml` line 18),
  `biome.json` lines 8-17 include `"**"` except `dist`, `node_modules`, `bun.lock`, `*.html`,
  `test/fixtures`, so `bench/budgets.json` is formatted and checked by Biome (2-space indent,
  line 22-23). The pinned file is identical to the config clone (`bc87049`).
- CI: `ci.yml` line 18 `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`, whose
  steps at that ref are lint (line 28), typecheck (line 30) and test (line 38), identical to the
  config clone; `ci.yml` line 32 runs `bun run bench:selftest` and line 33
  `docker compose -f bench/compose.bench.yaml config --quiet`.
- `bench:selftest` (`package.json` line 18) includes `bench/selftest/check-budgets.ts`, which
  parses `budgets.json` with `parseBudgets` and checks that every emitted metric has a budget.
- No CI job runs the Bench workflow on a pull request; it runs nightly and by dispatch only
  (`bench.yml` lines 3-20).

### Checks

1. `bun run bench:selftest` and `bun run check` pass in the implementation checkout (expected:
   exit 0; `check-budgets: ok` printed).
2. Only one value changed. With the base `main` at `B0` and the PR head at `H`:
   `diff <(git show B0:bench/budgets.json | jq -S 'del(.api.test_cpu_s.budget)') <(git show H:bench/budgets.json | jq -S 'del(.api.test_cpu_s.budget)')`
   prints nothing; `git show B0:bench/budgets.json | jq .api.test_cpu_s.budget` prints `5.6`;
   `git diff --name-only B0 H` lists exactly `bench/README.md` and `bench/budgets.json`.
3. The new value is recomputed from the run artifacts, not from the file: for each run cited in
   the PR, `gh run download <id> -R lorenzh/pulse-api -n bench-out` and
   `jq '.[] | select(.service=="api" and .metric=="test_cpu_s") | .b' table.json`; take the
   maximum, apply the integer computation of Required behavior 2 (reference `bun -e` line), and
   compare with `jq .api.test_cpu_s.budget bench/budgets.json` at `H`. They must be equal. Also
   `jq -c '[.refs.a.api, .refs.b.api]' samples.json` must show the same full SHA `M` on both
   sides, and the run's log line `[bench] A:` must show `others` at `main`.
4. Pre-merge confirmation: for the run of Required behavior 6, `gh run view <id> -R
   lorenzh/pulse-api --json headBranch,headSha` shows the task branch and `H` (or a later head
   whose `bench/budgets.json` equals `H`'s); its downloaded `table.json` row api `test_cpu_s`
   has `verdict` equal to the literal `"ok"` and `budget` equal to the value from Check 3 (an
   independent source: the measurement runs' artifacts); `samples.json` shows `M1` on both
   sides.
5. `git diff B0 H -- bench/README.md` changes only the api bullet of "Temporary test floors"; it
   names every run id cited in the PR and the new value, and keeps the 1.6 s floor derivation and
   run ids 41508721559, 41517811504, 41525755478, 41578638886.

### Completion evidence

All of it exists before the merge; nothing in the task's completion waits for the merge.

- Checks 1-5 pass.
- The PR with the measurement runs, medians, calculation and value (Required behavior 5).
- The pre-merge confirmation run of Required behavior 6, named in the PR: its URL, branch head
  SHA, and the `table.json` row of api `test_cpu_s` with `verdict` `"ok"` (literal expected value)
  and `a` and `b` refs equal to `M1`.
- The PR's "Post-merge acceptance" section with the exact command of Required behavior 7 for the
  person who merges.

## Risks

- **Runner speed varies by 20-35 % between days.** A budget of max + 10 % over three runs of one
  day can still fail on a slower day. Accepted by the owner (option B); a later failure goes to a
  new issue, not to this one.
- **api `main` moves during the task or before the merge.** A merge that grows the test suite
  between the measurement runs and a confirmation run can push it over the new budget. The
  measurement runs all use `M`. If the pre-merge confirmation at `M1` fails, the task holds with
  both SHAs. If the owner's post-merge run at `M2` fails, the owner opens a new issue.
- **Post-merge acceptance is a person's step.** Factory does not run after the merge, so the
  owner's "Done when" depends on the person who merges running Required behavior 7. The pre-merge
  confirmation (same harness change, same `a`/`b`/`others` shape) makes a post-merge failure
  unlikely unless `main` or the runner speed changed in between.
- **Other rows fail.** With `others=main`, rows outside scope (probe `test_cpu_s` 2.32 s vs 2.3 s
  in the last nightly) can fail and make the workflow conclude `failure`. The "Done when" only
  requires the api `test_cpu_s` row to be `ok`; the PR lists the other failures.
- **The nightly still fails** on api `test_cpu_s` `FAIL regression` against `v0.1.0`
  (B - A ≈ 4.5 s above the 1.6 s floor). Out of scope by the owner decision.

## Acceptance evidence

- **Task completion (implementer, before merge):** the pre-merge confirmation run on the task
  branch (Required behavior 6, Check 4), dispatched with `a` = `b` = the full SHA of api `main` and
  `others=main`, shows api `test_cpu_s` with verdict `ok` in its `table.json`. The expected verdict
  `ok` is a literal. The budget it checks against is computed from the earlier, separate
  measurement runs (Check 3).
- **Feature done (owner, after merge):** the owner's "Done when": one Bench run on api `main`
  after the merge, dispatched with `a` = `b` = the full SHA of api `main` and `others=main`, shows
  api `test_cpu_s` with verdict `ok` in its `table.json` (literal expected value). The person who
  merges the api PR runs it with the command in the PR (Required behavior 7) and posts the run
  URL and the row on meta #761.
