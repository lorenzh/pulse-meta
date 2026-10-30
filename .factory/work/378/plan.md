# Spec #378: status page accessibility

Checked against `.repos/status` main (48b7cb9). Open points 1-12 of `issue-review.md` are decided below.

## Goal
The status page works with a keyboard and a screen reader while it polls: focus stays put, an uptime group is one tab stop, changes are announced once, every group is named, the page shows content without JavaScript, and every time names its zone.

## Scope
Only pulse-status (`public/`, `src/render.ts`, `src/sections.ts`, `src/components-view.ts`, `src/server.ts`, tests, CI, docs). Also a separate by-hand PR in pulse-meta (see "Meta follow-up").

## Non-goals
No visual redesign, no new page content, no api/proxy allow-list change, no website, feed or badge change, no new runtime dependency, no change to manual-incident writing.

## Decisions

### D1 In-place update (keyed patch)
- Renderers keep returning HTML strings, and `buildSections`/`showSections` keep their signatures (existing tests stay valid). `showSections` gets a new second-argument contract only in the browser: `client.js` passes a `show(id, html)` that calls a new browser module `src/patch.ts` (served like the other modules via `tsModules`): `patchHtml(container, html)`.
- `patchHtml`: if `container.innerHTML` equals the last html written for that container (kept in a `WeakMap`), do nothing. Otherwise parse `html` with a `<template>` and reconcile children recursively: match nodes by `data-key` when present, else by position and tag. Same tag + key: keep the node, sync attributes (set changed, remove missing) and recurse; text nodes: update `data` only if different; unmatched old nodes removed, new ones inserted. The active element is never replaced when its key matches. Reordered keyed children are moved with `insertBefore` (moving an element that holds focus is avoided: the focused node is not moved if its relative order is already right; otherwise moved and focus restored with `focus({preventScroll:true})`).
- Stable keys added by the renderers as `data-key`: `check:<id>`, `component:<id>`, `group:<heading>` (component group), `incident:<id>`, `maintenance:<checkId>:<start>`, `manual:<id>`, `manual-update:<id>:<at>`, `day:<date>` for bars. Incidents and checks have ids today; maintenance has none, so it uses `checkId:start`; manual updates use `at`. Fixed sections (`banner`, `summary`, `updated`) are handled by D3.
- Relative times (`<time>`) change text only (every 30 s tick and polls) and keep their node.
- No dependency; `patch.ts` has no DOM-library import and takes the document from `container.ownerDocument`, so unit tests use a minimal DOM stub or `happy-dom`-free hand-built fake; if a DOM is needed for tests, the Playwright test covers the real DOM and the unit test covers the pure helpers (`sameKeyOrder`, attribute diff plan) separated from the DOM calls.

### D2 Tab stops and uptime bars
- `renderUptime(entry, name)` (new required name argument; callers pass the check or component name) renders:
  `<div class="bars" role="group" aria-label="Checkout API, 90-day uptime 99.9 %" data-key="bars">` with days as `<span class="bar ..." role="img" data-key="day:2026-10-30" tabindex="-1" aria-label="2026-10-30 UTC: 99.9 %" title="...">`. Exactly one day has `tabindex="0"` (default: the last day). `role="img"` with `aria-label` passes axe and names the day; the text is not only a `title`. Incidents on a day, when the data has them, are appended to the label (`, 1 incident`); the day data has no incident list today, so only add when `days[].results` or equivalent already gives it, else leave it out (as today).
- Roving keys in a new browser module `src/bars.ts` (event delegation on `document`, bound once): ArrowLeft/ArrowRight (not wrapping), Home/End; moves `tabindex=0` and focus. On `focusin` of a bar it records that bar as the group's roving stop. Because the patch keeps nodes and `tabindex` is synced from the server html, the patch must not reset the roving stop: `patchHtml` skips the `tabindex` attribute of `.bar` elements that already exist (the roving state lives in the DOM).
- Relative times: remove `tabindex` from `<time>`. A sighted keyboard user reaches the exact time via the group-level details: no. Decision: the exact time is shown as visible text in the entry on `:focus-within`/hover is not possible for non-focusable elements; so the exact time is rendered as a `<time>` with `title` and a visually-hidden-until-needed `data-exact`; additionally the page gets a "Show exact times" `<button aria-pressed>` (one tab stop, in the header next to the theme switch) that toggles `body.exact-times`: CSS then shows `data-exact` text instead of the relative text. The state is kept in `localStorage` best-effort. Screen readers read the `<time>` with `aria-label` = exact time (title is kept for hover).
- Tab budget: per check or component the focusable elements are the bars group (1 stop). Manual incident entries and incident rows have no links today, so the real budget is 1 per check/component and 0 elsewhere (limit stays 3 as in the issue). Global stops: theme radios (1 group stop), the exact-times button, the feed link if present. The Chromium test tabs from the top to the end of the page and counts stops inside each `li.check, li.component`: at most 3 and exactly 1 on default data.

### D3 Live regions
- `index.html` holds `<div id="live" role="status" aria-live="polite" aria-atomic="true" class="visually-hidden"></div>` and `<div id="alert" role="alert" class="visually-hidden"></div>`, outside every patched container, never re-created. `renderSummary`/`renderBanner` lose their `role` attributes (the visible `#summary` and `#banner` text stay for sighted users and are patched in place without a role; `aria-live` is off on them).
- `client.js` (new `src/announce.ts` browser module, pure and unit-tested): `announceSummary(prev, next)` returns the text to set in `#live` only when the summary text (without the "· N incidents open" parts? no: the full text) differs from the previous one; `announceError(prev, next)` returns the alert text only when error kind goes `null → kind` or `kind → other kind`, and `""` when it goes back to `null`. Kinds are the existing `PollerErrorKind`: `unreachable`, `invalid`, `version`. Text uses the existing `bannerText`. The first draw after load sets `#live` only if the server did not already render the same text (the server renders `#live` and `#alert` empty, so the first client draw does not announce an unchanged initial state: the client seeds `prev` from the server-rendered summary text, read from `#summary`).
- Ordinary polls (same text, same kind) write nothing, so no DOM mutation and no announcement.

### D4 Names
`renderUptime` takes the name; `renderCheck`, `renderComponent` pass `check.name`/`component.name`. Checks under components use the check name. Manual incidents have no uptime bars; their list items get `aria-label`-free headings: the title is already the visible name, and the "Affects" list stays. Add `aria-labelledby` linking each manual incident `li` to its `.name` span via id `manual-name-<id>`. Format: `"<name>, 90-day uptime 99.9 %"` or `"<name>, 90-day uptime no data"`.

### D5 No-JavaScript view
- `index.html` gets `{{content}}` placeholders inside the existing containers and `{{renderedLine}}`: `<p class="no-js-note">` inside `<noscript>`? No: noscript content would be hidden when JS runs, which is what we want, and a visible `<p>` is needed only without JS. So: `<noscript><p class="no-js-note">This page does not refresh without JavaScript. Rendered 2026-10-30 12:00:00 UTC.</p></noscript>` placed at the top of `<main>`-level content. The content in the section containers is real HTML in both cases.
- Server: a new `src/ssr.ts` builds a `PollerState` for the request by running the same fetch/validate steps as the poller with a `fetch` adapter over `cachedAnswer` (no new upstream traffic when the cache is warm; `cacheMs` applies). It calls `createPoller({...}).refreshOnce()` equivalent: if the poller has no single-shot export, export a `loadState(fetch, now)` function from `poller.ts` that `createPoller` itself uses (refactor, behavior kept). Then `buildSections(state, serverEnv, ...)` with the same renderers. On any failure the server renders the sections as the poller's first-failure state (`renderUnavailable`) and still answers 200.
- Server env: `now = ctx.now()`, `formatExact` = `Intl.DateTimeFormat("en", {dateStyle:"medium", timeStyle:"medium", timeZone:"UTC", timeZoneName:"short"})` so the no-JS text names UTC explicitly. The same for `formatExactSpan`.
- Take-over without flash (open point 2): the client does not redraw on load. It seeds its patch cache from the server DOM, and the first draw happens at the first poll (a poll fires immediately at start, as today); `patchHtml` only touches nodes whose text differs. Absolute times switch from server UTC text to the visitor's zone at that first patch (accepted: the same layout, a zone label changes, one-time). Relative times stay stable because they are recomputed from `Date.now()`.
- CSP unchanged: no inline script, no inline style; the note is plain HTML.
- Escaping: all values go through the existing `escapeHtml` in the renderers.

### D6 Time zones
- `client.js` formatters get `timeZoneName: "short"` (`exactFormat`, `clockFormat`; `dayFormat` stays date only; the span's end carries the zone once). Absolute times in `data-exact`, `title` and `aria-label` therefore show the zone.
- Day labels read `2026-10-30 UTC: 99.9 %`. Add a legend line under the checks heading: `<p class="legend">Days are UTC days. Bars: ...</p>` rendered by `renderUptimeLegend()` once per section (not per entry), pulled in `renderChecks`/`renderComponents`; if the section is empty, no legend.

### D7 Automated check in CI
- Dev dependencies of status, pinned exactly like pulse-website (read its `package.json` for the versions; the website row in meta says playwright 1.64.1): `playwright`, `@axe-core/playwright`. `bun.lock` updated.
- New `e2e/a11y.test.ts` is NOT in `bun test` (`bunfig.toml` test root is set to `src`; the file lives in `e2e/` and has its own script) and `package.json` gets `"check:a11y": "bun e2e/run.ts"`. The runner starts `createStatusServer` with a stub api (in-process `http` server serving the contract JSON, mutable between polls) with a short `pollMs` (200 ms), then drives Chromium via Playwright over {light, dark} x {360, 1280} x {components, no components} (color scheme via `emulateMedia`, plus `data-theme`).
- Assertions: axe `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa` no violations; focus on a given `day:` bar survives five polls and a state change of its check (same node: a marker property set on the element survives); Tab count per entry; `#live` and `#alert` nodes are the same elements (marker property) and their text is stable across ten polls, changes once on a summary change; the alert appears on an error, changes on a kind change, clears on recovery; every `[role=group]` bars has an accessible name containing the entry name (via `page.accessibility`/`ariaSnapshot`); with `javaScriptEnabled:false` the page shows the check, component, incident, maintenance and the note; every `time[data-exact]` and the span text contains a zone abbreviation; legend and day labels contain "UTC".
- CI: new job `a11y` in `.github/workflows/ci.yml` (separate from `check` and `docker`): checkout, setup bun at the version in `package.json`, `bun install --frozen-lockfile`, `bunx playwright install --with-deps chromium`, `bun run check:a11y`. Dockerfile installs production dependencies only (`--production`), so Playwright and the browser never reach the image; the existing "no test files in image" step also checks `e2e/` is absent (add `.dockerignore`/COPY check if the Dockerfile copies the repo whole).

### D8 Docs
`docs/operation.md`: a "Keyboard and screen reader use" part (one tab stop per uptime group, arrow keys, Home/End, the exact-times button, live regions), a "Without JavaScript" part (server-rendered state, UTC times, no refresh), the UTC note for days. `docs/development.md`: the `check:a11y` script and the Chromium install.

## Required tests (unit, `bun test`)
- `render.test.ts`: group name contains the name for checks, components and checks under components; day label contains "UTC"; exactly one `tabindex="0"` in a group; `<time>` has no `tabindex`; summary and banner have no `role`; keys present.
- `patch.test.ts`: unchanged html makes no DOM call; a same-key node is kept (identity) with changed text; removed and added keyed nodes; reorder; focused element is kept; `.bar` tabindex not reset.
- `announce.test.ts`: summary change only; error appearing, kind change, clearing; unchanged returns `undefined`.
- `server.test.ts`: `/` contains the check, component, incident and maintenance HTML and the `no-js-note` with a UTC time; api failure still 200; CSP header unchanged; no inline `<script>`; `index.html` has `#live` and `#alert` once.
- Each new test must fail on the old code; the PR shows mutation output (revert the change, run, paste failures).

## Risks
- Patch regressions that skip a needed update: mitigated by the identical-html short circuit being exact string compare and by the Chromium test.
- `role="img"` on 90 bars is noisy for screen readers browsing by element: accepted; the group name carries the summary.
- SSR adds an upstream read per page request when the cache is cold: see below.
- Playwright download in CI: flaky network; cache `~/.cache/ms-playwright`.

## Performance impact
- Client: per poll, today 10+ `innerHTML` writes re-parse and re-layout whole sections, 90 bars per entry included. With the patch, an unchanged poll costs one string compare per section and no DOM writes. Target: on an unchanged poll, zero DOM mutations (asserted with a `MutationObserver` in the Chromium test).
- Server: each page request now runs the existing cached reads (`cachedAnswer`, `cacheMs` default applies) and the renderers. Status has no written performance budget in `docs/` or `AGENTS.md`; the implementation measures a request to `/` with 50 checks and 20 components (warm cache): p95 render time and response size, and records them in `docs/operation.md` as the budget (suggested: p95 under 20 ms warm, HTML under 250 KB). A cold cache adds at most the existing upstream timeout; the page falls back to the unavailable view.
- `/` is not cacheable by clients longer than before (`cache-control` unchanged).

## Repository: status
Files: `public/index.html`, `public/client.js`, `public/page.css` (visually-hidden live regions, note, legend, focus ring on `.bar:focus-visible` with 3:1 contrast and target size >= 24 px spacing check: bars narrower than 24 px are exempt only if equivalent spacing exists, so verify with axe `target-size`; if it fails, the roving group is the target), `src/render.ts`, `src/components-view.ts`, `src/sections.ts`, `src/poller.ts` (extract `loadState`), `src/server.ts`, new `src/patch.ts`, `src/bars.ts`, `src/announce.ts`, `src/ssr.ts`, `e2e/*`, `package.json`, `bun.lock`, `.github/workflows/ci.yml`, `docs/operation.md`, `docs/development.md`, unit tests as listed.
Checks: `bun run check` and `bun run check:a11y` green; CI `check`, `docker`, `a11y` green.
Completion evidence: PR with `Closes lorenzh/pulse-meta#<child>`, mutation output for each new test, the measured SSR numbers, and the acceptance list below ticked.

## Meta follow-up (not a Factory child)
A separate PR in pulse-meta edits `docs/approved-packages.md`: the `playwright` row also names pulse-status (dev-only), and a new `@axe-core/playwright` row (dev-only, pulse-status, same version as pulse-website). A person or the status implementer opens it by hand; it is not in `targets.json`.

## Acceptance evidence
- Focus on a day stays across five polls, also on a state change (Chromium).
- Tab stops per check/component <= 3 (1 by design), asserted with components and checks shown.
- Live regions present once, text constant over ten no-change polls, polite region changes once on a state change.
- Every uptime group name contains its entry name.
- JS disabled: checks, components, incidents, maintenance and the note show.
- Every absolute time shows a zone; legend and day labels say UTC.
- axe WCAG 2.2 AA: no violations in both themes and both widths; CI green.
