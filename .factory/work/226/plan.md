# Spec: Small review leftovers (P3), round 2 (#226)

## Goal
Close the collected P3 review findings: docs that no longer match the code, tests that pass on the old code, a few small behavior fixes, and two dependency pins.

## Scope
Targets `contract`, `api`, `status`, `probe`, `notify`. `kit` and `config` are untouched. Line numbers in the issue are approximate: locate code by content.

## Non-goals
- No new features, no new runtime dependencies (fontsource stays `5.3.0`, only the `^` goes).
- No change to the public API shape, except where named below.

## Decisions (from the issue review, assumptions)
- Notify keeps the channel-id error form `channel "<id>": smtp.port ...`; document it as deliberate (the path form conflicts with it).
- Notify accepts the kit duration format (`1h`, not `1h 0m`); document it, no code change.
- Api documents the new maintenance-window order (note error first); no code change.
- Public `/api/checks` is intentionally not a full `CheckWithState`; document it, and that the browser validates with placeholders for hidden fields.
- Already done on `main`, so verify and skip: status `docs/configuration.md` PORT/POLL_MS validation text; api `grace: null` code (#310 rejects null). Record the check in the PR.

## Acceptance (every repository)
- Docs state what the code does; quote the real messages read from `src/`.
- Every test named below fails on the pre-fix source and passes on the fixed source. Prove it: revert the fix locally, run the test, restore. Say so in the PR.
- The target's own checks pass. No secrets in docs.

## Risks
- Heartbeat deadline change alters the time to `down`; tests use fake time.
- Pin bumps can pull API changes; run the full checks.

## Repository: contract
- `src/validate.ts` (~67): required fields must be own properties; an `id` only on the prototype fails. Test fails on old code.
- Docs: `warnDays` is bounded by `Number.MAX_SAFE_INTEGER` (the `z.int()` cap), not unbounded.
- Done when: test for prototype-only `id` passes, docs name the bound, checks green.

## Repository: api
Depends on contract (pin bump to its new main).
- `package.json`/lockfile: pin pulse-contract to current contract main (the SHA that probe/status/notify use or newer); no API change expected.
- `docs/development.md` (~55-58): Compose test restarts only the API, not probe.
- `src/start.ts` (~89): token validation startup errors include the tokens file path and the key (decision 6). Test it.
- `src/main.test.ts` (~62) SIGTERM test: bound the readiness wait, reject on early child exit, always clean up the child.
- `src/heartbeat.ts` (~41): the deadline starts when the evaluator starts, not at the first tick; period 1000, grace 0 is no longer `unknown` 2 s after start. Fake-time test.
- `scripts/compose-e2e.sh` `notify_has`: anchor the match so id 2 does not match `12:opened`.
- `docs/rest-api.md` (~128): replace "at most the number of locations" with the true statement: retried submissions can store several rows per location and timestamp, so a page can exceed `limit` by more (5 rows for limit 1).
- Tests "GET /incidents: since keeps a still open incident" and "maintenance quorum: a late-arriving down inside a past window stays excluded" must fail on the old code; fix them.
- `docs/configuration.md`: document that explicit `null` for `type`, `retries`, `retryDelayMs`, TLS `port`/`warnDays` and heartbeat `grace` is rejected (deliberate change), and that a reversed maintenance window with a missing note reports the note first.
- Done when: the above merged with checks green.

## Repository: status
- `package.json`/lockfile: pin `@fontsource-variable/jetbrains-mono` and `@fontsource-variable/space-grotesk` to exactly `5.3.0`.
- `src/server.test.ts` (~95): add a raw-socket test `GET http://[ HTTP/1.1` that reaches the `handle(...).catch` handler; it must fail (process exit `ERR_INVALID_URL`) without the handler.
- `src/poller.test.ts` (~566, ~610): hide the tab before the failure settles, let sibling requests reject on abort, assert the final published state; must fail when `if (state.error !== null) controller.abort()` is removed.
- `src/render.test.ts` (~614): assert heartbeat-specific output in "heartbeat card escapes the name and the reason"; fails on old code.
- `docs/operation.md` (~54): drop "no location names"; list the served result fields and `days[].results`; document that public `/api/checks` is intentionally not a full `CheckWithState` (allow-list drops required config fields) and the browser validates with placeholders.
- `src/xml-parser.ts` (~57): use a `Map` or `Object.create(null)` for attributes so duplicate `__proto__` attributes are detected; test.
- `src/server.contract-modules.test.ts` (~45): add a successful zod request as positive control for the 404 test.
- `README.md` (~49): out-of-range `intervalMs` does not fail the refresh, the proxy drops it; only retained fields are validated.
- `src/server.cache.test.ts` (~175): the mismatch-forwarding test must fail on old code.
- Verify `docs/configuration.md` PORT/POLL_MS text is correct; no change expected.
- After merge, a person removes the "status still uses `^`" remark in meta `docs/approved-packages.md`.

## Repository: probe
- `src/scheduler.test.ts` (~238): the "wall clock step back" test must exercise the `main.ts` clock wiring, not an injected monotonic `now`; if needed extract the wiring into a small function without behavior change. Fails on pre-fix source.
- `src/client.ts` (~132): on a 2xx without `x-pulse-contract`, log the missing-header warning before body or validation errors propagate; keep suppression for non-2xx. Test it.
- Docs: show the literal health bind-error message (from `src/`); `docs/configuration.md` (~25) and `docs/troubleshooting.md` (~26) use `must be an integer 1..2147483647` and state the enforced bounds.

## Repository: notify
- `docs/operation.md` (~21): a reminder is superseded by a newer one that is "queued or in any ledger status except dropped".
- `docs/operation.md` (~128): document the enforced bounds; out-of-range checks are skipped.
- `docs/operation.md`/`configuration.md`: reminder text at whole hours/days is `1h`, not `1h 0m` (kit `formatDuration`); accepted.
- `docs/configuration.md` (~28-29): quote current messages, e.g. `PULSE_NOTIFY_RETRY_ATTEMPTS: must be an integer >= 0`; document that shape errors use the channel-id form `channel "<id>": smtp.port ...` deliberately.
- `test/ledger.race.test.ts` (~66): inject the failure after the rename (failed rewrite), not before; fails without the fix.
- `test/ledger-lock.test.ts` (~225): take the marker before the holder is live and test marker cleanup after acquisition; fails without the fix.
