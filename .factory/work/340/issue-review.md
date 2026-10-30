# Issue review: Manual incidents with updates (#340)

Verdict: specifiable. No blocking question; the open points below get decisions in the plan.

## Current state (checked in the clones)
- contract 1.2.0 already has components (`components.ts`, from #331). api has `components.ts` and `/components` routes; status handles components. Build on these; do not redo them.
- api: SQLite with `CREATE TABLE IF NOT EXISTS` plus a `migrate(db)` in `db.ts`; probe tokens in a file (`tokens.ts`, zod, min 16 chars, example tokens refused, never logged). Reads use a read token; probe writes use probe tokens.
- notify: reads `/incidents`, keys events `<id>:opened|resolved|reminder:n`; channel routing is by `checks` / `excludeChecks` (check ids).
- status: reads only through an allow-list (`api-filter.ts`) and a poller; feed built in `syndication.ts`/`feed.ts`.

## Open points and proposed decisions
1. Admin token source: file like probe tokens (`PULSE_API_ADMIN_TOKENS_FILE`?) vs one env var. Proposal: a separate file, same validation rules as `tokens.ts` (min length, no examples), must differ from every probe and read token; admin routes disabled (404/501) when unset. Constant-time compare, never logged.
2. Id namespace: `ManualIncident.id` vs automatic `Incident.id` both numeric; feed/notify keys must not collide. Proposal: separate table and id sequence; notify keys prefixed `manual:<id>:...`.
3. Contract shape: `resolvedAt` null while open; `status === "resolved"` iff `resolvedAt` set; `updates` ordered by `at`; `updates` carry an `id`/sequence? (spec lists none; notify idempotency needs a stable per-update key, so use the index in the list, updates append-only). Update `at` set by server (clock); no back-dating. Is the initial message of an incident an update? Proposal: create takes `title`, `impact`, `componentIds`, `status` (default investigating), and a required first `message` stored as update 0.
4. Whether a status update can reopen a resolved incident: proposal no (409); resolved incidents accept no updates.
5. `impact` changes: not in the update shape; fixed at create unless the plan adds an optional `impact` to updates. Proposal: fixed (delete and recreate otherwise).
6. Empty `componentIds`: allowed (general incident)? Proposal: allowed; then shown without component names, and component state unaffected.
7. Impact → component state mapping: none→no change, minor→degraded, major/critical→down? Maintenance vs. incident ordering. The plan defines it; add to contract `combineStates` input or a status-side rule. Only open (not resolved) incidents count; `monitoring` still counts.
8. Delete semantics: hard delete; notify already sent messages cannot be retracted; feed entries vanish. Document.
9. Limits: title ≤ 200, message ≤ 2000, max updates per incident (e.g. 100), max components, body size limit; plain text via contract `text` helper (control chars refused). "Recent resolved": window/limit (e.g. 14 days, max 50) and query params.
10. Retention: do manual incidents follow `retention.ts`? Proposal: kept for the same window as resolved incidents, or forever—plan decides.
11. Read routes: `GET /manual-incidents?status=open|resolved` (+ detail by id). Status allow-list gets exactly the new paths. Without the status poller route set, a 404 from an older api must be defined (deploy order contract → notify/status → api per issue, so status must tolerate absence? Plan decides; components plan treated 404 as error).
12. Hide-details: manual incidents shown regardless; but component names are hidden checks? Components are public vocabulary, so fine; with no components configured, `componentIds` must be empty.
13. Metrics: counters `manual_incidents_created_total`, `..._resolved_total` (plus maybe updates); check existing metric naming/label rules in `metrics.ts`.
14. Notify: routing by component id needs new channel keys (`components`, `excludeComponents`?). Rule for channels with only `checks` filters: do they get manual incidents? Notify needs component ids from the manual incident only (no check mapping). Reminders for open manual incidents: none. Seeding of keys at first start (as `seedKeys`) must include manual incidents so history isn't announced. Message format for updates; redaction rules; at-least-once via ledger keys `manual:<id>:opened`, `manual:<id>:update:<n>`, `manual:<id>:resolved`. Resolving via update with status resolved vs separate resolve call: both yield one `resolved` event, not an update event.
15. Ordering/dependencies: issue says contract, then status and notify, then api. Status and notify test against fakes; the api e2e compose builds them from `main`.
16. Feed: entry ids stable (`manual:<id>:<n>`), escaped, updated time; hide-details unaffected.
17. CLI vs curl: choose documented `curl` examples (fewer deps, no new package).
18. Time: status page shows times in the existing format; the 4-status order is not enforced (investigating → resolved allowed to skip).

## Assumptions
- Plain text only, no markdown; no new runtime dependencies (docs/approved-packages.md).
- Existing automatic `Incident` and its routes, keys and tests stay unchanged.
- Release of a contract minor (1.3.0) precedes target builds.
- Migration is additive and idempotent.

## Derived acceptance check
In `compose-e2e` (api repo): with admin token configured, POST a manual incident (affecting a configured component), POST two updates (the second resolves); assert:
1. `GET /manual-incidents` (public read) lists it with both updates in time order, `resolvedAt` set; unauthenticated/probe-token writes are refused; unknown component id, over-long title/message, and HTML-looking text per rules are rejected/escaped.
2. The status page shows the incident prominently while open (title, impact, status, latest update, components), component state reflects the impact, and afterwards lists it in history with all updates; hide-details does not hide it; the atom feed has entries for the incident and its updates, escaped.
3. The notify ledger has exactly one entry per event (created, update 1, resolved/update 2), each sent once, with component routing honored; a restart sends nothing twice.
4. Metrics count one created and one resolved. Delete removes it from reads.
5. Each new test in each repo fails on the old code; page checked in a browser.
