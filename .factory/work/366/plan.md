# Spec #366: Website spacing, motion and node-network background

## Goal
The built Home and Hosted pages in `lorenzh/pulse-website` match the approved design (version 27, `design/website/` in pulse-meta, added by #365) in spacing, motion and background, and docs pages get copy buttons for command blocks. No loss in accessibility or performance.

Preconditions (verified in the issue review): #365 is merged; the website runs on Bun (#367 and #393 closed). No new blocker issue is needed.

## Scope
- Only the `website` target changes. No other repository changes (the issue review found no product change; facts are only checked against `api`, `probe`, `config`, `status`).
- Pages: Home, Hosted (spacing, scroll-in, micro-animations, canvas, content, layout, header order); all pages (header order, hover rule); docs (copy buttons, content fixes, hover-only sidebar transition).

## Non-goals
- No background motion or scroll-in on docs pages.
- No Lighthouse dependency or CI gate (run ad hoc, numbers in the PR).
- No real Hosted offer values: all stay placeholders. The waitlist form stays disabled.
- No new runtime dependency; no external request at runtime.

## Design values (copied from the design; the implementer does not see pulse-meta)
- `--section-space: clamp(64px, 8vw, 128px)`; no borders or `<hr>` between sections.
- Easing `--ease: cubic-bezier(0.2, 0, 0, 1)`.
- Scroll-in: from `opacity 0` and `translateY(32px)` to rest, 700 ms `--ease`, stagger 100 ms between siblings that appear together, IntersectionObserver `threshold: 0.15`, `unobserve` after the first hit, once only.
- Primary button arrow: `translateX(6px)` with keyframes `0%,100% translateX(6px) scale(1)`, `25% translateX(10px) scale(1.15)`, `75% translateX(4px) scale(1)`; 900 ms ease-in-out, 200 ms delay, infinite; on `:hover` (hover media) and `:focus-visible`.
- Buttons: transition on background 200 ms, border and colour 450 ms ease-in-out, shadow 250 ms, transform 320 ms `cubic-bezier(.34,1.56,.64,1)`; `:active` `scale(.94)`, 120 ms ease-out.
- Outline button curtain: a `.fill` element (accent) scales `scaleX(0 -> 1)` in 450 ms ease-in-out on hover/focus; text switches to `--on-strong`.
- Cards lift: `translateY(-6px)`, border accent, shadow, 250 ms `--ease`.
- Nav link underline: `::after` `scaleX(0 -> 1)`, 300 ms `--ease`, on hover and `:focus-visible`.
- Status preview: one change every 4 s, an "ago" counter ticks every second, opacity crossfade 600 ms; paused while `document.hidden` or off screen.
- Open source heart: fill with accent 250 ms; pop 1 -> 1.2 -> 1 in 300 ms; 8 particles of 6–10 px, travel 30–70 px up and sideways, then fall and fade, 1.1 s total; one burst per hover.
- Canvas: receivers large, senders small, thin links, shooting-star pulses (pulse duration `clamp(len/130 s, 1.4 s, 4.2 s)`, 12 % of pulses in a second colour, spawn every ~0.6–1.5 s scaled by max pulse count); min distance 280 px (receivers) and 60 px (senders) on desktop, scaled with viewport width on phones to no less than 168 px and 36 px; angle between links at a node >= 20°, >= 15° at a node with 12 or more links; 30 fps cap (`now - last < 33` skips); reads theme colours on theme change, not per frame.
- Copy button: 44 px, top right, name "Copy commands"; pop 200 ms; tooltip "Copied" / "Copy blocked" in a live region (`role="status"`); reset after 1.5 s; `:active` `scale(.92)`.

## Required behavior
All requirements of the issue apply as written. Decisions where the issue is open (from the issue review):
1. **Scroll-in:** one small non-Preact script (or one island) sets `js-reveal` on `<html>` before first paint only if `IntersectionObserver` exists and `prefers-reduced-motion` is not `reduce`. Without it content is visible. Items already in view reveal at once without a flash. `transform` and `opacity` only. One observer for all sections.
2. **Canvas:** fixed, viewport-sized, `aria-hidden="true"`, `pointer-events: none`, `z-index` below content. Sizes measured on resize only (`ResizeObserver`/`resize`), never in the loop. The loop reads no layout and writes no layout-affecting styles. Stops on `document.hidden` and while off screen (IntersectionObserver); `visibilitychange` restarts. Under reduced motion draw one static frame (nodes and links, no pulses), redraw on resize only. Without JS: no canvas. Low-alpha lines and nodes from tokens; document the worst-case blend against the text colours of both themes (>= 4.5:1) and check visually in light and dark.
3. **Placement logic** (node placement, distance rules, angle rules, phone scaling, handling when the angle rule cannot be met by dropping the link, frame throttle) lives in pure `.ts` modules with `bun:test` tests and an injectable random.
4. **Live status preview** becomes an island on Home. No JS or reduced motion: one fixed state, no crossfade. Both states share one grid cell; labels right-aligned in each row, also during the crossfade. Only the visible state is exposed to screen readers; the other has `aria-hidden="true"`, so the accessible text equals the visible text. Timers stop while hidden or off screen and restart on `visibilitychange`.
5. **Heart burst island** on Hosted: creates 8 `aria-hidden` particles per burst on `pointerenter` (hover media) and `focusin`; re-arms on `pointerleave` and when focus leaves the card; removes particles after 1.1 s. `transform`/`opacity` only. Under reduced motion only the fill. The card must contain a focusable element so focus-within is reachable (check `hosted.tsx`; if none, the card's link gets the focus).
6. **Docs copy buttons:** classify command blocks at build time in `src/docs/markdown.ts`: a fenced block with language `bash`/`sh`/`shell`/`console` that has at least one `$ ` line, or a shell block whose lines are all commands. `json`, `text`, plain and output-only blocks get none. Copied text = lines with the `$ ` prompt removed; output lines (lines following a `$ ` command without prompt), comment lines (`#`) skipped; `\` continuation lines stay with their command; check fixtures in `test/fixtures/` and the pinned docs for edge cases (heredocs, multiple commands). Pages with no command block ship no copy-button island or script. The existing copy button is replaced by the new behaviour (icon, "Copy commands", "Copied"/"Copy blocked", 1.5 s).
7. **Hover rule:** list all existing hover rules in `base.css`, `components.css`, `docs.css` and move them under `@media (hover: hover)`. Focus effects stay outside it. A test scans the built CSS: every `:hover` selector sits inside a hover-media block. Docs sidebar links keep only a colour transition.
8. **Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables every animation and transition (scroll-in, buttons, arrow loop, curtain, lift, underline, preview crossfade, canvas animation, heart pop/burst; the heart only fills; the copy button only swaps the icon).
9. **Outline button contrast:** text colour must be >= 4.5:1 against both the resting background and the accent in each theme at every frame. Give the token pair numbers in the PR; if no single colour passes on both, switch the text colour with a delay so no frame falls below AA (or fill via a `transform` pseudo-element and `color` change timed at the curtain midpoint).
10. **Header order (all pages, desktop):** markup order nav, GitHub button (Hosted: "Join the waitlist"), theme toggle at the far right. The mobile menu layout stays unless it conflicts with tab order.
11. **Home layout:** "Configuration" and "The status page" rows `align-items: center`; text links "Read the configuration guide" and "Theming and white label" are `width: fit-content` (not stretched).
12. **Home content, version 27:** quick start includes generating the probe token (`openssl rand -hex 32`, pasted as `PULSE_PROBE_TOKEN` in `.env`); quorum wording: with two or more locations reporting, a check is down only when at least two see it down; privacy: only check targets (URLs) and error details stay private by default, components group checks and the page shows components; the config example has `name` and `secret` for the heartbeat check. Verify each against `.repos/{api,probe,config,status}` (code wins over design per website `AGENTS.md`), and state any difference in the PR. Product facts only from `facts.ts`.
13. **Hosted content:** every price, plan limit, SLA, region, backup, retention and open-source offer is a `<mark class="placeholder">` token (`[PRICE]`, `[REGIONS]`, `[TRIAL]`, `[DISCOUNT]`, `[REGION]`, `[BACKUP REGION]`, `[RETENTION]`, "placeholder"/"planned" tags) with the note "Planned offer, details not final" above the plans. Extend `hosted.test.ts` for the new tokens; no invented values.
14. **Islands:** canvas, live preview, scroll-in, heart burst and copy button are islands, mounted only on pages that contain their slot. JS budget (`budget.json`, 30000 B per page) must stay; share the Preact alias; keep the scroll-in and heart burst as tiny vanilla modules. Do not raise the budget silently; if it must change, state the reason and size per island in the PR.
15. **Timers:** every `setInterval`/`setTimeout`/`requestAnimationFrame` loop stops while `document.hidden` and restarts on `visibilitychange`.

## Risks
- JS budget overrun from five islands (mitigate: vanilla modules, per-page mounting, measure with `check:budget`).
- Contrast of text over the canvas is not visible to axe (mitigate: low alpha, computed worst case, visual check).
- Scroll-in hurting LCP/CLS (mitigate: transform/opacity only, above-the-fold items shown at once, hidden state only after the script runs).
- Command-block classification edge cases in docs.
- Lighthouse scores dropping from the canvas (mitigate: 30 fps cap, start after load/idle, off-screen pause).
- Design vs product facts differences.

## Performance impact
none expected for the api bench keys (`startup CPU`, `load CPU`, `RSS`, `test CPU`, `build CPU`, `image size`, p95, requests per second): this change is only in the website repository, which is static HTML, CSS and browser JavaScript, and touches no api code or image. (`bench/` is not present in `main` of the api repository.) The website's own metrics can move: per-page JS size grows by the islands (measured by `check:budget`, must stay within `budget.json`), CSS grows somewhat, and Lighthouse mobile performance must not drop. The implementer measures before/after with `bun run build && bun run check:budget` and an ad hoc Lighthouse run (mobile, local `dist/` served statically) of Home and Hosted on `main` first and after the change, and puts both sets of numbers in the PR.

## Repository: website
Files (names as in the repo; adapt to the real structure):
- `src/styles/tokens.css`: `--section-space`, motion tokens (durations, easings), canvas colour/alpha tokens per theme.
- `src/styles/base.css`, `components.css`, `docs.css`: spacing, no section separators, micro-animations, hover migration into `@media (hover: hover)`, reduced-motion block, copy button, curtain, nav underline, layout fixes.
- `src/components/*` (header, layout, buttons): header markup order, `.fill` curtain element, canvas slot, reveal markers.
- `src/content/home.tsx`, `status-mock.tsx`, `facts.ts`, `hosted.tsx`: content of version 27, preview markup with one visible state, placeholders, heart card markup.
- `src/islands/`: new `network-canvas`, `live-preview`, `heart-burst`, `scroll-reveal`; rewritten `copy-button`; `mount.tsx` mounts only the islands present. Pure logic in `src/lib` or next to the islands (`network.ts`, `throttle.ts`, `commands.ts`).
- `src/docs/markdown.ts`: command-block detection and the copy slot.
- `scripts/check-a11y.ts` (or a sibling Playwright script run in the CI `site` job): axe and keyboard checks in both themes (tab order nav, button, toggle; heart burst on focus-within), reduced-motion test with `reducedMotion: 'reduce'`, copy-button test (copied text per block, "Copied" and "Copy blocked" via stubbed `navigator.clipboard.writeText`, output and JSON blocks have no button), canvas fps/visibility checks, built-CSS hover scan.
- `test/*.test.ts`: unit tests for placement (distances 280/60, phone minimum 168/36, angles 20°/15°, unsatisfiable case), throttle (33 ms), command extraction, hosted placeholders, facts.
- `budget.json`: unchanged unless justified.

Checks: `bun run check:all` (lint, types, `bun test` with the 80 % coverage gate, build, budget, links, a11y) green; no new entry in `package.json` dependencies; no cross-origin request.

Completion evidence (in the PR):
- Lighthouse performance/accessibility/best-practices (mobile, local build) for Home and Hosted on `main` before and after, none lower; budget passing.
- Outline button contrast numbers per theme; canvas worst-case contrast numbers.
- Screenshots of Home and Hosted in light and dark.
- List of migrated hover rules, JS size per island, and any differences between design and product facts.
- Link to this spec and `Closes lorenzh/pulse-meta#<child>`.
