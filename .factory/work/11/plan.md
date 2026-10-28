# Spec: 90-day uptime bars on the status page

## Goal
Visitors of the status page see, per check, how reliable it was over the last 90 days: one bar per day coloured by uptime, the percentage on hover and keyboard focus, and the 90-day total.

## Scope
- contract: new types for the uptime response.
- api: new endpoint `GET /uptime`, computed from stored results.
- status: poller fetches it, `renderChecks` draws bars and total, CSS.

## Non-goals
Pruning old results, configurable window, per-location bars, time zone selector, response-time charts, incident markers, a cache or rollup table, subtracting maintenance windows. The probe is untouched.

## Decisions (from issue review, binding)
1. **Endpoint**: `GET /uptime` returns `CheckUptime[]`, one entry per configured check, in the order of `GET /checks`. `GET /checks` is unchanged.
2. **Types** (contract):
   ```ts
   export interface UptimeDay { date: string /* YYYY-MM-DD, UTC */; uptime: number | null /* 0..100, unrounded, null = no data */; results: number }
   export interface CheckUptime { checkId: string; days: UptimeDay[] /* 90, oldest first, last = date of now() */; uptime: number | null }
   export type UptimeResponse = CheckUptime[];
   ```
3. **Days**: UTC calendar days from the service's injectable `now()`, never `Date.now()`. Window = today plus the 89 days before it. Today is partial. Results with timestamp before the window start (00:00 UTC of day -89) or after `now()` are ignored.
4. **Uptime**: per day `(up + degraded results) / all results * 100`; degraded counts as up. All locations count. Maintenance is not subtracted (known limit). Days without results: `uptime: null`, `results: 0`; they do not count as down.
5. **Total**: sum of up+degraded over sum of all results in the window (result-weighted), `null` if no results. A check without results: 90 null days, total `null`.
6. **Performance**: one aggregate SQL query per check (`GROUP BY timestamp / 86400000`, `SUM(status != 'down')`, `COUNT(*)`) with `WHERE check_id = ? AND timestamp >= ? AND timestamp <= ?`, using the index `results_by_check`. No rows are loaded into JS. No cache unless the bound below is missed.
7. **Colours** (status page only): `>= 99.9` up colour, `>= 95` degraded colour, below red (down colour), no data grey. Fixed, not configurable. Must work in light and dark theme.
8. **Accessibility**: each bar is focusable (`tabindex="0"`), has `title` and `aria-label` "YYYY-MM-DD: 98.4 %" (one decimal) or "YYYY-MM-DD: no data", and a visible focus style, plus a CSS tooltip on `:hover`/`:focus` so keyboard users see it. Bars sit in a container with `role="group"` and `aria-label` "90-day uptime 99.2 %" (or "no data"). The total is also shown as visible text ("99.2 % uptime, 90 days" / "no data"). Colour is never the only carrier.
9. **Failure handling**: if the `/api/uptime` request fails or has no entry for a check, the page still renders the checks without bars, no banner. A failure of the other requests behaves as before.

## Risks
- Day boundary and off-by-one at the window edges: tested with the fixed clock.
- 130k rows per check: the SQL aggregation must use the index; verified by the performance test.
- Bars may show down results that maintenance hides in the state (accepted).
- Page re-renders `innerHTML` on every poll: focus on a bar is lost on re-render; keep markup stable and accept this, or skip re-render when the HTML is unchanged.
- api and status install contract as Git dependency: they must bump to the released contract first.

## Acceptance evidence
At fixed `now` = `2026-10-28T12:00:00Z`, seeded results for one HTTP check: D-4 all up (100), D-3 24 of 100 down (76), D-2 no results, D-1 all up with some degraded (100), today partial all up.
- `GET /uptime` has exactly 90 days, oldest first, last = `2026-10-28`; D-4 = 100, D-3 = 76, D-2 `null`, D-1 = 100, older days `null`; total = up/all.
- Results older than the window or after `now()` are not counted; moving the clock one day shifts the window.
- Performance test: 90 days at one-minute results (about 130,000 rows) for one check; the call returns the right values in under 1 s (generous bound for CI) with the injected clock.
- Status page with the seeded data: 90 bars per check, D-3 red with "76", D-2 grey with "no data", D-4 and D-1 green, percentage on hover and focus, 90-day total shown, "no data" for a check without results.

## Repository: contract
Files: `src/index.ts` (add `UptimeDay`, `CheckUptime`, `UptimeResponse` with doc comments for the semantics above), `test/types.fixture.ts` (fixture using the types), `README.md` if it lists types.
Checks: repository's lint, typecheck, build and tests pass (`dist` per the repo's convention).
Done when: the types are exported from the package and a change is released/mergeable so that api and status can depend on it.

## Repository: api
Depends on contract (new types).
Files: `src/service.ts` (method `getUptime()` using `now`; SQL aggregation), `src/db.ts` only if a prepared statement is kept there, `src/server.ts` (route `GET /uptime`), new tests `src/uptime.test.ts` (and a route test in `src/server.test.ts`), `README.md` (endpoint docs), `package.json`/lock (bump contract).
Behavior: as in decisions 1-6, 9 of the unknown-check case does not apply (the endpoint covers all checks). Per check one aggregate query.
Checks: `node:test` with injected clock and no real timers, tests for: the acceptance seed, window edges (first and last millisecond), future and older results ignored, degraded counted as up, total weighting, check without results, clock shift by one day, 130k-row performance test, route returns the JSON. Biome lint and tsc pass.
Done when: all tests pass and `GET /uptime` returns the acceptance values.

## Repository: status
Depends on contract (types) and api (run time only, no dependency needed in the build; the contract bump is required, so it depends on contract only).
Files: `src/poller.ts` (fetch `/api/uptime` in each refresh, tolerate its failure, `PollerState.uptime`), `src/render.ts` (`renderChecks(checks, uptime?)` with bars, escaping, total), `public/client.js` (pass uptime through), `public/index.html` (CSS for bars, tooltip, focus, light and dark), tests in `src/render.test.ts`, `src/poller.test.ts`, `src/theme.test.ts`/`palette.test.ts` as fit, `README.md`, `package.json`/lock (bump contract).
Behavior: decisions 7-9. Existing callers of `renderChecks(checks)` stay valid.
Checks: render tests for bar count (90), class at the boundaries 99.9 and 95 and below, grey for null, label text, escaping, no entry gives no bars, total text and "no data"; poller test that an uptime failure still yields checks. Lint, tsc and tests pass.
Done when: with the API seeded as in the acceptance check, the page shows the matching bars and total in both themes.
