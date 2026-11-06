# Spec #780: console: layout polish after the design change (tables, forms, overview, mobile)

## Goal

On console `main` (`5cdc34b`, after console PRs #15 and #16) the tokens, type scale and
components are in place, but several layouts do not hold up:

- the Checks table does not fit at 1280 px;
- table words, ids and dates break in the middle;
- each recovery code wraps its last character;
- the token preset radios sit above their labels;
- the sidebar border stops at the viewport height;
- buttons and fields stretch across the column;
- the Overview is a mono bullet list;
- the phone header wastes about 360 px;
- the Team actions column is ragged.

This spec fixes these in console only, with markup, CSS and browser checks. The checks fail on
`5cdc34b` and pass after the fix.

## Sources

- Issue #780 and its comments. Issue review: `.factory/work/780/issue-review.md`. It found no
  blocking question. The plan-review comment named two defects of the first spec, and this
  revision fixes both. First, the spec now has no mid-word break at all: overlong unbroken
  Checks values are cut with an ellipsis (R1, R2), and an unbroken fixture row tests this case.
  Second, the presence test of the word check now matches the exact text of a descendant
  element, then measures units separately (browser check 2). This spec adopts its
  working assumptions 1 to 10 and picks the concrete layouts they left open (Checks columns,
  field widths, compact account row, scroll hints).
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/780` answered
  `HTTP 404` in this run, so there are no findings. This is normal for a feature with no
  children yet.
- Earlier specs whose fixes must stay: #774 (tokens, components), #777 (headers and action links
  on one line, `td.actions-cell`, `.cell-note`, type scale). Their browser checks stay unless
  this spec names a change.
- No console design board exists in meta or in the console (the #774 plan records this). Where
  the issue says "the design's" tiles, option cards or button sizes, this spec uses the existing
  console components: `.panel`, `label.choice.option-card`, `button.secondary`, `button.small`,
  `.check-state`. The written rules below are the layout contract. There is no pixel comparison.
- Console clone at `5cdc34b`, read directly. The facts below come from it.

### Current behavior (console `5cdc34b`)

- Stylesheet `src/styles.ts`:
  - line 41: `body, p, h1, h2, h3, li, label, a, dd, td, legend { overflow-wrap: anywhere; }`.
  - line 49: `code, .secret { overflow-wrap: anywhere; word-break: break-all; }`. A token id in
    `<code>` can therefore break between any two characters, and its min-content width is one
    character.
  - line 185: `.table-scroll table.checks td { overflow-wrap: normal; word-break: normal; }`.
    It does not reach `td a` or `td code`, which keep their own rules.
  - lines 183–184: `table.checks { min-width: 56rem }`, `table.tokens { min-width: 60rem }`.
  - lines 93–94: `.shell { grid-template-columns: 236px minmax(0, 1fr); min-height: 100vh }` and
    `.sidebar { position: sticky; top: 0; height: 100vh; … border-right: 1px solid var(--rule) }`.
    The sidebar box is exactly one viewport high, so its border ends at 800 px on a longer page.
  - line 102: `.sidebar-foot { … flex-wrap: wrap; … }`. Lines 104–105: `.account`,
    `.account-email`.
  - lines 70, 74: `form { display: flex; flex-direction: column }` and every text input, select
    and textarea has `width: 100%`, with no maximum. Line 115: `main.shell-main` is a column
    flex box, so a direct child button stretches across it.
  - lines 67–68: `button.small` (36 px high, `::after` with `inset: -4px 0` for a 44 px hit area).
  - lines 81–83: `label.choice` and `label.choice.option-card`.
  - lines 160–161: `ul.counts` (Overview list).
  - line 202: `#recovery-codes { padding-left: 24px; font-family: var(--font-mono); }`.
  - lines 210–224: at `max-width: 719px` the sidebar becomes a static full-width block, the nav a
    sideways scroller with `background-attachment: local/scroll` shadows, and
    `.sidebar-foot { margin-top: 0 }`.
- Checks list, `src/check-pages.ts:158–195`: eight columns with headers `Name, Id, Type, Target,
  Source, State, Last result, Actions` (line 182). The Id is `<td class="mono">` (line 167), and
  the last result is `<td class="mono">` with `utcTime` (`YYYY-MM-DD HH:MM:SS UTC`, or
  `No results yet`; empty for a shadowed row). Actions are View, Edit, Export and Delete
  (`rowActions`, lines 135–152). The box is
  `<div class="table-scroll" tabindex="0" role="region" aria-label="Checks table">`, with the hint
  `Scroll sideways to see all columns.` (shown only at ≤ 719 px). At 1280 × 800 the content
  column is 1280 − 236 − 2 × 32 = 980 px, and the box is 978 px inside its border. That matches
  the 978 px box of the issue.
- Tokens, `src/token-pages.ts:81–105`: cells Name, `<code>` Id, Access, Source, Created, Last used
  and State, then `td.actions-cell`. Probes, `src/probe-pages.ts:67–99`: the same without Access.
  Both use `table.tokens`.
- Team, `src/team-pages.ts:64–90`: the member row prints `2FA: on` / `2FA: off` under a `2FA`
  header. `memberActions` returns `""` when `targetDecision` allows nothing, so the cell is empty.
  It otherwise returns `<span class="row-actions">` with links joined by a space. The invite row's
  action is `Revoke` or `""`. No CSS rule targets `.row-actions`.
- Recovery codes, `src/account-pages.ts:244–254`: a plain document (`plainDocument`, panel
  `max-width: 440px`, padding 32 px, 20 px at ≤ 719 px) with `<ol id="recovery-codes">` of
  `<li><code>…</code></li>`. `src/recovery-codes.ts:9–16` makes 8 groups of 4 hex digits joined
  by `-`: **39 characters** per code. JetBrains Mono advances 0.6 em per character, so a code
  needs 23.4 em: 351 px at 15 px, but the list has 440 − 64 − 2 − 24 = 350 px. That is why the
  last character wraps on desktop.
- Token create form, `src/token-pages.ts:133–146`: each preset is a bare
  `<label><input type="radio"> Label<br><small>…</small></label>`. `label` is
  `display: grid` (line 71), so the radio gets a row of its own above the text. The three presets
  that hold `admin` get the same `ADMIN_PRESET_TEXT` (`src/token-view.ts:18–19`), and Read gets
  none. Presets (`src/token-view.ts:7–12`): `read` `["read"]`, `checks`
  `["read","checks","admin"]`, `incidents` `["read","incidents","admin"]`, `full`
  `["read","checks","incidents","admin"]`. API `src/token-scopes.ts:14–29`: config read needs
  `read` or `checks`, config write needs `admin` and `checks`, incident write needs `admin` and
  `incidents`, token admin and audit read need `admin`.
- Copy buttons: `<button type="button" data-copy="<id>" hidden>Copy</button>` in
  `src/check-detail-pages.ts:185–188`, `src/probe-pages.ts:186–190`,
  `src/check-editor-page.ts:381–382` and `src/token-pages.ts:198–199`. The button has no class,
  so it is primary (black) and stretches in its column flex parent.
- Check editor, `src/check-editor-page.ts`: `input()` (lines 214–230) renders text inputs. Numeric
  ones carry `inputmode="numeric" pattern="[0-9]*"` (`isNumeric`), and `msInput` is always
  numeric. The submit (`Save check` / `Create check`, line 508) is a direct child of the form, so
  it stretches across the form.
- Overview, `src/overview.ts:55–75`: `<p>` with the overall state, then
  `<ul class="counts mono">` with `<li>` rows `Down: n`, `Degraded: n`, `Unknown: n`,
  `Maintenance: n`, `Up: n`, `Total: n`, without links. Counts come from `summarizeChecks` over
  the `/checks` answer (`src/overview-read.ts`). `src/check-filters.ts:64–68, 84–90` already
  supports `/checks?state=<up|degraded|down|unknown|maintenance>`, and a shadowed row never
  matches a state.
- Shell, `src/shell.ts:91–105`: `header.sidebar` holds wordmark, instance, `nav[aria-label=Main]`
  and `.sidebar-foot`. The foot holds the avatar, then
  `<p class="account">Signed in as <name> <span class="account-email">(<email>)</span><br>Role:
  <role></p>`, then the `Account security` link and the sign-out form (secondary button).
- Browser harness `e2e/run.ts` and `e2e/design-matrix.ts`:
  - The design matrix (`checkDesignMatrix`, `e2e/run.ts:2493`) runs light and dark at 1280 × 800
    and 390 × 844, with a 70-character owner e-mail. It visits `/`, `/checks` (with
    `MATRIX_CHECKS` `long-url`, `long-name` and `hostile`, line 2197), `/checks/edit?id=web`,
    `/team` and the account pages.
  - Helpers: `measureLines` (`e2e/design-matrix.ts:397`), `assertHeaderLines`,
    `assertActionLines`, `assertChecksActions` (it selects the row by
    `tr:has(td:text-is("long-url"))`, line 458), `assertChecksBoxEnd` (390 px only),
    `assertShellGeometry` (sidebar 236 px, line 264) and `HEADERS` (line 373).
  - `checkTokenLayout` (`e2e/run.ts:1901`), `checkProbeLayout` (2110), `checkTeamActions` (1092),
    `checkMobileNavFocusAt` (749, at 390/375/360/320), `checkEmail` / `checkLongEmail` (418/432)
    and `checkLinks` (556). `checkLinks` makes real recovery codes through the form and stores
    them in `env.console.recoveryCodes`.
  - No check measures whether the Checks table fits at 1280. No check measures words inside
    cells, recovery code lines, preset radio geometry, sidebar height or the compact account row.

## Scope

Console only: `src/styles.ts`, the markup of the Checks list, Tokens and Probes tables, Team
table, token create form, Copy buttons, check editor submit and field classes, Overview and
shell; their unit/HTTP tests; the browser checks; and the console docs that describe these
screens.

## Non-goals

- No change to the color/space/radius tokens on `:root` (`src/styles.ts:14–37`), the fonts, the
  CSP (`src/server.ts`), routes, roles, permissions, stored data, dependencies, `package.json`
  or `bun.lock`.
- Forms keep their method, action, field names, types and values, `required`/`inputmode`/
  `pattern` attributes, hidden `csrf` and `form_token` and their order, preset ids and scope
  arrays, the no-default preset rule, validation, kept input and POST effects. Only classes,
  wrappers and descriptive text change.
- No new API request and no new data on the Overview. No trend, uptime or incident figure.
- No change to the 236 px desktop sidebar width, the 719/720 px breakpoint, the type scale of
  #777 or the recovery code format.
- No other repository changes.

## Required behavior

Expected values in the checks are literals written from this spec, never read from
`CONSOLE_CSS` or from the element under test.

### R1. Checks table fits at 1280 px

- Four columns. Headers, literal: `Check`, `Target`, `State`, `Actions`.
- Row markup (every value through `escapeHtml`):
  - `Check` cell:
    `<span class="cell-title"><name></span><span class="cell-sub"><code><id></code> <source tag></span>`.
    The source tag is the existing `sourceTag` output.
  - `Target` cell:
    `<span class="cell-sub"><type label></span><span class="cell-target"><targetText></span>`.
  - `State` cell: `checkStateHtml(state, true)`. For an effective row it is followed by
    `<span class="cell-sub mono"><span class="visually-hidden">Last result: </span><utcTime></span>`.
    A shadowed row has no time span, as today.
  - `Actions` cell: unchanged `td.actions-cell` with View, Edit, Export and Delete, under the same
    permission rules.
- Each `Check` cell holds the check's id, so all information of the eight columns stays on the
  row: name, id, type, target, source, state and last result. Nothing moves off the list.
- `<colgroup>` with `<col class="col-check"><col class="col-target"><col class="col-state"><col class="col-actions">`.
  CSS: `table.checks { table-layout: fixed; }` with `col.col-state` about `13rem` and
  `col.col-actions` about `15rem`. Check and Target share the rest equally. The implementer may
  tune these two widths. The R8 checks must hold: actions on one line inside their cell, and no
  sideways scroll at 1280.
- `.cell-title` and `.cell-sub` are `display: block; overflow: hidden; text-overflow: ellipsis;`
  and keep `white-space: normal`. `.cell-sub` is muted, at `0.8125rem` (`0.75rem` when also
  `.mono`). They wrap at natural points (R2). A single unbroken word wider than its column is
  never split: it stays on its line and is cut at the cell edge with an ellipsis. This is the
  fallback for an overlong unbroken name or id. The api allows any non-empty string for both
  (contract `src/schema.ts:19–21` `nonEmpty`, `:400–401` `id: nonEmpty, name: text`), so the
  case is real. `.cell-target` is `display: block; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;`. A long URL shows on one line with an ellipsis. The full name, id and
  target stay in the DOM text and on the detail page (View).
- `.table-scroll table.checks { min-width: 56rem }` stays. It is the fallback: below a 896 px
  box (viewport under about 1200 px) the box scrolls. Remove the line-185 rule, because R2
  supersedes it.
- At 1280 × 800 (box 978 px) the table fits the box with no sideways scroll, in both schemes,
  with the matrix data. The data is `long-url`, a 300-character hyphenated `long-name`,
  `hostile`, and a new fourth row `unbroken` (below).
- New `MATRIX_CHECKS` row in `e2e/run.ts:2197–2201`:
  `{ id: "unbroken" + "x".repeat(56), name: "Unbroken" + "n".repeat(92), url: "https://example.com/u" }`.
  The id is 64 characters and the name 100, both without a space, `-` or `/`. At 1280 the Check
  column is about (978 − 208 − 240) / 2 ≈ 265 px before padding, so both values are wider than
  it: the name at 15 px sans is far over 600 px, and the id is 64 × 0.6 × 12 = 460.8 px in mono.
  So the row exercises the ellipsis fallback at both widths.

### R2. No break inside a word in tables

- After the table rules, add `td, td * { overflow-wrap: normal; word-break: normal; }`. It comes
  after lines 41 and 49 and has at least their specificity: (0,0,1) for `td *` against `a`, `p`
  and `code`. So it overrides `anywhere` and `break-all` on everything inside a cell, including
  `pre` (line 50, also a type selector). Some class rules set `anywhere` with a higher
  specificity: `.secret` (line 49), `.account-email` (105), `.type-choice li.panel` (163),
  `.settings dd` (191) and `.confirm-target` (198). No `td` holds any of them. They are used
  only at `src/account-pages.ts:91–93`, `src/shell.ts:97` and `src/confirm.ts:102` and in their
  own rules. With `normal`, no cell ever breaks inside a word:
  - In an auto-layout table (Tokens, Probes, Team, the detail tables) each column is at least as
    wide as its longest word, and the table grows and scrolls inside its box.
  - In the fixed Checks table, a word wider than its column is cut with an ellipsis (R1). It is
    not split.

  No rule in this spec allows a break inside a word. `overflow-wrap: break-word` and `anywhere`
  must not appear on `td` or its descendants.
- `td.cell-nowrap { white-space: nowrap; }` (and `td.cell-nowrap code` the same) on short
  values:
  - Tokens: Id, Created, Last used.
  - Probes: Id, Created, Last used.
  - Team members: 2FA.
  - Team invites: Expires, State.

  Role cells already use the nowrap `.tag`. Dates are `YYYY-MM-DD HH:MM:SS UTC`
  (`utcTime`) or `YYYY-MM-DD HH:MM UTC` (`utcMinute`). Token ids are `tok_` plus 24 hex digits
  (contract `src/token-id.ts:5`).
- Long values (names, e-mails, state sentences such as `Rotated: old secret valid until …`,
  `.cell-note` prose) wrap only at spaces and after `-` or `/`. The Tokens and Probes tables
  may grow wider than their box and scroll inside it. The document must not scroll sideways.

### R3. Recovery codes on one line

`#recovery-codes code { white-space: nowrap; word-break: normal; overflow-wrap: normal;
font-size: 0.8125rem; }`. At ≤ 719 px: `font-size: 0.75rem`. Worked from the facts above, not
from the stylesheet:

- Desktop: 39 × 0.6 × 13 = 304.2 px ≤ 350 px.
- 390 px: list width 390 − 32 − 2 − 40 − 24 = 292 px, and 39 × 0.6 × 12 = 280.8 px ≤ 292 px.

The page keeps one column, all ten codes in order, and the same bytes. No ellipsis.

### R4. Token presets as option cards

- Each preset renders as:

  ```html
  <label class="choice option-card"><input type="radio" name="preset" value="<id>"[ checked][ disabled]><span class="choice-text"><span class="choice-title"><label></span><small class="hint"><description></small>[<small class="hint"><lacks text></small>]</span></label>
  ```

- `label.choice.option-card` aligns its items to the top (`align-items: flex-start`). The radio
  gets a top margin so that its center lines up with the title line's center. `.choice-text` is
  a column. Disabled cards look disabled (muted text) and keep `The console token lacks
  <scope>.`
- New `PRESET_DESCRIPTIONS: Record<TokenPresetId, string>` in `src/token-view.ts`. Literal texts:
  - `read`: `Reads the checks and their configuration. Changes nothing.`
  - `checks`: `Reads checks and creates, changes and deletes them.`
  - `incidents`: `Reads checks and posts incidents.`
  - `full`: `Reads and changes checks and posts incidents.`
- The admin caveat is shown once, as `<p class="hint" id="preset-note">` directly after the
  `<legend>`. `ADMIN_PRESET_TEXT` becomes the literal `Manage checks, Post incidents and Full
  access can also create, rotate and revoke tokens with the same or fewer scopes, and read the
  audit log.` The fieldset gets `aria-describedby="preset-note"`. With a preset error, the
  error id is added to the same `aria-describedby`.
- `docs/tokens.md` "Presets" gets the four descriptions and the shared note.

### R5. Sidebar spans the page

- Wrap the sidebar content of `src/shell.ts` in `<div class="sidebar-inner">`. That is the
  wordmark, instance, nav strip (R7) and foot.
- `.sidebar` loses `position: sticky`, `height: 100vh` and `overflow-y`. It stretches with its
  grid row (`align-self: stretch`) and keeps `border-right`.
- `.sidebar-inner` gets what the sidebar had: `position: sticky; top: 0; height: 100vh;
  overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 14px 12px`.
  `.sidebar-foot { margin-top: auto }` stays inside it.
- At ≤ 719 px, `.sidebar-inner` is `position: static; height: auto; overflow-y: visible`. The
  phone layout is otherwise as in R7.

### R6. Buttons and field widths

- Every Copy button becomes
  `<button type="button" class="secondary small" data-copy="<id>" hidden>Copy</button>`, in all
  four places. CSS: `button[data-copy] { align-self: flex-start; }`. JS behavior and `hidden`
  stay.
- The editor submit goes into `<div class="actions">…</div>`, as the token and probe forms
  already do, so it keeps its intrinsic width.
- Field widths. The default rule gets `max-width: 40rem` for text inputs, selects and textareas.
  Two classes go on the control:
  - `input-narrow` (`max-width: 12rem`) for every `isNumeric` editor input (all `msInput`,
    retries, port, warn days, domain interval), the availability target, and the Method and
    Record type selects.
  - `input-medium` (`max-width: 24rem`) for the check Id and Name, header names, the token Name,
    the probe Location and Name, and the invite Email.

  The class rules must win over the default `max-width`: match its specificity, or put the
  classes in the same selector form. `field()` (`src/html.ts`), the editor `input()`/`select()`
  and the probe `inputHtml` get an optional `width: "narrow" | "medium"` that adds the class.
  Labels, hints and errors stay where they are.
- Unchanged: sign-in/setup plain forms (`.plain-panel form > .actions button` is still full
  width there) and the `.filters` form.

### R7. Mobile navigation and compact account row (≤ 719 px)

- Nav strip:
  - Wrap `nav[aria-label="Main"]` in `<div class="nav-strip">` and add two decorative siblings
    after the nav: `<span class="nav-edge nav-edge-start" aria-hidden="true"></span>` and
    `<span class="nav-edge nav-edge-end" aria-hidden="true"></span>`.
  - Desktop: `.nav-edge { display: none }`.
  - ≤ 719 px: `.nav-strip { position: relative; timeline-scope: --main-nav; }` and
    `.sidebar nav { scroll-timeline: --main-nav x; }`. The nav stays one row (`flex-wrap:
    nowrap`), with the existing scroll snap and background shadows as a fallback.
  - `.nav-edge` is `position: absolute; top: 0; bottom: 0; width: 28px; pointer-events: none;
    opacity: 0`, a gradient from `var(--bg)` to transparent, and a CSS chevron in `var(--lead)`
    (border-drawn `::before`). The start edge is at `left: 0` and the end edge at `right: 0`.
  - Each edge runs a scroll-driven animation: `animation: nav-edge-start linear both`, then
    `animation-timeline: --main-nav`. Write it after the shorthand, because the shorthand resets
    it.
  - Keyframes: `nav-edge-start` opacity 0 at 0 %, 1 from 5 % to 100 %. `nav-edge-end` opacity 1
    from 0 % to 95 %, 0 at 100 %.
  - So the start hint shows only when there is content to the left, the end hint only when there
    is content to the right, and neither when the row does not overflow (inactive timeline).
  - Focused items keep `scroll-snap-align: center`, so Tab brings Probes and Team fully into view.
- Account row:
  - `src/shell.ts` renders
    `<p class="account"><span class="account-who"><span class="account-prefix">Signed in as </span><name> <span class="account-email">(<email>)</span></span> <span class="account-role">Role: <role></span></p>`.
  - The `<br>` goes. The text `Role: <role>` stays contiguous.
  - Desktop shows the full text: `.account-who` and `.account-role` are blocks, and wrapping is
    as today.
  - At ≤ 719 px the foot is one row (`flex-wrap: nowrap`, padding `8px 12px`):
    - `.avatar` is hidden.
    - `.account` is a two-line column (`flex: 1 1 0; min-width: 0; line-height: 1.3`).
    - `.account-who` is `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
    - `.account-prefix` is visually hidden (the `.visually-hidden` declarations repeated in the
      media block).
    - `.account-role` is nowrap.
  - Account security and the Sign out button sit at the end of the row. Sign out uses
    `secondary small`: `submitButton` gets an optional `size: "small"` that adds `small` to the
    class.
  - DOM order and Tab order stay: nav entries, Account security, Sign out.
  - The full name and e-mail stay in the DOM text.

### R8. Overview tiles

- Replace `<ul class="counts mono">` with this markup, in the order Down, Degraded, Unknown,
  Maintenance, Up, Total:

  ```html
  <ul class="state-tiles"><li><a class="panel state-tile" href="<href>"><span class="tile-label"><dot><label></span><span class="tile-count"><n></span></a></li>…</ul>
  ```

  - `<dot>` is `<span class="check-state check-state-<state>"><span class="dot" aria-hidden="true"></span></span>`.
    Total has no dot.
  - `href` is `/checks?state=<state>`, and `/checks` for Total.
- The overall-state `<p>` and the `pulse-api: <origin>` `.mono` paragraph stay above the tiles.
  The zero-check empty state, the no-token, rejected-token and failure views stay unchanged.
- CSS:
  - `.state-tiles { list-style: none; margin: 0; padding: 0; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 12px; }`.
  - `.state-tile` is a block link with padding 16 px, text color `var(--text)`, no underline, and
    a hover border `var(--accent)`.
  - `.tile-label` is in the sans font, at `0.875rem`.
  - `.tile-count` is `display: block; font-family: var(--font-mono); font-size: 1.75rem;
    font-weight: 600`.
  - Remove the `ul.counts` rules.
- Without its own rule, a visited tile turns accent-colored, because `a:visited` (0,1,1) beats
  `.state-tile` (0,1,0). Add `a.state-tile, a.state-tile:visited { color: var(--text); }`
  outside any `@media`. Then add the entry `"a.state-tile:visited": "var(--text)"` to
  `VISITED_RULES` (`e2e/run.ts:88–98`), which grows from 9 to 10 rules. Change "nine" to "ten"
  in `docs/development.md`. This is the only change to the visited table.

### R9. Team table

- The member 2FA cell shows `On` or `Off` (`td.cell-nowrap`). The header stays `2FA`.
- An action cell with no allowed action (member or invite) renders
  `<span class="cell-empty"><span aria-hidden="true">—</span><span class="visually-hidden">No actions</span></span>`.
  `.cell-empty` is in the muted color. Never add a link that `targetDecision` does not allow.
- `.row-actions { display: inline-flex; flex-wrap: nowrap; gap: 12px; }`. The visually hidden
  ` for <name>` suffixes stay. The action cell has no border other than the row divider that
  every `td` has (`border-bottom: 1px solid var(--rule)`). Remove any other border or separator
  seen in the action cell or its children. The implementer inspects the rendered table with
  `bun e2e/run.ts --serve` at 1280 and 390 and names in the PR what drew the stray divider.

## Performance impact

None expected. The change touches only console CSS, server-rendered markup and browser tests.
The `bench/budgets.json` of the api clone has the sections `api`, `probe`, `status`, `notify`,
`contract`, `kit` and `config`, and none for `console`. No api, probe, status or notify code
changes. `/console.css` grows by about 2 KB, and pages grow by a few classes. No measurement is
needed.

## Security impact

Security impact: no. The change touches stylesheet rules, classes and wrappers in
server-rendered markup (every value still goes through `escapeHtml`), fixed descriptive texts
and browser tests. It does not touch auth, routes, permissions, parsers or validators, the CSP,
file writes, error or log texts with external data, dependencies, Dockerfiles or CI. Forms keep
their fields, CSRF and form tokens.

## Rollout order

One repository: only `console` changes. No other target reads its CSS or markup, and no pin
moves.

## Counterexamples

- **Document width is not table fit.** On `5cdc34b` at 1280 the document does not scroll
  sideways (`assertNoSidewaysScroll` passes), but the Checks box has `scrollWidth` 1241 >
  `clientWidth` 978 (issue evidence). The R1 check measures the box, not the document. A fix that
  sets `overflow-x: hidden` on the box would hide the overflow. The check therefore also asserts
  the computed `overflow-x` of the box is `auto`, and that the rightmost action link's
  `getBoundingClientRect().right` ≤ the box right + 0.5 at `scrollLeft` 0.
- **Shrinking text to fit.** A fix that sets the Checks table to 11 px would fit too. The check
  asserts the computed font size of a Checks action link is literal 15 px (± 0.01), the #777
  body size.
- **Actions overflowing a fixed column.** With `table-layout: fixed`, a nowrap action set wider
  than its column overflows into the next cell or past the table without any scroll. The check
  asserts the last action link's right ≤ its `td` right − padding-right + 0.5, and that the
  View/Edit/Export/Delete labels still measure 1 line each (#777).
- **Splitting a word at a natural point is allowed, mid-word is not.** In `ci-deploy`, a break
  after `ci-` is allowed, but `depl|oy` is not. The word check splits text into units: runs of
  non-whitespace, each also split after `-` and `/`. It asserts each unit is on 1 line. A check
  that measured whole cells would wrongly fail a name that wraps at a space. A check that only
  read computed `overflow-wrap` would pass a `word-break: break-all` left on `td code`.
- **Units must exist.** If the Tokens page had no `ci-deploy` token, "every unit is 1 line" would
  pass trivially. Each table check first asserts its literal required texts (below) exist. Each
  one must equal the trimmed `textContent` of some element inside a `td`, or of the `td` itself.
  A presence test against units would wrongly fail: `long-url` splits into the units `long-` and
  `url`. A presence test against whole cells would also wrongly fail, because the R1 Check cell
  holds name, id and source together. After the presence test, the helper splits the matched
  text into units and measures them like all others.
- **Unbroken overlong value.** A hyphenated name such as `long-name` never needs a mid-word
  break, so it cannot catch `overflow-wrap: break-word` or `anywhere` left on the Checks cells.
  The `unbroken` row (R1) has a 100-character name and a 64-character id, both without a natural
  break, each wider than the Check column. A wrong implementation splits them over 2 or more
  lines, and the unit check catches that. One that sets `overflow-wrap: normal` without
  `overflow: hidden` lets the word spill into the Target column. The check catches that too: the
  `.cell-title` and `.cell-sub` rects must end inside their `td`, and their computed
  `overflow-x` must be `hidden` and `text-overflow` `ellipsis`.
- **Dates in 3 or 4 lines.** On `5cdc34b` a token Created date can take 3 lines. A fix that only
  keeps each unit intact would still allow `2026-01-01` / `00:00:00` / `UTC` on three lines,
  because the spaces are natural breaks. So each `td.cell-nowrap` must also measure exactly 1
  line as a whole.
- **Recovery code length.** The sign-in fixtures use 32-digit codes without hyphens. Measuring
  those would pass a layout that still wraps the 39-character real codes. The check reaches the
  real result page through `/account/recovery-codes` and first asserts each code matches
  `/^[0-9a-f]{4}(-[0-9a-f]{4}){7}$/` (39 characters, literal) and that there are 10 (literal).
- **Recovery code ellipsis.** A fix with `overflow: hidden; text-overflow: ellipsis` gives 1 line
  but hides characters. The check asserts each `code`'s `scrollWidth` ≤ `clientWidth` and its
  rect lies inside the panel content box.
- **Radio on its own line.** On `5cdc34b` the radio's center is about one line above the label
  text's center. The check asserts radio right ≤ title left, and gap 12 ± 1 px (the existing
  `label.choice` gap), vertical centers within 2 px. A check of `label.choice` presence alone
  would pass a card whose `align-items` puts the radio at the card's vertical middle, next to a
  three-line text. The center test catches that.
- **Shared description.** A fix that gives every card `ADMIN_PRESET_TEXT` passes "4 non-empty
  descriptions". The check asserts the four literal texts of R4, in preset order, and that they
  are pairwise distinct.
- **Sidebar 800 px.** On `5cdc34b` `header.sidebar` is 800 px high on a page whose
  `scrollHeight` is larger. A check of `height >= 800` passes on it. The check asserts header
  top + `scrollY` within 0.5 of 0 and bottom + `scrollY` ≥ `scrollHeight` − 1, at the top and
  after scrolling to the bottom. It first asserts `scrollHeight` ≥ 1200 (literal) for that page.
  It also asserts the Main nav is still inside the viewport after the scroll, so a fix that drops
  `sticky` fails.
- **Scroll hints.** A fix that always shows both edges at full opacity passes "hint visible". The
  check asserts the literal opacities 0/1 at `scrollLeft` 0, 1/1 in the middle and 1/0 at the
  end. Wait two animation frames after each scroll.
- **Compact row height.** On `5cdc34b` at 390 px with the 70-character e-mail, the foot is
  several lines and the header about 360 px taller than needed. The check asserts
  `.sidebar-foot` height ≤ 56 px and `header.sidebar` height ≤ 240 px, both literal. Derivation
  at 390: inner padding 28, wordmark 28.5, gap 8, instance 19.5, gap 8, nav 56, gap 8, foot 52
  and border 1 come to about 209 px. Truncating the e-mail by `overflow: hidden` on the whole
  foot would hide the buttons, so the check also asserts Account security and Sign out are
  inside the viewport and reachable by Tab.
- **Full-width buttons.** On `5cdc34b` the Copy and Save check buttons span their column. The
  check asserts the button width < half its parent's content width, and its left edge equals the
  parent's content left ± 1 px. Copy also needs class `small` and a computed `min-height` of
  literal 36 px. A fix with `width: auto` alone leaves `align-self: stretch` in a flex column,
  and the width check catches it.
- **Field widths.** A fix that only targets `input[type=number]` misses every editor numeric
  field, because they are `type="text"` with `inputmode="numeric"`. The check measures
  `input[name="interval_ms"]` ≤ 192.5 px (12 rem, literal) at 1280.
- **Overview links.** A tile linking to `/checks?state=Down` (capitalised) gets
  `FILTERS_IGNORED_NOTICE` and the unfiltered list. The check asserts the exact literal hrefs and,
  after a click, the `select#filter-state` value `down`.
- **Empty actions.** A fix that adds a disabled link for every action would fill the cell but
  show actions the user may not take. The check asserts the literal action label lists per row.
  The owner row shows `—`. The `Rem Ovable` member row shows the owner's allowed links.
- **Statistics.** None. A "line count" is the number of distinct `Math.round(rect.top)` over the
  client rects wider than 0 of one Range (`measureLines`). Expected value: the literal 1.

## Contract fields

No new names in contract or config. New names are console-local CSS classes, one id and one
constant. Each search below gave no match in this run:
`grep -rn -- '<name>' .repos/contract/src .repos/config .repos/console/src .repos/console/e2e .repos/console/test .repos/console/docs`
→ 0 lines for each `<name>` in:

`input-narrow`, `input-medium`, `state-tiles`, `state-tile`, `tile-label`, `tile-count`,
`nav-strip`, `nav-edge`, `sidebar-inner`, `account-who`, `account-prefix`, `account-role`,
`cell-title`, `cell-sub`, `cell-target`, `cell-nowrap`, `cell-empty`, `col-check`, `col-target`,
`col-state`, `col-actions`, `choice-text`, `choice-title`, `preset-note` (id),
`PRESET_DESCRIPTIONS`.

The CSS custom identifiers `--main-nav`, `nav-edge-start` and `nav-edge-end` (timeline and
keyframes) are local to `/console.css`. `ADMIN_PRESET_TEXT` keeps its name and changes its text.

## Repository: console

Files:
- `src/styles.ts` (R1–R9 rules; remove the line-185 Checks td rule and the `ul.counts` rules)
- `src/check-pages.ts` (R1 columns, colgroup, row markup)
- `src/token-pages.ts` (R2 `cell-nowrap`; R4 option cards and note; R6 Copy class, Name width)
- `src/token-view.ts` (R4 `PRESET_DESCRIPTIONS`, new `ADMIN_PRESET_TEXT` text)
- `src/probe-pages.ts` (R2 `cell-nowrap`; R6 Copy class; `inputHtml` width)
- `src/team-pages.ts` (R2 `cell-nowrap`; R9 2FA text, `cell-empty`; invite Email width)
- `src/check-editor-page.ts` (R6 submit wrapper, Copy class, `input-narrow`/`input-medium`)
- `src/check-detail-pages.ts` (R6 Copy class)
- `src/html.ts` (R6 `field()` width; R7 `submitButton` `size`)
- `src/shell.ts` (R5 `sidebar-inner`; R7 nav strip, edges, account markup, small Sign out)
- `src/overview.ts` (R8 tiles)
- Tests updated or added: `src/server.test.ts` (CSS substrings), `src/server.checks.test.ts`,
  `src/server.tokens.test.ts`, `src/token-view.test.ts`, `src/server.probes.test.ts`,
  `src/server.team.test.ts`, `src/check-editor-page.test.ts`, `src/html.test.ts`,
  `src/shell.test.ts`, `src/server.races.test.ts` (account substring), `src/overview.test.ts`,
  `src/server.overview.test.ts`, and any other suite whose literal markup assertion the change
  breaks (update the literal to the new markup; never delete the assertion)
- `e2e/design-matrix.ts` (new helpers and literal expectations; `HEADERS.checks`; Checks row
  selector)
- `e2e/run.ts` (call sites, the `unbroken` `MATRIX_CHECKS` row, fixture rows for the word
  checks)
- `docs/checks.md` (list columns), `docs/tokens.md` (presets), `docs/development.md` (browser
  check list)

Behavior change: yes. Every signed-in page changes its layout, and the Checks, Tokens, Team,
Overview and recovery-code pages change their markup.

### Tool facts (verified)

All console lines are from the clone at `5cdc34b`. The config pin is
`04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`: `package.json:24` (`@lorenzh/pulse-config`) and
`.github/workflows/ci.yml:18` (`uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`).
The pinned `.github/workflows/check.yml` and `biome.json` were read with
`gh api "repos/lorenzh/pulse-config/contents/<path>?ref=04108fa…"`. `diff` against the config
clone shows no difference for either file, so the line numbers below hold for both.

- Bun 1.4.0: `package.json:8–10` (`engines.bun`) and `package.json:35` (`packageManager`
  `bun@1.4.0`). CI uses `bun-version: 1.4.0` in the `browser` job (`ci.yml:300–302`) and in the
  pinned `check.yml:22–24`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:18`):
  - `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`).
  - `typecheck` runs `tsc --noEmit` on the root and with `-p e2e` (`package.json:13`, TypeScript
    `npm:typescript@7.0.2`, `package.json:29`), so the e2e files are typechecked.
  - `test` = `bun test` (`package.json:14`).
- `check:browser` = `bun e2e/run.ts` (`package.json:19`). In CI it is the `browser` job
  (`ci.yml:291–308`): `bun install --frozen-lockfile` (304),
  `bunx playwright install --with-deps chromium` (306), `bun run check:browser` (308).
  Playwright `1.64.1` (`package.json:28`), `@axe-core/playwright` `4.14.0` (`package.json:22`).
- Biome `2.6.3` (`package.json:23`). `biome.json` only `extends`
  `@lorenzh/pulse-config/biome.json`. The pinned config has:
  - `vcs.useIgnoreFile: true` (line 6) and `files.includes` (from line 10);
  - `lineWidth: 100` (line 23) and `quoteStyle: "double"` (line 28);
  - `noNonNullAssertion` (line 46) and `noExplicitAny` (line 49) as errors, with
    `noNonNullAssertion` off for `**/*.test.ts` and `**/test/**` (lines 55–59).

  So `e2e/*.ts` may not use `!`.
- `bunfig.toml` `[test]`: `coverage = true` (line 2), `coverageThreshold = { lines = 0.8,
  functions = 0 }` (line 3), and `coveragePathIgnorePatterns` (line 4).
- Pinned `check.yml:25–38`: Install, Lint, Typecheck and Test. Build and the dist check
  (lines 31–36) run only with `inputs.build`, which `ci.yml:17–18` does not set.

### Behavior

Implement R1–R9. Put the new table rules after the existing `th`/`td` rules
(`src/styles.ts:168–185`). Put the phone rules inside the existing `@media (max-width: 719px)`
block. Keep the header-comment constraints of `src/styles.ts`: no `style` attribute, no
`@import`, no data URI, and `:visited` rules outside `@media`. Keep the #777 rules
(`th { white-space: nowrap }`, `td.actions-cell`, `.cell-note`) and the #774 tokens as they are.

### Checks

TDD: write each check first and see it fail on `5cdc34b` for the stated reason.

Unit/HTTP (`bun run check`), each with literal expected substrings from this spec:
- `/console.css` contains `table-layout: fixed`,
  `td, td * { overflow-wrap: normal; word-break: normal; }`, `text-overflow: ellipsis`,
  `td.cell-nowrap`, `#recovery-codes code`, `.sidebar-inner`, `scroll-timeline: --main-nav x`,
  `.state-tiles`, `input-narrow`, `input-medium` and `button[data-copy]`. It no longer contains
  `ul.counts`, `.table-scroll table.checks td { overflow-wrap: normal` or `break-word`.
- `/checks`:
  - headers `Check`, `Target`, `State`, `Actions`, in this order;
  - a row `<span class="cell-title">Long URL</span><span class="cell-sub"><code>long-url</code> <span class="tag tag-info">Console</span></span>`
    (adapt the fixture id/name of the HTTP suite);
  - `<span class="visually-hidden">Last result: </span>`;
  - the colgroup;
  - the unchanged permission matrix of the actions (the existing role tests stay green).
- `/tokens/new`:
  - four `label class="choice option-card"` with the four R4 descriptions;
  - `id="preset-note"` with the new `ADMIN_PRESET_TEXT`;
  - `aria-describedby="preset-note"`, plus the error id on a preset error;
  - a disabled card with `The console token lacks <scope>.` when `/self` lacks a scope;
  - the unchanged `name="preset" value="<id>"` set and no `checked` by default;
  - an unchanged POST body (the existing token create tests stay green).
- Copy markup `class="secondary small" data-copy=` in the token, probe, check detail and editor
  suites. The editor submit inside `<div class="actions">`. `input-narrow` on `interval_ms` and
  `input-medium` on `name`.
- `/team`: the owner row shows `<td class="cell-nowrap">On</td>` or `Off`, and the owner row's
  action cell (no allowed action) holds the `cell-empty` markup. No `2FA: on` or `2FA: off`.
- Shell: `<span class="account-role">Role: Owner</span>`, `class="account-prefix">Signed in as </span>`,
  `class="sidebar-inner"`, `class="nav-strip"`, both `nav-edge` spans with `aria-hidden="true"`,
  and the sign-out button `class="secondary small"`.
- Overview: the six tiles with their literal hrefs `/checks?state=down`, `…degraded`,
  `…unknown`, `…maintenance`, `…up` and `/checks`, and the counts of the fixture (literal in the
  test). The failure, no-token, rejected-token and empty tests stay green.

Browser (`bun run check:browser`). Add helpers to `e2e/design-matrix.ts`. Each failure message
names scheme, width, page, element text and the measured value. Wait for `document.fonts.ready`
before measuring.

1. **Checks fit (matrix, light/dark × 1280).** On `/checks`, with the scroll box at
   `scrollLeft` 0:
   - the box's computed `overflow-x` is `auto`;
   - `scrollWidth ≤ clientWidth`;
   - the table rect right ≤ the box rect right + 0.5;
   - the rightmost action link's right ≤ its `td` right − padding-right + 0.5;
   - the action link font size is 15 ± 0.01 px.

   Update `HEADERS.checks` to `["Check", "Target", "State", "Actions"]`. Change the long-url row
   selector to `tr:has(td code:text-is("long-url"))`. Keep `assertChecksActions` (View, Edit,
   Export, Delete, 1 line each). At 390 keep `assertChecksBoxEnd` (it scrolls to Actions, shows
   the hint and the 2 px outline) and the "Actions cell inside the box" check.
2. **Table words.** A helper `assertWordsIntact(page, tableSelector, required, label)`:
   - First, presence. For each entry in `required` (a string or a RegExp), assert that some
     element inside a `td` of the table, or a `td` itself, has a trimmed `textContent` equal to
     the string or fully matching the RegExp. The failure message names the missing entry. For
     example, `long-url` matches the `<code>` in the Check cell, not the whole cell and not a
     unit.
   - Then, units. For every text node in a `td` (skip `.visually-hidden`), split it into units
     as in Counterexamples, and assert each unit has 1 line (`measureLines` on a Range over the
     unit). This includes the texts that matched the presence test: `long-url` is measured as
     `long-` and `url`.
   - Also assert every `td.cell-nowrap` has 1 line as a whole.

   Run it in these places:
   - Checks (matrix, both schemes, 1280 and 390): required `long-url`, `hostile`, `Maintenance`,
     `Console`, and the literal `unbroken` name `"Unbroken" + "n".repeat(92)` and id
     `"unbroken" + "x".repeat(56)` (R1). On the `unbroken` row, also assert:
     - its `.cell-title` and its `.cell-sub` each have computed `overflow-x` `hidden` and
       `text-overflow` `ellipsis`;
     - `scrollWidth > clientWidth` for both, which proves that the fixture hits the fallback;
     - both rects end at or before their `td` right − padding-right + 0.5;
     - the full name and id are still the `textContent` of the `.cell-title` and the `code`.
   - Team (matrix `/team`, both schemes, 1280 and 390). Before measuring, create one invite with
     role `admin` (the owner may) in addition to the existing member invite. Required `Owner`,
     `Admin`, `Member`, and `/^(On|Off)$/`. Required also: an invite Expires cell matching
     `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/`, and `pending`.
   - Tokens (`checkTokenLayout`, 1280 and 390). Before measuring, add two rows to the fake api
     with `setTokens`:
     - name `ci-deploy`, scopes `["read"]`, `lastUsedAt` non-null;
     - name `old-ci`, `revokedAt` non-null.

     Restore the earlier rows after. Required `ci-deploy`, `Active`, `Read`, `Revoked`, one id
     matching `/^tok_[0-9a-f]{24}$/`, and one date matching
     `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/`.
   - Probes (`checkProbeLayout`, 1280 and 390): required one id matching the token id pattern,
     one date matching the date pattern, and `Active`.

   Keep `assertFits`/`assertNoSidewaysScroll` on each of these pages.
3. **Recovery codes (matrix, light and dark).** Once per scheme, at 1280:
   - open `/account/recovery-codes`, submit the owner password, and assert exactly 10 `li code`,
     each matching `/^[0-9a-f]{4}(-[0-9a-f]{4}){7}$/`;
   - copy them into `env.console.recoveryCodes`, as `checkLinks` does, so later sign-ins still
     work;
   - on that same result page, at 1280 × 800 and again after `setViewportSize(390, 844)`, assert
     each code has 1 line, `scrollWidth ≤ clientWidth`, and its rect is inside the `.plain-panel`
     content box (± 0.5);
   - assert no sideways scroll.
4. **Preset cards (`checkTokenLayout`, 1280 and 390, and once in dark).** On `/tokens/new`:
   - 4 `label.choice.option-card` cards, each holding exactly one `input[name=preset]`, in the
     order `read`, `checks`, `incidents`, `full`;
   - their `.choice-text small.hint` first texts equal the four R4 literals;
   - `#preset-note` text equals the R4 literal;
   - for each card: radio 18 × 18 ± 0.5, `title.left − radio.right` = 12 ± 1, the vertical
     centers of radio and `.choice-title` within 2 px, and the radio inside the card;
   - a click on the description text checks that card's radio;
   - ArrowDown from a checked radio moves the check to the next enabled one;
   - no radio is checked on load;
   - keep the existing editor `assertRadio`.
5. **Sidebar (matrix, light/dark × 1280).** On `/checks/edit?id=web`:
   - `scrollHeight ≥ 1200`;
   - at `scrollY` 0 and after `window.scrollTo(0, scrollHeight)`: the `header.sidebar` top +
     `scrollY` is within 0.5 of 0, its bottom + `scrollY` ≥ `scrollHeight` − 1, and its computed
     `border-right` is `1px solid` in the scheme's `--rule` color, written as a literal in the
     check: light `rgb(223, 215, 212)` (`#dfd7d4`) and dark `rgb(62, 48, 73)` (`#3e3049`), from
     `src/styles.ts:16, 31`;
   - after the scroll, the `nav[aria-label="Main"]` rect lies inside the viewport.
6. **Mobile nav hints (light and dark at 390; light at 375, 360 and 320).** Extend
   `checkMobileNavFocusAt`. The five items are on one row (existing check). At `scrollLeft` 0,
   computed `opacity` of `.nav-edge-start` = 0 and `.nav-edge-end` = 1. After setting
   `scrollLeft` to half of `scrollWidth − clientWidth`: both 1. At the end: start 1, end 0. Wait
   two `requestAnimationFrame`s before reading. After Tab reaches Probes and then Team, the
   focused item's rect lies fully inside the nav box (existing `inside` check) and its label text
   is the literal `Probes`/`Team`.
7. **Compact account row (matrix 390, both schemes, with the 70-character e-mail; and 375, 360,
   320 in `checkMobileNavFocusAt`).**
   - `.sidebar-foot` height ≤ 56 and `header.sidebar` height ≤ 240 (literals);
   - the vertical centers of `.account`, the `Account security` link and the `Sign out` button
     are within 6 px of each other;
   - both controls lie inside `[0, width]`;
   - `.account` text contains `Signed in as`, the full e-mail and `Role: Owner`;
   - `.account-role` is visible and has 1 line.

   `checkEmail` (one top for `.account-email`) and `checkLongEmail` (the full e-mail in the span)
   stay. The Tab order check (`checkFocus`) stays as it is, and Sign out still signs out with
   JavaScript off (existing `checkAccountNoScript`).
8. **Buttons and fields (matrix, light/dark × 1280 and 390).**
   - On `/checks/edit?id=web`, Save check's width is < 0.5 × its form's content width at 1280,
     and its left equals the form's left ± 1. `input[name="interval_ms"]` width ≤ 192.5 and
     `input[name="name"]` ≤ 384.5 at 1280. At 390 each is ≤ the form width.
   - On the token secret answer (`checkCopy`) and on the check detail page with a host binding
     (`checkScreensWith`), Copy has class `small`, computed `min-height` 36 px, width < 200, and
     its left equals its parent's content left ± 1. Its `::after` `top` is `-4px` (44 px hit
     area).
   - The copied string is unchanged (existing copy checks).
9. **Overview tiles (matrix, light/dark × 1280 and 390).** Before visiting `/`, reply `/checks`
   with the literal states `down, down, degraded, up, up, up`.
   - Assert six `a.state-tile` with labels and counts, in order: `Down 2`, `Degraded 1`,
     `Unknown 0`, `Maintenance 0`, `Up 3`, `Total 6` (literals). Their hrefs are the six R8
     literals.
   - `ul.state-tiles` computed `list-style-type` is `none`, and `.tile-label` font family starts
     with `"Space Grotesk"`.
   - Clicking `Down` lands on `/checks?state=down` with `select#filter-state` value `down`.
   - Restore the matrix `/checks` reply afterwards. `assertFontsUsed(page, "main .mono", …)` on
     `/` still passes (the origin paragraph and the counts are mono).
   - The `checkLayout` Overview cases (success, empty, unreachable, token banner) stay green.
10. **Team actions (matrix `/team`, and `checkTeamActions` at 390).**
    - The member headers stay `Name, Email, Role, 2FA, Actions`.
    - The owner row's 2FA cell text is `On` or `Off`, and no cell text starts with `2FA:`.
    - The owner row's action cell holds `.cell-empty` with visible text `—`.
    - In `checkTeamActions` (owner actor), the `Rem Ovable` member row's visible action labels
      equal the literal list `Change role`, `Reset link`, `Reset 2FA`, `Remove`.
      `src/permissions.ts:142–148`: `Make owner` goes only to an Admin, and nothing to the Owner.
    - In each action cell, every descendant has computed border widths 0. The cell's left and
      right border widths are 0, and its bottom border equals that of the row's first cell.
    - The first link (or `.cell-empty`) of every action cell starts at the cell's content left
      ± 1.

Existing checks stay as they are: axe on every listed page, CSP violations 0, other-origin
requests 0, fonts and colors, `:visited` rules, `assertNoSidewaysScroll`, `assertFits`, header
and action line counts of #777, type scale, shell geometry (236 px sidebar, 720/719 switch),
JS-off and busy-button flows. Do not weaken lint, typecheck or the coverage threshold.

### Completion evidence

1. `bun run check` passes (paste the summary lines).
2. Red proof on `5cdc34b`. Run the new browser checks against the old `src/` (for example
   `git stash` the `src/` changes only). The runner stops at its first failure, so run each group
   alone with the others skipped in the local run only (never committed). Report one failing
   message for each:
   - Checks fit: `scrollWidth 12xx > 978`, or the action right past the box;
   - words: a unit with 2 or more lines in Tokens, and the `unbroken` name with 2 or more lines
     in Checks;
   - recovery codes: a code with 2 lines;
   - preset cards: radio center offset;
   - sidebar: bottom < `scrollHeight`;
   - nav hints: missing `.nav-edge`;
   - account row: foot height > 56;
   - buttons: Save check width;
   - overview: no `a.state-tile`;
   - Team: `2FA: on`.
3. `bun run check:browser` passes on the final tree with the new `ok(...)` lines.
4. `git diff --stat 5cdc34b` shows only the files of the `Files:` list (plus test suites whose
   literals changed). `package.json`, `bun.lock` and `src/server.ts` are unchanged, and
   `src/styles.ts:14–37` (the tokens) is unchanged (`git diff 5cdc34b -- src/styles.ts` shows no
   `--` custom-property line).
5. Manual smoke run per console `AGENTS.md`:
   - run `bun e2e/run.ts --serve`;
   - check `/checks` at 1280 (fits, no scroll), `/tokens/new` (cards), `/` (tiles) and a phone
     width (one-row nav with hints, compact account row);
   - report the command and the result in the PR, and name the stray Team divider's cause (R9).
6. The PR names #780, the checks that ran, and the known limits:
   - the Target ellipsis on the list, and the ellipsis on an unbroken name or id wider than the
     Check column (full text in the DOM and on the detail page);
   - the scroll-hint fallback in browsers without scroll-driven animations (static shadows only);
   - Tokens and Probes tables may still scroll inside their box.

## Risks

- **Markup assertions in many suites.** The Checks row, Overview list, shell account line, Copy
  button and preset markup are asserted as literals in several HTTP suites. Update each literal
  to the new markup from this spec. Never drop an assertion or a permission case.
- **`overflow-wrap: normal` on all cells.** Check detail tables (`src/check-detail-pages.ts`)
  lose `anywhere`. A long unbroken value there makes its auto table wider, and it scrolls inside its
  `.table-scroll` box. The existing detail checks (300-character name at 390) must stay green.
  If a detail page overflows the document, hold with `needs-input` instead of changing that page.
- **Fixed Checks columns.** If 15rem does not hold `View Edit Export Delete` in the fonts on CI,
  widen `col-actions` and narrow `col-state`. Do not shrink link text or let actions wrap.
- **Scroll-driven animation support.** Playwright 1.64.1 Chromium supports `scroll-timeline`
  and `timeline-scope`. Other browsers without support show no edge element, but they keep
  today's background shadows. No script is added.
- **Recovery codes per scheme.** Making new codes spends the old ones. Store the new codes in
  `env.console.recoveryCodes` right after each generation, or later sign-ins in the matrix fail.
- **Sticky inner sidebar.** `position: sticky` needs no `overflow` on the ancestors. Keep
  `.shell` and `.sidebar` without `overflow`.

## Acceptance evidence (feature)

- Console PR merged with `Closes lorenzh/pulse-meta#<child>`. CI jobs `check`, `docker`,
  `deploy-dev` and `browser` are green.
- The browser log shows, for light and dark at 1280 px:
  - Checks box `scrollWidth ≤ clientWidth` with the matrix data, including the `unbroken` row,
    whose name and id are each on 1 line and cut with an ellipsis inside their cell;
  - Team, Tokens and Probes word units and `cell-nowrap` cells at 1 line each, with the literal
    required texts found;
  - 10 recovery codes of 39 characters at 1 line each, at 1280 and 390;
  - four preset cards with radio-to-title gap 12 ± 1 px and centers within 2 px.
- The red proofs of completion evidence 2 are recorded in the PR.
