# Issue review #381: latency history and availability SLOs

Verdict: specifiable. No blocking question; the open points have defaults below.

## Checked against the clones
- Status proxy allow-list (`status/src/api-filter.ts`) is exact pathname plus query, no wildcard. `/api/checks/:id/latency` needs a pattern match or the page must use `/api/latency` only (preferred: one route, filtered).
- Contract has `latencyObjectiveMs` on checks (`schema.ts` ~217; `z.never()` for heartbeat/tls ~357). `availabilityTarget` needs the same exclusion decision.
- API `GET /uptime` is result-weighted, `degraded` counts as up, late results counted, maintenance not subtracted, 90 UTC days (`concepts.md`). Retention is at least 90 days.
- Status `renderLatency` is at `render.ts:151`.

## Open points and assumptions
1. Rolling 30 days vs UTC days: assumed the last 30 UTC calendar days including today (the same day buckets as `/uptime`), so the SLO equals the weighted mean of those 30 days' counts. State it in the docs.
2. Heartbeat and TLS checks: latency is left out (stated). Assumed `availabilityTarget` is allowed on them (availability is defined for them) and applies to components containing them; if the contract rejects it, say so. Plan decides; default allow.
3. Percentile method is unspecified. Assumed nearest-rank (`ceil(p*n)`-th value, no interpolation), documented, so hand-computed tests are exact. Rollups store p50, p95 and count per closed day; today is computed live. Late results: include (as `/uptime` does).
4. Rollup table: closed days filled lazily or at start/hourly; retention must not delete rollups needed for the 90-day window (rollups for closed days remain valid even if raw rows are later cut). A db migration is needed and backups/restore docs change. Changes to result rows after the day closed (late results) may make a rollup stale; assumed ignored for closed days or recomputed on write — the plan picks.
5. `days` is 90 UTC days with today the last entry; `p50Ms`/`p95Ms` are integers or numbers? Assumed numbers, unrounded nearest-rank values of integer `latency_ms`, so integers. `count` is the number of successful results.
6. SLO data placement: assumed an optional `slo` object on `GET /checks` and `GET /components` entries, present only when a target is set. Contract also needs the types for the `slo` field in those responses; `budgetRemaining` is in percent of the budget (50 means 50 %), while the metric `pulse_api_slo_budget_remaining_ratio` is a ratio (0.5). Docs must state the unit difference. Target 100 is excluded by the schema (x < 100), so no division by zero.
7. Component availability: assumed the same computation as the existing component uptime (the approach `GET /components/uptime` uses), over 30 days.
8. No data in the window gives `availability: null`, `budgetRemaining: null`; the metric is then omitted.
9. Inactive checks: `/latency` lists active checks only, in `GET /checks` order; `GET /checks/:id/latency` for unknown or inactive id returns the same error as `GET /checks/:id/results`.
10. Privacy: status serves only the allowed fields; with `PULSE_STATUS_SHOW_CHECKS=false` the proxy returns 404 for the latency path and the component SLO text (components only) must not leak check ids or names. The SLO of a check is also check-level data in `/api/checks`, which is already filtered; the same filter applies.
11. Component SLO fields and the sentinel privacy test: with checks hidden, component targets still show (components are public); only per-check data is hidden.
12. Chart for checks without latency data (all null, or heartbeat/TLS): the chart is omitted for heartbeat/TLS; for HTTP checks with no data, show a short text instead of an empty chart.
13. The accessibility wave #378 is closed; the plan must read the post-#378 `main` of status (in-place update and tab-stop rules) rather than the issue text.
14. Performance budget: the plan must read the api's p95 budget and benchmark seed from the #377 work and measure both routes; the number goes into the spec's "Performance impact" section.
15. Version bumps: contract is consumed by api and status through its release; the order contract, api, status holds. No new runtime dependency (see `docs/approved-packages.md`).

## Derived acceptance check
- Contract: a checks file with `availabilityTarget` 90 ≤ x < 100 on a check and a component validates; 89.9 and 100 are rejected. `CheckLatency` and the SLO data parse with 90 days and nulls.
- API with a fixed data set (hand-computed): `GET /checks/:id/latency` returns 90 days, oldest first, nearest-rank p50 and p95 per day over `up` and `degraded` results, `null` and `count: 0` for empty days, down results excluded; `GET /latency` is the same for every active HTTP check in `GET /checks` order, without heartbeat and TLS checks.
- A target 99.9 with 99.95 % availability gives `budgetRemaining` 50; with 99.8 % it gives −100. Component likewise. The metric reports 0.5 and −1.
- Cache and invalidation: a new result is visible within 5 seconds or at once by invalidation.
- Benchmark seed (100 checks, 90 days of 1-minute results): `GET /latency` and `GET /checks` with SLO stay inside the p95 budget; numbers in the spec and PR.
- Status: every shown HTTP check has an aria-hidden SVG chart, a text summary, and a `<details>` data table reachable in one step; objective line when set; "Availability 99.95 % of 99.9 % target, 50 % budget left" in words with and without targets; axe and keyboard checks green; with `PULSE_STATUS_SHOW_CHECKS=false` the proxy returns no per-check latency (sentinel test).
- `compose-e2e`: `/latency` has values for today and the page shows a chart.
- Each new test fails on the old code (mutation output in the PRs).
