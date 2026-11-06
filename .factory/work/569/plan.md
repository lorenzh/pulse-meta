# Spec #569: console incident and maintenance screens

## Goal

Give the console the two missing screens of the self-hosted shell: **Incidents** and
**Maintenance**. A person signed in to the console can see automatic and manual incidents with a
mean time to resolve (MTTR), open one incident with its timeline, declare a manual incident in a
composer with a live preview of the status-page card, post updates, resolve it, and plan, edit
and delete database maintenance windows. The incident screens work at 390 px. Everything goes
through the existing pulse-api routes: this feature adds no API, contract or status change.

## Sources and decisions this spec applies

- Issue #569 and its comments. The owner chose option 1: #569 waited for #765 (database-backed
  maintenance windows, item B of #460) and is now specified with its full scope, including the
  Maintenance page ([decision](https://github.com/lorenzh/pulse-meta/issues/569#issuecomment-6666734219)).
- `.factory/work/569/issue-review.md` (state `issue-review`, after #765 merged). Its "Scope
  reconciliation", "Nonblocking open points" and "Derived acceptance check" sections are
  applied below. Where the review left a choice to the plan, this spec makes it (marked
  **Decision**).
- #460 sections 10–15 and 18–20 (via the review): self-hosted, one organisation; database
  maintenance with a stable id, 1–50 checks, start/end, a public note; no title, no announced
  state, no paused-from-alerting column; publish-now composer; automatic incidents are read-only.
- The #564 permission matrix as shipped in console `src/permissions.ts:40-58`:
  `incident.write` Member, `incident.delete` Admin, `incident.edit-text` no role,
  `maintenance.create`/`maintenance.edit` Member, `maintenance.delete` Admin. Viewing uses
  `overview.view` (Viewer), as the Checks pages do (`src/check-routes.ts:93`).
- The "pulse Console" design boards are not available as an export in this repository (the
  review checked `design/`: website exports only). No acceptance check asserts pixel fidelity to
  them; the screens use the existing shell, states, tables, callouts and confirmations.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/569`
  answered `HTTP 404` on 6 November 2026: no findings yet.
- Plan-review of this spec (four changes, applied): the typed-title rule now follows the shipped
  trim/NFC `isTypedNameConfirmed` and its counterexamples match it; the resolve page is composed
  from `src/html.ts` helpers, so `confirm.ts` stays unchanged; deploy step 7 uses a second
  unused resolve token kept from step 6 and checks the later GET `409` separately; the
  performance bound is four pulse-api requests per console request.

### What this spec builds on (do not redo)

Verified heads: console `5cdc34b`, api `4b3e9b1`, contract `c4a2eb5` (version 2.3.0,
`package.json:3`), status `8b6d431`, deploy `e754d46`.

- **#568 (api, contract):** public manual incidents. `GET /manual-incidents[?status=open|resolved|all]`
  and `GET /manual-incidents/:id` serve only published `public` incidents; writes
  `POST /manual-incidents`, `POST /manual-incidents/:id/updates`,
  `POST /manual-incidents/:id/resolve`, `DELETE /manual-incidents/:id` need `admin` and
  `incidents` (api `docs/rest-api.md:307-349`). Private draft/note routes exist; this feature
  does not use them.
- **#765 (api #771, contract #770):** `GET /admin/maintenance` (`AdminMaintenanceList`
  `{revision, windows, shadowed}`), `POST /admin/maintenance`, `PUT|DELETE /admin/maintenance/:id`
  with `If-Match`, contract `validateAdminMaintenanceList` and
  `validateAdminMaintenanceWindowInput` (contract `src/admin.ts:217-334`,
  `src/validate-admin.ts:129-151`; api `docs/rest-api.md` "Admin maintenance routes",
  `src/maintenance-write.ts:110-200`). Do not add another maintenance store.
- **#566/#718/#567 (console):** shell, states, confirmations (`src/confirm.ts`), form tokens,
  `writeGuardProblem` and the write outcome classes (`src/check-write.ts`, `src/check-outcome.ts`),
  bounded reads (`src/api-read.ts`), the People log (`src/people-log.ts`), the Playwright/axe
  harness (`e2e/run.ts`) and the deploy console scenario pattern (`e2e/console-probes.sh`).

## Scope

- console: the Incidents list with MTTR, the manual and automatic incident detail pages, the
  composer (declare), post update, resolve, delete (Admin+), the live preview and its no-JS
  fallback, the Maintenance list, create, edit and delete (Admin+), navigation, People-log rows,
  mobile layout, docs, unit/HTTP/browser tests and an agent-browser record.
- console: contract pin update to merged contract `main` with 2.3.0 (`c4a2eb5` or later).
- deploy: one dev-only end-to-end step that drives the real console, api and status: preview
  parity against the real status page, the incident lifecycle and a maintenance window, plus an
  agent-browser record against the dev stack.

## Non-goals

- No change to api, contract, status, notify, probe, kit, config or website.
- No draft, internal-note, visibility, autosave, subscriber or AI UI (#568's private routes stay
  unused by the console). No editing of published incident text (no role may, matrix row 6).
- No reopening of a resolved incident; no Markdown or attachments; no new suppression engine.
- No component management screen, no database component store.
- No status preview endpoint, no change to the status proxy allow-list, no CSP widening.
- No Activity screen for the People log (it stays unavailable); rows are only written.
- No hosted/multi-tenant variant of the boards.

## Required behavior

All pages are signed-in shell pages. Routes compare the raw path byte for byte (console
`AGENTS.md`, "This repository"). Ids travel in the query (`?id=`) for GET and in a hidden field
for POST, as on the Checks pages. Every time is shown with `utcTime` from
`src/check-format.ts:24-28` (`YYYY-MM-DD HH:MM:SS UTC`) inside `<time datetime="<ISO>">`.

### 1. Routes and roles

| Path | Methods | Role (`routeRole`) | Purpose |
| --- | --- | --- | --- |
| `/incidents` | GET | `overview.view` (Viewer) | list, MTTR |
| `/incidents/manual` | GET | `overview.view` | manual detail and timeline (`?id=`) |
| `/incidents/automatic` | GET | `overview.view` | automatic detail (`?id=`) |
| `/incidents/new` | GET, POST | `incident.write` (Member) | composer; `?from=<automatic id>` prefill |
| `/incidents/update` | POST | `incident.write` | post an update (form on the detail page) |
| `/incidents/resolve` | GET, POST | `incident.write` | plain confirmation with a message (`?id=`) |
| `/incidents/delete` | GET, POST | `incident.delete` (Admin) | typed-title confirmation (`?id=`) |
| `/maintenance` | GET | `overview.view` | list by phase |
| `/maintenance/new` | GET, POST | `maintenance.create` (Member) | create a database window |
| `/maintenance/edit` | GET, POST | `maintenance.edit` (Member) | replace a database window (`?id=`) |
| `/maintenance/delete` | GET, POST | `maintenance.delete` (Admin) | plain confirmation (`?id=`) |

- `NAVIGATION` entries `incidents` and `maintenance` (`src/navigation.ts:27-40`) become
  `isAvailable: true` in the same change. `/incidents` and `/incidents/*` set `navId:
  "incidents"`; `/maintenance` and `/maintenance/*` set `navId: "maintenance"`.
- The dispatcher order stays as documented (console `docs/configuration.md:115,121`): route and
  method, phase, Host, session, then for POST Origin, content type, body size, repeated/list
  fields, CSRF, then role, then form token, then the handler. Navigation visibility is never
  authorization: a Viewer's forged POST answers `403` with zero API requests.
- Every write handler calls `writeGuardProblem` (`src/check-write.ts:46-66`) immediately before
  its outbound API request, with the route's required role: a session deleted or a role lowered
  after the form token was accepted gives `409 Not saved` or `403`, with zero API requests.
- A detail or confirmation `id` query must be present once and non-empty (as
  `queryIdOf`, `src/check-routes.ts:108-113`). A manual or automatic id must match
  `^[1-9][0-9]{0,14}$`; a maintenance id must match the contract `MAINTENANCE_WINDOW_ID` with at
  most 64 characters. Anything else answers the shell `404`.
- There is no automatic-incident write route. `POST /incidents/automatic` answers `405`
  (`Allow: GET, HEAD`), as every GET-only protected route does.

### 2. Repeated (list) fields and form limits

- **Decision:** `ProtectedRoute` gains `listFields?: Readonly<Record<string, number>>` (field
  name → most values) and `PageRequest` gains `lists: Readonly<Partial<Record<string, readonly
  string[]>>>` (empty for GET/HEAD). In the "repeated field" step a list field may appear up to
  its limit; more values, or the same value twice in one field, answer `400` like a repeated
  known field. Single known fields keep refusing repetition. `csrf` and `form_token` are never
  list fields.
- Lists: `/incidents/new` `component` (1000); `/maintenance/new` and `/maintenance/edit`
  `check` (1000) and `component` (1000).
- Body limits (`maxFormBytes`): `/incidents/new`, `/incidents/update`, `/incidents/resolve`
  32768 bytes (`MAX_INCIDENT_FORM_BYTES`); `/maintenance/new`, `/maintenance/edit` 131072 bytes
  (`MAX_MAINTENANCE_FORM_BYTES`); every other new POST keeps `MAX_FORM_BYTES` 8192
  (`src/forms.ts:4`). 32768 holds the largest valid incident form: title 200 and message 2000
  UTF-16 units at 9 URL-encoded bytes each (19800), 50 component ids of 64 ASCII characters
  with their names (≈3.6 KiB) and the hidden fields.
- Before an outbound write the console checks the built JSON with the contract limit of its
  route (`MANUAL_INCIDENT_MAX_BODY_BYTES` 16384, contract `src/schema.ts:854`;
  `ADMIN_MAX_BODY_BYTES` for maintenance, `isWithinApiBodyLimit`, `src/check-write.ts:25-27`).
  Over the limit: the form again with `422`, zero API requests.

### 3. Reads

All reads use `readApi` (`src/api-read.ts:25-49`, 5000 ms, no followed redirect, wire header
recorded) and map failures with `readFailureOf` to the existing shell states
(`apiUnavailableState`, `tokenRejectedBanner`). `ApiCall` (`src/api-failure.ts:4-15`) gains
`"manual-incidents"`, `"manual-incident"`, `"incidents"` and `"maintenance"`.

| Read | Token | Validation |
| --- | --- | --- |
| `GET /manual-incidents?status=all` | none (public) | raw array; drop every item for which `isPublicManualIncident` is false; then `validateManualIncidentsResponse`; copy each with `publicManualIncident` |
| `GET /manual-incidents/<id>` | none | `isPublicManualIncident` false → treated as `404`; then `validateManualIncident`; `publicManualIncident` |
| `GET /incidents?since=<now-1209600000>&limit=1000` | none | `validateIncidentsResponse` |
| `GET /checks/<id>/results?limit=20[&before=<resolvedAt+1>]` | none | `validateResultsResponse` (as `src/check-read.ts:227-240`) |
| `GET /admin/config` | admin token | `readCheckConfig` (`src/check-read.ts`), for check names, effective checks, components and the revision |
| `GET /admin/maintenance` | admin token | `validateAdminMaintenanceList` |

- `now` is the injected console clock (`deps.now()`), read once per request.
- The public reads never carry the admin token. No read uses `/admin/manual-incidents`; draft
  titles, notes, internal incidents or private counts never reach a console page.
- `GET /manual-incidents` with `404` (an api before #568, or before the admin import) counts as
  an empty list, as contract `getManualIncidents` with `isAbsentTolerated` does
  (contract `src/client.ts:343-375`).
- `GET /admin/maintenance` answering `404` or `405` shows the Maintenance page's old-api state:
  `This pulse-api is too old for the Maintenance page. It needs database maintenance windows (pulse-api with #765).`
  and no form. Other failures use the shared failure states.

### 4. Incident list (`GET /incidents`)

Reads: manual list, automatic list, `/admin/config` (check names). All three must succeed;
otherwise the page shows the failure state of the first failed read (order as listed) and no
rows and no MTTR.

**Rows.** One row per manual incident of the manual read and per automatic incident of the
automatic read. Each row shows: a kind label (`Manual` or `Automatic`); the title (manual
`title`; automatic: the check name from `/admin/config` `checks[].name`, falling back to the
check id, then ` — ` and the `reason` or `no reason`); for manual rows `Impact: <impact>`; the
state (manual `status` word; automatic `open` or `resolved`); the start time (manual
`createdAt`, automatic `openedAt`); and the duration (`resolvedAt - start` when resolved, else
`open for <now - start>`), formatted by section 6. The title links to
`/incidents/manual?id=<id>` or `/incidents/automatic?id=<id>`. Route identity carries the kind:
manual #7 and automatic #7 are two rows and two pages.

**Filters** (query, parsed like `parseCheckFilters`, `src/check-filters.ts:20-45`: a repeated,
empty or unknown value counts as absent and shows `Some filters were ignored.`):
`state` = `open` | `resolved` | `all` (default `all`); `kind` = `manual` | `automatic` | `all`
(default `all`). Filter links keep the other filter.

**Order.** Open rows first, newest start first; then resolved rows, newest `resolvedAt` first.
Ties: manual before automatic, then higher id first.

**Bound.** At most 200 rows are rendered; above that the list ends with `Showing the first 200
of <n> incidents. Narrow the filters.`

**Empty states.** No incident in both reads: `No incidents in the last 14 days.` (Member+ also
sees `Declare incident`). Rows exist but none matches: `No incidents match these filters.` with a
`Clear filters` link to `/incidents`.

**Actions.** Member+ sees `Declare incident` (link to `/incidents/new`). After a delete the page
shows the success callout `Incident deleted.` for `?deleted=1`.

### 5. MTTR (two labelled values, never combined)

The list header shows two statistics, each with its label, sample count and period:

1. **Manual:** `Mean time to resolve, manual incidents: <value>` and
   `<n> resolved in the last 14 days (pulse-api returns at most 50)`.
   - Sample set: the items of the manual read (after the public filter) with `resolvedAt !==
     null`. pulse-api defines the set: public incidents resolved within 14 days of its clock,
     newest first, at most 50 (api `docs/rest-api.md:315-317`). The console does not re-filter
     by its own clock. With `n = 50` the label adds `the 50 most recent`.
   - Duration of an item: `max(0, resolvedAt - createdAt)` in ms (public `createdAt` is the
     publication time).
2. **Automatic:** `Mean time to resolve, automatic incidents: <value>` and
   `<n> resolved in the last 14 days`.
   - Sample set: the items of the automatic read with `resolvedAt !== null` and
     `resolvedAt >= now - 1209600000`.
   - Duration: `max(0, resolvedAt - openedAt)`.
   - If the automatic read returned exactly 1000 items (the requested `limit`), the set may be
     truncated: the value is `—` with `Not computed: more than 1000 automatic incidents in 14
     days.` Never average a truncated page.

Formula for both: `mean = sum(durations) / n` in ms, computed exactly; rounded once for display
by section 6. `n = 0`: value `—` and `No incident resolved in the last 14 days.` Open
incidents never enter a sample. Filters of the list do not change the statistics. Updates are
never counted as incidents.

### 6. Duration text

`durationText(ms)`: `m = Math.round(ms / 60000)` (half up; `ms >= 0`). `m = 0`: `under 1 min`;
`m < 60`: `<m> min`; `m < 1440`: `<h> h <m mod 60> min` (`<h> h` when the minutes are 0);
else `<d> d <h mod 24> h` (`<d> d` when the hours are 0). Used for row durations and both MTTR
values.

### 7. Manual incident detail (`GET /incidents/manual?id=<n>`)

Reads: `GET /manual-incidents/<n>`, `/admin/config` (component names). `404` from pulse-api:
the shell `404` with `This incident does not exist or is not public.`

- Header: title, `Impact: <impact>`, `Status: <status>`, affected components (names from
  `/admin/config` `components`, falling back to the id; `No component` when empty), started
  (`createdAt`), resolved (`resolvedAt` or `open`), duration (section 6).
- Timeline: every update in **response array order** (oldest first). The array index is the
  stable update number, shown as `#<index>` and used for the element id `update-<index>`; two
  updates with equal `at` keep array order. Each entry: the status word, the time, the message
  as escaped text in an element with `white-space: pre-wrap` and `overflow-wrap: anywhere`.
- Open incident and Member+: the **post update** form (section 9) and a `Resolve` link to
  `/incidents/resolve?id=<n>`. Resolved incident: no update form and no resolve link, for every
  role. Admin+: a `Delete` link to `/incidents/delete?id=<n>`.
- Success callouts for `?published=1` (`Incident published.`), `?posted=1` (`Update posted.`),
  `?resolved=1` (`Incident resolved.`).
- There is no edit of title, impact, components or published messages.

### 8. Automatic incident detail (`GET /incidents/automatic?id=<n>`)

Reads: the automatic list (section 3; the same 14-day, 1000-item read as the list),
`/admin/config` (check name and components). The id not in that read: the shell `404` with
`This automatic incident is not among the incidents of the last 14 days.`

- Shows check (name and id, link to `/checks/check?id=<checkId>`), reason (or `no reason`),
  opened, resolved or `open`, duration, and the check's results:
  `GET /checks/<checkId>/results?limit=20`, with `&before=<resolvedAt + 1>` when resolved, newest
  first. A results `404` (the check was removed) shows `The check no longer exists; no results.`
  instead of a failure state.
- Text: `Automatic incidents are opened and resolved by pulse-api from check results. They cannot
  be edited here.`
- Member+: `Post a public update` links to `/incidents/new?from=<n>`.

### 9. Composer, update and resolve forms, and the preview

**Composer (`/incidents/new`).** Fields: `title` (text), `impact` (radio `none|minor|major|critical`,
default `minor`), `status` (radio `investigating|identified|monitoring`, default
`investigating`), `component` (one checkbox per `/admin/config` component, value = id, with
`data-name="<escaped name>"`; none configured: the text `No components are configured; the
incident names no component.`), `message` (textarea), and two submit buttons `name="action"`
`value="preview"` (`Update preview`) and `value="publish"` (`Publish incident`, busy label
`Publishing…`). Text above the buttons: `Publishing posts this incident to the status page at
once and sends notifications. Sent notifications cannot be recalled.`

- `?from=<id>`: the console reads the automatic list. Found: every component whose `checkIds`
  contain the incident's `checkId` is preselected, and a callout says `Publishing creates a new
  manual incident. Automatic incident #<id> stays unchanged.` No component contains the check:
  nothing is preselected and the callout adds `No component contains check <name>; pick
  components or publish a general incident.` Not found: the composer without preselection and
  the callout `Automatic incident #<id> is not among the incidents of the last 14 days; nothing
  was preselected.` The title and message are never prefilled: no reason, target or check
  detail is copied into public text. `from` is not posted; no link between the two incidents is
  stored.

**Post update (`POST /incidents/update`).** Hidden `incident`; `status` radio
`investigating|identified|monitoring` (default: the incident's current status); `message`;
`action` `preview|publish` (`Post update`). `status=resolved` (forged) answers `422` `Use
Resolve to resolve an incident.` with zero API requests.

**Resolve (`/incidents/resolve`).** **Decision:** the resolve page is an incident form built in
`src/incident-pages.ts`, the same composition as the post-update form, not `plainConfirmPage`:
`src/confirm.ts:74-108` has no slot for a field, a preview or two named buttons, and this
feature does not change `confirm.ts`. The page is built only from the existing `src/html.ts`
helpers: `csrfField` and `formTokenField` (`:42-50`), hidden `incident`, `textareaField`
(`:95`) for `message` prefilled `Resolved.`, `formErrorSummary` (`:121`), the preview section
(resolved form, below) and two `submitButton`s (`:106-118`, which take `name` and `value`):
`name="action" value="preview"` (`Update preview`) and `name="action" value="publish"`
(`Resolve incident`, busy label `Resolving…`), with a `Cancel` link to the detail page. Text:
`Resolving ends the incident on the status page and discards any unpublished draft update of it.
A resolved incident cannot be reopened.`
- GET of an open incident: that form, `200`, with a fresh form token. Every GET issues a new
  token (`src/form-tokens.ts:87-98`; up to 100 unused tokens per session, `FORM_TOKEN_BINDING_MAX`, `:8`), so two open
  tabs hold two usable tokens.
- GET of a resolved incident: `409` `This incident is already resolved.` with no form.
- POST (update and resolve alike) first reads `GET /manual-incidents/<id>` and `/admin/config`
  (the preview head and the re-rendered form need them). If that read shows `status:
  "resolved"`: `409` `This incident is already resolved.` with the posted message kept as
  text and **zero** writes (the form token was already used by the dispatcher). Otherwise `action=publish`
  sends `POST /manual-incidents/<id>/resolve` `{"message": ...}`. If the incident is resolved
  between that read and the write, pulse-api's `409` is shown (section 10), input kept.

**Delete (`/incidents/delete`, Admin+).** `typedConfirmPage` (`src/confirm.ts:92-104`) with
`consequence` `Deleting removes the incident from the status page and feeds. Notifications
already sent cannot be recalled.`, `action` `/incidents/delete`, `hidden` `[["incident",
"<id>"]]`, `revision` the incident's update count as text (the field `confirmForm` always
writes, `src/confirm.ts:83`; the POST declares it as a known field and does not compare it, as
the delete sends no `If-Match`), `targetName` the title with `.trim()` (as check delete,
`src/check-routes.ts:686`), `submitLabel` `Delete incident`, `busyLabel` `Deleting…`,
`cancelHref` the detail page. The typed text is checked with the shipped `typedNameError` and
`isTypedNameConfirmed` (`src/confirm.ts:47-57`, "Decision 7" in its doc comment, unchanged): both values
trimmed and NFC-normalized, case-sensitive, inner whitespace counts. A mismatch or blank: `422`
with the `typedNameError` text, the typed value kept, zero API requests. POST sends
`DELETE /manual-incidents/<id>`; success redirects to `/incidents?deleted=1`. Works without
JavaScript.

**Input handling (all incident forms).**
- `message`: every `\r\n` and every remaining `\r` become `\n` before validation (browsers send
  textarea newlines as CRLF; CR is a control character the contract refuses). No trimming of
  `title` or `message`: the stored text is what the person typed.
- The body is built and validated with the contract: `validateManualIncidentInput` (composer),
  `validateManualIncidentUpdateInput` (update); for resolve the message rules of the update
  validator with `status: "resolved"`. A failure re-renders the form with `422`, a field error
  from the contract message, and **all input kept** (title, impact, status, components,
  message). No browser-only length check replaces the contract check (no `maxlength`).
- A posted `component` id that is not in the current `/admin/config` components: `422`
  `Component <id> is not configured any more.`, input kept.
- `action=preview`: re-render the same form with the server preview of the posted input and a
  fresh form token; **zero** pulse-api requests other than the reads the form needs, no People
  row, no notification.

**Preview markup.** The server and the script render the same structure inside
`<section aria-labelledby="preview-heading">` with heading `Status page preview` and
`<div class="incident-preview" data-preview="open|resolved">`. Parts are elements with
`data-part`:

| `data-part` | Text | Source rule in status `src/render.ts` @ `8b6d431` |
| --- | --- | --- |
| `impact` | `Impact: <impact>` | `manualHead`, lines 654-666 |
| `status` | `Status: <status>` | `manualHead` |
| `title` | the title | `manualHead` |
| `affects` | `Affects: <name>, <name>` (names joined by `, `, id when unknown); element has `hidden` when no component | `manualComponents`, lines 648-652 |
| `update` (one per shown update) containing `update-status` (status word), `time` and `message` (pre-wrap) | | `manualUpdate`, lines 668-676 |

- Open preview (composer, update form): the head uses the new status; one `update` part, the new
  one (status `renderManualIncidents` shows only the latest update, lines 683-704).
- Resolved preview (resolve page): head `Status: resolved`; all existing updates in array
  order, then the new `resolved` update (status `renderResolvedManualIncidents` shows all
  updates oldest first, lines 707-728).
- The new update's `time` text is `when published`; existing updates show `utcTime`. `time`
  parts are excluded from every parity comparison.
- Every value is set as text: the server through kit `escapeHtml`, the script only through
  `textContent`. `<script>`, `<b>` or `&lt;` in input stay visible inert text.

**Live preview (script).** `CONSOLE_JS` (`src/console-script.ts`) gains one delegated `input`
and `change` listener for forms with `data-preview-form`. It recomputes the parts from the form's
current values (checked component checkboxes in DOM order, their `data-name`) and writes them
with `textContent`, toggling `hidden` on `affects`. It sends no request, uses no storage, reads
no page data beyond the form, and adds no timer. The CSP (`src/server.ts:100`) stays unchanged.
Without JavaScript the `Update preview` button gives the same preview from the server.

### 10. Incident writes and their outcomes

One outbound request per accepted POST, never retried, never redirected, 5000 ms timeout
(`requestJson`, as `src/check-write.ts:126-141`), `Authorization: Bearer <admin token>`, no
`If-Match`. The outcome class comes from `checkOutcome` (`src/check-outcome.ts:23-46`). Mapping:

| Outcome | Answer |
| --- | --- |
| saved `201`/`200`/`204` | composer: `303` to `/incidents/manual?id=<id>&published=1` (id from the answer body validated with `validateManualIncident`; unreadable body: `303` to `/incidents?published=1` with `Incident published. Open the list to find it.`); update `…&posted=1`; resolve `…&resolved=1`; delete `/incidents?deleted=1` |
| saved, People row failed | `200` page `Saved in pulse-api. The People log row could not be written.` with a link to the incident |
| refused `400`, `413` | the form, `422`, the pulse-api message (at most 1000 characters), input kept |
| refused `409` | the form (or the page with the message for delete), `409`, the pulse-api message, input kept (resolved incident, 100 updates) |
| refused `404` | `404` `This incident does not exist or is not public.` |
| refused `401` | `502` with the token-rejected banner |
| refused `403` | `502` `The console token lacks the admin or incidents scope. Incident changes need both.` |
| refused `429` | the form, `503`, `pulse-api is throttling the console. Try again in a minute.` |
| other refused | `502` `pulse-api refused the request (<status>): <message> Nothing was changed.` / `pulse-api could not save the change (<status>). Nothing was changed.` |
| unknown (timeout, network, redirect, foreign answer) | `504`/`502` `The result is unknown. Open the incident list to see whether the change was published before you send it again.`, input shown as text; no retry |

The consumed form token makes a reload of the POST answer `409 Already submitted`; an unknown
outcome never triggers a second request.

### 11. People log

`PeopleAction` (`src/people-log.ts:5-23`) gains `manual-incident.create`,
`manual-incident.update`, `manual-incident.resolve`, `manual-incident.delete`,
`maintenance.create`, `maintenance.replace`, `maintenance.delete` (the api audit names, contract
`src/audit.ts:13-20`). `PeopleEvent.target` gains `{kind: "incident"; id: number | undefined}`
(stored `["incident", null, null, String(id) or "unknown"]`) and `{kind: "maintenance"; id:
string}` (`["maintenance", null, null, id]`). One row per saved or unknown write, appended after
the API answer (separate transaction, as check writes, `src/check-write.ts:163-183`). `value`:
`unknown` for an unknown outcome; for maintenance the new revision from the `ETag`; otherwise
null. A row never holds a title, message, note, body or token. Refused writes add no row.
Log lines (`incident change`, `maintenance change`) carry action, actor id, target id, outcome
class and status only.

### 12. Maintenance list (`GET /maintenance`)

Reads: `/admin/maintenance` and `/admin/config`. Sections in this order, each with a count:

- `Current` (`phase: current`), ordered by `end` ascending; `Planned` (`planned`), by `start`
  ascending; `Past` (`past`), by `end` descending, at most 50 rendered with `Showing 50 of <n>
  past windows.`; `Shadowed by the checks file` (`shadowed`), in response order. Ties in a
  section: file before database, then id (or file index) ascending.
- Phase is the API's at read time. The page shows `As of <utcTime(now)>` and a `Reload` link; it
  does not refresh itself (no timer).
- Each row: identity (`id`, or `File window #<index>` when a file window has `id: null`), a
  source label (`From the checks file, read-only` or `Database`), checks (names from
  `/admin/config`; an id not in the effective checks shows `<id> (not configured; does not apply
  now)`), start and end (`utcTime`), duration (section 6), note as escaped text.
- Actions: an unshadowed database row: `Edit` (Member+) and `Delete` (Admin+). A shadowed row:
  `Delete database copy` (Admin+) only, with `The checks file defines a window with this id; the
  file window stays in force.` A file row: no action for any role.
- Member+: `Plan maintenance` (link to `/maintenance/new`). Empty list: `No maintenance windows.`
- Success callouts: `?saved=1` `Maintenance window saved.`, `?deleted=1` `Maintenance window
  deleted.`

### 13. Maintenance form (`/maintenance/new`, `/maintenance/edit`)

GET reads `/admin/maintenance` and `/admin/config`. If their revisions differ, it reads both once
more; if they still differ, it shows `staleState` (`src/states.ts:145`) with a reload link. The
form carries hidden `revision` = that common revision.

Fields:
- `id` (create only): text. Rule `MAINTENANCE_WINDOW_ID`, 1–64 characters (contract
  `src/admin.ts:217-238`), entered by the person, never generated. **Decision:** no prefill.
  Edit: hidden `target`; the id is shown and cannot change.
- `check`: one checkbox per effective check of `/admin/config` (name and id). Edit: the stored
  `checkIds` are checked; a stored id that is not effective now is listed as a checked checkbox
  `<id> (not configured)` so it is never dropped silently.
- `component`: one checkbox per `/admin/config` component, showing its member check names.
  Never preselected (a window stores checks, not components).
- `start`, `end`: `<input type="datetime-local" step="1">` labelled `(UTC)`. The value is read
  as **UTC**, never as the browser's or server's local time. Accepted:
  `^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$`; the parts must round-trip through
  `Date.UTC` (so `2026-02-30T10:00` is refused). Epoch ms = `Date.UTC(...)`. Edit prefill: the
  stored value as `YYYY-MM-DDTHH:MM:SS` UTC; when the posted text equals the prefill text of
  the stored value, the stored epoch is kept exactly (milliseconds included).
- `note`: one-line text. Validated only by the contract (`validateAdminMaintenanceWindowInput`):
  1–500 UTF-16 units, no control characters, no leading or trailing whitespace. No trimming.

POST:
1. Read `/admin/config`. If its revision differs from the posted `revision`: the stale page with
   all input kept (shown as text, plus `Open the form again`) and zero writes. Component
   membership is never re-expanded silently from a changed configuration.
2. `checkIds` = the posted `check` values in posted order, then for each posted `component` (in
   posted order) its `checkIds` in component order, skipping ids already present. An unknown
   component id: `422`, input kept.
3. Build `{id, checkIds, start, end, note}` and validate with
   `validateAdminMaintenanceWindowInput`. `checkIds` length 0 or above 50: `422` `Select 1 to 50
   checks; this selection has <n>.`; end not after start: `422` `End must be after start.`;
   other contract errors map to their field. Input kept.
4. `POST /admin/maintenance` (create) or `PUT /admin/maintenance/<target>` (edit; body `id` =
   `target`) with `If-Match: "<revision>"`, through the check-write sender (`If-Match`, 5000 ms,
   no retry). Saved: `303` `/maintenance?saved=1`. Outcomes as `refusedAnswer`
   (`src/check-write.ts:89-115`) with maintenance texts: `403` `The console token lacks the
   admin or checks scope. Saving maintenance windows needs both.`, `404` `This maintenance
   window no longer exists.`, `409` (id exists, shadowed, capacity) the form with the API
   message, `412` the stale page with input kept, `422` the form with the API message (unknown
   reference), unknown outcome `The result is unknown. Open Maintenance to see whether the
   window was saved.`
- Edit of a shadowed or file id: GET answers `409` `This window comes from the checks file or is
  shadowed by it; it cannot be edited here.` with no form; a forged POST is sent and the API's
  `409` is shown, input kept.
- Current and past database windows can be edited like planned ones (the API has no
  future-only rule).

**Delete (`/maintenance/delete`, Admin+).** GET: `plainConfirmPage` tone `danger` for an
unshadowed or shadowed database id (`Delete maintenance window <id>?`; for a shadowed one
`Delete the database copy of <id>? The file window stays in force.`), hidden `target` and
`revision` (from `/admin/maintenance`). It uses only the fields `plainConfirmPage` supports today
(`consequence`, `action`, `revision`, `hidden`, labels, `tone`, `cancelHref`, `notice`;
`src/confirm.ts:13-34`); `confirm.ts` does not change. A file id or unknown id: `404`. POST sends
`DELETE /admin/maintenance/<target>` with `If-Match`; `303` `/maintenance?deleted=1`.

### 14. Layout and accessibility

- The incident list, both detail pages, the composer, the update form and the resolve and delete
  confirmations have no horizontal scroll at 390 px and at 1280 px with a 300-character unbroken
  title and message; long text wraps (`overflow-wrap: anywhere`). The list rows use the
  responsive pattern of the Checks list (`src/check-pages.ts`, `src/styles.ts`). The Maintenance
  pages also have no horizontal scroll at 390 px (desktop-first, but usable).
- Every state is text, not only colour (impact and status words). Form errors use the existing
  error summary and field error pattern of the check editor; focus order follows the visual
  order; every control has an accessible name; the preview section is not a live region.

## Performance impact

None expected for any metric of api `bench/budgets.json` (`startup_cpu_ms`, `load_cpu_s`,
`idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `cold_read_cpu_ms`, `eod_read_cpu_ms` and the
reported `startup_wall_ms`, `p95_*`, `rps`, `image_mb`, `cold_*`, `eod_*`): the api code does not
change, and the console adds only person-paced requests to existing routes. Bound per console
request, from sections 4–13: at most **four** pulse-api requests. The worst case is the
maintenance form GET (section 13): `/admin/maintenance` and `/admin/config`, and when their
revisions differ both once more (4 reads). The incident list and the automatic detail make 3
reads (the list: `/manual-incidents`, `/incidents?since=…&limit=1000`, `/admin/config`; the
automatic detail: `/incidents?…`, `/admin/config`, `/checks/<id>/results`); every other GET
makes 1 or 2. A POST makes at most two reads and one write (update and resolve:
`/manual-incidents/<id>`, `/admin/config`, then the write; composer and maintenance:
`/admin/config`, then the write; incident delete: `/manual-incidents/<id>` for the typed title, then the write; maintenance delete: the write only); a refused form is re-rendered from
those reads and the posted input, with no further read. The budgets file
has no console entry (keys: api, config, contract, kit, notify, probe, status). No A/B run is
needed.

## Security impact

Security impact: yes. New authenticated write routes, a form-parser change (list fields), a
script change, API error texts shown to people, a dependency pin update, and a deploy CI step.

Checklist items that apply:
- **Secrets in errors, logs and responses:** the admin token never reaches a page, a log line,
  the script, the People log or a URL. Log lines carry ids and statuses only; no title, message
  or note in a log line or People row. API error messages are shown escaped and cut to 1000
  characters. Deploy: the owner credentials file is mode 600 in a mode-700 directory, never
  printed, removed by the trap.
- **Auth order and status codes:** the fixed dispatcher order (section 1); `403` before any
  outbound request; `writeGuardProblem` right before the write; navigation is not
  authorization; `405` for automatic-incident writes.
- **Body and size limits:** `maxFormBytes` 32768 / 131072; list field limits; JSON size checked
  against the contract limits before sending.
- **Input validation:** contract validators for every body; CRLF normalisation; UTC time parsing
  with round-trip; ids by regex before they reach a URL (`apiIdSegment`, `src/api-path.ts`).
- **Accessor execution:** upstream incident items are filtered with `isPublicManualIncident`
  (reads own data descriptors only) before validation.
- **Dependency pins:** the contract pin moves to a full SHA on contract `main`; no new runtime
  dependency (approved list unchanged).

Not applicable: SSRF and redirects (the API URL is the configured one; writes do not follow
redirects, as today); file writes (none); Dockerfiles (unchanged).

## Rollout order

1. **console** merges first. It needs api `main` ≥ `4b3e9b1` (#771) for Maintenance and #568 for
   incidents; both are released. Older consumers: an api without `/admin/maintenance` GET shows
   the Maintenance old-api state; an api without `/manual-incidents` shows an empty manual list
   (404 tolerated). The status page and notify are untouched and keep reading the same public
   routes. The console's own pin of kit and config is unchanged.
2. **deploy** merges after console: its `e2e-dev` job checks out console `main`
   (deploy `.github/workflows/ci.yml:286-291`), so the new step needs the merged console. The
   `full` setup runs published images and skips the step (`skip: console incidents and
   maintenance (published images)`), so it keeps passing with the older published console.

## Counterexamples

| Rule | Input or case | Must give |
| --- | --- | --- |
| Manual MTTR | resolved durations 10 min (`createdAt 0`, `resolvedAt 600000`) and 30 min (`0`, `1800000`), one open incident | `20 min`, `2 resolved`; the open one is ignored |
| Rounding | durations 10 min and 25 min | mean 1050000 ms → `18 min` (half up), not `17 min` |
| Empty sample | no resolved manual incident | `—` and `No incident resolved in the last 14 days.`, not `0 min` |
| No percentile/average mix | — | the mean is of raw durations; no per-day or per-kind means are averaged |
| Automatic truncation | automatic read returns exactly 1000 items | automatic MTTR `—`, `Not computed: …`; manual MTTR still shown |
| Automatic window | resolved automatic incident with `resolvedAt = now - 1209600001` | excluded from the automatic sample |
| Duration text | 29999 ms; 30000; 5400000; 93600000 | `under 1 min`; `1 min`; `1 h 30 min`; `1 d 2 h` |
| Identity | manual #7 and automatic #7 | two rows; `/incidents/manual?id=7` and `/incidents/automatic?id=7` show different records |
| Shortcut | `from=7` on automatic #7, publish | one `POST /manual-incidents`; automatic #7 unchanged (same `openedAt`, `resolvedAt`) |
| List order | manual and automatic open, same start | manual row first |
| Timeline ties | updates #1 and #2 with equal `at` | #1 shown before #2 |
| CRLF | message `a\r\nb\rc` | body message `a\nb\nc`, accepted |
| No trim | title ` Slow` | sent as ` Slow`; preview shows ` Slow` |
| Contract length | message of 2001 UTF-16 units; 1000 `😀` (2000 units) | 422 with input kept; accepted |
| HTML input | title `<script>alert(1)</script>` | preview and pages show the text; no `<script>` element; status shows the same text |
| Forged resolve via update | `POST /incidents/update` `status=resolved` | `422`, zero API requests |
| Resolved incident | update or resolve POST (with a second unused form token) on an incident already resolved | console read sees `resolved`: `409` `This incident is already resolved.`, message kept as text, **zero** writes; GET resolve page `409` without form; detail page has no forms |
| Resolve race | the fake api resolves the incident between the console's read and its write | one write; pulse-api `409` shown with input kept |
| Delete typed title | for title `Slow checkout`: typed `slow checkout`; `Slow  checkout` (two inner spaces); blank `   ` | `422` (`The name does not match. Type Slow checkout exactly.` / same / `Type the name to confirm.`), zero writes |
| Delete typed title, trim | typed `Slow checkout ` (trailing space) or `Café` typed decomposed (`Cafe` + U+0301) for title `Café` | accepted: `isTypedNameConfirmed` trims and NFC-normalizes both (`src/confirm.ts:47-50`); a wrong implementation that compares raw strings refuses it |
| Roles | Member `POST /incidents/delete` or `/maintenance/delete`; Viewer `POST /incidents/new`, `/incidents/update`, `/maintenance/new` | `403`, zero API requests |
| Role lowered mid-request | Member's role set to Viewer after the form token was accepted, before the write | `403`, zero API requests |
| List field | `component=web&component=web` | `400` |
| List field limit | 1001 `check` values | `400` |
| Body limit | 32769-byte incident form | `413` |
| Unknown write outcome | API times out on create | `504` unknown text; exactly one API request; a People row with value `unknown` |
| Private filtering | public read answers one item with `visibility: "internal"` and one with an accessor `publishedAt` | neither shown, not counted in MTTR |
| Time parse | `2026-11-06T10:00` | start `1793959200000` (not shifted by the browser time zone) |
| Time parse | `2026-02-30T10:00`; `10000-01-01T00:00` | `422` |
| Time keep | stored start `1793959200123`, field unchanged on edit | PUT start `1793959200123` |
| Span | end equal to start | `422` `End must be after start.` |
| Selection | checks `e2e-tcp`, `e2e-post` and component `web` (`status-page`, `e2e-post`) | `checkIds` `["e2e-tcp","e2e-post","status-page"]` |
| Selection size | nothing selected; 51 checks | `422` `… this selection has 0.` / `… has 51.` |
| Window id | `1window`, `Window`, 65 characters | `422`; `db-upgrade` accepted |
| Collision | create `db-upgrade` twice | second answers `409` with the API message, input kept |
| Stale | a check write between form GET and POST | console precheck or API `412`: stale page, input kept, zero window writes |
| Shadowed | edit of a shadowed id | GET `409` without form; delete removes only the database copy |
| Missing check | stored id not effective | listed checked as `<id> (not configured)`; submitting it gives the API `422` |
| Phase boundary | `now = start` | `current`; `now = end` → `past` (API phase, half-open) |

## Contract fields

No new contract or config names: this feature adds no field to any wire shape. New console-only
names and the searches that show they do not collide (run from `.target/.repos`):

| Name | Search | Result |
| --- | --- | --- |
| routes `/incidents…`, `/maintenance…` | `grep -rn -F '"/incidents' contract/src config` ; `grep -rn -F '/maintenance/new' contract/src config` ; `grep -rn -F '/incidents/new' contract/src config` | 0 hits each. Console hits only the planned nav paths (`src/navigation.ts:30,37`) and `src/navigation.test.ts:87`, which this change updates. The api's own `/maintenance` and `/incidents` are pulse-api routes on another origin. |
| People actions `manual-incident.create/update/resolve/delete`, `maintenance.create/replace/delete` | `grep -rn -F 'manual-incident.create' contract/src config` (same for each) | 1 hit each, contract `src/audit.ts:13-20`: the api audit names, reused on purpose. Console `maintenance.create` also exists as a matrix action (`src/permissions.ts:11`), a different type (`MatrixAction`); no clash. |
| People target kinds `incident`, `maintenance` | `grep -rn -F '"incident"' console/src` | 0 hits; `target_kind` has no CHECK (`src/database.ts:106-121`) |
| `listFields`, `lists` | `grep -rn -F 'listFields' contract/src config console/src` | 0 hits |
| `data-preview`, `data-part`, `data-preview-form` | `grep -rn -F 'data-part' contract/src config console/src` ; same for `data-preview` | 0 hits |
| `MAX_INCIDENT_FORM_BYTES`, `MAX_MAINTENANCE_FORM_BYTES` | `grep -rn 'MAX_INCIDENT_FORM_BYTES\|MAX_MAINTENANCE_FORM_BYTES' console/src contract/src` | 0 hits |
| deploy `e2e/console-incidents.sh`, `e2e/incident-card.mjs`, `ok: console incidents and maintenance` | `grep -rn -F 'console-incidents' contract/src config` ; `grep -rn -F 'incident-card' contract/src config` ; `grep -rn -F 'console incidents and maintenance' contract/src config deploy` | 0 hits |

## Repository: console

Files:
- `package.json`, `bun.lock` (contract pin)
- `src/navigation.ts`, `src/navigation.test.ts`
- `src/protected-route.ts`, `src/server.ts`, `src/forms.ts`, `src/forms.test.ts`
- `src/api-failure.ts`, `src/people-log.ts`, `src/people-log.test.ts`
- `src/check-write.ts` (export the shared sender and People-row helper with per-resource texts)
- `src/incident-read.ts`, `src/incident-read.test.ts` (new)
- `src/incident-list.ts`, `src/incident-list.test.ts` (new: filters, order, MTTR, `durationText`)
- `src/incident-form.ts`, `src/incident-form.test.ts` (new: parse, CRLF, bodies, field errors)
- `src/incident-preview.ts`, `src/incident-preview.test.ts` (new: server preview)
- `src/incident-write.ts`, `src/incident-write.test.ts` (new: outcome mapping)
- `src/incident-pages.ts`, `src/incident-routes.ts` (new)
- `src/maintenance-read.ts`, `src/maintenance-view.ts`, `src/maintenance-view.test.ts` (new: phases, order, rows)
- `src/maintenance-form.ts`, `src/maintenance-form.test.ts` (new: UTC times, selection, body)
- `src/maintenance-pages.ts`, `src/maintenance-routes.ts` (new)
- `src/console-script.ts`, `src/styles.ts`
- `src/server.incidents.test.ts`, `src/server.incidents-write.test.ts`, `src/server.maintenance.test.ts` (new)
- `test/incident-api.ts` (new: stateful fake of the incident and maintenance routes), `test/fake-api.ts`
- `e2e/run.ts`, `e2e/design-matrix.ts`
- `README.md`, `AGENTS.md`, `docs/configuration.md`, `docs/index.md`, `docs/incidents.md` (new), `docs/maintenance.md` (new)

Behavior change: yes. New screens, routes, a dispatcher list-field rule and a script behavior.

**Behavior.** Required behavior sections 1–14. The routes are registered in `protectedRoutes`
(`src/server.ts:1149-1163`) beside `checkRoutes`. `src/confirm.ts` and `src/confirm.test.ts` do not change: the resolve page is composed in
`src/incident-pages.ts` from `src/html.ts` helpers (section 9), and both deletes use the
existing `typedConfirmPage`/`plainConfirmPage` fields. The contract pin in `package.json:32` moves
from `66818a24…` to contract `main` at a full SHA that contains 2.3.0 (`c4a2eb5214d48d40d0c1afbae5e3e49463185e15`
or later); the only commits between the two are `22acb5d` and `96336b3` (additive maintenance
schemas), so existing reads keep validating. Run `bun install` to update `bun.lock`.

**Fake API.** `test/incident-api.ts` is a stateful in-memory implementation used by the server
tests and `e2e/run.ts`, not a reply-anything stub: it requires the bearer token on writes, keeps
public manual incidents (ids from 1, own counter), validates bodies with
`validateManualIncidentInput`, `validateManualIncidentUpdateInput`,
`validateAdminMaintenanceWindowInput`, answers `400/404/409` as api `docs/rest-api.md:319-349`
(resolved → `409`, 100 updates → `409`), keeps database windows with the shared revision
(`If-Match` missing `428`, stale `412`, `*` `400`; duplicate id, shadowed replace, file id `409`;
unknown `404`), computes `phase` from an injected `now`, serves file and shadowed rows from
fixtures, and counts every write per route. A switch makes the public list also return a
private-looking item (section 3 filtering test); another resolves an incident after its next
read, so the console's following write meets pulse-api's `409` (resolve race).

**Checks.**
- Unit: `incident-list.test.ts` (every MTTR, duration, order, filter and bound counterexample),
  `incident-form.test.ts` (CRLF, no trim, contract errors to fields, forged resolve status),
  `incident-preview.test.ts` (the literal parts below), `incident-write.test.ts` (every row of
  the section 10 table), `maintenance-form.test.ts` (time parse/keep, selection, sizes, ids),
  `maintenance-view.test.ts` (phase sections, order, missing checks, file/shadowed actions per
  role), `forms.test.ts` (list fields, limits), `people-log.test.ts` (new targets, no text).
- Preview literals (independent source: status `src/render.ts` lines 648-728 at `8b6d431`, cited
  in section 9): input title `<b>Checkout</b> slow`, impact `major`, components `web` ("Web")
  and `public-api` ("Public API"), status `investigating`, message `Line 1\nLine <2>` → parts
  `Impact: major`, `Status: investigating`, `<b>Checkout</b> slow`, `Affects: Web, Public API`,
  `investigating`, `Line 1\nLine <2>`; the HTML holds `&lt;b&gt;Checkout&lt;/b&gt; slow` and no
  `<b>`. With no component, `affects` has `hidden`.
- HTTP (`server.incidents*.test.ts`, `server.maintenance.test.ts`, real server on port 0 against
  the fake api): routes, roles and `405`; Viewer/Member/Admin/Owner views and forged POSTs with
  zero writes; CSRF failure, form-token replay (`409 Already submitted`, one write), role and
  session removed before the write (`writeGuardProblem`); `action=preview` makes zero writes and
  no People row; publish/update/resolve/delete happy paths and their People rows; a second open resolve form posted after the resolve answers `409` with zero writes, and the fake api's race switch (resolve between read and write) shows pulse-api's `409` after exactly one write; typed-title delete with the trim/NFC and mismatch rows of the Counterexamples; every outcome
  row of section 10 and the maintenance outcomes (`409`, `412`, `422`, `404`, timeout, unknown)
  with input kept; private items never rendered; old-api Maintenance state; a scan of every
  response, log line and the test database for the sentinel admin token and the test titles,
  messages and notes in log lines and People rows (0 hits).
- Browser (`bun run check:browser`, Playwright and axe as today, `e2e/run.ts`): at 390 px and
  1280 px the pages of section 14 with long text (no sideways scroll, axe clean, focus order);
  live preview: typing into title, impact, status, components and message changes the parts and
  the fake api counts zero writes; the JS preview parts equal the server preview parts after
  `Update preview` for the same input (two independent renderers); no CSP violation; with
  JavaScript off: publish, post update, resolve and delete confirmation work.
- `src/navigation.test.ts`: Incidents and Maintenance visible for every role; 2 entries remain
  unavailable (Activity, System).
- Manual agent-browser check against `bun e2e/run.ts --serve` (fixture console and the stateful
  fake api, as #718 check 13 and #566): sign in; declare an incident with two components,
  watch the preview change, publish; post `identified` and `monitoring`; resolve; reload and
  check list, MTTR and timeline; try resolve again (`409`); plan a window with checks and a
  component, edit its note and end, delete it as Owner; repeat the forms at a 390 px viewport.
  The PR lists the commands and outcomes.
- `PULSE_API_URL=http://localhost:3000 bun start` against a local api built from api `main`
  (`.repos/api` context): open `/incidents` and `/maintenance` once; the PR reports the result.

Tool facts (console `main` `5cdc34b`; config pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`; the
pinned `.github/workflows/check.yml` and `biome.json` are byte-identical to the config clone,
checked with `diff -q` against `gh api …?ref=04108fa…`):
- Runtime Bun 1.4.0 (`package.json:8-10`, `packageManager` `package.json:35`).
- Scripts: `typecheck` runs `tsc --noEmit` for root and `-p e2e` (`package.json:13`); `test` =
  `bun test` (`:14`); `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`:15`);
  `check` = lint, typecheck, test (`:18`); `check:browser` = `bun e2e/run.ts` (`:19`). Pins
  `@axe-core/playwright` 4.14.0 (`:22`), `@biomejs/biome` 2.6.3 (`:23`), `playwright` 1.64.1
  (`:28`), `typescript7` = `typescript@7.0.2` (`:29`).
- Tests: `bunfig.toml:1-4` coverage on, 80 % lines, ignores `**/*.test.ts`, `test/**`,
  `**/test/**`, `dist/**` (so `test/incident-api.ts` is not counted).
- Biome: `biome.json:1-3` extends `@lorenzh/pulse-config/biome.json`; the pinned file includes
  `**` minus `**/dist`, `**/node_modules`, `**/bun.lock`, `**/*.html`, `**/test/fixtures`
  (config `biome.json:10-17`), so `src/`, `test/`, `e2e/` are in scope.
- CI: `check` uses the pinned `check.yml` (`.github/workflows/ci.yml:17-18`), which runs install,
  `bun run lint`, `bun run typecheck`, `bun run test` (config `check.yml:25-30,37-38`);
  `browser` runs `bunx playwright install --with-deps chromium` and `bun run check:browser`
  (`ci.yml:291-308`); `deploy-dev` runs deploy `main` with this checkout and
  `E2E_CONSOLE_FLOW=two-factor bash e2e/console-setup.sh dev/compose.yaml` (`ci.yml:230-289`).

**Docs.** README: pages and the token scopes (`read` or `checks`, `admin`, plus `incidents` for
incident writes and `checks` for maintenance writes; README line 20 today names only `read` or
`checks` and `admin`). `docs/configuration.md`: the signed-in pages list (line 121), the list
field step and limits in the POST order (line 115). `docs/incidents.md`: routes, roles, MTTR
populations and formula, preview meaning and its limits (time excluded, container layout not
compared), the automatic shortcut, draft interaction (an update keeps a private draft, a resolve
discards it), outcome texts. `docs/maintenance.md`: UTC times, selection snapshot, stale rule,
file/shadowed rows, phases. `docs/index.md` links both. `AGENTS.md`: the new `server.*.test.ts`
files in "End-to-end checks", and a "This repository" sentence for incident/maintenance routes,
the list fields and the script's preview.

**Completion evidence.** `bun run check` and `bun run check:browser` pass; the agent-browser
commands and outcomes in the PR; the `bun start` result; the PR names this issue and the known
limits (preview parity with the real status page is checked in deploy).

## Repository: deploy

Files:
- `e2e/console-incidents.sh` (new)
- `e2e/incident-card.mjs` (new)
- `e2e/incident-card.test.sh` (new)
- `e2e/console-probes.sh`
- `e2e/compose-e2e.sh`
- `.github/workflows/ci.yml`
- `README.md`
- `AGENTS.md`

Behavior change: yes. A new end-to-end step and CI requirement.

**Behavior.**
- `e2e/incident-card.mjs <html file> preview` prints one JSON object
  `{impact, status, title, affects, updates: [{status, message}]}` from the console preview
  (`[data-part]` elements, section 9 of this spec); `e2e/incident-card.mjs <html file> status
  <id>` prints the same object from the status page item `li.manual-incident[data-key="manual:<id>"]`
  (classes `manual-impact`, `manual-status`, `name`, `manual-components`, `manual-update-status`,
  `manual-message`, status `src/render.ts:648-676` @ `8b6d431`). It decodes entities in one
  pass (as `e2e/snippet.mjs`), drops `time` elements, trims the head parts, keeps messages byte
  exact, `affects` is `null` when absent or `hidden`. Exit 1 when the item is missing. Node,
  no dependency (as `snippet.mjs`).
- `e2e/console-probes.sh` writes the owner's email, password and TOTP setup key to
  `<owner dir>/owner.env` (mode 600) right after setup, when `compose-e2e.sh` passes an owner
  directory; it prints none of them.
- `e2e/console-incidents.sh run <work dir> <owner dir> <api port> <status port> <console port>`
  signs in as the Owner from `owner.env` (password, then a TOTP code of a later step than the
  last one, `totp_after` in `e2e/console-lib.sh`) and then, through the console only (curl,
  `req`, `csrf`, `form_token_args` of `e2e/console-lib.sh`):
  1. Records the api write state: `GET /manual-incidents` length and `GET /admin/maintenance`
     revision (admin token of the e2e overlay).
  2. `POST /incidents/new` `action=preview` with title `E2E <script>alert(1)</script> Ünï 😀`,
     impact `major`, component `web`, status `investigating`, message `Line one` LF
     `Line <b>two</b>` → `200`; the api list length and revision are unchanged (zero writes).
  3. `action=publish` → `303` to `/incidents/manual?id=<n>&published=1`.
  4. Waits (`wait_for`, `T_PAGE`) until status `GET /` holds `manual:<n>`, then requires
     `incident-card.mjs status` of it to equal `incident-card.mjs preview` of step 2 (two
     independently rendered artifacts).
  5. Posts `identified` and `monitoring` updates through `/incidents/update`, previewing the
     second and comparing it with the status card as in step 4.
  6. Opens `GET /incidents/resolve?id=<n>` **twice** and keeps both form tokens and CSRF values
     (`form_token_args` reads the last body, so the script saves the first token before the
     second GET; each GET issues its own token, console `src/form-tokens.ts:87-96`). With the
     first token it sends `action=preview` (`200`); that answer carries a fresh token
     (section 9), with which it sends `action=publish` (`303`). It
     compares the preview with the status resolved item (all four updates: messages literal
     `Line one\nLine <b>two</b>`, the two update messages of step 5, and `Resolved.`).
  7. Sends `POST /incidents/resolve` `action=publish` with the **second**, still unused token
     from step 6 → `409` (literal; the console's read sees the incident resolved). Then
     `GET /manual-incidents/<n>` on the api still lists exactly 4 updates (literal) and
     `status: "resolved"`. Separately, `GET /incidents/resolve?id=<n>` answers `409` and its
     body holds no `name="form_token"` input.
  8. Records `sha256sum` of `/config-rw/checks.json` in the api container. Plans window
     `e2e-window` with checks `e2e-tcp`, `e2e-post`, component `web`, start = now + 1 day,
     end = start + 2 h (UTC `datetime-local` text), note `E2E planned window` → `303`. Requires
     `GET /admin/maintenance` to list it with `source: "database"`, `checkIds`
     `["e2e-tcp","e2e-post","status-page"]`, the exact epoch start/end that the script
     computed, `phase: "planned"`; status `GET /api/maintenance` to list the note for each of the
     three checks (`wait_for`); `checks.json` hash unchanged.
  9. `docker compose restart api`, waits healthy, requires the window again (persistence).
  10. Edits the note to `E2E edited window` and end + 1 h through `/maintenance/edit` → `303`;
      the api shows both changes. Deletes through `/maintenance/delete` → `303`; the api no
      longer lists it.
  11. Deletes the incident through `/incidents/delete` with the typed title → `303`; the api
      answers `404` for it.
  12. Scans `docker compose logs console api` and the console database files for the owner
      password, the TOTP key and the admin token: 0 hits.
  Ends with `ok: console incidents and maintenance`. Never prints a credential.
- `e2e/compose-e2e.sh`: creates the owner directory (mode 700) before `Console probe locations`
  and passes it to both scripts; adds the step `Console incidents and maintenance` after
  `Console probe locations` (line 1097) and before `Persistence across down and up`; on `full`
  it prints `skip: console incidents and maintenance (published images)`; the trap removes the
  owner directory and the work directory.
- `.github/workflows/ci.yml`: the `lint` job runs `bash e2e/incident-card.test.sh` beside the
  other helper tests (lines 42-55); the `e2e-dev` job requires
  `grep -qx 'ok: console incidents and maintenance' e2e-dev.log` after line 306.

**Checks.**
- `bash e2e/incident-card.test.sh`: literal HTML fixtures written in the test: a status item in
  the markup of status `src/render.ts:654-676` @ `8b6d431` and a console preview in the markup of
  this spec's section 9, both for the step 2 input, give the same JSON; entities
  (`&lt;script&gt;`, `&amp;lt;` → `&lt;`), a newline in a message, a `hidden` affects, a missing
  item (exit 1).
- shellcheck and `bash -n` of every `*.sh`, `node --check` of every `*.mjs` (lint job,
  `ci.yml:34-39`); the existing helper tests (`ci.yml:42-55`).
- `E2E_SETUP=dev bash e2e/compose-e2e.sh` passes with the new line and the two existing required
  lines (`ci.yml:305-306`).
- Manual agent-browser check against the dev stack (`scripts/init-secrets.sh`,
  `docker compose -f dev/compose.yaml up -d --build` from sibling checkouts of `main`): the
  incident journey and a maintenance window as in console's check, plus the status page beside
  the preview. If the environment cannot run Docker, the PR says so and cites the `e2e-dev` run
  instead.

Tool facts (deploy `main` `e754d46`): `lint` job prints the tool versions (`ci.yml:26-33`), runs
`shellcheck -x` and `bash -n` over `git ls-files '*.sh'` (`:34-37`), `node --check` over
`*.mjs` (`:38-39`), `jq empty` over `*.json` (`:40-41`) and the helper tests (`:42-55`); the
`e2e-dev` job checks out api, probe, status, notify and console at `main` (`:262-291`) and runs
`E2E_SETUP=dev bash e2e/compose-e2e.sh` with the two `grep -qx` lines (`:299-306`). The e2e
overlay sets `PULSE_CHECKS_FILE: /config-rw/checks.json` (`e2e/compose.e2e.yaml:13`); the e2e
checks file has components `web` (`status-page`, `e2e-post`) and `public-api` (`e2e-post`,
`heartbeat-e2e`) (`e2e/ro/checks.json`). The status page server-renders manual incidents
(status `src/sections.ts:124-133`, `src/server.ts:740`).

**Completion evidence.** The lint job checks and `E2E_SETUP=dev bash e2e/compose-e2e.sh` pass
with `ok: console incidents and maintenance`; the agent-browser record (or the stated reason and
the CI run) in the PR; README "e2e" section and `AGENTS.md` (commands table, CI description of
`e2e-dev`) updated.

## Acceptance evidence

1. Incident journey (issue: create, update, resolve): console agent-browser record and HTTP
   tests; deploy step 2–7 against the real api and status (`ok: console incidents and
   maintenance`).
2. Preview matches the status page: deploy steps 4–6 compare the console preview with the
   real status output (independent artifacts); console browser check compares the JS preview
   with the server preview; console unit literals come from status `render.ts` @ `8b6d431`.
3. Maintenance planning: deploy steps 8–10 (real api, status, restart, `checks.json` hash);
   console tests of every maintenance counterexample. Atomic writes, file precedence, phase
   boundaries and alert suppression inside a window (down samples open no incident; an open one
   stays open) are #765's and stay covered by the existing api tests
   (`src/maintenance-write.test.ts`, `src/effective-maintenance.test.ts`,
   `src/service.maintenance.test.ts`, `src/server.maintenance-admin.test.ts`); this feature does
   not rebuild them and changes no api code.
4. MTTR: console unit tests with the literal values of the counterexamples (20 min / 2; 18 min;
   `—`; truncation).
5. Roles and confirmations: console HTTP tests (zero writes on every refusal).
6. Mobile: console browser check at 390 px (no sideways scroll, axe).
7. Secrets: console HTTP scan and deploy step 12 (0 hits).

## Risks

- **Status markup drift.** A status change of the card markup breaks the deploy comparison, not
  the console. That is intended: it surfaces a parity change. The helper's test pins the markup
  it reads.
- **E2E side effects.** The deploy step uses a planned (future) window only, so no check enters
  maintenance during the run; it deletes its incident and window, so the later
  `Persistence across down and up` step sees the stack as before. The incident's notifications
  are sent (publish-now); the step does not assert notify ledgers.
- **TOTP reuse.** The second sign-in must use a TOTP code of a later step than setup's
  (`totp_after`); a same-step code is refused by design.
- **Manual MTTR population.** It is bounded by pulse-api (14 days, 50); the label says so. A
  longer or organisation-wide MTTR needs a new API read and is out of scope.
- **Automatic list bound.** More than 1000 automatic incidents in 14 days hides the automatic
  MTTR and shows the first 200 rows only; an automatic incident older than 14 days has no detail
  page.
- **Unknown outcomes.** A timed-out publish may have published; the console says so and does not
  retry. A person can find it in the list.
