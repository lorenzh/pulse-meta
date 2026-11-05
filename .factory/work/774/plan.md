# Spec #774: console — apply the pulse design to the shared stylesheet and the built screens

## Goal

The console works but still looks like a plain form app: one stylesheet with `system-ui`, a blue
`#1b4f9c` button, 4 px radii, a top header and a link row as navigation
(`.repos/console/src/styles.ts` lines 4–60). This feature puts the visual language of the owner's
"pulse Console" boards into that one stylesheet as CSS custom properties and component classes. It
moves every screen that is on console `main` onto those classes. It also fixes the four shared
#773 defects: radios next to their labels, the mobile checks table, danger delete buttons, and the
403 page.

The result is a presentation change. Routes, statuses, roles, CSRF, form tokens, cookies, stored
data, CSP, texts and status meanings stay as they are. #460 and the #718 amendment win over a
board. This spec builds on #718 (shell, states, confirmations, closed): it restyles those parts
and does not rebuild them.

Inputs read for this spec:

- Issue #774 and its one comment (the issue-review result). The review artifact
  `.factory/work/774/issue-review.md` gives open points 1–11 and a derived acceptance check. This
  spec adopts them; where it decides an open point, the decision is named below.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/774` answered
  `HTTP 404`, so this feature has no findings yet.
- Console clone at `c78c9d5` (`.repos/console`, merge of PR #12, "console check screens").
  The source files read are named in the repository section. Deploy
  `.repos/deploy/e2e/console-setup.sh` lines 273, 308, 327 and 417 grep the page texts `Signed in
  as` and `This browser`. Line 140 greps `Checks: <n>.`. This spec keeps those texts.
- Console PR lorenzh/pulse-console#14 (#768, tokens and probe locations screens) is open and
  mergeable. It changes `src/navigation.ts`, `src/styles.ts` (+1 line), `src/shell-line.ts` and
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
- No new route (not even a session-expired route), no setting, no stored value, no new package,
  no CSS framework, no build step, no web font, no CSP change.
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
  - no `@import`, `@font-face` or `url(` to a non-`data:` address;
  - a `data:` image is allowed by `img-src 'self' data:`, but this spec draws every glyph without
    one (see R4 and R12).
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
- Link color rules (`a`, `a:visited`) never override button text. Use `a.button, a.button:visited`
  with the variant's text color.
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
- The offset is 3 px everywhere except one place: the nav items in the horizontally scrolling
  mobile nav row (≤719 px) use `outline-offset: -2px`, because their box would clip an outer
  outline. The `.table-scroll` box keeps 3 px.
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
- Nav items:
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
  - `e2e/run.ts:47` `LINK_COLOUR`, the `visitedRules` CSSOM check (lines 413–429), and the Tab
    order "Skip to content, Account security, Sign out, Overview" (line 543).
  They are replaced by token-based expectations. Their behavior coverage must not be dropped:
  link color, visited color, focus outline, skip-first and reachability.
- **Deploy e2e.** `console-setup.sh` greps `Signed in as`, `This browser`, `Checks: <n>.` and
  `Already submitted`, and extracts the `csrf` and `form_token` inputs. All of them stay, so
  deploy needs no change. The CI job `deploy-dev` (console `ci.yml` lines 210–269) proves it.
- **`:has()`** is used only for the option card's checked look, which is enhancement only.
  Chromium of Playwright 1.64.1 supports it.
- **Sticky sidebar and scroll shadows** are CSS only. Where a browser lacks them, the content
  stays usable.

## Performance impact

None expected for `bench/budgets.json` of the api repository (startup CPU, load CPU, idle and
peak RSS, test CPU, build CPU, wall-clock startup, p95 latency, requests per second, image
size). Only the console changes: a larger constant CSS string and slightly larger HTML. The api
bench does not build, start or measure the console. The console's own test CPU can rise by a few
seconds of extra browser checks, which are not part of `bun run check`.

## Security impact

Security impact: yes. The change rewrites the HTML of the authentication pages (setup, sign-in,
factor, invite, reset) and of the admin team routes. It moves the sign-out POST form and the
confirmation forms, and it renders user-controlled names in new places (initials, breadcrumbs,
tags).

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
- **CSP.** The header stays byte-identical: `default-src 'none'; script-src 'self'; style-src
  'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`.
  There is no `style` attribute, no inline script, no external request and no font request.
- Not applicable: body and size limits, accessor execution, SSRF and redirects, file writes,
  dependency pins (no package change), Dockerfiles, CI files.

## Rollout order

One repository: only `console` changes. No wire field, contract or config pin, api route or
deploy file changes. A console built from this change runs against the same pulse-api, so no
older consumer is affected. Deploy `main` keeps working because the texts and form fields it
greps are unchanged; the console CI job `deploy-dev` checks this.

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
  header string equals the literal above.

## Contract fields

No new names. The change adds no wire field, JSON key, environment variable, setting, route or
`/metrics` label. New CSS class names and the internal TypeScript names (`callout`,
`CalloutKind`, `tone`, the `ghost` and `danger` variants, `src/icons.ts`) live only inside the
console. The contract and config clones carry no CSS or console renderer names, which this search
confirms:
`grep -rln 'callout\|CalloutKind\|check-state\|table-scroll' .repos/contract/src .repos/config`
finds no file.

## Repository: console

Files:

- `src/styles.ts` — rewrite: tokens, dark scheme, typography, the R3–R14 component classes.
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
  692 and 976; no route or header change.
- `src/server.test.ts` — replace the `#1b4f9c` assertion at line 156 with token assertions.
- The other `src/*.test.ts` and `src/server.*.test.ts` that assert changed class names or markup.
  Behavior assertions stay.
- `test/fixture-routes.ts` — call `plainConfirmPage` with `tone`; add a fixture route for a
  check state and tag sampler only if the real pages cannot show every kind (prefer real pages).
- `e2e/run.ts` — the light and dark design matrix (checks below), with the old link, visited and
  Tab-order checks replaced.
- `docs/configuration.md` (line 175 and the shell description), `docs/development.md` (line 23):
  describe the sidebar shell, tokens and color scheme, and the `icons.ts` module. No new endpoint.

Behavior change: yes. Every rendered page changes its markup and look, and the 403 page changes
its visible text structure.

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

Implement R1–R14 above. Points that are easy to miss:

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
  - the body does not contain `@font-face`, `@import`, `1b4f9c` or `overflow-x: hidden`.
- A test over every renderer used in the e2e matrix asserts that the output has no `style="` and
  no `<style`. Existing security tests keep asserting the exact CSP header.

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
9. **Links.** A body link (`Sessions` on `/account/security`) has `color` `rgb(122, 66, 144)`
   light or `rgb(194, 155, 211)` dark. A CSSOM check finds an `a:visited` rule whose `color` is
   `var(--accent-text)`, and no `:visited` rule with another color. Focus outline as in 1.
10. **No CSP violation and no request** to another origin or for a font, in either scheme. The
    existing `watchCsp` and `watchPageCsp` stay.
11. **Hostile and long data.** A check named `<img src=x onerror=alert(1)>` renders as text in
    the list, breadcrumb and confirmation. No dialog opens and no element is created. A
    70-character email and a 300-character check name fit at 390 px.

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
