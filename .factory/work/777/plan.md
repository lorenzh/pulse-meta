# Spec #777: console: fix squeezed table actions and the type scale

## Goal

Fix two defects on console `main` left by the design change (#774, #776, console PR #15):

1. The shared wrapping rules squeeze the Actions column of the Checks table so that the header
   "Actions" and the action links View, Edit, Export and Delete break over several lines. The same
   rules affect every console table header and action cell.
2. The body, page title and section heading sizes differ from the type scale approved in #774.

Add browser checks that fail on today's `main` and pass after the fix.

## Sources

- Issue #777 and its one comment (the issue-review run). Issue review:
  `.factory/work/777/issue-review.md`. It found no blocking question, and this spec adopts its
  working assumptions 1 to 5.
- Approved scale, #774 issue body: "Base 0.9375rem (15 px), line-height 1.5 … Page title
  `clamp(2rem, 1.8rem + 0.8vw, 2.5rem)`, weight 700, letter-spacing -0.02em, line-height 1.1.
  Section heading `clamp(1.25rem, 1.15rem + 0.4vw, 1.5rem)`, weight 500."
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/777` answered
  `HTTP 404`, so there are no findings. This is normal for a feature with no children yet.
- Console clone at `00ef91c` (merge of PR #15), read directly. The facts below come from it.

### Current behavior (console `00ef91c`)

- `src/styles.ts:40`: `body { … font-size: 1rem; … line-height: 1.5; … }`.
- `src/styles.ts:41`: `body, p, h1, h2, h3, li, label, a, dd, td, legend { overflow-wrap: anywhere; }`.
  `th` inherits `anywhere` from `body`. `a` has the rule directly, so the Checks override at
  `src/styles.ts:179` (`.table-scroll table.checks td { overflow-wrap: normal; word-break: normal; }`)
  does not reach the links. With `anywhere`, the min-content width of a header or a link shrinks
  to one character. Table auto layout then gives that column almost no width, which is the
  reported ~45 px column.
- `src/styles.ts:42`: `h1 { font-size: 1.75rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; margin: 0; }`.
- `src/styles.ts:43`: `h2 { font-size: 1.125rem; font-weight: 500; line-height: 1.3; margin: 0; }`.
- Component h2 sizes that stay as they are: `.eyebrow` (`src/styles.ts:47`, 0.75rem),
  `.callout-title` (`src/styles.ts:133`, 15 px) and `.empty-state h2` (`src/styles.ts:146`,
  1.125rem). Each has higher specificity than `h2` or comes later in the stylesheet.
- `src/styles.ts:167–180`: `table { width: 100% }`, `th`/`td` padding, `.table-scroll` with
  `overflow-x: auto`, `table.checks { min-width: 56rem }`, `table.tokens { min-width: 60rem }`.
  No rule sets `white-space` on `th` or on an action cell.
- Tables and their action cells:
  - Checks, `src/check-pages.ts:174`: the last `<td>` holds `rowActions()` (lines 135–151), which
    joins with spaces the links View, Edit (database, not shadowed, addressable, `check.write`),
    Export (`check.write`) and Delete (`check.delete`). Headers are at line 182.
  - Team members, `src/team-pages.ts:70`: the last `<td>` holds `<span class="row-actions">` with
    links "Change role", "Reset link", "Reset 2FA", "Remove" and "Make owner". Each link has a
    visually hidden suffix " for <name>" (lines 46–61).
  - Team invites, `src/team-pages.ts:86`: the last `<td>` holds "Revoke" with a visually hidden
    suffix.
  - Tokens, `src/token-pages.ts:65–75, 92`: the last `<td>` holds "Rotate" and "Revoke" links, or
    the prose `<strong>This console</strong> OWN_TOKEN_TEXT` (111 characters), or
    `LAST_ADMIN_TEXT` in place of Revoke.
  - Probe credentials, `src/probe-pages.ts:72–82`: the last `<td>` holds "Rotate this token" and
    "Revoke this token".
  - Sessions, `src/account-pages.ts:212–219`: headers "Signed in", "Last used" and an empty
    header. The last cell is "This browser". There is no action column.
  - All of these tables sit in a focusable `.table-scroll` region with an `aria-label`.
- Browser harness: `check:browser` is `bun e2e/run.ts` (`package.json` `scripts.check:browser`).
  `checkDesignMatrix` (`e2e/run.ts:2449`) runs light and dark contexts and, for each,
  `MATRIX_WIDTHS` = 1280×800 and 390×844 (`e2e/run.ts:2183`). `matrixPages` visits `/checks`
  (`e2e/run.ts:2224–2232`) and calls `assertChecksBoxEnd` only at 390 px. That function
  (`e2e/design-matrix.ts:204`) checks that the Actions header can be scrolled into the box, but
  not how many lines it takes. `MATRIX_CHECKS` (`e2e/run.ts:2178`) adds the database checks
  `long-url`, `long-name` and `hostile` for the owner, so each of their rows shows View, Edit,
  Export and Delete. No current browser check asserts computed font sizes. An existing helper
  counts lines with a Range: `emailTops` (`e2e/run.ts:403`) counts the distinct rounded tops of
  `range.getClientRects()`.
- `src/server.test.ts:148–200` asserts some substrings of `/console.css`, but none of the rules
  this spec changes. `src/server.tokens.test.ts:144` asserts that the body contains
  `<strong>This console</strong>`.

## Scope

Console only: `src/styles.ts`, the action-cell markup of the five tables that have actions, the
browser checks, and the unit tests that cover the served CSS and markup.

## Non-goals

- No change to color tokens, the CSP, routes, roles, permissions, forms, stored data, font files,
  or font delivery.
- No change to the root font size (it stays 16 px), so rem-based layout and controls keep their
  sizes. Small, label, tag, button (15 px), eyebrow, callout-title and empty-state title sizes
  stay as they are.
- No global removal of `overflow-wrap: anywhere` from names, URLs, prose, `code` or `.secret`.
  Long names and URLs still wrap as they do today.
- No new dependency and no lockfile change. No other repository changes.

## Required behavior

### R1. Table headers on one line

Every `th` of the console gets `white-space: nowrap` from the shared stylesheet. Each header
label then renders on exactly one line, at every width, in every table: Checks, Team members,
Team invites, Sessions, Tokens and Probe credentials.

### R2. Action cells on one line

- Each action `<td>` gets the class `actions-cell`: Checks (`src/check-pages.ts:174`), Team
  members (`src/team-pages.ts:70`), Team invites (`src/team-pages.ts:86`), Tokens and Probe
  credentials (their last cell). The markup is otherwise unchanged: same links, same order, same
  separators, same visually hidden suffixes. Do not mark a cell as an action cell just because it
  is the last cell. Sessions has no action column and gets no `actions-cell`.
- Shared CSS: `td.actions-cell` gets `white-space: nowrap`. `td.actions-cell a` gets
  `white-space: nowrap; overflow-wrap: normal`, so a link label (including a multi-word label
  such as "Change role" or "Revoke this token") never breaks.
- Prose in a token action cell (`<strong>This console</strong> OWN_TOKEN_TEXT` and
  `LAST_ADMIN_TEXT`) goes into `<span class="cell-note">…</span>`. The shared rule
  `.cell-note { white-space: normal; overflow-wrap: normal; }` lets that prose wrap between words
  but never inside a word, so a 111-character sentence does not force one line of about 800 px.
  `<strong>This console</strong>` stays in the markup as a substring.
- Rely on the existing scroll box for extra width. `.table-scroll` already has
  `overflow-x: auto`, and `table { width: 100% }` grows past the box when its min-content needs
  more room. Do not add `max-width`, `table-layout: fixed`, or a fixed column width that would
  squeeze another column back. `assertNoSidewaysScroll` must stay green: the document never
  scrolls sideways at 390 or 1280 px.

### R3. Type scale

In `src/styles.ts`, keep `html`/root at the browser's 16 px and change only these declarations:

- `body`: `font-size: 0.9375rem` (line-height 1.5 unchanged).
- `h1`: `font-size: clamp(2rem, 1.8rem + 0.8vw, 2.5rem); font-weight: 700; line-height: 1.1; letter-spacing: -0.02em;`
- `h2`: `font-size: clamp(1.25rem, 1.15rem + 0.4vw, 1.5rem); font-weight: 500;` (line-height 1.3
  unchanged).

The expected computed values below come from the #774 formulas, worked out in this spec. They
are not read from the stylesheet:

| Viewport width | body | h1 (page title) | ordinary h2 (section heading) |
| --- | --- | --- | --- |
| 1280 px | 15 px | 28.8 + 10.24 = 39.04 px | 18.4 + 5.12 = 23.52 px |
| 390 px | 15 px | 28.8 + 3.12 = 31.92 → clamped to 32 px | 18.4 + 1.56 = 19.96 → clamped to 20 px |

The h1 line-height is 1.1 × its size (42.944 px at 1280, 35.2 px at 390). Its letter-spacing is
−0.02 × its size (−0.7808 px at 1280, −0.64 px at 390). `.eyebrow`, `.callout-title` and
`.empty-state h2` keep their own sizes.

### R4. Browser checks (`check:browser`)

The expected values are literals in `e2e/design-matrix.ts`, written from this spec. They are
never read from `CONSOLE_CSS` or from computed styles of another element.

- **Line counting.** Add a helper that counts the lines of an element's text: the number of
  distinct `Math.round(rect.top)` values over `range.getClientRects()` of a Range set with
  `selectNodeContents`, keeping only rects wider than 0. This is the same method as `emailTops`.
  Exclude `.visually-hidden` descendants (they are clipped to 1 px). The simplest way is to
  measure the link's first text node. Call `document.fonts.ready` before you measure.
- **Checks rows (matrix, light and dark × 1280 and 390).** In `matrixPages`, on `/checks`, find
  the row whose Id cell is `long-url`. Assert that its `td.actions-cell` contains exactly the
  links View, Edit, Export and Delete, in this order (literal list). Assert that each one has
  exactly 1 line. Assert that the "Actions" header has exactly 1 line. At 390 px, run this after
  `assertChecksBoxEnd` has scrolled the box to its end, and also assert that the Actions cell of
  that row lies inside the box rectangle (±0.5 px). Keep every current `assertChecksBoxEnd`
  check: tabindex, hint, ArrowRight scroll, header inside the box, 2 px outline.
- **All Checks headers.** In the same place, every `th` of the Checks table has exactly 1 line.
  Its text must equal one of the literal list Name, Id, Type, Target, Source, State,
  Last result, Actions.
- **Type sizes (matrix, light and dark × 1280 and 390).** On `/team`, which `matrixTeamAndAccount`
  already visits, read `getComputedStyle` of `body`, of `.page-head h1`, and of
  `#people-heading` (an ordinary h2). Parse each value with `parseFloat` and compare it with the
  R3 table with a tolerance of ±0.05 px:
  - body `fontSize`;
  - h1 `fontSize`, `lineHeight` (1.1 × the expected size) and `letterSpacing` (−0.02 × the
    expected size);
  - h2 `fontSize`.
  Also assert h1 `fontWeight` 700 and h2 `fontWeight` 500.
- **Other tables.** Use the same line helper for these, at the widths the harness already uses:
  - Team (`checkTeamActions` at 390, where a member row shows its multi-word links; the matrix
    `/team` with a pending invite shows Revoke): every `th` and every link in `td.actions-cell`
    is 1 line.
  - Sessions (`/account/sessions` in `matrixTeamAndAccount`): every `th` is 1 line.
  - Tokens (`checkTokenLayout`, 390 and 1280): every `th`, and every Rotate/Revoke link in
    `td.actions-cell`, is 1 line. At least one Rotate link must exist (assert the count > 0
    before measuring).
  - Probes (`checkProbeLayout`, 390 and 1280): every `th` and each "Rotate this token" /
    "Revoke this token" link is 1 line. At least one of each must exist.
  Keep `assertFits`/`assertNoSidewaysScroll` on every page as it is.
- **Label everything.** Each failure message names the scheme, the width, the page, the label
  text and the measured line count or value. A red run then shows which assertion failed.

## Risks

- **Body size change ripples.** Every element that inherits the body size goes from 16 to
  15 px: table cells, paragraphs, the `.wordmark .cursor` em-based box, and `td.num`. Existing
  browser checks may have geometry that depends on it: shell geometry, the 52 px row height, nav
  44 px, the 1-line e-mail Range at 390 px, and gaps. The implementer runs the full
  `check:browser` and reports any changed literal. A check may change only when the spec
  required that change. If an unrelated assertion breaks because of 15 px body text, hold with
  `needs-input` rather than loosen it.
- **Wider tables.** With nowrap, the Checks table at 1280 px can grow wider than its box. This
  is intended: the box scrolls. The 1280 px matrix does not call `assertChecksBoxEnd`, so it
  stays as it is.
- **Token prose.** Without `.cell-note`, nowrap on the token action cell would set the 111-character
  sentence on one line. R2 prevents that. The Tokens layout check keeps `assertFits`.
- **Red proof masking.** The runner stops at its first failure. The implementer shows both red
  reasons separately (see Acceptance evidence 2).

## Performance impact

None expected. The change touches only console CSS, markup classes and browser checks. The
`bench/budgets.json` of the api clone has no `console` section (keys: `api`, `probe`, `status`,
`notify`, `contract`, `kit`, `config`), and no api, probe, status or notify code changes. The
`/console.css` response grows by a few dozen bytes. No measurement is needed.

## Security impact

Security impact: no. The change touches only stylesheet rules, two class attributes on existing
cells, a `<span>` around existing escaped prose, and browser tests. It does not touch auth,
routes, parsers, the CSP, file writes, error or log texts, dependencies, Dockerfiles or CI.

## Rollout order

One repository: only `console` changes. No other target reads its CSS or markup, and no pin
moves.

## Counterexamples

- **"Actions" on one line.** On current `main` at 1280 px, the header "Actions" renders on about
  7 lines (issue evidence). The check must report a count above 1 and fail. A check that only
  compares `getComputedStyle(th).whiteSpace === "nowrap"` would pass after a wrong fix that sets
  nowrap on `th` but lets `a` keep `overflow-wrap: anywhere` with `white-space: normal`. The
  links would still break, so the check measures lines with a Range, not computed styles.
- **Links on one line.** On current `main`, "Export" in the `long-url` row renders on 3 or more
  lines. The check must fail. A wrong fix that sets nowrap on `td.actions-cell` but not on its
  `a` still passes, because `a` inherits `white-space` (that is acceptable). A wrong fix that
  sets `word-break: keep-all` only on `td` leaves `a { overflow-wrap: anywhere }` in force, and
  the check must catch it.
- **Labels must exist.** If a row with no Edit link (a file check such as `web`) were measured,
  "each of the four words is 1 line" could pass with Edit missing. The check therefore selects
  the `long-url` row and first asserts the literal label list `View, Edit, Export, Delete`.
- **Visually hidden suffix.** In a Team link, `"Change role" + " for <name>"` gives a Range over
  the whole link that includes a 1×1 px clipped rect at another top. A naive count would report
  2 lines and fail a correct fix. The helper measures only the visible text node, or drops rects
  of `.visually-hidden` descendants.
- **Type sizes, wrong sources.** If the check read the expected h1 size from the CSS text, or
  from `getComputedStyle` of another h1, it could never fail. The expected values are the
  literals 15, 39.04, 23.52 (1280) and 15, 32, 20 (390). On current `main` the check reads body
  16 px, h1 28 px and h2 18 px at both widths, and must fail on each.
- **Clamp bounds.** A wrong formula without the clamp minimum (`1.8rem + 0.8vw`) gives 31.92 px
  at 390. That is outside ±0.05 of 32, so the check rejects it. A wrong h2 without the clamp gives
  19.96 px at 390, also outside ±0.05 of 20.
- **Root size.** A wrong fix that sets `html { font-size: 15px }` makes body 15 px, but h1 at
  1280 becomes 27 + 10.24 = 37.24 px and fails the 39.04 check.
- **Title metrics.** At 1280 px, line-height must be 42.944 ± 0.05 px. The old 1.2 gives
  46.85 px against the new size and fails. Letter-spacing must be −0.7808 ± 0.05 px. The old
  −0.01em gives −0.39 px and fails.
- **Wrong section heading.** If the check measured `.callout-title` (15 px) or an `.eyebrow` h2
  (12 px), a correct fix would fail. The check measures `#people-heading` only.
- **No sideways scroll.** A fix that gives the table `min-width: max-content` outside a scroll
  box, or removes `overflow-x: auto`, would make `documentElement.scrollWidth` larger than
  `clientWidth` at 390 px. The existing `assertNoSidewaysScroll` fails on it, and must stay.
- **Statistics.** No statistic. A "line count" is the number of distinct `Math.round(top)`
  values of the non-empty client rects of one Range. Expected value: the literal 1.

## Contract fields

No new names in contract or config. The change adds two CSS class names, local to console
markup and CSS:

- `actions-cell`: `grep -rn 'actions-cell' .repos/contract/src .repos/config .repos/kit/src .repos/console/src .repos/console/e2e .repos/console/test` → no match.
- `cell-note`: `grep -rn 'cell-note' .repos/contract/src .repos/config .repos/kit/src .repos/console/src .repos/console/e2e .repos/console/test` → no match.

The existing `span.row-actions` in `src/team-pages.ts:61` stays. No CSS rule targets it, and the
new class has a different name.

## Repository: console

Files:
- `src/styles.ts` (R1, R2 and R3 rules)
- `src/check-pages.ts` (class `actions-cell` on the action `<td>`)
- `src/team-pages.ts` (class `actions-cell` on the member and invite action `<td>`)
- `src/token-pages.ts` (class `actions-cell` on the action `<td>`, `span.cell-note` around the prose)
- `src/probe-pages.ts` (class `actions-cell` on the action `<td>`)
- `src/server.test.ts` (assert the new and changed CSS rules in `/console.css`)
- `src/server.checks.test.ts`, `src/server.team.test.ts`, `src/server.tokens.test.ts`, `src/server.probes.test.ts` (assert `<td class="actions-cell">` and, for tokens, `class="cell-note"`)
- `e2e/design-matrix.ts` (line-count helper, literal expected sizes, the new assertions)
- `e2e/run.ts` (call the new assertions from `matrixPages`, `matrixTeamAndAccount`, `checkTeamActions`, `checkTokenLayout` and `checkProbeLayout`)

Behavior change: yes. Rendered layout and type sizes change for every signed-in user, and markup
gains classes.

### Tool facts (verified)

- Bun 1.4.0: `package.json` `engines.bun` and `packageManager` `bun@1.4.0`. CI pins `bun-version: 1.4.0`
  in the `browser` job of `.github/workflows/ci.yml` and in the shared check workflow
  (`lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`, lines 22–24).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json` `scripts.check`).
  `lint` = `biome check . && pulse-eslint . && pulse-workflows`. `typecheck` runs
  `typescript7/bin/tsc --noEmit` on the root and on `-p e2e`, so the e2e files are typechecked.
- `check:browser` = `bun e2e/run.ts` (`package.json` `scripts.check:browser`). In CI it is the
  `browser` job (`ci.yml`, "Browser checks" step), after `bunx playwright install --with-deps chromium`.
  Playwright is pinned at `1.64.1` in `devDependencies`.
- Biome 2.6.3 (`devDependencies`). `biome.json` only `extends` `@lorenzh/pulse-config/biome.json`.
  The pinned file (`04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`, read with `gh api`) has
  `files.includes` `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures`
  (lines 10–17) and `lineWidth: 100` (line 23). So `src/` and `e2e/` are linted and formatted.
  The pinned `check.yml` and `biome.json` match the config clone's `main`.
- `bunfig.toml` `[test]`: `coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`.
- The shared check workflow runs Install, Lint, Typecheck, Test (`check.yml@04108fa…` lines
  25–38). `build` is not set by the console, so the dist steps are skipped.

### Behavior

Implement R1, R2 and R3 in the shared stylesheet. Put the new table rules next to the existing
table rules (`src/styles.ts:167–180`), after the `th` and `td` rules. Change the existing `body`,
`h1` and `h2` declarations in place (`src/styles.ts:40, 42, 43`). Do not add a second `h1`/`h2`
rule. Keep the stylesheet constraints in the header comment of `src/styles.ts`: no `style`
attribute, no `@import`, no data URI. Add the markup classes of R2. Implement the browser checks
of R4.

### Checks

- Unit/HTTP (TDD, red first):
  - `src/server.test.ts`: `/console.css` contains these literal substrings (each written into
    the test):
    - `th { white-space: nowrap; }` or the exact combined rule you write;
    - `td.actions-cell { white-space: nowrap; }`;
    - `td.actions-cell a { white-space: nowrap; overflow-wrap: normal; }`;
    - `.cell-note { white-space: normal; overflow-wrap: normal; }`;
    - `font-size: 0.9375rem`;
    - `h1 { font-size: clamp(2rem, 1.8rem + 0.8vw, 2.5rem); font-weight: 700; line-height: 1.1; letter-spacing: -0.02em;`;
    - `h2 { font-size: clamp(1.25rem, 1.15rem + 0.4vw, 1.5rem); font-weight: 500;`.

    It does not contain `font-size: 1.75rem`.
  - HTTP tests of `/checks`, `/team`, `/tokens` and `/probes`: the page contains
    `<td class="actions-cell">` and the action links inside it. `/tokens` for the console's own
    token contains `<span class="cell-note"><strong>This console</strong>`. The existing
    `<strong>This console</strong>` assertion stays.
- Browser (R4), in `check:browser`.
- Existing checks stay as they are: axe, CSP violations 0, other-origin requests 0, fonts,
  colors, `assertNoSidewaysScroll`, `assertFits`, `assertChecksBoxEnd`, hostile text, the 1-line
  e-mail and the shell geometry. Do not weaken lint, typecheck or the coverage threshold.

### Completion evidence

1. `bun run check` passes (paste the summary lines).
2. Red proof on `00ef91c` styles. Use the new tests with the old `src/styles.ts` (for example
   `git stash` only the stylesheet, or `git show 00ef91c:src/styles.ts > …` into the working
   tree), and run once for each group, because the runner stops at its first failure:
   - typography group alone: the failure names body 16 px (expected 15), h1 28 px (expected
     39.04 at 1280), or h2 18 px (expected 23.52);
   - action group alone (with the typography assertions temporarily skipped in the local run
     only, never committed): the failure names "Actions" or an action label with a line count
     above 1 on `/checks` at 1280 px.
   Report both failing messages.
3. Green: `bun run check:browser` passes on the final tree, with the new `ok(...)` lines for
   each scheme × width (light/dark × 1280/390) on Checks and type sizes, and for Team, Sessions,
   Tokens and Probes.
4. `git diff --stat 00ef91c` shows only the files in the `Files:` list. `package.json` and
   `bun.lock` are unchanged. `src/server.ts` (CSP) is unchanged.
5. Manual smoke run, per console `AGENTS.md` ("Before handoff of a user-visible change …"). Run
   `bun e2e/run.ts --serve`, open `/checks` at 1280 px, and confirm that View Edit Export Delete
   sit on one line and the page title is about 39 px. Report the command and the result in the
   PR.
6. The PR names #777, the checks that ran, and the known limits.

## Acceptance evidence (feature)

- Console PR merged with `Closes lorenzh/pulse-meta#<child>`. CI jobs `check`, `docker`,
  `deploy-dev` and `browser` are green.
- The browser check reports, for each of light/dark × 1280/390: Checks "Actions" header and the
  View/Edit/Export/Delete labels of row `long-url` at 1 line each (literal 1). It also reports
  body/h1/h2 computed sizes equal to the literals of the R3 table within ±0.05 px.
- The red proof of completion evidence 2 is recorded in the PR.
