# Issue review: #408 Contract validation 2.3x slower

Verdict: specifiable. No blocking question.

## Findings from the clones
- `contract` (v1.6.0, pin `6401721`) validates with zod. `src/validate.ts` has `ownView(schema, value)` (copies declared own fields level by level, `define`, `ownValue`), and `problem()` runs `schema.safeParse(ownView(...))`. This is the "recursive copy" the issue means.
- `status` and `api` both pin `@lorenzh/pulse-contract#6401721…`. Both need a bump to the new contract commit.
- `contract` uses `typescript` 6.0.3 with `tsc` in `build` and `typecheck`. `probe` and `api` use `typescript7` (`npm:typescript@^7.0.2`) and run `bun node_modules/typescript7/bin/tsc`. `contract`'s `build` is `tsc -p tsconfig.build.json` (declaration, `rewriteRelativeImportExtensions`, `rootDir src`, `outDir dist`).
- The benchmark does not exist yet. `test/` has no bench file. The #324 own-property and getter tests live in `test/validate.test.ts`.

## Open points (not blocking)
1. "Old pin vs new code": the old pin is the contract before #324/#34. The PR must name the commit used. The benchmark test must not need the old code at runtime. The comparison is a one-off measurement in the PR body, run on the old commit and on the new code with the same fixture.
2. A benchmark test must not flake CI. Assume it reports time (console output) and asserts only a loose sanity bound or none. The 1.2x target is checked by the PR measurement, not by a hard timing assertion.
3. "Within 1.2x of the old time" is measured against 192 ms (so at most about 230 ms) on the reviewer's fixture. Assume the median of at least 5 runs after warmup, on the same machine, for old and new.
4. "Own-property and getter tests from #324 still fail on the old (spread-based) code": this means a faster implementation must not drop those guarantees. The spec should name those tests and require they exist and still pass. The implementation may not re-add inherited reads or getter calls to gain speed. Wording is loose: current code is not spread-based, and the old pin is the fast one without own checks. The acceptance reads: the tests fail against a naive implementation (plain `safeParse` on the raw value or a spread copy) and pass against the new one.
5. The fix approach is open: avoid the copy for plain data (a single own-property pre-walk with no allocation, or checks inside the schema) while keeping error paths and messages byte-identical. The plan chooses it. Existing error-path tests are the guard.
6. TS 7 move (approver addition):
   - Use the `typescript7` alias, scripts `bun node_modules/typescript7/bin/tsc`, and remove or replace the `typescript` 6.0.3 devDependency. Check that `@types/bun`, biome, and `pulse-eslint` (typed linting needs the `typescript` package) still work. If a tool needs `typescript` itself, keep it as a dev dependency for that tool only and say so.
   - `dist/` must keep its shape: same files, `.js` extension rewriting, `.d.ts`. Compare a file listing and `.d.ts` diff before and after.
   - Report typecheck and build CPU before and after (user+sys time, median of several runs). If TS 7 cannot build the package, record why in the PR and keep the validator work.
   - `bun.lock` changes and a version bump (new pin commit) follow the repo rules. Runtime dependencies stay within `docs/approved-packages.md` (zod only; nothing new at runtime).
7. Order: contract merges first, then status and api bump the pin (children depend on `contract` via `dependsOn`). Status and api need no code change beyond the pin and lockfile. Their tests must pass with the new pin. `status` is expected to show about 192 to 230 ms on its own repeated-validation measure. Report it in the status PR if cheap.
8. Plans see only `main` of each target. Contract `main` already includes #34 and the latest merge (#37, latency/availability SLOs), so the fixture must include those types if they affect history validation.

## Assumptions
- Targets: `contract`, `status`, `api`. `probe`, `notify`, `config`, `kit`, `website` are untouched.
- Public API, error paths and messages, and "never throw, never run a getter" are unchanged.
- Fixture: 1,000 checks x 90 days of uptime, generated in the test, not committed as a big file.

## Derived acceptance check
- In contract, a benchmark test runs history validation on the 1,000 x 90 fixture, prints the median of several runs, and passes. The PR body shows old pin vs new code: new median is at most 1.2x the old median.
- `bun run check` passes in contract: all existing tests pass, including the #324 own-property and getter tests, which fail on a naive or spread-based validator.
- Contract builds and typechecks with `typescript7`; `dist/` has the same shape; typecheck and build CPU before and after are in the PR (or the reason TS 7 fails is recorded).
- `status` and `api` pins point to the new contract commit and their checks pass.
