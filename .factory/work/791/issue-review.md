# Issue review: #791 console layout documentation

## Decision

Ready for `plan`; no question blocks the spec. The implementation target is `console` only, with no new target dependency. This is documentation follow-up to #780 and its completed child #784, delivered by [console PR #18](https://github.com/lorenzh/pulse-console/pull/18). Do not repeat its implementation.

## Evidence and prior decisions

- Read the meta `AGENTS.md`, `README.md`, Factory preamble and issue-review prompt, plus the console `AGENTS.md`, requested documentation, relevant source and existing test assertions.
- Read [#791 and its comments](https://github.com/lorenzh/pulse-meta/issues/791). The only comment at review time is the current Factory claim; there are no earlier decisions for this issue.
- Also read the comments on [#780](https://github.com/lorenzh/pulse-meta/issues/780) and [#784](https://github.com/lorenzh/pulse-meta/issues/784), and PR #18 metadata/body. PR #18 is merged into `main`; its merge commit is `fc2c166de8237a841b5253cef99bb3fd17f85f2f`, exactly the inspected `.repos/console` checkout (`main` and `origin/main`). Its diff does not update either requested file. The PR comments endpoint returned no discussion entries; the child issue and PR body supply the history.
- The [owner decision on #784](https://github.com/lorenzh/pulse-meta/issues/784#issuecomment-6683883939) accepts the measured old-source overflow baseline rather than requiring an unbroken name to wrap on old code. This documentation issue must not reopen baseline testing or change table layout.
- Console `AGENTS.md` assigns settings/endpoints and repository behavior to `README.md`, requires both requested files to follow behavior changes, and forbids Factory artifacts in console. English, short plain sentences apply.

## Current behavior to describe

### Overview

`src/overview.ts` renders the overall state and six linked tiles in this order when a successful read contains at least one active check:

| Tile | Destination |
| --- | --- |
| Down | `/checks?state=down` |
| Degraded | `/checks?state=degraded` |
| Unknown | `/checks?state=unknown` |
| Maintenance | `/checks?state=maintenance` |
| Up | `/checks?state=up` |
| Total | `/checks` |

These are five state counts plus a total, not six check states. A zero-count state tile still exists when there are other checks. With no checks, the page shows `No checks yet` and Reload instead of tiles. Missing/rejected token and API-failure views do not show the tiles either. Counts come from `/checks`, not from shadowed definitions; the unfiltered Checks list can additionally show shadowed definitions. The responsive grid fits six tiles at the existing 1280 px fixture and two columns at 390 px; avoid promising a fixed column count at every width. Source and existing assertions: `src/overview.ts`, `src/overview.test.ts`, `src/server.overview.test.ts`, `src/styles.ts`, `e2e/design-matrix.ts`.

### Navigation and account row

`src/shell.ts`, `src/navigation.ts` and `src/styles.ts` implement:

- A desktop sidebar whose border spans a long page, with its inner navigation/account content sticky and separately scrollable.
- At 719 px and below, a full-width header with a single horizontally scrollable navigation row, icons beside labels, keyboard focus and edge hints. Scroll-driven chevrons indicate remaining content in supporting browsers; static background shadows are the fallback. These indicators are not navigation buttons.
- Overview and Checks for every role; Tokens, Probes and Team additionally for Admin/Owner. Unavailable registry entries such as Incidents are not exposed as working screens.
- A compact mobile account row: the avatar and visible `Signed in as` prefix disappear, identity truncates with an ellipsis, and role, Account security and Sign out remain. The full name/email remain in the markup. Desktop email wrapping differs from mobile truncation.

The existing account-shell paragraph in `docs/configuration.md` describes email wrapping without a mobile exception. Qualify it while adding the responsive navigation description. Do not alter role rules or imply that navigation visibility authorizes a route. Existing browser checks exercise mobile navigation at 390, 375, 360 and 320 px.

### Checks and other screens

`src/check-pages.ts` has four table headers, in order:

| Column | Contents |
| --- | --- |
| Check | Name; id and source tag below (`checks.json (read-only)` or `Console`) |
| Target | Type and target |
| State | State and last result time; shadowed definitions have their shadowed label and no result time |
| Actions | Existing actions permitted for the role and check source |

The Checks table fits the existing 1280 px fixture; narrower space scrolls inside its named, focusable table region. The mobile hint says `Scroll sideways to see all columns.` Long targets and oversized unbroken names/ids can be clipped with an ellipsis; full values remain in the markup and on detail pages. Do not promise that all text is visible or that every long name is a single line. `src/check-filters.ts` confirms that the state query values used by the tiles filter the list; state filters exclude shadowed rows.

Other presentation changes from PR #18 fit a short screen summary in `docs/configuration.md`: Tokens and Probes keep their existing headers, with ids/timestamps kept together and tables allowed to scroll inside their boxes. Team's 2FA column says `On`/`Off`; unavailable member/invite actions show a dash with accessible `No actions` text. Sources: `src/token-pages.ts`, `src/probe-pages.ts`, `src/team-pages.ts`, `src/styles.ts`.

### Forms and token presets

`src/token-view.ts` and `src/token-pages.ts` define four Access radio cards, none selected by default:

| Preset | Description | Scopes |
| --- | --- | --- |
| Read | Reads the checks and their configuration. Changes nothing. | `read` |
| Manage checks | Reads checks and creates, changes and deletes them. | `read`, `checks`, `admin` |
| Post incidents | Reads checks and posts incidents. | `read`, `incidents`, `admin` |
| Full access | Reads and changes checks and posts incidents. | `read`, `checks`, `incidents`, `admin` |

One note above the cards explains that the latter three can also create, rotate and revoke tokens with the same or fewer scopes and read the audit log. A preset requiring a scope the console token lacks is disabled and says `The console token lacks <scope>.` These are token access presets, not new check presets or new console roles.

`src/styles.ts`, `src/html.ts` and the relevant page renderers cap ordinary form controls at 40rem, short numeric/select fields at 12rem and selected identifiers/names at 24rem, while fitting available width. Save and Copy buttons are compact rather than full form width; Copy remains a progressive enhancement. Recovery codes stay on one line each. Describe these as current presentation where useful, without inventing new fields, defaults, request semantics or validation rules.

## Open points and assumptions resolved for planning

1. **Which repository owns the two paths?** Both are in `pulse-console`. The exact two-file rule applies to the final console implementation diff. Meta must retain this review and later Factory spec/task artifacts; it is not an instruction to edit meta's README or suppress `.factory/work/791`.
2. **How broad is “anything about screens, columns or presets”?** Cover the PR #18 presentation changes above in the requested files, at operator-facing detail. Keep README concise, put screen/form/preset detail in configuration, and link to the existing `docs/checks.md`, `docs/tokens.md` and `docs/team.md` as useful. Do not edit those other files or perform unrelated documentation cleanup.
3. **“Six tiles linking to the filtered Checks list” has an exception.** Document the five filtered links and Total's unfiltered link explicitly. State the empty-installation exception; do not change the code to fit a literal six-state interpretation.
4. **Main is the authority.** Use the inspected source and current runtime, not every historical claim or old spec. Existing detailed docs already include some layout updates and can contain stale unrelated text; cross-check rather than copy it blindly. Recheck console main when writing the spec/implementation if it has advanced.
5. **Dependency already delivered.** #780/#784 are completed and the merge is present locally; no unresolved dependency or cross-repository implementation is needed. No change to provider dependency links, labels or comments is required in this review.
6. **Running-console evidence belongs to implementation verification.** This review inspected source and existing assertions; it did not install dependencies, start the service or independently run the previous PR's tests/browser checks. Its historical passing results are not new verification for #791.

## Derived acceptance check

In the eventual writable console build checkout:

1. Both `README.md` and `docs/configuration.md` change. Compare the complete implementation against its base with `git diff --name-only <base> HEAD` (or `git diff --name-only <base>` before committing); the sorted output must be exactly `README.md` and `docs/configuration.md`. Also inspect `git status --short` for unintended files and run `git diff --check`. Bare `git diff --name-only` is appropriate only for uncommitted edits and must not silently pass on an already committed clean tree.
2. README explains the successful nonempty Overview's six tiles, the five filtered links versus unfiltered Total, and the horizontal mobile navigation. It does not imply six states, tiles on an empty/error page, or access to unavailable screens.
3. Configuration accurately describes the four Checks columns and mobile scrolling; preset cards, no default selection, shared access note and disabled-scope behavior; desktop/sidebar and compact mobile account behavior, including the email wrapping exception. Include concise relevant form, Team and other-table presentation details from the inspected source. Any documented labels, scopes, links or breakpoints must agree with main.
4. Start the current console using its documented fixture command `bun e2e/run.ts --serve`, sign in with the local fixture credentials, and inspect the Overview, Checks, Tokens/new and Team at desktop (1280 px) and mobile (390 px), with a dark-scheme spot check. Never publish the fixture credentials. Verify all six tile hrefs/counts, follow each state link and Total, and confirm the selected filter/results. Include a fixture state with a zero count if available. Check the mobile navigation scroll/focus behavior and account row against the prose. The fixture contains active checks across the states; it does not require production API credentials.
5. Review the zero-check and failed-read exceptions against the source/existing fixtures. Verify the documented four-column grouping, long-value clipping/scrolling, preset descriptions and initial selection against the rendered console. Record the actual command and observations; flag discrepancies instead of changing product code or tests to match the draft.
6. Follow console's required `bun run check` gate in the implementation checkout. Existing browser checks may supply supporting evidence (`bun run check:browser`); no new tests or fixtures are needed for this documentation-only task. The final target diff must contain no code, tests, styles, dependencies/lockfiles, CSP, routes, roles, settings changes or Factory artifacts.

## Review environment notes

The initial directory probe found no `.factory/work/791`; this patch creates it. The subsequent console file listing/read succeeded. Cloud runtime status tooling is not available in this session and `/etc/codex/network-policy.json` is absent, so runtime policy/credential readiness could not be inspected through that skill. GitHub connector reads succeeded without local credential inspection. These limitations do not block source-based issue review; runtime verification remains an acceptance step for the build.
