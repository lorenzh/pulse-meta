# Issue review: #927

The feature can be specified. No question requires a `needs-input` hold. Plan eleven independent target changes, each limited to its root `AGENTS.md`; create that file in `agent` if it is still absent at implementation time.

## Evidence and earlier decisions

- Read the issue and all comments on [#927](https://github.com/lorenzh/pulse-meta/issues/927). The only comment is the current Factory claim; there are no decisions from earlier runs.
- Read meta's `AGENTS.md`, `README.md`, `docs/code-conventions.md`, `.factory/config.yaml` and the issue-review prompt. The convention is already present locally, and a GitHub file read confirmed it exists on meta `main` at [the canonical reference](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md). No new meta convention or Factory configuration change is needed.
- Read all ten existing target `AGENTS.md` files directly from the read-only clones. None names `code-conventions.md`. Inspected the complete tracked tree and README of `agent`: it contains only `LICENSE` and `README.md`, with no `AGENTS.md` or product code.
- Console already has rendering helpers in `src/html.ts` (including `field` and `formErrorSummary`) and `src/states.ts` (including `callout` and `emptyState`). `test/rendered-audit.ts:7` exports `expectCalloutsOnly(body)`, which checks alert/status callout markup and rejects inline styles. `src/server.checks.test.ts` imports and calls it. A text inventory finds the name in three of thirty `src/server.*.test.ts` files; this is not a complete audit of page-rendering tests or indirect helper calls, and does not establish universal compliance.
- Existing instructions already cover purity, small responsibilities and reuse in most targets. The new entry can supplement those instructions without broad edits. Existing stale repository descriptions are outside this issue.

The inspected clone revisions are evidence for this review, not pins to impose on implementation:

| Target | Inspected HEAD | Relevant context for the short entry |
| --- | --- | --- |
| contract | `6370c25d79123f4b81f2482756b6d5487bebb88c` | Shared schemas, validators and wire helpers. |
| probe | `5cc1e3249009813ec1530fff2120df3cb5cc7db7` | Check logic separated from clients and scheduling effects; reuse kit helpers. |
| api | `5d87c591145dd4c94d7d0e7df867e74d9833471a` | Small logic functions separated from HTTP and SQLite effects. |
| status | `cd7904e3b2958cb9c3dadee0718db2f8a7497bd6` | Rendering and formatting logic, with browser/server boundaries preserved. |
| notify | `a833e6bbc95748d262eba8278288671fbe33c6c5` | Shared channel, message and test helpers; effects passed as dependencies. |
| config | `bc870498cc8e2539a132ce2aac35a09db1deabd8` | Shared tooling, scripts, checks and test setup; no product service. |
| kit | `536133f3e8b708179fa01feeb02395a0e1961e07` | Shared runtime helpers with side effects supplied as parameters. |
| website | `d5e725f576922a99dfe7d0520059cb432032e673` | Shared components and pure presentation; build I/O in its existing layer. |
| console | `f0988d91776efb9386d019be2ce0663cb26ee8a0` | Shared HTML/state helpers and rendered-page audit helper already exist. |
| deploy | `9853c6dfc0f2b6acc8584a2e4c5311cece8db885` | Compose, scripts, CLI and test helpers; purity where those layers allow it. |
| agent | `e72ddb2e3f706f2beaf30093f50a4f4dd37b28e6` | Rust host-agent placeholder; create only the requested guidance file. |

## Open points and assumptions for the spec

1. **Missing agent guidance.** “Add an entry” includes creating a minimal root `AGENTS.md` in `agent`. Use a file title and the short Code conventions entry. Do not copy another target's Bun/TypeScript instructions, invent Rust tooling commands, scaffold product code or wait for a separate agent implementation. If main gains guidance first, preserve it and add the entry there.

2. **Portable reference.** Use `[Code conventions](https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md)` or equivalent descriptive Markdown with that exact destination. A bare `docs/code-conventions.md` link would resolve inside the target, and a sibling-checkout or `.repos/meta` path depends on the workspace. The public `main` URL keeps the rule in one place and follows future approved revisions.

3. **Brevity and target fit.** Each target gets a short, discoverable “Code conventions” entry: the link plus one or two sentences covering search before writing, extraction on the second use and small, pure functions where the layer allows it. Use vocabulary appropriate to the target rather than imposing UI or TypeScript rules everywhere. Console additionally needs the specific page/helper/test guidance below, so its complete entry may be a few concise sentences longer. This is the explicit console requirement, not permission to reproduce the seven-rule document or its examples. Naming existing relevant helper modules can make the entry useful without a new inventory or unrelated documentation cleanup.

4. **Preservation and precedence.** Keep existing target text unchanged unless an actual conflicting instruction must be minimally corrected. Existing “keep a helper beside its only caller; move it out when a second module needs it” guidance does not authorize duplicate patterns within a module: the new second-use rule applies wherever the second use occurs. Retain stricter kit/contract reuse, dependency boundaries, purity rules and existing checks. Do not treat generic existing TDD wording as a requirement to add tests for this documentation change. The issue's narrow scope also takes precedence over generic companion-README update wording.

5. **Console wording and scope.** Explicitly state that `*-pages.ts` modules are pure: data in, markup out, no I/O. Name every required shared-helper category: inputs, selects, choices, field errors, tables, callouts, empty states and outcome pages; a screen must not write its own copy. Name `src/html.ts` and `src/states.ts` as existing shared rendering locations, and `expectCalloutsOnly` from `test/rendered-audit.ts` for every `src/server.*.test.ts` that renders a page. Preserve the issue's filename pattern; do not rename modules or expand this into a page-module reorganization.

6. **A documented rule, not a retrofit.** The console test requirement describes what `AGENTS.md` must instruct. It does not authorize changing existing tests, adding an automatic gate, auditing every current page for compliance or repairing existing duplication. This resolves the apparent tension between “every ... runs `expectCalloutsOnly`” and the explicit prohibition on test changes. Existing implementation gaps are follow-up work; do not assert that this feature makes all existing code or tests comply.

7. **Dependencies and rollout.** The shared convention from #925 is already available. All eleven target edits can proceed independently, with no runtime dependency, consumer pin, release/version or CI change. Meta's convention and guidance already provide the source; do not add a twelfth implementation target or change Factory configuration. Re-read each target's current instructions before its implementation because main may advance.

## Derived acceptance check

1. **Coverage and reference.** For each of `contract`, `probe`, `api`, `status`, `notify`, `config`, `kit`, `website`, `console`, `deploy` and `agent`, read the candidate root `AGENTS.md`. Confirm a discoverable Code conventions entry links to `https://github.com/lorenzh/pulse-meta/blob/main/docs/code-conventions.md`. Follow the link and verify it opens the convention document, rather than only checking that a URL is syntactically present.

2. **Common meaning and length.** In every entry, verify the brief wording requires searching for an existing helper before writing one, extracting the second occurrence of a pattern into a shared helper, and keeping functions small and pure where the layer permits it. Review meaning, not an exact sentence template. Confirm target-appropriate wording and no copied rule list or examples.

3. **Console requirements.** Read the console addition and check explicitly for the `*-pages.ts` purity/no-I/O rule; all eight helper categories and the prohibition on screen-local copies; and the instruction that every page-rendering `src/server.*.test.ts` runs `expectCalloutsOnly`, with its existing helper location. This acceptance checks the documented requirement, not universal current implementation compliance.

4. **Scope and preservation.** Review each target PR's complete diff against its implementation base. Only root `AGENTS.md` may change (new in `agent` if absent). Existing text remains intact except for a justified direct contradiction. No source, generated output, dependency, lockfile, test, CI, README or version changes; no new enforcement mechanism or refactoring. Do not add product tests for these prose additions. Honor existing required repository checks without changing their configuration, and report any execution limits accurately.

5. **Final integration check.** After the eleven target PRs merge, read each root `AGENTS.md` from that repository's `main`, repeat checks 1–3, and record the reviewed main revision per target. Candidate-branch review supports individual PR acceptance; it does not substitute for the issue's explicit post-merge main check. No merges are authorized by this review state.

This issue-review run changed only this artifact. It did not modify the context clones, run product checks or change provider comments or labels.
