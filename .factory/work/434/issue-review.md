# Issue review: #434 website phone overflow, docs code blocks, status latency rounding, demo chart

Verdict: specifiable. No blocking question.

## Findings in the clones (main)
- status: the latency chart is read only when `PULSE_STATUS_SHOW_CHECKS` is on (`ssr.ts`: `hasLatency: ctx.showChecks`; docs/configuration.md says so). It renders only for HTTP checks on the checks list. `demo-status` in `api/compose.yaml` sets only `PULSE_API_URL`, so `latency` is null and no chart appears. Answer to the issue's question: the chart needs `SHOW_CHECKS` (and `/latency`), not components as such. With components configured, the check lists (and so the charts) show only with `SHOW_CHECKS`.
- The demo checks file is written by `api/compose/demo/init.mjs` and has no `components`. So the issue's "no components section" is true. The demo config is `compose.yaml` (`demo-status` env) plus `compose/demo/init.mjs`.
- Latency display sites in `status/src/render.ts`: `renderLatency` (`${latencyMs} ms`, also the `· objective` text), `latencySummary` (p95), `renderLatencyTable` cells (p50/p95). The objective value is an integer from config. SVG chart labels: `renderChartSvg` uses `toFixed(1)` for coordinates only; check whether text labels or `<title>` elements show values. The issue says "chart labels", which may refer to the summary text or the table.
- website: `scripts/check-a11y.ts` uses Playwright-style contexts (`newContext`, width option); `check:a11y` exists in `package.json`. Docs copy button and CSS were not inspected in detail here; the spec/plan must read `website/src` and `scripts/build.ts`.

## Open points (not blocking)
1. Rounding rule: ">10 ms whole, below 10 one decimal". Boundary: use `< 10` for one decimal, `>= 10` whole (assumption). `null` stays "no data". Put one shared helper in status and use it everywhere. 0 shows "0 ms"? Assumption: one decimal below 10 gives `0.0`; trim trailing zero is allowed but must be consistent, so pick `1.2 ms`, `0 ms` -> `0 ms`.
2. Demo chart needs history: `/latency` has daily buckets, so a fresh demo shows one day (today) and a nearly empty chart. The chart renders when any day has count > 0, so it appears after the first rollup. Check how soon `/latency` returns today's data (latency-rollup in api); if only after a rollup interval, say so in the spec.
3. Demo components: the issue says "no components section". Decide: add `SHOW_CHECKS=true` only (minimal, gives chart and SLO line), and optionally add a components block to `init.mjs` so the components view is visible. Assumption: set `PULSE_STATUS_SHOW_CHECKS: "true"` on `demo-status`, and add 2 to 3 components (grouped) to the demo checks file only if the contract's component schema accepts it. Components change the page to a components view, so with `SHOW_CHECKS` the member checks list under each. The SLO line needs `latencyObjectiveMs` (exists on `slow-endpoint` only): consider also one objective on another check so a chart has a dotted line without being the slow one.
4. The demo hides details by default (`HIDE_DETAILS` true); does that remove the objective from the API? The text "objective 500 ms" shows, so the objective is public.
5. api is in scope only for demo config. Is the demo covered by an e2e or docs (README of the demo, `docs/`) that must be updated? Spec should check the api repo docs for the demo description.
6. Dependency order: status and api (demo) are independent. The demo uses `pulse-status` built from `main`, so no ordering is required; api PR should not depend on a status merge for correctness (the env var already exists).
7. website: "no page scrolls horizontally at 360 and 390 px" in `check:a11y`: assumption is all pages built to `dist` that the check already crawls, both widths, test `document.documentElement.scrollWidth <= innerWidth`. Pages with legitimate wide tables must wrap or scroll inside their own container (docs tables!). The spec must verify docs pages too, and fix what the check finds, not only the home page.
8. Docs code blocks: exact inset (suggest 8 px or `0.5rem`), right padding at least button width plus inset. Keyboard focus on a scrollable `pre` needs `tabindex="0"` for WCAG 2.1.1 (axe rule `scrollable-region-focusable`); mention in the spec. Tap target of the button stays >= 43.5 px per the existing check.
9. Home code card: also covers the same CSS for `.code-card pre.code`; `min-width: 0` on grid children of any section, not only the configuration one.

## Assumptions
- Rounding applies to display only; API values and the `data-key` structure are not changed.
- No new runtime dependencies.
- The date in the issue (30 Oct 2026) is the screenshot date, not a deadline.

## Derived acceptance check
- website: after `bun run check:site`, `check:a11y` passes and includes a check that, at 360 and 390 px, `scrollWidth <= clientWidth` for the home page and every docs page (fails on main). Home at 390 px is not wider than 390 px; the configuration section's code scrolls inside its block. In docs, the copy button has a visible inset from the top-right border, and a long `curl` line scrolls horizontally without sitting under the button.
- status: unit tests in `render.test.ts`: `1.2342099999950733` -> `1.2 ms`, `1502.040158000018` -> `1502 ms`, `9.96` -> check boundary as in open point 1; same in the live line, the summary, and the daily table. No page text matches `\d+\.\d{2,} ms`.
- api demo: `docker compose --profile demo up`, open the demo status page: the latency chart (SVG with p50/p95 and the dotted objective line) shows for the slow endpoint after the first data, and the components section (if added) is shown. No console errors.
