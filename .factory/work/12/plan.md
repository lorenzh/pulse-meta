# Spec: Dark mode for the status page (#12)

## Goal
The status page follows the OS light/dark preference. A visitor can pick light, dark or system, the choice persists in the browser, and all state colours are readable (WCAG AA) in both themes.

## Scope
Only the `status` repository (the page, its client and its server). `api`, `probe` and `contract` have no UI and need no change.

## Non-goals
Server-side or cross-device persistence, cookies/client hints, print styles, `forced-colors`, a redesign of the layout, changes to `render.ts` output or to the poller.

## Required behavior
1. Modes: `light`, `dark`, `system`. Default with nothing stored: `system`.
2. Mechanism (decision): CSS custom properties on `:root`. The `<html data-theme="light|dark|system">` attribute holds the chosen mode. Light values are the default. Dark values apply under `:root[data-theme="dark"]` and under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }`. This makes `system` follow the OS live in pure CSS. Set `color-scheme` accordingly, and add `<meta name="color-scheme" content="light dark">`.
3. First paint (decision): a tiny inline `<script>` in `<head>` reads `localStorage["pulse-theme"]` in try/catch and sets `data-theme` (anything not `light`/`dark` becomes `system`). No CSP exists, so inline is fine.
4. Switch: a control in the header, outside `#banner/#checks/#incidents/#maintenance` (so polling never recreates it). It is a labelled radio group (or `<select>`) with Light / Dark / System, keyboard accessible, with the current choice visibly indicated. Changing it sets `data-theme` and writes `localStorage`, with no reload and no navigation. If storage throws, the theme still changes for the current view.
5. Logic module (decision): a pure `src/theme.ts` (erasable TS only), served by `server.ts` at `/theme.js` like `render.js`. It exports `parseTheme(value)` (unknown, null or invalid gives `system`), `loadTheme(storage)`, `saveTheme(storage, theme)` (both swallow errors) and `applyTheme(root, theme)`. `client.js` imports it and wires the control. The inline snippet only duplicates the minimal read-and-apply step.
6. Palette: all colours in `index.html` move into variables, with no hard-coded colour outside the two theme definitions. Suggested values, which the test must verify (adjust any that fail):
   - Light: bg `#ffffff`, text `#1f2328`, up `#1a7f37`, down `#cf222e`, unknown `#636c76`, maintenance `#9a6700`, secondary `#57606a`, border `#d0d7de`, banner bg `#ffebe9` / border `#cf222e`.
   - Dark: bg `#0d1117`, text `#e6edf3`, up `#3fb950`, down `#ff7b72`, unknown `#8b949e`, maintenance `#d29922`, secondary `#9da7b3`, border `#30363d`, banner bg `#3d1114` / text `#ffdcd7` / border `#ff7b72`.
7. Contrast: every text/background pair is at least 4.5:1 in both themes. This covers the 4 states, secondary text, body text and banner text. Borders are at least 3:1 where they carry meaning.

## Risks
- A flash of the wrong theme if the inline snippet is dropped or runs late.
- `server.ts` has an explicit route list, so `/theme.js` is missing unless it is added.
- The same colours are hard-coded in two places (the CSS and the contrast test). Keep the test as the single palette source, or parse the CSS.
- There is no DOM test setup, so DOM wiring is checked manually.

## Acceptance evidence
- `npm run check` is green (lint, typecheck, tests).
- Unit tests (node:test, fake storage, no timers, no DOM) cover `theme.ts`, a palette contrast test, and a `server.test.ts` case for `/theme.js` (status 200, JS content type).
- Existing `render.test.ts` passes unchanged.
- Manual check: in a browser with the OS in each theme, no stored choice follows the OS. Switch between the three modes without a reload, reload and see the choice kept with no flash. Switch the OS theme while in `system` and see the page follow. Poll updates do not reset the control.

## Repository: status
Files:
- `public/index.html`: variables, theme CSS, meta tag, head snippet, header control (markup and CSS).
- `public/client.js`: import `/theme.js`, initialise the control from the stored value, handle change events.
- `src/theme.ts` and `src/theme.test.ts`: the module and its tests.
- `src/server.ts`: add the `/theme.js` route to `tsModules`. `src/server.test.ts` covers it.
- A contrast test (e.g. `src/palette.test.ts`) that checks the palette in point 6.

Behavior and checks: points 1–7 above. Run `npm run check`, then the manual check.
Completion evidence: green `npm run check`, the new tests listed, and a short note of the manual check results in the PR.
