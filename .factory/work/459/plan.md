# Spec: #459 website: fail the build on unsafe link schemes, add a CSP

Source: issue #459 (security audit M6 and M7) and the issue review in `.factory/work/459/issue-review.md`. I checked the facts below on `main` of pulse-website (`af622ee`).

## Goal

`bun run build` fails on any link with an unsafe URL scheme, in docs Markdown and in hand-written pages, and the error names the file, the repository and the link. `bun run check:links` also fails on such links in `dist/`. Every page carries a `<meta http-equiv="Content-Security-Policy">` as the first element of `<head>`. The policy allows only the site's own scripts, styles and fonts, plus the hashed inline theme script, and every island keeps working under it.

## Scope

- Repository: `website` only.
- One shared pure module decides whether a URL is safe. Three callers use it: the docs link resolver, a check over every page `renderSite` renders, and the `dist/` link check.
- One pure module builds the CSP from `themeScriptHash()` and puts the meta tag into every page.
- Tests: unit tests, plus a `securitypolicyviolation`/console listener in `scripts/check-a11y.ts`.
- `README.md` and `AGENTS.md` of the website.

## Non-goals

- No HTTP headers and no hosting config. `frame-ancestors`, `report-uri`/`report-to`, `sandbox`, HSTS, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` are only documented, for when a host exists.
- No change to the docs sources in other repositories. A grep of the `docs/` folders on `main` of all six docs repositories finds no link with a scheme other than `http(s):`, so the current pins should still build. The implementer confirms this with `bun run build`.
- No new dependency, and no change to `budget.json`, `biome.json`, `tsconfig.json`, the ESLint config or CI.
- No change to how CSS `url()` values are checked (`collectCssRefs` keeps dropping `data:`).
- `tel:` is not allowed: no page uses it today (grep of `src/`, `site.config.ts` and the docs repos).

## Current behavior (what changes)

- `src/docs/links.ts` `resolveLink`: `SCHEME.test(href)` returns any scheme unchanged. `markdown.ts` sends both `link` and `image` (an image becomes an `<a>`) through `resolve`. `buildDocPages` runs a first pass with an identity resolver to collect heading ids. Only the second pass calls `resolveLink`.
- `src/build/links-check.ts` `resolveTarget` skips `mailto:|tel:|javascript:|data:`. Other schemes are misreported as "does not resolve to a file in dist".
- `src/build/html-refs.ts` `decode` handles only `&amp;`, `&quot;` and `&#39;`.
- `src/build/theme-hash.ts`: `themeScriptHash()` is used only by a format test.
- `src/components/Document.tsx`: the head order is charset, viewport, title, meta tags, canonical, icon, inline theme `<script>`, stylesheet, module scripts.
- Nothing on the site needs inline styles or other origins:
  - no `style=` attribute, no `style={…}` in TSX and no `<style>` element in `src/`;
  - islands change styles only through `style.setProperty` (CSSOM, which `style-src` does not govern);
  - no `<img>`, `<iframe>`, `<object>`, `<base>`, `eval`, `fetch` or WebSocket;
  - fonts are under `/assets/fonts/`;
  - the waitlist form has no `action`.

## Required behavior

### 1. URL safety rule (one shared module)

New pure module `src/build/url-safety.ts`:
- `urlScheme(value: string): string | undefined`
- `isSafeUrl(value: string): boolean`
- `class UnsafeLinkError extends Error { override name = "UnsafeLinkError" }`

Normalisation, in this order (as the WHATWG URL parser does):
1. Strip leading and trailing C0 controls and spaces (U+0000–U+0020).
2. Remove every ASCII tab, LF and CR (U+0009, U+000A, U+000D) anywhere in the value.

Scheme detection after normalisation: find the first `:`.
- If it comes before any `/`, `?` and `#`, the text before it, lowercased, is the scheme. The scheme does not have to match the scheme grammar: `java\x01script:`, `&#106;avascript:` (undecoded) and `foo bar:` all count as having a scheme.
- Otherwise the value has no scheme.

The rule: safe if and only if the value has no scheme (relative path, `/…`, `#…`, `?…`, `//host…`), or its scheme is exactly `http`, `https` or `mailto`, compared case-insensitively. `HTTPS://x` is safe. Everything else is unsafe, `tel:` included. The empty string is safe (same page).

`isSafeUrl` never rewrites the value. Callers keep emitting the original href, as today.

### 2. Build-time check, docs Markdown

`resolveLink` (`src/docs/links.ts`) checks `isSafeUrl(href)` as its first statement, before `SCHEME`.
- On failure it throws `UnsafeLinkError` with the message
  `<owner/repo> <file>: unsafe link <JSON.stringify(href)>: only http:, https:, mailto: and in-site links are allowed`.
  Example: `lorenzh/pulse-api docs/install.md: unsafe link "javascript:alert(1)": only http:, https:, mailto: and in-site links are allowed`.
- `<owner/repo>` is `ctx.config.repos[ctx.repoKey].repo`. If that lookup fails, use the repo key.
- `JSON.stringify` makes control characters visible and keeps the log on one line.
- Links and images both hit this check, because both go through `resolve`.
- One error per build: the first unsafe link throws. The tests prove each fixture link on its own (one fixture per link).
- The identity resolver in the first pass of `buildDocPages` stays. The second pass renders every file and throws.

### 3. Build-time check, every rendered page (hand-written pages included)

`renderSite` (`src/site.tsx`) checks each rendered HTML page before it returns:
- It runs `collectRefs(html)` and finds every ref whose value fails `isSafeUrl`.
- For `srcset`, it checks each comma-separated candidate's URL (its first whitespace-separated token).
- It throws `UnsafeLinkError`: `<dist file>: unsafe link <tag> <attr>=<JSON.stringify(value)>: only http:, https:, mailto: and in-site links are allowed`. Hand-written pages have no repository, so the dist file names the page.

`collectRefs` decodes each value once. This covers the TSX constants (`siteConfig`, `facts`, `c.href`, `p.cta.href`) and gives docs pages a second check.

Implement the page check as a pure exported function `unsafeRefs(html: string): Ref[]` in `src/build/url-safety.ts`, or in `html-refs.ts` if an import cycle forces it. `renderSite` and `links-check.ts` both call it.

### 4. Entity decoding in `html-refs.ts`

`decode` becomes one single-pass replace for:
- `&amp;`, `&quot;`, `&#39;`;
- decimal `&#NNN;` and hex `&#xHH;` (case-insensitive `x`);
- the named entities `&colon;`, `&Tab;`, `&NewLine;` and `&lpar;`/`&rpar;`, case-insensitive on the name.

Single pass means `&amp;#106;` decodes to the literal text `&#106;`, not to `j`. That is right, because the browser decodes once. Any other `&name;` stays as it is. If it sits before the first `:`, the scheme text holds `&` and is not in the allow-list, so the value fails. That is the conservative result.

### 5. `dist/` link check (`src/build/links-check.ts`)

- In `checkPage`, before `isCrossOrigin` and `checkInternal`, every ref whose value fails `isSafeUrl` adds the problem `<file>: unsafe link scheme in <tag> <attr>=<JSON.stringify(value)>`. The ref is not counted as internal or external.
- `resolveTarget` no longer skips `tel:`, `javascript:` or `data:`. It skips only `mailto:`, matched case-insensitively after the same normalisation; everything else unsafe has already been reported.
- `http(s):` refs keep going through `isCrossOrigin`, and `mailto:` refs are counted as external links.

### 6. Content-Security-Policy

New pure module `src/build/csp.ts`:
- `contentSecurityPolicy(): string` returns exactly
  `default-src 'self'; script-src 'self' '<themeScriptHash()>'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`.
  - This is the issue's policy, unchanged.
  - `img-src data:` is not needed by any page today. It is kept as the issue states, because a `data:` image cannot run script.
  - There is no `'unsafe-inline'` anywhere, because nothing needs it (see Current behavior).
  - The policy holds no `frame-ancestors`, `report-uri`, `report-to` or `sandbox`: browsers ignore them in a meta tag, and Chrome logs a console warning for `frame-ancestors`.
- `cspMetaTag(): string` returns `<meta http-equiv="Content-Security-Policy" content="<policy>">`. The policy holds no `"`, `&`, `<` or `>`, which a test asserts.
- `withCsp(html: string): string` inserts `cspMetaTag()` immediately after the single `<head>` start tag. It throws a named `Error` subclass (`CspError`) if the HTML does not hold exactly one `<head>`.
  - The tag is inserted as a string, not through JSX, because React 19 `renderToStaticMarkup` may reorder head metadata.
  - `<meta charset>` becomes the second element and stays within the first 1024 bytes; a test asserts this.
- `cspProblems(file: string, html: string): string[]` (pure) checks that the page has:
  - exactly one CSP meta tag;
  - that tag as the first element after `<head>`;
  - a `content` equal to `contentSecurityPolicy()`;
  - exactly one inline `<script>` (no `src`), whose sha256 hash (base64) appears as a `'sha256-…'` source in `script-src`;
  - no `style=` attribute and no `<style>` element.

`renderPage` in `src/site.tsx` wraps its final output with `withCsp(...)`. This covers every page from `renderSite`: home, hosted, every docs page, `/docs/` and `404.html`.

`src/build/theme-hash.ts`: update the doc comment. The hash now feeds `script-src` in `csp.ts`; remove "only recorded".

`scripts/check-links.ts` also runs `cspProblems` on every page of `dist.html` and adds the results to the failure list, under the heading `csp`. This keeps the check on the real `dist/` in the CI job `site` without touching CI.

### 7. Islands under the CSP

No island changes are expected:
- the island scripts are same-origin `type="module" src` files (`'self'`);
- styles change only through CSSOM `setProperty`;
- Preact applies style props through CSSOM, and no TSX passes `style`;
- fonts are same-origin.

If the listener in section 8 reports any violation, fix the cause by moving an inline style to a class or a CSSOM call. Do not loosen the policy. A policy change needs a written justification in the PR.

### 8. Playwright CSP listener (`scripts/check-a11y.ts`)

New helper `watchCsp(context, where)`. Call it everywhere `watchNetwork` is called today: the main theme/width loop, `checkNoScript`, `checkCopyButtons` and `checkMotionPages`.
- It runs before any page loads.
- `await context.exposeBinding("__cspViolation", (_src, v: string) => fail(where, \`CSP violation: ${v}\`))`.
- `await context.addInitScript(...)` registers `document.addEventListener("securitypolicyviolation", e => __cspViolation(\`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}\`), true)`. Init scripts run before page scripts.
- `context.on("console", m => …)` fails on any message whose text contains `Content Security Policy` or `Content-Security-Policy`. This also catches warnings such as an ignored directive.
- No context sets `bypassCSP`; grep the script to confirm.
- In the no-JS context, init scripts do not run, but the console listener still applies.

Positive control, `checkCspListener(browser)`: in its own context with `watchCsp` pointed at a local list, not at `fail`:
1. Load `/`.
2. Run `page.evaluate(() => { const s = document.createElement("script"); s.textContent = "1"; document.head.append(s); })`. CDP evaluate itself is not blocked, but the inserted inline script is.
3. Assert that at least one violation (`script-src-elem`) was recorded. If none was, call `fail("csp listener", "no violation seen for a blocked inline script")`.

This proves the listener works, so "zero violations" means something.

If axe-core or a `page.evaluate` in the script triggers a violation, find the exact cause and change that code. Never filter violations by pattern.

### 9. Documentation

- `README.md`: a new section "Link rule and Content-Security-Policy" that covers:
  - the allowed links (`http:`, `https:`, `mailto:`, relative paths, `#fragment`) and the normalisation;
  - that the build (`resolveLink`, `renderSite`) and `check:links` fail on anything else, and what the error names;
  - the exact policy;
  - that the theme script hash comes from `themeScriptHash()` and is pinned in `csp.test.ts`, so changing `THEME_SCRIPT` means updating the pin;
  - that `img-src data:` is kept but unused;
  - that HTTP headers (`frame-ancestors 'none'`, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, reporting) follow once a host is chosen.

  Also update the `src/build/` row of the layout table (CSP, URL safety).
- `AGENTS.md` (website), under "Code design":
  - links only with `http:`, `https:`, `mailto:` or in-site targets;
  - no inline scripts beyond the hashed theme script;
  - no `style` attributes or `<style>` elements;
  - every page keeps the CSP meta tag first in `<head>`;
  - a policy change needs a reason in the PR.

## Performance impact

None expected for the api `bench/budgets.json` metrics (startup CPU, load CPU, idle and peak RSS, test CPU, build CPU, wall-clock startup, p95 latency, requests per second, image size). The change is in the static website only, which is not part of the api benchmark.

On the website itself:
- every HTML page grows by about 330 bytes (one meta tag) against the 60000-byte `htmlBytes` budget;
- the build gains one regex pass over each rendered page, a few milliseconds.

The implementer reports the size of the largest page before and after from `bun run check:budget`.

## Security impact

Security impact: yes. The change validates untrusted input at a trust boundary: link destinations in docs Markdown fetched from other repositories, which reach `href` attributes. It also adds a CSP that limits injected script.

Checklist items that apply:
- **Input validation:** the scheme allow-list, the normalisation of controls and whitespace, case folding, entity decoding in the dist check, and both the link and image paths.
- **Error and log texts with external data:** the unsafe href goes into the error message through `JSON.stringify`, so control characters and newlines cannot forge log lines. No secrets are involved.
- **Accessor execution:** none. The theme script is the only inline script, and only its hash is allowed.
- **Dependency pins:** unchanged, no new dependency.

Not applicable: auth, body limits, SSRF, file writes. The build writes `dist/` as today.

## Rollout order

One repository: only `website` changes. It has no consumers, and nothing in contract, kit or config depends on it.

## Counterexamples

URL rule (each must be rejected by `isSafeUrl`, by `resolveLink` with `UnsafeLinkError`, and by `checkLinks` as an unsafe link scheme):
- `javascript:alert(1)`, `JaVaScRiPt:alert(1)`, ` javascript:alert(1)` (leading space), `\x01javascript:alert(1)`, `java\tscript:alert(1)`, `java\nscript:x`.
- `data:text/html,<script>alert(1)</script>`, `DATA:text/html,x`.
- `vbscript:msgbox(1)`, `file:///etc/passwd`, `tel:+41000`, `ftp://x`, `foo:bar`, `blob:https://x/y`.
- Dist only, as HTML attribute text: `href="&#106;avascript:alert(1)"`, `href="&#x6A;avascript:x"`, `href="javascript&colon;x"`, `href="java&Tab;script:x"`.
- A wrong implementation that only tests `^javascript:` with `i` misses `data:`, `vbscript:`, the control-character forms and the entity forms. One that tests only the docs path misses a hand-written `href`.

Must be accepted (a wrong, too strict implementation rejects them):
- `https://github.com/x`, `HTTP://x`, `mailto:a@b.c`, `MAILTO:a@b.c`.
- `install.md#with-npm`, `../AGENTS.md`, `/docs/`, `#main`, `?q=1`, `//github.com/x` (protocol-relative, no scheme), `./a:b.md` (colon after `/`), `` (empty).

Error text (a wrong one omits a part): the docs error must contain `lorenzh/pulse-api`, `docs/install.md` and the quoted link. The page error must contain the dist file, for example `index.html`, and the quoted value.

Decoding: `&amp;#106;avascript:x` decodes once to `&#106;avascript:x`. That is unsafe by the rule, because the text before `:` is `&#106;avascript`, which is not allowed. That is acceptable: a double-encoded value is never correct output. The test asserts it is reported, not that it decodes to `j`.

CSP placement:
- Rejected by `cspProblems`: a page where the CSP meta comes after `<meta charset>` (not first); a page with two CSP metas; a page with no CSP meta.
- Rejected: a policy whose `script-src` hash does not match the page's inline script (for example after one character of `THEME_SCRIPT` changes while the pinned hash stays).
- Rejected: a page with a second inline `<script>`, or with a `style="…"` attribute.

Hash drift: `csp.test.ts` pins `const THEME_SCRIPT_HASH = "sha256-…"` (the current value, computed once). If `THEME_SCRIPT` gains one character, `themeScriptHash() !== THEME_SCRIPT_HASH`, so the test fails. A computed-only test cannot catch this, because the hash always matches its own script.

No statistics are involved.

## Contract fields

No new names in contract or config: no route, field, key or wire format changes. The new names are internal to the website:
- the modules `src/build/url-safety.ts` and `src/build/csp.ts`;
- `isSafeUrl`, `urlScheme`, `unsafeRefs`, `UnsafeLinkError`, `contentSecurityPolicy`, `cspMetaTag`, `withCsp`, `cspProblems` and `CspError`;
- the browser binding `__cspViolation`, which exists only in the check script.

Collision searches:
- `grep -rln "UnsafeLinkError\|Content-Security-Policy\|contentSecurityPolicy\|link-scheme\|isSafeUrl" .repos/contract/src .repos/config` finds nothing (exit 1).
- `grep -rn "UnsafeLinkError\|Content-Security-Policy\|csp" .repos/website/src .repos/website/scripts` finds nothing.

## Repository: website

Files:
- `src/build/url-safety.ts` (new): normalisation, `urlScheme`, `isSafeUrl`, `unsafeRefs`, `UnsafeLinkError`.
- `src/build/url-safety.test.ts` (new).
- `src/build/csp.ts` (new): `contentSecurityPolicy`, `cspMetaTag`, `withCsp`, `cspProblems`, `CspError`.
- `src/build/csp.test.ts` (new): the pinned theme-script hash.
- `src/build/html-refs.ts`: single-pass `decode` with numeric and selected named entities.
- `src/build/links-check.ts`: unsafe-scheme problem; the skip list reduced to `mailto:`.
- `src/build/links-check.test.ts`: unsafe cases.
- `src/build/theme-hash.ts`: doc comment only.
- `src/docs/links.ts`: `isSafeUrl` check first in `resolveLink`, error with `owner/repo`, file and link.
- `src/docs/links.test.ts`: replace the `mailto` passthrough test with allowed and unsafe cases.
- `src/docs/page.test.ts`: the four acceptance fixtures, plus the image and control-character forms.
- `src/site.tsx`: `withCsp` in `renderPage`; the `unsafeRefs` check per page in `renderSite`.
- `src/site.test.ts` (new) or an addition to `src/content/home.test.ts`: renders all pages with one fixture docs page.
- `scripts/check-links.ts`: runs `cspProblems` over `dist/`.
- `scripts/check-a11y.ts`: `watchCsp`, the positive control.
- `README.md`, `AGENTS.md`.

### Behavior

Sections 1–9 of Required behavior, as written.

### Checks (tests to add; red first, then green)

1. `url-safety.test.ts`: every counterexample above, rejected and accepted, including the control-character and mixed-case forms. Also `urlScheme` for `HTTPS://x` (`https`) and `/a:b` (no scheme).
2. `page.test.ts`, one `buildDocPages` call per fixture file `api:docs/index.md`:
   - each of `[x](javascript:alert(1))`, `[y](JaVaScRiPt:alert(1))`, `[z](data:text/html,<script>alert(1)</script>)`, `[w]( javascript:alert(1))`, `![i](javascript:alert(1))` and a link with `\x01` before `javascript:` throws `UnsafeLinkError`;
   - each message matches `lorenzh/pulse-api`, `docs/index.md` and the link text (`JSON.stringify` of the href that marked hands over);
   - before relying on the throw, confirm each form is parsed as a link by marked 18.1.2: with the check removed, the rendered HTML holds an `<a href="…">` with that scheme;
   - `https:`, `mailto:`, relative and `#fragment` links still build.
3. `links-check.test.ts`:
   - `<a href="javascript:alert(1)">`, `<a href=" JAVASCRIPT:x">`, `<a href="&#106;avascript:x">`, `<a href="tel:+1">` and `<a href="data:text/html,x">` each give one `unsafe link scheme` problem, not a "does not resolve" problem;
   - `<a href="mailto:a@b.c">` gives no problem.
4. `csp.test.ts`:
   - the exact policy string;
   - `themeScriptHash() === THEME_SCRIPT_HASH` (the pinned literal);
   - no `'unsafe-inline'`, `'unsafe-eval'`, `frame-ancestors` or `report-` in the policy, and no `"&<>` in it;
   - `withCsp` puts the tag directly after `<head>` and throws `CspError` on zero or two `<head>`;
   - `cspProblems` catches each CSP counterexample.
5. Site render test (`loadSite` → `renderSite` with one fixture `DocPage` whose `html` holds a command block, so the docs layout and the copy-button island render). For every `.html` output:
   - `cspProblems(file, html)` is `[]`;
   - the CSP meta is the first element of `<head>`;
   - `<meta charset` lies within the first 1024 bytes;
   - the page's inline script hashes to `THEME_SCRIPT_HASH`.

   A second case passes a fixture `DocPage` whose `html` holds `<a href="javascript:x">`. `renderSite` throws `UnsafeLinkError` naming its dist file.
6. Mutation evidence for the PR:
   - comment out the `isSafeUrl` check in `resolveLink`: the `page.test.ts` cases fail;
   - remove the unsafe branch in `checkLinks`: the `links-check.test.ts` cases fail;
   - change one character in `THEME_SCRIPT`: `csp.test.ts` fails on the pin.

   Paste the red output of each into the PR, then restore.
7. `bun run check:a11y` on the built `dist/` passes:
   - zero CSP violations and zero CSP console messages across all pages, both themes, both widths, no-JS, motion pages and copy buttons;
   - the positive control records at least one violation;
   - the theme toggle, menu, docs nav, copy buttons, network canvas, live preview, scroll reveal and heart burst checks pass unchanged.

### Completion evidence

- `bun run check:all` passes locally and in CI (jobs `check` and `site`), with line coverage at 80 % or more.
- `bun run build` passes on the current `docs.config.json` pins, so no upstream doc holds an unsafe link.
- `check:budget` passes; the PR states the largest HTML page size before and after.
- `grep -n bypassCSP scripts/check-a11y.ts` is empty.
- The PR names issue #459 (via its child issue), lists the checks that ran, shows the mutation output from step 6, and states the known limits: no HTTP headers until a host exists; `img-src data:` is kept but unused.

## Risks

- **React 19 head handling:** solved by string insertion after `<head>`. The render test guards the order.
- **marked parsing of the fixture forms:** marked's bare-destination grammar allows `<` and trims surrounding whitespace, so all four are expected to reach `link`. Check step 2 verifies this before relying on the throw.
- **Axe or Playwright helpers causing violations:** the positive control and the exact violation text locate the cause. The fix goes into the script, never into a filter.
- **A future upstream docs link with another scheme** (for example `tel:`) will fail the build. This is intended. The fix is in the source repository, or a reasoned change to the allow-list here.
- **Changing `THEME_SCRIPT` needs a pin update:** this is intended, and the README says so.
