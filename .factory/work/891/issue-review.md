# Issue review: #891

## Outcome

Ready for `plan`; no blocking question. The only implementation target is `status`.
This is a test-only fix. No production code, dependency, setting, endpoint, wire
type, shared tooling, CI, design, or documentation change is needed.

The exact implementation file list is:

- `src/subscribe-test-support.ts`
- `src/subscribe-timing.test.ts`

No README change is needed because this is a test-only change with no production
behavior, setting, endpoint, or type change. `docs/development.md` does not describe
timing self-checks and remains correct; it and all other documentation stay unchanged.
The plan and task must use this same file list and protect the documentation.

## Inspection and evidence

Inspected the meta `AGENTS.md`, `README.md`, issue-review prompt and status context
entry in `.factory/config.yaml`. Inspected the read-only status clone, including
its `AGENTS.md`, complete `README.md`, `docs/development.md`, `package.json`,
`bunfig.toml`, complete `src/subscribe-timing.test.ts`, test-driver implementation
and relevant enumeration callers. Status HEAD is
`2cefdf1cfbbd7cce175a9df97dbdafdec0e925aa`. Both repositories were initially clean.
Only the root `AGENTS.md` was found within status. A search of status documentation,
README and AGENTS for timing/self-check/driver terminology found no matching guidance.

The supplied issue comments describe earlier reviews, plans and experiments. No
`.factory/work/891/` directory exists in this fresh checkout, so those earlier
artifact contents were not available to inspect. This review creates the directory
and artifact; later states must preserve it. Initial attempts to list that absent
directory returned an expected missing-path error, resolved by creating this artifact.

Current source supports the reported cause:

- `subscribe-timing.test.ts:279-300` has one self-check test iterating two wrong
  handlers: `early answer` and `call timeout 2000`. The first asserts
  `driven.bytesBeforeRelease > 0` at line 290, then proves check 2 rejects it.
  The second asserts timer registrations `[5000, 2000, 2000]` and proves check 1
  rejects the wrong timeout. No other self-check block exists in this file.
- `wrongServer` at lines 246-276 registers a release timer and calls fake notify.
  On successful notify completion the early-answer variant writes immediately.
- `finished` at lines 57-61 observes fake notify's response completion or abort.
  This does not establish that the raw status client has received the answer.
- `RawClient` and `rawClient` in `subscribe-test-support.ts:182-203` retain chunks
  in a socket `data` listener and expose `received()`.
- `driveSubscribe` at lines 285-329 waits for registrations and notify arrival,
  invokes `settle`, optionally fires the call timer, yields for exactly 50
  `setImmediate` turns, snapshots the client's byte count at line 319, and fires
  the release at line 320. A fixed number of turns does not guarantee client data.
- `waitUntil` at lines 235-242 already polls a condition using `setImmediate`, with
  a 20,000-turn failure bound and a diagnostic. No real timer or sleep is needed.
- Normal timing checks assert zero bytes before release, timer order/delays,
  cancellation, release-time output, byte equality and abort behavior. Enumeration
  tests also call this shared driver and assert zero pre-release bytes.
- `package.json` defines `test` as `bun test` and `check` as lint, typecheck and
  tests. The required runtime is Bun 1.4.0. `bunfig.toml` enables the 80% line
  coverage threshold. No checks or coverage settings should change.

No target tests, repeated-run experiment, baseline control or performance measurement
was executed in this issue-review state. Earlier experiment results are reports from
the supplied comments, not newly verified evidence or implementation acceptance.

## Decisions carried forward and resolved assumptions

1. The manager's README correction supersedes earlier comments proposing README and
   development-doc edits. Status AGENTS requires README updates for behavior,
   settings, endpoints or types; the manager explicitly resolves its application
   here as excluding this test-only change. The current development doc gives
   general fake-clock advice and commands, with no timing-self-check recipe that
   this change would invalidate. Do not add documentation merely to satisfy the
   superseded four-file plan.
2. Preserve the earlier review decision that the test driver/self-check behavior
   changes: use `Behavior change: yes` and `behaviorChange: true` where required,
   explicitly qualified as test-only. This does not imply a production behavior
   change or a README edit.
3. The observation must happen inside the driver before its byte snapshot and
   before the manual release fires. Waiting after `driveSubscribe` returns cannot
   repair the already-captured count. Waiting for server completion alone is also
   insufficient. Raising the 50-turn count is not the requested condition wait.
4. A client-aware optional `beforeRelease` hook, as proposed in earlier comments,
   is a suitable narrow seam. It can run after the existing observation turns and
   before the snapshot and release. The early-answer self-check uses it to wait
   until `client.received().length > 0`. The ordinary D22/enumeration callers and
   call-timeout variant must retain their zero-byte expectations and not wait for
   data that should not exist before release. An equivalent equally narrow design
   is acceptable if the spec explains how it proves this ordering.
5. Inspect both wrong-handler variants for the same observation race. Only the
   early-answer variant currently asserts positive pre-release bytes. The timeout
   variant tests registered timer values, which the driver already waits for;
   adding an unconditional positive-byte wait would make it hang until the bound.
   Do not weaken that variant or add an unrelated timing wait.
6. The issue's held-request wording refers to withholding the manual response
   release. In the inspected self-check the form body is sent in full and the
   fake notify is answered by `ok`; there is no need to change body handling to
   meet the requirement. The essential proof is client data while release remains
   unfired, rather than merely data received by the end of the request.
7. Preserve the deterministic regression approach from the earlier plan comments:
   gate the wrong server's early answer so it cannot be sent before the new
   synchronization seam is reached. Open the gate there, wait for observed client
   data, and verify it was captured before release. Do not use scheduler noise or
   a lucky intermittent failure as red evidence. If names such as `gate`,
   `openGate` or `beforeRelease` are introduced, the plan must redo and record the
   relevant scoped collision searches; prior comments' searches are historical.
8. The previous plan and plan-review comments accepted interpreting the 50-run
   evidence as 50 consecutive complete suite invocations on one machine with no
   failure attributed to `src/subscribe-timing.test.ts`. Retain that interpretation
   of "without a failure of this file" and record every invocation's exit status
   and failures. Earlier comments report unrelated flakes in server.test.ts
   ("502 when the API is down") and subscribe-enumeration.test.ts ("R8 L9 full").
   Those reports are known limits, not permission to conceal failures or to count
   an incomplete/unattributable run as success. Do not claim 50 green suite exits
   if any failed. Do not repair unrelated flakes in this issue. Independently,
   `bun run check` must pass; unrelated failures must be reported and handled
   through the workflow rather than declaring acceptance complete.
9. A baseline full-suite observation may record failure. Clearly separate it from
   controls described as passing on the base: every such control actually runs
   and passes at the recorded base. This resolves the earlier plan-review
   contradiction without weakening the final branch checks.

## Derived acceptance for the plan and implementation task

### Behavior and regression

- On the recorded implementation base, reproduce the defect deterministically
  using the gated regression. Run each new regression three times in isolation
  against the base (with only the compatible regression/fixture overlay). Every
  run fails for the stated pre-release observation reason. Explain any mechanical
  adaptation so a missing hook API or compilation error is not counted as red.
- With the fix, the early-answer self-check waits for positive observed client
  bytes using a bounded condition and retains `bytesBeforeRelease > 0` and the
  rejection by check 2. The release timer is still live/unfired when data is
  observed; the snapshot is taken before it fires. A regression must reject
  synchronization moved after either the snapshot or release.
- Review all self-checks in the file; fix equivalent positive-observation races
  if found. Keep the wrong-timeout assertion `[5000, 2000, 2000]` and check 1
  rejection, ordinary zero-byte assertions, timer counts/order/delays and
  cancellation, release output, K/P/U equality and abort checks intact.
- Keep synchronization opt-in for expected early output. Normal timing and
  enumeration callers continue through the shared driver without the new wait.
  Use fake clocks/manual timers and condition-based event-loop yields. Add no
  real timers, real clocks, sleeps, fixed-delay substitute, external network or
  production changes. Clean up test servers and sockets, including failure paths.
- Every baseline control the plan labels passing runs successfully on the exact
  recorded base, with commands and outcomes reported. A full-suite observation
  is explicitly excluded from this passing-control claim; record its actual
  result. Never promote earlier comments' experiments into current evidence.

### Execution evidence and PR reporting

- Run 50 consecutive `bun run test` invocations on one machine. Report base and
  branch SHAs, Bun version, command, run count, each run's result and a summary
  in the PR body: zero failures of `src/subscribe-timing.test.ts`, plus every
  unrelated failure and the number of suite exits that were nonzero. Preserve
  logs sufficient to attribute failures. Do not silently retry, drop runs or
  reset the count around file failures to present a selected sequence.
- `bun run check` passes in pulse-status with existing lint, typecheck and
  coverage enforcement. Any failures or inability to run remain explicit;
  separate lint/typecheck results alone do not substitute for this command.
- Measure test CPU using five interleaved base/branch pairs on the same machine
  (base, branch, repeated five times). Report user+system CPU, per-run results,
  summary and branch-minus-base delta using the same test command/environment.
  CPU is information only on the shared noisy host. Do not run the Docker bench
  (the issue identifies host-port collision #834).
- Prefer adding the regression to the existing timing test file. If a new test
  file becomes necessary, revise the exact allowed list explicitly before work;
  it carries no explanatory comments except one line naming the class and expected
  outcome. Read every added line in the final diff, including inline comments,
  and list every added comment in the PR body; write "none" only after inspection.

### Scope evidence in every task's acceptance

Record `BASE` as the implementation base SHA before changes. The exact allowed
list is the two test paths above. Protect every other tracked path, explicitly
including `README.md`, `docs/`, `AGENTS.md`, all production source, dependencies,
lockfiles, config, CI and other tests. The plan must enumerate or generate the
concrete protected path list from the recorded base, excluding only the two
allowed paths; checking `src/` wholesale would incorrectly protect the allowed files.

After the last implementation commit, verify all of these independently:

- `git diff --name-only "$BASE" HEAD` matches the exact allowed file list.
- `git diff --name-only --cached` is empty.
- `git diff --name-only` is empty.
- `git status --porcelain` is empty (also catches untracked files).
- `git diff --exit-code "$BASE" HEAD -- <protected files>` exits zero; include
  README and development documentation in the protected list.

Prove that scope verification works using a disposable fixture, without adding it
to the target's allowed files. Check a clean allowed-only case and protected changes
in commits, index and working tree separately. Include both restored-worktree traps:
stage a protected change then restore only the worktree to BASE (cached diff must
catch it), and commit a protected change then restore the worktree to BASE (the
BASE-to-HEAD/protected checks must catch it). Also show an untracked path fails the
cleanliness requirement. Report each expected rejection rather than using a single
combined diff that can cancel changes across states. The fixture is validation
evidence, not an extra deliverable in pulse-status.

## Remaining open points

None block specification. The plan must make the regression/gate mechanics,
scoped name searches, exact baseline controls, CPU collection command, log format
and protected-file fixture concrete. These are implementation and validation
choices within the accepted scope. If the implementation base changes, recheck
source, documentation and preconditions; do not assume the old line numbers or
historical measurements still apply. No target repository was edited in this state.
