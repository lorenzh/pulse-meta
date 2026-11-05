# Issue review: #754 — console: one sentence on the 404 page

The request is ready for `plan`. There are no blocking questions. Only the `console` target needs an implementation; this review changes no target repository.

## Sources and current behavior

- Read meta `AGENTS.md`, `README.md`, and the issue-review prompt, plus console `AGENTS.md`, its renderer, callers, tests, package scripts and CI workflow.
- Read [#754 comments](https://github.com/lorenzh/pulse-meta/issues/754): the current Factory claim is the only comment; there are no decisions from earlier runs.
- Read [#741 comments](https://github.com/lorenzh/pulse-meta/issues/741) and [child #748 comments](https://github.com/lorenzh/pulse-meta/issues/748). The [review note on #741](https://github.com/lorenzh/pulse-meta/issues/741#issuecomment-6656377278) explicitly identifies the conflict between “one plain sentence” and the two-sentence literal in its plan, and suggests “There is no page at this address; go to the overview.” The #748 discussion records the earlier implementation and validation. The PR #11 comments endpoint returned an empty list.
- Inspected `.repos/console` on `main` at `9a3ef14fc8a0335f8bf70f56023868633a56525e` (merge of console PR #11). The earlier feature is already present; do not redo #741's shell, account-page, styling or API-error work. No waiting implementation dependency is needed.
- `src/states.ts:90–94`: `notFoundState()` returns `<p>There is no page at this address. Check the address, or go to the overview.</p>`, followed by `<p><a href="/">Go to the overview</a></p>`. It adds no heading of its own.
- `src/shell.ts`: the shell puts the page title in one `h1` inside `main#main`; `documentHead()` also uses it in the HTML `title`. One visible title is already satisfied.
- `src/server.ts:1009–1019`: unknown paths use this shell 404 for eligible signed-in GET/HEAD requests; other unknown-path requests retain the plain text 404. `src/team-routes.ts` and `test/fixture-routes.ts` also reuse the renderer. Changing its fixed copy therefore reaches their existing shell 404s as well.
- Existing assertions bind the old wording in `src/states.test.ts:87–89`, `src/server.security.test.ts:605–607`, and `e2e/run.ts:374–375`. Two partial assertions in `src/server.confirm.test.ts:215,225` require `There is no page at this address.` and must also change if the suggested semicolon wording is used.
- `README.md:12` and `docs/configuration.md:115` quote the old literal. Console instructions require those documents to stay consistent with page behavior.
- `package.json` defines `bun run check` as lint, typecheck (including e2e), and tests; `bun run check:browser` drives the browser checks. Bun is pinned to 1.4.0. `.github/workflows/ci.yml` includes check, browser, Docker on both architectures, and deploy-dev jobs for pull requests.

## Open points and assumptions

1. **Resolve the old spec's contradiction.** `.factory/work/741/plan.md` requires one plain sentence but D6 fixes a two-sentence literal. #754 and the later review note clarify the intended result. Use the suggested sentence, `There is no page at this address; go to the overview.`, as the new fixed copy. Exact wording was presented as an example, so choosing it needs no decision from a person.
2. **Define the sentence-count input.** “Rendered 404 body” means the explanatory prose rendered inside the main content area. Count its text after rendering, excluding the heading, separate overview action link, shell navigation, account header and document metadata. `Intl.Segmenter` can treat headings and link labels as sentence segments even without terminal punctuation; counting all page text would test the shell rather than this requirement. Assert one nonempty explanatory paragraph as well as one sentence, and assert the title and link separately.
3. **Keep the existing visible title.** “Title once” refers to the single visible `h1` `Page not found`, with no repeated state heading. The document `title` remains; it is not a second visible heading.
4. **Shared renderer scope.** Update the copy in `notFoundState()` so all its existing callers receive the correction. Do not change routing, status codes, GET/HEAD behavior, plain text 404s, invalid public-link pages, session or role gates, security headers, CSP, form tokens, or shell markup. The distinct `Link not valid` page is outside scope.
5. **Tests and documentation are part of the wording change.** Update all stale full and partial assertions and both quoted documentation passages. Preserve the existing title, link-navigation, HEAD and plain-404 checks. No new packages, dependency pins, configuration, CI workflow changes, or other targets are needed.
6. **Validation belongs to the console build.** This state establishes the acceptance check without editing the read-only console clone. The implementer must record the new rendered-output test failing on the inspected main behavior and passing after the wording change, then run the existing checks and observe PR CI.

## Derived acceptance check

1. In the existing authenticated 404 browser flow (`e2e/run.ts`, `checkNotFound`), visit `/does-not-exist` with a full session. Assert HTTP 404, exactly one visible `Page not found` heading (the shell `h1`), and no repeated body heading.
2. Read the explanatory paragraph text from the rendered `main#main`, selecting the prose separately from the link-only paragraph. Assert exactly one nonempty explanatory paragraph. Apply `new Intl.Segmenter("en", { granularity: "sentence" })` to that rendered text, discard whitespace-only segments, and assert exactly one segment. Assert the fixed copy independently as `There is no page at this address; go to the overview.`. Do not count a hard-coded replacement string or read the source file in the regression test.
3. Write and run the sentence-count assertion before changing production copy: on console main it must fail with actual count 2 versus expected 1. After changing only the wording, the same assertion must pass with count 1. Keep the count assertion independent of the literal assertion so the demonstrated failure specifically proves the sentence defect. Record the command, baseline revision and both results in build evidence.
4. Verify the existing `Go to the overview` link retains `href="/"` and clicking it reaches the overview. Update the unit, HTTP, confirmation-fixture and browser literals identified above; continue checking single-heading output, shell/security headers, empty HEAD body with status 404, and unchanged plain text unknown-path responses.
5. Update `README.md` and `docs/configuration.md` to quote the new sentence. Inspect the final diff to confirm production code changes are confined to that copy.
6. On the console implementation, run `bun run check` and `bun run check:browser`, exercise the 404 once through the running service as required by console `AGENTS.md`, and require all applicable PR CI jobs to be green. Do not weaken tests or CI to meet this condition.

## Review validation and limits

- A read-only Node 24.19.0 probe extracted the current paragraph from `src/states.ts` and applied the English `Intl.Segmenter`: current copy yields 2 sentences; the proposed copy yields 1. Bun 1.4.0 is available. This probe establishes the text distinction only; it is not the required rendered-output regression test or a claim that console checks ran here.
- The initial artifact-directory listing reported that `.factory/work/754` did not exist. Creating this review file creates that directory; no existing artifact was lost. A later search found no additional meta `AGENTS.md`; target status was rechecked separately after the no-match search stopped the earlier command chain.
- No product files, provider labels or comments were changed. No unresolved tool failure blocks planning.
