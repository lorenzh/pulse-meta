# Issue review: Dark mode for the status page (#12)

## Current state (inspected in the clones)

- Only `pulse-status` is affected. Contract, probe and api have no UI and need no change. No earlier-run comments on this issue.
- The page is `public/index.html` with one inline `<style>` block. There is no separate CSS file. All colours are hard-coded hex values:
  - state text: up `#1a7f37`, down `#cf222e`, unknown `#6e7781`, maintenance `#9a6700`
  - `.url`, `.reason`, `.note`, `.empty`: `#57606a`
  - `li` border `#ddd`
  - error banner: background `#ffebe9`, border `#cf222e`
  - body: browser default colours. There is no `color-scheme`, so the page is always light.
- No `prefers-color-scheme`, no theme switch, no `localStorage` use, no `<meta name="color-scheme">`.
- `src/server.ts` serves `index.html` (it only injects `data-poll-ms` into `<body>`), `/client.js`, and `/render.js` and `/poller.js` (type-stripped from `src/*.ts`). It has an explicit route list: any new browser file (a separate CSS or JS file) needs a new route and a server test.
- `client.js` re-renders `#checks`, `#incidents`, `#maintenance` and `#banner` via `innerHTML` on every poll. Elements outside these containers (e.g. a theme switch in the header) are not recreated.
- `render.ts` emits only class names (`state-*`, `banner error`, `empty`, ...) and no inline colours. Theming is therefore CSS-only for the rendered content.
- Repo conventions (`AGENTS.md`): strict TS, node:test next to the code, injectable clock, no real timers, Biome excludes HTML. `npm run check` = lint, typecheck, tests. There is no browser or DOM test setup (no jsdom or playwright). Tests exist for `render`, `poller` and `server` only.

## Assumptions

1. The three modes are `light`, `dark` and `system`. The default, with nothing stored, is `system`.
2. `system` follows `prefers-color-scheme` live. If the OS preference changes while the page is open in `system` mode, the page follows it without a reload.
3. Storage is `localStorage` with a single key (e.g. `pulse-theme`) holding `light`, `dark` or `system`. An unknown or unreadable value (including a thrown `localStorage` access, as in private mode) falls back to `system`. The switch must still work for the current page view if storage fails.
4. Implementation is CSS custom properties on the root, driven by a `data-theme` attribute (`light` or `dark`) with `color-scheme` set. For `system`, either the attribute is absent and a `prefers-color-scheme: dark` media query applies, or the script resolves it. The spec should pick one.
5. The theme is applied before first paint to avoid a flash of the wrong theme. Because the page is plain HTML, this needs a small inline script in `<head>`, or a blocking external script. No CSP exists today, so inline is fine.
6. The switch is a control in the page header: three options (a segmented control or radio group, or a `<select>`), keyboard accessible, with an accessible label and a visible indication of the current choice. It sits outside the re-rendered containers so polling does not reset it.
7. "Readable" means WCAG AA contrast (4.5:1 for text) in both themes. This applies to every state colour (up, down, unknown, maintenance), the secondary text colour, the error banner, and borders (for visibility, not text). The dark palette needs its own values. The current light greens, reds and ambers on a dark background do not all pass, and `#6e7781` on white is itself only about 4.6:1.
8. Scope covers every element on the page: the checks list, the incidents list, upcoming maintenance, the banner, the headings and the empty-state text.
9. No server-side or per-user persistence. The choice is per browser, not synced across devices. The server does not read the preference (no cookie, no `Sec-CH-Prefers-Color-Scheme`).

## Open points (non-blocking, for the spec)

- Where the theme logic lives: inline in `index.html`, or a new `public/theme.js` (needs a server route). Prefer a small pure module in `src/` (e.g. `theme.ts`) that is served like `render.js`, so it can be unit-tested with `node:test` using fake storage and a fake `matchMedia`. This is the testable-seam approach in line with the repo conventions. It conflicts with assumption 5 (a flash-free first paint needs an inline or blocking script); the spec must decide, e.g. a tiny inline snippet for first paint plus a module for the switch.
- Whether the colours move to a separate stylesheet. This is optional. A separate stylesheet would need a route and a content-type.
- The control's look and placement (top right of the `h1` line vs. below it). The issue gives no design.
- Whether to also set `<meta name="color-scheme" content="light dark">`. It is recommended, so that native controls and scrollbars match.
- The exact dark palette. The spec should list concrete values and the measured contrast ratios.
- Switching must not cause a reload and must not disturb polling (the poller is not touched).
- The issue says nothing about print styles or a `forced-colors` mode. Both are out of scope.

## Derived acceptance check

In `pulse-status` only:
1. With no stored choice and the OS in dark mode, the page renders with the dark palette. With the OS in light mode it renders with the light palette (verify via the emulated `prefers-color-scheme`).
2. A visible control offers light, dark and system. Choosing one changes the theme immediately, with no page reload and no navigation. The poller keeps running and the control's state is not reset by a poll update.
3. The choice is written to `localStorage`. After a reload, the same choice is applied, with no visible flash of the other theme on first paint. Choosing `system` again follows the OS (including OS changes while the page is open).
4. A corrupt or unavailable stored value falls back to `system` without a script error.
5. All four state colours, the secondary text, the error banner and the borders meet WCAG AA contrast against the page background in both themes, checked by a script or a test over the palette values.
6. The themed rendering contains no hard-coded colours outside the theme definitions. `render.ts` output is unchanged (existing render tests pass).
7. Any new browser-served file is routed by `server.ts` with a correct content type, and `server.test.ts` covers it.
8. Unit tests (node:test, no real timers or DOM) cover the theme resolution logic: stored value, fallback, system resolution, and the persistence call. `npm run check` is green.
9. Manual check: load the page in a browser and in both OS themes, switch between the three modes, reload, and confirm each of them.

No blocking questions. The feature can be specified.
