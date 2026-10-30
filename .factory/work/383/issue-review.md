# Issue review #383: probe result buffering and location heartbeat

Verdict: specifiable. No blocking question; the points below go to the plan.

## Findings from the clones (main)
- probe `postResult` (`client.ts`) returns `accepted | dropped | failed | unknown-check`. It logs every drop. 5xx/429/timeout/network collapse into `failed`/`dropped` today, so the plan must split outcomes into retryable (network, timeout, 429, 5xx) and final (400/401/403/404).
- api lateness (`service.ts` ~604-625): a result is `late` only if its timestamp is older than the newest stored result of the SAME check and location. It is not late by age.
- api `checkTimestamp` (`server.ts` ~96) rejects results older than 7 days (`MAX_RESULT_AGE_MS`) with 400.
- `HEARTBEAT_LOCATION = "heartbeat"` is exported from `service.ts` (the issue says `heartbeat.ts`; it is only imported there).
- contract already has `locationResultSchema`/`LocationResult` (per-check location result). A new `Location` name must not collide with it or confuse it.

## Open points (plan must decide)
1. **Buffered results are mostly not "late".** Delivered oldest first after an outage, they are newer than the last stored result, so the api treats them as live. They rewrite state, can open or close incidents with old timestamps and send notifications, and are not flagged `late`. The issue says buffered results "fit the existing ingest path as late". Assumption: in-order replay is accepted as is (no api change, "no change to how late results count"). The docs must say that results replayed after an outage drive state and incidents by their original timestamps, and that `late` appears only for out-of-order arrival. The plan should confirm that state/incident handling with old timestamps does not produce wrong notifications, or state the limit.
2. **Max age vs api 7-day limit:** `PULSE_BUFFER_MAX_AGE_MS` must be capped well below 7 days, or old results get 400 and are dropped as `rejected`. Plan: default 1 h, cap 2^31-1 ms as required, and docs mention the 7-day api limit. A 400 for a buffered result counts `rejected` and leaves the buffer (no head-of-line blocking).
3. **Ordering with concurrency:** today the probe posts results as the checks finish. With a buffer, "one sender, one at a time" applies while buffering. Plan must say whether the happy path (empty buffer) posts directly (concurrently, as today) and when it switches to the queue, and how it avoids a new result overtaking the buffer during the switch.
4. **Per-check order:** the api needs the timestamp order per check; FIFO of the whole probe satisfies it.
5. **Backoff curve** (suggest 1 s doubling to 30 s cap, with the reset on success); the 10 s request timeout applies per attempt. 429: honor `Retry-After` if present (optional, plan decides).
6. **Age check timing:** drop `too_old` when the oldest is at the head at send time and also when enqueuing; counts per result. `rejected` counts final 4xx drops (also of results that were never buffered? Assumption: yes, every dropped-as-final result counts `rejected`).
7. **Unknown-check (404):** today the probe may use `unknown-check` to trigger a reload; keep that behavior for 404 and still drop.
8. **Shutdown:** the sender stops at the shutdown timeout; the remaining results are lost and logged once with the count. Check the existing shutdown path in `main.ts`.
9. **Memory:** the budget comes from the Performance impact section (#377); the plan must read the current budget value and measure RSS with a full buffer (10 000 results). Defaults can be lowered if the budget demands it.
10. **api silent rule:** default `PULSE_LOCATION_SILENT_MS` = max(3 min, 3 × largest `interval` among active non-heartbeat checks), computed at read time so config reloads apply. Explicit setting overrides. Decide: heartbeat-type checks are excluded from the largest interval. With no active checks, no location is silent-eligible (use 3 min).
11. **Known locations:** from the newest result per location at start (excluding `heartbeat`), then from accepted results. A location only seen before a restart appears with its old time and is `silent`. Locations that never report are unknown. Retention may remove old locations; fine.
12. **`lastResultAt` updates** use the result timestamp (probe clock) or the api receive time? The issue says "time of the last accepted result" and "late results update only if newer", so result timestamp. Replayed results then move `lastResultAt` back-in-time, so right after an outage the location can show `silent` until the buffer catches up to now. Acceptance says `reporting` within one interval after restart: the plan must use the max over timestamps and ensure the newest fresh result arrives promptly (the sender drains oldest first, so a long buffer delays this). Consider whether api receive time is the better basis; recommend receive time for `silent` while keeping result timestamp for `lastResultAt`, or document the delay. Needs a plan decision.
13. **Metric cardinality:** `pulse_api_location_last_result_timestamp_seconds{location}` is bounded by tokens/locations; exclude `heartbeat`.
14. **`GET /locations` is public:** it exposes location names; matches "names and times only". Response: array or `{locations: [...]}`; follow the other list reads. Sort by name. Add to OpenAPI/docs in contract and the wire version rules (`WIRE_VERSION_HEADER`) as for other routes.
15. **compose-e2e:** the repo that owns it needs to be identified (likely api or probe `compose-e2e`); the stop must exceed 2 check intervals, the history comparison per check must find no gap. The issue's 2-minute/10 s acceptance is the manual form.
16. **Repo-specific:** each target runs mutation tests; the PR text carries output. New runtime dependencies are not needed (approved-packages).

## Assumptions
- No contract version bump beyond a minor additive change (new schema/type only).
- Probe reads settings via the existing `settings.ts` readers; invalid values fail as other settings do.
- `/readyz`, notify, status, config, kit, website unchanged.

## Derived acceptance check
1. Stop the api for >2 intervals (e.g. 2 min, 10 s checks), restart it. Every result of the gap reaches the api; `GET /checks/:id/results` shows no gap, timestamps ascending per check.
2. Probe metrics: `pulse_probe_buffered_results` rises then returns to 0; `delivered_late_total` increases by the delivered count; exactly two log lines (start, empty with count).
3. Unit: buffer at max drops oldest (`buffer_full`), aged result dropped (`too_old`), 401/403/400/404 never buffered (`rejected`), 429/5xx/timeout/network buffered.
4. `GET /locations` lists a stopped probe as `silent` after the threshold and `reporting` within one interval after restart; `heartbeat` never listed; metric matches; late result does not move `lastResultAt` back.
5. Contract `Location` schema validates the response; CI green in contract, probe, api; peak RSS with a full default buffer stays within the budget (measurement in PR).
