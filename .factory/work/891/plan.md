# Spec #891: status: stop the subscribe-timing self-check from failing intermittently

## Goal

The self-check `self-check: an early answer fails check 2, a 2000 call timeout fails check 1` in
`src/subscribe-timing.test.ts` of pulse-status fails now and then at
`assert.ok(driven.bytesBeforeRelease > 0)` (line 290). The test driver counts the client's bytes
after a fixed 50 event-loop turns. When the wrong handler's early answer has not reached the client
by then, the count is 0, the release fires, and the assertion fails. Make the driver able to wait for
a condition (client data observed) before it counts the bytes and fires the release. Use that wait
in the self-check that expects early data. Add a regression test that fails on the base every time
and passes on the fix. No production code changes.

## Evidence on the recorded base

Inspected base: status `main` at `2cefdf1cfbbd7cce175a9df97dbdafdec0e925aa` (the context clone,
clean). The implementer records its own `BASE` before any edit. If `main` has moved, re-check the
line numbers below; the design does not depend on them.

- `src/subscribe-test-support.ts:285-329` `driveSubscribe`: waits for the request's timers and the
  notify call (`:301-306`), runs `settle` (`:308`), optionally fires the call timer (`:309-316`),
  then yields exactly 50 `setImmediate` turns (`:317-318`), counts
  `client.received().length` (`:319`), fires the release timer `scheduler.timers[start + 1]`
  (`:320`) and waits for the socket to close (`:321`). There is no hook between the turns and the
  count.
- `src/subscribe-timing.test.ts:246-277` `wrongServer`: the `early answer` variant writes the
  answer in the `.then` of the notify `requestJson` call (`:269-271`), so the bytes reach the
  client only after the fake notify answer has been read, parsed and validated by `fetch`, and
  after the write has crossed the loopback socket.
- `src/subscribe-timing.test.ts:279-300` is the only self-check in the file that drives
  `driveSubscribe`. It has two variants. `early answer` expects `bytesBeforeRelease > 0` (`:290`) and
  check 2 to throw (`:291`). `call timeout 2000` expects the literal registrations
  `[5000, 2000, 2000]` (`:293-296`) and check 1 to throw with `1500` (`:297`). Its handler writes
  only at the release, so it must not wait for early data. `settle: finished` (`:57-61`, `:287`)
  waits for the fake notify's *server* response to finish. That is not the client's observation of
  the status answer.
- Other callers of `driveSubscribe`: the D22 cases (`subscribe-timing.test.ts:167`, `:199`) and
  `subscribe-enumeration.test.ts:98`. All of them assert `bytesBeforeRelease === 0`
  (`subscribe-timing.test.ts:145`, `subscribe-enumeration.test.ts:103`). They keep the 50-turn
  chance for a wrong handler and must not wait for data.
- The other `self-check:` test of the repository, `src/subscribe-routes.test.ts:486`, does not
  use `driveSubscribe` or `bytesBeforeRelease` (`grep -rn "driveSubscribe\|bytesBeforeRelease"
  src` lists only the files above). It is out of scope: the issue limits the audit to this file.
- `waitUntil` (`subscribe-test-support.ts:235-242`) yields `setImmediate` turns until a
  predicate holds and throws `gave up waiting for <what>` after 20,000 turns. It uses no wall-clock
  timer. `rawClient` (`:190-204`) keeps every received byte and exposes `received()`.

Measured during this spec run (Bun 1.4.0, a writable copy of the base in `/tmp`, dependencies
installed with `bun install --frozen-lockfile`, a shared 4-CPU machine; not in `.repos/`):

- Base `bun run test`: `Ran 662 tests across 44 files`. One run took 3.00 s user + 0.91 s system
  CPU (`/usr/bin/time`).
- Base, 145 full `bun run test` runs in three loops (25, 60, 60): 135 exited 0. Failures:
  - `src/subscribe-timing.test.ts` `self-check: an early answer fails check 2, a 2000 call timeout fails check 1`: 1 run (the bug of this issue).
  - `src/subscribe-enumeration.test.ts` `R8 L9 full (half waiting, half partial): valid and invalid get the same 503 page`: 2 runs.
  - `src/server.test.ts` `502 when the API is down` (`404 !== 502` at `server.test.ts:100`): 7 runs (1, 2 and 4 in the three loops).
  The last two are other, pre-existing flakes outside this file (see Decisions and Risks).
- Prototype candidate (the design below), 60 consecutive full `bun run test` runs in one loop:
  every run printed `Ran 663 tests across 44 files`, 52 exited 0, and 0 failures were attributed to
  `src/subscribe-timing.test.ts`. All 8 failures were `src/server.test.ts`
  `502 when the API is down`. The last base loop of 60, run right after it on the same
  quiet machine, had 4 of that failure. The change does not touch `server.test.ts` or the server.
  With counts this small, 8 against 4 is within chance (a two-sided Fisher exact test gives
  p ≈ 0.36), but the implementer reports both counts (acceptance 6).
- The base self-check run alone 40 times (`bun test --config=/dev/null src/subscribe-timing.test.ts -t "self-check"`):
  40 passes. The race shows up only under full-suite load. Hence a deterministic regression is
  required (see the regression design), not a rerun count.
- Prototype of the design below (applied to the throwaway copy, then discarded; nothing was
  written to any target): the new regression failed 3 of 3 runs on the base driver with
  `AssertionError: false == true` at `assert.ok(driven.bytesBeforeRelease > 0)`, `0 pass`,
  `1 fail`. It passed 3 of 3 runs with the hook (`12 pass`, `0 fail` for the file). Moving the hook
  call after the byte count, or after the release, made the regression fail again with the same
  assertion. `bun run lint` and `bun run typecheck` exited 0 with the prototype.

## Scope

Only pulse-status: the test driver `src/subscribe-test-support.ts`, the test file
`src/subscribe-timing.test.ts`, and the developer docs `README.md` (Development) and
`docs/development.md` (Checks).

## Non-goals

- No production code change. Nothing under `src/` except the two named test files changes, and
  no `public/`, `e2e/`, `bench/` or `scripts/` change.
- The other flaky tests seen on the base (`server.test.ts` `502 when the API is down`,
  `subscribe-enumeration.test.ts` `R8 L9 full …`) are not fixed here. They are reported as
  known limits (see Decisions).
- The 50-turn loop of `driveSubscribe` (the chance for a wrong handler to write early, which the
  zero-byte checks need) stays exactly as it is. Do not raise or lower the count.
- No change to `subscribe-routes.test.ts`, `subscribe-enumeration.test.ts`, timing values, the
  public subscribe delay, settings, dependencies, tooling config or CI.
- Do not redo or touch the changes of status #70, #71 or #72.

## Required behavior

1. **Driver hook.** `DriveOptions` in `src/subscribe-test-support.ts` gets one optional field:
   `beforeRelease?: (client: RawClient) => Promise<void> | void`. `driveSubscribe` awaits it
   (`await options.beforeRelease?.(client)`) after the existing 50-turn loop and before the line
   `const bytesBeforeRelease = client.received().length`. The order is fixed: registrations, then
   `settle`, then the optional call-timer fire, then the 50 turns, then `beforeRelease`, then the
   byte count, then the release fire, then `await client.closed`. A caller without the hook behaves
   exactly as on the base. The field has a one-line JSDoc like its siblings (for example
   `/** Runs before the bytes are counted and the release fires (for example: wait for early data). */`).
2. **Existing self-check.** The `early answer` variant of the self-check at
   `subscribe-timing.test.ts:279` passes
   `beforeRelease: (client) => waitUntil(() => client.received().length > 0, "early answer at the client")`.
   This is a condition, not a delay. It is bounded by the 20,000-turn limit of `waitUntil`. The
   `call timeout 2000` variant passes no hook. Its handler answers only at the release, so a data
   wait there would end in `gave up waiting`. All existing assertions of both variants stay
   word for word: `bytesBeforeRelease > 0`, `throws … /0/`, `[5000, 2000, 2000]`, `throws … /1500/`.
   Use the spread pattern `...(wrong === "early answer" ? { beforeRelease: … } : {})` or an
   equivalent. `exactOptionalPropertyTypes` is on (see the tool facts), so do not pass
   `beforeRelease: undefined`.
3. **Gate for the wrong server.** `wrongServer` gets an optional fourth parameter
   `gate?: Promise<void>`. In the `early answer` variant, the early write waits for the notify call
   result and then for the gate (for example `.then(() => gate).then(() => { … write(res) })`).
   Without a gate, the behavior is the base behavior plus one microtask.
4. **Deterministic regression.** Add one test to `src/subscribe-timing.test.ts`, named
   `self-check: early data that arrives late is still counted before the release` (or a name that
   keeps the `self-check:` prefix; the PR names it). It:
   - starts a fresh `manualScheduler`, a fake notify with `ok`, and `wrongServer(…, "early answer", gate)`
     with a gate that only the test opens;
   - drives the request with `isCalling: true`, `settle: finished` and a `beforeRelease` hook that
     opens the gate, waits with `waitUntil` until `client.received().length > 0`, and records the
     state of the request's release timer (`scheduler.timers[1]` for a fresh scheduler; it is the
     second timer of the request);
   - asserts, in this order: `assert.ok(driven.bytesBeforeRelease > 0)`; the recorded release state
     equals the literal `"live"`; `assert.throws(() => checkRequest(driven, { isCalling: true }), /0/)`.

   The early data cannot reach the client before the hook opens the gate. Its arrival therefore
   does not depend on any number of event-loop turns or on wall time. On the base driver, the hook
   option is ignored at run time (Bun does not typecheck), so the gate stays closed during the byte
   count. The count is 0 and the first assertion fails every time. That is the stated red reason:
   the base driver counts before client data is observed. The test imports no runtime value that
   the base support module lacks (`RawClient` is a type and already exported at
   `subscribe-test-support.ts:183`; import it with `type`). On the base, it must therefore fail on
   the assertion, never on an import or a missing export.
5. **Docs.** `README.md` `## Development` and `docs/development.md` `## Checks` each get one or
   two short sentences with the same content. The subscribe timing tests fire the release timer by
   hand. A self-check that expects an early answer waits until the test client has received data
   (a condition, no delay and no real timer) before it counts the bytes and fires the release. The
   checks of the real handler still require zero bytes before the release. Do not mention or change
   the public 2 s answer delay or any setting.

## Decisions

- **The 50-run evidence.** The issue's "Done when" reads: `bun run test` passes 50 times in a
  row "without a failure of this file". The standing rule says "with no failure of the file". On
  the base, two other tests in other files fail in about 6 % of full runs (9 of 145, see the
  evidence; 8 of 60 for the prototype candidate). 50 fully green runs in a row would then depend on
  luck (about 0.94^50 ≈ 5 %, less at the candidate's measured rate), and fixing those files is
  outside this issue. Decision: the required evidence is 50 consecutive full
  `bun run test` runs of the final candidate on one machine with **zero failures attributed to
  `src/subscribe-timing.test.ts`**. Every run's exit status and every failing test, with its file,
  is recorded and reported. Rules for the loop:
  - A failure attributed to `src/subscribe-timing.test.ts` ends the sequence. Fix the cause, then
    start a new sequence at run 1. Report the failed sequence too.
  - A failure of `src/server.test.ts` `502 when the API is down` or of
    `src/subscribe-enumeration.test.ts` `R8 L9 full (half waiting, half partial): valid and invalid get the same 503 page`
    (the known base flakes) does not end the sequence. It is counted and listed.
  - Any other failing test ends the sequence. Investigate it: if this change caused it, fix it; if
    it is a pre-existing flake, show it on the base with the same attribution and name it in the
    PR. Then start a new sequence.
  - The PR states the result in this form:
    `50/50 consecutive full runs with 0 subscribe-timing failures; <n>/50 exited 0; other failures: <file> <test> ×<k>, …`.
    If a sequence also happens to have 50 exit-0 runs, say so; it is not required.

  This reading follows the literal qualifier of the issue and the standing rule. It replaces the
  stricter "all 50 exit 0" of the issue review, which did not know about the other flakes. If a
  person wants the other flakes fixed first, that is a separate issue for each of them.
- **`bun run check`** must exit 0 on the final commit. If an attempt fails only in one of the two
  known base flakes, rerun it. Report every attempt with its attributed failures; a pass is required.
- **Where the wait lives.** A hook (`beforeRelease`), not a boolean such as `isEarlyDataExpected`.
  The regression needs to open its gate at the exact point where the driver is about to count. A
  boolean would force a gate opened in `settle`, before the 50 turns, and the base would then fail
  only by chance.

## Risks

- **A wait in the wrong place.** A wait after the byte count, after the release, or after
  `driveSubscribe` returns cannot fix the race. The count and the release have already happened.
  The regression's release-state assertion (`"live"`) and the mutation controls (acceptance 4)
  catch this.
- **A data wait on a silent handler.** The `call timeout 2000` variant, the D22 cases and the
  enumeration cases must stay without a hook. A hook there either hangs until `gave up waiting`
  or turns their zero-byte checks into nothing.
- **Coverage in focused runs.** `bunfig.toml:2-3` turns coverage on with a 0.8 line threshold for
  every `bun test` run. A run of one file loads only part of `src/` and exits 1 on coverage alone:
  measured `bun test src/subscribe-timing.test.ts` on the base gave exit 1 with `11 pass`,
  `0 fail`, `All files` 25.26 % lines. Focused red and green runs therefore use
  `bun test --config=/dev/null …`. That flag drops the whole bunfig, and `bunfig.toml` has only these
  coverage keys (`bunfig.toml:1-4`). The coverage gate stays in the full `bun run test` and
  `bun run check`.
- **Other flakes in the 50-run loop.** See Decisions. Report them honestly and never relabel a
  subscribe-timing failure as one of them. Attribution comes from the file header that Bun prints
  before a failing test (acceptance 6), not from the test name: `self-check:` also appears in
  `subscribe-routes.test.ts:486`.
- **The 50-run loop alone proves little.** On this machine, the target failure showed in 1 of 145
  base runs (the issue reports about 1 in 5 in an earlier review). 50 clean runs are required
  evidence, but the proof that the race is gone is the deterministic regression (red 3 of 3 on the
  base, green on the fix) and the mutation controls. Do not cut either to save time.
- **Unbounded wait.** The hook relies on `waitUntil`'s 20,000-turn bound. Do not add a loop of
  your own without a bound, and add no real timer, `sleep` or `setTimeout`.
- **main moving.** If status `main` moves past `2cefdf1` before implementation, re-read the
  driver and the self-check. If they differ from the evidence above, re-check the design before
  coding.

## Performance impact

The api repository's `bench/budgets.json` lists these status keys: `startup_cpu_ms`,
`load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s` (gating), `startup_wall_ms` and
`image_mb` (reported).

- `test_cpu_s`: one new test of about 20 ms (measured 17-20 ms for the regression in the
  prototype) and a few extra turns in the existing self-check. Expected change: under +0.05 s,
  within noise. One base full run measured 3.91 s CPU (user plus system).
- `image_mb`: `src/subscribe-test-support.ts` is copied into the image (`Dockerfile:12`
  `COPY src ./src`; `.dockerignore` excludes only `**/*.test.ts` and similar). It grows by about
  150 bytes. That is far below the MB resolution, so no measurable change.
- `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `startup_wall_ms`: none
  expected. No production module changes, and the support module is imported only by tests.

How to measure (information only, no gate): on one machine, with the same Bun 1.4.0, the same
lockfile install and the same coverage settings, run the full `bun run test` ten times,
interleaved: base, branch, base, branch, … (five per revision, none at the same time). Wrap each
run in `/usr/bin/time -f '%U %S'`, which counts the waited-for child processes. Report every
sample (user, system, sum, exit status, attributed failures), the median per revision (the 3rd of
the 5 sorted sums), the delta of the medians in CPU seconds and in percent of the base median. A
sample with a failing test is kept and marked, not dropped. Do not run the Docker bench or
`bun bench/run.ts` (host port collision, #834).

## Security impact

Security impact: no

Only a test driver, one test file and developer docs change. No route,
parser, validator, client, header, file write, log text, dependency, Dockerfile or CI file changes.

## Rollout order

One repository: only `status` changes. It is a test-and-docs change with no production code, no
contract or kit pin change, and no interface used by another service, so every consumer keeps
working.

## Counterexamples

| Case | Required result | What a wrong implementation does |
| --- | --- | --- |
| Gated regression on the **base** driver (hook ignored) | fails 3 of 3 with `AssertionError: false == true` at `assert.ok(driven.bytesBeforeRelease > 0)`, `0 pass`, `1 fail` | A regression whose early data is not gated may pass on the base by chance. It is then not red evidence. |
| Hook awaited **after** `const bytesBeforeRelease = …` | regression fails on the byte assertion | A "fix" that waits but counts first still flakes. |
| Hook awaited **after** the release fire | regression fails on the byte assertion (and the release state would read `"fired"`) | Data that comes from the release is mistaken for early data. |
| Wait for data in the `call timeout 2000` variant | must not exist; that handler writes only at the release | `gave up waiting for early answer at the client` after 20,000 turns, and the variant fails. |
| Hook given to the D22 or R8 callers | must not exist | A correct handler never sends early data, so the wait hangs to its bound, or the zero-byte check proves nothing. |
| Replace the condition with more turns (for example 500 instead of 50) | rejected | A fixed count is still a race under load, and it slows every caller. |
| `settle: finished` alone as "the wait" | rejected; it is the base behavior | It watches the fake notify's server response, not the status answer at the client. |
| Regression that waits until `driveSubscribe` returns, then checks `driven.answer.length > 0` | rejected | The answer after the release is always non-empty, so the check cannot fail. |
| Focused run with the repository `bunfig.toml` | not evidence: exit 1 on coverage with `0 fail` | Reading that exit 1 as a red regression, or lowering the threshold. |
| 50-run loop where run 17 fails in `src/subscribe-timing.test.ts` | the sequence ends; fix the cause, then start again at run 1 | Counting it as "the known flake" or retrying only that run. |
| 50-run loop where run 30 fails only in `src/server.test.ts` `502 when the API is down` | counted, listed, the sequence continues | Hiding it, or restarting so that it disappears from the report. |

Statistic (performance, information only): sample = the user plus system CPU seconds of one full
`bun run test` run as `/usr/bin/time -f '%U %S'` reports it; 5 samples per revision, interleaved;
median = the 3rd value of the 5 sorted sums; delta = branch median − base median, in seconds
(2 decimals) and as a percentage of the base median (1 decimal). No averages of medians.

## Contract fields

No contract or config names change. New names exist only in pulse-status test code:
`DriveOptions.beforeRelease` (test support), the `gate` parameter of the local `wrongServer`, the
wait label `early answer at the client`, and the test name
`self-check: early data that arrives late is still counted before the release`. No collision:
`grep -rn 'beforeRelease' .repos/contract/src .repos/config .repos/status/src .repos/kit/src`
printed nothing, and
`grep -rn 'early answer at the client\|late is still counted' .repos/status/src` printed nothing.

## Repository: status

Files:
- `src/subscribe-test-support.ts` (changed)
- `src/subscribe-timing.test.ts` (changed)
- `README.md` (changed)
- `docs/development.md` (changed)

Behavior change: no

Only test code and developer docs change; no production module, setting,
endpoint or tooling changes.

### Tool facts (cited)

- Bun 1.4.0: `package.json:9` (`engines`), `package.json` `"packageManager": "bun@1.4.0"`, and
  the pinned CI `check.yml:22-24` (`setup-bun` with `bun-version: 1.4.0`).
- Scripts: `test` is `bun test` (`package.json:14`). `lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`:15`). `typecheck` runs TypeScript 7 on
  the root and `e2e` projects (`:13`). `check` is `bun run lint && bun run typecheck && bun run test` (`:19`).
- Coverage: `bunfig.toml:1-4` is the whole file: `[test]`, `coverage = true`,
  `coverageThreshold = { lines = 0.8, functions = 0 }`, and ignore patterns that include
  `**/*.test.ts`. `src/subscribe-test-support.ts` is not ignored, so it counts toward coverage; the new
  hook line is run by the tests.
- Focused runs: `bun test --help` (Bun 1.4.0) lists `-t, --test-name-pattern` and
  `--rerun-each`. `bun --help` lists `-c, --config=<val>` ("Specify path to Bun config file.
  Default $cwd/bunfig.toml"). Measured: `bun test --config=/dev/null src/subscribe-timing.test.ts`
  on the base exits 0 with `11 pass`; without `--config=/dev/null` it exits 1 on coverage
  (`All files` 25.26 % lines, `0 fail`).
- TypeScript: `tsconfig.json:2` extends `@lorenzh/pulse-config/tsconfig.base.json` and `:3`
  includes `src`. At the pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`),
  `tsconfig.base.json:8` `strict`, `:9` `noUncheckedIndexedAccess` (so `scheduler.timers[1]` is
  `ManualTimer | undefined`; use `?.`), `:11` `exactOptionalPropertyTypes`, `:14`
  `erasableSyntaxOnly`.
- Biome: `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. At the pin, its
  `files.includes` (`:10-16`) covers `**` except `dist`, `node_modules`, `bun.lock`, `*.html` and
  `**/test/fixtures`, so both changed `.ts` files are linted. Biome 2.6.3 is pinned at
  `package.json:23`.
- ESLint: `eslint.config.js:4` spreads the pinned config. At the pin, `eslint.config.js:16` sets
  `sonarjs/cognitive-complexity` to 15 and `:27` sets `@typescript-eslint/no-floating-promises`.
  The `void requestJson(…).then(…).then(…)` chain stays `void`-prefixed.
- Pre-commit: `lefthook.yml:1-2` extends the pinned `lefthook.yml:1-8` (Biome and ESLint on
  staged files). Never use `--no-verify`.
- CI: `.github/workflows/ci.yml:16-18` calls the pinned
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…` without `build`. Its steps
  (`check.yml:25-38`) are install `--frozen-lockfile`, `bun run lint`, `bun run typecheck`,
  `bun run test`.
- The pinned files `.github/workflows/check.yml`, `biome.json`, `eslint.config.js`,
  `tsconfig.base.json` and `lefthook.yml` were read with
  `gh api "repos/lorenzh/pulse-config/contents/<path>?ref=04108fa…"`. The first four are
  byte-identical to the config clone (`main` at `bc87049`); `lefthook.yml` was read at the pin only.

### Steps

1. Record `BASE=$(git rev-parse HEAD)` on status `main` before any edit (full SHA). Install with
   `bun install --frozen-lockfile`. Create a disposable base checkout outside the implementation
   tree (for example `git clone <repo> /tmp/status-base && git -C /tmp/status-base checkout "$BASE"`,
   then install there too). Never use `.repos/`.
2. Baseline controls on the base checkout. Each must run and exit 0 there (they did at `2cefdf1`
   in this spec run):
   - `bun test --config=/dev/null src/subscribe-timing.test.ts -t "^D22"`, 3 runs: `10 pass`, `0 fail` each.
   - `bun test --config=/dev/null src/subscribe-enumeration.test.ts`: `4 pass`, `0 fail`.
   - `bun test --config=/dev/null src/subscribe-timing.test.ts -t "self-check"`: `1 pass`, `0 fail`.
     Isolated, it passes; the race shows only under load.
   - `bun run lint` and `bun run typecheck`: exit 0.
   - One full `bun run test`: record the exit status, `Ran <n> tests across <m> files`
     (`662`/`44` at `2cefdf1`) and any attributed failures. This is not claimed stable.
3. Red: write the regression (required behavior 3 and 4) and the gate in
   `src/subscribe-timing.test.ts`. Copy **only** that file into the base checkout (the base
   `src/subscribe-test-support.ts` stays). Run
   `bun test --config=/dev/null src/subscribe-timing.test.ts -t "late is still counted"` three times.
   Each run must exit 1 with `0 pass`, `1 fail`, and the failure must be
   `AssertionError: false == true` at `assert.ok(driven.bytesBeforeRelease > 0)` of the new test.
   Not red evidence: an import or syntax error, `gave up waiting`, a different assertion, or an
   exit 1 with `0 fail`. `bun run typecheck` of this overlay on the base is not evidence either,
   because the base `DriveOptions` has no `beforeRelease`. Then restore the base checkout
   (`git -C /tmp/status-base checkout -- . && git -C /tmp/status-base status --porcelain` empty)
   before the CPU samples.
4. Green: add `beforeRelease` to the driver (required behavior 1) and the hook to the existing
   self-check (required behavior 2). Run the same focused command three times: exit 0, `1 pass`,
   `0 fail` each. Run `bun test --config=/dev/null src/subscribe-timing.test.ts`: `12 pass`, `0 fail`
   (the 11 of the base plus 1). Run the enumeration and D22 controls of step 2 again: same counts, `0 fail`.
5. Mutation controls in a throwaway copy of the candidate (not committed), one at a time, each
   followed by `bun test --config=/dev/null src/subscribe-timing.test.ts -t "self-check"`:
   - (m1) move `await options.beforeRelease?.(client)` below the byte count: the regression fails
     with `AssertionError: false == true` at the byte assertion.
   - (m2) move it below the release fire: the same failure.
   - (m3) remove `openGate()` from the regression's hook: the run fails with
     `gave up waiting for early answer at the client` (the wait is bounded and does not hang).
   Record each command, the expected failure and the actual output, then discard the copy.
6. Update `README.md` and `docs/development.md` (required behavior 5).
7. Commit with Conventional Commit subjects (for example
   `test: wait for early client data before the release in the timing self-check`). Use the normal
   hooks.
8. Run `bun run check` (see Decisions), the 50-run loop (acceptance 6), and the CPU samples
   (Performance impact), all on the final commit.

### Acceptance

The source of each expected value is given in brackets.

1. **Baseline controls.** Step 2 runs on `BASE`, with the commands, counts and exit statuses
   recorded. Every control named there exits 0 with `0 fail` and the counts given there, or, if
   `BASE` is newer than `2cefdf1`, with the counts printed by that base run, recorded before any
   edit. [Literal counts measured at `2cefdf1` in this spec; for a newer base, the base run itself.]
2. **Red, 3 of 3.** Step 3 output for all three runs: exit 1, `0 pass`, `1 fail`, the new test's
   name and `AssertionError: false == true` at `assert.ok(driven.bytesBeforeRelease > 0)`.
   [Literals; the prototype in this spec produced exactly this 3 of 3.]
3. **Green.** Step 4: the regression exits 0 with `1 pass`, `0 fail` in 3 of 3 runs. The whole
   file gives `12 pass`, `0 fail`, and the D22 and enumeration controls repeat their base counts.
   [Literal counts: 11 base tests plus 1 new.]
4. **Mutation controls.** (m1), (m2) and (m3) of step 5 each fail as stated. [The literal
   failure texts in step 5.]
5. **Preserved assertions.** In `git diff "$BASE" HEAD -- src/subscribe-timing.test.ts`, no
   existing `assert` line is removed or changed. In particular, these stay unchanged:
   `assert.ok(driven.bytesBeforeRelease > 0)`, both `assert.throws(… /0/)` and `(… /1500/)`, the
   literal `[5000, 2000, 2000]`, every line of `checkRequest`, and the zero-byte check at the old
   line 145. `git diff --exit-code "$BASE" HEAD -- src/subscribe-enumeration.test.ts` exits 0. In
   `src/subscribe-test-support.ts`, the diff adds only the `beforeRelease` field with its JSDoc and
   the one `await options.beforeRelease?.(client);` line, between the 50-turn loop and the byte
   count. The `for (let turn = 0; turn < 50; …)` line is unchanged. A `grep -nE
   'setTimeout|setInterval|sleep|Bun\.sleep|Date\.now|performance\.now'` over the added lines
   prints nothing. [Literal lines of the base file; the grep has a literal empty expected output.]
6. **50-run stability evidence.** On the final commit, on one machine, in one shell loop, run 50
   consecutive full `bun run test` invocations, for example:
   `for i in $(seq 1 50); do bun run test >/tmp/run-$i.txt 2>&1; echo "run $i exit=$? $(awk '/^src\/.*\.test\.ts:$/{f=$0} /^\(fail\)/{print f" "$0}' /tmp/run-$i.txt | tr '\n' ' ')"; done`.
   The awk attributes each `(fail)` line to the last file header that Bun printed before it. Pass
   when the 50 lines show 0 failures attributed to `src/subscribe-timing.test.ts:` and follow the
   loop rules of Decisions. Record the revision (`git rev-parse HEAD`), `bun --version` (`1.4.0`),
   the command, all 50 lines, and the summary line in the PR form of Decisions. Every
   `Ran <n> tests` line shows the base count plus 1. A loop on one file, `--rerun-each`, retries of
   single tests or a sum over several sequences is not this evidence. For comparison, run the same
   loop of 50 on the disposable base checkout, after the overlay has been removed, on the same
   machine. Report its attributed failure counts per file and test next to the candidate's. This
   is information only, not a gate: the base is expected to show some subscribe-timing and other
   failures. [Literal 50 and literal 0; the attribution comes from Bun's own output.]
7. **Check.** `bun run check` exits 0 on the final commit with the unchanged `bunfig.toml`
   (coverage gate on). Report every attempt (see Decisions). [The command's exit status.]
8. **Docs.** `git diff "$BASE" HEAD -- README.md docs/development.md` shows a change under
   `## Development` in `README.md` and under `## Checks` in `docs/development.md` with the content of
   required behavior 5, and no other section changes. Neither text mentions a new setting or a change
   to the 2 s answer delay. [The section names of the base files.]
9. **Scope**, after the last commit, each check separately:
   - `git diff --name-only "$BASE" HEAD | sort` equals exactly these four lines:
     `README.md`, `docs/development.md`, `src/subscribe-test-support.ts`,
     `src/subscribe-timing.test.ts`. [This literal allowlist.]
   - `git diff --name-only --cached` prints nothing. `git diff --name-only` prints nothing.
   - `git status --porcelain` prints nothing (also no untracked files).
   - `git diff --exit-code "$BASE" HEAD -- . ':(exclude)README.md' ':(exclude)docs/development.md' ':(exclude)src/subscribe-test-support.ts' ':(exclude)src/subscribe-timing.test.ts'`
     exits 0. This protects every other tracked path. Named explicitly as well, so that a wrong
     pathspec cannot pass:
     `git diff --exit-code "$BASE" HEAD -- AGENTS.md CLAUDE.md package.json bun.lock bunfig.toml biome.json eslint.config.js lefthook.yml tsconfig.json Dockerfile .dockerignore .github public e2e bench scripts docs/configuration.md docs/index.md docs/install.md docs/operation.md docs/theming.md docs/troubleshooting.md src/subscribe-enumeration.test.ts src/subscribe-routes.test.ts src/server.ts src/server.test.ts`
     and, for every other file under `src/`,
     `git diff --exit-code "$BASE" HEAD -- $(git ls-tree -r --name-only "$BASE" src | grep -vx 'src/subscribe-test-support.ts\|src/subscribe-timing.test.ts')`
     exits 0.
   - `git diff --check "$BASE" HEAD` exits 0.
   - Do not redefine `BASE` after the first commit. Keep all evidence files outside the
     repository, and add no ignore rules.
10. **Proof of the scope checks.** In a disposable Git fixture repository with its own recorded
    base (not the status branch), with one allowed file and one protected file, record the
    command, the expected result and the actual exit status for each case:
    - (a) unstaged protected change: `git diff --name-only` is not empty;
    - (b) staged protected change: `git diff --name-only --cached` is not empty;
    - (c) committed protected change with a clean worktree: the allowlist comparison and the
      `--exit-code` diff reject it;
    - (d) untracked file: `git status --porcelain` is not empty;
    - (e) restored worktree after staging: stage a protected change, then restore only the
      worktree file to the base content. `git diff "$BASE" -- <file>` (worktree against base) is
      empty, but `--cached` and `git status --porcelain` reject the state;
    - (f) restored worktree after a commit: commit a protected change, then restore only the
      worktree file to the base content. The worktree-against-base diff is empty, but
      `git diff --exit-code "$BASE" HEAD -- <file>` and `git status --porcelain` reject the state;
    - (g) a clean commit that changes only the allowed file: every check passes.
11. **Comments.** Read every added line of `git diff "$BASE" HEAD` (code, JSDoc and inline). The
    PR body lists every added or changed comment line word for word: at least the `beforeRelease`
    JSDoc. Add no explanatory comments to the new test. No new test file is created. Write "none"
    only for a category that has none after that read.
12. **Performance (information only).** The PR reports the five interleaved samples per revision
    as described in "Performance impact": raw values, exit statuses, medians, and the delta in
    seconds and percent. No Docker bench.
13. **PR.** The body has `Closes lorenzh/pulse-meta#<child>` and names #891. It lists `BASE`, the
    checks that ran with their results (acceptance 1-12), the 50-run summary line, and the known
    limits: the two other base flakes (`src/server.test.ts` `502 when the API is down`,
    `src/subscribe-enumeration.test.ts` `R8 L9 full …`), which are not fixed here.
