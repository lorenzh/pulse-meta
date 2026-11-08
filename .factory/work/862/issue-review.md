# Issue review: probe location validation (#862)

## Decision

Ready for `plan`; no blocking question. The latest manager requirements supersede earlier claims about child-process controls. One target, `probe`, is sufficient; no contract, API, kit, deployment or shared-tooling change is required.

Security finding `security-probe-2026-11-04-1` is public P2. Location: `pulse-probe/src/location.ts`, at the `PULSE_LOCATION` configuration boundary, before `src/check.ts` uses the location in the generated HTTP `User-Agent`. Class: insufficient validation of configuration used as an HTTP header value. Impact: an incompatible location can be accepted at startup and make that probe's HTTP checks report false `down` results; the issue reports TCP checks and a valid control staying up. Fix direction: validate the trimmed location against the generated header's accepted character classes during startup, preserve accepted location identity, and reject incompatible values with a fixed value-free diagnostic and exit 2. This is not evidence of header injection or credential disclosure.

## Repository evidence

Inspected the read-only `probe` clone at `9490141ef9e92044808c70bb8200db3d497d1060` (the available `main`). Record the implementation checkout's own exact base SHA before changing it; refresh these observations if that base differs.

- `src/location.ts:1-16`: `parseLocation` trims with `String.trim()`, maps unset or blank to `default`, rejects a trimmed length above 64, and otherwise returns the location unchanged. There is no character validation. `userAgent` embeds that string in the generated header without encoding or replacement.
- `src/settings.ts:66-101`: `loadSettings` calls `parseLocation` directly on the environment value and wraps its ordinary error as a single-line `StartupError`. This already provides the error path needed by a parser-only production change.
- `src/main.ts:241-256`: settings load before the health listener and before check loading. A rejected location can therefore stop startup before any listener, API request or check. `src/main.ts:158` logs an accepted location and API URL after successful validation; a new rule must not accidentally demand removal of that protected info line.
- `src/check.ts`, `sendHop`: the generated `user-agent` is set on each HTTP request; the result path uses the original `deps.location`. Fetch failures become `down` with a sanitized reason. The TCP path does not build this HTTP header. These are source observations, not a new end-to-end reproduction of the security finding.
- `src/location.test.ts` already covers defaults, trimming/case, the 64/65 boundary and the generated agent. `src/settings.test.ts` checks startup-error wrapping. `src/check.test.ts` has local HTTP helpers and an existing result-location/header assertion. `src/main.test.ts` already spawns the real entry point against local peers and tests occupied-health-port failure before an API call.
- `README.md` links configuration but does not document the accepted location characters. `docs/configuration.md` has the setting table, Location section and migration sections. `docs/troubleshooting.md` documents the existing length error. Probe's `AGENTS.md` explicitly requires `README.md` in the same change when a setting or behavior changes.
- `package.json` pins Bun 1.4.0 and has `check` = lint, typecheck and tests. `bunfig.toml` enables coverage with an 80% line threshold. A partial test run can have passing tests but fail its coverage exit gate.
- `.factory/config.yaml` already gives `probe` context for `meta`, `contract`, `config` and `kit`. No Factory configuration update is needed.

The available kit clone (`536133f3e8b708179fa01feeb02395a0e1961e07`) shows `runService` writing a single prefixed `StartupError` line to stderr and exiting 2 in `src/run-service.ts`. The available contract clone (`1b5e7d3e268372a6241db05ae30272eab7299b10`) has a header-value rule in `src/schema.ts` that excludes tabs; it must not be reused to narrow the probe's previously working location set. These clones are newer context, not proof of behavior at the dependency pins in probe's `package.json`.

## Decisions carried forward and resolved open points

1. **Accepted form and compatibility.** Carry forward the earlier specification decision: trim first; default if empty; check the existing 64-character limit first; then accept only tab, space, visible ASCII and Latin-1. The accepted code-unit set is U+0009, U+0020-U+007E and U+0080-U+00FF. Preserve the existing length metric (JavaScript string length), case and exact returned identity. Do not replace, escape, encode, case-fold or otherwise normalize an accepted location. The character rule applies after existing trimming, not to the raw setting.
2. **Rejected classes.** Cover disallowed controls, the excluded ASCII deletion-control class, and characters outside Latin-1, including supplementary characters and isolated surrogates, in parser tests. Keep test inputs internal to test code, built at runtime from escapes or code points. A process-environment regression must use a class that can actually reach the entry point intact; transport restrictions must not turn it into a parent-spawn failure. Do not publish concrete refused values.
3. **Error contract and precedence.** Retain `PULSE_LOCATION is longer than 64 characters` exactly, with length validation preceding the new character check. Carry forward the fixed character diagnostic `PULSE_LOCATION must hold only tab, space, visible ASCII or Latin-1 characters`. The process emits only the usual `pulse-probe: ` prefix, that diagnostic and a newline on stderr, exits 2, and has no stdout. Assert the runtime length message rather than grepping a literal source string: the existing source interpolates its length constant.
4. **Value-free scope.** The new parser error, its rejected-location startup output, and new test titles/assertion messages must contain no location value, credentials or full settings. This does not prohibit existing successful-startup logging of accepted settings or expand the change into an unrelated logging rewrite. Rejected values must never reach that successful-startup line.
5. **Test layers and baseline evidence.** Test parser identity and generated-header transport with in-process strings; test startup rejection through a child process. Do not revive the earlier unverified claim that a non-ASCII environment-passed startup control succeeds on the base. Before marking any child-process control as passing on BASE, run that exact control through the real entry point on the recorded base and capture its successful result. A failing base control must be removed or redesigned, never silently reclassified as a regression.
6. **Runtime limitation sentence for the plan.** Bun's child-process environment decoding can differ from in-process strings, so an accepted in-process transport control is not proof of an accepted startup control.
7. **Disclosure.** The plan, issue review, task acceptance and PR text must identify location, class, impact and fix direction as above. They must contain no working payload, concrete refused value, value table or manual reproduction command. The plan names rejected classes and explains runtime construction without supplying construction expressions. Task acceptance names test cases by title only. Probe's usual manual-start convention can be satisfied with an accepted control and a safe result report; it does not authorize publishing a security reproduction command.
8. **Scope.** Keep the implementation cohesive: one production parser change, four test suites and three documentation files. No production changes to settings wiring, HTTP execution, scheduling, authentication or quorum. No shared package, dependency pin, lockfile, build, CI, coverage-threshold or tooling change. API location/token identity remains unchanged; operators who must rename a rejected location must coordinate the matching API token location as existing documentation requires.
9. **Verification gates.** Follow probe's TDD instructions: new rejection tests must fail on the recorded base for the intended reason and pass after the fix. Compatibility controls must pass on that base. Judge a focused four-suite run by test results, all named cases passing and `0 fail`, not by its coverage exit status. The full `bun run check` must exit 0 and enforce the unchanged coverage threshold. Do not weaken tooling or skip commit hooks.
10. **Prior review corrections remain binding.** Scope logging restrictions to rejected-location diagnostics; check the overlength error at runtime; align focused-run criteria with coverage behavior; include README in both `Files:` and exclusive-scope acceptance. There is no reason to repeat the earlier spec defects.

## Derived acceptance

### Behavior and regression cases

The plan and task should assign stable, value-free titles to these cases and refer to those titles in acceptance:

- **Location rejects incompatible header characters:** runtime-built inputs cover each rejected class, with a fixed diagnostic free of values; combine overlength and incompatible input to prove length-error precedence.
- **Location preserves accepted names and generated header:** defaults, blank input, existing trimming, case, 64-character boundary, punctuation, internal whitespace, and accepted extended characters preserve identity and the agent format. Test representative accepted characters and the accepted set's boundaries without narrowing valid names.
- **Settings rejects an incompatible location without exposing settings:** the pure settings call returns the expected one-line `StartupError`, with no setting value or credential sentinel.
- **Local HTTP preserves accepted location identity:** pass an accepted location through the parser and real `runCheck` to a loopback HTTP server, assert `up`, status 200, null reason, the unchanged result location and exact generated header as received. Exercise the accepted extended range in-process; do not treat an environment-decoding artifact as a production-parser failure.
- **Startup rejects an incompatible location before side effects:** spawn the real entry point with otherwise valid settings, a local API counter and an occupied local health port. Assert exit 2, exact fixed location stderr, empty stdout, no stack, no values or credentials, and zero API/check-target requests. The location error must win over the occupied-port error. Bound the child's lifetime and clean up child and servers even on assertion failure.
- **Startup accepts a verified control location:** if the plan includes this extra process-level compatibility control, prove it passes on the recorded base first. It must perform a real local HTTP check, receive the exact generated header, post an `up` result with matching identity, then shut down cleanly. Do not assume an in-process passing value passes through the child's environment.

New parser/settings/startup rejection cases fail on BASE for the missing validation, then pass after the fix. Existing and new accepted controls remain green. Tests construct refused values only at runtime inside test code; test failure reporting must not print them. Add documentation in README and configuration for accepted values, default, trimming, case, length, startup rejection and unchanged identity; add safe troubleshooting and migration guidance without any refused value or reproduction command.

### Exclusive file scope and fixture proof

The planned probe `Files:` list is exactly:

- `src/location.ts`
- `src/location.test.ts`
- `src/settings.test.ts`
- `src/check.test.ts`
- `src/main.test.ts`
- `README.md`
- `docs/configuration.md`
- `docs/troubleshooting.md`

Record `BASE` as the exact implementation base commit before editing. Task acceptance must inspect each Git state separately after the last implementation commit:

1. Compare `git diff --name-only "$BASE" HEAD` against the exact allowed list above. No changed path outside that list may pass; the final change must include the required parser, test and documentation files, including README.
2. Require `git diff --name-only --cached` to be empty.
3. Require `git diff --name-only` to be empty.
4. Require `git status --porcelain` to be empty, including untracked files.
5. Require `git diff --exit-code "$BASE" HEAD -- <protected files>` to succeed, with the plan expanding the placeholder into explicit protected paths. Include `src/settings.ts`, `src/main.ts`, `src/check.ts`, scheduling/client/authentication files and tooling/dependency/CI files. The exact allowlist also protects all paths not named above.

Prove the actual proposed gate in a disposable fixture repository before relying on it. Include a clean allowed committed change that passes, and protected edits present separately in the working tree, index and commits that each fail. Include both restored-worktree tricks: stage a protected edit then restore only the worktree to BASE; commit a protected edit then restore only the worktree to BASE. Both must fail even though the protected worktree bytes match BASE. Also reject an allowed but uncommitted change and an untracked file, because final cleanliness is independently required. Use harmless fixture content and local-only commits; the fixture is not an extra file in the probe PR. Show results for each state, rather than claiming that a single working-tree diff covers them all.

### Completion evidence

Report the recorded base SHA, red/green results by test title, actual base-pass controls, focused test summary, full `bun run check` success with unchanged coverage policy, scope checks for commits/index/worktree/status, protected-file check, fixture-state outcomes and documentation review. Public evidence stays value-free and contains no security reproduction command. Review all new artifacts and PR text for disclosure compliance before handoff.

## Checks performed in this issue review and limits

- Read meta's and probe's `AGENTS.md`, meta README, Factory issue-review prompt, target source/tests/docs/settings/tooling declarations, and current kit/contract context. Probe's clone was clean at the recorded SHA.
- Bun 1.4.0 is available. Read-only parser controls passed for default, blank, trim, case, 64 characters and the exact runtime 65-character error. A loopback HTTP transport check with the base parser and header generator passed for all 224 accepted code units embedded inside a location, preserving both parser identity and received header. This did not invoke `runCheck` or the real entry point and is not a startup-control claim.
- Probe and meta dependencies are not installed. No child-process startup control, full regression suite or full `bun run check` was run here; none is listed as passing on BASE. Installing into a read-only target clone is outside this state's scope.
- Optional managed-environment status tooling was not exposed. Initial lookups confirmed that work directory 862 did not yet exist and corrected kit source paths to `src/run-service.ts` and `src/settings.ts`. The artifact directory is created by this write.
- Attempts to inspect probe's pinned dependency objects locally failed: the contract pin has no readable `src/schema.ts` in the available object lookup, and the kit pin is unavailable. The config-pin lookup was not reached. Later states must verify exact pinned tooling and helper behavior from available pinned sources or installed dependencies before making pin-specific claims; current-clone observations above are explicitly limited.
- Earlier issue comments describe prior plan/task artifacts, but `.factory/work/862` was absent in this fresh checkout. This review carries their manager decisions and corrections forward without claiming those earlier artifacts exist here. Only this issue-review artifact is written in this state.

No unresolved product decision blocks a precise, testable probe-only spec.
