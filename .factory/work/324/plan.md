# Spec #324: Small review leftovers (P3), round 3

## Goal
Close a bundle of small, independent review leftovers across six targets: validator hardening, test-quality fixes, docs corrections, input validation.

## Scope
contract, probe, api, status, notify, config. `kit` and `website` are not changed (kit's `readUrl` is only used). Plus one meta edit, see "Meta follow-up".

## Non-goals
No new features, no wire-format change, no change to JSON input handling. No Factory prompt change. No version bump in other targets.

## Rules for every child
- Line numbers in the issue are stale. Re-locate each item; if already fixed, skip it and say so in the PR.
- Every test-quality item needs a mutation run: remove the guarded line (or apply the named revert), run the test, confirm it fails, paste the failing output into the PR, restore the line. A test that stays green is not done.
- Runtime dependencies only from `docs/approved-packages.md`.
- PR lists each leftover with its fix (or "already fixed").

## Meta follow-up
The README settings section of this repo (~line 161) has an exception sentence about the probe accepting an invalid `PULSE_API_URL`. Remove it after the probe PR merges (a person or a follow-up meta change; it is not a child target).

## Repository: contract
- Validators: check declared fields without spreading the object. Required fields must be own properties at every level (e.g. an uptime day's `date`), not only the outer object. A valid non-enumerable own `id` is accepted. Unknown enumerable getters are never run, so validators never throw. JSON input and wire format unchanged.
- Tests: nested inherited required field rejected; non-enumerable own `id` accepted; throwing getter on an unknown key does not throw. Mutation: restore the spread / outer-only check and show these fail.
- TypeScript: try TypeScript 7 (currently pinned 6.0.3) under Bun. Compare build time (6.x ~3.9 s vs 7 ~0.71 s). Restore 7 if it works; otherwise record why in the PR and in the docs. Report whether a release is needed (assume no unless validator behavior ships to consumers; follow the repo's release convention).
- Docs: `AGENTS.md` (~18) says `node --test`, README says it requires Node, `docs/index.md` (~322) names `package-lock.json`: match the Bun reality.
- Done when: the tests above pass, the build uses TS 7 or the reason is recorded, docs match.

## Repository: probe
- `src/settings.ts`: validate `PULSE_API_URL` with `readUrl` from pulse-kit like the other services; empty or invalid (`bogus`) exits 2 with one line naming the variable. Keep the default. Test it.
- Extract the scheduler wiring out of `main.ts` into an exported function; test that function so the "wall clock step back" test fails if the wiring uses `Date.now` instead of the monotonic clock. Mutation: switch to `Date.now`, show red.
- `docs/configuration.md`: an env header reference replaces the whole header value, so a bearer token needs the scheme in the variable (`SVC_TOKEN="Bearer …"`).
- Done when: `PULSE_API_URL=bogus` exits 2; mutation output in PR.

## Repository: api
- `src/config.ts` (~371): duplicate component id error names the path, e.g. `components[1].id: duplicate component id "web"`. Test it.
- Manual-incident reads return an empty list (200) when `PULSE_API_ADMIN_TOKENS_FILE` is unset, even if the database holds incidents (`src/server.ts` ~426; spec #340 decision 1). Add a populated-database test; mutation: remove the guard, show red. Correct `docs/configuration.md`.
- `src/start.test.ts` (~411) passes on main: make it fail without the fix (mutation output).
- Docs: `docs/configuration.md` states `/components` and `/components/uptime` are public like the other reads (status proxies them without a token); decision 9 "same auth as other reads" is read that way. Env header reference replaces the whole value: bearer token needs the scheme in the variable (`SVC_TOKEN="Bearer …"`).
- `docs/install.md` (~50): status healthcheck is `GET /healthz`.
- `scripts/compose-e2e.sh` (~242): the demo guard compares against the exact expected service list (four regular, seven demo; read the list from the compose file, do not copy from this spec) instead of rejecting names containing `e2e`.

## Repository: status
- Page: show incidents of checks that belong to no component while checks are hidden, with the neutral `Service` label like the feed. Reuse the feed's label code; do not redo the feed.
- `src/syndication.ts` (~144): after a successful manual-incidents read, a 404 (older api) keeps the last successful list in `/feed.atom`, as the page does; only a successful empty list clears. Test it with a mutation run.
- `src/manual-incidents.test.ts` (~58) only validates a fixture: make it exercise the real code.
- `src/poller.test.ts` (~621) "hiding the tab before a failure settles ...": before hiding, assert the preserved first error and that sibling requests abort because of the failure. Mutation: remove `if (state.error !== null) controller.abort()`, show red.
- `docs/configuration.md`: "nine environment variables" but 11 are listed. Fix the count (find the text; if gone, say so).

## Repository: notify
- `test/manual-incidents.test.ts` (~191, ~206): the 404 and "failing manual read" tests pass on old code and fail only `/manual-incidents`; make them fail on the old behavior (mutation output).
- `README.md` (~5): mention manual incidents, updates and component routing.
- `docs/configuration.md` (~28): `RETRY_DELAY_MS` and `RETRY_MAX_DELAY_MS` text `must be an integer >= 0` conflicts with the generic `of at least <min>`; make consistent.
- `docs/channels.md` (~75): whole days read `1d`, not `1h`.

## Repository: config
- `src/hook.test.ts` (~15): launch Lefthook's launcher with `process.execPath` so `bun test src` passes with Node absent from PATH. Verify by running with Node removed from PATH, and show the old form fails.
- TypeScript check: config pins `typescript` 6.0.3 for typescript-eslint beside the `typescript7` alias; record in the PR whether this can change.

## Risks
Stale references; tests that stay green after the fix (hence mutation evidence); api empty-read change is observable (assumption: 200 with empty list, not 404).

## Acceptance evidence
Per target, a PR table of leftovers with fix or "already fixed", the mutation output for test items, green checks. Observable: contract rejects inherited nested fields; probe exits 2 on `bogus`; api empty reads with feature off; status feed keeps entries after 404; config tests pass without Node.
