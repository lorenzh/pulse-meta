# Issue review: #774

## Result

Ready for `plan`. No question requires a `needs-input` hold. The request supplies enough design values to specify a console-only presentation change. The plan must resolve the nonblocking points below explicitly and preserve the shipped behavior of #718 and the later account, team and checks work.

## Evidence and decisions read

- Read meta `AGENTS.md`, `README.md`, the issue-review prompt, console `AGENTS.md`, the #718 review and relevant sections of its approved plan.
- Inspected the read-only console clone at `c78c9d5e835ee11978a025a6955dfc5eca1c23b2`, including `src/styles.ts`, `html.ts`, `shell.ts`, `navigation.ts`, `states.ts`, `confirm.ts`, `pages.ts`, `account-pages.ts`, `team-pages.ts`, `overview.ts`, the checks renderers and routes, `console-script.ts`, `e2e/run.ts`, package scripts and development documentation.
- Read #774 and all its comments through the GitHub API using `gh`. Its only comment at review time is the current Factory claim; there are no earlier decisions to carry forward. Read #460 and its comments, the owner's comment on #718, and the current #773 body. The GitHub connector failed to fetch comments; the CLI fallback succeeded. No required issue discussion remains unread.
- The 4 November owner decision on #718 explicitly permits the existing same-origin busy-button enhancement in addition to copy/preview. Forms must remain usable without JavaScript and keep server-side replay protection. The #718 plan fixes the instance name at `pulse Console`, passed into the shell; it adds no name setting.
- #773 now explicitly leaves radio layout, the mobile table, danger styling and the 403 presentation to #774. Rounding Last reason, readable settings labels, duplicate recent results, create/edit field parity and heartbeat addressing remain in #773.
- Inspected deploy `e2e/console-setup.sh`: it checks for `Signed in as` and extracts the existing CSRF/form-token fields. Keep those semantics and text so a visual change needs no deploy child.

The cloud runtime skill was read. This session exposes no `environment_status` tool and has no `/etc/codex/network-policy.json`; runtime readiness was not inferred. Normal GitHub CLI reads worked. No infrastructure change is needed for this review.

## Current implementation and scope

- `src/styles.ts` exports the one stylesheet; its current rules use system fonts, blue buttons, 4 px radii and a header/navigation row. Global `label` grid layout and full-width `input` rules also affect radios. These are shared rules, not isolated edit-form defects.
- `html.ts` owns the plain document and common controls. `submitButton` accepts only primary/secondary. Many account/setup forms use literal buttons, so extending that helper alone does not migrate every screen.
- `shell.ts` renders the skip link, instance/user information, POST sign-out form, navigation, banner and main heading. Only Overview, Checks and Team are available in `navigation.ts`; Team remains role-filtered. Unavailable entries must stay unavailable.
- `states.ts` supplies state bodies. `forbiddenState` emits an `Access denied` h2 while server/team callers also supply that title to the shell h1, explaining the duplicate. It currently uses the error kind and has no back link. The 404 body already relies on the shell heading and has an overview link.
- `confirm.ts` supplies typed and plain confirmation bodies, but account sign-out-all and recovery-code confirmations are separate markup in `account-pages.ts`. The shared `ConfirmView` has no presentation variant. Team role editing also uses class `confirm` despite being a normal edit form.
- The checks table already has a horizontally scrolling wrapper and a wide minimum table width, but the wrapper lacks a tab stop, accessible name and scroll hint. Detail tables, Team tables and the sessions table also need the common table treatment where wide.
- Check states, sources, numerical values and timestamps are mostly plain escaped strings. Adding dots/tags/mono styling requires markup changes at render sites; CSS alone cannot infer their meaning safely.
- `e2e/run.ts` already drives real console servers with local fake APIs, Playwright and axe. It tests layout, focus, no-script confirmations, busy behavior, account/team flows and check writes. It hardcodes the old blue link color, reads literal CSS color declarations for visited links, and expects the old shell Tab order. It does not explicitly run the requested light/dark design matrix.

Implementation target: **console only**. No API, contract, deploy, config, package-pin, database or runtime setting change is needed. Keep all context clones read-only in this spec workflow. The meta change records the spec/review artifacts only.

## Open points and assumptions for the plan

### 1. Design authority and reuse

Use the issue's exact light/dark palette and dimensions as the implementation contract; #460 and the #718 amendment win over a board. There is no console board file or address supplied with this task, and no board was inspected. Pixel comparison against an unavailable canvas is not an acceptance dependency. Choose consistent decorative SVG paths and class names in the spec. Reuse the existing renderers and stylesheet; do not introduce a parallel design system or reconstruct routes.

Specify the shared class vocabulary for buttons, fields/choice rows, option cards, tables/scroll boxes, check states, tags, callouts, empty states, panels, description lists, page heads and responsive grids. Generic classes for later screens are in scope, including the stated breakpoints; building those screens or a production component gallery is not. A future dialog radius token does not authorize a modal.

### 2. Preserve existing search, data and text

The checks list already has a Search field (`q`) in its existing filter form. Interpret “leave out … search box” as forbidding a new global/board search box, not removing this working filter. Preserve search, all filters, downloads and their routes. Likewise do not add board availability tiles or metrics; preserve existing API-backed detail data and its text. Apply typography and layout to existing settings labels without renaming them (that fix remains #773).

Keep source labels/capitalization, state labels, numeric results, error details and consequence text intact. The requested wordmark, self-hosted pill, navigation group title, breadcrumb labels, scroll hint and 403 back action are allowed presentation additions. Decorative dots/icons must not duplicate accessible names or replace text. Keep `Signed in as`, the existing user identity/email and role available in the sidebar.

### 3. Shell and navigation

Restructure the existing shell into the 236 px sidebar and main column. Group only visible admin entries beneath “Instance”; today this means Team for admin/owner, with no empty group for lower roles. Do not expose unavailable links or add Settings. Derive initials from the existing escaped user name, with a deterministic fallback, and treat the avatar as decorative.

Breadcrumbs should derive from known page/navigation data and existing destinations; no new route, storage or client-side router is needed. Keep one h1, one main landmark, the skip link first, `aria-current`, banner alerts and server-enforced roles. Sign out remains the current POST button with CSRF and form token, styled as an action in the sidebar foot; it must not become a GET link. Keep `pulse Console` as the instance name.

The old exact Tab order through header actions may change with the new sidebar's logical DOM order. Update presentation-specific test expectations while preserving skip-first access, visible focus and reachability of every nav/account/sign-out control. Do not fake visual order with an incoherent keyboard order.

### 4. Plain layout and session expiry

Apply the wordmark and centered 440 px panel through `plainDocument`, including its current callers for authenticator enrollment and recovery-code results. Keep shell-based account pages in the shell. At narrow widths, panel padding/available width must still leave fields usable.

Session expiry currently leads to sign-in with the safe return path and the expired-session notice; restyle that flow rather than adding a session-expired route. Preserve next-path validation and never replay a mutation. Do not invent footer policy/help links or new prose solely to fill the design's footer slot; reuse existing secondary text/links.

### 5. Confirmations need explicit presentation intent

All typed-name confirmations use the danger panel and submit. Plain confirmations need a caller-supplied presentation choice rather than label/path matching: invite revocation, deletion, reset 2FA and sign-out-all are destructive; resolve and new recovery codes use primary as the issue explicitly requires. Creating a password-reset link uses primary: creating it does not itself end sessions; its existing consequence text stays unchanged. Role editing remains a normal edit form despite its current `confirm` class.

Audit shared helpers, account-specific confirmation markup and real call sites. Every delete/revoke/remove/transfer submit must be danger, including ownership transfer whose label is `Make owner`. Destructive confirmation panels get the error border; Cancel is a ghost-styled anchor before the submit in a right-aligned wrapping footer. Keep one visible title; do not add a second heading merely to put it inside a panel. Preserve password fields, typed-name normalization, revision fields, hidden field order, CSRF, form tokens and action endpoints.

### 6. Scripts stay as shipped

“Confirmations … without JavaScript” means they function without it, not that signed-in confirmation documents lose the existing script. Keep `/console.js` and its busy/copy behavior unchanged, with the existing script-loading boundary between shell and plain documents. Theme selection is CSS-only. CSS must preserve `[hidden]` on copy buttons and other elements even when button classes use `inline-flex`. Do not add resize, overflow detection or theme code to satisfy the visual requirements.

### 7. Touch size and typography exceptions

Treat the 18 px radio/checkbox as the visual control inside a label row with a minimum 44 px interactive target; it must not inherit full field width. Base body size is 15 px with the named fallback stacks; form labels use the explicitly specified 14 px/500 style, while metadata/footer labels use 13 px. Use 20/14 px component padding where explicitly given even though they extend the general spacing scale.

The 36 px small-button visual conflicts with the blanket 44 px target unless the hit area is enlarged. Keep a minimum 44 px interactive target around a 36 px visual where used; ordinary existing buttons can remain 44 px. The plan must explain this treatment and verify targets rather than shrink live destructive actions. Disabled/busy opacity is the explicit inactive-control treatment; do not apply it to ordinary actionable buttons.

### 8. Mobile overflow and wide content

Interpret “nothing scrolls sideways” as no **document-level** overflow. The issue explicitly permits contained horizontal navigation below 720 px and marked table scroll boxes. Main/grid children need shrinkable widths; do not mask failures with root/body `overflow-x: hidden`. Keep account links and sign-out visible beneath the mobile nav.

Wide tables need a named focusable scroll region, a visible focus outline and a visible hint or edge treatment without a new script. A persistent hint at the narrow breakpoint is acceptable. Verify keyboard scrolling on an overflowing checks table. Apply the same wrapper behavior to other wide existing tables. Long URLs, names, secrets and snippets must wrap; the existing `<pre>` horizontal overflow must not introduce an unmarked third kind of scroll box at 390 px. CSS wrapping must preserve the copied snippet's original `textContent`.

### 9. Color contrast is about actual pairings

Do not assume all tokens can be combined arbitrarily. Calculating WCAG sRGB contrast from the supplied literals gives light `--accent2` on `--surface` approximately **4.466:1**, and on `--tint` approximately **4.369:1**. Both miss 4.5:1 for tag-sized text. The palette need not change: keep info-tag text on a compliant background, for example explicit `--bg` where its container would otherwise use surface/tint. Audit tags in headers, footers, callouts and selected/hovered rows. Borders/dots are not text; do not apply the text threshold to the field-border pair.

Specify actual foreground/background choices for each callout, secondary and ghost buttons, and ordinary/visited/navigation links. Generic link rules cannot override on-primary/on-danger text or selected nav text. Use the exact danger pairing `--error` / `--bg` in both schemes. Existing `.notice` defaults to info as requested; an explicitly identified saved result can use success without changing its words. Preserve alert/status semantics when adding decorative, `aria-hidden` SVG icons.

### 10. States and heading ownership

For role and target denials, render warning presentation, a single visible `Access denied` heading and a safe existing-route back link (default overview). Preserve status 403 and the role/target explanation. Update every shared caller and the fixture consistently. Give 404 neutral presentation without duplicating its shell title. Keep API unavailable/token rejected/error summary as errors, stale/replay states as warning, and read-only 503 distinct from generic upstream failure. Restyling a response must not change its status or retained nonsecret input.

### 11. Acceptance tests should use real controls where present

The listed pages do not each contain primary, danger, input and radio controls. Test each page in the matrix and assert the relevant controls where they exist: sign-in/edit for primary and fields, a typed delete confirmation for danger and its name field, the HTTP edit form for radios. Do not inject dangerous buttons onto the overview to satisfy a literal reading.

Read computed styles and compare them with **literal expected colors** from the issue in each scheme, not just with whatever the stylesheet declares as its own tokens. The old `LINK_COLOUR` and CSSOM test assumes blue and literal flat declarations; adapt those tests for tokens, media rules, and the intentionally distinct nav/ghost styles without dropping focus or visited-link coverage. Do not reimplement the design in test expectations or remove behavior assertions to accommodate a restyle.

## Derived acceptance check

The console implementation should demonstrate all of the following:

1. `bun run check` and `bun run check:browser` pass with existing quality gates and behavioral coverage intact. Extend the existing local fixtures/harness; no new runtime dependency, external test service or production fixture route.
2. The stylesheet remains solely `src/styles.ts` served as `/console.css`. Verify every requested light/dark token, `color-scheme: light dark`, typography, spacing/radii and component rules. No inline styles, extra stylesheet, font request, framework, build step or new `/console.js` behavior. Existing CSP and security headers remain exact.
3. In explicitly emulated **light and dark** contexts, check overview, checks list, HTTP edit, sign-in and a real typed-name delete confirmation at 390 px and desktop width. Check all present relevant controls; in particular primary fill/text are light `#271b32`/`#f2eeec`, dark `#dfd7d4`/`#271b32`; danger fill/border/text are light `#a4262c`/`#a4262c`/`#f2eeec`, dark `#f2a7ab`/`#f2a7ab`/`#271b32`; field fill/border/text are light `#faf8f7`/`#93847e`/`#271b32`, dark `#1f1529`/`#766877`/`#dfd7d4`. Assert hover, focused and invalid presentations separately so those states do not corrupt the base-color assertions.
4. Run axe with the existing WCAG tag set, including color contrast, on the five representative pages in both schemes; retain existing axe coverage of 403/404, account/team and both confirmation kinds. No suppressed contrast rule. Exercise visible info tags and representative callouts so actual token pairings are covered.
5. Measure a real edit-form radio and its label text: 18 px control, control on the left with vertically aligned text and 12 px gap, in a clickable row at least 44 px high; check checked option styling and keyboard selection. Ensure text inputs/selects/buttons meet their required target size and show the accent focus outline; text fields also show the specified focus/invalid rings.
6. At 390 px assert document `scrollWidth <= clientWidth` without root overflow hiding. The checks table's overflowing box has a tab stop, accessible name, visible overflow cue and focus outline; keyboard arrows change its horizontal scroll position and reach the last columns. Mobile nav overflow stays contained, while account/security/sign-out remain visible. Test long names, URLs and snippets as well as ordinary fixtures.
7. Verify the 236 px desktop sidebar, 64 px top bar, current nav treatment, role-filtered Instance group and logical focus order. Verify layout boundaries at 1180/1181, 900/901 and 719/720 for applicable shared grid/shell classes; the mobile content padding is 20/16/40. Panel/plain widths stay within the viewport.
8. All currently built screens use the shared treatment: setup/owner, sign-in/factor, authenticator and recovery results, account security/password/sessions/sign-out-all, Team/invites/role/remove/transfer/reset-link/reset-2FA, invite/reset link pages, checks list/detail/new/edit/shadowed/export UI, overview and shared states. Preserve export as the same redacted download, not a new HTML screen. Use layout assertions/manual inspection beyond the five representative pages; do not add unbuilt feature screens.
9. A real denied route still returns 403, shows `Access denied` once, names the appropriate role/target reason, has warning colors and a working overview link. A real unknown page stays 404 with neutral treatment. Shared failure/conflict/validation states preserve response status, error associations, alert semantics and kept input.
10. All typed and destructive plain confirmation submits have danger styling and error-bordered panels; safe plain confirmations use primary. Include real delete, invite revoke, remove and `Make owner` callers and account-specific confirmations in markup assertions. Both confirmation types, cancellation and actual account/check/team forms still work without JavaScript; replay and stale-version tests remain intact.
11. Retain busy-button and copy tests with JavaScript enabled, including hidden/selectable copy fallback without it. No CSP console violations or new external asset requests in either theme. Preserve the default instance name, existing checks search/filter and settings/data text; #773's remaining fixes stay excluded.

This state only reviews and writes the artifact; it does not run or claim completion of the implementation's Bun/browser checks. The plan should require the console's normal manual smoke and report its commands/results when the implementation is handed off.
