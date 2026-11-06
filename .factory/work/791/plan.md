# Spec #791: console: document the layout polish in README.md and docs/configuration.md

## Goal

Console PR #18 (issue #780, child #784) changed the Overview, the Checks table, forms, the
sidebar and the mobile navigation. It did not update `README.md` or `docs/configuration.md`,
which the console `AGENTS.md` (section "Documentation") requires when behavior changes. This
spec brings both files up to date with what console `main` does now. It is a documentation
follow-up only. #780 and #784 are done, and their code is on `main`. Do not redo or change it.

Source: console `main` at `fc2c166de8237a841b5253cef99bb3fd17f85f2f` (the merge of PR #18).
`origin/main` was the same commit when this spec was written. If `main` has moved when the
child starts, re-read the files named below before you write.

## Scope

- Console `README.md`: a short description of the Overview tiles and of the mobile navigation.
- Console `docs/configuration.md`: the screen, column, preset, form and shell-layout facts listed
  under "Required behavior", at operator level, with links to the existing `docs/checks.md`,
  `docs/tokens.md` and `docs/team.md` where they already hold the detail.

## Non-goals

- No change to code, tests, styles, dependencies, the lockfile, the CSP, routes, roles, settings,
  `AGENTS.md`, or any other doc (`docs/checks.md`, `docs/tokens.md`, `docs/team.md`,
  `docs/index.md`, `docs/development.md`).
- No cleanup of unrelated stale text in either file.
- No new tests, fixtures or browser checks. Old baseline questions from #784 (for example the
  owner decision on old-source overflow) stay settled.
- No Factory artifacts or notes in the console repository.

## Required behavior

Everything below was checked in the console clone at the commit named above. The docs describe
this behavior and nothing beyond it. If the running console differs from this list, the
implementer requests a hold and names the difference. It does not change code, and it does not
document the spec text instead of what the console does.

### Overview (README.md and docs/configuration.md)

`src/overview.ts:46-53` (`COUNT_ROWS`) and `:64-74`: on a successful read with at least one active check, the
Overview shows the overall-state sentence and then six linked tiles, in this order:

| Tile        | Link                          |
| ----------- | ----------------------------- |
| Down        | `/checks?state=down`          |
| Degraded    | `/checks?state=degraded`      |
| Unknown     | `/checks?state=unknown`       |
| Maintenance | `/checks?state=maintenance`   |
| Up          | `/checks?state=up`            |
| Total       | `/checks` (no filter)         |

- That is five state tiles plus Total, not six states. Each state tile carries the state dot;
  Total has none.
- A state tile with count `0` is still shown (`COUNT_ROWS` always renders all six).
- Counts: a state tile counts the entries of the `/checks` answer of pulse-api with that state;
  Total is the number of entries in that answer (`summarizeChecks`, `src/overview.ts:12-19`).
  They do not count shadowed definitions. The unfiltered Checks list can also show shadowed
  definitions, so its row count can be higher than Total. A state filter never matches a
  shadowed row (`src/check-filters.ts:84`).
- With zero checks the page shows `No checks yet` and a `Reload` link, with no tiles
  (`src/overview.ts:57-62`). No token, a rejected token and a failed read show no tiles either
  (`src/overview.ts:83-93`).
- Layout: the tiles fill a responsive grid (`.state-tiles`, `src/styles.ts:170`,
  `repeat(auto-fit, minmax(9rem, 1fr))`). The docs may say that it fits all six in one row at
  1280 px and two per row at 390 px (the widths that `e2e/run.ts` checks). They must not promise
  a fixed column count at every width.

The configuration paragraph at `docs/configuration.md:131` already says "the count per check
state". Make it name the six tiles and their links (or point to the README), plus the
zero-check and failure exceptions.

### Navigation and account row (README.md short, docs/configuration.md detail)

From `src/shell.ts:40-51,102-103`, `src/navigation.ts` and `src/styles.ts:101-115,238-262`:

- Desktop: a left sidebar. Its border runs the full page height. Its navigation and account part
  stays in place (sticky) and scrolls on its own.
- At a viewport width of 719 px or less (`@media (max-width: 719px)`, `src/styles.ts:238`): a
  full-width header at the top. The navigation is one horizontal row that scrolls sideways, with
  an icon beside each label. A focused link scrolls into view. Edge chevrons show that more items
  are off screen, in browsers with scroll-driven animations. Elsewhere, static edge shadows do
  that job. The chevrons and shadows are hints, not buttons. The "Instance" group heading is
  hidden visually but stays for screen readers.
- Entries: Overview and Checks for every role; Tokens, Probes and Team also for Admin and Owner
  (`src/navigation.ts:24-45`, `visibleNavigation`). Entries marked unavailable (Incidents,
  Maintenance, Activity, System) are not shown. Navigation visibility is not authorization; the
  role check of each route stays as described in `docs/team.md`.
- Mobile account row (at 719 px or less): no avatar, and the `Signed in as` prefix is hidden
  visually but stays in the markup. Name and e-mail stay on one line and end in an ellipsis when
  they are too long. Role, `Account security` and `Sign out` stay visible.
- `docs/configuration.md:185` says the header e-mail "moves to the next line whole and wraps
  inside only when it is wider than the line". Keep that for desktop and add the mobile
  exception (one line, ellipsis). Do not change the link-color sentence that follows.

### Checks table (docs/configuration.md)

`src/check-pages.ts:165-190`: four columns, in this order:

| Column  | Contents                                                                           |
| ------- | ---------------------------------------------------------------------------------- |
| Check   | Name; below it the id and the source tag `checks.json (read-only)` or `Console`     |
| Target  | Type, then the target                                                              |
| State   | State and the time of the last result; a shadowed row shows its shadowed state, without a time |
| Actions | The actions that the role and the check source allow                               |

- The table sits in a focusable, named region (`role="region"`, `aria-label="Checks table"`).
  When the space is narrower than the table, it scrolls sideways inside that region. At 719 px
  or less the hint `Scroll sideways to see all columns.` is shown above it (`src/styles.ts:266`).
- A long target, name or id can be cut off with an ellipsis (`src/styles.ts:204,207`). The full
  value stays in the page markup and on the detail page. Do not promise that every value is
  fully visible or that every name fits on one line.
- The README sentence "shows the checks of pulse-api with their type, target, source, state and
  last result" stays true. It may add that these are grouped in the four columns.

### Other tables (docs/configuration.md, short)

- Tokens (`src/token-pages.ts:110`) and Probes (`src/probe-pages.ts:99`) keep their column
  headers. Their tables can also scroll sideways inside their box.
- Team People table (`src/team-pages.ts:198`): the `2FA` column says `On` or `Off`
  (`src/team-pages.ts:71`). A row without an available action shows a dash, which screen readers
  read as `No actions` (`src/team-pages.ts:55`).

### Token presets and forms (docs/configuration.md, short, link to docs/tokens.md)

From `src/token-view.ts:7-27` and `src/token-pages.ts:46-47,140-155`:

| Preset        | Card description                                             | Scopes sent                                |
| ------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Read          | `Reads the checks and their configuration. Changes nothing.` | `read`                                     |
| Manage checks | `Reads checks and creates, changes and deletes them.`        | `read`, `checks`, `admin`                  |
| Post incidents| `Reads checks and posts incidents.`                          | `read`, `incidents`, `admin`               |
| Full access   | `Reads and changes checks and posts incidents.`              | `read`, `checks`, `incidents`, `admin`     |

- The presets are radio cards. None is selected when the form first opens: `checked` is set only
  when the posted preset equals that card (`src/token-pages.ts:147`).
- One note above the cards: `Manage checks, Post incidents and Full access can also create,
  rotate and revoke tokens with the same or fewer scopes, and read the audit log.`
- A preset that needs a scope the console token lacks is disabled and shows
  `The console token lacks <scope>.`
- These are token access presets. They are not check presets and not console roles.
  `docs/tokens.md` ("Presets") already has the full table. `docs/configuration.md` may repeat it
  or link to it, but must not contradict it.
- Form widths (`src/styles.ts:74-77`): a text field, select or text area is at most 40rem wide; a
  short number or select field at most 12rem; a name or id field at most 24rem. On a narrow
  screen each field takes the available width. Copy buttons are not stretched to the full form
  width (`src/styles.ts:228`), and Copy still needs JavaScript (progressive enhancement). Each
  recovery code stays on one line (`src/styles.ts:226-227`). Describe these only as current
  presentation; do not invent fields, defaults or validation rules.

## Risks

- Overclaiming: "six tiles linking to the filtered Checks list" in the issue is loose; Total is
  unfiltered and the tiles are missing on an empty or failed Overview. The docs must say so.
- Copying stale text from older specs or from `docs/*.md` without checking `main`.
- Scope creep into other docs or into code to "match" the docs. Either one fails the acceptance
  check.
- Promising a column count or a fully visible value at every width, which the CSS does not
  guarantee.
- Publishing the fixture credentials of `bun e2e/run.ts --serve` in the PR. They must not appear
  anywhere.

## Performance impact

None expected. Only two Markdown files change. The console image copies only `package.json`,
`bun.lock`, `node_modules`, `src` and `assets` (console `Dockerfile` lines 4, 10-13), so the
image size stays the same. `bench/budgets.json` of the api repository has no console metrics,
and no api metric (startup CPU, load CPU, idle or peak RSS, test CPU, build CPU, wall-clock
startup, p95 latency, requests per second, image size) can move. No measurement is needed.

## Security impact

Security impact: no
Documentation only. No route, auth step, parser, header, file write, log text, dependency,
Dockerfile or CI file changes. The one rule that applies is the repository rule: no secrets or
fixture credentials in the docs or the PR.

## Rollout order

One repository: only `console` changes, and only its docs. No consumer reads these files at run
time, and nothing is released with them.

## Counterexamples

Every check below must reject the draft that does what is described.

- Tiles counted as states: "the Overview shows six check states". Reject: there are five states
  (`down`, `degraded`, `unknown`, `maintenance`, `up`) plus `Total`.
- Total link: Total said to link to `/checks?state=total` or to a filtered list. Reject: it links
  to `/checks`.
- Zero tile hidden: "only states with checks get a tile". Reject: an installation with 3 checks
  that are all `up` shows Down `0`, Degraded `0`, Unknown `0`, Maintenance `0`, Up `3`, Total `3`.
- Empty or failed read: "the Overview always shows the tiles". Reject: zero checks shows
  `No checks yet` and `Reload`; no token, a rejected token or a failed read shows no tiles.
- Total equals the Checks rows: reject. With 2 active checks and 1 shadowed definition, Total is
  `2` and the unfiltered list has 3 rows. A `?state=up` list never holds the shadowed row.
- Count definition: each count is a plain count of the entries in one `/checks` answer of
  pulse-api, read on this page visit. There is no time window, no sampling, no percentile, no
  rounding. A doc that calls it an average, an uptime figure or a count over a time span is
  wrong.
- Breakpoint: "below 720 px" is fine; "at 768 px or less" or "on tablets" is wrong. The rule is
  `max-width: 719px`.
- Chevrons: "tap the arrow to scroll the menu". Reject: the chevrons are non-interactive hints
  (`pointer-events: none`, `aria-hidden="true"`).
- Navigation: a doc that lists Incidents (or Maintenance, Activity, System) as a working screen, or
  says a Viewer sees Tokens, is wrong.
- Navigation as authorization: "a Member cannot open `/tokens` because the link is hidden".
  Reject: the route's role check refuses it with `403`; the hidden link is not the control.
- E-mail: keeping "wraps inside only when it is wider than the line" without a mobile exception
  is wrong at 390 px, where the identity is cut with an ellipsis.
- Presets: "Read is selected by default" is wrong; no card is selected at first.
- Diff scope: a diff that also touches `src/styles.ts`, `docs/tokens.md`, `bun.lock` or
  `AGENTS.md` fails, even if the docs are right.

## Contract fields

No new names. This change adds no field, key, setting, route or name. It documents existing
routes (`/checks?state=<state>`) and labels that are already in console `src/`.

## Repository: console

Files:
- `README.md`
- `docs/configuration.md`

Behavior change: no
Docs only: the code on `main` already has the behavior; this task describes it.

### Task

1. Re-read the console sources named in "Required behavior" on the current `main`. If they
   differ from this spec, document `main` as it is and say so in the PR. If a difference changes
   the meaning of a required point (for example, the tiles no longer link), request a hold
   instead.
2. `README.md`, section "What works now": extend the sentence about the signed-in shell and the
   Overview. Describe the overall state and the six tiles (five state links plus the unfiltered
   Total) and the empty and failure exceptions. Describe the sidebar on wide screens and the one
   scrolling navigation row with icons at 719 px or less. Keep it short, in the style of the
   file, and link to `docs/configuration.md` for detail. Do not change the settings table or the
   endpoints table. Neither one changes.
3. `docs/configuration.md`:
   - Overview paragraph (now line 131): the tiles, their links, the count definition, the
     exceptions.
   - Shell paragraph (now line 185): desktop sidebar, mobile header and navigation row, the
     compact account row, and the qualified e-mail sentence.
   - Checks list: the four columns, the scroll region and hint, the ellipsis limit. Put it beside
     the Checks paragraph (now line 133) or in a new short section such as `## Screens`.
   - A short note on the Tokens, Probes and Team tables, the preset cards and the form widths,
     linking to `docs/tokens.md` and `docs/team.md`.
   Use English, short plain sentences (console `AGENTS.md`, "Documentation").
4. Do not edit any other file.

### Tool facts (cited)

- `bun run check` is `bun run lint && bun run typecheck && bun run test` (console
  `package.json:18`). `lint` is `biome check . && pulse-eslint . && pulse-workflows`
  (`package.json:15`). Bun `1.4.0` (`package.json:9,35`). `bun test` has 80 % line coverage on
  (`bunfig.toml:1-3`); docs cannot change it.
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned at
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json`, devDependency
  `@lorenzh/pulse-config`). At that ref, `biome.json:8-17` sets `ignoreUnknown: true` and includes
  `**` except `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`. The pinned file is
  the same as the config clone on `main` (checked with `diff`).
- CI: `.github/workflows/ci.yml:18` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. At
  that ref, `check.yml:22-38` sets up Bun `1.4.0`, then runs `bun install --frozen-lockfile`,
  `bun run lint`, `bun run typecheck` and `bun run test`. The pinned file is the same as the
  config clone on `main`.
- The manual fixture console is `bun e2e/run.ts --serve` (console `AGENTS.md`, Commands table;
  `e2e/run.ts:1-2`). Browser checks are `bun run check:browser` (`package.json:19`), after
  `bunx playwright install chromium`.

### Checks

1. Scope. Run `git diff --name-only origin/main...HEAD | sort` on the final branch. The expected
   output is the literal two lines `README.md` and `docs/configuration.md`, nothing else. Before
   the commit, `git diff --name-only | sort` must give the same two lines, and
   `git status --short` must show no untracked file. `git diff --check origin/main...HEAD`
   prints nothing.
2. Gate. `bun install --frozen-lockfile` then `bun run check` exits `0`.
3. Running console. Start `bun e2e/run.ts --serve` and sign in with the fixture account (do not
   copy its credentials into the PR). Check at 1280 px and 390 px wide, and once in dark scheme:
   - Overview: the six tiles in the order Down, Degraded, Unknown, Maintenance, Up, Total. Their
     `href`s are the six literals of the table under "Overview" in this spec. Follow each link.
     The Checks state filter shows the chosen state, and Total opens `/checks` without a filter.
     Each state tile's count equals the row count of its filtered list (two separate pages, read
     independently). Note any tile with count `0`.
   - Navigation at 390 px: one horizontal row, scrolls sideways, keyboard focus brings a hidden
     link into view, no Incidents entry. Account row: no avatar, identity cut with an ellipsis,
     role, `Account security` and `Sign out` visible.
   - Checks at 390 px: the hint `Scroll sideways to see all columns.` is visible and the table
     scrolls inside its region. At 1280 px the headers are `Check`, `Target`, `State`, `Actions`.
   - `/tokens/new`: four cards, none checked, the note above them.
   - `/team`: the `2FA` column shows `On` or `Off`.
   Compare each observation with the new text. A mismatch is fixed in the docs if the doc is
   wrong, or reported as a hold if the console contradicts this spec.
4. Exceptions from source. The zero-check text (`No checks yet`, `Reload`) and the failure views
   match `src/overview.ts:57-62,83-93` and the assertions in `src/overview.test.ts`.
5. Content review. Every counterexample in this spec is false for the new text. Every label,
   link, breakpoint and scope that the docs name appears literally in the cited `src/` line.

### Completion evidence

The PR names issue #791, lists the output of check 1 (the two file names), the result of
`bun run check`, the commands and widths of check 3 with what was seen, and any known limit,
for example a browser without scroll-driven animations that shows only the static edge shadows.
