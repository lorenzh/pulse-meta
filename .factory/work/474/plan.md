# Spec #474: status: cache the filtered proxy response, not only the upstream data

Found in the review of lorenzh/pulse-status#54 (#458). Checked against `main` of pulse-status at
`961a089` (merge of #54). Issue review: `.factory/work/474/issue-review.md`.

## Goal

The status server caches the finished answer of each allow-listed API path: filtered, hidden and
serialized. A cached request costs a map lookup and a validity check, as it did before #54. The
privacy filter of #458 stays as strong as it is now. A cached answer is valid only while every
upstream read it was built from is still the current, unexpired raw cache entry. It is never
served for other visibility settings.

## Current behavior (961a089)

- `cachedRaw(path, ctx)` in `src/server.ts` caches each **unfiltered** upstream read under
  `raw:<path>` in `ctx.cache` for `cacheMs`, single flight, errors included. `cacheMs === 0`
  turns it off. `expiresAt` is `null` while the call is in flight and is set when it ends.
- `proxyAnswer(url, ctx)` builds the answer **on every request** from these reads. It runs
  `filterApiBody`, then `limitResolvedWindow(body, now() - RESOLVED_WINDOW_MS)` for
  `/api/incidents?status=resolved` only. In hidden mode (`!hasChecks && needsComponents`) it runs
  `hiddenAnswer`, which reads `/components` and, only when the components list is non-empty and
  `needsActiveChecks(pathname)`, also `/checks`. Then `hideCheckIds` runs, and `answer()` calls
  `JSON.stringify`.
- `cachedAnswer(path, ctx)` (SSR `renderState`, feed, badges) calls `proxyAnswer` too.
- `ctx.isHidden` and `ctx.hasChecks` are fixed per `createStatusServer` call. `ctx` (and its
  cache map) belongs to one server instance.
- Before #54, the cache held the finished `ProxyAnswer` per `pathname + search`.

## Scope

Target `status` only: `src/server.ts`, a new pure module for the answer cache, tests, a benchmark
script and `docs/operation.md`.

## Non-goals

- No change to `filterApiBody`, `limitResolvedWindow`, `hideCheckIds`, `hiddenCheckKeys`,
  `parseComponentsSnapshot`, `parseActiveCheckIds`, `needsComponents` or `needsActiveChecks`.
  Their output for a given input stays byte-identical.
- No new setting and no runtime settings reload. The answer cache uses `PULSE_STATUS_CACHE_MS`.
- No change to the raw cache's timing (one upstream call per path per period, errors included).
- No change to the allow-list, the `/api/latency` 404 in hidden mode, headers
  (`cache-control: no-store`, wire header) or status codes.
- No HTTP caching for clients (no `ETag`, no `max-age`).
- No other repository.

## Required behavior

1. **Answer cache.** `ProxyContext` gets a second map, `answers`, owned by the instance (never
   module-level). Its key is `${isHidden ? 1 : 0}${hasChecks ? 1 : 0}:${pathname}${search}`.
   The settings stay in the key as defense in depth, even though they are fixed per instance.
   Each entry holds:
   - the answer promise (`Promise<ProxyAnswer>`: status, serialized body, wire header);
   - `deps`: `null` while the build runs. Afterwards it lists every raw cache entry the build
     read, as pairs of key and `CacheEntry` object identity: the own path, plus `/components`
     and `/checks` when they were read.
2. **Recording the inputs.** `rawReader` records the `CacheEntry` object that `cachedRaw`
   returned for each path. `cachedRaw` must expose the entry, for example by returning
   `{ entry, read }` internally. Only paths actually read count as deps. `/checks` is a dep only
   when the build read it, which depends on the data (non-empty components, `needsActiveChecks`).
3. **Lookup.** `proxyAnswer` and `cachedAnswer` both go through the answer cache, so `/api/*`,
   `/`, `/feed.atom` and the badges share one built answer per path. A found entry is used when:
   - `deps === null` (the build is in flight). The request joins the build (single flight).
   - Or, for **every** dep: `ctx.cache.get(dep.key) === dep.entry`, and
     `dep.entry.expiresAt !== null`, and `ctx.now() < dep.entry.expiresAt`.

   In every other case the answer is rebuilt from `cachedRaw` reads. The new entry replaces the
   old one. A rebuilt raw entry (new upstream body) or an expired raw entry of **any** input
   therefore invalidates the answer at once. The answer never outlives the earliest expiry of its
   inputs.

   **No late writer by design.** An entry is replaced only after its build has finished
   (`deps !== null`) and failed the validity check, or deleted after its build rejected
   (rule 4). While a build is in flight, every request for the same key joins it. So two builds
   for one key never run at the same time in production, and a slow build cannot overwrite a
   newer answer. A build that read raw entries which are replaced while it runs (for example
   `/components` refreshed by another path's build) still finishes and is stored with those
   older deps. Its joined callers get that answer, as any request that started before the
   refresh would. The **next lookup** fails the identity check and rebuilds.
4. **Store and rejection.** When a build ends, its `deps` are set only if `answers.get(key)` is
   still this entry. This identity guard is defense in depth: under rule 3 nothing replaces an
   in-flight entry, but the guard keeps a future change (an explicit invalidation, a bypass)
   from storing a finished build over a newer entry. It is tested at module level (Checks). If a
   build rejects (an unexpected throw in the filter or in serialization), its entry is deleted,
   if it is still in the map, before the rejection reaches the caller. A rejected promise is
   never cached. The caller keeps today's 500 path (`logFailure`, generic body).
5. **Errors.** Answers derived from failed reads (upstream error status, `API unreachable`,
   `INVALID_RESPONSE`, `snapshotFailure`, wire mismatch) are cached under the same rule. They
   never outlive the failed raw entry, so the retry once per `cacheMs` stays.
6. **`cacheMs === 0`.** No answer cache: `proxyAnswer` builds from fresh reads on every call, as
   today. The map stays empty.
7. **Resolved window.** The 7-day cutoff of `/api/incidents?status=resolved` is computed with
   `ctx.now()` at build time. It is reused for at most the life of the raw entry (≤ `cacheMs`),
   as before #54. A code comment at the build says so.
8. **Order of checks.** `proxyApi` keeps the hidden `/api/latency` 404, the raw-target check and
   `isAllowedApiPath` in front of the cache. A path that is not allowed never creates an entry.
   The map is bounded by the 9 `ALLOWED_API_PATHS` (one settings pair per instance).
9. **Module.** Put the cache logic (entry type, key, lookup validity, single flight, store on
   finish, delete on reject) in a new pure module `src/answer-cache.ts`. It is generic over the
   build function and the validity check, has no I/O, and receives `now`. It exports the key
   function (`answerKey(settings, pathname, search)`) and takes the `Map` it works on as a
   parameter (the instance's `answers`), so tests can inspect and replace entries. `server.ts`
   wires it to `cachedRaw`. The unit tests count builds through the injected build function.
10. **Docs.** `docs/operation.md`, section Caching: the proxy keeps each unfiltered upstream read
    and also the finished, filtered answer per path and query. The answer is dropped as soon as
    any upstream read it was built from is fetched again or expires, and `PULSE_STATUS_CACHE_MS=0`
    turns both off. The unfiltered read is still never sent to a client. The `cacheMs` comment
    in `ServerOptions` says that it covers both caches.

## Risks

- **Stale privacy filter.** The answer could be served after `/components` changed while the own
  path is still cached, and a check that just became hidden would then show its name. Rule (3)
  covers it through the identity check on every dep. Regression test B below.
- **Data-dependent deps.** `/checks` is read only when components are non-empty. If the
  implementation assumed a fixed dep list, it could miss `/checks` or add a phantom dep. Rule (2)
  records the reads that actually happened.
- **Rejected promise cached forever** (`deps` stays `null`). Rule (4) deletes it.
- **Late writer.** An older build could overwrite a newer entry. Rule (3) rules this out by
  joining in-flight builds; the identity guard of rule (4) is defense in depth.
- **Tests that pass against the wrong code.** Each instance has its own raw map, and a fixed
  clock stores raw entry and answer at the same instant. So some integration tests cannot tell
  a correct cache from a wrong one. The Counterexamples name the setup that makes each test
  discriminate, and where an integration test is only a regression guard, a unit test in
  `src/answer-cache.test.ts` carries the check.
- **Memory.** One string per allowed path, at most 9. This is less than the per-request garbage
  today.

## Performance impact

`bench/` exists in `main` of the api repository, but its `status` budgets only cover the status
service as a whole: `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`,
`test_cpu_s`, `startup_wall_ms`, `image_mb`.

- `load_cpu_s` (status): down when the load hits `/api/*`, `/`, the feed or badges with cached
  upstream data. In the issue's scenario, CPU per cached request goes back to about the pre-#54
  cost (~0.8–1 ms) from ~2–2.6 ms.
- `peak_rss_mib` (status): down or flat. The issue measured 101–114 MiB, back toward 85–91 MiB.
- `test_cpu_s` (status): up slightly, by a few new tests (< 0.1 s).
- `startup_cpu_ms`, `idle_rss_mib`, `startup_wall_ms`, `image_mb`: none expected. Nothing is
  built at startup, and nothing is added to the image except a source file and a bench script.
- p95 latency and rps of the api: none expected. The upstream call count is unchanged.

**Measurement (acceptance gate).** A committed script `bench/proxy-cache.ts` in pulse-status
(not a `*.test.ts`, not run by `bun test` or CI). It takes the server module path as an argument
(`--server <path to src/server.ts>`, default `../src/server.ts`) and loads it with dynamic
import, so the same script runs against the pre-#54 tree. Setup:

- fake upstream through `fetch`: 100 checks; `/uptime` with 90 days of daily history per check;
  `/components` returns `[]`. The old commit does not read it.
- options `showChecks: true`, default `hideDetails`, default `cacheMs` (2000), and
  `now: () => FIXED`, so exactly one upstream `/uptime` call happens for the whole run. The script
  asserts that count and exits non-zero otherwise.
- one warm-up request, then 300 sequential `GET /api/uptime` over HTTP on `127.0.0.1`. Each
  response body is read fully.
- measured over the 300 requests: wall time (`performance.now()` delta), CPU
  (`process.cpuUsage()` delta, user + system, in ms, for the whole process, client included) and
  final RSS (`process.memoryUsage().rss` after the run, in MiB).
- one process per run. Do 5 runs per tree and report the **median** of each metric (the 3rd of
  the 5 sorted values). Round CPU and wall time to whole ms and RSS to 1 MiB.

Baseline: the first parent of `961a089` (`git fetch --deepen=5` or
`git fetch origin 961a089^1` on the shallow clone; `git worktree add /tmp/pre54 961a089^1`;
`bun install --frozen-lockfile` there). Run
`bun bench/proxy-cache.ts --server /tmp/pre54/src/server.ts`, then on the change, on the same
machine in one session. **Gate: median CPU of the change ≤ 1.2 × median CPU of pre-#54.** The PR
shows a table with wall time, CPU and RSS for pre-#54, `961a089` (main) and the change, plus the
issue's numbers for reference. An optional report-only row covers hidden mode with components
(no pre-#54 baseline).

## Security impact

Security impact: yes. The cached body is a privacy-filtered public response. It must never be
served for the wrong settings or for older upstream data.

Checklist items that apply:
- **Secrets in errors, logs and responses:** the unfiltered raw read must never be stored as a
  served answer or sent to a client. The answer cache holds only `ProxyAnswer` values that come
  out of `filterApiBody`/`hiddenAnswer`/`answer()`. A rejected build still answers only the
  generic 500.
- **Input validation:** the allow-list and the raw-target check stay in front of the cache, so no
  key comes from an unchecked request. The map is bounded.
- Not applicable: auth, body limits (unchanged, in `fetchJson`), SSRF and redirects (upstream base
  is fixed), file writes, dependencies, Dockerfile, CI.

Hostile cases for the security state: request order that interleaves hidden and shown instances;
`/components` changing between two requests within one own-path period; a build that throws;
`?status=resolved&x` and other non-allow-listed queries (no entry created); a build whose
`/components` raw entry is refreshed by another path while the build waits on `/checks`.

## Rollout order

One repository: only pulse-status changes. No wire, contract or api change, so any api version
that works today keeps working.

## Counterexamples

- **Own path changes.** A fixed clock does not catch an answer cache with its own TTL: raw entry
  and answer would be stored at the same instant and expire together. The clock must move
  **between the end of the own raw read and the store of the answer**. Setup: hidden mode
  (`showChecks` false), `cacheMs 2000`, mutable `clock = 1000`, path `/api/uptime` (it reads
  `/uptime` and `/components` in parallel). The fake fetch answers `/uptime` at once with body
  A. For `/components` it first waits one macrotask (`await new Promise(r => setTimeout(r, 0))`),
  then sets `clock = 1500` and returns `[]` (no components, so checks are shown by design). So
  the raw `/uptime` entry gets `expiresAt` 3000, raw `/components` 3500, and the answer is
  stored at 1500. Upstream then switches `/uptime` to body B and the clock moves to 3000. The next
  request must serve B (and the `/uptime` fetch count is 2). An answer cache that expires at
  store time + `cacheMs` (3500) wrongly serves A. The test asserts the clock really was 1500
  after the first request, so a change of the read order cannot silently make it pass.
  Module-level twin in `src/answer-cache.test.ts`: the injected build sets the fake clock from
  1000 to 1500 before it resolves and reports a dep that is valid while `now < 3000`; at 3000 the
  lookup must call the build again (count 2).
- **Snapshot changes, own path still cached.** Hidden mode, `cacheMs 2000`. At t=0 a request to
  `/api/components` creates the `/components` raw entry with `[]`. At t=1500 a request to
  `/api/incidents?status=open` creates its own raw entry and reuses `/components` (`[]`, so checks
  are shown by design and `SENTINEL-NAME` is visible). The own entry is still valid at t=2500. At
  t=2500 the `/components` entry has expired, and upstream now returns a component that contains
  `sentinel-id`. The answer must be rebuilt and must contain neither `SENTINEL-NAME` nor
  `sentinel-id`. Deriving expiry from the own path alone would leak.
- **`/checks` as a hidden dep.** Components are non-empty, the path is `/api/incidents`, and
  `/checks` is refreshed with a new active set while `/components` and the own path stay valid.
  The answer must be rebuilt, because a check that is no longer active must lose its `service`
  key. A dep list fixed to own + components is wrong.
- **Settings.** Two instances with the same upstream and clock: hidden (`showChecks` false, with
  components) and shown (`showChecks: true`). Whatever the request order (shown first, then
  hidden, and the reverse), the hidden instance never returns `SENTINEL-NAME` or `sentinel-id`.
  This integration test is a **regression guard** only: each instance has its own raw map, so
  even a shared module-level answer map with a key without settings would rebuild for the other
  instance (`ctx.cache.get(dep.key) !== dep.entry`) and pass. The settings in the key and the
  per-instance map are defense in depth. The discriminating checks are unit tests in
  `src/answer-cache.test.ts`:
  - `answerKey({ isHidden: true, hasChecks: false }, p, s)` differs from
    `answerKey({ isHidden: false, hasChecks: true }, p, s)` for the same path and query, and
    from the other two settings pairs (all four keys distinct);
  - one shared `Map`, a validity check that always returns true, and a build that returns the
    settings it was called with: a lookup with hidden settings, then one with shown settings
    for the same path, must call the build twice and return each caller its own settings'
    answer. A key without settings collides, serves the hidden answer to the shown caller (or
    the reverse), and fails.
- **Join, not late writer.** Under rule (3) a late writer cannot occur, so there is no
  late-writer test against the production path. Instead:
  - Join: hidden mode, the fake `/components` fetch is held on a deferred promise. Request X to
    `/api/uptime` starts; request Y to the same path arrives while X is in flight. Release the
    deferred: both get identical bytes and the build (and each upstream path) ran once. An
    implementation that starts a second build while one is in flight fails the count.
  - Older reads are not reused: hidden mode, `cacheMs 2000`. At t=0 a request to
    `/api/components` creates raw `/components` entry C1 (non-empty, expires 2000). At t=1500
    build X of `/api/incidents` creates its own raw entry (expires 3500), reuses C1, and its
    `/checks` read is held on a deferred. At t=2500 a request to `/api/components` refreshes raw
    `/components` to C2 with a different component list. Then the `/checks` deferred is
    released; X finishes and is stored with dep C1. The next request to `/api/incidents` at
    t=2500 (own entry still valid) must rebuild (`/api/incidents` build count 2, upstream
    `/incidents` count still 1) and its body must follow C2. An implementation that checks only
    the own path's entry fails.
  - Identity guard (module level, defense in depth): in `src/answer-cache.test.ts`, start a
    build on key K whose promise is held; replace `map.get(K)` with a different finished entry E
    directly in the injected map; resolve the build. `map.get(K)` must still be E, and E must be
    what the next lookup returns. Without the guard of rule (4) the test fails.
- **Rejected build.** The build function throws once. The next request must build again (counter
  2) and must not hang or reuse the rejection.
- **`cacheMs 0`.** Two requests mean two upstream calls and two builds.
- **Within a period.** 10 sequential plus 10 parallel requests at a fixed clock give identical
  bytes and exactly one build.
- **Not allowed path.** `/api/incidents?status=resolved&x=1` answers 404 and leaves `answers`
  empty.

The benchmark statistic is defined under Performance impact: 5 runs, median (3rd of 5 sorted) of
the per-run totals over 300 requests. No per-request percentiles.

## Contract fields

No new names in the contract, the config, the wire or the settings. The internal names
(`answers` in `ProxyContext`, module `src/answer-cache.ts`, script `bench/proxy-cache.ts`) are
private to pulse-status. Checks:

- `grep -rn 'answer-cache\|answerCache\|proxy-cache' .repos/contract/src .repos/config/src`
  → no match.
- `ls .repos/status/bench` → does not exist; `ls .repos/status/src/answer-cache.ts` → does not
  exist.

## Repository: status

Files:
- `src/answer-cache.ts` (new): pure answer cache (required behavior 1, 3, 4, 9).
- `src/answer-cache.test.ts` (new): unit tests with an injected build counter and a fake clock.
- `src/server.ts`: `ProxyContext.answers`; `cachedRaw` exposes its `CacheEntry`; `rawReader`
  records deps; `proxyAnswer`/`cachedAnswer` go through the answer cache; `cacheMs === 0` skips
  it; comment on the resolved window; `ServerOptions.cacheMs` comment.
- `src/server.cache.test.ts`: new integration tests (own path change, `cacheMs 0`, reuse within
  the period, join of an in-flight build, not-allowed path).
- `src/server.hidden-checks.test.ts`: new tests (snapshot change while own path is cached;
  `/checks` change; rebuild after `/components` was replaced during a build; two instances
  with different settings, both orders).
- `bench/proxy-cache.ts` (new): benchmark script (Performance impact). It must pass `bun run lint`.
  If the typecheck does not cover `bench/`, keep it type-clean anyway.
- `docs/operation.md`: Caching section (required behavior 10).

Behavior: Required behavior 1–10 above.

Checks:
- Existing tests stay green without weakening any assertion, especially
  `src/server.privacy.test.ts`, `src/server.hidden-checks.test.ts`, `src/server.cache.test.ts`
  ("20 parallel requests share one upstream call", "each path and query is one cache entry",
  "cacheMs 0 turns the cache off", "an upstream error is cached for the period only"),
  `src/server.ssr.test.ts` and `src/server.syndication.test.ts`.
- New tests, one per counterexample above: own path change (with the clock moved between raw
  read and answer store, plus its module twin), snapshot change, `/checks` dep, settings in both
  orders (integration regression guard plus the two discriminating `answer-cache` unit tests),
  join of an in-flight build, rebuild after a dep was replaced during the build, identity guard
  (module level), rejected build, `cacheMs 0`, reuse within a period, not allowed path. Each
  test except the settings integration test must fail against an implementation that ignores
  the dependency it covers; the counterexample names that implementation. The implementer
  checks this by breaking the rule locally once per test (not committed) and notes the result
  in the PR.
- The rejected-build and identity-guard tests live in `src/answer-cache.test.ts`.
- No timing assertions in `bun test`.
- `bun run check` passes.

Completion evidence (in the PR):
- the benchmark table (pre-#54, `961a089`, change; wall, CPU, RSS medians of 5 runs; the issue's
  numbers for reference), with change CPU ≤ 1.2 × pre-#54 CPU from the same machine;
- the exact commands used for both trees;
- `bun run check` output green.
