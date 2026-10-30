# Spec 434: Website phone overflow, docs code blocks, status latency rounding, demo chart

## Goal
Fix reflow on phones and docs code blocks in the website, round latency for display in status, and make the demo status page show the latency chart with the SLO line.

## Scope
- website: no horizontal scroll at 360 and 390 px on any page; docs code block copy button inset and scrolling; new `check:a11y` assertion.
- status: one shared display helper for latency, used at every site that shows latency.
- api: demo config only (`compose.yaml`, `compose/demo/init.mjs`).

## Non-goals
- No change to API values, the `data-key` structure, contract, or runtime dependencies.
- No change to the status chart logic itself, no product change in api.

## Decisions (from issue-review assumptions)
- Rounding: `< 10 ms` shows one decimal (`1.2 ms`), `>= 10 ms` shows whole ms (`1502 ms`). `null` stays "no data". `0` shows `0 ms`. A value that rounds to `10.0` at one decimal (9.96) shows `10 ms` (round whole when the one-decimal result reaches 10).
- Answer to the issue's question: the chart renders only with `PULSE_STATUS_SHOW_CHECKS` (it reads `/latency` only then), for HTTP checks on the checks list. Components are not required.
- Demo: set `PULSE_STATUS_SHOW_CHECKS: "true"` on `demo-status`. Add a `latencyObjectiveMs` to a second HTTP check in `init.mjs` so more than one chart shows the SLO line. Components are added to the demo only if the contract schema accepts them and the result still shows the chart (implementer verifies against `.repos/contract`); otherwise skip and say so in the PR.

## Performance impact
none expected. The change is CSS, a display helper, a docs-page test and demo-only compose config; none of the startup, load, RSS, test, build, image-size or latency metrics in `bench/budgets.json` is touched (demo profile is not benchmarked).

## Repository: website
Files: `src/styles/components.css` (grid and code-card/`pre.code` rules, docs code block and copy button), `src/islands/copy-button.tsx`, `src/docs/` markdown render (code block markup), `src/content/home.tsx`, `scripts/check-a11y.ts`.
Behavior:
- `min-width: 0` on grid children (any section, covering the Configuration section's eyebrow, h2, lead and `.code-card`); `overflow-x: auto` on `pre.code` and docs `pre`.
- Docs code block: copy button inset (`0.5rem`) from top and right borders; block `overflow-x: auto`; right padding at least button width plus inset so text never sits under the button. Button tap target stays at least the size the existing check demands.
- Scrollable `pre` gets `tabindex="0"` (WCAG 2.1.1, axe `scrollable-region-focusable`) and a visible focus style.
- `check:a11y`: for the home page and every page the check already crawls (docs included), at 360 and 390 px assert `document.documentElement.scrollWidth <= innerWidth`. Fix every page it flags (docs tables wrap or scroll in their own container).
Checks: `bun run check:site` (includes `check:a11y`, budget, links), unit tests for markup changes.
Evidence: the new check fails on main and passes; home at 390 px is not wider than 390 px; screenshot or DOM assertion of the copy button inset and a long `curl` line scrolling.

## Repository: status
Files: `src/render.ts` (`renderLatency`, `latencySummary`, `renderLatencyTable` p50/p95 cells, any chart text or `<title>` that shows a value), `src/render.test.ts`, `src/latency.test.ts`.
Behavior: add one helper (for example `formatLatencyMs`) implementing the rounding rule above and use it at every display site, including the `· objective` text (integer stays as is). Chart coordinates are not affected.
Checks: repo's usual test, lint and type commands per its `AGENTS.md`.
Evidence: tests: `1.2342099999950733` -> `1.2 ms`, `1502.040158000018` -> `1502 ms`, `9.96` -> `10 ms`, `0` -> `0 ms`, null unchanged; same in the live line, summary, daily table; no rendered page text matches `\d+\.\d{2,} ms`.

## Repository: api
Files: `compose.yaml` (`demo-status` env), `compose/demo/init.mjs`, and the demo description in README or `docs/` if it exists.
Behavior: `demo-status` gets `PULSE_STATUS_SHOW_CHECKS: "true"`; a second HTTP check gets a `latencyObjectiveMs`; optional components as in Decisions. Keep `HIDE_DETAILS` as is. State in the docs or PR that the chart fills after the first latency rollup and shows a single day on a fresh demo (implementer checks how soon `/latency` returns data).
Checks: api's usual checks (`AGENTS.md`), including any compose or demo config test; `docker compose --profile demo config` validates.
Evidence: demo status page shows the SVG latency chart with p50/p95 and the dotted objective line (verify with `docker compose --profile demo up`, no console errors). No dependency on a status merge: the env var already exists on status `main`.
