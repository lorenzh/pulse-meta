# Issue review #97

Only `pulse-status` changes (`public/index.html`, `src/server.ts`, `src/render.ts`, tests, README). No contract/API change.

## Current state (checked in `.repos/status`)
- `public/index.html` has `<title>{{name}} status</title>`; `server.ts` defaults the name to `pulse` and replaces `{{name}}` (escaped). The name also feeds the wordmark.
- `renderUpcomingMaintenance` renders `renderTime(start) – renderTime(end)`; both are relative, so same-day windows read "in 1 d – in 1 d". `TimeEnv.formatExact` is browser-made (the tooltip text); the server renders relative text only.
- `renderResolvedIncidents` renders one `li.incident.resolved` per incident (name, resolved time, duration, reason), no limit; empty text exists.

## Open points / assumptions
1. Title vs default: the issue wants a custom name used as is, but default `pulse` must stay "pulse status". Assumption: the default title becomes "pulse status" while a configured name is the whole title (e.g. title template `{{title}}`, with title = configured name, or "pulse status" if none configured). Wordmark keeps showing the name only. Explicitly setting `PULSE_STATUS_NAME=pulse` yields title "pulse" (or is treated like the default; the plan picks one and tests it). README row for `PULSE_STATUS_NAME` must be updated.
2. Exact times "29 Oct, 22:20–00:20": local time is known only in the browser (like `formatExact`). Assumption: extend the `TimeEnv` mechanism (e.g. an exact-range formatter made client-side, with server HTML containing a placeholder/`data-*` the script fills, or a server fallback in UTC), keeping `<time datetime>` elements for start and end. The plan must decide how server render tests stay deterministic. Format: "D Mon, HH:mm–HH:mm"; when end is on a different local day, assumption: include the end date ("29 Oct, 22:20 – 30 Oct, 00:20"). Example in the issue itself crosses midnight with only the time shown for end, so the end date is omitted only if... it's ambiguous; assumption: omit the end date when end is the same local day or within the same span display, otherwise include it.
3. "Same-day window" in the Constraints/test: the relative start ("in 1 d") is shown always; end is shown as exact time only (no relative end). Applies to all upcoming windows, not only same-day ones.
4. Resolved list: one line per incident; fields in order name, resolved time, duration, reason. Limit 10 after the existing newest-first sort; "and N more" shown below when more than 10 (N = total − 10). Open incidents list unchanged. The 7-day window unchanged.
5. Styling: CSS for compact rows is in `index.html`; theme variables, white-label settings and default theme from #82 must not change.

## Acceptance check
- `PULSE_STATUS_NAME="Acme status"` → `<title>Acme status</title>` (once); no name → `<title>pulse status</title>`; name still HTML-escaped.
- A maintenance window starting and ending the same relative day renders the relative start ("in 1 d"), the exact start and end times, and `<time datetime>` for both.
- With 12 resolved incidents in the last 7 days: 10 single-line entries and "and 2 more"; with ≤10 no such text.
- Tests for custom-name title, same-day window span and the list limit; `npm run check` passes in pulse-status.

No blocking questions.
