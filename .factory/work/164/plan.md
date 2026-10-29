# Spec: Status page stops publishing internals (#164)

## Goal
The public pulse-status page and its `/api/*` proxy expose only what the page needs, with credentials and (by default) internal details removed, and the page is hardened with security headers.

## Scope
- `status`: proxy allow-list, JSON sanitizing and redaction, new setting, security headers, logo sandbox, tests, docs.
- `api`: docs-only line in `docs/install.md`.

## Non-goals
No caching or polling changes. No API code change. No contract change: `lastReason` is `string | null`, `keyword?`, `url?`, `host?`, `port?` already allow absent or null values. Check `name`, incident ids/times and maintenance notes stay public (operator-authored).

## Decisions
- **Setting:** `PULSE_STATUS_HIDE_DETAILS`, accepts `true`/`false`/`1`/`0`; empty counts as not set; any other value fails at startup like the other settings (`createStatusServer` option `hideDetails`).
- **Default: `true` (hidden).** Reason: the page is public, and target URLs, hosts, ports, keywords and probe error text can name internal systems; secure by default. Operators who want the old display set `false`. The docs state this as a visible change in behavior.
- **URL sanitizing is always on**, regardless of the setting: userinfo, query string and fragment are removed from every URL shown. An unparseable `url` is replaced by nothing (omitted).
- Rendering runs in the browser, so redaction is done in the proxied JSON.

## Required behavior (repository: status)
1. **Proxy allow-list.** Match on the parsed `pathname` and exact query, nothing else. Allowed: `/api/uptime`, `/api/checks`, `/api/maintenance` (no query), `/api/incidents?status=open`, `/api/incidents?status=resolved`. Re-derive from `src/poller.ts` and confirm `public/client.js` calls no other `/api/` URL. Anything else (other path, extra/other query, trailing slash, `//`, encoded variants, `..`) returns 404 JSON `{"error":"not found"}` without calling the API. GET/HEAD only (405 otherwise, as now). Export the list from one constant so the poller test can assert it equals what the poller requests.
2. **Upstream handling.** Non-2xx upstream: fixed generic JSON error with the same status (no upstream body). Non-JSON or unparsable body: 502 generic. Network failure: 502 as now.
3. **Sanitize (always).** In `/api/checks` set `url` to its sanitized form (omit if unparseable). In `lastReason` and incident `reason`, replace each `https?://...` substring with its sanitized form (strip userinfo, query, fragment). Docs state that hosts and IPs in reasons stay visible when the setting is `false`.
4. **Hide (when on).** In `/api/checks` delete `url`, `host`, `port`, `keyword`, set `lastReason` to `null`; in `/api/incidents*` set `reason` to `null`. Check `/api/uptime` and `/api/maintenance` for any url/host/reason fields and strip/sanitize them the same way. `src/render.ts`: omit the `<div class="url">` when there is no target; keyword and reason spans are already conditional; TLS meta shows `${days} days left` when `lastReason` is null. `src/validate.ts` must accept the missing fields. The page still renders without a target line.
5. **Security headers on every response** (200, 404, 405, 500, static files, proxy): `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: <origin of a remote PULSE_STATUS_LOGO, else nothing more>; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. No `unsafe-inline`: move the inline theme bootstrap script to a served `/theme-init.js` (in the `<head>`, not deferred, so no theme flash) and the inline `<style>` to a served `/page.css` (add to the static routes). Confirm that `render.ts`/`client.js` set no `style=` attributes or inline handlers; if any, replace them with classes.
6. **Logo.** `/logo` additionally sends `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'` (so a direct visit cannot run script in the page origin; the image still renders in `<img>`) and `nosniff`.
7. **Docs (status).** `docs/configuration.md`: row for `PULSE_STATUS_HIDE_DETAILS` and the empty-counts-as-unset note. `docs/operation.md` (or `install.md`): a "What is public" section: the five exposed API reads, which fields are shown, always-sanitized URLs, hidden details by default and why, reasons caveat when `false`, security headers and the logo sandbox. `docs/troubleshooting.md`: invalid value error. `docs/development.md`: new files. `README.md` if it lists settings.

## Tests (status; each fails on current main)
In `src/server.test.ts` with the fake `fetch` recording calls: allow-listed paths proxied; `/api/checks/<id>/results?limit=1000`, `/api/foo`, `/api/checks?x=1`, `/api/incidents?status=other`, `/api/checks/`, `/api//checks`, `/api/%63hecks` give 404 and zero upstream calls; non-2xx upstream body not forwarded; fixture check `https://user:pass@internal.example:8443/health?token=abc` with reason naming `10.0.0.5` never shows `user:pass@` or `token=abc` in either mode; hide on removes url/host/port/keyword/reasons from proxied JSON and from the rendered output (render tests, TLS days still shown); hide off keeps them (sanitized); CSP, nosniff, frame protection and Referrer-Policy on 200/404/405/proxy; the index HTML has no inline `<script>`/`<style>`; `/logo` has the sandbox CSP; env parsing tests for the new setting in `main`/config parsing (extract a parse function so it is testable). Poller test: requested URLs are a subset of the allow-list. Browser check: if a headless browser is already available in the repo tooling use it; otherwise document a manual check (page renders, updates, no CSP violations in the console, setting on and off) in the PR, without adding heavy dependencies. `npm run check` passes.

## Repository: status
Files: `src/server.ts`, `src/main.ts`, `src/render.ts`, `src/validate.ts`, `src/poller.ts` (only if the allow-list constant is shared), `public/index.html`, new `public/theme-init.js` and `public/page.css`, tests, `docs/*`, `README.md`.
Behavior: items 1 to 7 above.
Checks: `npm run check`; manual page check as described.
Completion evidence: PR with tests that fail on old code, docs updated, and a note on the browser check with the setting on and off.

## Repository: api
Files: `docs/install.md` only.
Behavior: at the services table (line ~46) and its text, say that the API stays non-public (`127.0.0.1:3000`), and that port 8080 of pulse-status exposes a filtered read-only subset: `GET /uptime`, `/checks`, `/maintenance`, `/incidents?status=open|resolved`; no other path, and check targets/reasons/keywords are hidden by default (`PULSE_STATUS_HIDE_DETAILS`, see the pulse-status docs). No code change.
Checks: the repository's docs/lint check.
Completion evidence: PR with the docs edit only.

## Risks
- Default hidden changes what existing operators see; documented.
- Moving inline code to files must not cause a theme flash or break fonts (CSP `font-src 'self'`).
- Regex URL sanitizing in free text is best effort; docs say reasons can still reveal hosts/IPs when details are shown.
- Remote logo origin in `img-src` must be derived from validated `PULSE_STATUS_LOGO` only.

## Acceptance evidence
The derived acceptance check in `issue-review.md` passes: sanitized/hidden JSON, 404 with no upstream request for other paths, headers everywhere with a sandbox CSP on `/logo`, page renders and updates with no CSP violations in both modes, new tests fail on old code, docs in status and api updated.
