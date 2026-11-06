# Issue review: #777

## Decision

Ready for `plan`. No question blocks the spec. This is a console-only correction to the merged design work, not a repeat of #774/#776. No other target needs a change or an unmerged prerequisite.

## Sources and current baseline

- Read the meta `AGENTS.md` and `README.md`, and the console `AGENTS.md`, package scripts, shared stylesheet, table renderers and browser harness directly in `.repos/console`.
- Read [#777 and its comments](https://github.com/lorenzh/pulse-meta/issues/777). At review time the only comment is the current Factory claim; there are no earlier decisions or unanswered questions.
- Read [#774](https://github.com/lorenzh/pulse-meta/issues/774), its comments and `.factory/work/774/plan.md`, plus [#776](https://github.com/lorenzh/pulse-meta/issues/776). The owner decision in #774 is to self-host the fonts; those files and their delivery are already implemented and need no changes here. The older #774 issue-review artifact predates that decision; use the final issue and approved plan for inherited requirements.
- [Console PR #15](https://github.com/lorenzh/pulse-console/pull/15) is merged. The inspected console main is `00ef91c920e6c5376f8cc297ee71825605251789`, that merge commit.
- `src/styles.ts:40–43` currently sets body to `1rem`, h1 to `1.75rem` with line-height `1.2` and tracking `-0.01em`, and h2 to `1.125rem`. The global wrapping selector includes anchors and cells; `overflow-wrap: anywhere` is also inherited from body. These declarations differ from the requested scale.
- `src/styles.ts:167–181` has full-width collapsed tables, focusable scroll wrappers, minimum widths of `56rem` for Checks and `60rem` for token tables, and a Checks-specific normal-wrapping override on td. Headers and action links have no shared nowrap protection. The anchor rule can still break words within Checks cells. The reported 45 px column and line counts are issue evidence, not measurements reproduced during this review.
- Checks actions are the last td in `src/check-pages.ts`, containing space-separated View/Edit/Export/Delete links. Team member and invite tables use their last td for actions (`src/team-pages.ts`); token and probe credential tables do likewise (`src/token-pages.ts`, `src/probe-pages.ts`). Sessions (`src/account-pages.ts`) has headers but no Actions column: its last cell is the current-browser indication. All these tables already have named, focusable scroll wrappers. Tokens and probes are built on this baseline, even though #774 originally excluded them from its screen list.
- `check:browser` runs `bun e2e/run.ts`. Its existing design matrix uses light/dark and 1280 × 800 / 390 × 844 contexts with long and hostile check names. `e2e/design-matrix.ts` checks document overflow and whether the Actions header can be scrolled into view, but not whether its text or the action words occupy one line. Existing checks cover font loading/use, not these computed type sizes.

## Open points and working assumptions

1. **Missing mobile section size:** derive it from the approved #774 formula rather than ask for another design decision. Keep the root's ordinary 16 px basis; set body to `0.9375rem`, h1 to `clamp(2rem, 1.8rem + 0.8vw, 2.5rem)`, and h2 to `clamp(1.25rem, 1.15rem + 0.4vw, 1.5rem)`. The expected computed sizes are:

   | Viewport width | Body | Page title | Section heading |
   | --- | --- | --- | --- |
   | 1280 px | 15 px | 39.04 px | 23.52 px |
   | 390 px | 15 px | 32 px | 20 px |

   Page titles keep weight 700 and gain line-height 1.1 and tracking -0.02em; section headings keep weight 500. Do not change the root size to 15 px, which would also change rem-based layout and controls.

2. **Which section heading to measure:** use an actual ordinary h2, such as `/team`'s `#people-heading` or the edit form's “Probe host binding”. Panel eyebrow h2, callout titles and empty-state headings intentionally have their own sizes and do not represent the section scale. Preserve those component overrides and the existing font assets/stacks. This issue does not request a wider audit or change of small, label, tag or button sizes.

3. **Shared table scope:** keep every table header and the Actions cells/labels unbroken through the shared stylesheet, with selector coverage for Checks, Team including invites, tokens and probe credentials. Sessions receives the shared header protection. A shared class/selector may need small markup changes to identify action cells; there is no requirement to use a particular selector. Do not blindly treat every last td as Actions, or remove wrapping globally from names, URLs and prose. Inspect the token Actions cells' explanatory text as well as active Rotate/Revoke links. Extra table width belongs inside the existing scroll wrapper.

4. **Meaning of one line:** protect the Actions cell and headers with `white-space: nowrap` as requested, and measure the rendered text itself. A visible link or a narrow header element can still contain multiple text lines. Use text Range geometry (distinct line tops with a small subpixel tolerance) or an equivalent real layout assertion, rather than only checking computed nowrap, element visibility or total cell height. Multiword Team/probe action labels should also stay intact. Preserve visually hidden accessible suffixes on Team links.

5. **Representative data and regression proof:** test an authorized, editable database check whose row actually contains all four words; assert that each expected label exists before measuring it. Keep the existing long/hostile data. The browser checks must independently expose both wrapping and typography defects against the inspected baseline; an early typography failure alone does not establish that the action regression test works. No production fixture route or new dependency is needed.

## Derived acceptance check

1. In the existing browser runner, cover all four width/scheme combinations: 1280 × 800 and 390 × 844, each explicitly light and dark. Wait for fonts to be ready before geometry measurements.
2. On `/checks`, assert Actions and each View, Edit, Export and Delete label in the representative row occupy exactly one rendered text line. Check all header labels for the shared header requirement. At 390 px scroll the named table region fully to the Actions end and verify the action text remains intact and reachable. Retain keyboard scrolling, focusability, accessible name, visible overflow hint and focus-outline checks.
3. Check computed body, page-title and ordinary section-heading sizes against the literal table above in both schemes, with a narrow numeric tolerance for browser rounding (for example 0.05 px). Also verify title line-height equals 1.1 times its computed size and letter-spacing equals -0.02 times that size. Do not derive expected values from the stylesheet under test.
4. Inspect populated Team/invites, Sessions, Tokens and Probes tables at both widths for intact headers and any available action labels. Use permitted rows that actually expose actions, including multiword labels. Confirm shared CSS covers them, table overflow stays in their existing wrappers, and document width remains within the viewport. Keep existing long-name, URL, secret/snippet and accessible-text behavior.
5. Demonstrate red/green behavior: with the new assertions and the baseline CSS, the action wrapping checks and the type-size checks fail for their intended reasons; with the correction both pass. Record the commands, failing assertions and final results. When the runner stops on its first failure, run the regression groups separately or otherwise demonstrate each one.
6. In the console implementation checkout, `bun run check` and `bun run check:browser` pass without weakening existing assertions, lint/type/coverage gates, axe, CSP or overflow checks. Complete the console's required user-visible smoke exercise and report the command/result at handoff.
7. The implementation changes only console presentation and its regression coverage. Token values, font delivery, CSP, routes, role permissions, forms and stored data retain their behavior. No dependency or lockfile change is needed; no changes to other target repositories are required.

This issue-review state inspected source and remote discussion; it did not run or claim completion of the implementation's Bun/browser checks. Only this artifact is written in meta; the read-only target clones remain untouched.
