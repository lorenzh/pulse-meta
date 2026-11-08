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

1. **Scope (manager correction).** The allowed list is exactly `src/subscribe-test-support.ts`
   and `src/subscribe-timing.test.ts` (issue review, decision 1). `README.md`,
   `docs/development.md` and `AGENTS.md` are not changed and are protected paths. No README
   change is needed because the change is test-only, and status `AGENTS.md:88` asks for a README
   update only when behavior, a setting, an endpoint or a type changes. `docs/development.md`
   gives only general test advice (line 48: "hand-written fakes, no real clock and no external
   network"; line 41 names the 80 % coverage gate, which stays true). It describes no timing
   self-check, so it does not become wrong.
2. **Behavior classification.** The shared test driver and the self-check change, so the section
   says `Behavior change: yes`, qualified as test-only (issue review, decision 3).
3. **Where to wait.** The wait goes inside the driver, before the byte count and before the
   release fires. A wait after `driveSubscribe` returns cannot fix a count that is already taken.
   Waiting for the fake notify to finish is not enough (`finished` at
   `subscribe-timing.test.ts:57-61` sees the fake's response end, not the status client's bytes).
   Raising the 50-turn count is a fixed delay, which the issue rules out.
4. **Opt-in.** The ordinary D22 and enumeration callers expect 0 bytes before the release. They
   must not wait for data that must not exist.
5. **"Without a failure of this file"** means: 50 consecutive `bun run test` runs on one machine
   with 0 failures attributed to `src/subscribe-timing.test.ts` (issue review, decision 6). Every
   run's exit status and every failure is reported. Failures in other files are known limits:
   reported, never hidden, not fixed here, and never described as "50 green runs".
6. **Base full-suite run is an observation**, not a passing control. It may fail because of the
   known unrelated flakes. Its result is recorded as it is.
7. **Focused commands run without coverage (manager decision after the second spec review).**
   `bunfig.toml:2-3` turns coverage on with an 80 % line threshold for every `bun test` run. A
   focused run fails that threshold even when every selected test passes: on base `2cefdf1`,
   `bun test src/subscribe-timing.test.ts --test-name-pattern "D22"` printed `10 pass`, `0 fail`
   and exited 1 (verified 2026-11-08, Bun 1.4.0). Every focused command in this spec therefore
   uses an empty bunfig outside the repository:
   `mkdir -p /tmp/891-nocov && : > /tmp/891-nocov/bunfig.toml`, then
   `bun test --config=/tmp/891-nocov/bunfig.toml <file> [--test-name-pattern …]`. This was
   verified on the base (see `### Tool facts` and the evidence section). `bunfig.toml` is not
   changed; the threshold stays enforced in the full `bun run test` and `bun run check`.
8. **Findings.** `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/891` returned
   HTTP 404 on 2026-11-08. That is normal before child issues exist. There are no shared findings
   to cite.

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
- `src/subscribe-test-support.ts:183-204` `RawClient` (exported interface, line 183) keeps every
  received chunk in a socket `data` listener and exposes `received()`.
- `src/subscribe-test-support.ts:235-242` `waitUntil(isDone, what)` yields `setImmediate` turns
  until `isDone()` holds and throws `gave up waiting for <what>` after 20,000 turns. It uses no
  timer and no clock.
- `src/subscribe-test-support.ts:6-10` `ManualTimer` has `ms` and
  `state: "live" | "fired" | "cancelled"`.
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
- No change to `bunfig.toml`, `package.json` scripts or any config file (decision 7).
- No change to the 50-turn loop, `waitUntil`, `rawClient`, the manual scheduler, `checkRequest`
  or any D22 or enumeration expectation.
- No fix for the unrelated intermittent failures reported in earlier comments,
  `src/server.test.ts` ("502 when the API is down") and `src/subscribe-enumeration.test.ts`
  ("R8 L9 full …"). Each needs its own issue.
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

The `"early answer"` iteration passes `beforeRelease: earlyBytes`; the `"call timeout 2000"`
iteration passes no hook, for example:

```ts
    const driven = await driveSubscribe(port, scheduler, notify, K, {
      isCalling: true,
      settle: finished,
      ...(wrong === "early answer" ? { beforeRelease: earlyBytes } : {}),
    });
```

Both iterations keep every assertion as it is: `bytesBeforeRelease > 0` and `checkRequest`
throwing `/0/`, and `[5000, 2000, 2000]` and `checkRequest` throwing `/1500/`. The test name
stays as it is. `RawClient` is added as `type RawClient` to the existing import from
`./subscribe-test-support.ts`.

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

A new test at the end of `src/subscribe-timing.test.ts`:

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
  servers. No dangling handle stays open: the red runs in the planning trial ended normally with
  a test summary.
- **Unrelated flakes in the 50-run loop.** Earlier comments report `src/server.test.ts`
  ("502 when the API is down") and `src/subscribe-enumeration.test.ts` ("R8 L9 full …"). They
  are reported as known limits (decision 5).
- **Coverage.** `src/subscribe-test-support.ts` is not matched by
  `coveragePathIgnorePatterns` (`bunfig.toml:4`), so it counts toward the 80 % line gate
  (`bunfig.toml:3`). The added line runs in the new tests, so coverage cannot drop. Focused runs
  turn coverage off only through the external empty bunfig (decision 7); the gate stays in
  `bun run check`.
- **The empty bunfig leaks into the repository.** It lives under `/tmp/891-nocov/`, outside the
  worktree. A12 (`git status --porcelain` empty) would catch a copy inside the repository.

## Evidence from a planning trial (planning only, not acceptance)

Run on 2026-11-08 in throwaway clones of status `2cefdf1` under `/tmp` (one for the base, one for
the fix), Bun 1.4.0, git 2.56.0, `bun install --frozen-lockfile`. No target repository was
written.

- Coverage problem on the base: `bun test src/subscribe-timing.test.ts --test-name-pattern "D22"`
  (tracked `bunfig.toml`) printed `10 pass`, `1 filtered out`, `0 fail`, a coverage table, and
  exited 1.
- Coverage-off variants on the base, same selection: `bun test --config=/tmp/891-nocov/bunfig.toml`
  and `bun --config=/tmp/891-nocov/bunfig.toml test` both exited 0 with `10 pass`, `0 fail` and
  no coverage table. `bun test --coverage=false` exited 1 with
  `error: The argument '--coverage' does not take a value.` and is not usable.
- C3 on the base with `bun test --config=/tmp/891-nocov/bunfig.toml src/subscribe-timing.test.ts --test-name-pattern "D22"`:
  3 of 3 exited 0 with `10 pass`, `1 filtered out`, `0 fail`. The whole file with the same
  config: 3 of 3 exited 0 with `11 pass`, `0 fail`.
- Red (R3 test and `gate` added, driver at base),
  `bun test --config=/tmp/891-nocov/bunfig.toml src/subscribe-timing.test.ts --test-name-pattern "just before the release"`:
  3 of 3 exited 1 with `0 pass`, `11 filtered out`, `1 fail`, `AssertionError: false == true` at
  `src/subscribe-timing.test.ts:326` (`assert.ok(driven.bytesBeforeRelease > 0)` of the new
  test). No coverage failure is mixed in.
- Green (R1 + R2 + R3), whole file with the empty config: 3 of 3 exited 0 with `12 pass`,
  `0 fail`.
- Mutation (hook after the count; hook after the release `fire()`): each 3 of 3 exited 1 with
  `1 fail`, `AssertionError: false == true` at line 326.
- `bun run lint` exit 0 on base and fix (3 warnings, 40 infos on both). `bun run typecheck`
  exit 0 on base and fix.
- `bun run check` on the committed fix: exit 0, `663 pass`, `0 fail`,
  `Ran 663 tests across 44 files`, line coverage of all files 98.44 %.
- Base full `bun run test` (observation): exit 0, `662 pass`, `0 fail`,
  `Ran 662 tests across 44 files`.
- Support file size: 10,502 bytes at `2cefdf1`, 10,712 bytes with R1 (+210).
- 50 consecutive `bun run test` runs with the fix (tracked bunfig, coverage on): 50 of 50 exited
  0, each with `Ran 663 tests across 44 files`; the `awk` attribution of A8 printed no `(fail)`
  line, so 0 failures in `src/subscribe-timing.test.ts` and none in other files. The reported
  flakes in `src/server.test.ts` and `src/subscribe-enumeration.test.ts` did not occur in this
  sample; they stay known limits from earlier comments.
- Test CPU, 5 interleaved pairs (`/usr/bin/time -f "%U %S" bun run test`, base then fix), user+
  system seconds: base 4.24, 4.23, 4.26, 4.30, 4.32 (median 4.26); fix 4.27, 4.32, 4.31, 4.33,
  4.26 (median 4.31); delta +0.05 s, inside the noise of a shared machine (the base runs alone
  span 0.09 s).

The implementer repeats all of this on the recorded base. These numbers are not acceptance
evidence.

## Performance impact

Two metrics of status (`bench/budgets.json` in api `515031b`, key `"status"`) can move:
`test_cpu_s` (gating, budget 3.4 s), the only affected gating metric, and `image_mb` (reported,
not gating, budget 124 MB; see the image size paragraph below). Every other metric stays
unchanged.

`test_cpu_s`: expected effect none to +0.05 s. The change adds one test and one bounded wait,
which replaces a race. The planning trial's interleaved measurement is in the evidence section.
Local values are not comparable with the bench budget, which is measured in the bench's own
environment.

Image size (`"image_mb"`, budget 124 MB, not gating; measured as `docker image inspect
--format {{.Size}}` / 1e6 in api `bench/stack.ts:105-114`) grows by a few hundred bytes. The
image copies `src/` (status `Dockerfile:12`). `.dockerignore:5-8` drops `**/*.test.ts`,
`**/*.spec.ts`, `**/__fixtures__` and `**/*.mock.ts`, but not `src/subscribe-test-support.ts`,
so that file is in the image (10,502 bytes on the base). R1 adds 210 bytes (10,712 bytes in the
planning trial). `src/subscribe-timing.test.ts` is not in the image. Expected effect: about
+0.0002 MB, which `image_mb` does not show at its usual precision. Measure it without Docker and
without the bench: report `git show "$BASE:src/subscribe-test-support.ts" | wc -c` and
`git show "HEAD:src/subscribe-test-support.ts" | wc -c` and their difference (expected: positive
and below 1,000 bytes; the literal bound comes from this estimate). If the support file grows by
1,000 bytes or more, report the number in the PR body.

Startup CPU (`startup_cpu_ms`), load CPU (`load_cpu_s`), idle and peak RSS (`idle_rss_mib`,
`peak_rss_mib`) and startup wall-clock (`startup_wall_ms`) cannot move: no production code
changes, and no runtime module imports `src/subscribe-test-support.ts`
(`grep -rln subscribe-test-support src e2e` in status `2cefdf1` lists only
`src/subscribe-timing.test.ts`, `src/subscribe-enumeration.test.ts` and
`src/subscribe-routes.test.ts`), so the server never loads it. p95 latency, requests per second
and build CPU have no status key in `bench/budgets.json`; they would not move either (no request
path changes; the image build copies one slightly larger file and runs no extra step).

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
  the new regression must fail. The gate opens only after the count, so the count is 0 (planning
  trial: 3 of 3 failed at `bytesBeforeRelease > 0`).
- **Hook after the release fires:** the count is taken before the gate opens, so it is 0. The
  regression must fail (3 of 3 in the planning trial).
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
- **Focused control run with the tracked bunfig:** `bun test src/subscribe-timing.test.ts
  --test-name-pattern "D22"` exits 1 on the unchanged base although all 10 tests pass. Treating
  it as a passing control, or as a valid red, is wrong; focused runs use the empty config
  (decision 7). Weakening `bunfig.toml` instead is forbidden (A13 protects it).

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
- `gate` in the two changed files: 0 matches (exit 1), so the new parameter hides nothing.

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

No README change is needed: the change is test-only, and status `AGENTS.md:88` asks for a README
update only when behavior, a setting, an endpoint or a type changes. `docs/development.md` does
not describe timing self-checks (only general test advice at line 48), so it stays unchanged too.
Both are protected paths, as is `AGENTS.md`.

### Tool facts (status `2cefdf1`, config pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`)

- Bun 1.4.0: `package.json:9` (`engines.bun`) and `:38` (`packageManager`).
- `bun run test` is `bun test` (`package.json:14`). `bun run check` is
  `bun run lint && bun run typecheck && bun run test` (`package.json:19`). `bun run lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`). `bun run typecheck`
  runs `tsc --noEmit` from `typescript7` for the root and `e2e` (`package.json:13`).
- `bunfig.toml:1-4` `[test]`: `coverage = true` (line 2),
  `coverageThreshold = { lines = 0.8, functions = 0 }` (line 3), and
  `coveragePathIgnorePatterns` with `**/*.test.ts`, `test/**`, `**/test/**` and `dist/**`
  (line 4). `src/subscribe-test-support.ts` is therefore covered and counts. The file has no
  other section, so an empty replacement config drops only the coverage settings.
- Coverage off for focused runs (Bun 1.4.0): `bun --help` lists
  `-c, --config=<val>  Specify path to Bun config file. Default $cwd/bunfig.toml`.
  `bun test --config=/tmp/891-nocov/bunfig.toml …` with an empty file exits 0 when the selected
  tests pass and prints no coverage table (verified 3 times on the base, see the evidence
  section). `bun test --help` lists `--coverage` only as a switch; `--coverage=false` is
  rejected (`error: The argument '--coverage' does not take a value.`).
- Biome 2.6.3 (`package.json:23`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`
  (config pin at `package.json:24`). At the pin, `biome.json` `files.includes` is `**` minus
  `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures` (lines 10-17). Both changed
  files are in scope. The pinned file is identical to the config clone (`bc87049`), checked on
  2026-11-08 with `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=04108fa…"` and
  `diff`.
- CI: `.github/workflows/ci.yml:17-18`, job `check`, uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`. At the pin, that workflow
  installs Bun 1.4.0 (lines 22-24), then runs `bun install --frozen-lockfile` (26), `bun run lint`
  (28), `bun run typecheck` (30) and `bun run test` (38). The pinned file is identical to the
  config clone (same check). CI therefore runs the full suite with the coverage gate.
- `bun test` strips types without checking them. On the base driver, the new test runs, and the
  unknown `beforeRelease` option is ignored at run time. It is not a compile error, so the red
  run fails at the assertion, not at load time. (`bun run typecheck` would reject the option on
  the base. That is why red runs use `bun test`, not `bun run check`.)

### Steps

1. Record `BASE=$(git rev-parse HEAD)` on a clean `main` before any change. Record
   `bun --version` (expected literal `1.4.0`). Create the empty config outside the repository:
   `mkdir -p /tmp/891-nocov && : > /tmp/891-nocov/bunfig.toml`, and set
   `NOCOV=--config=/tmp/891-nocov/bunfig.toml`. Write the protected-path list:
   `git ls-tree -r --name-only "$BASE" | grep -vxF -e src/subscribe-test-support.ts -e src/subscribe-timing.test.ts > /tmp/protected-891.txt`.
2. Baseline controls on `BASE`, each with its command and result reported. Every control below
   must pass on the base:
   - C0 the coverage override works: `bun test $NOCOV src/subscribe-timing.test.ts` exits 0 with
     `11 pass` and `0 fail` and prints no line containing `% Lines`, 3 times.
   - C1 `bun run lint` exits 0.
   - C2 `bun run typecheck` exits 0.
   - C3 `bun test $NOCOV src/subscribe-timing.test.ts --test-name-pattern "D22"` exits 0 with
     `10 pass`, `1 filtered out` and `0 fail`, 3 times.
   - C4 the base matches this spec:
     `grep -n "beforeRelease" src/subscribe-test-support.ts src/subscribe-timing.test.ts` prints
     nothing (exit 1). If it prints something, apply the hold rule above.

   No enumeration test is a control: `src/subscribe-enumeration.test.ts` has a reported flake
   ("R8 L9 full …").

   Observations only, **not** passing controls:
   - one full `bun run test` on `BASE`. Record its exit status, `Ran N tests across M files` and
     every `(fail)` line with its file header. It may fail because of the known unrelated flakes.
   - `bun test src/subscribe-timing.test.ts --test-name-pattern "D22"` with the tracked bunfig:
     record that it exits 1 with `10 pass` and `0 fail` (coverage threshold only). This documents
     why the empty config is needed.
3. Red: add the R3 regression and the `gate` parameter to `src/subscribe-timing.test.ts` only,
   with the driver still at `BASE`. Run
   `bun test $NOCOV src/subscribe-timing.test.ts --test-name-pattern "just before the release"`
   3 times. Each run must exit 1 with `0 pass`, `1 fail` and `AssertionError: false == true` at
   the `assert.ok(driven.bytesBeforeRelease > 0)` line of the new test. A load error, a type
   error, a `gave up waiting` message or a coverage-threshold exit is not a valid red.
4. Green: add R1 to `src/subscribe-test-support.ts` and the R2 hook to the existing self-check.
5. Mutation proof (scratch only, not committed): move `await options.beforeRelease?.(client);`
   (a) after the `bytesBeforeRelease` line, and (b) after the release `fire()` line. For each, run
   the step 3 command 3 times; every run exits 1 with `1 fail` at the same assertion. Restore the
   R1 position afterwards (for example keep a copy of the fixed file and copy it back) and check
   with `git diff` that only R1 remains. Report each result.
6. Commit with a Conventional Commit subject (for example
   `test: wait for the early answer before counting bytes in the timing self-check`). Run the
   checks and the evidence below on the committed `HEAD`.

### Acceptance

Expected values are literals in each check, or the recorded `BASE` (an independent source:
the commit before the change).

- A1 **Baseline controls:** C0–C4 of step 2 ran on `BASE` and passed as stated (C0 `11 pass`,
  `0 fail`, exit 0, no coverage table, 3 times; C1 and C2 exit 0; C3 `10 pass`, `1 filtered out`,
  `0 fail`, exit 0, 3 times; C4 prints nothing). Both observations are recorded with their real
  exit status and are excluded from this passing requirement.
- A2 **Red on the base:** step 3 output: 3 of 3 isolated runs with `$NOCOV` exit 1 with
  `0 pass`, `1 fail` and `AssertionError: false == true` at
  `assert.ok(driven.bytesBeforeRelease > 0)` in the new test.
- A3 **Green:** `bun test $NOCOV src/subscribe-timing.test.ts` on `HEAD` exits 0 with `12 pass`
  and `0 fail` (the base has 11 tests; the regression adds 1). Run it 3 times.
- A4 **Mutation:** step 5 shows 3 of 3 failures for each of the two wrong hook positions, at
  the same assertion.
- A5 **Hook is opt-in:** on `HEAD`, `grep -c "beforeRelease" src/subscribe-enumeration.test.ts`
  prints `0`, and in `src/subscribe-timing.test.ts` `beforeRelease` appears only in the
  self-check (`earlyBytes` in the early-answer iteration) and in the new regression. Check with
  `grep -n "beforeRelease" src/subscribe-timing.test.ts`: every line is after the
  `// ---- Self-check` marker line (`grep -n "// ---- Self-check" src/subscribe-timing.test.ts`).
- A6 **Assertions kept:** `git diff "$BASE" HEAD -- src/subscribe-timing.test.ts` has no removed
  (`-`) line that contains `assert`, and these literal lines are still in the file:
  `assert.ok(driven.bytesBeforeRelease > 0);`,
  `assert.throws(() => checkRequest(driven, { isCalling: true }), /0/);`,
  `assert.throws(() => checkRequest(driven, { isCalling: true }), /1500/);`,
  `[5000, 2000, 2000],`, `assert.equal(driven.bytesBeforeRelease, 0);` and
  `assert.deepEqual(delays, c.isCalling ? [5000, 2000, 1500] : [5000, 2000]);`.
  `git diff "$BASE" HEAD -- src/subscribe-test-support.ts` removes no line (`-` count 0, apart
  from the `---` header), and the 50-turn loop line
  `for (let turn = 0; turn < 50; turn++) await new Promise((r) => setImmediate(r));` is
  unchanged.
- A7 **No timers or sleeps added:** the added lines of `git diff "$BASE" HEAD` contain no
  `setTimeout`, `setInterval`, `sleep`, `Date.now`, `performance.now` and no new `for`/`while`
  turn loop. Check: `git diff "$BASE" HEAD | grep '^+' | grep -E 'setTimeout|setInterval|sleep|Date\.now|performance\.now|for \(|while \('`
  prints nothing.
- A8 **50-run evidence:** 50 consecutive `bun run test` runs on `HEAD` on one machine, each log
  kept (`/tmp/891-runs/run-<i>.log`), for example:
  `mkdir -p /tmp/891-runs; for i in $(seq 1 50); do bun run test > /tmp/891-runs/run-$i.log 2>&1; echo "run $i exit $?"; done`.
  Attribute failures with
  `awk '/^src\/.*\.test\.ts:$/{f=$0} /^\(fail\)/{print FILENAME": "f" "$0}' /tmp/891-runs/run-*.log`,
  and list the runs without a `Ran N tests across` line. The required result is 0 runs that fail
  `src/subscribe-timing.test.ts` (definition in `## Counterexamples`). The PR body reports the
  base and head SHAs, `bun --version`, the command, all 50 exit statuses, every failure with its
  file, and the count of nonzero exits. No retries and no restarted counts. Failures in other
  files are listed as known limits. These runs use the tracked bunfig (coverage on).
- A9 **`bun run check`** on `HEAD` exits 0 (lint, typecheck and tests with the tracked
  `bunfig.toml` and its 80 % line gate). If it fails only because of a known unrelated flake,
  report that run and its failure, then rerun `bun run check` and report both runs. A failure in
  `src/subscribe-timing.test.ts`, or a lint, typecheck or coverage failure, is never rerun away.
- A10 **CPU (information only):** five interleaved base/branch pairs as in
  `## Performance impact`, with per-run values, both medians and the delta in the PR body. No
  Docker bench. Image size (information only): the PR body reports the byte counts of
  `src/subscribe-test-support.ts` at `BASE` and `HEAD` and their difference, measured with
  `git show <ref>:src/subscribe-test-support.ts | wc -c` (expected: a positive difference below
  1,000 bytes, the literal bound from `## Performance impact`).
- A11 **Scope, commits:** `git diff --name-only "$BASE" HEAD` prints exactly the two lines
  `src/subscribe-test-support.ts` and `src/subscribe-timing.test.ts` (sorted, nothing else).
- A12 **Scope, index and worktree:** after the last commit, `git diff --name-only --cached`
  prints nothing, `git diff --name-only` prints nothing, and `git status --porcelain` prints
  nothing (this also catches untracked files, such as a stray `bunfig` copy).
- A13 **Protected paths:** `grep -cxF -e README.md -e docs/development.md -e AGENTS.md -e bunfig.toml /tmp/protected-891.txt`
  prints `4`, and
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
    `git restore --worktree --source="$BASE" README.md`. The worktree file equals `BASE` again,
    so a check that compares only the worktree with the base,
    `git diff --exit-code "$BASE" -- README.md`, exits 0 and misses the change (the trap). The
    A12 checks catch it: `git diff --name-only --cached` prints `README.md` (index differs from
    `HEAD`), `git diff --name-only` also prints `README.md` (worktree differs from the index), and
    `git status --porcelain` prints `MM README.md`;
  - (g) restored-worktree trap, commit: commit a `README.md` change, then
    `git restore --worktree --source="$BASE" README.md`. Again
    `git diff --exit-code "$BASE" -- README.md` exits 0 (the trap). `git diff --name-only --cached`
    prints nothing, `git diff --name-only` prints `README.md` (worktree differs from the index,
    which holds the commit), `git status --porcelain` prints ` M README.md`,
    `git diff --name-only "$BASE" HEAD` lists `README.md` (A11), and the protected diff exits 1
    (A13).

  The literal results of (f) and (g) were reproduced on 2026-11-08 in a disposable fixture
  (git 2.56.0, `mktemp -d`, removed afterwards): (f) worktree-vs-base exit 0, cached
  `README.md`, unstaged `README.md`, status `MM README.md`; (g) worktree-vs-base exit 0, cached
  empty, unstaged `README.md`, status ` M README.md`, `BASE..HEAD` lists `README.md`, protected
  diff exit 1.

  The fixture is validation evidence only. It is not added to pulse-status.
- A15 **Comments:** after reading every added line of `git diff "$BASE" HEAD` (inline comments
  included), the PR body lists each added comment verbatim. The plan expects exactly one: the
  JSDoc of `beforeRelease`. Write "none" only after that inspection. No new test file is created.
  If one becomes necessary, stop and request `needs-input`, because the allowed list would change.
- A16 **PR body:** names `Closes lorenzh/pulse-meta#<child>`, the checks that ran (A1–A14), the
  focused-run command with the empty config and why it is needed, the known limits (the
  unrelated flakes in `src/server.test.ts` "502 when the API is down" and
  `src/subscribe-enumeration.test.ts` "R8 L9 full …", which are not fixed here), and states that
  `README.md`, `docs/` and `bunfig.toml` are unchanged because the change is test-only.
