# pulse website design

Design reference for the pulse website, exported from the design canvas "pulse Website" as version 28 on 31 October 2026. Read-only input for the website project; the built site lives in lorenzh/pulse-website.

| File | Page |
| --- | --- |
| `Main.dc.html` | Home (`/`) |
| `Docs.dc.html` | Docs: Quick start |
| `DocsApi.dc.html` | Docs: REST API reference |
| `Hosted.dc.html` | Hosted: plans and waitlist |
| `canvas.json` | Canvas index: page sizes and order |
| `losoft-tokens.json` | losoft design system tokens: colours (light and dark), type styles, spacing, radii, fonts |

The `.dc.html` files are design-canvas pages: plain HTML with inline styles plus a small component script, meant to be read for layout, content and tokens, not served. Fonts are Space Grotesk and JetBrains Mono (the `@fontsource-variable` packages that pulse-status already uses).

Content rules for the build:

- Product facts on the site must match the current code and docs of the pulse repos; the docs pages are generated from the repos' `docs/*.md` at pinned commits.
- The hosted offer does not exist yet. Prices, regions, availability promises, data location and the waitlist are placeholders until a person replaces them. So is every other commitment about the hosted offer (backups, upgrades, who runs the servers, staying up when the customer's network is down, included notifications, white-labelling): each is a marked placeholder, and a test checks the hosted table, plans and included cards.

## Changes in version 28

- Home hero: pulse checks HTTP endpoints, TLS certificates, ports, DNS, domains and cron jobs.
- Home features: the TLS card is now "TLS, TCP, DNS and domains"; new cards "Incident updates", "Latency and SLOs" and "Checks API". The Home board is 5400 px high.
- Home architecture: new texts for probe (all five check types, result buffer) and api (admin changes without a restart).
- Hosted: the included item reads "Components, incident updates, feed and badges".
- Docs REST API: the intro names probe, admin and heartbeat authentication; new rows `GET /latency`, `GET` and `POST /manual-incidents`, and `PUT /admin/checks/:id` with `If-Match` (`412` on a stale revision).
- Checked against the service repos on main: "Latency and SLOs" says "per HTTP check" (only HTTP checks have latency), and the REST intro names `GET /admin/config` as a read route that needs a token.

## Motion and background

Home (`Main.dc.html`) and Hosted (`Hosted.dc.html`):

- Section spacing is `--section-space: clamp(64px, 8vw, 128px)`, with no separator lines between sections.
- Sections fade and rise in once when they scroll into view (IntersectionObserver).
- Micro-animations: the arrow on the primary button nudges in a loop (900 ms) while the button is hovered or focused; outline buttons fill with an accent curtain on hover; buttons give press feedback; cards lift on hover; nav links get an underline; the live status preview on Home updates while it is on screen.
- Hosted "Open source" card: on hover or focus-within the heart fills with accent (250 ms) and pops 1 → 1.2 → 1 (300 ms). Eight small hearts (6–10 px) burst up and sideways 30–70 px, then fall and fade over 1.1 s; one burst per hover. The design uses static markup for the particles; the site may create them by script with randomised paths.
- Background: a canvas node network behind the page. Large receiver nodes and small sender nodes, joined by thin lines, with shooting-star pulses running along the links. Minimum distance 280 px between receivers and 60 px between senders on desktop; on phones they scale down, but never below 168 px and 36 px. Links at a node are at least 20° apart, 15° at a node with 12 or more links.

Hosted offer: every price, plan limit, SLA, region, backup, retention and open-source offer is a marked placeholder. The design uses tokens such as `[PRICE]`, `[REGIONS]`, `[TRIAL]`, `[RETENTION]`, small "placeholder" or "planned" tags, and a "Planned offer, details not final" note above the plans.

Layout details on Home and in the header:

- The "Configuration" and "The status page" two-column rows are centred vertically.
- The text links "Read the configuration guide" and "Theming and white label" are only as wide as their text.
- Status preview: the state labels are right-aligned in every row, also during the crossfade.
- Header on desktop: the GitHub button (Hosted: "Join the waitlist") comes before the theme toggle, which sits at the far right. The markup has the same order, so the tab order matches.

Docs pages (`Docs.dc.html`, `DocsApi.dc.html`): every command code block gets a copy button; output and JSON blocks get none.

- A 44 px icon button at the top right, labelled "Copy commands".
- It copies only the command lines, without the `$ ` prompt and without output or comment lines.
- On success the icon morphs into a check with a 200 ms pop and a "Copied" tooltip appears, announced to screen readers; after 1.5 s it returns to the copy icon. On a clipboard failure it shows "Copy blocked".
- Press feedback scales the button to 0.92.

Rules for the build:

- Under `prefers-reduced-motion: reduce` all of this is off: no scroll-in, no micro-animations, no canvas animation. Content is visible from the start. The Open source heart only fills (no pop, no burst); the copy button only swaps the icon.
- Docs pages stay calm: no background animation and no scroll-in. The copy button and the hover-only colour transition of the sidebar links are their only motion.
- Every hover effect, on all pages, sits under `@media (hover: hover)`.
- The canvas animation runs at most at 30 fps. It pauses while the tab is hidden (`document.hidden`) and while the canvas is off screen; the live preview pauses the same way.
