# Issue review: #585 — probe and status test CPU over budget

## Disposition

Ready for `plan`. There is no blocking product decision: the issue authorizes either a measured reduction in probe test CPU or a justified budget increase, and requires a fresh status measurement before changing status. The remaining questions are investigation and implementation choices.

## Request and decisions

- Source: [pulse-meta#585](https://github.com/lorenzh/pulse-meta/issues/585). Read the issue and all comments. The sole comment is the Factory claim for this run; there are no earlier decisions or holds to carry forward.
- The goal is a successful hosted bench on API `main`, with measurements explaining the fix or revised budget in the implementation PR. This review does not run the implementation or claim that the bench is green.
- [#526](https://github.com/lorenzh/pulse-meta/issues/526) is closed as completed. Its API optimization is existing work to preserve, not work to repeat or revert. No dependency on its former PR branch is needed.

## Verified repository context

Read meta `AGENTS.md`, `README.md`, the issue-review prompt, and the API, probe and status repository instructions. Inspected the read-only clones directly:

| Target | Inspected HEAD | Relevant ownership |
| --- | --- | --- |
| `api` | `eb9d64a573429948a6167f1f9b8687bf0cd5b6bc` | Hosted `.github/workflows/bench.yml`, `bench/run.ts`, `bench/measure.ts`, `bench/compare.ts`, `bench/refs.ts`, `bench/budgets.json`, `bench/README.md` |
| `probe` | `2a19aa3e36964fdc406383b75be9d1af85a1e4c8` | Probe tests, test command and coverage configuration |
| `status` | `be41dfd75226e451c69262f835e73f89f9084e39` | Status tests, test command and coverage configuration |

There is no root `bench/` in meta. Any budget change belongs to the `api` target; service test changes belong to their service targets. Do not edit the context clones from meta.

### Hosted failure evidence

Read [run 41235464206, job 124638190832](https://github.com/lorenzh/pulse-api/actions/runs/41235464206/job/124638190832) through the GitHub job-log API. The run completed five rounds per side and its final table reports:

| Metric | A median | B median | Budget | Verdict |
| --- | --- | --- | --- | --- |
| probe `test_cpu_s` | 3.71 s | 3.71 s | 2.30 s | FAIL budget |
| status `test_cpu_s` | 2.45 s | 2.44 s | 2.40 s | FAIL budget |

Those are the only failing rows in that run; it exited 1. All API gating rows passed. The logs name API A as `21e7bdc87f207cb2f586092ae6f1a61dee6cdade` and API B as `factory/526-api-api-reads-after-each-ingest-re-aggregate-all`. For probe and status, A was requested as `v0.1.0` and B as `main`, rather than explicitly pinned to the same SHA. Their medians agree closely, consistent with the issue's statement that this was not caused by #526, but these symbolic refs alone do not prove identical commits. The current clones also postdate that run. Record resolved SHAs in new evidence rather than assuming current `main` equals the failing snapshot.

The run uploaded `bench-out` with `samples.json`, `table.json` and `table.md` ([artifact](https://github.com/lorenzh/pulse-api/actions/runs/41235464206/artifacts/13056453016)). This review read the final log table, not the raw sample artifact.

### Measurement and gates

- `bench/run.ts::measureRepoScripts` measures the full `bun run test` command for each repository. Both probe and status define that script as `bun test`; both enable coverage with an 80% line threshold in `bunfig.toml`.
- `bench/measure.ts::runCommand` uses `Bun.spawn().resourceUsage()` and sums user and system CPU time, including waited descendants. This is CPU consumption, not elapsed test duration. Child startup, coverage work and fixture generation are candidates to measure as well as timers.
- Five alternating A/B rounds are the default, and verdicts use medians. The workflow uses `ubuntu-24.04` and Bun 1.4.0. It uploads the results even after failure.
- A metric fails for either a relative regression or exceeding its absolute budget. Defaults are 10% and a 0.2 s floor for CPU seconds. Widening the relative floor cannot cure an absolute budget failure.
- `bench/README.md` requires a PR with measured A medians for budget changes, about 30% headroom and rounding up (CPU seconds to 0.1 s). The original test budgets came from a local one-round baseline, with a recommendation to reset from hosted results. Current probe/status limits remain 2.3/2.4 s.
- The harness and budget file come from the workflow checkout, independently of the API refs selected for A/B. Verification of a budget PR must execute the checkout containing that change; selecting it only as input `b` does not load its budgets.
- Default non-API A refs use the newest release tag (or baseline SHA), while B uses `main`. `others: main` / `--others-ref main` makes an A=B diagnostic for the other repositories, but does not compare an unmerged probe/status branch. Resolve and record actual refs; avoid inventing per-service workflow inputs that do not exist.

### Test investigation leads, not established causes

- Probe `src/check.domain.test.ts` has `stubBootstrap("429", 1500)` in the shared-bootstrap timeout test, with 1000/5000 ms check timeouts. Its stub calls real `setTimeout`. Other timeout tests use local stalled peers.
- Probe `src/main.test.ts` starts a fresh service child for many settings/token cases, polls with a real 20 ms timer, and has 3 s fallback termination timers. `src/tls.test.ts` generates EC certificates with `openssl` for local TLS tests. All contribute work beyond simply waiting for a timer.
- Probe TCP and DNS resolver tests also contain real delays. Scheduler and reloader tests already use injected fake timers.
- Status has process startup tests and zero-delay polling loops in cache/hidden-check integration tests. The 0.04 s B excess alone is insufficient evidence to change them or their budget.
- Probe's clone is shallow and its local log does not provide the history needed to identify the introducing commit. No CPU profiling, before/after test measurement or causal attribution was performed in this review.

## Open points and assumptions for planning

1. **Identify what raised probe CPU before choosing the remedy.** Compare the budget-setting suite/dependencies with the failing and current suite, and measure expensive files or groups under the full suite's coverage settings. Timer removal can improve wall time without materially improving this CPU metric. The plan must not present the timer hypothesis as an established cause.
2. **Choose a concrete target set from the evidence.** A budget-only fix is authorized if the repeatable cost is justified, for example by necessary test coverage. A measured test optimization uses `probe`; include `api` when changing budgets or recording bench calibration there. Include a `status` implementation only when its remeasurement warrants one. Do not create a no-op service child simply because its metric was named.
3. **Remeasure status first.** Leave its 2.4 s budget unchanged if repeated comparable measurements pass. If its median repeatedly exceeds the budget, explain the repeatable cost/variation and choose a focused test fix or a measured recalibration. Do not round the one reported 2.44 s observation into an automatic increase.
4. **Define comparable evidence.** Use Bun 1.4.0, frozen dependencies and the unchanged full coverage-enabled command. Capture at least the standard five rounds, actual repository SHAs, individual CPU samples, medians and runner details. Local profiling can locate costs; hosted results decide acceptance and budget calibration. For an increase, use a comparable A baseline for the intended suite and document the 30% headroom and rounding calculation. Do not derive a numeric replacement solely from this review's rounded historical medians.
5. **Preserve useful tests and measurement meaning.** Keep behavioral assertions, required service/HTTP integration coverage and the 80% line threshold. Use injected clocks/timers and event completion where appropriate under service instructions. Preserve production behavior; a narrow dependency seam may be specified if needed for deterministic tests. Do not disable coverage, skip costly tests, weaken gating or alter unrelated budgets merely to obtain green.
6. **Sequence cross-repository delivery.** An API workflow can benchmark merged service refs but has no per-service candidate ref input. If the remedy changes probe/status tests, the final hosted verification must run after those commits reach their `main` branches. Put dependencies and the final verification owner explicitly in the plan. A preparatory budget PR may link a qualifying hosted measurement, with the final API-main run linked once all changes land.
7. **Scope the final green check.** Assume the normal complete hosted bench, including every existing gate, rather than a filtered test-only check. Use API `main` for B and the merged affected service refs; state the A/other-ref choices. An A=B diagnostic is useful for noise but should not silently replace normal baseline regression coverage. New unrelated failures should be reported and investigated, not hidden by widening other budgets.

## Derived acceptance check

1. The implementation PR identifies the measured source of probe test CPU growth (or explains why the current necessary suite warrants recalibration) and gives reproducible before/after CPU samples and medians with commands, SHAs and runner context. A test optimization preserves behavior and coverage; a budget increase in API `bench/budgets.json` includes its measured calibration and headroom calculation.
2. Status has fresh repeated CPU measurements before any status test or budget adjustment. If it passes at 2.4 s, that limit stays; otherwise the PR supplies measured justification for its remedy too.
3. Each changed target passes its required `bun run check`. API bench changes also pass `bun run bench:selftest` and the existing Compose configuration check, as applicable. Tests and measurement gates remain enabled.
4. After any service changes and budget changes are merged, link a successful complete hosted `Bench` run from the API `main` workflow checkout with API B on `main`. Its standard five-round results show probe and status `test_cpu_s` within their retained or justified revised limits, no relative regression failure, no other gating failures and no harness errors. Retain/link `samples.json` and the table, and attach the run and measurement explanation to the implementation PR(s).

No files in target repositories, provider labels or issue comments were changed during this review. This artifact is retained for the later spec states.
