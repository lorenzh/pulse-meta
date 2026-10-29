# Spec: Atom feed and SVG uptime badges on the status page (#268)

Tracking: #166 (F3). Issue review: `.factory/work/268/issue-review.md`.

## Goal

Visitors follow incidents in a feed reader. Maintainers embed an uptime badge in READMEs and dashboards. Both are served by `pulse-status` from data its proxy already caches.

## Scope

Only `status` changes. `contract`, `api`, `probe`, `notify`, `config`, `kit` stay as they are: no new wire type, no new upstream path, no new `ALLOWED_API_PATHS` entry.

## Non-goals

- No email subscriptions, no per-component badges, no RSS 2.0 (skipped: Atom only, documented), no maintenance entries, no durations (so no `Intl.DurationFormat`), no auth or per-feed tokens, no pagination.
- No change to the global CSP, the allow-list, or `/api/*` behavior.

## Decisions (open points of the review)

1. **Absolute links.** New optional setting `PULSE_STATUS_PUBLIC_URL` (option `publicUrl`): an http(s) URL without userinfo, query or fragment; invalid value fails startup like `PULSE_STATUS_LOGO`. Used for the feed `<link rel="alternate">`, `rel="self"` and ids. Without it `/feed.atom` answers 404 (same body as any unknown path); never built from `Host`. Badges need no public URL. A trailing slash is normalized.
2. **Ids and times.** Entry `<id>` = `tag:` URI from the public URL host plus incident id (e.g. `tag:<host>,2026:incident-<id>`), stable across polls. Entry `updated` = `resolvedAt ?? openedAt` (RFC 3339 UTC). Feed `updated` = newest entry `updated`; with no entries `1970-01-01T00:00:00Z`. No `now()` in the output, so the body is deterministic for a given cache state. Entries sorted newest first, ties by id descending. Feed `<id>` = the public URL, title = product name (`PULSE_STATUS_NAME`, default "pulse") + " incidents".
3. **Entries.** One per incident from the cached open and resolved lists (resolved already limited to 7 days by `limitResolvedWindow`). Title `<check name>: Open` or `<check name>: Resolved`. Entry `<link>` = the public URL (status page). An incident whose check is not in the cached `/api/checks` list is skipped. Content: `<summary type="text">` with "Opened <ISO>" and, if resolved, "Resolved <ISO>". Reason appended only when it is a non-null string in the cached answer (the filter already nulls it in hide mode and sanitizes URLs), so the feed never re-adds a field. Targets and URLs never appear.
4. **Data source.** Feed reads `/api/checks`, `/api/incidents?status=open`, `/api/incidents?status=resolved`; badge reads `/api/checks` and `/api/uptime`. All through `cachedAnswer` with the existing keys, so the upstream call count per cache window is unchanged. `cacheMs=0` fetches per request, as for `/api/*`.
5. **Upstream failure.** If a needed cached answer is not status 200 or its body is not the expected shape: respond 503 `text/plain` `unavailable`, `Cache-Control: no-store`. No upstream text leaks. For badges the existence check (404) uses the checks list only when it is available; if checks fail, 503 for every id (known or not), so existence is not revealed by failures. If only `/api/uptime` fails or lacks the check, the badge answers 200 with uptime text `no data`.
6. **Hide mode.** Name, state, times and uptime are public in both modes (the page shows them). Reasons only when hide is off. Same code path; the test runs both.
7. **Badge content.** Left part = label (default: check name), right part = `<state> <uptime>` e.g. `up 99.95%`; uptime `null` or missing = state only plus `no data`... exact text: `up · 99.95%` is avoided; use `up 99.95%` and `up no data`. States and fixed colors (white text `#fff` on fill, contrast >= 4.5:1; right-part text colors tested): `up` green `#2e7d32`, `degraded` amber-dark `#8a5a00`, `down` red `#c62828`, `unknown` grey `#616161`, `maintenance` blue `#1565c0`. Unknown future states fall back to `unknown` styling with text `unknown`. Uptime shown with up to 2 decimals, trailing zeros trimmed, from the overall `uptime` in `/api/uptime` (a 0-100 percentage as the page shows it; implementer follows the page's formatting in `render.ts`). Text also states state in words (not color alone). Width: per-character approximate table (Verdana 11px style), cap per part; the limit is documented. Accessible: `role="img"`, `aria-label="<label>: <state> <uptime>"`, `<title>`. Pure module `src/badge.ts`, no I/O.
8. **`?label=`.** Only `label` is recognized; other parameters are ignored. Empty value = default. Max 32 code points, no control characters (C0, C1, DEL, line/paragraph separators) after one percent-decoding by `URLSearchParams`. Invalid or too long: 400 `text/plain` `invalid label`. Order: validate the label first for every id, then the id lookup (404), so 400 never depends on existence. XML-escape `& < > " '` and strip XML-illegal characters (already rejected). Cache key independent of label (no per-label cache; rendering is cheap).
9. **Id handling.** Route matches exactly `/badge/<segment>.svg`: one segment, no `/` or further dots handled by taking the segment before the final `.svg`; percent-decoded once with `decodeURIComponent` in try/catch (malformed = 404). Found by linear lookup in the cached checks list (string equality). Unknown, inactive (absent from the list), malformed, wrong extension, extra segments: identical 404 (`text/plain` `not found`, `Cache-Control: no-store`, same headers, same code path). Only `GET` and `HEAD`, as elsewhere.
10. **Cache-Control.** Success: `public, max-age=<n>`, `n = max(1, ceil(max(cacheMs, pollMs) / 1000))`. 404, 400 and 503: `no-store`. ETag optional, skipped.
11. **Headers.** Feed `application/atom+xml; charset=utf-8`. Badge `image/svg+xml; charset=utf-8` plus per-response `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'` (as `/logo`). No `Cross-Origin-Resource-Policy`; `nosniff` stays. Global CSP unchanged. `public/index.html` gets `<link rel="alternate" type="application/atom+xml" href="/feed.atom">` only when the public URL is set (server injects it like other placeholders), else not present; CSP is unaffected.
12. **XML.** `src/feed.ts` pure module builds the Atom string with a small `escapeXml` that first removes characters illegal in XML 1.0 (everything but `\t \n \r`, U+0020-D7FF, U+E000-FFFD, U+10000-10FFFF; lone surrogates) and then escapes `& < > " '`. No CDATA. Escape also applies to the public URL and name.
13. **Test XML parsing.** No new dependency. The test file includes a small strict well-formedness checker/tokenizer (tags, attributes in quotes, entities limited to the five predefined plus numeric, a single root, proper nesting, no illegal characters) which also extracts elements to assert on. If the implementer finds it unreasonable, a devDependency with MIT/BSD license and lockfile entry is allowed; no runtime dependency in any case.

## Required behavior

- `GET /feed.atom` and `GET /badge/<check id>.svg` as above, public and unauthenticated, served from the proxy cache, `HEAD` supported.
- Feed and badges follow `PULSE_STATUS_HIDE_DETAILS`, the allow-list and sanitizing of the filter.
- Metrics `recordHttp` counts them as other responses; no new metric.

## Risks

- A feed link built from `Host` would allow link injection: avoided by the setting.
- Existence leak through 400/503/timing: fixed order and shared code path (decisions 5, 8, 9).
- Width approximation can clip unusual characters: documented, capped parts.
- Tag URIs must stay stable if the public URL changes host: documented.

## Acceptance evidence

Against a stub API with one up check, one down check with an open incident (reason `<&>`), one resolved incident inside the window, one outside, one incident of a removed check:
1. `/feed.atom` is 200, Atom type, parsed by the test; entries only for open and in-window resolved incidents of listed checks, with name, state, updated, link; escapes verified with `]]>`, `&`, `<script>`, NUL, emoji; no target; reason absent with hide on and present (sanitized) with hide off; 404 without public URL.
2. `/badge/<id>.svg` 200 `image/svg+xml`, two parts with state and 90-day uptime; down state; `no data`; `?label=` replaces left text, escaped; over-long or control-character label gives 400 for known and unknown ids alike; unknown, removed, malformed and extra-segment ids give byte-identical 404.
3. `Cache-Control` values as in decision 10; CSP unchanged; `ALLOWED_API_PATHS` unchanged and `/api/feed.atom` etc. 404; repeated requests in the cache window cause no extra upstream calls (counting fetch); upstream failure gives 503 no-store without leaking.
4. Every new test fails on previous `main`; `npm run check` passes; the PR notes a real browser or feed-reader check (command and result).

## Repository: status

Files (names guide, split per AGENTS.md):
- `src/feed.ts` + `src/feed.test.ts`: pure Atom builder, `escapeXml`, entry ordering, skipping unlisted checks; test XML tokenizer.
- `src/badge.ts` + `src/badge.test.ts`: pure SVG renderer, state styles, width table, label validation (`parseBadgeLabel` returning a result value), escaping; contrast check of fills like `palette.test.ts`.
- `src/server.ts`: routes `/feed.atom` and `/badge/*.svg` before static handling, reading through `cachedAnswer` with existing keys; per-response headers; 503 handling; autodiscovery link injection. Keep complexity under 15 (extract a small `syndication` module, e.g. `src/syndication.ts`, if `server.ts` grows).
- `src/settings.ts`, `src/main.ts` (and their tests): `PULSE_STATUS_PUBLIC_URL` validation and wiring.
- `src/server.syndication.test.ts`: HTTP end-to-end tests on port 0 with a fake API: feed content, hide on/off, escaping, badge states, label 400, identical 404s, headers, CSP, call counts, 503, allow-list regression.
- Extend `server.privacy.test.ts` / `server.cache.test.ts` minimally for allow-list and call-count regressions.
- Docs: `README.md` (endpoints, setting), `docs/operation.md` (subscribe with `/feed.atom`, badge Markdown snippet `![status](https://status.example.com/badge/<check id>.svg)`, what is public, caching), `docs/configuration.md`, `docs/index.md` if it lists endpoints. State that RSS is not offered.

Checks: `npm run check` (typecheck, lint, tests with coverage >= 80 %). Start the server with `npm start` against a stub API and open `/feed.atom` in a feed reader or validator and a badge in a browser; note the command and result in the PR.

Completion: all acceptance evidence above holds, new tests fail on old `main`, PR `Closes lorenzh/pulse-meta#<child>`.
