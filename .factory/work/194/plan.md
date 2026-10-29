# Spec #194: Status poller: failed refresh, timeout default, cache test

## Goal
Fix the review findings of lorenzh/pulse-status#25 (#188): a failed refresh must not leave peer requests uncancellable, the default timeout follows `pollMs`, and the cache test proves caching.

## Scope
Only `status` changes. No contract or API change.

## Non-goals
- No change to the allow-list, redaction, or error text shown to users.
- No change to polling cadence or cache behavior in `server.ts`.

## Required behavior
1. When a refresh fails, the controller aborts all remaining requests of that refresh before the timeout is cleared and `inFlight` is dropped. Hiding the tab (`halt()`) aborts every in-flight request.
2. The first error stays the published error; the abort caused by cleanup must not replace it, and an aborted sibling must not cause an unhandled rejection.
3. Default timeout is `min(pollMs, 4000)`; an explicit `timeoutMs` wins.
4. The cache test shows reuse within the TTL and a new upstream call after it, per path.

## Risks
- Aborting siblings could change the published error: keep the first error.
- `pollMs` <= 0: assume validated positive; check `client.js`/settings.

## Acceptance evidence
`npm run check` passes in `status`, and:
1. Poller test: one of five requests rejects at once, the others hang, tab hidden, all pending signals aborted. Fails on old code.
2. Poller test: `pollMs` 1000 with no `timeoutMs` aborts a hanging request at 1000 ms; `pollMs` 10000 at 4000 ms. Fails on old code.
3. Cache test repeats requests per path within the TTL, asserts one upstream call per path (by URL, queries as separate keys), then a new call per path after the TTL via the injected clock. Fails without the cache.
4. Allow-list and redaction tests unchanged and green.

## Repository: status
Files: `src/poller.ts`, `src/poller.test.ts`, `src/server.cache.test.ts`; `public/client.js` and `docs/operation.md` only if they state the 4000 default or set the timeout.
- `refresh()`: when `load` fails or ends in an error state, call `controller.abort()` before `clearTimeout` and `inFlight = undefined`. Keep the first error as published.
- Replace the constant default by `options.timeoutMs ?? Math.min(options.pollMs, 4000)`; update the doc comment at the option.
- Add the tests listed under acceptance evidence 1-3. Replace the weak "each path has its own cache entry" test.
- Completion evidence: `npm run check` green; new poller tests fail on the old `poller.ts`.
