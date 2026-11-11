# Issue review: #838

## Decision

Ready for `plan`; no question needs a `needs-input` hold. This is a console-only accessibility correction to the existing incident preview from #569 / child #787 / pulse-console#19, not a new composer or a change to pulse-status.

Read issue #838 and all its comments through GitHub on 2026-11-08. The only comment is the current Factory claim; there are no prior decisions or unanswered questions. Do not change provider labels or comments.

## Inspected evidence

- Read meta `AGENTS.md`, `README.md` and `.factory/prompts/issue-review.md`, and console `AGENTS.md` and the relevant README/documentation sections. Inspected the read-only clones directly, rather than relying on a workspace search that skips them.
- Console clone HEAD: `aa5dc1808d55f9e6655f4da78388957b522c189a`. This is the inspection revision; the implementation must record its own actual starting commit as `BASE`.
- Console `src/incident-preview.ts`: `openPreview` and `resolvedPreview` preserve the raw title. `previewSection` always renders `<h3 data-part="title">…</h3>` (line 84), including for an empty title. It already uses `hidden` on the empty component list.
- Console `src/console-script.ts`: `renderPreview` updates the title through `setPart`, which only assigns `textContent`; it does not update title visibility. The preview changes on both `input` and `change`. Update/resolve forms have no title input, so their existing server-provided titles must remain intact.
- Console `src/incident-preview.test.ts` has three existing tests for escaped filled parts, component names, and the resolved timeline. It has no empty-title visibility assertion. There is no `src/console-script.test.ts` in this clone; browser coverage is the existing way to exercise the script.
- Console `e2e/run.ts`: `checkIncidentsWith` already starts a stateful fake API and an authenticated console and runs with JavaScript on and off. `incidentLayout` includes `/incidents/new`; `axeOn` uses only WCAG tags, explaining why this check cannot catch the reported best-practice failure. `incidentLivePreview` checks inert text, no live region, zero API writes, and equality with the server preview after `Update preview`. Its `previewParts` comparison includes each part's `hidden` attribute. `axeOn` navigates before analyzing, so reusing it after typing would discard the state under test.
- Console `src/incident-pages.ts` and `src/incident-routes.ts`: the composer uses the shared preview renderer for its initial empty state and server preview responses. Existing `src/server.incidents-write.test.ts` covers server preview with zero writes and existing untitled-title validation.
- Status clone HEAD: `b3a29d5873b56f34de847dfb53a11f5d6d48b2a7`. Read `src/render.ts:649-729`: `manualHead` escapes the raw incident title and renders it as a named span; impact, status, components and update messages are separate parts. Parity means the existing filled text parts, escaping and update selection, not identical HTML tags or layout. No status change or dependency update is needed.
- Console `package.json` uses Bun 1.4.0. `check` runs lint, typecheck and the full test suite; `check:browser` separately runs `e2e/run.ts`. `bunfig.toml` enables coverage with an 80% line threshold. Browser dependencies are already pinned; no new package is needed.

## Open points resolved by assumptions

1. **Meaning of empty.** Specify the reported zero-length title (`title === ""`). Do not introduce trimming, a new title classifier, replacement text, or changed validation. Nonempty raw titles, including leading/trailing whitespace and the existing untitled-incident cases, retain their current text behavior. Broader treatment of invisible-only titles is outside this request; `docs/incidents.md` already describes its separate validation and display rules.
2. **Visibility mechanism.** Both omission and `hidden` are permitted by the request. Prefer retaining the existing title element and toggling `hidden` on server and client: this preserves the update selector and permits empty → filled → empty → filled without rebuilding DOM. An omitted-node implementation must prove the same transitions. `aria-hidden` alone, CSS-only hiding, or a placeholder heading does not meet the request.
3. **Audit scope.** Add an unrestricted, default-rule axe analysis of the whole `/incidents/new` page for the relevant states; no WCAG-only filter, exclusions or disabled `empty-heading` rule. Keep the existing WCAG audits for other pages. The result must have zero total violations, not merely zero violations with that one id. Inspect the current DOM without navigating between an edit and its analysis.
4. **Server and client independence.** Initial HTML must hide/omit the heading before the console script runs. The script must reveal it for a value and hide it again on clearing. A client-only fix fails the request. Cover a native `Update preview` response with an empty title and with a filled title, including JavaScript disabled, to exercise the shared server path.
5. **Documentation is required.** This changes visible preview behavior, so the internal/test-only exception does not apply. Console `AGENTS.md` explicitly requires `README.md` and `docs/configuration.md` for a behavior change. Also update the preview owner, `docs/incidents.md`, and the browser-check description in `docs/development.md`. These four documents must describe the same behavior; no endpoint, setting, form-field or CSP change is implied.
6. **Dependencies and integration.** The prerequisite feature is already present in the inspected console clone. Reuse its preview, script, fake API, auth helpers and browser runner. Do not redo the broader incidents/maintenance feature or add work to another target. Existing filled-title controls are sufficient to preserve renderer parity; this fix does not require a new cross-service harness or Docker run.
7. **Evidence belongs to the later execution states.** No test pass, baseline reliability, measured CPU delta or browser reproduction is claimed by this source review. Planning must verify any proposed baseline controls before describing them as passing; missing dependencies in these read-only clones are not a reason to invent a pass or to hold this spec.

## Exact implementation scope

The plan and every task must agree on this union. Task-specific `Files:` may use a subset, but no unlisted target path may change:

- `src/incident-preview.ts`
- `src/incident-preview.test.ts`
- `src/console-script.ts`
- `e2e/run.ts`
- `README.md`
- `docs/configuration.md`
- `docs/incidents.md`
- `docs/development.md`

Use the existing unit-test file and browser runner; no new test file or persistent scope-check harness is needed. Scope-check fixtures and timing logs can live in disposable temporary directories and be reported as evidence. No `.factory/` files belong in pulse-console. This issue-review artifact belongs only in meta.

Protect every path outside that list, explicitly including `AGENTS.md`, `package.json`, `bun.lock`, `bunfig.toml`, `biome.json`, `eslint.config.js`, all tsconfig files, `.github/`, `assets/`, `test/`, `src/server.ts`, `src/incident-routes.ts`, `src/incident-pages.ts`, `src/incident-form.ts`, `src/incident-read.ts`, `src/incident-write.ts` and `src/styles.ts`. No other repository, route, field, API shape, validation policy, dependency pin, CSP or existing filled-preview text changes.

## Derived acceptance

### Behavior and regression checks

1. Extend `src/incident-preview.test.ts` through exported `previewSection`/preview builders. For `title: ""`, there is no exposed title heading: the element is absent or carries `hidden`. For a nonempty title, its heading is present, unhidden and correctly escaped. Include a filled title with markup characters and outer whitespace; preserve literal text without creating markup. Retain the existing filled-open and resolved-preview assertions.
2. In `e2e/run.ts`, test a fresh authenticated `/incidents/new` page: the title input is empty and the preview has no exposed empty title heading. Default axe analysis of the whole page reports `violations.length === 0`, with `empty-heading` enabled. Add an identifiable success line for this case to the existing `bun run check:browser` flow.
3. Without navigation, enter a filled title, clear it, and enter a filled title again. Assert heading visibility and literal title text at each step and run unrestricted axe in the filled and cleared states. Exercise the existing `input` and `change` listeners, so a hidden title cannot remain stuck after filling or exposed after clearing. Keep the rest of the preview visible and unchanged. The exercise must make zero preview-triggered HTTP requests or API writes and produce no CSP violations or browser errors.
4. With JavaScript disabled, inspect the initial empty composer and submit native `Update preview` with empty and filled titles. The server response has the corresponding hidden/absent or visible title heading. No API writes occur; normal config reads are allowed. With JavaScript enabled, retain the existing filled live/server `previewParts` comparison, including visibility, inert markup, affects, impact, status, message and update behavior. Filled resolve/update previews remain visible even though those forms have no title input. Do not attempt to inject axe into the JavaScript-disabled context; use its DOM/visibility checks and the scripted axe checks for their respective evidence.
5. Update all four listed documents in the same change. README and configuration describe the title appearing only when nonempty; incidents documents the same server/live-preview behavior without changing its raw-title rules; development documents the unrestricted empty-composer audit separately from the existing WCAG-tagged audits. Review the diff to confirm no documented endpoint, form-field, setting or CSP contract changes.
6. Final pulse-console `bun run check` and `bun run check:browser` exit 0. The full check retains the repository coverage threshold and existing lint/typecheck policies. Before handoff, also exercise the change once through a service started with `bun start`, as console `AGENTS.md` requires; report the command and observed empty/filled/cleared behavior. Use local fake API data and temporary database state, with no external mutations.

### Baseline and red/green evidence

7. Record the actual implementation `BASE` SHA before editing. A later plan may call a baseline control passing only after three independent executions on that exact base exit 0 with the expected pass count. Candidate controls are the existing preview unit tests and existing filled-preview behavior; their reliability is unverified here. Do not label any full suite or known-flaky file a guaranteed passing baseline without evidence. Preserve the required final full-check gate; report unrelated baseline failures accurately rather than weakening tests or configuration.
8. For focused Bun controls and regression runs, create an empty temporary TOML config using file tools and verify on the recorded base that `bun test --config <absolute-empty-config> ./src/incident-preview.test.ts` disables automatic coverage and reliably passes the original three tests. Do not use the empty config for `bun run check`, and do not edit tracked `bunfig.toml` or lower coverage. Pin exact commands, Bun version, expected counts and all three outcomes in the plan/evidence.
9. Run the new regression assertions against unchanged production code at `BASE`, in a disposable writable checkout during implementation, and observe three reliable failures for the intended empty-title visibility / `empty-heading` reason. A filled-title compatibility control should continue to pass. Reapply the fix and obtain green results. A dependency, auth, unrelated browser-matrix or coverage failure is not the intended red signal. Ensure direct browser regression evidence can reach this case even if unrelated earlier runner checks fail; temporary execution harnesses need not expand the target file list.

### Scope, comments and performance evidence

10. Every task's acceptance must separately check committed, indexed and worktree changes against its recorded implementation base and exact allowed list. After the last commit:
    - Compare `git diff --name-only "$BASE" HEAD` with the exact task `Files:` allowance; fail for any outside path.
    - Require both `git diff --name-only --cached` and `git diff --name-only` to be empty.
    - Require `git status --porcelain` to be empty, including untracked files.
    - Require `git diff --exit-code "$BASE" HEAD -- <protected files>` to succeed. Expand the protected paths explicitly and also protect the complement of the allowed list, so the check cannot miss an unanticipated path. README is allowed here because its update is mandatory.
11. Prove those checks using a disposable Git fixture with representative allowed and protected paths: a clean allowed committed change passes, while a protected change in each of the committed, index-only and worktree-only states fails its appropriate check. Include the restored-worktree trick twice: stage a protected change and restore its worktree contents to the base without resetting the index; then, separately, commit a protected change and restore only the worktree to the base. Both must fail even though the protected file's current worktree contents match the base. Also demonstrate that an untracked file fails the clean-status check. Include the fixture results in every task's evidence; never mutate the read-only context clones to perform this proof.
12. Read every added line before handoff, including inline comments and additions to existing files. List every added comment in the PR body; write `none` only after that inspection. No new test file is planned. If one becomes necessary, reconcile the exact file lists in issue review, plan and task first, and permit no explanatory comments there beyond one line naming the test class and expected outcome.
13. Report test CPU as information from five interleaved base/branch pairs using the same Bun, pinned dependencies and coverage settings: base, branch, base, branch, until five samples per revision. Measure user plus system CPU of the full test command, including children; report samples, medians, branch-minus-base seconds and percent. Use the unchanged original suite on the base for timing, after removing temporary red-test additions. Report failures and noise honestly; no CPU budget is specified. Do not run the Docker bench (#834).

## Work performed in this state

Only this meta artifact was created. No target files, provider labels or comments were changed. No dependencies were installed and no target tests, browser checks, scope fixtures or benchmarks were run. Initial path probes found no existing work directory, no target `node_modules`, and no standalone console-script test; subsequent inspection used the actual existing paths. The cloud runtime skill was read; environment-status tools and `/etc/codex/network-policy.json` are not available in this executor, so no runtime-readiness claim is made. These observations do not block source-based issue review or the transition to planning.
