# Spec #922: console uses the shared callout for every alert, and the audit runs in every route suite

## Goal

Every `role="alert"` and `role="status"` element on the Tokens and Probes pages becomes a shared
callout from `src/states.ts`, with the same text, role, status code and form behavior. The
existing audit `expectCalloutsOnly` (`test/rendered-audit.ts`) runs on the rendered bodies in the
seven server suites of the token, probe, incident, maintenance, notification and status-page
routes, so a hand-written alert fails a test from now on.

This spec builds on the issue review `.factory/work/922/issue-review.md` and keeps its file scope,
documentation decision and acceptance. It adds the measured baseline, the exact callout kind of
every render site, and the commands.

Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/922` answered
HTTP 404 on 2026-11-09, so there are no findings yet. Only one repository changes, so no question
repeats across sections and no shared finding is expected.

## Recorded inspection base

- console `main` = `45b2d48260476510fa697f0c9cb560fbae26432f` (the clone, and
  `gh api repos/lorenzh/pulse-console/commits/main` on 2026-11-09). This is the base of every
  number below. The implementer records the real `BASE` (`git rev-parse HEAD` before the first
  edit). If `BASE` differs from `45b2d48`, it reruns the baseline controls and the render-site
  search below on `BASE` and reports any difference before it edits.
- Tool facts (verified, cited):
  - Bun `1.4.0`: console `package.json:9` (`engines.bun`) and `:35` (`packageManager`), and
    `bun --version` printed `1.4.0`.
  - `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:18`);
    `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`:15`); `test` = `bun test`
    (`:14`); Biome `2.6.3` (`:23`).
  - `bunfig.toml:1-4`: `[test]`, `coverage = true`, `coverageThreshold = { lines = 0.8,
    functions = 0 }`, test files and `test/**` ignored for coverage.
  - `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned in `package.json:24` at
    `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. The pinned `biome.json` (read with
    `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=04108fa…"`) is byte-identical to
    the config clone (`88996cb`); its `files.includes` (lines 10-17) covers `src/**` and `test/**`.
  - CI: `.github/workflows/ci.yml:18` uses
    `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`. The pinned `check.yml` is
    byte-identical to the clone and runs Bun `1.4.0` (line 24), `bun install --frozen-lockfile`
    (26), `bun run lint` (28), `bun run typecheck` (30) and `bun run test` (38).
  - Focused runs without coverage: `bun --config=<abs path>/empty.toml test <files>` with an empty
    file outside the checkout disables the `bunfig.toml` coverage gate (verified on `45b2d48`: no
    coverage table, exit 0). The form `bun test --config <empty> <files>` does **not**: it still
    prints the coverage table and exits `1` with `309 pass, 0 fail` (three runs on `45b2d48`). Use
    only the first form. Never edit `bunfig.toml`.

## Measured baseline on `45b2d48`

Install: `bun install --frozen-lockfile` in a scratch copy of the clone (125 packages).
`E` is an empty file created with the file tools in a directory outside the checkout.

| Control | Command | Runs | Result (each run) |
| --- | --- | --- | --- |
| B1 seven suites | `bun --config=$E test src/server.tokens.test.ts src/server.probes.test.ts src/server.incidents.test.ts src/server.incidents-write.test.ts src/server.maintenance.test.ts src/server.notifications.test.ts src/server.status-page.test.ts` | 3 | exit 0, `309 pass`, `0 fail`, `Ran 309 tests across 7 files` |
| B2 per file (same form, one file each) | tokens / probes / incidents / incidents-write / maintenance / notifications / status-page | 1 each | exit 0; 52 / 40 / 32 / 77 / 46 / 27 / 35 pass, 0 fail (sum 309) |
| B3 full check | `bun run check` (lint, typecheck, `bun test` with the `bunfig.toml` 80 % line threshold) | 3 | exit 0, `1993 pass`, `0 fail`, `Ran 1993 tests across 90 files` |

B1 test CPU (user+sys from `/usr/bin/time`, information only): 16.42, 16.33, 16.52 s.

The expected values of these controls are the literals in this table (counts from execution, not
from grep). The implementer repeats B1 three times on its `BASE` before edits and records exit
codes and counts. No coverage percentage is an expectation; B3 expects exit 0, the pass count and
the unchanged 80 % line threshold of `bunfig.toml:3`.

## Render sites (search on `45b2d48`)

Search: `grep -n 'role="\(alert\|status\)"\|state-' src/*.ts` without test files, plus every call
of the local `alert` helpers. Only the four token/probe modules render a role element that is not
a callout. Every other production hit is inside `callout` or a `check-state`/`state-tile` class
without a role.

A discovery run on `45b2d48` (scratch copy only, not a deliverable: `replyOf` in
`test/signed-in-console.ts` logged every reply body whose role tags fail the audit) found
offending bodies only in `src/server.tokens.test.ts` and `src/server.probes.test.ts`; the
incident, maintenance, notification and status-page suites rendered no offending body and no
`style`. So those five suites only gain the audit; their production code stays unchanged.

The required kind of every site. "alert" and "status" are the existing roles and do not change.
`callout(...)` means `callout({ kind, body: paragraph(text), role })` with `paragraph` from
`src/html.ts:52` (escapes the text); `alertCallout(text)` is `src/states.ts:59`.

| # | Site on `45b2d48` | Text | Role | Kind | Render with |
| --- | --- | --- | --- | --- | --- |
| T1 | `token-routes.ts:126` `selfBanner` no-token | `NO_TOKEN_TEXT` | alert | error | `alertCallout` |
| T2 | `token-routes.ts:128` `selfBanner` failed | `selfUnknownText(failure)` | alert | error | `alertCallout` |
| T3 | `token-routes.ts:155` `listBanner` | `lastAdminExpiryText(expiresAt)` | alert | **warning** | `callout` |
| T4 | `token-routes.ts:93-94` local `alert`: callers 108 (`NO_TOKEN_TEXT`), 282 (write answer message), 375 (inactive/own/last-admin refusal), 495 (`lacksScopeText`) | unchanged | alert | error | `alertCallout`; delete the local `alert` |
| T5 | `token-routes.ts:547` `alert(answer.notLogged)` | `SAVED_NOT_LOGGED_TEXT` | alert | **warning** | `callout` |
| T6 | `token-routes.ts:562` `alert(FORM_EXPIRED_TEXT)` | `FORM_EXPIRED_TEXT` | alert | **warning** | `callout` |
| T7 | `token-routes.ts:162` `revokedNotice` and `:547` revoked paragraph | `Revoked <name> (<id>).` | status | success | `callout` |
| T8 | `token-pages.ts:160` create-form `notice` | `formExpiredNotice` (from `server.ts:999`) | alert | warning (chosen by `alertCallout`) | `alertCallout` |
| T9 | `token-pages.ts:201` secret page `notLogged` | `SAVED_NOT_LOGGED_TEXT` | alert | **warning** | `callout` |
| P1 | `probe-routes.ts:75-76` local `alert`: callers 198 (`PROBE_LACKS_CHECKS_TEXT`), 219, 246, 304, 383 | unchanged | alert | error | `alertCallout`; delete the local `alert` |
| P2 | `probe-routes.ts:396` `alert(notLogged)` | `SAVED_NOT_LOGGED_TEXT` | alert | **warning** | `callout` |
| P3 | `probe-routes.ts:467` `alert(FORM_EXPIRED_TEXT)` | `FORM_EXPIRED_TEXT` | alert | **warning** | `callout` |
| P4 | `probe-routes.ts:121-124` list notice, `:396` revoked paragraph | `Revoked <name> (<id>).…` | status | success | `callout` |
| P5 | `probe-pages.ts:108` group warning | `No active token: new results will be refused.` | alert | **warning** | `callout` |
| P6 | `probe-pages.ts:182` form `notice` | `formExpiredNotice` | alert | warning (chosen by `alertCallout`) | `alertCallout` |
| P7 | `probe-pages.ts:206` `notLoggedHtml` | `SAVED_NOT_LOGGED_TEXT` | alert | **warning** | `callout` |

Why these kinds: `alertCallout` makes every text an error except the two shared form-expired
notices, so the bold warnings must call `callout` with `kind: "warning"`. The repository already
renders the same texts this way: `SAVED_NOT_LOGGED_TEXT` as a warning alert in
`incident-routes.ts:162`, `maintenance-routes.ts:325` and `notification-routes.ts:221`; the
identical expired-change text `CHANGE_EXPIRED_TEXT` as a warning alert in `check-routes.ts:535`;
success notices as `callout({ kind: "success", …, role: "status" })` in `account-pages.ts:20-24`
and `incident-pages.ts:65`. Probe pages that reuse `selfBanner` (`selfRefused` on `/probes/new`,
`/probes/rotate`, `/probes/revoke`) are fixed by T1/T2.

## Scope

- One repository: `console`, exactly the 13 paths of the issue review (listed in the repository
  section).
- Production: the four modules `src/token-routes.ts`, `src/token-pages.ts`, `src/probe-routes.ts`,
  `src/probe-pages.ts` (markup of the sites above only).
- Tests: the seven server suites run `expectCalloutsOnly` on their rendered bodies; the token and
  probe suites gain the scenarios that reach the uncovered sites.
- Docs: one added paragraph each in `README.md` and `docs/configuration.md`.

## Non-goals

- No change to `src/states.ts`, `src/html.ts`, `src/styles.ts`, `src/icons.ts`, `src/confirm.ts`,
  `src/server.ts`, `test/rendered-audit.ts`, `test/signed-in-console.ts`,
  `test/fixture-routes.ts` or any other test helper. No new helper, no CSS rule for
  `.state-error`/`.state-warning`, no new dependency.
- No change of text, route, status code, role, permission, form field, form token handling,
  API call, People row, log line or secret handling.
- No global audit in a shared test helper (`getPage`, `postForm`, `replyOf`): it would also reach
  `test/fixture-routes.ts:60` and unrelated suites.
- No cleanup of the existing local `post`/`fetch` helpers in the incident, maintenance,
  notification and status-page suites, and no merge of the identical constants
  `FORM_EXPIRED_TEXT` (`token-routes.ts:62`) and `CHANGE_EXPIRED_TEXT` (`check-routes.ts:439`).
  Both are existing duplications outside this issue; the PR names them as known limits.
- No other `src/server.*.test.ts` file gains the audit in this change (for example
  `server.team.test.ts`); only the seven listed suites render the routes of the issue.
- No design export sync, no Docker bench (#834).

## Required behavior

1. Each site in the table renders `<section class="callout callout-<kind>" role="<role>">` with
   the icon of `calloutIcon(kind)` and the unchanged text in a `<p>` inside
   `<div class="callout-body">`, exactly as `callout` builds it. No `state state-*` class and no
   `<p role=…>` remains in the four modules:
   `grep -nE 'state-(error|warning)|role="(alert|status)"' src/token-routes.ts src/token-pages.ts src/probe-routes.ts src/probe-pages.ts`
   prints nothing (expected: empty; the roles are passed as the `role` option of `callout`).
2. The two local `alert` helpers (`token-routes.ts:93`, `probe-routes.ts:75`) are removed; their
   callers use the shared `alertCallout` or `callout`. No new local wrapper that copies callout
   markup or the role attribute is added in any module.
3. Texts stay byte-identical and stay escaped: every body goes through `paragraph` of
   `src/html.ts`. A token or probe name with `<`, `>`, `&` or `"` appears escaped in the revoked
   notice.
4. Statuses, redirects, form tokens, API calls and People rows stay as on `BASE`; the existing
   assertions of the seven suites keep passing unchanged (only additions, plus the `groupOf`
   adjustment below).
5. Audit coverage: in each of the seven suites, every reply body that is an HTML page (any status,
   GET and POST, including error, refusal, form re-render, expired, revoked and not-logged pages)
   is passed to `expectCalloutsOnly`. Not audited: redirects (`303`/`302` with empty body), the
   `/metrics` text, and JSON. The raw fetch in `server.incidents-write.test.ts:918-929`, which
   reads and discards its body, audits that body too. An import of `expectCalloutsOnly` without a
   call on real page bodies does not count.
6. Non-vacuous: wherever a test now reaches a repaired site, it also asserts the visible message
   and the expected wrapper, for example
   `expect(body).toContain('<section class="callout callout-warning" role="alert">')` next to the
   expiry text, so a page that drops the banner cannot pass the audit by having no role element.

## Risks

- **Nested section.** A callout is a `<section>`. `groupOf` in `server.probes.test.ts:111-116`
  stops at the first `</section>` after the heading, so a group with the P5 warning would be cut
  before its credential table. Adjust `groupOf` (in the permitted file) so that it still returns
  the whole group (for example end at the next `<section class="location">` or the end of the
  list), and keep every existing `groupOf` assertion.
- **Wrong kind by default.** `alertCallout` turns `FORM_EXPIRED_TEXT`, `SAVED_NOT_LOGGED_TEXT`,
  the expiry text and the probe warning into errors. The table fixes the kind per site; tests
  assert it.
- **Coverage gate in focused runs.** See the tool facts: only `bun --config=$E test …` disables
  it. A red run that fails on coverage is not the required red.
- **Vacuous audit.** Auditing only the happy path, or bodies without any role element, proves
  nothing. Requirement 5 and 6 and the red runs below guard this.
- **Main moves.** If `BASE` is newer than `45b2d48`, redo the render-site search and the discovery
  check; a newly found hand-written alert in the four modules is in scope, one elsewhere needs a
  scope adjustment through review first (hold, do not widen the file list).

## Acceptance evidence

1. **Baseline on `BASE`.** B1 three times: exit 0, `309 pass`, `0 fail` each (literal expected
   values from the table above; a different `BASE` reports its own counts and the reason).
2. **Red before repair (test-only commit first).** Commit the test changes alone, then run the
   token suite and the probe suite with `bun --config=$E test <file>` three times each against the
   unchanged production code of `BASE`. Expected: exit 1 each run, `fail` > 0, every failure at
   `expectCalloutsOnly` (`test/rendered-audit.ts:10`) or at a new kind/wrapper assertion, with the
   received tag being a legacy `<section class="state state-…" role="alert">`, `<p role="alert">`
   or `<p role="status">`. Required failing tests (reproduced in a scratch prototype on
   `45b2d48`, three runs, `48 pass, 5 fail`, each failing at `rendered-audit.ts:10`):
   - expiry banner: received `<section class="state state-warning" role="alert">` (T3);
   - the three `self failures` cases 404/invalid/wire: received
     `<section class="state state-error" role="alert">` (T2);
   - a new `no admin token` test that starts the console with `adminToken: undefined` via
     `startTeamConsole` and opens `/tokens`: received `<section class="state state-error" role="alert">`
     (T1, and T4 for the body).
   Plus, after the full test additions, at least one failing test per remaining site group:
   T4/P1 refusal, T5/P2 and T9/P7 not-logged, T6/P3 expired change, T7/P4 revoked notice, P5 group
   warning. A coverage error, a timeout, a dependency error or a different assertion is not the
   required red. The five other suites with the audit pass on `BASE` (expected: exit 0 with their
   B2 counts plus any added tests); they are coverage, not regression tests, and the PR says so.
3. **Green.** With the production change: B1 form on all seven files three times, exit 0,
   `0 fail`, pass count = 309 + number of added tests (report the number and list the added test
   names). The same red tests pass.
4. **Full check.** `bun run check` exit 0 with the unchanged `bunfig.toml` threshold; report the
   pass count (base: 1993 + added tests). No exact coverage percentage is expected.
5. **Grep checks.** Requirement 1 grep prints nothing. `grep -n 'function alert' src/token-routes.ts src/probe-routes.ts`
   prints nothing. `grep -c 'expectCalloutsOnly' <file>` is at least `2` (import plus a call) in
   each of the seven suites, and the reviewer reads every page reply in those files to confirm
   requirement 5 (a grep count alone is not proof).
6. **Escaping.** A test lists a revoked token whose name is `<b>x</b> & co` through
   `/tokens?revoked=<id>` and asserts `Revoked &lt;b&gt;x&lt;/b&gt; &amp; co (<id>).` inside the
   success callout and the absence of `<b>x</b>`. The fake API serves token metadata, whose `name`
   is `trimmedText(Number.POSITIVE_INFINITY)` without a character rule
   (`.repos/contract/src/tokens.ts:114`; the same line in the pinned contract `96f33aa` under
   `node_modules`), so such a name is valid. Expected values are the
   literals in this item.
7. **Docs.** The two added paragraphs exist at the anchors below; every protected doc is
   byte-identical to `BASE` (scope check 8).
8. **Scope** at every task boundary, as in the repository section.
9. **Manual check.** `bun start` once (console `AGENTS.md`, "Before handoff of a user-visible
   change"), with a disposable `PULSE_CONSOLE_DB` and secret key file in a `mkdtemp` directory, no
   admin token and `PULSE_API_URL=http://127.0.0.1:9` (nothing listens). After setup and sign-in,
   `GET /tokens` and `GET /probes` show the no-token text inside
   `<section class="callout callout-error" role="alert">` with its icon, and no `style=`. Report
   the commands and result, never a real secret.
10. **Performance**, as in `## Performance impact`.
11. **Comments.** The change adds no new test file. Read every added line and list every added
    comment (inline ones included) in the PR body, or write `none` after that read.

## Performance impact

No runtime metric moves: the markup of a few rarely shown banners grows by the icon SVG and two
wrapper elements per banner; no request, query or start-up work changes. Of
`bench/budgets.json` in pulse-api only the kind "test CPU" applies, and only for the console's own
tests (the bench measures pulse-api, which does not change). Expected: about +0.1 to +0.6 s
user+sys on the seven suites (base B1: 16.33-16.52 s), from the extra regex scans of
`expectCalloutsOnly` and the few added tests. Startup CPU, load CPU, idle or peak RSS, build CPU,
startup wall-clock, p95 latency, requests per second and image size: none expected (no new
code path at start, no new file in the image; `ci.yml:36-47` keeps tests out of the image).

Measurement (information only, not a gate): interleave base, branch, base, branch, base, branch on
the B1 command with the same `node_modules`, record user+sys per run from `/usr/bin/time`, and
report delta = mean(branch user+sys) − mean(base user+sys) over the three runs each, in seconds
with two decimals, with the pass counts. Do not compare wall time; do not run the Docker bench
(#834).

## Security impact

Security impact: yes

The token and probe pages are admin routes (Admin and Owner) that show
names from pulse-api and, on the secret page, a show-once secret next to a changed notice; the
callout `body` is raw HTML, so a missing escape would be an injection.

Checklist items that apply:
- **Secrets in responses:** the secret page keeps the secret only in its one POST answer; the
  not-logged callout on that page holds only `SAVED_NOT_LOGGED_TEXT`. No secret, token or admin
  token text enters a callout, a log line or `/metrics` (the existing `secrets` test of
  `server.tokens.test.ts` stays and passes).
- **Input validation / output encoding:** every callout body is `paragraph(text)` from
  `src/html.ts`, which escapes. Hostile inputs for the security state: a token name and a probe
  location with `<script>`, `"><img src=x>` and `&amp;` in the revoked notices (T7, P4) and the
  probe group warning heading context (P5); a `selfUnknownText` reason built from a hostile
  status or body (it only carries the classified reason, never the body).
- **Auth order and status codes:** unchanged. Role checks (`403`), form token checks (`409`),
  self failure refusals (`502`/`503`) keep their statuses; the existing role tests stay and pass.
- Not affected: body and size limits (unchanged, the 413 test in `server.incidents-write.test.ts`
  only gains a body audit), SSRF and redirects, file writes, dependency pins, Dockerfile, CI.

## Rollout order

One repository: only pulse-console changes, and nothing else consumes its HTML. No contract, kit
or config pin changes; older services keep working because no API call or wire shape changes.

## Counterexamples

| Rule | Input or case a correct implementation handles, or a wrong one gets wrong |
| --- | --- |
| Expiry banner is a warning | `alertCallout(lastAdminExpiryText(t))` renders `callout-error`. Reject: the test expects `callout callout-warning" role="alert"`. |
| Not-logged text is a warning | `alertCallout(SAVED_NOT_LOGGED_TEXT)` on the revoked page or the secret page renders `callout-error`. Reject. |
| Expired change form is a warning | `alertCallout(FORM_EXPIRED_TEXT)` renders `callout-error`, because the text differs from `formExpiredNotice`. Reject. |
| Revoked notice keeps role status | `callout({ kind: "success", …, role: "alert" })` or `kind: "info"`. Reject. |
| Refusals stay errors | `callout({ kind: "warning", body: paragraph(lacksScopeText(…)) … })` for a `403`. Reject. |
| Same text | Rewording `NO_TOKEN_TEXT` or adding a title to a callout. Reject: existing `toContain` assertions and docs/tokens.md texts are unchanged. |
| No evasion of the audit | Dropping `role="alert"` from a banner, a regex change in `test/rendered-audit.ts`, or a new `.state-error` CSS rule. Reject: the role stays, the helper and `src/styles.ts` are protected. |
| No vacuous audit | Calling `expectCalloutsOnly` only on the happy `/tokens` page without a banner. Reject: the red run must fail on base for T1, T2, T3 at least. |
| Escaping | Body built as `` `<p>${text}</p>` `` without `escapeHtml`: a token named `<b>x</b>` renders bold. Reject: the escaping test sees `&lt;b&gt;`. |
| Coverage-off focused run | `bun test --config $E <files>`: on `45b2d48` it prints the coverage table and exits `1` with `309 pass, 0 fail`. Reject as control; use `bun --config=$E test <files>` (exit 0). |
| Nested section in groupOf | Leaving `groupOf` as is: after P5, `groupOf(body, "b-rep0")` ends at the callout's `</section>` and loses the credential table. Reject: all existing `groupOf` assertions still pass. |
| Scope | A diff touching `src/states.ts` or `test/signed-in-console.ts` (a global audit). Reject: protected path, scope check 7 fails. |
| Scope state | A protected change only staged, or committed and then restored in the worktree to `BASE`. Reject: index check, commit check and protected diff each catch it (fixture proof). |

Statistic: the only number defined here is the test-CPU delta of `## Performance impact`
(sample set: three base and three branch runs of B1, interleaved; per run user+sys of
`/usr/bin/time`; delta of the arithmetic means; two decimals; no percentile).

## Contract fields

No new names. The change adds no field, key, route, setting or exported name; it removes two
module-local functions (`alert` in `token-routes.ts` and `probe-routes.ts`) and uses the existing
exports `callout` and `alertCallout`. For the record: `grep -rn 'state-error\|state-warning' .repos/contract/src .repos/config/src`
prints nothing.

## Repository: console

Files:
- `src/token-routes.ts` (changed: T1-T7, delete local `alert`)
- `src/token-pages.ts` (changed: T8, T9)
- `src/probe-routes.ts` (changed: P1-P4, delete local `alert`)
- `src/probe-pages.ts` (changed: P5-P7)
- `src/server.tokens.test.ts` (changed: audit on every page body, `no admin token` test, tests
  for uncovered token sites, kind/wrapper and escaping assertions)
- `src/server.probes.test.ts` (changed: audit on every page body, tests for uncovered probe sites,
  kind/wrapper assertions, `groupOf` adjusted for nested sections)
- `src/server.incidents.test.ts` (changed: audit only)
- `src/server.incidents-write.test.ts` (changed: audit only, including the raw fetch at 918-929)
- `src/server.maintenance.test.ts` (changed: audit only)
- `src/server.notifications.test.ts` (changed: audit only)
- `src/server.status-page.test.ts` (changed: audit only)
- `README.md` (changed: one paragraph inserted after line 16)
- `docs/configuration.md` (changed: one paragraph inserted after line 139)

Behavior change: yes
Token and probe banners and notices gain the shared callout markup, kind styling and icons; texts, roles, statuses and form behavior stay the same.

### Shared modules to use

- `callout` and `alertCallout` from `src/states.ts` (lines 31, 59); `paragraph` from
  `src/html.ts:52` for every callout body.
- `expectCalloutsOnly` from `test/rendered-audit.ts:7`; existing test helpers
  `getPage`, `postForm`, `formTokenOf`, `replyOf` (`test/signed-in-console.ts`),
  `startTeamConsole` (`test/team-console.ts`), `startFakeApi`/`jsonReply` (`test/fake-api.ts`),
  `test/token-fixtures.ts` and `test/incident-api.ts`. No new helper and no copy of server
  setup. Call the shared assertion directly on each body; a small file-local function inside one
  suite that only calls `expectCalloutsOnly` on a reply is allowed when the suite already has such
  a local reply helper, but no change to a shared test helper.
- The repository already calls `callout({ kind, body: paragraph(…), role })` directly at each use
  (`incident-routes.ts:162`, `maintenance-routes.ts:325`, `notification-routes.ts:221`,
  `check-routes.ts:535`, `confirm.ts:62`). Follow that use; do not add module-local wrappers in
  `token-routes.ts` and `probe-routes.ts` (two such wrappers would be the same duplication as the
  two local `alert` helpers that this change removes).

### Behavior

As in `## Required behavior` and the site table. Production edits change only the markup of the
listed sites and the imports they need (`callout`, `alertCallout` from `./states.ts`;
`SAVED_NOT_LOGGED_TEXT` is not needed, the existing `notLogged` value is passed through).

### Tests

- `server.tokens.test.ts`: audit every page reply. Existing scenarios reach T2, T3, T4 (`403`,
  `409` refusals, `502`/`503`/`504` write answers), T5 (People insert failure, test at line 842),
  T7 (revoke redirect followed by `/tokens?revoked=`). Add: `no admin token` (T1, T4 no-token
  body); an expired change form, via a form token that is no longer valid on
  `/tokens/rotate` or `/tokens/revoke` (T6); an expired create form (T8, warning from
  `formExpiredNotice`); a create or rotate with a broken People log (T9) if not yet covered;
  the escaping case of acceptance 6. Assert kind and role next to each message.
- `server.probes.test.ts`: audit every page reply; existing scenarios reach P1, P4, P5. Add the
  sites not yet reached: P2 (revoke with a broken People log), P3 (expired change form), P6
  (expired add-location form), P7 (create or rotate with a broken People log), and
  `PROBE_LACKS_CHECKS_TEXT` (P1) if not yet covered. Adjust `groupOf`.
- The other five suites: audit every page reply, including the bodies that are only status-checked
  today. These pass on `BASE`.
- How to break a People log row or expire a form token: reuse the existing mechanisms. A People
  insert failure is `c.db.run("DROP TABLE people_events")` before the POST
  (`server.tokens.test.ts:842-856`). An expired form is a POST by an Admin with a valid `csrf` and
  an unknown `form_token` (for example `"x"`): `isProtectedTokenAccepted` (`src/server.ts:979-1006`)
  then calls the route's `renderForm` with `formExpiredNotice` and answers `409`
  (`expiredCreate`, `token-routes.ts:354`; `expiredChange`, `:585`; probe form `probe-routes.ts:287`;
  probe change `:461`). Do not add a new mechanism.

### Docs

Documentation inventory (from the issue review, rechecked on `45b2d48`): searched `README.md` and
every `docs/*.md` for alert, callout, banner, notice, audit and the touched texts.

- Changed: `README.md`, new paragraph after line 16 (the paragraph that starts "Each person has
  one console role"). Proposed text: "The Tokens and Probes pages show their banners and notices
  as the same callouts as the other pages: an error for a refusal or a failed read, a warning for
  the expiry of the last admin token, a location without an active token, an expired change form
  and a People log row that could not be written, and a success notice after a revoke."
- Changed: `docs/configuration.md`, new paragraph after line 139 (the paragraph that starts "The
  Tokens and Probes tables keep their column headers"): the same statement, plus that the alert
  and status roles stay as they were and that the texts are those of [tokens.md](tokens.md).
- Unchanged and still true (protected): `README.md:118-127,151-152` (route statuses),
  `docs/configuration.md:63,115,121,131,150,152-158,164,167,169`, `docs/development.md:23,25-26`
  (callout kinds, `alertCallout`, the audit: the helpers keep exactly this behavior),
  `docs/development.md:39,43-45,61,91`, `docs/tokens.md:23-33,44-46,92-114,130-152,166-169`
  (texts unchanged), `docs/checks.md:31-33,41,287-291`, `docs/incidents.md:3,9-18,53-62`,
  `docs/maintenance.md:3,9-14,43-50`, `docs/team.md:7-30`, `docs/index.md:5-11`, `AGENTS.md`
  (its rule "Every `src/server.*.test.ts` that renders a page runs `expectCalloutsOnly`" becomes
  more true and needs no edit), `CLAUDE.md`.
- `git diff "$BASE" HEAD -- README.md docs/configuration.md | grep '^-[^-]'` prints nothing
  (expected: empty; only lines are added).

### Scope checks (every task)

Record `BASE` before the first edit. With `ALLOWED` = the exact cumulative list of this task and
the earlier accepted tasks (a subset of the 13 files above), and
`PROTECTED` = `git ls-tree -r --name-only "$BASE"` minus the 13 files:

1. `git diff --name-only "$BASE" HEAD | sort` equals `ALLOWED` sorted (exact list, no wildcard).
2. `git diff --name-only --cached` prints nothing.
3. `git diff --name-only` prints nothing.
4. `git status --porcelain` prints nothing (catches untracked files).
5. `git diff --exit-code "$BASE" HEAD -- $PROTECTED` exits `0`.
6. `git diff --name-only "$BASE" HEAD` has at most the 13 listed paths.
7. The protected list includes `src/states.ts`, `src/html.ts`, `src/styles.ts`,
   `test/rendered-audit.ts`, `test/signed-in-console.ts`, `test/fixture-routes.ts`,
   `package.json`, `bun.lock`, `bunfig.toml`, `biome.json`, `tsconfig.json`, `.github/`,
   `AGENTS.md`, `CLAUDE.md` and every doc other than the two changed ones; a check on these names
   alone is not enough, use the full derived list.
8. Fixture proof (in a disposable `git init` directory outside the target, never in the target):
   run the same checker on (a) a clean allowed commit: pass; (b) a protected change only in the
   worktree: fails at 3/4; (c) a staged protected change: fails at 2; (d) a committed protected
   change: fails at 1 and 5; (e) an untracked file: fails at 4; (f) a staged protected change
   whose worktree bytes are restored to `BASE`: still fails at 2; (g) a committed protected change
   whose worktree bytes are restored to `BASE`: still fails at 1 and 5. Keep the outputs; finish
   with the real target clean. No fixture or evidence file enters the target.

### Suggested task cut (for breakdown)

1. Tests first: the audit and new scenarios in all seven suites and the `groupOf` adjustment;
   red evidence for the token and probe suites (acceptance 2), green for the other five on
   `BASE`. Commits only test files.
2. Repair: the four production modules and the two docs; green, full check, manual check,
   performance and the final scope checks over all 13 files.

The breakdown may cut differently, but the red evidence must come from the test changes against
the production code of `BASE`, and the same tests must turn green without being weakened.

### Completion evidence

The PR body names issue #922 (`Closes lorenzh/pulse-meta#<child>` as Factory sets it), lists
`BASE`, the baseline, red, green and full-check commands with exit codes and counts, the scope
check outputs and fixture proof, the CPU delta table, the manual check, every added comment (or
`none` after the full read), and the known limits (the duplicated expired-text constant, the
local post helpers of four suites, and other `server.*.test.ts` files that still do not run the
audit). No AI attribution.
