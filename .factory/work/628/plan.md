# Spec #628: config hook tests must not inherit Lefthook settings from the caller

## Goal
`src/hook.test.ts` in pulse-config runs the real pre-commit hook through Lefthook. Since pulse-meta#627 the Factory runner sets `LEFTHOOK=0` (`.github/workflows/factory-run.yml:216` in meta) so that the Factory's own commits skip hooks. Any agent that runs the config tests inside a Factory run, for example the api bench, then sees "pre-commit hook reports a real error" fail: Lefthook inherits `LEFTHOOK=0`, skips every command and exits 0 (seen in #617). The hook tests must test the hook whatever the caller's environment is.

## Scope
Only `pulse-config`, and in it only `src/hook.test.ts`. The fix is in how the test helper `preCommit` builds the environment of the Lefthook child process.

## Non-goals
- No change to `LEFTHOOK=0` in meta's `factory-run.yml` or to how developer and Factory commits handle hooks.
- No change to `lefthook.yml`, `lefthook-local.yml`, `eslint.config.js`, `eslint.local.config.js`, `biome.json`, `bunfig.toml`, `package.json` or CI.
- No dependency, package version or consumer pin change. `src/hook.test.ts` is not in the `files` list of `package.json` (lines 15-26), so it is not shipped to any target.
- Lefthook settings other than the three named in the issue (`LEFTHOOK`, `LEFTHOOK_EXCLUDE`, `LEFTHOOK_QUIET`) stay out of scope.
- No README or AGENTS.md change: no command or convention changes.

## Required behavior
1. **Child environment.** Every Lefthook run in `src/hook.test.ts` gets an explicit `env` option. It is a new object built from a base environment (default `process.env`) with exactly the keys `LEFTHOOK`, `LEFTHOOK_EXCLUDE` and `LEFTHOOK_QUIET` left out. All other keys are kept unchanged, in particular `PATH` (the hook commands call `bunx` and `bun`, `lefthook.yml:5,8`, `lefthook-local.yml:4`) and `HOME`.
2. **Leaving out, not overriding.** The keys are absent from the child environment. Setting `LEFTHOOK=1` or `LEFTHOOK_EXCLUDE=""` instead is not enough and does not meet this spec.
3. **Parent untouched.** The test never deletes or assigns keys on `process.env` or `Bun.env`. No global mock, no `beforeAll`/`afterAll` that changes the environment.
4. **Self-proving test.** The helper `preCommit(file, base = process.env)` takes the base environment as an optional second parameter (file-local, not exported). The test "pre-commit hook reports a real error" calls it with a hostile base: `{ ...process.env, LEFTHOOK: "0", LEFTHOOK_EXCLUDE: "biome,eslint", LEFTHOOK_QUIET: "meta,summary,success,failure,skips,execution,execution_out,execution_info" }`. Its assertions stay: exit code not 0, output matches `/no-floating-promises/`. A helper that passes the caller's settings through makes this test fail in any caller environment, so the suite itself proves the isolation; the fixture test keeps the default base.
5. **Kept as is.** Runtime launcher (`process.execPath` with `node_modules/lefthook/bin/index.js`), arguments (`run pre-commit --file <file> --no-tty`), `cwd: root`, output capture, error mapping, probe file name and `afterAll` cleanup, and both test names. The number of Lefthook runs stays at two.

## Risks
- The fixture test ("skips the invalid fixtures") expects exit 0, so a skipped hook also passes it. It cannot detect the bug; the real-error test is the one that proves the hook ran. Do not weaken it.
- If Lefthook reads another setting from the environment that changes the outcome (outside the three keys), the tests can still depend on the caller. That is out of scope by the issue; a later issue can widen the list.
- `LEFTHOOK_QUIET` with the listed output types may or may not hide the ESLint diagnostic on an unfixed helper; the spec does not rely on it. `LEFTHOOK=0` alone already makes the unfixed helper fail.

## Acceptance evidence
All in a writable pulse-config checkout after `bun install --frozen-lockfile` (Bun 1.4.0, `package.json:7-9`). Expected values are literals in the checks.
1. **Reproduction (before the fix).** On `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`, `LEFTHOOK=0 bun test src/hook.test.ts` exits non-zero and reports "pre-commit hook reports a real error" as failed at the `assert.notEqual(result.code, 0, ...)` assertion (literal from the issue).
2. **Red step.** With only the new hostile base of behavior 4 added to the test (helper still without `env`), `bun test src/hook.test.ts` without any Lefthook variable set fails in "pre-commit hook reports a real error".
3. **After the fix**, each of these exits 0 and prints `2 pass` and `0 fail` (literal: the file has two tests):
   - `LEFTHOOK=0 bun test src/hook.test.ts`
   - `env -u LEFTHOOK -u LEFTHOOK_EXCLUDE -u LEFTHOOK_QUIET bun test src/hook.test.ts`
   - `LEFTHOOK_EXCLUDE=eslint bun test src/hook.test.ts`
   - `LEFTHOOK_QUIET=meta,summary,success,failure,skips,execution,execution_out,execution_info bun test src/hook.test.ts`
   - `LEFTHOOK=0 LEFTHOOK_EXCLUDE=biome,eslint LEFTHOOK_QUIET=execution_out bun test src/hook.test.ts`
4. `LEFTHOOK=0 bun run check` exits 0 (lint, typecheck, full test suite with the 80 % line coverage threshold of `bunfig.toml:3`).
5. Review: the diff touches only `src/hook.test.ts`; the `run(...)` call passes `env`; the code contains no assignment to or `delete` of `process.env`/`Bun.env`.

## Performance impact
The only metric that can move is `config.test_cpu_s` in `bench/budgets.json` of the api repository (budget 29.8 s, floor 3 s). In a normal environment none expected: the suite still runs Lefthook twice with the same commands, and building one environment object costs microseconds. In an environment with `LEFTHOOK=0` the real-error test now runs ESLint and Biome instead of skipping them, so its CPU rises by the cost of one hook run (roughly 1-3 s), but on the current main that run fails, so there is no valid baseline to compare. The implementer measures the normal case with `bun bench/run.ts --a <config main> --b <config branch>` from the api repository, or locally with `/usr/bin/time -v bun run test` on both refs; the difference must stay inside run-to-run noise (about 20 % per `bench/README.md:114` of api).

## Security impact
Security impact: no. Test-only change in one file: no route, parser, probe client, shipped file, dependency, Dockerfile or CI changes; the child gets a subset of the parent's own environment.

## Rollout order
One repository: only `pulse-config` changes, and only a file that is not shipped (`package.json` `files`, lines 15-26). Targets on older config pins (`04108fa…`, `51e95b0…`, `86896e9…`) keep working because they never run this test. No target needs a pin update.

## Counterexamples
- `env: { ...process.env, LEFTHOOK: "1" }`: keeps an inherited `LEFTHOOK_EXCLUDE=biome,eslint`, Lefthook skips both commands, the real-error test with the hostile base fails. Must be rejected.
- `env: { LEFTHOOK: undefined, ...process.env }` (spread order wrong): the caller's `LEFTHOOK=0` wins. Must be rejected; the hostile-base test fails.
- `delete process.env.LEFTHOOK` in the test file or in a hook: passes the tests but changes the parent environment for the rest of the run. Violates behavior 3.
- `env: { LEFTHOOK_EXCLUDE: "" }` without spreading the base: drops `PATH`, so `bunx`/`bun` are not found and the hook fails for the wrong reason (the fixture test then fails with a non-zero code). Must be rejected.
- Removing keys case-insensitively or by prefix (`LEFTHOOK_*`): goes beyond the three keys named; drop exactly `LEFTHOOK`, `LEFTHOOK_EXCLUDE`, `LEFTHOOK_QUIET`. A caller variable `lefthook=0` (lower case) is a different key on Linux and stays.
- Wrapping the real-error test in `test.skipIf(process.env.LEFTHOOK === "0")`: makes `LEFTHOOK=0 bun test` pass without testing the hook. Must be rejected.
- No statistics in this spec.

## Contract fields
No new names. The helper parameter and the local constant are file-local in a test that is not exported or shipped.

## Repository: config
Files:
- `src/hook.test.ts`

Behavior change: no. Change of a test file alone; no shipped file, tooling, CI or product behavior changes.

Tool facts (verified in the config clone at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`; config's CI uses its own local `check.yml`, not a pinned ref, so no pin read is needed):
- Bun 1.4.0: `package.json:7` (`packageManager`), `package.json:9` (`engines`); CI sets `bun-version: 1.4.0` at `.github/workflows/check.yml:24`.
- Lefthook 2.2.2: `package.json:53`; Biome 2.6.3: `package.json:51`.
- `bun run test` is `bun test src` (`package.json:36`); `bun run check` is lint, typecheck, test (`package.json:40`); lint runs Biome, ESLint with `eslint.local.config.js` and `pulse-workflows` (`package.json:37`).
- `bunfig.toml:2-4`: coverage on, line threshold 0.8, `**/*.test.ts` ignored for coverage.
- Biome scope `biome.json:10-17` includes `src/**`; the test file is linted and formatted (lineWidth 100, double quotes, `biome.json:23,29`).
- CI: `.github/workflows/ci.yml:17` calls `./.github/workflows/check.yml`, which runs install, lint, typecheck and test (`check.yml:25-38`).

Behavior:
- Change `preCommit(file)` at `src/hook.test.ts:14` to `preCommit(file: string, base: NodeJS.ProcessEnv = process.env)`. Build the child environment from `base` without `LEFTHOOK`, `LEFTHOOK_EXCLUDE` and `LEFTHOOK_QUIET` (for example a file-local `const callerSettings = ["LEFTHOOK", "LEFTHOOK_EXCLUDE", "LEFTHOOK_QUIET"]` and `Object.fromEntries(Object.entries(base).filter(([key]) => !callerSettings.includes(key)))`) and pass it as `env` next to `cwd: root` at line 19. Add a one-line comment why: the caller (the Factory runner) may set `LEFTHOOK=0`.
- In "pre-commit hook reports a real error" (line 35) pass the hostile base of Required behavior 4 as the second argument. Keep both assertions and the fixture test unchanged.
- No new export, no global mock, no change to `process.env`.

Checks:
- TDD: add the hostile base first and show the red step (Acceptance 2), then add `env` to the helper.
- The five commands of Acceptance 3 and `LEFTHOOK=0 bun run check` (Acceptance 4).

Completion evidence:
- The PR names the failing run before the fix (Acceptance 1 or 2) and the passing runs after it, with the `2 pass` / `0 fail` lines, and states that only `src/hook.test.ts` changed.
