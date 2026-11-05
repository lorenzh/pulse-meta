# Spec #741: console account pages in the app shell, and the rough edges

The app shell of #718 and the account pages of #563 landed in separate children. The account
pages still render as standalone plain documents with no header, no navigation and no way back.
This spec puts `/account/security`, `/account/sessions` and the two account confirmations inside
the shell. It also fixes five smaller defects: the doubled 404 title, the "pulse-api cannot be
reached" state that does not say what kind of failure happened, unstyled links, missing space
between stacked forms, and the signed-in e-mail address that splits at its hyphen at 390 px.

Sources read for this spec: issue #741 and its comments (only the Factory issue-review claim; no
owner decisions), `.factory/work/741/issue-review.md`, the #460 amendment of 2 November
(issuecomment-6589563362, section 14: "'pulse-api cannot be reached' with timeout, network or
status"; section 15: mobile), the predecessor specs `.factory/work/718/plan.md` and
`.factory/work/563/plan.md`, and these clones: `console` at `76dab43` (the screenshot revision
`fa92054` from the issue is historical), `contract` at `9ab7e24`, plus contract `src/client.ts`
at the console pin `176fb6ed14b2f14b730a9fd1757239f210f97a29` (fetched with `gh api`), `config`
`main`, plus `check.yml` and `biome.json` at the console pin `04108fa0` (fetched with `gh api`;
both are byte-identical to the clone), and `deploy` `e2e/console-setup.sh`.
Shared findings: none. `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/741`
answered HTTP 404.

## Goal

Every full-session account page that a person reaches from the shell header looks like the rest
of the console. It has the header with name, e-mail and role, the main navigation, and a clear
way back. Both confirmations have Cancel. The other defects named in the issue are fixed and
covered by `bun run check:browser`.

## Scope

Only the `console` repository changes. The scope has seven parts:

1. **Shell for the four account pages.** These pages render through `shellPage` (`src/shell.ts`):
   `GET /account/security`, `GET /account/sessions`, `GET /account/sessions/sign-out-all` and
   `GET /account/recovery-codes`. So do all their re-renders of the same page: 401 wrong
   password, 422 password format, 429 throttled, 409 form expired and 409 "credentials changed".
2. **Cancel and back links.** The two confirmations get a Cancel link. `/account/sessions` gets a
   link back to account security.
3. **404.** The page shows one visible title and one plain sentence that says what to do.
4. **API failure kind.** The Overview failure state names the kind of failure: timeout,
   connection refused, network error or status. A refused connection is told apart from other
   network errors by structured transport data.
5. **Link and form spacing styles.** One link colour rule covers normal and visited links. Forms
   that follow each other get a gap.
6. **E-mail at 390 px.** The e-mail address in the header moves to the next line as one unit.
   When it is wider than the line, it wraps inside itself and is never cut off.
7. **Browser and HTTP tests** that prove each part, and docs.

## Non-goals

- No change to any security rule. This covers access gates, stages, the 2FA gate, role checks,
  CSRF, single-use form tokens and their binding paths, the POST order, throttles, race guards,
  status codes, redirects, cookies, `cache-control`, the referrer policy, the CSP and the single
  `/console.js` element. No new dependency, no new script and no inline style.
- No shell for these pages: `/account/password`, `/account/authenticator` (all stages, including
  `enrol`, which must never get a signed-in shell), the pending-expired 409, the once-only
  recovery-code result page, `/sign-in/factor`, the replay page "Already submitted"
  (`alreadySubmittedPage`) and the `messagePage` error pages (no key 503, decrypt 500, not saved
  500). They keep `plainDocument`. Only the CSS of part 5 reaches them.
- No new navigation entry and no `NavId` for account pages. No navigation entry is marked
  `aria-current` on an account page.
- No change to the account page contents beyond what this spec names: the data, sentences, field
  labels, button labels and link targets stay. There is one removal. The duplicate in-body
  "Sign out" form on `/account/sessions` goes, because the shell header already has the one
  "Sign out" form (see Required behavior 1).
- No change to the setup connection test (`src/connection-test.ts`). Its texts stay as they are.
- No change to contract, api, deploy or config.

## Decisions taken in this spec

The issue review lists these as working assumptions. None of them needs a decision from the
owner.

- **D1, the way back.** On every shell page, the navigation's "Overview" link (`/`) is the way
  back to the Overview. On top of that:
  - `/account/sessions` gets `<p><a href="/account/security">Back to account security</a></p>`
    after the "Sign out all other sessions" link.
  - Sign out all gets a Cancel link to `/account/sessions`.
  - New recovery codes gets a Cancel link to `/account/security`.

  Cancel is a plain `<a class="cancel">` inside the same `<div class="actions">` as the primary
  button, directly after it. This is the markup of `src/confirm.ts:56-57`. It is a GET link
  without JavaScript and sends nothing. The generic `plainConfirmPage` is **not** reused: it adds
  a hidden `revision` field, and these routes do not read one.
- **D2, failure wording.** The failure state keeps its heading `pulse-api cannot be reached`.
  It adds one paragraph `Kind: <kind>` before the existing detail paragraph. The four kinds are:

  | Failure | Kind paragraph | Detail paragraph |
  |---|---|---|
  | deadline of 5000 ms expired (`fetchJson` `timeout`) | `Kind: timeout` | `pulse-api did not answer within 5 seconds.` (unchanged) |
  | `network` with a refused-connection code | `Kind: connection refused` | `The connection to <origin> was refused. Check that pulse-api is running at this address.` |
  | any other `network`, or `aborted` | `Kind: network error` | `pulse-api cannot be reached at <origin>.` (unchanged) |
  | `http` | `Kind: status <n>` | the existing `httpText` sentence (unchanged) |

  `wire-mismatch`, `missing-header` and `invalid` keep their heading
  `pulse-api sent an answer the console cannot use` and get no kind paragraph.
- **D3, refused detection.** The failure is `refused` when the contract error is
  `{ kind: "network", cause }` and `cause`, or `cause.cause` one level down, has an **own data
  property** `code` whose value is exactly `"ConnectionRefused"` or `"ECONNREFUSED"`. Reading
  that property never runs a getter: use `Object.getOwnPropertyDescriptor` and accept only
  descriptors that have a `value`. Wrap the read in `try`/`catch`, so that a Proxy that throws
  gives `network`.
  - Bun 1.4.0 behaves as follows. This was checked for this spec with `bun 1.4.0` on Linux and
    must be re-checked by the implementer's test. `fetch` to a closed 127.0.0.1 port rejects
    with a `TypeError` whose own data property `code` is `"ConnectionRefused"`. It has no
    `cause`.
  - A host that does not resolve gives `code: "ENOTFOUND"`, which counts as `network`.
  - `ECONNREFUSED` covers a `fetch` that follows the Node style (`cause.code`). The fake fetch
    in the tests uses that style.
  - The message text, the elapsed time and the URL are never used to classify a failure.
- **D4, false timeout.** Source and test inspection at `76dab43` show that a refused read already
  ends as `network`, not `timeout`:
  - `src/server.overview.test.ts:263-271` (closed port) passes.
  - `src/overview-read.test.ts:281-289` passes.
  - The pinned contract's `fetchJson` returns `timeout` only when its own scheduled timer has
    fired (`client.ts:192-193` at `176fb6e`).

  The screenshot that shows "5 seconds" cannot be traced to a refused connection on `main`. The
  spec therefore does **not** rewrite the transport or the deadline. It makes each kind visible
  and pins every path with a test through the real `fetchJson`:
  - a refused connection has no `5 seconds`;
  - a deadline that really fired has it;
  - a 503 is a status, not a timeout.

  If the implementer's first red test does reproduce `5 seconds` for a refused connection on the
  real path, that is a bug in this scope. Fix it in `src/overview-read.ts` or
  `src/api-failure.ts` and name the cause in the PR. Never fix it in the contract.
- **D5, the e-mail.** The address goes into `<span class="account-email">(<email>)</span>`, and
  the parentheses go inside the span. CSS: `.account-email { display: inline-block; max-width:
  100%; }`.
  - An inline-block is one atomic box in its line. When it does not fit after "Signed in as
    <name>", it moves to the next line whole, so no break at the hyphen.
  - Its shrink-to-fit width is at most the line width. An address wider than the line therefore
    wraps inside the box (the existing `overflow-wrap: anywhere` is inherited), stays fully
    visible and causes no horizontal scroll.
  - There is no truncation, so there is no hidden full address to expose.
- **D6, the 404 body.** `notFoundState()` (`src/states.ts:84-86`) no longer renders the `state`
  box with its own `h2`. It returns
  `<p>There is no page at this address. Check the address, or go to the overview.</p>`, followed
  by the existing `<p><a href="/">Go to the overview</a></p>`. The page's one visible title is the
  shell `h1` `Page not found`. This also covers the two other callers: `team-routes.ts:59` and the
  fixtures `test/fixture-routes.ts:244` and `:331`.
- **D7, styles.**
  - `a, a:visited { color: #1b4f9c; }` is added to `/console.css`. This is the colour that
    `nav a` already uses (`src/styles.ts:31`). It is placed before the `nav` rules, so that
    `nav a[aria-current]` still applies.
  - `form + form { margin-top: 1rem; }` (16 px at the default font size) is added.
  - `.actions { align-items: center; }` is added to the general `.actions` rule.
  - The focus rule `a:focus-visible` (`src/styles.ts:12`) stays.
  - No other colour, size or layout changes.

## Required behavior

1. **Account shell renderer.**
   - Add an account-page shell helper in `src/http-context.ts`, which is the module that
     `account-routes.ts` already uses for `Ctx` and `sessionForm`. It renders
     `shellPage({ instanceName: ctx.deps.instanceName, user: current.user, role, csrf:
     form.csrf, signOutToken: form.signOutToken, current: undefined, title, body })`.
   - `role` comes from one shared function `roleOfUser(ctx, user)`
     (`ctx.deps.roleOf?.(user) ?? user.role`). That function moves from `src/server.ts:328-330`
     into `http-context.ts`, and `server.ts` imports it. The test override `roleOf` therefore
     reaches account pages exactly as it reaches the Overview.
   - The helper never issues tokens itself. It takes the `SessionForm` of the one `sessionForm(ctx)`
     call per response, so each response issues the same tokens as today:
     - one form token for the page path (when the page has a form);
     - one for `/sign-out`;
     - none for HEAD (`sessionForm` already returns `""` for HEAD, `http-context.ts:214-215`).
   - `securityPage` has no form today and issues no token. It may call `sessionForm(ctx)` for
     the header's sign-out token. It may also use a variant that issues only the `/sign-out`
     token. Either way it must not issue a usable page token for HEAD.
2. **Four pages as shell parts.**
   - `securityPage`, `sessionsPage`, `signOutAllPage` and `newCodesPage` in
     `src/account-pages.ts` return the shell's `title` and `body`, not a full document. Each
     handler and re-render in `src/account-routes.ts` that sends them wraps the parts with the
     helper of item 1. This covers `sendSecurity`, `sendSessions`, `sendSignOutAllForm`,
     `postSignOutAll` (409 expired, 409 changed), `sendNewCodesForm` and `postNewCodes` (via
     `newCodesView`: 401, 422, 429, 409 expired, 409 changed).
   - Titles stay: "Account security", "Sessions", "Sign out all other sessions",
     "New recovery codes".
   - The result is exactly one `<!doctype html>`, one `<h1>`, one `<header class="shell-header">`,
     one `<nav aria-label="Main">` and exactly one `<script src="/console.js" defer></script>`.
   - `sessionsPage` drops its in-body sign-out form. The page then has exactly one form with
     `action="/sign-out"`, the one in the header. Playwright's
     `getByRole("button", { name: "Sign out", exact: true })` must stay unambiguous for
     `e2e/run.ts:460`.
3. **Cancel and back links** as in D1.
   - After a 409 or 401 re-render, Cancel and the back link are still there.
   - The successful recovery-code result keeps its single `Continue` link to its existing `next`
     and gets no Cancel.
4. **404** as in D6.
   - Unchanged: status 404, shell, the full-session GET/HEAD rule, a HEAD body of `""`, and the
     plain `not found\n` for POST, for anonymous requests and before setup.
5. **API failure kinds** as in D2 and D3.
   - `src/api-failure.ts` gains the `ApiFailure` variant `{ kind: "refused"; origin: string }`
     and an exported kind-label function (for example `apiFailureKind(failure): string |
     undefined`). `apiFailureOf` maps `network` to `refused` or `network` using D3.
   - `apiUnavailableState` (`src/states.ts:35-42`) renders `<p>Kind: …</p>` before the detail
     paragraph.
   - `src/overview-read.ts` keeps its log line exactly: one `warn` `api read failed` per failed
     read with `call`, the contract `kind` and, for HTTP, `status`. No URL, body, token,
     exception message or `code` value is logged or rendered.
   - Precedence stays: no token, config 401 means token rejected, config failure, checks failure,
     missing header.
   - Add the fixture `["api-refused", { kind: "refused", origin: "http://127.0.0.1:9" }]` to
     `API_FAILURES` (`test/fixture-routes.ts:290`) and `/__test/states/api-refused` to
     `FIXTURE_PAGES` (`e2e/run.ts:103`).
6. **Styles** as in D7, in `src/styles.ts` only.
7. **E-mail** as in D5. Change `src/shell.ts:47`, add the rule to `src/styles.ts`, and update the
   expectation in `src/shell.test.ts`.
8. **Fixture e-mail.** `test/signed-in-console.ts` gains the optional `ownerEmail` in
   `SignedInOptions`. It defaults to the existing `OWNER_EMAIL`, so every existing HTTP test is
   unchanged. `e2e/run.ts` starts its env with `ownerEmail: "demo-owner@example.com"` and signs
   in with it.

## Performance impact

None expected. Only the console changes, and the change is a few lines of server-rendered HTML,
CSS and one classification branch. No metric of `bench/budgets.json` in the api repository can
move: `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, or the
reported wall-clock startup, p95 latency, requests per second and image size all measure
pulse-api. The api's code and image are untouched. No A/B run is needed.

## Security impact

Security impact: yes. The change re-renders authenticated account and confirmation routes, and
it classifies upstream transport errors whose objects come from outside the console into page
text.

Checklist items that apply:

- **Secrets in errors, logs and responses.**
  - Failure text holds only fixed sentences, the saved API origin (no path, no query, no
    credentials) and the integer status.
  - The `cause` message, any `code` value other than the two matched literals, the upstream body
    and the admin token never reach HTML or logs.
  - Account pages show no session id and no other session's CSRF.
  - The header renders the same csrf and sign-out token as before.
- **Auth order and status codes.**
  - The gate stays at `server.ts:272` (`passesGate`, stage `full` for all four routes) and still
    runs before any rendering.
  - Every status code stays: 200, 303, 401, 403, 409, 415, 422, 429.
  - `enrol` and `factor` sessions still get 303 to their stage target, never a shell.
  - HEAD issues no stored form token.
  - The header sign-out form and the page form carry tokens bound to `/sign-out` and to the page
    path respectively. A token from one is refused at the other.
- **Accessor execution.** `cause` is an unknown runtime object. Read `code` only as an own data
  property, inside `try`/`catch` (D3). A getter or Proxy on `cause` must not run code or crash
  the request.
- **Input validation.** No new input is read. The Cancel and back links are fixed literals and
  carry no user value.

These items do not apply: body and size limits, SSRF and redirects (the fetch, `redirect:
"manual"` and timeout are unchanged), file writes, and dependency pins (none added).

## Rollout order

One repository: only `console` changes. Its only consumer is the `deploy-dev` CI job, which runs
`e2e/console-setup.sh` of deploy `main`. That script keeps working:

- It reads the first `csrf` field (`console-setup.sh:60-64`). The header's sign-out form carries
  the same session CSRF value as the page form.
- It reads the `form_token` of the form whose action is exactly the POST path (`:66-88`).
- It looks for `This browser` and `Signed in as` (`:308`, `:273`), and both stay.

## Counterexamples

- **Refused vs timeout.**
  - A Bun `fetch` to a closed 127.0.0.1 port that rejects at once with `code
    "ConnectionRefused"` must render `Kind: connection refused` and must not contain the
    substring `5 seconds`. A wrong implementation would treat any `network` as a timeout, or
    show the timeout sentence for every unreachable state.
  - A held upstream reply whose 5000 ms deadline fires through the scheduler injected into the
    real `fetchJson` must render `Kind: timeout` and `5 seconds`.
  - A preconstructed `{ kind: "timeout" }` passed to the renderer does not count as proof of the
    real path.
- **Message is not a code.** A fake `fetch` that rejects with
  `new TypeError("ECONNREFUSED connection refused sentinel")`, with no `code` property, must
  render `Kind: network error`. Matching on the message is wrong. The sentinel text must not
  appear in the body or in the logs.
- **Accessor.** A fake `fetch` that rejects with an object whose `code` is a getter that throws
  (or that records a call) must render `Kind: network error`. The getter must have been called
  0 times, and the request must still answer 200.
- **Nested code.** A rejection `new TypeError("x", { cause: { code: "ECONNREFUSED" } })` renders
  `Kind: connection refused`. A cause nested two levels down (`cause.cause.cause.code`) does
  not count and renders `Kind: network error`.
- **Status is not a timeout.** A `/checks` answer of 503 renders `Kind: status 503` and
  `pulse-api answered 503.`, and no `5 seconds`. A config 401 still shows the token banner and no
  kind paragraph.
- **404 title count.** In the body of `GET /no-such-page` with a full session, the string
  `Page not found` occurs exactly 2 times: once in `<title>Page not found · …</title>` and once in
  `<h1>`. There is no `<h2>Page not found</h2>`. With `POST /no-such-page`, or with no cookie,
  the body is exactly `not found\n`.
- **Stage gate.** `GET /account/security` with an `enrol` session answers 303 to
  `/account/authenticator`. With a `factor` session it answers 303 to `/sign-in/factor`. Neither
  answer has a body with `shell-header`.
- **HEAD.** `HEAD /account/sessions/sign-out-all` answers 200 with an empty body. The number of
  issued form tokens is the same before and after. A form token taken from an earlier GET is
  still accepted once.
- **One sign-out form.** `/account/sessions` with two sign-out forms is wrong: the count of
  `action="/sign-out"` must be exactly 1.
- **Cancel sends nothing.** Without JavaScript, opening
  `/account/sessions/sign-out-all` and clicking Cancel must leave a second browser signed in. A
  wrong implementation would make Cancel a submit button of the form.
- **Cancel on the result page.** The recovery-code result page with a Cancel link is wrong.
- **E-mail split.** At a 390 px viewport, `demo-owner@example.com` rendered as `(demo-` on one
  line and `owner@example.com)` on the next is wrong. The check: the client rects of a `Range`
  over the text of `.account-email` must have exactly 1 distinct `top` value, rounded to whole
  px.
- **Visited colour.** A rule `a { color: #1b4f9c; }` without `a:visited` leaves visited links
  purple and is wrong. A browser check that reads `getComputedStyle(a).color` on a visited link
  cannot catch this, because browsers report the unvisited colour for privacy. The checks read
  the stylesheet rules and the served CSS text against the literal colour instead.
- **Long e-mail.** A 70-character address (`"a".repeat(58) + "@example.com"`, length `70`)
  must give `document.documentElement.scrollWidth <= 390`, and the span's `textContent` must equal `(` + the full address + `)`. A wrong fix uses
  `white-space: nowrap` with no wrap fallback, which overflows. Another wrong fix uses
  `overflow: hidden` on `html` or `body`, which `assertFits` (`e2e/run.ts:146-155`) rejects.
- **Gap.** On `/sign-in/factor` at 390 px, the vertical gap between consecutive `<form>`
  elements must be at least 12 px: next form's `getBoundingClientRect().top` minus the previous
  form's `bottom`. 0 px is today's value.

No statistics are defined by this spec.

## Contract fields

These new names stay inside the console. None is a wire field or a contract name:

- `ApiFailure` kind `"refused"`
- the kind-label function (suggested `apiFailureKind`)
- the refused predicate (suggested `isConnectionRefused`)
- the account shell helper (suggested `accountShell`)
- the CSS class `account-email`
- the fixture route `/__test/states/api-refused`
- the `SignedInOptions` field `ownerEmail`

No contract field, key or API route is added or renamed. Searches run for this spec:

```sh
grep -rn '"refused"' .repos/contract/src .repos/config          # no hit
grep -rn 'refused' .repos/contract/src                           # one comment, schema.ts:806 ("control characters are refused"), not a name
grep -rln 'account-email\|api-refused\|ownerEmail\|isConnectionRefused\|apiFailureKind\|accountShell' .repos/contract/src .repos/config   # no hit
grep -rn 'ConnectionRefused\|ECONNREFUSED' .repos/contract/src .repos/config                          # no hit
grep -rn 'account-email\|api-refused\|ownerEmail\|isConnectionRefused\|apiFailureKind\|accountShell\|"refused"' .repos/console/src .repos/console/test .repos/console/e2e   # no hit
```

`roleOfUser` already exists in `src/server.ts:328`. It moves and is not a new name.

## Repository: console

Files:
- `src/account-pages.ts`: the four pages return shell parts; Cancel and back links; the
  sessions page loses its in-body sign-out form
- `src/account-routes.ts`: wraps the four pages and their re-renders in the shell
- `src/http-context.ts`: account shell helper; `roleOfUser` moves here
- `src/server.ts`: imports `roleOfUser`; no routing or gate change
- `src/shell.ts`: the `account-email` span
- `src/styles.ts`: link colour, `form + form`, `.actions` alignment, `.account-email`
- `src/states.ts`: 404 body; kind paragraph in `apiUnavailableState`
- `src/api-failure.ts`: `refused` variant, refused predicate, kind labels, refused text
- `src/overview-read.ts`: only if needed to pass the error through; its log fields stay
- `src/api-failure.test.ts`, `src/states.test.ts`, `src/shell.test.ts`,
  `src/overview-read.test.ts`, `src/server.overview.test.ts`, `src/server.security.test.ts`,
  `src/server.sessions.test.ts`, `src/server.recovery.test.ts`, `src/server.form-token.test.ts`,
  `src/server.test.ts`: new and updated tests
- `test/fixture-routes.ts`: `api-refused` fixture
- `test/signed-in-console.ts`: optional `ownerEmail`
- `e2e/run.ts`: browser checks
- `README.md`, `docs/configuration.md`: wording of the account pages, the 404 and the Overview
  failure state

Behavior change: yes. The account pages, the 404, the failure state, the CSS and the header
markup all change visibly.

### Tool facts

Each fact is verified in a file:

- **Runtime.** Bun `1.4.0` (`package.json:9` `engines`, `:35` `packageManager`).
- **`bun run check`.** It runs `bun run lint && bun run typecheck && bun run test`
  (`package.json:18`):
  - lint is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`);
  - the typecheck also covers `e2e` (`package.json:13`), so `e2e/run.ts` must type-check;
  - test is `bun test` (`package.json:14`).
- **Coverage.** `bunfig.toml:2-4` sets coverage on, a line threshold of 0.8, and ignores
  `**/*.test.ts` and `test/**`.
- **Biome.** Biome `2.6.3` (`package.json:23`). `biome.json` only `extends`
  `@lorenzh/pulse-config/biome.json`. At the pin `04108fa0`, that file includes `**` and
  excludes `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`
  (pulse-config `biome.json:8-18`; identical to the clone). So `e2e/` and `test/` are linted.
  The SonarJS limit of 15 for cognitive complexity is stated in console `AGENTS.md` ("Tests
  (TDD)").
- **CI.** `ci.yml:18` calls pulse-config `check.yml@04108fa0`. That workflow runs Bun 1.4.0,
  `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and `bun run test`
  (pulse-config `check.yml:22-38` at the pin; identical to the clone). `ci.yml` also has the jobs
  `docker` (`:20`), `deploy-dev` (`:210`) and `browser` (`:270`). `browser` runs
  `bun run check:browser` (`:287`), which is `bun e2e/run.ts` (`package.json:19`), with Playwright
  `1.64.1` (`package.json:28`) and Chromium.

### Behavior

Required behavior 1 to 8 and decisions D1 to D7 above apply. Guidance:

- Keep each page renderer pure. The routes call the single `sessionForm(ctx)` and pass its result
  into both the page part and the shell.
- `newCodesView` stays the one re-render function of `/account/recovery-codes`, so every error
  path (401, 422, 429, 409) gets the shell through it.
- `CREDENTIALS_CHANGED_TEXT` 409s still render with the current request's user. The page may show
  the shell even when the session row was just removed by a race. The page is informational, and
  its tokens are bound to the gone session, so they are unusable.
- Keep the busy-button contract. Submit buttons stay plain `<button type="submit">` or
  `submitButton`. Nothing is rendered `disabled`.

### Checks (TDD, tests first)

1. **HTTP shell tests.** Use `src/server.sessions.test.ts`, `src/server.recovery.test.ts`, or a
   new `src/server.account-shell.test.ts`. For each of the four GET routes with a full session:
   - status 200;
   - `<header class="shell-header">` and `<nav aria-label="Main">` occur exactly once each;
   - `<h1>` occurs exactly once and the title is the literal above;
   - `<a href="/">Overview</a>` is present without `aria-current`;
   - there is exactly one `<script`;
   - the `expectShell` headers of `server.security.test.ts:585-595` (CSP, referrer policy
     `same-origin`, `no-store`, no `style=`, no `on*=`);
   - the existing content: `of 10 recovery codes left`, `This browser`, the four security links,
     and the confirmation sentence.

   Also check:
   - The Cancel `href` is `/account/sessions` on sign out all and `/account/security` on new
     codes. Each sits inside the same `<div class="actions">` as the submit button.
   - `/account/sessions` has `Back to account security` and exactly one `action="/sign-out"`.
   - A wrong-password 401, a 422 and a 409 form-expired re-render of `/account/recovery-codes`,
     and a 409 form-expired re-render of `/account/sessions/sign-out-all`, carry the shell and
     the Cancel link.
   - With `roleOf` set to viewer, `/account/security` answers 200 with the nav holding Overview
     and no Team link.
   - The `enrol` and `factor` stage counterexamples are covered.
   - The HEAD counterexample is covered.
   - The recovery-code result has `Continue` and no `Cancel`.
2. **404 tests.** Update `server.security.test.ts:597-610` and `states.test.ts:56-57`:
   - `Page not found` occurs exactly 2 times (title and `h1`);
   - no `<h2>Page not found</h2>`;
   - the literal sentence of D6;
   - `<a href="/">Go to the overview</a>`.

   Keep the HEAD and plain-404 cases as they are.
3. **Failure tests.** These use `src/overview-read.test.ts`, `src/server.overview.test.ts` and
   `src/api-failure.test.ts`, through the real `readOverview` and `fetchJson`:
   - closed port: `Kind: connection refused` and the D2 sentence with the origin, no `5 seconds`;
   - held reply with a scheduler that records `ms === 5000` and fires after the fake API has
     received the request: `Kind: timeout` and `5 seconds`;
   - 503: `Kind: status 503`;
   - the message-only, accessor and nested-cause counterexamples;
   - sentinel texts absent from body and logs;
   - log fields unchanged (`call`, `kind: "network"` for refused, `status` only for HTTP);
   - Retry still links to `/`.

   Retry recovery: after a refused read, point the fetch back at a live fake API. The next
   `GET /` must show the summary. The existing tests of `connection-test.test.ts` must pass
   unchanged.
4. **Unit tests.**
   - `shell.test.ts` expects `<span class="account-email">(o@example.com)</span>`.
   - `states.test.ts` expects the kind paragraph for each of the four kinds and none for
     `invalid`.
   - The existing test `GET /console.css serves the stylesheet` (`src/server.test.ts:148`)
     also expects the served body to contain the literal line
     `a, a:visited { color: #1b4f9c; }` and the literal `form + form { margin-top: 1rem; }`.
     The expected strings are written in the test, not read from `CONSOLE_CSS`.
5. **Browser checks in `e2e/run.ts`** (`bun run check:browser`), with the env owner
   `demo-owner@example.com`:
   - **Layout.** In `checkLayout`, at 390 and at 1280 px, visit the four account routes and the
     re-render of a wrong password on `/account/recovery-codes`. For each:
     - `assertFits`;
     - `header.shell-header` and `nav[aria-label="Main"]` are visible;
     - one `h1`;
     - clicking the nav link `Overview` lands on `${base}/`.
   - **Viewer.** Repeat one account route with `env.role.current = "viewer"`. The nav has
     `Overview` and no `Team`.
   - **E-mail.** At 390 px, on `/` and on each of the four routes, the Range-rect check of the
     counterexample gives exactly 1 distinct top. Then start a second signed-in console with a
     70-character `ownerEmail`: `"a".repeat(58) + "@example.com"` (58 + 12 = 70 characters).
     The check first asserts that the address `length` is the literal `70`. On `/` the page
     fits at 390 px and the span text equals the literal full address in parentheses.
   - **404.** On `/does-not-exist`:
     - `page.getByText("Page not found", { exact: true })` has a count of 1 visible element;
     - the D6 sentence is visible;
     - clicking `Go to the overview` lands on `/`.
   - **Failure kinds**, through `/`:
     - *refused:* `startEnv` passes a `fetch` wrapper to `startSignedInConsole`. With
       `env.refuse.current` set, the wrapper sends the request to a 127.0.0.1 port that the
       check bound and closed. The page shows `Kind: connection refused` and its text does not
       contain `5 seconds`.
     - *timeout:* hold `/checks` (`isHeld: true`) and use a `schedule` wrapper. When
       `env.fastDeadline.current` is set and `ms === 5000`, the wrapper fires after a real
       100 ms; otherwise it uses `setTimeout(fn, ms)`. The page shows `Kind: timeout` and
       `5 seconds`.
     - *status:* 503 shows `Kind: status 503`.

     Then reset every switch and confirm that the summary is back.
   - **Links.** For the header `Account security`, a link on `/account/security`, the Cancel
     links and `Continue` on the recovery-code result, `getComputedStyle(a).color` is
     `rgb(27, 79, 156)`. This proves the unvisited colour only: browsers report the unvisited
     colour from `getComputedStyle` for a visited link, for privacy (MDN, "Privacy and the
     :visited selector"), so a computed-style read cannot detect a wrong visited colour.
     Tabbing to each link gives a non-`none` outline, using the `focusedOutline` helper
     (`e2e/run.ts:218`).
   - **Visited links.** The visited colour is checked on the rules, not on computed style. In
     the page, walk every `CSSStyleRule` of `document.styleSheets` (the one `/console.css`
     sheet). Expected values are literals:
     - at least 1 rule has `a:visited` in its `selectorText` selector list and
       `style.color === "rgb(27, 79, 156)"`;
     - every rule whose `selectorText` contains `:visited` has `style.color` equal to `""` or
       `"rgb(27, 79, 156)"`, so no later rule gives visited links another colour.
     A wrong implementation that writes only `a { color: #1b4f9c; }` leaves visited links in
     the browser's default purple and fails the first assertion.
   - **Gap.** At 390 px on `/sign-in/factor` (3 forms) and on `/account/authenticator` in its
     replace state (2 forms), each gap between consecutive forms is at least 12 px.
   - **No JavaScript.** Extend `checkAccountNoScript` (`e2e/run.ts:409`):
     - On the sign-out-all confirmation, click Cancel first. It lands on `/account/sessions`,
       and the second browser is still signed in (`GET /` is 200 with `Signed in as`).
     - Then confirm as today. The other browser ends.
     - On `/account/recovery-codes`, click Cancel. It lands on `/account/security` with the same
       `of 10 recovery codes left` count as before.
     - Then create codes as today: 10 codes shown once, and `Continue` goes to
       `/account/security`.
   - **Axe.** Add `/account/security`, `/account/sessions`, `/account/sessions/sign-out-all`
     and `/account/recovery-codes` to `checkAxe`. Each has 0 violations.
   - **CSP.** No CSP violation on any page.
   - **Focus order.** The order of `checkFocus` (`e2e/run.ts:231`) stays
     `Skip to content, Account security, Sign out, Overview`.
6. **Smoke check.** Run `PULSE_API_URL=http://127.0.0.1:9 bun start` and complete setup in a
   browser. Then:
   - open `/account/security` and both confirmations;
   - open an unknown path;
   - open `/` while nothing listens on port 9, and expect `Kind: connection refused`.

   Report the commands and what was seen in the PR.

### Completion evidence

- `bun run check` passes, with coverage at or above 0.8 lines.
- `bun run check:browser` passes, with the new checks named in its `ok:` output.
- CI is green: `check`, `docker` (both runners), `deploy-dev` and `browser`, with no job
  weakened.
- `README.md` and `docs/configuration.md` describe:
  - the account pages in the shell, with Cancel;
  - the 404 sentence;
  - the four failure kinds and their texts.
- The PR body lists the commands run and the D4 finding: whether the false timeout reproduced.

Expected values in these checks come from literals written in this spec: status codes, the
strings in D2 and D6, `rgb(27, 79, 156)` (the hex `#1b4f9c` from `src/styles.ts:31` before the
change), the 12 px gap, the counts 1 and 2, and the 390 px width. They do not come from the code
under test.
