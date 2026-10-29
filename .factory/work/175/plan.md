# Spec 175: notify keeps an event queued after an out-of-range timestamp

## Goal
A malformed incident must never suppress its event for good. Spec #165 decision 3: a bad incident is re-evaluated on every poll. Today `1.8e18` passes validation, `toISOString()` throws after the key entered `queued`, and the key is never released.

## Scope
Only `notify` changes. No contract, API, key format or ledger format change.

## Non-goals
- No change to log dedupe (once per incident id and process), delivery, ledger or detector.
- No new config.

## Required behavior
- Timestamps are milliseconds (`new Date(timeMs)`). The edge check accepts a value only if `Number.isFinite(v) && Math.abs(v) <= 8.64e15` (the range of `Date`). `openedAt` and, when not null, `resolvedAt` get it. Reason text: `openedAt is not a valid date` / `resolvedAt is not a valid date` (keep the existing "not a finite number" reason for non-numbers).
- Build before queue: at every enqueue site (`#pollChannel` and `#rebuildLegacyPending` in `src/notifier.ts`) call `buildNotification` first, then `queued.add(key)`, then `enqueue`. If building throws, catch it, log an `error` with `channel`, `key` and the error fields, leave the key unqueued and continue with the other events and channels (defense in depth). `tick()` still never rejects.
- A bad incident creates no ledger entry. Once the API corrects it, its event is delivered once with key `<id>:opened`.

## Risks
- Catching around build must not swallow errors from `enqueue`; wrap only the build.
- Repeated build failures log on every poll; accepted (should not occur after validation).

## Acceptance evidence
- Regression test in `test/notifier.test.ts` (fails on old code): poll 1 returns incident A with `openedAt: 1.8e18` and a valid incident B; an error log names A, B is delivered, nothing for A, no unhandled rejection. Poll 2 returns A with a valid `openedAt`; A's `opened` event is delivered once with key `A:opened`.
- Unit test of the validator (via `fetchIncidents` or the existing api test style): `1.8e18`, `-1.8e18`, `8.64e15 + 1` rejected; `8.64e15` and `0` accepted.
- Test for the build-failure catch path at an enqueue site: key not left queued.
- `npm run check` passes.

## Repository: notify
Files: `src/api.ts` (range check in `checkIncident`), `src/notifier.ts` (order and catch at both enqueue sites), `test/notifier.test.ts` and the api test file (tests above), `docs/operation.md` and `docs/troubleshooting.md` (state that an out-of-range `openedAt`/`resolvedAt` counts as malformed data and is checked again each poll).
Completion: tests above pass, `npm run check` passes, the regression test fails on main.
