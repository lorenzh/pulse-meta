# pulse website design

Design reference for the pulse website, exported from the design canvas "pulse Website" on 30 October 2026. Read-only input for the website project; the built site lives in lorenzh/pulse-website.

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

## Motion and background

Approved for Home (`Main.dc.html`) and Hosted (`Hosted.dc.html`) only:

- Section spacing is `--section-space: clamp(64px, 8vw, 128px)`, with no separator lines between sections.
- Sections fade and rise in once when they scroll into view (IntersectionObserver).
- Micro-animations: the arrow on the primary button nudges on hover and pulses once; outline buttons fill with an accent curtain on hover; buttons give press feedback; cards lift on hover; nav links get an underline; the live status preview on Home updates while it is on screen.
- Background: a canvas node network behind the page. Large receiver nodes and small sender nodes, joined by thin lines, with shooting-star pulses running along the links. Minimum distance 280 px between receivers and 60 px between senders; links at a node are at least 20° apart.

Rules for the build:

- Under `prefers-reduced-motion: reduce` all of this is off: no scroll-in, no micro-animations, no canvas animation. Content is visible from the start.
- Docs pages stay calm: no background animation and no scroll-in.
- Hover effects apply only on devices that hover (`@media (hover: hover)`).
- The canvas animation runs at most at 30 fps, and its timers and the live preview pause while the tab is hidden (`document.hidden`) or the element is off screen.
