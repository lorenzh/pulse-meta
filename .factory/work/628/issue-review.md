# Issue review #628: isolate hook tests from caller Lefthook settings

Verdict: ready for `plan`. No blocking questions or contradictory requirements were found.

## Sources and current behavior

- Read [issue #628](https://github.com/lorenzh/pulse-meta/issues/628) and all its comments. The only comment is this run's Factory claim; there are no earlier decisions to carry forward.
- Read meta's `AGENTS.md`, `README.md` and issue-review prompt, and config's `AGENTS.md`, package scripts, README hook guidance, hook configurations, test configuration and `src/hook.test.ts`.
- Inspected the read-only config clone at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. Its `preCommit` helper (`src/hook.test.ts:14`) launches the Lefthook JavaScript entry point using `process.execPath`, with only `cwd` in the process options. It supplies no child environment, so caller environment variables reach Lefthook.
- Both hook tests use that helper. The fixture test expects exit code zero; the real-error test writes a TypeScript probe with an un-awaited promise and requires a nonzero exit code plus `no-floating-promises` in the output. A skipped hook can therefore make the fixture test pass without exercising the hook, while violating the real-error assertions.
- `lefthook.yml` defines `biome` and `eslint` commands. `lefthook-local.yml` overrides ESLint to use `eslint.local.config.js`, which excludes the invalid fixtures. Preserve these actual hook checks and assertions.
- Inspected meta's `.github/workflows/factory-run.yml:214` and read [#627](https://github.com/lorenzh/pulse-meta/pull/627). The runner deliberately sets `LEFTHOOK=0` to allow Factory publication commits, including publication of holds. This behavior already exists and must remain intact.

## Open points and working assumptions

1. **Scope.** Only config's hook-test subprocess setup needs to change. No shared hook policy, Factory workflow, API bench, consumer dependency pin, package version or runtime dependency change is required. This is a test-isolation fix, not a change to how developer or Factory commits handle hooks.
2. **Exact environment contract.** Interpret “does not inherit” literally: remove `LEFTHOOK`, `LEFTHOOK_EXCLUDE` and `LEFTHOOK_QUIET` from the environment explicitly passed to every Lefthook invocation in the tests. Setting `LEFTHOOK=1` alone is insufficient and leaves the other two controls inherited. Other Lefthook controls are outside this request.
3. **Preserve unrelated environment and parent state.** Construct a fresh environment from the caller's environment, omit the three named keys, and retain unrelated variables such as `PATH` needed by the hook's nested commands. Do not delete or replace variables on `process.env`/`Bun.env`; the test runner and unrelated subprocesses must retain their original settings. Apply isolation when building each child environment so the helper consistently handles caller settings.
4. **Regression evidence.** The stated command covers the disabling variable but does not independently prove exclusion or quiet settings are removed. The spec should require checks with those variables supplied too, plus review of the explicit child environment for absence of all three keys. Preserve the fixture-success and real-error assertions; do not make the suite pass by skipping tests, weakening assertions, or changing lint policy. Use the existing integration tests and focused regression evidence without exporting a test-only API or adding global environment mocks.
5. **Prerequisites and compatibility.** Validation belongs in a writable config checkout with Bun 1.4.0 and dependencies installed from the lockfile. Preserve the current runtime launcher, working directory, file selection, output capture and probe cleanup. No documentation update is needed unless implementation changes a documented command or convention.

## Derived acceptance check

In the config implementation checkout, install with `bun install --frozen-lockfile`, then:

1. Before the fix, run `LEFTHOOK=0 bun test src/hook.test.ts` and record the expected failure of “pre-commit hook reports a real error” because the hook returned zero. After the fix, the same command must exit zero with both hook tests passing.
2. Run the hook suite with the three controls absent: `env -u LEFTHOOK -u LEFTHOOK_EXCLUDE -u LEFTHOOK_QUIET bun test src/hook.test.ts`. It must still pass.
3. Exercise caller controls independently with `LEFTHOOK_EXCLUDE=eslint bun test src/hook.test.ts` and `LEFTHOOK_QUIET=1 bun test src/hook.test.ts`, then together with `LEFTHOOK=0 LEFTHOOK_EXCLUDE=eslint LEFTHOOK_QUIET=1 bun test src/hook.test.ts`. Each invocation must pass, including the nonzero hook exit and diagnostic assertion for the real error. Review the supplied environment to verify all three keys are absent, unrelated variables are retained and the parent environment is unchanged; successful commands alone do not prove that contract.
4. Run `LEFTHOOK=0 bun run check` to verify lint, typecheck and the full test suite in the Factory environment. Keep all existing check and coverage thresholds.

## Review validation

This state read issue comments and source; it did not edit any target repository or run config tests. Bun 1.4.0 is available, but the read-only config clone has no `node_modules`, so the reproduction and acceptance commands above are required evidence for implementation, not claimed test results. Only this review artifact was written, and `.factory/work/628/` remains available to later states without an ignore rule.
