# Issue review: #652 — notify test CPU budget after the SQLite ledger

## Disposition

Ready for `plan`. No question blocks the spec. This is a bounded, measured recalibration in the `api` target, restricted to `bench/budgets.json` and `bench/README.md`. Exact replacement numbers depend on the implementation's hosted run R; they must not be estimated in the spec. The cap and unrelated-failure holds are explicit implementation gates.

## Request and earlier decisions

- Read [#652](https://github.com/lorenzh/pulse-meta/issues/652) and all its comments. Its only comment is this run's Factory claim; there are no earlier issue-review decisions.
- Read all comments on [#649](https://github.com/lorenzh/pulse-meta/issues/649), including the [owner decision](https://github.com/lorenzh/pulse-meta/issues/649#issuecomment-6594413459). The decision accepts the test CPU increase as required spec work, forbids cutting acceptance tests, and explicitly requires this follow-up after notify PR #41 merges. It specifies the same formulas, 1.4 s floor cap, 3.2 s budget cap, release cleanup rule and unrelated-failure hold as #652. The old local +0.25 s limit is superseded; do not reopen it here.
- [notify PR #41](https://github.com/lorenzh/pulse-notify/pull/41) merged at 2026-11-03 04:03:08 UTC as `757e78f27cfdbb89109c216dcba829158ea7b5c3`. The read-only notify clone is at that merge. Its SQLite ledger and tests are existing work, not implementation scope for this feature. No new notify child is needed.

## Verified repository context

Read meta `AGENTS.md`, `README.md` and the issue-review prompt, plus the api and notify `AGENTS.md` files. Inspected the clones directly; neither was edited.

| Target | Inspected HEAD | Relevant files |
| --- | --- | --- |
| api | `90f605555c31bd112bedd5a8f3f26ffb4afa5050` | `.github/workflows/bench.yml`, `.github/workflows/ci.yml`, `bench/run.ts`, `refs.ts`, `measure.ts`, `compare.ts`, `budgets.json`, `README.md`, `selftest/check-budgets.ts` |
| notify | `757e78f27cfdbb89109c216dcba829158ea7b5c3` | `src/ledger.ts`, `test/ledger-cost.test.ts`, repository instructions |

- Current `notify.test_cpu_s` is `{ budget: 2.5, unit: "s", gating: true, floor: 0.6 }`, without `thresholdPct`. Other notify rows and every other service's values are out of scope.
- README's existing "Temporary test floors" section documents notify's older hosted A/B medians (1.900/2.205 s) and temporary 2.5/0.6 values from R1. Replace the notify calibration explanation with R; preserve the other services' records and their cleanup rules.
- `bench.yml` checks out its dispatch branch and runs `bun bench/run.ts` on `ubuntu-24.04`, Bun 1.4.0. The harness defaults to five alternating A/B rounds. There is no workflow `rounds` input and no workflow change is needed.
- Default A is each repository's newest `v*` tag, falling back to `bench/baseline.json`; B is `main`. Inputs `a` and `b` affect api only. `others` pins every non-api repository to the same ref on both sides, so it must remain unset for this calibration: `others: main` would replace the release-versus-main comparison with A=B.
- The harness reads budgets from its own workflow checkout, independently of api input `b`. Merely selecting the feature branch as `b` does not load its budget changes; dispatch the workflow on the actual api implementation branch.
- `test_cpu_s` measures user plus system CPU for the complete `bun run test` command, including waited descendants. Five-sample medians are the third smallest values. Use unrounded samples for arithmetic, not the table's two-decimal display.
- A row fails when `B - A > max(A * 0.10, floor)` or B exceeds its absolute budget. The proposed formulas address both gates while retaining their meaning.
- `bench-out` is uploaded even on failure. It contains `samples.json`, `table.json` and `table.md` after a complete measurement. `samples.json.refs` stores requested symbolic refs, not resolved checkout SHAs. Successful checkout command output is captured rather than printed by `runChecked`; do not assume the artifact or workflow head SHA proves every measured repository's SHA.
- The recent Actions listing shows a successful api-main Bench [41525755478](https://github.com/lorenzh/pulse-api/actions/runs/41525755478), created 2026-11-02 21:09:30 UTC. This predates notify #41's merge and cannot satisfy R or final acceptance. This review did not dispatch a run, inspect its raw samples, or establish post-merge Bench health.

## Open points and assumptions for planning

1. **Separate measurement, branch validation and post-merge acceptance.** Run R on the api implementation branch after #41's merge, using normal baseline/main defaults and five rounds. R may fail on `notify.test_cpu_s` under the old values. Derive the values, then obtain a green hosted run from the branch checkout containing them. The required green api-main run can happen only after a person merges the implementation PR; link it back in that PR afterward. Branch green alone is not feature completion, and this feature does not authorize merging or tagging.
2. **Record exact evidence without expanding the file scope.** The implementation PR should identify the workflow checkout SHA and the A/B resolved SHAs for all measured repositories, particularly notify A's tag commit and B containing #41. Plan how to establish those SHAs alongside dispatch, for example by timestamped remote-ref snapshots bracketing preparation, with an unchanged-ref check and repository history as needed. Symbolic `main`/tag names or today's clone HEADs alone are insufficient. If refs move and the measured checkout cannot be established, obtain a new qualifying run with adequate evidence; do not change the workflow or harness to add reporting under this issue.
3. **Apply formulas exactly; caps are not clamping instructions.** Define `ceil0.1(x) = ceil(10*x)/10`. For R's notify medians A and B, set floor to `ceil0.1(B - A + 0.2)` and budget to `max(ceil0.1(A * 1.3), ceil0.1(B + 0.1))`. If either exceeds its cap, hold with all five A and B samples, medians, arithmetic, run link and SHAs. Do not substitute the cap or a guessed 3.1/1.3 pair. An unexpected result incompatible with the nonnegative budget schema also needs evidence and a hold rather than an invented formula adjustment.
4. **Check the full result, including unrelated gates.** Before and during implementation inspect applicable nightly results and every R/validation table. Any failing row other than `notify.test_cpu_s` requires a hold with evidence; no unrelated budget or code fixes belong here. A harness error or incomplete sample set does not qualify as calibration evidence or green acceptance. Surface it and obtain a complete valid run; do not hide it by weakening gates or tests.
5. **Handle the next release through documentation.** Both notify values stay explicitly temporary. The first api PR after the next notify `v*` tag must remove notify's floor and reset its budget to `ceil0.1(new A * 1.3)`. This is a documented future obligation, not automation or a release to implement now. If a notify tag arrives before calibration/merge, recheck which baseline and cleanup rule apply rather than installing stale temporary values. Preserve api's separate temporary-floor rule.
6. **Keep the implementation narrow.** Only the two named api files change. Preserve `unit`, `gating`, all existing thresholds, all other notify metrics, and all other service values. Add no `thresholdPct`, dependency changes, baseline changes, code changes or tags. No new tests are needed for two data/doc edits; run the existing checks.

## Derived acceptance check

1. A complete hosted five-round run R was dispatched from the api implementation branch after notify #41 merged, with normal baseline/main comparison and no `others` override. The PR links R and its artifacts, records five notify A samples and five B samples, their unrounded medians, workflow checkout SHA and resolved measured A/B SHAs. Notify B includes the merged ledger work. No other row fails.
2. The diff changes only api `bench/budgets.json` and `bench/README.md`. Only notify `test_cpu_s.floor` and `.budget` change in JSON. They equal R's formulas exactly, with floor <= 1.4 s and budget <= 3.2 s. All other values and gating settings are unchanged and no `thresholdPct` is added. If the bounds cannot be met, the outcome is a hold with samples, not a widened budget.
3. README "Temporary test floors" records both new notify values as temporary, R's link, medians and explicit arithmetic, and the next-notify-tag cleanup obligation. Other service documentation remains valid.
4. The api implementation passes `bun run check`, `bun run bench:selftest`, `docker compose -f bench/compose.bench.yaml config --quiet`, and diff/JSON checks. A complete hosted Bench using the updated branch checkout passes every gate without harness errors; attach its run and measurement evidence to the PR.
5. After owner merge, a complete hosted `Bench` from the updated api `main` checkout, with normal baseline/main defaults and five rounds, is green. Add its link, medians and resolved SHAs to the implementation PR. Keep final acceptance pending until this post-merge evidence exists.

Only this review artifact was written in meta. No target files, labels or issue comments were changed. The initial comment-tool argument errors were corrected and both discussions were retrieved. The unsupported connector workflow-list request was replaced by a successful read-only `gh api` listing; absent guessed paths were replaced by inspection of the actual repository files.
