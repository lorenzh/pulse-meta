# Issue review: #891

The feature can be specified. Transition to `plan`; no question requires a `needs-input` hold. The implementation target is status only, with test/support and documentation changes. No production behavior change is authorized.

## Evidence inspected

- Read meta `AGENTS.md`, `README.md` and `.factory/prompts/issue-review.md`. Read status `AGENTS.md`, `README.md`, `docs/development.md`, `package.json`, `bunfig.toml`, the complete `src/subscribe-timing.test.ts` and `src/subscribe-test-support.ts`, and the helper's other caller, `src/subscribe-enumeration.test.ts`, directly from the read-only clone.
- Status context HEAD is `2cefdf1cfbbd7cce175a9df97dbdafdec0e925aa`; its working tree was clean. Record the actual implementation base before edits later; this inspected SHA is not permission to assume main will remain unchanged.
- Fetched [#891](https://github.com/lorenzh/pulse-meta/issues/891) and all issue comments. The sole comment is the current Factory claim, with no earlier decision or requested revision. The status #70/#71/#72 failure history is reported by the issue; this review did not reproduce those reviews.
- `subscribe-timing.test.ts:279-300` contains one self-check test with two variants: `early answer` and `call timeout 2000`. The former expects positive `bytesBeforeRelease` and rejection by check 2; the latter expects `[5000, 2000, 2000]` and rejection by check 1. There is no separate held-request-body self-check in this snapshot.
- `wrongServer` sends an early status response after its notify request resolves in the `early answer` variant. `finished` observes the fake notify response's completion/abort, not receipt of the status response by the raw client. These are different events.
- `driveSubscribe` waits for registrations/notify arrival and optional settlement, then yields for exactly 50 `setImmediate` turns. It snapshots `client.received().length`, fires the second timer (release), waits for socket closure and returns the snapshot. The positive assertion at line 290 is therefore checked after the release has already fired, against a count captured before it. Waiting on the returned `Driven` object cannot fix the capture race.
- `rawClient` already records data from the socket; `waitUntil` already yields until a predicate holds, with a 20,000-turn failure bound and no wall-clock timer. The manual scheduler fires only when instructed. The same driver is used by ordinary timing and enumeration tests that correctly expect zero bytes before release.
- Bun is available as version `1.4.0`, matching status instructions. The context clone has no `node_modules`. This state did not install dependencies, run target tests, reproduce the flake, run scope fixtures or measure CPU. All execution requirements below remain implementation work.

## Nonblocking open points and assumptions

1. **Meaning of held request.** Preserve the issue's intended ordering: the subscribe request is being driven while its manual release is held. The observed early data must precede firing that release. Do not introduce an unfinished request-body scenario merely to match the introductory wording; the existing self-check sends a complete body and detects a deliberately wrong handler answering early.

2. **Synchronization location.** The condition belongs before the byte snapshot and before firing the release, where the raw client's received data is available. Prefer a narrow, explicit test-driver option or pre-release hook used only by self-checks expecting early data. A condition-based wait using existing test infrastructure or an already-observed socket event is appropriate. A server-side `finish`, notify completion, larger fixed turn count, fixed delay, or waiting after `driveSubscribe` returns is insufficient. Keep failure bounded/diagnosable without real timers, sleeps, global mocks or production exports added for testing.

3. **Other self-checks and shared callers.** Audit both variants in the file. The wrong-timeout variant does not expect early bytes and must not acquire an unconditional positive-data wait: its handler answers only at release. Preserve its literal registration assertion and check-1 failure. Ordinary timing and enumeration cases must likewise continue to accept zero pre-release bytes and progress when release is fired. Reuse the same condition for any additional positive-data self-check found on the actual base; do not broaden this issue into fixing unrelated polling loops elsewhere.

4. **Regression evidence.** The old intermittent failure is not a reliable red test. The plan must choose a controlled test-only event/deferred fixture that demonstrates the driver cannot sample/fire release before delayed client-data observation, without scheduling correctness by a fixed number of turns. Keep the existing wrong-handler checks as mutation controls. Any new or strengthened regression must exercise the old behavior on the recorded base and fail three times in isolation for the stated ordering defect; missing new APIs/imports, missing dependencies, a timeout caused by broken setup, or coverage-only failures are not valid red evidence. The exact fixture is an engineering choice for planning, not a product decision requiring a hold. Prefer keeping regression coverage in the existing timing file.

5. **Documentation scope.** Include both `README.md` (Development) and `docs/development.md` (Checks), with a short accurate explanation of condition-based client observation for timing self-checks and manually controlled release. This conservatively satisfies the issue's documentation rule for the changed test behavior and keeps the existing developer documentation aligned. Do not claim a change to the public subscribe delay or operator settings. Status `AGENTS.md` requires README updates when behavior changes; it names no additional mandatory companion doc for this test fix, and `docs/development.md` is the relevant existing developer guide. No command or repository-wide convention changes, so leave `AGENTS.md` unchanged. The plan and tasks must retain the same documentation scope.

6. **Performance interpretation.** Use five interleaved base/branch pairs, giving five full-suite CPU samples per revision. CPU means user plus system time including child processes, not wall time. Report raw samples, per-revision medians, absolute branch-minus-base median delta and percentage of the base median. There is no performance gate; the shared machine is noisy. Do not run the Docker benchmark (#834).

7. **Dependencies and boundaries.** No contract, kit or other target change, dependency update, production code edit, design sync or rollout dependency is needed. Do not redo the changes discussed in status #70/#71/#72. Use the pinned environment and local loopback servers on ephemeral ports. All deliberate scope-check mutations belong in disposable fixtures in the later writable implementation environment, never in these read-only context clones.

## Proposed implementation Files

The cumulative exact allowed list for the status change is:

- `src/subscribe-timing.test.ts`: synchronize the early-answer self-check and add/strengthen deterministic ordering regression coverage; retain both wrong-handler checks.
- `src/subscribe-test-support.ts`: narrowly support condition-based client observation before snapshot/release while preserving ordinary callers.
- `README.md`: describe the test synchronization in Development.
- `docs/development.md`: document the same behavior in Checks.

The plan and every task must enumerate their exact allowed subset in `Files:` and matching acceptance, and check the cumulative scope too. If planning finds a genuinely necessary additional path, reconcile this review, plan and tasks explicitly before implementation; do not silently enlarge the allowlist. No new test file is needed by this proposal. Do not ship a scope framework, measurement script, evidence file or `.factory/` directory in status.

## Derived acceptance checks

### Ordering and preserved assertions

1. Record `BASE=<full implementation-base SHA>` before edits. Inspect the actual base's two self-check variants and shared driver callers. Establish the client-data condition before the snapshot and while the manual release timer is still live. Assert that early bytes were observed in that state, then capture the positive count and drive release/completion. The self-check must still demonstrate `checkRequest` rejecting the deliberately early handler at check 2, with no assertion weakening or acceptance of zero bytes.
2. Preserve the wrong-timeout variant's literal `[5000, 2000, 2000]` registration assertion and check-1 rejection expecting `1500`. It must complete without waiting for data that requires release. Preserve ordinary correct-handler assertions: zero pre-release bytes; exact timer registrations and cancellation; release at the recorded request time; complete status-200 answer at release; abort/cancel when notify remains open; live-timer bound; and byte-equal answers across addresses/orders. Exercise the existing enumeration caller too. Do not replace positive/negative observations with server-side completion or post-release bytes.
3. Demonstrate deterministic ordering with a controlled delayed-observation fixture, independent of wall time and fixed event-loop turn counts. The fixture must prove that the condition wait keeps release pending until client data is observed and that the same regression detects the base ordering defect. Run each new/strengthened regression three times in isolation on the recorded base, then on the candidate, recording commands, names, assertion diagnostics and results. Carry only the needed regression instrumentation into a disposable base checkout; retain the old driver behavior for red evidence. The planner must make this procedure concrete before implementation. Any per-invocation isolation adjustment for coverage must use supported runner options, leave committed coverage configuration intact, and be reported.
4. Execute every control the plan describes as passing on the base and capture a real pass there before labeling it a baseline control. Suitable controls include ordinary D22 timing cases, the wrong-timeout self-check and enumeration callers. Record the unmodified base full-suite/check result separately; the issue already reports a flaky early-answer control, so do not claim base stability or hide its failures. New regressions must fail for the intended cause independently of that pre-existing flake.
5. Review all added/changed test and helper code for real timers, sleeps, fake-clock bypasses, unbounded waits and unconditional positive-data waits. No production modules or existing timing assertions may be weakened. Preserve local-only networking, fake scheduling, cleanup, coverage, lint and typechecking requirements.

### Stability, checks, documentation and comments

6. On the final candidate revision, run **50 consecutive complete `bun run test` invocations on one machine**. Require all 50 invocations to exit successfully and zero failures of `src/subscribe-timing.test.ts`. Do not substitute a single-file loop, individual-test retries or an aggregated count of successes. Stop/report a failure; after fixing it, start a fresh consecutive sequence. Record revision, Bun version, command, completed iterations, exit results and timing-file failures. The PR body must state the actual loop result, for example `50/50 consecutive full-suite runs passed; 0 subscribe-timing failures`, only after it is observed.
7. Require `bun run check` to pass in status on the final revision with normal lint, typecheck, tests and coverage. Keep dependency pins/lockfile, CI and tooling thresholds unchanged, and use normal commit hooks. No public endpoint behavior changes, so no new user-visible service smoke scenario is required. This issue does not authorize starting Docker for a benchmark.
8. Review both documentation diffs for an accurate, matching description of client-observation synchronization before manual release. Both named documents must be in the plan/task `Files:` and acceptance. No implication that public subscription timing or configuration changed.
9. Read all added lines in the complete base-to-HEAD diff, including inline comments. The PR body lists every added comment, including changed comment lines and any fixture comment; write `none` only after that inspection. If planning adds a new test file, it contains no explanatory comments except at most one line naming its test class and expected outcome. Existing-file placement does not waive the PR comment inventory.

### Informational CPU evidence

10. On the same machine and using the same Bun version, dependency setup and coverage settings, measure the unchanged recorded base and final candidate with five alternating pairs of full `bun run test` runs: base, branch, base, branch, continuing to five samples each. Include child-process CPU. Remove any regression-only overlay from the disposable base before measurement. Report every sample's user/system/summed CPU, command exit status, medians, CPU-seconds delta and percentage delta in the PR body. Record baseline flaky failures honestly; do not silently discard or relabel samples. This evidence is informational and separate from the 50 consecutive successful candidate runs. Do not run the Docker bench.

### Scope evidence required in every task

11. Against the recorded pre-edit implementation `BASE`, after each task's last commit, require all of the following; enumerate the actual allowed and protected paths in the plan and task rather than leaving placeholders:

    - `git diff --name-only "$BASE" HEAD` matches the exact allowed changed-file list, with no extra or missing paths. Check both the task's scope and cumulative branch scope as appropriate.
    - `git diff --name-only --cached` is empty.
    - `git diff --name-only` is empty.
    - `git status --porcelain` is empty, including untracked files.
    - `git diff --exit-code "$BASE" HEAD -- <protected files>` exits 0. Protect every tracked path outside the exact allowed set. In particular, protect all production `src/` files, other test files including `src/subscribe-enumeration.test.ts`, `AGENTS.md`, `package.json`, `bun.lock`, `bunfig.toml`, lint/typecheck/hook configuration, `.github/`, Docker files, `public/`, `bench/`, `e2e/`, scripts and unrelated documentation. Expand the production/protected file list without accidentally protecting the two explicitly allowed test/support paths.
    - `git diff --check "$BASE" HEAD` passes.

    Do not redefine BASE after implementation commits or substitute `git diff "$BASE"` for the committed comparisons. Keep temporary evidence outside the implementation tree and do not add ignore rules to hide it.

12. Prove the combined scope checker using a disposable Git fixture with its own recorded base. A clean allowed change committed must pass. Independently require rejection for a protected change in each of the three states: unstaged, staged, committed with a clean worktree. Also reject an untracked file. Include both restored-worktree traps: stage a protected change then restore only the worktree content to the fixture base; separately commit a protected change then restore only its worktree content to base. Show that a base-to-worktree comparison can be empty while the independent index/history/status checks reject those states. Record commands, expected outcomes and actual exit statuses. This is acceptance evidence, not a reason to mutate real protected files or add shipped fixture infrastructure.

## Handoff and validation in this state

Write a status-only spec and breakdown from these decisions. The central risk is placing synchronization after the snapshot/release or applying it to correct handlers that must remain silent. The plan must spell out deterministic red evidence and carry the scope, documentation, stability, CPU and comment requirements into every applicable task.

Created only `.factory/work/891/issue-review.md`; retain it for later states. Source and instruction inspection and issue/comment retrieval were performed. Initial probes confirmed that this artifact directory and status dependencies were absent; later inspection used the existing source paths. No target files, provider labels or comments were changed. No target execution pass is claimed.
