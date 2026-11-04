# Spec #718: console app shell, navigation, shared UI states and confirmations

Item A of the console MVP in #460 (amendment of 2 November, sections 13, 14, 15 and the
rendering decision). It gives every later console screen (#564, #566, #567, #569, #572 and the
activity log) one frame, one set of state components and two confirmation pages, so no screen
invents its own layout, error page or dialog.

Sources read for this spec: issue #718 and its comments, `.factory/work/718/issue-review.md`,
the #460 amendment, the owner-confirmed role matrix of #564
(issuecomment-6637789309), the #694 referrer decision, `docs/approved-packages.md`, and the
clones `console` at `edefdbe`, `contract` at `176fb6e`, `api` at `2bc5910`, `status` at
`d268b5b`, `config` at `bc87049` and `deploy` (`e2e/console-setup.sh`). Shared findings: none
(`gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/718` answered HTTP 404).

## Goal

A signed-in user lands on an Overview page inside a shared shell. The shell, the Overview and
ten shared state components are reusable modules of pulse-console. Each state renders from its
own test-only route, the two confirmation pages work with JavaScript off, and a Chromium test at
390 px proves there is no horizontal scroll on sign-in, the shell, the Overview and the states.

## Scope

Only pulse-console changes. The meta repository changes `docs/approved-packages.md` in this spec
pull request (see "Dev tooling decision"); no child issue is opened for meta.

- App shell for every signed-in page: header (instance name, signed-in user, role, sign out), a
  main navigation from an ordered registry, a banner slot, the page body.
- A protected-page dispatcher in `src/server.ts`: one place that applies setup phase, loopback
  `Host`, session, POST order, role and then calls the page. The Overview uses it; the test
  routes use it; later screens register in it.
- Overview at `/`: a summary of `GET /checks` from pulse-api, with the token checked through
  `GET /admin/config`.
- Shared states, one renderer each (list in "Required behavior" 4).
- Busy submit button: server-rendered pending variant, plus a same-origin `/console.js`
  progressive enhancement that disables the button while the request runs.
- Typed-name and plain confirmation pages, with a pure typed-name check.
- Test-only routes under `/__test/`, registered only by a test-created server.
- Chromium tests (Playwright library API and axe) in a new CI job `browser`.

## Non-goals

- No change to setup, sign-in, sessions, cookies, the CSRF rules, the CSP or the referrer
  policy. The sign-in page HTML stays as it is; only a CSS change is allowed if the 390 px check
  needs it.
- No role migration and no change of `User.role` (`"owner"` only, `src/account-store.ts:14`,
  `src/database.ts:28`). The four-role type added here is a presentation and route-guard type.
- No screen of #563, #564, #566, #567, #569 or #572: no Checks, Incidents, Maintenance, Tokens,
  Probes, Team, Activity or System page, no route stub for them, no session or 2FA operation.
- No contract or api change, no new overview endpoint, no polling, cache, chart or incident
  aggregate, no import from pulse-status.
- No configurable instance name, no setup field and no database column for it.
- No public demo gallery, no production environment flag that enables test routes.

## Decisions made in this spec

These close the open points of the issue review. Each one is binding for the console task.

1. **Instance name.** `pulse Console`, passed to the shell as `instanceName`, so a later setting
   can supply it. `main.ts` passes the constant.
2. **Later navigation entries.** The registry lists all ten entries in this order with a minimum
   role and an `isAvailable` flag: Overview (`/`, viewer, available), Checks, Incidents,
   Maintenance (viewer), Tokens, Probes, Team, Activity, System (admin), all nine not available.
   Only entries that are available and allowed for the role are rendered. No greyed-out text,
   no dead link. A later screen sets its flag and path in the same change that adds its route.
   The minimum roles come from the #564 matrix: "View status, checks, incidents, maintenance"
   is V+; tokens, probes, Activity log, System page and invites are A+.
3. **Roles.** `ConsoleRole = "viewer" | "member" | "admin" | "owner"`, ordered in that order.
   `hasRole(role, needed)` is true when `role` is at or above `needed`. The role of a request is
   `deps.roleOf(user)`; its default returns `user.role`. `main.ts` never sets `roleOf`. Only a
   test-created server passes another `roleOf` (from a test variable, never from a request
   field, header or cookie). Navigation visibility is never authorization: each protected route
   declares `requiredRole` and the server checks it.
4. **Overview reads.** Two reads, started together, each with its own 5000 ms timeout, so the
   page waits at most about 5000 ms for pulse-api:
   - `GET <apiUrl>/admin/config` with `Authorization: Bearer <admin token>`, validated with
     contract `validateAdminConfigSummary`. It proves the token is accepted; its content is not
     shown or counted.
   - `GET <apiUrl>/checks` without the token (a public read, api `docs/rest-api.md:42`),
     validated with contract `validateChecksResponse`. It is the only source of the counts.
   Both use contract `fetchJson` with `redirect: "manual"`, the default 5 MiB body cap and the
   wire header check, as `src/connection-test.ts:102-118` does. `apiUrl` is the saved instance
   URL (`store.instance().apiUrl`), never a request value. The token stays on the server.
   Precedence: no admin token configured (no request is sent) > failure of `/admin/config` >
   failure of `/checks` > a missing `x-pulse-contract` header on either > success. A success of
   `/checks` never shows a summary when `/admin/config` failed.
5. **Overall state.** First match wins: any `down` gives Down; else any `degraded` gives
   Degraded; else any `unknown` gives Unknown; else any `maintenance` gives Maintenance; else Up.
   Zero checks is the empty state, not Up. This deliberately differs from contract
   `combineStates` (`contract/src/components.ts:8-15`), which ranks `up` above `unknown` for
   status-page components: an operator overview must never call a check without a result
   healthy. The rule lives in the console and is not added to the contract.
6. **Busy button.** One renderer `submitButton`. Without JavaScript the form submits natively and
   the button is not disabled during the request (a known HTML limit, documented). With
   JavaScript, `/console.js` disables the clicked button and shows its busy label while the
   request runs. The server can also render the pending variant (disabled, busy text), for a
   page that shows a running operation. `script-src 'self'` already allows `/console.js`; the
   CSP does not change. This follows the issue text ("disabled while the request runs, works
   without JavaScript"); the issue review's alternative (no script) would not meet "disabled
   while the request runs".
7. **Confirmations are pages, not modals.** A GET renders a page with heading, consequence text,
   a POST form and a Cancel link. The typed name is checked on the server against the name the
   route reads from its own data at POST time. Rule: `typed.trim().normalize("NFC") ===
   expected.normalize("NFC")`; case-sensitive; inner whitespace counts.
8. **Session expiry on protected routes.** GET or HEAD without a live session answers `303` to
   `/sign-in?next=<encodeURIComponent(target)>`, where `target` is the raw request target (path
   and query) when it passes `safeNext` (`src/request-guard.ts:48-52`), else `/`. For `/` this is
   exactly today's `/sign-in?next=%2F` (`src/server.ts:248`). A POST without a live session
   answers the same `303` without reading the body and without running the action; after
   sign-in the browser GETs the page again, so a mutation is never replayed. The sign-in page
   with its existing `Your session has expired.` notice (`src/server.ts:94`, `:317-324`) is the
   "session expired" component; it is not changed.
9. **404 inside the shell.** An unknown path answers the shell 404 page (HTML, status 404) only
   when the method is GET or HEAD, setup is complete, the loopback `Host` rule passes and the
   request has a live session. Every other unknown-path request keeps today's `404`
   `not found\n` plain text (`src/server.ts:627-629`), so raw-path cases such as `//healthz`
   and `/%2e%2e/` without a session answer exactly as today.
10. **Test routes.** Namespace `/__test/`. `ConsoleServerDeps.testRoutes?: ReadonlyMap<string,
    ProtectedRoute>` defaults to none. `createConsoleServer` throws an `Error` subclass when a key
    does not start with `/__test/` or equals a production route. The fixture implementations
    live in `test/` (outside `src/`, so `Dockerfile:12` never copies them and `.dockerignore`
    lines 9-10 exclude `test`), never in `src/`.

## Dev tooling decision

The Chromium test uses `playwright` `1.64.1` (library API) and `@axe-core/playwright` `4.14.0`,
as pulse-status does (`status/package.json:22`, `:28`). Both were approved for tests only, but
their rows named only pulse-website and pulse-status. This spec pull request extends those two
rows of `docs/approved-packages.md` to pulse-console (same versions, dev dependency, never in
the image). Merging the spec approves that. No runtime dependency is added. The CI job uses only
`actions/checkout@3d3c42e…` and `oven-sh/setup-bun@0c5077e…`, which the pinned action policy
allows for every target (`pulse-config/actions-policy.json:4-13` at
`04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`).

## Required behavior

### 1. Routing and order

Protected routes are `/` and every key of `testRoutes`. For them the server applies, in order:

1. route and method: unknown path as in Decision 9; another method `405` with `allow`;
2. phase: before setup, GET or HEAD `303` to `/setup`, POST `404`;
3. loopback `Host` (`421`), unchanged;
4. session: as in Decision 8;
5. POST only: the existing order of `readPostForm` (`src/server.ts:341-368`) with the
   session's CSRF token: Origin `403`, content type `415`, body over 8192 bytes `413`, repeated
   known field `400`, CSRF `403`;
6. role: `hasRole(roleOf(user), route.requiredRole)` false gives the shell 403 page;
7. the route's handler.

The role check after the CSRF check keeps "CSRF before any other check of the form" and tells a
cross-site POST nothing. `/sign-in`, `/sign-out`, `/setup`, `/setup/owner`, `/console.css` and
the ops routes keep their code paths unchanged. A page result is rendered inside the shell with
the existing security headers and `cache-control: no-store` (`src/server.ts:57-62`, `:172-178`).

### 2. Shell (`src/shell.ts`)

`shellPage(view)` takes `instanceName`, the user's `name` and `email`, `role`, the session CSRF
token, the current navigation id (or none), an optional banner (HTML from a state renderer), the
page title and the body. It renders:

- a "Skip to content" link as the first focusable element, targeting `#main`;
- `<header>` with the instance name, `Signed in as <name> (<email>)` (this text stays: deploy
  `e2e/console-setup.sh:143` greps `Signed in as`), `Role: <Owner|Admin|Member|Viewer>`, and the
  existing sign-out form (`POST /sign-out`, hidden `csrf`);
- `<nav aria-label="Main">` with a list of the visible registry entries; the current entry has
  `aria-current="page"`;
- the banner slot, then `<main id="main">` with one `<h1>`;
- `<script src="/console.js" defer></script>` in the head; no inline script or style.

Every value goes through kit `escapeHtml`. The document head and the field helpers move from
`src/pages.ts` to `src/html.ts` so pages, shell, states and confirmations share them; setup and
sign-in output stays byte-identical (existing tests stay green unchanged).

### 3. Overview (`/`)

- Page title `Overview`, navigation current `overview`, status `200` in every presentation state
  (deploy `e2e/console-setup.sh` step 8 expects `200`).
- The page keeps the line `pulse-api: <origin of the saved API URL>` (asserted today in
  `src/server.sign-in.test.ts:389`).
- Success with at least one check: the overall state line and a list of the five counts in this
  order with their text labels: Down, Degraded, Unknown, Maintenance, Up, then `Total`. Each
  count shows even when it is 0. Fixed overall texts:
  - Down: `Overall state: Down. At least one check is down.`
  - Degraded: `Overall state: Degraded. At least one check is degraded, none is down.`
  - Unknown: `Overall state: Unknown. At least one check has no result yet.`
  - Maintenance: `Overall state: Maintenance. Some checks are in maintenance, the others are up.`
  - Up: `Overall state: Up. All checks are up.`
- Zero checks: the empty state with heading `No checks yet`, text `pulse-api has no active
  checks. Add a check in pulse-api, then reload this page.` and the action link `Reload`
  (`href="/"`).
- Failures: the "pulse-api cannot be reached" state (4.3) with a `Retry` link (`href="/"`), or
  the token banner (4.4). No summary is shown then.
- No admin token configured: the unavailable state with the existing `NO_TOKEN_TEXT`
  (`src/connection-test.ts:31-32`); no request goes to pulse-api.
- Each failed read logs one `warn` `api read failed` with `call` (`config` or `checks`) and
  `kind` (and `status` for an HTTP answer); never a URL, body, header or token.

Statistic definition: the sample set is the array of one successful, validated `GET /checks`
answer of this page request. `counts[s]` is the number of elements whose `state` equals `s`, for
each of the five `CheckState` values; `Total` is the array length. Integers, no rounding, no
window, no percentiles, no merge with `/admin/config` entries.

### 4. Shared states (`src/states.ts`, `src/html.ts`)

One exported renderer each. Callers pass caller text; renderers hardcode no product meaning
beyond their own heading. Status text is never colour only: every state has a heading or a
leading word in text.

1. **Empty state** `emptyState({ title, text, action })`: heading, text, one action (link or
   button form) as the next step. Inline, the page status stays the caller's (200).
2. **Busy button** `submitButton({ label, busyLabel, name?, value?, isPending?, variant? })`:
   enabled `<button type="submit" data-busy-label="…">`; with `isPending` the button is
   `disabled` and shows `busyLabel`. Never render an initially disabled button on a form the
   user must submit. `/console.js` (Decision 6) on a form's `submit` event with a submitter that
   has `data-busy-label`: a second submit of the same form is prevented; after the current task
   (`setTimeout(…, 0)`, so the submitter's name and value are still in the form data) it sets
   `disabled` and the busy label; on `pageshow` with `persisted` it restores the label and
   enables the button. Served at `GET`/`HEAD /console.js` as `text/javascript; charset=utf-8`
   from a string constant in `src/console-script.ts`, with the security headers.
3. **pulse-api cannot be reached** `apiUnavailableState(failure, retryHref)`. `ApiFailure` is a
   console union mapped from contract `FetchJsonError` (`contract/src/client.ts:10-18`) by a pure
   function in `src/api-failure.ts`. Fixed detail texts:
   - timeout: `pulse-api did not answer within 5 seconds.`
   - network or aborted: `pulse-api cannot be reached at <origin>.`
   - HTTP 3xx: `pulse-api answered with a redirect (<status>); redirects are not followed.`
   - HTTP 403 from `/admin/config`: `The console token lacks the read or checks scope.`
   - HTTP 429: `pulse-api is throttling the console. Try again in a minute.`
   - other HTTP: `pulse-api answered <status>.`
   - wire mismatch: `pulse-api speaks wire version <label>; this console needs 1.`
   - missing header: `pulse-api sent no x-pulse-contract header.`
   - too large, invalid JSON, validation: `pulse-api sent an invalid answer.`
   Heading `pulse-api cannot be reached` for timeout, network, HTTP and redirect kinds;
   `pulse-api sent an answer the console cannot use` for wire and invalid kinds. Never an
   upstream body, exception text, token or full URL (the origin only). `src/connection-test.ts`
   keeps its texts and tests; it may import a shared `wireLabel` but its output stays the same.
4. **Token banner** `tokenRejectedBanner()`: shown in the shell banner slot for an api `401`:
   heading `pulse-api rejected the console token`, text `Set a valid token in
   PULSE_CONSOLE_ADMIN_TOKEN or PULSE_CONSOLE_ADMIN_TOKEN_FILE and restart the console.` It
   never ends the console session and never claims the console role is insufficient.
5. **403 page** `forbiddenState({ requiredRole, role })`, status `403`, inside the shell:
   heading `Access denied`, text `This page needs the <Required> role or higher. Your role is
   <Role>.`
6. **Session expired**: the existing sign-in notice plus `next` (Decision 8). No new renderer.
7. **404 page** `notFoundState()`, status `404`, inside the shell: heading `Page not found`, a
   link `Go to the overview` (`/`).
8. **Changed since you opened it** `staleState({ status: 409 | 412, detail?, reloadHref })`:
   heading `Changed since you opened it`, text `Someone changed this since you opened it. Your
   input is kept below. Reload to see the current version, then apply your change again.`, an
   optional caller detail line (for a 409 that is a duplicate or a reference, not a stale
   edit), and a `Reload` link. The caller re-renders its form with the kept non-secret values;
   password, token and recovery fields are never refilled. No automatic retry.
9. **422 field messages**: the existing `field()` pattern (`src/pages.ts:36-49`: error `span`
   with `id`, `aria-invalid="true"`, `aria-describedby`) extended to `textarea`, plus
   `formErrorSummary(errors)` at the top of the form with a link to each `#field-<name>`.
   Callers map their known api error strings to fields; there is no structured api error.
10. **Checks file is read-only** `readOnlyState()`: heading `The checks file is read-only`, text
    `pulse-api cannot save changes until its checks file is writable. Your input is kept
    below.` Only a caller that knows the write failed as read-only (api `ConfigWriteError`
    `readonly`, `api/src/admin-routes.ts:56-63`, message `checks file is read-only (<code>)`,
    `api/src/config-write.ts:113`) renders it, with status `503`. A generic `503` is state 3.

### 5. Confirmations (`src/confirm.ts`)

- `typedConfirmPage(view)`: heading, consequence text (caller), the target's display name in
  text, a field `confirm_name` labelled `Type <name> to confirm`, hidden `csrf` and `revision`,
  a submit `submitButton` (caller label), a `Cancel` link (caller href).
- `plainConfirmPage(view)`: heading, consequence text, hidden `csrf` and `revision`, submit,
  `Cancel` link.
- `isTypedNameConfirmed(typed, expected): boolean` (Decision 7).
- The expected name never comes from the form; an extra form field such as `expected` is an
  unknown field and is ignored (`src/forms.ts` `parseForm`). Errors: blank `Type the name to
  confirm.`, mismatch `The name does not match. Type <name> exactly.` (status 422, the typed
  value kept). A `revision` that differs from the target's current revision gives state 8 with
  status 409. A target that is gone gives the shell 404. GET, HEAD and Cancel never act.
- Families that later screens use (fixture parameters here, not production types): typed
  `delete-check`, `delete-incident`, `revoke-token`, `revoke-probe`, `remove-member`,
  `transfer-ownership`; plain `resolve-incident`, `delete-maintenance`, `reset-2fa`,
  `sign-out-all-sessions`, `new-recovery-codes`. The header sign-out stays the plain existing
  form without a confirmation.

### 6. Test routes (`test/fixture-routes.ts`)

Registered only by test-created servers (`src/server.*.test.ts`, `e2e/run.ts`). Each uses the
real renderers, the real shell, the real dispatcher and POST order. Fake targets and a recorder
of fake actions live in the fixture module; nothing calls pulse-api writes.

| Route | Methods | Shows |
| --- | --- | --- |
| `/__test/states/empty` | GET | empty state, 200 |
| `/__test/states/busy` | GET, POST | enabled form (fields `choice`, button `name="action" value="go"`); POST waits on a test-controlled gate, records `action`, answers 200 with `Submitted: go`; `?pending=1` renders the pending variant |
| `/__test/states/api-timeout`, `/__test/states/api-network`, `/__test/states/api-status` | GET | state 3 for timeout, network, HTTP 503; 200 |
| `/__test/states/token-rejected` | GET | state 4 in the banner slot; 200 |
| `/__test/states/forbidden` | GET | `requiredRole: "admin"`; real 403 for viewer or member |
| `/__test/states/session-expired` | GET | protected page; with an expired session the real 303 to sign-in with `next` |
| `/__test/states/not-found` | GET | state 7, 404 |
| `/__test/states/conflict-409`, `/__test/states/conflict-412` | GET, POST | form `name`, `note` (textarea), `secret` (password); POST answers 409 or 412 with state 8, `name` and `note` kept, `secret` empty |
| `/__test/states/invalid-422` | GET, POST | POST answers 422 with summary and errors next to `name` and `note` |
| `/__test/states/read-only-503` | GET, POST | POST answers 503 with state 10 and kept input |
| `/__test/confirm/typed/<family>` (6 routes) | GET, POST | typed confirmation of target `Checkout API`; `requiredRole: "admin"` |
| `/__test/confirm/plain/<family>` (5 routes) | GET, POST | plain confirmation; `requiredRole: "admin"` |
| `/__test/confirm/done` | GET | `Done: <family> <target>` after a `303` |

### 7. Mobile and accessibility

- At a 390 × 844 viewport, `document.documentElement.scrollWidth` is at most `390` on: sign-in,
  the Overview (success, empty, unreachable, token banner), and every `/__test/` page, with
  long content: user name of 100 characters (the setup maximum), an email of 254 characters
  without break opportunities, a long caller detail. Wrapping (`overflow-wrap: anywhere`, flex
  wrap) fixes width; `overflow: hidden` on page containers is not allowed.
- Desktop-first above that; shell `main` may be wider than today's `32rem`.
- Keyboard: every link, button and field is reachable with Tab in DOM order; the focus outline
  (`src/styles.ts:11`) stays visible on new controls, including nav links and the skip link.
- Every field has a `<label for>`; status is text, not colour only.

## Performance impact

None expected on `bench/budgets.json` of the api (`startup_cpu_ms`, `load_cpu_s`,
`idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `startup_wall_ms`, `p95_get_checks_ms`, `rps`,
`image_mb` and the cold and end-of-day keys): pulse-api code does not change, and the bench load
does not run the console, so the two reads per Overview page view (`GET /admin/config`,
`GET /checks`) never reach a measured run. `budgets.json` has no console section. Console side,
not budgeted: the image is unchanged in content apart from new `src/*.ts` modules (dev packages
stay out, checked by the image job); `bun test` time grows by the new server tests (a few
seconds at most). No measurement run is needed; the implementer reports the `bun run test`
duration before and after in the pull request.

## Security impact

Security impact: yes
New authenticated routes and a role guard, error texts built from upstream answers, a new same-origin script, new dev dependencies and a new CI job.

Checklist items that apply:

- **Secrets in errors, logs and responses**: the admin token never appears in HTML, `/console.js`,
  logs, `/metrics` or a fixture; upstream bodies and exception texts are never echoed; failure
  texts carry only the API origin and a status number; passwords and secret fields are never
  refilled.
- **Auth order and status codes**: the fixed order of Required behavior 1; no route acts
  without a live session; POST without a session is `303` and changes nothing; role check after
  CSRF; 403 for role, 404 for unknown paths; an api 401 or 403 never signs out the user.
- **Body and size limits**: console form bodies stay at 8192 bytes (`413`); api answers stay
  under the contract 5 MiB cap (`too-large` is "invalid answer").
- **Input validation**: typed name rule, `next` through `safeNext`, unknown form fields ignored,
  repeated fields `400`, the expected name only from server data.
- **SSRF and redirects**: requests go only to the saved API URL; `redirect: "manual"`; a 3xx is
  a failure and is not followed.
- **Dependency pins**: `playwright` `1.64.1` and `@axe-core/playwright` `4.14.0` exact, dev
  only, absent from the image; CI actions pinned by SHA under the shared policy.
- **Test-route isolation**: fixtures live outside `src/`; an ordinary server and the image
  answer 404 under `/__test/`.

The security state after review should try hostile inputs: `next` values (`//evil.example`,
`/\evil`, 513 characters, control characters), forged `expected`, `role`, `revision` fields,
cross-origin and `Origin: null` POSTs to confirmations, a POST with an expired session, an api
that redirects, answers 401/403/429/503, a 6 MiB body, invalid JSON, a wrong wire header, and
HTML in user names and upstream status contexts.

## Rollout order

One repository: only pulse-console changes. It keeps the contract pin `176fb6e` (already
contract `main`) and needs no api change. pulse-deploy's `e2e/console-setup.sh` keeps working:
`GET /` still answers `200` with `Signed in as` after sign-in, and an api failure renders inside
that `200` page. Older pulse-api releases keep working: `validateAdminConfigSummary` accepts 1.x
and 2.0.0 answers (`contract/src/validate-admin.ts:141-147`) and `GET /checks` is unchanged.

Integration with in-flight work: #563 (2FA, sessions) and #564 (roles) may land before this
child. If #563 is on main first, the dispatcher's session step uses its "fully signed in" check,
so a session waiting for TOTP never reaches a shell page. If #564 is on main first, the role
comes from its stored role and `roleOf`'s default reads it; the navigation minimum roles stay as
in Decision 2. Neither is redone here.

## Counterexamples

| Rule | Input | Must give | A wrong implementation gives |
| --- | --- | --- | --- |
| Overall state | `[up, unknown]` | Unknown | Up (contract `combineStates`) |
| Overall state | `[maintenance, unknown]` | Unknown | Maintenance |
| Overall state | `[up, maintenance]` | Maintenance | Up |
| Overall state | `[maintenance, maintenance]` | Maintenance | Unknown |
| Overall state | `[degraded, down, up]` | Down | Degraded |
| Overall state | `[]` | empty state `No checks yet` | `Overall state: Up` |
| Counts | `[down, down, up]` | Down 2, Degraded 0, Unknown 0, Maintenance 0, Up 1, Total 3 | zero counts left out |
| Precedence | `/admin/config` 401, `/checks` 200 | token banner, no summary | a healthy summary |
| Precedence | `/admin/config` 200, `/checks` timeout | `pulse-api did not answer within 5 seconds.` | partial summary |
| Precedence | `/admin/config` 403 | `The console token lacks the read or checks scope.`, status 200, session kept | console 403 page or sign-out |
| Redirect | `/checks` answers `302` to a second server | redirect text; the second server gets 0 requests | the redirect is followed |
| Read-only | `/checks` answers `503` | `pulse-api answered 503.` | `The checks file is read-only` |
| Wire | `/checks` 200 without `x-pulse-contract` | `pulse-api sent no x-pulse-contract header.` | a summary |
| Body cap | 6 MiB body | `pulse-api sent an invalid answer.` | memory growth or a summary |
| Typed name | expected `api`, typed `API` | 422, not executed | executed |
| Typed name | expected `api`, typed ` api ` | executed | 422 |
| Typed name | expected `my  check`, typed `my check` | 422 | executed |
| Typed name | blank | 422 `Type the name to confirm.` | executed |
| Typed name | `confirm_name=x&expected=x` | 422 (the forged field is ignored) | executed |
| Revision | target renamed after GET, POST with old `revision` | 409 with state 8, typed value kept | executed, or 500 |
| Role | GET with role viewer, `requiredRole` admin | 403 `This page needs the Admin role or higher. Your role is Viewer.` | 200 because the link is hidden |
| Role change | role admin at GET, viewer at POST | 403, 0 fake actions | executed |
| CSRF | POST with a missing or wrong `csrf` | 403 `Request refused`, 0 actions | executed |
| Origin | POST with `Origin: null` or another origin | 403, 0 actions | executed |
| Expired POST | POST to a confirmation with an expired session | 303 to `/sign-in?next=…`, 0 actions, also after sign-in | action replayed |
| `next` | target `/__test/states/session-expired?x=1` | `next` kept, sign-in redirects back there | `/` |
| `next` | target longer than 512 characters | `next=%2F` | the long target |
| `next` for `/` | GET `/` without session | `Location: /sign-in?next=%2F` (unchanged) | another encoding |
| 404 | GET `/nope` with a session | 404 HTML inside the shell | plain text |
| 404 | GET `/nope` without a session | `404` `not found\n` plain | redirect to sign-in |
| 404 | raw `GET //healthz` without a session | `404` plain (unchanged) | 200 ops answer |
| Isolation | `GET /__test/states/empty` on a server without `testRoutes`, and in the image | 404 | 200 |
| Registry | `testRoutes` key `/checks` | `createConsoleServer` throws | a public route |
| Busy, JS on | click submit, gate held | button disabled with busy label while pending; `action=go` recorded once | `action` missing (disabled too early) |
| Busy, JS on | second submit while pending | still 1 recorded submission | 2 |
| Busy, JS off | submit | 200 `Submitted: go` | blocked by a disabled button |
| Mobile | 254-character email at 390 px | `scrollWidth` ≤ 390 | 600 |
| Secret field | 409 after POST with `secret=s3cret-sentinel` | the response does not contain `s3cret-sentinel` | the secret refilled |

## Contract fields

No contract field, key or wire name is new or renamed; the console reads existing contract
exports only (`fetchJson`, `validateChecksResponse`, `validateAdminConfigSummary`,
`WIRE_VERSION`, `WIRE_VERSION_HEADER`, types `CheckState`, `ChecksResponse`, `FetchJsonError`).
New console-local names (routes, form fields, deps, types) and the search that shows no
collision in the contract, config and console clones:

```sh
for n in '__test' 'console.js' 'confirm_name' 'ConsoleRole' 'check:browser' 'roleOf' 'testRoutes' 'ProtectedRoute'; do
  grep -rn -- "$n" .repos/contract/src .repos/config/src .repos/config/bin .repos/console/src
done
# no output for any name (run on contract 176fb6e, config bc87049, console edefdbe)
```

Other new names: routes `/console.js` and the `/__test/…` paths above, form field `revision`
(console-local, never sent to pulse-api), log message `api read failed`, metrics path label
`/console.js`, npm script `check:browser`, CI job `browser`.

## Repository: console

Files:
- `src/server.ts` (protected-route dispatcher, Overview at `/`, shell 404, `/console.js`,
  `testRoutes` and `roleOf` deps)
- `src/main.ts` (passes `instanceName`; still no `testRoutes` and no `roleOf`)
- `src/html.ts` (new: document head, `csrfField`, `field`, `textarea` field, `submitButton`,
  `formErrorSummary`, moved from `src/pages.ts`)
- `src/pages.ts` (setup and sign-in pages import from `src/html.ts`; `landingPage` removed)
- `src/shell.ts` (new)
- `src/navigation.ts` (new: registry, `visibleNavigation`)
- `src/roles.ts` (new: `ConsoleRole`, `hasRole`, role labels)
- `src/protected-route.ts` (new: `ProtectedRoute`, `PageRequest`, `PageResult` types)
- `src/states.ts` (new: the state renderers)
- `src/api-failure.ts` (new: `ApiFailure`, mapping from `FetchJsonError`, texts)
- `src/overview.ts` (new: pure summary and overall state, Overview body)
- `src/overview-read.ts` (new: the two pulse-api reads)
- `src/confirm.ts` (new: confirmation pages, `isTypedNameConfirmed`)
- `src/console-script.ts` (new: `CONSOLE_JS`)
- `src/styles.ts` (shell, nav, banners, states, confirmation and 390 px rules)
- `src/metrics.ts` (`PathLabel` adds `/console.js`)
- `src/connection-test.ts` (only if `wireLabel` moves to `src/api-failure.ts`; texts unchanged)
- `src/html.test.ts`, `src/shell.test.ts`, `src/navigation.test.ts`, `src/roles.test.ts`,
  `src/states.test.ts`, `src/api-failure.test.ts`, `src/overview.test.ts`,
  `src/overview-read.test.ts`, `src/confirm.test.ts` (new)
- `src/server.overview.test.ts`, `src/server.states.test.ts`, `src/server.confirm.test.ts`
  (new); `src/server.test.ts`, `src/server.sign-in.test.ts`, `src/server.security.test.ts`,
  `src/main.startup.test.ts` (extended; existing assertions stay)
- `test/fixture-routes.ts`, `test/fake-api.ts` (new, test only)
- `e2e/run.ts`, `e2e/tsconfig.json` (new, Chromium checks)
- `package.json`, `bun.lock` (dev dependencies, `check:browser`, `typecheck` with `-p e2e`)
- `tsconfig.json` (`include` adds `test`)
- `.github/workflows/ci.yml` (job `browser`, image check paths, `release` needs `browser`)
- `README.md`, `docs/configuration.md`, `docs/development.md`, `AGENTS.md`

Behavior change: yes
New signed-in shell and Overview at `/`, a shell 404, `/console.js`, new renderers and a new CI job.

### Verified tool facts

- Bun `1.4.0`: `package.json:9` (`engines.bun`) and `package.json:32` (`packageManager`).
- Scripts: `package.json:13` `typecheck` runs `bun node_modules/typescript7/bin/tsc --noEmit`;
  `:14` `test` is `bun test`; `:15` `lint` is `biome check . && pulse-eslint . &&
  pulse-workflows`; `:18` `check` is lint, typecheck, test. Biome `2.6.3` at `package.json:21`,
  TypeScript `npm:typescript@7.0.2` at `:26`.
- `bunfig.toml:2-4`: coverage on, line threshold `0.8`, `coveragePathIgnorePatterns` includes
  `test/**` and `**/test/**`, so `test/` fixtures do not count toward coverage.
- `tsconfig.json:3` includes only `src`; it extends `@lorenzh/pulse-config/tsconfig.base.json`
  (pin `04108fa…`, `tsconfig.base.json:6` `lib: ["esnext"]`, same as the config clone). The
  shared ESLint config at the pin uses `projectService: true` for `**/*.ts`
  (`eslint.config.js:19-23`, identical to the clone), so `test/` must be added to
  `tsconfig.json` and `e2e/` needs its own `e2e/tsconfig.json` (with `lib: ["esnext", "dom"]`,
  as `status/e2e/tsconfig.json:3`), or lint fails on those files.
- `biome.json` extends `@lorenzh/pulse-config/biome.json`; at pin `04108fa…` (identical to the
  clone) `files.includes` is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`,
  `test/fixtures` (lines 10-17), so `test/` and `e2e/` are linted and formatted; the override at
  lines 53-63 turns off `noNonNullAssertion` only for `**/*.test.ts` and `**/test/**`, so
  `e2e/run.ts` must not use `!`.
- CI: `.github/workflows/ci.yml:18` calls `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`;
  that file at the pin (identical to the clone) runs install, `bun run lint`, `bun run
  typecheck`, `bun run test` (lines 25-38). It does not run browsers. The `docker` job's dev-path
  loop is at `ci.yml:42`; `release` needs `[check, docker]` at `ci.yml:159`.
- Image: `Dockerfile:5` installs with `--production`; `Dockerfile:12` copies only `src`.

### Behavior

Implement "Decisions made in this spec" and "Required behavior" 1 to 7 as written. Specifics for
this repository:

- `ConsoleServerDeps` gains `instanceName: string`, `testRoutes?:
  ReadonlyMap<string, ProtectedRoute> | undefined` and `roleOf?: ((user: User) => ConsoleRole)
  | undefined`. Existing deps (`fetch`, `schedule`, `now`) feed the Overview reads, so tests use
  a fake `schedule` for the timeout, no real timer.
- `ROUTES` (`src/server.ts:70-77`) adds `/console.js` (`GET`, `HEAD`); `/` keeps `GET`, `HEAD`.
  `pathLabel` and `PathLabel` add `/console.js`; `/__test/*` counts as `other`.
- Module size: one responsibility per module (AGENTS.md "Code design"); cognitive complexity at
  most 15 per function (shared lint).
- `e2e/run.ts` is a plain Bun script (`bun e2e/run.ts`, not `*.test.ts`, so `bun test` does not
  pick it up). It starts the fake api and a console server with `testRoutes`, a `mkdtemp`
  database with a completed setup, signs in through the real form, and drives Chromium at
  390 × 844 and 1280 × 800, with one context `javaScriptEnabled: false` and one with JavaScript.
  It exits non-zero on the first failed assertion and prints `ok:` per check.
- CI job `browser` on `ubuntu-24.04`, `timeout-minutes: 15`, `permissions: contents: read`:
  checkout (`persist-credentials: false`), setup-bun `1.4.0`, `bun install --frozen-lockfile`,
  `bunx playwright install --with-deps chromium`, `bun run check:browser` (as
  `status/.github/workflows/ci.yml:51-68`). `release.needs` becomes `[check, docker, browser]`.
  The `docker` dev-path loop adds `/app/node_modules/playwright`,
  `/app/node_modules/@axe-core`, `/app/test` and `/app/e2e`, and a new step checks that
  `GET /__test/states/empty` on the running container answers `404`.
- Docs: README "What works now" and the endpoint table (`/`, `/console.js`, unknown path signed
  in); `docs/configuration.md` HTTP routes (protected-route order, Overview reads, the log line,
  the `/console.js` path label, the no-JS busy limit); `docs/development.md` code layout, the
  `test/` and `e2e/` folders, `bun run check:browser`, the `browser` job and the image check;
  `AGENTS.md` "This repository" (new modules; scripts limited to `/console.js`), commands
  (`bun run check:browser`) and replace the rule "Test helpers stay inside the `*.test.ts` file"
  (`docs/development.md:48`) with the `test/` folder rule.

### Checks

Every expected value below is a literal written in this spec or in the test.

1. `bun run check` passes (lint, typecheck including `-p e2e`, tests, coverage ≥ 80 % lines).
2. `src/overview.test.ts`: the overall-state and count rows of Counterexamples, as literals.
3. `src/navigation.test.ts`: table over the four roles: with today's registry every role sees
   exactly `["Overview"]`; with a registry whose entries are all marked available, viewer and
   member see `Overview, Checks, Incidents, Maintenance`, admin and owner see all ten in the
   order of Decision 2; no unavailable entry renders an `<a>`.
4. `src/server.overview.test.ts` (real server, fake api on `127.0.0.1:0`): success, mixed,
   all unknown, all maintenance, empty; timeout (fake `schedule`), network (closed port), 401,
   403, 429, 503, 302 (second server gets 0 requests), missing and wrong `x-pulse-contract`,
   6 MiB body, invalid JSON, invalid shape, no admin token (fake api gets 0 requests). Each
   answers `200` with the literal text of Required behavior 3 or 4.3. The fake api records that
   `/checks` had no `authorization` header and `/admin/config` had `Bearer <token>`. A sentinel
   token and a sentinel upstream body (`upstream-body-sentinel`) never appear in any response
   body or log line. A corrected fake api makes the next `GET /` show the summary.
5. `src/server.states.test.ts`: each `/__test/states/*` route answers the status in the table
   of Required behavior 6 (`200`, `403`, `404`, `409`, `412`, `422`, `503`, `303`), with its
   literal heading; 409 and 412 keep `name` and `note` and not the secret sentinel; 422 has
   `aria-invalid="true"` and `aria-describedby` pointing to an element with the error text;
   the forbidden route with viewer names `Admin` and `Viewer`; the expired-session route
   redirects to `/sign-in?next=%2F__test%2Fstates%2Fsession-expired`, and sign-in with that
   `next` lands there.
6. `src/server.confirm.test.ts`: for all 11 families, GET and HEAD record 0 actions; correct
   POST records exactly 1 action `{family, target}` and answers `303`; the typed-name,
   revision, role, CSRF, Origin and expired-session rows of Counterexamples hold.
7. `src/server.test.ts` and `src/server.security.test.ts`: a server without `testRoutes` and
   `bun src/main.ts` (`src/main.startup.test.ts`) answer `404` for `/__test/states/empty`;
   the shell 404, `/console.js`, Overview and every fixture response carry the exact CSP string
   of `src/server.ts:54-55`, `referrer-policy: same-origin`, `x-frame-options: DENY`,
   `x-content-type-options: nosniff`, `cache-control: no-store`; no response body holds
   `<script>` without `src` or a `style=` attribute.
8. `bun run check:browser` (CI job `browser`): at 390 px every page of Required behavior 7 has
   `scrollWidth ≤ 390`; axe reports 0 violations for tags `wcag2a`, `wcag2aa`, `wcag21a`,
   `wcag21aa`, `wcag22aa` on sign-in, Overview, the shell 404, 403, one typed and one plain
   confirmation; with JavaScript off, a typed confirmation completes by typing `Checkout API`
   and pressing Enter, and a plain confirmation completes with Tab and Enter (recorder shows 1
   action each), and the busy form submits (`Submitted: go`); with JavaScript on, the busy
   button is `disabled` and shows its busy label while the gate is held, and `action=go` is
   recorded once after two clicks; Tab from the top reaches the skip link first, then the sign-out
   button and the Overview link, each with a computed `outline-style` other than `none`.
9. Existing tests stay green without weakening: `src/server.setup.test.ts`,
   `src/server.sign-in.test.ts` (including `Signed in as Owner &lt;Sentinel&gt;`, the API
   origin and `action="/sign-out"` on `/`), and the setup texts of
   `src/connection-test.test.ts`.
10. CI `docker` job: the extended dev-path loop passes and `/__test/states/empty` answers `404`
    in the container.
11. Manual smoke (AGENTS.md "End-to-end checks"): `PULSE_API_URL=http://localhost:3000 bun start`
    against a local pulse-api, set up, sign in, see the Overview, stop pulse-api, reload, see
    `pulse-api cannot be reached`; the pull request reports the commands and results.

### Completion evidence

The pull request lists: `bun run check` output summary (tests, coverage), `bun run
check:browser` output (`ok:` lines), the green CI jobs `check`, `docker` (both legs) and
`browser`, the manual smoke commands and results, `bun run test` duration before and after, and
the known limit that without JavaScript a submit button is not disabled during the request.
