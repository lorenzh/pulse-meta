# Issue review: #459 website: fail the build on unsafe link schemes, add a CSP

Target: `website` only (`lorenzh/pulse-website`, `main` at `af622ee`). Nothing blocks the spec. The issue comments hold no earlier decisions; this is the first run.

## Current behavior (checked on `main` of pulse-website)

- `src/docs/links.ts`: `SCHEME = /^[a-z][a-z0-9+.-]*:/i`; `resolveLink` returns any href that matches it unchanged (`isExternal` only for `http(s):`). `javascript:`, `data:` and `vbscript:` pass through to the `<a href>` (escaped with `escapeHtml`, which only escapes HTML and does not make the URL safe).
- `src/docs/markdown.ts`: the `link` and `image` renderers both call `resolve(href)`. Images become links (`image()` → `<a href=…>`), so `![x](javascript:…)` is a second way in. Raw HTML in the Markdown is escaped, so `<a href="javascript:…">` written as HTML is not a vector. Autolinks (`<scheme:…>`) and reference links reach the same `link` renderer.
- `src/docs/page.ts` `buildDocPages` calls `resolveLink` per file. `LinkError` messages today look like `api:docs/install.md: link "…" …` (repo key and file, not the `owner/repo` name).
- `src/build/links-check.ts` `resolveTarget` returns `undefined` (skip) for `mailto:|tel:|javascript:|data:`. Other schemes (`vbscript:`, `file:`, unknown ones) are treated as relative paths and reported as "does not resolve to a file in dist", which fails by accident, with a misleading message. `html-refs.ts` `decode` handles only `&amp;`, `&quot;` and `&#39;`, not numeric entities. `collectCssRefs` drops every `data:` URL.
- `src/build/theme-hash.ts` `themeScriptHash()` returns `sha256-<base64>` of `THEME_SCRIPT`. Only `theme-script.test.ts` uses it, and that test checks only the format and that the value is stable. No CSP exists anywhere: no meta tag and no README or AGENTS text.
- `src/components/Document.tsx` renders `<head>`: `meta charset`, viewport, title, the `headTags` metas, canonical, icon, the inline `<script>` holding `THEME_SCRIPT` (via `dangerouslySetInnerHTML`, output byte-identical), the stylesheet `<link>`, then the island `<script type="module" src>`. Every page, including `404.html`, comes from `renderPage` in `src/site.tsx`. `renderSite` is pure, and `src/content/home.test.ts` already calls it, so a unit test can render every page.
- CSP-relevant content today:
  - no `style="…"` attribute and no `<style>` element in `src/`;
  - islands change styles only through CSSOM (`style.setProperty` in `heart-burst.ts` and `scroll-reveal.ts`), which `style-src 'self'` does not block;
  - no `<img>`, `<iframe>`, `<object>`, `<base>`, `eval`, `new Function`, `fetch`, `WebSocket` or `EventSource`;
  - fonts are self-hosted under `/assets/fonts/`; the only CSS `url()` values are the fonts and `url(#arch-arrow)`;
  - the one `<form>` (waitlist in `hosted.tsx`) has no `action` and stays disabled.
- No page uses `tel:` or `mailto:` today, so `tel:` is not allowed. `mailto:` stays allowed because the issue asks for it.
- `scripts/check-a11y.ts` has no `console` or `securitypolicyviolation` listener yet. CI job `site` runs build, `check:links`, `check:budget` and `check:a11y`. `budget.json` sets `htmlBytes` to 60000 per page; one meta tag of about 300 bytes is well within it.

## Open points for the plan (none blocking)

1. **Where the build-time link check lives.**
   - For docs: in `resolveLink`, or in a small dedicated module that `resolveLink` calls, before any other handling. It must also cover the `image` renderer path.
   - For hand-written pages: TSX hrefs come from constants (`siteConfig`, `facts`, `c.href`, `p.cta.href`). The simplest full coverage is a check over each rendered page in `renderSite`/`renderPage` (pure), or in `scripts/build.ts`, that throws naming the dist file and the link.
   - The plan picks one and says how hand-written pages are covered. A dist-only check is not enough, because the issue wants the build itself to fail.
2. **Normalisation before the scheme test.** Strip leading and trailing C0 controls and spaces, and remove ASCII tab, LF and CR anywhere, as the WHATWG URL parser does. Then match the scheme case-insensitively.
   - Allowed: `http:`, `https:`, `mailto:`, and scheme-less values (relative paths, `/…`, `#…`, `?…`).
   - A value whose first `:` comes before any `/`, `?` or `#` counts as having a scheme, so `java\tscript:` and `\x01javascript:` must fail too.
   - The plan should also cover HTML-entity forms (`&#106;avascript:`), at least in the dist check, which must decode numeric entities before testing. In the Markdown path, check how `marked` 18.1.2 passes entities and backslash escapes in link destinations and add a test case.
   - Protocol-relative `//host` in docs today resolves to a blob URL and needs no change; leave it as is.
3. **Error text.** "names the source file, the repository and the link": use the `owner/repo` (for example `lorenzh/pulse-api`) plus the file path plus the raw href. Today's messages only use the repo key, so either add the full name or state that the key is enough. Hand-written pages have no repository; their error names the page or dist file and the link.
4. **One link or all.** The acceptance fixture has four bad links. Either the test checks each link on its own (one fixture per link, each must throw), or the error collects all unsafe links of a file. Either works; the plan picks one so that each of the four is proven to fail on its own.
5. **Dist link check (`links-check.ts`).**
   - Replace the skip list: `mailto:` is skipped as today. Any other scheme becomes its own problem (`unsafe link scheme`) instead of being skipped or misreported. `tel:` is no longer skipped.
   - Apply the same normalisation as point 2; share one pure module with the build check rather than two regexes.
   - Decide whether `src`, `action` and `srcset` get the same rule (recommended: yes, every collected ref).
6. **CSP placement under React 19.** `renderToStaticMarkup` in React 19 may reorder head metadata (charset first, hoisting). The CSP meta must be the first element of `<head>` and come before the inline theme script and every `<link>` and `<script>`. If React does not keep it first, `renderPage` may insert it as a string right after `<head>` (the output is already a string). A test asserts the order in the rendered HTML. `<meta charset>` moving to second place is fine: it stays within the first 1024 bytes.
7. **Hash test that really catches drift.** `themeScriptHash()` hashes `THEME_SCRIPT` at build time, so a computed CSP always matches its own constant. To meet "changing one character of the theme script without rebuilding the hash fails the test":
   - pin the expected hash as a literal in the test, which must be updated on purpose whenever the script changes;
   - and/or extract the inline `<script>` text from each rendered page, hash it, and assert that the page's CSP `script-src` holds that hash.
   - The plan states which and shows the mutation, for example by editing one character of `THEME_SCRIPT` and showing the red test.
   - Update the doc comment of `themeScriptHash()`, which says "only recorded".
8. **CSP value.** Take the issue's policy as given: `default-src 'self'; script-src 'self' '<hash>'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`.
   - Nothing on the site needs `'unsafe-inline'` for styles today; the plan re-checks the TSX, the island bundles and the Preact output.
   - `img-src data:` is not needed by any page today. Keep it as the issue states, or drop it with a reason.
   - Do not put `frame-ancestors`, `report-uri`/`report-to` or `sandbox` into the meta tag: browsers ignore them there, and Chrome logs a console warning for `frame-ancestors`. Document them for the host instead.
9. **Playwright CSP listener.**
   - Register the `securitypolicyviolation` listener before page scripts run (`page.addInitScript` / `context.addInitScript`), collect the events, and fail on any.
   - Also fail on console messages that report a CSP block.
   - Do not set `bypassCSP`.
   - Risk: axe-core or the check script's own `page.evaluate` code might set style attributes and raise violations. If so, the plan must find the cause and not filter broadly. Islands to exercise: theme toggle, menu, docs nav, copy button, plus network canvas, live preview, scroll reveal and heart burst, which are on the home page.
10. **Docs.** Add to `README.md` (website) a section with the link rule and the CSP: what is allowed, where the hash comes from, and that HTTP headers such as `frame-ancestors`, HSTS, `X-Content-Type-Options` and `Referrer-Policy` follow once a host is chosen. Add to `AGENTS.md` (website) the rule: no inline scripts or styles beyond the hashed theme script, and links only with the allowed schemes. pulse-meta needs no change.

## Assumptions

- "The build" means `bun run build` (`scripts/build.ts` → `buildDocPages` / `renderSite`). Unit tests prove the failure through the pure functions with fixture sources, without network access, as the repo rules require.
- `mailto:` and `http(s):` are matched case-insensitively. Their output is not rewritten; only the check is added.
- The CSP is identical on every page, since all pages share the theme script and use only same-origin assets. One builder function, for example `src/build/csp.ts`, makes it from `themeScriptHash()`.
- No new dependency and no change to `budget.json`, the lint/tsc config or CI, except what `check:a11y` itself needs, which lives in `scripts/check-a11y.ts`.
- `tel:` is not allowed, because no page uses it today.

## Derived acceptance check

On the website PR branch, `bun run check:all` passes in CI (`check` and `site`), and:
1. Unit tests:
   - `buildDocPages` (or `resolveLink`) with a docs fixture holding `[x](javascript:alert(1))`, `[y](JaVaScRiPt:alert(1))`, `[z](data:text/html,<script>…)`, `[w]( javascript:…)`, plus an image form and a control-character form, throws for each, with the repository, the file and the link in the message.
   - `http`, `https`, `mailto`, relative and `#fragment` links still pass.
   - `checkLinks` reports a problem for `<a href="javascript:alert(1)">` and for `href=" JAVASCRIPT:…"` in a dist page.
   - The PR shows mutation output: with the check removed, these tests fail.
2. A unit test over `renderSite` with fixture docs checks every HTML page:
   - exactly one `<meta http-equiv="Content-Security-Policy">`, as the first element of `<head>`;
   - its `script-src` holds the hash of the inline theme script found in that page, and that hash equals a pinned literal;
   - changing one character of `THEME_SCRIPT` makes the test fail.
3. `bun run check:a11y` passes on the built `dist/` with the CSP in place, and records zero `securitypolicyviolation` events across all pages, themes and widths, with all islands working.
4. `bun run check:budget` passes.
