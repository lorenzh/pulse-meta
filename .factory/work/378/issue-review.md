# Issue review: #378 status page accessibility (status only)

Checked against `.repos/status` main (48b7cb9). The five findings hold: `public/client.js` `show()` sets `innerHTML` per section; `public/index.html` has "Loading…" only; `#banner`, `#summary`, `#updated` are plain divs filled per poll; the formatters have no `timeZoneName`; the CSP is `script-src 'self'` (server.ts ~227); `index.html` is templated in `server.ts` (~388) with `{{title}}`, `{{wordmark}}`, `{{feedLink}}`.
Status has no browser test setup today: no playwright, no e2e dir. CI is `.github/workflows/ci.yml`. The test runner is `bun test`.
`docs/approved-packages.md` has playwright 1.64.1 for pulse-website only. `@axe-core/playwright` has no row.

## Open points (none blocks the spec)
1. Render sharing: the browser imports `/render.js` and `/sections.js`, which are served from `src/`. The server can reuse the same modules. The plan must check that the render env (`formatExact`, `now`) can run on the server. The no-JS view then uses the server's zone and locale. The "does not refresh" line must give its render time with an explicit zone (UTC).
2. Zone on the no-JS view and "client takes over without flash": after the client's first draw, absolute times change from the server zone to the visitor's zone. The plan should keep the text stable until the first poll replaces it, or accept the change on the first patch. Decide in the plan.
3. Patch mechanism: keyed by stable ids. The renderers return HTML strings, so the patch must either parse them (`template`/`DOMParser`) and diff against the live DOM, or the renderers change. The `buildSections`/`showSections` API is used by several tests. The plan should keep it, or name the changes.
4. Relative-time reach for sighted keyboard users: the plan must state it. Options: a `<time>` with `title` plus the exact time as visible text on focus or hover of the row, or the details element. The issue leaves this to the plan.
5. Tab budget: "at most three tab stops per check or component" with group + incident link + details. The plan should state which elements are focusable and how the count is asserted, including the theme switch and any links.
6. Roving tabindex: the bars need `role` and a pattern (e.g. `role="group"` with `aria-label`, days as `role="img"` or a `listbox`/`option` style). The day names must not be only a `title`. The plan picks the pattern and checks it passes axe. Which day holds `tabindex=0` after a poll must be kept (the focused day), else the last day.
7. The "alert region only when an error first appears or changes kind": the plan must define "kind" from the existing error states in `renderUpdated`/the poller.
8. The alert region and the polite region sit in `index.html` and are filled by the client. In the no-JS view the server fills them (or leaves them empty) once, which should not announce twice after the client starts.
9. The manual incident, maintenance and resolved sections also need keyed ids. The plan lists which have stable ids today. If some have none, it states the key to use.
10. Playwright needs a Chromium download in CI. `ci.yml` and the Dockerfile must not ship it; the lockfile is `bun.lock`. The plan states the CI step and whether `bun test` excludes the browser test (a separate script such as `check:a11y`, as in pulse-website).
11. Meta PR: `docs/approved-packages.md` needs a separate PR with the dev-only rows. It is not a child target of the fan-out (`targets` lists status only). The plan should say it is made by hand or as a note for the implementer. Targets.json should list only `status`.
12. Performance: the plan must have a "Performance impact" section with the status budgets (check `docs/` in status for numbers). SSR renders per request from the cached reads, so it should measure the added cost.

## Assumptions
- "Status only" means `targets.json` has the one target `status`, no `dependsOn`.
- "Same renderers" means the existing `src/render.ts`, `src/sections.ts`, `src/components-view.ts`.
- Bars stay UTC days. Only labels change.
- No change to the api, feed, badges, or the website.
- Mutation output in the PR is the implementer's duty, not a spec item.

## Derived acceptance check
Playwright + axe (Chromium) against the page with a stub api, light and dark, 360 and 1280 px, with and without components:
- Focus on a day stays on that day over five polls, also when that check's state changes.
- Tab from top to footer: at most three stops per check or component, asserted.
- Live regions exist once, are not re-inserted across ten polls; the polite text changes once on a state change; the alert only on an error appearing or changing kind and is cleared after.
- Every uptime group's accessible name contains its check or component name.
- JavaScript disabled: checks, components, incidents, maintenance, and the "does not refresh" line with render time show.
- Every absolute time shows a zone; legend and day labels say UTC.
- axe WCAG 2.2 AA: no violations. Unit tests for renderers and the keyed patch fail on old code. `bun run check` and CI are green. Docs (`operation.md`) are updated. The meta PR for approved-packages is separate.
