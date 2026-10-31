# Issue review: #474, status: cache the filtered proxy response, not only the upstream data

Target: `status` only. Checked against `main` of pulse-status at `961a089` (merge of #54 / #458).

## Verified current behavior

- `src/server.ts` `cachedRaw` caches the **unfiltered** upstream read per upstream path (`raw:<path>`) for `cacheMs`, single flight, errors included. `cacheMs === 0` turns it off.
- `proxyAnswer` builds the served answer **on every request** from these raw reads:
  1. `filterApiBody(pathname, own.value, isHidden, hasChecks)`;
  2. `limitResolvedWindow(body, now() - RESOLVED_WINDOW_MS)` for `/api/incidents?status=resolved` only. This step depends on the clock, not only on the upstream data;
  3. in hidden mode (`!hasChecks` and `needsComponents(pathname)`): `hiddenAnswer` reads `/components` and, for `/api/incidents` and `/api/maintenance`, also `/checks`. It then runs `hideCheckIds`;
  4. `JSON.stringify` in `answer()`.
- `cachedAnswer(path)` (used by SSR `renderState` and by `createSyndication` for feed and badges) also calls `proxyAnswer`, so `/`, `/feed.atom` and the badges pay the same cost on every request.
- Before #54 (diff of PR lorenzh/pulse-status#54), the cache held the finished `ProxyAnswer` (filtered and serialized) per `pathname + search`. The resolved window was computed once when the answer was fetched, then reused for `cacheMs`. #54 moved the cache to the raw reads because the hidden answer depends on more than one upstream read.
- The set of keys is bounded: `ALLOWED_API_PATHS` is a fixed list of 9 path+query strings. SSR and syndication read only paths from that list. The upstream reads are `/<path>`, `/components` and `/checks`.
- Visibility settings (`hideDetails` → `ctx.isHidden`, `showChecks` → `ctx.hasChecks`) are read once from the environment at start (`settings.ts`) and are fixed for the `ProxyContext` of one server instance. Nothing reloads them at runtime. The cache map lives in that `ctx`, so it is already per server instance.
- `docs/operation.md` (Caching section, ~104) says that the proxy keeps each upstream read and "builds every answer from it". This text must change with the feature.
- There is no benchmark script in the repository. The reviewer's script behind the issue table was not published (not in the PR #54 reviews or comments).

## Open points (non-blocking, for the plan)

1. **One answer, several upstream entries.** The issue says to invalidate the answer "together with the upstream cache entry". In hidden mode, one answer depends on up to three raw entries (own path, `/components`, `/checks`), and each expires on its own schedule. The cached answer must be valid only while **every** raw read it was built from is still the current, unexpired entry. For example: store references to those raw entries or promises with the answer and compare their identity on lookup, or expire the answer at the earliest expiry of its inputs **and** drop it when any input is fetched again. The plan picks the mechanism. A cached answer must never be served after a newer raw read of any of its inputs exists.
2. **Races.** A request that started on older raw reads can finish after a newer raw entry has been set. It must not store its answer over the answer built from the newer reads (or it must store it under the identity of its inputs so that it never matches). Concurrent requests for the same answer should share one build (single flight, like `cachedRaw`), or at least never serve a mixed or stale result.
3. **Clock dependency of `/api/incidents?status=resolved`.** A cached answer freezes the 7-day window for at most the life of its raw inputs (≤ `cacheMs`). This is the same as before #54 and negligible against 7 days. Assumption: accepted, and documented in the code comment. The alternative (rebuild only this route) is allowed but not required.
4. **Settings in the key.** Settings cannot change at runtime. The issue's "settings change" means another server instance (or a restart) with other settings. Assumption: the answer cache stays in the per-instance `ctx` (never module-level), and the key includes `isHidden` and `hasChecks` anyway, as defense in depth. No runtime settings reload is introduced.
5. **`cacheMs === 0`.** The raw cache is off, so the answer cache must also be off: every request builds its answer from fresh reads, as today. Keep the existing "cacheMs 0 turns the cache off" test green.
6. **Error answers.** Answers derived from failed reads (own error, `snapshotFailure`, `INVALID_RESPONSE`) may be cached under the same validity rule. They must never outlive the failed raw entry, because the docs promise a retry once per `cacheMs`.
7. **Where to cache.** Cache the `ProxyAnswer` (status, serialized body, wire header) at the `proxyAnswer`/`cachedAnswer` level, so that SSR, feed and badges get the gain too. The `/api/latency` 404 in hidden mode and the allow-list check in `proxyApi` stay in front of the cache, unchanged.
8. **Memory.** At most one answer string per allow-listed path (9). This replaces the per-request objects and strings, so the final RSS should fall. Report it in the PR table, but it is not an acceptance gate.
9. **Benchmark reproduction.** The reviewer's script is not available, so the implementer writes one that matches the issue:
   - fake upstream: 100 checks and 90 days of `/api/uptime` history;
   - shown mode (assumed `showChecks: true`; `hideDetails` default `true`), fixed `now` clock, default `cacheMs` (one upstream call for the whole run);
   - 300 requests to `/api/uptime`, wall time, CPU (`process.cpuUsage`) and final RSS.

   It runs on the pre-#54 commit (first parent of `961a089`; the clone is shallow, so fetch it) and on the change, on the same machine in one session. The table in the PR shows both and the issue's numbers for reference. The acceptance compares the **same-machine** pre-#54 CPU, not the absolute numbers in the issue. Optional extra row: hidden mode with components (no pre-#54 baseline, report only). Whether the script is committed (for example under `bench/`, not part of `bun test` or CI) is the plan's choice. Timing assertions must not go into the test suite.
10. **Docs.** Update `docs/operation.md` Caching (and the comment on `cacheMs` in `ServerOptions` if needed). The text must say that the filtered answer is cached per path and dropped together with its upstream reads, and that the unfiltered read is still never sent to a client.

## Assumptions

- "Shown mode" in the issue means `PULSE_STATUS_SHOW_CHECKS=true` (no `/components` read), with default `hideDetails`.
- Settings are fixed per server instance. A "settings change" is tested with two instances that have different settings and the same upstream, plus the key containing the settings.
- The privacy filter functions (`filterApiBody`, `hideCheckIds`, `hiddenCheckKeys`, `limitResolvedWindow`) do not change behavior. Only the point where their result is stored changes.
- No new runtime dependency and no new setting (the answer cache uses `PULSE_STATUS_CACHE_MS`).
- No other target is affected.

## Derived acceptance check

1. **Performance (PR table):** the benchmark from open point 9, run on pre-#54 and on the change on the same machine, shows CPU for 300 cached `/api/uptime` requests (100 checks, 90 days, shown mode, fixed clock, one upstream call) **≤ 1.2× the pre-#54 CPU**. The table also lists wall time and final RSS.
2. **Privacy unchanged:** `src/server.privacy.test.ts`, `src/server.hidden-checks.test.ts` and the other existing tests pass without weakening any assertion.
3. **New regression tests (in `bun test`), each fails if the answer cache ignores the dependency:**
   - new upstream body for the own path after the raw entry expires (clock moved past `cacheMs`) → the next response has the new filtered body, not the old one;
   - hidden mode with components: `/components` (and, for `/api/incidents` or `/api/maintenance`, `/checks`) changes upstream and is read again while the own path's raw entry is still valid → the answer is rebuilt from the new snapshot. A check that becomes hidden never appears with the old filtering;
   - two server instances with different `hideDetails`/`showChecks` against the same upstream and clock → each serves its own filtered body (sentinel style: no `SENTINEL-NAME`/`sentinel-id` in the hidden instance), whatever the request order;
   - repeated requests within one cache period return the same bytes and build the answer once (for example, a spy or counter shows that the filter or serialization does not run again);
   - `cacheMs: 0` → no answer reuse.
4. **Docs:** `docs/operation.md` Caching describes the answer cache. `bun test`, lint and typecheck pass (CI green).
