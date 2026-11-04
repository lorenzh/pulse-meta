# Issue review: #718 — console shell, navigation, states and confirmations

## Outcome

Ready for `plan`. No owner decision blocks specification. This is a console-only feature against current main, with reusable presentation and test fixtures for future screens. The interpretations below resolve underspecified details without implementing those screens, changing authentication, or waiting for the role-management feature.

## Sources and inspected baseline

- [Issue #718](https://github.com/lorenzh/pulse-meta/issues/718) and all its comments were read. Its only comment at review time is the Factory claim; there are no earlier review decisions.
- [#460 amendment of 2 November](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362), especially sections 13–15, 19 and 20, supplies the role policy, shared states, wave order, rendering and security decisions. The amendment overrides the older issue body and design boards.
- [#564 owner-confirmed matrix](https://github.com/lorenzh/pulse-meta/issues/564#issuecomment-6637789309) supplies the detailed permissions. Its comments describe a completed spec, not shipped roles. Local `.factory/work/563` and `564` are absent, so their plans must not be assumed available in this checkout.
- [#694 referrer-policy decision](https://github.com/lorenzh/pulse-meta/issues/694#issuecomment-6630888343) explicitly requires `same-origin`, retaining rejection of `Origin: null`. Read its comments and the #563 comments too. #563 remains adjacent work; its [later review](https://github.com/lorenzh/pulse-meta/issues/563#issuecomment-6640797665) distinguishes ending other sessions from ordinary sign-out. This item supplies confirmation presentation, not either session operation.
- Read root `AGENTS.md`, `README.md`, `.factory/prompts/issue-review.md`, `docs/approved-packages.md`, the #562 plan, and the console instructions and development/configuration documentation.
- Inspected read-only clones: console `edefdbeaa152d602d724a3c19cc3ca3ad760aa6b`, api `2bc5910c9c3e223a5a17e654ada9e1e98dd7a0d1`, contract `176fb6ed14b2f14b730a9fd1757239f210f97a29`. Also inspected the status summary renderer and deploy's console setup consumer.

Current behavior established from code:

- Console `src/pages.ts`, `styles.ts` and `server.ts` render escaped server HTML and `/console.css`. `/` redirects to setup before initialization, to sign-in when signed out, and otherwise renders the bare landing page with `Signed in as`, the saved API origin and a CSRF-protected sign-out form. Sign-in honors a validated local `next` path. Unknown paths currently return a plain-text 404. There is no shell, overview or shared state/dialog suite.
- `src/account-store.ts` and database migration 1 support only the owner role. Instance state contains API URL and setup completion time; there is no instance-name setting or stored name. Sessions and expiry handling already exist. An invalid session cookie on the sign-in page produces an expiry notice.
- `src/connection-test.ts` already uses contract `fetchJson`, safe fixed errors, a 5000 ms timeout per request, bounded responses, server-only credentials and manual redirects. Setup checks `/admin/config` and `/admin/tokens`; it is not a live-state overview client and must not be changed into one.
- Contract `src/schema.ts` and `validate.ts` expose `CheckState`, `ChecksResponse` and `validateChecksResponse`. `/checks` supplies live states: `up`, `degraded`, `down`, `unknown`, `maintenance`. `/admin/config` supplies effective configuration, including source/file information, but no live state or overall-state aggregate (`src/admin.ts`). A summary validator already supports configuration responses across API versions.
- API `src/admin-routes.ts` authenticates `/admin/config`; invalid credentials produce 401, insufficient scope 403. Public `/checks` does not authenticate the console token. The API error body is generally `{error: string}`, not a structured collection of field errors. Read-only checks-file write failures are contextual 503 errors; not every 503 has that meaning.
- Console has Bun HTTP/security/session tests and shared check/coverage CI, plus Docker checks. It has no browser test harness or browser dependency in `package.json`. `Dockerfile` copies `src`, while CI rejects shipped `*.test.ts`/`*.spec.ts` files. Test-only route registration must respect that packaging boundary.
- Deploy `e2e/console-setup.sh` expects `/sign-in?setup=done`, HTTP 200 on signed-in `/`, and the text `Signed in as`. Existing console tests also assert the sign-in flow and root redirects. Keep these compatible while adding the overview.

## Open points and working assumptions for the plan

### 1. Scope, roles and merge order

Target console only. Existing API/contract shapes are sufficient; do not add an overview endpoint, build account/team/check/token screens, or update deploy images for this item. #460 places this shell in wave 2, before #564. Therefore four-role presentation must not require the four-role database migration: implement a small typed navigation policy covering the four decided roles, feed it the authenticated user's current role, and test other roles with fixtures/pure policy tests. Production main still admits only its existing owner account. Do not manufacture roles from a request field or cookie.

Use Overview, Checks, Incidents and Maintenance at viewer or above; Tokens, Probes, Team, Activity and System at admin or above. Owner-only actions inside those screens stay in their owning features. Navigation visibility is not authorization. Reuse server permission decisions when they exist; do not introduce a competing full permission matrix, change the role model, or grant access by hiding a link. Provide the role-naming 403 component and server fixture coverage here; actual future routes still enforce their own permissions.

Treat #562/#694 as the merged foundation. #563 and #564 are parallel/later integrations, not prerequisites to recreate. If they land before implementation, adapt to their actual session/user interfaces and render only fully authenticated pages inside the shell; do not bypass a TOTP/enrolment gate. Record that rebase integration explicitly in the plan.

### 2. Instance name and future navigation

There is no configurable instance name on main. Use the existing product name `pulse Console` as the header's instance label in this item, passed through a shell view parameter so future settings can supply a name. Do not add a database migration or setup field just for branding. Display the authenticated name/email and role, with the current sign-out POST in the header.

Interpret a “clear place” for later entries as an extensible ordered navigation registry and layout. Enable actual links only for screens that exist on the implementation baseline. Do not create dead links or route stubs for all later screens. If the design includes visible future labels, render them as noninteractive, explicitly unavailable text and apply the same role filtering. The plan must choose and document one presentation; enabled Overview plus a registry for later entries is the default. Mark the active page accessibly.

### 3. Overview data and credential rejection

Keep `/` as the overview and default sign-in destination; preserve successful sign-in's existing `next` behavior. Read the saved API base URL and the process-configured token, not a browser-provided destination or credential.

The older #460 wording says the console talks only to the admin API, but current admin configuration has no live states. For this read-only summary, assume server-side use of the existing `/checks` read on that same API is allowed. Pair it with an authenticated `/admin/config` read using its existing summary validator to establish token acceptance. This supplies a real token-rejection banner without waiting for #566's `/admin/tokens/self`, exposing a proxy, or listing tokens on every page. Merely adding a bearer header to `/checks` cannot detect rejection. Do not sum configuration entries and live entries together or count shadowed/inactive checks.

Use contract `fetchJson`/validators and established timeout/body limits; refuse redirects and require the supported wire header. Reuse the transport/error classification where appropriate while keeping setup behavior unchanged. The plan must specify request ordering, bounded total latency and precedence when one read succeeds and another fails. Prefer treating a failed authenticated read as unavailable rather than displaying a healthy summary based solely on the public endpoint. No new polling, cache, dashboard charts or incident aggregate is required.

Define overall state explicitly from live check states. Recommended deterministic precedence is down, degraded, unknown, maintenance, up; unknown must never silently become healthy, and zero checks is a separate empty state. Show all five state counts, including zero, plus the total. The plan may choose a clearly explained neutral treatment of maintenance, but must test mixed unknown/maintenance and all-maintenance data. This item counts checks, not components, and does not import code from pulse-status.

An empty overview must offer a working next step without linking to an unbuilt check editor: e.g. retry/refresh and safe operator guidance for adding checks. Later callers can supply their own role-appropriate next action.

### 4. Shared states and status mapping

Give each requested state one reusable renderer/view contract; use the relevant ones on the overview and expose the rest through isolated test routes. Reuse existing HTML escaping, field/error relationships and form conventions. Do not copy whole error pages into each fixture or future screen.

- Network, timeout and upstream HTTP failures show a safe category, timeout duration or status and a usable retry action. Never echo arbitrary upstream bodies, exception text, credentials or a full request URL.
- Distinguish console authorization (403 naming the required role) from an API 401 rejection banner and API 403 insufficient-token-scope guidance. An upstream token failure must not sign out the console user or falsely describe their console role as insufficient.
- Expired sessions reuse existing sign-in, cookie expiry and `safeNext` behavior. Define GET and POST outcomes for protected pages, retain the original local page path (and safe query where appropriate), and never replay a mutation after sign-in. No expiry or session-storage redesign is authorized. A component demo must not require loosening real authentication.
- Signed-in unknown-page responses can render the shared 404 inside the shell while preserving raw-path matching and status 404. Preserve pre-setup/authentication routing and ops behavior. State explicitly how unknown unauthenticated paths behave.
- 409 and 412 share “changed since you opened it” presentation with the attempted nonsecret input retained and an explicit reload/review path. Do not silently retry or overwrite a newer revision. A 409 may be a duplicate/reference conflict rather than a stale edit, so allow safe contextual detail supplied by the caller.
- 422 supports errors next to labeled fields using `aria-invalid` and `aria-describedby`, plus a form-level fallback. Current API errors are strings; callers map known errors to their fields, rather than assuming an unavailable structured-error protocol or changing the API here.
- Render “the checks file is read-only” only for a known configuration-write read-only failure. A generic upstream 503 remains an API failure. Keeping input means retaining safe entered values; do not refill password/token/recovery-secret fields or introduce storage of write-only values.

The plan must distinguish presentation state from response status: an inline empty state or banner is not itself an HTTP error; real forbidden/not-found/conflict/validation responses preserve their appropriate status. Rendering fixtures alone does not replace real overview transport tests.

### 5. Busy buttons without JavaScript

The request combines “disabled while the request runs” with JavaScript-free forms, while #460 allows scripts only for copy/preview. Plain HTML cannot dynamically disable the already displayed submit button during an outstanding navigation. Interpret this as a reusable enabled/pending button renderer: a rendered pending button is disabled and exposes busy text; normal forms submit and finish through native browser navigation without JavaScript. Do not render an initially disabled button on a form that must be submitted.

The plan must state this limitation honestly and test both the pending rendering and native submission. Do not silently add a submit script, use CSS to pretend a button is disabled, or claim a browser assertion proved dynamic disabling with scripts off. Server-side protections for future mutations remain the owning route's responsibility; this component does not promise exactly-once execution. If literal dynamic disabling is required later, it needs a change to the stated script restriction.

### 6. Confirmations as server-rendered pages

“Dialog” may be a dedicated confirmation page with a heading, explanation, cancel link and POST form; no JavaScript modal or focus trap is needed. Type-the-name confirmation receives a server-owned target identity and expected display name from the caller. POST validates an exact match on the server after the normal Origin/body/CSRF/session/permission checks. A hidden expected-name value is not authoritative. Specify whitespace/case rules (default: exact, case-sensitive display name), wrong/blank input errors and retained nonsecret input.

The shared contract supports all six typed action families (delete check, delete incident, revoke token/probe, remove member, ownership transfer) and all five plain families (resolve, delete maintenance, reset 2FA, sign out all sessions, new recovery codes). Caller-supplied text describes the actual consequences; the renderer must not hardcode the meaning of sign-out-all or implement those operations. Ordinary header sign-out remains the existing form. Revalidate permissions and the target at execution time; a confirmation is not an authorization grant.

Test fixtures use inert targets and record a fake action, never call real destructive endpoints. Cancel/GET/HEAD do not mutate; a missing/wrong CSRF token or typed name cannot execute. Both confirmation types must complete with scripts disabled.

### 7. Test routes and production packaging

Choose a stable private test-route namespace in the spec, with an individual route for every state (separate 409 and 412 cases), busy rendering and confirmation variant. Register fixtures only in a test-created server through injected handlers/dependencies defaulting off, with fixture implementations in excluded test files. Do not add a public demo gallery, a new production environment flag or a route that bypasses authentication/permissions. Prove the namespace is unavailable on an ordinary server and absent as an enabled capability in the image.

Production components remain reusable modules. Fixture pages use their real renderers, the real shell/security headers where applicable and the normal POST guards. Simulated roles and expiry in fixtures must be scoped to that fixture server, not production account state.

### 8. Mobile, accessibility and verification tooling

At 390 CSS pixels, test sign-in, signed-in header/navigation, overview success/empty/failure and every shared state, with long names, email addresses, error details and preserved input. Assert document scroll width does not exceed viewport width; hiding overflow to mask clipped controls is not a fix. Use wrapping layouts and allow all controls to remain reachable. Confirmation forms should remain usable too.

Keep setup/sign-in/session semantics intact. A narrowly required CSS adjustment for the explicitly requested sign-in viewport check is in scope. #563's future 2FA, invitations and resets get their additional mobile checks in their own features; do not build them here.

Test landmarks/headings, labels, keyboard access, visible focus, active navigation and text alternatives for status colours. Provide appropriate status/error semantics without unnecessary alert roles on every static paragraph.

The plan must add a reproducible browser check to CI, not rely solely on manual screenshots or HTML tests. Use approved pinned browser tooling only as dev tooling, excluded from the image, and respect the shared Actions policy; do not add UI libraries or runtime packages. Check the precise approved-package scope before choosing a new dev dependency. Retain Bun lint/type/test/coverage and Docker jobs. The console instructions additionally require a local `bun start` smoke exercise for the implemented user-visible change. Preserve the deploy consumer's `Signed in as` text and successful root response so this work needs no cross-repository rollout.

## Derived acceptance check

1. **Routing and shell:** initialize the current console, sign in and follow the existing redirect to `/`. Get a 200 Overview with instance label, escaped user identity, actual role, navigation and working CSRF-protected sign-out. Existing setup redirects, setup completion notice, invalid credentials, safe `next`, expiry and sign-out behavior still pass. No API call is made by an unauthenticated overview request. Ops routes and raw-path tests stay green.
2. **Navigation:** table-driven tests cover all four roles against the specified viewer/admin navigation groups and enabled-screen flags. Hidden entries are absent, active navigation is announced, and no unavailable screen is an enabled dead link. Production's owner identity remains sourced from the existing store; fixtures do not expand the role schema. Real denied fixture routes return 403 naming the required role.
3. **Overview success:** local API fixtures return each state, a mixed set, all unknown, all maintenance and no checks. Assert exact counts/total and the specified overall-state rule, including safe empty behavior. Validate contract responses/wire headers and the configured saved destination. Only the intended same-origin API paths are contacted; no secrets reach the browser.
4. **Overview failures:** deterministically cover timeout, network failure, HTTP failure (including 429/503), missing/rejected credential, insufficient API scope, redirect, missing/incompatible wire header, oversized/invalid JSON and invalid shape. Show the appropriate reusable message/banner with safe status details and retry. A public-state success cannot conceal a rejected console token. Corrected retry recovers, and no raw error body or credential appears in HTML/logs/metrics.
5. **State fixtures:** every listed shared state has its own route using the reusable implementation. Assert real response statuses where applicable, required-role text, a safe expiry return path, retained safe input on both 409 and 412, accessible adjacent field errors for 422 and the contextual read-only 503. A generic 503 must not claim the file is read-only. Pending-button fixture is disabled with busy text; enabled form still submits without scripts.
6. **Confirmations:** with JavaScript disabled, exercise both confirmation types and the action-family parameters. GET/cancel do nothing; blank/wrong typed names, forged expected-name fields and invalid Origin/CSRF cannot execute. Correct server-validated name or plain confirmation executes exactly the intended fake action. Target/permission changes before submit are refused. No product mutation routes from later issues are built.
7. **Browser/mobile:** a CI browser test signs in and exercises shell/overview plus success, empty, failure, state and confirmation fixtures at 390 px. Assert no horizontal scrolling with long content and that fields, status text, links and buttons remain visible/reachable by keyboard. Record native-form completion with scripts off and visible focus/labels. Screenshots alone are insufficient evidence.
8. **Security, isolation and compatibility:** all new responses retain the exact CSP, `referrer-policy: same-origin`, no-store policy and other current headers. New change forms use the existing CSRF/Origin/body-validation order and cookie rules. Ordinary server/image requests cannot activate fixture routes. No test files/dev browser tooling ship. Existing deploy setup/sign-in assertions remain valid; API downtime does not alter local session validity or reopen setup.
9. **Quality and docs:** console `bun run check`, browser CI and existing image jobs pass without lowering coverage or weakening policy. Use local HTTP fixtures, temporary databases and injected clocks/timers. Exercise the changed UI once through `bun start` and record commands/results. Update console README/configuration/development docs for the overview, shared component contracts, test-only fixtures and browser command. No new runtime dependency, role migration, setup flow or future management screen is introduced.

## Review validation

This state changes only this artifact. No target files, provider comments or labels were changed. Application, browser and Compose tests were not run: acceptance above describes implementation work, not completed verification. An initial issue-comments call used the wrong connector parameter; it was corrected to `repo_full_name` and all requested comments were read successfully. Missing prior artifact directories were confirmed explicitly. The artifact must remain tracked for later Factory states.
