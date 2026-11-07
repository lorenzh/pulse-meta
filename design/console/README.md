# pulse Console design

Design reference for pulse-console (self-hosted first, hosted later), exported from the design canvas "pulse Console". Read-only input for Factory specs and for the pulse-console build; the code lives in lorenzh/pulse-console.

## Source

| | |
| --- | --- |
| Artifact | [pulse Console](https://claude.ai/artifact/LfbJQnnkNCF8VHGnTnYWnP) (claude.ai, Design type). The artifact is the source of truth; this folder is a copy. |
| Exported from artifact version | `1794085135-571f` |
| Export date | 7 November 2026 |
| Design system | losoft App, [artifact](https://claude.ai/artifact/1EbvYkD4WhfdNqD7HygC2q), version `1794041526-2438` (also recorded in `canvas.json` under `designSystems`) |
| Related design system | losoft (website), [artifact](https://claude.ai/artifact/LpY9zNebhf9hVcb8cJwbwH), used by `design/website/` |

## Scope: what is v1

The canvas has three groups. Only the first is a source for v1 work items (canvas note "scope").

- Self-hosted boards (`SH*`, titles start with "SH"): v1. One organisation, invites only, no billing or plans.
- Hosted boards (titles start with "Hosted, later"): not v1.
- "Later" boards (status page settings, notification channels, agent access, AI assistance): not v1. MCP and AI assistance are not part of the MVP (issue #460).

## Boards

The table follows the canvas order. Size is the board size in the canvas (width × height, px; phone boards are 390 × 844).

| File | Screen | Size |
| --- | --- | --- |
| `Main.dc.html` | Hosted, later · 3 · Overview | 1440 × 1480 |
| `Auth.dc.html` | Hosted, later · 1 · Sign in / create account | 1440 × 960 |
| `AuthMobile.dc.html` | Hosted, later · 1 · Sign in · mobile | 390 × 844 |
| `Onboarding.dc.html` | Hosted, later · 2 · Onboarding | 1440 × 1240 |
| `OverviewMobile.dc.html` | Hosted, later · 3 · Overview · mobile | 390 × 844 |
| `Checks.dc.html` | Hosted, later · 4 · Checks | 1440 × 2300 |
| `CheckDetail.dc.html` | Hosted, later · 4 · Check detail | 1440 × 1960 |
| `CheckEdit.dc.html` | Hosted, later · 5 · Create / edit check | 1440 × 2080 |
| `Incidents.dc.html` | Hosted, later · 6 · Incidents | 1440 × 1160 |
| `IncidentDetail.dc.html` | Hosted, later · 6 · Incident detail (automatic) | 1440 × 1560 |
| `IncidentComposer.dc.html` | Hosted, later · 6 · Manual incident composer | 1440 × 1480 |
| `ComposerMobile.dc.html` | Hosted, later · 6 · Composer · mobile | 390 × 844 |
| `StatusPage.dc.html` | Hosted, later · 7 · Status page settings | 1440 × 2300 |
| `Notifications.dc.html` | Hosted, later · 8 · Notification channels | 1440 × 1700 |
| `Team.dc.html` | Hosted, later · 9 · Team and roles | 1440 × 1240 |
| `ApiKeys.dc.html` | Hosted, later · 10 · API keys | 1440 × 1000 |
| `Billing.dc.html` | Hosted, later · 11 · Billing | 1440 × 1560 |
| `Security.dc.html` | Hosted, later · 12 · Account security | 1440 × 1480 |
| `AgentAccess.dc.html` | Later · Hosted, later · 13 · Agent access (MCP) | 1440 × 2020 |
| `AiAssist.dc.html` | Later · Hosted, later · 14 · AI assistance | 1440 × 1800 |
| `SHSetup.dc.html` | SH 1 · First-run setup | 1440 × 1780 |
| `SHSetupMobile.dc.html` | SH 1 · Setup: owner · mobile | 390 × 844 |
| `SHSignIn.dc.html` | SH 2 · Sign in (self-hosted) | 1440 × 1020 |
| `SHOverview.dc.html` | SH 3 · Overview with instance health | 1440 × 1500 |
| `SHOverviewMobile.dc.html` | SH 9 · Overview · mobile | 390 × 844 |
| `SHProbes.dc.html` | SH 4 · Probe locations and tokens | 1440 × 2600 |
| `SHSystem.dc.html` | SH 5 · System | 1440 × 1940 |
| `SHTokens.dc.html` | SH 6 · Tokens and API keys | 1440 × 1140 |
| `SHTeam.dc.html` | SH 7 · Team (self-hosted) | 1440 × 1980 |
| `SHSettings.dc.html` | SH 8 · Settings | 1440 × 1560 |
| `SHChecks.dc.html` | SH · Checks | 1440 × 3440 |
| `SHCheckDetail.dc.html` | SH · Check detail | 1440 × 1900 |
| `SHCheckEdit.dc.html` | SH · Create / edit check | 1440 × 2160 |
| `SHIncidents.dc.html` | SH · Incidents | 1440 × 1240 |
| `SHIncidentDetail.dc.html` | SH · Incident detail | 1440 × 2280 |
| `SHIncidentComposer.dc.html` | SH · Incident composer | 1440 × 1480 |
| `SHStatusPage.dc.html` | Later · Status page settings | 1440 × 2360 |
| `SHNotifications.dc.html` | Later · Notification channels | 1440 × 1700 |
| `SHSecurity.dc.html` | SH · Account security | 1440 × 1580 |
| `SHAgentAccess.dc.html` | Later · Agent access (MCP) | 1440 × 2020 |
| `SHAiAssist.dc.html` | Later · AI assistance | 1440 × 1800 |
| `SHTwoFactor.dc.html` | SH · Sign in: second factor | 1440 × 900 |
| `SHInviteAccept.dc.html` | SH · Accept invitation | 1440 × 1000 |
| `SHPasswordReset.dc.html` | SH · Set new password | 1440 × 900 |
| `SHSignInMobile.dc.html` | SH · Sign in · mobile | 390 × 844 |
| `SHTwoFactorMobile.dc.html` | SH · Second factor · mobile | 390 × 844 |
| `SHInviteMobile.dc.html` | SH · Accept invitation · mobile | 390 × 844 |
| `SHResetMobile.dc.html` | SH · Password reset · mobile | 390 × 844 |
| `SHMaintenance.dc.html` | SH · Maintenance | 1440 × 1500 |
| `SHActivity.dc.html` | SH · Activity log | 1440 × 1300 |
| `SHStates.dc.html` | SH · States and confirmations | 1440 × 3200 |
| `SHIncidentsMobile.dc.html` | SH · Incidents · mobile | 390 × 844 |
| `SHIncidentDetailMobile.dc.html` | SH · Incident detail · mobile | 390 × 844 |
| `SHComposerMobile.dc.html` | SH · Declare incident · mobile | 390 × 844 |

Other files:

| File | Content |
| --- | --- |
| `canvas.json` | Canvas index: board positions, sizes, titles, order, notes, design system reference |
| `console.css` | Page glue and the Console's own patterns, built from the tokens (the boards load it) |
| `shell.js` | Drawer behaviour of the app shell on narrow widths |
| `ds/losoft-app/tokens.css` | losoft App tokens: colours (light and dark), spacing, radii, type, font faces |
| `ds/losoft-app/components/bundle.css` | losoft App components (`la-*` classes) |
| `ds/losoft-app/components/bundle.js` | losoft App components for charts; loaded by 2 boards |

## How to read the files

- The `.dc.html` files are design-canvas boards: plain HTML with inline styles plus a small component script (`DCLogic`, `renderVals`) for the states a board can show. Read them for layout, content, states and tokens; do not serve them.
- Each board has a `data-props` block that lists its variants (for example `theme`, `dialog`, `mode`). The default variant is what the canvas shows.
- Boards link to each other by file name; the sidebar of every board lists the whole Console.
- Not exported, because the artifact runtime supplies them: `support.js` (the board runtime), the logo image (`/_blob/…`), and the font files. Fonts are Space Grotesk and JetBrains Mono (the `@fontsource-variable` packages that pulse-status already use) and Inter (Google Fonts). The font files are left out to keep the repository lean; `tokens.css` names the faces.
- Because `support.js` and the logo are missing, the boards do not render when opened from disk. Open the artifact to see them.
- All names, addresses, tokens and keys in the boards are examples (organisation "Quillbird", `*.example` domains). Keys such as `pulse_live_…` and webhook secrets are made-up samples; none works anywhere.

## Changes in version 1794085135-571f

- Initial export of the Console canvas.
- The canvas was restyled onto the losoft App design system (version `1794041526-2438`): the `la-*` components replace the website-style components used before.

## Updating this export

The artifact is the source of truth. To bring this folder to a newer artifact version:

1. List the artifact files (Artifact tool, action `list`, scope `files`, url above) and note the version id in the first line of the result.
2. Read every board (`project/*.dc.html`), `project/canvas.json`, `project/console.css`, `project/shell.js` and `project/ds/losoft-app/{tokens.css,components/bundle.css,components/bundle.js}` (Artifact tool, action `read`, with `paths` and an `out_dir`), and copy them without the `project/` prefix into this folder. Do not export `artifact-type/`, `SKILL.md`, `index.html` or the fonts.
3. Run `git diff --stat design/console` to see which boards changed. Add and remove rows in the board table so it matches the `order` in `canvas.json`.
4. Update the version id, export date and design system version at the top of this file, and add a section "Changes in version <new id>" above the previous one that names the changed boards and what changed in them.
5. Open a pull request. Factory reads the diff to plan the console changes.
