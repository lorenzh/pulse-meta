# Issue review: Degraded state on slow responses

## Current state (inspected in `.repos/*`)
- **contract**: `CheckStatus = "up" | "down"` (used by `Result.status`). `CheckState = CheckStatus | "unknown" | "maintenance"`. `HttpCheck` and `TlsCheck` have `timeoutMs?` and no latency objective. `Result` has `latencyMs`. `CheckStateFields` has `locations: LocationResult[]`, each holding the latest `Result`.
- **probe**: `runCheck` returns `up` for 2xx and `down` otherwise. `latencyMs` is measured as `now() - start` after the body is cancelled. It only sees what `GET /checks` gives it, so it cannot know an objective unless the API serves it.
- **api**:
  - `validateResult` rejects any status other than `up` or `down`.
  - `quorumStatus(CheckStatus[])` returns only up or down. `applyResult(prev, status)` treats every non-`up` status as down.
  - The `checks` table has no objective column, and `upsertChecks` and `toCheck` copy only id, name, url, interval and timeout.
  - `parseChecks` validates and copies only those fields, and drops unknown fields. It builds HTTP-shaped checks only, so TLS checks are not handled by the API at all today.
  - The maintenance path tests `status === "down"`. The DB has a `migrate()` step using `PRAGMA table_info`.
- **status**: `renderChecks` prints `check.state` and uses a `state-${state}` CSS class. `renderLocations` counts `down` locations. There is no latency output. `index.html` holds the CSS, which has no `state-degraded` rule.

## Open points (none block the spec)
1. **Field name and location.** Assumption: optional `latencyObjectiveMs?: number` (positive integer, ms) on `HttpCheck` and `TlsCheck`, set in the checks file, validated like `timeoutMs`, and served in `GET /checks`. Absent means no objective, so no degradation.
2. **Who decides `degraded`.** Options:
   - (a) The probe compares latency with the objective and posts `status: "degraded"`.
   - (b) The API derives it at ingest from `latencyMs` and the stored objective.
   - Assumption: (a). The issue says "a result ... is degraded", and the contract comment on `Result` makes the result the unit of status. The probe gets the objective through `GET /checks`. The API also accepts `degraded` in `validateResult`. A result that arrives with `up` and a latency above the objective is stored as sent, because the API does not re-derive it. This gap is a known limit.
3. **Boundary and which latency.** Assumption: degraded iff the response is 2xx and `latencyMs > objective`, strictly. Equal is up. `latencyMs` is the existing probe measure. A non-2xx response or a timeout stays `down` whatever the latency. The objective is expected to be below `timeoutMs`. If it is not, the check can never be degraded. The spec may warn about this or reject it in the config. Assumption: warn only, no rejection.
4. **Contract shape.** Assumption: `CheckStatus = "up" | "degraded" | "down"`, so `Result.status` and `CheckState` both gain `degraded` and nothing else changes. Every consumer needs a check for exhaustive handling (the constraint in the issue).
5. **Quorum with multiple locations.** The issue does not say. Assumption: the quorum first decides down (at least two down locations, or a single reporting location, as today). Otherwise the combined status is `degraded` if any reporting location in the window is degraded, and `up` if none is. Rationale: slowness seen from one location is still worth showing. This is flagged for the spec as a decision. The alternative, majority degraded, is rejected as inconsistent with the down rule.
6. **Incident rules.** "Degraded results do not count towards an incident." Assumption: a degraded evaluation behaves like `up` for incidents. It resets `consecutiveDown` to 0, and it resolves an open incident, so degraded is a recovery. The state stored on the check is `degraded`. `consecutiveDown` is not incremented. The spec should state the reset explicitly, because the alternative (degraded neither counts nor resets) would keep partial down streaks alive.
7. **Maintenance.** The maintenance branch suppresses only `down` results. Degraded results in a window go through the normal evaluation path, and the displayed state is still `maintenance` while the window is active. Assumption: no change to maintenance. The spec should say this.
8. **TLS checks.** `TlsCheck` exists in the contract, but the API config and the probe do not handle it today. Assumption: the objective applies to HTTP checks only. Keep the field on the shared base so both types stay consistent, but the spec states that nothing is implemented for TLS here. Alternative: put it on `HttpCheck` only. Prefer `HttpCheck` only, to avoid a field without behaviour.
9. **Storage and migration.** The `checks` table gets `latency_objective_ms INTEGER` (nullable), added in `migrate()` through a `PRAGMA table_info(checks)` guard. `upsertChecks` also updates it, so removing the objective from the file clears it (NULL). Stored `results.status` accepts the new value without a schema change. Existing rows are unaffected.
10. **Status page.** "Own state and the measured latency." Assumption: `renderChecks` shows `degraded` through the existing `<span class="state">` and `state-degraded` class, plus a latency element, e.g. `<span class="latency">850 ms</span>`, for `up` and `degraded` checks. The latency is taken from the check's newest result across `locations` (highest timestamp). Down checks show the reason as today. Needs a `state-degraded` colour in `index.html` that works in light and dark themes, and is distinguishable from up and down without relying on colour alone (the text label does this). The objective is also shown, e.g. `850 ms (objective 500 ms)`. Assumption: show it, as it explains the state. `renderLocations` keeps counting down locations only.
11. **Done-when needs a delay-controllable test server.** None exists in the repositories. Assumption: the acceptance check starts a tiny local HTTP server inside the test, with a settable delay and the ability to close it. It is a script or test helper in the repo that runs the check, not a product feature. Default intervals are 1 s, so the done-when timings (e.g. objective 500 ms, delay 100 ms, then 800 ms) fit under the 1 s timeout default only if `timeoutMs` is set above the delay.
12. **Down needs three results.** "Down when the server is off" appears on the status page only after the state is `down`. The state is `down` after the first down evaluation (only incidents wait for three), so the acceptance check does not need to wait for an incident.
13. **Cross-repository order.** contract first (types), then api, probe and status in any order, each depending on the new contract. The repositories take pulse-contract as a Git dependency, so each needs its dependency bumped to the contract change before it can compile.

## Derived acceptance check
Set up a checks file with one HTTP check: `intervalMs` 1000, `timeoutMs` 3000, `latencyObjectiveMs` 500, pointing at a local test server whose response delay can be changed. Run the API, the probe and the status page.
1. Delay 0 ms: the status page shows the check as `up` with the measured latency below 500 ms.
2. Set the delay to 800 ms: after the next probe result the status page shows `degraded` with a latency above 500 ms. No incident is open, and `GET /incidents` stays empty.
3. Set the delay back to 0 ms: the page shows `up` again.
4. Stop the server: the page shows `down` with the reason (e.g. `ECONNREFUSED`). After three down results an incident opens.
5. Unit level: boundary at exactly the objective gives `up`. A 503 slow response gives `down`. A check with no objective is never degraded. Three degraded results in a row open no incident, and a degraded result after two downs resets the streak. A degraded result resolves an open incident. The API accepts `degraded` in `POST /results` and rejects unknown statuses. The status renderer shows the `degraded` state class and the latency.

## Hold?
No hold. Open points 2, 5 and 6 are decisions the spec should record, but each has a reasonable default stated above.
