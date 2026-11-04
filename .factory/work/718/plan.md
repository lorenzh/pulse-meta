# Spec #718: console app shell, navigation, shared UI states and confirmations

Item A of the console MVP in #460 (amendment of 2 November, sections 13, 14, 15 and the
rendering decision). It gives every later console screen (#564, #566, #567, #569, #572 and the
activity log) one frame, one set of state components and two confirmation pages, so no screen
invents its own layout, error page or dialog.

Sources read for this spec: issue #718 and its comments (including the owner decision of
4 November on the busy button), the #563 spec on `main` (`.factory/work/563/plan.md`, schema 2
and its access gate), `.factory/work/718/issue-review.md`,
the #460 amendment, the owner-confirmed role matrix of #564
(issuecomment-6637789309), the #694 referrer decision, `docs/approved-packages.md`, and the
clones `console` at `edefdbe`, `contract` at `176fb6e`, `api` at `2bc5910`, `status` at
`d268b5b`, `config` at `bc87049` and `deploy` (`e2e/console-setup.sh`). Shared findings: none
(`gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/718` answered HTTP 404 again
in this revision).

Revision after plan-review: the navigation registry has nine entries (eight not available);
the busy button shipped no script (replaced by the next revision, see below); the existing
test files that construct the server, including `src/server.setup.test.ts`, are listed with a
wiring-only rule; the name search in "Contract fields" covers every new name and documents the
reuse of `revision` and `wireLabel`.

Revision after the owner review of spec PR #719 (comment of 4 November on #718, "Decision ... the
busy button is a progressive enhancement"): the review found that the earlier Decision 6
deferred the busy button. That PR was closed and this spec restarts on a fresh branch from the
same content (`issue-review.md`, this file, `targets.json` and the `docs/approved-packages.md`
rows were taken over from PR #719 head `280896c`). Decision 6 now follows the owner decision:
one same-origin script file `/console.js` disables the submit buttons of a form on submit
(with JavaScript), every form works without it, and a new single-use form token (Decision 11)
stops a double submission on the server in both cases. No other script use is added.

Revision after the plan-review of 4 November (P2): the owner decision says every state-changing
form carries a single-use form token and a replay gets the shared "already submitted" answer.
The earlier Decision 11 left out setup, sign-in and sign-out. Those exemptions are removed.
`/setup`, `/setup/owner`, `/sign-in` and `/sign-out` now carry `form_token`. These routes keep
the order and status of every refused request. They use the token at their commit point,
directly before their first state change (Decision 11, Required behavior 1a). A replay answers
`409` `Already submitted`. The rules for setup and sign-in HTML and for existing tests are
rewritten to allow exactly this change (one hidden field, a token in test request bodies, no
changed `expect`). pulse-deploy's `e2e/console-setup.sh` posts these forms, and deploy's `dev`
job builds console `main`, so deploy now has its own section and merges first.

## Goal

A signed-in user lands on an Overview page inside a shared shell. The shell, the Overview and
the ten shared states of the issue (plus the "already submitted" state of the form token) are
reusable modules of pulse-console. Each state renders from its own test-only route, the two
confirmation pages work with JavaScript off, a submitted form cannot take effect twice, and a
Chromium test at 390 px proves there is no horizontal scroll on sign-in, the shell, the Overview
and the states.

## Scope

pulse-console changes, and pulse-deploy's e2e script sends the new form field. The meta
repository changes `docs/approved-packages.md` in this spec pull request (see "Dev tooling
decision"); no child issue is opened for meta.

- App shell for every signed-in page: header (instance name, signed-in user, role, sign out), a
  main navigation from an ordered registry, a banner slot, the page body.
- A protected-page dispatcher in `src/server.ts`: one place that applies setup phase, loopback
  `Host`, session, POST order, role and then calls the page. The Overview uses it; the test
  routes use it; later screens register in it.
- Overview at `/`: a summary of `GET /checks` from pulse-api, with the token checked through
  `GET /admin/config`.
- Shared states, one renderer each (list in "Required behavior" 4).
- Busy submit button as a progressive enhancement (Decision 6): one renderer, one same-origin
  script file `/console.js` for all shell pages, and a single-use form token checked by the
  dispatcher on every protected POST (Decision 11).
- Typed-name and plain confirmation pages, with a pure typed-name check.
- Test-only routes under `/__test/`, registered only by a test-created server.
- Chromium tests (Playwright library API and axe) in a new CI job `browser`.

## Non-goals

- No change to the setup and sign-in flows, sessions, cookies, the CSRF rules, the CSP or the
  referrer policy. The one change to setup, sign-in and sign-out is the single-use form token
  that the owner decision of 4 November requires (Decision 11, Required behavior 1a): one hidden
  field in each form, and one check before the first state change. Apart from that field, the
  setup and sign-in page HTML stays as it is. A CSS change is allowed if the 390 px check needs
  it.
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
2. **Later navigation entries.** The registry lists all nine entries of the issue in this order
   with a minimum role and an `isAvailable` flag: Overview (`/`, viewer, available), Checks,
   Incidents, Maintenance (viewer), Tokens, Probes, Team, Activity, System (admin); the eight
   entries after Overview are not available.
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
6. **Busy button as a progressive enhancement** (owner decision of 4 November on #718; it
   extends the #460 script rule, which allowed scripts only for copy buttons and the preview,
   by exactly this one use).
   - Markup: `submitButton` renders `<button type="submit" data-busy-label="<busy text>">` with
     its label, and `name` and `value` when given. It is never rendered `disabled`. There is no
     server-rendered pending variant.
   - With JavaScript: one static same-origin file, served at `GET`/`HEAD` `/console.js` with
     `content-type: text/javascript; charset=utf-8`, is the only script of the console. Every
     shell page (signed-in pages, the shell 403 and 404, the states and confirmations) loads it
     with exactly `<script src="/console.js" defer></script>` in the head; there is no inline
     script and no `on…=` attribute. The CSP stays byte-identical (`script-src 'self'`). The
     file adds one `submit` listener on `document`. For a submitted form whose `method` is
     `post`, when the event is not cancelled:
     - it marks the form busy; a later `submit` event of a busy form is cancelled with
       `preventDefault()`, so a second click or Enter sends nothing;
     - in a `setTimeout(…, 0)` callback (after the browser has built the form data set, so
       the submitter's `name` and `value` are still sent; a control that is disabled
       synchronously would be left out of the body) it sets `disabled` on every
       `button[type="submit"]` and `input[type="submit"]` of the form, sets
       `aria-busy="true"` on those buttons, and sets the text of the submitter
       (`event.submitter`, which is the default button for an Enter key submit) to its
       `data-busy-label` when it has one;
     - on `pageshow` with `event.persisted` (back/forward cache) it restores the saved labels,
       removes `disabled` and `aria-busy` and clears the busy mark, so a page restored from
       history is usable.
     The file reads no page data, sends no request, and uses no storage or cookie. Setup and
     sign-in pages do not load it and have no script element. Their only HTML change is the
     hidden `form_token` field of Decision 11.
   - Without JavaScript: every form works completely by native submit; the button is not
     disabled while the request runs. CSS never fakes a disabled look on an enabled button.
   - Double submission is stopped on the server in both cases by the form token of Decision 11,
     not by the script.
   No other script use is added (no copy button or preview here; those come with their
   screens and reuse `/console.js` or extend it under the #460 rule).
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
11. **Single-use form token on every state-changing form** (owner decision of 4 November: "every
    state-changing form carries a single-use form token next to the CSRF token"). Every form
    with `method="post"` carries a hidden field `form_token` directly after `csrf`. This covers
    every form that a protected route renders, the shell's sign-out form, and the forms of
    `/setup`, `/setup/owner` and `/sign-in`. No console POST form is exempt. The CSRF tokens do
    not change: the session CSRF token stays per session and the anonymous CSRF cookie stays as
    it is (#562; cookie rules unchanged).
    - Value: 32 bytes from `deps.randomBytes`, base64url (43 characters), as the existing
      `newToken` (`src/server.ts:196-198`).
    - Binding: each token is bound to a binding string and to the form's action path (the raw
      path the form posts to). There are two kinds of binding:
      - signed-in forms (protected routes and `/sign-out`): `s:` + `sessionDigest(sessionId)`
        (`src/account-store.ts:48-50`);
      - pre-session forms (`/setup`, `/setup/owner`, `/sign-in`): `a:` + the lowercase SHA-256
        hex of the anonymous CSRF token that the same page puts in its `csrf` field (the
        value from `ensureCsrf`, `src/server.ts:205-211`).
      A page issues one token per form at render time (`request.issueFormToken(actionPath)` on
      protected routes; the server's own pages issue in the same way). For a `HEAD` request it
      returns an empty string and stores nothing, because the body is not sent.
    - Store: in memory in the server state (`src/form-tokens.ts`, created once per
      `createConsoleServer`), with `now` injected. No database table and no schema change, so
      it does not collide with the schema 2 of #563. Each entry holds the token, the binding,
      the path, `issuedAt` and `usedAt` (or none).
    - Lifetime: `FORM_TOKEN_LIFETIME_MS = 43_200_000` (12 hours) from `issuedAt`. An entry with
      `now >= issuedAt + 43_200_000` is invalid and is removed (on each `issue`, `consume` and
      `wasUsed`). A used entry stays until its lifetime ends, so a replay within that time is
      recognised.
    - Bounds:
      - at most 100 unused tokens per binding: issuing the 101st removes the oldest unused
        token of that binding;
      - at most 2000 entries with an `a:` binding: issuing beyond that removes the oldest `a:`
        entry. Anonymous page views can therefore never remove a signed-in token;
      - at most 10000 entries in total: issuing beyond that removes the oldest entry.
      A removed token is simply invalid; it can never be accepted.
    - Consume: `consume(token, binding, path)` runs once per POST, in one synchronous step (no
      `await` between the lookup and setting `usedAt`). So of two concurrent POSTs with one
      token, exactly one is `accepted`. Where it runs:
      - protected routes: in the dispatcher, after the CSRF and role checks and before the
        handler (Required behavior 1);
      - `/setup`, `/setup/owner`, `/sign-in`, `/sign-out`: at the commit point, after every
        existing check of the route and directly before its first state change (Required
        behavior 1a).
      Results:
      - `accepted`: the entry is marked used and the action runs;
      - `replayed`: the entry exists for this binding and path and is already used. The action
        does not run. The answer is the "already submitted" state (4.11) with status `409`;
      - `invalid`: the field is missing or empty, or the token is unknown (for example after a
        restart), expired, removed, or bound to another binding or path. The action does not
        run. The answer is the route's form again with the kept non-secret input, a fresh
        token and the expired notice, with status `409` (Required behavior 1 and 1a).
    - A token is used up when the action starts, whatever its outcome. Every answer that shows
      the form again (401, 409, 412, 422, 429, 500, 502, 503, an api failure) renders it with a
      fresh token.
    - Existing guards stay as they are. Two submits with two different tokens (two tabs) are
      not a replay; for setup the database guard still answers the second one with `409`
      `Setup is already complete` (`src/server.ts:510-513`).
    - If #563 is on `main` when the console child starts, its state-changing POST forms (for
      example `/sign-in/factor`, the enrolment, recovery-code and session forms) get the same
      field and the same commit-point check, each with a replay test. Forms that #563 adds after
      this child merges are #563's to protect under the same owner rule.
    - Logs, metrics and responses never contain a form token, except the fresh token in a
      rendered form. A refused token is logged as one `info` line `form token refused` with
      `reason` (`replayed` or `invalid`) and the route path, never the token.

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
7. POST only: the form token (Decision 11): `replayed` gives the "already submitted" state
   (`409`), `invalid` the re-rendered form with the expired notice (`409`); only `accepted`
   continues;
8. the route's handler.

The role check after the CSRF check keeps "CSRF before any other check of the form" and tells a
cross-site POST nothing. A POST refused at steps 1 to 6 does not consume its form token, so the
same token still works on a later valid POST. The dispatcher adds `csrf` and `form_token` to the
known fields of every protected POST route. `/sign-in`, `/sign-out`, `/setup` and `/setup/owner`
keep their code paths, except for the form-token step of 1a. `/console.css` and the ops routes
keep their code paths unchanged. `/console.js` is served like
`/console.css` (`GET`, `HEAD`; the loopback `Host` rule applies; no session needed, in every
phase). A page result is rendered inside the shell with
the existing security headers and `cache-control: no-store` (`src/server.ts:57-62`, `:172-178`).

### 1a. Form token on setup, sign-in and sign-out

These routes keep their order and the status of every refused request. Unchanged are: phase,
loopback `Host`, `readPostForm` (`src/server.ts:341-368`), the grant `403`, the format `422`,
throttles `429`, wrong code or credentials `401`, the connection test `502`, and the setup
database guard `409`. The form-token step comes after all of them, directly before the first
state change. So a failed attempt never uses up a token, and a repeated wrong attempt still
counts in the throttle. The token field is a known field of each route, so a repeated
`form_token` is `400` like any repeated field.

| Route | Binding | Commit point (consume runs directly before it) | `invalid` answer (`409`) | `replayed` answer (`409`) link |
| --- | --- | --- | --- | --- |
| `POST /setup` | `a:` | after the code matched (`src/server.ts:383-403`), before `gate.createGrant()` (`:406`) | the setup code form, error `This form has expired. Send it again.`, code not refilled | `Open the page again` → `/setup` |
| `POST /setup/owner`, `action=complete` | `a:` | after the grant, action, field and connection checks (`:444-480`), before `hashPassword` in `commitSetup` (`:497`) | the owner form with the kept `api_url`, `email` and `name`, message `This form has expired. Your input is kept below. Send it again.`, passwords empty | `/setup/owner` |
| `POST /setup/owner`, `action=test` | `a:` | none: a connection test changes nothing and does not use the token | — | — |
| `POST /sign-in` | `a:` | after format, throttle admission and credentials (`:542-576`), before `startSession` (`:578`) | the sign-in form with `next` kept, error `This form has expired. Send it again.` | `/sign-in` |
| `POST /sign-out` with a live session | `s:` | after the session CSRF check (`:531`), before `deleteSession` (`:533`) | a shell page titled `Sign out` with the text `This form has expired. Send it again.` (the header's sign-out form carries a fresh token) | `/` |

- Sign-in with `replayed` or `invalid`: the throttle reservation is released
  (`admission.attempt.release()`), so it counts as neither a failure nor a success. No auth
  metric is recorded and no session is started, so the second request has no `Set-Cookie`.
- Setup code with `replayed` or `invalid`: the reservation is released and no grant cookie is
  set.
- The "already submitted" answer of all four routes uses `alreadySubmittedPage(reopenHref)`. It
  is state 4.11 in the plain document of setup and sign-in, with no shell and no script element.
  This includes a `/sign-out` replay, because by then the session may already be deleted.
- `POST /sign-out` without a live session (for example the same request sent again after the
  first sign-out deleted the session and its cookie). The checks run in this order:
  1. Origin `403`, content type `415`, body over 8192 bytes `413`, repeated field `400`. There
     is no CSRF check, because no session token exists to compare.
  2. If `wasUsed(form_token, "/sign-out")` is true, the answer is `409` with the
     `alreadySubmittedPage` (link `/sign-in`). `wasUsed` checks only the token and the path,
     uses nothing up and changes nothing.
  3. Any other request answers `303` to `/sign-in` without `Set-Cookie`, as today.

  This is a deliberate change: without a session, a bad Origin answered `303` before and
  answers `403` now. In both cases nothing changes.
- After setup completes, `POST /setup` and `POST /setup/owner` still answer `404` from the
  phase rule (`src/server.ts:618-622`) before any form step. The route is closed, so a replay
  there gets `404`, as deploy `e2e/console-setup.sh:116-120` expects.
- Rendering: each of the four pages renders `formTokenField(token)` directly after
  `csrfField`. On setup and sign-in pages the HTML differs from today by exactly that one line
  `<input type="hidden" name="form_token" value="<43 characters>">`, and by the notice line
  when the answer is `invalid`.

### 2. Shell (`src/shell.ts`)

`shellPage(view)` takes `instanceName`, the user's `name` and `email`, `role`, the session CSRF
token, the current navigation id (or none), an optional banner (HTML from a state renderer), the
page title and the body. It renders:

- a "Skip to content" link as the first focusable element, targeting `#main`;
- `<header>` with the instance name, `Signed in as <name> (<email>)` (this text stays: deploy
  `e2e/console-setup.sh:143` greps `Signed in as`), `Role: <Owner|Admin|Member|Viewer>`, and the
  existing sign-out form (`POST /sign-out`, hidden `csrf` and `form_token` with an `s:`
  binding, Required behavior 1a), whose button is a `submitButton` with busy label
  `Signing out…`;
- `<nav aria-label="Main">` with a list of the visible registry entries; the current entry has
  `aria-current="page"`;
- the banner slot, then `<main id="main">` with one `<h1>`;
- the existing `/console.css` stylesheet link and exactly one script element,
  `<script src="/console.js" defer></script>` (Decision 6); no inline script, no `on…=`
  attribute, no inline style, no `style=` attribute.

Every value goes through kit `escapeHtml`. The document head and the field helpers move from
`src/pages.ts` to `src/html.ts` so pages, shell, states and confirmations share them; the head
helper takes a flag for the script element, which only the shell sets. Setup and sign-in output
has no script element. It is byte-identical to today except for the one `form_token` line of
Required behavior 1a and the expired notice of an `invalid` answer. The existing assertions
stay green; the test rule is in the Files list of the console section.

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
2. **Busy button** `submitButton({ label, busyLabel, name?, value?, variant? })` (Decision 6):
   `<button type="submit" data-busy-label="<busyLabel>">` showing `label`, with `name` and
   `value` when given; never `disabled` in the HTML. With JavaScript, `/console.js` disables it
   after submit, sets `aria-busy="true"` and shows `busyLabel` as text, so the busy state is
   text, not colour only. Without JavaScript the form submits natively. A form that uses it on
   a protected route also carries `formTokenField(token)` (hidden `form_token`, in
   `src/html.ts`) next to `csrfField`.
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
11. **Already submitted** `alreadySubmittedState({ reopenHref })`, status `409`, inside the
    shell, rendered by the dispatcher for a `replayed` form token (Decision 11): heading
    `Already submitted`, text `This form was already sent. Nothing was changed by this
    request.`, and a link `Open the page again` to `reopenHref` (the request path when the
    route allows GET, else `/`). `alreadySubmittedPage(reopenHref)` is the same state in the
    plain document for setup, sign-in and a sign-out without a session (Required behavior
    1a). The notice for an `invalid` token is the exported constant `formExpiredNotice`
    (`This form has expired. Your input is kept below. Send it again.`), shown above the
    re-rendered form like the other notices. Forms that keep no input (setup code, sign-in,
    sign-out) use `formExpiredResendNotice` (`This form has expired. Send it again.`).

### 5. Confirmations (`src/confirm.ts`)

- `typedConfirmPage(view)`: heading, consequence text (caller), the target's display name in
  text, a field `confirm_name` labelled `Type <name> to confirm`, hidden `csrf`, `form_token`
  and `revision`, a submit `submitButton` (caller label and busy label), a `Cancel` link
  (caller href).
- `plainConfirmPage(view)`: heading, consequence text, hidden `csrf`, `form_token` and
  `revision`, submit, `Cancel` link.
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
| `/__test/states/busy` | GET, POST | form (field `choice`, hidden `csrf` and `form_token`, button `name="action" value="go"`, label `Run`, busy label `Running…`); POST records `action` and `choice` in the recorder, answers 200 with `Submitted: go` and the form again with a fresh token. The fixture takes an injected `wait` before it answers (none in `bun test`; `e2e/run.ts --serve` passes a 3000 ms wait for the manual agent-browser check) |
| `/__test/states/already-submitted` | GET | state 11, 409 (render check for 390 px and axe; the real path is the replay of a busy or confirmation POST) |
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
seconds at most). The form-token store is bounded at 10000 entries of about 200 bytes each
(token, binding, path, two numbers), so at most about 2 MiB of console RSS in the worst case
(anonymous sign-in and setup page views fill at most 2000 of them) and a few KiB in normal use.
Each form page view adds one 32-byte random draw and one SHA-256 of a 43-character string; `/console.js` is a static string of well under 2 KiB. No measurement
run is needed; the implementer reports the `bun run test` duration before and after in the pull
request.

## Security impact

Security impact: yes
New authenticated routes, a role guard, a single-use form token on every POST form including setup, sign-in and sign-out, a same-origin script, error texts built from upstream answers, new dev dependencies and a new CI job.

Checklist items that apply:

- **Secrets in errors, logs and responses**: the admin token never appears in HTML, logs,
  `/metrics` or a fixture; upstream bodies and exception texts are never echoed; failure
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
- **Script scope**: the CSP stays byte-identical (`script-src 'self'`). The only script is the
  static file `/console.js`, served with `text/javascript` and `nosniff`; the only `<script`
  in any response is exactly `<script src="/console.js" defer></script>` in shell pages; no
  inline script, no `on…=` attribute, no page data in the script. Setup and sign-in pages
  have no script element.
- **Replay and double submission**: the single-use form token of Decision 11 is on every POST
  form, including setup, sign-in and sign-out. It is bound to the session digest (`s:`) or to
  the anonymous CSRF token's digest (`a:`) and to the action path. It is used up synchronously
  after CSRF and role (protected routes) or directly before the first state change (setup,
  sign-in, sign-out). It has a 12-hour lifetime and a bounded store. The token never appears in
  a log or metric. A token of another binding or path is `invalid`. CSRF protection stays the
  existing CSRF tokens; the form token adds no CSRF exemption. On sign-in the token step comes
  after the credential check and releases the throttle reservation, so a replay neither starts
  a session nor counts as a failure that could lock the owner out. The only route that reads a
  token without CSRF is a sign-out without a session: `wasUsed` changes nothing and only tells
  the holder of that token whether it was used.
- **Store flooding**: unauthenticated `GET /sign-in` and `GET /setup` issue `a:` tokens. They
  are capped at 2000 entries and never remove an `s:` entry. A flood can at worst remove an
  open anonymous form's token. That form then answers `invalid` and is shown again; a removed
  token is never accepted.

The security state after review should try hostile inputs: `next` values (`//evil.example`,
`/\evil`, 513 characters, control characters), forged `expected`, `role`, `revision` fields,
replayed, concurrent, cross-session, cross-path, expired, empty and repeated `form_token`
fields, 101 form views in one session, 2001 anonymous sign-in page views and 10001 in total,
replayed and concurrent sign-in, setup code, setup completion and sign-out POSTs, a sign-out
replay without a session cookie, a sign-in form token posted to `/setup`,
cross-origin and `Origin: null` POSTs to confirmations, a POST with an expired session, an api
that redirects, answers 401/403/429/503, a 6 MiB body, invalid JSON, a wrong wire header, and
HTML in user names and upstream status contexts.

## Rollout order

Two repositories, deploy first:

1. **pulse-deploy** merges its `e2e/console-setup.sh` change. Every POST of the script sends the
   `form_token` of the page it read `csrf` from, but only when that page has one. Deploy's
   `dev` job runs on every pull request, push and daily (`deploy/.github/workflows/ci.yml:3-10`).
   It builds console `main` (`:213-215`) and runs the script (`:225`). Today's console `main`
   renders no `form_token`, so the script sends none and runs as today. Its replay step prints
   that it was skipped. The `full` stack does not run the script (`deploy/README.md:128`), so
   no image pin moves.
2. **pulse-console** merges second (`dependsOn: deploy`). After the merge, deploy's next `dev`
   run builds the new console. The script finds `form_token` on each page, sends it, and its
   replay step expects `409`. Had console merged first, deploy's `dev` job would fail at
   step 4 (`POST /setup` without a token answers `409`, not `303`).

Older consumers: the console keeps the contract pin `176fb6e` (already contract `main`) and
needs no api change. `GET /` still answers `200` with `Signed in as` after sign-in, and an api
failure renders inside that `200` page. Older pulse-api releases keep working:
`validateAdminConfigSummary` accepts 1.x and 2.0.0 answers
(`contract/src/validate-admin.ts:141-147`), and `GET /checks` is unchanged. A browser that has a
sign-in or setup page open from before the console update posts without `form_token`. It gets
`409` with the form again and a fresh token, and the next submit works.

Integration with in-flight work: #563 (2FA, sessions) and #564 (roles) may land before this
child. If #563 is on main first, the dispatcher's session step uses its "fully signed in" check,
so a session waiting for TOTP never reaches a shell page. If #564 is on main first, the role
comes from its stored role and `roleOf`'s default reads it; the navigation minimum roles stay as
in Decision 2. Neither is redone here. The form token is in memory and adds no table, so this
child takes no schema version and cannot conflict with the schema 2 migration of #563; a
restart only makes open forms `invalid` (re-rendered with kept input). The `PathLabel` union
(`src/metrics.ts:4-14`) gains `/console.js`; #563 adds its own labels to the same union, which
is a textual merge, resolved with `factory start --workflow merge` if it conflicts. #563's
deploy child also edits `e2e/console-setup.sh` (flow detection, `two-factor` flow). If it is on
deploy `main` first, the form-token rule covers every POST of both flows. If #563 changes
`postSignIn` or `commitSetup` first, the commit point stays "directly before the first state
change" (before its session creation or its setup transaction). The form token is placed there,
not redone elsewhere.

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
| Busy, no JavaScript | GET `/__test/states/busy`, JavaScript off, press Enter on `Run` | 200 `Submitted: go`, `action=go` recorded once | blocked by an initially disabled button |
| Busy, markup | the GET answer of `/__test/states/busy` | the button has no `disabled` attribute and has `data-busy-label="Running…"` | `disabled` on load |
| Busy, JavaScript | JavaScript on, the POST held, click `Run` | button `disabled`, `aria-busy="true"`, text `Running…`; after release 1 recorded `action=go` | the button stays enabled, or `action` is missing from the body (disabled before the form data set was built) |
| Busy, JavaScript | JavaScript on, the POST held, click `Run` three times and press Enter | exactly 1 POST request and 1 recorded action | 2 or more POSTs |
| Form token | the same busy POST body (same `form_token`) sent twice in sequence | first 200 `Submitted: go`, second 409 `Already submitted`; recorder 1 | recorder 2 |
| Form token | two POSTs with one token sent at the same time | one 200 and one 409 `Already submitted`; recorder 1 | both 200 |
| Form token | POST without `form_token`, or with an empty one | 409 with `This form has expired. Your input is kept below. Send it again.`, `choice` kept, recorder 0 | executed |
| Form token | token issued to session A, POST with session B (B's valid CSRF) | 409 expired notice, recorder 0 | executed |
| Form token | token issued for `/__test/confirm/plain/reset-2fa`, POSTed to `/__test/confirm/plain/resolve-incident` | 409 expired notice, recorder 0 | executed |
| Form token | POST at `issuedAt + 43_200_000` (fake `now`) | 409 expired notice, recorder 0 | executed |
| Form token | POST at `issuedAt + 43_199_999` | accepted, recorder 1 | refused |
| Form token | 101 tokens issued in one session, then POST with the first | 409 expired notice (evicted) | accepted |
| Form token | POST with a valid token and a wrong `csrf`, then the same token with the right `csrf` | first 403 `Request refused`; second accepted, recorder 1 | second refused (token consumed by a refused POST) |
| Form token | a valid POST of the 409 stale-state fixture, then a fresh submit of the re-rendered form | second POST is not `replayed` (its form carries a new token) | `Already submitted` |
| Form token | 2001 `GET /sign-in` without cookies, then a POST with a shell form's `s:` token issued before them | `s:` token accepted; the first `a:` token `invalid` | the `s:` token evicted |
| Sign-in replay | correct sign-in POST (`csrf`, `form_token`, `email`, `password`, `next`) sent twice with the same cookies | first `303` with a session `Set-Cookie`; second `409` `Already submitted`, no `Set-Cookie`, still 1 session row | second `303` and a second session row |
| Sign-in concurrent | the same correct sign-in body twice with `Promise.all` | one `303`, one `409`; 1 session row; auth metric `result="success"` 1 | two sessions |
| Sign-in without token | correct credentials, no `form_token` | `409` with `This form has expired. Send it again.`, `next` kept, 0 session rows, no `failure` counted; then a fresh-token sign-in `303` | `303`, or a `401` that counts toward the lock |
| Sign-in failures | wrong password 5 times with one and the same `form_token` | `401` ×5 (each counted, the token is not used up), then a correct sign-in `429` | `409` after the first, or no lock |
| Sign-in binding | sign-in token issued under anonymous CSRF A, POST with CSRF cookie and field B | `409` expired notice, 0 sessions | `303` |
| Cross path | `form_token` from the `/sign-in` page posted with a correct setup code to `/setup` | `409` expired notice, no grant cookie | `303` |
| Setup code replay | correct setup code POST sent twice | first `303` with `pulse_console_setup` cookie; second `409` `Already submitted`, no `Set-Cookie` | a second grant |
| Setup complete replay | the same `action=complete` body twice with `Promise.all` | one `303`, one `409` `Already submitted`; 1 user | two commits |
| Setup complete, two tokens | two `complete` bodies with two different tokens at once | one `303`, one `409` `Setup is already complete` (database guard, unchanged) | two owners |
| Setup after completion | the completing body sent again after the `303` | `404` `not found` (phase rule) | `409` or a second owner |
| Setup test action | `action=test` twice with one token | `200` both times (not used up) | `409` |
| Sign-out replay | sign-out POST, then the same body again with the old session cookie, and again with no session cookie | `303` `/sign-in`; then `409` `Already submitted` twice; 0 session rows | `303` hides the replay, or a `500` |
| Sign-out concurrent | the same sign-out body twice with `Promise.all` | one `303`, one `409` | two `303` |
| Sign-out without session | no session, no `form_token`, valid Origin | `303` `/sign-in`, no `Set-Cookie` (unchanged) | `409` or `403` |
| Sign-out without session | no session, `Origin: http://evil.example` | `403` `Request refused` (changed from `303`; nothing changes either way) | a body read without the Origin check |
| Script scope | any console response body | `<script` appears only as `<script src="/console.js" defer></script>` and only in shell pages; no `on…=` attribute | an inline script, or a script element on sign-in or setup |
| Frozen HTML | `GET /sign-in` today and after the change, with the `form_token` line removed and the CSRF value fixed | identical bodies | any other change |
| Script route | `GET /console.js` | 200, `content-type: text/javascript; charset=utf-8`, the CSP header unchanged | 404, or `text/plain` blocked by `nosniff` |
| Mobile | 254-character email at 390 px | `scrollWidth` ≤ 390 | 600 |
| Secret field | 409 after POST with `secret=s3cret-sentinel` | the response does not contain `s3cret-sentinel` | the secret refilled |

## Contract fields

No contract field, key or wire name is new or renamed; the console reads existing contract
exports only (`fetchJson`, `validateChecksResponse`, `validateAdminConfigSummary`,
`WIRE_VERSION`, `WIRE_VERSION_HEADER`, types `CheckState`, `ChecksResponse`, `FetchJsonError`).
Every new console-local name (route prefix, form fields, deps, exported types and functions,
the log message, the npm script) and the search that shows no collision in the contract, config
and console clones. Run from the meta checkout on contract `176fb6e`, config `bc87049`, console
`edefdbe`:

```sh
for n in '__test' 'confirm_name' 'instanceName' 'ConsoleRole' 'hasRole' 'roleOf' \
  'requiredRole' 'testRoutes' 'ProtectedRoute' 'PageRequest' 'PageResult' 'ApiFailure' \
  'api read failed' 'shellPage' 'visibleNavigation' 'isAvailable' 'emptyState' \
  'submitButton' 'busyLabel' 'apiUnavailableState' 'tokenRejectedBanner' \
  'forbiddenState' 'notFoundState' 'staleState' 'formErrorSummary' 'readOnlyState' \
  'typedConfirmPage' 'plainConfirmPage' 'isTypedNameConfirmed' 'readOverview' \
  'summarizeChecks' 'overallState' 'check:browser' 'form_token' 'formTokenField' \
  'createFormTokens' 'FormTokens' 'issueFormToken' 'FORM_TOKEN_LIFETIME_MS' 'form token refused' \
  'alreadySubmittedState' 'formExpiredNotice' 'renderForm' 'CONSOLE_JS' 'console.js' \
  'data-busy-label' 'aria-busy' 'wireLabel' 'revision' 'formExpiredResendNotice' 'wasUsed' \
  'alreadySubmittedPage'; do
  printf '%s: ' "$n"
  grep -rn -- "$n" .repos/contract/src .repos/config/src .repos/config/bin .repos/console/src | wc -l
done
for n in 'form_token' 'formExpiredResendNotice' 'wasUsed' 'alreadySubmittedPage'; do
  printf '%s: ' "$n"; grep -rn -- "$n" .repos/deploy/e2e .repos/deploy/scripts | wc -l
done
```

Result (rerun in this revision with `formExpiredResendNotice`, `wasUsed` and
`alreadySubmittedPage` added; the second loop covers deploy at `e3c2eb5`, whose e2e script
gains `form_token`): `0` for every name in both loops, except two console names that are reused
on purpose:

- `wireLabel`: `2` hits, both in `console/src/connection-test.ts:40` and `:77`. It is the same
  private console function; moving it to `src/api-failure.ts` and importing it back is a move,
  not a new name. Its output stays the same.
- `revision`: `26` hits. The 17 contract hits are all the admin revision `sha256-<hex>`
  (`contract/src/revision.ts:1-7`, its imports at `admin.ts:2`, `audit.ts:2`, `index.ts:59`,
  `contract/src/admin.ts:16-19` `if-match`/`etag`, `:37` `412 stale revision`, `:53`, `:240`,
  `:255-260`, `:338`, `contract/src/validate-admin.ts:141`, `contract/src/audit.ts:88-90`); the
  7 console hits are test fixtures of that same field (`src/connection-test.test.ts:17`, `:25`,
  `:42`, `:298-299`, `src/server.setup.test.ts:36`, `:583`); the 2 config hits are OCI image
  annotations
  (`config/src/release.test.ts:266`, `:412`), unrelated. The console hidden form field
  `revision` intentionally reuses the contract meaning: "the version of the target the user saw
  when the page opened". A later checks-file screen fills it with the contract admin revision
  and sends it as `if-match`, so a stale write answers the contract `412`; other later screens
  fill it with their own version string. Here the fixtures use opaque test strings. It is an
  HTML form field of the console, not a wire field; the contract does not change.

New routes: the production route `GET`/`HEAD` `/console.js` (0 hits above) and the `/__test/…`
paths of Required behavior 6 (test-created servers only). New metrics label value: `path` gains
`/console.js`. Other new names outside source code: CI job `browser`, folders `test/` and
`e2e/`, the flag `--serve` of `e2e/run.ts`, and in deploy the step `8b` and the helper
`form_token_args` of `e2e/console-setup.sh` (0 hits for `form_token` in deploy above). Fixture fields `choice`, `action`, `note`, `secret`
live in `test/` only.

## Repository: deploy

Files:
- `e2e/console-setup.sh` (sends `form_token` when the page has one; new replay step 8b)
- `README.md` (the paragraph on `e2e/console-setup.sh`, `README.md:128`, names the form token and
  the replay step)

Behavior change: yes
The console e2e script sends a new form field and gains a replay check.

### Verified tool facts

- CI `.github/workflows/ci.yml:34-37` runs `shellcheck -x` and `bash -n` on every tracked `*.sh`.
  The `dev` job (`:179`) runs on `pull_request`, `push` to `main`, `workflow_dispatch` and
  daily (`:3-10`). It checks out console `main` (`:213-215`) and runs
  `bash e2e/console-setup.sh dev/compose.yaml` (`:225`).
- The script reads `csrf` with `sed` from the last response body (`e2e/console-setup.sh:50-55`).
  It posts with `req` (`:41-48`), prints only `ok:` lines and never prints a token
  (`:5`).

### Behavior

- A helper `form_token_args` reads the `form_token` value from the same body as `csrf()`, with
  the same `sed` pattern (`name="form_token" value="…"`, first match). When the value is not
  empty, every POST that uses that `csrf` gets `--data-urlencode "form_token=<value>"`. When
  the page has no such field (console `main` before this feature), nothing is added and the POST
  is byte-identical to today. This covers every POST: steps 3, 4, 5 and 6 (`owner_post`), 7
  and `sign_in`. If #563's deploy change is on `main` first, it also covers each POST of its
  `two-factor` flow. The value is never printed.
- Steps 3 and 5 already read `csrf` again from the answer. The form token is read again at the
  same places, because each answer that shows a form carries a fresh one.
- New step 8b, right after the successful step 8 sign-in. If the step-8 sign-in sent a form
  token, the script sends the identical POST again: same jar, same fields, same `form_token`.
  It expects status `409` and the body text `Already submitted`, and prints
  `ok: 8b POST /sign-in replay 409 Already submitted`. If no form token was sent, it prints
  `ok: 8b replay check skipped: console without form_token`. Step 8's `GET /` check then runs
  as today: it still answers `200` with `Signed in as`, because the replay did not end the
  session.
- No other step, status or text changes.

### Checks

1. `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and `... | xargs -0 -n 1 bash -n` exit `0`
   (the CI lint commands, `ci.yml:34-37`).
2. The deploy pull request's `dev` job is green against console `main` without form tokens. Its
   log has the literal line `ok: 8b replay check skipped: console without form_token`, and every
   other `ok:` line of today.
3. The token path is proven later, by the console child (console check 14). It runs this script
   from deploy `main` against the console branch and gets the literal line
   `ok: 8b POST /sign-in replay 409 Already submitted`. The console branch does not exist while
   this child runs (`dependsOn`).

### Completion evidence

The pull request lists the shellcheck output and the `dev` job result with the skip line.

## Repository: console

Files:
- `src/server.ts` (protected-route dispatcher with the form-token step, the form-token step of
  `/setup`, `/setup/owner`, `/sign-in` and `/sign-out` (Required behavior 1a), Overview at `/`,
  shell 404, `/console.js`, `testRoutes` and `roleOf` deps)
- `src/main.ts` (passes `instanceName`; still no `testRoutes` and no `roleOf`)
- `src/html.ts` (new: document head with the script flag, `csrfField`, `formTokenField`,
  `field`, `textarea` field, `submitButton`, `formErrorSummary`, moved from `src/pages.ts`)
- `src/form-tokens.ts` (new: `createFormTokens`, `FormTokens`, `FORM_TOKEN_LIFETIME_MS`)
- `src/console-script.ts` (new: `CONSOLE_JS`, the static script text served at `/console.js`)
- `src/metrics.ts` (`PathLabel` gains `/console.js`)
- `src/pages.ts` (setup and sign-in pages import from `src/html.ts`, take a `formToken` and
  render `formTokenField` after `csrfField`; `alreadySubmittedPage`; `landingPage` removed)
- `src/shell.ts` (new)
- `src/navigation.ts` (new: registry, `visibleNavigation`)
- `src/roles.ts` (new: `ConsoleRole`, `hasRole`, role labels)
- `src/protected-route.ts` (new: `ProtectedRoute`, `PageRequest`, `PageResult` types)
- `src/states.ts` (new: the state renderers)
- `src/api-failure.ts` (new: `ApiFailure`, mapping from `FetchJsonError`, texts)
- `src/overview.ts` (new: pure summary and overall state, Overview body)
- `src/overview-read.ts` (new: the two pulse-api reads)
- `src/confirm.ts` (new: confirmation pages, `isTypedNameConfirmed`)
- `src/styles.ts` (shell, nav, banners, states, confirmation and 390 px rules)
- `src/connection-test.ts` (only if `wireLabel` moves to `src/api-failure.ts`; texts unchanged)
- `src/html.test.ts`, `src/shell.test.ts`, `src/navigation.test.ts`, `src/roles.test.ts`,
  `src/states.test.ts`, `src/api-failure.test.ts`, `src/overview.test.ts`,
  `src/overview-read.test.ts`, `src/confirm.test.ts`, `src/form-tokens.test.ts` (new)
- `src/server.overview.test.ts`, `src/server.states.test.ts`, `src/server.confirm.test.ts`,
  `src/server.form-token.test.ts` (new)
- `src/server.test.ts` (`depsFor` at `:41` gains `instanceName`; new cases added),
  `src/server.setup.test.ts` (the `createConsoleServer` call at `:102` gains `instanceName`;
  the `Client.post` helper at `:172-191` sends a `form_token`),
  `src/server.sign-in.test.ts` (call at `:94` gains `instanceName`; the `Client.post` and
  `signIn` helpers at `:163-187` send a `form_token`; new cases added),
  `src/server.security.test.ts` (call at `:62` gains `instanceName`; raw `send` bodies that
  must reach a commit point gain a `form_token`; new cases added),
  `src/main.startup.test.ts` (new case for `/__test/` on `bun src/main.ts`)
- `test/fixture-routes.ts`, `test/fake-api.ts` (new, test only)
- `e2e/run.ts`, `e2e/tsconfig.json` (new, Chromium checks)
- `package.json`, `bun.lock` (dev dependencies, `check:browser`, `typecheck` with `-p e2e`)
- `tsconfig.json` (`include` adds `test`)
- `.github/workflows/ci.yml` (job `browser`, image check paths, `release` needs `browser`)
- `README.md`, `docs/configuration.md`, `docs/development.md`, `AGENTS.md`

Behavior change: yes
New signed-in shell and Overview at `/`, a shell 404, new renderers, the `/console.js` route, a single-use form token on every POST form (protected routes, setup, sign-in, sign-out) and a new CI job.

### Rule for the existing test files

This rule covers the five existing test files above. Only these edits are allowed:

1. Constructor wiring: one `instanceName: "pulse Console"` line per call listed above.
2. Form tokens in requests. Today's tests post success paths (setup code, owner `complete`,
   sign-in, sign-out) without a form token, and those would now answer `409`. So:
   - The request helpers (`Client.post`, `signIn`) send a fresh `form_token` with each POST.
     They get it from a GET of the page that renders that form, sent with only the cookies the
     form needs:
     - `/setup`: the anonymous CSRF cookie;
     - `/setup/owner`: the CSRF and setup cookies;
     - `/sign-in`: only the anonymous CSRF cookie, so an expired or live session cookie is not
       sent and not cleared;
     - `/sign-out`: a GET `/` with the session cookie.
     The helper reads the token with `/name="form_token" value="([^"]+)"/` and does not store
     cookies from that GET. A helper that finds no token sends none. A fresh token per POST
     keeps today's results: for example, the two concurrent completions at
     `src/server.setup.test.ts:633-656` carry two tokens and still give `303` and `409`
     `Setup is already complete`.
   - Raw `send` bodies in `src/server.security.test.ts` that must reach a commit point (the
     `303` unlocks at `:179-190`, `:286` and `:321`) gain `&form_token=<token>`, taken from a
     GET `/setup` with the same cookie.
3. New `test(...)` cases.

No existing `expect` is removed, loosened or changed: `git diff main -- <these files>` has no
removed line that contains `expect(` (console check 9). Required behavior 1a keeps the order
and status of every refused request, so a request that was refused before the token step still
gets today's answer.

If an existing assertion still fails, that is a defect of the implementation, to fix in `src/`.
Examples: an assertion that fails because `GET /` now reads pulse-api, or because a helper GET
moved a count. If it cannot be fixed in `src/`, the implementer requests a hold instead of
changing the assertion.

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
- `ROUTES` (`src/server.ts:70-77`) gains exactly one production path, `"/console.js": ["GET",
  "HEAD"]`, answered with `CONSOLE_JS` and `content-type: text/javascript; charset=utf-8`
  through the same `send` as `/console.css` (security headers, `no-store`); `/` keeps `GET`,
  `HEAD`. `PathLabel` (`src/metrics.ts:4-14`) and `pathLabel` (`src/server.ts`) gain
  `/console.js`; `/__test/*` counts as `other`.
- `CONSOLE_JS` is plain ES2020 in a template string (no TypeScript syntax, no import, no
  `eval`, no `innerHTML`), with the behavior of Decision 6 only. It is the single script file;
  later screens extend this file for copy buttons and the preview instead of adding another.
- `ProtectedRoute` has `path`, `methods`, `requiredRole`, `navId?`, `knownFields` (POST),
  `handle(request): Promise<PageResult>` and, for a route with POST, `renderForm(request,
  notice): PageResult`, which renders the GET form with the kept non-secret fields and the
  notice, without any action. The dispatcher calls `renderForm` for an `invalid` form token and
  answers its result with status `409`. `PageRequest` carries the user, role, session CSRF
  token, parsed fields (POST), query, and `issueFormToken(actionPath): string`.
- `createFormTokens({ now, randomBytes })` returns three functions:
  - `issue(binding, path): string`;
  - `consume(token, binding, path): "accepted" | "replayed" | "invalid"`;
  - `wasUsed(token, path): boolean`, which uses nothing up.
  The lifetime and the three bounds of Decision 11 are named constants. The store holds a
  `Map`, does no I/O and uses no timer: expiry is checked against `now()` on each call. The
  server builds the binding (`s:` + session digest, `a:` + SHA-256 hex of the anonymous CSRF
  token with `node:crypto` `createHash`, as `sessionDigest` does).
- Setup, sign-in and sign-out follow Required behavior 1a, inside their existing functions
  (`postSetupCode`, `postSetupOwner`/`commitSetup`, `postSignIn`, `postSignOut`). They do not
  move into the dispatcher.
- Module size: one responsibility per module (AGENTS.md "Code design"); cognitive complexity at
  most 15 per function (shared lint).
- `e2e/run.ts` is a plain Bun script (`bun e2e/run.ts`, not `*.test.ts`, so `bun test` does not
  pick it up). It starts the fake api and a console server with `testRoutes`, a `mkdtemp`
  database with a completed setup, signs in through the real form, and drives Chromium at
  390 × 844 and 1280 × 800. The no-JavaScript checks run in a context with
  `javaScriptEnabled: false`; the script and axe checks run in a separate context with
  JavaScript on. The script check holds the busy POST with `page.route` until the assertions
  on the pending page are done, then lets it continue. It exits non-zero on the first failed
  assertion and prints `ok:` per check. With `--serve` it does not run checks: it starts the
  same fake api and fixture console on `127.0.0.1`, passes a 3000 ms `wait` to the busy
  fixture, prints the URL and the fixture sign-in (generated per run, test-only data), and
  runs until stopped; it is used for the manual agent-browser check (check 13).
- CI job `browser` on `ubuntu-24.04`, `timeout-minutes: 15`, `permissions: contents: read`:
  checkout (`persist-credentials: false`), setup-bun `1.4.0`, `bun install --frozen-lockfile`,
  `bunx playwright install --with-deps chromium`, `bun run check:browser` (as
  `status/.github/workflows/ci.yml:51-68`). `release.needs` becomes `[check, docker, browser]`.
  The `docker` dev-path loop adds `/app/node_modules/playwright`,
  `/app/node_modules/@axe-core`, `/app/test` and `/app/e2e`, and a new step checks that
  `GET /__test/states/empty` on the running container answers `404`.
- Docs: README "What works now" and the endpoint table (`/`, unknown path signed in);
  `docs/configuration.md` HTTP routes (protected-route order including the form-token step,
  the commit-point token step of setup, sign-in and sign-out with their `409` answers, the
  `403` of a sign-out without a session and with a bad Origin,
  `/console.js`, Overview reads, the log lines `api read failed` and `form token refused`, the
  busy button with and without JavaScript, the form-token lifetime and bounds and that a
  restart makes open forms expire); `docs/development.md` code layout, the `test/` and `e2e/`
  folders, `bun run check:browser`, `bun e2e/run.ts --serve`, the `browser` job and the image
  check; `AGENTS.md` "This repository" (new modules; the assets are the stylesheet and the one
  script `/console.js`, which holds only the busy button now and later the copy buttons and the
  preview as #460 and the 4 November decision allow; every protected form carries
  `form_token`), commands
  (`bun run check:browser`) and replace the rule "Test helpers stay inside the `*.test.ts` file"
  (`docs/development.md:48`) with the `test/` folder rule.

### Checks

Every expected value below is a literal written in this spec or in the test.

1. `bun run check` passes (lint, typecheck including `-p e2e`, tests, coverage ≥ 80 % lines).
2. `src/overview.test.ts`: the overall-state and count rows of Counterexamples, as literals.
3. `src/navigation.test.ts`: table over the four roles: with today's registry every role sees
   exactly `["Overview"]`; with a registry whose entries are all marked available, viewer and
   member see exactly the 4 entries `Overview, Checks, Incidents, Maintenance`, admin and owner
   see exactly the 9 entries `Overview, Checks, Incidents, Maintenance, Tokens, Probes, Team,
   Activity, System` in that order; the registry has exactly 9 entries, 8 of them not
   available; no unavailable entry renders an `<a>`.
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
   literal heading (each POST first GETs the form and sends its `form_token`); 409 and 412 keep
   `name` and `note` and not the secret sentinel, and their form carries a new `form_token`
   that differs from the one sent; 422 has
   `aria-invalid="true"` and `aria-describedby` pointing to an element with the error text;
   the forbidden route with viewer names `Admin` and `Viewer`; the expired-session route
   redirects to `/sign-in?next=%2F__test%2Fstates%2Fsession-expired`, and sign-in with that
   `next` lands there.
6. `src/server.confirm.test.ts`: for all 11 families, GET and HEAD record 0 actions; correct
   POST records exactly 1 action `{family, target}` and answers `303`; the same POST body sent
   again answers `409` `Already submitted` and the recorder still holds exactly 1 action; the
   typed-name, revision, role, CSRF, Origin and expired-session rows of Counterexamples hold.
7. `src/server.test.ts` and `src/server.security.test.ts`: a server without `testRoutes` and
   `bun src/main.ts` (`src/main.startup.test.ts`) answer `404` for `/__test/states/empty`;
   `GET /console.js` answers `200` with `content-type: text/javascript; charset=utf-8`, a body
   that contains `data-busy-label`, `aria-busy` and `pageshow` and does not contain `eval`,
   `innerHTML`, `fetch(` or `XMLHttpRequest`, and the CSP header below; `HEAD /console.js`
   answers `200` with no body; `POST /console.js` answers `405` with `allow: GET, HEAD`; the
   `/metrics` text after one `GET /console.js` contains
   `pulse_console_http_requests_total{path="/console.js",code="200"} 1`; the shell 404,
   Overview and every fixture response carry the CSP string `default-src 'none'; script-src
   'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none';
   frame-ancestors 'none'` (literal from the issue), `referrer-policy: same-origin`,
   `x-frame-options: DENY`, `x-content-type-options: nosniff`, `cache-control: no-store`; in
   every shell response the only `<script` is exactly `<script src="/console.js"
   defer></script>`, once; the setup and sign-in responses contain no `<script`; no response
   body contains `style=` or an ` on` event attribute (regex `/\son[a-z]+=/`).
   The metrics line format is the one the existing tests assert
   (`src/server.test.ts:263`, `pulse_console_http_requests_total{path="/",code="303"} 1`).
7a. `src/form-tokens.test.ts` (fake `now`, fake `randomBytes`): the form-token rows of
   Counterexamples at unit level: `accepted` once then `replayed`; another session digest or
   path `invalid`; `invalid` at `issuedAt + 43_200_000`, `accepted` at `issuedAt +
   43_199_999`; the 101st `issue` in one session makes the first token `invalid` while the
   second stays valid; with 10000 entries in total the next `issue` makes the oldest entry
   `invalid`; with 2000 `a:` entries the next `a:` `issue` makes the oldest `a:` entry
   `invalid` while an older `s:` entry stays `accepted`; an unknown and an empty token are
   `invalid`; `wasUsed` is `false` before `consume`, `true` after it for the same path, `false`
   for another path, and `false` at `issuedAt + 43_200_000`.
7b. `src/server.form-token.test.ts` (real server, fixtures): every form-token row of
   Counterexamples over HTTP, with literal statuses `200`, `303`, `403` and `409`, the literal
   texts `Already submitted` and `This form has expired. Your input is kept below. Send it
   again.`, and the recorder count (0 or 1) after each case; two POSTs started together with
   `Promise.all` give exactly one `200` and one `409`; a captured log shows `form token
   refused` with `reason` `replayed` and `invalid` and never the token value.
7c. `src/server.form-token.test.ts`, setup, sign-in and sign-out (real server, temp database,
   fake api): every row of Counterexamples from "Sign-in replay" to "Sign-out without session".
   The test checks these literals: statuses `303`, `200`, `401`, `403`, `404`, `409` and `429`;
   the texts `Already submitted`, `This form has expired. Send it again.`, `Setup is already
   complete` and `not found`; the session row count (0 or 1, `SELECT id_digest FROM sessions`
   as `src/server.sign-in.test.ts:194-199`); the user count (1); and whether a `Set-Cookie`
   header is present.
   - After a sign-in replay, `/metrics` contains
     `pulse_console_auth_attempts_total{kind="sign-in",result="success"} 1` and no
     `result="failure"` line.
   - `GET /sign-in`, `GET /setup` and `GET /setup/owner` (with grant) contain exactly one match
     of `/<input type="hidden" name="form_token" value="[A-Za-z0-9_-]{43}">/`, directly after
     the `csrf` field. Two GETs give two different values.
   - With that line removed, the `GET /sign-in` body (fixed CSRF cookie) equals a literal HTML
     string written in the test. The test author copies that string from console `main`'s
     `signInPage` output with the same CSRF; it is not generated from the code under test.
   - `HEAD /sign-in` answers `200` with an empty body.
8. `bun run check:browser` (CI job `browser`): at 390 px every page of Required behavior 7 has
   `scrollWidth ≤ 390`; axe reports 0 violations for tags `wcag2a`, `wcag2aa`, `wcag21a`,
   `wcag21aa`, `wcag22aa` on sign-in, Overview, the shell 404, 403, one typed and one plain
   confirmation; with JavaScript off, a typed confirmation completes by typing `Checkout API`
   and pressing Enter, and a plain confirmation completes with Tab and Enter (recorder shows 1
   action each); with JavaScript off, on `/__test/states/busy` the `Run` button is not
   disabled on load, Enter submits and the page shows `Submitted: go` with 1 recorded
   `action=go`, then the captured POST body of that submission sent again through
   `context.request.post` (same cookies, same `Origin`) answers `409` with `Already
   submitted` and the recorder still holds 1 action; with JavaScript on, on
   `/__test/states/busy` with the POST held, after a click on `Run` the button has
   `isDisabled()` true, `aria-busy` `"true"` and text `Running…`, three more clicks and an
   Enter send no further request (exactly 1 POST request seen by `page.on("request")`), and
   after the release the page shows `Submitted: go` with exactly 1 recorded action whose
   `action` is `go` (the submitter value survived); the browser console reports 0 CSP
   violations on every page; Tab from the top reaches the skip link first, then the sign-out
   button and the Overview link, each with a computed `outline-style` other than `none`.
9. Existing tests stay green under "Rule for the existing test files": `src/server.setup.test.ts`,
   `src/server.sign-in.test.ts` (including `Signed in as Owner &lt;Sentinel&gt;`, the API
   origin and `action="/sign-out"` on `/`), `src/server.test.ts`,
   `src/server.security.test.ts`, and the setup texts of `src/connection-test.test.ts`.
   `git diff main -- src/server.test.ts src/server.setup.test.ts src/server.sign-in.test.ts
   src/server.security.test.ts src/main.startup.test.ts | grep -c '^-.*expect('` prints `0`.
10. CI `docker` job: the extended dev-path loop passes and `/__test/states/empty` answers `404`
    in the container.
11. Manual smoke (AGENTS.md "End-to-end checks"): `PULSE_API_URL=http://localhost:3000 bun start`
    against a local pulse-api, set up, sign in, see the Overview, stop pulse-api, reload, see
    `pulse-api cannot be reached`; the pull request reports the commands and results.
12. Image: the docker job's container answers `GET /console.js` with `200` and
    `content-type: text/javascript; charset=utf-8` (the script ships in `src/`).
13. Manual browser check with `agent-browser` (the owner decision names it; as in #562 and
    #563) against `bun e2e/run.ts --serve`: sign in, open `/__test/states/busy`, click `Run`;
    during the 3000 ms wait the snapshot shows the button disabled with `aria-busy="true"` and
    text `Running…`; after the answer `Submitted: go`. Then with JavaScript disabled in a new
    agent-browser session: the form submits and works, and the same POST body sent a second
    time (the reload of the POST result, which re-sends it, or `curl` with that session's
    cookie, `Origin` and the captured body) shows `Already submitted` and the fixture recorder
    still holds 1 action. (Going back re-fetches the `no-store` page with a fresh token, so it
    is not a replay.) The pull request lists the agent-browser commands
    and results.
14. Deploy e2e against this branch. Use deploy `main`, which has the deploy child of this spec
    merged. Set `PULSE_SRC_DIR` so that deploy `dev/compose.yaml:89` builds this console
    branch. Then run, from the deploy checkout: `scripts/init-secrets.sh`,
    `docker compose -f dev/compose.yaml up -d --build`,
    `scripts/wait-ready.sh dev/compose.yaml 900` and
    `bash e2e/console-setup.sh dev/compose.yaml`. The run exits `0`, prints every `ok:` line of
    steps 1 to 10, and includes the literal line
    `ok: 8b POST /sign-in replay 409 Already submitted`. Without this run, deploy's daily `dev`
    job would be the first to see the token flow after the merge.

### Completion evidence

The pull request lists:
- the `bun run check` output summary (tests, coverage);
- the `bun run check:browser` output (`ok:` lines);
- the green CI jobs `check`, `docker` (both legs) and `browser`;
- the manual smoke commands and results;
- the agent-browser commands and results of check 13;
- the deploy e2e commands and output of check 14;
- the `bun run test` duration before and after.

It also lists the known limits:
- Without JavaScript, the button is not disabled while the request runs. The form token still
  refuses a second effect.
- Open forms, including an open sign-in or setup page, expire after 12 hours or a console
  restart. They are shown again with the kept input.
- After setup completes, a replayed setup POST gets the phase `404`, not `Already submitted`
  (Required behavior 1a).
- A sign-out without a session and with a bad Origin now answers `403` instead of `303`.
- State-changing forms that #563 adds after this merge must add the token themselves
  (Decision 11).
