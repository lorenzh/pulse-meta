# Spec: Degraded state on slow responses

## Goal
A service that answers too slowly is visible as `degraded` before it fails. A check may set a latency objective; a successful but slow result is `degraded`, not `up`.

## Scope
- Contract: new status value `degraded`, new optional check field `latencyObjectiveMs`.
- Probe: decides `degraded` per result.
- API: loads, stores and serves the objective; accepts `degraded` results; quorum, state and incident rules handle it.
- Status page: shows `degraded` with its own style, the measured latency and the objective.

## Non-goals
- TLS checks (the API and probe do not handle them today; the field goes on `HttpCheck` only).
- API-side re-derivation of `degraded` from `latencyMs` (a result posted as `up` is stored as sent).
- Alerts, notifications, history charts, or a change to the maintenance logic.
- Rejecting an objective that is not below `timeoutMs` (no rejection; the check can then never be degraded).

## Decisions (recorded)
1. Field: `latencyObjectiveMs?: number` on `HttpCheck` only. A positive integer, in ms, validated like `timeoutMs`. Absent means no objective.
2. Contract: `CheckStatus = "up" | "degraded" | "down"`. `Result.status` and `CheckState` gain `degraded` through it. Nothing else changes in the shape.
3. The probe decides. A result is `degraded` iff the response is 2xx, an objective is set, and `latencyMs > latencyObjectiveMs` (strict; equal is `up`). Non-2xx, timeouts and network errors are `down` whatever the latency. `latencyMs` is the existing measure.
4. The probe gets the objective from `GET /checks`, so the API must serve it.
5. Quorum over reporting locations in the window: first the existing down rule (unchanged: down if a single location reports down, or at least two locations are down). Otherwise `degraded` if any reporting location is degraded, else `up`.
6. Incidents: an evaluation of `degraded` acts like `up` for incidents. It resets `consecutiveDown` to 0, resolves an open incident, never increments the streak or opens an incident. The stored check state is `degraded`.
7. Maintenance: unchanged. While a window is active the displayed state stays `maintenance`; degraded results take the normal evaluation path.
8. Storage: nullable column `latency_objective_ms INTEGER` on `checks`, added in `migrate()` behind a `PRAGMA table_info(checks)` guard. `upsertChecks` writes it, so removing the objective from the file clears it to NULL. `results.status` needs no schema change.
9. Status page: for `up` and `degraded` checks show the latency of the newest result across locations (highest timestamp), as `<span class="latency">850 ms</span>`, plus the objective when set, e.g. `850 ms (objective 500 ms)`. The state text `degraded` and class `state-degraded` give a distinct state in light and dark themes without relying on colour alone. `down` shows its reason as today. `renderLocations` still counts only `down` locations.

## Required behavior
- Checks file with `latencyObjectiveMs` is validated: a non-integer or non-positive value fails config load like a bad `timeoutMs`. Unknown fields are still dropped.
- `GET /checks` returns `latencyObjectiveMs` when set.
- `POST /results` accepts `up`, `degraded`, `down`; rejects any other status with a 400 (message lists the three).
- Every consumer of `CheckStatus`/`CheckState` handles `degraded` (no `up/down` binary assumptions left).

## Risks
- Contract is a Git dependency: each consumer must bump its dependency to the released contract change before it compiles. Hence the dependencies below.
- A binary `up`/`down` assumption left anywhere (treating non-`up` as down) would open incidents for degraded checks. Review every status comparison.
- Objective at or above `timeoutMs` makes `degraded` unreachable. Documented only.
- DB migration on an existing database must keep old rows working.

## Acceptance evidence
Each repo's `npm run check` passes with the unit tests named in its section. End to end (done-when): a checks file with one HTTP check (`intervalMs` 1000, `timeoutMs` 3000, `latencyObjectiveMs` 500) points at a local test server whose delay can be changed, with API, probe and status page running.
1. Delay 0 ms: page shows `up` with latency below 500 ms.
2. Delay 800 ms: page shows `degraded` with latency above 500 ms; `GET /incidents` stays empty.
3. Delay back to 0: `up` again.
4. Server stopped: page shows `down` with a reason (e.g. `ECONNREFUSED`); after three down results an incident opens.
The test server is a helper started inside a test, not a product feature.

## Repository: contract
Files: `src/index.ts`, `test/types.fixture.ts`, `test/smoke.test.ts`, `README.md` if it documents the shapes.
- `CheckStatus` becomes `"up" | "degraded" | "down"`; update the doc comment of `Result` and `CheckState` accordingly.
- Add `latencyObjectiveMs?: number` to `HttpCheck` with a doc comment (ms; the result is degraded above it; absent means none).
- Extend the type fixture so `degraded` is usable in `Result` and `CheckState` and the field is usable on `HttpCheck`, and a fixture shows a check state of each of the values.
- Checks: `npm run check`. Evidence: the change is merged and released so consumers can depend on it (`dist` built as the repo's release flow requires).

## Repository: api
Depends on contract. Files: `src/config.ts`, `src/db.ts`, `src/server.ts`, `src/service.ts`, `src/state.ts`, `checks.example.json`, `README.md`, and their tests.
- `parseChecks` validates and copies `latencyObjectiveMs` (positive integer, like `timeoutMs`); the example file and README show it.
- `db.ts`: add the `latency_objective_ms` column in `migrate()`; `upsertChecks` writes it (NULL when absent); `toCheck` returns it only when set.
- `validateResult` accepts `degraded`; error message names all three.
- `quorumStatus` returns `up | degraded | down` per decision 5; `applyResult` treats `degraded` like `up` for the streak and incidents per decision 6; the stored state is `degraded`. Maintenance path unchanged (decision 7). Audit every status comparison for the binary assumption.
- Tests (`node:test`, injectable clock, local servers only): config accept/reject; migration on an old database and clearing the objective; `POST /results` with `degraded` (200) and an unknown status (400); `GET /checks` serves the objective; quorum table including degraded with up, down and multiple locations; state: three degraded open no incident, degraded after two downs resets the streak, degraded resolves an open incident; maintenance with a degraded result.
- Checks: `npm run check`. Evidence: tests above pass.

## Repository: probe
Depends on contract. Files: `src/check.ts`, `src/check.test.ts`, `src/client.test.ts` if it has check fixtures, `README.md`.
- `runCheck`: for 2xx, return `degraded` when `check.latencyObjectiveMs` is set and the measured `latencyMs > latencyObjectiveMs`, else `up`; reason is `null` for `up` and a short text such as `latency 850ms over objective 500ms` for `degraded`. Everything else stays `down`.
- Make sure the check parsed from `GET /checks` keeps `latencyObjectiveMs` (client/scheduler must not strip it).
- Tests with the injectable clock and a local server: latency below, equal (`up`) and above the objective; no objective never degraded; 503 slow stays `down`; timeout stays `down`; the field survives `client` parsing.
- Checks: `npm run check`. Evidence: tests above pass.

## Repository: status
Depends on contract. Files: `src/render.ts`, `src/render.test.ts`, `public/index.html`, `public/client.js` if it renders states, `src/poller.ts` if it narrows states, `README.md`.
- `renderChecks`: render `degraded` through the `state` span with class `state-degraded`; add the latency span (and objective when set) for `up` and `degraded` per decision 9, from the newest result across `locations`; escape all output as today. `down` unchanged.
- `index.html`: add the `state-degraded` colour (a warning tone) for light and dark themes with enough contrast; check the palette/theme tests (`palette.test.ts`, `theme.test.ts`) and extend them to cover the new colour.
- Remove any binary `up/down` assumption (also in `public/client.js` and the poller).
- Tests: `degraded` rendering with latency and objective; `up` with latency; no latency when there is no result; `down` unchanged; locations count still counts only down; palette contrast.
- Checks: `npm run check`. Evidence: tests above pass, and the end-to-end acceptance run shows up, degraded, up, down on the page.
