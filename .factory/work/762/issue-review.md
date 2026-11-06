# Issue review: #762

Ready for `plan`. No question blocks the spec.

## Decisions and scope

This is a bounded follow-up to the merged console PR #12 and the Checks work
(#751/#567). Do not rebuild the check screens. Only `console` needs a build;
no other target change or dependency upgrade is required.

The manager's latest decision restarts the spec at `issue-review`. This review
supersedes the review from closed spec PR #800, which predates the added
requirements. The new plan and task acceptance must include all four console
documentation files (`AGENTS.md`, `docs/checks.md`, `README.md`, and
`docs/configuration.md`) and make the production-entry smoke mandatory.
The earlier missing-review hold is resolved by creating this artifact.
The workflow failure alerts in the comments are history, not instructions to
dispatch another run from this state. Factory applies the outcome.

Carry forward the two corrections accepted in the earlier spec review:

- Permit `src/styles.ts` only if a new browser check proves that a focus outline
  or editor layout needs a fix. Include it as conditional in the file allowlist,
  consistently across scope, tasks, acceptance and evidence. A layout fix must
  not conceal overflow. Name the triggering failed check in the PR evidence.
- Stored literal headers and the stored body offer Keep / Replace / Remove.
  The heartbeat secret offers Keep / Replace only. The module guide must
  describe the actual choices, without inventing secret removal.

Constraints: keep the contract pin, routes, roles and form tokens unchanged.
Keep the existing POST validation, authorization and revision checks. No new
runtime packages or cross-repository implementation are needed.

## Inspected baseline

Read the meta `AGENTS.md`, state prompt, and the console `AGENTS.md` before
writing this review. Inspected the read-only console clone at
`fc2c166de8237a841b5253cef99bb3fd17f85f2f`; meta starts at
`3eb48a8dd8edf0cf6d820f81555538531562b307`. Also read the original Checks
requirements in `.factory/work/567/plan.md` and the pointer validator in the
contract clone. Target repositories were not edited.

- `console/src/check-form.ts:362`: `assertRow` calls
  `raw(r, assert_<i>_pointer).trim()` before validating and building either an
  Equals or Exists assertion. A stored `/status ` is therefore changed to
  `/status` on submission. The shared parser serves create and edit.
- `console/src/check-editor-page.ts`, `assertValues` and `editInputOf`, already
  copy the stored pointer directly into the retained form values. Fixing the
  parser is sufficient for the identified whitespace loss; no rendering change
  has been shown necessary.
- `console/src/check-form.test.ts` has parser coverage but no regression for a
  name-only edit with a trailing-space pointer. `src/server.checks-change.test.ts`
  already drives edit requests against a fake API and inspects outbound PUT
  bodies, providing the integration-test location.
- `console/e2e/run.ts`, `checkScreensWith`, switches to 1280 x 800 and visits
  the 12 entries in `EDITORS`: create and edit for each of six check types.
  That loop asserts quorum/heartbeat text, not editor width. Existing generic
  and token/probe keyboard tests do not establish Checks-editor traversal.
  `checkWriteFlowsWith` uses a 1280 px viewport but does not assert editor fit.
- `console/e2e/run.ts`, `assertFits`, checks document scroll width and rejects
  hidden root/body overflow. Reuse it and add a form bounding-box assertion.
- `console/src/styles.ts:53` defines a 2 px solid focus-visible outline with a
  3 px offset. New browser checks must verify the computed visible outline;
  the existence of this CSS rule alone is not evidence of keyboard behavior.
- `console/AGENTS.md` has no check-module guide under "This repository".
  The original #567 plan explicitly requires that guide, keyboard focus through
  the editor and editor fit at 1280 px.
- Console documentation instructions require `README.md` and
  `docs/configuration.md` updates when behavior changes. The same instructions
  require starting with `bun start` and exercising changed behavior before
  handoff. `README.md` already describes check editing and
  `docs/configuration.md` describes check edit requests; update those passages.
- `console/package.json`: `start` is `bun src/main.ts`; `check` runs lint,
  typecheck and tests; `check:browser` runs `bun e2e/run.ts`. Bun is pinned to
  1.4.0. `bunfig.toml` enforces 80% line coverage, with no function threshold.
  The contract pin is `66818a24b81f5d0d86eee939dad64fa126617ba2`.
- `console/src/main.ts` wires real settings, database, clock and fetch into the
  server. The e2e `--serve` mode instead uses `startSignedInConsole`, injected
  dependencies and fixture routes; it does not satisfy the required smoke.
  `test/fake-api.ts` can record outbound request bodies independently of how
  the console starts.

The local findings ref was absent; a successful
`git ls-remote origin refs/heads/factory/findings/762` returned no ref. There
are no shared findings available from that branch.

## Nonblocking open points and assumptions for the plan

1. **Pointer semantics.** Preserve the raw submitted pointer string, with no
   whitespace normalization, for both assertion modes. This naturally applies
   to create as well as edit because they share `assertRow`. Keep empty string
   as the whole-document pointer. Spaces after `/` are key data, including
   trailing spaces; a leading-space or spaces-only string is invalid, rather
   than silently becoming a different pointer or the empty pointer. Retain the
   existing field error for a nonempty pointer that does not start with `/`.
   Leave escape and byte-limit validation to the existing contract validator.
   Do not change unrelated field parsing (some fields deliberately preserve
   whitespace already).
2. **Regression depth.** Use stored assertions `/status ` with Equals and
   `/ready ` with Exists. Build the parser test's submitted values from
   `editInputOf(view).values`, changing only the name. Add an HTTP edit test
   that opens the stored editor, obtains a valid form token and submits its
   non-secret values with only the name changed. Assert the actual PUT JSON
   keeps both literal pointer strings and assertion modes/values. Do not merely
   construct an expected trimmed string from the parser's output.
3. **Keyboard scope.** Follow the earlier spec's representative HTTP create
   form and existing `web` edit form, with JavaScript enabled and disabled.
   The new plan must spell out the expected traversal independently of a DOM
   query for tab stops. Account for native radio-group behavior, open disclosure
   summaries, stored header/body intents, the fixed id on edit, and the submit
   button. Reach controls with Tab, assert active-element identity and a visible
   2 px solid outline at every stop, and verify that Tab after submit leaves the
   editor form. Do not copy an unexpected browser sequence into the expected
   sequence just to pass. If an unexplained order mismatch requires changing
   the approved interaction, use `needs-input`, as the earlier plan required;
   a missing outline alone permits the conditional CSS fix.
4. **Width scope.** Assert all 12 `EDITORS` at an actual 1280 px viewport in
   both JavaScript modes. Check document width and the editor form itself:
   positive width, left edge at least 0, right edge at most 1280 and width at
   most 1280. Visiting the page or checking its text is insufficient. Preserve
   the existing mobile, accessibility, CSP and write-flow checks.
5. **Guide scope.** Add a concise map of the existing check modules, parser and
   rendering boundaries, read/write paths, write-only intents, shared shell-line
   builders and relevant tests. Verify names against the checkout. This is
   documentation of the present architecture, not a refactor or new convention
   that needs product code changes.
6. **Production smoke setup.** Run the real `bun start` process against a local
   fixture API that serves valid config containing the two space-suffixed
   pointers and records a successful PUT. Use a disposable database and local
   fixture credentials. Prepare a valid stored user/session with current
   timestamps or complete normal setup/sign-in; production must still enforce
   its existing session, role, CSRF and form-token gates. A test-only route or
   `roleOf` override must not substitute for production startup. The smoke may
   use HTTP to submit the rendered form; a separate manual-browser smoke is
   not required. Choose ports at execution time and clean up processes and
   temporary data. Do not commit local secrets, databases or evidence notes to
   console. Record the exact commands and safe results in the PR evidence.
7. **File allowlist.** The planned committed console changes are
   `src/check-form.ts`, `src/check-form.test.ts`,
   `src/server.checks-change.test.ts`, `e2e/run.ts`, `AGENTS.md`,
   `docs/checks.md`, `README.md`, and `docs/configuration.md`, plus conditional
   `src/styles.ts` as above. Put this complete list into the "only these files
   change" acceptance. A disposable smoke harness may be temporary and cleaned
   up; no extra committed harness is currently necessary.

## Derived acceptance checks

The next plan and generated console task must make every item below mandatory:

- First add the stored-pointer parser regression and run it on the unchanged
  parser. Record failure caused by `/status ` becoming `/status` (and cover
  Exists with `/ready `). After the minimal fix, the same regression passes.
  Report a focused test's coverage-threshold result separately from whether
  its assertion failed for the expected reason.
- Unit and HTTP tests prove a name-only edit preserves both stored pointers
  exactly, with the edited name and unchanged assertion modes/values in the
  outbound API input. Existing validation stays intact. Cover empty, invalid
  leading-space and spaces-only pointers without normalizing them.
- Committed Chromium checks Tab through the HTTP create and `web` edit
  editors in both JavaScript modes, verify the independently specified order
  and 2 px solid outlines, and show that the final Tab leaves the form.
- Committed Chromium checks assert document and form fit at 1280 px for all
  six create and six edit forms in both JavaScript modes. No hidden overflow
  workaround is accepted.
- `AGENTS.md` contains the check-module guide and the correct write-only
  choices. `docs/checks.md`, `README.md`, and `docs/configuration.md` describe
  preservation of pointer whitespace on edit, visible keyboard focus and the
  1280 px editor fit, at a level appropriate to each document. Include all
  four docs in the committed-file acceptance list.
- In the writable console build checkout, `bun run check` and
  `bun run check:browser` pass. Install pinned dependencies and Chromium as
  required by console instructions. Do not weaken checks or change tooling pins.
- Required smoke: launch the fixture API, prepare disposable authentication,
  then start the service with `PULSE_API_URL=<fixture-url>` and
  `PULSE_CONSOLE_DB=<temporary-db>` (plus the actual local admin-token/port
  settings) using **`bun start`**. GET the real edit page, submit a name-only
  edit through the normal route, and inspect the fixture's recorded PUT JSON.
  Record the command sequence, successful save/redirect and exact JSON pointer
  values `/status ` and `/ready ` in the PR evidence. `bun e2e/run.ts --serve`
  and an in-process HTTP test are not substitutes for this smoke.
- The next PR body labels `% Funcs` as function coverage and `% Lines` as line
  coverage, using the `All files` row from the final full `bun run check` run.
  It includes red/green regression evidence, browser outcomes and the required
  production smoke commands/outcome. It identifies any conditional styles fix
  and its triggering failed check. All committed changes fit the allowlist;
  contract pin, routes, roles and form tokens are unchanged.

This state performed source inspection only. Product tests and the production
smoke are implementation acceptance work, not claimed as completed here.
