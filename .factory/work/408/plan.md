# Spec: faster contract validation (#408)

## Goal
Bring history validation in `@lorenzh/pulse-contract` back to within 1.2x of the pre-#324 time (reviewer's fixture: 192 ms old, so at most ~230 ms; new is 441 ms), and move contract's own build and typecheck back to TypeScript 7. Own-property rule, "validators never throw, no getter is run" and error paths/messages stay unchanged.

## Scope
- `contract`: `src/validate.ts` (and `validate-admin.ts` if it shares `ownView`), a benchmark test, TS 7 toolchain move.
- `status`, `api`: bump the contract pin and lockfile only.

## Non-goals
- No change to the public API, wire format, error paths or messages.
- No new runtime dependency (zod only, see `docs/approved-packages.md`).
- No hard timing assertion in CI; no code change in probe, notify, config, kit, website.

## Required behavior
- Replace the recursive copy (`ownView` then `schema.safeParse`) with a path that does not allocate a copy for plain data: for example a single allocation-free own-property pre-walk (`Object.hasOwn` / own descriptor data check without invoking getters) followed by `safeParse` on the original value, or the checks inside the schema. Pick the one that meets the 1.2x target. Inherited values and accessors must still count as missing/invalid and never run.
- Error paths and messages byte-identical; existing tests are the guard.
- The #324 own-property and getter tests in `test/validate.test.ts` stay and pass; they must fail against a naive validator (plain `safeParse` on the raw value, or a spread copy). The implementer shows this once by running them against such a variant and says so in the PR.
- Benchmark test (e.g. `test/validate.bench.test.ts`): generates the fixture in the test (1,000 checks x 90 days of uptime, including the F9 and latency/availability SLO types if they affect history validation), warms up, runs several times, prints the median to the console and passes. At most a loose sanity bound.
- TS 7: use the `typescript7` alias (`npm:typescript@^7.0.2`) as probe/api do; scripts `build` and `typecheck` run `bun node_modules/typescript7/bin/tsc`. Remove `typescript` 6.0.3, or keep it only if biome, `pulse-eslint` (typed linting) or `@types/*` need the `typescript` package, and say so. `dist/` keeps its shape: same file list, `.js` extension rewriting, `.d.ts` equal or equivalent. If TS 7 cannot build the package, record why in the PR and keep the validator work.

## Risks
- A pre-walk that is stricter or looser than the copy changes which inputs fail: guard with the existing tests plus cases for nested arrays, inherited fields, getters, null prototypes.
- Benchmark noise: compare medians of at least 5 runs after warmup, same machine.
- Typed lint may need the `typescript` package next to `typescript7`.

## Performance impact
- Reported metric of the consumers: request-path CPU of status `/api/*` history routes and api test CPU (`test_cpu_s` in `bench/budgets.json`) go down slightly; nothing else expected to move (startup, RSS, image size unchanged).
- Contract itself: validation time about 441 ms to at most ~230 ms on the fixture; typecheck CPU and test CPU should drop with TS 7.
- Measure: benchmark test on old commit (pre-#324 pin, named in the PR) vs new code, median of at least 5 runs; typecheck and build CPU (user+sys, median of several runs) before and after the TS 7 move; in api, optionally `bun bench/run.ts --a <old pin ref> --b <new>`.

## Repository: contract
Files: `src/validate.ts`, `src/validate-admin.ts` if needed, `test/` (new benchmark test), `package.json`, `bun.lock`, `tsconfig*.json` if TS 7 needs it, `src/version.ts`/package version per repo rules.
Behavior: as under Required behavior.
Checks: `bun run check` passes (lint, build, typecheck, test), including the #324 tests.
Completion evidence in the PR: old vs new median (commit named), the naive-variant failure of the #324 tests, `dist/` file list and `.d.ts` comparison, typecheck/build CPU before and after, and the new commit to pin.

## Repository: status
Files: `package.json`, `bun.lock`.
Behavior: pin `@lorenzh/pulse-contract` to the new contract commit. No code change.
Checks: the repo's `bun run check` passes. If cheap, report the repeated-validation measure (1,000 x 90, expected ~192 to 230 ms).
Completion: PR with the new pin.

## Repository: api
Files: `package.json`, `bun.lock`.
Behavior: pin `@lorenzh/pulse-contract` to the new contract commit. No code change.
Checks: the repo's `bun run check` passes; report test CPU if cheap.
Completion: PR with the new pin.
