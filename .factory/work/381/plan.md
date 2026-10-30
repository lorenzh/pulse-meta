# Spec #381: Latency history and availability SLOs

## Goal
Visitors and operators see how fast each check answered over the last 90 days (p50 and p95 per UTC day) and, where an operator sets `availabilityTarget`, the 30-day availability with the remaining error budget.

## Scope
- contract: schemas/types for `CheckLatency`, `Slo`, optional `availabilityTarget`.
- api: `GET /latency`, `GET /checks/:id/latency`, `slo` on `GET /checks` and `GET /components`, metric `pulse_api_slo_budget_remaining_ratio`.
- status: per-check latency chart (inline SVG), SLO sentence, proxy allow-list and filter.
- Builds on the accessibility wave #378 (closed). The implementer reads post-#378 `main` of status (in-place patching in `patch.ts`/`sections.ts`, tab-stop, live-region and naming rules) and follows it; the new chart and SLO lines update in place and add no new tab stops beyond the one `<details>` summary.

## Non-goals
No latency per location or component, no percentiles besides p50/p95, no configurable window (30 days), no alerts (notify unchanged), no latency SLO, no chart library, no new runtime dependency.

## Decisions (defaults from the issue review)
- Percentile: nearest-rank, value at index `ceil(p*n)` (1-based) of the sorted `latency_ms`, no interpolation, so integers. p50 of [10,20,30,40] = 20; p95 of 20 values = the 19th. Over `up` and `degraded` results, all locations, late results included. `count` = number of those results.
- Days: 90 UTC days, today last. Empty day: `p50Ms: null, p95Ms: null, count: 0`.
- Heartbeat and TLS checks: no latency (omitted from `/latency`; `/checks/:id/latency` for them answers the same error as for an unknown id). `availabilityTarget` IS allowed on them and on components containing them.
- SLO window: the last 30 UTC calendar days including today, same day buckets as `/uptime`; result-weighted, `degraded` is up, maintenance not subtracted. `availability` in percent; `budgetRemaining = 100 * (1 − (1 − a/100) / (1 − t/100))` in percent of the budget, may be negative; both `null` with no results. The metric is a ratio (0.5 = 50 %) and is omitted when `null`. Docs state the unit difference.
- `slo` object: present on a `GET /checks` / `GET /components` entry only when a target is set: `{target, windowDays: 30, availability, budgetRemaining}`. No new route.
- Worked examples (test data): target 99.9, availability 99.95 gives 50; 99.8 gives −100.

## Performance impact
`bench/budgets.json` does not exist in `main` of api yet, so the kinds of metric are named: p95 latency of `GET /latency`, `GET /checks`, `GET /checks/:id/latency`; load CPU and peak RSS (rollup compute and SLO sums); startup CPU/idle RSS (a new table, no startup scan); test CPU (more tests). Image size none (no dependency). Expected: `GET /checks` with SLO adds one 30-day grouped count per target check, served from the existing 5 s cache, so a small increase on a cold read only. `GET /latency` cold read is dominated by today's live percentiles (≈ 100 checks × 1 440 rows) plus a read of ≤ 9 000 rollup rows; closed days are never recomputed on read. Without a rollup, 9 M rows would be sorted per call, which the budget forbids.
Measurement: extend `src/bench-reads.ts` (seed 100 checks, 90 days of 1-minute results, with varied `latency_ms`) to time `service.getLatency()`, `getCheckLatency(id)` and `listChecks()` with SLO targets on every check, cold (cache cleared) and warm; run a local A/B against `main` (`bun bench/run.ts --a <ref> --b <ref>` if `bench/` exists by then). Put the p95 numbers into the "Performance impact" section of the PR and compare them with the api's p95 budget; the first cold fill of 89 closed days per check is measured separately (target: the backfill never runs inside a request, see api).

## Repository: contract
Files: `src/schema.ts`, `src/index.ts`, `src/components.ts` (if component schema lives there), `test/*`, `docs/index.md`.
- `availabilityTarget`: optional number `>= 90` and `< 100` on every check type and on components in the checks-file schema (strict; 89.9, 100, NaN, strings rejected). Allowed for heartbeat and TLS.
- `CheckLatencySchema` / `CheckLatency`: `{checkId: string, days: 90 entries {date: YYYY-MM-DD, p50Ms: number|null, p95Ms: number|null, count: int>=0}}`, exactly 90 days. A day with `count: 0` has `null` values and one with `count > 0` has numbers (refine).
- `SloSchema` / `Slo`: `{target, windowDays, availability: number|null, budgetRemaining: number|null}`; add optional `slo` to the check and component response types of `GET /checks` / `GET /components` (client types too).
- Docs: fields, ranges, nearest-rank and SLO formulas, units.
- Tests: valid/invalid files at the bounds, `CheckLatency` with 90 days and nulls, wrong day count, `Slo` with nulls; each fails on the old code (mutation output in PR). Bump the version so api and status can consume the release; CI green.
Evidence: green CI, mutation output, release version.

## Repository: api
Depends on the contract release. Files: `src/db.ts`, `src/service.ts`, `src/server.ts`, `src/metrics.ts`, `src/retention.ts`, `src/config.ts` (pass `availabilityTarget` through), `src/bench-reads.ts`, tests (`src/latency.test.ts`, `src/slo.test.ts`, server tests), `docs/rest-api.md`, `docs/concepts.md`, `docs/configuration.md`, `docs/operation.md` (backup/restore, retention), `checks.example.json`, `scripts/compose-e2e.sh`.
- Rollup table `latency_daily (check_id, day, p50_ms, p95_ms, count, PRIMARY KEY (check_id, day))` created with `CREATE TABLE IF NOT EXISTS` (no upgrade path exists; document that old files get it on open). Closed days are filled lazily by a backfill that runs at startup and then hourly off the request path (and, as a fallback, the first read fills missing closed days for the requested checks with `INSERT OR IGNORE`); empty closed days get a `count: 0` row so they are not rescanned. Today is computed live from `results` (index `results_by_check`). A closed-day rollup is not recomputed for late results (documented). Retention keeps rollups for at least 90 days regardless of raw-row retention and removes rollups of deleted checks.
- `GET /latency`: array of `CheckLatency` for active HTTP checks in `GET /checks` order; `GET /checks/:id/latency`: one `CheckLatency`, errors as `GET /checks/:id/results` for unknown/inactive ids. Same auth, headers and 5 s cache; the existing invalidation (new result, check changes) also clears them. Add both paths to the route label/metrics lists (`/checks/:id/latency` as a template label).
- SLO: the 30-day availability reuses the `/uptime` day-bucket query/function (no second definition); component availability reuses the `/components/uptime` approach. `slo` on `GET /checks` and `GET /components` entries only with a target. Gauge `pulse_api_slo_budget_remaining_ratio{check}` / `{component}` (ratio), omitted when `null`.
- Tests with hand-computed data: known results with several days, down results excluded, degraded included, empty days, multiple locations merged, nearest-rank edge cases (n=1, n=2, n=20), heartbeat/TLS left out, order, cache and invalidation, closed-day rollup equals live computation, 99.95 gives 50 and 99.8 gives −100 on check and component (metric 0.5 and −1), no data gives `null` and no metric, retention keeps rollups. Each new test fails on the old code (mutation output in PR).
- compose-e2e: assert `/latency` has non-null values for today for a seeded HTTP check.
Evidence: CI green; benchmark p95 of `GET /latency`, `GET /checks/:id/latency`, `GET /checks` with SLO under the seed, inside the budget, in the PR.

## Repository: status
Depends on api and contract. Files: `src/api-filter.ts`, `src/api-poll.ts`, `src/render.ts`, `src/sections.ts`, `src/patch.ts`, `src/ssr.ts`, `src/components-view.ts`, `src/theme.ts` (colours), `public/*`, `e2e/*`, docs (`configuration.md`, `theming.md`, `operation.md`), tests.
- Proxy: add exactly `/api/latency` to `ALLOWED_API_PATHS`; the page uses only this route (no per-id pattern). It is a per-check read, so with `PULSE_STATUS_SHOW_CHECKS=false` the proxy answers 404 and `filterApiBody` passes no check ids. Cleaners for `/api/checks` and `/api/components` keep the `slo` field (validated, numbers/null only); with checks hidden the component `slo` still shows and carries no check id or name. Sentinel privacy test with hidden checks: no request returns per-check latency, and no ids/names.
- Chart per shown HTTP check (also rendered in the no-JS/SSR view and updated in place by the patcher from the poll, as the post-#378 rules require): inline SVG built by the page's own code, p95 and p50 lines over 90 days with gaps for `null` days, objective as a horizontal line when set; `aria-hidden="true"`; theme colours with at least 3:1 contrast against the background in light and dark (extend the palette test); no new tab stop except the `<details>` summary holding the table of daily values (date, p50, p95, count); text summary next to it (“p95 last 7 days 180 ms, objective 300 ms”; “no latency data yet” for HTTP checks without data). Heartbeat/TLS: no chart. Replaces nothing in `renderLatency`'s newest-value text beyond reuse.
- SLO text for components and checks with a target: “Availability 99.95 % of 99.9 % target, 50 % budget left”; negative budget reads “budget exceeded by 100 %”; no data reads “no availability data yet”. Checks without target show nothing. Numbers formatted per the page locale rules from #378.
- Tests: render/patch/ssr unit tests, filter and sentinel tests, palette contrast, e2e with axe and keyboard (the `<details>` reachable in one step) with and without targets; look at the page in a browser in both cases. Each new test fails on the old code (mutation output in PR). Compose-e2e: the page shows a chart.
Evidence: CI green, axe/keyboard checks from #378 green, screenshots without and with targets.
