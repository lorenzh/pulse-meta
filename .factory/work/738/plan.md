# Spec: status fails closed when the manual-incidents answer is not a list (#738)

## Goal

The status proxy must never serve, cache-tag or revalidate an upstream `/manual-incidents` answer
that is not a JSON array. Today `filterApiBody` in `status/src/api-filter.ts:255` returns every
non-array body unchanged before the manual-incidents privacy guard of #568 runs
(`api-filter.ts:258-264`), and `buildAnswer` (`status/src/server.ts:561,566`) then hands it to
`okAnswer` (`server.ts:369-377`), which serializes it and attaches an ETag. A single internal or
draft incident object from pulse-api therefore reaches `/api/manual-incidents` with its title,
updates and notes, and it gets an ETag that `If-None-Match` can hit. This was proved by a failing
test in the review of pulse-status#65 (child #733 of #568).

After this change, a non-array manual-incidents answer gets the result that status already uses
for an unreadable upstream answer: `502` with body `{"error":"invalid API response"}`
(`server.ts:417,430,435`), no ETag and `Cache-Control: no-store` (`server.ts:653-657`).

This is a follow-up to #568 (merged in status PR #65 at status `main`
`6336cb78c1440defea94b61df102e9b62a46401d`). The #568 array guard, its projection
(`cleanManualIncident`, `api-filter.ts:220-238`), the poller guard and the syndication guard are in
place and must not be redone.

## Baseline (inspected)

- status `main` = `6336cb78c1440defea94b61df102e9b62a46401d`; it pins contract
  `9ab7e2492a2cec91789fba7c742bdba900a800a9` (`status/package.json:34`), which exports
  `isPublicManualIncident`.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/738` answered
  `HTTP 404`, so there are no findings for this feature yet.
- Issue review: `.factory/work/738/issue-review.md` (no blocking question). Its planning
  assumptions are adopted below as decisions.

### Readers of manual incidents in status (search result)

Searched `status/src`, `status/public` and `status/e2e` for `manual-incidents`, `manualIncidents`,
`filterApiBody` and `Array.isArray(body) ? ... : body` / `if (!Array.isArray(body)) return body`.

| Path | Non-array handling today | Public passthrough? |
|------|--------------------------|---------------------|
| Proxy `/api/manual-incidents`: `buildAnswer` → `filterApiBody` (`server.ts:561`) → `okAnswer` (`server.ts:566`); `/api/manual-incidents` is not in `needsComponents` (`hidden-checks.ts:67-75`), so no snapshot check runs | returned unchanged (`api-filter.ts:255`) | **yes, the defect** |
| Browser and SSR poller `getManualIncidents` (`poller.ts:318-342`) | `Array.isArray(raw) ? raw.filter(isPublicManualIncident) : raw` passes the non-array into `validateManualIncidentsResponse`, which rejects it; the refresh fails and earlier validated state stays | no (validator rejects) |
| SSR (`ssr.ts:79-82`) | reads through the proxy cache with the poller above | no |
| Feed and component badge `parseManualIncidents` (`syndication.ts:161-186`) via `jsonList` (`syndication.ts:61-69`) | `jsonList` needs status `200` and an array, else `undefined` → `503 unavailable` (`syndication.ts:260-273,352-356`) | no |
| `limitResolvedWindow` (`api-filter.ts:273-280`) | returns non-array unchanged | not a manual-incidents path (only `/api/incidents?status=resolved`, `server.ts:562-565`) |
| `withPlaceholders`/`withDayPlaceholders` ternaries (`poller.ts:105,248`) | non-array goes into a validator | checks/uptime, not manual incidents |

So the proxy is the only manual-incidents path that serves a non-array body unchanged. The
other readers are kept as they are and covered by regression checks.

## Decisions

1. **Failure result.** A non-array manual-incidents body produces
   `answer(502, INVALID_RESPONSE, own.wireHeader)`: status `502`, body exactly
   `{"error":"invalid API response"}`, no `etag` field, so `proxyApi` sends
   `Cache-Control: no-store` and never `304`. The `x-pulse-contract` header is forwarded as on
   every other error answer (README of status, line 63). No placeholder `200`, no `[]`, no
   wrapping of a singleton into a list, no generic `500` from a throw.
2. **Every non-array is rejected** on this route: object (public or private), `null`, string,
   number, boolean. A public singleton is rejected too: the route's shape is a list.
3. **Representation.** `filterApiBody("/api/manual-incidents", body, isHidden)` returns `undefined`
   when `body` is not an array, without reading any property of `body`. `undefined` cannot come
   from `JSON.parse`, and it is the convention the module family already uses for "cannot be
   served" (`hideCheckIds`, `parseComponentsSnapshot` in `hidden-checks.ts`, checked at
   `server.ts:511,518,522`). `buildAnswer` checks `body === undefined` right after the
   `filterApiBody` call and returns the failure result of decision 1 before
   `limitResolvedWindow`, `hiddenAnswer` or `okAnswer`. The doc comment of `filterApiBody` says
   that `undefined` means "the body cannot be served". Other routes keep returning a non-array
   body unchanged. The implementer may use an equivalent local result type instead if it keeps
   every other caller and test of `filterApiBody` unchanged in behavior; no contract or kit type
   is added.
4. **Caching.** The failure answer is cached like every other error answer: it lives in the answer
   cache with the raw entry it was built from (`proxyAnswer`, `server.ts:583-591`) and is rebuilt
   when that raw entry expires. Within one cache period after a successful list the old list can
   still be served (existing TTL reuse); once the malformed body has been read, no request serves
   its content, an ETag derived from it, or the earlier successful list. No cache purge or
   per-request bypass is added.
5. **Arrays keep their current semantics**, including items that are not objects (`[null]` stays a
   malformed list for its readers, `api-filter.ts:259-261`), ordering, the projection, empty lists,
   legacy items without `visibility`/`publishedAt`, ETags and `304`.
6. **Optional getter.** No `review-runtime.ts` exists in status `main`. The guard of decision 3
   rejects an in-process non-array before it reads `title` or any other property, so a throwing
   `title` getter on a singleton object is never invoked. This is the same code path and gets one
   unit test. Getters on items inside a valid array are out of scope.

## Scope

- status: the proxy route `/api/manual-incidents` fails closed for non-array upstream bodies;
  tests for proxy, page, feed, component badge and poller; README and `docs/operation.md` text.

## Non-goals

- No change to pulse-api (it stays the primary privacy enforcer), contract, kit, notify, deploy.
- No general shape validation for other proxy routes; their non-array legacy behavior stays.
- No change to the poller's kept state on a failed refresh, the `404` handling of an older api,
  or browser caching.
- No hardening of accessors on items inside arrays.
- No new dependency, no repin.

## Required behavior

R1. `GET /api/manual-incidents` when upstream `/manual-incidents` answers `200 application/json`
with a non-array body: `502`, body `{"error":"invalid API response"}`,
`cache-control: no-store`, no `etag` header, for `PULSE_STATUS_HIDE_DETAILS` true and false,
`PULSE_STATUS_SHOW_CHECKS` true and false, cache on and off.

R2. The same request with `If-None-Match: *`, with the ETag that `main` served for the singleton
body, or with the ETag of an earlier valid list answers the same `502` (never `304`, never `200`).

R3. With an injected clock and cache on: valid list → `200` with ETag T; advance past the cache
period; upstream switches to a singleton → `502` per R1; advance past the period again; upstream
switches back to the valid list → `200` with the same bytes and ETag T.

R4. `/`, `/feed.atom` and `/badge/component/<id>.svg` show none of the malformed body's text
and carry no ETag derived from it. Feed and component badge answer `503 unavailable` (as
today), also after an earlier success. The SSR page keeps its existing `200` unavailable page
and its existing cache behavior; no SSR code changes. How that works today and after the change:
- SSR reads `/api/manual-incidents` through the same proxy answer (`ssr.ts:77-99`, `read` =
  `cachedAnswer`/`readWithDeps`, `server.ts:593-618,771-779`). The poller catches the failed
  refresh and publishes the error state (`poller.ts:401-420`, `getManualIncidents`
  `poller.ts:318-342`); `buildSections` renders the banner and the unavailable section from it
  (`sections.ts:71-77`). `renderSections` therefore returns `isComplete: true`
  (`server.ts:736-739`); `isComplete: false` is only for a render exception
  (`server.ts:740-743`) and is not expected here. With the cache on, the page is stored with
  `etagFor(ctx, html)` of the rendered HTML (`server.ts:785`), which contains no malformed text,
  and it is rebuilt when the raw entries expire, as for every other upstream failure.
- The only visible difference is the error kind of that page. On `main` the singleton reaches the
  poller as a `200` and its validator rejects it, so the kind is `invalid` ("The API sent an
  unexpected answer.", `render.ts:590-591`). After the change the poller reads the `502`, a
  fetch `http` error (`poller.ts:212-213`), so the kind is `unreachable` ("Cannot reach the
  API.", `render.ts:586-589`). That is exactly what the page shows today for every other
  unreadable upstream answer (invalid JSON, wrong media type, too large: all `502` from
  `fetchRaw`, `server.ts:415-431`), so it is the expected result of the issue's "result it already
  uses for an unreadable upstream answer". Do not change the poller or SSR to keep `invalid`.

R5. The poller rejects a non-array `/manual-incidents` body as a failed refresh, does not add it to
`manualIncidents`, keeps the earlier validated list, and still treats `404` as "no manual
incidents".

R6. Valid arrays (public only, empty, legacy items without visibility fields, public mixed with
drafts/internal items) are served with the bytes, ETags and `304` behavior of status `main`.

R7. Other routes are unchanged: for example upstream `/components/uptime` answering
`{"x":1}` with checks shown is still served as `200` with body `{"x":1}` and an ETag, as on
`main` (`needsComponents` excludes it, `filterApiBody` returns it unchanged).

## Risks

- **Treating `undefined` as a body.** If a later caller of `filterApiBody` forgets the check,
  `JSON.stringify(undefined)` yields `undefined` and `answer` would build a broken body. Mitigation:
  the check sits directly after the only call (`server.ts:561`), and the doc comment says so.
- **Breaking tests that use `filterApiBody` as an oracle** (`server.hidden-checks.test.ts`,
  `poller.test.ts`, `latency.test.ts`, `manual-incidents.test.ts`). Only the manual-incidents
  non-array return changes; these tests must pass unchanged.
- **ETag drift for arrays.** A change in the serialization path would move ETags. The array
  branch is not touched; R6 is checked A/B against `main`.
- **Cognitive complexity** of `buildAnswer` (SonarJS limit 15 via `pulse-eslint`): adding one
  branch may need a small helper beside it.

## Performance impact

None expected: the change adds one `Array.isArray` check that already runs, plus one comparison
per answer build, only on `/api/manual-incidents`; no metric of `bench/budgets.json` (status:
`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `startup_wall_ms`,
`image_mb`) moves measurably. `test_cpu_s` of status grows by the few new HTTP tests (well under
0.1 s); the implementer compares the `bun test` CPU time of `main` and the branch once and reports
both numbers in the PR. No A/B bench run is needed.

## Security impact

Security impact: yes. It changes the validation of JSON from another service at the status trust
boundary and what the public proxy responds with.

Checklist items that apply:
- Secrets in responses: private incident text (title, updates, notes, draft fields) must not
  appear in any response body or be inferable from an ETag/`304`.
- Input validation: every non-array top-level body is rejected on the manual-incidents route.
- Accessor execution: an in-process singleton with a throwing `title` getter is rejected without
  invoking the getter (decision 6).
- Error texts: the failure body is the fixed `{"error":"invalid API response"}`; no upstream text
  is copied into errors or logs.
Not affected: auth, body and size limits (unchanged 5 MiB cap), SSRF, file writes, dependencies,
Dockerfiles, CI.

## Rollout order

One repository: only status changes. It keeps working against every api version: a current api
sends an array (unchanged path), an older api without the route answers `404` (unchanged path),
and a misbehaving api that sends a non-array now gets `502` instead of a leak. No contract, kit or
config pin changes.

## Counterexamples

Each of these is a `200 application/json` upstream answer of `/manual-incidents` unless noted.

| Input | Required result | Wrong implementation it catches |
|-------|-----------------|---------------------------------|
| (a) `{"id":"i1","title":"SENTINEL-A-TITLE","visibility":"internal","publishedAt":1,"updates":[{"at":1,"status":"investigating","message":"SENTINEL-A-UPDATE"}],"notes":"SENTINEL-A-NOTE",...}` | `502` invalid API response, no ETag | `main` (passthrough) |
| (b) draft object, `publishedAt: null`, title/update/note sentinels | `502` | a fix that only runs `isPublicManualIncident` on objects |
| (c) published internal record, `visibility:"internal"`, finite `publishedAt` | `502` | same |
| (d) public singleton, `visibility:"public"`, finite `publishedAt` | `502` | a fix that serves a public singleton or wraps it as `[item]` |
| `null`, `"x"`, `0`, `true`, `{}` | `502` | a fix that checks only `isRecord` |
| any of the above with `If-None-Match: *` | `502`, not `304` | answer with an ETag of the error or of a cached list |
| any of the above with the ETag `main` served for (a) | `502`, not `304` | ETag kept from the old body |
| non-array after a cached valid list, clock past the period | `502`, not the old `200` list | fallback to the last good list |
| any non-array | not `200 []` | silent substitution of an empty list |
| `[null]` | `200` `[null]` (unchanged, a malformed list for its readers) | over-eager change of the array branch |
| `[]` | `200` `[]` with ETag and `304` as on `main` | broken empty-list handling |
| `/components/uptime` answering `{"x":1}` (checks shown) | `200` `{"x":1}` as on `main` | a general non-array rejection across routes |
| in-process `filterApiBody("/api/manual-incidents", obj)` where `obj.title` is a throwing getter | returns `undefined`, getter called `0` times | reading fields before the shape check |

No statistic is involved.

## Contract fields

No new names: no new field, key, route, header, setting or contract export. The failure body
`{"error":"invalid API response"}` already exists (`status/src/server.ts:435`). Search:
`grep -rn 'invalid API response' .repos/contract/src .repos/config` → no match; status keeps it as
a local constant, as today.

## Repository: status

Files:
- `src/api-filter.ts` (change: manual-incidents non-array returns `undefined`; doc comment)
- `src/server.ts` (change: `buildAnswer` maps that to the `502` invalid-response answer)
- `src/api-filter.test.ts` (new unit cases)
- `src/server.privacy.test.ts` (new HTTP regression tests; or a new `src/server.manual-shape.test.ts` if the file grows too large)
- `src/poller.test.ts` (regression case for the non-array body, only if not already covered)
- `README.md` (line 61: the proxy failure rule names the non-array manual-incidents answer)
- `docs/operation.md` (lines 175-177: the manual-incidents failure rules)

Behavior change: yes. A non-array `/manual-incidents` answer becomes `502` with no ETag instead of a tagged `200` that repeats the upstream body.

### Behavior

Implement decisions 1-6 and R1-R7 above. In short:
- `filterApiBody`: for `pathname === "/api/manual-incidents"` and a body that is not an array,
  return `undefined` before any property access. All other pathnames keep
  `if (!Array.isArray(body)) return body`. The array branch is unchanged.
- `buildAnswer` (`server.ts:552-567`): if the filtered body is `undefined`, return
  `answer(502, INVALID_RESPONSE, own.wireHeader)`. Keep `buildAnswer` within the cognitive
  complexity limit.
- The poller, SSR and syndication guards stay as they are.
- Docs: README line 61 adds that a non-array `/manual-incidents` answer is `502`
  `invalid API response`; `docs/operation.md` near line 176-177 says the same, that the feed
  and component badge then answer `503`, and that the page treats it like any other unreadable
  answer (`Cannot reach the API.`, the existing text of `docs/operation.md:157`).

### Tool facts (verified)

- Runtime and package manager: Bun 1.4.0 (`package.json:9` `engines.bun`, `package.json:38`
  `packageManager`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:19`);
  `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`); `typecheck`
  runs `typescript7` `tsc --noEmit` for the project and `-p e2e` (`package.json:13`); `test` =
  `bun test` (`package.json:14`).
- Biome `2.6.3` (`package.json:23`); `biome.json:2` only `extends`
  `@lorenzh/pulse-config/biome.json`. At the pinned config ref
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`), `biome.json:10-17` includes
  `**` except `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`. The pinned file is
  identical to the config clone.
- Coverage: `bunfig.toml` `[test]` sets `coverage = true` and a line threshold of `0.8`
  (`bunfig.toml:2-3`).
- CI: `.github/workflows/ci.yml:17-18` `uses`
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`,
  which runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test`
  (pinned `check.yml:25-38`; identical to the config clone). `ci.yml` also has the `docker` and
  `a11y` (`bun run check:a11y`) jobs; both stay.

### Checks

TDD per status `AGENTS.md`: write the HTTP regression first and record that it fails on `main`
`6336cb78c1440defea94b61df102e9b62a46401d` with a `200` that contains a sentinel and an ETag.

1. HTTP regression (`createStatusServer` on `127.0.0.1` port `0`, fake api on port `0`, injected
   clock, fixtures and helpers of `server.privacy.test.ts` such as `startOnUpstream`, `served`,
   `PRIVATE_SENTINELS`). Other upstream routes return valid fixtures. For hide-details true and
   false, checks shown and hidden, cache on (`cacheMs > 0`) and off (`0`), and each body
   (a)-(d) plus `null`, `"x"`, `0`, `true`, `{}` from the counterexamples:
   - `/api/manual-incidents`: status `502`, body exactly `{"error":"invalid API response"}`,
     `cache-control` exactly `no-store`, `etag` header absent (all literals).
   - No sentinel string (distinct literals for title, update message, note, draft field) in any
     response body or header.
   - Repeat with `If-None-Match: *`, with the old passthrough ETag
     (`etagFor(settings, JSON.stringify(body))` from `http-cache.ts`, the value `main` served) and
     with the ETag of a prior valid list: each answer is the same literal `502`.
2. Transition (R3) with a fake clock, cache on: valid list → `200` + ETag T; clock past the cache
   period; singleton → literal `502` above; clock past the period; valid list again → `200` with
   ETag equal to T and body equal to the first `200` body (same run, two independent reads).
   No real sleeps.
3. Page, feed, component badge (R4): with each malformed body, `/` answers `200` (literal),
   contains no sentinel and contains the literal text `Cannot reach the API.`; with the cache on,
   its `etag` differs from the page ETag served with the valid list in the same run, and a second
   request within the cache period gives the same page ETag (stored, as on every other upstream
   failure); `If-None-Match` with the page ETag of the valid list gives `200`, not `304`.
   `/feed.atom` and `/badge/component/<fixture id>.svg` answer `503` with no `etag` header, also
   after an earlier `200` of the same surface. No SSR, sections or poller source changes. Positive control in the same test file: with the
   valid public array, the page contains the public title, the feed contains `:manual:1:0`, the
   badge answers `200` (so absence cannot pass because everything failed).
4. Poller (R5): a direct poller test with a fake `fetch` returning a singleton for
   `/manual-incidents` after a valid list: the refresh fails, `manualIncidents` still equals the
   earlier list; a `404` still keeps the list. If `poller.test.ts` already covers this, cite the
   test name instead of adding one.
5. Unit (`api-filter.test.ts`): `filterApiBody("/api/manual-incidents", x, h)` is `undefined` for
   every counterexample non-array and both `h`; for an object whose `title` getter throws, the
   result is `undefined` and the getter call counter is `0`; `filterApiBody("/api/checks", {}, h)`
   and `filterApiBody("/api/components/uptime", {"x":1}, h)` still return the input object
   (`assert.equal` identity).
6. Array compatibility (R6), A/B against `main`: serve the same fixture set (public only `[publicControl]`, `[]`,
   a legacy item without `visibility`/`publishedAt`, `PRIVATE_UPSTREAM`) from a worktree of
   `main` `6336cb7` and from the branch; the `/api/manual-incidents` bodies and ETags must be
   byte-equal, and `If-None-Match: <etag>` gives `304` on both. Record the sha256 of each body and
   the ETags of both sides in the PR. The existing tests
   `manual incidents: drafts, internal items, notes and draft updates never served` and
   `manual incidents: entity tags and 304 depend only on public items`
   (`server.privacy.test.ts:967,988`) pass without edits.
7. Other route (R7): upstream `/components/uptime` answering `{"x":1}` with checks shown gives
   `200` and body `{"x":1}` (literal), as on `main`.
8. `bun run check` passes; `bun run check:a11y` stays green in CI. Coverage and complexity limits
   are not lowered.
9. Smoke: `bun start` against a fake api on `127.0.0.1` that answers `/manual-incidents` with a
   singleton; `curl -i /api/manual-incidents` shows `502`, the literal body, `no-store` and no
   ETag. Report the command and result in the PR, without private data.

### Completion evidence

The PR (with `Closes lorenzh/pulse-meta#<child>`) names: the failing run of check 1 on `main`
`6336cb7` and the passing run on the branch; the A/B table of check 6; the `bun run check`
result; the smoke command and output; the `bun test` CPU time of `main` and the branch; and the
known limits (TTL reuse of an earlier list until its raw entry expires, decision 4).
