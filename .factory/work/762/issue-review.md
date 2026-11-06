# Issue review: #762 — console follow-up to check screens

## Outcome

Ready for `plan`. No unanswered product decision blocks the spec. The implementation target
is `console` only; this review changes only this meta artifact. Build on the merged work from
#751/#567 rather than implementing the check screens again.

## Evidence and prior decisions

- Read root `AGENTS.md`, `README.md`, Factory configuration and the issue-review prompt;
  read the Console instructions and inspected its clone directly. Reviewed Console HEAD
  `fc2c166de8237a841b5253cef99bb3fd17f85f2f`, which includes later layout work from PR #18.
- Read all [#762 comments](https://github.com/lorenzh/pulse-meta/issues/762): only the current
  Factory claim is present, with no prior human decisions or earlier holds.
- Read [Console PR #12](https://github.com/lorenzh/pulse-console/pull/12) metadata/body and
  discussion. It is merged, closes #751, and implements the Console section of
  `.factory/work/567/plan.md`. Its discussion response contains no comments.
- Read the Console section and browser acceptance checks of that approved plan, especially
  the module guide under `AGENTS.md` / “This repository”, keyboard focus through the editor,
  and editor fit at 1280 px.

### Verified current behavior

| Evidence in the Console clone | Finding |
| --- | --- |
| `src/check-form.ts:assertRow` | Applies `.trim()` to `assert_<i>_pointer` before building both Exists and Equals assertions. Thus `/status ` becomes `/status`. Create and edit share this parser. |
| `src/check-editor-page.ts:assertValues`, `editInputOf` | Copies stored pointer strings directly into form values. The rendering path already preserves a trailing space; parsing changes it during submission. |
| `src/check-form.test.ts`, `src/server.checks-change.test.ts` | Existing assertion tests cover ordinary and empty pointers, and existing edit tests inspect outbound PUTs. No stored trailing-space pointer regression was found. |
| `e2e/run.ts:EDITORS`, `checkScreensWith`, `assertQuorumText` | Already visits create and edit forms of all six types with JavaScript on and off. Switches to a 1280 × 800 viewport, but that loop checks quorum text rather than editor width. `assertFits` already measures root scroll width and rejects hiding root overflow. |
| `e2e/run.ts` design matrix; `e2e/design-matrix.ts:assertInput`, `assertRadio`, `assertEditorWidths` | Newer tests already check HTTP edit colors, programmatic input focus, radio arrow operation, selected field widths and sideways scroll at desktop/mobile widths. This partially overlaps the request but does not establish keyboard traversal through a Checks editor or fit of all twelve editors. |
| `src/styles.ts` | Existing `:focus-visible` rules cover inputs, selects, textareas, buttons and summaries with a 2 px outline and 3 px offset. A styling change is needed only if the new checks expose a defect. |
| `AGENTS.md` | Lists the check HTTP test suites but lacks the check-module guide in “This repository”; guides for Team, Tokens and Probes are already present. |
| `package.json`, `bunfig.toml` | `check` runs lint, typecheck (including e2e) and tests; `check:browser` runs `bun e2e/run.ts`. Coverage enables an 80% line threshold and a zero function threshold. Contract pin is `66818a24b81f5d0d86eee939dad64fa126617ba2`. |

The read-only contract clone's `src/schema.ts:jsonAssertSchema` accepts empty pointers or
pointers starting with `/`, validates escape sequences and the byte limit, and does not trim.
There is no contract change implied by preserving a valid pointer's trailing space.

## Nonblocking open points and assumptions for the plan

1. **Pointer semantics.** Treat a pointer as an exact string, including whitespace in key
   names. Preserve it for both Exists and Equals; keep existing contract validation, whole-body
   empty-pointer behavior and assertion modes. Remove normalization at the shared parsing
   boundary, so newly entered pointers also have exact-string semantics. Do not introduce an
   edit-only workaround or change trimming rules for unrelated fields. A leading space before
   `/` is invalid input, not whitespace to repair. No migration of stored checks is needed.
2. **Regression boundary.** Use a stored HTTP assertion ending in a space and change only the
   check's name. Derive submitted values from the editor's stored-value mapping or assert the
   rendered input, then inspect the resulting parsed assertion and outbound PUT. An arbitrary
   manually posted pointer alone would not establish the requested stored-edit round trip.
   Reuse existing parser/editor and HTTP fixtures; the plan can choose the smallest test split.
3. **Keyboard scope.** The original plan does not prescribe a complete focus order for every
   type. Use the complex HTTP editor as the representative Checks editor, covering create and
   edit with JavaScript enabled and disabled. Assert a deliberate sequence of actual Tab
   navigation through common fields and representative select, textarea, header/assertion,
   radio-group or disclosure controls to Submit, with visible outlines. Respect native radio
   group keyboard behavior and the create/edit differences. Existing shell-only Tab checks
   and calling `.focus()` separately on each field do not satisfy traversal through an editor.
4. **Viewport scope.** Reuse the existing twelve-entry `EDITORS` matrix: create and edit of
   HTTP, TLS, TCP, DNS, domain and heartbeat. At 1280 × 800, measure and assert width after each
   navigation, in both JavaScript modes. Setting the viewport or checking only individual
   field widths is insufficient. Reuse `assertFits` and measure editor bounds if needed;
   assert no editor extends horizontally outside the viewport and do not hide overflow to
   pass. Keep newer design-matrix coverage and existing 390 px list/detail checks.
5. **Guide content.** Extend Console `AGENTS.md` under “This repository” with the current
   module map: `check-routes.ts`; list/detail/editor page modules; `check-form.ts`; read/write
   and outcome helpers; formatting, filters, export and shell-copy helpers; and the related
   unit, HTTP and browser fixtures. Explain reuse of the existing roles/form-token gates,
   revision-based writes, write-only keep semantics and exact pointer strings. The guide
   documents existing boundaries rather than changing routes, roles or tokens.
6. **Coverage reporting.** This is an acceptance requirement for the next Console PR body.
   Report function and line percentages under their actual Bun column names from the new
   run; do not reuse the old PR's percentage or infer the line figure from function coverage.
   No coverage threshold, tooling configuration or Factory workflow change is requested.
7. **Boundaries.** Keep the contract pin, routes, roles and form tokens unchanged. Add no
   runtime dependency or other target task. Retain existing secret handling and guards. Keep
   any operator-doc clarification about literal pointer spaces small and follow Console's
   documentation ownership rules; no broader check-screen redesign is implied.

## Derived acceptance check

1. A new regression starts with a stored HTTP assertion such as
   `{ pointer: "/status ", equals: "ok" }`. Opening edit retains the trailing space; submitting
   the form with only the name changed sends the exact original `jsonAssert` in the PUT and
   the changed name. Cover Exists as well at the shared parser boundary. Empty pointers and
   existing validation still behave according to the pinned contract.
2. Demonstrate that the focused trailing-space regression fails on the old parser for the
   expected `/status ` versus `/status` mismatch and passes after the fix. Record the focused
   commands/results during build; this review does not claim that tests have run.
3. Committed browser tests exercise keyboard traversal through the HTTP create/edit editor,
   verify the expected focused controls and visible outline style/width, and reach Submit
   without a trap, with JavaScript on and off.
4. Committed browser assertions verify every create/edit editor in the twelve-entry matrix
   fits the 1280 px viewport in both script modes. Existing axe/CSP and design checks pass.
5. Console `AGENTS.md` contains the check-module guide, consistent with current file names
   and responsibilities. The next PR body reports fresh coverage figures with correct labels.
6. In the implementation checkout, `bun run check` and `bun run check:browser` both exit 0.
   Follow Console's required manual service exercise and record the command/result. Review
   the diff for unchanged contract dependency pin, routes, role policy and form-token logic.

## Review validation and tooling limits

This state inspected repositories and GitHub read-only and wrote only this artifact. No
product code was edited and no product tests were run. Early searches of the not-yet-created
work directory and absent `.factory/work/751` were corrected by using the existing #567 plan
and creating the #762 artifact. `git check-ignore` returns 1 for this unignored path, as
expected. The cloud runtime status tool is unavailable and `/etc/codex/network-policy.json`
is absent in this executor; authenticated GitHub plugin reads succeeded, so neither prevents
this review. No provider labels or comments were changed.
