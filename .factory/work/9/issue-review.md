# Issue review: Multi-location quorum for down

## Current state (inspected in `.repos/*`)
- **contract**: `Result` has no location. `CheckWithState` has `state`, `consecutiveDown`, `lastResultAt`, `lastReason`. Types only.
- **probe**: `main.ts` reads only `PULSE_API_URL`. `runCheck` builds the `Result`. `postResult` sends it to `POST /results`.
- **api**:
  - `ingest` stores the result, then `applyResult(prev, status)` runs on that single result. It counts `consecutiveDown` per check and opens an incident at `DOWNS_TO_OPEN = 3`. An up result resolves it.
  - The `results` table has no location column.
  - The service has no clock. Time comes from result timestamps.
  - `validateResult` builds the `Result` from a whitelist of fields, so an unknown `location` field is silently dropped today.
  - The schema is `CREATE TABLE IF NOT EXISTS`, so there is no migration path for an existing DB file.
- **status**: `renderChecks` shows state, name, URL and reason only. It renders from `ChecksResponse`.

## Open points (none block the spec)
1. **How a probe gets its location.** "Set when it starts" is not specific. Assumption: env var `PULSE_LOCATION` on the probe. It is trimmed and must be non-empty. If unset, the probe uses `default`. Rejected alternative: a CLI arg. The done-when needs three probes on one machine, so each process needs its own value. Env fits that.
2. **Result shape.** Assumption: `Result.location: string`. It is required in the type for new probes, and API input may omit it. The API normalises a missing, empty or non-string location to `default`. Decide: a non-string present value should give 400, but a missing value should map to `default`. The spec should fix the validation rule (non-empty string, max length, e.g. 64).
3. **"Last two intervals" reference point.** The window is `2 * check.intervalMs`. The reference "now" is not defined, and the API service has no clock. Options:
   - (a) The API's wall clock, injected as a clock. A location silent for 2 intervals drops out of the quorum.
   - (b) The timestamp of the newest result for the check. This is deterministic and needs no clock, but a dead location never drops out while others keep reporting, since the newest result is always from a live one. In practice (a) and (b) agree while any probe is alive.
   - Assumption: (b), evaluated at ingest time, i.e. window = `[result.timestamp - 2*intervalMs, result.timestamp]`. This follows the existing convention that timestamps come from results. The probe's clock is trusted. Skew between probes on different machines is a known limit.
   - If all locations stop, the state stays as last computed (same as today).
4. **Per-location latest result.** In the window, each location counts through its latest result only (by timestamp, then id). Assumption: a location with an older result still in the window and no newer one counts with that older result. Results older than the window are ignored.
5. **Quorum rule, exact.** Let R be the locations with a result in the window and D those whose latest result is down.
   - |R| = 1: that location's status decides, as today.
   - |R| ≥ 2: down iff |D| ≥ 2, otherwise up. A fixed 2, not a majority, as the issue says.
   - Consequence to document: with 2 reporting locations and one down, the check is up. With 3 locations and 2 down, it is down.
6. **What an "evaluation" is.** Assumption: one evaluation per accepted result (per `POST /results`), producing a combined status of up or down. Then the existing `applyResult` runs on that combined status. `consecutiveDown` therefore counts consecutive down evaluations, and an up evaluation resets it and resolves an open incident.
   - Consequence: with three probes, each at one interval, evaluations arrive about 3 times per interval. "Three consecutive down evaluations" is then reached in roughly one interval after quorum is reached, not three intervals.
   - Alternative: evaluate once per interval on a timer. This needs a scheduler and a clock in the API. It is more complex, and the issue does not ask for it.
   - Done-when says "an incident opens after three evaluations", which matches the per-result reading.
   - The spec should say this explicitly and confirm the faster opening is acceptable.
7. **Flapping from order of arrival.** With 3 locations, A down, B down, C up: after A's result the evaluation is down only if A is alone in the window (|R| = 1). This is the "single reporting location decides as today" rule. At startup or after a quiet period one failing probe can therefore still produce a first down evaluation until the other locations report. After 3 such evaluations an incident could open.
   - This is inherent to the rule as written. The done-when scenario (one rejecting probe, all three reporting) is not affected, because the other locations report within the window.
   - The acceptance test must start all three probes and wait until all have reported before asserting.
   - The spec should note the limitation.
8. **Existing data and schema.** Add a `location` column to `results` (`TEXT NOT NULL DEFAULT 'default'`). An existing DB file needs `ALTER TABLE ... ADD COLUMN`, guarded by a check of `PRAGMA table_info`. Add an index on `(check_id, location, timestamp)`. Existing rows count as `default`. The persisted `consecutive_down` and `state` columns are kept.
9. **API: "latest result per location".** Not defined as a route or field. Options:
   - (a) New route `GET /checks/:id/locations` returning `LocationResult[]`.
   - (b) A `locations` field on each `CheckWithState` in `GET /checks`.
   - Assumption: both from the same data. `GET /checks` gets `locations: LocationResult[]`, because the status page already reads that endpoint and needs no second call per check. `GET /checks/:id/results` is unchanged except that each result now carries `location`.
   - Per-location entry: the latest `Result` (including `location`) plus `stale: boolean`, meaning it falls outside the quorum window. Window staleness is measured relative to the newest result, as in point 3.
   - Does the listing show all locations ever seen, or only those in the window? Assumption: all ever seen, with the `stale` flag, so that operators can see a dead probe. Sorted by location name.
10. **Status page.** "How many locations see a check as down." Assumption: text such as `1/3 locations down`, where the denominator is the locations in the window (non-stale) and the numerator those whose latest result is down. With one location it still shows `0/1` or `1/1`. Hide it if there are no locations (state unknown). Output must be HTML-escaped, as now.
11. **`CheckWithState` fields.** The `state`, `consecutiveDown`, `lastResultAt` and `lastReason` fields keep their meaning, but on the combined state. `lastReason` is the reason of the latest down result in the window, or `null` when up. Assumption: today's code stores the reason of the latest result, which would be `null` when an up result arrives after down ones. Keep that for `lastReason` as the latest ingested result's reason, to avoid changes. Incident `reason` is the reason of the result that triggered the opening evaluation. This is a down result, since an opening evaluation needs at least one down location, but it may be from the location that arrived last and not the one that is down. Assumption: use the reason of the latest down result in the window.
12. **Incident `openedAt`.** The timestamp of the result that triggered the opening evaluation (as today).
13. **Identical timestamps and out of order arrival.** Not handled beyond the tie-break by insertion id. Out of order results older than the window are stored but do not affect the evaluation.
14. **Location name rules.** Case-sensitive, compared as exact strings. The name `default` is reserved in effect: a new probe that sets `PULSE_LOCATION=default` merges with legacy probes. Accepted.
15. **Docs.** Probe README (new env var), API README (new response fields, quorum rule), status README, and the top-level README run instructions (multi-probe example) should be updated.
16. **Delivery order.** contract first (types), then probe, api, status, each pinning the merged contract SHA, as in earlier specs (see `.factory/work/1`). The contract is a Git dependency, so a placeholder SHA may be needed during development.

## Assumptions summary
- Env `PULSE_LOCATION`, default `default`.
- The API maps a missing location to `default`.
- Window is `2 * intervalMs` ending at the newest result's timestamp.
- One evaluation per ingested result; the existing 3-down rule runs on the combined status.
- `locations` array on `GET /checks` with a `stale` flag.
- The status page shows `N/M locations down`.

## Derived acceptance check
Setup: pulse-api with one check (`intervalMs` 1000) on a test server. Three probes run on one machine with `PULSE_LOCATION=a`, `b` and `c`. The test server answers 500 only to probes it identifies, e.g. by a header or a per-probe query value. For this the check URL must differ per probe, or the server must see the probe's identity. Open: how the server tells probes apart. Suggested answer: the server rejects the Nth connection or by a `User-Agent` suffix that includes the location. The spec should add `User-Agent: pulse-probe/<location>`, or the acceptance test should use a small fake in front. Decision for the spec: the probe sends `User-Agent: pulse-probe (<location>)`, so a test server can reject by location.

1. Server rejects only `a`. After all three have reported:
   - `GET /checks` shows the check with `state: "up"`.
   - `locations` has three entries, with `a` down and `b`, `c` up.
   - There is no open incident after 5 or more intervals.
   - The status page shows `1/3 locations down` and the check as up.
2. Server rejects `a` and `b`. After the next results:
   - `state` is `down` and `consecutiveDown` reaches 3.
   - `GET /incidents?status=open` has one incident for the check.
   - The status page shows `2/3 locations down`.
3. Server stops rejecting `b`. Once `b` reports up, the state returns to `up` and the incident is resolved.
4. A legacy result posted without `location` appears as location `default`.
5. Unit level in api:
   - quorum with 1, 2 and 3 locations
   - window expiry
   - legacy `default`
   - schema migration of an old DB
   - validation
   - the 3-evaluation rule on the combined state
