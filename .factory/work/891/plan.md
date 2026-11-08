# Spec: status — stop the subscribe-timing self-check from failing intermittently (#891)

## Goal

The self-check `self-check: an early answer fails check 2, a 2000 call timeout fails check 1`
in `src/subscribe-timing.test.ts` of pulse-status fails now and then at line 290:
`assert.ok(driven.bytesBeforeRelease > 0)`. The test driver counts the client's bytes after a
fixed 50 event-loop turns. Sometimes the wrong handler's early answer has not reached the test
client by then. Make the self-check wait for observed client data (a bounded condition, no timer,
no sleep) before the driver counts the bytes and fires the release. Keep what the test proves: a
wrong handler that answers before the release fails check 2.

This is a test-only fix in one repository (status). No production code, setting, endpoint, type,
dependency, tooling, CI or documentation changes.

## Decisions carried from the issue, its comments and the issue review

1. The manager correction in the issue replaces the earlier four-file plan. `README.md` and
   `docs/development.md` are **not** changed. The change is test-only, so status `AGENTS.md`
   ("Update `README.md` in the same change when behavior, a setting, an endpoint, or a type
   changes") does not require a README edit. `docs/development.md` gives only general test
   advice (line 48: "hand-written fakes, no real clock and no external network"). It describes no
   timing self-check, so this change does not make it wrong. The allowed list is exactly the two
   files from `.factory/work/891/issue-review.md`. Plan, task and issue review agree on it.
2. The self-check behavior and the shared test driver change, so the section says
   `Behavior change: yes`, qualified as test-only (decision 2 of the issue review, and the
   earlier plan-review finding).
3. The wait goes inside the driver, before the byte count and before the release fires. A wait
   after `driveSubscribe` returns cannot fix a count that is already taken. Waiting for the fake
   notify to finish is not enough either (`finished` at `subscribe-timing.test.ts:57-61` sees the
   fake's response end, not the status client's bytes). Raising the 50-turn count is a fixed
   delay, which the issue rules out.
4. The wait is opt-in. The ordinary D22 and enumeration callers expect 0 bytes before the
   release. They must not wait for data that must not exist.
5. "Without a failure of this file" means: 50 consecutive `bun run test` runs on one machine
   with 0 failures attributed to `src/subscribe-timing.test.ts`. Every run's exit status and
   every failure is reported. Earlier plan and plan-review comments accepted this reading, and
   the issue review (decision 8) keeps it. Failures in other files are known limits. They are
   reported, never hidden, and not fixed here.
6. A full-suite run on the base is only an observation, not a passing control. It may fail
   because of the known unrelated flakes. Its result is recorded as it is.
7. The findings branch `factory/findings/891` does not exist:
   `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/891` returned HTTP 404 on
   2026-11-08. That is normal before child issues exist. There are no shared findings to cite.

## Current behavior (verified on status `main` 2cefdf1cfbbd7cce175a9df97dbdafdec0e925aa)

- `src/subscribe-test-support.ts:272-279` `DriveOptions` has `isCalling`, `settle` and
  `isCallTimeoutFired`. Nothing gives the caller access to the client before the byte count.
- `src/subscribe-test-support.ts:285-329` `driveSubscribe`:
  1. sends the form request with `rawClient` (lines 296-299);
  2. waits until the timers are registered and the notify call has arrived (lines 300-306);
  3. runs `settle` (line 308) and, optionally, fires the call timer (lines 309-316);
  4. yields exactly 50 `setImmediate` turns (lines 317-318, comment "Give a wrong handler every
     chance to write early.");
  5. takes `bytesBeforeRelease = client.received().length` (line 319);
  6. fires the release timer `scheduler.timers[start + 1]` (line 320) and waits for
     `client.closed` (line 321).
- `src/subscribe-test-support.ts:183-204` `RawClient` keeps every received chunk in a socket
  `data` listener and exposes `received()`.
- `src/subscribe-test-support.ts:235-242` `waitUntil(isDone, what)` yields `setImmediate` turns
  until `isDone()` holds and throws `gave up waiting for <what>` after 20,000 turns. It uses no
  timer and no clock.
- `src/subscribe-timing.test.ts:246-277` `wrongServer(scheduler, notifyUrl, wrong)` is a wrong
  subscribe handler. It registers the body timer (5000) and the release timer (2000, which writes
  `answer`), then calls notify through `requestJson` with timeout 1500, or 2000 for the
  `"call timeout 2000"` variant. In the `"early answer"` variant it writes the answer as soon as
  `requestJson` resolves (lines 269-271).
- `src/subscribe-timing.test.ts:279-300` is the only self-check in this file. It loops over
  both variants:
  - `"early answer"`: asserts `driven.bytesBeforeRelease > 0` (line 290) and that
    `checkRequest` throws `/0/` (check 2, line 291). This is the race. `requestJson` resolves
    in the wrong server only after the fake notify's response has crossed a real socket. Then
    the answer crosses a second socket to the raw client. 50 turns do not guarantee that both
    hops have completed.
  - `"call timeout 2000"`: asserts the registrations `[5000, 2000, 2000]` (lines 293-296) and
    that `checkRequest` throws `/1500/` (check 1, line 297). The driver already waits for 3
    registrations (lines 301-306), so the values are present when it returns. This variant has
    no observation race. It expects no early bytes, so a wait for bytes would hang it until the
    20,000-turn bound.
- Other callers of `driveSubscribe`: the D22 cases (`subscribe-timing.test.ts:167-171`, `:199`)
  and `subscribe-enumeration.test.ts:98-103`, which asserts `bytesBeforeRelease === 0`. Search:
  `grep -rn "driveSubscribe\|bytesBeforeRelease" src e2e` in the status clone found no other
  callers.
- Another self-check exists in a different file (`src/subscribe-routes.test.ts:486`). It is
  outside this issue ("the other self-checks of the file") and is not touched.

## Scope

- status only: the shared test driver `src/subscribe-test-support.ts` and
  `src/subscribe-timing.test.ts`.

## Non-goals

- No production code (`src/subscribe*.ts` handlers, `src/server.ts`, …), no setting, endpoint
  or type change.
- No README, `docs/` or `AGENTS.md` change (decision 1).
- No change to the 50-turn loop, `waitUntil`, `rawClient`, the manual scheduler, `checkRequest`
  or any D22 or enumeration expectation.
- No fix for the unrelated intermittent failures in `src/server.test.ts` ("502 when the API is
  down") and `src/subscribe-enumeration.test.ts` ("R8 L9 full …"). Each needs its own issue.
- No change to `src/subscribe-routes.test.ts` or its self-check.
- No Docker bench run (host port collision, #834).

## Required behavior

### R1: a `beforeRelease` hook in the driver

`DriveOptions` (`src/subscribe-test-support.ts`) gets one optional field:

```ts
  /** Runs before the bytes are counted and the release fires (for example: wait for an early answer). */
  beforeRelease?: (client: RawClient) => Promise<void> | void;
```

`driveSubscribe` awaits it exactly once, after the existing 50-turn loop and immediately before
`const bytesBeforeRelease = client.received().length;`:

```ts
  for (let turn = 0; turn < 50; turn++) await new Promise((r) => setImmediate(r));
  await options.beforeRelease?.(client);
  const bytesBeforeRelease = client.received().length;
  scheduler.timers[start + 1]?.fire();
```

Without the option, the driver behaves exactly as on the base. The 50 turns stay. They give a
wrong production handler its chance to write early, which makes the zero-byte assertions mean
something.

### R2: the existing self-check waits for client data in the early-answer variant

In `src/subscribe-timing.test.ts`, add a module-level helper next to the self-check:

```ts
const earlyBytes = (client: RawClient): Promise<void> =>
  waitUntil(() => client.received().length > 0, "early answer bytes");
```

The `"early answer"` iteration passes `beforeRelease: earlyBytes`. The `"call timeout 2000"`
iteration passes no hook. Both iterations keep every assertion as it is: `bytesBeforeRelease > 0`
and `checkRequest` throwing `/0/`, and `[5000, 2000, 2000]` and `checkRequest` throwing `/1500/`.
The test name stays as it is.

Review result for "the same pattern in the other self-checks of the file": the file has one
self-check with two variants. Only the early-answer variant asserts data that arrives
asynchronously over a socket. The call-timeout variant asserts registrations that the driver
already waits for. It needs no wait and gets none.

### R3: a deterministic regression for the hook's position

`wrongServer` gets an optional fourth parameter `gate?: Promise<void>`. The early-answer write
runs only after the gate resolves. Without a gate the behavior is the same as on the base
(`await undefined`):

```ts
      })
        .then(() => gate)
        .then(() => {
          if (wrong === "early answer") write(res);
        });
```

A new test in `src/subscribe-timing.test.ts`:

```ts
test("self-check: an early answer let through just before the release is counted", async () => {
  const scheduler = manualScheduler();
  const notify = await startFakeNotify(ok, scheduler);
  cleanups.push(() => notify.close());
  const gate = Promise.withResolvers<void>();
  const port = await wrongServer(scheduler, notify.url, "early answer", gate.promise);
  const releaseStates: string[] = [];
  const driven = await driveSubscribe(port, scheduler, notify, K, {
    isCalling: true,
    settle: finished,
    beforeRelease: async (client) => {
      gate.resolve();
      await earlyBytes(client);
      releaseStates.push(...scheduler.timers.filter((t) => t.ms === 2000).map((t) => t.state));
    },
  });
  assert.ok(driven.bytesBeforeRelease > 0);
  assert.deepEqual(releaseStates, ["live"]);
  assert.throws(() => checkRequest(driven, { isCalling: true }), /0/);
});
```

The gate makes the early answer possible only once the hook runs. The result therefore depends
only on where the driver calls the hook, not on turn counts or machine speed:

- The hook runs before the count: data is seen, the count is > 0, and the release timer is
  still `live` when the data arrives. The test passes.
- The hook is missing (base), or runs after the count or after the release: the count is 0. The
  test fails at `assert.ok(driven.bytesBeforeRelease > 0)` with `AssertionError: false == true`.

`RawClient` is added to the existing type import from `./subscribe-test-support.ts`.

An equivalent design is allowed only if it keeps these properties: the wait sits inside the
driver before the count and the release, it is opt-in, it uses a condition, and a gated
regression fails for each of the three wrong positions. The names in `## Contract fields` must
then be searched again.

### R4: no real timers, no fixed delays

The change adds no `setTimeout`, `setInterval`, `Bun.sleep`, `Date.now`/`performance.now`
reads and no new turn-count loops. Waits use `waitUntil` (bounded `setImmediate` turns) only.
Servers created in the new test are closed through the existing `cleanups` (`wrongServer` already
pushes `closeServer`; the test pushes `notify.close()`).

## Risks

- **The waits hang a caller that expects no bytes.** Mitigation: the hook is opt-in. Only the
  early-answer self-check and the new regression use it. The 20,000-turn bound of `waitUntil`
  turns a hang into a failure that names `early answer bytes`.
- **The gate promise is never resolved on the base or in a wrong-position mutant.** The pending
  `.then` holds only a closure. `res.writableEnded` guards the late write. `cleanups` closes the
  servers. No dangling handle stays open. This was seen in the scratch trial: the red runs ended
  in about 0.1 s, not at a timeout.
- **Unrelated flakes in the 50-run loop.** In a scratch trial with the fix (see Evidence), 1 of
  50 runs failed in `src/server.test.ts` ("502 when the API is down"). Earlier comments also
  report `src/subscribe-enumeration.test.ts` "R8 L9 full …". They are reported as known limits
  (decision 5).
- **Coverage.** `src/subscribe-test-support.ts` is not matched by
  `coveragePathIgnorePatterns` (`bunfig.toml:4`), so it counts toward the 80 % line gate
  (`bunfig.toml:3`). The one added line runs in the new tests, so coverage cannot drop.

## Evidence from a scratch trial (planning only, not acceptance)

The design was tried in a throwaway copy of status `2cefdf1` under `/tmp` with Bun 1.4.0. No
target repository was written.

- New regression with the base driver: failed 3 of 3 in isolation at
  `src/subscribe-timing.test.ts:326` `assert.ok(driven.bytesBeforeRelease > 0)`,
  `AssertionError: false == true`.
- Hook moved after the count: failed 3 of 3, same line and message. Hook moved after the
  release: failed 3 of 3, same line and message.
- Fixed: `bun test src/subscribe-timing.test.ts` gave 12 pass / 0 fail 3 of 3. `bun run lint`
  exit 0 (3 warnings and 40 infos, the same counts as on the base). `bun run typecheck` exit 0.
- 50 consecutive `bun run test` runs with the fix: 49 exited 0. Run 33 exited 1 with
  `(fail) 502 when the API is down` under `src/server.test.ts:`. 0 failures were attributed to
  `src/subscribe-timing.test.ts`.
- Base controls: `bun run lint` exit 0, `bun run typecheck` exit 0, and
  `bun test src/subscribe-timing.test.ts --test-name-pattern "D22"` 10 pass / 0 fail 3 of 3.

The implementer repeats all of this on the recorded base. These numbers are not acceptance
evidence.

## Performance impact

Only `test_cpu_s` of status (`bench/budgets.json` in api `515031b`, `"status"` →
`"test_cpu_s"`, budget 3.4 s, gating) can move. Expected effect: none to +0.05 s. The change adds
one test and one bounded wait, which replaces a race. A scratch trial with 5 interleaved
base/branch `bun run test` runs measured user+system CPU of 4.28/4.25, 4.30/4.28, 4.19/4.30,
4.24/4.25 and 4.24/4.24 s: median 4.24 s (base) and 4.25 s (branch), a delta of +0.01 s. That
is inside noise. The local value is above the bench budget because the bench measures in its
own environment; it is not comparable. Startup CPU, load CPU, idle and peak RSS, build CPU,
startup wall-clock, p95 latency, requests per second and image size cannot move: no production
code or image content changes (test files are not in the image, `ci.yml` step "Check the image
holds no test files").

Measurement (information only, the machine is shared and noisy): five interleaved pairs on one
machine. For each run, `/usr/bin/time -o <file> -f "%U %S" bun run test`, with the base worktree
and the branch worktree alternating (base, branch, base, branch, …). Report every run's
user+system seconds, the median of each side, and the delta median(branch) − median(base),
rounded to 0.01 s. A median of 5 values is the 3rd value after sorting; no percentile is
averaged. Do not run the Docker bench (#834).

## Security impact

Security impact: no. The change touches only test code: no admin route, authentication, parser,
validator, probe client, file write, error or log text, dependency, Dockerfile or CI.

## Rollout order

One repository: only status changes, and no other repository consumes its test files.

## Counterexamples

- **Hook after the byte count** (`bytesBeforeRelease` read, then `await options.beforeRelease`):
  the new regression must fail. The gate opens only after the count, so the count is 0. Seen in
  the scratch trial: 3 of 3 failed at `bytesBeforeRelease > 0`.
- **Hook after the release fires:** the count is taken before the gate opens, so it is 0. The
  regression must fail (3 of 3 in the scratch trial).
- **No hook at all (the base driver):** the regression must fail for the same reason, 3 of 3.
- **Fixed delay instead of a condition** (for example the 50-turn loop raised to 500, or a
  `setTimeout`/`Bun.sleep`): ruled out by R4. Against a gate, no number of turns opens it, so the
  regression still fails.
- **Unconditional wait in the driver** (`waitUntil(() => client.received().length > 0)` for
  every caller): every D22 case and every enumeration case would fail with
  `gave up waiting for …` after 20,000 turns. Their 0-byte expectation must keep passing.
- **Wait added to the call-timeout variant:** that variant writes nothing before the release.
  A bytes wait would fail with `gave up waiting for early answer bytes`. It must keep asserting
  `[5000, 2000, 2000]` and `/1500/` without a hook.
- **Wait after `driveSubscribe` returns:** it cannot raise `bytesBeforeRelease`, which is already
  fixed. The regression would still fail.
- **Weakened assertion** (for example `>= 0`, or removing `assert.ok(driven.bytesBeforeRelease
  > 0)`): forbidden. The acceptance diff check (A6) rejects it.

Statistics:

- **50-run loop:** the sample is 50 consecutive invocations of `bun run test` in the branch
  worktree on one machine. There are no retries, and no run is dropped or restarted. A run
  "fails this file" if its log has at least one `(fail)` line under the header
  `src/subscribe-timing.test.ts:` (bun prints `src/<file>.test.ts:` before each file's
  results), or if the run ends without a test summary (crash or hang). An unattributed nonzero
  exit counts as a failure of the file. Reported: the per-run exit status, every failure with its
  file, the count of nonzero exits, and the count of runs that fail this file. The required value
  is 0.
- **CPU:** see `## Performance impact` (median of 5 per side, delta rounded to 0.01 s,
  information only).

## Contract fields

New names, all in status test code only: `beforeRelease` (field of the exported test interface
`DriveOptions`), `gate` (parameter of the test-local `wrongServer`), `earlyBytes` and
`releaseStates` (test-local constants). No route, wire field, setting or contract name changes.

Searches on 2026-11-08, excluding `node_modules` and `.git`:

```sh
for r in contract config kit status; do
  for n in beforeRelease earlyBytes releaseStates; do grep -rn --exclude-dir=node_modules --exclude-dir=.git "$n" .repos/$r; done
  grep -rnw --exclude-dir=node_modules --exclude-dir=.git gate .repos/$r
done
grep -n gate .repos/status/src/subscribe-timing.test.ts .repos/status/src/subscribe-test-support.ts
```

- contract `6370c25`, config `bc87049`, kit `536133f`, status `2cefdf1`: `beforeRelease`,
  `earlyBytes` and `releaseStates` match nothing.
- `gate` as a whole word: only prose. Config `README.md:43,70,92` and a comment in
  `.github/workflows/release.yml:3` (release gate jobs). Status `docs/development.md:41`
  (coverage gate) and `:78` (release gate). No identifier.
- `gate` in the two changed files: 0 matches, so the new parameter hides nothing.

## Repository: status

Files:
- `src/subscribe-test-support.ts` (changed)
- `src/subscribe-timing.test.ts` (changed)

Behavior change: yes. This is a test-only change: the shared test driver gains the opt-in
`beforeRelease` hook, `wrongServer` gains the `gate` parameter, and the early-answer self-check
now waits for client data. No production code, setting, endpoint, type, tooling or CI changes.

If the recorded base already waits for observed client data before `bytesBeforeRelease` is
taken (a hook or a condition between the 50-turn loop and the count in `driveSubscribe`), request
a hold with status `needs-input`. Do not open a review in that case.

No README change is needed: the change is test-only, and status `AGENTS.md` asks for a README
update only when behavior, a setting, an endpoint or a type changes. `docs/development.md` does
not describe timing self-checks (only general test advice at line 48), so it stays unchanged too.
Both are protected paths.

### Tool facts (status `2cefdf1`, config pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`)

- Bun 1.4.0: `package.json:9` (`engines.bun`) and `:38` (`packageManager`).
- `bun run test` is `bun test` (`package.json:14`). `bun run check` is
  `bun run lint && bun run typecheck && bun run test` (`package.json:19`). `bun run lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`). `bun run typecheck`
  runs `tsc --noEmit` from `typescript7` for the root and `e2e` (`package.json:13`).
- `bunfig.toml:1-4` `[test]`: `coverage = true`, `coverageThreshold = { lines = 0.8, functions =
  0 }`, and `coveragePathIgnorePatterns` with `**/*.test.ts`, `test/**`, `**/test/**` and
  `dist/**`. `src/subscribe-test-support.ts` is therefore covered and counts.
- Biome 2.6.3 (`package.json:23`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`
  (config pin at `package.json:24`). At the pin, `biome.json` `files.includes` is `**` minus
  `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures` (lines 8-16). Both changed
  files are in scope. The pinned file is identical to the config clone (`bc87049`), checked with
  `gh api …/contents/biome.json?ref=04108fa…` and `diff`.
- CI: `.github/workflows/ci.yml:17-18`, job `check`, uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`. At the pin, that workflow
  installs Bun 1.4.0 (lines 22-24), then runs `bun install --frozen-lockfile` (26), `bun run lint`
  (28), `bun run typecheck` (30) and `bun run test` (38). The pinned file is identical to the
  config clone.
- `bun test` strips types without checking them. On the base driver, the new test runs, and the
  unknown `beforeRelease` option is ignored at run time. It is not a compile error, so the red
  run fails at the assertion, not at load time. (`bun run typecheck` would reject the option on
  the base. That is why red runs use `bun test`, not `bun run check`.)

### Steps

1. Record `BASE=$(git rev-parse HEAD)` on a clean `main` before any change. Record
   `bun --version` (expected literal `1.4.0`). Write the protected-path list:
   `git ls-tree -r --name-only "$BASE" | grep -vxF -e src/subscribe-test-support.ts -e src/subscribe-timing.test.ts > /tmp/protected-891.txt`.
2. Baseline controls on `BASE`, each with its command and result reported. Every control must
   pass on the base:
   - C1 `bun run lint` exits 0.
   - C2 `bun run typecheck` exits 0.
   - C3 `bun test src/subscribe-timing.test.ts --test-name-pattern "D22"` exits 0 with
     `10 pass` and `0 fail`, 3 times.
   - C4 the base matches this spec:
     `grep -n "beforeRelease" src/subscribe-test-support.ts src/subscribe-timing.test.ts` prints
     nothing (exit 1). If it prints something, apply the hold rule above.

   No enumeration test is a control: `src/subscribe-enumeration.test.ts` has a known flake
   ("R8 L9 full …").

   Observation only, **not** a passing control: one full `bun run test` on `BASE`. Record its
   exit status, `Ran N tests across M files` and every `(fail)` line with its file header. It may
   fail because of the known unrelated flakes.
3. Red: add the R3 regression and the `gate` parameter to `src/subscribe-timing.test.ts` only,
   with the driver still at `BASE`. Run
   `bun test src/subscribe-timing.test.ts --test-name-pattern "just before the release"` 3 times.
   Each run must report `1 fail` and `AssertionError: false == true` at the
   `assert.ok(driven.bytesBeforeRelease > 0)` line of the new test. A load error, a type error or
   a `gave up waiting` message is not a valid red.
4. Green: add R1 to `src/subscribe-test-support.ts` and the R2 hook to the existing self-check.
5. Mutation proof (scratch only, not committed): move `await options.beforeRelease?.(client);`
   (a) after the `bytesBeforeRelease` line, and (b) after the release `fire()` line. For each, run
   the regression 3 times in isolation; every run fails at the same assertion. Restore with
   `git checkout -- src/subscribe-test-support.ts` and re-apply R1, or keep the change in a
   stash. Report each result.
6. Commit with a Conventional Commit subject (for example
   `test: wait for the early answer before counting bytes in the timing self-check`). Run the
   checks and the evidence below on the committed `HEAD`.

### Acceptance

Expected values are literals in each check, or the recorded `BASE` (an independent source:
the commit before the change).

- A1 **Baseline controls:** C1–C4 of step 2 ran on `BASE` and passed as stated (C1 and C2 exit 0;
  C3 `10 pass` and `0 fail` 3 times; C4 prints nothing). The full-suite observation is recorded
  with its real exit status, and it is excluded from this passing requirement.
- A2 **Red on the base:** step 3 output: 3 of 3 isolated runs fail with
  `AssertionError: false == true` at `assert.ok(driven.bytesBeforeRelease > 0)` in the new test.
- A3 **Green:** `bun test src/subscribe-timing.test.ts` on `HEAD` exits 0 with `12 pass` and
  `0 fail` (the base has 11 tests; the regression adds 1). Run it 3 times.
- A4 **Mutation:** step 5 shows 3 of 3 failures for each of the two wrong hook positions, at
  the same assertion.
- A5 **Hook is opt-in:** on `HEAD`, `grep -c "beforeRelease" src/subscribe-enumeration.test.ts`
  prints `0`, and in `src/subscribe-timing.test.ts` `beforeRelease` appears only in the
  self-check (`earlyBytes` in the early-answer iteration) and in the new regression. Check with
  `grep -n "beforeRelease" src/subscribe-timing.test.ts`: every line is at or after the
  `// ---- Self-check` marker.
- A6 **Assertions kept:** `git diff "$BASE" HEAD -- src/subscribe-timing.test.ts` has no removed
  (`-`) line that contains `assert`, and these literal lines are still in the file:
  `assert.ok(driven.bytesBeforeRelease > 0);`,
  `assert.throws(() => checkRequest(driven, { isCalling: true }), /0/);`,
  `assert.throws(() => checkRequest(driven, { isCalling: true }), /1500/);`,
  `[5000, 2000, 2000],`, `assert.equal(driven.bytesBeforeRelease, 0);` and
  `assert.deepEqual(delays, c.isCalling ? [5000, 2000, 1500] : [5000, 2000]);`.
  `git diff "$BASE" HEAD -- src/subscribe-test-support.ts` removes no line (`-` count 0, apart
  from the `+++`/`---` headers), and the 50-turn loop line
  `for (let turn = 0; turn < 50; turn++) await new Promise((r) => setImmediate(r));` is
  unchanged.
- A7 **No timers or sleeps added:** the added lines of `git diff "$BASE" HEAD` contain no
  `setTimeout`, `setInterval`, `sleep`, `Date.now`, `performance.now` and no new `for`/`while`
  turn loop. Check: `git diff "$BASE" HEAD | grep '^+' | grep -E 'setTimeout|setInterval|sleep|Date\.now|performance\.now|for \(|while \('`
  prints nothing.
- A8 **50-run evidence:** 50 consecutive `bun run test` runs on `HEAD` on one machine, each log
  kept (`/tmp/891-runs/run-<i>.log`), for example:
  `for i in $(seq 1 50); do bun run test > /tmp/891-runs/run-$i.log 2>&1; echo "run $i exit $?"; done`.
  Attribute failures with
  `awk '/^src\/.*\.test\.ts:$/{f=$0} /^\(fail\)/{print FILENAME": "f" "$0}' /tmp/891-runs/run-*.log`,
  and list the runs without a `Ran N tests across` line. The required result is 0 runs that fail
  `src/subscribe-timing.test.ts` (definition in `## Counterexamples`). The PR body reports the
  base and head SHAs, `bun --version`, the command, all 50 exit statuses, every failure with its
  file, and the count of nonzero exits. No retries and no restarted counts. Failures in other
  files are listed as known limits.
- A9 **`bun run check`** on `HEAD` exits 0 (lint, typecheck and tests with the 80 % line gate).
  If it fails only because of a known unrelated flake, report that run and its failure, then
  rerun `bun run check` and report both runs. A failure in `src/subscribe-timing.test.ts`, or a
  lint, typecheck or coverage failure, is never rerun away.
- A10 **CPU (information only):** five interleaved base/branch pairs as in
  `## Performance impact`, with per-run values, both medians and the delta in the PR body. No
  Docker bench.
- A11 **Scope, commits:** `git diff --name-only "$BASE" HEAD` prints exactly the two lines
  `src/subscribe-test-support.ts` and `src/subscribe-timing.test.ts` (sorted, nothing else).
- A12 **Scope, index and worktree:** after the last commit, `git diff --name-only --cached`
  prints nothing, `git diff --name-only` prints nothing, and `git status --porcelain` prints
  nothing (this also catches untracked files).
- A13 **Protected paths:** `grep -cxF -e README.md -e docs/development.md -e AGENTS.md /tmp/protected-891.txt`
  prints `3`, and
  `xargs -a /tmp/protected-891.txt git diff --exit-code "$BASE" HEAD --` exits 0. Also
  `git diff --exit-code "$BASE" HEAD -- README.md docs/ AGENTS.md package.json bun.lock bunfig.toml biome.json .github/`
  exits 0.
- A14 **Scope-check fixture:** prove that A11–A13 catch each state separately. Use a disposable
  repository outside the target (for example `mktemp -d`, `git init`, files `a.ts`, `README.md`
  and `docs/development.md`; record `BASE`; allowed list `a.ts`). Report each expected result:
  - (a) only `a.ts` committed: all checks pass;
  - (b) `README.md` changed in a commit: A11 lists `README.md`, and the protected diff exits 1;
  - (c) `README.md` changed and staged only: `git diff --name-only --cached` prints `README.md`;
  - (d) `README.md` changed in the worktree only: `git diff --name-only` prints `README.md`;
  - (e) an untracked file: `git status --porcelain` prints `?? <file>`;
  - (f) restored-worktree trap, index: stage a `README.md` change, then
    `git restore --worktree --source="$BASE" README.md`. `git diff --name-only` is empty, but
    `git diff --name-only --cached` still prints `README.md`;
  - (g) restored-worktree trap, commit: commit a `README.md` change, then
    `git restore --worktree --source="$BASE" README.md`. The cached diff is empty, but
    `git diff --name-only "$BASE" HEAD` lists `README.md` and the protected diff exits 1.

  The fixture is validation evidence only. It is not added to pulse-status.
- A15 **Comments:** after reading every added line of `git diff "$BASE" HEAD` (inline comments
  included), the PR body lists each added comment verbatim. The plan expects exactly one: the
  JSDoc of `beforeRelease`. Write "none" only after that inspection. No new test file is created.
  If one becomes necessary, stop and request `needs-input`, because the allowed list would change.
- A16 **PR body:** names `Closes lorenzh/pulse-meta#<child>`, the checks that ran (A1–A13), the
  known limits (the unrelated flakes in `src/server.test.ts` "502 when the API is down" and
  `src/subscribe-enumeration.test.ts` "R8 L9 full …", which are not fixed here), and states that
  `README.md` and `docs/` are unchanged because the change is test-only.
