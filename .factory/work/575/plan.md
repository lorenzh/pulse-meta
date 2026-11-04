# Spec #575: Website home update, "Coming soon" docs and the console on Hosted

## Goal

The website shows what pulse can do today and what comes next:
- Home gets four more feature cards and a component-first status text. "How it works" shows pulse-console as an optional fifth service. Two new bands follow: "See it in action" (three static previews) and "Coming next" (console in progress, pulse-deploy CLI coming soon).
- Docs gets a "Coming soon" group with the published pulse-console and pulse-deploy docs.
- Hosted gets an included card for the same open-source console and a "Web console" row in the comparison table.

The waitlist stays disabled. No new visitor-facing text mentions agents or agent access.

## Scope

One repository: `website`. The work covers:
- hand-written content in `src/content/` (`home.tsx`, `architecture.tsx`, `hosted.tsx`, `facts.ts`, plus a new `previews.tsx`);
- five new icons in `src/components/Icon.tsx`;
- CSS for the new bands and the dashed optional box;
- `console` and `deploy` in `DOC_REPOS` and in `docs.config.json` (targeted bump);
- a "Coming soon" group in `src/docs/nav.ts`;
- a renderer fix that drops a Markdown token that is only an HTML comment (needed by the deploy CLI guide, see "Docs" below);
- two new fixtures, the tests and `README.md`.

## Non-goals

- No change to any service, console or deploy code, and no edit of their docs. No hand edit of fetched docs.
- No bump of the six existing doc pins (`api`, `probe`, `status`, `notify`, `contract`, `kit`). Run `docs:bump console deploy` only.
- No change to the live status mock (`status-mock.tsx`), to the hero, to the hero Terminal or to `COMPOSE_SERVICES`. The hero still points to the api Compose quick start. Moving it to pulse-deploy is a separate feature.
- No new placeholder name. `PLACEHOLDERS` stays as it is.
- No screenshot, raster image, iframe, recording, external demo URL, new island or new runtime dependency.
- No date for any roadmap item. No download link for the CLI.
- No redo of #487 (merged spec PR #497). Its hero, its three cards (Incident updates, Latency and SLOs, Checks API), its architecture texts and its Team item stay byte for byte. Their tests stay.

## Decisions taken from the issue review (`.factory/work/575/issue-review.md`)

1. **Design.** The v28 export (`design/website/Main.dc.html` at `1fdab7b`) has the Components and Feed and badges cards (lines 288–297) and the "Every component" text (line 189). It has nothing else that this issue asks for. This spec fixes all other copy. Implementers copy it exactly: plain ASCII hyphens and apostrophes, `·` (U+00B7) only where written here, `…` (U+2026) only in the CLI preview.
2. **Card order.**
   - Components and Feed and badges go after "White-label status page" and before "Incident updates", as in the design.
   - CDN-ready caching and Hot backups go after "Checks API" and before "Notifications".
   - That makes 15 cards.
3. **Status text.** Only the first two words change: "Every check" becomes "Every component". The rest of the paragraph stays, so the v27 privacy assertions still hold. The design's other rewording of that paragraph (line 189) is not taken. The current "Only check targets (URLs) and error details stay private" line is guarded by an existing test.
4. **Console in "How it works".**
   - pulse-console is an optional fifth box with a dashed outline and an arrow to pulse-api labelled `admin API`.
   - Its badge reads `Optional · in progress`.
   - The console already calls pulse-api during setup (console `src/pages.ts:80`, "Connected. Wire version: 1. Checks: N"), so the arrow is real. Check management is described as in progress.
   - All five services pin pulse-contract (`api/package.json:31`, `probe/package.json:30`, `status/package.json:34`, `notify/package.json:30`, `console/package.json:29`), so "Each of them shares pulse-contract" is true.
5. **Release state.**
   - At planning time `gh api repos/lorenzh/pulse-deploy/releases` returned `[]`. So did the same call for `lorenzh/pulse-console`.
   - Console image `ghcr.io/lorenzh/pulse-console:0.1.0` is pinned in deploy `common/services.yaml:44`.
   - The CLI source and its guide (`docs/cli.md`) exist on deploy main `c3e340a`.
   - So the CLI is "coming soon" (the first release with binaries) and the console is "in progress" (management).
   - If `gh api repos/lorenzh/pulse-deploy/releases --jq length` prints more than `0` when the implementer starts, a CLI release exists and "coming soon" would be false. The implementer then requests a `needs-input` hold that names the release tag. It does not reword on its own.
6. **Previews.** "See it in action" holds three static, hand-written HTML previews (status page, CLI wizard, console). They are built from tokens and existing classes and have no island. They are labelled `role="img"` like the existing hero Terminal (`home.tsx:97`).
   - The status preview is a new small static figure. It is not a second `StatusMock`: two `live-preview` islands would animate twice, and the existing mock stays the only live one.
   - The CLI and console previews show only strings that exist in the code at the pinned SHAs (facts with fixtures, below).
   - The console preview shows the first-run setup page that ships today, labelled "Preview · in progress". It shows no planned management screen, so nothing claims a feature that does not exist.
7. **Docs "Coming soon".**
   - Both repositories already have docs (console `docs/index.md`, `docs/configuration.md`, `docs/development.md`; deploy `docs/cli.md`). The condition "once they have docs" is met, so all four files are published.
   - The new last group is titled `Coming soon`. It lists these four real pages, each exactly once, with the progress state in the label.
   - No non-link entry is added, so the `NavEntry` model, `navProblems` and the pager stay unchanged.
   - The routes follow `docUrl` (`src/docs/links.ts:21-24`): `/docs/console/`, `/docs/console/configuration/`, `/docs/console/development/`, `/docs/deploy/cli/`.
8. **HTML comments in fetched Markdown.**
   - deploy `docs/cli.md:35` and `:42` hold `<!-- verify-download:start -->` and `<!-- verify-download:end -->`. They are markers for deploy's own docs test.
   - The website renderer escapes every raw HTML token (`src/docs/markdown.ts:74-76`). Without a change, both markers would show as visible text on `/docs/deploy/cli/`.
   - The markers belong in the source, so the website drops an HTML token whose whole text is one comment. Every other raw HTML stays escaped.
9. **Hosted.**
   - The console card is the fifth included card and carries `[AVAILABILITY]`.
   - The "Web console" row goes after "Checks file and API" and before "Price". Its hosted cell carries `[PARITY]`.
10. **Agents.** "No mention of agent access" applies to visitor-facing hand-written content. The rendered `index.html` and `hosted/index.html` must not match `/agent/i`. They do not today (`grep -n -i agent src/content/*.tsx` is empty). Fetched docs are out of this rule: console `docs/development.md:3` says "Conventions for agents and humans are in AGENTS.md". That is contributor text from the source repo, which the website must not edit.

## Required behavior

### Home (`src/content/home.tsx`)

**Feature grid**, `FEATURES`, exactly 15 cards in this order:

| # | icon | title | text |
|---|------|-------|------|
| 1 | `globe` | HTTP checks | unchanged |
| 2 | `lock` | TLS, TCP, DNS and domains | unchanged |
| 3 | `pulse` | Heartbeats | unchanged |
| 4 | `shield` | Quorum | unchanged |
| 5 | `calendar` | Maintenance windows | unchanged |
| 6 | `monitor` | White-label status page | unchanged |
| 7 | `grid` (new) | `Components` | `Group checks into what your users know, like Shop or API. The page then shows the components instead of single checks.` [Main.dc.html:291] |
| 8 | `rss` (new) | `Feed and badges` | `An Atom feed of incidents and SVG uptime badges for READMEs and dashboards.` [Main.dc.html:297] |
| 9 | `message` | Incident updates | unchanged |
| 10 | `bars` | Latency and SLOs | unchanged |
| 11 | `code` | Checks API | unchanged |
| 12 | `zap` (new) | `CDN-ready caching` | `The page, the feed and the badges send ETags and answer a repeat with 304. Feed and badges may be cached by a CDN for 60 seconds.` [status `docs/operation.md:109`, `:117`, `:140-142`] |
| 13 | `database` (new) | `Hot backups` | `One command writes a consistent copy of the database while the API keeps serving traffic. It never overwrites a file.` [api `docs/operation.md:112`, `:126`] |
| 14 | `bell` | Notifications | unchanged |
| 15 | `chart` | Metrics and health | unchanged |

**Status band.** The paragraph under "What your visitors see" starts with `Every component with its state written as a word,` instead of `Every check with its state written as a word,`. Everything after those words stays byte for byte.

**How it works:**
- h2: `Four small services, an optional console, one shared contract`
- lead: `Probes run the checks and post results. The API decides the state of every check and keeps the incidents. The status page and the notifier only read from it. The optional console signs you in and talks to the admin API.`
- closing paragraph: `Each of them shares <code>pulse-contract</code>: the wire types, runtime validators and a version header, so a mismatched deploy fails loudly instead of quietly.` This replaces "All four share".

**See it in action**, a new section after "How it works":
- `<section id="in-action" className="band" aria-labelledby="in-action-title">`, eyebrow `See it in action`, h2 `The page, the wizard and the console`.
- Then `<ul className="preview-grid">` with exactly three `<li>`, each holding `<figure className="card preview" data-reveal>`. In order:
  1. **Status page.**
     - Screen: `<div className="preview-screen" role="img" aria-label="Status page preview: Acme status, all systems operational. Shop up, API up, Search in maintenance.">`.
     - Its children are `aria-hidden="true"`: the name `Acme status`, the summary `All systems operational`, and three rows using the existing `state state-up` and `state state-maintenance` classes: `Shop` / `Up`, `API` / `Up`, `Search` / `Maintenance`.
     - `<figcaption>`: `<span class="tag">Available</span>` then `Status page: components with their state as a word.`
  2. **CLI wizard.**
     - Screen: `role="img" aria-label="CLI wizard preview: the first questions of pulse init."`. Its children are `aria-hidden="true"` and styled like the hero Terminal.
     - The lines, rendered from `CLI_WIZARD_PROMPTS`:
       ```
       $ pulse init
       Setup (minimal, full, demo, dev) [full]:
       Enable the status page? [Y/n]
       Enable notifications (notify)? [Y/n]
       Enable the console? [Y/n]
       …
       Probe location [default]:
       …
       ```
     - `<figcaption>`: `<span class="tag">Coming soon</span>` then `CLI wizard: the first questions of pulse init, abbreviated.`
  3. **Console.**
     - Screen: `role="img" aria-label="Console preview: the Create the owner account page of first-run setup."`. Its children are `aria-hidden="true"`.
     - Rendered from `CONSOLE_SETUP`: the title `Create the owner account`, the field labels `pulse-api URL`, `Owner email`, `Owner name`, `Password`, each over an empty decorative box, and two button-styled `<span>`s `Test connection` and `Finish setup`.
     - The preview has no `<form>`, `<input>`, `<button>` or `<a>`.
     - `<figcaption>`: `<span class="tag">Preview · in progress</span>` then `Console: first-run setup as it ships today. Check management is planned.`
- The three previews live in a new `src/content/previews.tsx` (exported component `InActionPreviews`).

**Coming next**, a new section after "See it in action" and before "Configuration":
- `<section id="next" className="band" aria-labelledby="next-title">`, eyebrow `Coming next`, h2 `What we are building now`.
- Then `<ul className="card-grid">` with exactly two `<li className="card" data-reveal>`:
  1. `<span class="tag">in progress</span>`, h3 `pulse-console`, p `A web console for pulse. Today it has first-run setup, a local owner account and password sign-in. Managing checks, components and maintenance through the admin API comes next.`, then `<a class="text-link" href="/docs/console/">Read the console docs</a>`.
  2. `<span class="tag">coming soon</span>`, h3 `pulse-deploy CLI`, p `<code>pulse init</code> asks a few questions and writes a plain Docker Compose install; <code>pulse up</code>, <code>pulse status</code> and <code>pulse down</code> run it. The code and the guide are public; the first release with binaries is coming soon.`, then `<a class="text-link" href="/docs/deploy/cli/">Read the CLI guide</a>`.

**Section order** in `HomeContent`: hero, status band, features, how, in-action, next, configuration, docs.

### Architecture (`src/content/architecture.tsx`)

- `SERVICES` gains a fifth entry, last: `{ name: "pulse-console", badge: "Optional · in progress", text: "The web console: first-run setup and sign-in today, check management over the admin API in progress." }`.
- SVG:
  - `viewBox="0 0 720 300"`.
  - A new `<rect x="285" y="232" width="150" height="60" rx="12" className="diagram-optional" />` in `diagram-box`.
  - The text `pulse-console` at `x="360" y="268"` (`textAnchor="middle"`) in `diagram-text`.
  - The path `M360 230V144` in `diagram-line`.
  - The label `admin API` at `x="372" y="192"` (`textAnchor="start"`) in `diagram-label`.
- `<desc>` becomes exactly: `The probe posts results to the API. The status page and the notifier read from the API. The optional console calls the admin API; its check management is in progress. Each service shares pulse-contract.`
- CSS (`src/styles/components.css`): `.diagram-box .diagram-optional { stroke-dasharray: 6 4; }`. Token colours only.
- The existing probe, api, status and notify texts and badges stay unchanged.

### Icons (`src/components/Icon.tsx`, `PATHS`)

- `grid: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect>'` [Main.dc.html:289]
- `rss: '<path d="M4 11a9 9 0 0 1 9 9"></path><path d="M4 4a16 16 0 0 1 16 16"></path><circle cx="5" cy="19" r="1"></circle>'` [Main.dc.html:295]
- `zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"></path>'`
- `database: '<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14a9 3 0 0 0 18 0V5"></path><path d="M3 12a9 3 0 0 0 18 0"></path>'`
- `panel: '<rect x="3" y="3" width="7" height="9" rx="1"></rect><rect x="14" y="3" width="7" height="5" rx="1"></rect><rect x="14" y="12" width="7" height="9" rx="1"></rect><rect x="3" y="16" width="7" height="5" rx="1"></rect>'`

### Facts (`src/content/facts.ts`) and fixtures

- **`CLI_WIZARD_PROMPTS`**:
  - Source comment: `Source: pulse-deploy cli/prompt.ts (askServices, askPlaces).`
  - Value, as const: `[{ question: "Setup (minimal, full, demo, dev)", hint: "[full]:" }, { question: "Enable the status page?", hint: "[Y/n]" }, { question: "Enable notifications (notify)?", hint: "[Y/n]" }, { question: "Enable the console?", hint: "[Y/n]" }, { question: "Probe location", hint: "[default]:" }]`.
  - These come from deploy `cli/prompt.ts:440-445` and `:482` at `c3e340a`. The format is `askValid` (`:126-128`, `` ` [${def}]` `` + `": "`) and `askYesNo` (`:179`, `[Y/n]` when the default is on, which it is for `full`).
- **`CONSOLE_SETUP`**:
  - Source comment: `Source: pulse-console src/pages.ts (setupOwnerPage).`
  - Value, as const: `{ title: "Create the owner account", labels: ["pulse-api URL", "Owner email", "Owner name", "Password"], actions: ["Test connection", "Finish setup"] }`.
  - These come from console `src/pages.ts:93`, `:97-100`, `:103-104` at `f320e5d`.
- **Fixtures**, byte copies at the pins that the bump writes to `docs.config.json`:
  - `test/fixtures/deploy-cli-prompt.ts.txt`: deploy `cli/prompt.ts`.
  - `test/fixtures/console-pages.ts.txt`: console `src/pages.ts`.
  - The `.txt` suffix keeps them out of `tsc` (`tsconfig.json` `include: ["src","scripts","site.config.ts"]`) and out of ESLint's TS globs. Biome already skips `**/test/fixtures` (pinned config `biome.json:16`).
- **`src/content/facts.test.ts`** gets two tests:
  - Each `question` appears in the deploy fixture as the literal `"<question>"`. The fixture also contains `"Setup (minimal, full, demo, dev)", "full"` and `"Probe location", "default"`.
  - The console fixture contains `"Create the owner account"`, `label: "<label>"` for each label, and `><action></button>` for each action.

### Hosted (`src/content/hosted.tsx`)

- `INCLUDED` gains a fifth card, last:
  - icon `panel`
  - title `The same open-source console`
  - text `<>Planned: the pulse-console you can run yourself, connected to your hosted API. Check management in the console is still in progress. <Placeholder name="AVAILABILITY" /></>`
- The comparison table gains a row between "Checks file and API" and "Price":
  - `<th scope="row">Web console</th>`
  - `<td>Optional pulse-console; check management in progress</td>`
  - `<td>Planned, the same console <Placeholder name="PARITY" /></td>`
- The waitlist form, the plans and all other text stay unchanged.

### Docs

- **`src/docs/bump.ts`**:
  - `DOC_REPOS` gains `console: "lorenzh/pulse-console"` and `deploy: "lorenzh/pulse-deploy"`, in that order after `kit`.
  - The doc comment says eight repositories.
  - `DOC_FILE` (`/^docs\/(?:channels\/)?[a-z0-9-]+\.md$/`) already accepts all four files. Leave it as it is.
- **`docs.config.json`**: run `bun run docs:bump console deploy` (`scripts/bump-docs.ts` takes keys from argv). Do not hand-edit it and do not bump the other six. Expected result:
  - `console`: `files: ["docs/configuration.md","docs/development.md","docs/index.md"]`.
  - `deploy`: `files: ["docs/cli.md"]`.
  - The SHA is whatever main is at bump time. At planning, console was `f320e5d59703b654e6cc573b7e7f636598e20624` and deploy was `c3e340a17ec16a9a983c6f069e10aaf24431fdde`.
- **`src/docs/nav.ts`**: append a last group:
  ```ts
  {
    title: "Coming soon",
    entries: [
      e("Console · in progress", "console", "docs/index.md"),
      e("Configuration · console", "console", "docs/configuration.md"),
      e("Development · console", "console", "docs/development.md"),
      e("pulse CLI · coming soon", "deploy", "docs/cli.md"),
    ],
  },
  ```
  Extend the header comment by one line: the group holds real pages of tools that are not released yet.
- **`src/docs/markdown.ts`**: the `html` renderer returns `""` for a token whose `text.trim()` is exactly one HTML comment. That means:
  - it starts with `<!--`;
  - it ends with `-->`;
  - the first `-->` at or after index 4 is the final one;
  - its length is at least 7.

  Any other text is escaped as before. Write it as a small exported pure function, `isOnlyComment(text: string): boolean`. Use string methods, not a backtracking regex: SonarJS `super-linear-regex` is active in the pinned ESLint config.
- Links in the new pages need no change:
  - `../AGENTS.md` and `../README.md#http-endpoints` resolve to GitHub blob URLs at the pin (`links.ts:69-79`).
  - Absolute GitHub URLs stay external.

### README (`README.md`)

- Line 55: "each of the six repos (`api`, `probe`, `status`, `notify`, `contract`, `kit`)" becomes eight repos with `console` and `deploy`.
- Add one sentence each on:
  - the "Coming soon" docs group;
  - comment-only HTML tokens being dropped by the renderer;
  - the two new fixtures.

## Risks

- **Upstream docs break the link check.** If a new page has a link or anchor that `check:links` rejects, the fix belongs in console or deploy. The implementer requests a `needs-input` hold that names the page and link. It does not patch generated docs or weaken the check.
- **Main moves before the bump.** New files on console or deploy main would make the build fail with "published but not in the nav". The implementer adds them to the "Coming soon" group with a unique label and names them in the PR. Facts fixtures must come from the same SHAs as the bump.
- **A CLI or console release appears.** See decision 5: hold `needs-input`.
- **Budget.** Home grows by four cards, five icons, a fifth service, two sections and three small previews: roughly 6–8 KB of raw HTML, about 2 KB gzip. Each docs page's sidebar grows by four links. The CLI guide (251 lines, about 15 KB of Markdown) is the largest new page. All of this stays well under `htmlBytes: 60000` (`budget.json:2`); CSS grows by well under 1 KB against `cssBytes: 20000` (`budget.json:3`). `check:budget` is the gate, and `budget.json` must not change.
- **Mobile layout.** The diagram is hidden below 720 px (`components.css:610-622`), and the service list carries the console there. `preview-grid` must collapse to one column like `feature-grid` (`components.css:365-380`). `check:a11y` checks overflow at mobile widths on every page.
- **Network.** `docs:bump` and `build` need github.com, api.github.com and raw.githubusercontent.com. `GITHUB_TOKEN` is used when set.

## Performance impact

None expected for the api `bench/budgets.json` metrics: startup CPU, load CPU, idle and peak RSS, test CPU, build CPU, and the reported wall-clock startup, p95 latency, requests per second and image size. The change touches only the static website. No api code, image or dependency changes.

On the website side, the page sizes move as described under "Risks". The implementer:
- runs `bun run build && bun run check:budget` before the change (on `main`) and after it;
- writes the gzip size of `dist/index.html`, `dist/hosted/index.html` and `dist/docs/deploy/cli/index.html` and the CSS bundle into the PR, before and after;
- expects every page to stay ≤ 60000 B gzip HTML and the CSS ≤ 20000 B (`budget.json:2-3`).

## Security impact

Security impact: yes. The change alters how the website renders fetched, untrusted Markdown: comment-only HTML tokens are now dropped instead of escaped.

Checklist items that apply:
- **Input validation.**
  - Only a token that is exactly one complete comment is dropped. Everything else, including a comment followed or preceded by any other markup, stays escaped.
  - The test feeds the hostile inputs listed under "Counterexamples".
  - The rendered HTML of each must contain no `<script`, `<img` or `<!--` outside escaped text.
- **Links.** `url-safety.ts` and `resolveLink` stay unchanged. The two new repos go through the same `isSafeUrl` check, and the new hand-written links are in-site paths.
- **Secrets in responses.** Nothing secret is added. The console preview shows field labels only, never values. The CLI preview shows no token or secret prompt.

No auth, probe client, Dockerfile, CI or dependency change. The CSP meta tag and its policy stay unchanged, and the new markup has no `style` attribute, no `<style>` and no inline script.

## Rollout order

One repository: only `website` changes. It reads console and deploy `main` at pinned SHAs that already exist. No service consumes the website, so no older consumer is affected.

## Counterexamples

- **Card count and order.**
  - A grid of 14 or 16 cards fails the count of 15.
  - "Components" after "Incident updates" fails the order check.
  - "Hot backups" after "Notifications" fails it too.
  - "Feed and badges" before "Components" fails it too.
- **Card copy.**
  - `RSS feed` or `an RSS feed` instead of `An Atom feed` fails. Status serves Atom only (status `docs/operation.md:104`).
  - `cached for 5 minutes`, or a claim that every answer is publicly cached, fails the literal text check.
  - A Hot backups text that promises "scheduled" or "off-site" backups fails the literal text check.
- **Status text.**
  - `Every check with its state` still present fails.
  - Rewording the privacy sentence fails the existing v27 assertion `Only check targets \(URLs\) and error details\s+stay private by default\.`.
- **Architecture.**
  - Four `<rect` in `diagram-box` fails (expect exactly 5).
  - A desc that still says `All four share` fails.
  - A console box without `diagram-optional` fails.
  - A service list of 4 items fails (expect exactly 5 `service-name` spans).
- **Previews.**
  - A second `data-island="live-preview"` on Home fails (expect exactly 1).
  - Any `<input`, `<button`, `<form` or `<a ` inside the `in-action` section fails.
  - A preview without its tag text (`Available`, `Coming soon`, `Preview · in progress`) fails.
  - A CLI preview line that is not in the deploy fixture, for example `Enable the dashboard? [Y/n]`, fails the facts test.
- **Coming next.**
  - A `href="#"`, a github.com releases URL or a download link in the `next` section fails. Expect exactly the two hrefs `/docs/console/` and `/docs/deploy/cli/`.
  - Any four-digit year or month name in the section (a date) fails: `/\b20\d\d\b|January|February|March|April|May|June|July|August|September|October|November|December/` must not match.
- **Text links.** The existing test "the two text links …" expects 2 `<a class="text-link"`. It must become exactly 4. A third Coming-next link, or a lost one, fails.
- **Hosted.**
  - A console card or "Web console" hosted cell without `<mark class="placeholder">[` fails "every hosted promise carries a placeholder". That test's bounds are raised to `cells.length >= 7` (rows) and `cards.length >= 5`, so dropping the new row or card also fails.
  - A new placeholder name such as `[CONSOLE]` is rejected by this spec, and the hosted test asserts only the 16 known names.
  - A `<form` with `action=` or `method=`, or an `<input` or `<button` without `disabled`, fails the existing waitlist tests.
- **Agents.** `/agent/i` matching `dist/index.html` or `dist/hosted/index.html` fails.
- **Nav.**
  - Listing `deploy:docs/cli.md` twice, or omitting `console:docs/development.md`, fails `navProblems` and the build.
  - Reusing the label `Configuration · api` for the console page fails the unique-label check.
  - Putting the group anywhere but last fails the nav test. The literal expectation is that `NAV.at(-1).title === "Coming soon"` and that `neighbours("console","docs/index.md").previous.label === "Development · notify"`.
- **Comment dropping.** Inputs and the required rendering:
  - `<!-- verify-download:start -->` → `""`.
  - `<!--x-->` → `""`.
  - `<!-- a --><script>alert(1)</script>` → escaped, contains `&lt;script&gt;`.
  - `<!-- a -- > <img src=x onerror=alert(1)>` (no closing `-->`) → escaped.
  - `<!-- a --> text <!-- b -->` → escaped, because there are two comments.
  - `<!-->` → escaped (length 5).
  - `<b>x</b>` → escaped, as before.
- **Pins.**
  - A `console` or `deploy` SHA that is not the `git ls-remote` main at bump time fails acceptance check 2.
  - Bumping `api` (or any of the other six) along with them fails acceptance check 3.
- **No statistic** is computed by this change. "60 seconds" and "304" are copied facts with named sources.

## Contract fields

No new names in contract or config. The new identifiers are website-internal. Searches run at planning time (website `7d17f14`), from the meta root:
- New exports, files, CSS classes, section IDs and the nav group title. Each line returns 0 matches:
  ```
  for n in isOnlyComment InActionPreviews CLI_WIZARD_PROMPTS CONSOLE_SETUP \
           in-action in-action-title next-title preview-grid preview-screen \
           diagram-optional previews.tsx 'Coming soon'; do
    grep -rn -F -- "$n" .repos/contract/src .repos/config .repos/website/src \
      .repos/website/scripts .repos/website/site.config.ts --exclude-dir=node_modules | wc -l
  done
  ```
- Section ID `next`: `grep -rn -E 'id="next"|"#next"' .repos/contract/src .repos/config .repos/website/src --exclude-dir=node_modules` returns nothing.
- CSS class `preview` (on `<figure className="card preview">`): `grep -rn "preview" .repos/website/src/styles` returns nothing. The existing ID `preview-title` (status band) and the island name `live-preview` (`src/build/assets.ts:13`) are different names and stay as they are.
- The full list of `id=` values in `src/content/*.tsx` and `src/components/*.tsx` today is: `arch-arrow`, `arch-desc`, `arch-title`, `compare-title`, `docs-nav`, `docs-title`, `faq`, `faq-title`, `features`, `features-title`, `how`, `how-title`, `included-title`, `main`, `oss`, `plans`, `plans-title`, `preview-title`, `site-nav`, `start-title`, `waitlist`, `waitlist-email`, `waitlist-note`, `waitlist-title`. None of `in-action`, `in-action-title`, `next`, `next-title` is in it.
- `grep -n -E "^\s+(grid|rss|zap|database|panel):" .repos/website/src/components/Icon.tsx` returns nothing, so the five icon keys are free.
- `grep -n -E '"(console|deploy)"' .repos/website/docs.config.json .repos/website/src/docs/*.ts` returns nothing, so the two docs keys are free.
- No new route in any service. The new site routes `/docs/console/`, `/docs/console/configuration/`, `/docs/console/development/` and `/docs/deploy/cli/` do not exist in `dist/` today, because `docs.config.json` has no `console` or `deploy` key.

## Repository: website

Files:
- `src/content/home.tsx`
- `src/content/previews.tsx` (new)
- `src/content/architecture.tsx`
- `src/content/hosted.tsx`
- `src/content/facts.ts`
- `src/components/Icon.tsx`
- `src/styles/components.css`
- `src/docs/bump.ts`
- `src/docs/nav.ts`
- `src/docs/markdown.ts`
- `docs.config.json` (written by `bun run docs:bump console deploy` only)
- `test/fixtures/deploy-cli-prompt.ts.txt` (new), `test/fixtures/console-pages.ts.txt` (new)
- `src/content/home.test.ts`, `src/content/hosted.test.ts`, `src/content/facts.test.ts`, `src/docs/bump.test.ts`, `src/docs/nav.test.ts`, `src/docs/markdown.test.ts`
- `README.md`

Behavior change: yes. The site shows new sections, cards, docs pages and Hosted content, and the renderer drops comment-only HTML.

Behavior: as in "Required behavior" above.

Tool facts (verified at website `7d17f14`):
- **Bun 1.4.0**: `package.json:8` (`packageManager`) and `:10` (`engines`). CI job `site` uses `bun-version: 1.4.0` (`.github/workflows/ci.yml:28`), and the shared check job does too (pinned config `.github/workflows/check.yml:24`).
- **Biome 2.6.3**: `package.json:38`.
  - The website `biome.json:2` extends `@lorenzh/pulse-config/biome.json` at pin `86896e9ff02e6458e431aa3417ee81d3b1cbc335` (`package.json:39`).
  - That pinned file excludes `!**/*.html` and `!**/test/fixtures` (pinned `biome.json:15-16`). The website adds `!**/.build`, `!**/.cache`, `!**/.repos` and `!**/src/styles/tokens.css` (`biome.json:4`).
  - The pinned file equals the config clone on main (`diff` empty).
- **Lint**: `biome check . && pulse-eslint .` (`package.json:22`).
  - `pulse-eslint` is the bin of the pinned config (pinned `package.json:11-12`). It passes no `--config` when a local `eslint.config.js` exists (pinned `bin/pulse-eslint.js:8-9`, `:20-24`). The website has one, so the local file is used. The pinned bin equals the clone.
  - Local `eslint.config.js:1` imports `@lorenzh/pulse-config/eslint.config.js`, and `:3` adds only `ignores: [".repos/**", ".build/**", ".cache/**"]` before `...base`. It does not ignore `test/fixtures`.
  - Pinned `eslint.config.js` (equals the clone): `:7` ignores `**/dist/**`, `**/node_modules/**`, `**/public/**`, `**/coverage/**`. `:10-17` apply `sonarjs.configs.recommended` with `cognitive-complexity` 15 to `files: ["**/*.ts", "**/*.js"]` (`:11`). `:13` sets `reportUnusedDisableDirectives: "error"`. `:20-51` add the type-aware `@typescript-eslint` rules for `**/*.ts` only.
  - Consequences: `.tsx` files (`home.tsx`, `previews.tsx`, `hosted.tsx`, `architecture.tsx`, `Icon.tsx`) are not in an ESLint glob and are checked by Biome only. `markdown.ts`, `facts.ts`, `bump.ts`, `nav.ts` and all `*.test.ts` are. A `.txt` fixture matches no ESLint glob.
  - `sonarjs/super-linear-regex` is active: the plugin is `eslint-plugin-sonarjs@4.2.2` (`bun.lock:143`, `:257`), and the repo carries working `eslint-disable-next-line sonarjs/super-linear-regex` directives (`src/docs/markdown.ts:28`, `src/content/hosted.test.ts:30`, `:35`) that would fail lint as unused under pinned `:13` if the rule were off. A new test regex over generated HTML needs the same directive with a reason, or a string method instead.
- **Typecheck**: `bun node_modules/typescript7/bin/tsc --noEmit` (`package.json:20`). `tsconfig.json:2` extends `@lorenzh/pulse-config/tsconfig.base.json`, and `:8` sets `"include": ["src", "scripts", "site.config.ts"]`. The pinned base (equals the clone) has no `include` and sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax` (pinned `tsconfig.base.json:8-13`). `test/fixtures/*.txt` lies outside `include` and is not a TypeScript file.
- **Tests**: `bun test` (`package.json:21`), with `coverage = true` and `coverageThreshold = { lines = 0.8, functions = 0 }` (`bunfig.toml:3-4`).
- **CI**:
  - Job `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@86896e9…` with no `with:` (`ci.yml:16-17`). So `build` defaults to `false` (pinned `check.yml:6-9`), and the job runs install, lint, typecheck and test (pinned `check.yml:25-38`). The pinned file equals the clone.
  - Job `site` runs `bun install --frozen-lockfile`, `bunx playwright install --with-deps chromium`, `bun run build`, `check:links`, `check:budget` and `check:a11y` (`ci.yml:29-35`).
- **`check:all`** = `check` + `check:site` (`package.json:19`, `:26`). `docs:bump` is `bun scripts/bump-docs.ts` (`package.json:15`).
  - `scripts/bump-docs.ts:36` reads the keys from `process.argv.slice(2)` and drops `--`. `:37` falls back to all of `Object.keys(DOC_REPOS)` only when no key is given, so `docs:bump console deploy` touches only those two.
  - `:39` resolves each key with `repoForKey` from `src/docs/bump.ts`, so `console` and `deploy` must be in `DOC_REPOS` before the bump runs.
  - `:40-45` take the SHA from `git ls-remote https://github.com/<repo>.git refs/heads/main`. `:46-49` read the docs file list and commit date from the GitHub API at that SHA. `:50` merges the entry with `withRepo`, and `:53` writes `docs.config.json` once at the end.
  - `withRepo` (`src/docs/bump.ts:64-74`) spreads the existing `repos`, sets only the given key, and orders the result by `DOC_REPOS` order. So the six existing entries stay byte-equal, and `console`, `deploy` land after `kit`. An unknown key throws in `repoForKey` (`src/docs/bump.ts:18-26`).

Steps:
1. `bun install --frozen-lockfile`. Check `gh api repos/lorenzh/pulse-deploy/releases --jq length` (decision 5).
2. Write the failing tests first (red), then add `console` and `deploy` to `DOC_REPOS`.
3. Run `bun run docs:bump console deploy` and record the `git ls-remote` output of both repos in the PR.
4. Copy the two fixtures from the SHAs now in `docs.config.json` (`curl -fsS https://raw.githubusercontent.com/<repo>/<sha>/<path>`).
5. Make the facts, nav, renderer, icon, CSS and content edits.
6. Run `bun run check:all`.

Tests (assert literals from this spec, never values read from the content arrays under test):
- `home.test.ts`, new test "issue 575 content":
  - the four new title+text pairs as `<h3 class="t-h3">T</h3><p>X</p>`;
  - the order White-label status page < Components < Feed and badges < Incident updates < Checks API < CDN-ready caching < Hot backups < Notifications, by `indexOf`;
  - exactly 15 cards in the feature grid (the old literal `11` becomes `15`);
  - the five SVG icon strings;
  - `Every component with its state written as a word,` present and `Every check with its state` absent;
  - the new h2, lead and `Each of them shares` sentence;
  - 5 `<rect` in the `diagram-box` group, the `diagram-optional` class, `pulse-console` in the SVG, the exact desc, and 5 `service-name` spans;
  - the `in-action` section: three `<figure class="card preview"`, three `role="img"` screens with the exact aria-labels, the three tag texts and captions, the CLI lines and console strings written above, and no `<input|<button|<form|<a ` inside the section;
  - exactly one `data-island="live-preview"` on the page;
  - the `next` section: both cards with tags, titles, texts and exactly the hrefs `/docs/console/` and `/docs/deploy/cli/`, and no date pattern;
  - section order by `indexOf`: `id="how"` < `id="in-action"` < `id="next"` < `id="start-title"`;
  - `/agent/i` does not match;
  - the text-link count changes from 2 to 4.
- `hosted.test.ts`:
  - the exact card text with `<mark class="placeholder">[AVAILABILITY]</mark>`;
  - `<th scope="row">Web console</th><td>Optional pulse-console; check management in progress</td><td>Planned, the same console <mark class="placeholder">[PARITY]</mark></td>`;
  - the row sits after `Checks file and API` and before `<th scope="row">Price</th>`;
  - the bounds in "every hosted promise carries a placeholder" become rows `>= 7` and cards `>= 5`;
  - `/agent/i` does not match.
- `facts.test.ts`: the two fixture tests above.
- `bump.test.ts`: `Object.keys(DOC_REPOS)` deep-equals the literal `["api","probe","status","notify","contract","kit","console","deploy"]`. The "constructor key after the six known keys" test is updated to eight.
- `nav.test.ts`: the last group equals the literal shown above (title, labels, repo keys, files) and the `neighbours` expectation from "Counterexamples". The existing "every published file is in the nav exactly once" test runs against the bumped `docs.config.json`.
- `markdown.test.ts`: every comment-dropping case from "Counterexamples", through `renderMarkdown` (`markdown.ts:64`) and through `isOnlyComment`.

Acceptance evidence. The expected values are literals in this spec or independent sources:
1. `bun run check:all` exits 0: lint, typecheck, tests with ≥ 80 % line coverage, build, `check:links`, `check:budget`, `check:a11y`. CI jobs `check` and `site` are green.
2. In `docs.config.json`, `repos.console.sha` and `repos.deploy.sha` equal the hash printed by `git ls-remote https://github.com/lorenzh/pulse-<name>.git refs/heads/main` at bump time (independent source, pasted into the PR). `repos.console.files` equals the literal `["docs/configuration.md","docs/development.md","docs/index.md"]` and `repos.deploy.files` equals `["docs/cli.md"]`, unless main gained a docs file (risk above, named in the PR).
3. `git diff main -- docs.config.json` changes no line inside the six existing repo entries. Their SHAs stay `11f5555…`, `9674e51…`, `b01a1ab…`, `584eabd…`, `ebcbbb6…` and `6a06ec2…`.
4. Each new fixture is byte-equal to upstream at the pinned SHA: `curl -fsS https://raw.githubusercontent.com/lorenzh/pulse-deploy/<sha>/cli/prompt.ts | cmp - test/fixtures/deploy-cli-prompt.ts.txt`, and the same for console `src/pages.ts`.
5. After the build, these files exist: `dist/docs/console/index.html`, `dist/docs/console/configuration/index.html`, `dist/docs/console/development/index.html` and `dist/docs/deploy/cli/index.html`. Each contains `<p class="side-title">Coming soon</p>` and `Generated from <a href="https://github.com/lorenzh/pulse-`. `grep -c 'verify-download' dist/docs/deploy/cli/index.html` prints `0`. Every docs page contains the four labels from the nav literal above.
6. `dist/index.html` and `dist/hosted/index.html` contain every literal from "Required behavior". `grep -ci agent` on both prints `0`. `grep -c '<form[^>]*\(action\|method\)=' dist/hosted/index.html` prints `0`.
7. `check:budget` reports every page ≤ 60000 B gzip HTML and CSS ≤ 20000 B. The literals are in `budget.json:2-3`, and `git diff --exit-code main -- budget.json` is empty.
8. `git diff --exit-code main -- biome.json tsconfig.json eslint.config.js budget.json bunfig.toml .github` is empty: no gate is weakened.
9. `check:a11y` covers every `dist/` page automatically (`scripts/check-a11y.ts:24`), including the four new docs routes. It runs axe, light and dark, mobile overflow, no-JS, CSP and the external-request block. The PR names that it passed with those routes in its output.
