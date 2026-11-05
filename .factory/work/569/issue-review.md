# Issue review: #569 — console: incident and maintenance screens

## Outcome

`needs-input`: decide ownership of the missing database components/maintenance prerequisite
before writing the spec. The UI and incident work can otherwise be specified using the
assumptions below.

**Question:** should #569 include the contract/API work for database-backed components and
maintenance windows required by section 10 of the Console v1 decision record, or wait for a
separate prerequisite feature to deliver it?

- **Separate prerequisite (recommended):** provide/open the item B named in the decision record,
  link it as a native blocker of #569, and resume planning against its merged contract and API.
- **Include the prerequisite in #569:** explicitly expand this feature beyond console, with
  contract/API sections before console and any consumer compatibility work the plan identifies.

The existing file-writing API cannot implement the decided maintenance behavior. Do not silently
substitute it, create a console-local maintenance store, or drop maintenance from acceptance.
This hold asks about the delivery boundary of an explicitly separate prerequisite, not about
already-decided maintenance semantics. No issue, comment, label or dependency was changed here.

## Inputs and decisions checked

- Read meta `AGENTS.md`, `README.md`, `.factory/prompts/issue-review.md`, approved packages,
  and the console, API, contract and status repository instructions. Inspected the clones
  directly; all target repositories remain unchanged.
- Read [#569](https://github.com/lorenzh/pulse-meta/issues/569) and its comments. The only comment
  is this run's Factory claim; there are no earlier product decisions on this issue.
- Read [#460](https://github.com/lorenzh/pulse-meta/issues/460), including the
  [2 November amendment](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362).
  Sections 10–15 and 18–20 directly constrain this feature and override older boards.
- Read [#568](https://github.com/lorenzh/pulse-meta/issues/568), its comments and approved plan.
  It is closed; the private incident API and public filtering are present in the inspected
  sources. Its spec explicitly leaves console screens to #569 and their permissions to #564.
  Reuse this backend; do not rebuild drafts, notes or public filtering merely to add screens.
- Consulted the approved #564 role matrix and #567/#718 foundations. Console now has the
  actual role policy, check screens, shell, states and confirmations; reuse them.
- The native `blocked_by` read for #569 returns only #562 and #568, both closed. Searches for
  maintenance/components titles and for maintenance plus database find no separate item B;
  the matching decision record names it but does not link an issue. This is evidence of an
  unavailable prerequisite, not a claim that its intended implementation is already present.
- `design/` contains website exports only. Neither #569 nor the inspected local references
  provides a URL/export of the named `pulse Console` boards. No conclusion here relies on
  viewing those boards. The plan can use the current self-hosted shell and recorded decisions;
  if boards become available, cite their self-hosted versions and reconcile them with #460.
  Exact pixel fidelity to an unavailable board is not an acceptance assertion.

## Verified baseline

These are the inspected clone heads, not dependency pins to copy into the implementation:

| Target | HEAD |
| --- | --- |
| console | `c78c9d5e835ee11978a025a6955dfc5eca1c23b2` |
| api | `32704fd1e2217a109f51ea7ff41ccc7e8c73cfeb` |
| contract | `66818a24b81f5d0d86eee939dad64fa126617ba2` |
| status | `8b6d4315fcb989a7a8d74c063ab08d97c18a7d2d` |

| Evidence | Current behavior and implication |
| --- | --- |
| Console `src/navigation.ts`, `src/server.ts` | Incidents and Maintenance are unavailable navigation entries. New production routes must be registered and enable the entries in the same change. Checks, Overview and Team already work. |
| Console `src/permissions.ts`, `src/protected-route.ts`, `src/check-write.ts` | Viewer+ can view; Member+ can declare/post/resolve incidents and create/edit maintenance; Admin+ can delete manual incidents or maintenance. Existing incident text cannot be edited by any role. Writes recheck the session and stored role before the outbound API request. |
| Console `src/api-read.ts`, `src/check-write.ts`, `src/form-tokens.ts`, `src/people-log.ts` | Bounded contract-validated HTTP, write outcomes, replay guards and a People log exist. The current check write helper assumes check scopes and `If-Match`; incident writes need their own semantics. People-log types currently include checks but no incident/window targets or actions. |
| Contract `src/schema.ts`; API `src/manual-incidents.ts`, `src/manual-incident-routes.ts`, `docs/rest-api.md` | Public create/update/resolve/delete already exist. Manual incidents have title, component ids, impact, status, timestamps and an append-only public timeline. Private routes separately expose drafts, notes and internal visibility. Public list history is the last 14 days, at most 50 resolved items; it is not an all-time dataset. |
| API `src/server.ts`, `src/service.ts`; contract `Incident` | Automatic incidents identify a check, reason and open/resolve times, with bounded reads using `limit`/`since`. They are separate from manual incidents, and have no manual update or resolve operation. |
| Contract `src/schema.ts`, `src/admin.ts` | A maintenance window currently has one `checkId`, `start`, `end`, `note`; admin addressing adds an array `index`. It has no stable id, `checkIds`, source or shadowed metadata. |
| API `src/config-write.ts`, `src/admin-routes.ts`, `src/effective-checks.ts`, `docs/rest-api.md` | Only checks have the file/database merge. Components and maintenance still come from the file; their writes rewrite it. They may reference only file checks. `/maintenance` lists current/upcoming windows (`end > now`), so it cannot supply past windows. |
| Status `src/render.ts` | Open manual incident cards show title, impact, status, affected components and the latest update. Resolved history shows all public updates for the last 14 days. Messages are escaped plain text. Maintenance is consumed as per-check windows. |
| Console `src/console-script.ts`, `src/styles.ts`, `e2e/run.ts`, `package.json` | Server-rendered forms, one same-origin script, strict CSP and an existing Playwright/axe harness at 390/1280 px. This does not by itself satisfy the explicit agent-browser acceptance requirement. |

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

Use current contract bounds: title 1–200 UTF-16 units, message 1–2000, at most 50 distinct
component ids and 100 updates. Public messages are plain text with permitted newlines;
Markdown, attachments, editable published text and reopening resolved incidents are not implied.
Creation exposes existing non-resolved statuses and impact values; subsequent public updates
use investigating/identified/monitoring/resolved. Define deterministic timeline ordering,
including equal timestamps, and show time zone and resolved/open durations consistently.

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

### Maintenance contract required from the prerequisite

The plan needs the resolved prerequisite's real endpoints and validators, not a guessed id
layer over today's file indexes. It must cover stable identities, source/precedence/shadowing,
effective check references (including database checks), revision/conflict rules, current/planned/
past reads and durable create/edit/delete. A console form cannot safely emulate a multi-check
window with several independent file writes: partial saves and index changes break that model.

Assume component selection expands to a deduplicated snapshot of its effective check ids at
save time, combined with directly selected checks, with a final 1–50 limit; later component
membership changes do not silently change an existing window. The prerequisite/spec should
make that explicit. Validate references again when saving. Define unknown/removed checks,
overlapping windows, file precedence and retained past records in that backend contract.

For screens, classify planned as `now < start`, current as `start <= now < end`, past as
`end <= now`. Use explicit UTC inputs or an explicit time-zone/offset conversion so a browser
and server in different zones schedule the same instant. Require `end > start`, a visible
duration and the public note; do not silently shift a local time through DST ambiguity. Whether
past/current windows can be edited must follow the prerequisite's documented policy. Delete
uses plain confirmation. File windows remain read-only even for Owner. Preserve recording of
results during maintenance and existing incident/quorum behavior; no new suppression engine
belongs in the console.

### Authorization, errors and audit

Register protected routes with `routeRole`, recheck current session/role immediately before an
outbound write, and preserve the existing Origin/content-type/body-size/repeated-field/CSRF/
form-token order. URL-encoded multilingual text can exceed a JSON byte limit; choose form
bounds that accept valid contract-sized messages without removing transport bounds. Repeated
check selections need deliberate parsing, not a bypass of duplicate-field protections.

The console's server-only API token needs `admin`+`incidents` for incident writes and the
prerequisite's maintenance permissions (currently `admin`+`checks` for config writes). Update
scope documentation and fixtures; never put the token in browser code or the console database.
Reuse API failure states but do not retain check-specific scope/error text for incident writes.
Keep input on validation/conflict, show actual 404/403 and token rejection distinctly, and do
not claim an unreachable or timed-out write was definitely unsaved. A consumed form token
prevents ordinary double submission; an unknown upstream outcome must not trigger a blind
retry that creates a duplicate incident/update/window.

Add People-log actions/targets using the API action names for successful incident and window
mutations. Store person, time, action and target identity, never title/message/note/body/token.
The API audit still attributes the console token, not the console user. As with check writes,
the API commit and console log are separate transactions: report “saved, log failed” accurately
if the second fails; do not replay the API write or claim distributed rollback.

## Derived acceptance check

The build must demonstrate all of the following after the prerequisite scope is resolved:

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
   editable database origin and read-only file origin. A restart preserves the window; planning
   it does not rewrite `checks.json`. Reject empty/>50/unknown selections and invalid spans.
6. **Maintenance integration:** prerequisite tests establish atomicity, file precedence and
   conflict handling, database-check references and retention of past windows. During an active
   window results continue to persist and down samples open no new automatic incident; an
   already-open incident remains open. Exercise start-inclusive/end-exclusive boundaries with
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

This state reviewed instructions, comments, dependency metadata, source and existing tests.
Only this artifact was written. No target files were changed and no product/browser tests were
run; the acceptance checks above are requirements for later states, not completed test results.
Failed discovery calls were corrected: issue comments were fetched with `repo_full_name`,
absent directories were listed through their existing parents, and status rendering was read
from `src/render.ts`. The review artifact must remain tracked for the resumed state.
