# Spec: Maintenance windows (issue #8)

## Goal
Planned work on a watched service does not count as an outage. Inside a configured maintenance window, down results are recorded but do not change the check to down, do not count towards an incident and open none. The API lists current and upcoming windows. The status page shows a "maintenance" state with the note, and lists upcoming windows.

## Scope
- contract: window type, `"maintenance"` state, response type.
- api: parse windows from the checks file, classify results, compute displayed state, `GET /maintenance`, injectable clock.
- status: poll `/api/maintenance`, render the maintenance state, note and upcoming list.

## Non-goals
- No change to probe (it keeps probing and posting during windows).
- No runtime editing or hot reload of windows; they are read at API start, like the checks. No SQLite schema change; windows live in memory.
- No clock-skew handling, no out-of-order result handling, no recurring windows, no history of past windows.

## Decisions (defaults taken from the issue review)
1. **Config**: the checks file gets an optional top-level `maintenance` array next to `checks`: `{ "checkId": string, "start": string, "end": string, "note": string }`. A missing key means no windows, so existing files stay valid.
2. **Time format**: `start` and `end` in the file are ISO 8601 strings with an explicit offset (`Z` or `±hh:mm`). They are parsed to epoch ms. Everywhere else (contract, API) they are epoch ms numbers.
3. **Interval**: half-open `[start, end)`. Validation, failing with `ConfigError` at startup: `checkId` must reference a configured check; `end > start`; invalid or offset-less dates rejected; `note` must be a non-empty string. Overlapping windows of one check are allowed (union); when several are active, the one with the earliest `start` is reported.
4. **Classification of a result**: by the result's own `timestamp` (when it was measured). The displayed state and the current/upcoming listings use the injectable clock `now()`.
5. **Down result in a window**: inserted into `results`; `last_result_at` and `last_reason` updated; stored `state`, `consecutive_down` and incidents untouched. **Up result in a window**: processed normally (state up, count reset, an open incident resolves, since it is a real recovery). An incident open when a window starts stays open; down results never close it.
6. **Displayed state**: `"maintenance"` is never stored. `GET /checks` returns `state: "maintenance"` plus `maintenance` (the active window) for a check whose window contains `now()`, whatever its stored state (including `unknown`). Otherwise the stored state. After the window the stored state shows again; in-window downs did not count, so counting restarts at the stored value and the first up result sets `up`.
7. **`GET /maintenance`**: returns `MaintenanceWindow[]` with every window where `end > now()`, sorted by `start`, then `checkId`. Optional `?checkId=` filter. A client tells current (`start <= now`) from upcoming (`start > now`). Open incidents continue to appear in `/incidents` during a window.
8. **Status page**: a check row in a window shows state `maintenance` (CSS class `state-maintenance`, its own colour) and the escaped note. An "Upcoming maintenance" section lists windows with `start > now` (check name or id, start, end, note), with an empty-state text. Active windows show on the check row only. The poller fetches `/api/maintenance` as a third request; failure fails the refresh like the others. "Upcoming" filtering uses the poller's injectable `now`, never `Date.now()` directly.

## Required behavior
- In-window down results: stored, no state change, no count, no incident.
- Down results straddling a window edge count only outside it (`start` inclusive, `end` exclusive).
- Open incident stays open through a window of downs.
- After a window with the server back, the next up result gives `up` and the full `/incidents` list has no entry for the window.
- Time comes from an injectable clock (`() => number`); tests use a fake clock, with no real timers or sleeps.

## Risks
- Probe/API clock skew can misclassify results near edges (accepted, out of scope).
- Windows need an API restart to change; set them before starting.
- Contract change needs a rebuilt, committed `dist/` and SHA pin bumps in api and status (merge order: contract first).

## Acceptance evidence
With a window for `example` around a period in which the test server on port 9000 is off:
1. Before the window the page shows `example` up; the window is listed as upcoming on the page and in `GET /maintenance`.
2. Inside the window with the server off: probe posts down results, present in `GET /checks/example/results`; `GET /checks` shows `state: "maintenance"` with the note; `GET /incidents` is empty; the page shows "maintenance" and the note.
3. After the window with the server back: the check is `up`, `GET /incidents` (all) has no entry, and the window is gone from the API and page lists.
4. `npm run check` passes in contract, api and status.

## Repository: contract
Files: `src/` types file (and its `test/`), rebuilt `dist/`, README.
- Add `"maintenance"` to `CheckState`.
- Add `interface MaintenanceWindow { checkId: string; start: number; end: number; note: string }` (epoch ms, `[start, end)`).
- Add `maintenance?: MaintenanceWindow` to `CheckWithState` (set only when state is `"maintenance"`).
- Add `type MaintenanceResponse = MaintenanceWindow[]` for `GET /maintenance`.
- Update type tests in `test/` to cover the new types, document them in README, rebuild and commit `dist/`.
- Done when `npm run check` passes and the merge commit SHA is available for the pins.

## Repository: api
Files: `src/config.ts`, `src/service.ts`, `src/state.ts` (only if needed), `src/server.ts`, `src/main.ts`, their tests, `checks.example.json`, `README.md`, `package.json` and lockfile (contract SHA bump).
- Bump `@lorenzh/pulse-contract` to the new contract SHA.
- `config.ts`: parse and validate `maintenance` per decisions 1–3 and return `{ checks, maintenance }` (add `loadConfig`/extend the parser; keep the checks-only behavior valid). `main.ts` passes windows to the service/server.
- `service.ts`: `createService(db, { maintenance, now = Date.now })`; replace the "needs no clock" comment. `ingest` classifies by `result.timestamp` (decision 5); `listChecks` computes the displayed state with `now()` (decision 6); add `listMaintenance(checkId?)` (decision 7).
- `server.ts`: route `GET /maintenance` with optional `checkId`; `createApiServer` takes the clock via the service.
- Tests (node:test, fake clock): 3+ in-window downs leave no incident, unchanged `consecutiveDown`, results stored; open incident survives in-window downs; an in-window up resolves it; edge cases at `start` and `end`; config valid, missing key, bad date, no offset, unknown checkId, `end <= start`, empty note; `listChecks` shows maintenance with the note and the stored state after the window; `/maintenance` lists current and upcoming, excludes past, filters by `checkId`.
- Update `checks.example.json` (with an example window) and README (config, endpoint, semantics).
- Done when `npm run check` passes with no real timers.

## Repository: status
Files: `src/poller.ts`, `src/render.ts`, `public/index.html`, `public/client.js` if it wires the poller, their tests, `README.md`, `package.json` and lockfile (contract SHA bump).
- Bump `@lorenzh/pulse-contract` to the new contract SHA.
- `poller.ts`: fetch `/api/maintenance` along with checks and incidents; add `maintenance` to `PollerState`.
- `render.ts`: `state-maintenance` row with the escaped note (`escapeHtml`) and the label "maintenance"; "Upcoming maintenance" section with windows where `start > now` (injected `now`), sorted by start, with an empty case.
- `index.html`: style `state-maintenance`. `server.ts` needs no change (proxies `/api/*`).
- Tests: render of maintenance row with escaped note, upcoming list, empty list, active window not in the list; poller fetches and stores maintenance, using a fake `now` and local servers only.
- README: describe the maintenance display.
- Done when `npm run check` passes.

Probe: no change.
