# Spec #762: console keeps JSON pointers on edit, adds missing checks-editor tests and guide

## Goal

Close the gaps that the review of Console PR #12 found (check screens, #751 / spec #567):

1. A name-only edit of a stored HTTP check changes a JSON pointer that ends in whitespace,
   because the shared form parser trims it. `"/status "` and `"/status"` are different RFC 6901
   pointers that select different keys, so the edit silently changes what the check asserts.
2. Spec #567 asked for committed checks and a guide that PR #12 did not deliver: Tab navigation
   through a Checks editor with a visible outline, all editors fitting a 1,280 px viewport with
   a width assertion, and a check-module guide in Console `AGENTS.md`. The PR body also labelled
   a coverage figure wrongly.
3. Added by the manager after the review of spec PR #800: the behavior is described in
   `README.md` and `docs/configuration.md` as well (Console `AGENTS.md`, "Documentation": update
   both when behavior changes), and the production entry point `bun start` is smoke-tested
   against a fixture API with a name-only edit whose outbound pointers are inspected.

This builds on the merged check screens (#751, Console PR #12) and the later layout work
(Console PR #18, Console `main` at `fc2c166`). Nothing of those screens is built again.

This spec replaces the spec of closed PR #800. It follows the issue review written after the
restart (`.factory/work/762/issue-review.md`) and keeps the two corrections of the earlier
plan review: `src/styles.ts` is a conditional file under one rule, and the heartbeat secret
offers Keep / Replace only.

## Scope

- `console` only:
  - the pointer read in `src/check-form.ts`;
  - a regression test at the parser (`src/check-form.test.ts`) and at the HTTP edit route
    (`src/server.checks-change.test.ts`);
  - two browser checks in `e2e/run.ts`;
  - the check-module guide in `AGENTS.md`;
  - documentation of exact pointers, keyboard focus and the 1280 px fit in `docs/checks.md`,
    `README.md` and `docs/configuration.md`, and the list of browser checks in
    `docs/development.md`;
  - the coverage labels, red/green evidence and the `bun start` smoke in the PR body.
- `src/styles.ts` changes only on the condition in Non-goals.

## Non-goals

- No change of the contract pin (`package.json:32`, `66818a24…`), the kit pin, routes, roles,
  the permission matrix, form tokens, CSRF order or the CSP.
- No change of trimming for any other field (id, name, URL, header names, numbers, resolver,
  expected status). Only `assert_<i>_pointer` changes.
- No migration of stored checks. No change of how `src/check-editor-page.ts` maps a stored view
  to form values: `assertValues` already copies the pointer unchanged
  (`src/check-editor-page.ts:166-177`).
- No coverage threshold, tooling, Biome, ESLint, TypeScript or CI change.
- No redesign of the editor. `src/styles.ts` changes only if a new browser check fails on the
  current styles:
  - Task 2 finds a stop without the `2px solid` focus outline: fix only that focus rule.
  - Task 3 finds an editor wider than 1280 px: fix only that editor's layout rule, never by
    hiding overflow.
  The PR body names each such change and the failing check that caused it. Without such a
  failure `src/styles.ts` stays unchanged.
- No new runtime or dev dependency. No committed smoke harness: the `bun start` smoke uses
  temporary files outside the checkout.

## Current behavior (verified at Console `fc2c166`)

- `src/check-form.ts:352-377` `assertRow`. Line 362 reads
  `const pointer = raw(r, \`assert_${i}_pointer\`).trim();`. Lines 363-369 reject a non-empty
  pointer that does not start with `/`. Then it builds `{ pointer, exists: true }` or
  `{ pointer, equals }`. Mode `none` returns before the pointer is read (line 361). Create
  (`parseCreateForm`) and edit (`parseEditForm`) share it.
- `src/check-editor-page.ts:166-177` `assertValues` puts `assertion.pointer` into
  `assert_<i>_pointer` unchanged. `editInputOf` (line 179) uses it. The edit form therefore
  renders `value="/status "`, and the parse on submit drops the space.
- Contract `src/schema.ts:210-221` (`isJsonPointer`, `jsonAssertSchema`) at the pin and on
  `main`: accepts `""` or a value that starts with `/`, checks `~` escapes and at most 256
  bytes, and never trims. A pointer with a trailing space is valid; one with a leading space is
  not.
- `src/check-form.test.ts` (block "parseEditForm with a trusted view", line 593, fixture
  `editFields` line 569) and `src/server.checks-change.test.ts` (`describe("POST /checks/edit")`,
  line 118) cover ordinary and empty pointers. No test has a pointer with surrounding
  whitespace.
- `src/server.checks-change.test.ts:32-40` `fakeApi(config)` serves `/admin/config`, `/checks`
  and a `SAVED` reply to `PUT /admin/checks/web`. `submit` (line 58) opens the page, takes its
  form token and posts. `WEB_EDIT` (line 85) is a valid edit of `web`. `sentBody` (line 98)
  parses the recorded PUT body.
- `e2e/run.ts:1258-1271` `EDITORS` lists the twelve editors: create and edit of http, tls, tcp,
  dns, domain and heartbeat. `checkScreensWith` (line 1348) runs with JavaScript on and off
  (`e2e/run.ts:2812-2813`). It sets 1280 × 800 at line 1430 and visits every editor only
  through `assertQuorumText` (line 1273), which checks text, not width. `assertFits` (line 254)
  measures `document.documentElement.scrollWidth` and rejects `overflow-x: hidden` on the root.
  `checkFocus` (line 681) tabs only through the shell; `focusedOutline` (line 673) and `tabTo`
  (line 710) are its helpers.
- `src/styles.ts:53` gives `a, button, input, select, textarea, summary, [tabindex]` a
  `:focus-visible` outline of `2px solid var(--accent)` at offset 3 px.
- Console `AGENTS.md` "This repository" (line 104 on) has guides for Team, Tokens and Probes but
  none for Checks.
- Docs: `README.md:16` describes the Checks list, detail, create and edit;
  `docs/configuration.md:133` describes the reads and writes of `POST /checks/edit`;
  `docs/checks.md` "Editor fields" (line 130) ends with the JSON assertion rows (line 169-170),
  and "Editor pages" (line 172) lists the editor layout. None says that a pointer is sent
  unchanged, that keyboard focus moves through an editor with a visible outline, or that the
  editors fit 1280 px. `docs/development.md:61` lists what `e2e/run.ts` checks.
- `package.json:12` `start` is `bun src/main.ts`. `src/main.ts` wires the real settings,
  database, clock and fetch. `bun e2e/run.ts --serve` starts a console with injected
  dependencies and fixture routes instead, so it is not the production entry point.
- Console PR #12 body line 26: "1308 pass, 0 fail, 98.05 % line coverage". `bunfig.toml:3` sets
  `coverageThreshold = { lines = 0.8, functions = 0 }`. Bun prints `% Funcs` and `% Lines`
  columns, and the review found the figure was not taken from the `% Lines` column.

Shared findings: none (`gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/762`
answers HTTP 404).

## Required behavior

1. **Exact pointer.** `assertRow` uses the posted `assert_<i>_pointer` value exactly as posted:
   no trim and no other normalization, for both Exists and Equals and for create and edit. The
   existing rule stays: `""` means the whole body; any other value must start with `/` or the
   field gets the existing message `Enter a JSON pointer such as /status, or leave it empty for
   the whole body.` Mode `none` still ignores the row.
2. **Name-only edit round trip.** A stored HTTP check whose `jsonAssert` is
   `[{ pointer: "/status ", equals: "ok" }, { pointer: "/ready ", exists: true }]` renders both
   pointers with the trailing space at `/checks/edit?id=<id>`. Submitting the form with only the
   name changed sends a PUT whose `jsonAssert` equals that stored array exactly and whose `name`
   is the new name.
3. **Keyboard traversal.** A committed browser check presses Tab through the HTTP create editor
   and the HTTP edit editor of `web`, with JavaScript on and off. At each stop it asserts the
   focused control and an outline of style `solid` and width `2px` (literal from
   `src/styles.ts:53`). The sequence is under Repository: console, Task 2.
4. **1,280 px fit.** A committed browser check visits every entry of `EDITORS` at a 1280 × 800
   viewport, with JavaScript on and off. After each navigation it asserts that the root does not
   scroll sideways (`assertFits(page, 1280, …)`) and that the `form.check-editor` box has
   `width > 0`, `left >= 0`, `right <= 1280` and `width <= 1280`.
5. **Guide.** Console `AGENTS.md` "This repository" gains a check-module guide (Task 4).
6. **Docs.** `docs/checks.md`, `README.md` and `docs/configuration.md` state the editor
   behavior at the level of each document (Task 5). `docs/development.md` lists the two new
   browser checks.
7. **Production smoke.** Before handoff, the implementer starts the console with `bun start`
   against a fixture API, completes the normal setup and sign-in, saves a name-only edit of a
   check with the two stored pointers, and inspects the PUT JSON that the fixture recorded
   (Task 6).
8. **PR body.** The PR body reports the coverage of the final `bun run check` run from the
   `All files` row of the Bun coverage table with both labels: `% Funcs` as function coverage
   and `% Lines` as line coverage, each copied as printed.

## Performance impact

None expected. The change is in Console only: it removes one `String.prototype.trim` call per
assertion row of a form POST and adds tests and docs. No metric of `bench/budgets.json` in the
api repository (startup CPU, load CPU, idle or peak RSS, test CPU, build CPU, wall-clock
startup, p95 latency, requests per second, image size) covers the Console, and the api is
unchanged. The Console image gains no file: the docker job checks that the image holds no test
files (`.github/workflows/ci.yml:20`, step "Check the image holds no test files or dev packages").

## Security impact

Security impact: yes. The change edits a parser of an untrusted POST body (`src/check-form.ts`,
the Console's trust boundary for check forms) whose value is echoed back into HTML.

Checklist items that apply:

- **Input validation:** validation becomes stricter, never looser. A value that the old code
  made valid by trimming (`" /status"`, `"   "`) is now rejected with the existing field message
  and no write. pulse-api still validates with the contract `jsonAssertSchema`; the Console adds
  no bypass.
- **Error and log texts that carry external data:** a rejected pointer is re-rendered in the
  retained form only through `escapeHtml` (the existing `input` helper), never in a log line,
  an error message or a header. The field message stays the fixed literal and never quotes the
  posted value.
- **Auth order and status codes:** unchanged. The dispatcher order (session, Origin, content
  type, body size, repeated fields, CSRF, role, form token) and the `422` for a field error stay
  as they are. A rejected pointer sends no PUT and does not use up the form token.
- **Secrets in errors, logs and responses (smoke only):** the `bun start` smoke uses a
  disposable admin token, secret key, password and TOTP seed in a temporary directory outside
  the checkout. None of them, the setup code, a session cookie or a form token goes into the PR
  body or a commit.

Not affected: body size limits, SSRF and redirects, file writes, dependency pins, Dockerfile,
CI.

## Rollout order

One repository: only `console` changes. The contract, api and every other service are
unchanged, and the Console keeps its contract pin, so older probes and services keep working.
Checks stored before this change keep their pointers; after the merge an edit stops changing
them.

## Counterexamples

Pointer parse (`parseCreateForm` / `parseEditForm`, row 0, mode as given):

| Posted `assert_0_pointer` | Mode | Must give | Wrong implementation gives |
| --- | --- | --- | --- |
| `"/status "` (stored, name-only edit) | equals `"ok"` | `{ pointer: "/status ", equals: "ok" }` | old code: `"/status"` |
| `"/ready "` (stored, name-only edit) | exists | `{ pointer: "/ready ", exists: true }` | old code: `"/ready"` |
| `"/a b\t"` (create) | exists | `{ pointer: "/a b\t", exists: true }` | trimming kept on create only |
| `" /status"` | exists | `422`, error on `assert_0_pointer` with the existing message, no POST or PUT to the api | old code: accepted as `"/status"` |
| `"   "` | exists | `422`, same error, no write | old code: `""`, a whole-body assertion |
| `""` | exists | `{ pointer: "", exists: true }` (unchanged) | an implementation that now rejects empty |
| `"/x "` | none | no assertion (row ignored) | an implementation that validates ignored rows |

Other fields keep trimming: name `" Web shop 2 "` still becomes `"Web shop 2"`, and URL
`" https://example.com/ "` still parses. An implementation that removes `.trim()` from `raw` or
from all of `src/check-form.ts` fails these.

Round trip: a test that posts a hand-written `assert_0_pointer: "/status "` without first
rendering the stored check does not prove requirement 2. The parser test takes the values from
`editInputOf(view)` of the stored view; the HTTP test checks the rendered `value` attributes
before it posts them. The expected PUT array is the literal fixture array, never the parser's
output.

Keyboard traversal:

- Calling `.focus()` on each control, or asserting only `document.activeElement` after one Tab,
  does not count. Each stop is reached by one `Tab` press from the previous one.
- An outline of style `none`, or of a width other than `2px`, at any stop fails.
- The expected sequence is a literal in the test, written from this spec. It is never built by
  querying the DOM for focusable elements in document order: such a list always matches.
- A radio group is one Tab stop at its checked radio; the test does not expect every radio.
- After the submit button one more Tab must move focus out of `form.check-editor` (no trap).

1,280 px fit:

- Setting the viewport without measuring, or measuring only `name` and `interval_ms`, fails the
  requirement.
- `overflow-x: hidden` on `html` or `body` must fail (`assertFits` already rejects it). An
  editor whose root `scrollWidth` is 1281 must fail, and a form box with `right` 1281 must fail.
- The width limit is the literal `1280`, not `window.innerWidth` read in the same run.

Production smoke:

- `bun e2e/run.ts --serve`, an in-process HTTP test or `startSignedInConsole` is not the smoke.
  The console process is started with `bun start`.
- A session row written straight into the database, a `/__test/` route or a `roleOf` override
  does not count. The smoke goes through setup, enrolment and the normal gates (session, Origin,
  CSRF, role, form token).
- A smoke that reports only the `303` but not the recorded PUT body proves nothing about the
  pointers. The expected pointers are the literals `"/status "` and `"/ready "`.

Coverage statistic: both figures come from the `All files` row of the text coverage table that
`bun test` (run by `bun run check`) prints for the final commit of the PR. `% Funcs` is the
share of functions run at least once and `% Lines` the share of executable lines run, both
over the files that `bunfig.toml:4` does not ignore, as Bun computes them, copied with the two
decimals Bun prints. A figure from an earlier run or from Console PR #12, or a `% Funcs` value
labelled as line coverage, is wrong. A focused run such as `bun test src/check-form.test.ts`
can fail the 80 % line threshold because it loads few files; its threshold result is reported
apart from whether its assertions passed or failed.

## Contract fields

No new names. The change adds no field, key, route or form field. It reuses the existing form
field `assert_<i>_pointer` (`src/check-form.ts:362`, rendered at
`src/check-editor-page.ts:411`) and the contract key `pointer` (contract `src/schema.ts:219`).
Proof that nothing new is introduced: the spec's only identifiers are these two, and
`grep -rn 'assert_\${i}_pointer' .repos/console/src` and
`grep -n 'pointer:' .repos/contract/src/schema.ts` find them as they are today.

## Repository: console

Files:
- `src/check-form.ts` (change: `assertRow` stops trimming the pointer)
- `src/check-form.test.ts` (new tests: exact pointer on create and on a name-only edit through
  `editInputOf`, the rejected leading-space and spaces-only pointers, empty pointer, other
  fields still trimmed)
- `src/server.checks-change.test.ts` (new HTTP tests: name-only edit of stored trailing-space
  pointers; a leading-space pointer gives `422` and no PUT)
- `e2e/run.ts` (new keyboard traversal check and 1,280 px editor fit assertion)
- `AGENTS.md` (check-module guide under "This repository")
- `docs/checks.md` (exact pointer under "Editor fields"; keyboard focus and 1280 px fit under
  "Editor pages")
- `README.md` (one sentence in the Checks passage, line 16)
- `docs/configuration.md` (one sentence in the Checks reads and writes passage, line 133)
- `docs/development.md` (the browser-check list at line 61 names the two new checks)
- `src/styles.ts` (conditional: only if Task 2 finds a missing focus outline or Task 3 finds an
  editor that does not fit 1280 px; see Non-goals. At `fc2c166` the outline rule exists,
  `src/styles.ts:53`, and no rule removes an outline, so no change is expected)

Behavior change: yes. A posted JSON pointer is no longer trimmed: a stored trailing space
survives an edit, and a leading-space or spaces-only pointer is now rejected.

`docs/development.md` is in the list although the issue names only four docs: it lists what
`e2e/run.ts` checks, and two new checks would leave that list incomplete. No other file
changes.

### Tool facts (verified)

- Bun 1.4.0: `package.json:9` (`engines.bun`), `package.json:35` (`packageManager`), CI browser
  job `.github/workflows/ci.yml:302` (`bun-version: 1.4.0`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:18`).
  `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`).
  `typecheck` runs `tsc --noEmit` for the root and for `-p e2e` (`package.json:13`), so
  `e2e/run.ts` is type-checked. `test` = `bun test` (`package.json:14`).
- `bun run check:browser` = `bun e2e/run.ts` (`package.json:19`). The CI job `browser` installs
  with `bun install --frozen-lockfile`, installs Chromium with
  `bunx playwright install --with-deps chromium` and runs it (`.github/workflows/ci.yml:291-308`),
  with Playwright `1.64.1` (`package.json:28`).
- `bun start` = `bun src/main.ts` (`package.json:12`).
- Coverage: `bunfig.toml:1-4` (`[test]`, `coverage = true`,
  `coverageThreshold = { lines = 0.8, functions = 0 }`, ignore patterns for tests, `test/**` and
  `dist/**`).
- Biome `2.6.3` (`package.json:23`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`
  at pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). That pinned file
  includes `**` and ignores only `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`
  (pulse-config `biome.json:10-17` at the pin), so `src/`, `e2e/` and `test/` are linted. The
  pinned file is identical to the config clone's `main`.
- CI `check` job: `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`
  (`.github/workflows/ci.yml:18`). At that pin it runs `bun install --frozen-lockfile`,
  `bun run lint`, `bun run typecheck` and `bun run test` (pulse-config `check.yml:25-38`; the
  build steps run only with `inputs.build`). The pinned file is identical to the config clone's
  `main`.

### Task 1: exact pointer (TDD)

1. Red first. In `src/check-form.test.ts`, add a test in or beside the block "parseEditForm with
   a trusted view" (line 593). Build a stored HTTP view with
   `jsonAssert: [{ pointer: "/status ", equals: "ok" }, { pointer: "/ready ", exists: true }]`.
   Take the values of `editInputOf(view)` (`src/check-editor-page.ts:179`), change only `name`,
   and expect `parseEditForm(…).jsonAssert` to equal the stored array, written as a literal in
   the test. Run `bun test src/check-form.test.ts` on the old code and record that it fails with
   `"/status"` received where `"/status "` was expected. Report the coverage threshold result of
   that focused run apart from the assertion result.
2. In the same file add: create with `"/a b\t"` keeps it; `" /status"` and `"   "` with mode
   `exists` give the error on `assert_0_pointer` with the existing message; `""` with mode
   `exists` still gives `{ pointer: "", exists: true }`; `"/x "` with mode `none` gives no
   assertion; name `" Web shop 2 "` is still trimmed.
3. Green: in `src/check-form.ts:362` drop `.trim()` from the pointer read. Change nothing else
   in `assertRow` and no other `.trim()`.
4. In `src/server.checks-change.test.ts`, under `describe("POST /checks/edit")`, add a test
   with `fakeApi(config)` where `config` is `checkConfig` with the `web` entry replaced (map,
   not `withChecks`, which appends) by `web` plus the `jsonAssert` above.
   - `GET /checks/edit?id=web` renders `value="/status "` and `value="/ready "` for
     `assert_0_pointer` and `assert_1_pointer`.
   - `submit` with `WEB_EDIT`, the rendered assertion values (`assert_0_pointer: "/status "`,
     `assert_0_mode: "equals"`, `assert_0_equals: '"ok"'`, `assert_1_pointer: "/ready "`,
     `assert_1_mode: "exists"`) and `name: "Web shop 2"` answers `303` to
     `/checks/check?id=web&saved=1`.
   - The calls are exactly `GET /admin/config` then `PUT /admin/checks/web`.
     `sentBody(api, "PUT")` has `name: "Web shop 2"` and `jsonAssert` equal to the literal
     stored array.
   - A second case posts `assert_0_pointer: " /status"` with mode `exists` and expects `422`,
     the field message, and no PUT.

Evidence: the failing run of step 1 on the old code and the passing run after step 3, each with
the command and the relevant output line, in the PR body.

### Task 2: keyboard traversal through a Checks editor

Add a function to `e2e/run.ts` (for example `assertEditorTabOrder`). Call it from
`checkScreensWith`, which runs in both script modes (`e2e/run.ts:2812-2813`), at the
1280 × 800 viewport, for `/checks/new?type=http` and `/checks/edit?id=web`. Reuse
`focusedOutline` (`e2e/run.ts:673`) or extend it to return the focused element's `name` (or
the text of a `summary` or `button`), `outlineStyle` and `outlineWidth`.

Start: load the page and press Tab from the top until focus first enters `form.check-editor`
(bounded, like `tabTo` at `e2e/run.ts:710`). That stop is the first entry of the sequence. Then
press Tab once per stop and assert each stop in order. Each stop must have
`outlineStyle === "solid"` and `outlineWidth === "2px"`.

Expected sequence, written from the template at `fc2c166` (`src/check-editor-page.ts:297-531`).
A radio group is one stop at its checked radio. `HEADER_ROWS` is 20 and `ASSERT_ROWS` is 10
(`src/check-form.ts:15-16`). Hidden inputs (`csrf`, `form_token`, `type`, `revision`) are no
stops, and the closed `More rows` disclosure is one stop at its summary.

- **Create HTTP** (`/checks/new?type=http`): `id`, `name`, `availability_target`, `url`,
  `method`, `interval_ms`, `timeout_ms`, `retries`, `retry_delay_ms`, `latency_objective_ms`,
  `expected_status`, `keyword`, `body`, summary `Headers`, then for rows 0 to 4:
  `header_<i>_name`, `header_<i>_kind` (`plain` checked), `header_<i>_value`; summary
  `More rows`; summary `JSON assertions`; then for rows 0 to 9: `assert_<i>_pointer`,
  `assert_<i>_mode` (`none` checked), `assert_<i>_equals`; button `Create check`.
- **Edit `web`** (`/checks/edit?id=web`; fixture `test/check-fixtures.ts:9-18`: stored
  `X-Api-Key` in row 0, env `Authorization` in row 1, stored body): `name`,
  `availability_target`, `url`, `method`, `interval_ms`, `timeout_ms`, `retries`,
  `retry_delay_ms`, `latency_objective_ms`, `expected_status`, `keyword`, `body_intent`
  (`keep` checked), `body`, summary `Headers`, `header_0_intent` (`keep` checked),
  `header_0_value`, `header_1_name`, `header_1_kind` (`env` checked), `header_1_value`, then
  rows 2 to 4 as on create, summary `More rows`; with JavaScript on only, the `Copy` button of
  the probe host binding block (it carries `hidden` without the script); summary
  `JSON assertions`; rows 0 to 9 as on create; button `Save check`.
- After the submit button, one more Tab moves focus outside `form.check-editor`.

The test may build the list from these literal patterns (for example a loop over row numbers),
but never from a DOM query of focusable elements. If Chromium shows a different order than this
spec, do not adapt the list to the observed order: request a hold with status `needs-input` and
report the observed sequence. A stop that is in the right order but lacks the `2px solid`
outline is not an order difference: fix only the focus rule in `src/styles.ts` and name it in
the PR body (see Non-goals).

The `ok(...)` line of `checkScreensWith` names the new check, for example "Tab through the HTTP
create and edit editors reaches each control with a 2px solid outline and leaves the form after
Submit".

### Task 3: every editor fits 1,280 px

In `checkScreensWith`, after `page.setViewportSize({ width: 1280, height: 800 })`
(`e2e/run.ts:1430`), for each of the twelve entries of `EDITORS` after navigation:

- call `assertFits(page, 1280, \`${label} 1280px ${url}\`)`;
- read the bounding box of `form.check-editor` and assert `width > 0`, `left >= 0`,
  `right <= 1280` and `width <= 1280` (literal limit).

Both script modes run, because `checkScreensWith` runs twice. Keep `assertQuorumText`, axe, the
design-matrix checks (`assertEditorWidths`) and the 390 px list and detail checks unchanged.
Extend the `ok(...)` line with "12 editors fit 1280 px". If an editor does not fit, fix only
that editor's layout rule in `src/styles.ts`, without hiding overflow, and name it in the PR
body (see Non-goals).

### Task 4: check-module guide in `AGENTS.md`

Add one bullet under "This repository" (after the Probes sentence, `AGENTS.md` line 104 on), in
the style of the Team, Tokens and Probes guides. It names the current files and their jobs;
check every name against the tree before writing it:

- Routes: `src/check-routes.ts` (also the typed delete confirmation). Pages:
  `src/check-pages.ts` (list and shared check views), `src/check-detail-pages.ts` (detail and
  shadowed definition), `src/check-editor-page.ts` (create and edit forms, and `editInputOf`,
  the stored-view mapping).
- Form parse: `src/check-form.ts` (`parseCreateForm`, `parseEditForm`). A JSON pointer is an
  exact string and is never trimmed.
- Reads and writes: `src/check-read.ts` (`readCheckList`, `readCheckConfig`,
  `readCheckExport`), `src/check-write.ts` (`sendCheckWrite`, writes with the revision as
  `If-Match`), `src/check-outcome.ts` (`checkOutcome`, the class of a write outcome).
- Helpers: `src/check-format.ts` (display formats), `src/check-filters.ts` (list filters),
  `src/check-export.ts` (export), and the shell lines (`shellQuote`, `hostBindingLine`,
  `heartbeatLine`) in `src/shell-line.ts`.
- Gates: check routes use the same `ProtectedRoute` role gate (`routeRole`) and form tokens as
  the other pages. Write-only values are never rendered. Stored literal headers and the stored
  body offer Keep / Replace / Remove (`header_<i>_intent`, `body_intent`,
  `src/check-editor-page.ts:324,429`). The stored heartbeat secret offers only Keep / Replace
  (`secret_intent`, `secretField`, `src/check-editor-page.ts:452-466`). The guide must not say
  that the heartbeat secret can be removed.
- Tests: unit tests beside each module; `src/server.checks.test.ts`,
  `src/server.checks-write.test.ts` and `src/server.checks-change.test.ts` against the fake api
  of `test/fake-api.ts` with `test/check-fixtures.ts`; the browser checks `checkScreensWith`
  (with the Tab order and the 1280 px fit) and `checkWriteFlowsWith` in `e2e/run.ts`.

This documents existing boundaries; it changes no route, role or token.

### Task 5: documentation

Write short plain sentences, at the level of each document:

- `docs/checks.md`:
  - "Editor fields", after the JSON assertion row sentence (line 169-170): the pointer is sent
    exactly as entered. A space belongs to the key name and is never removed, so an edit keeps a
    stored pointer such as `/status ` as it is. A pointer that is not empty must start with `/`;
    a leading space or only spaces is a field error.
  - "Editor pages" (line 172 on): one bullet that Tab moves through every control of an editor
    in page order, each focused control shows a 2 px solid outline, and every create and edit
    form fits a 1280 px wide window without sideways scroll.
- `README.md:16`, in the sentence about create and edit at `/checks/new` and `/checks/edit`:
  an edit keeps every field it does not change, including JSON pointers with spaces, and the
  editors work by keyboard with a visible focus outline and fit 1280 px.
- `docs/configuration.md:133`, after the `POST /checks/edit` sentence: the console sends each
  JSON pointer as posted, without trimming; other text fields are trimmed as before. It also
  states the keyboard focus and 1280 px fit in one sentence or points to `checks.md` for them.
- `docs/development.md:61`: the Checks part of the browser-check list also names the Tab order
  with focus outline through the HTTP create and edit editors and the 1280 px fit of all twelve
  editors, with JavaScript on and off.

No document may say that a pointer is trimmed, or that the heartbeat secret can be removed.

### Task 6: `bun start` smoke (required)

Console `AGENTS.md` "End-to-end checks" requires one run of `bun start` before handoff. This run
is required and is not replaced by `bun e2e/run.ts --serve` or an in-process test. Use a
temporary directory outside the checkout, for example `S=$(mktemp -d)`, for every file below,
and choose free loopback ports when you run it.

1. **Fixture API.** A temporary Bun script in `$S` imports `startFakeApi` and `jsonReply` from
   the checkout's `test/fake-api.ts` and the fixtures from `test/check-fixtures.ts` by absolute
   path. It serves `GET /admin/config` as `checkConfig` with the `web` entry given
   `jsonAssert: [{ pointer: "/status ", equals: "ok" }, { pointer: "/ready ", exists: true }]`,
   `GET /checks` as `checkStates`, a valid `GET /admin/tokens/self` answer (for example `selfToken()` of
   `test/token-fixtures.ts:33`), and a saved reply to `PUT /admin/checks/web` (as
   `src/server.checks-change.test.ts:37` uses). It prints its URL and writes each recorded PUT
   body to `$S/put.json`.
2. **Disposable settings.** `$S/key` with 64 lowercase hex characters (for example
   `openssl rand -hex 32`), an admin token that the rules of `src/admin-token.ts` accept in
   `$S/token`, and `$S/console.db` as the database.
3. **Start.** In the console checkout:
   `PULSE_API_URL=<fixture url> PULSE_CONSOLE_DB=$S/console.db PULSE_CONSOLE_PORT=<port>
   PULSE_CONSOLE_ADMIN_TOKEN_FILE=$S/token PULSE_CONSOLE_SECRET_KEY_FILE=$S/key bun start`,
   with its output in `$S/console.log`.
4. **Setup and sign-in through the normal routes.** Take the setup code from the log line
   `pulse-console setup code: …`, post `/setup` and `/setup/owner` (`action=complete`), then
   confirm the authenticator at `/account/authenticator` with a TOTP computed from the
   rendered `#totp-secret`. Send each POST with `Origin: http://127.0.0.1:<port>`, the session
   cookie, `csrf` and the `form_token` of that form. Pulse-deploy `e2e/console-setup.sh` steps
   1-8 and `e2e/totp.mjs` show the same flow; read them, do not edit them.
5. **Edit.** `GET /checks/edit?id=web` answers `200` and its HTML holds `value="/status "` and
   `value="/ready "`. Post the form with every rendered non-secret value (text inputs, checked
   radios, selected options, textareas, hidden `revision`, `csrf`, `form_token`) and only
   `name` changed to `Web shop 2`. Expect `303` to `/checks/check?id=web&saved=1`.
6. **Inspect.** `$S/put.json` holds `name: "Web shop 2"` and `jsonAssert` equal to the literal
   `[{"pointer":"/status ","equals":"ok"},{"pointer":"/ready ","exists":true}]`.
7. **Clean up.** Stop both processes and remove `$S`. Nothing of `$S` is committed.

Record in the PR body: the commands (with the token, key, password, setup code and TOTP
replaced by placeholders), the `303` location, and the recorded `jsonAssert` printed with
`JSON.stringify` so the trailing spaces are visible.

### Task 7: PR body

Per Console `AGENTS.md` "Commits and pull requests": name the issue
(`Closes lorenzh/pulse-meta#<child>`), the checks that ran and the known limits. Report from the
final `bun run check` run the test counts, and `% Funcs` as "function coverage" and `% Lines`
as "line coverage" from the `All files` row, each copied as printed. State the red/green
evidence of Task 1, the `bun run check:browser` result with its new `ok` lines, the smoke of
Task 6, and any `src/styles.ts` change with the failing check that caused it.

### Completion evidence

- `bun test src/check-form.test.ts` fails on the old code with expected `"/status "` and
  received `"/status"` (expected value: the literal `"/status "` written in the test), and
  passes after the change. The coverage threshold result of that focused run is reported apart.
- `bun run check` exits 0 (literal expected exit code).
- `bun run check:browser` exits 0 and prints the extended `ok` lines for JavaScript on and off
  (literal texts from this spec).
- The `bun start` smoke of Task 6 answers `303` to `/checks/check?id=web&saved=1` and the
  fixture's recorded PUT holds the literal `jsonAssert` of Task 6 step 6.
- `git diff main -- package.json bun.lock src/permissions.ts src/form-tokens.ts src/server.ts`
  is empty: the contract pin, roles, form tokens and dispatcher order are unchanged (expected
  value: an empty diff).
- `git diff main --name-only` lists only files of the `Files:` list: `src/check-form.ts`,
  `src/check-form.test.ts`, `src/server.checks-change.test.ts`, `e2e/run.ts`, `AGENTS.md`,
  `docs/checks.md`, `README.md`, `docs/configuration.md`, `docs/development.md`, and
  `src/styles.ts` only if Task 2 found a missing focus outline or Task 3 found an editor wider
  than 1280 px, with that failing check named in the PR body.
- The guide's heartbeat-secret sentence names Keep / Replace only, and its header and body
  sentence names Keep / Replace / Remove (expected values: the literal choice lists of
  `src/check-editor-page.ts:324,429,466` at `fc2c166`, cited above).
- `grep -n -i "pointer" README.md docs/configuration.md docs/checks.md` shows the new sentences,
  and none of them says that a pointer is trimmed.

## Risks

- **Stricter input:** a person who typed `" /status"` or only spaces now gets a field error
  instead of a silently repaired value. This is intended (exact-string semantics, issue review
  point 1), and the message already says what to enter.
- **Long Tab sequence:** the HTTP editor has about 60 stops, so a template change breaks the
  literal list. That is the purpose of the check. Build the list from the row patterns so that
  a row-count change is one edit.
- **Hidden controls:** the closed `More rows` details and the script-revealed `Copy` button
  differ between modes. The spec names both, so a mismatch is a real finding.
- **Flaky focus:** use Playwright `keyboard.press("Tab")` and read focus with `page.evaluate`
  after each press; no timers.
- **Smoke effort:** the production gates need setup, enrolment and TOTP. The deploy script shows
  the flow; the smoke files stay in `$S` and are removed afterwards. A smoke that cannot reach
  the edit page through the normal gates is a finding to report, not a reason to use a test
  route.

## Acceptance evidence

1. The new pointer test fails on the old code for `"/status "` vs `"/status"` and passes on the
   new code (expected value: the literal `"/status "` in the test, from the stored fixture).
2. The HTTP edit test proves that a name-only edit sends the stored `jsonAssert` unchanged
   (expected value: the literal fixture array, independent of the parser).
3. `bun run check` and `bun run check:browser` exit 0.
4. Committed browser checks: Tab traversal with a `2px solid` outline at each stop through HTTP
   create and edit, with JavaScript on and off; all twelve editors fit 1280 px (literal limit)
   in both modes.
5. Console `AGENTS.md` holds the check-module guide with the correct write-only choices.
   `docs/checks.md`, `README.md` and `docs/configuration.md` state exact pointers, keyboard
   focus and the 1280 px fit; `docs/development.md` lists the new checks.
6. The `bun start` smoke shows the recorded PUT with the literal pointers `"/status "` and
   `"/ready "` (Task 6).
7. The PR body labels `% Funcs` as function coverage and `% Lines` as line coverage from the
   final run.
