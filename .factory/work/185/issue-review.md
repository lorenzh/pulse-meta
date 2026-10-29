# Issue review: #185 Small review leftovers (P3)

## Verdict
Specifiable. Independent small items per target, no cross-target dependency (no `dependsOn`). No blocking question.

## Observed in clones
- contract `lefthook.yml` uses scalar `extends:`; api uses the list form. Contract `AGENTS.md` line 26 already reads "plain-TS validators and the wire version", so for contract only `lefthook.yml` changes, and `AGENTS.md` must be checked for any mention of the hook.
- `AGENTS.md` line 26 still says "no runtime code" in api, probe, config and notify. Status was not checked. Their wording must match contract's line 26.
- notify `src/notifier.ts` has the build catch (docstring "Builds first, so a build error leaves the key unqueued"); the legacy pending rebuild loop is near line 292.
- status `src/server.ts` has the `handle(...).catch` rejection handler near line 359.
- status `README.md` line 43 says 502 for a non-JSON upstream answer without "successful".

## Open points (non-blocking)
1. "all consumer repos" for the `AGENTS.md` fix is not enumerated. Assume api, probe, status, notify and config, copying the contract wording. The planner should confirm per clone, including status.
2. Line numbers in the issue are approximate. The planner must locate the text itself.
3. The probe tests that "pass on old code" need a way to step the wall clock back (fake timers, or mocking `Date.now`). Each must demonstrably fail against the pre-fix behavior. Assumption: verify by temporarily reverting the fix locally. The same applies to these tests:
   - api retention test
   - status poller tests (let aborted siblings reject, and combine a failure followed by hiding)
   - status malformed incident/maintenance test
4. Status malformed resolved incidents: the issue gives two options, add a log line or fix the README. Assumption: add the log line, because the README promises it. Do not change the README wording.
5. Probe docs: the actual new startup retry behavior (interval or backoff) and the TLS-check semantics must be read from the probe code and docs updated to match. `retrying in 2000ms` must be replaced with the real log line.
6. api `docs/troubleshooting.md`: replace only the structural messages that the contract validator now produces. Read the exact messages from contract `src/validate.ts`. Keep the API-specific bound messages.
7. api `scripts/compose-e2e.sh`: drop the probe restart only; keep the rest of the reload step. If other things rely on it, the plan must say so.
8. notify tests: cover both the normal enqueue and the legacy pending rebuild. Assert the log fields (channel and key), that the key is not queued, that other events and channels still deliver, and that delivery succeeds after the data is corrected. `docs/operation.md` lists the build-error log line verbatim.
9. notify `docs/development.md`: describe the hook as Biome plus the type-aware ESLint rules. Read the real hook and config in notify to word it.
10. status `docs/troubleshooting.md`: the timeout is the shorter of `POLL_MS` and 4000 ms.

## Constraints
- Docs and tests, plus two small code changes: the contract `lefthook.yml` and the status log line. No other behavior changes.
- Fixing contract's lefthook may make the hook run for the first time. Pre-existing violations may surface, and the build must handle them within the contract repo.

## Acceptance check
- `npx lefthook dump` in contract shows pre-commit commands.
- Each of the listed tests fails against the old behavior and passes against the new.
- Test and lint suites pass in every touched repo.
- Each listed doc statement matches the code. `grep "no runtime code"` finds nothing in the consumer `AGENTS.md` files.
- The malformed resolved incident is logged by status.
- `scripts/compose-e2e.sh` no longer restarts the probe.
