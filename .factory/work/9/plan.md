# Spec: Multi-location quorum for down

## Goal
One failing probe location must not declare a check down. A check is down only when at least two reporting locations report down. The API exposes the latest result per location, and the status page shows how many locations see a check as down.

## Scope
Repositories contract, probe, api, status. The decisions below resolve the open points of `issue-review.md` (point numbers in brackets).

## Non-goals
- No timer-based evaluation and no API clock. Evaluation runs once per ingested result.
- No clock-skew handling between probes.
- No new route: the per-location data is a field of `GET /checks`.
- No change to the 3-down incident rule itself, only to its input.

## Required behavior (shared interface)
- **Location [1]:** the probe reads env `PULSE_LOCATION` at start, trimmed. If unset or empty it uses `default`. Every `Result` it sends carries `location`.
- **Result shape [2]:** `Result.location: string` (required in the contract type). The API accepts a missing or empty `location` and stores `default`. A present non-string value, or a string longer than 64 characters after trim, gives 400. Names are case-sensitive exact strings [14].
- **Window [3]:** at ingest of a result with timestamp T for check C, the window is `[T - 2*intervalMs, T]`. Results of C newer than T (out of order arrival) are ignored for this evaluation.
- **Per-location latest [4]:** within the window, each location counts by its latest result (highest timestamp, ties by highest id). R is the set of such locations, D those whose latest result is down.
- **Quorum [5]:** if |R| = 1, that location's status decides. If |R| >= 2, the combined status is down iff |D| >= 2, else up.
- **Evaluation [6]:** one evaluation per accepted result. The combined status feeds the existing `applyResult`: `consecutiveDown` counts consecutive down evaluations, an incident opens at 3, an up evaluation resets and resolves. Incidents may thus open faster than 3 intervals. This is accepted. Known limit [7]: when only one location is in the window (startup, quiet period), it decides alone.
- **Fields [11][12]:** `state`, `consecutiveDown`, `lastResultAt` keep their meaning on the combined state. `lastReason` stays the reason of the latest ingested result. Incident `reason` is the reason of the latest down result in the window. `openedAt` is the timestamp of the triggering result.
- **API output [9]:** `CheckWithState.locations: LocationResult[]`, where `LocationResult = { location: string; result: Result; stale: boolean }`. It lists every location ever seen for the check, sorted by location name. `stale` is true when the latest result of that location is outside the window ending at the check's newest result. Checks without results have `locations: []`. `GET /checks/:id/results` is unchanged except each result carries `location`.
- **Status page [10]:** per check, `N/M locations down`, with M the non-stale locations and N those whose latest result is down. It is shown also for M = 1. It is hidden when there are no locations. All output is HTML-escaped.
- **User-Agent:** the probe sends `User-Agent: pulse-probe (<location>)` on its check requests, so a test server can reject by location.
- **Legacy [constraint]:** results without a location (older probes, existing DB rows) count as location `default`.

## Risks
- Contract is a Git dependency: each downstream repo pins the merged contract SHA (placeholder during development).
- Existing DB files need a migration (see api).
- A single reporting location still decides alone [7]. The acceptance test must wait until all three probes have reported.

## Acceptance evidence
Three probes run with `PULSE_LOCATION` a, b, c against one api and a test server that rejects by User-Agent location.
1. Rejecting only `a`: after all have reported, `GET /checks` shows `state: "up"`, three `locations` with `a` down, no open incident after 5+ intervals, status page shows `1/3 locations down`.
2. Rejecting `a` and `b`: `state` becomes `down`, `consecutiveDown` reaches 3, one open incident, status page shows `2/3 locations down`.
3. Stopping the rejection of `b`: state returns to `up` and the incident resolves.
4. A result posted without `location` appears as `default`.
Each repo's own unit tests and lint/typecheck pass.

## Repository: contract
Files: `src/` types, `test/`, README.
- Add `location: string` to `Result`, with doc comment (probe location name; `default` for legacy).
- Add `LocationResult` and `locations: LocationResult[]` on `CheckWithState`.
- Export a `DEFAULT_LOCATION = "default"` constant only if the package already exports runtime values; otherwise document it in the README.
- Update tests and README; rebuild `dist` if the repo commits it.
- Completion: build, typecheck, lint and tests pass; released change is mergeable for pinning.

## Repository: probe
Files: `src/main.ts`, `src/check.ts`, `src/client.ts`, tests, README.
- Read `PULSE_LOCATION` (trim, default `default`, reject over 64 chars at startup with a clear error) and pass it to `runCheck`, which sets `Result.location`.
- Send `User-Agent: pulse-probe (<location>)` on check requests.
- README documents the env var and a three-probe example.
- Checks: unit tests for default, trimmed value, long value, result carries location, User-Agent header; typecheck, lint.
- Completion: tests pass; contract SHA pinned.

## Repository: api
Files: `src/db.ts`, `src/service.ts`, `src/state.ts`, `src/server.ts`, tests, README.
- Schema: `results.location TEXT NOT NULL DEFAULT 'default'`; for existing DB files `ALTER TABLE ... ADD COLUMN` guarded by `PRAGMA table_info`; index on `(check_id, location, timestamp)`.
- `validateResult`: normalise location as specified (missing/empty -> `default`, bad type/length -> 400).
- `ingest`: store the result with location, compute the quorum status (pure function, in `state.ts` or a new module), then run `applyResult` on it. Incident reason per the fields rule.
- `GET /checks` returns `locations` per the shape above; results listing carries `location`.
- Checks (unit): quorum with 1, 2, 3 locations; window expiry; legacy `default`; migration of an old DB; validation; 3-evaluation rule on combined state; reset/resolve; `locations` with `stale`.
- Completion: tests, typecheck, lint pass; README documents quorum rule and fields; contract SHA pinned.

## Repository: status
Files: `src/render.ts`, `src/poller.ts` if types require, tests, `public/` if styled, README.
- Render `N/M locations down` per check from `locations`, escaped, hidden when empty; tolerate a missing `locations` field from an older API.
- Checks: render tests for 0/1, 1/3, 2/3, all stale, empty, escaping; typecheck, lint.
- Completion: tests pass; contract SHA pinned.

## Repository: meta (docs only, not a target)
Top-level README multi-probe run example may be updated by the maintainers.
