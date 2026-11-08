# pulse Console design

Design reference for pulse-console (self-hosted first, hosted later), exported from the design canvas "pulse Console". Read-only input for Factory specs and for the pulse-console build; the code lives in lorenzh/pulse-console.

## Source

| | |
| --- | --- |
| Artifact | [pulse Console](https://claude.ai/artifact/LfbJQnnkNCF8VHGnTnYWnP) (claude.ai, Design type). The artifact is the source of truth; this folder is a copy. |
| Exported from artifact version | `1794097103-7336` |
| Export date | 8 November 2026 |
| Design system | losoft App, [artifact](https://claude.ai/artifact/1EbvYkD4WhfdNqD7HygC2q), version `1794041526-2438` (also recorded in `canvas.json` under `designSystems`) |
| Related design system | losoft (website), [artifact](https://claude.ai/artifact/LpY9zNebhf9hVcb8cJwbwH), used by `design/website/` |

## Scope: what is v1

The canvas has three groups. Only boards titled "SH · …" are a source for v1 work items, wherever they sit on the canvas (canvas notes "scope" and the host and container note).

- Self-hosted boards (titles start with "SH ·" or "SH <number> ·"): v1, also the host and container check boards (`SHHostCheck*`, `SHContainer*`, issues #836 and #839) in the row below "Later". One organisation, invites only, no billing or plans.
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
| `SHHostCheckEdit.dc.html` | SH · Host check: create / edit (agent push) | 1440 × 2140 |
| `SHContainerCheckEdit.dc.html` | SH · Container check: create / edit | 1440 × 1240 |
| `SHHostCheckDetail.dc.html` | SH · Host check detail (degraded) | 1440 × 1360 |
| `SHHostCheckDetailSilent.dc.html` | SH · Host check detail (not reporting) | 1440 × 1360 |
| `SHContainerCheckDetail.dc.html` | SH · Container check detail, web (exited 137) | 1440 × 980 |
| `SHContainerCheckDetailHostSilent.dc.html` | SH · Container check detail, web (host not reporting) | 1440 × 980 |
| `SHContainerApiCheckDetail.dc.html` | SH · Container check detail, api (running) | 1440 × 980 |
| `SHContainerApiCheckDetailHostSilent.dc.html` | SH · Container check detail, api (host not reporting) | 1440 × 980 |
| `SHContainerWorkerCheckDetail.dc.html` | SH · Container check detail, worker (running) | 1440 × 980 |
| `SHContainerWorkerCheckDetailHostSilent.dc.html` | SH · Container check detail, worker (host not reporting) | 1440 × 980 |
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

## Changes in version 1794097103-7336

- New: host and container checks for the self-hosted Console (issues #836, #839), 10 boards in a new canvas row "Self-hosted: host and container checks" below the "Later" row.
  - `SHHostCheckEdit`: create or edit a host check (agent push): expected interval and grace period, threshold rows (metric, degraded above, down above, held for), and an "Install the agent" panel with the check secret (reveal, copy, rotate with confirmation), interval, mounts, interfaces, user, environment file, systemd unit and a download per architecture.
  - `SHContainerCheckEdit`: create or edit a container check, configured per container.
  - `SHHostCheckDetail` (degraded, swap 97% above 90%) and `SHHostCheckDetailSilent` (not reporting): current values as meters, no graphs.
  - `SHContainerCheckDetail`, `SHContainerApiCheckDetail`, `SHContainerWorkerCheckDetail`, each with a "host not reporting" variant: web exited (137), api running and healthy, worker running with 1 restart.
- `SHCheckEdit`: the type selector now offers Host and Container; the name field and the Cancel link follow the chosen type; loads `ds/losoft-app/components/bundle.js` for the code blocks.
- `SHChecks`: 39 checks (was 35), 8 created in the console (was 4); new state "Degraded"; four new rows (`app-01`, `web on app-01`, `api on app-01`, `worker on app-01`) that link to the new detail boards.
- `SHIncidents`, `SHIncidentsMobile`, `SHOverview`, `SHOverviewMobile`, `SHIncidentComposer`, `SHStatusPage`: two new automatic incidents (#144 app-01 swap above 90%, #145 web on app-01 is down), 4 open incidents (was 2), overall "Partial outage · API, Website", Website shown as partial outage on the status page, checks up 33 of 38. The sidebar of all `SH*` boards shows 38 checks and 4 open incidents.
- Tokens and styles: `console.css` adds threshold rows, meter list, key-value list and secret field (marked as design system candidates) and no-break identifiers. The design system version is unchanged.
- Example secrets: the artifact replaced the made-up keys and tokens in `ApiKeys`, `Notifications`, `SHNotifications`, `SHProbes`, `SHTokens`, `SHTeam`, `SHSetup`, `SHSetupMobile`, `SHSecurity`, `SHInviteMobile`, `SHTwoFactor` and `SHTwoFactorMobile` by values marked `EXAMPLE` (setup keys, otpauth links, recovery codes, invite link). The earlier export still carried random-looking values.
- Scope rule: the canvas note on the host and container row marks it as v1 although it sits below the "Later" row. A board is v1 when its title starts with "SH"; position on the canvas does not decide.

## Changes in version 1794085135-571f

- Initial export of the Console canvas.
- The canvas was restyled onto the losoft App design system (version `1794041526-2438`): the `la-*` components replace the website-style components used before.

## Updating this export

Use the `syncing-designs` skill (`.agents/skills/syncing-designs/SKILL.md`).
