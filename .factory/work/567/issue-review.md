# Issue review: #567 — console: check screens

## Outcome

Ready for `plan`; no unanswered product decision requires a `needs-input` hold. Use the
explicit narrowing of #567 in the [2 November amendment to #460](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362),
sections 1, 8, 13–15 and 19–20. The issue body predates that amendment. In particular, its
pause, dry-run, heartbeat-failure and TLS-verification acceptance examples are for deferred
work, not acceptance criteria for this MVP spec.

The remaining scope is the Checks list, check detail, and create/edit forms for the six existing
types, using the existing shell, permissions and database check API. Retain the requested
per-location uptime: the amendment does not explicitly defer it, and current reads do not
provide it. The plan must account for that data gap rather than invent uptime from a recent
results page. All remaining engineering choices below can be settled in the plan.

## Inputs and decisions checked

- Read root `AGENTS.md`, `README.md`, the issue-review prompt, approved packages, and the
  Console, contract, API and probe repository instructions. Target clones were inspected
  directly and remain unchanged.
- Read [#567](https://github.com/lorenzh/pulse-meta/issues/567) and all its comments. At review
  time there is only the current Factory claim comment; no prior review decision is hidden
  there.
- Read [#460](https://github.com/lorenzh/pulse-meta/issues/460) and its comments. Its amendment
  explicitly names #567, separates the deferred work, and says the decisions override older
  boards. Follow that recorded scope without asking the owner to decide it again.
- Read [#565](https://github.com/lorenzh/pulse-meta/issues/565), its local review and approved
  plan, and [#718](https://github.com/lorenzh/pulse-meta/issues/718) and its local plan. Both
  features are closed and their relevant code is in the clones. The role policy from #564 is
  also present; its approved plan was consulted. Reuse these foundations rather than redo
  setup, sign-in, roles, source precedence, storage, export, or shared UI states.
- The checkout contains website design files, but no `pulse Console` board files or URL to the
  named design. No claim here relies on an unseen board. Use the existing Console shell and
  the published self-hosted v1 decisions; hosted boards are outside this issue.

### Scope reconciliation

| Original request | Scope after the recorded amendment |
| --- | --- |
| List with filters; detail; six-type editor | Included. Source, read-only and shadowed behavior are part of the screens. |
| Quorum and location selection | Deferred. Explain the fixed rule and that every probe runs every probed check. |
| Pause and Test check | Deferred by sections 19–20. Do not add controls or change scheduling, states or alerts. |
| Heartbeat `/fail` | Deferred by section 19. Edit existing period/grace/secret options and document the existing ping route only. |
| TLS chain and hostname verification option | Deferred by section 19. Expose only existing TLS expiry-check options. |
| Import `checks.json` | Deferred by sections 8 and 19. Export remains included; import is a separate feature. |
| Probe version per location | Deferred. Show only data the API actually supplies. |

## Verified baseline

Inspected clone heads: Console `76dab43`, contract `9ab7e24`, API `fb6f1a5`, probe `8fd19c8`.
These identify the reviewed snapshots, not dependency pins to copy into the implementation.

| Repository and evidence | Current behavior and implication |
| --- | --- |
| Console `src/navigation.ts`, `src/server.ts`, `src/protected-route.ts` | Checks is an unavailable navigation entry; production protected routes currently cover Overview and Team. The route map matches exact raw paths. New check routes need production registration and must pass through the existing session/form/role gates. |
| Console `src/permissions.ts`, `src/roles.ts` | View access is Viewer+; `check.write` is Member+; `check.delete` is Admin+. Export is Member+ under #460. The role is read on each request; hiding controls alone is insufficient. |
| Console `src/overview-read.ts`, `src/api-failure.ts`, `src/states.ts`, `src/confirm.ts` | Already has bounded, validated API reads, token rejection and wire/error handling, shared conflict/field/error states, and confirmations. Overview uses the tolerant admin summary validator, not the full editable configuration. |
| Console `src/forms.ts`, `src/console-script.ts`, `src/styles.ts`, `e2e/run.ts` | Server-rendered URL-encoded forms, an 8192-byte form cap, one same-origin script, existing Playwright/axe harness, and no-JavaScript checks. The current form cap cannot carry a contract-sized HTTP body. |
| Contract `src/schema.ts`, `src/admin.ts`, `src/validate-admin.ts` | Six types are HTTP, TLS, TCP, DNS, domain and heartbeat. Admin inputs/views are strict, source is `file` or `database`, HTTP literal values/body use keep markers, env references remain visible, and heartbeat views expose only `hasSecret`. Config has `checks`, separate `shadowed`, `file`, and a revision. |
| API `src/check-write.ts`, `src/effective-checks.ts`, `src/admin-routes.ts`, `src/config-export.ts` | #565 already creates/replaces/deletes database definitions with `If-Match`, keeps file checks read-only, keeps shadowed definitions separate, applies file precedence, persists heartbeat digests, audits writes, and exports the redacted effective set. A broken file does not block database check writes. No import API is needed here. |
| API `src/server.ts`, `src/service.ts`; contract `src/schema.ts` | `/checks` supplies live state, latest result per location with `stale`, and optional 30-day SLO. `/uptime` is aggregate 90-day history; `/checks/:id/latency` is 90-day daily p50/p95 for HTTP only. `/checks/:id/results` pages newest first with `limit` and exclusive `before`, preserving timestamp ties. None supplies historical uptime grouped by location. |
| API `src/state.ts`; probe `src/client.ts`, `src/check-scheduler.ts` | One reporting location decides alone; with two or more, at least two down locations are required. API evaluation also applies its freshness window. There is no per-check quorum/location field. Heartbeat checks are excluded from probing. |
| API `src/heartbeat.ts`, `src/server.ts` | Missing pings generate failure results; valid pings generate `up`. The second path segment in `/heartbeat/:id/:secret` currently means a secret, not a `fail` action. The reported missing explicit failure path is real but deferred. |
| Probe `src/check.ts`; contract `src/schema.ts` | TLS connects with `rejectUnauthorized: false` and judges leaf expiry. There is no chain/hostname verification option. `CheckState` has no paused member and there is no editor dry-run route in the inspected API routing. These findings do not authorize implementing the deferred features. |

## Nonblocking open points and planning assumptions

### 1. List, filters and identity

Assume filters for text (id/name/target), type, live state, and source, including a way to show
shadowed database entries. They must compose, survive navigation/reload through GET query
parameters, have a clear reset action, and distinguish an empty installation from no matches.
The plan can choose exact query names and layout; tags, groups, bulk operations and server-side
search are not implied.

Never merge two definitions with the same id into an editable row. Live data belongs to the
effective check; a shadowed database definition must not display the file check's results as its
own runs. Give source-selected detail/export/delete actions unambiguous identities. Keep the
id fixed on edit because PUT addresses an existing id; renaming an id is not an implied feature.
Show source on list and detail, file entries as read-only, and shadowed entries as Delete and
Export only. Deleting a shadowed database definition must leave the effective file check intact.

### 2. Detail data, especially per-location uptime

Keep the existing aggregate 90-day uptime and HTTP latency history and 30-day SLO semantics.
Show latest per-location status, timestamp, latency, reason, attempts and stale indication from
the API, not a second implementation of quorum/freshness rules. Recent results use bounded
paging; do not fetch the entire retention window into the browser. Heartbeat's `heartbeat`
location is a synthetic ping source, not a selectable probe; network latency is not applicable.
Non-HTTP checks must not call the HTTP-only latency endpoint and present its 404 as an outage.

The remaining request for per-location uptime cannot be satisfied by `locations[].result`,
aggregate daily uptime, or a percentage of the latest 100 results. Recommended assumption:
use the same 90 UTC day window and result-weighted `(up + degraded) / total` definition as
existing uptime, grouped by location, with an explicit period/sample count and null for no
samples. Keep this distinct from check-level quorum state and the 30-day SLO. The plan must
choose the exact additive API/contract shape, handling of retained historical locations and
empty windows, and an indexed/bounded aggregation approach. Existing daily rollups discard
location, so they cannot simply be relabelled. Include API and contract tasks for this gap;
do not silently drop it under the otherwise narrower MVP scope. A latest latency per location
is already available; additional per-location percentile histories are not assumed.

No client-side recomputation of SLO or invented burn-rate text. Show no objective configured,
no samples, and exhausted/negative budget distinctly, using the returned values. Keep unknown,
maintenance and stale data visible without implying healthy service.

### 3. Complete editors and write-only fields

Expose the existing writable options for all six types, with requiredness, defaults, bounds,
units and cross-field validation taken from the current contract and API parser:

- HTTP: URL, interval, timeout, retries/delay, latency objective, method, headers, body, expected
  statuses/ranges, keyword, JSON assertions and availability target.
- TLS: host, port, interval, timeout, warning days and availability target. Explain that this
  check judges certificate expiry; do not offer chain validation or an HTTP TLS bypass toggle.
- TCP: host, port, interval, timeout, retries/delay and availability target.
- DNS: DNS name, record type, expected answers, optional resolver, interval, timeout,
  retries/delay and availability target.
- Domain: domain, warning days, interval (minimum one hour), timeout, retries/delay and
  availability target.
- Heartbeat: period, grace, availability target and write-only secret creation/replacement;
  keep the existing secret when it is not replaced. No interval/location selector or run action.

All types have id and display name. The plan must define whether type changes are allowed;
recommended minimum is choosing type on create and keeping it fixed on edit. That does not
prevent creating and editing each of the six types.

For stored literal headers/body render “set” with explicit keep, replace and remove intentions;
never turn an empty input into accidental removal. A normal GET/edit/PUT must preserve these
values. Env headers show/edit only `PULSE_HEADER_*` reference names and a copyable host-binding
configuration instruction for every probe. The Console does not read/change
`PULSE_PROBE_HEADER_HOSTS`, fetch probe environment values, or accept header secrets through
the secret-reference control. Plain header inputs must be clearly labelled non-secret.

Heartbeat credentials are also not recoverable from an admin GET. Recommended minimum is a
write-only credential input on create and optional replacement on edit, with `/heartbeat/<id>`
and a Bearer placeholder in usage examples. If the plan chooses generated/show-once credentials,
it must define that flow and its lifetime explicitly. Never manufacture a working old secret,
echo submitted credentials in error pages, or point heartbeat usage at a Console route.

### 4. Export, conflicts and file health

Use `GET /admin/config/export` for the effective-set download. A shadowed row's export must
come from its selected admin view with the same redaction policy; the existing bulk endpoint
deliberately excludes shadowed definitions. Preserve env references, omit literal values,
bodies and credentials, and list omitted fields. Explain that a redacted export needs operator
completion before it is a runnable `checks.json`. Never serialise keep markers as configuration.
No single-check API endpoint is assumed necessary.

Carry the revision that the person actually edited into `If-Match`. On 409/412 keep non-secret
input and offer an explicit reload/reconcile action; never fetch a fresh revision and silently
overwrite intervening changes. Use the type-the-name deletion confirmation and recheck source
and current permissions before the outbound mutation. Handle a file reload shadowing a check
while its edit/delete page is open.

Show invalid/unreadable/written-not-applied file status, safe API message and last applied time
without disabling healthy database editing. Preserve the last applied effective file view.
Do not make file repair, file upload, or editing a file-owned check through the Console part of
this spec. Component/window storage and editing remain their separate work items.

### 5. Integration and request boundaries

View routes are Viewer+, create/edit/export Member+, delete Admin+; enforce this on the server
for direct requests too. Continue existing session, Origin, content type, repeated-field, CSRF,
single-use form-token, raw-path, escaping, cookie and CSP behavior. Route representation is a
plan choice; query-selected ids can fit the current exact-path dispatcher. User-controlled ids
must be encoded as data, never concatenated into an unvalidated API path.

Plan a bounded form size for check editing: an HTTP body alone may be 65,536 bytes, in addition
to headers/assertions and URL-encoding overhead, whereas current forms allow only 8192 bytes.
Either a route-specific limit or another bounded representation must carry valid contract
inputs without weakening unrelated account forms or the API's 1 MiB bound. Define safe field
redisplay: non-secret values survive failure; new literal/body/credential values are not echoed.

Use validated contract shapes at both HTTP edges and the configured server-side API token.
The browser gets neither that token nor a generic admin/probe proxy. Public reads do not
authenticate that token merely because a Bearer header was sent; keep an authenticated admin
read for token rejection detection as Overview does. Writes require API `admin` plus `checks`
scopes, independently of Console user roles. Distinguish missing/rejected/under-scoped token,
unreachable API, invalid/wire-incompatible response, unknown id, and validation failure.

The Console currently pins contract `176fb6e`, while the inspected contract is 2.1.0 with wire
version 1. Pin a merged main SHA providing all used shapes; do not require unrelated incident
changes in the spec. Prefer additive shapes for location history. Define a clear unsupported
API state for older deployments without #565/location-history support, retaining setup and
Overview compatibility rather than treating absent source data as permission to write files.

Successful writes already have API-token audit entries. #460 also requires human attribution
in the Console's People log using API action names. The plan must define how check actions are
recorded and how an API failure or an ambiguous timeout is represented; do not add a fake
“on behalf of” API field or claim a local SQLite transaction atomically commits a remote write.
No credentials, literal headers or bodies go into either log.

### 6. Target boundaries and dependencies

Expected implementation scope: Console, plus contract then API for genuine per-location uptime
data, with Console depending on those merged interfaces. Probe requires no MVP change.
Status/notify do not need a new paused state or contract migration here. Assess deploy only for
a concrete stack/browser integration test or compatibility adjustment after inspecting its
current harness; do not move image pins or assume unmerged work. Existing #565, #718 and #564
foundations are already on the reviewed main snapshots. Recheck main in planning; record any
new prerequisite using native blocked-by metadata through the Factory workflow if needed.

No new runtime package is needed: use current server-rendered HTML, forms and same-origin
script/style. Playwright and axe are already approved and installed as test dependencies in
Console. Update affected operator docs in the implementation targets; do not build the deferred
features just to match older design text.

## Derived acceptance check

Done when a signed-in operator can find and inspect effective and shadowed checks, create and
edit each existing type, preserve write-only settings, export safely, and delete only permitted
database definitions, with accurate historical location data and the existing authorization
and error states. Required checks for the narrowed feature:

| Check | Observable acceptance |
| --- | --- |
| List and filters | Fixtures include all six types, all five live states, file/database sources and a shadowed duplicate. Text/type/state/source filters compose and round-trip in the URL; reset, empty installation and no-match states work. Shadowed rows are not counted as extra live checks. |
| Detail | Known effective id displays state, stale latest results per location, aggregate uptime, recent paged results and optional SLO. Unknown id gets 404. Selecting a shadowed definition shows its own settings without attributing the file version's runtime data to it. |
| Real per-location uptime | Seed two locations with different known success/down histories, including more rows than a recent-results page, an empty window and a boundary timestamp. API values, counts, period and rendered percentages agree with the specified full-window calculation. Test null versus zero, degraded samples, retention boundaries and freshness independently. Existing aggregate uptime/SLO responses retain their meaning. |
| Latency and SLO | HTTP daily p50/p95 and latest per-location latency render from API values; non-HTTP/heartbeat unsupported measurements show an appropriate empty/not-applicable state. SLO absence, null observations and negative budget are distinguishable. |
| Create/edit all six | Parameterised HTTP tests plus browser flows save valid HTTP, TLS, TCP, DNS, domain and heartbeat inputs and reopen them. Required fields, units, bounds and cross-field errors are checked; wrong-type fields are not sent. Include POST/HEAD/body/assertion rules, DNS expected/resolver values, domain minimum interval and heartbeat grace. |
| Write-only preservation | Start with stored literal header, env reference, body and heartbeat credential. An unrelated edit preserves them; explicit replace/remove changes only the requested values. HTML, redirects, browser API responses and logs contain no stored literal/body/secret values or Console API token. Reference names and the host-binding instruction remain usable. |
| Source and file health | File checks cannot be mutated; shadowed entries permit only export and authorized delete. A file collision introduced after opening an edit produces a safe conflict. Invalid/unreadable file banners retain last-good data and do not stop database writes. |
| Concurrency and delete | Two edits based on one revision cannot silently overwrite each other; 409/412 preserves safe input. Wrong typed-name confirmation does nothing. Deleting a shadowed database row leaves its file counterpart running; deleting an unshadowed database check follows existing API history/incident semantics. |
| Export | Member+ downloads the effective redacted document; selected shadowed export contains the database definition, not the file definition. Env names survive, removed fields are listed, and secrets/body/keep markers are absent. Viewer export and file mutation attempts are denied server-side. |
| Roles and forms | Allowed and denied direct-route tests cover Viewer reads, Member create/edit/export and Admin delete, with higher roles inherited. Forged role/source/id/revision, missing CSRF, disallowed Origin and replayed form token never bypass the existing guards. Session/role checks precede outbound mutations. |
| API failures | Bounded reads/writes, timeout/network/status failure, rejected or under-scoped token, missing/mismatched wire header, invalid JSON/shape, old API, 422 field errors and 404 all render through shared states. No automatic retry commits an uncertain mutation a second time. |
| Form capacity | A valid large HTTP body can be submitted within the chosen bound; an oversized form is refused before an API mutation. Unrelated forms retain their existing bounds. |
| Browser behavior | Extend the existing Chromium harness with real check routes and a fake API: six-type create/edit, filtering, detail, export, conflict recovery and typed delete. Run with JavaScript enabled and disabled; verify labels, focus, keyboard operation, textual status and axe/CSP checks. Checks remain usable at 390 px, while detailed editing is desktop-first per #460. |
| Integration and regression | An HTTP integration scenario uses a real API and temporary database/file: create, reopen, update, collision, export and delete, verifying probe visibility and existing audit behavior. Run changed targets' `bun run check`, Console `bun run check:browser`, and any specifically added deploy scenario. Record user-visible manual exercise during implementation. |

New screen behavior and new location-history contract/API tests must fail on the reviewed main
for the relevant missing behavior, then pass after implementation. Existing source precedence,
keep-marker, persistence, heartbeat and TLS tests are regression coverage, not falsely reported
as new failing tests. Deferred pause/dry-run/`/fail`/TLS-chain tests belong to their later issues.

## Review validation

This state performed read-only repository and GitHub inspection and wrote only this artifact.
No product tests were run or claimed: implementation and browser validation belong to build
states. Initial searches included the not-yet-created work directory and a nonexistent Console
`public/` directory; subsequent searches used existing paths. A read of nonexistent API
`src/uptime.ts` was corrected by locating uptime implementation in `src/service.ts` and
`src/uptime-rollup.ts`. No unresolved tool failure blocks this review.
