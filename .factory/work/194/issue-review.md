# Issue review #194

Only `status` changes (`src/poller.ts`, `src/poller.test.ts`, `src/server.cache.test.ts`, maybe `public/client.js`). No contract or API change. Verified against `.repos/status` main.

## Findings checked
1. P2 confirmed: `refresh()` creates one controller per refresh. `load()` uses `Promise.all`, which rejects on the first failing required endpoint (checks, incidents, maintenance). `finally` then clears the timeout and sets `inFlight = undefined` while the sibling requests are still pending. A later `halt()` (tab hidden) finds no controller, so the siblings are not aborted. The same applies to the timeout, which is cleared early.
2. P3 confirmed: `DEFAULT_TIMEOUT_MS` is a constant 4000. The #188 spec says `min(pollMs, 4000)`, but one sentence in it says "use 4000 in `client.js`". The issue sets the rule: `min(pollMs, 4000)`.
3. P3 confirmed: "each path has its own cache entry" in `src/server.cache.test.ts` requests each path once and would pass without a cache. The TTL test only covers `/api/checks`.

## Assumptions
- Fix for 1: in `refresh()`, abort the controller when `load` fails or ends in an error state, before clearing the timeout and dropping `inFlight`. Aborting after success is harmless but not needed. The optional endpoints (uptime, resolved) swallow errors, so aborting them is fine too. An abort caused by this cleanup must not change the published error text (the first error stays). A late rejection of an aborted sibling must not become an unhandled rejection. `Promise.all` already handles this.
- Alternative (equivalent): keep the controller in `inFlight` until all five settle (`allSettled`). The issue says "aborted before the controller is dropped", so use abort.
- Fix for 2: apply `min(options.pollMs, 4000)` when `timeoutMs` is not given. An explicit `timeoutMs` wins. `client.js` passes no `timeoutMs`, so it gets the new default. Whether `pollMs` <= 0 can occur is not covered; assume `pollMs` is validated positive. Check `client.js` for how it sets `pollMs`.
- Fix for 3: the cache test requests each path (for example `/api/checks`, `/api/uptime`, `/api/incidents?status=open`) several times within the TTL and asserts one upstream call per path (by URL). It then advances the injected clock past the TTL and asserts one new call per path. Paths with different queries are separate keys, and the test should show that. It should fail without caching (`cacheMs: 0` or a stub).
- Tests must fail on old code: P2 (one endpoint rejects at once, the others hang, then hide via the visibility stub, and every pending signal is aborted) and P3 timeout (`pollMs` 1000, assert the timer is set with 1000, or that a hanging request aborts at 1000 ms with fake timers).

## Open points (not blocking)
- Should the failed refresh also abort when only the timeout fires? That already aborts all, so no change.
- Docs: `docs/operation.md` may state the timeout default. Update it to `min(pollMs, 4000)` if it says 4000.

## Acceptance check
In `status`, `npm run check` passes, and:
1. New poller test: one of the five requests rejects at once, the others hang, the tab is hidden, and all pending request signals are aborted. It fails on old code.
2. New poller test: with `pollMs` 1000 and no `timeoutMs`, a hanging request is aborted at 1000 ms (and with `pollMs` 10000 at 4000 ms). It fails on old code.
3. The cache test repeats requests within the TTL with one upstream call per path, and a new call per path after the TTL. It fails if the cache is removed.
4. The allow-list and redaction tests are unchanged and green.
