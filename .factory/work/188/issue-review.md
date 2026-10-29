# Issue review: #188 Status page robust polling, caching and freshness

Verdict: specifiable. Only `status` changes (no API or contract change needed). No blocking question.

## Verified against code (`.repos/status`)
- `poller.ts`: `options.onUpdate(state)` runs after the `try/catch` in `refresh`, so a render throw rejects `tick` and the `setTimeout` for the next poll is never set. Confirmed.
- `server.ts proxyApi`: one `doFetch` per request, no cache, no timeout (`doFetch` + `upstream.text()`). Confirmed. `poller.ts` `getJson` has no timeout either.
- Resolved filter to 7 days is client-side in `getResolved` (`RESOLVED_WINDOW_MS` from `render.ts`).
- The API (`api/src/server.ts`) supports only `GET /incidents?status=open|resolved`. No `since`/`limit` param. So the filter must be server-side in the status proxy (`api-filter.ts` `filterApiBody`). The #164 allow-list needs no change (the query string stays `status=resolved`).
- `render.ts renderSummary`: all-unknown checks give "All systems operational". The error banner is separate. Confirmed.
- No `visibilitychange` handling in the poller or `client.js`.

## Open points and decisions the plan should take
1. **Cache design.** Key = allow-listed path+query. Single-flight (concurrent misses share one upstream call). TTL: pick a default, make it configurable or derive from `pollMs` (e.g. TTL < pollMs so a viewer sees fresh data each poll; if the TTL is >= pollMs, the data lag is up to TTL + pollMs). Decide and document. Errors (502, non-2xx) are cached at most the same period (or not at all, but then single-flight still needs to limit load). Cache holds the raw upstream result and filtering/redaction (`hideDetails`) is applied per response or cached after filtering (hideDetails is fixed per server, so either works).
2. **Serve stale on error?** Issue says errors not cached longer than the period. Assumption: no stale serving; an upstream failure returns 502 so the page shows the error banner. State this.
3. **Resolved window server-side.** Filter by `resolvedAt >= now - 7d` and sort newest first in the proxy. The server needs an injectable clock for tests. The client keeps its filter as defence (harmless) or drops it; keep sorting consistent. `RESOLVED_WINDOW_MS` is in `render.ts`, shared by the server and client; the plan should place it where both can import it.
4. **Timeouts.** Server: `AbortSignal.timeout` covering fetch and `text()` (body read). Value, configurability and docs needed. Timeout gives 502 (or 504; pick one, keep consistent with the "API unreachable" tests). Client: an `AbortSignal` that covers `response.json()`, injectable via poller options for tests. Choose a client timeout so that it is below or tied to `pollMs`. Without an overlap guard, a slow poll could overlap the next one; the existing chain (`tick` schedules after `refresh`) already prevents this.
5. **Freshness display.** Show "Last updated <time>" using `updatedAt` (render function + element in `index.html`, CSP-safe: no inline style/script). Decide: absolute time or relative with `<time>`; it should tick without a new fetch, or at least update on each poll. When the data is stale (error), the label must still show the last successful time.
6. **Error state.** While `error !== null`: summary must not say "All systems operational" (e.g. "Status unavailable" / "Showing last known data"). `renderSummary` needs the error/state input; decide whether stale data from before the error stays visible (assumption: yes, with the changed summary and the freshness time). First fetch fails (`updatedAt === null`): show the error, not "Loading…" (check `client.js` and `index.html` placeholders).
7. **All-unknown checks.** Define: if every check is `unknown`, the summary is not "operational" (e.g. "Status unknown"). Open: a mix of up and unknown. Assumption: some up + rest unknown/maintenance stays operational as today (the existing doc comment says unknown does not count as a problem); only the all-unknown (and all-maintenance?) case changes. The plan must decide on maintenance-only and keep existing render tests consistent.
8. **Hidden tabs.** Use `document.visibilityState` / `visibilitychange`: stop the timer when hidden, call `refresh` at once when visible again, avoid double timers (poller `start/stop` is idempotent). Put it in the poller (testable with an injected visibility source) or in `client.js`; a unit test must fail on old code. Decide whether an in-flight request is cancelled when hiding.
9. **Render-error handling.** Wrap `onUpdate` in try/catch with `console.error`; `tick` always reschedules. Also consider `refresh()` called directly (public API). The test: `onUpdate` throws, then the next poll still runs; it fails on the old code.
10. **"Works in a browser".** Precedent in #164: use a headless browser if the repo tooling has one, else document a manual check in the PR. Check that the repo has none before demanding one. Needs a stated approach for cache, hidden tab, and error banner.
11. **Cache and `HEAD`/headers.** Responses to the browser may add `Cache-Control` (e.g. `max-age` equal to the TTL or `no-store`); decide, since a browser HTTP cache interplays with polling freshness. Assumption: `no-store` or short `max-age`, documented.
12. **Tests for cache.** Fake `fetch` call counts, injectable clock (no real sleep), N parallel requests give 1 upstream call per path; after the TTL a new call; error not cached beyond the TTL; allow-list unaffected (existing #164 tests still pass).
13. **Docs.** `docs/operation.md` (caching, freshness display, timeouts), `docs/configuration.md` if new settings, `docs/troubleshooting.md` (error banner/unavailable), `docs/development.md` if files are added, README if it lists settings.

## Assumptions
- Only the `status` target changes; no `dependsOn`, one child issue. Does not depend on other in-flight features; builds on #164 (allow-list/redaction) and must not redo or weaken it.
- Wave 6 accessibility is out of scope; new text keeps `role="status"` semantics already present.
- Non-goal: no new public data; the cache must not weaken redaction (hide/sanitize applies to cached data too).

## Derived acceptance check
With the status server running against a fake API:
1. 20 parallel page loads/polls within one cache period produce at most one upstream call per allow-listed path; after the period the next request calls upstream again; a failing upstream is retried after the period.
2. `/api/incidents?status=resolved` returns only incidents resolved in the last 7 days from the proxy, even if the API returns older ones.
3. Data that makes rendering throw is logged to the console and the next poll still happens (test fails on old code).
4. The page shows "last updated" time; with the API down, the summary is not "All systems operational", and a failed first fetch shows an error, not "Loading…". All-unknown checks do not show "All systems operational".
5. A hanging upstream (headers or body) is aborted by the timeout in proxy and client.
6. A hidden tab makes no requests; becoming visible polls at once.
7. Docs describe cache period, freshness display and timeouts; `npm run check` passes in `status`; manual or headless browser check recorded.
