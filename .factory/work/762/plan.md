# Spec #762: console keeps JSON pointers on edit, adds missing checks-editor tests and guide

## Goal

Close the two gaps that review of Console PR #12 (check screens, #751 / spec #567) found:

1. A name-only edit of a stored HTTP check changes a JSON pointer that ends in whitespace,
   because the shared form parser trims it. `"/status "` and `"/status"` are different RFC 6901
   pointers that select different keys, so the edit silently changes what the check asserts.
2. Spec #567 asked for committed checks and a guide that PR #12 did not deliver: Tab navigation
   through a Checks editor with a visible outline, all editors fitting a 1,280 px viewport with
   a width assertion, and a check-module guide in Console `AGENTS.md`. The PR body also labelled
   a coverage figure wrongly.

This builds on the merged check screens (#751, Console PR #12) and the later layout work
(Console PR #18, HEAD `fc2c166`). Nothing of those screens is built again.

## Scope

- `console` only: the pointer parse in `src/check-form.ts`, a regression test at the parser and
  at the HTTP edit route, two browser checks in `e2e/run.ts`, a guide in `AGENTS.md`, one sentence
  in `docs/checks.md`, and the coverage labels in the PR body.

## Non-goals

- No change of the contract pin (`package.json:32`, `66818a24…`), routes, roles, the permission
  matrix, form tokens, CSRF order or the CSP.
- No change of trimming for any other field (id, name, URL, header names, numbers, resolver,
  expected status). Only `assert_<i>_pointer` changes.
- No migration of stored checks; no change of how `src/check-editor-page.ts` maps a stored view
  to form values (it already copies the pointer unchanged, `src/check-editor-page.ts:166-177`).
- No coverage threshold, tooling, Biome, ESLint, TypeScript or CI change.
- No redesign of the editor and no change of `src/styles.ts`, unless the new keyboard check
  exposes a missing outline (then fix only that rule and say so in the PR).
- No new runtime dependency.

## Current behavior (verified at Console `fc2c166`)

- `src/check-form.ts:353-378` `assertRow`: line 362 reads
  `const pointer = raw(r, \`assert_${i}_pointer\`).trim();`, then rejects a non-empty pointer
  that does not start with `/` (lines 363-369), and builds `{ pointer, exists: true }` or
  `{ pointer, equals }`. Create (`parseCreateForm`, line 604) and edit (`parseEditForm`,
  line 633) share it.
- `src/check-editor-page.ts:166-177` `assertValues` puts `assertion.pointer` into
  `assert_<i>_pointer` unchanged; the edit form therefore renders `value="/status "`, and the
  parse on submit drops the space.
- Contract `src/schema.ts:210-221` (`isJsonPointer`, `jsonAssertSchema`) accepts `""` or a value
  that starts with `/`, checks `~` escapes and at most 256 bytes, and never trims. A pointer with
  a trailing space is valid; a pointer with a leading space is not.
- `src/check-form.test.ts:225-262` and `src/server.checks-change.test.ts` cover ordinary and
  empty pointers; no test has a pointer with surrounding whitespace.
- `e2e/run.ts:1258-1271` `EDITORS` lists the twelve editors (create and edit of http, tls, tcp,
  dns, domain, heartbeat). `checkScreensWith` (from line 1348) runs with JavaScript on and off
  (`e2e/run.ts:2812-2813`), sets 1280 × 800 at line 1430 and visits every editor only through
  `assertQuorumText` (line 1273), which checks text, not width. `assertFits` (line 254) measures
  `document.documentElement.scrollWidth` and rejects `overflow-x: hidden` on the root.
  `checkFocus` (line 681) tabs only through the shell. `assertEditorWidths`
  (`e2e/design-matrix.ts:919`) checks three fields of one edit form, not the whole editor.
- `src/styles.ts:53` gives `a, button, input, select, textarea, summary, [tabindex]` a
  `:focus-visible` outline of `2px solid var(--accent)` at offset 3 px.
- Console `AGENTS.md` "This repository" (line 104 on) has guides for Team, Tokens and Probes but
  none for Checks.
- Console PR #12 body line 26: "1308 pass, 0 fail, 98.05 % line coverage". `bunfig.toml:3` sets
  `coverageThreshold = { lines = 0.8, functions = 0 }`; Bun prints `% Funcs` and `% Lines`
  columns, and the review found the figure was not taken from the `% Lines` column.

Shared findings: none (`factory/findings/762` answers HTTP 404).

## Required behavior

1. **Exact pointer.** `assertRow` uses the posted `assert_<i>_pointer` value exactly as posted:
   no trim, no other normalization, for both Exists and Equals and for create and edit. The
   existing rule stays: `""` means the whole body; any other value must start with `/` or the
   field gets the existing message `Enter a JSON pointer such as /status, or leave it empty for
   the whole body.` Mode `none` still ignores the row.
2. **Name-only edit round trip.** Opening `/checks/edit?id=<id>` of a stored HTTP check whose
   `jsonAssert` holds `{ pointer: "/status ", equals: "ok" }` and `{ pointer: "/ready ",
   exists: true }` renders both pointers with the trailing space; submitting the form with only
   the name changed sends a PUT whose `jsonAssert` equals the stored array exactly and whose
   `name` is the new name.
3. **Keyboard traversal.** A committed browser check presses Tab through the HTTP create editor
   and the HTTP edit editor of `web`, with JavaScript on and off, and asserts at each stop the
   focused control and an outline of style `solid` and width `2px` (literal from
   `src/styles.ts:53`). See the sequence under Repository: console.
4. **1,280 px fit.** A committed browser check visits every entry of `EDITORS` at a 1280 × 800
   viewport, with JavaScript on and off, and asserts after each navigation that the root does
   not scroll sideways (`assertFits(page, 1280, …)`) and that the `form.check-editor` box has
   `left >= 0` and `right <= 1280`.
5. **Guide.** Console `AGENTS.md` "This repository" gains a check-module guide (content below).
6. **Docs.** `docs/checks.md` "Editor fields" says the JSON pointer is used exactly as entered:
   a space is part of a key name and is never removed.
7. **PR body.** The PR body reports the coverage of the final `bun run check` run from the
   `All files` row of the Bun coverage table with both labels: `% Funcs` as function coverage
   and `% Lines` as line coverage, each copied as printed.

## Performance impact

None expected: the change is in Console only, removes one `String.prototype.trim` call per
assertion row on a form POST and adds tests and docs. No metric of `bench/budgets.json` in the
api repository (startup CPU, load CPU, idle or peak RSS, test CPU, build CPU, wall-clock startup,
p95 latency, requests per second, image size) covers the Console, and the api is unchanged.
The Console image gains no file (the docker job already excludes `e2e/` and tests,
`.github/workflows/ci.yml` docker job).

## Security impact

Security impact: yes. The change edits a parser of an untrusted POST body (`src/check-form.ts`,
the Console's trust boundary for check forms) and a form value that is echoed back into HTML.

Checklist items that apply:

- **Input validation:** validation becomes stricter, never looser. A value the old code turned
  valid by trimming (`" /status"`, `"   "`) is now rejected with the existing field message and
  no write. The api still validates with the contract `jsonAssertSchema`; the Console adds no
  bypass.
- **Error and log texts that carry external data:** a rejected pointer is re-rendered in the
  retained form through `escapeHtml` only (the existing `input` helper), never in a log line, an
  error message text or a header. The field message stays the fixed literal and never quotes the
  posted value.
- Auth order and status codes are unchanged: the dispatcher order (session, Origin, content
  type, body size, repeated fields, CSRF, role, form token) and the `422` for a field error stay
  as they are; a rejected pointer sends no PUT and does not use up the form token.

Not affected: secrets in responses (write-only values keep their existing handling), body size
limits, SSRF and redirects, file writes, dependency pins, Dockerfile, CI.

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
| `"/a b\t"` (create) | exists | `{ pointer: "/a b\t", exists: true }` | trimming on create only kept |
| `" /status"` | exists | `422`, error on `assert_0_pointer` with the existing message, no PUT/POST to the api | old code: accepted as `"/status"` |
| `"   "` | exists | `422`, same error, no write | old code: `""`, a whole-body assertion |
| `""` | exists | `{ pointer: "", exists: true }` (unchanged) | an implementation that now rejects empty |
| `"/x "` | none | no assertion (row ignored) | an implementation that validates ignored rows |

Other fields keep trimming: name `" Web shop 2 "` still becomes `"Web shop 2"` and URL
`" https://example.com/ "` still parses. An implementation that removes `.trim()` globally from
`raw` or from `src/check-form.ts` fails these.

Round trip: a test that posts a hand-written `assert_0_pointer: "/status "` without first
rendering the stored check does not prove requirement 2; the test must take the value from the
edit page (rendered `value` attribute) or from `editInputOf(view)` of the stored view.

Keyboard traversal:

- Calling `.focus()` on each control, or asserting only `document.activeElement` after one Tab,
  does not count; each stop is reached by one `Tab` press from the previous one.
- An outline of style `none`, or of width other than `2px`, at any stop fails.
- The expected sequence is a literal in the test (written from this spec), never built by
  querying the DOM for focusable elements in document order: such a list always matches.
- A radio group is one Tab stop at its checked radio; the test does not expect every radio.
- After the submit button one more Tab must move focus out of `form.check-editor` (no trap).

1,280 px fit:

- Setting the viewport without measuring, or measuring only `name`/`interval_ms`, fails the
  requirement.
- `overflow-x: hidden` on `html` or `body` must fail (`assertFits` already rejects it); an
  editor at `scrollWidth` 1281 must fail.
- Width limit is the literal `1280`, not `window.innerWidth` read in the same run.

Coverage statistic: the two figures come from the `All files` row of the text coverage table
that `bun test` (run by `bun run check`) prints for the final commit of the PR. `% Funcs` is the
share of functions run at least once, `% Lines` the share of executable lines run, both over the
files not ignored by `bunfig.toml:4`, as Bun computes them, copied with the two decimals Bun
prints. A figure from an earlier run, from Console PR #12, or a `% Funcs` value labelled as line
coverage is wrong.

## Contract fields

No new names. The change adds no field, key, route or form field; it reuses the existing
`assert_<i>_pointer` form field (`src/check-form.ts:62`) and the contract key `pointer`
(contract `src/schema.ts:219`).

## Repository: console

Files:
- `src/check-form.ts` (change: `assertRow` stops trimming the pointer)
- `src/check-form.test.ts` (new tests: exact pointer on create and on a name-only edit through
  `editInputOf`, and the rejected leading-space and spaces-only pointers)
- `src/server.checks-change.test.ts` (new HTTP test: name-only edit of a stored trailing-space
  pointer)
- `e2e/run.ts` (new keyboard traversal check and 1,280 px editor fit assertion)
- `AGENTS.md` (check-module guide under "This repository")
- `docs/checks.md` (one sentence under "Editor fields")

Behavior change: yes. A posted JSON pointer is no longer trimmed: a stored trailing space
survives an edit, and a leading or spaces-only pointer is now rejected.

### Tool facts (verified)

- Bun 1.4.0: `package.json:9` (`engines.bun`), `package.json:35` (`packageManager`), CI browser
  job `.github/workflows/ci.yml:302`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:18`);
  `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`); `typecheck`
  runs `tsc --noEmit` for the root and for `-p e2e` (`package.json:13`), so `e2e/run.ts` is type
  checked; `test` = `bun test` (`package.json:14`).
- `bun run check:browser` = `bun e2e/run.ts` (`package.json:19`); CI job `browser` runs it
  (`.github/workflows/ci.yml:291-308`) with Playwright `1.64.1` (`package.json:28`).
- Coverage: `bunfig.toml:2-4` (`coverage = true`, `coverageThreshold = { lines = 0.8,
  functions = 0 }`, ignore patterns for tests and `test/**`).
- Biome `2.6.3` (`package.json:23`); `biome.json:2` extends `@lorenzh/pulse-config/biome.json`
  at pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`). That pinned file
  includes `**` and ignores only `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`
  (pulse-config `biome.json:8-17` at the pin), so `src/`, `e2e/` and `test/` are linted.
- CI `check` job uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`
  (`.github/workflows/ci.yml:18`); at that pin it runs install, `bun run lint`,
  `bun run typecheck` and `bun run test` (pulse-config `check.yml:25-38`). The pinned file is
  identical to the config clone's `main`.

### Task 1: exact pointer (TDD)

1. Red first. In `src/check-form.test.ts` add a test that builds a stored HTTP view with
   `jsonAssert: [{ pointer: "/status ", equals: "ok" }, { pointer: "/ready ", exists: true }]`
   (reuse the `view` / `editFields` fixture of the "parseEditForm with a trusted view" block,
   `src/check-form.test.ts:593`), takes the values of `editInputOf(view)` (`src/check-editor-page.ts:179`),
   changes only `name`, and expects `parseEditForm(…).jsonAssert` to equal the stored array
   exactly. Run `bun test src/check-form.test.ts` on the old code and record that it fails with
   `"/status"` received where `"/status "` was expected.
2. In the same file add: create with `"/a b\t"` keeps it; `" /status"` and `"   "` with mode
   `exists` give the error on `assert_0_pointer` with the existing message; `""` with mode
   `exists` still gives `{ pointer: "", exists: true }`; name `" Web shop 2 "` is still trimmed.
3. Green: in `src/check-form.ts:362` drop `.trim()` from the pointer read. Change nothing else in
   `assertRow` and no other `.trim()`.
4. In `src/server.checks-change.test.ts` add a test under `describe("POST /checks/edit")`: a
   fake api (`fakeApi(withChecks(…))` or a copy of `checkConfig` whose `web` entry gets the
   `jsonAssert` above), `GET /checks/edit?id=web` renders `value="/status "` and
   `value="/ready "` for `assert_0_pointer` / `assert_1_pointer`; `submit` with `WEB_EDIT` plus
   the rendered assertion values (`assert_0_pointer`, `assert_0_mode: "equals"`,
   `assert_0_equals: '"ok"'`, `assert_1_pointer`, `assert_1_mode: "exists"`) and
   `name: "Web shop 2"` answers `303`, sends exactly `GET /admin/config` then
   `PUT /admin/checks/web`, and `sentBody(api, "PUT")` has `name: "Web shop 2"` and
   `jsonAssert` equal to the stored array. A second case posts `assert_0_pointer: " /status"`
   and expects `422`, the field message, and no PUT.
5. `docs/checks.md` "Editor fields" (after line 170): add one sentence that the pointer is sent
   exactly as entered; a space belongs to the key name and is never removed.

Evidence: the failing run of step 1 on the old code and the passing run after step 3, both with
the command and the relevant output line, in the PR body.

### Task 2: keyboard traversal through a Checks editor

Add a function to `e2e/run.ts` (for example `assertEditorTabOrder`) and call it from
`checkScreensWith` (both script modes, `e2e/run.ts:2812-2813`) at the 1280 × 800 viewport, for
`/checks/new?type=http` and `/checks/edit?id=web`. Reuse `focusedOutline` (`e2e/run.ts:673`)
or extend it to return the focused element's `name` (or `textContent` for `summary` and
`button`), `outlineStyle` and `outlineWidth`.

Start: load the page and press Tab from the top until focus first enters `form.check-editor`
(bounded, like `tabTo` at `e2e/run.ts:710`); that stop is the first entry of the sequence. Then
press Tab once per stop and assert each stop in order. Each stop must have `outlineStyle === "solid"` and
`outlineWidth === "2px"`.

Expected sequence, written from the template at `fc2c166` (`src/check-editor-page.ts:297-505`;
a radio group is one stop at its checked radio, and every group's first choice is checked by
default):

- **Create HTTP** (`/checks/new?type=http`): `id`, `name`, `availability_target`, `url`,
  `method`, `interval_ms`, `timeout_ms`, `retries`, `retry_delay_ms`, `latency_objective_ms`,
  `expected_status`, `keyword`, `body`, summary `Headers`, then for rows 0 to 4:
  `header_<i>_name`, `header_<i>_kind` (`plain` checked), `header_<i>_value`; summary
  `More rows`; summary `JSON assertions`; then for rows 0 to 9: `assert_<i>_pointer`,
  `assert_<i>_mode` (`none` checked), `assert_<i>_equals`; button `Create check`.
- **Edit `web`** (`/checks/edit?id=web`, fixture: stored `X-Api-Key` row 0, env `Authorization`
  row 1, stored body): `name`, `availability_target`, `url`, `method`, `interval_ms`,
  `timeout_ms`, `retries`, `retry_delay_ms`, `latency_objective_ms`, `expected_status`,
  `keyword`, `body_intent` (`keep` checked), `body`, summary `Headers`, `header_0_intent`
  (`keep` checked), `header_0_value`, `header_1_name`, `header_1_kind` (`env` checked),
  `header_1_value`, then rows 2 to 4 as on create, summary `More rows`; with JavaScript on only,
  the `Copy` button of the probe host binding block (it is `hidden` without the script); summary
  `JSON assertions`; rows 0 to 9 as on create; button `Save check`.
- After the submit button, one more Tab moves focus outside `form.check-editor`.

The list may be built in the test from these literal patterns (for example a loop over row
numbers) but never from a DOM query of focusable elements. If Chromium shows a different order
than this spec, do not adapt the list to the observed order: request a hold with status
`needs-input` and report the observed sequence, unless the difference is a missing outline,
which is fixed in `src/styles.ts` and reported.

The `ok(...)` line of `checkScreensWith` names the new check, for example "Tab through the HTTP
create and edit editors reaches each control with a 2px solid outline and leaves the form after
Submit".

### Task 3: every editor fits 1,280 px

In `checkScreensWith`, after `page.setViewportSize({ width: 1280, height: 800 })`
(`e2e/run.ts:1430`), for each entry of `EDITORS` (all twelve) after navigation: call
`assertFits(page, 1280, \`${label} 1280px ${url}\`)` and assert the bounding box of
`form.check-editor` has `left >= 0` and `right <= 1280`. Both script modes run, because
`checkScreensWith` runs twice. Keep `assertQuorumText`, axe, the design-matrix checks
(`assertEditorWidths`) and the 390 px list and detail checks unchanged. Extend the `ok(...)`
line with "12 editors fit 1280 px". If an editor does not fit, fix its layout in
`src/styles.ts` without hiding overflow and report it.

### Task 4: check-module guide in `AGENTS.md`

Add one bullet under "This repository" (after the Probes sentence, `AGENTS.md` line 104 on),
in the style of the Team, Tokens and Probes guides, that names the current files and their
jobs; check every name against the tree before writing it:

- Routes: `src/check-routes.ts` (also the typed delete confirmation). Pages: `src/check-pages.ts`
  (list and shared check views), `src/check-detail-pages.ts` (detail and shadowed definition),
  `src/check-editor-page.ts` (create and edit forms, the stored-view mapping `editInputOf`).
- Form parse: `src/check-form.ts` (`parseCreateForm`, `parseEditForm`); a JSON pointer is an
  exact string and is never trimmed.
- Reads and writes: `src/check-read.ts`, `src/check-write.ts` (revision `If-Match` writes),
  `src/check-outcome.ts` (the class of a write outcome, from the response metadata).
- Helpers: `src/check-format.ts` (display formats), `src/check-filters.ts` (list filters),
  `src/check-export.ts` (export), and the shell lines with `shellQuote` in `src/shell-line.ts`.
- Gates: check routes use the same `ProtectedRoute` role gate (`routeRole`) and form tokens as
  the other pages; write-only values (literal headers, body, heartbeat secret) are never
  rendered and use Keep / Replace / Remove.
- Tests: unit tests beside each module, `src/server.checks.test.ts`,
  `src/server.checks-write.test.ts` and `src/server.checks-change.test.ts` against the fake api
  of `test/fake-api.ts` with `test/check-fixtures.ts`; the browser checks are
  `checkScreensWith` and `checkWriteFlowsWith` in `e2e/run.ts`.

This documents existing boundaries; it changes no route, role or token.

### Task 5: PR body

Per Console `AGENTS.md` "Commits and pull requests": name the issue (`Closes
lorenzh/pulse-meta#<child>`), the checks that ran and the known limits. Report from the final
`bun run check` run: the test counts, `% Funcs` as "function coverage" and `% Lines` as "line
coverage" from the `All files` row, both copied as printed. State the red/green evidence of
Task 1, the `bun run check:browser` result with its new `ok` lines, and the manual run below.

### Completion evidence

- `bun test src/check-form.test.ts` fails on the old code with expected `"/status "` and
  received `"/status"` (expected value: the literal `"/status "` written in the test), and passes
  after the change.
- `bun run check` exits 0 (literal expected exit code).
- `bun run check:browser` exits 0 and prints the extended `ok` lines for "JavaScript on" and
  "JavaScript off" (literal texts from this spec).
- Manual exercise (Console `AGENTS.md` "End-to-end checks"): `bun e2e/run.ts --serve` or
  `bun start` against a fake api with a stored trailing-space pointer; open the edit form, change
  the name, save, and confirm the PUT body keeps `"/status "`. Report command and result.
- `git diff main -- package.json bun.lock src/permissions.ts src/form-tokens.ts src/server.ts`
  is empty (the contract pin, roles, form tokens and dispatcher order are unchanged; expected
  value: an empty diff).
- `git diff main --stat` lists only the files of the `Files:` list, plus `src/styles.ts` only if
  Task 2 or Task 3 found a layout or outline defect, said in the PR.

## Risks

- **Stricter input:** a user who typed `" /status"` or only spaces now gets a field error
  instead of a silently repaired value. This is intended (exact-string semantics, issue review
  point 1) and the message already says what to enter.
- **Long Tab sequence:** the HTTP editor has about 60 stops; a template change will break the
  literal list. That is the purpose of the check. Keep the list built from the row patterns so a
  row-count change is one edit.
- **Hidden controls:** the closed `More rows` details and the script-revealed `Copy` button
  differ between modes; the spec names both, so a mismatch is a real finding.
- **Flaky focus:** use Playwright `keyboard.press("Tab")` and read focus with `page.evaluate`
  after each press; no timers.

## Acceptance evidence

1. The new pointer test fails on the old code for `"/status "` vs `"/status"` and passes on the
   new code (expected value: literal `"/status "` in the test, taken from the stored fixture).
2. The HTTP edit test proves a name-only edit sends the stored `jsonAssert` unchanged (expected
   value: the literal fixture array, independent of the parser).
3. `bun run check` and `bun run check:browser` exit 0.
4. Committed browser checks: Tab traversal with a `2px solid` outline at each stop through HTTP
   create and edit with JavaScript on and off; all twelve editors fit 1280 px (literal limit)
   in both modes.
5. Console `AGENTS.md` holds the check-module guide; `docs/checks.md` states exact pointers.
6. The PR body labels `% Funcs` as function coverage and `% Lines` as line coverage from the
   final run.
