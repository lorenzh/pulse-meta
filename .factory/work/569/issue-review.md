# Issue review: #569 — console: incident and maintenance screens

## Outcome

Transition to `plan`. No blocking question remains. This review supersedes the earlier
`needs-input` outcome in this artifact.

The [owner's decision](https://github.com/lorenzh/pulse-meta/issues/569#issuecomment-6666734219)
selected a separate prerequisite, #765, and explicitly directed the resumed spec to include
the full scope, including the Maintenance page, once that prerequisite merged. On 6 November
2026, [#765](https://github.com/lorenzh/pulse-meta/issues/765) is closed as completed, its final
comment confirms that all children are closed, and the inspected API and contract heads contain
the merged implementations (#771 and #770 respectively). The earlier missing-prerequisite
finding is resolved. Reuse that work; do not implement another maintenance store, split off
maintenance or expand #569 to redo the prerequisite. No provider metadata was changed here.

## Inputs and decisions checked

- Read meta `AGENTS.md`, `README.md`, `.factory/prompts/issue-review.md`, approved packages,
  and the console, API, contract and status repository instructions. Inspected the clones
  directly; all target repositories remain unchanged.
- Read [#569](https://github.com/lorenzh/pulse-meta/issues/569) and all four current comments,
  including the earlier hold and the owner's decision linked above.
- Read [#460](https://github.com/lorenzh/pulse-meta/issues/460), including the
  [2 November amendment](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362).
  Sections 10–15 and 18–20 directly constrain this feature and override older boards.
- Read the saved #568 and #564 specs and rechecked the incident API and console policy sources.
  The private incident API and public filtering from #568 are present in the inspected
  sources. Its spec explicitly leaves console screens to #569 and their permissions to #564.
  Reuse this backend; do not rebuild drafts, notes or public filtering merely to add screens.
- Consulted the approved #564 role matrix and #567/#718 foundations. Console now has the
  actual role policy, check screens, shell, states and confirmations; reuse them.
- Read #765 and its comments, its saved spec, and the actual contract/API implementation.
  The prerequisite deliberately leaves components in the file: existing component definitions
  are sufficient to select their checks, and a database window stores check ids, not component
  ids. Database component management is not a prerequisite or a new part of #569. The owner's
  native-blocker instruction is preserved; this run did not change dependencies or recheck the
  native dependency edge. Completion and availability are verified independently above.
- `design/` contains website exports only. Neither #569 nor the inspected local references
  provides a URL/export of the named `pulse Console` boards. No conclusion here relies on
  viewing those boards. The plan can use the current self-hosted shell and recorded decisions;
  if boards become available, cite their self-hosted versions and reconcile them with #460.
  Exact pixel fidelity to an unavailable board is not an acceptance assertion.

## Verified baseline

These are the inspected clone heads, not dependency pins to copy into the implementation:

| Target | HEAD |
| --- | --- |
| console | `5cdc34b6c5396dc67f02d6dff5585e9c1174a60a` |
| api | `4b3e9b1dcce5f4e362c6bc1f529375181fb49f9a` |
| contract | `c4a2eb5214d48d40d0c1afbae5e3e49463185e15` |
| status | `8b6d4315fcb989a7a8d74c063ab08d97c18a7d2d` |

| Evidence | Current behavior and implication |
| --- | --- |
| Console `src/navigation.ts`, `src/server.ts` | Incidents and Maintenance are unavailable navigation entries. New production routes must be registered and enable the entries in the same change. Checks, Overview and Team already work. |
| Console `src/permissions.ts`, `src/protected-route.ts`, `src/check-write.ts` | Viewer+ can view; Member+ can declare/post/resolve incidents and create/edit maintenance; Admin+ can delete manual incidents or maintenance. Existing incident text cannot be edited by any role. Writes recheck the session and stored role before the outbound API request. |
| Console `src/api-read.ts`, `src/api-failure.ts`, `src/check-write.ts`, `src/form-tokens.ts`, `src/people-log.ts` | Bounded contract-validated HTTP, write outcomes, replay guards and a People log exist. The current check write helper assumes check scopes and `If-Match`; incident writes need their own semantics. Read-call/error types and People-log actions/targets need incident/window extensions. |
| Contract `src/schema.ts`; API `src/manual-incidents.ts`, `src/manual-incident-routes.ts`, `docs/rest-api.md` | Public create/update/resolve/delete already exist. Manual incidents have title, component ids, impact, status, timestamps and an append-only public timeline. Private routes separately expose drafts, notes and internal visibility. Public list history is the last 14 days, at most 50 resolved items; it is not an all-time dataset. |
| API `src/server.ts`, `src/service.ts`; contract `Incident` | Automatic incidents identify a check, reason and open/resolve times, with bounded reads using `limit`/`since`. They are separate from manual incidents, and have no manual update or resolve operation. |
| Contract `src/admin.ts`, `src/validate-admin.ts`, `src/index.ts` | Version 2.3.0 exports `AdminMaintenanceWindowInput`, `AdminMaintenanceWindow`, `AdminMaintenanceList` and validators. Stable ids, multi-check definitions, source, phase, revision and separate shadowed rows are available. Legacy `AdminMaintenanceView` remains for compatibility; it is not the new admin list shape. |
| API `src/maintenance-write.ts`, `src/maintenance-store.ts`, `src/effective-maintenance.ts`, `src/admin-routes.ts`, `docs/rest-api.md` | `GET /admin/maintenance` includes all phases and shadowed database definitions; POST/PUT/DELETE store database windows with revision and audit atomically. File windows are read-only and win by id. Public `/maintenance` still returns current/upcoming per-check windows; components still come from the file. |
| Status `src/render.ts` | Open manual incident cards show title, impact, status, affected components and the latest update. Resolved history shows all public updates for the last 14 days. Messages are escaped plain text. Maintenance is consumed as per-check windows. |
| Console `src/console-script.ts`, `src/styles.ts`, `e2e/run.ts`, `package.json` | Server-rendered forms, one same-origin script, strict CSP and an existing Playwright/axe harness at 390/1280 px. This does not by itself satisfy the explicit agent-browser acceptance requirement. |

The console still pins contract `66818a24b81f5d0d86eee939dad64fa126617ba2`, which predates
the new maintenance exports. The plan must update its full-SHA pin and lockfile to merged
contract main providing 2.3.0. API already pins `c4a2eb5…`. The public status shapes remain
compatible; no new contract/API/status implementation is assumed necessary. Inspect consumers
when updating the pin and keep existing checks green.

## Scope reconciliation

Apply these recorded decisions without asking the owner to decide them again:

- Self-hosted, one organisation, current shell; hosted boards and multi-tenancy are later.
- #460 section 10 requires database-backed maintenance with a stable id, 1–50 check ids,
  start/end and a public note of 1–500 characters. List current, planned and past windows;
  select checks directly or through a component. File entries are read-only and win over
  database definitions. No title, announced state or paused-from-alerting column.
- MVP composer publishes immediately; its timeline contains public updates only. Draft and
  internal-note UI is not requested by #569 and remains outside this screen spec even though
  #568 has now supplied the backend. No visibility selector, internal-only screen, autosave,
  subscriber toggle, subscription control or AI assistance is assumed.
- Automatic incidents are read-only. “Post a public update” opens a prefilled composer that
  creates a separate manual incident; it never updates or resolves the automatic incident.
- Incident list, detail, posting, resolution and declaration work at 390 px without horizontal
  scrolling. Maintenance remains desktop-first but usable on narrow screens.
- Use the shipped #564 permission matrix, including Admin+ maintenance deletion and no
  permission to edit published incident text. Members may plan maintenance, including the
  required People-log attribution; no additional owner approval is needed for that policy.

## Nonblocking open points and planning assumptions

### Incident list, identity and MTTR

Assume the list includes automatic incidents and published public manual incidents, visibly
distinguished, with open/resolved views and links to their respective detail pages. Their numeric
ids are independent: route identity must include the kind. Do not merge equal ids or infer that
a manual incident is linked to an automatic one merely because their component/check overlaps.
The plan should settle exact filters, sort order and routes; preserve filters on navigation and
distinguish no incidents from no matches.

“MTTR” lacks a population, period and formula. Recommended minimum: an explicitly labelled
mean resolution duration for the returned resolved public manual incidents in the last 14 days
(at most 50), `sum(resolvedAt - createdAt) / count`. Show the sample count and the API cap;
exclude open incidents, drafts and private incidents; show an em dash/no resolved incidents for
an empty sample. For example, 10-minute and 30-minute incidents yield 20 minutes. This is not
organisation-wide or all-time recovery time. Automatic rows can show their own
`resolvedAt - openedAt` duration separately. If the plan chooses a combined or longer-period
metric, it must provide a complete, bounded API dataset for that declared population; never
average a silently truncated page or count updates as incidents.

### Timeline, composer and manual lifecycle

Use current contract validators and bounds: title 1–200 characters, message 1–2000, at most 50 distinct
component ids and 100 updates. Public messages are plain text with permitted newlines;
Markdown, attachments, editable published text and reopening resolved incidents are not implied.
Creation exposes existing non-resolved statuses and impact values; subsequent public updates
use investigating/identified/monitoring/resolved. Define deterministic timeline ordering,
including equal timestamps (the response array index is the stable update number), and show
time zone and resolved/open durations consistently. Do not key updates by timestamp alone or
replace contract Unicode validation with an inconsistent browser-only length check.

Use the existing publish-now public API for this MVP. Resolution gets a plain confirmation;
deletion gets type-the-title confirmation, works without JavaScript and warns that delivered
notifications cannot be recalled. Preserve backend 404/409 behavior, update-count limits and
the no-reopen rule. A resolved record has no post-update or resolve action. Direct requests
must enforce these rules even if the UI hides the action.

The automatic-detail composer shortcut should preselect the containing component when one
exists; the plan must define no-component behavior (a general manual incident is supported),
and visibly explain that publication creates a new manual incident. Do not automatically copy
raw failure reasons, targets or credentials into public text. Its detail may show authenticated
reason, times and recent results using bounded existing reads; no invented public timeline.

Public reads exclude private content supplied by #568. Do not use the private admin list and
then leak draft titles, notes, hidden counts or internal incidents into this MVP list/preview.
Handling a public incident with an existing private draft must follow the legacy API behavior:
posting retains the draft; resolving discards it. Document that interaction rather than
silently publishing another person's saved draft.

### Preview meaning and implementation boundary

Interpret “matches the status page output” as semantic parity of the incident block: title,
impact, status, affected component names, escaped message/newlines and timeline selection.
Open preview shows the latest public update; a resolving preview follows resolved-history
behavior. Compare with the real pulse-status output at a fixed time and time zone, allowing
container layout and relative-time differences that the plan explicitly normalizes. The issue
does not supply runtime status-theme configuration to reproduce an arbitrary whole page.

The preview changes as the person edits, including before first publication; it must not POST
to pulse-api, save a draft, notify anyone or write the People log. Render safe text, including
HTML-looking strings. Keep it within the authenticated console. No credential or unpublished
message in a URL/query string, diagnostic log or public endpoint. Publishing must work without
JavaScript; provide a form-driven preview fallback if needed.

Extend the existing script; no inline scripts or external assets. If preview uses same-origin
fetch, account explicitly for CSP (`connect-src` currently falls back to `default-src 'none'`),
authentication, CSRF/form handling and stale response order. A local DOM preview avoids a new
fetch allowance. Services cannot import another service's renderer; use independently verified
fixtures or an explicitly planned shared pure rendering module in an appropriate library if
necessary. A duplicated console snapshot alone cannot prove status parity. Do not add a new
status preview endpoint or broaden its proxy allow-list without a specific need.

### Maintenance: consume the merged prerequisite

The spec must use these inspected #765 semantics, not infer a new backend from older boards:

- Read `GET /admin/maintenance` with `validateAdminMaintenanceList`. The response is
  `{revision, windows, shadowed}` with an ETag and no-store. Query parameters are rejected;
  phase filtering and ordering belong in the console. There is no admin single-window GET;
  edit/detail forms must locate a database row in this validated list. `/maintenance` and the
  `maintenance` field of `/admin/config` cannot supply the stored multi-check identities and past list.
- Create with `POST /admin/maintenance`, replace with `PUT /admin/maintenance/:id`, delete
  with `DELETE /admin/maintenance/:id`. POST/PUT take exactly
  `{id, checkIds, start, end, note}`; validate using `validateAdminMaintenanceWindowInput`.
  Create returns 201 and replace 200 with an `AdminMaintenanceWindow`; delete returns 204.
  A window is one atomic database write, not several independent single-check writes.
- The id is client-chosen, starts with a lowercase letter, and is 1–64 characters from
  `[a-z0-9._-]`. The plan must decide whether it is entered or generated and show collision
  feedback (409). An existing id is immutable: PUT's body and path ids must agree. This is
  an identity, not the removed design title. Do not use a file index as a database identity.
- There must be 1–50 distinct effective check ids, from either source. Epoch milliseconds
  are integers with `0 <= start < end <= 253402300799999`. The note is public plain text,
  1–500 UTF-16 code units, one line, no control characters or leading/trailing whitespace;
  use the contract's precise Unicode validation. At most 1000 database windows are stored.
- File rows have `source: file`, an index and nullable id. Database rows have
  `source: database`, non-null id and null index. File ids shadow whole database windows;
  `shadowed` rows must be visibly separate, read-only except for Admin+ deletion. Deleting
  a shadowed database row leaves the file window active. File-only rows cannot be changed
  by any role. An id-less file row must still be viewable without inventing an editable id.
- `If-Match` uses the shared config revision, also changed by check writes and file applies:
  missing 428, stale 412, malformed or wildcard 400. Do not silently fetch a fresh revision
  to overwrite a concurrent change. Preserve fields and make refresh/review explicit.
  Unknown references yield 422; duplicate ids, shadowed replacements and capacity yield
  409; unknown ids yield 404. Window writes do not yield a read-only-file 503.
- Removed check ids remain stored and visible, stop applying while absent and apply again
  if the check returns. Show missing ids rather than silently dropping them on edit; an
  attempted replacement still validates every reference. Overlaps are permitted and form
  a union; the earliest-starting active window supplies the public note. Past definitions
  remain listable until deleted. The writer has no future-only or planned-only edit rule.
- Broken, unreadable or read-only files leave their last applied definitions in force and
  do not block database writes. Public status consumes the existing effective per-check
  projection. Results continue to be recorded; down samples inside a window do not open
  incidents, and starting a window does not itself resolve an open incident. Up/degraded
  samples still follow existing quorum behavior. No new suppression engine belongs here.

Assume selecting a component expands to a deduplicated snapshot of its effective check ids,
combined with directly selected checks, with a final 1–50 limit. Later component membership
changes do not silently rewrite the window. Reuse the `components` field of `/admin/config`
and effective checks; no component-management screen or database component store is needed. The plan must
define how the selection snapshot and revision stay coherent across config and maintenance
reads and a submit. A stale revision must retain the user's selections, never silently apply
changed component membership. Revalidate references at the API commit.

Use the API phase: planned `now < start`, current `start <= now < end`, past `end <= now`.
Specify when the list refreshes across boundaries. Use explicit UTC inputs or explicit
time-zone/offset conversion so browser and server schedule the same instant. Show duration
and zone; do not silently shift local time through DST ambiguity. Offer create/edit for
unshadowed database rows and plain-confirmation delete, subject to existing roles. Include
current/past rows in the documented edit policy without imposing an unrequested scheduler.

### Authorization, errors and audit

Register protected routes with `routeRole`, recheck current session/role immediately before an
outbound write, and preserve the existing Origin/content-type/body-size/repeated-field/CSRF/
form-token order. URL-encoded multilingual text can exceed a JSON byte limit; choose form
bounds that accept valid contract-sized messages without removing transport bounds. Repeated
check selections need deliberate parsing, not a bypass of duplicate-field protections.

The console's server-only API token needs `admin`+`incidents` for incident writes,
`admin`+`checks` for maintenance writes, and `read` or `checks` for the admin list. Update
scope documentation and fixtures; never put the token in browser code or the console database.
Reuse API failure states but do not retain check-specific scope/error text for incident writes.
Keep input on validation/conflict, show actual 404/403 and token rejection distinctly, and do
not claim an unreachable or timed-out write was definitely unsaved. A consumed form token
prevents ordinary double submission; an unknown upstream outcome must not trigger a blind
retry that creates a duplicate incident/update/window.

Add People-log actions/targets using the API action names for successful incident and window
mutations (`manual-incident.create/update/resolve/delete` and
`maintenance.create/replace/delete`). Store person, time, action and target identity,
never title/message/note/body/token.
The API audit still attributes the console token, not the console user. As with check writes,
the API commit and console log are separate transactions: report “saved, log failed” accurately
if the second fails; do not replay the API write or claim distributed rollback.

## Derived acceptance check

The build must demonstrate all of the following using the merged #765 backend:

1. **Incident browser journey:** with a real API and status service on local fixtures, use
   agent-browser to sign in as Member, declare a public incident with affected components,
   preview and publish it, post identified/monitoring updates, then confirm resolution. Reload
   and verify persisted list/detail state and ordered public updates; verify the same incident
   and messages on pulse-status. Reject invalid fields without losing the message. Resolving
   twice or posting after resolution changes nothing and produces the documented conflict.
2. **Preview parity:** before publishing, changing title, impact, status, components and message
   changes the preview with zero API mutations/log entries. After publication compare its
   normalized content with actual status open/resolved rendering. Include newlines, Unicode
   and `<script>`/HTML-looking input; it stays inert escaped text. Private drafts/notes/internal
   incidents never appear. A fixture containing only private content yields no public card.
3. **Automatic incidents:** show check, reason, times and bounded results; direct update/resolve
   attempts cannot mutate them. The public-update shortcut creates a separate manual record
   and leaves the automatic one unchanged, including when their numeric ids coincide.
4. **MTTR:** a literal fixture with resolved durations 10 and 30 minutes shows 20 minutes and
   sample count 2; open/private records do not affect it. An empty set shows no value. The
   displayed population, 14-day period and 50-item cap match the documented query semantics.
5. **Maintenance browser journey:** as Member, choose direct checks plus a component with an
   overlapping check, enter explicit times and public note, and save one durable multi-check
   database window. Reload and verify id, deduplicated check set, note and exact epoch times.
   Verify planned/current/past lists at injected boundary times, status-page maintenance output,
   editable database origin and read-only file origin. Edit the database note/end and confirm
   deletion as Admin; reload to check persistence and removal. A restart preserves the saved
   window; planning it does not rewrite `checks.json`. Reject empty/>50/unknown selections,
   invalid spans/notes/ids and collisions. A stale form after a check or window change keeps
   the input and does not overwrite; a shadowed row allows only deletion of its database copy.
6. **Maintenance integration:** reuse #765 tests for atomicity, file precedence and
   conflict handling, database-check references and retention of past windows; do not rebuild
   that feature. Verify the console sends the real contract and revision. During an active
   window results continue to persist and down samples open no new automatic incident; an
   already-open incident remains open under those down samples. Exercise start-inclusive/end-exclusive boundaries with
   an injected clock. These checks cannot be replaced by a fake API that accepts any body.
7. **Roles and confirmations:** Viewer can view but cannot declare/update/resolve/plan/edit;
   Member can perform those actions but cannot delete either a manual incident or maintenance,
   including their own; Admin can delete with the required confirmation. All roles are refused
   published-text edits and file-window writes. Exercise direct POSTs, CSRF failures, double
   submission and session/role changes before the outbound request; forbidden attempts make
   zero upstream mutations. Cancellation and incorrect type-the-title change nothing.
8. **Mobile and accessibility:** run list, detail, declaration, posting and resolution at 390 px
   and a desktop viewport; assert no horizontal scroll with long text, reachable controls,
   keyboard focus, accessible names, textual status and usable errors/confirmation. Cover busy
   and no-JavaScript publication/confirmation. Keep existing Playwright/axe browser CI green;
   retain explicit agent-browser commands and results for the issue's acceptance journeys.
9. **Failure and audit evidence:** cover timeout, network failure, rejected/underscoped token,
   unknown id, conflict, update limit and uncertain write result. Verify preserved input and
   no blind retry; successful mutations add person/action/target People-log rows. Sentinel
   tokens and incident/message/note bodies appear in neither logs nor audit metadata. Document
   route/scope/MTTR/preview/maintenance semantics and provide each changed target's required
   checks plus the real-service browser evidence. No new runtime dependency is assumed.

## Review validation

This state reviewed instructions, current issue comments, prerequisite completion, source and
existing tests. Read #765's merged contract/API schemas, writer, effective projection and
HTTP tests, as well as the API maintenance concepts. The old prerequisite hold is superseded.
Only this artifact was written. No target files were changed and no product/browser tests were
run; the acceptance checks above are requirements for later states, not completed test results.
`git diff --check` passed; `git ls-files --error-unmatch` confirms the artifact is tracked,
and `git check-ignore -v` found no ignore rule. Only this artifact appears in the changed-file list.
Discovery references to absent `console/public`, `maintenance-store.test.ts` and
`maintenance.test.ts` were corrected by reading the existing console assets and API
`server.maintenance-admin.test.ts`, `maintenance-write.test.ts`,
`effective-maintenance.test.ts` and `service.maintenance.test.ts` directly. The optional
cloud runtime check could not read `/etc/codex/network-policy.json` (absent), and no
`environment_status` tool is available in this session. No runtime/network readiness is
claimed; GitHub connector reads and local repository inspection succeeded. This does not
block the issue review. Keep this artifact tracked and available to `plan`.
