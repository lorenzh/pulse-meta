# Spec #774: console — apply the pulse design to the shared stylesheet and the built screens

## Goal

The console works but still looks like a plain form app: one stylesheet with `system-ui`, a blue
`#1b4f9c` button, 4 px radii, a top header and a link row as navigation
(`.repos/console/src/styles.ts` lines 4–60). This feature puts the visual language of the owner's
"pulse Console" boards into that one stylesheet as CSS custom properties and component classes. It
moves every screen that is on console `main` onto those classes. It also fixes the four shared
#773 defects: radios next to their labels, the mobile checks table, danger delete buttons, and the
403 page.

It also serves the two design font families itself, from files committed in the console
repository (owner decision, R15).

The result is a presentation change. Routes, statuses, roles, CSRF, form tokens, cookies, stored
data, texts and status meanings stay as they are. The only new routes are the seven font files,
and the only CSP change is the added `font-src 'self'`. #460 and the #718 amendment win over a
board. This spec builds on #718 (shell, states, confirmations, closed): it restyles those parts
and does not rebuild them.

Inputs read for this spec:

- Issue #774 (current body, re-read for this revision) and its comments. The review artifact
  `.factory/work/774/issue-review.md` gives open points 1–11 and a derived acceptance check. This
  spec adopts them; where it decides an open point, the decision is named below.
- The owner's decision in the issue comments: the console serves Space Grotesk and JetBrains Mono
  itself, as committed `woff2` files under the SIL Open Font License, with `font-src 'self'` as
  the only CSP change. This replaces the "no web font, no CSP change" rule of the first revision
  of this spec. The words "no … font request" in issue-review acceptance check 2 are superseded
  by it; the rest of that check stands.
- The plan-review comment on the first revision (five required changes: fonts, the `:visited`
  conflict between R3 and browser check 9, console cost estimates, the mobile nav focus offset,
  concrete test files). This revision answers each of them; the breakdown comment named the same
  `:visited` conflict.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/774` answered
  `HTTP 404` again for this revision, so this feature has no findings yet.
- Font sources, read for this revision: the npm tarballs `@fontsource/space-grotesk@5.3.0`
  (`dist.integrity`
  `sha512-ksnGizDPXIDuvqcTYTSrmZ+evx9sDlS8rp7+42BQ7wU+spt3twEoXfbJz672C+5CLg6VeUQwRy5RXshWb67LcQ==`)
  and `@fontsource/jetbrains-mono@5.3.0` (`dist.integrity`
  `sha512-fqDfB5I9f1p1TV486aUgB9t8zP84P0O1FtQR5Ol9vjwPy+S+EIGlVYm1cvj2W5shcZMTg2nZFdVMoH5wFu8a1A==`),
  both `license: OFL-1.1` in the registry. The file sizes and SHA-256 hashes in R15 were computed
  from those extracted tarballs.
- Console clone at `c78c9d5` (`.repos/console`, merge of PR #12, "console check screens").
  The source files read are named in the repository section. Deploy
  `.repos/deploy/e2e/console-setup.sh` lines 273, 308, 327 and 417 grep the page texts `Signed in
  as` and `This browser`. Line 140 greps `Checks: <n>.`. This spec keeps those texts.
- Console PR lorenzh/pulse-console#14 (#768, tokens and probe locations screens) is still open
  (`gh pr view 14 -R lorenzh/pulse-console` answered `"state":"OPEN"`, console `main` is still
  `c78c9d5`). It changes `src/navigation.ts`, `src/styles.ts` (+1 line), `src/shell-line.ts` and
  `e2e/run.ts`. It is not on `main`; see Risks.

## Scope

- `src/styles.ts`, served at `/console.css`, stays the only style source. It holds the tokens,
  the dark scheme, and the component classes of the vocabulary below.
- The shared renderers move onto the vocabulary. These are `html.ts` (document, fields, buttons,
  error summary), `shell.ts` (sidebar shell), `states.ts` (callouts, empty state, 403, 404) and
  `confirm.ts` (confirmation panels).
- The screens on `main` move onto the shared classes. These are:
  - overview `/`;
  - checks list, detail, new (type choice and editor), edit, shadowed, the export links and the
    delete confirmation;
  - setup `/setup` and `/setup/owner`;
  - sign-in `/sign-in` and `/sign-in/factor`;
  - authenticator, recovery codes and their result, account security, password, sessions and
    sign-out-all;
  - team with invites, role, remove, transfer, reset link and reset 2FA;
  - invite `/invite/<token>` and reset `/reset/<token>`;
  - every shared state, including the session-expired notice on sign-in.
- Self-hosted fonts (R15): seven latin `woff2` files and two OFL license texts committed under
  `assets/fonts/`, served from seven fixed routes under `/fonts/`, loaded by `@font-face` rules
  in the shared stylesheet, shipped in the Docker image, and allowed by `font-src 'self'`.
- The four shared #773 defects listed under Goal.
- Browser checks in light and in emulated dark color scheme. Unit tests change where markup or
  class names change.
- Docs: the paragraphs in `docs/configuration.md` and `docs/development.md` that describe the old
  header, the link color `#1b4f9c` and the stylesheet.

## Non-goals

- No screen that is not built: incidents, maintenance, tokens, probes, activity, system,
  settings. Their own items use these classes and add only what is missing, in the same
  stylesheet.
- Nothing the boards show that #460 or the api do not provide: a global search box, theme toggle,
  nav counts, status-page link pill, org switcher, version or health tiles, 90-day bars,
  availability figures or passkeys. The checks list keeps its existing `Search` filter field
  (`q`). That field is a filter, not the board's global search box (issue-review point 2).
- No modal or dialog. The 16 px radius token exists only for a later dialog.
- No change to `/console.js` behavior, no theme script, no resize or overflow detection script.
- No new route other than the seven font routes of R15 (not even a session-expired route), no
  setting, no stored value, no new package (runtime or dev), no CSS framework, no build step.
  No font from a CDN or another origin, no font package at runtime, no font subsetting or
  conversion step in the repository: the committed files are the upstream files byte for byte.
- No CSP change other than adding `font-src 'self'` (R15). No `<link rel="preload">` for fonts:
  it would change every document head for a small gain; `font-display: swap` covers the first
  paint.
- The remaining #773 items stay in #773:
  - rounding of "Last reason";
  - readable settings labels: labels get the new typography but keep their words;
  - duplicate recent results;
  - create versus edit field parity;
  - the heartbeat address.
- No pixel comparison with the boards. No board file is available here; the token table and the
  dimensions in this spec are the contract.

## Required behavior

### R1. One stylesheet, tokens and schemes

- `CONSOLE_CSS` in `src/styles.ts` is the only CSS. The rules for it are:
  - no `<style>` element, no `style="…"` attribute and no second stylesheet;
  - no `@import`;
  - `@font-face` only as the seven rules of R15, and `url(` only inside those rules, each to one
    of the seven `/fonts/…` paths of R15;
  - no `data:` URI, although `img-src 'self' data:` would allow an image: this spec draws every
    glyph without one (see R4 and R12).
- `:root` sets `color-scheme: light dark` and every token below. `@media (prefers-color-scheme:
  dark) { :root { … } }` sets the dark values. No other selector redefines a color token.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f2eeec` | `#271b32` |
| `--surface` | `#e6dfdc` | `#33263f` |
| `--rule` | `#dfd7d4` | `#3e3049` |
| `--line-strong` | `#c4b8b3` | `#5a4b66` |
| `--field-line` | `#93847e` | `#766877` |
| `--field` | `#faf8f7` | `#1f1529` |
| `--text` | `#271b32` | `#dfd7d4` |
| `--lead` | `#4a3f52` | `#c9bfc4` |
| `--muted` | `#6a5850` | `#a89b95` |
| `--strong` | `#271b32` | `#dfd7d4` |
| `--on-strong` | `#f2eeec` | `#271b32` |
| `--accent` | `#8a4f9f` | `#c29bd3` |
| `--accent-text` | `#7a4290` | `#c29bd3` |
| `--accent2` | `#56619a` | `#9da7d4` |
| `--tint` | `#e6dbe3` | `#3d2d48` |
| `--tint-line` | `#d6c4d6` | `#54406a` |
| `--error` | `#a4262c` | `#f2a7ab` |
| `--error-tint` | `#f5dddd` | `#40232a` |
| `--warning` | `#8a5300` | `#f0c46b` |
| `--warning-tint` | `#f4e5c8` | `#3d3020` |
| `--success` | `#2d6a44` | `#9fd4ae` |
| `--success-tint` | `#dcebe0` | `#233a2c` |
| `--info` | `#3d5a94` | `#a9bde6` |
| `--info-tint` | `#dde4f1` | `#262e47` |
| `--code` | `#271b32` | `#1b1224` |
| `--code-text` | `#dfd7d4` | `#dfd7d4` |

- Non-color tokens on `:root`, set once:
  - `--font-sans: "Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif`;
  - `--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  - spacing `--space-1` … `--space-7` = 4, 8, 12, 16, 20, 24, 32 px, plus `--space-page-1` 40 px
    and `--space-page-2` 56 px;
  - `--touch: 44px`;
  - radii `--radius-field: 6px`, `--radius-panel: 12px`, `--radius-dialog: 16px`,
    `--radius-pill: 999px`.
- `[hidden] { display: none !important; }` comes first. Without it, `display: inline-flex` on
  buttons would show the copy buttons that `/console.js` keeps hidden.
- The root and `body` never get `overflow-x: hidden` or `overflow: hidden`.

### R2. Typography

The values come from the issue and are not repeated here: body, small, label, tag, page title,
section heading, eyebrow, and mono with `tabular-nums`. The decisions this spec adds are:

- A field label is 0.875rem with weight 500. A metadata or footer label is 0.8125rem.
- The eyebrow style is a shared class `.eyebrow`. Panel titles and `th` use it.
- Mono with `font-variant-numeric: tabular-nums` is the class `.mono`. These places use it:
  - check ids, timestamps (`utcMinute`, `utcTime` output), API URLs and origins, latency and
    count numbers in tables;
  - the counts list on the overview;
  - setup keys, recovery codes, link outputs and `code`/`pre`.
- `pre` and snippet blocks use `--code` fill and `--code-text` text, with radius 6.
- `body` uses `var(--font-sans)`. `.mono`, `.eyebrow`, `code`, `pre`, `kbd`, `samp`, tags, the
  wordmark and the dense check-state label use `var(--font-mono)`. Form controls get
  `font: inherit` so they use the sans stack too.
- Weights in use, and so the only weights R15 ships: sans 400 (body), 500 (labels, buttons, nav,
  section headings, callout titles), 600 (confirmation title), 700 (page title, `strong`, `b`);
  mono 400 (numbers, ids, code), 500 (eyebrow, tags), 600 (wordmark). No rule sets another
  weight, and no rule sets `font-style: italic` on a mono or sans text (no italic file ships;
  `em` keeps the browser's synthesized oblique).

### R3. Buttons

- Selector base: `button`, `a.button`. The base rules are:
  - inline-flex, centered;
  - `min-height: var(--touch)`, padding `0 20px`, radius 999, 15 px, weight 500, 1 px border;
  - default look is primary.
- Variants are classes: `.secondary`, `.ghost`, `.danger`, plus the size `.small`. Primary has no
  class.
  - Primary: fill `--strong`, border `--strong`, text `--on-strong`. Hover fill and border are
    `color-mix(in srgb, var(--strong) 85%, var(--bg))`.
  - Secondary: transparent fill, border `--line-strong`, text `--text`. Hover border is
    `--text`.
  - Ghost: transparent fill and border, text `--text`. Hover fill is `--surface`.
  - Danger: fill `--error`, border `--error`, text `--bg`. Hover fill and border are
    `color-mix(in srgb, var(--error) 85%, var(--text))`. That gives 7.30:1 light and 8.81:1 dark
    with `--bg`, computed with the formula in Counterexamples.
  - `.small`: visual height 36, padding `0 14px`, 0.8125rem. A `::after` pseudo-element with
    `inset: -4px 0` keeps a 44 px hit area, with `position: relative` on the button. No current
    screen needs `.small`; the copy buttons may use it (issue-review point 7).
- `button:disabled` and `[aria-busy="true"]` get opacity 0.45 and `cursor: default`. No other
  state gets that opacity.
- Link colors and `:visited`. `getComputedStyle` hides the visited color, so the browser check
  reads the CSS rules (check 9). Every top-level rule whose selector contains `:visited` uses
  exactly one of these selector parts, with exactly this `color`, and no `:visited` rule sits
  inside an `@media` block:

  | Selector part | `color` | Why |
  |---|---|---|
  | `a:visited` (rule `a, a:visited`) | `var(--accent-text)` | ordinary links |
  | `a.button:visited` (rule `a.button, a.button:visited`) | `var(--on-strong)` | primary link button |
  | `a.button.secondary:visited` | `var(--text)` | secondary link button |
  | `a.button.ghost:visited` | `var(--text)` | ghost link button (confirmation Cancel) |
  | `a.button.danger:visited` | `var(--bg)` | danger link button |
  | `.callout a:not(.button):visited` | `var(--text)` | underlined links on a tint |
  | `.nav-item:visited` | `var(--lead)` | sidebar nav items |
  | `.nav-item[aria-current="page"]:visited` | `var(--text)` | current nav item |
  | `.breadcrumbs a:visited` | `var(--muted)` | breadcrumb link |

  The unvisited form of each selector carries the same color. So a visited link never changes
  color, and no link rule overrides a button's text. A later screen that needs another link
  color adds a row here and to check 9; it never adds an unlisted `:visited` rule.
- `submitButton` in `src/html.ts` takes `variant?: "primary" | "secondary" | "ghost" | "danger"`.
  Primary or undefined renders no class. Every other variant renders `class="<variant>"`. The
  output of today's `primary` and `secondary` calls stays byte-identical.
- Literal `<button>` elements may stay literal. They carry the same classes; `secondary` stays
  `secondary`.
- Every submit whose action deletes, revokes, removes or transfers is danger:
  - `Delete check`;
  - `Revoke invite`;
  - `Remove`;
  - `Make owner`;
  - `Reset 2FA`;
  - `Sign out all other sessions` (destructive plain confirmation, R11).
- These stay primary: Resolve (the test fixture), `Create new recovery codes`, `Make reset link`
  (issue-review point 5) and `Change role`.
- Shell `Sign out` and the sign-in factor `Cancel` keep their current variant (`secondary`).

### R4. Fields

- `label` is a block with `display: grid; gap: 8px`. Its text is the label style from R2. It still
  wraps its control, as `field()` and the editor render today.
- Text controls are `input` except `type=radio|checkbox|hidden`, plus `select` and `textarea`.
  They get:
  - `width: 100%`, `min-height: var(--touch)`, padding `0 14px`;
  - `--field` fill, 1 px `--field-line` border, radius 6, `--text` text, the sans font.
- `textarea` gets padding `12px 14px` and line-height 1.6.
- Focus: `outline: 2px solid var(--accent); outline-offset: 3px`, `border-color: var(--accent)`
  and `box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)`.
- `[aria-invalid="true"]` gets a `--error` border and
  `box-shadow: 0 0 0 3px color-mix(in srgb, var(--error) 20%, transparent)`. On focus, the outline
  stays the accent outline.
- `select` gets `appearance: none` and `padding-right: 36px`. Its chevron is drawn with two
  `linear-gradient` background images in `var(--muted)`. There is no SVG `data:` URI: it could
  not follow the dark scheme.
- `.hint` is 0.875rem `--muted`. `.error` (the field error text) is 0.8125rem `--error`, weight
  400.
- `fieldset` has no browser border. It gets `border: 0; padding: 0; margin: 0; min-width: 0`.
  `legend` uses the label style.

### R5. Radios, checkboxes and option cards (#773 radio defect)

- `input[type=radio]` and `input[type=checkbox]` are 18 × 18 px with
  `accent-color: var(--accent)`, `margin: 0` and `flex: none`. They never get the text-control
  width.
- A choice row is `label.choice`:
  - `display: inline-flex; align-items: center; gap: 12px; min-height: var(--touch)`;
  - the control is first, then the text;
  - `width: auto`, so the row is not stretched to the full width.
- Each choice row of a fieldset is its own line. The fieldset is a column flex with `gap: 0`.
- `radios()` in `src/check-editor-page.ts` renders `<label class="choice"><input type="radio" …>
  <span>Label</span></label>`. The role select in the team stays a select.
- `.option-card` is a modifier of `.choice`:
  - 1 px `--line-strong` border, radius 12, padding `14px 16px`, `display: flex`;
  - with `:has(input:checked)`: `--accent` border and `--tint` fill.
  - Today's editor radios are plain choice rows. `.option-card` is in the stylesheet for later
    role and type choices.
- The type choice of `GET /checks/new` (`checkTypeChoiceHtml`) stays a list of links. Its items
  get the panel look; the links keep their href and text.

### R6. Tables and the scroll box (#773 mobile table defect)

- `table` is full width with collapsed borders.
- `th` uses the eyebrow style on a `--surface` fill, padding `10px 16px`, left-aligned, with a
  bottom border of `--line-strong`.
- `td` has padding `9px 16px`, a `--rule` bottom border and `vertical-align: middle`. Rows have
  `height: 52px`, which acts as a minimum height in a table.
- `td.num` and `th.num` are right-aligned mono. Latency, counts and durations use them.
- `tbody tr:hover` gets the fill `color-mix(in srgb, var(--surface) 45%, transparent)`.
- Every table whose content can be wider than 390 px sits in
  `<div class="table-scroll" tabindex="0" role="region" aria-label="<name>">`. This covers the
  checks list, the detail result and latency tables, the team members and invites tables, and
  sessions. The names are:
  - checks list: `Checks table`;
  - detail tables: `<section heading> table`;
  - team members: `Team table`;
  - team invites: `Pending invites table`;
  - sessions: `Sessions table`.
- The box has `overflow-x: auto`, radius 12, a 1 px `--line-strong` border and the R9 focus
  outline.
- Edge shadow without script: the CSS-only scroll-shadow technique.
  - Two `background` layers in the `--bg` color have `background-attachment: local`.
  - Two radial or linear shadow layers have `background-attachment: scroll`.
  - The shadow shows at an edge only while content lies beyond that edge.
- Visible hint: at ≤719 px, `.table-scroll-hint` shows above the box. It is the text
  "Scroll sideways to see all columns." in label style. It is rendered only for the checks list,
  whose `table.checks` keeps `min-width: 56rem`.
- The arrow keys scroll the focused box. This is native browser behavior.

### R7. Check state and tags

- A check state is `<span class="check-state check-state-<state>"><span class="dot"
  aria-hidden="true"></span><span>Label</span></span>`. `<state>` is one of `up`, `degraded`,
  `down`, `maintenance`, `unknown` or `shadowed`. The label text is the existing `STATE_LABELS`
  value or `SHADOWED_TEXT`, unchanged.
- The dots:
  - up: 8 px filled `--success`;
  - degraded: 8 px filled `--warning`;
  - down: 8 px filled `--error`, and the label text is also `--error`;
  - maintenance: 10 px ring, 1.5 px `--accent2`, transparent;
  - unknown and shadowed: 8 px ring, 1 px `--field-line`.
- `.check-state.dense` is the table form: label mono 0.75rem `--muted`, or `--error` when down.
- The renderers are: the checks list State column (dense), the detail page State value, and the
  State column of the detail recent-results table (dense). Overview count rows get the dot of
  their state before the existing `Label: n` text.
- A tag is `<span class="tag tag-<kind>">`:
  - height 24, padding `0 9px`, radius 999, 1 px `currentColor` border;
  - mono 0.75rem weight 500, `white-space: nowrap`, transparent fill.
  - The kinds are `neutral` (`--muted`), `info` (`--accent2`) and `error` (`--error`).
- Contrast rule (issue-review point 9): light `--accent2` on `--surface` is 4.47:1 and on
  `--tint` 4.37:1, both below 4.5:1. So `.tag-info` sets its own `background: var(--bg)`. No tag
  is placed on a fill other than `--bg`, `--field` or the row-hover mix (4.80:1 for light
  `--accent2`).
- Tags are used for:
  - the Source column of the checks list: `checks.json (read-only)` as neutral, `Console` as
    info;
  - the role column of the team tables, and the invite role: neutral;
  - the source on the detail page.
- The text inside a tag is unchanged.

### R8. Callouts, banners and the empty state

- One renderer in `src/states.ts`:
  `callout(view: { kind: CalloutKind; title?: string; body: string; role?: "alert" | "status";
  id?: string; action?: { href: string; label: string } }): string`, with
  `CalloutKind = "info" | "success" | "warning" | "error" | "neutral"`. It renders:

  ```html
  <section class="callout callout-<kind>" [role] [id]>
  <svg class="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">…</svg>
  <div class="callout-body">[<h2 class="callout-title">title</h2>]<p>…</p>[<a class="button secondary small" href>…</a>]</div>
  </section>
  ```

  The body HTML is passed in already escaped by the caller, as `state()` does today.
- Layout: `display: flex; gap: 12px; padding: 14px 16px; border-radius: 6px;` 1 px border. The
  title is 15 px weight 500 and the text 0.875rem.
- Fill, border and text per kind:
  - info: `--info-tint` fill, `--line-strong` border, `--text` text, `--info` icon;
  - success: `--success-tint` fill, `--success` border, `--text` text, `--success` icon;
  - warning: `--warning-tint` fill, `--warning` border, `--text` text, `--warning` icon;
  - error: `--error-tint` fill, `--error` border, `--text` text, `--error` icon;
  - neutral: `--tint` fill, `--tint-line` border, `--text` text, `--lead` icon.
- Links inside a callout use `--text` with an underline, so no link sits as `--accent-text` on a
  tint.
- Icons are paths in a new module `src/icons.ts`. They use `fill="none" stroke="currentColor"`;
  presentation attributes are not style attributes, so the CSP allows them. The CSS sets the
  icon color. The glyphs are:
  - info: circle with "i";
  - success: circle with check;
  - warning: triangle with "!";
  - error: circle with "!";
  - neutral: circle.
  The module also holds the 16 px nav icons of R10.
- Mapping. Existing texts, statuses and roles stay unchanged.
  - error:
    - `apiUnavailableState` and `tokenRejectedBanner`;
    - the overview `no-token` section and `errorSection` and its siblings in `check-pages.ts`;
    - `notSavedBody` (team 409) and `readOnlyState` (503);
    - `formErrorSummary`: title "There is a problem", the list of links in the body, `role="alert"`;
    - the account and sign-in `role="alert" class="error"` paragraphs;
    - the sign-in error and the failed connection test (`#connection-result`, keeps its id);
    - team `SAVE_FAILED` and the team error at `team-routes.ts:353`;
    - the check write `answer.message` (`Not saved`) and `conflictPage` / unaddressable (409
      `Not possible`).
  - warning:
    - `staleState` (409/412) and `alreadySubmittedState`;
    - `formExpiredNotice`, `formExpiredResendNotice` and `CHANGE_EXPIRED_TEXT`;
    - `SAVED_NOT_LOGGED_TEXT`, the confirmation `notice`, and the team role `switchNotice` and
      invite `notice`;
    - the 403 body (R13).
  - success: `CHECK_SAVED_TEXT`, `CHECK_DELETED_TEXT`, "All other sessions are signed out." and
    "Your password is changed. Other sessions are signed out.".
  - info: the sign-in `class="notice"` (the session-expired notice "Your session has expired."),
    `FILTERS_IGNORED_NOTICE`, `SHADOWED_PAGE_TEXT` and the checks-file banner (`fileBanner`).
  - neutral: the 404 body (R13).
- The setup connection test: a failure is an error callout with `id="connection-result"` and
  `role="alert"`. The success line "Connected. Wire version: 1. Checks: <n>." is a success
  callout with `id="connection-result"` and no role, as today. Its text stays byte-identical,
  because deploy greps `Checks: <n>.`.
- An audit rule follows from this mapping. After the change, every element with `role="alert"`
  or `role="status"` in a rendered page is a callout. Field error spans have no role and are not
  callouts.
- `emptyState()` renders `<section class="empty-state">`:
  - `<h2>` at 1.125rem, `<p>` with max-width 300 px in `--lead`;
  - its one action as `a.button` primary, or the given form HTML;
  - transparent fill, 1 px dashed `--line-strong` border, radius 12, padding `40px 24px`, a
    centered column.
- `action` becomes optional. The viewer variant of `emptyInstallation` in `check-pages.ts` then
  uses `emptyState()` with no action instead of its own markup.

### R9. Focus

- Every `a`, `button`, `input`, `select`, `textarea`, `summary` and `[tabindex]` gets
  `:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }`.
- The offset is 3 px everywhere, with no exception. The nav items in the horizontally scrolling
  mobile nav row (≤719 px) also keep `outline-offset: 3px`. An element with `overflow-x: auto`
  clips at its padding box, so the outline needs room inside it:
  - the scrolling nav row gets `padding: 6px` on every side, which is more than the 5 px the
    outline reaches beyond an item (2 px width + 3 px offset);
  - it gets `scroll-padding-inline: 6px`, so a focused item scrolled into view keeps that room
    at the row's start and end edges;
  - the row has no `overflow-y` clip other than the one `overflow-x: auto` implies, and its
    items have no negative margins.
  The `.table-scroll` box keeps 3 px; its outline is outside the box, in `main`, which does not
  clip.
- The old `#e3a008` outline goes.

### R10. Shell

`shellPage` keeps every field of `ShellView` and one `h1`. The new DOM order is:

```html
<a class="skip-link" href="#main">Skip to content</a>
<div class="shell">
<header class="sidebar">
  <p class="wordmark"><span class="wordmark-name">pulse</span><span class="cursor" aria-hidden="true"></span><span class="pill">self-hosted</span></p>
  <p class="instance">pulse Console</p>                 <!-- view.instanceName, escaped -->
  <nav aria-label="Main"><ul>…main entries…</ul>
    [<p class="eyebrow nav-group" id="nav-instance">Instance</p><ul aria-labelledby="nav-instance">…admin entries…</ul>]
  </nav>
  <div class="sidebar-foot">
    <span class="avatar" aria-hidden="true">LH</span>
    <p class="account">Signed in as <name> <span class="account-email">(<email>)</span><br>Role: <role></p>
    <a href="/account/security">Account security</a>
    <form method="post" action="/sign-out" class="sign-out">csrf, form_token, Sign out (secondary)</form>
  </div>
</header>
<div class="shell-column">
  <div class="topbar"><nav aria-label="Breadcrumb" class="breadcrumbs"><ol>…</ol></nav></div>
  [<div class="banner">…</div>]
  <main id="main" class="shell-main">
    <div class="page-head"><h1>title</h1></div>
    body
  </main>
</div>
</div>
```

- The "Instance" group holds the visible entries with `minRole: "admin"` (Tokens, Probes, Team,
  Activity, System), in registry order. When no such entry is visible (viewer, member), the eyebrow
  and its list are not rendered. `visibleNavigation` keeps deciding visibility. A small pure
  helper in `navigation.ts` splits its result into main and instance groups by `minRole`.
- Nav items are `<a class="nav-item" href="…">`:
  - `min-height: 44px; padding: 0 12px; border-radius: 6px`, `--lead` text, weight 500, no
    underline;
  - a 16 px icon from `src/icons.ts` before the text, `aria-hidden`;
  - hover `--surface`;
  - `[aria-current="page"]` gets `--tint` fill and `--text` text.
  Icons exist for every `NavId`, so a later screen needs no stylesheet or icon change to appear.
- The avatar shows initials, `aria-hidden="true"`: 32 px round, `--surface` fill, mono 0.75rem.
  The initials are:
  - the first code point of the first and of the last whitespace-separated word of
    `user.name.trim()`, upper-cased with `toLocaleUpperCase("en")`, so one word gives one letter;
  - when the name is empty, the first code point of `user.email`;
  - when both are empty, `?`.
  They go through `escapeHtml`. `Signed in as`, the name, the email in its `.account-email` span
  and `Role:` stay as text.
- The wordmark is not a link. It is mono 19 px weight 600, with a `.cursor` block (0.55em ×
  1em, `--accent` fill) and a `.pill` (mono 11 px, 1 px `--line-strong` border, radius 999).
- Breadcrumbs:
  - with `view.current` defined and its entry's label ≠ `view.title`:
    `<li><a href="<entry path>">label</a></li><li aria-current="page">title</li>`;
  - otherwise `<li aria-current="page">title</li>`.
  They use mono 0.8125rem `--muted` with `/` separators drawn by CSS `::before`. There is no new
  route and no new data.
- Desktop (≥720 px):
  - `.shell` is a grid with the columns `236px minmax(0, 1fr)`;
  - the sidebar is sticky at full height, with a right border `--rule` and padding `14px 12px`;
  - the top bar has `min-height: 64px`, padding `10px 32px` and a bottom border `--rule`;
  - `main` has `max-width: 1280px`, padding `28px 32px 56px` and a 24 px gap between direct
    children (flex column);
  - `.page-head` is flex-wrap with space-between. It holds the `h1` and an optional `.page-sub`
    (0.875rem `--lead`) and `.page-actions`.
- ≤719 px:
  - `.shell` is one column and the sidebar becomes a full-width top block with a bottom border;
  - the nav lists form one row with `display: flex; overflow-x: auto; flex-wrap: nowrap`, both
    groups in the same row with the eyebrow hidden visually (`.visually-hidden`);
  - the `.sidebar-foot` stays visible below the nav row, wrapping;
  - `main` padding becomes `20px 16px 40px`.
- `/console.js` and its `<script>` element stay as they are. Only the shell loads it.

### R11. Panels, page parts and confirmations

- `.panel`:
  - `--bg` fill, 1 px `--line-strong` border, radius 12;
  - `.panel-head`: min-height 52, padding `8px 20px`, bottom border `--rule`, flex
    space-between;
  - `.panel-body`: padding 20;
  - `.panel-foot`: padding `12px 20px`, `--surface` fill, top border `--rule`, flex end, gap 8,
    wrapping.
- The detail page `section()` in `check-detail-pages.ts` renders `<section class="panel"><div
  class="panel-head"><h2 class="eyebrow">…</h2></div><div class="panel-body">…</div></section>`.
  The headings stay `h2` elements with their existing text.
- `dl.settings`:
  - grid `150px minmax(0, 1fr)`;
  - `dt` in mono label style (`--muted`, 0.8125rem);
  - `dd` with `margin: 0` and `overflow-wrap: anywhere`;
  - one column at ≤900 px.
- Grids for later screens: `.grid-2` and `.grid-4` with gap 16. `.grid-4` becomes two columns at
  ≤1180 px. `.grid-2`, `.grid-4` and `.form-grid` become one column at ≤900 px. Every grid child
  has `min-width: 0`.
- Confirmations (`confirm.ts`). `ConfirmView` gets a required
  `tone: "danger" | "safe"`; there is no default, so every caller decides. The typed confirmation
  is always danger and has no `tone` field. Both render:

  ```html
  [warning callout notice][error summary]
  <form method="post" action="…" class="panel confirm confirm-<tone>">
  csrf, form_token, revision, hidden…            <!-- order unchanged -->
  <div class="panel-body"><p class="confirm-title">consequence</p>[<p class="confirm-target mono">name</p> field]</div>
  <div class="panel-foot"><a class="button ghost cancel" href="…">Cancel</a> submit</div>
  </form>
  ```

  - `.confirm-title` is weight 600.
  - `.confirm-danger` has border `--error` and a `danger` submit. `.confirm-safe` has the normal
    border and a primary submit.
  - The type-the-name input is mono.
  - Cancel comes before the submit in both DOM and visual order. It is a ghost-styled link and
    changes nothing.
  - No second heading: the shell `h1` stays the one title.
  - Callers: team `revokeInviteBody` danger, `resetTwoFactorBody` danger, `resetLinkConfirmBody`
    safe. `removeBody`, `transferBody` and the check delete are typed, so danger. The fixture
    `plain/resolve-incident` is safe.
- Account confirmations in `account-pages.ts` move onto the same markup by hand, because they
  carry other fields:
  - `signOutAllPage` gets a danger panel with a danger submit;
  - `newCodesPage` gets a safe panel; its password field sits in the panel body, with a primary
    submit.
  Their forms keep action, fields and field order.
- Team `roleFormBody` drops `class="confirm"` and becomes a normal form in a panel. Its Cancel
  becomes ghost and `Change role` stays primary.

### R12. Plain pages

- `plainDocument(title, body)` keeps its signature and stays without a script element. It renders:

  ```html
  <body class="plain">
  <header class="plain-head"><p class="wordmark">…</p></header>
  <main class="plain-main"><div class="panel plain-panel"><h1>title</h1>body</div></main>
  ```

- `.plain-panel` has `max-width: 440px`, `width: 100%`, padding 32, a 20 px gap (flex column)
  and centered margins. At ≤719 px its padding becomes 20.
- In `.plain-panel` the last primary submit of a form is `width: 100%` (`.plain-panel form >
  .actions button:not(.secondary)`). Secondary buttons stay auto width.
- Footer line: only existing secondary links and texts are styled as `.plain-foot` in label
  style. These are the factor page `Cancel` form, the authenticator `Sign out` form, recovery
  `Continue`, "Back to the team" and the link-not-valid text. No new link or text is added.
- Callers: setup, owner, sign-in, factor, authenticator, pending-expired, recovery codes,
  password change, invite accept, reset password, link not valid, `messagePage` and
  `alreadySubmittedPage`. Their bodies are unchanged except for R3, R4 and R8 classes.

### R13. States: 403 and 404 (#773 403 defect)

- `forbiddenState(view)` keeps its parameter type. It returns a warning `callout` without a
  title. The body is the existing role or target sentence plus the action link `Go to the
  overview` (`/`).
- The shell `h1` "Access denied" stays the only visible heading.
- Callers stay as they are (`server.ts:1015`, `check-write.ts:60`, `team-routes.ts:69-70`). So
  every 403 is fixed in one place, with status 403 kept.
- `notFoundState()` returns a neutral callout without a title. It holds the same sentence "There
  is no page at this address; go to the overview." and the link `Go to the overview`. Status
  404, the shell heading "Page not found" and the plain-text 404 for signed-out requests are
  unchanged.

### R14. Responsive

- The breakpoints are `max-width: 1180px`, `900px` and `719px`; R6, R10, R11 and R12 use them.
- At 390 × 844 the document has no horizontal overflow:
  `document.documentElement.scrollWidth <= document.documentElement.clientWidth`. Only the
  `.table-scroll` boxes and the mobile nav row scroll sideways, inside their own boxes.
- Long names, emails, URLs, ids, secrets and snippets wrap: `overflow-wrap: anywhere` on text
  containers, `min-width: 0` on flex and grid children.
- `pre` does not scroll sideways at 390 px. It gets `white-space: pre-wrap` and
  `overflow-wrap: anywhere`. That is presentation only: the copied `textContent` is the same
  bytes.

### R15. Self-hosted fonts (owner decision)

- **Files.** Seven latin-subset static `woff2` files, committed byte for byte from the npm
  tarballs named under Inputs (path inside the tarball: `package/files/<name>`), plus each
  tarball's `package/LICENSE` (the SIL Open Font License 1.1 text with the copyright line):

  | Committed file | Family, weight | Bytes | SHA-256 |
  |---|---|---|---|
  | `assets/fonts/space-grotesk-latin-400-normal.woff2` | Space Grotesk 400 | 13388 | `65fd17fcbd2e2f522940b5f67ead3d23329e02891aa5495e74d11a499c0b0673` |
  | `assets/fonts/space-grotesk-latin-500-normal.woff2` | Space Grotesk 500 | 13312 | `1b1a8131d9edf975d9decee81e2f2bf504812f7a4f498e5500f28a613e22e64c` |
  | `assets/fonts/space-grotesk-latin-600-normal.woff2` | Space Grotesk 600 | 13284 | `685bbbf69fa616df1ef81847c85fc76be097ddfb3468ff2257be54511ab3130f` |
  | `assets/fonts/space-grotesk-latin-700-normal.woff2` | Space Grotesk 700 | 12840 | `35f8aec56cfd5cbfdb03cc68733a54a0b05bb3617ffcd5fd332badc0b045ca55` |
  | `assets/fonts/jetbrains-mono-latin-400-normal.woff2` | JetBrains Mono 400 | 21168 | `14425ba9c695763c1547f48a206b7aa60350a33ae23de09f0407877f3fcd89eb` |
  | `assets/fonts/jetbrains-mono-latin-500-normal.woff2` | JetBrains Mono 500 | 21832 | `cb182feeed4d798ff6961d3c79f7026279448fca0676438aaecb21f3fc39553a` |
  | `assets/fonts/jetbrains-mono-latin-600-normal.woff2` | JetBrains Mono 600 | 21860 | `400c6bfda18d5d14acad1c15d6dcb9f8e13c015e7286317e0b9a482539bef147` |
  | `assets/fonts/OFL-space-grotesk.txt` | license of `@fontsource/space-grotesk@5.3.0` | 4401 | `18a4de52385f6b988782639d5d0cc1326e5a8c2de9a7f01d7b20d9aedcc60943` |
  | `assets/fonts/OFL-jetbrains-mono.txt` | license of `@fontsource/jetbrains-mono@5.3.0` | 4524 | `403581b69dac5cff4079205e01c6b467e56af449ecbd7247693ddb1baafa005b` |

  The fonts total 117684 bytes. The implementer fetches the two tarballs from
  `https://registry.npmjs.org/@fontsource/<name>/-/<name>-5.3.0.tgz`, checks them against the
  `dist.integrity` values under Inputs, extracts them into an empty scratch directory and copies
  only these files. Nothing is added to `package.json` or `bun.lock`. When the implementer cannot
  reach the registry, it requests a hold; it never substitutes other files.
  Static per-weight files, not the variable files: the issue asks for "only the weights the
  design uses", and the variable latin files of the same release (22288 + 40404 bytes) also
  carry weights the design does not use.
- **Routes.** Seven fixed GET and HEAD routes, one per font file, with the file name as the last
  path segment: `/fonts/space-grotesk-latin-400-normal.woff2`, `…-500-…`, `…-600-…`, `…-700-…`,
  `/fonts/jetbrains-mono-latin-400-normal.woff2`, `…-500-…`, `…-600-…`.
  - They are entries of the `ROUTES` table in `src/server.ts` (lines 116–142 today) with
    `access: "public"`, like `/console.css` (line 122). So they answer before setup, run no
    session gate, keep the `Host` check (`isHostRefused`) and answer `405` with
    `allow: GET, HEAD` for another method.
  - The raw path is compared byte for byte, as for every route. The server never builds a file
    path from request data: each route maps to a constant file name. The license texts are not
    served.
  - The response: status `200`, `content-type: font/woff2`, `cache-control: public,
    max-age=31536000, immutable`, `content-length` of the file, the shared security headers, no
    `set-cookie`, no body for HEAD. `send` in `src/http-context.ts` (lines 84–99) always sets
    `no-store` and takes a string; add a byte-body variant or widen it to `string | Uint8Array`,
    with the cache header passed in. Every other response keeps `no-store`.
  - The bytes are read once, when `createConsoleServer` runs, from `assets/fonts/` resolved
    against the module URL (`new URL("../assets/fonts/<name>", import.meta.url)`), not against
    the working directory. `src/fonts.ts` (new) holds the constant list (route, file name,
    family, weight) and a pure `loadFonts(readFile)` that returns the bytes per route; the
    server passes `readFileSync`. A missing file throws a named `Error` subclass, so a broken
    image fails at startup and not on the first page.
  - Because the URLs carry no content hash, `immutable` binds the repository: a changed font
    file gets a new file name and route. `docs/development.md` states this.
  - `/metrics`: the seven paths count under one new `path` label `/fonts/:file`
    (`PathLabel` in `src/metrics.ts`, `pathLabel` in `src/server.ts`). Any other `/fonts/…` path
    is a normal 404 under `other`.
- **Stylesheet.** Seven `@font-face` rules at the top of `CONSOLE_CSS`, after `[hidden]`:
  `font-family: "Space Grotesk"` or `"JetBrains Mono"`, `font-style: normal`, `font-weight:
  <n>` (a single number), `font-display: swap`, `src: url("/fonts/<name>") format("woff2")`. No
  `woff` fallback, no `local()`, no `unicode-range` (the files hold only the latin subset). The
  stacks of R1 keep the system fonts as the fallback.
- **CSP.** `CONTENT_SECURITY_POLICY` in `src/server.ts` (lines 95–96) becomes exactly:
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
  form-action 'self'; base-uri 'none'; frame-ancestors 'none'`. This is the issue's string, with
  `font-src 'self'` directly after `img-src`. Nothing else in the header set changes.
- **Image.** The `Dockerfile` copies `src` only (line 12). Add `COPY assets ./assets` after it.
  `.dockerignore` does not exclude `assets` and stays as it is. The image then carries the
  fonts and their license texts, as the OFL requires for a redistribution.
- **Docs.** `README.md`: the assets line (line 14), the endpoint table (a row for `GET
  /fonts/<file>.woff2` beside `/console.css`, lines 129–130) and the License section (line 140):
  "MIT, see LICENSE. The fonts in `assets/fonts/` are under the SIL Open Font License 1.1, see
  the `OFL-*.txt` files beside them." `docs/configuration.md`: the label list (line 111), the CSP
  line (line 201) and the asset paragraph (line 206). `docs/development.md`: the fonts paragraph
  (source tarballs, hashes, the new-name rule) and the CI step list (line 79). The console
  `AGENTS.md` CSP sentence (lines 112–115) gets the new string.

## Risks

- **Overlap with console PR #14 (#768).** It edits `navigation.ts`, `styles.ts` and `e2e/run.ts`,
  and it adds token and probe pages that use today's classes.
  - When the child starts and #768 is on `main`, Tokens and Probes are already available
    (`isAvailable: true`). They then appear under the Instance group through R10 without extra
    work. Their pages must keep passing their tests under the new stylesheet. Their bodies get
    no dedicated restyle beyond what the shared helpers give them.
  - When #768 merges after this child opened its PR, the conflict goes through the merge
    workflow (`factory start --issue <child> --workflow merge --apply`).
  - This is a shared finding: the child that meets the merge state first records whether #768
    was on `main` at its start.
- **Contrast of real pairings.** Tokens cannot be combined freely; see R7. axe runs on the
  rendered pages in both schemes, and the unit table in Counterexamples lists the pairs the CSS
  uses.
- **Tests that pin the old look.** These tests pin the old look and change with this feature:
  - `src/server.test.ts:156` checks the literal `a, a:visited { color: #1b4f9c; }`;
  - `e2e/run.ts:47` `LINK_COLOUR`, the `visitedRules` CSSOM check (lines 412–429), and the Tab
    order "Skip to content, Account security, Sign out, Overview" (lines 534–543).
  They are replaced by token-based expectations. Their behavior coverage must not be dropped:
  link color, visited color, focus outline, skip-first and reachability.
- **Tests that pin the CSP literal.** Eight places hold the old CSP string and must get the new
  one of R15: `src/server.test.ts` lines 21 and 362, `src/server.security.test.ts` lines 43 and
  574, `src/server.states.test.ts` line 19, `src/server.team.test.ts` line 19,
  `src/server.invite.test.ts` line 26 and `src/server.account-shell.test.ts` line 14.
  `src/server.checks.test.ts:333` and `src/server.test.ts:286` only check a prefix and stay. A
  missed literal fails `bun test`, so none can be missed silently; the risk is a wrong fix that
  reads the expected string from `CONTENT_SECURITY_POLICY`. Each test keeps its own literal.
- **Font files in the image.** The `Dockerfile` copies only `src` today. Without the new
  `COPY assets ./assets` line the image starts nothing (R15 loads the fonts at server creation),
  and the CI docker job fails at its `/readyz` wait. The new CI step (Checks) proves the files
  are served from the image.
- **Font license.** The OFL allows bundling and redistribution when the license text travels
  with the font, and forbids selling the fonts alone. Committing the two `OFL-*.txt` files beside
  the fonts and shipping them in the image meets that. The font files are not renamed in a way
  that touches a Reserved Font Name: the fontsource files keep the upstream family names, and
  the OFL texts of both releases list no Reserved Font Name (their copyright lines name only the
  project authors).
- **Layout shift from `font-display: swap`.** The first paint uses the fallback stack and
  swaps when the font arrives. On a cold load this shifts text once. This is the issue's choice;
  the browser checks wait for `document.fonts.ready` before they measure geometry.
- **Deploy e2e.** `console-setup.sh` greps `Signed in as`, `This browser`, `Checks: <n>.` and
  `Already submitted`, and extracts the `csrf` and `form_token` inputs. All of them stay, so
  deploy needs no change. The CI job `deploy-dev` (console `ci.yml` lines 210–269) proves it.
- **`:has()`** is used only for the option card's checked look, which is enhancement only.
  Chromium of Playwright 1.64.1 supports it.
- **Sticky sidebar and scroll shadows** are CSS only. Where a browser lacks them, the content
  stays usable.

## Performance impact

**`bench/budgets.json` of the api repository: none expected.** The file has sections `api`,
`probe`, `status`, `notify`, `contract`, `kit` and `config` and no `console` section, and the api
bench does not build, start or measure the console. No api, probe, status or notify code
changes, so none of their keys (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`,
`test_cpu_s`, `startup_wall_ms`, the `p95_*`, `rps`, `image_mb`, the `cold_*` and `eod_*` keys)
can move. A `bun bench/run.ts` A/B in the api repository would compare identical api code.

**Console costs** (the same kinds of metric, measured on the console). Current values were read
on the clone `c78c9d5`; the new values are estimates with bounds:

| Metric | Now | After | How to measure |
|---|---|---|---|
| `/console.css` bytes | 4055 (`CONSOLE_CSS.length`) | 20–35 KB, bound 49152 bytes | `bun -e 'import("./src/styles.ts").then(m=>console.log(Buffer.byteLength(m.CONSOLE_CSS)))'` on both refs |
| shell HTML per page | — | +1.5–4 KB: sidebar, breadcrumbs, ≤ 9 nav SVGs of ≤ 300 bytes each | `curl -s -b session=<cookie> http://127.0.0.1:<port>/ \| wc -c` against `bun e2e/run.ts --serve` on both refs |
| font bytes, cold load | 0 | ≤ 117684 bytes (the sum of R15), only the faces a page uses | browser check 10 sums the font response sizes |
| requests, cold load of `/` | 3 (HTML, CSS, JS) | ≤ 10 (plus ≤ 7 fonts); warm: 3, the fonts are `immutable` for a year | browser check 10 counts requests |
| console RSS | — | +0.2 MiB at most: 117684 font bytes held once, plus the larger CSS string | `ps -o rss= -p <pid>` after start, both refs |
| console startup | — | +< 5 ms: seven sync reads of ≤ 22 KB at server creation | `src/main.startup.test.ts` wall time, both refs |
| console image | — | +126609 bytes (117684 fonts + 8925 license texts), about +0.13 MB | `docker build -t console:a <ref a>`, `docker build -t console:b .`, `docker image inspect -f '{{.Size}}' console:a console:b` |
| console test CPU | — | `bun test`: +< 1 s for the new unit tests; `bun run check:browser`: roughly 1.5–2× its wall time, because the design matrix runs twice (two schemes) at two widths | `time bun test`, `time bun run check:browser`, both refs |

No request path gets slower: fonts are served from memory, and HTML rendering adds only string
concatenation. The PR reports the measured values of this table for both refs.

## Security impact

Security impact: yes
The change rewrites the authentication and admin team pages, adds seven public routes and a CSP
directive, reads files at startup, and changes the Dockerfile and CI.

In detail: it rewrites the HTML of the authentication pages (setup, sign-in, factor, invite,
reset) and of the admin team routes. It moves the sign-out POST form and the confirmation forms,
and it renders user-controlled names in new places (initials, breadcrumbs, tags). It adds the
font routes, `font-src 'self'`, a `COPY` line in the `Dockerfile` and a step in the CI docker
job.

Checklist items that apply:

- **Secrets in errors, logs and responses.** No new place shows the admin token, a password, the
  setup code, a TOTP key or a recovery code. The setup key and the codes stay on the pages that
  show them today, and only there. Breadcrumbs and the page title never carry query values such
  as invite or reset tokens: the title strings are fixed per route.
- **Input validation and output encoding.** Every value placed in the new markup goes through
  kit `escapeHtml`: initials, breadcrumb labels, tag texts, check-state labels, callout titles and
  aria-labels. The hostile inputs to test are user names and check names such as
  `<img src=x onerror=alert(1)>`, `"><script>`, `&amp;`, a 300-character name, and an emoji or
  combining-mark name. The initials helper must not split a surrogate pair into invalid UTF-16.
  It takes code points, not UTF-16 units.
- **Auth order and status codes.** The dispatcher order (session, POST form, role, form token) and
  every status stay as they are: 403, 404, 409, 412, 422, 429 and 503. Navigation visibility is
  still not authorization: a member who opens `/team` gets 403 with the warning callout.
- **CSRF and form tokens.** Every moved form keeps `csrf` directly followed by `form_token`, then
  `revision` and the hidden fields in their current order. Sign out stays a POST button, never a
  GET link.
- **CSP.** The header gains exactly `font-src 'self'` after `img-src` (R15) and is otherwise
  byte-identical. Without `font-src`, fonts fall under `default-src 'none'` and are blocked, so
  the directive is needed. `font-src 'self' data:` or a scheme source would widen it and is
  wrong. There is no `style` attribute, no inline script and no request to another origin.
- **Auth order for the new routes.** The font routes are `access: "public"` like `/console.css`,
  before and after setup. That is safe: they return fixed public bytes, set no cookie, read no
  session and write nothing. They still pass the `Host` check and the method check (`405`).
- **Path-safe reads.** The server reads seven constant file names from a directory resolved
  against the module URL, once at startup. No request value reaches a file path, so `..`,
  percent-encoding, a double slash or a trailing slash cannot select another file: each is a
  normal 404 (Counterexamples). The license texts and every other file under `assets/` are not
  served.
- **Dependency pins.** No package is added. The font binaries are third-party content: they are
  pinned by the SHA-256 hashes of R15, which come from the npm tarballs with the named
  `dist.integrity`, and a unit test and the CI docker step compare served bytes with those
  literal hashes.
- **Dockerfiles.** One `COPY assets ./assets` line. The image still runs as `bun` (non-root),
  ships no test file and keeps its healthcheck and `CMD`; the existing CI checks stay.
- **CI files.** The docker job gets one more check step (Checks). No action, pin, permission or
  existing step changes, and nothing is weakened.
- Not applicable: body and size limits (GET only), accessor execution, SSRF and redirects, file
  writes.

## Rollout order

One repository: only `console` changes. No wire field, contract or config pin, api route or
deploy file changes. A console built from this change runs against the same pulse-api, so no
older consumer is affected. Deploy `main` keeps working because the texts and form fields it
greps are unchanged; the console CI job `deploy-dev` checks this. Deploy routes every console
path to the one console container and holds no path list (`grep -rln '/fonts\|console.css'
.repos/deploy` finds no file), so the font routes need no deploy change either. A browser that
cached an old `/console.css` gets the new one on its next page: the stylesheet keeps
`cache-control: no-store`.

## Counterexamples

- **Contrast.** The definition is the WCAG 2.x contrast ratio:
  - relative luminance from sRGB channels (c/255, then c/12.92 when c ≤ 0.03928, else
    ((c+0.055)/1.055)^2.4), weighted 0.2126 R + 0.7152 G + 0.0722 B;
  - ratio (L1+0.05)/(L2+0.05) with L1 the lighter;
  - compared unrounded against 4.5 for text. The 2-decimal values here are for reading only.
  - A `color-mix(… transparent)` fill is resolved over the `--bg` behind it.
  The cases:
  - Must reject: light `.tag-info` (`#56619a`) on the `--surface` table head `#e6dfdc` gives
    4.47:1, and on a `--tint` current-nav fill `#e6dbe3` 4.37:1. A tag without its own `--bg`
    fill in those places fails.
  - Must pass, with these as the expected numbers:
    - primary text on fill: light 14.13, dark 11.49;
    - danger `--bg` on `--error`: light 6.30, dark 8.45;
    - `--muted` on `--surface` (th): light 5.11, dark 5.23;
    - light `--muted` on the row-hover mix `#ede7e5`: 5.49;
    - link `--accent-text` on `--bg`: light 6.05, dark 6.92;
    - `--text` on the warning callout fill: light 13.10, dark 9.02.
  - Not a text rule: `--field-line` around `--field` is a border (3:1 non-text rule at most).
    Applying 4.5 to it is wrong.
- **Danger.** A wrong implementation styles only `Delete check` as danger. Each of these must
  have class `danger` and fill `--error`:
  - `Revoke invite`, `Remove`, `Make owner`, `Reset 2FA`, `Sign out all other sessions`.
  Each of these must not be danger:
  - `Make reset link`, `Create new recovery codes`, `Change role`, the fixture `Resolve
    incident`.
  A caller of `plainConfirmPage` without `tone` must fail to typecheck.
- **Danger text color.** `color: white` (`#ffffff`) or a fixed light color on danger is wrong:
  in dark it puts light text on the light `#f2a7ab` fill (about 1.6:1). The rule is
  `color: var(--bg)`. Today `--on-strong` has the same values as `--bg`, but the danger rule
  names `--bg`. A test reads the computed value and compares it with the literal
  `rgb(242, 238, 236)` light and `rgb(39, 27, 50)` dark.
- **403 heading.** A page with the h1 `Access denied` plus an h2 `Access denied` fails. The text
  "Access denied" must appear exactly once among visible headings. A 403 without a link to `/`
  fails. A 403 with status 200 fails.
- **404.** Moving the heading into the callout and dropping the shell h1 fails; one h1 "Page not
  found" stays.
- **Radio row.** A radio that is 100 % wide, sits on its own line above its text, or has a row
  under 44 px high fails. So does a label text that starts more than 12 px + 1 px after the
  control's right edge. A fieldset where two choices share a line also fails.
- **`[hidden]`.** `button { display: inline-flex }` without the `[hidden]` rule shows the copy
  button with JavaScript off. With JavaScript off, the copy button must have
  `getComputedStyle(el).display === "none"`.
- **Overflow at 390 px.** These fail:
  - hiding overflow with `html, body { overflow-x: hidden }`: a CSS check asserts that the
    computed `overflow-x` of `html` and `body` is `visible`;
  - a 70-character email that pushes the sidebar foot wider than 390 px;
  - a `pre` with a 200-character line that scrolls sideways.
- **Scroll box.** A `.table-scroll` without `tabindex="0"` or an accessible name fails axe
  `scrollable-region-focusable` or the explicit check. A box whose `scrollLeft` stays 0 after
  pressing `ArrowRight` five times on an overflowing checks table fails.
- **Breakpoints.** At 720 px the sidebar is a side column of 236 px; at 719 px it is a top block
  of full width. At 901 px `dl.settings` has two columns; at 900 px it has one. At 1181 px
  `.grid-4` has four columns; at 1180 px it has two. Swapping `min-width` and `max-width`, or
  using 720 instead of 719, fails one of those six widths.
- **Initials.**
  - `"Ada Lovelace"` → `AL`;
  - `"  ada  "` → `A`;
  - `"Jean-Luc Picard Jr"` → `JJ`;
  - `""` with `ops@example.com` → `O`;
  - `"😀 Smile"` → `😀S`, two code points, valid UTF-16;
  - `"<b>"` → `&lt;`, escaped, never a raw `<`.
- **Callout mapping.** The `Your session has expired.` notice is info, not error. `Check saved.`
  is success, not info. `This form has expired. …` is warning, not error. `formErrorSummary` is
  error and keeps `role="alert"`.
- **Nav group.** For a viewer or member, the page has no "Instance" text. For an admin or owner,
  "Instance" stands above `Team`, and `Team` is not in the first list.
- **Unchanged bytes.** `submitButton({label:"A", busyLabel:"B"})` and
  `submitButton({…, variant:"secondary"})` give the same strings as before the change. The CSP
  header string equals the literal of R15.
- **CSP.** Each of these fails the exact-string tests: the old string without `font-src`;
  `font-src 'self'` placed after `frame-ancestors` or before `img-src`; `font-src 'self' data:`;
  `font-src *`; any change to another directive.
- **Font routes.** With the seven routes of R15:
  - `GET /fonts/space-grotesk-latin-700-normal.woff2` → `200`, `font/woff2`, 12840 bytes,
    SHA-256 `35f8aec5…ca55` (full value in R15), `cache-control: public, max-age=31536000,
    immutable`, no `set-cookie`; before setup the same;
  - `HEAD` of it → `200`, `content-length: 12840`, empty body;
  - `GET …?v=2` → `200`, the same bytes (the query is ignored, as on every route);
  - `POST` → `405`, `allow: GET, HEAD`;
  - each of these → `404` and the `other` label: `/fonts/`,
    `/fonts/space-grotesk-latin-300-normal.woff2` (a weight that is not shipped),
    `/fonts/Space-Grotesk-latin-400-normal.woff2` (case),
    `/fonts/space-grotesk-latin-400-normal.woff2/` (trailing slash),
    `//fonts/space-grotesk-latin-400-normal.woff2`, `/fonts/%2e%2e/package.json`,
    `/fonts/../src/server.ts`, `/fonts/OFL-space-grotesk.txt` (license texts are not served),
    `/assets/fonts/space-grotesk-latin-400-normal.woff2` (the directory is not a route);
  - a wrong implementation that serves `/fonts/<anything>` by joining the name into a path is
    caught by the `%2e%2e` and `..` cases; one that keeps `no-store` is caught by the cache
    header assertion; one that answers `application/octet-stream` is caught by the
    content-type assertion (`nosniff` makes the type matter).
- **Font bytes.** A served file whose SHA-256 differs from the R15 literal fails, for example
  the variable `space-grotesk-latin-wght-normal.woff2` (22288 bytes) or a latin-ext file under
  the latin name. `loadFonts` with a fake `readFile` that throws for one name must throw the
  named error, not return six fonts.
- **`@font-face`.** A rule with `font-display: block` or `auto`, a `src` with a second `woff`
  URL, a `url(` to anything but the seven `/fonts/…` paths, a `font-weight: 300 700` range, or
  an eighth rule fails the CSS text test.
- **Title font.** A page whose `h1` computed `font-family` starts with `"Space Grotesk"` but
  renders in a fallback (font blocked by the CSP, 404, wrong MIME) fails: the check asks
  Chromium for the platform font actually used (`CSS.getPlatformFontsForNode`), not only the
  declared stack. `document.fonts.check()` alone is not enough, because it also answers `true`
  when no face matches.
- **Visited rules.** A `:visited` rule not listed in R3 fails check 9, for example
  `a.button:visited { color: var(--accent-text) }` (it would give a link button link text), a
  `.nav-item:visited` with `var(--accent-text)`, or an `a:visited` rule inside the dark
  `@media` block. A missing listed rule fails too.
- **Mobile nav focus.** At 390 px, `outline-offset: -2px` on a nav item fails (the issue asks
  for 3 px on every control). So does a 3 px offset on a row without the 6 px padding: the
  outline rectangle (item box grown by 5 px) leaves the row's padding box and is clipped.

## Contract fields

No wire field, JSON key, environment variable or setting is added. The new names are console
routes and one `/metrics` label value:

| Name | Kind |
|---|---|
| `/fonts/space-grotesk-latin-{400,500,600,700}-normal.woff2` | 4 console routes |
| `/fonts/jetbrains-mono-latin-{400,500,600}-normal.woff2` | 3 console routes |
| `/fonts/:file` | value of the `path` label of `pulse_console_http_requests_total` |
| `font-src` | CSP directive in the console response header |

Searches, run from the meta checkout for this revision, each with no match:

- `grep -rn '/fonts' .repos/contract/src` and
  `grep -rn --exclude-dir=node_modules --exclude-dir=.git '/fonts' .repos/config`: no match.
- `grep -rn 'woff2\|font-src\|fonts/:file' .repos/contract/src` and the same over
  `.repos/config` (excluding `node_modules` and `.git`): no match.
- Inside the console, so no existing route, test route or link prefix collides:
  `grep -rn '/fonts\|woff2\|font-src' .repos/console/src .repos/console/test
  .repos/console/e2e`: no match. The link prefixes are `/invite/` and `/reset/`
  (`src/account-links.ts`), and test routes must start with `/__test/` (`src/server.ts`
  line 115), so `/fonts/` overlaps neither.
- `grep -rln '/fonts' .repos/deploy`: no match.

New CSS class names and the internal TypeScript names (`callout`, `CalloutKind`, `tone`, the
`ghost` and `danger` variants, `nav-item`, `src/icons.ts`, `src/fonts.ts`, `loadFonts`) live only
inside the console. The contract and config clones carry no such names:
`grep -rln 'callout\|CalloutKind\|check-state\|table-scroll\|nav-item\|loadFonts'
.repos/contract/src .repos/config` finds no file outside `node_modules`.

## Repository: console

Files:

- `src/styles.ts` — rewrite: tokens, dark scheme, typography, the seven `@font-face` rules (R15), the R3–R14 component classes.
- `src/html.ts` — `submitButton` variants, `plainDocument` layout, `formErrorSummary` as an error
  callout.
- `src/html.test.ts` — variants, byte-identical primary and secondary, plain layout markup.
- `src/icons.ts` (new) — the callout and nav SVG strings.
- `src/shell.ts`, `src/shell.test.ts` — sidebar shell, groups, initials, breadcrumbs.
- `src/navigation.ts`, `src/navigation.test.ts` — the main and instance group split.
- `src/states.ts`, `src/states.test.ts` — `callout`, optional empty-state action, 403 and 404.
- `src/confirm.ts`, `src/confirm.test.ts` — the panel markup and `tone`.
- `src/pages.ts` — setup, owner and sign-in classes and callouts.
- `src/account-pages.ts` — callouts, account confirmation panels, sessions table box.
- `src/team-pages.ts` — tags, table boxes, confirmation tones, role form panel, callouts.
- `src/team-routes.ts` — the callout for `SAVE_FAILED` and the error at line 353.
- `src/overview.ts`, `src/overview.test.ts` — callouts, mono counts with state dots.
- `src/check-pages.ts` — table box and hint, state and tag markup, empty states, callouts.
- `src/check-detail-pages.ts` — panels, `dl.settings`, table boxes, state markup.
- `src/check-editor-page.ts`, `src/check-editor-page.test.ts` — choice rows, type-choice list.
- `src/check-routes.ts` — the callouts of the saved, deleted, expired, conflict and `Not saved`
  notices.
- `src/server.ts` — the callout for `formExpiredNotice` and `formExpiredResendNotice` at lines
  692 and 976; the new CSP string (lines 95–96); the seven font entries in `ROUTES`, their GET
  and HEAD handling in `handleGet`, and their `pathLabel` case (R15).
- `src/fonts.ts` (new) — the constant font list and `loadFonts(readFile)` (R15).
- `src/fonts.test.ts` (new) — `loadFonts` with a fake `readFile`: seven routes, the named error
  for a missing file.
- `src/http-context.ts` — a byte body and a caller-supplied `cache-control` for `send` (R15).
- `src/metrics.ts` — the `"/fonts/:file"` member of `PathLabel`.
- `assets/fonts/` (new) — the seven `.woff2` files and `OFL-space-grotesk.txt`,
  `OFL-jetbrains-mono.txt` of R15, byte for byte.
- `Dockerfile` — `COPY assets ./assets` after line 12.
- `.github/workflows/ci.yml` — one new step in the `docker` job after "Check the test routes are
  absent and the script is served" (lines 81–94); see Checks.
- `src/server.fonts.test.ts` (new) — the font routes over HTTP, every case of the "Font routes"
  counterexample.
- Tests with the CSP literal (Risks), each set to the new literal written out:
  `src/server.test.ts` (lines 21, 362), `src/server.security.test.ts` (lines 43, 574),
  `src/server.states.test.ts` (line 19), `src/server.team.test.ts` (line 19),
  `src/server.invite.test.ts` (line 26), `src/server.account-shell.test.ts` (line 14).
- `src/server.test.ts` also: replace the `#1b4f9c` and `form + form` assertions of the
  `/console.css` test (lines 148–158) with the CSS checks below, and add the
  `path="/fonts/:file"` line to the metrics test near line 345.
- Tests that assert markup this feature changes. Each keeps its behavior assertions and
  changes only the class names, element names or wrappers it pins: `src/check-editor-page.test.ts`,
  `src/confirm.test.ts`, `src/html.test.ts`, `src/overview.test.ts`, `src/shell.test.ts`,
  `src/states.test.ts`, `src/navigation.test.ts`, `src/server.account-shell.test.ts`,
  `src/server.checks.test.ts`, `src/server.checks-change.test.ts`,
  `src/server.checks-write.test.ts`, `src/server.confirm.test.ts`,
  `src/server.form-token.test.ts`, `src/server.overview.test.ts`, `src/server.races.test.ts`,
  `src/server.roles.test.ts`, `src/server.security.test.ts`, `src/server.setup.test.ts`,
  `src/server.states.test.ts`, `src/server.team.test.ts`. These are the test files that today
  match `class=`, `<h2`, `state-`, `notice`, `secondary`, `Access denied`, `table-`, `<header`,
  `aria-label` or `role=`. A file of this list that needs no edit stays as it is; a test file
  outside it is edited only when `bun test` shows that it pins changed markup, and the PR names
  it.
- `test/fixture-routes.ts` — call `plainConfirmPage` with `tone`; add a fixture route for a
  check state and tag sampler only if the real pages cannot show every kind (prefer real pages).
- `e2e/run.ts` — the light and dark design matrix (checks below), with the old link, visited and
  Tab-order checks replaced, and the font checks.
- `README.md` (lines 14, 129–130, 140), `docs/configuration.md` (lines 111, 175, 201, 206),
  `docs/development.md` (lines 22–23, 60, 79 and a fonts paragraph), `AGENTS.md` (the CSP
  sentence at lines 112–115, and `src/server.fonts.test.ts` in the list of server tests): describe
  the sidebar shell, tokens and color scheme, the `icons.ts` and `fonts.ts` modules, the font
  routes and their license, and the new CSP.

Behavior change: yes. Every page changes its markup and look, and seven font routes and `font-src 'self'` are new.

### Tool facts (verified)

- Runtime Bun 1.4.0: `package.json` lines 8–10 (`engines`) and `packageManager`. CI uses
  `bun-version: 1.4.0`: `.github/workflows/ci.yml` line 281, and the pinned
  `pulse-config/.github/workflows/check.yml` line 24 at `04108fa`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test`: `package.json` line 18.
  - lint is `biome check . && pulse-eslint . && pulse-workflows` (line 15);
  - typecheck runs `tsc --noEmit` for the root and `-p e2e` (line 13), with `typescript7` =
    `typescript@7.0.2` (line 29).
- CI job `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
  (`ci.yml` line 18). The steps at that pin are lint (line 28), typecheck (line 30) and test
  (line 38). The pinned file is identical to the config clone (`diff` showed no difference).
- `bun run check:browser` = `bun e2e/run.ts` (`package.json` line 19). CI job `browser` installs
  Chromium with `bunx playwright install --with-deps chromium` (`ci.yml` line 285) and runs it
  (line 287). Playwright 1.64.1 and `@axe-core/playwright` 4.14.0 come from `package.json` lines
  28 and 22.
- Biome 2.6.3 (`package.json` line 23). `biome.json` only `extends`
  `@lorenzh/pulse-config/biome.json`. At pin `04108fa` that file includes `**` and ignores only
  `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures` (lines 10–17), with
  `ignoreUnknown: true` (line 9). It is identical to the config clone. The CSS lives in a TS
  template string, so Biome checks it only as TypeScript.
- `bunfig.toml` `[test]`: coverage on, line threshold 0.8 (lines 1–3). Keep the
  `functions = 0` value and never lower the threshold.
- axe tags `["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]`: `e2e/run.ts` line 44.
  Keep them and do not disable `color-contrast` or any other rule.

### Behavior

Implement R1–R15 above. Points that are easy to miss:

1. Keep the `<script>` element only in the shell head (`html.ts` `documentHead` with
   `hasScript`). `CONSOLE_JS` stays byte-identical.
2. Keep every text the deploy e2e greps: `Signed in as`, `This browser`, `Checks: <n>.`,
   `Already submitted`. Keep the hidden input markup of `csrfField` and `formTokenField`
   byte-identical.
3. Keep the instance name `pulse Console` (`plainDocument` passes it; the shell gets it from
   `ShellView.instanceName`).
4. Keep the checks list filters (`q`, type, state, source, `Filter`, `Reset filters`), the export
   links and the export download unchanged. The export stays a download, not an HTML page.
5. Keep the settings `dt` texts word for word (#773 owns their wording).
6. The R6 scroll hint is new text. Apart from it, the presentation additions are the wordmark,
   `self-hosted`, `Instance`, the breadcrumbs and the 403 `Go to the overview` link. No other new
   visible text.
7. The Tab order after the change: `Skip to content`, then the nav entries, then `Account
   security`, then `Sign out`, then the breadcrumb link (when present), then the content. The
   e2e Tab test states this order.
8. The busy-button behavior and the no-JavaScript paths keep their tests: the plain and typed
   confirmations by Tab and Enter, the account confirmations, and the copy fallback in `<pre>`.
9. Fonts (R15): the committed bytes are the tarball bytes; no subsetting, renaming of the
   family, `package.json` entry or lockfile change. The routes are fixed entries, not a prefix
   handler. Every response other than a font keeps `cache-control: no-store`.

### Checks

Unit tests (`bun test`, part of `bun run check`). Every expected value is a literal written in the
test.

- `html.test.ts`:
  - `submitButton` output for primary and secondary equals the pre-change literal strings;
  - `ghost` and `danger` render `class="ghost"` and `class="danger"`;
  - `plainDocument` renders `class="plain-panel"` with one `h1` and no `<script`.
- `shell.test.ts`:
  - the initials cases from Counterexamples;
  - a viewer shell has no `Instance` text, and an admin shell has `Instance` before `Team`;
  - `aria-current="page"` stays on the current entry;
  - the breadcrumb for `current: "checks"` with title `Edit check` has a link `/checks` and a
    current item `Edit check`;
  - a hostile user name is escaped in the name and the initials;
  - `Signed in as` is present, and the sign-out form keeps `csrf` and then `form_token`.
- `states.test.ts`:
  - `forbiddenState` has no `<h2`, has `callout-warning`, the role sentence, and
    `href="/"` with `Go to the overview`;
  - `notFoundState` has `callout-neutral`;
  - `apiUnavailableState` has `callout-error` and `role="alert"`;
  - `staleState` has `callout-warning`;
  - `emptyState` without an action renders no link.
- `confirm.test.ts`:
  - typed has `confirm-danger` and `class="danger"`;
  - plain safe has `confirm-safe` and no `danger`;
  - Cancel comes before the submit and has `class="button ghost cancel"`;
  - hidden field order is `csrf`, `form_token`, `revision`, then the extras.
- Team page tests: `Revoke invite`, `Remove`, `Make owner` and `Reset 2FA` render
  `class="danger"`, and `Make reset link` and `Change role` do not. The members table sits in a
  `.table-scroll` with `tabindex="0"` and an aria-label.
- `check-editor-page.test.ts`: each radio is inside `<label class="choice">` and comes before its
  text.
- `server.test.ts` for `/console.css`:
  - status 200 and `text/css`;
  - the body contains `color-scheme: light dark`, `@media (prefers-color-scheme: dark)`,
    `--bg: #f2eeec`, `--bg: #271b32`, `--error: #a4262c`, `--error: #f2a7ab`, `--touch: 44px`
    and `[hidden]`;
  - the body contains exactly 7 `@font-face`, exactly 7 `font-display: swap` and exactly 7
    `url(`; each of the seven literal strings `url("/fonts/<name>") format("woff2")` of R15
    occurs once, written out in the test;
  - the body contains `--font-sans: "Space Grotesk", system-ui, -apple-system, "Segoe UI",
    sans-serif` and `--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo,
    Consolas, monospace`;
  - the body does not contain `@import`, `data:`, `local(`, `1b4f9c`, `overflow-x: hidden` or
    `outline-offset: -`;
  - `Buffer.byteLength(body) <= 49152` (the bound of Performance impact).
- A test over every renderer used in the e2e matrix asserts that the output has no `style="` and
  no `<style`.
- CSP: the eight test literals listed under Files equal the R15 string written out, and
  `src/server.security.test.ts` keeps asserting the exact header on a page, on `/console.css` and
  now on one font route.
- `src/fonts.test.ts`: `loadFonts` with a fake `readFile` returns the seven route paths written
  out in the test (and no other); a fake that throws for
  `jetbrains-mono-latin-600-normal.woff2` makes `loadFonts` throw the named error.
- `src/server.fonts.test.ts` (real server on port 0, before and after setup): every case of the
  "Font routes" counterexample. For each of the seven routes, the SHA-256 of the body and its
  length equal the R15 literals written in the test (the independent source is the npm tarball,
  not the committed file). The metrics text after one font GET contains
  `pulse_console_http_requests_total{path="/fonts/:file",code="200"} 1`.

CI (`.github/workflows/ci.yml`, job `docker`, new step after lines 81–94, named "Check the fonts
are served from the image"): `curl` of `/fonts/space-grotesk-latin-700-normal.woff2` and
`/fonts/jetbrains-mono-latin-400-normal.woff2` from the running container; each must answer
`200 font/woff2` (`%{http_code} %{content_type}`), and `sha256sum` of the bodies must equal the
literals `35f8aec56cfd5cbfdb03cc68733a54a0b05bb3617ffcd5fd332badc0b045ca55` and
`14425ba9c695763c1547f48a206b7aa60350a33ae23de09f0407877f3fcd89eb` written in the step; and
`docker exec console test -f /app/assets/fonts/OFL-space-grotesk.txt -a -f
/app/assets/fonts/OFL-jetbrains-mono.txt`. The step prints `ok:` lines like its neighbours.
`docs/development.md` adds it to the numbered list.

Browser checks (`bun run check:browser`, `e2e/run.ts`). Run the matrix in two contexts,
`colorScheme: "light"` and `colorScheme: "dark"` (Playwright `browser.newContext({ colorScheme
})`), each at 1280 × 800 and 390 × 844.

The pages are:

- overview `/`;
- checks list `/checks` with a fixture of more than 8 checks, one with a 120-character URL and one
  with a 300-character name;
- the HTTP edit form `/checks/edit?id=…`;
- sign-in `/sign-in`;
- the typed delete confirmation `/checks/delete?id=…`.

For each page and scheme, the browser checks assert:

1. **Computed colors.** These come from `getComputedStyle` and are compared with literals.
   - Primary button (sign-in `Sign in`, edit `Save check`): `background-color` and `color` are
     `rgb(39, 27, 50)` / `rgb(242, 238, 236)` in light and `rgb(223, 215, 212)` /
     `rgb(39, 27, 50)` in dark.
   - Danger button (`Delete check` on the confirmation): `background-color`, `border-top-color`
     and `color` are `rgb(164, 38, 44)` / `rgb(164, 38, 44)` / `rgb(242, 238, 236)` in light and
     `rgb(242, 167, 171)` / `rgb(242, 167, 171)` / `rgb(39, 27, 50)` in dark.
   - Input (sign-in `Email`, edit `Name`, the confirmation name field): `background-color`,
     `border-top-color` and `color` are `rgb(250, 248, 247)` / `rgb(147, 132, 126)` /
     `rgb(39, 27, 50)` in light and `rgb(31, 21, 41)` / `rgb(118, 104, 119)` /
     `rgb(223, 215, 212)` in dark.
   - Read the base colors with the mouse away from the control and nothing focused. Then focus
     the input and assert `outline-color` `rgb(138, 79, 159)` light or `rgb(194, 155, 211)` dark,
     with `outline-width` `2px` and `outline-offset` `3px`.
   - On the overview, which has no primary submit or input, assert the body `background-color`
     `rgb(242, 238, 236)` light or `rgb(39, 27, 50)` dark, and that the current nav item has fill
     `rgb(230, 219, 227)` light or `rgb(61, 45, 72)` dark.
   - Do not inject controls into a page that has none.
2. **axe.** `new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()` reports zero violations,
   with no rule disabled. That covers `color-contrast` and `scrollable-region-focusable`. Keep
   the existing axe coverage of 403, 404, team, account routes, both confirmations and the invite
   pages, now in both schemes.
3. **Radio on the edit form** (an HTTP check's radio group):
   - the input box is 18 × 18 ± 0.5 px;
   - `input.right <= text.left` and `text.left - input.right` is within 12 ± 1 px;
   - the vertical centers differ by ≤ 2 px;
   - the label row height is ≥ 44 px and its width is less than the fieldset width;
   - pressing Space or the arrow keys on a focused radio changes `checked`.
4. **No sideways scroll at 390 px.**
   - `documentElement.scrollWidth <= documentElement.clientWidth`;
   - the computed `overflow-x` of `html` and `body` is `visible`.
   On `/checks`:
   - the `.table-scroll` has `tabindex="0"` and the accessible name `Checks table`, and the hint
     text is visible;
   - after `focus()` and five `ArrowRight` presses, `scrollLeft > 0`;
   - after `End` or enough `ArrowRight` presses, the `Actions` header is inside the box's visible
     rectangle;
   - the focused box shows a 2 px outline.
   On the overview, the mobile nav row's `scrollWidth` may exceed its own width, but `Account
   security` and `Sign out` are visible inside the viewport.
   Mobile nav focus (R9), at 390 px, for each visible nav item reached by Tab:
   - computed `outline-style` `solid`, `outline-width` `2px`, `outline-offset` `3px`;
   - the item's border box grown by 5 px on every side lies inside the scrolling row's padding
     box (the row's `getBoundingClientRect()` minus its border widths), with a tolerance of
     0.5 px. This proves the outline is not clipped.
5. **Shell geometry at 1280 px.** The sidebar width is 236 ± 1 px and the top bar height ≥ 64 px.
   At 720 px the sidebar is a column. At 719 px its width equals the viewport width. At 390 px
   the computed `main` padding is `20px 16px 40px`.
6. **Breakpoint boundaries** on the check detail page, whose `dl.settings` is the one shared grid
   on `main` today: two columns at 901 px, one at 900 px. `.grid-4` has no real page yet, so it
   is checked by a unit test of the CSS text for `@media (max-width: 1180px)` and
   `@media (max-width: 900px)`.
7. **403.** A member at `/team` gets status 403 and exactly one visible heading containing
   `Access denied`. The warning callout has `background-color` `rgb(244, 229, 200)` light or
   `rgb(61, 48, 32)` dark. Clicking `Go to the overview` reaches `/`. Unknown `/does-not-exist`:
   status 404, one `h1` `Page not found`, neutral callout.
8. **Confirmations.** Every submit of the delete, revoke, remove, transfer, reset-2FA and
   sign-out-all pages has `background-color` `--error` (literals above). The new-recovery-codes
   page and the plain fixture `resolve-incident` have primary colors. Without JavaScript, both
   confirmation kinds still submit by Tab and Enter (the existing checks stay).
9. **Links.** Computed colors, compared with literals:
   - an ordinary body link (`Sessions` on `/account/security`): `color` `rgb(122, 66, 144)`
     light or `rgb(194, 155, 211)` dark;
   - the confirmation Cancel (`a.button.ghost`): `rgb(39, 27, 50)` light or `rgb(223, 215, 212)`
     dark (`--text`), not the link color;
   - a non-current nav item (`Checks` on the overview): `rgb(74, 63, 82)` light or
     `rgb(201, 191, 196)` dark (`--lead`); the current one: `--text` as above;
   - focus outline as in 1.
   The visited check replaces `visitedRules` (lines 412–429). It reads every top-level
   `CSSStyleRule` of the console stylesheet, splits each `selectorText` at commas and keeps the
   parts that contain `:visited`. The test holds the nine-row table of R3 as a literal map from
   selector part to `style.color` string (for example `"a:visited" → "var(--accent-text)"`,
   `"a.button.danger:visited" → "var(--bg)"`). It fails when a part is not in the map, when a
   rule's `style.color` differs from the map value of its part, or when a map entry has no rule.
   It also fails when any `CSSMediaRule` holds a rule whose selector contains `:visited`. The
   expected map is written in the test from R3, never read from `CONSOLE_CSS`. The `ok:` lines
   name the ordinary-link color and the number of listed button, callout, nav and breadcrumb
   rules.
10. **No CSP violation, no other origin, fonts only from the seven routes**, in either scheme.
    The existing `watchCsp` and `watchPageCsp` stay. A `page.on("request")` listener fails on a
    request to another origin, and on a font request (`resourceType() === "font"`) whose path is
    not one of the seven R15 paths written in the test. On a cold context (new context, empty
    cache), the load of `/` after sign-in makes at most 10 requests to the console after the
    document navigation starts, and its font responses sum to at most 117684 bytes; the check
    prints both numbers (`ok: cold / made <n> requests, <m> font bytes`) for the Performance
    table.
11. **Hostile and long data.** A check named `<img src=x onerror=alert(1)>` renders as text in
    the list, breadcrumb and confirmation. No dialog opens and no element is created. A
    70-character email and a 300-character check name fit at 390 px.
12. **Fonts load and are used**, in both schemes, on the overview, sign-in and the typed
    confirmation (sign-in covers the plain document, before a session):
    - every font response seen by the page has status `200` and `content-type: font/woff2`;
      on the overview, at least the responses for
      `/fonts/space-grotesk-latin-700-normal.woff2` (page title) and
      `/fonts/jetbrains-mono-latin-600-normal.woff2` (wordmark) are seen;
    - after `await document.fonts.ready`, `document.fonts` holds a `FontFace` with family
      `Space Grotesk`, weight `700` and `status` `"loaded"`;
    - the computed `font-family` of the page `h1` starts with `"Space Grotesk"`;
    - through a Chromium CDP session (`page.context().newCDPSession(page)`, `DOM.getDocument`,
      `DOM.querySelector` for `h1`, `CSS.enable`, `CSS.getPlatformFontsForNode`), the fonts used
      for the `h1` text include one with `familyName` `Space Grotesk` and `isCustomFont` `true`,
      and it covers all glyphs of the title (`glyphCount` equal to the sum over the list);
    - the same CDP check on a `.mono` element (a check id or count) gives `JetBrains Mono`.
    Geometry checks (3, 4, 5, 6) run after `document.fonts.ready`, so the font swap cannot move
    a measured box after it was read.

Manual smoke: run `bun e2e/run.ts --serve` and open overview, checks, edit, sign-in, team and a
confirmation in Chromium with the OS or devtools scheme set to light and to dark. Then run
`PULSE_API_URL=http://localhost:3000 bun start` once, as `AGENTS.md` requires. Report the
commands and the result in the PR.

### Completion evidence

- `bun run check` and `bun run check:browser` pass locally. CI jobs `check`, `docker`,
  `deploy-dev` and `browser` are green.
- The PR lists the matrix output lines (`ok: …`) for both schemes and both widths.
- The PR names each #773 item it fixes (radios, mobile table, danger, 403) and the items left
  to #773.
- The PR says whether #768 (console PR #14) was on `main` at the start. This is the shared
  finding named in Risks.
- The PR shows `sha256sum assets/fonts/*` and states that it equals the R15 table, names the
  two tarballs and their `dist.integrity`, and shows the green docker step "Check the fonts are
  served from the image".
- The PR fills the console-cost table of Performance impact with measured values for the base
  ref and the PR head.
