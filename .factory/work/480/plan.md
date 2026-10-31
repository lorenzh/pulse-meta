# Spec #480: status: Cache-Control and ETag for page, feed, badges and API answers

Target: `status` only. Checked against `main` of `lorenzh/pulse-status` (the tree in `.repos/status`, which includes the #474/#476 answer cache `src/answer-cache.ts`). The issue review is `.factory/work/480/issue-review.md`. This spec resolves its open points 1-12 and keeps assumptions A1-A7 unless a section below says otherwise.

## Goal

Feed and badges become cheap to re-fetch: a short public `max-age` plus a strong `ETag`, and `304 Not Modified` for an unchanged body. Proxied `/api/*` answers get `no-cache` plus an `ETag`, so the page poller revalidates every time and gets `304` when nothing changed. The HTML page gets `no-cache`. No cache, shared or private, ever holds or validates a body that the privacy settings (`PULSE_STATUS_HIDE_DETAILS`, `PULSE_STATUS_SHOW_CHECKS`) would filter. Every tag is computed from the filtered body actually sent, plus the visibility settings.

## Current behavior (checked on status `main`)

- `src/server.ts` `proxyApi`: every `/api/*` answer, success and error, sends `content-type: application/json` and `cache-control: no-store`, and the wire header when it is known. There is no ETag. Rejected paths answer `404` through kit `sendJson`, which sends no cache header. `src/server.cache.test.ts:54` asserts `no-store`.
- `ProxyAnswer { status, body, wireVersion? }` is built in `fetchRaw` (upstream errors: `answer(status, {error:"API error"})`; a version mismatch is `answer(200, {error:"API version mismatch"})`; `502` for an invalid or unreachable upstream), in `snapshotFailure` (`502`), in `hiddenAnswer` and in `buildAnswer` (success `200`). The #474 cache (`cachedAnswerFor`, key `answerKey(settings, pathname, search)` with the prefix `<isHidden><hasChecks>:`) stores these answers per server instance (`ctx.answers`, created inside `createStatusServer`).
- `src/syndication.ts`: `200` answers of `/feed.atom`, `/badge/<id>.svg` and `/badge/component/<id>.svg` send `cache-control: public, max-age=N`. `N = max(1, ceil(max(cacheMs, pollMs)/1000))` is computed in `server.ts` and is 5 with the defaults. `src/server.syndication.test.ts` asserts it at lines 84 and 140, and `max-age=30` at line 231. The `400`/`404`/`503` answers (`sendText`) send `no-store`. Bodies are rebuilt on every request from `cachedAnswer` reads. `createSyndication` returns `(url, res) => Promise<boolean>` and never sees the request headers.
- The feed body has no clock in it: the feed-level `<updated>` is the newest entry's time, or a constant for an empty feed (`feed.ts:166`). Badges have no time either. An unchanged upstream state therefore gives identical bytes, so ETags are useful.
- `/` and `/index.html` send no `cache-control`. Of the static routes, only the fonts send `public, max-age=31536000, immutable` (`server.test.ts:290`). The others send no cache header.
- The server reads no request header except the method and URL. There is no compression, no content negotiation, no cookies and no auth. Feed links come from `PULSE_STATUS_PUBLIC_URL`, never from `Host`.
- `HEAD` is allowed on every route. Node's `http` server drops the body of a `HEAD` response and of a `304` response on its own.
- `metrics.recordHttp(res.statusCode)` counts each status code, so `304`s show up in `/metrics` without changes.

## Scope

- `status`: new `src/http-cache.ts` (ETag computation and `If-None-Match` matching), ETag/304 for feed, badges and successful `/api/*` answers, `no-cache` on the page, `no-store` kept or made explicit on every error answer, tests, the bench script, and docs.

## Non-goals

- No CDN or reverse-proxy configuration shipped. No caching in pulse-api. No change to poll intervals or to the browser poller (`src/poller.ts`). Browsers revalidate `no-cache` answers on their own (A7).
- No ETag on the HTML page: it embeds the render time and server-rendered state.
- No new cache headers on static routes. Only the fonts keep `immutable`. `page.css`, `theme-init.js`, `theme.css`, `client.js`, the transpiled modules, `/pulse-contract/*`, `/pulse-kit/*` and `/logo` stay as they are (their URLs are not content-hashed, so `immutable` would be wrong).
- No `Last-Modified` / `If-Modified-Since`.
- No change to pulse-api's bench (`bench/` in api).

## Decisions (resolving the review's open points)

1. **Max-age of feed and badges: a fixed `60` seconds.** It no longer depends on `POLL_MS`/`PULSE_STATUS_CACHE_MS`. Why 60: README badges are fetched through code-host image proxies, and feed readers poll every few minutes at most, so a stale view of up to one minute is acceptable for both. It is 12× the default poll period, so shared caches absorb most repeats, and the `304` path handles the rest. A longer value (120) would show a recovered check as down for up to 2 minutes in READMEs. A shorter one (30) roughly halves the benefit for proxies that do not revalidate. It is a module constant `SYNDICATION_MAX_AGE_SECONDS = 60` in `src/syndication.ts`, not an environment setting. The `maxAgeSeconds` option of `createSyndication` and its derivation in `server.ts` are removed. The three existing assertions (`max-age=5` ×2, `max-age=30`) change to `max-age=60`. The test "badge: max-age follows the larger of cache and poll time" is replaced by "badge: max-age is 60 s regardless of cache and poll time" (with `cacheMs: 30000` it still answers `max-age=60`).
2. **ETag input = settings fingerprint + exact body.** `etagFor(settings, body)` returns `"` + base64url(SHA-256(`<isHidden 0|1><hasChecks 0|1>` + `"\n"` + body bytes as UTF-8)) truncated to the first 27 characters + `"`. 27 base64url characters are 162 bits. The result is a strong tag of the form `"[A-Za-z0-9_-]{27}"`. The fingerprint is the same `isHidden`/`hasChecks` pair that prefixes `answerKey`. Same tag means same settings and same bytes, so it is a valid strong validator, and two visibility configurations never share a tag (A2). The hash uses `node:crypto` `createHash("sha256")`. No new dependency.
3. **Cacheability marker on `ProxyAnswer`.** Add the optional field `etag?: string`. It is set only by the success paths that return a filtered `200` built from successful upstream reads: the `answer(200, body, own.wireHeader)` returns in `buildAnswer` and in `hiddenAnswer` (`components.length === 0` and the hidden success). Use a helper `okAnswer(body, wireHeader, ctx)` that serializes once and hashes that exact string. It is never set by `fetchRaw` (upstream 4xx/5xx passthrough, version mismatch `200`, `502`s), by `snapshotFailure`, or by any `answer(502, INVALID_RESPONSE, …)`. "Has an `etag`" is the only test for "cacheable". The status code is never used for it, so the version-mismatch `200` stays `no-store`.
4. **`If-None-Match` matching** (`ifNoneMatchHits(header: string | undefined, etag: string): boolean` in `src/http-cache.ts`), following the weak comparison of RFC 9110 §13.1.2:
   - `undefined` or empty means no match.
   - Trimmed `*` matches (there is a current representation whenever we have an `etag`).
   - Otherwise split on `,` and trim each member. Strip one leading `W/` (case-sensitive, as in the RFC). The rest must be a quoted opaque tag `"…"` with no `"` inside, and it matches when it equals `etag` exactly. Members that are not well formed are skipped. They do not invalidate the other members.
   - A header longer than 8192 characters is treated as no match (full `200`) and not parsed. Node already caps all headers at 16 KiB.
   - A mismatch, a malformed header or an unknown tag always gives the full `200` with the current tag. It is never an error status.
5. **Headers on `304`.** `etag`, `cache-control` (the same value as the `200`), the wire header for `/api/*` when the answer has one, and the badge `content-security-policy` for badges. The global security headers stay as they are. No `content-type`, no `content-length`, no body. `res.writeHead(304, headers).end()`.
6. **`HEAD`** follows the same path as `GET`: the same `cache-control`/`etag` headers, and `304` on a match. Node drops the body.
7. **Where the hash lives.** For `/api/*`, the tag is computed once inside the build and stored on the `ProxyAnswer` held by the #474 entry. It is reused for every request while that entry lives. With `PULSE_STATUS_CACHE_MS=0` it is hashed on each build, which is acceptable. The feed and badges hash their rendered body on each `200`/`304` decision. The bodies are a few KiB, a SHA-256 of them takes microseconds, and they are already rebuilt on every request today. The bench (below) must show that the CPU is not worse. Memoizing rendered bodies is out of scope.
8. **Static assets:** unchanged (see Non-goals).
9. **Bench:** the #377 fixed load sends no client requests to status, so the 304 share comes from the status repo's own bench (A5). See Performance impact.
10. **Mutation evidence** targets the ETag/304 logic, the settings in the tag input, and the max-age constant. `public, max-age` already passes on `main`.
11. **`Vary`:** none is sent. No response body depends on a request header. `If-None-Match` only chooses between `200` and `304` of the same representation, and conditional headers need no `Vary` (RFC 9110 §12.5.5). The docs state this, so that a later compression or negotiation change knows it must add `Vary`.
12. **Feed `lastManual`:** unchanged. The tag is over the body actually sent, including a kept manual list. `lastManual.list` is updated before the `200`/`304` decision, exactly as today.
13. **Settings change and restart.** Settings are read once in `createStatusServer`. A restart builds a new server with an empty `ctx.answers` map (#474: never module-level), so no answer of the old settings survives. A changed `isHidden`/`hasChecks` changes every tag through the fingerprint, even where the body bytes happen to be equal. Other settings (name, theme, public URL) change tags only through the body. That is correct, because they are not privacy filters and the bytes are the identity.
14. **Error answers on the proxy:** the proxy `404` from `sendJson` gets an explicit `cache-control: no-store` (fourth argument of kit `sendJson`). The generic `404`/`500`/`405` of `handle` stay unchanged (out of scope, and none of them carries data).

## Required behavior

Per route (the table goes into `docs/operation.md` in the same form):

| Route | Status | `cache-control` | `etag` | `If-None-Match` hit |
|---|---|---|---|---|
| `/feed.atom` | 200 | `public, max-age=60` | yes | `304` |
| `/feed.atom` | 503 | `no-store` | no | n/a |
| `/badge/<id>.svg`, `/badge/component/<id>.svg` | 200 | `public, max-age=60` | yes | `304` |
| badges | 400, 404, 503 | `no-store` | no | n/a |
| `/api/*` (allow-listed) | 200 with a filtered body | `no-cache` | yes | `304` |
| `/api/*` | upstream 4xx/5xx passthrough, 502, version-mismatch 200 | `no-store` | no | never `304` |
| `/api/*` (rejected path) | 404 | `no-store` | no | n/a |
| `/`, `/index.html` | 200 | `no-cache` | no | n/a (always `200`) |
| `/fonts/*.woff2` | 200 | `public, max-age=31536000, immutable` (unchanged) | no | n/a |
| other static routes, `/logo`, `/healthz`, `/readyz`, `/metrics` | unchanged | unchanged | no | n/a |

- `If-None-Match` is evaluated only for answers that have a tag, after the body has been built (so the upstream reads and the `lastManual` update happen exactly as for a `200`). On a hit: `304` with the headers of decision 5. Otherwise: `200` with the body and the `etag`.
- The same upstream state and settings give the same tag across requests and across server instances. A changed upstream state that changes the filtered body gives a new tag. For the feed and badges, the change becomes visible once the #474 entry expires (`PULSE_STATUS_CACHE_MS`).
- Privacy:
  - Every tag is `etagFor(settings, filteredBody)` of the bytes in the `200` body. No code path hashes a raw upstream read (`RawRead.value`) or an upstream body.
  - Nothing that is `public` depends on request data other than the URL (path and query: the badge `?label=` is part of the URL and therefore of every cache key).
  - `/api/*` is never `public` and never has a `max-age`.
- `SYNDICATION_MAX_AGE_SECONDS` is exported from `src/syndication.ts` for tests. `etagFor` and `ifNoneMatchHits` are exported from `src/http-cache.ts`.
- `createSyndication` returns `(url, req, res) => Promise<boolean>` (or takes the `if-none-match` header value as a parameter), so it can read `if-none-match`. `serveGenerated` passes `req`.

## Performance impact

Metrics of `bench/budgets.json` (api repo, `status` block) that the change can move:

- `load_cpu_s` (gating, budget 0.5 s): **none expected** (±0). The #377 fixed load sends no client requests to status. Status CPU in that window is its own idle work, and this change adds work only per client request. Startup `startup_cpu_ms`, `idle_rss_mib`, `peak_rss_mib`: none expected (one extra module, `node:crypto` is built in). `test_cpu_s`: up by well under 0.1 s from the new tests. `image_mb`, `startup_wall_ms`: none.
- How to confirm: the nightly bench (or `bun bench/run.ts --a <api sha> --b <api sha> --others-ref <status branch sha>` in api, compared with `--others-ref main`) shows status `load_cpu_s` within its threshold. The implementer does not need this locally. The PR states that the fixed load has no status client traffic.
- Measured in the status repo: extend `bench/proxy-cache.ts` with a `--conditional` mode (or add `bench/conditional.ts` next to it, same style). It sends a fixed load of 300 requests each to `/api/checks`, `/feed.atom` and `/badge/check-0.svg` against a constant upstream. Each route first gets one plain request; every later request sends the last seen `etag` as `If-None-Match`. It prints JSON with `requests`, `cpuMs`, `wallMs`, `rssMib` and `share304` per route and in total (share304 = 304 answers ÷ requests of the measured loop, as a percentage rounded to one decimal). Run it A/B: `bun bench/conditional.ts --server <main tree>/src/server.ts` against the branch, 5 runs each, median of `cpuMs`. Expected: `share304` = 100.0 on the branch and 0.0 on main; `cpuMs` on the branch ≤ main (304s write no body). The PR pastes both outputs. The existing `bench/proxy-cache.ts` default mode (300 unconditional `GET /api/uptime`) must not get worse by more than 10 % median CPU (one hash per #474 entry, not per request).

## Security impact

Security impact: yes
The change controls what shared caches (code-host image proxies, reverse proxies) may store and validate for privacy-filtered data. It also parses a new request header (`If-None-Match`) at the public trust boundary.

Checklist items that apply:
- **Secrets in errors, logs and responses:** tags must never be derived from unfiltered upstream data (a tag of a raw body would be an oracle: a client could confirm a guessed hidden value by replaying a tag). Error answers carry no tag and are `no-store`. Covered by the privacy sentinel test.
- **Input validation / body and size limits:** `If-None-Match` parsing is total. It never throws, it caps at 8192 characters, it skips malformed members, and a malformed header gives `200` and never `4xx`/`5xx`. The hostile inputs are listed under Counterexamples.
- **Auth order and status codes:** no auth exists. `304` is sent only where a `200` with the same tag would be sent. Error paths never become `304`.
- Not applicable: SSRF and redirects, file writes, dependency pins (no new dependency), Dockerfiles, CI, accessor execution.

Residual risk, documented in `docs/operation.md`: after an operator *tightens* the settings (for example `PULSE_STATUS_HIDE_DETAILS` from `false` to `true`, or `PULSE_STATUS_SHOW_CHECKS` from `true` to `false`) and restarts, shared caches may still serve the old, less filtered feed or badge for up to 60 s (`max-age`). `/api/*` is revalidated at once, and the new fingerprint makes the old tag miss. The docs tell operators to purge their reverse-proxy cache for `/feed.atom` and `/badge/*` after tightening, or to wait 60 s.

## Rollout order

One repository: only `status` changes. It needs no new field from contract, kit or config (kit `sendJson` already takes extra headers at the pinned SHA `fa79ba8`). It keeps working against every api version it supports today, because nothing upstream-facing changes. Browsers on an old page build simply revalidate the new `no-cache` answers. Clients that never send `If-None-Match` get the same `200` bodies as before.

## Counterexamples

Each must be handled as stated. A wrong implementation would get them wrong:

- **Version mismatch is `200`:** the upstream sends a different wire header, and the proxy answers `200 {"error":"API version mismatch"}`. It must be `no-store` with no `etag`, and `If-None-Match: *` must still give `200`, not `304`. An implementation keyed on `status === 200` fails this.
- **Upstream `500` passthrough** (`500 {"error":"API error"}`) and **`502` API unreachable**: `no-store`, no `etag`, never `304` (even with `If-None-Match: *`).
- **Snapshot failure** with checks hidden: `/components` fails, so `/api/checks` answers `502`. It must be `no-store` with no tag, although the own read succeeded. Hashing the own read here would leak.
- **Same bytes, different settings:** no components are configured, so hiding checks changes nothing and the `/api/checks` bodies are byte-equal. The tags must still differ between `showChecks: true` and `false`. A pure body hash fails this.
- **Replay across settings:** a tag taken from a shown-checks server, sent to a hidden-checks server with the same upstream state, gives `200` (never `304`).
- **Tag of the raw body:** the test computes `etagFor(s, rawUpstreamBody)` for all four fingerprints `s`. None may equal any served tag, and replaying each gives `200`.
- **Upstream change:** the check `web` goes from `up` to `down`. After `PULSE_STATUS_CACHE_MS` has passed, the old feed and badge tags give `200` with a new tag, and the new tag then gives `304`.
- **Weak form:** `If-None-Match: W/"<tag body>"` (what nginx gzip produces) gives `304`.
- **List:** `If-None-Match: "nope", W/"x", <tag>` gives `304`. `If-None-Match: "nope"` gives `200`.
- **Malformed members:** `If-None-Match: <tag without quotes>`, `""`, `W/`, `"a"b"`, `,,,`, `w/"<tag>"` (lower-case `w/` is not the weak prefix and stays unmatched) all give `200`, never `400`/`500`. `If-None-Match: garbage, <tag>` gives `304` (a bad member is skipped).
- **Oversized:** an 8193-character header that contains the tag gives `200`.
- **`HEAD` with a matching tag:** `304`, with the same headers and no body.
- **Badge with `?label=`:** `/badge/web.svg?label=A` and `?label=B` have different bodies and different tags. The tag of one sent to the other gives `200`.
- **Badge `404` for an unknown id or a hidden check:** `no-store`, no tag, and `If-None-Match: *` still gives `404`.
- **Feed `503`** (one read fails): `no-store`, no tag. A stale tag from an earlier `200` gives `503`, not `304`.
- **Page:** `/` with any `If-None-Match` always gives `200` with `no-cache` and no `etag`.
- **Statistic `share304`:** the window is the measured loop only (excluding the first plain request per route). The sample set is all requests of that loop per route. The value is `count(status === 304) / count(requests) × 100`, rounded half-up to one decimal. The total is computed from the summed counts, never by averaging the per-route percentages. `cpuMs` per run is `process.cpuUsage` user+system over the loop, rounded to ms. A/B compares the median of 5 runs.

## Contract fields

No contract or config names change. New names exist only inside status. Searches in the clones:

- `grep -rni 'etagFor\|ifNoneMatchHits\|SYNDICATION_MAX_AGE\|okAnswer' .repos/contract/src .repos/config/src .repos/kit/src`: no hits.
- `grep -rni 'if-none-match' .repos/contract/src .repos/config/src .repos/kit/src`: no hits.
- `grep -rni 'etag' .repos/contract/src`: only `ADMIN_ETAG_HEADER = "etag"` and its docs in `admin.ts` (the admin config revision of pulse-api). The status proxy does not forward or use it. The new `ProxyAnswer.etag` field is private to `status/src/server.ts`. No collision.
- New HTTP header values only: `etag` (response), `if-none-match` (request), `cache-control: no-cache` / `public, max-age=60`. No new route, environment variable or JSON key.

## Repository: status

Files:
- `src/http-cache.ts` (new): `etagFor(settings: AnswerSettings, body: string): string` and `ifNoneMatchHits(header: string | undefined, etag: string): boolean`, as in decisions 2 and 4.
- `src/http-cache.test.ts` (new): unit tests for both functions (every Counterexamples item about tag format, weak, list, malformed and oversized input, and fingerprint separation).
- `src/server.ts`: `ProxyAnswer.etag?`. An `okAnswer` helper on the success paths of `buildAnswer`/`hiddenAnswer`. `proxyApi` sends `no-cache` + `etag` and answers `304` on a hit for tagged answers, and `no-store` for all others. The proxy `404` gets `no-store`. `/` and `/index.html` get `cache-control: no-cache`. The `maxAgeSeconds` derivation is removed. The settings fingerprint is passed to syndication. `serveGenerated` passes `req` to syndication.
- `src/syndication.ts`: `SYNDICATION_MAX_AGE_SECONDS = 60` (exported). Options take `settings: AnswerSettings` (for `etagFor`) instead of `maxAgeSeconds`. Feed and both badge `200` paths compute the tag of the rendered body and answer `304` on a hit (headers of decision 5). `sendText` paths are unchanged (`no-store`, no tag). The handler signature gains the request (or its `if-none-match` value).
- `src/server.syndication.test.ts`: max-age assertions changed to 60, the derived-max-age test replaced. New tests: feed, check badge and component badge carry `public, max-age=60` + a strong tag. A repeat with the tag (plain, `W/`, in a list) gives `304` with an empty body and the same tag. `HEAD` gives the same. After an upstream state change and the cache period (`now` advanced past `cacheMs`), the old tag gives `200` with a new tag. `400`/`404`/`503` have `no-store`, no tag and no `304` with `*`.
- `src/server.cache.test.ts`: the `/api/*` header assertion changes from `no-store` to `no-cache` + tag for a `200`. New tests: `/api/checks` gives `no-cache` + `etag`. The matching `If-None-Match` gives `304`, empty body, the same tag and the wire header. An upstream `500`, a `502` (network failure) and a version mismatch give `no-store`, no tag and no `304` with `*`. The proxy `404` gives `no-store`. One build means one hash: two requests within the cache period give equal tags with one upstream call.
- `src/server.privacy.test.ts` (or `src/server.hidden-checks.test.ts`): the sentinel test (see the evidence below).
- `src/server.test.ts`: `/` and `/index.html` send `no-cache` and no `etag`, and `If-None-Match` gives `200`. Fonts are still `immutable`. `page.css`, `client.js` and `theme.css` still have no `cache-control`.
- `bench/conditional.ts` (new), or a `--conditional` mode in `bench/proxy-cache.ts`: as in Performance impact.
- `docs/operation.md`: under "Feed and badges", replace the derived `max-age=N` sentence. Rewrite "Caching": remove "Answers carry `cache-control: no-store`" and add the per-route table above. Add reverse-proxy guidance: `public, max-age=60` may be stored by shared caches. `no-cache` may be stored but must be revalidated each time. `no-store` must never be stored. Pass `If-None-Match` through to status and do not strip `ETag`. A compressing proxy may turn the tag into `W/"…"`, which status still matches. Status sends no `Vary` because no answer depends on a request header (a future compression or negotiation layer must add it). Purge `/feed.atom` and `/badge/*` after tightening the privacy settings, or wait 60 s.
- `README.md`: only if it repeats the old `no-store` or max-age sentence. Check it with `grep -n 'no-store\|max-age' README.md docs/*.md` and fix every hit that describes the routes above.

Behavior and checks: everything under Required behavior and Counterexamples. Follow `AGENTS.md` of status (Bun, biome, eslint, typecheck). No new runtime dependency (`node:crypto` is built in).

Completion evidence (in the PR):
1. `bun run check` and CI are green.
2. **Regression tests (feed, badges):** `public, max-age=60` + `etag`. The `If-None-Match` repeat gives `304` with an empty body. After the upstream change the old tag gives `200` with a new tag.
3. **Regression tests (`/api/checks`):** `no-cache` + `etag`, a matching tag gives `304`. A `502` from upstream has `no-store` and no tag. A version mismatch has `no-store`.
4. **Privacy sentinel test:** an upstream fixture with sentinel strings in every field that the filters remove (check `url`/`host`/`keyword`/`lastReason`, incident `reason`, the ids and names of hidden checks). Components are configured, checks hidden, details hidden. For every allow-listed `/api/*` path, `/feed.atom`, the check badge of a hidden check, the component badge and `/`, every `200` or `304` answer has no sentinel in its body. Its `etag` (if any) equals `etagFor(hiddenSettings, servedBody)` and differs from `etagFor(s, rawUpstreamBody)` for all four `s`. The `/api/checks` tag of the hidden server differs from the tag of a shown-checks server on the same upstream state. Replaying the shown tag and every raw-body tag at the hidden server gives `200`. A new server instance with changed settings (simulating a restart) gives different tags for every tagged route.
5. **Mutation output** (the commands and the failing test names pasted): (a) `ifNoneMatchHits` always returns `false` fails the `304` tests. (b) `etagFor` drops the settings fingerprint, which fails the hidden-vs-shown and same-bytes tests. (c) `etag` set on every `ProxyAnswer` (also errors) fails the version-mismatch/`502` tests. (d) `SYNDICATION_MAX_AGE_SECONDS` set back to the derived value fails the max-age tests. (e) Hashing the raw upstream body instead of the filtered one fails the sentinel test. The new tests also fail on unmodified `main` (show that run).
6. **Bench:** `bench/conditional.ts` output for main and branch (5 runs, median `cpuMs`, `share304` per route and total), and `bench/proxy-cache.ts` default mode before and after. The PR also states that the #377 fixed load has no status client traffic, so status `load_cpu_s` is not expected to change.
7. `docs/operation.md` diff with the per-route table and the reverse-proxy guidance.
