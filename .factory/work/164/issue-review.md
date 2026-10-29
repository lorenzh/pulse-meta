# Issue review: #164 Status page: stop publishing internals

Verified against `.repos/status` (main). The three findings hold: `/api/*` forwards any GET path and query (`src/server.ts`); `render.ts` prints `check.url`, `host:port`, `keyword`, `lastReason` and incident `reason` verbatim; no security headers are set; `/logo` serves the local file with its own type (SVG possible).

## Facts the plan must use
- Only pulse-status changes code. pulse-api gets a docs-only edit (`docs/install.md` line 46 says "not public"). Single code target, plus a docs target for api; `targets.json` needs `status` and `api` (api docs independent, no dependsOn needed).
- The browser polls exactly: `/api/uptime`, `/api/incidents?status=resolved`, `/api/checks`, `/api/incidents?status=open`, `/api/maintenance` (`src/poller.ts`). That is the allow-list (exact path, exact query). Re-derive from the poller at plan time and check for any other `/api/` use in `public/client.js`.
- Rendering runs in the browser (`/render.js` is served from `src`), so hiding only in HTML is pointless; redaction must happen in the proxy JSON (required by the issue). The proxy now must parse and rewrite JSON bodies for `/api/checks`, `/api/incidents*` (reason) and probably `/api/maintenance` and `/api/uptime` (check for url/name fields).
- `public/index.html` has an inline `<script>` (theme bootstrap) and an inline `<style>`; the server also injects `data-poll-ms` into the body and a theme `<link>`. A strict CSP needs either hashes (server computes sha256 at startup) or moving them to files (`/theme-init.js`, a static CSS). Decide in the plan; style attributes generated in render.ts (if any) need `style-src 'unsafe-inline'` or removal. Check `render.ts`/`client.js` for `style=` use.
- Remote logo (`http(s)://` URL) is loaded by the page: CSP `img-src` must allow it (or `https:`/`http:`), while `default-src 'self'`. Fonts and theme are same-origin.

## Open points (not blocking; assumptions given)
1. Default of the hide setting. Assumption: default is **off** (current behavior, existing users unchanged) for targets/reasons/keywords, but URL sanitizing (no userinfo, no query) is **always on**. Alternative is default on (secure by default, but a breaking visual change). Plan must pick one and justify in docs; recommend default hidden is arguably safer, but the issue says "plan decides". Name suggestion: `PULSE_STATUS_HIDE_DETAILS=true|false` (accepts `true/false/1/0`; invalid value fails at startup like the other settings; empty counts as not set).
2. URL sanitizing scope: which URL fields? `check.url` for http checks; also any URL inside `lastReason` / incident `reason` text (error messages may embed URL, host or IP). Assumption: with the setting off, reasons are shown raw except URLs inside reason text are sanitized by a regex (userinfo and query stripped); with it on, reasons are removed entirely. State that internal hosts/IPs in reasons stay visible when the setting is off, and document this.
3. Query-string removal also drops the fragment? Assumption: yes, drop `#fragment` too. Unparseable URL: show nothing (or the host-less placeholder) rather than raw text.
4. What "removed" means in JSON: assumption: delete keys `url`, `host`, `port`, `keyword`, `lastReason`, `reason` (set `null` where parsers require the field; check `validate.ts` which parses the response and may reject missing fields). Plan must align `validate.ts`/`render.ts` so the page still renders without a target line (no empty `<div class="url">`). The cert-days case (`reasonIsDays` uses `lastReason` for TLS days) must keep working, or the days must be exposed another way (`certDays` field if present).
5. Does the proxy send redacted JSON for non-200 upstream responses? Assumption: non-OK upstream responses become a fixed generic JSON error with the same status class (no upstream body forwarded), since error bodies can leak internals.
6. Non-JSON or unparsable upstream bodies on an allowed path: assumption: 502 generic error.
7. Query parameter allow-list: exactly `status=open` and `status=resolved` on `/api/incidents`; any other parameter or value on any allowed path returns 404 (assumption: 404, as the issue says "every other path"). Trailing slash, encoded paths (`/api/%63hecks`), double slash and `..` are not allowed variants; match on the parsed pathname exactly, no contact with API.
8. Method: GET/HEAD only already (405 else). HEAD on proxy: same allow-list.
9. Security headers values, assumption: `Content-Security-Policy: default-src 'none'; script-src 'self' [hash]; style-src 'self' [hash]; img-src 'self' data: <logo origin or https:>; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. Sent on every response including 404/405/500 and static assets. `/logo` additionally gets `Content-Security-Policy: sandbox; default-src 'none'` and `nosniff`. Plan should note `sandbox` on `/logo` protects direct navigation; in `<img>` SVG scripts do not run anyway.
10. Module scripts: `/render.js` etc. are same-origin `type=module` imports, covered by `script-src 'self'`.
11. Test requirement "fails on old code" plus "still renders in a browser": the repo may already have a browser test (check `package.json` scripts / `docs/development.md`); if not, the plan adds a smoke check (CSP violations = none) with the existing tooling, and avoids adding heavy deps without need. Open: whether a headless browser is available in CI.
12. Docs: `docs/configuration.md` (new setting row), a new "What is public" section (in `docs/operation.md` or `install.md`) listing the exposed endpoints and fields, `docs/troubleshooting.md` for an invalid value, and `README.md` if it lists settings. pulse-api `docs/install.md` must say that port 8080 of the status page exposes the five read endpoints above (filtered), and that the API itself stays non-public.
13. Contract: if `contract` defines the response shapes, no change is expected; the plan should confirm field names there (`.repos/contract`) before naming fields to strip.

## Assumptions
- No hold needed: the default for the setting is a plan decision per the issue.
- No caching/polling changes; no API code change.
- Maintenance entries and incident names/messages are operator-authored and stay public (state in docs).
- Check names (`name`) stay public; only target/reason/keyword are hidden.

## Derived acceptance check
With a check at `https://user:pass@internal.example:8443/health?token=abc` and a down reason mentioning `10.0.0.5`:
1. `GET /api/checks` via the status server never contains `user:pass@` or `token=abc`, in HTML or JSON; with the hide setting on, no `url`, `host`, `port`, `keyword` or reason appears in `/api/*` JSON or the rendered page.
2. `GET /api/checks/<id>/results?limit=1000`, `/api/foo`, `/api/checks?x=1`, `/api/incidents?status=other` return 404 and the fake API records no request.
3. Every response has CSP (no inline script without hash), `nosniff`, frame protection, `Referrer-Policy`; `/logo` has a `sandbox` CSP.
4. In a browser the page renders and updates with no CSP violations, with the setting on and off.
5. Each new test fails on current `main`; docs in status and api describe the above.
