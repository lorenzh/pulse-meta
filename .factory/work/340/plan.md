# Spec: Manual incidents with updates (#340)

## Goal
Operators post manual incidents (title, impact, affected components, status, timed updates) through an authenticated API. The status page shows them next to automatic incidents, feeds carry them, and notify announces creation, each update and resolution. Builds on components (#331); automatic `Incident` stays unchanged.

## Non-goals
No web UI for writing, no scheduled maintenance beyond existing windows, no subscriptions, no reminders for open manual incidents, no new runtime dependency, no CLI (documented `curl` examples instead).

## Decisions (from the issue review)
1. **Admin token**: separate file, env `PULSE_API_ADMIN_TOKENS_FILE`, same parser rules as `tokens.ts` (zod, min 16 chars, example tokens refused, never logged). Admin tokens must differ from all probe and read tokens (startup error). Unset: write routes answer 404 and the feature is read-only (reads return an empty list). Constant-time compare.
2. **Ids**: own table and own id sequence. Notify keys are `manual:<id>:opened`, `manual:<id>:update:<n>`, `manual:<id>:resolved`; feed ids `manual:<id>:<n>`. No collision with automatic keys.
3. **Contract shape**: `ManualIncident` = `{id, title, componentIds, impact, status, createdAt, resolvedAt, updates}`; `updates` = `{at, status, message}[]`, append-only, ordered by `at`, index = stable update number. Invariant (validator): `status==="resolved"` iff `resolvedAt!==null`; `updates` non-empty; the last update's status equals `status`; the last update's `at` equals `resolvedAt` when resolved. Update 0 is the creation message (status = initial status). Times are set by the server.
4. A resolved incident accepts no updates or reopening (409).
5. `impact` is fixed at creation.
6. Empty `componentIds` is allowed (general incident, affects no component state). Ids must be unique and exist in the configured components; with no components configured they must be empty.
7. **Impact to component state** (open incidents only; `monitoring` counts, `resolved` does not): none -> no change, minor -> `degraded`, major and critical -> `down`. Component state = worst of check-derived state and incident-derived state with the order down > degraded > up > maintenance > unknown (the existing `combineStates`). The mapping lives in the contract as `incidentImpactState(impact)`; applying it is done in status. An incident-derived `degraded` over `maintenance`/`unknown`/`up` wins; component uptime numbers are unchanged.
8. **Delete**: hard delete; sent notifications cannot be retracted; feed entries vanish. Documented.
9. **Limits**: title 1-200, message 1-2000 chars, at most 100 updates per incident, at most 50 componentIds, body at most 16 KiB. Text is plain: control characters (except newline in messages) refused; HTML is not stripped but stored and escaped on output (consumers escape). Recent resolved: resolved within 14 days, max 50, newest first.
10. **Retention**: resolved manual incidents are purged with the same retention window as resolved incidents (`retention.ts`), if that window is configured.
11. **Read routes** (public, same auth as other reads): `GET /manual-incidents?status=open|resolved|all` (default all = open + recent resolved), `GET /manual-incidents/{id}`. Write routes (admin token, `Authorization: Bearer`): `POST /manual-incidents` (`title`, `impact`, `componentIds`, `status` default investigating and not resolved, `message` required), `POST /manual-incidents/{id}/updates` (`status`, `message`; status may be resolved), `POST /manual-incidents/{id}/resolve` (optional `message`, default "Resolved."), `DELETE /manual-incidents/{id}`. Resolution by either route yields one `resolved` event, not an update event. Probe and read tokens get 401/403 on writes.
12. **Absence tolerance**: status and notify treat a 404 from `/manual-incidents` (older api) as "no manual incidents" without error and without clearing state it already holds from a successful read; other failures behave like their existing failure handling.
13. **Metrics** (api): `manual_incidents_created_total`, `manual_incidents_resolved_total`, following the existing naming in `metrics.ts`; no labels with free text.
14. **Notify routing**: channels get optional `components` and `excludeComponents` (component ids). A manual incident matches a channel when: component filters are absent, or `components` intersects its `componentIds`, and `excludeComponents` does not intersect. A channel with only `checks`/`excludeChecks` filters receives all manual incidents with no components, and none with components unless the channel has no component filters at all (then it receives all). Rule in short: check filters are ignored for manual incidents; component filters apply; an incident with empty `componentIds` only matches channels without a `components` include list.
15. Upgrade order: contract, then status and notify (parallel), then api.

## Risks
Id/key collisions (separate prefixes); first start of notify announcing history (seed keys must include manual incidents); HTML injection (escape in status, feed, notify; tests with `<script>`); admin token leakage (never in logs, errors or metrics); older api (decision 12).

## Acceptance evidence
`compose-e2e` in api: with admin token configured, POST a manual incident on a configured component, two updates (second resolves). Assert:
1. `GET /manual-incidents` lists it with both updates plus the creation message in time order and `resolvedAt` set; unauthenticated and probe-token writes refused; unknown component, over-long title/message rejected.
2. Status page shows it prominently while open (title, impact, status, latest update, components), component state follows decision 7, afterwards it is in history with all updates; hide-details does not hide it; the feed has escaped entries for the incident and updates.
3. The notify ledger has one entry per event (opened, update 1, resolved), sent once, component routing honored, a restart sends nothing twice.
4. Metrics count one created, one resolved; delete removes it from reads.
5. Every new test fails on the old code; the page was checked in a browser (screenshot or description in the PR).

## Repository: contract
Files: `src/schema.ts` (zod `ManualIncidentUpdate`, `ManualIncident`, `ManualIncidentInput`/`ManualIncidentUpdateInput` write bodies with the limits of decision 9, impact/status enums and exported constants for the limits, a plain-text `text` rule), `src/validate.ts` (validators `validateManualIncident`, list validator, invariants of decision 3), `src/components.ts` or new `src/incidents.ts` (`incidentImpactState`), `src/index.ts` exports, `src/client.ts` (`getManualIncidents`, `getManualIncident` read helpers with the 404 -> empty tolerance as an option), `docs/index.md`, `test/` (schema, validator invariants, mapping, client), `test/types.fixture.ts`. `Incident` unchanged. Minor version bump to 1.3.0 in `src/version.ts` and `package.json`.
Checks: the repo's lint, typecheck, tests. Completion: exports present, each new test fails without the change, docs describe the fields and limits.

## Repository: status
Files: `src/api-filter.ts` (allow exactly `/manual-incidents` list path), `src/api-poll.ts`/`src/poller.ts` (poll and validate, 404 tolerance), `src/components-view.ts` (apply decision 7 to component state), `src/sections.ts`/`src/render.ts` (prominent open block: title, impact, status, latest update, component names; history: resolved ones with all updates in time order; all text escaped; not subject to hide-details), `src/syndication.ts`/`src/feed.ts` (entries `manual:<id>:<n>`, updated time, escaped), `public/` styles for impact levels, `docs/`, README if it lists the features. Tests next to code: filter, poller, render with `<script>` text, hide-details, component state mapping, feed, 404 tolerance. Bump pulse-contract to the 1.3.0 SHA.
Checks: lint, typecheck, tests, page opened in a browser. Completion: screenshot of open and resolved states.

## Repository: notify
Files: `src/api.ts` (read `/manual-incidents`, 404 tolerance), `src/detector.ts` (events opened/update:n/resolved with keys per decision 2, seed keys include manual incidents at first start), `src/channel-schema.ts`/`src/config.ts` (`components`, `excludeComponents`; unknown component ids are not validated against the api), `src/notifier.ts`/`src/types.ts` (routing per decision 14, message format: title, impact, status, update message, component ids; at-least-once via the ledger), `src/redact.ts` (apply existing redaction to text), `src/metrics.ts` if events are counted, docs (`docs/channels.md`, `docs/configuration.md`, `docs/operation.md`), tests for detector keys, routing, seeding, restart idempotency, resolve-by-update yielding one resolved event, and no change to automatic incident events. Bump pulse-contract.
Checks: lint, typecheck, tests. Completion: tests prove one delivery per key across restart.

## Repository: api
Files: `src/tokens.ts` or new `src/admin-tokens.ts` and `src/config.ts` (decision 1, tests incl. overlap with probe/read tokens, never logged), `src/db.ts` (additive idempotent `migrate` creating `manual_incidents` and `manual_incident_updates`), new `src/manual-incidents.ts` (store, validation against configured components, limits, state rules 409), `src/server.ts` (routes of decision 11, body size limit, 404 when admin tokens unset), `src/metrics.ts` (decision 13), `src/retention.ts` (decision 10), `docs/rest-api.md`, `docs/configuration.md`, `docs/operation.md` with `curl` examples for create/update/resolve/delete, example admin token file (refused example values) next to `tokens.example.json`, `compose.yaml`/`compose.e2e.yaml` and `compose/` with an admin token and a component, and the `compose-e2e` scenario from the acceptance evidence, building status and notify from `main`. Tests: server, db migration on an old database, tokens, retention, metrics. Bump pulse-contract.
Checks: lint, typecheck, tests, `compose-e2e`. Completion: e2e asserts items 1-4 above.
