# Spec: Status page components (#331)

## Goal
Operators group checks into named, customer-facing components (name, description, optional section heading). The public status page shows components instead of raw checks when any are configured. Internal check config stays private.

## Scope
contract (types, schemas, validators, docs), api (config, reads, docs, e2e compose), status (proxy allow-list, page, badge, feed, setting, docs). Notify: no change. Mentioning components in messages is not cheap (notify reads incidents by check id), so it is skipped. probe, config, kit: no change.

## Non-goals
No manual incidents (F6), no editing UI, no stored component state, no new runtime dependencies, no rework of F3 feed/badges (#268) beyond component additions.

## Decisions (resolve the open points of the issue review)
1. **Combined state** of member check states, first match wins: any `down` gives `down`; any `degraded` gives `degraded`; else, after dropping `maintenance` and `unknown` members, any `up` gives `up`; else any `maintenance` gives `maintenance`; else (all `unknown`) `unknown`. So `maintenance` is ignored next to `up`, and `unknown` is ignored next to any known state (a not-yet-probed check does not turn a healthy component grey). Documented with a test table covering every pair and the all-same cases.
2. **Uptime aggregation**: per day, result-weighted over member checks: sum(up+degraded results) / sum(results) * 100, using each day's `results`; `null` with `results` 0 when no member has results that day. Window value likewise over all 90 days. A check in several components counts in each.
3. **Where uptime lives**: `ComponentWithState` carries the window `uptime` (number 0..100 or null). Per-day bars come from a new route `GET /components/uptime` returning `ComponentUptime[]` (`componentId`, `days` as `UptimeDay[]` with 90 days, `uptime`), in configured order. `GET /uptime` and `UptimeResponse` stay unchanged. The window value in `ComponentWithState` equals that of `ComponentUptime`.
4. **Incidents**: `Incident` is unchanged (`checkId`). `ComponentWithState.incidentIds` lists the ids of open incidents of the member checks, ascending. The page and feed map checkId to components via the member lists from `GET /components`; a check in several components names all of them.
5. **Id rules**: component `id` matches `^[a-z0-9][a-z0-9._-]*$`, max 64 chars, unique among components; separate namespace from check ids (a component may share an id with a check). Check ids with `/` cannot be served by `/badge/<id>.svg` (the segment must not contain `/`), so `/badge/component/<id>.svg` cannot collide. `name` 1..100 chars, `description` max 500, `group` 1..100, all plain text, trimmed, no control characters (same `text` helper as the contract). `checkIds` must be non-empty and free of duplicates; unknown check ids are rejected by the api.
6. **Order**: components keep configured order everywhere. The page orders groups by first appearance; components without `group` form an unheaded block at the position of their first appearance, in configured order (a component stays in its group block, relative order preserved).
7. **Probe isolation**: `components` is a known top-level key of the checks file read only by the api. `/probe/checks` output and the probe are unchanged (no `components`).
8. **Status setting**: `PULSE_STATUS_SHOW_CHECKS`, boolean, default false. With components configured and the setting false, no check appears on the page (including checks that belong to no component). With true, each component lists its member checks below it, and checks that belong to none are listed in a trailing block without heading. Setting has no effect without components. `PULSE_STATUS_HIDE_DETAILS` (default true) still redacts check names, reasons and urls as today, including in the component view; with details hidden, incident reasons are not shown in the component view.
9. **Privacy**: the page HTML, feed and badges must not contain ids or names of hidden checks. `incidentIds` are numeric and may be shown only as counts or as incident entries without check names. `GET /components` in the api needs the same token auth as other reads.
10. **Badges/feed**: `/badge/component/<id>.svg` renders the component uptime (same window and rendering as check badges), label from the component name; unknown component gives 404. Feed entries for incidents of a member check name the component(s) in title/summary (escaped). When no component exists or the check belongs to none, entries stay as today; with components configured and checks hidden, entries never name the check.
11. **Poller**: status polls `/api/components` and `/api/components/uptime` in addition to today's paths. Any failed or invalid path invalidates the snapshot as today (503 behavior from #275). An empty `components` list gives the no-components page; a 404 from the api is an error, not a fallback. Deploy order is contract, api, status.
12. **e2e compose** is owned by the api repo (`compose.yaml`, `compose/checks.json`, `compose/e2e/`); it gets two components (one of two checks, one sharing one check with the first, with a `group`).
13. **Versioning**: contract minor bump with new exports and docs; api and status consume the released contract.

## Required behavior (summary)
See the repository sections. Without a `components` array, every output, page and test behaves as before.

## Risks
- Leaking hidden check names via component view, feed, badge 404/200 differences or HTML attributes: covered by privacy tests.
- Allow-list widening: only the exact two new paths (no queries); all other paths stay 403/404.
- Contract release timing: api and status builds need the published contract.

## Acceptance evidence
1. `GET /components` and `GET /components/uptime` return both e2e components in configured order with state, uptime, `incidentIds`; an unknown check id, unknown key in a component, duplicate component id, or empty `checkIds` makes the api refuse to start.
2. Stopping the target of one member check makes its components `down` with the open incident id listed; maintenance and unknown follow the rule in Decisions.
3. In a browser, the status page shows grouped components with state, uptime bars and incidents and no check names/ids by default; with `PULSE_STATUS_SHOW_CHECKS=true` the checks appear under their component; without `components` the page is as before.
4. `/badge/component/<id>.svg` and `/feed.atom` name the component; other paths remain blocked; hide-details still redacts.
5. Each repo's new tests fail on the old code and pass on the new.

Approver note: status is built before api (contract → status → api), because api's `compose-e2e` builds status from `main`. status tests the new routes against its fake API; api's e2e may then assert that the page shows the components.

## Repository: contract
Files: `src/schema.ts`, `src/validate.ts`, `src/index.ts`, `src/version.ts`/package version, `test/`, `docs/index.md`, README if it lists exports.
- Add `componentSchema` (`id`, `name`, `description?`, `checkIds`, `group?`; rules of decision 5; strict unknown keys), `componentWithStateSchema` (adds `state: CheckState`, `uptime: percent`, `incidentIds: integer[]`), `componentUptimeSchema` (`componentId`, `days`, `uptime`), and a pure helper `combineStates(states)` implementing decision 1 and `aggregateUptime(days[][])` per decision 2 so api and status share one rule. Types `Component`, `ComponentWithState`, `ComponentUptime`, `ComponentsResponse`, `ComponentsUptimeResponse`. Validators and client methods (if the client wraps routes, add `components()` and `componentsUptime()`) in the existing style.
- Docs: the state rule table, uptime aggregation, id rules, route response shapes.
- Tests: table test for every state combination, aggregation tests (empty day, weighting, null), schema accept/reject (bad id, empty or duplicate checkIds, unknown key, too-long name), validators. Each fails on the old code (exports missing).
- Done when: lint, typecheck, tests pass; minor version bumped and ready to publish.

## Repository: status
Depends on api (new routes) and contract.
Files: `src/api-filter.ts`, `src/api-poll.ts`, `src/poller.ts`, `src/settings.ts`, `src/sections.ts`, `src/render.ts`, `src/badge.ts`, `src/syndication.ts`, `src/feed.ts`, matching tests, `docs/configuration.md`, `docs/operation.md`, README, theming docs if CSS hooks are added, `public/` styles.
- Allow-list: add exactly `/api/components` and `/api/components/uptime` (no query); everything else unchanged and still blocked.
- Poller/snapshot: fetch and validate both paths; behavior on failure per decision 11.
- Settings: `PULSE_STATUS_SHOW_CHECKS` (decision 8) with validation tests.
- Page: with components, render by group in configured order (decision 6), each with name, description (escaped), state, 90-day uptime bars from component uptime, window uptime, and incidents for member checks (redaction per decision 8/9); checks shown under components only when the setting is true. Without components: unchanged output (snapshot tests for equality).
- Badge `/badge/component/<id>.svg` and feed component naming (decision 10), served from the proxy cache; unknown component 404; check badge route unchanged.
- Tests: allow-list, settings, sections/render with and without components, hide-details redaction, no hidden check id/name in HTML, feed, badges, poller failure. Each fails on old code.
- Browser check: run the api e2e compose stack and load the page with and without components (and with the show-checks setting); record in the PR what was seen.
- Done when: lint, typecheck, tests pass and the browser check is described.
## Repository: api
Depends on contract.
Files: `src/config.ts` (+ tests `config.components.test.ts`, `config.strict.test.ts`, `config.examples.test.ts`), `src/server.ts`, `src/service.ts`/`state.ts` as needed, `src/server.reads.test.ts`, `checks.example.json`, `compose.yaml`, `compose/checks.json`, `docs/`, README.
- Config: accept optional top-level `components` in the checks file; validate with the contract schema and the set of known check ids (pattern of `maintenance`); reject unknown check ids, duplicate component ids, unknown keys (top-level and per component) with path-bearing errors; a check may be in several components. Components are not passed to `/probe/checks`.
- Routes (same auth as other reads): `GET /components` returns `ComponentWithState[]` in configured order (state via contract `combineStates` over current check states including maintenance; `uptime`; `incidentIds` of open incidents of member checks). `GET /components/uptime` returns `ComponentUptime[]`. Both return `[]` without components. Responses validate against the contract.
- Compose: `compose/checks.json` gets two components, e.g. `web` (group "Services", two checks) and `public-api` (group "Services" or a second group, sharing one of them). Update `checks.example.json` and docs (checks file, routes, examples).
- Tests: config accept/reject cases, route output with states down/degraded/maintenance/unknown, open incident ids, shared check in two components, empty list, auth required, probe checks unchanged, example file test. Each fails on old code.
- Done when: checks, tests pass; the e2e compose stack serves both components.

