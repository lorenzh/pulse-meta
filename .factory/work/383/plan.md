# Spec #383: probe result buffering and location heartbeat

## Goal
A probe keeps results it cannot deliver in a bounded in-memory FIFO buffer and delivers them in order when the api answers again. The api knows when each probe location last reported and shows operators which locations are silent (`GET /locations`, one metric).

## Scope
- contract: `Location` schema and type, docs.
- probe: buffer and sender, three metrics, two log lines, two settings, docs.
- api: per-location last-result tracking, `GET /locations`, metric, `PULSE_LOCATION_SILENT_MS`, docs, `compose-e2e` outage scenario (`scripts/compose-e2e.sh` lives in api).

## Non-goals
No on-disk buffer, no batch `POST /results`, no notification or status page for silent locations, no change to `/readyz`, quorum rules or what counts as late. notify, status, config, kit, website unchanged.

## Decisions (resolving the issue review)
1. **Replay semantics.** The api marks a result `late` only when it is older than the newest stored result of the same check and location. Results replayed in order after an outage are therefore *not* late: they are processed like live results with their original timestamps (state, incidents, `consecutive_down`). Accepted as is, no api change. A replay can open or resolve an incident with an old timestamp, so notifications can arrive after the outage with old times; docs state this limit. `late` appears only for out-of-order arrival (for example a direct post that failed after a newer one succeeded). The docs say so.
2. **Max age.** `PULSE_BUFFER_MAX_AGE_MS` default `3600000` (1 h), cap 2^31−1. The api rejects results older than 7 days with 400; docs say to keep the setting below that. A 400 on a buffered result counts `rejected` and removes it (no head-of-line blocking).
3. **Path.** One module `buffer.ts` with `submit(result)`. With an empty buffer and no sender running, `submit` posts directly (concurrent, as today). A retryable failure appends the result to the buffer and starts the single sender. While the buffer is non-empty (or the sender is active) every new result is appended behind it, never posted directly. Races among concurrent direct posts in flight when buffering starts can reorder at most those results; the api treats the older one as late (history only). Documented.
4. **Outcomes.** `postResult` returns `accepted | retry | rejected | unknown-check` (replacing `failed|dropped`). Retry: network error, timeout, 429, 5xx. Rejected: 400, 401, 403, any other 4xx, and a non-204 2xx/3xx (never succeed later). `404` stays `unknown-check` (still triggers `reloader.requestReload()`) and is dropped, counted `rejected`. `postResult` no longer logs per drop for retryable errors (the buffer logs start/empty); final drops still log one line each (they are configuration errors, rare). The existing `pulse_probe_post_results_total`-style outcome metric mapping in `main.ts` keeps its labels (`retry` → `error`).
5. **Sender.** One at a time, oldest first. Backoff after a failed attempt: 1 s doubling to a 30 s cap; reset on success. The per-attempt 10 s timeout stays. `Retry-After` is ignored (backoff only). The sender checks the age of the head before each send and drops `too_old` entries (counted each); `submit` also drops entries older than max age when it evicts. Full buffer: on append, drop the oldest, count `buffer_full`.
6. **Shutdown.** On stop the sender aborts with the shutdown signal; the existing `SHUTDOWN_TIMEOUT_MS` (5 s) bounds the wait. Remaining buffered results are lost; one log line with the count. Nothing is persisted.
7. **Silent rule (api).** Threshold = `PULSE_LOCATION_SILENT_MS` if set (positive integer ms, cap 2^31−1), else `max(180000, 3 × largest interval of the active non-heartbeat checks)`, evaluated at read time so check reloads apply. With no active checks: 180000.
8. **Basis.** The api keeps per location two in-memory values: `lastResultAt` = max result timestamp of accepted results (late and replayed results only raise it, never lower it; exposed and used for the metric) and `lastSeenAt` = api receive time of the last accepted result. `state` = `silent` when `now − lastSeenAt > threshold`, else `reporting`. Reason: replayed results carry old timestamps, so the timestamp alone would show `silent` until the buffer drained; receive time makes the location `reporting` as soon as the probe delivers anything. At start both are rebuilt from the newest stored result timestamp per location (excluding `heartbeat`), so a location is `reporting` after an api restart only for the remaining part of the threshold after its last result, and `silent` otherwise until a probe posts.
9. **Heartbeat location.** `HEARTBEAT_LOCATION` is exported from `src/service.ts` (not `heartbeat.ts`); it is never tracked, listed or exported as a metric label.
10. **Defaults of the buffer.** 10 000 results, 1 h. Lower the default only if the memory measurement demands it.

## Performance impact
`bench/` does not exist in `main` of the api repository, so named by kind.
- probe peak RSS: up, only while buffering. A `Result` object retained in a queue is roughly 0.5–1 KB on the heap, so 10 000 results ≈ 5–10 MB at the maximum. Idle RSS: none expected (an empty array). Measure: run the probe with a fake fetch that always fails, push 10 000 results, read `process.memoryUsage().rss` (and `bun --smol` if the image uses it) before and after, and compare with the probe's peak-RSS budget (read it from the probe repo's docs or CI at implementation time; if none is documented, state the measured delta and the container memory limit in `compose.yaml`). State the number in the PR. Lower the default result limit if the budget is exceeded.
- probe CPU: none expected (O(1) per result).
- api startup CPU/time: one extra `GROUP BY location` query at start (indexed by check/time; a negligible cost on a retained history). Measure startup time on a seeded database before and after.
- api load CPU/RSS and p95 latency: a Map update per accepted result, negligible; `GET /locations` is a few rows. Measure with the existing test-CPU and any local A/B; if `bench/run.ts` exists when implemented, run `bun bench/run.ts --a main --b <ref>`.
- test CPU, build CPU, image size: small increase from new tests and code; none otherwise.

## Repository: contract
Files: `src/schema.ts`, `src/index.ts` exports, `test/`, `docs/index.md`, `README.md` if it lists schemas.
- Add `locationSchema` and type `Location`: `{ name: string (non-empty), lastResultAt: number (ms epoch, same time type as result timestamps in this package), state: "reporting" | "silent" }`, strict like the other response schemas. Do not touch `locationResultSchema`/`LocationResult`; the docs name the difference (per-check location result vs probe location). Export the list type used by other list reads (array of `Location`; follow the way `GET /checks` is typed).
- Docs: shape of `GET /locations`, the meaning of `state`, additive minor change, wire version rules as for other routes.
- Tests: accept valid, reject unknown state, missing/negative `lastResultAt`, empty name, extra keys (if other schemas are strict). Each new test fails without the schema (mutation output in the PR).
- Done when: contract CI green, package built and released so probe and api can import `Location`.

## Repository: probe
Files: `src/client.ts` (outcomes), new `src/buffer.ts` (+ `buffer.test.ts`), `src/main.ts` (use the buffer, shutdown count, reload on 404), `src/settings.ts` (`PULSE_BUFFER_MAX_RESULTS` positive integer default 10000; `PULSE_BUFFER_MAX_AGE_MS` via kit `readMs`, default 3600000, cap 2^31−1; invalid values fail like other settings), `src/metrics.ts`, tests in `client.test.ts`, `main.test.ts`, `settings.test.ts`, `metrics.test.ts`, docs `configuration.md`, `operation.md`, `troubleshooting.md`, `README.md`.
- Behavior per decisions 3–6 above.
- Metrics: gauge `pulse_probe_buffered_results`; counter `pulse_probe_results_dropped_total{reason="buffer_full|too_old|rejected"}` (all three label values exposed at 0 from start); counter `pulse_probe_results_delivered_late_total` (results delivered from the buffer, not direct posts).
- Logs: one line when buffering starts (first result buffered after an empty buffer), one when the buffer is empty again with the count delivered/dropped since start; no per-result lines for retryable failures.
- `/readyz` unchanged.
- Docs: buffering and limits, settings, what is lost on probe restart or shutdown (whole buffer), how replayed and late results appear in history (decision 1), 7-day api limit, how to alert on the gauge (for example `pulse_probe_buffered_results > 0` for 10 min; `increase(pulse_probe_results_dropped_total[1h]) > 0`).
- Tests (each fails on old code, mutation output in the PR): network error/timeout/429/500/503 buffered; 400/401/403/404 never buffered and counted `rejected`; FIFO order delivery with one in flight; new results queue behind a non-empty buffer; buffer full drops the oldest with `buffer_full`; too-old dropped with `too_old` at enqueue and at send; backoff 1 s→30 s cap and reset (fake timers); 404 requests a reload; log lines exactly twice; shutdown stops the sender and logs the lost count; gauge and counters; settings parsing and caps.
- Memory evidence: measurement with a full buffer at defaults (see Performance impact) in the PR.
- Done when: probe CI green.

## Repository: api
Files: `src/service.ts` (tracker: Map location → `{lastResultAt, lastSeenAt}`, updated in the ingest transaction after a successful insert, skipping `HEARTBEAT_LOCATION`; start-up rebuild query `SELECT location, MAX(timestamp) … GROUP BY location` excluding heartbeat; accessor `listLocations(now)`), `src/server.ts` (`GET /locations`: public like other reads, `200`, array sorted by name, wire version header, add to the route tables/path normalization for the request metrics as `/locations`), `src/config.ts` (`PULSE_LOCATION_SILENT_MS`, optional positive integer, cap 2^31−1), `src/metrics.ts` (`pulse_api_location_last_result_timestamp_seconds{location}` gauge in seconds, evaluated at scrape from the tracker), `src/main.ts` wiring, `scripts/compose-e2e.sh` and `compose/e2e/checks.json` if a check with a 10 s interval is missing, docs `rest-api.md`, `configuration.md`, `operation.md`, `concepts.md`, `troubleshooting.md`, `development.md`, README.
- Response validated against the contract `Location` schema in tests; `lastResultAt` in ms as in other timestamps.
- Late results: `lastResultAt` = max; never lowered. Rejected (400/401/404) posts do not count. Silent rule per decisions 7–8.
- Docs: `GET /locations`, silent rule and `PULSE_LOCATION_SILENT_MS`, the metric, alerting on silence (for example `time() - pulse_api_location_last_result_timestamp_seconds > 300`, and note the metric is by result timestamp, so after replay it can lag until the buffer drained), replay semantics from decision 1.
- Tests (fail on old code; mutation output in the PR): tracker updates, late result does not lower, heartbeat location absent from the list and the metric, rebuild at start from the DB, silent/reporting around the threshold with an injected clock, default threshold formula (3 × largest interval, min 3 min, heartbeat checks excluded, no checks), explicit override, route public without token, sorted output, contract schema validation, metric output, config validation.
- `compose-e2e`: new step: with the stack up and results flowing, stop the api for longer than two check intervals (checks at 10 s, stop ≥ 30 s; override via an `E2E_*` variable), start it, then `wait_for`: (a) `GET /locations` shows the probe location `reporting`; (b) for the check, `GET /checks/:id/results` over the gap window has consecutive timestamps no further apart than 1.5 × the interval (no hole) and ascending. The step needs the probe change (hence the dependency on probe).
- Done when: api CI green including `compose-e2e` with the outage step; the acceptance of the issue (2 min outage, 10 s checks) holds.

## Risks
- Replay after a long outage drives state and incidents with old timestamps and may emit late notifications; documented, no change.
- A probe restart loses its buffer; documented.
- Buffer memory against the probe peak-RSS budget; measured, defaults adjustable.
- A probe with a revoked token drops every result as `rejected` (as before) and logs per drop.

## Acceptance evidence
1. Outage run: after restart every result of the gap reaches the api, no gap in `GET /checks/:id/results`, ascending per check.
2. Probe metrics: gauge rises and returns to 0, `delivered_late_total` increases by the delivered count, exactly two log lines.
3. Unit: buffer_full, too_old, rejected, retryable vs final outcomes.
4. `GET /locations`: `silent` after the threshold, `reporting` after the probe delivers again, `heartbeat` never listed, metric matches, a late result does not lower `lastResultAt`.
5. Contract `Location` validates the response; CI green in contract, probe, api; memory measurement in the probe PR; mutation output in each PR.
