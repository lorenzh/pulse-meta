# Spec: pulse website (home, generated docs, hosted plans)

Issue: lorenzh/pulse-meta#348. Review: `issue-review.md` (18 non-blocking points, all settled below).

## Goal

A static pulse website in `lorenzh/pulse-website` (target `website`), built from `design/website/`: home, docs generated from the pulse repos' `docs/*.md`, the REST API reference, and the hosted plans page with placeholders. Build and CI only.

## Scope

- One new project in one repository: `website`. Nothing else in a target changes. No product repo needs a change (docs are read at pinned SHAs as they are).
- In meta, a separate PR (not part of this spec's child issue) adds the packages to `docs/approved-packages.md` (see Order).

## Non-goals

Deployment, domain, analytics or tracking, waitlist backend, search (the design's "Search the docs" box is left out), blog, edits to the docs of other repos.

## Order and the approved-packages PR

1. A person (or a separate meta feature) opens a PR here that adds to `docs/approved-packages.md`, each with exact version, licence, runtime deps, reason:
   - `preact` (MIT, no deps): the only code shipped to the browser (islands, with its `compat` layer).
   - `react`, `react-dom` (MIT): build-time only, `renderToStaticMarkup`; never shipped.
   - `marked` (MIT, no runtime deps): build-time Markdown to HTML for docs. Reason: GFM tables, fences, nested lists and reference links are too much for "a few lines in pulse-kit". Raw HTML in Markdown is escaped by a renderer override. Syntax highlighting is a small own tokenizer (json, yaml, bash only), no package.
   - The two fontsource packages are already approved at `5.3.0`; the website pins them exactly.
2. Dev-only tooling is not covered by the list (it covers runtime deps) but is named in the website README with exact pins: `esbuild` (bundle islands, compile TSX for the build), `@playwright/test` and `@axe-core/playwright` (a11y and keyboard), `typescript`, Biome, `lefthook`, `@lorenzh/pulse-config` (pinned to a full SHA like the siblings).
3. The website task may be started in parallel. It must not merge before the packages PR is merged. `targets.json` lists only `website`; the meta PR is outside it.

## Decisions

- **Node 24, not Bun.** Reason: the siblings and `pulse-config` are Node 24; type stripping runs the build scripts (`.ts`, erasable syntax). JSX files are compiled by esbuild into `.build/` and run from there. No concrete need for Bun.
- **Test runner** `node:test` with the 80 % line coverage gate like the siblings (config `test` script pattern, `src/**/*.test.ts` and `scripts/**/*.test.ts`). No Vitest. Playwright is used only for the browser checks (a11y, keyboard, no network), run as a separate script, not in the coverage gate.
- **CI.** The shared `check.yml` runs `npm ci`, `lint`, `typecheck`, `test` only (its `build` input only checks that `dist` is committed, which is wrong here: `dist/` is ignored). So `.github/workflows/ci.yml` has job `check` (uses `lorenzh/pulse-config/.github/workflows/check.yml@<SHA>` as in the siblings) and a second job `site` (Node 24, `npm ci`, `npx playwright install --with-deps chromium`, `npm run build`, `npm run check:links`, `npm run check:budget`, `npm run check:a11y`). Docs are fetched in `site` at the pinned SHAs (public repos, `GITHUB_TOKEN` not needed). No change to `pulse-config`.
- **Slug scheme** `/docs/<repo>/<page>/` with the repo short name (`api`, `probe`, `status`, `notify`, `contract`, `kit`); `notify` channels `/docs/notify/channels/<name>/`. `/docs/` renders (not redirects) the quick start, same content as `/docs/api/install/`, with `<link rel="canonical">` to the latter. The REST API page is `/docs/api/rest-api/`. Trailing-slash directories (`index.html`), so any static host works.
- **`SITE_URL`** is read from `site.config.ts` with the default `https://pulse.example` (placeholder, marked in README); used for `sitemap.xml`, canonical and `og:url`. No deployment exists.
- **Hosted prices** all become placeholders; the monthly/yearly toggle is dropped (nothing to toggle). Islands stay: theme toggle, mobile menu, docs-navigation toggle, copy button for code blocks.

## Required behavior (website)

### Stack and layout
`src/` pages (TSX components, one per page), `src/components`, `src/islands` (Preact, hydrated), `src/styles` (CSS from tokens), `src/docs` (fetch, parse, render, link rewrite), `scripts/` (`build.ts`, `bump-docs.ts`, `check-links.ts`, `check-budget.ts`, `check-a11y.ts`), `docs.config.json`, `budget.json`, `site.config.ts`, `public/` (favicon SVG, `robots.txt` template), `dist/` (ignored). A `react` → `preact/compat` alias applies to island bundles only; the server render uses real React. Every page renders without JavaScript; an island ships only where the page contains one. Fonts: the two fontsource packages, latin subset files only, copied to `dist/assets/fonts/`, `font-display: swap`, `@font-face` written by us (not the fontsource CSS that pulls every subset).

### Design and theme
Colours (light, dark), type styles, spacing and radii come from `design/website/losoft-tokens.json`: a build step (`scripts/tokens.ts`) generates `src/styles/tokens.css` from a copy of the JSON committed as `design/losoft-tokens.json` in the website repo; a test fails if the CSS and the JSON disagree. Fluid sizes `--fs-*`, the terminal block, the status page mock (static HTML, with text alternative), the architecture diagram (inline SVG with `<title>`/`<desc>` and a text list). Theme: `prefers-color-scheme` by default, the toggle stores `light`/`dark` in `localStorage`; a tiny inline script in `<head>` sets `data-theme` before paint (inline script hash is fixed; no CSP header exists yet, so this only matters for later). Interactive targets are at least 44 × 44 px. Layout works at 360 px.

### Docs generation
- `docs.config.json`: `{ "repos": { "api": { "repo": "lorenzh/pulse-api", "sha": "<40 hex>", "files": [...] }, ... } }`, the only place with SHAs. The build reads these and nothing else; it fetches `https://raw.githubusercontent.com/<repo>/<sha>/<path>` (build-time network only), caches in `.cache/docs/<repo>/<sha>/` (ignored), fails on a non-200, bad SHA format or empty file. Unit tests use fixtures and a fake `fetch` passed in.
- Published files: every `docs/*.md` and `docs/channels/*.md` of the six repos at the pinned SHA. Listing is in config (`files`), not guessed, so a new upstream file is a visible bump diff. The README of a repo is used only if the design needs it: it does not, so no README is published.
- `scripts/bump-docs.ts` (`npm run docs:bump [-- <repo>]`) resolves `main` HEAD per repo with `git ls-remote https://github.com/<repo>.git refs/heads/main`, lists `docs/` of that SHA via the GitHub tree API (unauthenticated, `GITHUB_TOKEN` optional), and rewrites `docs.config.json` (stable key order, one line per file). Pure parts are tested.
- Sidebar groups as in `Docs.dc.html`, entries follow the real files:
  - **Getting started**: Overview (api `index.md`), Quick start (api `install.md`; the Docker-free part of the install doc is part of the same page, so no separate "Install without Docker" entry unless the file has its own page), Concepts (api `concepts.md`; "Check states", "Quorum and incidents", "Maintenance windows", "Heartbeats" are headings of this page, shown in "On this page", not separate entries).
  - **Configuration**: api `configuration.md` (covers `checks.json`, `tokens.json`, env vars), probe `configuration.md`, status `configuration.md`, status `theming.md` ("Status page theming"), notify `configuration.md`, notify `channels.md` and `channels/*.md` ("Notification channels").
  - **Reference**: REST API (api `rest-api.md`), contract `index.md`, kit `index.md`. No "Metrics" entry unless a source file has a section for it; drop otherwise.
  - **Operation**: api `operation.md` ("Upgrades and backup" is a section of it), probe/status/notify `operation.md`, `troubleshooting.md` of each, `development.md` of each, `install.md` of probe/status/notify.
  - The implementer verifies each entry against the pinned files and records the entry → file mapping in `src/docs/nav.ts` (data, tested for "every published file is in the nav exactly once and every nav entry exists"). Entries are labelled with the repo where a title would collide ("Configuration · probe").
  - The "Search the docs" box is omitted.
- Page layout per design: sidebar (collapsible island on phones, a plain `details` fallback without JS), breadcrumb, title (first `# ` heading), "On this page" (h2 and h3, GitHub-style ids with `-1` suffixes for duplicates), previous/next within the nav order, "Edit this page on GitHub" (`https://github.com/<repo>/edit/main/<path>`; the pinned blob URL is used for "Generated from" and for unpublished links), "Generated from `<file>` in `<repo>`" as in `DocsApi.dc.html`, "Updated" date taken from the pinned SHA commit date (config stores `date` written by the bump script, so the build stays offline-deterministic).
- Link rewriting (`src/docs/links.ts`, tested): relative `.md` link to a published file → site URL (+ anchor); `../../<other repo>/...`-style or `../` links to any other file → `https://github.com/<repo>/blob/<sha>/<path>`; `http(s)` stays, external links get `rel="noopener"`; image links resolve to GitHub raw only if images are published (none are: render as link). A `#anchor` is checked against the target's heading ids; a dangling anchor fails the build.
- Renderer: `marked` with raw HTML escaped, headings with ids, tables wrapped in a focusable scroll region (`tabindex="0"`, `role="region"`, label), code blocks with `<pre>` + copy button island, language tokens for json/yaml/bash, task lists and blockquotes, "Warning/Note" blockquote styles as in the design.


### Licensing (added by the approver, decided by the owner)
- Code (build, components, scripts, styles): MIT; the existing `LICENSE` stays.
- Generated docs: MIT, as in their source repos; each generated page names its source file and repo.
- Hand-written content (home and hosted text, illustrations; keep it in one folder such as `src/content/`): CC BY 4.0, in a `LICENSE-content` file with the full licence name and link.
- The names "pulse" and "losoft" and their logos are not licensed (all rights reserved); `LICENSE-content` and the README say so.
- Fonts keep their OFL-1.1 licence from the `@fontsource-variable` packages.
- README "License" section with these points; the footer reads "Code MIT · Content CC BY 4.0" with links.

### Pages
- **Home** `/` from `Main.dc.html`: hero with the terminal block, status mock, architecture diagram, how it works, quick start teaser, link to hosted and docs, footer. All product facts are written against these sources (each is a constant in `src/content/facts.ts` with its source path in a comment, and a test that reads the pinned docs fixture or the repo list and checks the claims that can be machine-checked, such as env var names and ports in `install.md`):
  - check types, `checks.json` example: pulse-contract `src/` check schema and `checks.example.json` in pulse-api (the sample on the page must be a prefix-valid copy of the example or validated with the contract's parser in a script test; prefer copying the example from the pinned file).
  - channels: pulse-notify `docs/channels.md` (Slack, Teams, email, webhook, file; the design lists four, we list five).
  - endpoints: api `docs/rest-api.md`; env vars and ports (`PULSE_PROBE_TOKEN`, `PULSE_LOCATION`, `PULSE_API_PORT` 3000, `PULSE_STATUS_PORT` 8080, `http://localhost:8080`) and commands: api `docs/install.md` and `compose.yaml`.
  - Docker claim: "one Compose file" is kept only if `compose.yaml` in pulse-api still starts api, probe, status, notify together; the implementer checks it and rewords otherwise.
  Where the design and the code differ, the code wins.
- **Docs** `/docs/…` as above; `/docs/` and `/docs/api/rest-api/` are the two designed pages.
- **Hosted** `/hosted/` from `Hosted.dc.html`: every price, regional claim, trial term, availability date, data location, open-source plan term, `status.losoft.dev` and number-in-comparison-row becomes a visibly marked placeholder (`<mark class="placeholder">[PRICE]</mark>`, `[REGIONS]`, `[TRIAL]`, `[DATA_LOCATION]`, `[OSS_TERMS]`, `[STATUS_URL]`, `[AVAILABILITY]`, `[LIMIT]`), with a note "These details are not decided yet." The true facts stay: self-hosted pulse is free and MIT. The waitlist form renders with disabled fields and button and visible text "Sign-up is not open yet. Nothing you type is sent anywhere."; no `action`, no `method` to a URL, no script that sends. A test fails if the built hosted HTML contains `€`, `$`, a digit-price pattern, `status.losoft.dev` or a form `action`.
- **404** `404.html` with navigation, noindex.
- **Per page meta**: `<title>`, `description`, `og:title`, `og:description`, `og:type`, `og:url`, `twitter:card=summary`, canonical; no `og:image` (none exists; noted in README). Docs descriptions are the first paragraph (truncated at 160 chars). `lang="en"`. Skip link first in `<body>`, visible `:focus-visible` outline from tokens.
- `sitemap.xml` lists every page but `404.html`; `robots.txt` allows all and names the sitemap. Both use `SITE_URL`.

### Checks
- `npm run check` = `lint && typecheck && test` (like siblings, used by `check.yml`). `npm run check:site` = `build && check:links && check:budget && check:a11y`. `npm run check:all` runs both; the PR is done when it passes.
- **Links** (`check-links.ts`, offline): parse each `dist/**/*.html`; every internal `href`/`src` resolves to a file in `dist`, every `#fragment` exists as an id in the target page; external `https://github.com/...` links are only counted, not fetched. Also fails if `dist` HTML references another origin in `src`, `<link href>`, `<script>`, `@import`, `url()` or `form action` (no external requests at runtime); the check has a test with a failing fixture.
- **Budget** (`budget.json`): per page HTML ≤ 60 kB, CSS ≤ 20 kB, JS ≤ 30 kB, all gzip, fonts reported but excluded (≤ 2 files per family loaded per page); adjusted only with a stated reason in the PR. Pages with no island ship 0 JS.
- **A11y** (`check-a11y.ts`, Playwright Chromium against `dist` served by a tiny local static server on `127.0.0.1`): axe `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa` on every page, light and dark, at 360 px and 1280 px, zero violations; with network blocked (route abort for any non-local URL) zero failed or external requests; with JavaScript disabled a page renders its main content; keyboard: first Tab lands on the skip link, it moves focus to `main`; menu and docs navigation open and close with keyboard and Escape; every focusable element has a visible focus style; interactive targets measure ≥ 44 px (assertion on bounding boxes for buttons, nav and sidebar links, inline links in text excepted as WCAG allows).
- **Unit tests** cover: tokens CSS generator, theme script, docs fetch and cache (fake fetch), config validation, bump script parsing, Markdown rendering (escape of raw HTML, ids, tables), link rewriting, nav completeness, previous/next, meta generation, sitemap, hosted placeholder test, facts test, budget calculation.

### Repository documents
- `README.md`: what it is, commands, layout, how docs are pinned and bumped (`npm run docs:bump`, review the diff, merge), placeholders on the hosted page, `SITE_URL`, no deployment yet, link to the design in pulse-meta.
- `AGENTS.md` like the siblings (project, commands table, repository boundaries, TypeScript, code design, tests, "Never edit generated or fetched docs by hand; change the source repo", "Product facts only from the sources in `facts.ts`", the pinning rule); `CLAUDE.md` is the one-line pointer to `AGENTS.md` used in the siblings.
- `package.json` (`type: module`, `engines.node >=24`, `private`, exact pins for all deps), `biome.json` and `eslint.config.js` extending pulse-config, `tsconfig.json` extending the base (`jsx: react-jsx`, `noEmit`), `lefthook.yml` from pulse-config, `.gitignore` (`dist`, `.cache`, `.build`, `node_modules`).

## Risks

- Upstream docs change shape (raw HTML, new link styles): the renderer escapes raw HTML, link and anchor checks fail the build; fix by bump review.
- Sidebar entries from the design have no source: mitigated by mapping to real headings and omitting.
- Packages not yet approved: the PR order above.
- GitHub rate limit in `docs:bump` or a failed fetch in CI: cached per SHA, clear error.
- Chromium and axe flakiness: serve `dist` locally, no timers, retries off.
- Tokens drift between design and CSS: generator plus a test.

## Acceptance evidence

In a fresh clone of pulse-website on Node 24:

1. `npm ci && npm run check:all` passes (lint, typecheck, tests with the 80 % gate, build, links, budget, a11y).
2. `dist/` contains `index.html`, `hosted/`, `docs/` pages for every published file of the six repos (the REST API at `docs/api/rest-api/`), `404.html`, `sitemap.xml`, `robots.txt`; each page has title, description, Open Graph tags and canonical.
3. With JavaScript off, all pages render and navigate; with it on, only islands hydrate; zero cross-origin requests.
4. A docs page shows sidebar, "On this page", previous/next, "Edit this page on GitHub", "Generated from <file> in <repo>"; relative links resolve to site URLs or GitHub; the link check reports none dangling.
5. SHAs appear only in `docs.config.json`; `npm run docs:bump` rewrites them; the build uses only them.
6. The built hosted page has only marked placeholders for commercial facts, a disabled waitlist form and no submit path.
7. Each product fact on the home page has a named source in `facts.ts`.
8. axe reports no WCAG 2.2 AA violation in light and dark at 360 px and 1280 px; keyboard and 44 px checks pass.
9. `README.md`, `AGENTS.md`, `CLAUDE.md` exist as described; `ci.yml` uses the shared `check.yml` plus the `site` job.

## Repository: website

Files: everything listed under "Required behavior" in `lorenzh/pulse-website` (empty apart from README and LICENSE; README is replaced). Behavior: as specified above. Checks: `npm run check:all` locally and the CI jobs `check` and `site`. Completion evidence: the nine acceptance points above, the PR body lists the entry → file nav mapping, the facts with their sources, and the budget numbers; the PR is opened with `Closes lorenzh/pulse-meta#<child>`. Prerequisite outside this repository: the approved-packages PR in meta is merged before the website PR is merged.
