# Spec #458: hidden checks leak names and ids; DNS internals sent to the browser

Security audit M5 (Medium) and the DNS part of L7 (Low). Checked against `main` of pulse-status at
`20ccc80`. Issue review: `.factory/work/458/issue-review.md`.

## Goal

When checks are hidden, no response of the status server shows a check's name or id. This covers
the `/api/*` proxy, the server-rendered page `/`, `/feed.atom` and every badge. A DNS check's
`expected` and `resolver` never reach the browser. Page, feed and badges keep their content and
labels.

## Definitions

- **Hidden mode**: `PULSE_STATUS_SHOW_CHECKS` is off (`hasChecks` false) **and** the upstream
  `GET <api>/components` returns a non-empty list. Without components the page shows checks by
  name by design ("has no effect without components"), so that case stays unchanged. With
  `PULSE_STATUS_SHOW_CHECKS=true` nothing changes.
- **Snapshot**: what the server must know in order to filter in hidden mode. It is read from the
  unfiltered upstream answers of `/components` (each component `id` and `checkIds`, in order) and
  `/checks` (the set of active check `id`s).
- **Hidden key**: the string that replaces a check id in hidden mode. It reveals no check id or
  name and is deterministic, so several replicas give the same answer:
  - a check that belongs to one or more components: `components:` followed by the ids of the
    components it belongs to, in `/components` order, joined with `+`. Example: check `db` in
    components `shop` and `api` (in that order) → `components:shop+api`. Component ids match
    `^[a-z0-9][a-z0-9._-]*$` (contract `COMPONENT_ID`), so neither `:` nor `+` can occur inside an
    id and the key is unambiguous;
  - an active check (in the `/checks` snapshot) that belongs to no component: `service`
    (exported as `HIDDEN_CHECK_KEY`, next to `HIDDEN_CHECK_LABEL = "Service"`);
  - a check id that is neither in a component nor active (for example an incident of a check
    removed from the checks file): it has no key and its entries are dropped. The page drops
    them already today, because they have no label.

  Component ids are public already (`/api/components`, component badges). A key tells only which
  set of components a check belongs to, which the labels "Shop, API" show anyway.

## Scope

Target `status` only. The server-side filter (`src/api-filter.ts` plus a new pure module), the
proxy (`src/server.ts`), the browser label join (`src/components-view.ts`), the feed join
(`src/feed.ts`), docs and tests.

## Non-goals

- No api, contract or config change. The api keeps serving full data to the status server.
- `/metrics` and `/readyz` are not moved to an ops port (rest of L7, separate issue).
- No change when checks are shown (`PULSE_STATUS_SHOW_CHECKS=true`), and no change without
  components.
- Operator-written text (component names, descriptions, maintenance notes, manual incidents) stays
  public as it is. If an operator writes a check name into a note, that is not covered here.
- Incident `reason` keeps today's hide-details rule (`null` when hidden, sanitized when shown).
  Probe reasons name hosts and status codes, not check ids or names.
- Check counts may still be inferred (for example from component uptime). Only names and ids are
  in scope.

## Required behavior

### Proxy answers in hidden mode

The allow-list in `filterApiBody` stays the mechanism. Hidden mode is an extra step after the
allow-list, not a deny list. Changes per route:

| Route | Hidden mode answer |
|---|---|
| `/api/checks` | `[]` |
| `/api/uptime` | `[]` (per check; the page draws per-check bars only when checks are shown, and every check badge is already a `404` in hidden mode) |
| `/api/latency` | `404`, unchanged (already the case whenever `hasChecks` is false) |
| `/api/incidents?status=open` and `?status=resolved` | each incident is `{ id, checkId: <hidden key>, openedAt, resolvedAt, reason }`; `reason` follows hide-details as today; incidents without a hidden key are dropped; the resolved window (`limitResolvedWindow`) still applies |
| `/api/maintenance` | each window is `{ checkId: <hidden key>, start, end, note }`; windows without a hidden key are dropped |
| `/api/components` | every field as today, but `checkIds` holds the distinct hidden keys of the member checks, in order of first appearance. The list is never empty, because the contract requires at least one member |
| `/api/components/uptime` | unchanged (`componentId` only) |
| `/api/manual-incidents` | unchanged (`componentIds` only; manual incident ids are integers) |

`incidentIds` on components and incident `id`s are api integers (`INTEGER AUTOINCREMENT`) and stay.

Order of the reads and failure handling (fail closed):

1. With `hasChecks` true, nothing changes: no snapshot is read and the answers are byte-identical
   to today's.
2. With `hasChecks` false, an answer for one of the routes `/api/checks`, `/api/uptime`,
   `/api/incidents?…`, `/api/maintenance` or `/api/components` needs the snapshot. The route's own
   upstream read and the snapshot reads may run in parallel.
3. If the route's own upstream read fails, the answer is the same error answer as today.
4. If the route's own read succeeds but a snapshot read fails, the answer is `502` with the
   generic body today's proxy uses for that failure kind. That covers a non-200 status, a
   timeout, a network error, invalid JSON, a wire mismatch, or a body that is not an array of
   objects with a string `id` (and, for components, a string-array `checkIds`). The data is never
   served unfiltered. The route's wire header is still forwarded.
5. Snapshot components `[]` means not hidden mode: the route is served as today (checks shown by
   design).
6. The snapshot reads go through the same single-flight cache as the proxy, with the same
   `cacheMs` and their own cache keys (for example `raw:/components`, `raw:/checks`). The cached
   value is the raw body, which is never sent to a client. With caching on, hidden mode adds at
   most one upstream read of `/components` and one of `/checks` per cache period, whatever the
   number of visitors. With `PULSE_STATUS_CACHE_MS=0` every answer reads the snapshot afresh.
   Implementers may reuse a route's own raw read for the snapshot (the `/api/checks` and
   `/api/components` routes read exactly those paths), as long as no raw body is served.
7. Each served answer is cached per path as today. When components appear or disappear, a cached
   answer can stay for at most `cacheMs`. An answer cached before components existed was computed
   while checks were shown by design, so this is no leak. An answer computed in hidden mode never
   holds ids.

SSR (`renderState`), the feed and the badges keep reading the same filtered answers through
`cachedAnswer`, so they see exactly what a browser sees. No second, unfiltered path reaches any
renderer.

### DNS checks (every mode)

`cleanTarget` for `type: "dns"` copies only `dnsName` and `recordType`, and only when details are
shown. It never copies `expected` or `resolver`, whether details are shown or hidden and whether
checks are shown or hidden. Update the `validServedChecks` comment in `src/poller.ts` if it names
these fields. Their absence keeps contract validation passing, because both fields are optional
in `dnsCheckSchema`.

### Browser label join (`src/components-view.ts`)

- Export `HIDDEN_CHECK_KEY = "service"`.
- In `checkLabels`, the hidden branch (`showChecks` false) also maps `HIDDEN_CHECK_KEY` to
  `HIDDEN_CHECK_LABEL`. Component labels come from `component.checkIds` exactly as today, so the
  key `components:shop+api` gets the label "Online shop, API" without any new code. The existing
  mapping of every `view.checks` id to `Service` stays, so data without hidden keys still works:
  for example a cached answer from before components appeared.
- The shown branch is unchanged.
- The page renders entries with the label, never with the key. The maintenance `data-key` already
  uses the label. Check that no hidden key reaches the HTML when a label is missing: entries
  without a label are already dropped by `labeledIncidents` and `labeledMaintenance`.

### Feed (`src/feed.ts`)

- With components and `showChecks` false, an incident is kept when its `checkId` has a label:
  - it is in some component's `checkIds`, and then the label is the owner names, as today;
  - or it equals `HIDDEN_CHECK_KEY`, and then the label is `Service`;
  - or it is a listed check, as today (for data without hidden keys).

  The incident no longer needs to be in `checks`, which is `[]` in hidden mode. Titles stay
  `<label>: Open|Resolved`, and entry ids stay `incident-<id>`.
- With `showChecks` true or without components, `entries` is unchanged.

### Badges

- Check badges: with components and hidden checks, every check badge already answers `404`
  before using `checks`. Because `/api/checks` is now `[]`, the `404` stays indistinguishable for
  known and unknown ids. `503` when the components read fails stays.
- Component badges: unchanged (they read `/api/components` and `/api/components/uptime`).

### Docs

- `docs/operation.md`:
  - Components bullet `PULSE_STATUS_SHOW_CHECKS`: replace "The proxied JSON of `/api/checks` is
    filtered as before; the setting controls what the page, feed and badges show" with the hidden
    mode answers above (`/api/checks` and `/api/uptime` empty; incident, maintenance and component
    check ids replaced by keys made from component ids, or `service`; fail closed with `502`
    while components cannot be read).
  - Feed bullet: fix "instead of the check, An incident" → "instead of the check. An incident".
  - DNS sentence (~49): replace "`expected` and `resolver` of a DNS check are passed on but not
    drawn" with "`expected` and `resolver` of a DNS check are never served".
  - "What is public": name the hidden mode replacements in the allow-list lines for incidents
    `checkId`, maintenance `checkId`, uptime and components `checkIds`, and the DNS fields.
- `docs/theming.md` (~110, proxied reads): add one sentence that with `PULSE_STATUS_SHOW_CHECKS`
  off and components configured, the proxy also reads `/components` and `/checks` upstream to
  filter.
- `docs/configuration.md` `PULSE_STATUS_SHOW_CHECKS` row: add "with `false` and components, no
  check name or id is served". Update `README.md` only if a sentence there becomes wrong.

## Risks

- **Breaking the join.** If the keys on incidents and maintenance and the keys on
  `components.checkIds` come from different snapshots (different cache periods), a label can be
  missing or wrong for at most one cache period. Today's per-path caching already has this skew.
  Mitigation: all keys come from one function of (component order, membership, active ids), so
  equal upstream data always gives equal keys.
- **Fail closed costs availability.** If `/components` or `/checks` upstream fails, the hidden-mode
  check routes answer `502`. The page treats incidents, maintenance and components as required,
  so it shows the existing error banner and keeps the last data. That is the same as today when
  `/components` fails, because the page needs it anyway. The feed and component badges answer
  `503`, as they already do when `/components` fails.
- **Contract validation in the browser.** Hidden keys are non-empty strings and each component's
  `checkIds` stays non-empty and free of duplicates, so `validateIncidentsResponse`,
  `validateMaintenanceResponse` and `validateComponentsResponse` keep passing. `[]` passes
  `validServedChecks` and `validateUptimeResponse`.
- **Regression in shown mode.** All hidden-mode code is behind `hasChecks === false`. Existing
  tests with checks shown or without components must pass unchanged.
- **Cognitive complexity ≤ 15 (SonarJS).** Put the key logic in a new pure module instead of
  growing `fetchUpstream`.

## Performance impact

Status only. The api's `bench/budgets.json` metrics (`startup_cpu_ms`, `load_cpu_s`,
`idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, build CPU, wall-clock startup, p95 latency, rps,
image size) measure pulse-api, and this change does not touch the api's code. None of them moves:
none expected. On the status server, hidden mode adds at most one upstream read each of
`/components` and `/checks` per cache period (both are already read once per period by any
visiting page). It also adds a linear pass over already parsed arrays. The implementer confirms
with the existing `server.cache.test.ts` style: count the fake-api calls per cache period with
two concurrent page loads in hidden mode. That is at most one call per upstream path per period.

## Security impact

Security impact: yes. The change alters what the public proxy serves (responses at a trust
boundary). It closes M5 (hidden check names and ids) and the DNS part of L7.

Checklist items that apply:

- **Secrets and private details in responses**: no check id or name in any response in hidden
  mode; no DNS `expected` or `resolver` in any mode. The sentinel tests prove both.
- **Input validation**: the snapshot bodies come from another service and are validated at the
  edge (array of objects, string `id`, string-array `checkIds`). Malformed snapshots fail closed
  with `502`; they are never passed through.
- **Status codes**: unchanged for every route except the new `502` on a failed snapshot read.
  Check badges keep the identical `404` for known and unknown ids.
- **Errors and logs**: the `502` body is the existing generic text, with no upstream detail and no
  ids.

Not touched: auth, probe HTTP client, file writes, dependencies, Dockerfile, CI.

## Rollout order

One repository (`status`). It needs no contract, api or config change and works against the
current api (every route it reads already exists). An older status server keeps leaking until it
is updated. There is no compatibility concern: the browser code is served by the same server
process, so page and proxy always match.

## Counterexamples

Each case below is a hard rule that a wrong implementation would get wrong.

1. **Deny list instead of mapping.** Deleting only `checkId` from incidents fails browser
   validation (`checkId` is required) and loses every incident label → the page shows the "unexpected
   answer" banner. Required: `checkId` is replaced by a hidden key.
2. **Unkeyed hash of the check id** (for example `sha256(id)`) is rejected: ids are short and
   guessable, so the hash can be reversed by brute force. A per-process random key is rejected
   too: two replicas would serve keys that do not match across the incidents and components of
   one poll.
3. **Check in two components**: `db` in `shop` and `api` → incident key `components:shop+api`,
   which is in both `shop.checkIds` and `api.checkIds`. The page label is "Online shop, API", as
   today. A wrong implementation that takes only the first owner gives "Online shop".
4. **Two checks in the same component** with identical keys: `shop.checkIds` lists the key once
   (contract: no duplicates). Listing it twice fails `validateComponentsResponse`.
5. **Check in no component**: incident key `service`, page label `Service`, feed title
   `Service: Open`. Not the check name, not the id.
6. **Incident of a removed check** (inactive, in no component): dropped from the incidents and
   maintenance answers. It must not appear as `service`. Today's page does not show it either.
7. **Components read fails** (`/components` answers 500 upstream) while `hasChecks` is false:
   `/api/incidents?status=open` answers `502`, never the incident list with real `checkId`s.
8. **Components read returns `[]`**: not hidden mode. `/api/checks` lists checks with ids and
   names as today. The output must equal today's output byte for byte.
9. **`PULSE_STATUS_SHOW_CHECKS=true` with components**: no snapshot reads (fake-api call counts
   unchanged) and answers identical to today's.
10. **DNS check with details shown** (`PULSE_STATUS_HIDE_DETAILS=false`): `/api/checks` has
   `dnsName` and `recordType` but no `expected` or `resolver`. With details hidden it has none of
   the four.
11. **Check badge of a hidden check** `/badge/sentinel-id.svg`: `404 not found`, with the same
   body and headers as `/badge/does-not-exist.svg`.
12. **Sentinel inside the reason** is out of scope (operator or probe text). The fixture keeps
    reasons, notes and component names free of the sentinel strings, so the test checks only
    the id and name fields.

No statistics are introduced or changed.

## Contract fields

No new names in the contract, config or api. The change adds no field, key, or route. Hidden keys
are string values in the existing fields `checkId` and `checkIds`. The new status-internal
constant `HIDDEN_CHECK_KEY` and its value `service` do not collide with anything:

```
$ grep -rn '"service"\|components:' .repos/contract/src .repos/config
.repos/contract/src/admin.ts:152:    components: z.array(adminComponentSchema, { error: "must be an array" }),
.repos/contract/src/schema.ts:976:/** GET /components: one entry per configured component, in configured order. */
$ grep -rn 'HIDDEN_CHECK_KEY\|hidden-checks' .repos/contract/src .repos/status/src
(no output)
```

The two hits are an object key (`components:`) and a comment. Neither is a value of
`checkId`/`checkIds`.

## Repository: status

Files:
- `src/hidden-checks.ts` (new, pure: parse the snapshot bodies into an owner map; compute hidden
  keys; rewrite the filtered bodies of `/api/checks`, `/api/uptime`, `/api/incidents`,
  `/api/maintenance` and `/api/components` for hidden mode)
- `src/hidden-checks.test.ts` (new)
- `src/api-filter.ts` (DNS allow-list: drop `expected` and `resolver`; doc comment)
- `src/api-filter.test.ts`
- `src/server.ts` (snapshot reads through the single-flight cache under internal keys; hidden mode
  rewrite after `filterApiBody`; fail closed with `502`)
- `src/components-view.ts` (`HIDDEN_CHECK_KEY`; `checkLabels` hidden branch)
- `src/components-view.test.ts`
- `src/feed.ts` (`entries` keeps incidents labelled by components or `HIDDEN_CHECK_KEY` in hidden
  mode)
- `src/feed.test.ts`
- `src/poller.ts` (comment only, if it names DNS `expected`/`resolver`)
- `src/server.privacy.test.ts` (or a new `src/server.hidden-checks.test.ts`): sentinel and DNS
  tests
- `src/server.components.test.ts` and `src/server.syndication.test.ts`: page, feed and badge
  behavior in hidden mode
- `e2e/run.ts` (only if the components cell needs a hidden-check incident or maintenance window
  to show the labels)
- `docs/operation.md`, `docs/theming.md`, `docs/configuration.md`, `README.md` (only if a sentence
  becomes wrong)

Behavior: as in "Required behavior" above.

Checks (TDD, written first and seen failing on `main`):

1. **Sentinel test** (server level, real `createStatusServer` against a fake api on `127.0.0.1:0`,
   like `server.privacy.test.ts`). The fake api has:
   - components `shop` ("Online shop") and `api` ("API");
   - a check `{ id: "sentinel-id", name: "SENTINEL-NAME", type: "http" }` in `shop`;
   - a second check `{ id: "sentinel-loose", name: "SENTINEL-LOOSE" }` in no component;
   - a third check `db` in both components;
   - for each check, an open incident, a resolved incident within 7 days and a future maintenance
     window;
   - `/uptime` and `/latency` entries for all checks;
   - a manual incident on `shop`.

   With `showChecks: false`, `publicUrl` set, and `hideDetails` true and false, it requests every
   route the page can reach: each path in `ALLOWED_API_PATHS`, `/`, `/feed.atom`,
   `/badge/sentinel-id.svg`, `/badge/sentinel-loose.svg`, `/badge/component/shop.svg`. No body
   contains `sentinel-id`, `SENTINEL-NAME`, `sentinel-loose` or `SENTINEL-LOOSE` (case-sensitive
   substring on the raw body). The test fails on `main` (mutation output in the PR).
2. **DNS test**: a DNS check `{ expected: ["10.9.8.7"], resolver: "10.0.0.53" }`, with
   `hideDetails` true and false, and `showChecks` true and false (with and without components).
   No body of the routes above contains `10.9.8.7` or `10.0.0.53`. With details shown,
   `/api/checks` still has `dnsName` and `recordType`.
3. **Function in hidden mode** (same fixture):
   - the SSR page `/` lists the open and resolved incidents and the maintenance labelled
     "Online shop", "Online shop, API" and "Service";
   - the summary counts components;
   - `/feed.atom` has those incidents titled `Online shop: Open`, `Online shop, API: Open` and
     `Service: Open` (and the resolved ones);
   - `/badge/component/shop.svg` is `200`;
   - `/badge/sentinel-id.svg` is the same `404` as `/badge/unknown.svg`;
   - the browser poller (`createPoller` against the proxy answers) refreshes with `error: null`,
     which proves the contract validation passes.
4. **Fail closed**: the fake `/components` answers 500 (and, in a second case, malformed JSON).
   `/api/incidents?status=open`, `/api/maintenance`, `/api/components`, `/api/checks` and
   `/api/uptime` answer `502` and contain no sentinel. `/api/components/uptime` and
   `/api/manual-incidents` are unaffected.
5. **Unchanged modes**: with `showChecks: true` (with components), and with `showChecks: false`
   without components, the existing tests pass unchanged. One explicit test compares the bodies
   to the output of `filterApiBody` alone and checks that the fake api gets no extra `/components`
   or `/checks` calls.
6. **Cache**: in hidden mode, two concurrent loads of `/` within one cache period cause at most
   one upstream call per path (`/components`, `/checks`, and each route).
7. Unit tests of `src/hidden-checks.ts`: key for 0, 1 and 2 owners; deduplicated `checkIds` in
   first-appearance order; dropping of unknown inactive ids; malformed snapshot rejected.

Completion evidence (in the PR):
- `bun run check` green (coverage ≥ 80 %, lint, typecheck) and CI green.
- Mutation output: the sentinel test (1) and the DNS test (2) fail on `main` (or with the change
  reverted) and pass with it.
- Browser check: `bun start` (or `e2e/run.ts`) with components and `PULSE_STATUS_SHOW_CHECKS=false`.
  Include a screenshot of the page with component labels on incidents and maintenance. Include
  the output of `curl /api/checks`, `/api/incidents?status=open`, `/api/components` and
  `/feed.atom`, and the status of a component badge.
- `docs/operation.md` diff with the typo fix.
