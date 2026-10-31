# Spec #487: Website v28 copy (home features, architecture, hosted) and docs pin bump

## Goal

The built site shows the version 28 copy from `design/website/` (pulse-meta #485, commit `1fdab7b`) on Home and Hosted. It also builds its docs from the current `main` of every service repo, so the REST API page lists the latency, manual-incident and admin config routes.

## Scope

One repository: `website`. It covers copy in `src/content/home.tsx`, `architecture.tsx` and `hosted.tsx`, three new icons in `src/components/Icon.tsx`, a `docs:bump` of `docs.config.json`, refreshed `test/fixtures/` and `facts.ts`, and the tests that assert the new texts.

## Non-goals

- No layout or motion change beyond three more cards in the existing home `feature-grid`.
- No change to the docs sources in the service repos, and no hand edit of fetched or generated docs.
- No "Components" or "Feed and badges" home cards. The design has them, but this issue does not ask for them.
- No other v28 hosted or home wording beyond the texts listed below (issue review, open point 6).
- No new placeholder name. `PLACEHOLDERS` stays as it is.

## Decisions taken from the issue review (`.factory/work/487/issue-review.md`)

1. The three new cards go after "White-label status page" and before "Notifications", so the grid has 11 cards. This follows the relative order of `Main.dc.html` without its Components and Feed cards.
2. Icon names: `message` (speech bubble), `bars` (bar chart; `chart` already exists and stays for "Metrics and health"), `code` (brackets). The names may differ, but the paths match the design byte for byte.
3. The new Team item is appended as the seventh Team item, with `<Placeholder name="AVAILABILITY" />`.
4. The hero drops "a file", as the issue's text says. The Notifications card still lists the file channel.
5. The new api architecture text replaces the old one completely.

## Required behavior

All strings are copied exactly. They use plain ASCII hyphens and no curly quotes. Each one was checked against `design/website/Main.dc.html` and `Hosted.dc.html` at `1fdab7b`, at the lines given in brackets.

Home (`src/content/home.tsx`):
- Hero lead [Main.dc.html:152]: `pulse checks HTTP endpoints, TLS certificates, ports, DNS, domains and cron jobs from several locations, decides by quorum, and keeps a calm public status page. Incidents reach Slack, Teams, email or a signed webhook. Self-hosted with one Docker Compose file.`
- Card `lock` [Main.dc.html:260]: title `TLS, TCP, DNS and domains`, text `Certificate and domain expiry, open ports and DNS records, next to every HTTP endpoint.` The icon stays `lock`.
- New cards, in this order, between "White-label status page" and "Notifications":
  - `message`, `Incident updates`: `Post what you know, from investigating to resolved. The page, the feed and every channel follow.` [Main.dc.html:301-303]
  - `bars`, `Latency and SLOs`: `Response-time percentiles per HTTP check and availability objectives with an error budget.` [Main.dc.html:307-309]
  - `code`, `Checks API`: `Change checks, components and maintenance over an admin API. No restart, no lost edits.` [Main.dc.html:313-315]

Icons (`src/components/Icon.tsx`, `PATHS`):
- `message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path><path d="M8 12h.01M12 12h.01M16 12h.01"></path>'`
- `bars: '<path d="M12 20V10M18 20V4M6 20v-4"></path>'`
- `code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"></path>'`

Architecture (`src/content/architecture.tsx`, `SERVICES`):
- pulse-probe [Main.dc.html:346]: `Runs HTTP, TLS, TCP, DNS and domain checks, reloads them from the API and buffers results while it is away.`
- pulse-api [Main.dc.html:355]: `Stores results in SQLite, applies quorum and maintenance, rolls checks up into components, opens and resolves incidents, takes heartbeat pings and admin changes without a restart.`
- pulse-status and pulse-notify stay as they are.

Hosted (`src/content/hosted.tsx`, Team plan):
- Append `<>Components, incident updates, feed and badges <Placeholder name="AVAILABILITY" /></>` as the last item [Hosted.dc.html:238].

Docs pins:
- Run `bun run docs:bump` (`scripts/bump-docs.ts`) once, close to opening the PR. It writes every repo in `docs.config.json` (api, probe, status, notify, contract, kit) with the `main` SHA from `git ls-remote`, the commit date and the docs file list it finds. Do not copy SHAs from this spec. At the time of planning, main was api `11f5555`, probe `9674e51`, status `b01a1ab`, notify `584eabd`, contract `ebcbbb6` and kit `6a06ec2`. At those SHAs the file lists equal the current ones, so `src/docs/nav.ts` needs no change. If main has a new docs file by then, map it in `src/docs/nav.ts` (in scope).
- The REST API page comes from pulse-api `docs/rest-api.md`. `DocsApi.dc.html` guides the layout only, and no REST text is hand-written.

Facts and fixtures:
- Copy these files byte for byte from the new pins: `test/fixtures/api-rest-api.md` (api `docs/rest-api.md`), `api-install.md` (api `docs/install.md`), `api-compose.yaml` (api `compose.yaml`), `api-checks.example.json` (api `checks.example.json`) and `notify-channels.md` (notify `docs/channels.md`). All five differ from main today. Use `gh api` or `raw.githubusercontent.com/<repo>/<sha>/<path>`.
- `CHECKS_SAMPLE.checks[0]` (`example`) gains `availabilityTarget: 99.9` between `latencyObjectiveMs` and `keyword`. This is the code at api main `checks.example.json:10`; the facts test compares with `deepEqual`. `nightly-backup` stays unchanged.
- The other facts hold at main and stay unchanged (verified): `COMPOSE_COMMANDS` and `Open http://localhost:8080` in `docs/install.md`; `name: pulse`, `${PULSE_API_PORT:-3000}:3000`, `${PULSE_STATUS_PORT:-8080}:8080` and `PULSE_LOCATION:-default` in `compose.yaml` (lines 3, 25, 48, 32); `## POST /results` (line 34) and `/heartbeat/:id` in `rest-api.md`; the five channel types in `notify/docs/channels.md`. If one has changed at the pin the implementer uses, the code wins: fix the fact and name it in the PR.

Tests:
- `src/content/home.test.ts` gets a new test (for example "version 28 content: …") that asserts on the rendered `index.html`:
  - the hero sentence (allow `\s+` for line breaks in JSX);
  - `TLS, TCP, DNS and domains` and its text, and that `TLS certificates</h3>` is gone;
  - each of the three new titles and texts;
  - the order: White-label status page < Incident updates < Latency and SLOs < Checks API < Notifications, by `indexOf`;
  - the three literal SVG path strings above;
  - the two new architecture texts;
  - `&quot;availabilityTarget&quot;` in the checks sample;
  - exactly 11 `<li class="card" data-reveal="true">` items in the feature grid.
  The old v27 test may stay.
- `src/content/hosted.test.ts` asserts that `Components, incident updates, feed and badges <mark class="placeholder">[AVAILABILITY]</mark>` is in the Team plan, between `<h3 class="t-h3">Team` and `<h3 class="t-h3">Business`. The test "every hosted promise carries a placeholder" stays unchanged and must still pass. It now counts 15 plan items, still `>= 12`.
- `README.md`: update it only if it lists home features or pins (AGENTS.md: README owns pinning). Otherwise leave it as it is.

PR description: it names the differences between design and site:
- no Components and Feed and badges cards;
- the hero without "file";
- the bar-chart icon name;
- `availabilityTarget` in the home sample, which comes from code;
- any fact that the bump changed.

## Risks

- **Upstream docs break the link check.** If a bumped page has a link or anchor that `check:links` rejects, the fix belongs in the source repo. The implementer stops and requests a `needs-input` hold that names the page and link. It does not patch generated docs or weaken the check.
- **New docs file on main.** The build fails until `src/docs/nav.ts` maps the file. Map it.
- **Network.** `docs:bump` and `build` need github.com, api.github.com and raw.githubusercontent.com (12 API calls; `GITHUB_TOKEN` is used if set).
- **Budget.** The REST markdown grows from 19.6 KB to 33.6 KB. As gzip HTML this stays well under `htmlBytes: 60000` (`budget.json:2`). `check:budget` is the gate, and the budget must not be raised.
- **Main moves between bump and merge.** That is acceptable. The check is against `git ls-remote` when the PR is opened.

## Performance impact

None expected for the `bench/budgets.json` metrics of the api repo (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `startup_wall_ms` and the reported ones). The change touches only the static website: no api code, image or dependency. Website-side, home HTML grows by three cards and three icons (under 2 KB), and the REST API page grows by about 14 KB of source markdown. The implementer measures both with `bun run check:budget` (per-page gzip HTML <= 60000 B, `budget.json:2`) and writes the gzip size of `dist/index.html` and `dist/docs/api/rest-api/index.html` before and after into the PR.

## Security impact

Security impact: no. The change touches only static copy, inline icon constants, fetched docs pins and test fixtures. It changes no auth, parser, probe client, dependency, Dockerfile or CI file, and the fetched Markdown still passes the existing `url-safety` and link checks.

## Rollout order

One repository: only `website` changes. It reads the already released `main` of the service repos at pinned SHAs, so no consumer runs against an older version.

## Counterexamples

- **Card order:** a grid with "Incident updates" after "Notifications", or "Checks API" before "Latency and SLOs", fails the order assertion. So does a grid that adds "Components" or "Feed and badges" (12 or 13 cards fail the count of 11).
- **Icon paths:** reusing `chart` (`M3 3v18h18 …`) for "Latency and SLOs" fails, because the test needs the literal `M12 20V10M18 20V4M6 20v-4`. Renaming `chart` breaks "Metrics and health", which still renders `m19 9-5 5-4-4-3 3`.
- **Hero:** the v27 text `email, a webhook or a file` must be absent, and `email or a signed webhook` must be present.
- **Hosted placeholder:** a Team item `Components, incident updates, feed and badges` without a following `<mark class="placeholder">` fails "every hosted promise carries a placeholder". A new placeholder name (for example `[FEATURES]`) is rejected by the spec. A literal `99.9%` or any `\d%` on the hosted page fails the existing no-percent test.
- **Pins:** keeping `a1a78ac…` for api, or a SHA that is not main at PR time, fails the SHA check below. Hand-editing `docs.config.json` with a SHA whose file list differs from the tree fails the build, because a fetch is missing or a file is unmapped.
- **Fixtures:** an `api-checks.example.json` copied from main while `CHECKS_SAMPLE` lacks `availabilityTarget` fails the `deepEqual` in `facts.test.ts`. A fixture left at the old pin makes the facts test check stale facts. The fixture-vs-pin `cmp` below catches that.
- No statistic is computed by this change. "Latency and SLOs" is copy only.

## Contract fields

No new names in contract or config. The only new identifiers are website-internal icon keys and copy:
- `grep -rn -E "IconName|Icon\.tsx" .repos/contract/src .repos/config` returns no match. Icon keys live only in website `src/components/Icon.tsx`, where `message`, `bars` and `code` are not keys today (`grep -n -E "^\s+(message|bars|code):" .repos/website/src/components/Icon.tsx` returns nothing).
- `availabilityTarget` is not new. It already exists in contract (`grep -rn availabilityTarget .repos/contract/src` hits `schema.ts` and `index.ts`) and in api `checks.example.json:10`. The website only copies it.

## Repository: website

Files:
- `src/content/home.tsx`
- `src/content/architecture.tsx`
- `src/content/hosted.tsx`
- `src/components/Icon.tsx`
- `src/content/facts.ts`
- `src/content/home.test.ts`
- `src/content/hosted.test.ts`
- `docs.config.json` (written by `bun run docs:bump` only)
- `test/fixtures/api-rest-api.md`, `test/fixtures/api-install.md`, `test/fixtures/api-compose.yaml`, `test/fixtures/api-checks.example.json`, `test/fixtures/notify-channels.md`
- `src/docs/nav.ts`, only if the bump finds a new docs file
- `README.md`, only if it states the pins or the feature list

Behavior change: yes. The site shows new copy, new cards and new docs content.

Behavior: as in "Required behavior" above.

Tool facts (verified):
- Bun 1.4.0: `package.json` `packageManager` and `engines`; `ci.yml` `site` job `bun-version: 1.4.0`.
- Biome 2.6.3: `package.json` devDependency `@biomejs/biome: 2.6.3`. The website `biome.json:2` extends `@lorenzh/pulse-config/biome.json` at pin `86896e9ff02e6458e431aa3417ee81d3b1cbc335` (`package.json` devDependency). That pinned file excludes `!**/test/fixtures` and `!**/*.html` from Biome (pinned `biome.json` `files.includes`), so verbatim fixtures are not reformatted. The website adds `!**/.repos`, `!**/.build`, `!**/.cache` and `!**/src/styles/tokens.css`. The pinned file equals the config clone on `main` (diff empty).
- Lint is `biome check . && pulse-eslint .` (`package.json` `scripts.lint`). Typecheck is `tsc --noEmit` through `typescript7` (`scripts.typecheck`). Tests are `bun test` with `coverageThreshold = { lines = 0.8 }` (`bunfig.toml` `[test]`).
- CI: `ci.yml` job `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@86896e9…` with no `with:`. So `build` defaults to `false` (pinned `check.yml` lines 6-9), and the job runs install, lint, typecheck and test (pinned `check.yml` lines 26-38). The pinned file equals the clone. `ci.yml` job `site` runs `bun run build`, `check:links`, `check:budget` and `check:a11y` after `bunx playwright install --with-deps chromium`.
- `check:all` = `check` (lint, typecheck, test) + `check:site` (build, links, budget, a11y) (`package.json` scripts).

Steps:
1. `bun install --frozen-lockfile`
2. `bun run docs:bump`
3. Refresh the five fixtures from the new SHAs.
4. Update `facts.ts`.
5. Make the copy and icon edits.
6. Add the tests (red first: run them before the copy edits and see them fail).
7. `bun run check:all`

Acceptance evidence. The expected values are literals in this spec or independent sources:
1. `bun run check:all` exits 0 (lint, typecheck, tests with coverage, build, links, budget, a11y), and CI jobs `check` and `site` are green.
2. For each repo in `docs.config.json`, `sha` equals the output of `git ls-remote https://github.com/<repo>.git refs/heads/main` run when the PR is opened (an independent source). The PR lists both. Every `sha` differs from the old pins `a1a78ac807a2…`, `576962c27447…`, `5ab29f84f45f…`, `f0ed21fa5a25…`, `e49492764054…` and `72adb59b980e…` unless that repo's main has not moved since (main had moved for all six at planning time).
3. Each refreshed fixture is byte-equal to the upstream file at the new SHA: `curl -s https://raw.githubusercontent.com/<repo>/<sha>/<path> | cmp - test/fixtures/<name>` (an independent fetch).
4. `grep -c` on `dist/docs/api/rest-api/index.html` finds the literals `GET /latency`, `GET /manual-incidents` and `PUT /admin/checks/:id` (each at least once).
5. `dist/index.html` contains the literal hero sentence, the four card titles and texts and the three SVG path strings written above, and the two architecture texts. `dist/hosted/index.html` contains `Components, incident updates, feed and badges <mark class="placeholder">[AVAILABILITY]</mark>`. All of these are literals from `design/website/` v28 as quoted in this spec. `home.test.ts` and `hosted.test.ts` assert the same literals.
6. `check:budget` output shows every page `<= 60000` B gzip HTML. The literal limit is in `budget.json:2` and unchanged (`git diff --exit-code main -- budget.json`).
7. `git diff --exit-code main -- biome.json tsconfig.json eslint.config.js budget.json .github` is empty: no gate is weakened.
