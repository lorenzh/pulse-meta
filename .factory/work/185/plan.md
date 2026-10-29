# Spec: Small review leftovers (P3) (#185)

## Goal
Ship the collected P3 review findings together: weak regression tests that pass on old code, stale docs, one hook misconfiguration and one missing log line.

## Scope
Per-target items listed in the sections below. Each is independent; no cross-target interface changes.

## Non-goals
- No new features, no behavior change beyond the two code changes: contract `lefthook.yml` and the status log line for malformed resolved incidents.
- No change to wire formats or the contract API.

## Required behavior and rules
- Line numbers in the issue are approximate; locate the text in the code.
- Every test named below must fail against the pre-fix behavior and pass against the fix. Verify by temporarily reverting the fix locally (do not commit the revert).
- Docs state what the code does; read the code to word them.
- `AGENTS.md` fix: replace "shared types only. It has no runtime code" with wording matching contract line 26 ("shared types, plain-TS validators and the wire version. It has no runtime dependency and depends on no other repo."). Status already says it correctly; leave it.

## Risks
- Enabling contract's lefthook may surface existing violations; fix them within contract.
- Test hardening may reveal that a fix is itself incomplete; report instead of widening scope.

## Acceptance evidence
- `npx lefthook dump` in contract lists pre-commit commands.
- Each listed test fails on old behavior, passes on new.
- Tests and lint pass in every touched repo.
- `grep -rn "no runtime code"` finds nothing in the consumer `AGENTS.md` files.
- Status logs a malformed resolved incident.
- `scripts/compose-e2e.sh` no longer restarts the probe.

## Repository: contract
- `lefthook.yml`: change scalar `extends: node_modules/@lorenzh/pulse-config/lefthook.yml` to the list form used by the other repos (copy api's).
- Check `AGENTS.md` and docs for any statement about the hook and make them match.
- Fix any pre-existing lint/format violations the hook now surfaces.
- Done when `npx lefthook dump` shows pre-commit commands and checks pass.

## Repository: notify
- `src/notifier.ts`: tests only for the build catch at the enqueue sites (normal enqueue and the legacy pending rebuild loop, ~line 292). Add fault-injection tests: a build that throws is logged with channel and key; the key is not left queued; other events and channels still deliver; after the data is corrected the event is delivered. Removing the catch must make the tests fail.
- `docs/operation.md`: list the build-error log line verbatim.
- `docs/development.md`: describe the hook as Biome plus the type-aware ESLint rules (read the real hook and config).
- `AGENTS.md` line 26: contract wording fix.
- Done when tests, lint pass and the catch-removal check fails the new tests.

## Repository: api
- `docs/operation.md` (~24): list the `late` column and its one-time backfill among migrated columns.
- `src/service.inactive.test.ts` (~70): assert `listChecks()` excludes the removed check before pruning, so the test fails on old code.
- `scripts/compose-e2e.sh`: drop only the probe restart in the reload step (probe reloads checks itself); keep the rest.
- `docs/troubleshooting.md` (~70): replace structural error messages with those the contract validator now produces (read exact text from contract `src/validate.ts`, e.g. `result: must be an object`); keep API-specific bound messages.
- `AGENTS.md` line 26: contract wording fix.
- Done when tests, lint pass and the retention test fails on reverted code.

## Repository: probe
- `src/scheduler.test.ts` (~224, "wall clock step back") and `src/check.test.ts` (~444): actually step the wall clock back (fake timers or mocked `Date.now`) and assert the old behavior fails.
- `docs/configuration.md` (~43, ~77): update startup retry description and the invalid-TLS-check semantics to match the code.
- `docs/operation.md` (~10): replace `retrying in 2000ms` with the real log line.
- `docs/troubleshooting.md` (~31): move "fix the check" from version mismatch to invalid checks.
- `AGENTS.md` line 26: contract wording fix.
- Done when tests, lint pass and both regression tests fail on the reverted fix.

## Repository: status
- `README.md` (~43): say non-JSON *successful* (2xx) upstream answers give 502; non-2xx keep their status with `{"error":"API error"}`.
- `docs/troubleshooting.md` (~36): timeout is the shorter of `POLL_MS` and 4000 ms.
- Poller tests "the first error stays published after the abort" and "a hidden tab aborts all pending requests": let aborted siblings reject, and add a case combining a failure followed by hiding; they must fail on old code.
- Malformed resolved incidents: add a log line (README already promises it; do not change README wording). Update the malformed incident/maintenance test to assert the log so it fails on old code.
- `src/server.ts` (~359): add a regression test for the rejection handler with a malformed upstream URL (`http://[`): the process must not crash.
- No `AGENTS.md` change (already correct).
- Done when tests, lint pass and the new tests fail on reverted code.

## Repository: config
- `AGENTS.md` line 26: contract wording fix. Nothing else.
- Done when `grep "no runtime code" AGENTS.md` finds nothing and checks pass.
