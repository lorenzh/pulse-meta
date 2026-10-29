# Spec #188: Status page robust polling, caching and freshness

## Goal
The status page keeps updating, does not load the API once per viewer, and never presents stale or unknown data as healthy. Only `status` changes. No contract or API change: the API supports only `GET /incidents?status=open|resolved` (no date filter), so the 7-day window is applied in the status proxy.

## Scope
Poller, proxy server, render, `client.js`, `index.html`, docs of `pulse-status`.

## Non-goals
No accessibility rework (wave 6). No change to what is public: the #164 allow-list and redaction (`hideDetails`) stay and must not be weakened, also for cached data.

## Decisions
- **Cache**: in the proxy, key = allow-listed path + query. TTL default 2000 ms, setting `PULSE_STATUS_CACHE_MS` (0 = off; invalid value throws at start like the other settings), below the default `POLL_MS` 5000 so each poll sees fresh data. Single-flight: concurrent misses share one upstream call. The cache holds the final response (status + body after `filterApiBody`, redaction and the resolved window), so every viewer gets the same bytes. Errors (502, non-2xx, timeout) are cached for the same period only; no stale serving: a failed upstream gives the error response, the page shows its banner. Clock is injectable (`now` option) for tests. Responses carry `cache-control: no-store` so the browser cache does not add lag.
- **Resolved window**: for `/api/incidents?status=resolved` the proxy keeps incidents with `resolvedAt >= now - 7 d`, sorted newest first. Move `RESOLVED_WINDOW_MS` to a small shared module (e.g. `resolved-window.ts`, served to the browser via `tsModules` if the client imports it) or keep it in `render.ts` if `server.ts` may import it. The allow-list needs no change. The poller keeps its own filter as defence.
- **Timeouts**: proxy uses `AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)` for both `fetch` and `text()`; default 4000 ms, option `upstreamTimeoutMs` (env `PULSE_STATUS_UPSTREAM_TIMEOUT_MS`); a timeout answers 502 "API unreachable". Client: poller option `timeoutMs` (default `min(pollMs, 4000)`... use 4000 in `client.js`) with an `AbortSignal` passed to `fetch` and kept active until `response.json()` completes; a timeout counts as a failed refresh.
- **Freshness**: new element `#updated` in `index.html`; new pure `renderUpdated(updatedAt, error, env)` shows "Last updated <time>" (relative `<time>` via `renderTime`, exact time in tooltip) and, after an error, still the last successful time ("Last updated 3 min ago · API unreachable"). Redrawn on each poll and also by a 30 s `setInterval` in `client.js` from the stored state so it ticks without a fetch. No inline script or style (CSP).
- **Error state**: `renderSummary` takes the poll error. With an error: "Status may be outdated" (class `status-warning`) replaces any "All systems operational"; never "operational" next to the banner. Stale data stays visible. First fetch failed (`updatedAt === null`): `#checks` shows the error text instead of "Loading…" (the banner plus a "Status unavailable" summary).
- **All-unknown**: when every check is `unknown` the summary reads "Status unknown" (neutral class), not operational. If every check is `unknown` or `maintenance` with none up/degraded, also "Status unknown"; only-maintenance with no unknowns keeps today's text. At least one `up` with the rest unknown/maintenance stays operational. Existing render tests are updated consistently.
- **Render errors**: in the poller, `onUpdate` runs inside a `try` with `console.error` (injectable `log`, default `console.error`); `tick` always reschedules; `refresh()` called directly also does not reject on render errors.
- **Hidden tabs**: poller takes an optional `visibility: { isHidden(): boolean; onChange(fn): void }` (client wires `document.visibilityState` / `visibilitychange`). Hidden: clear timer, abort the in-flight request, no new request. Visible: refresh at once and resume the chain. Idempotent, no double timers (generation counter so a late result of an aborted tick does not reschedule).
- **Browser check**: the repo has no headless browser tooling; do not add one. The PR records a manual check against a fake API (cache hits, hidden tab, API down on first load and later, render-breaking data) and test-covered logic stays in unit tests.

## Required behavior
As in the issue, with the decisions above.

## Risks
- TTL plus poll interval adds up to ~TTL lag; default TTL < poll keeps it small.
- Shared cache must not leak across `hideDetails` modes: it is per server instance.
- Abort on hide must not leave the poller stuck.

## Acceptance evidence
1. 20 parallel requests in one period give 1 upstream call per path; after the period a new call; an upstream error is retried after the period; #164 tests still pass.
2. Proxy `status=resolved` returns only incidents from the last 7 days, newest first, although the fake API returns older ones.
3. Poller test with throwing `onUpdate`: logged, next poll runs (fails on old code).
4. Render tests: last-updated, error summary, all-unknown, failed first fetch.
5. Hanging upstream (headers and body) aborted in proxy and in poller tests with fake timers/short timeouts.
6. Hidden: no requests; visible: immediate poll.
7. Docs updated; `npm run check` passes; manual browser check noted in the PR.

## Repository: status
Files: `src/server.ts` (cache, single-flight, timeout, resolved window, `no-store`, options), `src/api-filter.ts` (resolved window filter, if placed there), `src/settings.ts` and `src/start.ts` (`PULSE_STATUS_CACHE_MS`, `PULSE_STATUS_UPSTREAM_TIMEOUT_MS`), `src/poller.ts` (try/catch around `onUpdate`, timeout, visibility), `src/render.ts` (`renderSummary`, `renderUpdated`), `public/client.js` and `public/index.html` (`#updated`, visibility wiring, timeout, ticker, no permanent "Loading…"), `public/page.css` if the new element needs style (no inline), `docs/operation.md` (caching, freshness, timeouts, hidden tabs), `docs/configuration.md` (two new settings), `docs/troubleshooting.md` (unavailable/outdated states), `docs/development.md` and README if they list files or settings.
Tests (each fails on old code): `server.test.ts` / new `server.cache.test.ts` (call counts, single-flight, TTL, error TTL, resolved window, timeouts incl. body), `poller.test.ts` (throwing `onUpdate`, client timeout incl. json body, hidden/visible), `render.test.ts` (summary and freshness), `settings.test.ts`/`start.test.ts` (new settings).
Done when: `npm run check` passes in `status`, the allow-list and redaction tests are unchanged and green, and the manual browser check is recorded in the PR description.
