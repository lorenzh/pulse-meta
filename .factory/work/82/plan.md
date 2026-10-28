# Spec: Status page design with white-label themes, losoft by default (#82)

## Goal
The pulse-status page looks like a finished product in the losoft visual language, and an operator rebrands it (name, logo, colours, fonts, radii) through settings and a theme file, without code changes.

## Scope
Only `pulse-status` changes. The API, its routes and response shapes stay as they are. Source of truth for default values is the table in the issue.

## Non-goals
- No change to pulse-api, contract, probe, notify.
- No framework, no build step: plain HTML, CSS and the existing browser modules.
- No contrast enforcement of operator themes (README says it is the operator's duty). No favicon, no print styles, no demo mode in the product.
- Theme switch (system/light/dark) and the `pulse-theme` storage key are unchanged.

## Decisions (fixed by this spec)
- **Theme file format: JSON**, easy to validate and merge per variable:
  `{ "light": { "accent": "#..." }, "dark": { "accent": "#..." }, "font-sans": "...", "font-mono": "...", "radius-sm": "6px", "radius-md": "12px", "radius-pill": "999px" }`. Every key is optional. Unknown keys are ignored. Missing keys fall back to the default theme, per variable and per mode.
- **CSS custom properties** are named `--<role>`: colours `--bg --surface --rule --line-strong --field-line --text --lead --muted --accent --accent-text --tint --tint-line --success --success-tint --warning --warning-tint --error --error-tint --info --info-tint`; non-colours `--font-sans --font-mono --radius-sm --radius-md --radius-pill`. Every colour has a light and a dark value. This set is fixed and documented; `public/index.html` CSS uses only these (no raw colours outside the theme block).
- **Server output**: the server builds the merged theme and serves it as `/theme.css` (`:root{light}`, `:root[data-theme="dark"]{dark}`, and `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){dark}}`). The dark values are generated from one parsed object, never duplicated by hand. The page links `/theme.css` before its own styles. `public/theme-default.json` holds the default (losoft) values and is the single source for the server and the palette test.
- **Validation (no CSS/HTML injection)**: colours must match `#rgb|#rrggbb|#rrggbbaa`; radii `^\d+(\.\d+)?(px|rem|em)$`; font stacks only `[A-Za-z0-9 ,'"_-]` characters, max 200 chars; name max 60 chars, HTML-escaped. An unreadable file, invalid JSON, or an invalid value stops the server at start with a message naming the file and key. No silent fallback.
- **Settings** (read in `main.ts`, passed in `ServerOptions`): `PULSE_STATUS_THEME` (path to the JSON file), `PULSE_STATUS_NAME` (default `pulse`), `PULSE_STATUS_LOGO` (optional; a local file path with extension svg/png/jpg/webp, served by the server at the fixed path `/logo` with its content type and used in an `<img alt="<name>">`; or an `http(s)://` URL used as is). SVG is only ever used via `<img>`, never inlined. Name and logo are injected into the HTML server-side (escaped) and into `<title>`.
- **Fonts**: add dependencies `@fontsource-variable/space-grotesk` and `@fontsource-variable/jetbrains-mono` (pinned in `package-lock.json`). The server serves only the latin-subset woff2 files from a fixed allow-list route (`/fonts/space-grotesk.woff2`, `/fonts/jetbrains-mono.woff2`; no path from the request is joined to a file path), `content-type: font/woff2`, `cache-control: public, max-age=31536000, immutable`. `@font-face` uses `font-display: swap`, weight ranges 300 700 (Space Grotesk) and 100 800 (JetBrains Mono). No request to a CDN: a test asserts no `http(s)://` font/asset URL in served HTML and CSS (except the operator logo URL).
- **Resolved incidents**: the poller adds a request `GET /incidents?status=resolved`, keeps incidents with `resolvedAt` within 7 days of `now()`, newest first. This list is optional like uptime: if the request fails or is malformed, the list is empty and no error banner shows. `PollerState` gets `resolved: IncidentsResponse`.
- **Summary wording**: worst state wins: down → "N check(s) down", else degraded → "N check(s) degraded", else "All systems operational". Maintenance and no data do not count as problems. Open incident count appended as " · N incident(s) open" when > 0. No checks: "No checks configured". The summary carries the state word and a status class, so it never relies on colour alone. Down uses `error`, degraded `warning`, operational `success`.
- **Relative time**: pure `formatRelative(then, now)` in `render.ts`: "just now", "N min ago", "N h ago", "N d ago"; future: "in N min", "in N h", "in N d". Output `<time datetime="ISO" tabindex="0" data-exact="...">` plus a CSS tooltip (`:hover` and `:focus`) from `data-exact` (local date-time string made in the browser; render takes an injectable `now` and `formatExact`). Mono face for times. The exact value is also in `title` as a fallback.
- **Duration** of resolved incidents: "12 min", "2 h 5 min", "3 d 2 h"; under a minute "<1 min".
- **44px targets**: theme switch options and uptime bars have a hit area of at least 44px height (bars: the bar group is a 44px tall flex row, each bar fills the height and shrinks horizontally; 90 bars fit 390px without scroll via `flex: 1 1 0; min-width: 0`).

## Required behavior
Layout/content:
- Header: wordmark (name in mono followed by an `accent` block cursor, or the logo `<img>` plus the name for screen readers), and the theme switch.
- Summary line at the top, see above.
- Each check is a row: state word (mono, uppercase), name, target (URL or `host:port`, mono, wraps with `overflow-wrap:anywhere`), then a meta line: latency (with ` · objective N ms` when set; shown for up/degraded as today), TLS "N days left", maintenance note, last reason (when not already the TLS text). "N/M locations down" shows only when at least one active location is down. Uptime bars with the 90-day percentage in mono below the row content.
- Times via `<time>` as above. Dates and IDs in mono.
- Open incidents: check name, "since <time>", reason. Under them "Resolved in the last 7 days": check name, resolved time, duration, reason. Empty states for both.
- Upcoming maintenance list keeps working, with the new time format.
- Eyebrows "CHECKS", "INCIDENTS", "MAINTENANCE": uppercase mono 12px, +0.06em tracking.
Styling:
- Radii 6/12/999px, no box-shadow, no left-border accent stripes, depth from `surface` and `rule`. Page title bold with tight tracking; body 15–18px; mono labels 13px.
- Transitions 150ms `cubic-bezier(0.2, 0, 0, 1)`, none under `prefers-reduced-motion: reduce`. Focus: `outline: 2px solid var(--accent); outline-offset: 3px` on every interactive element.
- Status colours: up `success`, degraded `warning`, down `error`, maintenance `info`, no data `muted`; `accent` only for brand (focus ring, selected theme option, cursor).
- Works at 390px without horizontal scroll.
Default theme: exactly the issue table values, light and dark.

## Risks
- A big restyle of `index.html` and `render.ts` replaces old markup assertions in `render.test.ts` and `palette.test.ts`; rewrite them, keep coverage >= 80 % and cognitive complexity <= 15 (split render helpers).
- Theme injection: handled by strict validation; the logo as `<img>` only.
- Operator theme with poor contrast is not caught (documented).
- Fontsource packages: confirm the latin woff2 file names in the installed package; the allow-list maps to them.

## Acceptance evidence
1. `npm run check` passes.
2. Palette test reads `public/theme-default.json` (and the generated CSS): every variable exists in light and dark; values equal the issue table; pairs >= 4.5:1: `text`, `lead`, `muted`, `accent-text` on `bg` and `surface`; `success|warning|error|info` on `bg` and on own tint; >= 3:1: `field-line` and `accent` on `bg`, `line-strong` on `bg`.
3. Render tests: summary sentences (all up, 1 degraded, 2 down + 1 incident, empty, singular/plural); locations-down shown only when >= 1 down; `<time datetime>` with relative text and exact value; TLS days left; objective; maintenance note; open and resolved lists with duration; resolved older than 7 days hidden; escaping.
4. Poller tests: resolved request, 7-day filter, failure of resolved request does not set `error`.
5. Server tests (local servers inside the test): a theme file changing only `accent` plus `PULSE_STATUS_NAME` gives that accent and name in the page/`/theme.css` and all other default variables; invalid/missing file, invalid value → start error; fonts served as `font/woff2`, other `/fonts/*` paths 404; logo route; no external font URL.
6. Manual check with demo data (one up, one degraded, one down with open incident, one in maintenance, one TLS, two locations) at 390px and desktop, light and dark; keyboard reaches switch, bars and times.
7. README documents every theme variable, the settings (`PULSE_STATUS_THEME`, `PULSE_STATUS_NAME`, `PULSE_STATUS_LOGO`), the theme file format and a minimal example theme (e.g. `{"light":{"accent":"#0b6bcb"},"dark":{"accent":"#8ab4f8"}}`), the no-contrast-check note, and the updated "What the page shows" section.

## Repository: status
Files: `package.json`/`package-lock.json` (two fontsource deps), `public/index.html` (markup, CSS on theme variables, `@font-face`), `public/theme-default.json` (new), `public/client.js` (render summary/resolved, relative time refresh each poll), `src/theme-config.ts` (new: load, validate, merge, CSS generation; separate from `src/theme.ts`, which is the client switch), `src/server.ts` (`/theme.css`, `/fonts/*` allow-list, `/logo`, name/logo injection), `src/main.ts` (new env settings), `src/poller.ts` and `src/validate.ts` (resolved incidents), `src/render.ts` (summary, rows, times, incidents), their tests, `src/palette.test.ts` (rewrite on the default theme), `README.md`.
Behavior: as in "Required behavior" and "Decisions".
Checks: `npm run check`; the tests under "Acceptance evidence".
Completion evidence: PR with `Closes lorenzh/pulse-meta#<child>`, green `npm run check`, screenshots of light and dark at 390px and desktop from a demo-data run.
