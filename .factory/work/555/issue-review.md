# Issue review: #555

The feature can proceed to `plan`. No question requires an owner decision before a spec can be written. The points below need explicit contracts in the spec; the proposed assumptions keep the work within the request.

## Sources and inspected baseline

- Read the meta `AGENTS.md`, `README.md`, approved-packages list, Factory prompts, and `audits/architecture/system.md` (finding 3 and notes 2 and 6).
- Read [issue #555](https://github.com/lorenzh/pulse-meta/issues/555) and all its comments. At review time the only comment was the Factory claim; there are no earlier decisions or feedback to preserve.
- Inspected the read-only clones: kit `6a06ec2`, api `c00a375`, probe `50ec9ca`, status `2e3067d`, notify `c090a07`, console `11a3f5f`, and their `AGENTS.md` files. Also checked the contract's timer constant and package dependencies, the website's docs source pin, and deploy's files. Deploy `2b2a355` currently holds a placeholder README and LICENSE, with no Compose implementation, despite the broader meta README description.
- All five services currently declare kit `fa79ba8cd93949fc0cf87f7b41bdaf261dbe4dc6` in `package.json` and the corresponding resolution in `bun.lock`.
- This state changes only this review artifact. No target code was edited.

## Confirmed behavior and migration inventory

| Area | Current code and implication |
| --- | --- |
| Timer settings | kit `src/settings.ts:35` uses `Number.MAX_SAFE_INTEGER` as the omitted `readMs.max`; its fallback returns before validation. status `src/settings.ts:62` and notify `src/config.ts:367` use uncapped values for timers. |
| Existing timer helper | kit `src/timer.ts` already exports `MAX_TIMER_DELAY_MS = 2147483647`; `safeSetTimeout` rejects out-of-range delays with `RangeError`, rather than clamping. No service currently imports it. |
| Local timer constants | api `src/location-silence.ts`, probe `src/settings.ts`, and probe `src/reload-interval.ts` repeat the platform maximum. Probe scheduler/reloader also use contract's `MAX_TIMER_MS`. API's one-hour reload limit is a distinct product constraint. |
| Shutdown | kit `src/run-service.ts:55` defaults timeout exit to `0`, with an optional override. All five services already use `runService`: api/probe/status/console `src/main.ts`, notify `src/index.ts`. None sets `timeoutExitCode`. The kit test suite explicitly expects the old default. |
| Logger | kit `src/logger.ts:44` directly stringifies unknown fields. Field enumeration, a getter or `toJSON`, the clock, and the sink can also throw. Existing reserved fields, level filtering, JSON lines, and stdout/stderr routing are part of its current contract. |
| API atomic write | `src/config-write.ts:357` plus `src/config-fs.ts:31` already implement temp file, file fsync, revision recheck, rename, and directory fsync. They preserve file mode, attempt owner/group preservation (tolerating EPERM), serialize edits, clean up temp files, and map filesystem errors to admin responses. |
| Notify atomic writes | `src/ledger.ts:176` writes synchronously for durable claims; `:228` writes batches asynchronously. Both fsync the file but omit directory fsync. `src/ledger-lock.ts:108` rewrites heartbeats with write/rename and no fsync. Lock acquisition and takeover markers separately use exclusive `wx` creation. |
| Object guards | The 11 identical guards are api `config.ts`, `config-write.ts`, `tokens.ts`; probe `check.ts`, `check-domain.ts`; status `api-filter.ts`, `poller.ts`, `syndication.ts`, `hidden-checks.ts`; notify `config.ts`, `ledger.ts`. They accept non-null, non-array objects, not just plain objects. |
| Secret readers | kit has no `readSecretFile`. Probe `src/token.ts` and console `src/admin-token.ts` duplicate trimmed, nonempty, single-line file reading and safe filesystem error-code extraction. Console additionally enforces minimum length, no whitespace, printable ASCII, and rejection of example/placeholder tokens; probe has a looser token policy. |
| Status browser boundary | `src/poller.ts` runs in the browser and contains one guard. `src/server.ts:244` serves only kit `escape.js` and `format-duration.js`, and rewrites kit subpath imports. Kit's root imports server modules and is unsuitable for the browser. |

Read-only reproduction using `bun -e` against kit source, with injected clock, sink, process, and timer:

```text
readMs(30 days): 2592000000
safeSetTimeout(30 days): RangeError
BigInt threw TypeError
circular threw TypeError
timed-out shutdown exits: [ 0 ]
```

No real long timer or process exit was used. No product test suite or Compose stack was run in this review state.

## Open points and proposed assumptions for the spec

### 1. Define timer limits at the correct boundary

“Cap timers” could mean reject, clamp, or split long waits. Assume oversized configured timer delays are rejected at startup, using `StartupError`, and direct invalid timer calls are rejected before reaching the runtime. Keep `safeSetTimeout`'s existing rejection contract; neither silently shorten a requested 30-day delay nor introduce long-wait scheduling. The literal maximum is `2147483647` ms; 30 days is `2592000000` ms.

Make `readMs` default to the platform maximum and include the effective upper bound in its standard error. Preserve lower per-setting limits, defaults, blank handling, zero where it disables an operation, and custom error wording where accurate. Specify how invalid fallbacks and explicit larger maxima are handled so neither can feed an oversized value to a timer.

Audit every `readMs` caller before changing its default. It also parses non-timer integers: api retention days; probe result counts and buffer age; notify retry counts, health failure counts, state retention days and API byte limits. Do not accidentally impose a timer bound on these unrelated settings. The planner can use an explicit appropriate maximum or a shared integer reader rather than introduce local parsing copies. Status cache age is likewise a timestamp comparison, not necessarily a timer delay.

Also inspect derived delays, especially notify's lease seconds converted to heartbeat milliseconds (`src/index.ts:300`) and retry backoff. A bound in milliseconds alone does not make an input in seconds safe. Retain legitimately fractional calculated delays if current scheduling requires them; the integer-only `safeSetTimeout` cannot simply replace every timer call without examining that behavior. Define the production timer wiring and preserve dependency injection, cancellation, and `unref` semantics. Replace duplicate platform constants with kit's constant where appropriate; retain contract's independent wire-validation maximum and API's narrower product limit.

### 2. Fix the existing service runner

“A runService wrapper” refers to the existing public helper, not a second lifecycle abstraction. Assume timeout exits `1` by default; clean completion remains `0`, startup setting failures `2`, and other startup/shutdown failures `1`. Define the override policy explicitly: positive custom failure codes may remain, but an override must not make a timed-out shutdown successful. Preserve signal registration before start, one stop for repeated signals, readiness/cleanup behavior, and cancellation of the bound after completion.

Update tests and operator docs that describe timeout exit `0` (for example probe `docs/operation.md:81`). This request does not ask for a redesign of handling a startup promise that never settles.

API has a second bound: `src/start.ts:335-366` races draining against 5000 ms, force-closes connections on timeout, finishes cleanup and resolves. Its `src/main.ts` gives kit a 6000 ms backstop, so fixing only kit can still report success after API's inner timeout. The spec must resolve this explicitly. Proposed assumption: a timed-out API drain also propagates failure after required cleanup so the process exits non-zero; normal drain stays successful. Preserve the existing guarantee that background work ends before database close, and adapt `src/start.test.ts`'s forced-close test accordingly.

### 3. Bound the “never throws” logger contract

Assume each logger method contains synchronous failures from unknown fields, serialization, clock and sink. Healthy sinks must receive valid JSON for BigInt and circular inputs while preserving the base keys and useful ordinary fields. The spec must choose a deterministic BigInt representation and circular/unserializable marker, and define fallback behavior for throwing getters, `toJSON`, invalid dates and write callbacks. A broken sink cannot guarantee delivery; it must not crash the caller or trigger recursive logging. Do not include a thrown object's arbitrary text or full input in a fallback, as it may contain secrets. This is not a guarantee against process termination, resource exhaustion, or unrelated asynchronous stream failures.

### 4. One atomic-write contract must fit both consumers

Assume one kit-owned durable replacement facility, with sync/async entry points if needed. The synchronous path is necessary because notify must persist claims before sending; the asynchronous path must retain batched I/O. Define names, signatures, injected filesystem operations, and package exports in the spec. Service adapters may keep business rules; they must not keep independent temp/fsync/rename algorithms.

Required semantics and compatibility points:

- Create an exclusive, collision-safe temp file in the destination directory; finish all bytes, fsync the file, close, rename, then fsync and close the directory before reporting success. Define metadata and creation mode, preserving API's current mode/ownership behavior and avoiding broader access to stored secrets.
- Permit API's second revision check after the temp file is durable and immediately before rename. Keep its serialized edits, ETag/conflict behavior, response/error mapping, and adoption of stored configuration only after the required persistence steps.
- Permit notify's asynchronous snapshot validity check/cancellation near rename, and preserve its sync-write generation checks and corrective rewrite when a claim races a batch. Its existing `test/ledger.race.test.ts` exercises this. Replacing fixed temp names may require adapting tests that currently force a failure by creating `<path>.tmp`.
- Before rename, failure/interruption leaves the destination's exact old bytes intact (or leaves it absent for a first write); clean up a temp file on handled failures without masking the original error. An abrupt crash may leave a disposable temp file. Atomic replacement is not a cross-process compare-and-swap guarantee.
- After rename, directory-fsync failure cannot promise restoration of the old file: report the durability error and specify how callers retain/reconcile state for retry. Keep API's existing recovery behavior; ensure notify does not treat an already-published write as though no publication occurred.
- Migrate all four audited paths, including notify lock heartbeat rewriting. Keep lock acquisition/takeover-marker exclusive creation and ownership checks: replacing `wx` acquisition with overwriting rename would break mutual exclusion. Keep parent-directory creation and service-specific lock/ledger policies at their appropriate boundary.

Target Linux/Bun service deployment semantics. Do not weaken directory fsync silently for unsupported filesystems; define and surface failures. Built-in `node:` modules suffice; no new runtime package is needed.

### 5. Define helper boundaries without changing token policies

`isRecord(value: unknown): value is Record<string, unknown>` should preserve the exact existing non-null/non-array predicate, including acceptance of objects with null prototypes. Export it from kit's package entry and a browser-safe subpath with no server imports. Add that subpath to status's allowlist, use its existing rewrite mechanism, and test the served module and browser polling. Never expose the kit root or filesystem helpers to the browser. Contract's similar private guard stays independent; adding a contract-to-kit runtime dependency is outside this request.

Assume `readSecretFile` extracts the shared file-read, trim, nonempty/single-line, and sanitized error behavior used by probe and console. Give it an injected reader and enough error context to name the setting/path safely. Env/file mutual exclusion, required versus optional token, minimum length, whitespace/ASCII rules, and placeholder policy remain service decisions; move them only if configurable behavior preserves both consumers. Neither error messages nor logs may contain file contents, tokens, or arbitrary filesystem exception text.

Notify's channel secret reader (`src/config.ts:49-96`) deliberately strips only trailing newlines and retains other spaces; credentials can have different rules from bearer tokens. Do not migrate it through a token-trimming helper unless the spec explicitly preserves that behavior. “Replace local copies” means the identified duplicated infrastructure, not unrelated URL parsers, config validators or all helpers found in the audits.

### 6. Scope, pin selection, and final integration evidence

Assume six implementation targets: kit, api, probe, status, notify, console. All five consumers depend on the merged kit change; they can then migrate independently. There is no new wire shape, route, env name, or contract behavior. Do not rename environment variables or roll in other audit findings, tooling upgrades, service imports, docs-site republishing, or deploy work. Website's kit docs-source ref is not a service dependency pin.

Choose one concrete full SHA on kit `main` containing the completed helper changes and committed `dist/`; record that SHA once for all five consumers to use. It cannot be known during issue review. Prevent independent children from selecting different later `main` tips. Update both manifests and lockfiles, build artifacts/exports and kit smoke tests, plus affected helper/operator documentation.

`compose-e2e` currently belongs to api (`.github/workflows/ci.yml:66`, `scripts/compose-e2e.sh`); it builds the other services from their GitHub `main` refs in `compose.yaml`. An API PR's early green run therefore cannot prove that all five migrated services work together. The rollout must capture a final integration run after all consumer changes are on main, or use temporary checkout/build overrides for the exact candidate refs and still verify the final main stack. Do not require API to wait for consumer merges in `targets.json` merely for a final test; those consumers do not need API code changes to build.

Plan should flag security impact for file writes, authentication-adjacent secret parsing, external log data and dependency pins, and note possible extra I/O cost from directory fsync in notify (including heartbeat writes). Existing CI/coverage/complexity gates stay intact.

## Derived acceptance check

Expected numeric bounds, exit codes and fixtures below are independent literals, not values read back from the code under test. Use injected fakes for clocks, process exits, filesystem failures and scheduling, plus isolated temporary directories for file integration checks. No 30-day real wait is needed.

1. **Timer regression:** `readMs` used for a timer rejects `2592000000` and `2147483648` without echoing the supplied value; `2147483647` is accepted. A fake downstream scheduler records no call for rejected settings. Exercise a currently uncapped real service setting such as status `POLL_MS` to prove adoption. Test fallback/override policy and relevant derived delays. Existing `safeSetTimeout(30 days)` rejection already passes on main and is insufficient as the new regression by itself. Maintain accepted ranges for non-timer integers and existing zero/minimum behavior.
2. **Shutdown regression:** with `stop` pending, trigger SIGTERM and advance the injected bound; default exit is exactly `1`. A late resolution and second signal cause no second exit. Clean stop remains `0`; startup `StartupError` remains `2`. Cover the chosen override policy and API's internal forced-drain timeout, including failure propagation through the outer runner after cleanup. Replace kit's old default-zero assertion and preserve each service's cleanup tests, including notify's lock release and API's no-write-after-database-close guarantee.
3. **Logger regression:** log a BigInt and a self-referencing object at an enabled level, including them together; calls do not throw and each resulting line parses as JSON. Check the spec's literal representations, retained ordinary fields, reserved keys and filtering. Also cover a throwing getter/`toJSON`, invalid clock and throwing sink for the literal never-throws contract. Fallback output contains no sentinel secret or arbitrary exception text.
4. **Atomic durability:** for both execution modes, verify the literal operation ordering (write complete bytes, file fsync, rename, directory fsync). With a preexisting fixture `old\n`, inject interruption/failure after file fsync but before rename and verify exact old bytes remain; resume a successful write and observe the complete new fixture. Check handled temp cleanup, destination-directory placement, exclusive creation/collision behavior, and preservation of API mode `0640`. Inject directory-fsync failure separately and assert the documented post-rename error/recovery behavior. The old API already passes pre-rename safety; a newly added test cannot honestly be called a regression against API main for that alone. Add consumer durability coverage that fails on notify's missing directory fsync, rather than relying only on an absent new export to make a test red.
5. **Helper consolidation:** object-guard cases include `{}`, a null-prototype object, `null`, an array and a primitive with literal expected booleans. Search all 11 listed production call sites and confirm they use kit rather than duplicate predicates. Fetch status's browser helper through the real local server and exercise polling; ensure filesystem/root kit files remain inaccessible. Probe/console token tests preserve their differing policies, trim/blank/multiline handling, env/file conflicts and missing-file behavior, and prove a sentinel token/content never reaches public errors or logs.
6. **Consumer compatibility:** API admin tests still preserve revision conflicts, file metadata, old bytes before rename, error status mapping, and later reload after post-store failure. Notify tests still prove durable claim-before-send, batch/claim race safety, dirty retry/flush, single lock ownership, takeover behavior and heartbeat error handling. All four atomic replacement sites call kit; acquisition still uses exclusive creation.
7. **One version and green integration:** record the chosen merged kit SHA as a literal in completion evidence; all five `package.json` dependencies and independently resolved `bun.lock` entries match it. Frozen-lockfile installs and each target's existing `bun run check`/CI pass; kit's committed `dist` matches a fresh build and its entry/subpath smoke checks include new modules. Record the five service refs and a passing final API `compose-e2e` run using those migrated services, including graceful exits `0`. Report unavailable checks as unverified, not green.

For the four requested defect regressions, preserve evidence that the new assertion fails for the intended reason on the inspected baseline and passes after implementation. Shared-helper extraction and pin equality additionally need the migration and integration checks above; the four examples alone do not establish completion.
