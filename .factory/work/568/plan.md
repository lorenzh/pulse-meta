# Spec #568: manual incident drafts, internal notes and internal-only incidents

## Goal

Operators can prepare a manual incident or an update before anyone sees it. They can keep private
notes on the incident timeline, and they can run an incident for the team only. Manual incidents
exist since #340 (`api/src/manual-incidents.ts`, contract `ManualIncident`,
`contract/src/schema.ts:856-923`). This spec extends them and does not rebuild them:

- **Drafts.** A manual incident can be saved as a draft. A published incident can hold one draft
  update. A draft is stored, can be edited or discarded, and becomes visible only through an
  explicit publish. Drafts never reach a public read, the status page or notify.
- **Internal notes.** Any manual incident can carry notes. Notes never reach a public read, the
  status page or notify, and they never change the status, the resolution time or the component
  state.
- **Internal-only incidents.** An incident has a visibility, `public` or `internal`. An internal
  incident is never shown on the status page and is **never notified** (decision 9).

The api enforces privacy: its public reads serve only published public incidents with their
published updates. Status and notify also drop any item that is marked private (defense in depth),
before they derive anything from it.

"Public surface" in this spec means every answer that needs no token: the api public reads and
its unauthenticated `/metrics` (`api/src/server.ts:343-360`, "None needs auth"); every status
answer (proxy, page, feed, badges, their `ETag` and `304` answers, status `/metrics`); every
notify channel output and notify `/metrics`. A draft, a note or an internal incident changes none
of them: not their content, not a counter, not an entity tag.

## Baseline and dependencies

This plan is written against `main` of every target at these HEADs (read in the clones):

| Target | HEAD | State that matters here |
| --- | --- | --- |
| contract | `176fb6ed14b2f14b730a9fd1757239f210f97a29` | version `2.0.0` (`package.json:3`), the merge of #565's contract part |
| api | `e8832af73295da66dd0891e3d1e576e472682f62` | contains #565 (lorenzh/pulse-meta#706); pins contract `176fb6e…` (`package.json:31`) |
| status | `d268b5b1b0afcf9bc94ce508934ddd879bb90df0` | pins contract `7ce23aaf…` (`package.json:34`) |
| notify | `f3bcfb9484b94c50168c41c06c6d7f41784b0335` | pins contract `7ce23aaf…` (`package.json:30`) |
| deploy | `7d27011792cf17a36991d657e360502e24283d00` | contains #565's deploy part (#707) |
| console | `875e359…` | contains the app shell of #718; read only, not changed |

**Dependency on #565 (complete, merged in every repository).** #565 provides:

- contract `2.0.0`: the database view of checks in the admin shapes (`source`, `shadowed`,
  `file`; `contract/src/admin.ts`, `src/validate-admin.ts`). This is the contract baseline of
  this spec. The new contract release of this spec is `2.1.0` and is built on top of `2.0.0`.
- api: checks stored in the database next to `checks.json` (transactional writes, combined
  revision, precedence of the file), with schema step 6 (`check_definitions`, `config_state`,
  `api/src/migrations.ts:123-142`). So the schema step of this spec is **step 7**, not 6.
- deploy: the e2e script detects the api kind once from `GET /admin/config`
  (`deploy/e2e/compose-e2e.sh:656-666`) and tests database checks; the console setup test.
- console: the console part of #565.

Nothing of #565 is redone here. This spec does not touch check storage, `GET /admin/config`, the
admin revision, `check_definitions`, `config_state` or the console.

**Console (no section in this spec).** The issue lists api, contract, status and notify. The
console screens for incidents (list, detail, composer) are #569, which is open and not specified.
This spec gives #569 what it needs on the api side (the private routes of R3 and the contract
validators of "Repository: contract") and changes no console file. Assumed about console `main`,
only as far as it is there now:

- The app shell of #718 is on `main`: the navigation has an `incidents` entry with path
  `/incidents`, `minRole: "viewer"` and `isAvailable: false` (`console/src/navigation.ts:27-33`).
  #569 turns it on; this spec does not.
- The roles of #564 are on `main` only as the type `ConsoleRole` with `viewer`, `member`, `admin`,
  `owner` (`console/src/roles.ts:1-9`). Only owner accounts exist (`console/src/account-store.ts:61`,
  "Migration 1 allows only the owner role"). #564 (matrix and invitations) is open. No role rule of
  this spec depends on it: the api knows tokens and scopes, not console roles. Which console role
  may save a draft, publish, add a note or see internal incidents is decided in #569 against the
  #564 matrix, on the console server.
- The console calls the api with one admin token (`PULSE_CONSOLE_ADMIN_TOKEN[_FILE]`,
  `console/src/admin-token.ts:3-4`). Its documented scopes are `read` or `checks` plus `admin`
  (`console/README.md:18`); the private routes of this spec need `admin` and `incidents`, so #569
  must add `incidents` to that token's documented scopes. The api records the token name as the
  note `author` and audit actor, so a note written through the console names the console's token,
  not the console user. Per-user attribution is a non-goal here (Known limit, R1).

## Decisions

The issue review (`.factory/work/568/issue-review.md`) lists 14 open points. The issue comments
decide none of them, except the owner's review findings. The first spec PR (#702) was closed after
an owner review found that the unauthenticated api `/metrics` counted internal incidents, and asked
for a policy on ETags and on shared incident ids. The second spec PR (#709) was closed because it
started from contract `1.7.1`; the owner asked to plan again against contract `2.0.0` and the api
that contains #565, and to keep the three findings of the first review. Decisions 11, 14, 15 and
16 settle those findings. This spec decides:

1. **Only manual incidents.** Drafts, notes and visibility apply to manual incidents. Automatic
   incidents (`/incidents`) do not change.
2. **Private API under `/admin/manual-incidents`.** All new reads and writes live there and need a
   token with `admin` and `incidents`: the existing permission `incident-write`
   (`api/src/token-scopes.ts:22-23`), already used by the manual incident writes
   (`api/src/server.ts:435-453`). No new permission or scope. An older api answers `404` for every
   one of these paths: `/admin/*` goes to the admin handler (`api/src/server.ts:611-614`), which
   knows only `config|checks|components|maintenance` (`api/src/admin-routes.ts:56`), audit and
   token paths; without a handler `/admin/*` is `404`. So a new client can never create a "draft"
   or an "internal" incident on an older api that would publish it by mistake. The old public reads
   and the old writes under `/manual-incidents` keep their paths, bodies and answers for published
   public incidents; on a draft or internal incident the old writes answer the unknown-id `404`
   (decision 14).
3. **The legacy create stays publish-now and public.** `POST /manual-incidents` still creates a
   published public incident. Because `manualIncidentInputSchema` is a non-strict `z.object`
   (`contract/src/schema.ts:839-848`) that strips unknown keys, the api refuses a body with a
   `visibility` or `draft` key with `400` before validation, so nobody sends
   `"visibility":"internal"` there and gets a public incident.
4. **One draft per incident.** A draft incident holds its initial status and message as its draft.
   A published, unresolved incident holds at most one draft update. Saving replaces it. Publishing
   moves the draft into the published timeline and deletes it. This gives the draft a stable
   identity (the incident id) and makes a repeated publish a `409` (nothing to publish), so it
   never appends twice.
5. **Published updates stay append-only.** Notes and drafts are stored outside the published
   update table. The public update index `n` (the Atom id `manual:<id>:<n>`,
   `status/src/feed.ts:135`) and the notify update key hash (`notify/src/detector.ts:105-113`) of
   published updates never change.
6. **Visibility is fixed at publication.** It is required when a draft incident is created, can be
   changed while the incident is a draft, and cannot change after publication. No recall, cache
   expiry or queue purge is needed, because a published audience never changes.
7. **Public `createdAt` is the publication time.** A draft incident has `createdAt` (first save)
   and `publishedAt` (`null` while a draft). The public projection serves `createdAt =
   publishedAt`, and update 0 has `at = publishedAt`. So a draft saved before notify started and
   published after it is a new incident for notify, with a fresh time.
8. **Drafts do not block component removal.** `hasOpenIncidentFor` counts unresolved
   **published** incidents of either visibility, not drafts (its caller is the component delete,
   `api/src/config-write.ts:340-345`). A draft incident whose component was removed fails to
   publish with `409` until it is edited.
9. **Internal-only incidents are not notified on any channel.** notify reads only the public feed
   and gets no private credential. Channels that should receive internal incidents are a non-goal
   (a later feature can add an authenticated feed and an explicit opt-in).
10. **Notes can be added and deleted, not edited.** Notes are allowed on every incident (draft,
    published, resolved; public or internal). A note never converts to an update.
11. **Metrics count only public publications.** The api `/metrics` needs no auth
    (`api/src/server.ts:343-360`), so it is a public surface.
    `pulse_api_manual_incidents_created_total` (`api/src/metrics.ts:89-92`) counts an incident
    when a **public** incident is published (legacy create, or publish of a draft incident with
    `visibility: "public"`); `..._resolved_total` (`api/src/metrics.ts:93-96`) counts a write that
    resolves a **public** published incident. An internal incident counts nothing, ever: not its
    publication, not its resolution. Saving, editing, discarding, notes and deletes count nothing.
    No new counter or label for internal or draft activity is added to `/metrics`; operators see
    that activity in the audit log (`/admin/audit`, authenticated) and the log lines (R4).
12. **Compose evidence runs in deploy against images built from `main`.** `e2e/compose-e2e.sh`
    gets a `dev` stack choice that builds the services from sibling checkouts, and a new CI job
    runs it. The published-image `full` job keeps working on the `0.1.0` images
    (`deploy/common/services.yaml:8-44`) and skips the new scenario there, chosen by detecting the
    api kind, as the script already does (see "Repository: deploy").
13. **No wire version bump.** `ManualIncident` and `GET /manual-incidents` keep their shape. The new
    shapes are on new routes. `WIRE_VERSION` stays `1` (`contract/src/version.ts:5`).
14. **Request metrics carry no private activity.** `pulse_api_http_requests_total`
    (`api/src/metrics.ts:97-100`) counts every request by route pattern and status code in a
    `finish` hook (`api/src/server.ts:835`). A request to `/admin/manual-incidents` or any path
    below it is **not recorded** in that counter at all (any method, any status), because a `201`
    of `POST /admin/manual-incidents/:id/notes` or a `200` of `…/publish` would show private
    activity. Their failed authentications and throttles are still counted by
    `pulse_api_admin_auth_failures_total` and `pulse_api_admin_auth_throttled_total`
    (`api/src/metrics.ts:114-123`): those outcomes come before any read of private state (R3
    order), so they only show what the caller itself sent. The legacy writes
    (`POST /manual-incidents/:id/updates`, `/resolve`, `DELETE /manual-incidents/:id`) stay
    counted, and so they answer `404 manual incident not found` for a draft or an internal
    incident, exactly as for an unknown id (R3). A `404` there says nothing a caller with any id
    could not cause. Internal incidents are changed and deleted only through the private routes.
15. **Incident ids: one shared sequence, gaps accepted.** Drafts, internal and public incidents
    take their id from the same `AUTOINCREMENT` sequence (`api/src/db.ts:57-58`). A public reader
    can see gaps in the public ids. A gap can be a deleted incident (deletes exist since #340), a
    draft, an internal incident, or a draft that was discarded; the api gives no way to tell them
    apart: the public detail of each is the same `404` with the same body and headers as an
    unknown id (R2). A separate sequence for public ids would give a published draft a second
    id and break the stable identity of decision 4. Known limit, written in `docs/rest-api.md`:
    "ids are not contiguous; a gap can be a deleted or a private incident".
16. **Entity tags follow the served bytes.** status computes every `ETag` from the bytes it serves
    after filtering (`status/src/http-cache.ts:13-16`; callers `status/src/server.ts:374`, `:784`,
    `status/src/syndication.ts:218`). Because R7 drops private items before anything is
    rendered, the tag, the `304` answer and the feed `<updated>` value are functions of the
    public items only. The api sets no entity tag on its public reads (its only `ETag` is the
    admin config revision, `api/src/admin-routes.ts:100-101`). This is a tested rule (R7,
    "Repository: status"), not a code change of `http-cache.ts`.

## Scope

- contract: new schemas, types, validators, constants, audit actions, the public guard and
  projection; version `2.0.0` to `2.1.0`.
- api: schema step 7, store, private routes, public projection, audit, logs, metrics, docs.
- status: drop non-public items in the proxy, the poller and the feed/badge reader; contract pin.
- notify: drop non-public items before validation and event derivation; contract pin.
- deploy: `dev` stack choice of `compose-e2e.sh`, the privacy scenario, a CI job.

## Non-goals

- No console change: no screen, no navigation change, no role rule (see "Baseline and
  dependencies"; screens are #569, roles #564). No autosave of incomplete forms, no scheduled
  publication, no approvals, no new token scope or agent role.
- No change of visibility after publication; no un-publish; no edit of a published update.
- No notification of internal incidents, drafts or notes on any channel, and no new notify setting.
- No per-user note author: the author is the api token name.
- No change to automatic incidents, check storage of #565, `/components` of the api, probe, kit,
  config, console or website.
- No new runtime dependency.

## Required behavior

### R1 Data model

An incident in the api store has: `id`, `title`, `impact`, `componentIds`, `visibility`
(`public`|`internal`), `status`, `createdAt` (first save), `publishedAt` (`null` while a draft),
`resolvedAt`, the published `updates` (`{at, status, message}`, append-only), at most one `draft`
(`{status, message, savedAt}`), and `notes` (`{id, at, author, message}`).

States:

| State | `publishedAt` | `updates` | `draft` | `status` |
| --- | --- | --- | --- | --- |
| draft incident | `null` | empty | required; `draft.status` is not `resolved` | equals `draft.status` |
| published, open | number | 1..100 | none or one draft update (any status) | last update's status |
| published, resolved | number | 1..100 | none | `resolved` |

`author` of a note is the name of the token that wrote it (the audit actor name). It holds no
secret. Known limit: through the console it is the console token's name (see "Baseline and
dependencies").

Limits (contract constants): title 1..200 and message 1..2000 characters as today
(`contract/src/schema.ts:787-788`); at most 100 published updates (`MANUAL_INCIDENT_MAX_UPDATES`,
`:789`); at most 100 notes per incident (`MANUAL_INCIDENT_MAX_NOTES`); at most 100 draft incidents
per installation (`MANUAL_INCIDENT_MAX_DRAFTS`); write bodies at most 16 KiB
(`MANUAL_INCIDENT_MAX_BODY_BYTES`, `:792`). A draft incident does not count toward a limit of
published updates.

### R2 Public reads (unchanged paths and shape)

- `GET /manual-incidents[?status=open|resolved|all]` returns only incidents with
  `publishedAt !== null` and `visibility === "public"`, as `ManualIncident` (exactly the fields
  `id, title, componentIds, impact, status, createdAt, resolvedAt, updates`; `createdAt` =
  `publishedAt`; `updates` = published updates only). Open ones first (newest `publishedAt`
  first, then id descending), then public incidents resolved within 14 days, newest first, at most
  50 (`api/src/manual-incidents.ts:14-15`). The 50 are counted after the filter, so internal
  incidents never take a slot.
- `GET /manual-incidents/:id` answers `404` with the body of an unknown id
  (`{"error":"manual incident not found"}`, `api/src/server.ts:555`) for a draft incident and for
  an internal incident. Status line, headers (apart from `Date`) and body are the same as for a
  deleted id and for an unknown id such as `999999` (decision 15).
- No query parameter, header or token changes what these routes return.
- Before the admin bootstrap they stay empty as today (`api/src/server.ts:813-816`).

### R3 Private routes

All need `Authorization: Bearer` with a token that holds `admin` and `incidents`. Order of checks,
as for the existing writes (`api/src/server.ts:534-559`, `:435-453`; `docs/rest-api.md:295`):
unknown path shape or a bad id syntax `404` (`^\d{1,15}$`, `api/src/server.ts:428-433`), wrong
method `405` with `Allow`, admin not bootstrapped `404`, then auth (`401` with
`WWW-Authenticate: Bearer` for a missing, unknown, expired or revoked token; `403` for a token
without both scopes; `429` from the shared throttle), then the body (`413` over 16 KiB, `400` for
invalid JSON or invalid fields), then existence (`404`), then state (`409`). An unauthenticated
caller therefore never learns whether an id exists. These routes are dispatched before the
`/admin/*` delegation (`api/src/server.ts:611-614`), so they work also when the config writes are
off (`ops.admin` undefined), exactly like the legacy manual writes.

| Route | Body | Success |
| --- | --- | --- |
| `GET /admin/manual-incidents[?status=open\|resolved\|all]` | none | `200`, `InternalManualIncident[]`: draft and open incidents (newest `createdAt` first, id descending), then incidents resolved within 14 days (newest first, at most 50); both visibilities |
| `GET /admin/manual-incidents/:id` | none | `200`, `InternalManualIncident` |
| `POST /admin/manual-incidents` | `ManualIncidentDraftInput` | `201`, the new draft incident |
| `PUT /admin/manual-incidents/:id` | `ManualIncidentDraftInput` | `200`; replaces title, impact, componentIds, visibility, status and message of a draft incident; `draft.savedAt` = now |
| `DELETE /admin/manual-incidents/:id` | none (read up to 16 KiB, ignored) | `204`; deletes any incident with its updates, draft and notes (same as `DELETE /manual-incidents/:id`) |
| `PUT /admin/manual-incidents/:id/draft` | `ManualIncidentUpdateInput` (`status`, `message`) | `200`; saves or replaces the draft update of a published, unresolved incident |
| `DELETE /admin/manual-incidents/:id/draft` | none | `204`; discards the draft update |
| `POST /admin/manual-incidents/:id/publish` | none (read up to 16 KiB, ignored) | `200`, the incident after publication |
| `POST /admin/manual-incidents/:id/notes` | `ManualIncidentNoteInput` (`message`) | `201`, the incident with the new note |
| `DELETE /admin/manual-incidents/:id/notes/:noteId` | none | `204` |

`ManualIncidentDraftInput` = `{title, impact, componentIds, status?, message, visibility}`, strict
(an unknown key is `400`). `status` defaults to `investigating` and may not be `resolved`.
`visibility` is required. `componentIds` must exist in the configured components (`400`
`componentIds: unknown component "<id>"`, the existing text). The configured components are those
of the applied checks file, as today (`api/src/start.ts:360`); #565 did not move components into
the database.

Publish, inside one `BEGIN IMMEDIATE` transaction that re-reads the row:

- **Draft incident:** checks `componentIds` against the configured components again (`409`
  `componentIds: unknown component "<id>"`). `at = now()`. Inserts update 0
  `{at, status: draft.status, message: draft.message}`, sets `publishedAt = at` and `status`,
  deletes the draft, records the audit entry, then (after commit) counts `created` when public.
- **Published incident with a draft update:** `409 manual incident has the most updates it takes
  (100)` when it has 100 updates. `at = max(now(), last update at)` (the existing rule,
  `api/src/manual-incidents.ts:196`). Appends `{at, draft.status, draft.message}` as update `n`,
  sets `status` and, for `resolved`, `resolvedAt = at`; deletes the draft; audit; counts
  `resolved` when it resolves a public incident.
- **Published incident without a draft:** `409 manual incident has no draft`. A second publish of
  the same draft gets this answer and changes nothing.

State rules (fixed texts):

| Request | Incident state | Answer |
| --- | --- | --- |
| `POST /manual-incidents/:id/updates`, `/resolve`, `DELETE /manual-incidents/:id` (legacy, with a valid token) | draft incident, or published `internal` incident | `404 manual incident not found` (decision 14; same body as an unknown id) |
| `PUT /admin/manual-incidents/:id` | published | `409 manual incident is published` |
| `PUT` or `DELETE /admin/manual-incidents/:id/draft` | draft incident | `409 manual incident is a draft` |
| `PUT /admin/manual-incidents/:id/draft` | resolved | `409 manual incident is resolved` |
| `PUT /admin/manual-incidents/:id/draft` | 100 published updates | `409 manual incident has the most updates it takes (100)` |
| `DELETE /admin/manual-incidents/:id/draft` | published, no draft | `409 manual incident has no draft` |
| `POST /admin/manual-incidents` | 100 draft incidents exist | `409 too many draft incidents (100)` |
| `POST /admin/manual-incidents/:id/notes` | 100 notes | `409 manual incident has the most notes it takes (100)` |
| `DELETE /admin/manual-incidents/:id/notes/:noteId` | note not on this incident | `404 note not found` |

Any write that resolves an incident (legacy update with `resolved`, legacy resolve, publish of a
resolving draft) deletes a pending draft update in the same transaction. So a resolved incident
never holds a draft.

The legacy writes keep working on published **public** incidents and keep their answers
(`ManualIncident` shape, without `visibility`, `draft` or `notes`). A legacy update on an
incident with a pending draft update appends and keeps the draft. On a draft or an internal
incident every legacy write answers `404 manual incident not found` and changes nothing
(decision 14). An internal incident gets updates through `PUT …/draft` plus `POST …/publish`, and
is deleted with `DELETE /admin/manual-incidents/:id`. No older client is affected: none can
create an internal incident or a draft (decision 2).

### R4 Audit, logs, metrics

- New audit actions: `manual-incident.edit` (PUT of a draft incident),
  `manual-incident.draft-save`, `manual-incident.draft-discard`, `manual-incident.publish`,
  `manual-incident.note-add`, `manual-incident.note-delete`. Creating a draft incident records
  `manual-incident.create`; `DELETE /admin/manual-incidents/:id` records `manual-incident.delete`.
  Target `{kind: "manual-incident", id: "<incident id>"}`, `revision: null`. The entry commits in
  the write's transaction (`api/src/manual-incidents.ts:55-56`, `:149`); a failing audit insert
  rolls the write back.
- Log lines: the existing `manual incident write` (`info`) and `manual incident write failed`
  (`warn`) lines (`api/src/server.ts:516`, `:523`) with the new action names `create-draft`,
  `edit`, `delete`, `save-draft`, `discard-draft`, `publish`, `add-note`, `delete-note`. No title,
  message, note, body or header goes into a line, an audit entry or a metric label.
- Private reads are not logged; their auth failures are logged and counted by the existing admin
  auth failure recorder.
- Metrics, decisions 11 and 14:
  - `onEvent("created")` fires after the commit of a publication only when the incident's
    `visibility` is `"public"`; `onEvent("resolved")` only when the resolved incident is
    `"public"`. The store decides this from the row it re-read in the transaction, not from the
    request body. Today they fire for every create and resolve (`api/src/manual-incidents.ts:204`,
    `:252`).
  - The `finish` hook (`api/src/server.ts:835`) does not call `recordRequest` for a path that is
    `/admin/manual-incidents` or starts with `/admin/manual-incidents/` (checked on the parsed
    pathname, as `routeOf` parses it, `api/src/server.ts:217-240`). So no
    `pulse_api_http_requests_total` series ever names these paths, and no `unmatched` series
    grows from them either.
  - The admin auth failure and throttle counters label these routes with the patterns
    `/admin/manual-incidents`, `/admin/manual-incidents/:id`, `/admin/manual-incidents/:id/draft`,
    `/admin/manual-incidents/:id/publish`, `/admin/manual-incidents/:id/notes`,
    `/admin/manual-incidents/:id/notes/:noteId`. No label holds an id.
  - Invariant (tested over HTTP): after any sequence of private-only actions (draft create, edit,
    draft save, discard, note add and delete, publish or resolve of an internal incident, admin
    delete of a draft or internal incident, legacy writes answered `404` on them), every line of
    an anonymous `GET /metrics` that starts with `pulse_api_` is the same as before, except the
    lines of `pulse_api_http_requests_total` with `route="/metrics"` (the scrapes themselves) and
    of `pulse_api_http_requests_total` with `code="404"` for the legacy routes (the same lines an
    unknown id gives).
- Known limit, not changed: `pulse_api_config_writes_total{result="conflict"}`
  (`api/src/metrics.ts:110-113`) rises when an admin removes a component that an open internal
  incident names (decision 8, `api/src/config-write.ts:340-345`). The same label rises for a
  public incident and for a check still in use (`api/src/config-write.ts:337`), and it rises only
  on an admin's own refused write, so it does not show which incident blocked it or that one is
  internal. Written in `docs/operation.md`.

### R5 Storage and migration

Migration **step 7** in `api/src/migrations.ts` (step 6 is #565's, `:123-142`; never edit steps
1-6, `api/src/migrations.ts:1-4`):

```sql
ALTER TABLE manual_incidents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE manual_incidents ADD COLUMN published_at INTEGER;
UPDATE manual_incidents SET published_at = created_at;
CREATE TABLE manual_incident_drafts (
  incident_id INTEGER PRIMARY KEY REFERENCES manual_incidents(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);
CREATE TABLE manual_incident_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES manual_incidents(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  author TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX manual_incident_notes_by_incident ON manual_incident_notes (incident_id, at, id);
```

Every existing incident becomes published and public with `published_at = created_at`, so its
public JSON (fields, order, times, update numbers) is byte-for-byte the same as before. A
database at step 7 is refused by an older api (`api/src/db.ts:109`), also by an api that has
#565 but not this change: a downgrade needs a backup (`bun run backup`). Retention
(`deleteResolvedBefore`, `api/src/manual-incidents.ts:282`) is unchanged: resolved incidents go
with their notes by cascade; draft incidents are never resolved and are bounded by
`MANUAL_INCIDENT_MAX_DRAFTS`.

### R6 Contract guard and projection

- `isPublicManualIncident(value: unknown): boolean` decides on raw JSON, before validation. It
  never runs a getter or setter and never throws. For each of the two keys `visibility` and
  `publishedAt` it reads the own property descriptor (`Object.getOwnPropertyDescriptor`, as the
  existing `ownValue` does, `contract/src/validate-core.ts:15-21`) and classifies the key:
  - no own property (also when the name is only inherited from a prototype): **absent**;
  - own data property (the descriptor has `value`): its **value**;
  - own accessor property (the descriptor has `get` or `set` and no `value`): **accessor**. The
    accessor is not called.

  The result is true exactly when the value is a non-array object, `visibility` is absent or the
  string `"public"`, and `publishedAt` is absent or a finite number. Every other case is false
  (fail closed), in particular: `visibility` `"internal"`, `"Public"`, `null`, `1`; `publishedAt`
  `null`, a string, `NaN`, `Infinity`; **an accessor on either key, whatever the getter would
  return** (this is where the guard differs from `ownValue`, which would treat an accessor as
  absent and so as public); a `Proxy` whose `getOwnPropertyDescriptor` trap throws (caught,
  false). The one rule for accessors in this whole spec: an accessor-defined privacy key makes the
  item non-public, and its getter never runs. Rationale for "absent means public": the public feed
  of the api and every older api carry neither field, and `JSON.parse` never produces an accessor
  or a proxy, so the accessor and proxy cases only reach the guard from a hostile or buggy
  in-process caller.
- `publicManualIncident(incident: ManualIncident): ManualIncident` returns a new object with exactly
  the eight public fields and each update as `{at, status, message}`. Consumers use it so that a
  `draft` or `notes` field of an upstream item can never reach their output.

### R7 Status

Every place that reads manual incidents drops an item for which `isPublicManualIncident` is
false, before it validates, cleans, renders, counts or remembers it:

- the proxy filter `filterApiBody` for `/api/manual-incidents` (`status/src/api-filter.ts:253-262`):
  dropped items are removed from the array; a non-object item still becomes `null` as today;
- the poller (`status/src/poller.ts:317-332`), on the server and in the browser: the raw array is
  filtered, then validated with `validateManualIncidentsResponse`, then mapped with
  `publicManualIncident`;
- the feed and component badge reader `parseManualIncidents` (`status/src/syndication.ts:160-181`).

So a draft, an internal incident or its impact never shows in `/api/manual-incidents`, the SSR
page, the browser refresh, the resolved history, `/feed.atom` or `/badge/component/<id>.svg`,
with `PULSE_STATUS_HIDE_DETAILS` on or off. The allow-list (`status/src/api-filter.ts:3-14`) is
unchanged: no `/api/admin/...` path, no credential, no write route.

The browser runs the guard too, so status serves the new contract module
`/pulse-contract/manual-incident-public.js`: one new entry in the served-module allow-list
`contractModules` (`status/src/server.ts:189-205`); every other file name stays refused
(Repository: status).

Conditional requests (decision 16): for each of `/api/manual-incidents`, `GET /`, `/feed.atom` and
`/badge/component/<id>.svg`, an upstream that serves the public items plus any private items
gives the same body bytes and the same `ETag` as an upstream that serves only the public items,
and an `If-None-Match` with the tag from the public-only upstream gets `304`. So a client that
polls with `If-None-Match` cannot see that a private item appeared, changed or went away. The
feed `<updated>` (`status/src/feed.ts:166`) is the newest public entry. Status `/metrics`
counts polls and requests only (`status/src/metrics.ts:25-34`), never items.

### R8 Notify

`fetchManualIncidents` (`notify/src/api.ts:280-301`) skips every raw item for which
`isPublicManualIncident` is false, before validation; a skipped item is not `rejected`, not logged
(`notify/src/notifier.ts:402-404`, `:556-561`) and not counted:
`pulse_notify_skipped_items_total{feed="manual-incidents"}` (`notify/src/metrics.ts:33-36`,
"skipped as malformed") does not rise for it, and `pulse_notify_deliveries_total` counts only
deliveries of public events. So notify `/metrics` is also unchanged by private items. Each accepted
item is passed through `publicManualIncident`. So event derivation, first-start seeding, payloads,
ledger entries, ledger pruning by visible ids (`notify/src/notifier.ts:406`, `:457`) and channel
output never see a draft, an internal incident, a draft update or a note. Routing, keys, seeding
and restart behavior of public incidents do not change.

## Risks

- **A legacy client sends privacy fields to the legacy create** and believes the incident is
  private. Mitigated by decision 3 (`400`) on the new api; an older api cannot be fixed, which is
  why all new writes are on paths an older api refuses (decision 2).
- **Status strips metadata before deciding.** The proxy allow-list copies only listed fields, so
  `visibility` would be lost if the guard ran after it. The guard runs on the raw item first (R7).
- **Older status/notify against a new api** see only the public projection; nothing leaks
  (Rollout order).
- **status and notify cross contract 2.0.0.** They pin `7ce23aaf…`; the new pin is the `2.1.0`
  SHA, which includes the breaking admin change of `2.0.0` and the validator fast path of
  `contract/src/validate-core.ts`. Neither imports an admin type: `grep -rln pulse-contract
  status/src status/test status/e2e notify/src notify/test | xargs grep -nE
  'Admin|ConfigView|validateAdmin|configView|shadowed|CheckSource'` prints nothing. Their
  existing tests must pass unchanged on the new pin; a failure caused only by the pin move is a
  shared finding (status and notify sections).
- **Status serves contract modules to the browser by allow-list.** The new contract module
  `manual-incident-public.js` is imported by the contract's `index.js`, but status serves only the
  file names in `contractModules` (`status/src/server.ts:189-205`, check at `:254`). A pin move
  without the new entry makes the browser module graph fail (`404`), so the page never refreshes
  in the browser. The status section adds the entry in the same change as the pin move and tests
  it (Repository: status). No other target serves contract files to a browser: `grep -rln
  'validate-audit.js' api/src notify/src console/src deploy` prints nothing; only
  `status/src/server.ts` matches.
- **Concurrent edit and publish.** Two operators: one saves a new draft text while the other
  publishes. Whichever transaction commits first wins; the publish publishes the draft text stored
  at that moment. Known limit, documented; no revision check in this spec.
- **Feed or notify replays.** Public update numbers and hashes do not move, because private rows are
  in other tables (decision 5).
- **API downgrade after migration** is refused; documented with the backup command.
- **Side channels on public surfaces.** Counters, request labels, entity tags and ids can show
  private activity without showing content. The first spec PR (#702) counted internal
  publications in the unauthenticated api `/metrics`. Decisions 11, 14, 15 and 16 close the
  counters, request labels and tags, and accept id gaps. Each of them has an HTTP test that
  compares an anonymous answer before and after private-only actions. Remaining known limits:
  id gaps (decision 15), the config write `conflict` count (R4), and response timing (not
  measured or equalized by this spec).
- **Compose against `main`** may expose unrelated drift between `main` and the `0.1.0` images.
  The deploy implementer fixes the script for both or requests a hold with the failing step
  (Repository: deploy).

## Performance impact

Bench keys from `api/bench/budgets.json` (sections `api`, `status`, `notify`, `contract`). The
bench load (`api/bench/load.ts`) and seed do not touch manual incidents (`grep -rln manual
api/bench` prints nothing).

- api `startup_cpu_ms` (gating, 325): none expected on a fresh bench database; step 7 runs once per
  database and is two `ALTER TABLE`, one `UPDATE` over the existing manual incident rows (none in
  the bench seed) and three `CREATE` statements, well under 1 ms.
- api `cold_read_cpu_ms` (gating, 390) and the reported `cold_*`: none expected; a cold start
  `--seed-with` an older worktree runs step 7 once on a file without manual incidents.
- api `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `eod_read_cpu_ms` (gating) and the reported
  `startup_wall_ms`, `p95_*`, `rps`, `eod_*`: none expected; the load reads and writes no manual
  incident. The new skip test in the request `finish` hook is one string prefix check per request.
- api `test_cpu_s` (gating, 5.6, floor 1.6): up by about 0.2 to 0.4 s for the new HTTP and store
  tests. Keep them on in-memory or `mkdtemp` databases and fake time.
- api `image_mb` (reported): none (no new file type or dependency).
- status `test_cpu_s` (3.4) and notify `test_cpu_s` (3.4, floor 1.5): up by under 0.1 s each for
  the new tests. `startup_cpu_ms`, `load_cpu_s`, RSS: none expected from this feature; the guard
  is two descriptor reads per item. The pin move to contract `2.1.0` brings the validator fast
  path of `2.0.0`, which can only lower validation CPU.
- contract `test_cpu_s` (9.0, floor 2) up by under 0.1 s; `build_cpu_s` (6.4) up by under 0.1 s
  for one more module.

Measurement: the api implementer runs `bun bench/run.ts --a <main sha> --b <branch sha>
--others-ref main` (`api/bench/README.md:76-81`) or at least the `test_cpu_s` comparison of
`bun run test` on both refs, and reports the numbers in the PR. Status and notify report
`bun test` CPU time before and after.

## Security impact

Security impact: yes
It adds authenticated admin routes, validators at a trust boundary (contract), a privacy filter on
untrusted upstream JSON in status and notify, audit/log text, contract pin updates and a CI job.

Checklist items that apply:

- **Secrets in errors, logs and responses:** no token, title, message, note or body in a log line,
  audit entry, metric label or error text (R4). Error texts are the fixed strings of R3 or the
  contract validation paths. `author` is a token name, never a secret.
- **Private state in public responses and metrics:** the unauthenticated api `/metrics` counts
  only public publications and resolutions (decision 11) and records no request to
  `/admin/manual-incidents*` (decision 14); status entity tags and `304` answers depend only on
  public items (decision 16); notify counts no skipped private item (R8); the public detail of a
  private id is the unknown-id `404` (decision 15). Each has a test that fails on current `main`
  or is named a regression guard (repository sections).
- **Auth order and status codes:** R3 order; `401` vs `403` vs `429`; existence (`404`) only after
  auth; legacy writes on a draft or internal id answer the unknown-id `404`; private routes before
  bootstrap `404`.
- **Body and size limits:** every write body at most 16 KiB (`413`), also the ignored bodies of
  `publish` and `DELETE`.
- **Input validation:** strict draft and note inputs; the legacy create refuses `visibility` and
  `draft` keys; ids `^\d{1,15}$` (the existing rule, `api/src/server.ts:428-433`) for incident and
  note ids.
- **Accessor execution:** `isPublicManualIncident` inspects own property descriptors and never
  runs a getter; an accessor on `visibility` or `publishedAt` makes the item non-public (R6). The
  validators keep their existing rule (accessors count as absent, never run).
- **Dependency pins:** api, status and notify move their contract pin to the merged `2.1.0` SHA on
  contract `main` with `bun install` updating `bun.lock`; no other dependency changes. deploy
  actions only by the SHAs already in its `ci.yml`, with `persist-credentials: false`.
- Not applicable: SSRF and redirects (no new outbound request; notify and status keep their
  clients), atomic path-safe file writes (SQLite only; no file is written).

## Rollout order

1. **contract** merges `2.1.0` (additive: new exports and audit actions; `ManualIncident`, its
   validators, the admin shapes of `2.0.0` and `WIRE_VERSION` unchanged). The api and console pin
   `176fb6e…` (`2.0.0`) and status, notify, probe pin `7ce23aaf…`; nothing changes at run time.
2. **api, status and notify** each move their pin to the merged `2.1.0` SHA and merge in any order:
   - The status pin move and the new `contractModules` entry for `manual-incident-public.js` land
     in one PR, so no status build on `main` serves an `index.js` that imports an unserved file.
     A status on the old pin keeps its old allow-list and the old contract `index.js`, which does
     not import the new module.
   - New status or notify against an **older api** (with or without #565): the older public feed
     has no `visibility` or `publishedAt`, so the guard passes every item, as today.
   - **Older status and notify** (images `0.1.0` and older `main`, contract pin `7ce23aaf…`)
     against a **new api**: they read only `GET /manual-incidents`, which serves the unchanged
     shape and never a private item. They keep working and leak nothing.
   - The api's own upgrade note says "contract, then status and notify, then api"
     (`api/docs/operation.md:165`); for this change any order is safe, because the api enforces
     privacy alone and status and notify only add defense in depth. The api doc is updated.
   - **probe, console, kit, config, website** do not read manual incidents (search of the clones
     for `manual-incidents|ManualIncident` finds them only in contract, api, status, notify and
     deploy `e2e/`); unaffected. The console keeps its `2.0.0` pin; #569 moves it when it needs
     the new validators.
   - The api migration to step 7 runs on first start. Rolling the api back needs the backup made
     before the upgrade (R5).
   - The audit actions are new enum values. The api is the only reader of `AUDIT_ACTIONS`
     (`api/src/audit-routes.ts:35`); no other service validates audit pages, so an older reader
     is not broken.
3. **deploy** after api, status and notify are merged on `main`: its new CI job builds those
   `main`s. Image pins in `common/services.yaml` are not bumped by this spec; the `full` job keeps
   testing the `0.1.0` images and skips the new scenario there.

## Counterexamples

Privacy (each must be absent from every public surface):

- Draft incident `{publishedAt: null, visibility: "public"}`: not in `GET /manual-incidents`,
  `?status=open`, `?status=all`; `GET /manual-incidents/<its id>` is `404` with
  `{"error":"manual incident not found"}`, the same body as id `999999`.
- Published internal incident with `impact: "critical"` on a component whose checks are all `up`:
  absent from the public list; the component badge of that component stays `up`. A wrong
  implementation that filters only the incident list but feeds `componentsWithIncidents` from an
  unfiltered list gets this wrong.
- Published public incident with a draft update `{status: "resolved", message: "U"}`: public
  `status` stays the last published status, `resolvedAt` stays `null`, `updates` length unchanged,
  `"U"` nowhere; the component state still follows the open incident.
- Note `"N"` on a public incident: `"N"` in no public JSON, page, feed entry or notify payload; no
  feed entry and no notify event appears when it is added (no placeholder, no time change).
- Upstream item `{..., "visibility": "Internal"}` (wrong case): dropped by status and notify
  (fail closed). Upstream item `{..., "visibility": "public", "publishedAt": null}`: dropped.
  Upstream item without both fields: kept (older api).
- Item with `visibility` defined by `Object.defineProperty` with a getter that returns
  `"public"` (and counts its calls): guard returns false, call count 0. A wrong implementation
  that reuses `ownValue` treats it as absent and returns true. The same with a getter on
  `publishedAt`, and with a getter that throws: false, no throw, call count 0.
- Item `Object.create({visibility: "internal"})` with own `publishedAt: 5`: the inherited
  `visibility` counts as absent, guard returns true (inherited names are never read, as in
  `ownValue`; a JSON body has no such prototype).
- `new Proxy({}, {getOwnPropertyDescriptor() { throw new Error("x") }})` and a revoked proxy
  (`Proxy.revocable({}, {})` after `revoke()`, where even `Array.isArray` throws): false, no
  throw.
- 50 internal incidents resolved within 14 days and 1 public one resolved earlier within 14 days:
  the public list still holds the public one (the limit counts after the filter).
- Anonymous `GET /metrics` before and after "create internal draft, publish it, add a note,
  save a resolving draft update, publish it": `pulse_api_manual_incidents_created_total` and
  `..._resolved_total` keep their values (literal: both `0` on a fresh api), and no
  `pulse_api_http_requests_total` line names `/admin/manual-incidents`. Positive control in the
  same test: a public draft published afterwards moves `created_total` from `0` to `1`. The
  #702 spec (count both visibilities) gives `1` after the internal publish and fails.
- Legacy `POST /manual-incidents/<internal id>/updates` with a valid token: `404 manual incident
  not found`, nothing appended, and the `pulse_api_http_requests_total` line it adds is
  `route="/manual-incidents/:id/updates",code="404"`, the same line that id `999999` adds. A
  wrong implementation that answers `201` (or `409`) shows an internal incident exists.
- Public detail of a draft id, an internal id, a deleted id and id `999999`: same status, body
  and headers apart from `Date` (decision 15). A wrong implementation that answers `403` or
  `409` for a private id shows it exists.
- Status serving an upstream with public control `A` only, then the same plus a draft and an
  internal incident: the `ETag` of `/api/manual-incidents`, `GET /`, `/feed.atom` and the
  component badge is the same in both; `If-None-Match: <tag of the first>` gets `304` on the
  second. A wrong implementation that tags the upstream bytes, or filters only the JSON proxy,
  gets a different tag on at least one surface.

Browser modules:

- Status with the contract pin moved to `2.1.0` and `contractModules` unchanged:
  `GET /pulse-contract/manual-incident-public.js` answers `404`, the import-graph test fails, and
  the page's poller cannot load in the browser. The correct change answers `200` with a
  JavaScript type. A wrong fix that serves every file of the contract directory answers `200` for
  `/pulse-contract/manual-incident-public.d.ts`; the correct allow-list answers `404`.

Publication and ordering:

- Second `POST /admin/manual-incidents/<id>/publish` after a successful one: `409 manual incident
  has no draft`; public `updates` length unchanged; notify sends no second event.
- Draft incident saved at `t0`, notify starts at `t1 > t0`, publish at `t2 > t1`: public
  `createdAt = updates[0].at = t2`; notify sends `manual:<id>:opened` once. A wrong
  implementation that keeps `createdAt = t0` still sends (keys are ids), but the page would show a
  start time before the publication: the api test asserts `createdAt === publishedAt === t2`.
- Clock step back: last update at `t = 1000`, `now() = 900` at publish: the published update has
  `at = 1000` (not 900); updates stay ordered.
- A note added at `t = 2000` to an incident whose last update is at `t = 1000`: public `updates`
  and their `at` values unchanged; `/feed.atom` keeps the same entry ids `manual:<id>:0..n`.
- Legacy resolve of an incident with a draft update: the draft is gone afterwards
  (`GET /admin/manual-incidents/<id>` has `draft: null`); a later publish is `409 manual incident
  has no draft`.

Validation and limits:

- `POST /manual-incidents` with `{"title":"T","impact":"none","componentIds":[],"message":"m",
  "visibility":"internal"}`: `400`, nothing stored (the non-strict input schema would strip the
  key and create a public incident).
- `POST /admin/manual-incidents` without `visibility`: `400`. With `"visibility":"private"`: `400`.
  With `"status":"resolved"`: `400`. With an unknown key `"draft":true`: `400`.
- Title of 201 characters, message of 2001 characters, note message of 2001 characters: `400`.
  A note message `"a\u0007b"`: `400` (control character); `"a\nb"`: accepted.
- 101st draft incident: `409`. 101st note: `409`. Draft save or publish when 100 updates exist:
  `409`.
- Body of 16 KiB + 1 byte to `POST /admin/manual-incidents/<id>/publish`: `413`.
- `GET /admin/manual-incidents/abc`: `404` before auth (no `401`, not throttled).
  `GET /admin/manual-incidents/1` without a token: `401`, also when id 1 does not exist.
  With a probe token: `403`. With `admin` but without `incidents`: `403`.
- With the config writes off (no `ops.admin`): `GET /admin/manual-incidents` with a valid token is
  still `200` (dispatched before the `/admin/*` delegation). A wrong implementation that adds the
  routes to the admin handler answers `404` there.
- Publish of a draft incident whose component `web` was removed from the config after the save:
  `409 componentIds: unknown component "web"`; the incident stays a draft.
- Component removal with only a draft incident naming it: allowed (decision 8). With a published
  internal open incident naming it: `409` as today.
- A step-6 database (an api with #565) opened by the new api: `user_version` becomes `7`; the
  same file opened afterwards by the #565 api is refused with "newer than this program supports".

Metrics (exact): `pulse_api_manual_incidents_created_total` increases by exactly 1 per published
**public** incident (legacy create or publish of a public draft incident), by 0 for the
publication of an internal incident and for draft save, edit, discard, note and delete.
`pulse_api_manual_incidents_resolved_total` increases by exactly 1 per write that resolves a
**public** incident (legacy resolve, legacy update with `resolved`, publish of a resolving draft
update), by 0 when an internal incident resolves. `pulse_api_http_requests_total` gains no series
and no count for any path under `/admin/manual-incidents`. The counters live in memory and start
at 0 on every api start (`api/src/metrics.ts:59-64`, initialized at `:133-134`); this spec does
not change that. So a check across an api restart asserts literal values counted from that
restart, never lifetime totals: a wrong check that expects the run's lifetime totals after a
restart fails on a correct api. No statistic over time windows is defined by this spec.

## Contract fields

New names, all in contract `src/` (field names on the new `InternalManualIncident` shape and new
exports, including every lowercase schema constant and the new module file). Every name of the
table below is searched by its full text; `grep` is case-sensitive, so `publicManualIncident`
does not match `isPublicManualIncident`. Searches of the contract clone (`176fb6e…`, version
`2.0.0`) and the config clone, run from the meta checkout. The module name is also searched in
the status clone, which serves contract modules by file name: `grep -rn 'manual-incident-public'
.repos/status/src | wc -l` prints `0`, so the new `contractModules` entry collides with nothing.

```
$ for n in visibility publishedAt savedAt author notes '"draft"' 'draft:' \
    MANUAL_INCIDENT_VISIBILITIES MANUAL_INCIDENT_MAX_NOTES MANUAL_INCIDENT_MAX_DRAFTS \
    InternalManualIncident InternalManualIncidentsResponse ManualIncidentNote \
    ManualIncidentNoteInput ManualIncidentDraft ManualIncidentDraftInput ManualIncidentVisibility \
    manualIncidentDraftSchema manualIncidentNoteSchema internalManualIncidentSchema \
    manualIncidentDraftInputSchema manualIncidentNoteInputSchema manualIncidentVisibilitySchema \
    validateInternalManualIncident validateInternalManualIncidentsResponse \
    validateManualIncidentDraftInput validateManualIncidentNoteInput \
    isPublicManualIncident publicManualIncident manual-incident-public admin/manual-incidents \
    manual-incident.publish manual-incident.edit manual-incident.draft manual-incident.note; do
    printf '%s: ' "$n"; grep -rn -- "$n" .repos/contract/src .repos/config | wc -l; done
visibility: 0
publishedAt: 0
savedAt: 0
author: 0
notes: 0
"draft": 0
draft:: 0
MANUAL_INCIDENT_VISIBILITIES: 0
MANUAL_INCIDENT_MAX_NOTES: 0
MANUAL_INCIDENT_MAX_DRAFTS: 0
InternalManualIncident: 0
InternalManualIncidentsResponse: 0
ManualIncidentNote: 0
ManualIncidentNoteInput: 0
ManualIncidentDraft: 0
ManualIncidentDraftInput: 0
ManualIncidentVisibility: 0
manualIncidentDraftSchema: 0
manualIncidentNoteSchema: 0
internalManualIncidentSchema: 0
manualIncidentDraftInputSchema: 0
manualIncidentNoteInputSchema: 0
manualIncidentVisibilitySchema: 0
validateInternalManualIncident: 0
validateInternalManualIncidentsResponse: 0
validateManualIncidentDraftInput: 0
validateManualIncidentNoteInput: 0
isPublicManualIncident: 0
publicManualIncident: 0
manual-incident-public: 0
admin/manual-incidents: 0
manual-incident.publish: 0
manual-incident.edit: 0
manual-incident.draft: 0
manual-incident.note: 0
$ grep -rn 'MANUAL_INCIDENT_MAX_UPDATES' .repos/contract/src .repos/config | wc -l
4
$ grep -rn 'manualIncidentSchema' .repos/contract/src .repos/config | wc -l
5
$ grep -rn 'admin/manual' .repos/api/src .repos/console/src .repos/status/src .repos/notify/src .repos/deploy/e2e | wc -l
0
```

The two counts `4` and `5` are positive controls: the same search finds existing names, one
uppercase constant and one lowercase schema constant. `manual-incident.draft` and
`manual-incident.note` are prefixes of the four new draft and note actions, so their 0 covers
`manual-incident.draft-save`, `.draft-discard`, `.note-add` and `.note-delete`. The last search
shows that no service uses the new route prefix yet. Not new: `MANUAL_INCIDENT_MAX_BODY_BYTES`
(exists, `contract/src/schema.ts:792`, reused) and the api permission `incident-write` (exists,
`api/src/token-scopes.ts:8`, reused). Full list:

| Name | Kind |
| --- | --- |
| `MANUAL_INCIDENT_VISIBILITIES = ["public", "internal"]`, `ManualIncidentVisibility`, `manualIncidentVisibilitySchema` | constant, type, schema |
| `MANUAL_INCIDENT_MAX_NOTES = 100`, `MANUAL_INCIDENT_MAX_DRAFTS = 100` | constants |
| `ManualIncidentDraft` `{status, message, savedAt}` | schema, type |
| `ManualIncidentNote` `{id, at, author, message}` | schema, type |
| `InternalManualIncident` `{id, title, componentIds, impact, visibility, status, createdAt, publishedAt, resolvedAt, updates, draft, notes}`, `InternalManualIncidentsResponse` | schema, type |
| `ManualIncidentDraftInput` `{title, impact, componentIds, status?, message, visibility}`, `ManualIncidentNoteInput` `{message}` | schemas, types |
| `validateInternalManualIncident`, `validateInternalManualIncidentsResponse`, `validateManualIncidentDraftInput`, `validateManualIncidentNoteInput` | validators |
| `manualIncidentDraftSchema`, `manualIncidentNoteSchema`, `internalManualIncidentSchema`, `manualIncidentDraftInputSchema`, `manualIncidentNoteInputSchema` | zod schema constants |
| `isPublicManualIncident`, `publicManualIncident` | functions |
| `src/manual-incident-public.ts` (built to `dist/manual-incident-public.js`) | module file |
| status path `/pulse-contract/manual-incident-public.js` (entry `"manual-incident-public.js"` of `contractModules`) | served browser module |
| audit actions `manual-incident.edit`, `.draft-save`, `.draft-discard`, `.publish`, `.note-add`, `.note-delete` | `AUDIT_ACTIONS` values |
| routes `/admin/manual-incidents`, `/:id`, `/:id/draft`, `/:id/publish`, `/:id/notes`, `/:id/notes/:noteId` | api routes |

## Repository: contract

Files:
- `src/schema.ts`
- `src/validate.ts`
- `src/manual-incident-public.ts`
- `src/audit.ts`
- `src/index.ts`
- `test/manual-incidents.test.ts`
- `test/audit.test.ts`
- `test/smoke.test.ts`
- `test/types.fixture.ts`
- `docs/index.md`
- `package.json`
- `dist/`

Behavior change: yes
New exported validators, guard and audit actions change what consumers accept.

What each file gets: `src/schema.ts` the new constants, the six new schemas and their types;
`src/validate.ts` the four validators; `src/manual-incident-public.ts` (new module) the guard and
the projection; `src/audit.ts` the six actions; `src/index.ts` the exports;
`test/smoke.test.ts` the exact export list of the package entry (`test/smoke.test.ts:50`) gains
every new runtime export; `test/types.fixture.ts` every new exported type; `docs/index.md` the
types table (`docs/index.md:45-49`), constants and audit actions; `package.json` version `2.0.0` to
`2.1.0` (`package.json:3`); `dist/` rebuilt with `bun run build`.

Baseline: contract `2.0.0` (`176fb6e…`) with #565's admin shapes. Nothing of `src/admin.ts`,
`src/validate-admin.ts` or `src/validate-core.ts` changes.

Behavior:

- `internalManualIncidentSchema` (`z.object`, like `manualIncidentSchema`) with the invariants of
  R1, each as a custom issue with a path:
  1. `publishedAt === null` iff `updates` is empty;
  2. `publishedAt === null` implies `draft !== null`, `draft.status !== "resolved"`,
     `status === draft.status`, `resolvedAt === null`;
  3. `publishedAt !== null` implies `updates[0].at === publishedAt`, and the existing
     `ManualIncident` invariants (order of `at`, last status, `resolvedAt`,
     `contract/src/schema.ts:880-923`);
  4. `status === "resolved"` implies `draft === null`;
  5. notes ordered by `at` then `id`, ids unique; at most `MANUAL_INCIDENT_MAX_NOTES`.
- `manualIncidentNoteSchema.message` and `manualIncidentDraftSchema.message` use the existing
  `manualMessage` rule (`src/schema.ts:819`); `author` is a non-empty string without maximum
  (legacy token names have none, `src/tokens.ts:99-100`); `id` a positive integer.
- `ManualIncidentDraftInput` and `ManualIncidentNoteInput` are `z.strictObject`; `status` uses the
  existing open-status rule (`src/schema.ts:804`); `visibility` is required.
- `ManualIncident`, `manualIncidentSchema`, `validateManualIncident`,
  `validateManualIncidentsResponse` and `WIRE_VERSION` do not change.
- Guard and projection: R6. `publicManualIncident` builds a new object (the validators keep
  returning the same object they were given, `AGENTS.md` "This repository").
- The module file name `src/manual-incident-public.ts` is fixed by this spec: status serves
  contract files to the browser by file name (`status/src/server.ts:189-205`) and allow-lists
  exactly `manual-incident-public.js` (Repository: status). Its relative imports point only at
  existing contract modules (for example `./schema.ts`, `./validate-core.ts`), so `dist/index.js`
  imports exactly one new file. The module needs no `zod` import for the guard and projection.
- Audit: the six actions; `kindOf` (`src/audit.ts:62`) maps each to `manual-incident`.

Checks:

- Tool facts, verified: Bun `1.4.0` (`package.json:7`, `package.json:9`). `bun run check` =
  lint, build, typecheck, test (`package.json:28`); lint = `biome check . && pulse-eslint .`
  (`package.json:25`); build and typecheck use `typescript7` (`package.json:22-23`, `:36`). Biome
  `2.6.3` (`package.json:31`); `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned
  at `51e95b0eb463b27a196a33b428607bd92443e4f0` (`package.json:32`), whose `files.includes` is
  `**` without `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures` (`biome.json:10-17`
  of pulse-config at that ref; read with `gh api`, identical to the config clone). Tests:
  `bunfig.toml:1-4`, coverage on, line threshold 0.8. CI: `ci.yml:17` uses
  `pulse-config/.github/workflows/check.yml@51e95b0…` with `build: true` (`ci.yml:19`); that file
  runs install, lint, typecheck, build, `git diff --exit-code -- dist` and test (`check.yml:25-38`
  at that ref; identical to the clone). `test/smoke.test.ts:15` fails when `dist/` is stale.
- Tests that fail on current `main` (the exports do not exist): guard true for public items
  without the two fields and for `visibility:"public", publishedAt:<number>`; false for each
  counterexample of R6 and "Counterexamples"; for an accessor on `visibility` and on
  `publishedAt` (returning `"public"` and `5`, and throwing) the guard returns false, does not
  throw, and the getter's call counter is 0 (literal); the inherited-name case returns true and the
  throwing-proxy and revoked-proxy cases false; projection drops `draft`, `notes`, `visibility`
  and unknown update fields; each internal invariant 1-5 rejects one bad record and accepts one
  good record per state of the R1 table; strict inputs reject `"draft": true`; audit validator
  accepts `manual-incident.publish` with kind `manual-incident` and rejects it with kind `check`.
- Existing tests, including the admin tests of #565 (`test/admin.test.ts`), pass unchanged.

Completion evidence: `bun run check` passes; the PR lists the new tests and shows them failing on
the pre-change `main` SHA; `dist/` committed; `test/types.fixture.ts` compiles every new type; the
merge SHA is reported for the consumers' pins.

## Repository: api

Files:
- `src/migrations.ts`
- `src/manual-incidents.ts`
- `src/manual-incident-routes.ts`
- `src/server.ts`
- `src/manual-incidents.test.ts`
- `src/server.manual-incidents.test.ts`
- `src/server.manual-incidents.private.test.ts`
- `src/server.manual-incidents.audit.test.ts`
- `src/server.manual-incidents.metrics.test.ts`
- `src/db.migrations.test.ts`
- `docs/rest-api.md`
- `docs/operation.md`
- `docs/concepts.md`
- `README.md`
- `package.json`
- `bun.lock`

Behavior change: yes
New routes, storage, migration, audit actions and a filtered public projection.

What each file gets: `src/migrations.ts` step 7 of R5; `src/manual-incidents.ts` the store with
drafts, publish, notes, visibility, the public projection, the draft-aware open-incident check of
decision 8, resolve deletes the draft, the public-only event callbacks; `src/manual-incident-routes.ts`
(new module) the handler of the private routes, so the server module keeps only dispatch;
`src/server.ts` dispatch of the private routes before the `/admin/*` delegation (`:611-614`), the
auth failure route labels of R4, the request hook skips the private paths (decision 14), the legacy
create refuses the two privacy keys, legacy writes on a draft or internal incident answer the
unknown-id 404, the empty store stub gains the new methods; `src/manual-incidents.test.ts` (new)
store rules, publish, limits, clock step back; `src/server.manual-incidents.test.ts` public
projection and legacy behavior; `src/server.manual-incidents.private.test.ts` (new) private routes
over HTTP, auth order, the R3 table, persistence by reopening the database file;
`src/server.manual-incidents.audit.test.ts` new actions, rollback on audit failure;
`src/server.manual-incidents.metrics.test.ts` (new) the anonymous metrics endpoint before and
after private-only actions (decisions 11, 14); `src/db.migrations.test.ts` step 7 on a step-6 file;
`docs/rest-api.md` route table (`:21-23`), private routes, state rules, curl examples for draft,
edit, publish, draft update, note, internal-only, ids are not contiguous (decision 15), the audit
action list (`:412`); `docs/operation.md` the manual incidents section (`:161-165`, including the
upgrade order), log actions (`:308`, `:312`), a downgrade needs a backup, the counters count only
public incidents, private routes are not in the request counter, the config write conflict limit
of R4; `docs/concepts.md` drafts, notes, visibility; `README.md` the manual incidents paragraph
(`README.md:56`); `package.json` contract pin from `176fb6e…` (`package.json:31`) to the merged
`2.1.0` SHA; `bun.lock` updated by `bun install`.

Behavior: R1 to R5 and decisions 2, 3, 4, 7, 8, 10, 11, 14, 15. Builds on #565: the api already
holds schema step 6 and the database checks; nothing of `check-store.ts`, `check-write.ts`,
`config-write.ts`, `admin-routes.ts` or `effective-checks.ts` changes. `src/token-scopes.ts` and
`src/start.ts` do not change: the private routes reuse `incident-write`, and the store keeps its
deps (`now`, `componentIds`, `onEvent`, `recordAudit`, `api/src/manual-incidents.ts:49-57`;
wiring `api/src/start.ts:358-361`). Additional rules:

- The store keeps SQL in the store module and maps rows to contract types there, as today. Every
  write is one `BEGIN IMMEDIATE` transaction with its audit entry (`src/manual-incidents.ts:149`).
- The public list and detail are built in SQL with `published_at IS NOT NULL AND visibility =
  'public'`, then mapped with only the public fields (`publicManualIncident` may be used on the
  mapped object).
- `createdAt` of the internal view is `created_at` (first save); the public `createdAt` is
  `published_at` (decision 7). For legacy creates both are the same time.
- Callbacks `onEvent("created")` and `onEvent("resolved")` fire after commit, exactly as R4
  metrics say: only for a `public` incident.
- The request hook (`src/server.ts:835`) skips `recordRequest` for the private paths; the
  private handler still calls the existing admin auth failure and throttle recorders through
  `ops.authThrottle.authorize` (`src/server.ts:438-443`).
- Legacy writes look the incident up as public-published first: a draft or internal row is
  treated as missing (`404 manual incident not found`, same body as today's unknown id).

Checks:

- Tool facts, verified: Bun `1.4.0` (`package.json:9`, `package.json:35`). `bun run check` =
  lint, typecheck, test (`package.json:20`); lint = `biome check . && pulse-eslint . &&
  pulse-workflows` (`package.json:16`); typecheck `typescript7` (`package.json:14`, `:27`); test
  `bun test` (`package.json:15`) with coverage and line threshold 0.8 (`bunfig.toml:1-4`). Biome
  `2.6.3` (`package.json:23`); `biome.json:2` extends the shared config pinned at
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`), `files.includes` as in the
  contract section (`biome.json:10-17` at `04108fa…`, read with `gh api`, identical to the clone).
  CI `ci.yml:18` uses `check.yml@04108fa…` (install, lint, typecheck, test; `check.yml:25-38`,
  identical to the clone, `build` input not set); CI also runs `bun run bench:selftest`
  (`ci.yml:31-32`), which this change must keep green.
- Tests that fail on current `main` (each with a positive control read through the private route
  that must succeed first, so a rejected write cannot pass an absence assertion):
  1. Draft: `POST /admin/manual-incidents` → `201`, `publishedAt: null`;
     `GET /admin/manual-incidents/<id>` → `200` with the title; public list (`all`, `open`)
     lacks the id; public detail → `404` with the unknown-id body.
  2. Publish: then `POST …/publish` → `200`; public list has it with `createdAt ===
     updates[0].at === publishedAt`; a second publish → `409`; public `updates` length 1.
  3. Draft update with `resolved`: public `status`, `resolvedAt`, `updates` unchanged until
     publish; after publish `resolved`, `resolvedAt` = last `at`, length 2;
     `pulse_api_manual_incidents_resolved_total` + 1.
  4. Note: `201`, visible in the private detail after reopening the database; absent from public
     list and detail bytes (search the response text for the note sentinel); public `updates`
     identical before and after (deep equal).
  5. Internal: published internal incident absent from public list/detail; present in the
     private list; legacy create with `visibility` → `400`; legacy update, resolve and delete
     of the internal id and of a draft id → `404` with the body of id `999999`, and the private
     detail afterwards is unchanged (deep equal).
  6. Auth: R3 order and every counterexample of "Validation and limits", including the private
     routes answering with the config writes off (server built without `admin`).
  7. Public detail indistinguishable (decision 15): for a draft id, an internal id, a deleted id
     and `999999`, status `404`, the body `{"error":"manual incident not found"}` (literal) and
     the header names and values apart from `Date` are equal.
  8. Public metrics (decisions 11 and 14), in `src/server.manual-incidents.metrics.test.ts`, on
     a fresh api with an admin token, reading anonymous `GET /metrics`:
     - before: `pulse_api_manual_incidents_created_total 0` and `..._resolved_total 0`
       (literals);
     - private-only sequence: create an internal draft, edit it, add a note, publish it (`200`),
       save a resolving draft update, publish it (`200`, `status: "resolved"`, the positive
       control read through `GET /admin/manual-incidents/<id>`), create a public draft, add a
       note to it and delete that note; legacy `POST /manual-incidents/<internal
       id>/updates` → `404`;
     - after: both counters still `0` (literal); no line of `/metrics` contains
       `/admin/manual-incidents`, except `pulse_api_admin_auth_failures_total` lines (none in
       this sequence, which has no failed auth: literal 0 such lines); every `pulse_api_` line
       equals the before text except `pulse_api_http_requests_total` lines with
       `route="/metrics"`, and the legacy line
       `pulse_api_http_requests_total{route="/manual-incidents/:id/updates",code="404"} 1`
       (literal);
     - positive control: publish the public draft → `created_total 1` (literal); legacy
       resolve of it → `resolved_total 1` (literal);
     - a `401` on `GET /admin/manual-incidents/1` gives
       `pulse_api_admin_auth_failures_total{route="/admin/manual-incidents/:id",status="401"} 1`
       (literal) and still no request counter line for the path.
     This test fails on current `main` (the private routes answer `404`, so the positive
     controls fail), and it would fail on the #702 spec (`created_total 1` after the internal
     publish).
  9. Migration: a step-6 file (the schema of api `main` with #565) holding one resolved and one
     open incident gives identical `GET /manual-incidents` JSON before and after opening with the
     new code; `PRAGMA user_version` is `7` (literal) afterwards; the `check_definitions` and
     `config_state` rows of step 6 are unchanged (deep equal).
- Existing manual incident tests (create, update, resolve, delete, audit, throttle) and the
  database check tests of #565 pass unchanged.
- Before handoff: `bun start` with an admin token, run the `curl` examples of
  `docs/rest-api.md`, report commands and answers.

Completion evidence: `bun run check` passes; PR names the failing-on-main tests with the
pre-change SHA; the bench or `test_cpu_s` numbers of "Performance impact".

## Repository: status

Files:
- `src/api-filter.ts`
- `src/poller.ts`
- `src/syndication.ts`
- `src/server.ts`
- `src/server.contract-modules.test.ts`
- `src/manual-incidents.test.ts`
- `src/api-filter.test.ts`
- `src/server.privacy.test.ts`
- `src/server.syndication.test.ts`
- `README.md`
- `docs/operation.md`
- `package.json`
- `bun.lock`

Behavior change: yes
Status drops upstream items marked private.

What each file gets: `src/api-filter.ts` drops non-public manual incident items before cleaning;
`src/poller.ts` filters, validates, projects; `src/syndication.ts` the manual incident reader of
feed and badge skips non-public items; `src/server.ts` adds `manual-incident-public.js` to the
allow-list `contractModules` (`src/server.ts:189-205`); `src/server.contract-modules.test.ts`
asserts that the new file is served and is part of the import graph;
`src/manual-incidents.test.ts` poller, render and component
state with private items; `src/api-filter.test.ts` filter cases; `src/server.privacy.test.ts` proxy,
SSR page, feed and badge over HTTP with a fake api, entity tags and not-modified answers with and
without private items (decision 16); `src/server.syndication.test.ts` feed entries, feed updated
time and badge state; `README.md` and `docs/operation.md` say where manual incidents are described
that private items are dropped and that this needs contract `2.1.0`; `package.json` contract pin
from `7ce23aaf…` (`package.json:34`) to the merged `2.1.0` SHA; `bun.lock` updated by `bun install`.

Behavior: R7. The poller is a browser module (`AGENTS.md` "This repository", `tsModules` at
`src/server.ts:177-185`); it imports `isPublicManualIncident` and `publicManualIncident` from the
contract as runtime values. `browserModule` rewrites that import to `/pulse-contract/index.js`
(`src/server.ts:285-290`). No new status browser module is added to `tsModules`.

Served contract modules: the server serves a contract file under `/pulse-contract/` only when its
name is in the allow-list `contractModules` (`src/server.ts:189-205`); `readContractModule`
returns `undefined` for every other name (`src/server.ts:254`), so the asset route answers
`404`. Contract `2.1.0` adds the module `src/manual-incident-public.ts`, built to
`dist/manual-incident-public.js` (contract `dist/` holds one `.js` per `src/*.ts`, and
`dist/index.js:1-10` re-exports each module with `from "./<name>.js"`), and its `index.js` imports
it. With the new pin and the old allow-list the browser's request for
`/pulse-contract/manual-incident-public.js` answers `404`, so the module graph of `index.js` fails
to load, the poller does not start in the browser, and the existing test "every import of the
served contract graph resolves to a served file" (`src/server.contract-modules.test.ts:92-118`)
fails at `assert.equal(r.status, 200, path)` (`:101`). So:

- `contractModules` gains exactly one entry, `"manual-incident-public.js"`. No other entry is
  added or removed; the set stays an explicit allow-list (no directory listing, no pattern).
- The zod rewrite in `readContractModule` (`src/server.ts:255`) applies to the new file like to
  the others; if the module imports nothing from `zod`, the rewrite is a no-op.
- Every other module that `dist/index.js` of the merged `2.1.0` imports is already in the list:
  the `2.0.0` modules (`admin`, `audit`, `client`, `components`, `revision`, `schema`, `token-id`,
  `tokens`, `validate`, `validate-admin`, `validate-audit`, `validate-core`, `validate-tokens`,
  `version`) are all in `src/server.ts:189-205` today (compare `ls contract/dist` at `176fb6e…`).
  If the merged contract imports any further module, it is added the same way and the PR names it.

Pin move: the new pin crosses contract `2.0.0` (#565). Status imports no admin type (search in
"Risks"), so no code change follows from it. **Shared finding:** whether any existing test fails
only because of the pin move from `7ce23aaf…` to the `2.1.0` SHA is the same question in the status
and notify sections. The child that answers it first records it; the other reads it before it
starts.

Checks:

- Tool facts, verified: Bun `1.4.0` (`package.json:9`, `package.json:38`). `bun run check` =
  lint, typecheck, test (`package.json:19`); lint `biome check . && pulse-eslint . &&
  pulse-workflows` (`package.json:15`); typecheck runs `typescript7` twice, the second with
  `-p e2e` (`package.json:13`); test `bun test` (`package.json:14`), coverage threshold 0.8
  (`bunfig.toml:1-4`). Biome `2.6.3` (`package.json:23`), `biome.json:2` extends the shared
  config at `04108fa…` (`package.json:24`; identical to the clone). CI `ci.yml:18` uses
  `check.yml@04108fa…`; CI also installs Chromium and runs `bun run check:a11y`
  (`ci.yml:64-68`, `package.json:18`), which this change must keep green.
- Fake upstream bodies, with sentinels `DRAFT-7f3a`, `INTERNAL-5d17`, `NOTE-2b8e`, `UPD-9c41`:
  - a public control incident (no new fields) with impact `major` on component `web`;
  - a draft `{publishedAt: null, visibility: "public", title: "DRAFT-7f3a", impact: "critical",
    componentIds: ["api"], updates: [{…, message: "DRAFT-7f3a"}]}` (valid as `ManualIncident`, so
    current `main` shows it);
  - an internal `{publishedAt: <n>, visibility: "internal", title: "INTERNAL-5d17", impact:
    "critical", componentIds: ["api"]}`;
  - the public control with `notes: [{message: "NOTE-2b8e"}]` and `draft: {status: "resolved",
    message: "UPD-9c41"}`.
- Assertions, with `PULSE_STATUS_HIDE_DETAILS` on and off: `/api/manual-incidents` JSON, the SSR
  `GET /` HTML, `/feed.atom` and `/badge/component/api.svg` contain no sentinel; the badge of
  `api` keeps its check-derived state; the control incident is present everywhere and
  `web` shows `down` (positive control); the control's feed ids stay `manual:<id>:0`.
- Entity tags (decision 16), with two fake upstreams started in the same test: `U1` serves only
  the public control; `U2` serves the control plus the draft, the internal incident and the
  control's `notes` and `draft` fields above. The draft and the internal incident carry
  `updates[0].at` and `createdAt` later than every public time, so a feed `<updated>` built from
  them would differ. For each of `/api/manual-incidents`, `GET /`, `/feed.atom` and
  `/badge/component/api.svg`, with `PULSE_STATUS_HIDE_DETAILS` on and off: the body bytes and the
  `ETag` header from a status on `U1` equal those from a status on `U2`; a request to the status
  on `U2` with `If-None-Match` set to the `U1` tag answers `304` with no body. Positive control:
  a third upstream `U3` that adds a second public incident gives a different tag on each
  surface, and the `U1` tag gets `200` there. Fails on current `main` for the draft and internal
  items (they are served, so the bytes and tags differ); passes on `main` for the `notes` and
  `draft` fields alone (regression guard). Both statuses use the same fake clock and settings,
  so the only input that differs is the upstream body.
- Served contract modules (`src/server.contract-modules.test.ts`, with the new pin installed):
  - `GET /pulse-contract/manual-incident-public.js` answers `200` (literal) with a
    `content-type` matching `/javascript/` (literal; `JS_TYPE`, `src/server.ts:275`), its body
    contains the literal text `isPublicManualIncident` and no bare `from "zod"`;
  - the existing import-graph test (`:92-118`) passes and its `seen` set contains
    `/pulse-contract/manual-incident-public.js` (new literal assertion);
  - the allow-list stays closed: `/pulse-contract/other.js` still answers `404` (existing,
    `:68`), and so does `/pulse-contract/manual-incident-public.d.ts` (new literal case; the
    `.d.ts` file exists in the contract `dist/` but is not allow-listed).
  The first two fail with the new pin and the old allow-list (status `404`), which is the
  failure this entry prevents. The PR shows that failure: the pin moved and `src/server.ts`
  unchanged, `bun test src/server.contract-modules.test.ts` fails.
- Browser check: `bun run check:a11y` (`package.json:18`, Chromium in CI `ci.yml:64-68`) loads
  the page with the new pin; it stays green.
- Fail on current `main`: the draft and internal cases (current `main` serves both). The note and
  draft-update cases already pass on `main`, because the allow-list strips unknown fields; they
  are regression guards and the PR says so.

Completion evidence: `bun run check` and `check:a11y` pass; PR shows the failing-on-main tests at
the pre-change SHA, and the `404` of `/pulse-contract/manual-incident-public.js` with the new pin
before the allow-list entry was added.

## Repository: notify

Files:
- `src/api.ts`
- `test/manual-incidents.test.ts`
- `test/api.test.ts`
- `README.md`
- `docs/channels.md`
- `docs/operation.md`
- `package.json`
- `bun.lock`

Behavior change: yes
Notify ignores upstream items marked private.

What each file gets: `src/api.ts` the manual incident fetch skips non-public items and projects
accepted ones; `test/manual-incidents.test.ts` detection with private items; `test/api.test.ts` a
skipped item is not rejected and logs nothing; `README.md`, `docs/channels.md` and
`docs/operation.md` say that drafts, notes and internal incidents are never sent and that this
needs contract `2.1.0`; `package.json` contract pin from `7ce23aaf…` (`package.json:30`) to the
merged `2.1.0` SHA; `bun.lock` updated by `bun install`.

Behavior: R8 and decision 9. No config key, no metric, no ledger change.

Pin move: the new pin crosses contract `2.0.0` (#565). Notify imports no admin type (search in
"Risks"). **Shared finding:** whether any existing test fails only because of the pin move from
`7ce23aaf…` to the `2.1.0` SHA is the same question in the status and notify sections. The child
that answers it first records it; the other reads it before it starts.

Checks:

- Tool facts, verified: Bun `1.4.0` (`package.json:9`, `package.json:35`). `bun run check` =
  lint, typecheck, test (`package.json:17`); lint `biome check . && pulse-eslint . &&
  pulse-workflows` (`package.json:14`); typecheck `typescript7` (`package.json:12`, `:27`); test
  `bun test` (`package.json:13`), coverage threshold 0.8 (`bunfig.toml:1-4`). Biome `2.6.3`
  (`package.json:21`), extends the shared config at `04108fa…` (`package.json:22`, `biome.json:2`;
  identical to the clone). CI `ci.yml:18` uses `check.yml@04108fa…`.
- Tests with a fake api and a file channel without filters (catch-all) plus a component-filtered
  channel:
  1. First poll: no manual incident (it seeds nothing). Second poll: public control `A`, a
     published internal `I` (`visibility: "internal"`) and a draft `D` (`publishedAt: null`, one
     update, valid as `ManualIncident`). Both channels hold exactly one `manual:A:opened` (the
     positive barrier) and no line for `I` or `D`. Fails on current `main` (it sends `I` and `D`).
  2. `A` with `notes` and a `draft` holding sentinel text, served together with a new public
     marker `B`: after the awaited poll that read this body, both channels hold exactly one
     `manual:B:opened` (positive barrier: the poll read this body and finished its writes), no
     payload line contains a sentinel, and there is no update event for `A`.
  3. Draft `D` is in the first poll (as a draft) and is a published public item in a later poll
     (same id, `publishedAt` set, `createdAt` = `publishedAt`): exactly one `manual:D:opened` is
     sent. Fails on current `main`: its first poll seeds `manual:D:opened` as handled, so the
     publication is never sent.
  4. Restart with the same ledger: nothing is sent twice.
  5. A skipped private item is not in `rejected` and logs nothing, and
     `pulse_notify_skipped_items_total{feed="manual-incidents"}` stays `0` (literal) after a
     poll of `A`, `I` and `D`. Positive control in the same test: a malformed public item
     (missing `title`) in the next poll raises it to `1` (literal).
- Existing manual incident, routing, upgrade and alert tests pass unchanged.

Completion evidence: `bun run check` passes; PR shows tests 1 and 3 failing at the pre-change
SHA.

## Repository: deploy

Files:
- `e2e/compose-e2e.sh`
- `e2e/compose.e2e.yaml`
- `scripts/check-setup.sh`
- `scripts/check-setup.test.sh`
- `.github/workflows/ci.yml`
- `README.md`
- `AGENTS.md`

Behavior change: yes
A test mode, a scenario and a CI job change.

What each file gets: `e2e/compose-e2e.sh` the `E2E_SETUP` stack choice `full` or `dev` and the
privacy step; `e2e/compose.e2e.yaml` its header comment (`e2e/compose.e2e.yaml:1-3`) names both
base files and says relative paths resolve from `full/` or `dev/` (siblings, so `../e2e/ro`
works for both), and never gets an image line; `scripts/check-setup.sh` rule 5 also resolves the
dev base with the e2e overlay and compares its published ports with a literal row;
`scripts/check-setup.test.sh` a case that fails when the dev plus e2e ports differ;
`.github/workflows/ci.yml` the new job `e2e-dev`; `README.md` the end-to-end section
(`README.md:133`) names the dev stack choice, the new job and the skip line; `AGENTS.md` the
commands table and the CI job list gain the dev mode and `e2e-dev`.

Behavior:

- `compose-e2e.sh` reads `E2E_SETUP` (default `full`). It selects only the base Compose file:
  with `full`, `COMPOSE_FILE` stays `full/compose.yaml:e2e/compose.e2e.yaml`
  (`e2e/compose-e2e.sh:14`); with `dev`, it is `dev/compose.yaml:e2e/compose.e2e.yaml`, and the
  images `pulse-<svc>:dev` are built from the sibling checkouts (`PULSE_SRC_DIR`, as
  `dev/compose.yaml:33`, `:50`, `:66`, `:78`, `:89`) with `docker compose build` before `up`. Any
  other value fails at once with `E2E_SETUP must be full or dev`. The full-only setup assertions
  get their dev counterpart: the "no build key" check (`e2e/compose-e2e.sh:333-334`) holds for
  `full` only, and in `dev` every service except `secrets-init` and `e2e-target` has a build key;
  the service list check (`:328-331`) reads the chosen base file. The project name stays
  `pulse-e2e` (verified: `docker compose config` of `dev/compose.yaml:e2e/compose.e2e.yaml` with
  `COMPOSE_PROJECT_NAME=pulse-e2e` prints `name: pulse-e2e` and the ports `api 127.0.0.1 3000
  3000`, `console 127.0.0.1 8082 8082`, `status - 8080 8080`). No new `image:` line in `e2e/`
  (`scripts/check-setup.sh:60-66`, `AGENTS.md` "Rules"). Every existing step must pass in both
  modes. If an existing step fails against `main` for a reason outside this feature, the
  implementer fixes the script so it passes for both the `0.1.0` images and `main`, or requests a
  hold with the failing step.
- `E2E_SETUP` never selects a test path. Which steps run is decided by detecting the api, as the
  script already does ("Detect the api kind once. Nothing else selects a path: no environment
  variable, no pin value", `e2e/compose-e2e.sh:656-666`).
- New CI job `e2e-dev` in `ci.yml`: the same checkouts of the five service `main`s as the `dev`
  job (`ci.yml:181-217`), `scripts/init-secrets.sh`, then `set -o pipefail; E2E_SETUP=dev bash
  e2e/compose-e2e.sh | tee e2e-dev.log` and then `grep -qx 'ok: manual incident privacy' e2e-dev.log`
  (a skip in `dev` fails the job), with `timeout-minutes: 60` for build and test. Triggers as the
  workflow (`ci.yml:3-10`). Teardown `docker compose -p pulse-e2e -f dev/compose.yaml -f
  e2e/compose.e2e.yaml down -v --remove-orphans` with `if: always()`. Actions only by the SHAs
  already used in the file, `persist-credentials: false`.
- `scripts/check-setup.sh` rule 5 (`scripts/check-setup.sh:74-128`) gains the combination
  `dev/compose.yaml` + `e2e/compose.e2e.yaml` (a setup name such as `e2e-dev` in
  `expected_ports` and the config args, `:75-87`, and in the loop, `:90`) with the literal
  expected rows `api 127.0.0.1 3000 3000`, `console 127.0.0.1 8082 8082`, `status - 8080 8080`
  (the same rows as the existing e2e row, `scripts/check-setup.sh:81`). `scripts/check-setup.test.sh`
  gets a case that changes one port of that combination and expects the check to fail.
- New step `Manual incident privacy`, placed after `ok: the container logs show no admin token`
  (`e2e/compose-e2e.sh:578`) and before `source e2e/outage-history.sh` (`:581`) and the step
  `Probe outage` (`:592`). At that point the step `Manual incidents` has asserted its literal
  counters (created 1, resolved 1, `e2e/compose-e2e.sh:569-570`) and deleted its incident
  (`e2e/compose-e2e.sh:572-574`; a delete changes no counter). The later steps do not depend on
  api uptime before `Probe outage`, which stops and starts the api itself
  (`e2e/compose-e2e.sh:594-596`), so the api restart of this step changes no later literal (the
  config write counter at `e2e/compose-e2e.sh:679-680` is counted after that outage restart).
  - **Gate (api detection):** `GET /admin/manual-incidents` with the e2e admin token. `200`: run.
    `404`: print `skip: manual incident privacy (api has no /admin/manual-incidents)` and go on
    (the pinned `0.1.0` api). Any other status: fail. In the `e2e-dev` job the missing
    `ok: manual incident privacy` line fails the job, so a skip cannot pass there.
  - Sentinels (literals): private `e2e-draft-7f3a`, `e2e-internal-5d17`, `e2e-note-2b8e`,
    `e2e-update-9c41`; public `e2e-public-0a62` (control `P`) and `e2e-marker-31c5` (marker `M`).
  - Helper `notify_polls_ok`: prints the value of `pulse_notify_polls_total{outcome="ok"}` read
    as `notify_has_polled` reads it (`e2e/compose-e2e.sh:169-173`).
  - Helper `badge_state <component>`: prints the state word of
    `/badge/component/<component>.svg`, taken from its `<title>` (`<label>: <state> <uptime>`,
    `status/src/badge.ts:87-95`).
  - **Why the badge component is `web`:** the component `public-api` holds `heartbeat-e2e`
    (`e2e/ro/checks.json:33-38`, `:76-82`). That check goes `down` 3000 ms (period 2000 +
    grace 1000, `e2e/ro/checks.json:36-37`) after its last ping, and the last ping is at
    `e2e/compose-e2e.sh:480`, before this step, so `public-api` is already `down` and its badge
    proves nothing. The component `web` holds `status-page` and `e2e-post`
    (`e2e/ro/checks.json:70-76`). Both are `up` here: the step `Incident` waits until the
    `status-page` incident is resolved (`e2e/compose-e2e.sh:490`), and `e2e-post` is back `up`
    at `e2e/compose-e2e.sh:448`. The step `Manual incidents` names only `web` with impact
    `major`, and that incident is resolved and deleted before this step
    (`e2e/compose-e2e.sh:532`, `:572-574`). A `major` or `critical` incident turns a component
    `down` (`contract/src/components.ts:60-72`, worst state wins, `contract/src/components.ts:8-15`),
    and the badge combines the api state with the open manual incidents it reads
    (`status/src/syndication.ts:325-329`). No heartbeat ping is needed: no assertion of this step
    reads `public-api` state. So the badge of `web` shows `up` exactly while no published public
    `major`/`critical` incident names it. `D` and `I` name both `web` and `public-api`: `web`
    carries the badge proof, and `public-api` keeps the routing of the `public-api` notify channel
    (`e2e/notify.json`) under test.
  - **Why a marker:** notify reads every manual incident with one `GET /manual-incidents` per poll
    (`notify/src/api.ts:283`), and status serves the proxy, page, feed and badges from its cached
    api answers (`status/src/answer-cache.ts`, `status/src/syndication.ts:343-347`), which are
    only replaced by newer answers. So a public incident `M` created by a legacy write **after
    the last private write** is the proof: a surface that shows `M` was built from an api answer
    produced after every private write before it. Seeing `P` alone is not proof, because `P` was
    published before its draft update was saved.
  - Steps and literal expectations:
    1. `GET /admin/manual-incidents`: no token `401`; probe token `403`.
    2. Precondition: wait (`T_PAGE`) until `badge_state web` prints `up` (literal).
       Metrics (literals): `pulse_api_manual_incidents_created_total 1`,
       `pulse_api_manual_incidents_resolved_total 1` (the values the step `Manual incidents` left).
    3. Draft `D`: `POST /admin/manual-incidents` `{title: "e2e-draft-7f3a", impact: "major",
       componentIds: ["web", "public-api"], message: "e2e-draft-7f3a", visibility: "public"}` →
       `201`, `.publishedAt == null`. `PUT` with the same body → `200`.
    4. Internal `I`: create `{title: "e2e-internal-5d17", impact: "critical", componentIds:
       ["web", "public-api"], message: "e2e-internal-5d17", visibility: "internal"}` → `201`;
       publish → `200`, `.visibility == "internal"`, `.publishedAt != null`.
    5. Public control `P`: create `{title: "e2e-public-0a62", impact: "none", componentIds:
       ["web"], message: "e2e-public-0a62", visibility: "public"}`; note
       `{message: "e2e-note-2b8e"}` → `201`; publish → `200`; draft update `{status: "resolved",
       message: "e2e-update-9c41"}` → `200`. This draft update save is the last private write.
    6. Marker `M`: `POST /manual-incidents` (legacy create) `{title: "e2e-marker-31c5", impact:
       "none", componentIds: ["web"], message: "e2e-marker-31c5"}` → `201`, sent after the `200`
       of step 5.
    7. Barrier (positive, all must hold before any absence check):
       - notify: wait until `manual-web.jsonl` holds `manual:<M>:opened` exactly once; then read
         `n=$(notify_polls_ok)` and wait until `notify_polls_ok` is greater than `n`, then sleep
         `POLL_INTERVAL * 3` seconds (the settle time of `e2e/compose-e2e.sh:560`). So at least
         one poll has completed whose single read came after step 6, and its channel writes are
         done. `manual-web.jsonl` also holds `manual:<P>:opened` exactly once.
       - status: wait until `/api/manual-incidents` lists `M`, `/feed.atom` has `manual:<M>:0`, and
         `GET /` holds `e2e-marker-31c5` (manual incidents are rendered on the page also with
         hide-details on, `status/src/sections.ts:124`).
    8. Absence (each read after the barrier):
       - api: `GET /manual-incidents`, `?status=open`, `?status=all` hold none of the four private
         sentinels; `GET /manual-incidents/<D>` and `/<I>` → `404`; `P` in the public list has
         `status != "resolved"`, `resolvedAt == null`, exactly 1 update.
       - status: `/api/manual-incidents`, `GET /` and `/feed.atom` hold none of the four private
         sentinels; `/feed.atom` has no `manual:<P>:1`; `badge_state web` prints `up` (literal;
         the badge reads the same cached `/api/manual-incidents` answer that the proxy barrier
         showed holding `M`). A status that let `D` or `I` through would print `down`, because
         both are `major`/`critical` on `web`.
       - notify: `incidents.jsonl`, `manual-web.jsonl` and `manual-public-api.jsonl` hold 0 lines
         with `manual:<D>:` or `manual:<I>:`, 0 lines with any private sentinel,
         `manual_update_count manual-web.jsonl <P>` = 0 and 0 lines with `manual:<P>:resolved`.
    9. Metrics before the api restart, read anonymously (no token) from the api `/metrics`
       (literals): `pulse_api_manual_incidents_created_total 3` (1 left by the step `Manual
       incidents`, plus the public `P` and `M`; the internal `I` counts nothing, decision 11; the
       draft save and edit of `D` count nothing), `pulse_api_manual_incidents_resolved_total 1`
       (the draft update of `P` is not published). `grep -c` of lines that start with
       `pulse_api_http_requests_total{` and contain `/admin/manual-incidents` prints `0`
       (literal, decision 14), although steps 1 and 3 to 5 sent such requests.
    10. Restart: `docker compose restart api notify`, wait until both are healthy, `/readyz` is
        `ok` and `notify_has_polled`. Metrics right after the restart, before any write
        (literals): `pulse_api_manual_incidents_created_total 0`,
        `pulse_api_manual_incidents_resolved_total 0` (counters live in memory and reset on
        restart, `api/src/metrics.ts:59-64`, initialized to 0 at `api/src/metrics.ts:133-134`).
        `GET /admin/manual-incidents/<D>` still has `.publishedAt == null`; `<P>` still has the
        note `e2e-note-2b8e` and `.draft.message == "e2e-update-9c41"`.
    11. Publish the draft update of `P` → `200`, `.status == "resolved"`; again → `409`. Wait until
        `manual-web.jsonl` holds `manual:<P>:resolved` exactly once and `/feed.atom` has
        `manual:<P>:1`; the proxy shows `P` resolved with exactly 2 updates and `e2e-update-9c41`;
        then no status surface and no channel file holds `e2e-note-2b8e`.
    12. Publish `D` (saved before the notify restart) → `200`. Wait until
        `manual-public-api.jsonl` and `manual-web.jsonl` each hold `manual:<D>:opened` exactly
        once and `badge_state web` prints `down` (literal; positive control for the badge check
        of step 8: the same badge turns `down` once one such incident is public). Then resolve
        the internal `I`: legacy `POST /manual-incidents/<I>/resolve` with the admin token →
        `404` (literal, decision 14); `PUT /admin/manual-incidents/<I>/draft` `{status:
        "resolved", message: "e2e-internal-5d17"}` → `200`; publish → `200` with `.status ==
        "resolved"`. Then `POST /manual-incidents/<D>/resolve` → `200` and
        `POST /manual-incidents/<M>/resolve` → `200`.
    13. Discard: create a draft `X` (title `e2e-discard-4e90`, `visibility: "public"`) and
        `DELETE /admin/manual-incidents/<X>` → `204`; then `GET /admin/manual-incidents/<X>` →
        `404`.
    14. `docker compose restart notify`, wait `notify_has_polled` plus `POLL_INTERVAL * 3`
        seconds: exactly 1 line each of `manual:<P>:opened`, `manual:<P>:resolved`,
        `manual:<M>:opened`, `manual:<D>:opened` in `manual-web.jsonl` and of `manual:<D>:opened`
        in `manual-public-api.jsonl`; 0 lines with `manual:<I>:` and 0 lines with
        `e2e-internal-5d17` in every channel file.
    15. Metrics after the restart (literals, counted from the restart of step 10):
        `pulse_api_manual_incidents_created_total 1` (`D`; the draft `X` counts nothing),
        `pulse_api_manual_incidents_resolved_total 3` (`P`, `D`, `M`; the resolution of the
        internal `I` in step 12 counts nothing, decision 11; an api that counted it would
        print `4`). Lines that start with `pulse_api_http_requests_total{` and contain
        `/admin/manual-incidents`: `0` (literal). Then print `ok: manual incident privacy`.
  The script prints no token. Every absence check comes after a positive barrier that proves the
  surface or channel read the api after the last private write before it (step 7 for step 8; the
  publications of steps 11 and 12 for the checks after them).

Checks:

- Tool facts, verified: Bun `1.4.0` (`package.json:9`, `package.json:28`); `bun run check` =
  lint, typecheck, test (`package.json:18`), test `bun test --coverage cli` (`package.json:13`),
  threshold 0.8 (`bunfig.toml:2`). Biome `2.6.3` (`package.json:21`); `biome.json:3-27` includes
  only `cli/**` and root config files and excludes `e2e`, `dev`, `scripts` and `.github`, so Biome
  does not check the changed files. Shared config at `04108fa…` (`package.json:22`, `ci.yml:17`;
  identical to the clone). CI `lint` job: `shellcheck -x` and `bash -n` on every `*.sh`
  (`ci.yml:34-37`), `jq empty` on every `*.json` (`ci.yml:40-41`), `bash e2e/manual-count.test.sh`
  (`ci.yml:47`), `scripts/check-setup.sh` (`ci.yml:53`), `bash scripts/check-setup.test.sh`
  (`ci.yml:55`). CI `full` runs `bash e2e/compose-e2e.sh` on the published images
  (`ci.yml:103-128`). CI `dev` builds every service `main` (`ci.yml:181-248`).
- The `e2e-dev` job fails on current `main` of api (the gate gets `404`, the step prints the skip
  line, and the job's `grep` for `ok: manual incident privacy` fails), and passes once the api,
  status and notify changes are merged.
- `full` stays green on the `0.1.0` images with the skip line.
- `shellcheck -x`, `bash -n`, `scripts/check-setup.sh` and `bash scripts/check-setup.test.sh` pass.

Completion evidence: links to a green `e2e-dev` run with the step's `ok:` lines, a green `full`
run with the skip line, and the image revisions the `dev` build used (`git rev-parse HEAD` of each
checkout, printed by the job).
