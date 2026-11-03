# Spec #660: kit failure limiter bound with a clock that runs backwards

## Goal

The failure limiter in pulse-kit (`src/failure-limiter.ts`) promises at most
`2 × (maxKeys + 1) × limit` evaluated failures in any interval of `windowMs` ms. That promise is
proven only for a clock that does not go backwards. With a clock that rolls back right after a
cleanup, the limiter admits more (10 against a bound of 8 in the reproduction below). This spec
makes the docs state the assumption ("valid while `now()` does not decrease") and pins the known
limit with a regression test. Runtime behavior does not change.

## Decision: qualify the bound, no clamp

The issue allows two options. This spec picks the second: qualify the bound and the docs.

- A monotonic clamp (`now` = largest value seen so far) does not keep the bound in raw epoch time
  for a general non-monotonic clock. It only fixes the reported trace. Reproduced on kit
  `c6d2cba7d90c981b884dcac2a9288dd9eccad8b5` with Bun 1.4.0, with the clamp put into the injected
  `now` (`now: () => (m = Math.max(m, t))`) and `limit 2`, `maxKeys 1`, `windowMs 60000`: attempts
  `a, b` at raw 0, then three times "jump to `i × 120000`, `check`, roll back to raw `i`, attempt
  `a, a, b, b`" (i = 1, 2, 3). Admitted raw timestamps: `[0,0,1,1,1,1,2,2,2,2,3,3,3,3]`, so
  14 failures in `[0, 60000)` against the bound of 8. Each forward jump ends the windows, and the
  clamped time never lets them come back. So a clamp would replace one counterexample with another
  and would still need the same qualified docs.
- Qualifying the docs keeps all current behavior. This includes the cleanup-order fix for rollbacks
  from #656 / pulse-kit#6 (the re-sort of `own` in `recordFailure`) and the clamp of
  `retryAfterMs` to `1..windowMs`. Both stay as they are.
- The issue review (`.factory/work/660/issue-review.md`) recommends this option. No earlier
  decision in the issue comments says otherwise.

## Scope

- kit: qualify the bound in the module comment of `src/failure-limiter.ts` (and so in the
  generated `dist/failure-limiter.d.ts`) and in the failure limiter section of `docs/index.md`.
  Add one regression test with a fake clock that rolls back after a cleanup.
- api: `docs/operation.md` repeats the same unconditional bound for the admin auth throttle
  (`200 020` per 60 000 ms, line 301). Qualify it the same way. pulse-api passes `Date.now`, which
  can step backwards (manual clock change, NTP step), so the assumption matters to operators.

## Non-goals

- No change to runtime code, exports, signatures, option validation, routing, capacity, overflow
  recovery, `retryAfterMs` or `clientKeyOf`.
- No clamp and no monotonic clock inside the limiter. No timers, no I/O, no dependency.
- No new bound for a non-monotonic clock. The docs name the assumption; they do not give a number
  for clocks that go backwards.
- No kit pin bump in api: the api change is docs only and is true for the current pin.
- Concurrent outstanding checks, a clock change between `check` and `recordFailure`, and invalid
  clock values (NaN) stay undefined, as today.
- The approved spec of #558 is history and is not rewritten.

## Required behavior

1. kit module comment (`src/failure-limiter.ts`, the "Bound:" paragraph, lines 17-20 today):
   - keeps the existing condition (record only after a check that was not blocked) and the
     unchanged formula `2 × (maxKeys + 1) × limit` with "factor 2";
   - states that the interval bound is valid while `now()` does not decrease (the words
     "does not decrease" appear);
   - says in one or two short sentences why: a clock that goes back after windows ended reopens
     budgets at earlier times, and ended windows are not restored, so one interval of epoch ms can
     hold more evaluated failures;
   - says that the per-window count (at most `limit`), the table size (at most `maxKeys + 1`
     windows) and `retryAfterMs` in `1..windowMs` hold for any clock.
2. kit `docs/index.md`, "Bound:" paragraph of "Failure limiter (`failure-limiter.ts`)" (lines
   156-159 today): the same statements as item 1, in the same plain style. The README of kit holds
   no limiter bound (it only links `docs/index.md`, `README.md:7`), so it does not change.
3. kit `dist/failure-limiter.d.ts`: regenerated with `bun run build`, never edited by hand. The
   module comment is emitted there, not in `dist/failure-limiter.js`, so `dist/failure-limiter.js`
   stays byte-identical.
4. kit test: one new test in `test/failure-limiter.test.ts`, inside the existing
   `describe("createFailureLimiter after a backward clock jump", ...)`. Its name says it is the
   documented limit outside the assumption, for example
   `"interval bound assumes a nondecreasing clock: rollback after cleanup admits 10, bound 8"`.
   It runs the fixture in "Counterexamples" with a fake clock, asserts each step, and asserts that
   the count in `[59999, 119999)` is exactly 10 and greater than the literal 8. A short comment
   says the test pins a known limit, not a guarantee, and points at the docs.
5. api `docs/operation.md`, "Bound:" bullet of "Admin auth throttle" (line 301): keep the numbers
   (10 per window, 10 001 live windows, `200 020`, factor 2, "not 100 010") and add that the bound
   holds while the system clock does not go backwards. A backward clock step (a manual change or an
   NTP step) after windows ended can let more failures through in that 60 000 ms. The per-client
   limit and the `429` answer still apply.

## Risks

- A test expecting 10 could read like an accepted bug. Mitigation: name and comment it as the
  documented limit outside the assumption; the docs say the same.
- A later change that clamps the clock makes this test fail (with the clamp, the same trace gives
  6). That is wanted: such a change must update the docs and the test together.
- The doc text could promise too much ("any clock") or too little (drop the factor 2). Acceptance
  checks below pin both the old formula and the new wording.
- `dist/` out of date. The smoke test (`test/smoke.test.ts:30`) and the CI step
  `git diff --exit-code -- dist` catch it.

## Performance impact

None expected: the change is comments, Markdown and one kit test. No runtime code in kit or api
changes, so none of `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`,
build CPU or the reported metrics (wall-clock startup, p95 latency, requests per second, image
size) in `api/bench/budgets.json` can move. The new kit test adds about 20 limiter calls; it does
not run in api's `test_cpu_s`, and its cost in kit's test time is far below noise. No A/B run is
needed.

## Security impact

Security impact: no
The change edits docs and comments and adds a test. It changes no code path of the admin auth
throttle, no parser, no dependency, no Dockerfile and no CI. It documents a limit that exists today.

## Rollout order

Two repositories, no order between them. Each step is true and passes its checks without the other.

1. kit: docs, comment, regenerated `dist/failure-limiter.d.ts` and the test. No export or runtime
   change, so every consumer (probe, api, status, notify, console) on the old pin
   `c6d2cba7d90c981b884dcac2a9288dd9eccad8b5` or older keeps working unchanged. No consumer needs
   a pin bump.
2. api: docs only. It describes the behavior of the kit pin it already uses
   (`api/package.json:32`, `c6d2cba…`); that behavior is the same before and after step 1.

## Counterexamples

Statistic: "evaluated failures in an interval" is the number of `recordFailure(key)` calls that
directly follow a `check(key)` that returned `{ isBlocked: false }` at the same fake-clock value,
counted by the raw value of the fake clock (epoch ms) at that call, in the half-open interval
`[s, s + windowMs)`. A `check` with no following `recordFailure` (a cleanup check) counts nothing.
No rounding; it is an integer count.

Fixture (limit `2`, maxKeys `1`, windowMs `60000`). An "attempt" is `check(key)`, assert
`{ isBlocked: false }`, then `recordFailure(key)` at the same clock value.

| Step | Fake clock | Operation, in order | Expected result |
| --- | --- | --- | --- |
| 1 | 0 | attempt `a`, attempt `b` | both admitted (own window for `a`, overflow for `b`) |
| 2 | 59999 | attempt `a`, attempt `b` | both admitted; both windows now hold 2 |
| 3 | 60000 | `check("cleanup")` | `{ isBlocked: false }`; both windows end |
| 4 | 59998 | `check("rollback")` (rollback by 2 ms) | `{ isBlocked: false }` |
| 5 | 59999 | attempt `a`, `a`, `b`, `b` | all four admitted |
| 6 | 119999 | `check("cleanup")` | `{ isBlocked: false }`; both windows end |
| 7 | 119997 | attempt `a`, `a`, `b`, `b` (rollback by 2 ms) | all four admitted |

- Expected admitted timestamps: `[0, 0, 59999, 59999, 59999, 59999, 59999, 59999, 119997, 119997, 119997, 119997]`.
- Expected count in `[59999, 119999)`: `10` (2 from step 2, 4 from step 5, 4 from step 7).
- Bound for a nondecreasing clock: `2 × (1 + 1) × 2 = 8`. The test asserts `10 > 8`.
- The fixture has two 2 ms rollbacks, each after a cleanup check, and step 5 moves forward 1 ms
  after the first rollback. Docs and test must not call it a single rollback.
- Source of the expected values: literals written in this spec, from a reproduction run outside
  the test file. The issue review ran it, and this plan ran it again on kit
  `c6d2cba7d90c981b884dcac2a9288dd9eccad8b5` with Bun 1.4.0 (output
  `[0,0,59999,59999,59999,59999,59999,59999,119997,119997,119997,119997] 10`). The test must
  hard-code these literals and must not compute them from the limiter or a model of it.

Wrong implementations or texts that the checks must reject:

- A test that counts with a closed interval `[59999, 119999]` gives the same 10 here, because the
  only event at 119999 is a cleanup check. A test that counts `check` calls instead of recorded
  failures gives a larger number. Both are wrong; count only admitted attempts, half-open.
- A test that asserts `≤ 8` for this trace fails on unchanged code. The issue allows that only with
  a runtime fix, which this spec does not make.
- A limiter with a monotonic clamp gives 6 for this trace, so the new test fails (expected 10).
  This is wanted; see "Decision" for why a clamp is not adopted.
- A doc text that drops the factor 2 or changes the formula is wrong for a nondecreasing clock. The
  existing test `"global bound: fixed windows can count twice in one interval"` (5 in
  `[59999, 119999)` with limit 2, maxKeys 1) and the scripted run (worst interval `≤ 18`) must keep
  their expectations unchanged.
- A doc text that says the bound holds "for any clock" or does not name the assumption is wrong.
  The step 7 result disproves it.

## Contract fields

No new names. The change adds no field, key, export, setting, metric or route; it only edits
prose and adds a test. Searches showing that the doc wording touches no existing contract or config
name are not needed, because no name is introduced (`grep -rn 'does not decrease' .repos/contract/src .repos/config`
finds nothing and needs to find nothing).

## Repository: kit

Files:
- `src/failure-limiter.ts` (module comment only, lines 17-20 today)
- `dist/failure-limiter.d.ts` (regenerated by `bun run build`)
- `docs/index.md` (the "Bound:" paragraph of "Failure limiter (`failure-limiter.ts`)", lines 156-159 today)
- `test/failure-limiter.test.ts` (one new test)

Behavior change: no
Only a comment, the generated declaration comment, docs and a test change; no runtime code changes.

Behavior: items 1-4 of "Required behavior". Write the test first and watch it pass on the
unchanged code: it pins existing behavior, so it is green from the start. The kit `AGENTS.md`
rule "a bug fix starts with a test that reproduces the bug" is met by the test reproducing the
documented limit. Use the existing `attempt`-style helper or a local closure with a fake clock
(`let t`; `now: () => t`), as the tests in the same file do; no real clock. Do not change the
expectations of any existing test.

Tool facts (verified at kit `c6d2cba7d90c981b884dcac2a9288dd9eccad8b5`):
- Bun 1.4.0: `package.json:8` (`engines.bun`) and `package.json:49` (`packageManager`).
- `bun run check` = lint, build, typecheck, test: `package.json:39`. Lint is
  `biome check . && pulse-eslint .` (`package.json:36`), Biome `2.6.3` (`package.json:42`).
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned at
  `51e95b0eb463b27a196a33b428607bd92443e4f0` (`package.json:43`). The pinned `biome.json`
  (read with `gh api .../contents/biome.json?ref=51e95b0…`) is identical to the config clone; its
  `files.includes` (lines 10-17) covers `**` except `dist`, `node_modules`, `bun.lock`, `*.html`
  and `test/fixtures`. So the new test file is linted; `dist/` is not.
- `bunfig.toml:1-4`: `[test]` with coverage on and a line threshold of 0.8; `test/**` is excluded
  from coverage.
- CI: `.github/workflows/ci.yml:17-19` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0`
  with `build: true`. The pinned `check.yml` is identical to the config clone. It runs install,
  lint, typecheck, then (with `build`) `bun run build` and `git diff --exit-code -- dist`
  (lines 31-36), then `bun run test` (line 38).
- `test/smoke.test.ts:30` fails when `dist/` differs from a fresh build of `src`.

Checks and completion evidence:
1. `bun run check` exits 0.
2. `bun test test/failure-limiter.test.ts --test-name-pattern "nondecreasing"` (or the chosen name)
   runs the new test and passes. The test hard-codes the admitted timestamps
   `[0, 0, 59999, 59999, 59999, 59999, 59999, 59999, 119997, 119997, 119997, 119997]`, the count
   `10` and the bound `8` as literals (source: "Counterexamples" of this spec).
3. `grep -c "does not decrease" src/failure-limiter.ts dist/failure-limiter.d.ts docs/index.md`
   prints at least 1 for each file.
4. `grep -n "2 × (maxKeys + 1) × limit" src/failure-limiter.ts dist/failure-limiter.d.ts` and
   `grep -n "2 \* (maxKeys + 1) \* limit" docs/index.md` still match (the formula is unchanged).
5. No runtime change: `git diff --exit-code origin/main -- dist/failure-limiter.js dist/index.js dist/index.d.ts package.json`
   exits 0 (the compiled JS and the exports are byte-identical to `main`), and
   `git diff origin/main -- src/failure-limiter.ts` touches only lines inside the leading `/** … */`
   comment.
6. `git diff --exit-code origin/main -- test/failure-limiter.test.ts` shows only added lines
   (no existing expectation changed): `git diff origin/main -- test/failure-limiter.test.ts | grep -c '^-[^-]'`
   prints 0.
7. The pull request names the issue, the checks that ran and the known limit (no bound for a clock
   that goes backwards).

## Repository: api

Files:
- `docs/operation.md` (the "Bound:" bullet of "Admin auth throttle", line 301 today)

Behavior change: no
Docs only; the throttle code, its constants and the kit pin stay as they are.

Behavior: item 5 of "Required behavior". Keep the numbers and the factor 2. Add the clock
assumption and the consequence of a backward clock step in one or two short sentences. No change to
`src/`, `test/`, `package.json` or the kit pin (`package.json:32`).

Tool facts (verified at api `3fdfbe5ce8ffb8b250409856832ddfc35c9d0d60`):
- Bun 1.4.0: `package.json:9` (`engines.bun`) and `package.json:35` (`packageManager`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test`: `package.json:20`; lint is
  `biome check . && pulse-eslint . && pulse-workflows` (`package.json:16`), Biome `2.6.3`
  (`package.json:23`).
- `biome.json` extends `@lorenzh/pulse-config/biome.json`, pinned at
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). The pinned `biome.json` and
  `check.yml` are identical to the config clone (checked with `gh api … ?ref=04108fa…` and `diff`).
- CI: `.github/workflows/ci.yml:18` uses `check.yml@04108fa…` without `build`, so it runs install,
  lint, typecheck and test.

Checks and completion evidence:
1. `bun run check` exits 0.
2. `grep -n "200 020" docs/operation.md` still matches the "Bound:" bullet, and the same bullet
   contains the words "does not go backwards" (literal expected phrase from this spec):
   `grep -n "200 020.*does not go backwards\|does not go backwards.*200 020" docs/operation.md`
   matches, or the two phrases are within the same bullet, shown in the PR.
3. `git diff --name-only origin/main` lists only `docs/operation.md`.
4. The pull request names the issue, the checks that ran and the known limit.
