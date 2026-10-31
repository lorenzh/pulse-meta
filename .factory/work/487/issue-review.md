# Issue review: #487 Website v28 copy and docs pin bump

Target: `website` only (`lorenzh/pulse-website`, base `453ce8c` at the time of review).
Design source: `design/website/` version 28 in pulse-meta (commit `1fdab7b`).

## What I checked

- `design/website/Main.dc.html` and `Hosted.dc.html` v28 against the v27 diff (`git show 1fdab7b`): every text in the issue matches the design word for word.
- Website `src/content/home.tsx`, `architecture.tsx`, `hosted.tsx`, `facts.ts`, `facts.test.ts`, `home.test.ts`, `hosted.test.ts`, `src/components/Icon.tsx`, `scripts/bump-docs.ts`, `docs.config.json`, `budget.json`, `src/docs/nav.ts`.
- `main` of each service repo (cloned under `.repos/`, same SHA as `git ls-remote`):
  - api `11f5555` (2026-10-31), probe `9674e51`, status `b01a1ab`, notify `584eabd`, contract `ebcbbb6`, kit `6a06ec2`.
  - Their `docs/` file lists match the lists in `docs.config.json` today. No new file shows up, so `src/docs/nav.ts` needs no new entry (unless main changes before the build).
- pulse-api `docs/rest-api.md` on main has `## GET /latency`, `### GET /manual-incidents` and a table row `PUT /admin/checks/:id` (with `If-Match`, `412`). The pinned copy (`test/fixtures/api-rest-api.md`, 19.6 KB) has none of them; main has 33.6 KB.
- Facts in the v28 copy hold on main: `checks.example.json` has `tcp`, `dns` and `domain` checks; probe docs describe the result buffer; api docs describe percentiles and `availabilityTarget` and the error budget; latency is HTTP only (as the design notes).

## Facts and fixtures after the bump (code wins)

The facts test compares `facts.ts` with `test/fixtures/`. These fixtures differ from main and must be refreshed to the copies at the new pins: `api-rest-api.md`, `api-install.md`, `api-compose.yaml`, `api-checks.example.json`, `notify-channels.md`.

Effects on the facts:
- `CHECKS_SAMPLE`: check `example` in `checks.example.json` on main has a new key `"availabilityTarget": 99.9` (between `latencyObjectiveMs` and `keyword`). The test compares with `deepEqual`, so `CHECKS_SAMPLE.checks[0]` must add this key. Check `nightly-backup` is unchanged. The home `checks.json` sample then shows the key. This is allowed: the hosted test bans `%` only on the hosted page.
- `COMPOSE_COMMANDS`, `STATUS_PAGE_URL` ("Open http://localhost:8080"), `ENV_VARS` and the ports in `compose.yaml`, `name: pulse`, the four services without a profile, `## POST /results` and `/heartbeat/:id`: all still on main. No change needed.
- `CHANNELS`: notify still has five channel types (slack, teams, email, webhook, file). No change needed.

## Open points (none blocks the spec)

1. **Hero drops "a file".** The current site says "email, a webhook or a file"; v28 (and v27) says "email or a signed webhook". The issue fixes the v28 text, so the hero no longer names the file channel. That is still true (it is a subset), and the Notifications card still lists the file. Follow the issue; the PR names it as a design-over-site copy change, not a code difference.
2. **Position of the three new cards.** `Main.dc.html` order: HTTP checks, TLS/TCP/DNS/domains, Heartbeats, Quorum, Maintenance windows, White-label status page, Components, Feed and badges, Incident updates, Latency and SLOs, Checks API, Notifications, Metrics and health. The site has no "Components" or "Feed and badges" card (an older gap, and not in this issue). Assumption: put the three new cards after "White-label status page" and before "Notifications", so 11 cards. Do not add "Components" or "Feed and badges"; the PR names this difference from the design.
3. **Icon names.** `Icon.tsx` already has `chart` (the line chart that "Metrics and health" uses). The new bar-chart icon needs a separate name. Assumption: `message` (`<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path><path d="M8 12h.01M12 12h.01M16 12h.01"></path>`), `bars` (`<path d="M12 20V10M18 20V4M6 20v-4"></path>`), `code` (`<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"></path>`). The names are up to the implementation; the paths must match the design byte for byte.
4. **Architecture api text.** The site's current api text has no "rolls checks up into components"; v28 has it. The new text replaces the old one completely, as in the issue.
5. **Hosted Team item: position and placeholder.** In the design the item replaces "Components, Atom feed and badges", which the site never had. The site's Team list has six items. Assumption: append it as the seventh Team item, as `Components, incident updates, feed and badges <Placeholder name="AVAILABILITY" />`, like the neighbouring "Slack, Teams, reminders and heartbeats" item. This adds no new placeholder name, so `PLACEHOLDERS` and the list in `hosted.test.ts` stay the same. The "every hosted promise carries a placeholder" test covers the item without a change; `hosted.test.ts` must also assert the text.
6. **Hero and Hosted wording beyond the issue.** v28 also has other hosted texts that differ from the site (for example the included Notifications card in the design: "delivered from our mail and network"). These come from earlier versions and are out of scope. Change only the texts the issue lists.
7. **Pins move with time.** "`main` SHA at the time of the PR" means the implementation runs `bun run docs:bump` itself; it does not copy the SHAs above. `docs:bump` needs network access to github.com and api.github.com (12 unauthenticated API calls, within the rate limit; `GITHUB_TOKEN` is used if set). If main of a repo has a new docs file by then, the build fails until `src/docs/nav.ts` maps it. That is allowed and in scope, since the bump requires it. If a bumped page has a link or anchor that the link check rejects, the fix belongs in the source repo (non-goal here). The implementation then stops and reports it instead of editing generated docs.
8. **Budget.** The budget is gzip HTML per page (60000 B). The REST API page grows from about 20 KB to about 34 KB of markdown, which is well under 60 KB gzip. Low risk; `check:budget` is the check.
9. **home.test.ts title.** The test "version 27 content: …" may stay or be renamed; a new v28 test asserts the new texts. The `data-reveal >= 8` assertion still holds.
10. **DocsApi.dc.html.** The design's REST intro and table are reference for layout only. The page content is the pinned `rest-api.md`, so the site never writes its own REST text.

## Assumptions

- Base is website `main` at `453ce8c`; no other website feature in flight touches these files.
- Placeholder for the new Team item: `AVAILABILITY`.
- New card text, hero, architecture and hosted strings are copied exactly as in the issue (typographic characters unchanged: the issue uses plain hyphens and no curly quotes in these strings).

## Derived acceptance check

On website `main` plus the PR, `bun run check:all` passes (lint, typecheck, tests, build, link check, budget, a11y), and:
- `docs.config.json`: every repo's `sha` equals `git ls-remote https://github.com/<repo>.git refs/heads/main` when the PR is opened, and `files` lists what `docs:bump` wrote.
- `dist/index.html` contains the v28 hero sentence, the card "TLS, TCP, DNS and domains" with its new text, the cards "Incident updates", "Latency and SLOs" and "Checks API" (in that order, before "Notifications") with the design's SVG paths, and the new probe and api architecture texts.
- `dist/hosted/index.html` contains "Components, incident updates, feed and badges" in the Team plan, followed by a `<mark class="placeholder">`.
- `dist/docs/api/rest-api/index.html` contains `GET /latency`, `GET /manual-incidents` and `PUT /admin/checks/:id`.
- `home.test.ts` and `hosted.test.ts` assert these texts; `facts.test.ts` passes against fixtures copied from the new pins (`CHECKS_SAMPLE` includes `availabilityTarget: 99.9`).
- The PR description names the differences between the design and the site: no "Components" and "Feed and badges" cards, `availabilityTarget` in the sample if the design differs, the hero without "file", and any other point above that applies.
