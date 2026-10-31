# Spec #554: status: latency charts by default, hidden-check reasons, caching, docs

Checked against `main` of pulse-status at `2e3067d`, pulse-contract `ebcbbb6` and pulse-api
`c00a375`. Issue review: `.factory/work/554/issue-review.md`. Builds on the merged specs #381
(latency charts, `.factory/work/381/plan.md`), #378 (accessibility and server rendering,
`.factory/work/378/plan.md`) and #474 (cache of filtered answers, `.factory/work/474/plan.md`).
Reuse their code. Do not build it again.

Lead decision (issue comment, option **B**):

- Budget: at most **250,000 UTF-8 bytes** for the served body of `/` in the default layout
  (20 components, checks hidden, component latency charts on), with the fixture of 50 checks,
  20 components and 90 days. The layouts with checks shown and with no components get a cap of
  **1,000,000 bytes** as a guard against growth.
- Uptime bars become decorative (`aria-hidden`). One `<details>` table of daily values per entry
  (date, uptime, p50, p95, results) is the accessible equivalent. It replaces the per-bar labels
  and the roving arrow keys of #378. The table can be reached by keyboard and read without
  JavaScript.
- Hidden checks: one latency chart per component. Each UTC day uses the highest p50 and the highest
  p95 of the component's HTTP member checks. The chart and the table label this as
  "highest member check".

## Goal

With default settings, the status page shows latency history. It never hints at hidden checks.
It serves its assets and its page cheaply. Component badges agree with the page. The developer
docs describe the real code. Status pins contract `main`.

## Current behavior (2e3067d)

- `public/client.js:130` and `src/ssr.ts:92` pass `hasLatency: showChecks`. The poller reads
  `/api/latency` only when the option is set (`src/poller.ts:247-258`).
- `src/server.ts:498-506` answers `404` for `/api/latency` whenever `PULSE_STATUS_SHOW_CHECKS` is
  off, also when there are no components and the checks are shown by the fallback.
  `src/api-filter.ts:261` returns `[]` for the same case. With the defaults, no latency chart is
  ever drawn.
- `src/api-filter.ts:53-56` (`cleanReason`) sets a reason to `null` only when `isHidden`
  (`PULSE_STATUS_HIDE_DETAILS`) is set. `hideCheckIds` (`src/hidden-checks.ts`) changes the
  `checkId` of incidents but leaves `reason` as it is. In hidden mode with
  `PULSE_STATUS_HIDE_DETAILS=false`, a reason such as `connect ECONNREFUSED 10.0.0.5:5432` reaches
  JSON, the server-rendered page and the feed (`docs/operation.md:83`).
- `src/server.ts:657-708`: `/page.css`, `/theme-init.js`, `/theme.css`, `/client.js`, the
  transpiled `tsModules`, the kit modules and the contract and zod modules go out without
  `Cache-Control` or `ETag`. Every request reads the file again, and a `tsModules` request also
  transpiles it again. Fonts already send `public, max-age=31536000, immutable`
  (`src/server.ts:667-676`).
- `src/server.ts:597-615` and `:646-655`: every `GET /` reads `public/index.html` and runs a new
  poller and a full render (`renderState`, `src/ssr.ts:77-102`). The upstream reads come from the
  cache, but the render runs on every request. The page has no `ETag`.
- `src/syndication.ts:329-360` (`serveComponentBadge`) uses the component `state` from pulse-api.
  It does not apply manual incidents, which the page applies (`componentsWithIncidents`,
  `src/components-view.ts:311-325`). `docs/operation.md:159` says so.
- `src/render.ts:199-218`: each of the 90 bars is a focusable `role="img"` element with its label
  three times (`title`, `aria-label`, `data-exact`). `src/bars.ts` moves the tab stop with the
  arrow keys, and `src/patch.ts:1` keeps that stop across patches. `src/render.ts:395-412` adds a
  separate latency `<details>` table per check.
- `docs/development.md:26` names `src/validate.ts`, which does not exist. It also says that
  browser modules "import only types", but `src/poller.ts:22` imports `RESOLVED_WINDOW_MS` from
  `./render.ts`, `src/sections.ts` and `src/components-view.ts` import runtime functions from
  sibling modules, and `src/server.ts:699` rewrites relative `.ts` imports for the browser. The
  "This repository" section of status `AGENTS.md` repeats the old rule.
- `package.json:34` and `bun.lock:10,89` pin contract `9fe5e8016ece235fdc11652d9be475d67df298f2`.
  `gh api repos/lorenzh/pulse-contract/compare/9fe5e80...ebcbbb6` shows 6 commits. One of them is
  `43e0037 feat: accept only http and https check urls` (`contract/src/schema.ts:15-22`). The
  changed files do not include `dist/version.js`, so the wire version stays the same. Contract
  main still pins `zod` `4.6.7` (`contract/package.json:39`), the same version as status
  `package.json:36`.
- `docs/operation.md:174` records about 1.2 MB for `/` with checks shown. No test bounds the size.

## Scope

Target `status` only: server, proxy filter, poller, renderers, browser client, styles, tests,
the Chromium checks, docs and the contract pin. pulse-api and pulse-contract stay as they are.
The component latency answer is a projection that status owns and builds from the existing
`GET /latency` and `GET /components`.

## Non-goals

- No pooled component percentile. The api has only daily percentiles per check, and no API or
  contract change is made to get raw samples.
- No new setting. `PULSE_STATUS_SHOW_CHECKS`, `PULSE_STATUS_HIDE_DETAILS` and
  `PULSE_STATUS_CACHE_MS` keep their names, values and defaults.
- No content-hashed asset URLs and no `immutable` policy for JS and CSS: the URLs stay
  unversioned. That can be a later step.
- No change to the logo route, the fonts, `/healthz`, `/readyz`, `/metrics` or readiness.
- No redaction of text written by operators (manual incident titles and updates, maintenance
  notes).
- No change to the old contract pin of notify.
- No total budget for JS and CSS transfer.
- The meta `README.md` (lines 37 and 189 say latency needs `PULSE_STATUS_SHOW_CHECKS=true`) is
  corrected in meta after the status pull request is merged. No child issue is opened for it.

## Required behavior

### 1. Latency visibility matrix

"Hidden mode" means components are configured (upstream `/components` is not empty) and
`PULSE_STATUS_SHOW_CHECKS` is off. This is the existing meaning in `hiddenAnswer`
(`src/server.ts:415-439`).

| Layout | `/api/latency` | `/api/components/latency` | Charts on the page |
|---|---|---|---|
| No components, either `SHOW_CHECKS` value | `200`, per-check `LatencyResponse` as today (`cleanLatency`) | `200`, `[]` | One per HTTP check |
| Components, `SHOW_CHECKS=true` | `200`, per-check, as today | `200`, `[]`, no upstream read | One per shown HTTP check (member and loose checks). No component chart |
| Components, `SHOW_CHECKS` off (hidden mode, the default) | `200`, `[]` | `200`, one entry per component with at least one HTTP member | One per component with HTTP members. No per-check chart |

- `/api/latency` no longer answers `404` because `SHOW_CHECKS` is off. Remove `isLatencyHidden`
  (`src/server.ts:498`) and the `[]` shortcut (`src/api-filter.ts:261`). Add `/api/latency` to
  `needsComponents`, and make `hideCheckIds` return `[]` for it. Hidden mode then goes through the
  same fail-closed path as `/api/uptime`: if `/components` cannot be read or parsed, the answer is
  `502` with the generic body, never the per-check data.
- New allow-listed route `/api/components/latency`. Status builds it. The proxy never sends an
  upstream request for `/components/latency`: the route has no own read and is built from the raw
  reads `/components` and `/latency`. It goes through `cachedAnswerFor` with those two raw entries
  as dependencies (#474 rule). With `SHOW_CHECKS=true` it is `[]` with no read. Otherwise:
  - `/components` fails → `502` (`snapshotFailure`). Not a components list → `502`
    `invalid API response`. Empty list → `[]`.
  - `/latency` fails → its failure answer is passed on as `/api/latency` passes it on (an older
    api's `404` stays `404`, the network error stays `502`). The raw body is checked with the
    contract's `validateLatencyResponse`. If that check fails, or member date lists differ →
    `502` `invalid API response`.
  - Any other query or a trailing slash → `404` `no-store`, like every route that is not on the
    allow-list.
- Shape (owned by status, not a contract type), in a new pure server module
  `src/component-latency.ts`:
  ```ts
  /** One public component's daily latency, from its HTTP members (highest member check). */
  export interface ComponentLatency { componentId: string; days: LatencyDay[] } // 90 days
  export type ComponentLatencyResponse = ComponentLatency[];
  ```
  `LatencyDay` is the contract type (`import type`). Entries come in `/components` order. Each
  `days` array passes the contract's `latencyDaySchema`: `p50Ms` and `p95Ms` are `null` exactly
  when `count` is `0`. The entry holds no check id, name, objective or member count.
- The poller always reads both routes. Remove the `hasLatency` option from `src/poller.ts`,
  `src/ssr.ts` and `public/client.js`. Both reads are optional, like today's latency read. A failed
  or invalid answer keeps the last good value, a wire mismatch fails the refresh
  (`src/poller.ts:247-258`). `PollerState` gains
  `componentLatency: ComponentLatencyResponse | null`, which is `null` until the first good read.
  The browser checks the component answer this way: it is an array, each item is an object with a
  non-empty string `componentId`, and its `days` pass
  `latencyDaySchema.array().length(90)` (`latencyDaySchema` from `@lorenzh/pulse-contract`).
  Do not reuse `validateCheckLatency` with a component id in `checkId`.
- The page draws a component chart only for an id that it knows from `/api/components`. Other ids
  are ignored. A component with HTTP members but no results in the 90 days shows the summary
  "no latency data yet", as a check does today. A component without HTTP members has no entry and
  no chart. It never shows a latency text.

### 2. The component statistic (highest member check)

For component `C` and day index `d` (0..89):

- `M` = the distinct ids in `C.checkIds` that have an entry in the raw `/latency` body. The api
  sends one entry per active HTTP check, so `M` is the set of the component's active HTTP
  members. A duplicate id in `checkIds` counts once. If `M` is empty, `C` has no entry.
- All members in `M` must have the same 90 `date` values in the same order. Otherwise the answer
  is `502` `invalid API response`. `date[d]` is that common value.
- `K_d` = the members of `M` whose day `d` has `count > 0`.
- `count[d]` = the sum of `count` over `K_d`. It is the number of up and degraded results that
  were used. It is not the number of members.
- `p50Ms[d]` = the maximum of the member `p50Ms` over `K_d`. `p95Ms[d]` = the maximum of the
  member `p95Ms` over `K_d`. Each is chosen on its own, so the two can come from different
  members. Values are copied exactly as the api sent them: no rounding, no mean, no weighting.
  Rounding happens only for display (`formatLatencyMs`, `src/render.ts:157-160`).
- If `K_d` is empty: `p50Ms` and `p95Ms` are `null` and `count` is `0`. The chart draws a gap.
- A check that is in several components counts in each of them. An HTTP check in no component
  counts in none.
- The member values are nearest-rank percentiles that the api computes per check and UTC day
  (`contract/src/schema.ts:652-655`). The maximum of the member p50 values is not the median of
  the component's results, and the maximum of the member p95 values is not their 95th
  percentile. Docs and labels say "highest member check" and never call it the component's
  p95.
- The chart summary of a component reads
  `highest member check daily p95, last 7 days <formatLatencyMs(max p95Ms over the last 7 days)>`.
  It has no objective. The legend reads `Solid line highest member check p95, dashed line highest
  member check p50. Days are UTC days.` The latency column headers of its table are
  `Highest member check p50 (ms)` and `Highest member check p95 (ms)`.

### 3. Decorative bars and one daily-values table per entry

- `renderUptime` draws 90 decorative bars. The `.bars` element gets `aria-hidden="true"` and keeps
  its colour classes. It loses `role="group"` and its `aria-label`. A bar has no `role`,
  `tabindex`, `title`, `aria-label` or `data-exact`. The visible total (`99.9 % uptime, 90 days`)
  stays as text.
- Delete `src/bars.ts` and `src/bars.test.ts`. Remove `/bars.js` from `tsModules`, `bindBars` from
  `public/client.js`, the roving-stop hooks from `src/patch.ts`, and the `.bar` hover, focus and
  `::after` tooltip rules from `public/page.css`.
- Each check or component entry that has uptime days or a latency chart gets exactly one
  `<details class="daily-values" data-key="daily">` after its bars and chart. Its `<summary>` reads
  `Daily values, <entry name>`. The latency chart (`renderLatencyChart`) keeps its summary, SVG
  (still `aria-hidden`) and legend, but no longer has a table of its own.
- Table: one row per UTC date, newest first, with the 90 dates of the uptime entry, or of the
  latency entry when there is no uptime entry. The header row has `Date (UTC)`, `Uptime (%)`,
  then `p50 (ms)` and `p95 (ms)` only when the entry has a latency chart (the component labels are
  in section 2), and then `Results`. Cells:
  - date: a `<th>` in the row;
  - uptime: `uptime.toFixed(1)`;
  - p50 and p95: the number of `formatLatencyMs` without the unit, from the latency day of the
    same date;
  - Results: the `results` of the uptime day.
  A missing value is `no data`. Units go in the headers, not in the cells.
- Tab stops: an entry with data has exactly one, its `<summary>`. The `open` state survives
  polls, as for today's latency details. Native `<details>` works without JavaScript.
- Markup guidance for the budget. Per-row keys are not needed: `planChildren`
  (`src/patch.ts`) matches unkeyed rows in order. No repeated labels per day. Short class names on
  the bars. Keep a component entry of the default fixture at about 11.5 KB or less.

### 4. Page-weight budget (test in CI)

- New test file `src/server.page-weight.test.ts`. It starts the real server on `127.0.0.1:0`
  against a stub API and runs the fixture below. Fixed `now`: `Date.UTC(2026, 9, 1, 12, 0, 0)`.
  `cacheMs` is the default.
- Fixture: 50 `http` checks `check-00`..`check-49`, each with 90 uptime days (day `i`:
  `uptime` 97.5 when `i % 10 === 0`, else 99.95, `results` 1440) and 90 latency days (`p50Ms`
  `80 + (i * 7) % 40 + 0.4`, `p95Ms` `150 + (i * 11) % 60 + 0.7`, `count` 1400; day 45 is
  `null`/`null`/`0`). 20 components `comp-00`..`comp-19`. Components 0-9 have 3 members each
  (checks 0-29), components 10-19 have 1 member each (checks 30-39), and checks 40-49 are in no
  component. Every component has 90 component uptime days. Component 0 is named
  `Café API — Zürich`, so string length and byte count differ. There are 5 open incidents, 10
  incidents resolved in the last 7 days, 5 upcoming maintenance windows and 2 open manual
  incidents.
- Measure `(await res.arrayBuffer()).byteLength` of `GET /`, without `Accept-Encoding`. Never use
  the string `length`, gzip size or asset size.
- Layout `default` (stub `/components` with 20 entries, `showChecks` unset, `hideDetails` unset):
  - at most `250000` bytes;
  - exactly 20 `data-key="component:`, 20 `class="latency-chart"` and 20 `class="daily-values"`;
  - no `check-` id and no `Check ` name.
- Layout `shown` (`showChecks: true`): at most `1000000` bytes, 50 latency charts, 0 component
  charts.
- Layout `fallback` (stub `/components` is `[]`, `showChecks` unset): at most `1000000` bytes,
  50 `data-key="check:` and 50 latency charts.
- The test prints the three byte counts. The pull request records them next to the numbers on
  `2e3067d`.
- If the default layout cannot meet 250,000 bytes with section 3 and all its content, the
  implementer requests a `needs-input` hold. Do not raise the limit, drop charts, tables or
  entries, or shrink the fixture.

### 5. Reasons in hidden mode

- In hidden mode, `reason` of every automated incident (open and resolved) is `null` in the
  served answer, whatever `PULSE_STATUS_HIDE_DETAILS` says. Apply this in the hidden-mode answer
  of `/api/incidents` (where `hideCheckIds` re-keys), before serialization and before the tag. JSON,
  the server-rendered page, the feed and the cached answers then agree.
- Outside hidden mode (no components, or `SHOW_CHECKS=true`), `HIDE_DETAILS` works as today:
  `true` → `null`, `false` → `sanitizeText`.
- Manual incident titles and updates and maintenance notes stay public and unchanged.

### 6. Asset caching

- These successful routes send `Cache-Control: no-cache` and a strong `ETag`: `/client.js`,
  `/theme-init.js`, `/page.css`, `/theme.css`, every `tsModules` path, the allow-listed
  `/pulse-kit/*.js` and `/pulse-contract/*.js`, and `/pulse-contract/zod/**/*.js`. The `ETag` is
  the SHA-256 of the exact bytes sent, in base64url and cut like `etagFor`
  (`src/http-cache.ts`). It does not depend on the privacy settings. Add a settings-free helper
  next to `etagFor`.
- A request whose `If-None-Match` hits the tag (`ifNoneMatchHits`) gets `304` with no body and the
  same `ETag` and `Cache-Control`. The security headers set in `handle` stay. `HEAD` works the same
  way.
- Why `no-cache`: the URLs are unversioned, and a deploy must reach the next page load. A
  revalidation costs a round trip but no body.
- The server keeps each asset's bytes and tag per instance after the first successful read. That
  is the transpiled output for `tsModules`, so it is no longer transpiled on every request.
  `/theme.css` is the generated CSS of this instance's theme. A failed read is not kept, so
  unknown paths never grow the map. The `zodFile` traversal guard and the allow-lists stay as
  they are.
- `404` and `500` answers keep their current headers: no `ETag` and no `no-cache`.
- Fonts keep `public, max-age=31536000, immutable`. `/logo` does not change.

### 7. Page snapshot

- `/` and `/index.html` share one stored render per server instance. Read `public/index.html` once
  when the server is created, not on every request.
- With `PULSE_STATUS_CACHE_MS > 0`, the page goes through the same rule as #474. It is a cached
  build whose dependencies are every raw upstream entry that its answers were built from. It is
  reused while all of them are still the current, unexpired raw entries. Concurrent requests join
  one build. A build that throws, or a render that falls back to empty sections after an error
  (`renderSections` catch), is served but not stored. The rendered time in the no-JavaScript note
  and the relative times are those of the build, so they are at most one cache period old.
- A stored page has a strong `ETag` (`etagFor(settings, html)`). A matching `If-None-Match` gets
  `304` with no body. `Cache-Control` stays `no-cache`.
- With `PULSE_STATUS_CACHE_MS=0`, every request renders, as today, with no `ETag`. This matches
  "0 turns the caches off" (`docs/operation.md:104`).
- No background rendering: a server without visitors renders nothing. Readiness stays with
  `src/api-poll.ts`. When upstream fails, the page shows the unavailable or stale banner of the
  failed reads, as today.

### 8. Component badges and manual incidents

- `serveComponentBadge` also reads `/api/manual-incidents` through the same proxy cache. It uses
  the `lastManual` state that it already shares with the feed (`src/syndication.ts:371`). A
  `404` keeps the last list, which is empty before the first success. Any other failure or a
  malformed list → `503 unavailable`, like the feed.
- The badge state is the page's rule. It is the worst of the api component state and
  `incidentImpactState(impact)` of each open manual incident (`resolvedAt === null`, so
  `monitoring` counts) that names the component, combined with the contract's `combineStates`.
  `parseManualIncidents` must keep `resolvedAt`. Reuse `componentsWithIncidents` or the same
  contract helpers. Do not write the rule a second time. Uptime stays as pulse-api computed it.
- Check badges, label validation, CSP, `public, max-age=60` and the `ETag` stay as they are.

### 9. Docs and contract pin

- Pin `@lorenzh/pulse-contract` to `github:lorenzh/pulse-contract#ebcbbb613328494185833f7133f1242910986948`
  in `package.json` and regenerate `bun.lock` with `bun install`. If contract main is newer when
  the work starts, keep `ebcbbb6` unless this spec is amended.
- `docs/development.md`:
  - drop `src/validate.ts`;
  - describe the real browser imports: relative `.ts` sibling imports rewritten to `/<name>.js`,
    contract runtime from `/pulse-contract/index.js`, and only `escape` and `format-duration`
    from the kit;
  - add `src/component-latency.ts`;
  - drop `src/bars.ts`.
- Status `AGENTS.md`, "This repository": state the same import rule, without "no relative
  runtime imports".
- `README.md:32`, `docs/configuration.md:15-16`, and in `docs/operation.md` the sections
  "Components" (`:59`), "Latency and availability" (`:63-69`), "What is public" (`:75`, `:83`),
  "Caching" and "HTTP caching" (`:102-134`, table rows for the page and the static routes),
  "Manual incidents" (`:159`), "Keyboard and screen reader use" (`:165`) and "Without JavaScript"
  (`:174`, replace with the measured bytes from section 4 and a warm p95 of `/`).

## Risks

- **Tight budget.** Estimate for the default layout with section 3: about 11.5 KB per component
  × 20, plus page chrome, about 235 KB. The test is the gate, and section 4 says what to do if it
  fails.
- **Lost per-day keys.** The roving arrow keys of #378 go away. The table is the text equivalent,
  as the lead decided. The Chromium checks must show one tab stop per entry and a readable table.
- **One member is the series.** A component with one HTTP member shows that member's series under
  the component name. That reveals no check identity, as component uptime with one member does
  today. A component with one slow member looks slow: that is why the "highest member check"
  label exists.
- **Revalidation per asset.** `no-cache` still costs about 20 conditional requests per page load,
  answered with `304`. Hashed URLs would remove them, but are a non-goal.
- **More api reads with visitors.** A visible default page now makes status read upstream
  `/latency` once per cache period per instance (default 2 s). Before, it did not read it at all.
- **Fail closed.** A wrong order in the new route (reading `/latency` before the hidden-mode
  decision, or answering raw data when the components read fails) would leak per-check data.
  Section 1 and its counterexamples test this.
- **Test CPU.** Three renders of the 50-check fixture and the new server tests raise
  `test_cpu_s`. That metric gates at 2.4 s.

## Performance impact

`bench/budgets.json` in the api repository (`main` `c00a375`) gates `status.startup_cpu_ms`
(377 ms), `load_cpu_s` (0.5 s), `idle_rss_mib` (82 MiB), `peak_rss_mib` (85 MiB) and
`test_cpu_s` (2.4 s), and reports `startup_wall_ms` and `image_mb`. The bench starts status
without visitors (`bench/compose.bench.yaml:46-58`, only `PULSE_API_URL`). Its load sends no
request to status (`bench/load.ts`). So status only runs the readiness poll of `/checks` there.

- `startup_cpu_ms`, `startup_wall_ms`: no change expected. The only extra start-up work is
  reading `public/index.html` once (a few KB). Assets are memoized lazily.
- `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`: no change expected in the bench, which sends no
  page or asset requests and has no background render. In production, memoized assets add well
  below 2 MiB of RSS once the zod module graph has been requested. A cached `/` costs a lookup
  instead of a render.
- `test_cpu_s`: up, roughly +0.2 to +0.5 s from the page-weight renders and the new server tests,
  within the 2.4 s budget. Measure CPU (user + sys) of `bun run test` three times on `2e3067d` and
  three times on the branch, for example with `/usr/bin/time -f "%U %S" bun run test`, and report
  the medians in the pull request.
- `image_mb`: no change (`src/bars.ts` removed, `src/component-latency.ts` added, a few KB).
- api metrics (`p95_get_latency_ms`, `rps` and the others): no change in the bench, because bench
  status has no visitors. In production, the api gets at most one `/latency` read per cache period
  per status instance while a default page is open.
- The nightly api bench (`bun bench/run.ts`, `api/bench/README.md` "Running it") takes status
  `main` as side B, so it shows the change after the merge. The implementer also runs
  `bun bench/conditional.ts` in status on `2e3067d` and on the branch, as a check that the proxy and
  syndication cost did not get worse.

## Security impact

Security impact: yes. The change alters what the proxy serves about hidden checks (reasons, a new
latency projection built from raw upstream reads), the validation of upstream and served JSON,
and a dependency pin.

Applicable checklist items:

- **Secrets in errors, logs and responses.** In hidden mode, no reason, check id, check name,
  objective or member count reaches `/api/*`, `/`, `/feed.atom` or a badge, whatever
  `PULSE_STATUS_HIDE_DETAILS` says. New error answers use the existing generic bodies.
- **Input validation.** Raw `/latency` is checked with `validateLatencyResponse` and raw
  `/components` with `parseComponentsSnapshot` before the projection. Both fail closed with
  `502`. The browser checks `/api/components/latency` against `latencyDaySchema`.
- **Path safety.** The asset memo is keyed only by allow-listed paths that were read
  successfully. The `zodFile` traversal guard stays.
- **Dependency pins.** Contract pinned to a full SHA on `main`, with an integrity-checked
  `bun.lock` entry.

Not applicable: auth, admin routes, probe HTTP client, file writes, Dockerfile and CI files.

## Rollout order

One repository: only status changes. Its contract bump uses the already merged contract `main`
(`ebcbbb6`) without a wire-version change.

- **Older pulse-api.** An api without `/latency` makes `/api/latency` and
  `/api/components/latency` pass on its `404`. The poller keeps `null`, and the page shows no
  charts, as today with an old api. Manual incidents keep their `404` handling, on the page and
  now on the component badge.
- **Old browser tabs after a deploy.** An old `client.js` passes `hasLatency`, which is now
  ignored, and reads `/api/latency`, which keeps the contract shape. `no-cache` makes the next
  load get the new assets.
- **Other services.** probe, api, notify and console do not read status.

## Counterexamples

Each case is a test (unit test, or real server on port `0` with a stub API). All test data uses
these sentinels: check id `secret-check`, check name `Secret DB`, host `db.secret.internal` and
IP `10.9.8.7`.

### Visibility and fail-closed

1. No components, `showChecks` and `hideDetails` unset: `GET /api/latency` is `200` with the
   per-check list. `GET /` contains `class="latency-chart"`. On `2e3067d` it is `404` and has no
   chart.
2. Hidden mode: `GET /api/latency` is `200` and its body is exactly `[]`. The body of
   `GET /api/components/latency` does not contain `secret-check`, `Secret DB` or
   `latencyObjectiveMs`.
3. Hidden mode, stub `/components` answers `500`: `/api/latency` and `/api/components/latency`
   are both `502`, and neither body contains `p95Ms`. A wrong fallback that passes the raw latency
   on fails this case.
4. Components with `showChecks: true`: `/api/components/latency` is `[]`, and the stub sees no
   `/latency` or `/components` read for it.
5. In any layout, the stub never receives `GET /components/latency`.
6. `/api/components/latency?x=1` and `/api/components/latency/` are `404` with `no-store`.
7. A member with day dates shifted by one day against another member: `502`
   `invalid API response`.
8. The stub changes `/components` membership after the raw entry expires: the next answer
   reflects it. Within the period, the cached answer stays, with byte-identical body and the same
   `ETag`.

### Statistic

Component `shop`, `checkIds` `["web", "api", "tcp-db", "web"]`. Day `d`: `web` has p50 80, p95 150,
count 10. `api` has p50 120, p95 140, count 5. `tcp-db` is not in `/latency`.

| Case | Expected | Wrong implementation it catches |
|---|---|---|
| Both have results | p50 `120`, p95 `150`, count `15` | mean p95 145; count-weighted mean p95 146.67; count `2` (members); count `25` (duplicate `web` counted twice) |
| `web` count 0 (nulls), `api` as above | p50 `120`, p95 `140`, count `5` | treating null as 0, or dropping the day |
| Both count 0 | `null`, `null`, `0`, gap in the chart | `0 ms` values |
| Component whose members are all `tcp`/`dns` | no entry, no chart, no latency text | an empty chart or "no latency data yet" |
| `web` also in component `api-gw` | `api-gw` uses `web` too | a check counted only in its first component |
| Loose HTTP check `solo` in no component | its values appear in no entry | an extra "Service" series |
| p95 of 9.96 ms | displays `10` (whole ms from 10, `formatLatencyMs`) | `10.0` |

### Budget

- The default layout with 250,001 bytes fails the test, and with 250,000 it passes (check with a
  stub page or by computing the limit as `<= 250000`).
- With `Café API — Zürich`, `body.length` is smaller than `byteLength`. The test uses
  `byteLength`.
- A default page with 0 charts fails the content assertions even when it is small.
- On `2e3067d` the default layout fails: no charts, and about 334 KB estimated in the plan
  comment.

### Reasons

| Layout | `HIDE_DETAILS` | Open/resolved `reason` served | Fails on `2e3067d` |
|---|---|---|---|
| Hidden mode | `false` | `null`, and `10.9.8.7` and `db.secret.internal` absent from `/api/incidents?status=open`, `?status=resolved`, `/` and `/feed.atom` | yes |
| Hidden mode | `true` | `null` | no |
| No components | `false` | `connect ECONNREFUSED 10.9.8.7:5432` (sanitized text kept) | no, positive control |
| Components, `showChecks: true` | `false` | reason kept | no, positive control |

Masking by `!hasChecks` alone is wrong: it also masks in the no-components fallback (row 3). A
second request with the returned `If-None-Match` gets `304`, and a cache hit returns the same
masked body. A manual incident update `Investigating 10.9.8.7` stays visible, because it is
operator text.

### Assets

- `GET /client.js` returns `cache-control: no-cache` and an `etag` that matches `^"[A-Za-z0-9_-]{27}"$`.
  On `2e3067d` the header is absent. `no-store`, `max-age=0` without a validator, or a missing
  header all fail.
- The same `If-None-Match` gives `304`, a body of 0 bytes, the same `etag`,
  `x-content-type-options: nosniff`, and the `content-security-policy` header.
- Covered: one path each of `/page.css`, `/theme-init.js`, `/theme.css`, `/render.js`,
  `/pulse-kit/escape.js`, `/pulse-contract/index.js` and a zod module reached from
  `/pulse-contract/zod/index.js`.
- Two server instances with different theme files give two different `/theme.css` tags.
- `GET /pulse-contract/nope.js` and `GET /pulse-contract/zod/..%2f..%2fpackage.json` are `404`
  with no `etag` and no `no-cache`.
- `/fonts/space-grotesk.woff2` stays `public, max-age=31536000, immutable`.

### Page snapshot

- `cacheMs` 2000, fake `now` = t0. `GET /` → body A. Set `now` = t0 + 1000 → `GET /` gives a
  body byte-identical to A (the "Rendered" `<time datetime>` is unchanged) and no new stub reads.
  On `2e3067d` the datetime changes.
- `now` = t0 + 2001 (after the raw entries expired) → new stub reads and a new rendered time.
- `/index.html` at t0 + 1000 gives body A. Two concurrent cold `GET /` give one stub read per path
  and identical bodies.
- `If-None-Match` with A's `etag` → `304`, empty body.
- `cacheMs: 0`: two requests with `now` advanced give different bodies and no `etag`.
- A renderer that throws once: that response is not stored, and the next request renders again.
- Two servers with different `showChecks` never share a page.

### Badges

API component `shop` has state `up`.

| Manual incidents | Badge right text | Fails on `2e3067d` |
|---|---|---|
| open `major` naming `shop` | starts with `down`, fill `#c62828` | yes |
| open `minor` | `degraded` | yes |
| `monitoring` status, `critical`, open | `down` | yes |
| `resolved` `major` | `up` | no |
| open `none` | `up` | no |
| API state `down` + open `minor` | `down` | no |
| `/manual-incidents` `404` | `up` | no |
| `/manual-incidents` `500` | `503 unavailable`, `no-store` | yes |

After an incident is created, the badge `etag` changes and the uptime text stays the same. A check
badge in hidden mode still answers like an unknown id.

### Contract pin

- With the pinned contract, the poller fed an `/api/checks` body with
  `"url": "ftp://example.test/"` (details shown) reports `error: "invalid"`. With `9fe5e80` it
  accepts it.
- `package.json` and `bun.lock` both contain `ebcbbb613328494185833f7133f1242910986948` or its
  short form `ebcbbb6` in the lock key. Neither contains `9fe5e80`.

## Contract fields

New names (all owned by status; no contract or config change):

| Name | Kind | Search | Result |
|---|---|---|---|
| `/api/components/latency` | status route | `grep -rn 'components/latency' .repos/contract/src .repos/config .repos/api/src` | 0 hits |
| `ComponentLatency`, `ComponentLatencyResponse` | status types | `grep -rn 'ComponentLatency' .repos/contract/src .repos/config` | 0 hits |
| `componentLatency` | `PollerState` field | `grep -rn 'componentLatency' .repos/contract/src .repos/config` | 0 hits |
| `componentId` (in `ComponentLatency`) | field | `grep -rn 'componentId' .repos/contract/src` | `schema.ts:748` (`componentUptimeSchema.componentId`). Reused on purpose, same meaning; not a collision |
| `highest member check` | label text | `grep -rn 'highest member check' .repos/contract/src .repos/config` | 0 hits |
| `daily-values` | CSS class / `data-key="daily"` | status-only markup | n/a |

`days` reuses the contract `LatencyDay` type and `latencyDaySchema`. No contract type is copied.

## Repository: status

Files:
- `src/server.ts` (latency 404 removed, `/api/components/latency` build, asset memo with `ETag`
  and `304`, page snapshot, template read once, `/bars.js` removed from `tsModules`)
- `src/api-filter.ts` (allow-list entry, no `[]` latency shortcut)
- `src/hidden-checks.ts` (`/api/latency` in `needsComponents` and `hideCheckIds`; reasons masked
  in hidden mode)
- `src/component-latency.ts` (new: types and the pure projection of section 2)
- `src/component-latency.test.ts` (new)
- `src/http-cache.ts`, `src/http-cache.test.ts` (settings-free asset tag)
- `src/poller.ts`, `src/poller.test.ts` (no `hasLatency`; reads both latency routes;
  `componentLatency`; validation)
- `src/ssr.ts` (no `hasLatency`)
- `src/render.ts` (decorative bars, `renderLatencyChart` without its own table, daily-values
  table, component chart labels)
- `src/components-view.ts`, `src/components-view.test.ts` (component chart and table in hidden
  mode)
- `src/sections.ts`
- `src/patch.ts`, `src/patch.test.ts` (roving hooks removed)
- `src/bars.ts`, `src/bars.test.ts` (deleted)
- `src/syndication.ts`, `src/server.syndication.test.ts` (manual incidents on component
  badges)
- `src/render.test.ts`, `src/latency.test.ts`
- `src/server.privacy.test.ts`, `src/server.cache.test.ts`, `src/server.hidden-checks.test.ts`,
  `src/server.ssr.test.ts`, `src/server.test.ts`, `src/server.contract-modules.test.ts` (updated
  and new cases)
- `src/server.page-weight.test.ts` (new)
- `public/client.js`, `public/page.css`
- `e2e/run.ts`
- `package.json`, `bun.lock` (contract pin)
- `README.md`, `AGENTS.md`, `docs/development.md`, `docs/configuration.md`, `docs/operation.md`

Behavior change: yes. Default pages gain latency charts, hidden-mode reasons are masked, assets
and the page gain `ETag`/`304`, component badges change state with manual incidents, and the bars
lose their keyboard role.

### Tool facts (verified)

- Bun 1.4.0: `package.json:9` (`engines`) and `:38` (`packageManager`). CI installs `1.4.0`
  (`.github/workflows/ci.yml:60`; pinned `check.yml` line 24).
- `bun run check` = lint, typecheck, test (`package.json:19`). Lint is `biome check . &&
  pulse-eslint .` (`:15`), Biome `2.6.3` (`:23`). Typecheck runs TypeScript 7 on the root and on
  `e2e` (`:13`). Test is `bun test` (`:14`) with coverage on and 80 % lines
  (`bunfig.toml:2-3`).
- `biome.json` only extends `@lorenzh/pulse-config/biome.json`. At the pinned ref `dc69a12`
  (`package.json:24`), that file's `files.includes` (lines 10-17) leaves out `**/*.html`, so
  `public/index.html` is not checked, while `public/*.js` and `public/*.css` are in scope. The pinned
  file is identical to the config clone (`diff` empty).
- CI `check` job: `.github/workflows/ci.yml:18` uses `lorenzh/pulse-config/.github/workflows/check.yml@dc69a12…`.
  At that ref, lines 25-38 run `bun install --frozen-lockfile`, `bun run lint`,
  `bun run typecheck` and `bun run test` (build steps off). The file is identical to the config
  clone `main`.
- CI `a11y` job: `timeout-minutes: 15` (`ci.yml:51`), Chromium install (`:64`),
  `bun run check:a11y` (`:66`) = `bun e2e/run.ts` (`package.json:18`). The `docker` job builds
  both architectures (`ci.yml` `docker` matrix).

### Tasks

1. Write the failing tests first (sections 1-9 and the counterexamples). Keep the output of the
   runs that fail on `2e3067d` (or on the branch before the fix) for the pull request.
2. Latency matrix and `src/component-latency.ts` (sections 1-2). Replace the test
   "latency is per check: with checks hidden it is 404…" (`src/server.privacy.test.ts:499`) and
   the `404` case in `src/server.cache.test.ts:478-480` with the new matrix.
3. Bars, table and charts (section 3), then the page-weight test (section 4).
4. Reasons (section 5), assets (section 6), page snapshot (section 7), badges (section 8).
5. Contract pin and docs (section 9).
6. `e2e/run.ts`:
   - run three status servers against the stub: default (components, checks hidden), `shown`
     (`showChecks: true`), and `fallback` (`hasComponents = false`);
   - axe (WCAG 2.2 AA) in light and dark at 360 and 1280 px for each;
   - in the default layout: a component latency chart, `.bars[aria-hidden="true"]`, no element
     `.bar[tabindex]`, exactly one tab stop per entry (its `daily-values` summary), `open`
     surviving polls, focus on the summary surviving polls, quiet unchanged polls, live regions,
     and the no-JavaScript view with the table readable after it is opened;
   - replace `checkStructure` and `checkFocusSurvivesPolls`, which use the roving bars.
7. Run `bun start` once against a local stub or api with defaults. Exercise `/`, `/api/latency`,
   `/api/components/latency`, a conditional `GET /client.js` and a component badge. Report the
   command and the result in the pull request.

### Acceptance evidence

Every expected value is a literal written in the test or check.

| # | Check | Expected | Fails on `2e3067d` |
|---|---|---|---|
| A1 | `src/server.privacy.test.ts` new case, no components, defaults: `GET /api/latency` | status `200`, one entry with `checkId` `web`; `GET /` contains `class="latency-chart"` | yes (`404`) |
| A1b | Hidden mode, default settings: `GET /api/components/latency` | `200`, `[{"componentId":"shop","days":[…90…]}]` with day `d` values from the counterexample table (`120`, `150`, `15`); no sentinel | yes (`404`, not allow-listed) |
| A2 | `src/server.page-weight.test.ts` | default ≤ `250000` bytes with 20/20/20 counts; shown ≤ `1000000` with 50 charts; fallback ≤ `1000000` with 50 entries and charts | yes (0 charts) |
| A3 | Hidden mode, `hideDetails: false`: `/api/incidents?status=open` and `/feed.atom` | `reason` is `null`; `10.9.8.7` absent from both bodies and from `/` | yes |
| A4 | `GET /client.js` and the asset route list | `cache-control: no-cache`, `etag` matching `^"[A-Za-z0-9_-]{27}"$`, `304` with 0-byte body on a hit | yes (no header) |
| A5 | `GET /badge/component/shop.svg` with an open `major` manual incident on an `up` component | body contains `down` and `#c62828` | yes (`up`) |
| A6 | Page snapshot clock case | byte-identical body at t0 + 1000; `etag` present; `304` on a hit | yes |
| A7 | Poller with `ftp://` URL | `error === "invalid"`; `package.json`/`bun.lock` hold `ebcbbb613328494185833f7133f1242910986948` / `ebcbbb6` | yes |
| A8 | `grep -n 'validate.ts' docs/development.md` and `grep -n 'no relative runtime imports' AGENTS.md` | no output | yes |
| A9 | `bun run check`, `bun run check:a11y`; CI `check`, both `docker` legs, `a11y` | all green | n/a |
| A10 | Pull request text | the three byte counts from A2 and the counts on `2e3067d`, the `test_cpu_s` medians (main vs branch), and the `bun start` command with its result | n/a |
