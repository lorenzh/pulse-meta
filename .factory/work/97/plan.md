# Spec #97: Status page polish (title, maintenance span, compact resolved list)

## Goal
Three small fixes to the pulse-status page from #82: a page title without a doubled " status", a readable maintenance time span, and a compact "Resolved in the last 7 days" list.

## Scope
Only `pulse-status`. No contract or API change.

## Non-goals
- Theme variables, white-label settings (name, logo, fonts) and the default theme from #82 stay as they are.
- The open incident list, the 7-day resolved window and the newest-first sort stay as they are.
- No change to other targets.

## Required behavior
1. **Title.** A configured `PULSE_STATUS_NAME` is the whole `<title>` (HTML-escaped, once). With no name configured the title is `pulse status`. Decision: "configured" means the option is set; setting `PULSE_STATUS_NAME=pulse` explicitly gives the title `pulse`. The wordmark keeps showing the name only.
2. **Maintenance span.** Each upcoming window shows the start relative (for example "in 1 d") and, next to it, the exact local start and end, for example "29 Oct, 22:20–00:20". Both the start and the end are `<time datetime>` elements as `renderTime` makes them. The end is shown as exact time only, never relative. The format is `D Mon, HH:mm–HH:mm` when the end is on the same local day as the start; when it is on another local day the end carries its date: `29 Oct, 22:20 – 30 Oct, 00:20`. (The issue's example crosses midnight and shows only the time; the decision is to keep the end date off only for the same local day, see Risks.) Local time comes from the browser, like `formatExact`: extend `TimeEnv` with a client-made formatter, so server-side render tests stay deterministic through an injected fake.
3. **Resolved list.** One compact line per incident: check name, resolved time, duration, reason (in that order), instead of a card each. At most 10 entries after the sort; with more, a line "and N more" (N = total − 10) below the list. With 10 or fewer no such line. The empty text stays.

## Risks
- Midnight-crossing windows: the issue example "22:20–00:20" omits the end date. Following the example literally would be ambiguous for multi-day windows, so the end date is shown whenever the end is on another local day than the start. If the person wants the literal example, change the formatter only.
- Title default rule differs from the name default; the README row must say so.

## Acceptance evidence
- `PULSE_STATUS_NAME="Acme status"` gives `<title>Acme status</title>`; no name gives `<title>pulse status</title>`; special characters stay escaped.
- A window starting and ending the same relative day renders the relative start, the exact start and end, and two `<time datetime>` elements.
- 12 resolved incidents render 10 compact lines and "and 2 more"; 10 or fewer render no such text.
- `npm run check` passes in pulse-status.

## Repository: status
Files: `public/index.html`, `public/client.js`, `src/server.ts`, `src/render.ts`, `src/render.test.ts`, `src/server.test.ts`, `README.md`.

- `src/server.ts`: compute the page title: `options.name` set -> that name, else `pulse status`; replace a `{{title}}` placeholder (escaped) in the HTML. The wordmark and the `name` validation stay.
- `public/index.html`: `<title>{{title}}</title>`; CSS for compact resolved rows (one line, no card; reason inline and truncated or wrapped without a card box) and an "and N more" line. Do not touch theme variables.
- `src/render.ts`: add `formatExactSpan(start, end)` (or equivalent) to `TimeEnv` as a client-made formatter; `renderUpcomingMaintenance` renders `renderTime(start)` plus the exact span with `<time datetime>` for start and end (exact text, no relative end). `renderResolvedIncidents` renders compact `li` rows, caps at 10 (export the constant) and adds `<p class="more">and N more</p>`.
- `public/client.js`: build the span formatter with `Intl.DateTimeFormat` (local day and month, `HH:mm`, 24 h) and pass it in `env`.
- `README.md`: the `PULSE_STATUS_NAME` row: the name is used as the page title as it is, the default title is `pulse status`.
- Tests: server test for a custom name (title shows the name once, escaped) and the default; render test for a same-day window span with a fake formatter (relative start, exact start and end, two `<time datetime>`), and for a different-day end; render tests for 12 resolved incidents (10 lines, "and 2 more") and 10 (no "more"); update the existing resolved and maintenance tests.
- Checks: `npm run check`.
- Completion evidence: the PR with these tests green and `npm run check` passing.
