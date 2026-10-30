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
