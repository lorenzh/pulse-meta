# Issue review: #761 — API test CPU bench budget

## Decision and scope

Ready for `plan`; no question blocks the spec. The implementation belongs only to
`pulse-api`. Change `bench/budgets.json` at `api.test_cpu_s.budget` and document
the measurement source in the implementation PR. No other target needs changes.

## Evidence inspected

- Read meta `AGENTS.md`, `README.md`, Factory configuration and issue-review
  prompt, plus API `AGENTS.md` and the bench files below. The read-only API clone
  is at main commit `4b3e9b1dcce5f4e362c6bc1f529375181fb49f9a`.
- [Issue #761](https://github.com/lorenzh/pulse-meta/issues/761) has one comment,
  the current Factory claim. There are no earlier decisions in its comments.
- The [owner's API PR #86 comment](https://github.com/lorenzh/pulse-api/pull/86#issuecomment-6662967513)
  dated 2026-11-05 reports an A/B comparison against API main with
  `others=main`: branch test CPU 5.88 s, main 5.92 s, existing budget 5.60 s.
  It says the remaining gating rows passed and explicitly separates this budget
  correction from that feature. PR #86 is merged.
- API `bench/budgets.json` still sets `api.test_cpu_s` to
  `{ "budget": 5.6, "unit": "s", "gating": true, "floor": 1.6 }`.
- `bench/compare.ts` uses medians and checks regression separately from the
  absolute budget. It first fails if `B - A > max(A * thresholdPct / 100, floor)`,
  then if `B > budget`. The default threshold is 10%; the API test floor is 1.6 s.
  Raising the budget alone cannot cure a genuine regression-gate failure.
- `.github/workflows/bench.yml` runs nightly and by workflow dispatch on
  `ubuntu-24.04` with Bun 1.4.0. Dispatch accepts API `a` and `b` refs and
  `others`; defaults are baseline versus main, with other repositories at their
  tags/baseline versus main. `others=main` pins other repositories to main on
  both sides.
- `bench/run.ts` loads budgets from the harness checkout, not from the API refs
  selected for A/B. It writes `samples.json`, `table.json`, and `table.md` under
  the uploaded `bench-out` artifact, and exits 1 for any failing row (2 for a
  harness error). The existing budget and comparison self-tests are available
  through `bun run bench:selftest`.

## Open points and assumptions for planning

1. **Exact value:** use the issue's 5.92 s main measurement as the stated basis.
   `5.92 * 1.10 = 6.512 s`; following the bench's convention of rounding CPU
   seconds upward to a tenth gives **6.6 s** (about 11.5% headroom). This is a
   reasonable interpretation of “about 10%,” not a new requirement for 30%.
2. **Source-run identification:** the issue and PR comment identify the
   comparison but contain no Actions run URL/ID or raw samples. The original run
   has not been independently identified in this review. During implementation,
   locate and cite it, with API A/B refs and the 5.92 s main median. If unavailable,
   obtain a fresh comparable hosted run and cite its run URL, resolved refs,
   measured main median, and resulting approximately 10% calculation. Do not
   invent a run ID or present the old measurement as a fresh measurement.
3. **Documentation conventions:** `bench/README.md` normally calls for an A
   median plus about 30% and describes the old API budget's statistical basis
   under “Temporary test floors.” This issue explicitly requests approximately
   10% over current main, so it authorizes that narrow exception. Preserve the
   historical provenance; a short note explaining the new API budget is
   appropriate if needed to keep the documentation accurate. Do not recalculate
   floors or apply the separate next-release floor-removal policy in this task.
4. **Narrow change:** leave every other JSON value unchanged, including the API
   test `unit`, `gating`, and `floor`; all services' other budgets; regression
   thresholds; baseline refs; workflow inputs/defaults; and measurement code.
   No dependency, test-suite, product-code, or shared-config change is needed.
5. **Acceptance timing:** a PR run validates the proposed budget only when the
   workflow's harness checkout includes it. Final main acceptance is a run
   after merge using the updated harness and API main on side B. An explicit
   main-versus-main run with `others=main` can isolate the unchanged-code case,
   but does not replace checking the normal nightly configuration. If another
   gating metric fails, record it rather than loosening it to satisfy this issue.
   The historical PR comment is evidence of the original problem, not proof
   that today's main already passes the other gates.

## Derived acceptance check

1. Diff the implementation against its base: the only budget/configuration
   value changed is `api.test_cpu_s.budget`, normally 5.6 -> 6.6 s using the
   supplied measurement. Check that the rest of the parsed JSON is identical.
2. The API PR names the source comparison and links its run evidence, reports
   the main median, and shows the headroom calculation and rounding. If a fresh
   measurement changes the proposed value, explain that explicitly.
3. In the implementation checkout, run `bun run bench:selftest` and
   `bun run check`, as required by API instructions. Existing checks suffice;
   no new implementation-mirroring test is needed for a single budget value.
4. Run the hosted Bench workflow with the updated harness, then verify a Bench
   run on main after merge. Retain its URL and `bench-out` evidence. The normal
   baseline-versus-main comparison must exit 0 with **all gating rows `ok`**,
   including API `test_cpu_s`, and no skipped/missing gating measurements or
   weakened regression settings. Reported-only rows need not meet their values.

## Review limits

This state inspected source and GitHub issue/PR comments; it did not run the
Docker bench or modify target repositories. The runtime skill's environment
status tool and `/etc/codex/network-policy.json` are unavailable in this runner;
GitHub connector reads succeeded. The initially absent artifact directory is
created by this artifact and is not ignored.
