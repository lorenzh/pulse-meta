# Issue review: #458, hidden checks leak names and ids; DNS internals sent to the browser

Target: `status` only (checked against `main` of pulse-status at `20ccc80`).

## Verified current behavior

- `src/api-filter.ts`, `filterApiBody`: `hasChecks` (`PULSE_STATUS_SHOW_CHECKS`) only affects `/api/latency`, which returns `[]`, and the proxy answers `404` for it (`server.ts` `proxyApi`). Every other cleaner ignores `hasChecks`.
- What still carries a check id or name while checks are hidden:
  - `/api/checks`: `id`, `name`, `maintenance.checkId`, `locations[].result.checkId`.
  - `/api/incidents?status=open|resolved`: `checkId` (`cleanIncident`).
  - `/api/maintenance`: `checkId` (`WINDOW_FIELDS`).
  - `/api/uptime`: `checkId`.
  - **`/api/components`: `checkIds`.** The issue does not name this route, but it lists every member check id, so it falls under "every other proxied route".
  - Clean: `/api/components/uptime` (`componentId`), `/api/manual-incidents` (`componentIds`; incident ids are integers or manual ids, not check ids), `/api/latency` (`[]`/404). Incident ids in the api are `INTEGER AUTOINCREMENT` (api `src/db.ts`), so `incidentIds` on components and `incident:<id>` keys show no check id.
- DNS: `cleanTarget` copies `dnsName`, `recordType`, `expected`, `resolver` when details are shown. Nothing in `src/` or `public/` reads `expected` or `resolver`. `docs/operation.md` says "`expected` and `resolver` of a DNS check are passed on but not drawn". That sentence must change.
- `docs/operation.md` (Components section): "The default `false` shows no check name or id in the page, feed or badges. … The proxied JSON of `/api/checks` is filtered as before". This describes the leak. Typo: "instead of the check, An incident".

## Why the change is not only a filter change (key finding for the plan)

The filtered proxy answers are not used only by the browser. The same filtered cache (`cachedAnswer` → `filterApiBody`) also feeds:
1. **SSR** (`src/ssr.ts` `renderState`): runs the browser poller against `cachedAnswer`.
2. **Feed** (`src/syndication.ts` `serveFeed` → `feed.ts` `entries`): it drops every incident whose `checkId` is not in `/api/checks`, and it labels incidents through `component.checkIds`.
3. **Badges** (`serveBadge`, `serveComponentBadge`): they read `/api/checks`, `/api/uptime` and `/api/components`.

The browser also joins on check ids:
- The poller validates `/api/incidents`, `/api/maintenance` and `/api/components` with the contract validators, which require `checkId` and `checkIds` strings (`validServedChecks` fills placeholders only for `/checks`).
- `components-view.ts` `checkLabels` maps `component.checkIds` to component names. It maps every check in `/api/checks` to `Service` (#373). `labeledIncidents` and `labeledMaintenance` drop entries whose `checkId` has no label.

So if `/api/checks` returns `[]` and `checkId` and `checkIds` are dropped:
- the browser fails validation (refresh error), or, if only `/api/checks` is emptied, every incident of a check in no component loses its `Service` entry;
- the feed loses every check incident;
- the page, feed and badges no longer render as required.

The plan must choose one consistent approach. Candidate approaches (the plan decides; none needs a person's decision):
- **A. Split raw and public data on the server.** SSR, feed and badges read the unfiltered (or check-preserving) upstream answer from the cache. Only the browser-facing `/api/*` response gets the hidden-check filter. The browser cannot join on check ids any more, so the hidden-mode answer must carry a join key that is not a check id. Examples: incidents and maintenance carry an opaque per-entry token or the owning component ids; components carry the same tokens instead of `checkIds`; one shared token for "no component" (→ `Service`). Placeholders, or poller/view changes, keep contract validation passing.
- **B. Replace check ids with non-identifying tokens everywhere in the hidden-mode proxy output.** One token per distinct set of owning components, for example derived from the public component ids, plus a fixed token for checks in no component. `/api/checks` contains only placeholder entries for those tokens, with a neutral name, or the view maps unknown tokens to `Service`. Feed, badges and SSR keep working on the same data. Avoid a per-process random key: several replicas behind a load balancer would answer one poll with tokens that do not match. Avoid an unkeyed hash of the check id: ids are guessable and could be reversed by brute force.
- Whatever the choice: names and ids must not appear in the SSR HTML (`/`), the feed or any badge either. Today they do not in hidden mode, so this must stay true after the change.

## Open points (non-blocking, for the plan)

1. **Scope of "hidden":** the page hides checks only when components exist. Without components the page lists checks by name whatever `PULSE_STATUS_SHOW_CHECKS` says ("has no effect without components"). The filter must apply only when `hasChecks` is false and `/api/components` is non-empty. That needs the components answer at filter time. The plan must define the following:
   - the order of the reads;
   - what happens when the components read fails: fail closed (hide, or `503`/`502`) rather than leak;
   - how cache entries per path stay consistent when components appear or disappear.
2. `/api/uptime` while hidden with components: the page draws per-check bars only when checks are shown, so `[]` (or a 404 like latency) is the smallest change. Check whether a badge still needs it: with components and hidden checks every check badge is already a 404.
3. `/api/maintenance` while hidden: the page needs only the label (component names / `Service`), `start`, `end`, `note`. The maintenance sort tie-break (`a.checkId.localeCompare`) and keys must work with whatever replaces `checkId`.
4. `/api/checks` `locations[].result.checkId` and `maintenance.checkId` also go away if `/api/checks` is no longer empty.
5. Operator-written text (component names, maintenance notes, manual incidents) is public by design. If an operator puts a check name there, that is not a leak this issue covers. The sentinel test fixture must keep component ids and names, notes and reasons free of the sentinel strings.
6. Incident `reason` while hidden with details shown (`PULSE_STATUS_HIDE_DETAILS=false`): probe reasons do not contain check ids or names in practice (hosts, status codes). They stay as they are. The issue does not ask to null them.
7. DNS: drop `expected` and `resolver` from the allow-list in every mode. `dnsName` and `recordType` stay under hide-details. Also update the poller comment and the docs allow-list paragraph.
8. Docs: rewrite the Components bullet on `PULSE_STATUS_SHOW_CHECKS`, the "What is public" allow-list lines (incidents `checkId`, maintenance `checkId`, uptime, components `checkIds`, DNS fields), the DNS sentence, and the typo ("instead of the check. An incident…").
9. Browser check: `e2e/run.ts` already has a components cell. The PR shows the page with components and hidden checks rendering, plus the feed and a component badge.

## Assumptions

- "Checks hidden" means `PULSE_STATUS_SHOW_CHECKS=false` **and** at least one component. Without components nothing changes, because the checks are then shown by design. This follows the issue intro ("With components configured …") and the non-goal "No change when checks are shown".
- No api or contract change. The status server may change its poller, views and syndication code as long as the page, feed and badges look the same.
- Check counts may still be inferable (for example from component uptime). Only names and ids are in scope.

## Derived acceptance check

1. Sentinel test (server level, through the real proxy, like `server.privacy.test.ts`). Fake api with at least one component, `showChecks` false, and these checks, each with open and resolved incidents and a maintenance window:
   - a check `{ id: "sentinel-id", name: "SENTINEL-NAME" }` inside a component;
   - a second sentinel-style check in no component.

   Request every route the page can request: the nine `/api/*` paths, `/`, `/feed.atom`, `/badge/sentinel-id.svg`, `/badge/component/<id>.svg`. With `PULSE_STATUS_HIDE_DETAILS` true and false, no response body contains `sentinel-id` or `SENTINEL-NAME` (or the second check's id or name). The test fails on current `main`; the mutation output goes in the PR.
2. DNS test: a DNS check with `expected: ["10.9.8.7"]` and `resolver: "10.0.0.53"`. Neither value appears in any response, with hide-details true and false, and with checks shown and hidden.
3. Function tests, with components and hidden checks:
   - the page still labels incidents and maintenance of member checks with component names, and those of a check in no component with `Service`;
   - the feed still has those incidents with the same titles;
   - component badges work;
   - check badges answer the unchanged `404`.
4. With checks shown, or without components, existing tests pass unchanged: identical output.
5. `docs/operation.md` matches the behavior and the typo is fixed. Browser check screenshot in the PR; `bun run check` and CI green.
