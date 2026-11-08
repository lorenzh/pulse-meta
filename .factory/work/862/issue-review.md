# Issue review: #862 — probe location validation

## Decision

Ready for `plan`; no blocking questions. Only `probe` needs an implementation child, with no cross-repository dependency. Earlier Factory comments describe a completed spec run, but its #862 artifacts are absent from this fresh checkout. Those comments remain decision history, not evidence that their tests or artifacts exist here. Rebuild the spec with the manager's added requirements below.

## Security finding and disclosure

Public P2 finding `security-probe-2026-11-04-1` concerns `PULSE_LOCATION` in pulse-probe's `src/location.ts`, consumed by the generated `User-Agent` in `src/check.ts`. The class is insufficient startup input validation for an HTTP header value. A header-incompatible location passes startup validation and causes HTTP checks to report false `down` results; the issue reports that TCP checks and a valid control location remain up. Fix direction: reject incompatible locations at the settings boundary before startup side effects, preserving accepted names and result identity.

The issue review, plan, task acceptance and PR text must name the location, class, impact and fix direction. None may contain a working payload, a concrete location that makes the header unusable, or a reproduction command. This includes literals, tables, shell commands and escaped recipes in prose. Describe rejected inputs only by class. Tests must construct their rejected inputs at runtime from escapes or code points inside test code, keep values out of test titles and diagnostics, and report acceptance by test title. Apply this disclosure rule to documentation and validation output too. The manager decision overrides probe's general instruction to report a manual exercise command for this security regression; use automated test titles and results instead.

## Repository evidence

Inspected the read-only clone `.repos/probe` at `9490141ef9e92044808c70bb8200db3d497d1060`:

- `AGENTS.md` requires validation at the edge, regression-first development, Bun 1.4.0, local-only HTTP tests, unchanged shared tooling, and a README update in the same change whenever behavior or a setting changes. No Factory artifacts belong in probe.
- `src/location.ts:5` trims the raw value, defaults an empty result to `default`, rejects a string longer than 64 JavaScript UTF-16 code units, then returns it without validating its characters. `userAgent` interpolates that string without encoding.
- `src/settings.ts` calls `parseLocation` from `loadSettings` and wraps ordinary errors in `StartupError` with a single-line message. No new settings plumbing is needed.
- `src/main.ts` calls `loadSettings` before starting the health listener and before fetching checks or starting their scheduler. A parser rejection therefore fits the required early-failure boundary without changing startup or scheduling.
- `src/check.ts:502` sets the generated `user-agent` after resolved check headers. Its HTTP failure handling returns a safe error code or `request error`; it does not repair the invalid startup setting. Results use `deps.location` unchanged. This explains the reported failure mechanism; no runtime reproduction was performed in this issue-review state.
- `src/location.test.ts` already covers defaults, trim/case preservation, the 64-character limit and user-agent formatting. `src/settings.test.ts` covers the overlength location and `StartupError` behavior, but not header compatibility. `src/check.test.ts` has local HTTP helpers and a location/user-agent identity test. `src/main.test.ts` runs real child processes against local fake APIs, captures output and checks startup exit codes and absence of API requests.
- `docs/configuration.md` documents trimming, case, default, length, the generated user agent and API token/location matching, but no accepted character range. `docs/troubleshooting.md` has the existing overlength error. `README.md` documents startup and links to configuration but does not document the accepted location range.
- `package.json` pins Bun 1.4.0 and contract/kit/config Git dependencies; `bun run check` runs lint, typecheck and tests. `bunfig.toml` enforces 80% line coverage.

Also inspected the cloned contract's `src/schema.ts` and kit's `src/settings.ts` and `src/run-service.ts`. The contract header-value validator excludes tabs, so it is unsuitable as the probe's location validator under the prior compatibility decision. Kit's startup boundary prints `pulse-probe: <message>` and exits 2 for `StartupError`. These context clones have different HEADs from probe's dependency pins; planning must verify any dependency behavior it relies on at the pinned revision. The fix need not change or reuse a contract validator and needs no new dependency or pin update.

## Resolved scope and assumptions

1. Preserve the rule from the earlier issue comments: trim first; unset or blank still means `default`; retain the existing 64-code-unit check and its exact message before the new character check. Then accept only horizontal tab (U+0009), space and visible ASCII (U+0020–U+007E), and Latin-1 header text (U+0080–U+00FF). This is a header compatibility rule, not a stricter location identifier grammar. Validate the trimmed name, not the raw whitespace around it.
2. Preserve accepted case, punctuation, internal spaces, internal tabs and Latin-1 characters. Do not encode, replace, truncate, sanitize, lowercase or otherwise rename locations. Keep the existing user-agent format and the location carried in results. The 64-character limit keeps its existing JavaScript string-length meaning.
3. Reject remaining control characters, DEL and characters outside the accepted one-byte range. Tests describe those classes without putting examples in public prose. Isolated-surrogate cases, if covered, belong at the parser/settings boundary because child-process environments cannot preserve every JavaScript string. Environment-inexpressible inputs need not be forced through a child process.
4. Use one fixed, single-line new error naming `PULSE_LOCATION`, without any setting value, credential, raw fetch exception or stack. The plan must fix its exact wording and align tests and docs. Existing overlength behavior is preserved. Other invalid settings and unrelated errors are outside this issue; test this path with otherwise valid settings and valid token sentinels.
5. Reject before the health listener, check fetches, result posts, target requests or scheduled work. Do not merely catch a failure in `runCheck`, drop the user agent or postpone validation until a check runs.
6. Document accepted values in probe's `README.md` as well as the configuration table and Location section. Add the new startup error to troubleshooting and a configuration migration note: formerly accepted incompatible settings now stop startup; operators choose an accepted name and retain API token/location matching. Do not include a rejected example or a reproduction command.
7. Keep scheduling, retries, authentication, quorum, contract schemas, API behavior, metrics and dependency/tooling pins unchanged. There is no API migration or shared validator change. Existing authentication still requires the configured location to match its API token; this issue does not validate that relationship at startup.

## Non-blocking points for the plan

- Select the fixed new error text. This is an implementation detail, not a manager decision.
- Confirm the accepted range against the generated header using Bun 1.4.0 and a real local HTTP receiver, including internal tabs and Latin-1. Earlier comments report this was checked, but this review does not claim that result as a fresh execution. If current pinned runtime evidence contradicts compatibility, resolve it explicitly before implementation rather than silently narrowing accepted names.
- Define red/green evidence for the bug tests: the incompatible-location cases must fail on the recorded implementation base for the expected reason, then pass after the fix. Compatibility control tests may already pass on the base.
- Specify the exact allowed paths and protected paths before implementation, record the implementation base SHA as `BASE`, and keep the scope-check proof in acceptance evidence. The inspected probe SHA above is evidence for this review, not a substitute for recording the later child's actual base.

## Expected probe files

Use this eight-file scope in the plan's `Files:` list and the task's exclusive-scope acceptance:

- `src/location.ts`
- `src/location.test.ts`
- `src/settings.test.ts`
- `src/check.test.ts`
- `src/main.test.ts`
- `README.md`
- `docs/configuration.md`
- `docs/troubleshooting.md`

Only `src/location.ts` needs production logic changes based on current evidence. Settings/startup/check production modules already provide the required path and are protected. In particular, protect `src/settings.ts`, `src/main.ts`, `src/check.ts`, scheduler modules, client/auth modules, dependency manifests and lockfiles, tooling/CI configuration and `AGENTS.md`. The exclusive allowed list also protects every other tracked path. Tests may extend existing helpers but must not broaden the production change or add Factory artifacts to probe. If fresh evidence requires a different scope, revise the plan and acceptance together before implementation.

## Derived acceptance check

The plan and task must name regression cases by title, never by rejected value. Suggested titles and observable checks:

1. **“location defaults, trimming and length stay compatible”** — preserve unset/blank defaults, case, surrounding whitespace handling, 64 accepted code units and the existing overlength message. Verify length validation precedes character validation when both fail.
2. **“location rejects header-incompatible character classes”** — runtime-constructed cases cover disallowed controls, DEL and characters outside the one-byte header range, including BMP and supplementary classes. Keep trim-sensitive rejected characters internal so trimming does not erase the case. Check the fixed message without printing inputs. A parser-only surrogate case can complete the string-boundary coverage.
3. **“settings reject an incompatible location with a redacted StartupError”** — prove the parser failure becomes the expected error type and one fixed line. Check that the location, credential sentinels and other setting values are absent.
4. **“accepted locations complete a local HTTP check with unchanged identity”** — parse accepted names and run the real HTTP check against `127.0.0.1` on an allocated port. Include an ordinary control, internal tab, punctuation/spaces and Latin-1 coverage. Assert `up`, successful status, no failure reason, exact result location and the receiver's unchanged generated user agent. Faking `fetch` is insufficient to verify header compatibility.
5. **“incompatible locations exit before startup side effects”** — use the actual probe child process with a runtime-constructed, environment-representable rejected location and otherwise valid settings. Assert exit 2, empty stdout, one fixed stderr line naming `PULSE_LOCATION`, no values, no stack and no fake API or target requests. Prove settings validation precedes listener binding, for example with an occupied configured health port: the location error must win over the bind error. Close children and servers even on a failed assertion.
6. **“an accepted location posts an up result through the real startup path”** — run the actual probe with a local fake API and local HTTP target, a valid token sentinel and accepted Latin-1 location. Verify the received generated header and posted location are unchanged and the result is `up`; stop the child cleanly. No external services or changes to authentication or scheduling are needed.
7. **“location documentation matches startup validation”** — README accepted values, configuration table/Location section/migration note and troubleshooting agree with the parser's default, trimming, length, character range, redacted message and exit code. No public text includes a working rejected value or reproduction command.
8. **“implementation scope checks detect committed, staged and unstaged protected edits”** — perform the separate checks and fixture proof below, and report their results by state.

Follow probe's regression-first workflow, then run its focused location/settings/local HTTP/startup tests and full `bun run check` with pinned Bun 1.4.0. Keep the existing coverage and lint thresholds. Report safe test titles, commands for test suites and pass/fail summaries; do not publish payloads, value-bearing failures or manual reproduction commands. This issue-review state inspects source and derives acceptance; it does not implement or claim execution of these tests.

## Exclusive-scope acceptance and fixture proof

At implementation start, record the exact base commit in `BASE`. At final acceptance after the last implementation commit, require all of these independently:

- `git diff --name-only "$BASE" HEAD` equals the exact eight-file allowed list above (compare normalized lists; no additional path is allowed).
- `git diff --name-only --cached` is empty.
- `git diff --name-only` is empty.
- `git status --porcelain` is empty, including untracked files.
- `git diff --exit-code "$BASE" HEAD -- <protected files>` succeeds, with the plan/task expanding the placeholder to its explicit protected paths. This check supplements the complete allowed-list comparison; it cannot replace it.

A base-to-worktree comparison alone cannot establish scope. Prove the gates with a disposable Git fixture, kept out of the deliverable, using harmless edits unrelated to the security trigger:

1. Establish a recorded base, an allowed file and a protected file. A committed allowed-only change with a clean index/worktree passes. A clean tree with a protected committed change fails the base-to-HEAD and protected-path gates.
2. An unstaged protected change fails the worktree/status gates even when committed scope is clean.
3. A staged protected change fails the index/status gates even when committed scope is clean.
4. Exercise the restored-worktree trick in both forms: stage a protected change and restore only its worktree content to the base; separately commit a protected change and restore only its worktree content to the base. A base-to-worktree diff can be empty in either form. The staged form must still fail the index/worktree/status gates; the committed form must still fail the committed/protected-path gates and dirty-state gates. Do not reset the index as part of the worktree restoration.
5. Include an untracked-file case to verify the status gate, then demonstrate that the clean allowed-only fixture passes again. Report the fixture checks and expected failures separately from the actual implementation acceptance. Clean up the fixture without touching the implementation checkout.

The scope fixture proves the acceptance procedure; it does not authorize adding a scope-check tool or modifying protected files in the probe deliverable. This review records that proof as required future task acceptance, not as already executed evidence.
