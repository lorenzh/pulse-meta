# Issue review: #331 Status page components

Verdict: specifiable. No blocking question; the points below are decided by the plan (defaults given).

## Current behavior (inspected on `main` of the clones)
- contract: `schema.ts` has `incidentSchema` (`checkId`), `checkUptimeSchema` (90 days, `uptime`), `checkStateSchema` (up, degraded, down, unknown, maintenance), validators, docs. No component type.
- api: checks file is `{ "checks": [...], "maintenance": [...] }`; `config.ts` validates maintenance with the set of known check ids, which is the pattern for `components`. Routes: `/results /checks /probe/checks /uptime /incidents /maintenance`, plus ops paths. `/probe/checks` and `compose/` configs exist (`compose/e2e/checks.json`, `compose/demo`).
- status: `api-filter.ts` has an exact path+query allow-list (`/api/uptime`, `/api/checks`, `/api/maintenance`, `/api/incidents?status=open|resolved`); `PULSE_STATUS_HIDE_DETAILS` defaults to true; `/feed.atom` and `/badge/<id>.svg` are served from the proxy cache (`syndication.ts`, `feed.ts`, `badge.ts`), `sections.ts` / `render.ts` build the page.
- notify: no change.

## Open points (plan must decide)
1. Combined state rule. Proposal: any `down` gives down; else any `degraded` gives degraded; else all-`maintenance` gives maintenance; mixed `maintenance` with up gives up (maintenance checks are ignored); `unknown` checks are ignored if at least one other check is known, and the component is `unknown` only if all are unknown. Open: should `unknown` beat `up` (conservative) instead? Pick one and document it with a test table.
2. Component uptime aggregation. Proposal: per day, result-weighted over member checks (sum(up+degraded)/sum(all)); null when no results; window value likewise. Needs per-day result counts, which `uptimeDaySchema` has (`results`). A check in several components counts in each.
3. Uptime route: new `GET /components/uptime` vs extending `/uptime`. Prefer a new route (keeps `UptimeResponse` unchanged). Decide the shape (`componentId`, `days`, `uptime`) and whether it is added to the status allow-list as `/api/components` and `/api/components/uptime`. Alternative: embed uptime into `ComponentWithState`; the issue says "its uptime" in `ComponentWithState`, so the plan must pick one place and not duplicate.
4. Incidents: "component view lists affected components" is ambiguous. Proposal: `ComponentWithState.incidentIds` (open incidents of member checks); incidents stay unchanged (`checkId` only); the page and feed map checkId to components via the member lists. A check in several components makes the feed entry name several components.
5. Id rules: component id charset, uniqueness, and collision with check ids (separate namespaces; badge path `/badge/component/<id>.svg` must not collide with a check id route `/badge/<id>.svg`; check whether check ids may contain `/`). Max lengths for name, description, group. Empty `checkIds` rejected? Duplicate ids inside one `checkIds` rejected? (Propose: reject both.)
6. Ordering and groups: components render in configured order; groups ordered by first appearance; ungrouped components first or in place (decide). `GET /components` returns configured order.
7. Probe config: `/probe/checks` and the probe must not see `components` (only the api reads it). Check that strict unknown-key rejection also covers the top-level key and component objects; `components` must be a known top-level key.
8. Status page setting: name and default for "show checks under their component" (propose `PULSE_STATUS_SHOW_CHECKS`, default false). Which checks does the page show when components exist but some checks belong to none? Propose: unassigned checks are hidden too (consistent with "hidden by default"), but the setting shows them; confirm. Hide-details and redaction apply to check names/reasons under components and to incident reasons.
9. Privacy: `ComponentWithState` is a public-safe shape (no urls); `GET /components` in the api is behind the same token auth as other reads. Check names are internal: component view must not leak check ids/names when checks are hidden. Incident `reason` text of member checks: show only under the same redaction rules (propose: not shown in component view unless details are shown). `incidentIds` leak only numeric ids, but ids of hidden checks must not appear in the page HTML.
10. Badges: per component uptime badge (same window and rendering as check badges); unknown component gives 404; label from the component name. Feed: entry title names the component(s); when checks are hidden, feed must not name check ids/names. Feed/badge are from F3 (#268, merged); do not redo them.
11. Poller/cache: status polls one more path; stale or failed `/components` fetch while other paths succeed: define behavior (propose: treat as the whole snapshot being invalid, as for other paths, 503 as in #275). An older api without `/components` (404): fall back to the no-components page, or fail? Propose fallback only on empty list; 404 is an error. Deploy order contract, api, status makes this moot.
12. Contract release: api and status consume the new contract version; the child issues depend on a published contract (see `dependsOn`: contract, then api, then status). `compose-e2e` is in api (`compose/e2e/checks.json`) and perhaps status; the plan names the repo that owns it.
13. Version/compat: a new contract export means a minor bump and docs in `contract/docs`; api docs for the checks file and routes; status docs for the setting and allow-list.
14. Notify: no change; mentioning components in messages is not cheap (notify reads incidents by check id), so propose skipping and say so in the plan.
15. Test requirement "each new test fails on the old code" and "works in a browser with and without components": needs a browser step (compose-e2e with two components: e.g. one with two checks, one with a shared check to cover the several-components case).

## Assumptions
- Component state is computed on read in the api from current check states; nothing is stored in the database.
- No new runtime dependencies.
- `description` is plain text, escaped on the page and in the feed.
- Manual incidents (F6) and any editing UI are out of scope.

## Acceptance check
With the e2e compose stack and a checks file with two components (one of two checks, one sharing a check with the first):
1. `GET /components` returns both in configured order with state, uptime and `incidentIds`; a checks file with an unknown check id or unknown key in a component fails to start.
2. Stopping the target of one member check makes its components `down` (or per the rule), with an open incident listed; maintenance and unknown cases follow the documented rule.
3. The status page shows the components grouped by `group` in configured order with state, uptime bars and incidents, and no raw check names or ids by default; with the show-checks setting the checks appear under their component.
4. `/badge/component/<id>.svg` and the feed name the component; the proxy allows only the new read paths (others still 403/404); hide-details still redacts.
5. Without a `components` array, the page, API output and tests behave as before.
6. Every repo's new tests fail on the old code and pass on the new.
