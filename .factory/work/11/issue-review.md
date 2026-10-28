# Issue review: 90-day uptime bars on the status page

## Current state (inspected in `.repos/*`)
- **contract**: `Result` has `status` (`up|degraded|down`), `timestamp` (epoch ms), `location`, `attempts`. `CheckWithState` is a `Check` plus state fields (`locations`, ...). No uptime or history type exists. `ChecksResponse = CheckWithState[]`.
- **api**:
  - `results` table holds every result, with index `results_by_check (check_id, timestamp DESC, id DESC)` and `results_by_location (check_id, location, timestamp)`. Nothing prunes results, so 90 days are available.
  - `createService` takes `now` (injectable clock, default `Date.now`). Routes: `POST /results`, `GET /checks`, `GET /checks/:id/results?limit` (max 1000), `GET /incidents`, `GET /maintenance`. No uptime route or field.
  - `listChecks` already does per-check work on each call. The status page polls it every few seconds.
- **status**: the poller fetches `/api/checks`, `/api/incidents?status=open` and `/api/maintenance`. `renderChecks` builds one `<li class="check state-…">` per check from strings. `index.html` holds the CSS, with light and dark themes and `--degraded`. `client.js` re-renders `innerHTML` on every poll. No history UI.
- AGENTS.md of the repos: strict TS, `node:test` next to the code, injectable clock, no real timers, network tests only against local servers. Biome lint.

## Open points (none block the spec)
1. **API shape.** Options: (a) a field `uptime` on each entry of `GET /checks`; (b) a new endpoint `GET /checks/:id/uptime`, or `GET /uptime` for all checks. The issue says "the API returns per check". Assumption: a new endpoint `GET /uptime` returning all checks in one response, so the status page makes one extra request per poll and `GET /checks` stays small and cheap. Contract gets a type `CheckUptime`: `{ checkId, days: UptimeDay[], uptime: number | null }`, with `UptimeDay = { date: "YYYY-MM-DD", uptime: number | null, results: number }` (`null` = no data). 90 entries, oldest first, the last one is today.
2. **Day boundary.** Assumption: UTC calendar days, derived from `now()`; the window is today and the 89 days before it (90 buckets). Today is a partial day. The status page shows dates in ISO/UTC, as it does for incident times. A per-viewer time zone is out of scope.
3. **Definition of uptime.** Assumptions:
   - Per day: `up results / all results` of that day, as a percentage with one decimal (stored as a number 0–100, unrounded in the API, rounded for display).
   - `degraded` counts as up (the service answered). Reason: degraded results do not count towards incidents (#10). The spec states it explicitly.
   - Result-based, not time-based: every result weighs the same. With multiple locations, all results of all locations count. Planned maintenance windows are not subtracted, because results during maintenance are still stored. This may show down results in the bar that the state hides. Flagged as a known limit; the alternative (excluding results inside windows) needs the stored windows in the query, and is left out.
   - Retried results count once (one stored result per attempt series).
4. **Total.** Assumption: the 90-day total is the sum of all up results over the sum of all results in the window (weighted by results, not the mean of the day percentages). `null` when there are no results at all, and the page then shows "no data". Days without data do not count as down.
5. **Colour thresholds.** The issue says "coloured by uptime" and gives no scale. Assumption: `>= 99.9` green (up), `>= 95` amber (degraded colour), below that red (down), no data grey. Applied by the status page only; the API returns the numbers. The colours must work in light and dark theme (new CSS variables or reuse of `--up/--degraded/--down`). Colour alone must not carry the meaning: each bar has an accessible label, and the hover text states the date and percentage. Thresholds are a spec decision, not configurable.
6. **Hover and focus.** Each bar is focusable (`tabindex="0"`) with the text "2026-10-27: 98.4 %" or "2026-10-27: no data", available as a `title` and as `aria-label` (and possibly a CSS tooltip on `:hover`/`:focus`). Assumption: native `title` plus `aria-label` and a visible focus style, because `title` alone is not shown on keyboard focus; a CSS tooltip covers focus. The bars sit in a list or a `role="img"` group with a summary label such as "90-day uptime 99.2 %". The spec must pick one structure.
7. **Fast with 90 days at a one-minute interval.** That is about 130,000 results per check (about 130k × checks rows). Assumptions:
   - Aggregate in SQL (`GROUP BY` day, `SUM(status != 'down')`) over `WHERE check_id = ? AND timestamp >= windowStart`, using the existing `results_by_check` index. Do not load rows into JS.
   - Day bucket in SQL as integer division `timestamp / 86400000` (UTC days since epoch), then map to dates in JS.
   - No cache or rollup table in the first version. The spec should set a measurable bound (e.g. a test that seeds 90 days × 1 min for one check, about 130k rows, and asserts a result and a generous time bound with the injected clock) and says that a cache keyed on `now()` day is only added if the bound is missed. A rollup table is out of scope.
   - Timestamps are set by the probe, so results with a future timestamp (after `now()`) or before the window are ignored.
8. **Injectable clock.** "Uses the injectable clock": the window and "today" come from the service's `now()` and never from `Date.now()`. The status page renderer takes no clock (the API supplies the dates). The tests seed results with fixed timestamps and a fixed `now`.
9. **Checks without results, and unknown ids.** A check with no results returns 90 no-data days and a total of `null`. A newly configured check shows grey bars; this is also how a day without data looks. An unknown check id on a per-check route returns 404, as for results.
10. **Status page failure handling.** If `/api/uptime` fails or returns no entry for a check, the page still shows the checks without bars. Assumption: the poller fetches it in the same refresh, but a failure of this request alone is tolerated (empty uptime, checks still render, no banner). The alternative is to fail the whole refresh like the other requests. The spec decides.
11. **Where the poller keeps the data.** `PollerState` gains `uptime`; `renderChecks(checks, uptime?)` takes it as an optional second argument so existing callers and tests stay valid. The server's `/api/*` proxy already forwards `/api/uptime`.
12. **TLS checks.** They also store results, so they get bars. The percentage rule is the same. No special handling.
13. **Cross-repository order.** contract (types), then api (endpoint), then status (UI). The repositories take pulse-contract as a Git dependency, so api and status bump it to the new contract first. The probe is untouched.
14. **Not in scope.** Pruning old results, configurable window length, per-location bars, a time zone selector, response-time charts, incident markers on the bars.

## Derived acceptance check
Seed the API database (a test helper or a script that runs `POST /results`, with an injected `now` in unit tests) for one HTTP check with results over several days, at a fixed `now` of e.g. `2026-10-28T12:00:00Z`:
- day D-4: all up (100 %)
- day D-3: an outage, e.g. 24 of 100 results down (76 %)
- day D-2: no results at all
- day D-1: all up, a few of them degraded (100 %, degraded counts as up)
- today: partial day, all up

Then:
1. `GET /uptime` returns an entry for the check with exactly 90 days, oldest first, the last equal to the date of `now()`. D-4 is 100, D-3 is 76, D-2 has `uptime: null` (no data), D-1 is 100. Days older than the seeded range are `null`. The total equals up results over all results in the window. A check without results has 90 `null` days and a `null` total.
2. Results older than 90 days and results after `now()` are not counted. Moving the injected clock by one day shifts the window by one day.
3. Performance: with 90 days of one-minute results (about 130,000) for a check, the call returns in a short time under a stated bound (to be fixed in the spec, e.g. well below one second) and runs one aggregate query per check.
4. Status page (run API and status page against the seeded data, or render with fixtures): per check 90 bars. The D-3 bar has the outage colour and a label with "76", the D-2 bar is grey with "no data", D-4 and D-1 are green. Each bar gets the percentage on hover (`title`) and on keyboard focus (`aria-label`, visible focus style). The 90-day total is displayed ("99.x %", or "no data" for a check without results). Works in the light and dark theme.
5. Render unit tests: bar count, class per threshold at the boundaries (99.9, 95), escaping, a check without an uptime entry renders without bars, and the page still renders when the uptime request fails.

## Hold?
No hold. Every open point has a stated default. Points 1, 3 (degraded and maintenance), 5 and 10 are decisions the spec should record.
