# Spec #567: console check screens (list, detail, editor for six types, export, delete)

Issue: [#567](https://github.com/lorenzh/pulse-meta/issues/567). Issue review:
`.factory/work/567/issue-review.md`. Scope decisions: the
[2 November amendment to #460](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362),
sections 1, 8, 13, 14, 15, 19 and 20, which narrow #567 and override the older issue body.
Shared findings: none (`gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/567`
answers `HTTP 404`, which means no child has recorded findings yet).

Clone heads read for this spec: console `76dab43`, contract `9ab7e24` (package 2.1.0, wire
version 1), api `fb6f1a5`, probe `8fd19c8`, deploy `770eae0`, config `bc87049`. These name the
snapshots behind every "verified" claim below; they are not pins to copy.

Revision after plan-review (5 November): edit and delete now read `/admin/config` before any
field or typed-name check and validate only against the view whose revision the form carries
(R5, R6, Decision 8); expired and replayed form tokens on the check routes are defined
(Decision 13); every `requestJson` outcome, including redirects and an oversized or unreadable
answer after a committed write, falls into one of three classes with a fixed status, text and
People-log rule (Decision 10, R8); the contract-valid ids `.` and `..`, which no URL path can
carry, are defined as not addressable (Decision 14).

Revision after the third plan-review (5 November): the host-binding and heartbeat lines are
built by one shell-quoting helper that serializes the JSON whole and single-quotes the whole
value and the whole URL, with literal and `/bin/sh` round-trip tests for apostrophes and shell
metacharacters (Decision 12); `GET /checks/:id/location-uptime` answers `405` with
`Allow: GET` to `HEAD`, like the other reads, and the api checks pin that (Repository: api).

Revision after the fourth plan-review (5 November): header rows are checked for duplicate
names, case-insensitively and including the stored literal rows, before any header object is
built (R4, R5); the typed-name confirmation trims the stored name as well as the typed one, so a
stored name with outer spaces such as `" Checkout API "` can be confirmed (R6); the contract
section lists `test/smoke.test.ts` with the literal additions to its export list; the create and
edit forms state the fixed quorum rule with the heartbeat exception (R4), checked in the
browser; every console task is a behavior change (Repository: console).

## Goal

A signed-in person can find, inspect, create, edit, export and delete checks in the Console,
within the roles of #564 and the source rules of #565, without ever seeing or leaking a stored
header value, request body, heartbeat secret or the Console's own api token. The check detail
shows real per-location uptime over the same 90-day window as the existing aggregate uptime.

## Current behavior (verified)

1. Console: the Checks navigation entry exists but is unavailable
   (`console/src/navigation.ts:26`, `isAvailable: false`). Production protected routes are `/`
   and the team routes only (`console/src/server.ts:1105-1107`). The dispatcher matches the raw
   path exactly (`server.ts:168-170`, `:1074`) and runs, for a protected route: setup phase,
   Host, full-session gate, POST form (Origin, content type, body size, repeated fields, CSRF),
   role, form token, handler (`server.ts:974-1010`).
2. Console form body limit is one constant, `MAX_FORM_BYTES = 8192`
   (`console/src/forms.ts:4`), used for every POST by `readBodyOrFail`
   (`console/src/http-context.ts:145-154`). A repeated known field answers `400`
   (`forms.ts:22-32`). An HTTP check body alone may be 65,536 bytes
   (`contract/src/schema.ts:174-179`), so a check form does not fit today.
3. Console roles: `overview.view` (row 1, "View status, checks, incidents, maintenance") is
   Viewer+, `check.write` (row 2, "Create and edit console checks, export") is Member+,
   `check.delete` (row 3) is Admin+ (`console/src/permissions.ts:40-44`,
   `console/docs/team.md:13-15`). `routeRole` gives a route its role
   (`permissions.ts:89-93`).
4. Console api reads: only the Overview reads pulse-api, through contract `fetchJson` with a
   5000 ms timeout, `redirect: "manual"` and the wire header, `GET /admin/config` with the Bearer
   token and `GET /checks` without it (`console/src/overview-read.ts:31-120`). It validates
   `/admin/config` with the tolerant `validateAdminConfigSummary`, so it accepts 1.x and 2.0.0
   apis (`contract/src/admin.ts:254-264`). `ApiCall` is `"config" | "checks"` and 403 on
   `config` reads "lacks the read or checks scope" (`console/src/api-failure.ts:4`, `:53-55`).
5. Console shared states exist: empty, api unavailable, token rejected, 403, 404, 409/412 stale,
   503 read-only, already submitted (`console/src/states.ts`), and typed and plain confirmations
   that work without JavaScript (`console/src/confirm.ts`). The People log is the append-only
   table `people_events` with a free-text `action` and `target_kind` and no `CHECK` on them
   (`console/src/database.ts:106-125`, `console/src/people-log.ts:4-35`). The one script
   `CONSOLE_JS` holds only the busy button (`console/src/console-script.ts:8-52`).
6. Console tests: `test/fake-api.ts` answers one reply per path for every method and records
   only path and `authorization` (`console/test/fake-api.ts:14-79`); `e2e/run.ts` drives
   Chromium with axe, 390 px fit checks (`e2e/run.ts:146-155`) and a no-JavaScript context
   (`e2e/run.ts:253-275`). The console pins contract `176fb6e`
   (`console/package.json:32`); contract `main` is two commits ahead of it (incident drafts),
   and `176fb6e` already has the admin view schemas with `source`, `shadowed` and `file`.
7. Contract: six check types (`schema.ts:267-496`); admin views and inputs with `source`, keep
   markers for literal header values and bodies, env references, and `hasSecret` for heartbeat
   (`contract/src/admin.ts:65-184`); `GET /admin/config` has `revision`, `checks`, `shadowed`,
   `components`, `maintenance`, `file` (`admin.ts:233-250`); the export document with `redacted`
   (`admin.ts:300-316`). `fetchJson` is GET only: its `init` carries only `signal` and `headers`
   (`contract/src/client.ts:129-133`). There is no write client.
8. Contract uptime: `checkUptimeSchema` is 90 UTC days, result-weighted
   `(up + degraded) / all * 100`, unrounded, `null` without results (`schema.ts:638-664`).
   `locationResultSchema` is the latest result per location with `stale`
   (`schema.ts:566-574`). No shape groups uptime by location.
9. api check writes (#565): `POST /admin/checks`, `PUT`/`DELETE /admin/checks/:id` need
   `admin` and `checks` scopes (`api/src/token-scopes.ts:20-21`) and an `If-Match` with the admin
   revision (`api/src/admin-routes.ts:226-256`). A create of an id in the file or store is `409`;
   a PUT of a file or shadowed id is `409`; a DELETE of a shadowed id deletes only the database
   definition; an unknown id is `404` (`api/src/check-write.ts`, `assertTarget`). A stale
   revision is `412`; a schema error `422` with a message that never quotes a value. The
   revision covers the applied file and the database generation, so a file reload also changes
   it. Every committed write records an api audit entry `check.create`, `check.replace` or
   `check.delete` (`check-write.ts`, `commit`). A deleted check becomes inactive; its results stay
   and its open incidents are resolved (`api/src/service.ts:518-528`).
10. api export: `GET /admin/config/export` serves the effective set as two-space JSON with a final
   newline; a shadowed definition is never exported; literal headers, bodies and secrets are left
   out and listed in `redacted` (`api/src/config-export.ts:10-65`).
11. api uptime: `uptime_daily (check_id, day, good, total)` holds closed UTC days
   (`api/src/migrations.ts:59-69`); an ingest bumps an existing day row
   (`service.ts:445-448`); a read fills missing closed days from `results`
   (`service.ts:833-860`); today comes from memory minus rows stamped after `now`
   (`service.ts:872-884`); `uptimeOf` builds the 90-day window `[firstDay * DAY_MS, now]`
   (`service.ts:886-910`). The hourly backfill fills one (check, day) per batch
   (`api/src/uptime-rollup.ts:40-54`). Retention deletes rollups before the cutoff day and
   results older than the cutoff except the newest row per (check, location)
   (`api/src/retention.ts:45-61`, `service.ts:611-620`). The set of locations of a check is a loose
   index scan over `results_by_sample (check_id, location, timestamp)` (`service.ts:547-555`).
   No stored tally keeps the location, so `uptime_daily` cannot be relabelled per location.
12. api public reads: `/checks/:id/results` pages newest first with `limit` (default 100, max
   1000) and exclusive `before`, returning a whole tie group (`api/docs/rest-api.md:147-160`);
   `/checks/:id/latency` is HTTP-only and answers `404` `unknown check` for other types and
   inactive ids (`rest-api.md:193-195`).
13. Deferred by #460 section 19 and the issue review, and verified absent: no paused state
   (`schema.ts:98`), no dry-run route, no `/heartbeat/:id/fail` (the second path segment is the
   secret, `api/src/server.ts:203`), TLS uses `rejectUnauthorized: false` and judges expiry only
   (probe `src/check.ts`). None of these is built here.
14. Check ids: the contract accepts any non-empty string as a check id (`contract/src/schema.ts:19-21`,
   `:270`; `admin.ts:252`), so `.` and `..` are valid ids of a file or api-created check. The
   WHATWG URL parser removes the path segments `.`, `..` and their `%2e` forms
   (case-insensitive), and `encodeURIComponent` leaves `.` unchanged. Run with Bun 1.4.0 at the
   heads above: `new URL("http://h/admin/checks/.").pathname` is `/admin/checks/`,
   `.../admin/checks/..` is `/admin/`, `.../admin/checks/%2E` is `/admin/checks/`,
   `.../checks/%2e%2E/location-uptime` is `/location-uptime`, `.../checks/.../results` stays
   `/checks/.../results`. `fetch` parses its URL the same way, and the api routes on
   `new URL(req.url, "http://localhost").pathname` (`api/src/server.ts:612-628`), so no per-id
   api route (`/checks/:id/results`, `/latency`, `/admin/checks/:id`, `/heartbeat/:id`) can
   address the ids `.` and `..` today. No other id is changed by the parser once each `/`, `%`,
   `?` and `#` is percent-encoded.
15. Console form tokens are bound to the raw path without the query (`console/src/server.ts:169`,
   `:949`). A refused token runs the route's `renderForm(request, notice)`, which is synchronous
   and gets only the posted fields (`server.ts:959-965`, `protected-route.ts:53-54`); a replayed
   token links `Open the page again` to `ctx.path`, the path without the query
   (`server.ts:953`). `PageRequest` carries `query` for a POST too (`server.ts:933`).
16. api answers: every response carries the wire header, set before routing
   (`api/src/server.ts:59-64`, `:883`). A check write answers `2xx` only after `applyWrite`
   committed (`api/src/admin-routes.ts:240-255`); the `ETag` is the quoted revision
   `"sha256-<64 hex>"` (`admin-routes.ts:100-102`); `If-Match` must be one quoted revision, else
   `400`, and is required (`428`) (`admin-routes.ts:105-113`, `:238`). A PUT body id must equal the
   path id (`admin-routes.ts:235-237`). The contract exports `isAdminRevision`
   (`contract/src/index.ts:60`).

## Scope

- contract: a per-location uptime shape and validator; a JSON write client `requestJson` next to
  `fetchJson`.
- api: `GET /checks/:id/location-uptime`, backed by per-location daily tallies.
- console: Checks list with filters, check detail, shadowed-definition view, create and edit
  forms for all six types, export (all and per check), delete, People-log rows for check
  changes, browser checks, docs.

## Non-goals

- Pause, "Test check" dry run, heartbeat `/fail`, TLS chain and host-name verification, import
  of `checks.json`, per-check quorum or location selection, probe version per location (all
  deferred by #460 section 19; their tests belong to their later issues).
- Editing a file-owned check, file repair or upload, renaming a check id, changing a check's
  type on edit.
- Reading or changing `PULSE_PROBE_HEADER_HOSTS` or any probe environment value from the
  Console or the api.
- An Activity page (item C of #460 renders the People log later); components and maintenance
  editing (#569).
- No change in probe, status, notify, kit, config, deploy or website.

## Decisions

1. **Per-location uptime is a new public read.** `GET /checks/:id/location-uptime` answers
   `CheckLocationUptime` (see Contract fields). Window: the one of `GET /uptime`, the 90 UTC days
   ending today, from `(today - 89) * 86400000` to the service's `now()` inclusive; rows stamped
   after `now()` are not counted. Sample set: every stored result of the check in the window at
   that location, any status, generated heartbeat results included. `good` counts
   `status != "down"` (up and degraded), `results` counts all, `uptime = good / results * 100`
   unrounded, `null` exactly when `results` is `0`. Listed locations: every location that has at
   least one stored result of the check at any age (the same set as `locations` of
   `GET /checks`), sorted by name in UTF-16 code-unit order, each once. A location whose rows are
   all older than the window is listed with `good 0`, `results 0`, `uptime null`. Unknown or
   inactive id answers `404` `{"error":"unknown check"}`, a malformed escape `400`
   `bad check id`, like `/checks/:id/latency`. It is public like the other `/checks/:id/*`
   reads: location names and states are already public in `GET /checks`.
2. **Bounded aggregation.** A new table `uptime_location_daily (check_id, day, location, good,
   total, PRIMARY KEY (check_id, day, location))`, created with `CREATE TABLE IF NOT EXISTS` in
   `api/src/db.ts` next to `latency_daily` (no numbered step, `user_version` unchanged), holds
   closed days. A stored closed day is complete when the sum of its `total` over locations
   equals that day's `uptime_daily.total`; otherwise a read, or the hourly backfill, replaces that
   day's location rows from `results` in one transaction (a day with `uptime_daily.total = 0`
   needs no rows). An ingest that bumps an existing `uptime_daily` row (a result for a closed,
   already filled day) upserts the location row in the same statement sequence; an ingest whose
   `uptime_daily` bump changes no row writes no location row. Today is one range query over the
   check's results of `[today * DAY_MS, now]` grouped by location. The answer uses the 5 s read
   cache of the other reads and is cleared with it. Why not a numbered step: the sum rule
   repairs a day that an older release changed without location rows, so a downgrade without a
   restore stays safe, as with `latency_daily`.
3. **Writes go through a contract client.** The contract adds `requestJson`, a POST/PUT/DELETE
   JSON client with the timeout, size cap and wire check of `fetchJson`, never following a
   redirect and never retrying. Its `http` error carries the api's `ErrorResponse.error` text
   when the body is one. A failed result also says whether a response arrived and with which
   status, `ETag` and wire check (`response`), so a caller can tell "the server answered `2xx`
   but the body was too large or invalid" from "no answer". Later Console items (tokens,
   maintenance, incidents) reuse it.
4. **Console routes use exact paths and a query id.** `GET /checks`, `GET /checks/check?id=`,
   `GET /checks/shadowed?id=`, `GET|POST /checks/new`, `GET|POST /checks/edit?id=`,
   `GET|POST /checks/delete?id=`, `GET /checks/export[?id=[&shadowed=1]]`. The `id` parameter
   must occur once and be non-empty, else the shell `404`; there is no length cap of its own,
   because every contract-valid id must stay reachable and the request-line limit of the HTTP
   server already bounds it. The id is compared
   with data from `GET /admin/config`. A POST form's `action` is the path with
   `?id=<encodeURIComponent(id)>`; its form token is issued for the path alone (`/checks/edit`,
   `/checks/delete`), because the dispatcher binds tokens to the path without the query
   (Current behavior 15). The handler takes the id from `request.query`, never from a field.
   An id enters an api path only through one helper, `apiIdSegment(id)`: it returns
   `undefined` for exactly `.` and `..` (Decision 14) and `encodeURIComponent(id)` otherwise.
5. **Identity of shadowed entries.** A list row and every link carry whether they address the
   effective check or the shadowed database definition. Runtime data (state, results, uptime,
   latency, SLO) is shown only for the effective check; `/checks/shadowed` shows only the stored
   definition, labelled `Shadowed by checks.json`, with Export (Member+) and Delete (Admin+).
6. **Type is chosen on create and fixed on edit.** The edit form has no `type` field; the type
   comes from the stored view. The id is fixed on edit.
7. **Write-only values.** Stored literal header values and a stored body show as `set` with an
   intent `keep` (default), `replace` or `remove`. A heartbeat secret is a write-only password
   input: required on create; on edit an intent `keep` (default) or `replace`. The Console never
   generates, stores or redisplays a secret, literal header value or body: after any failed POST
   these inputs come back empty with the text `Not kept for safety: enter it again.`, while all
   other non-secret input is kept. Plain header inputs are labelled `Plain value (not secret)`;
   env headers ask only for the variable name (`Secret from the probe environment`).
8. **Revision use and trusted context.** Edit and delete send the revision that the page showed
   as `If-Match: "<revision>"`. A create sends the revision of the read made just before it: a
   create cannot overwrite (an existing id is `409`). The Console never takes a fresh revision
   for an edit or delete. Neither `PageRequest` nor the form-token store keeps the stored type,
   keep markers or name between the page and its POST (Current behavior 15), and the form's
   hidden fields are never trusted for them. So an edit or delete POST first reads
   `GET /admin/config`, and every field or typed-name check runs only against the entry of that
   read, and only after the read's `revision` equals the form's `revision`: then the entry is
   exactly the one the person saw. Stored type, the names and order of stored literal headers,
   whether a body is kept, `hasSecret`, the name to type, and the source all come from that entry.
9. **Form size.** `POST /checks/new` and `POST /checks/edit` accept a form body up to
   524,288 bytes (`MAX_CHECK_FORM_BYTES`); every other POST keeps 8192. 524,288 covers a
   65,536-byte body fully percent-encoded (196,608 bytes), 16 KiB of header names and literals
   percent-encoded (49,152), and the other fields with room. The built JSON must also be at most
   `ADMIN_MAX_BODY_BYTES` (1,048,576, `contract/src/admin.ts:23`) before it is sent.
10. **Write outcome classes and the People log.** Every `requestJson` result of a check write
    falls into exactly one class, decided only by `response` (status and wire check) and never by
    the body:
    - `saved`: a response arrived with status `200`, `201` or `204` and wire check `ok`. pulse-api
      answers `2xx` only after its commit (Current behavior 16), so this holds even when the body
      then was too large, not JSON, failed validation, or timed out while being read. The body
      of the write answer is never needed: the Console redirects and the next page reads fresh
      data.
    - `refused`: a response arrived with a status of `400` to `599` and wire check `ok`: pulse-api
      itself refused, nothing was changed.
    - `unknown`: everything else: no response (timeout or network error before the headers,
      abort), any `1xx`/`3xx` or other `2xx` status, and any status whose wire check is `absent`
      or `mismatch` (pulse-api sets the header on every answer, so such an answer came from
      something in front of it or from another release, which may have forwarded the write).
    The action names are the api audit names `check.create`, `check.replace`, `check.delete`.
    `saved` appends one row with target kind `check`, `target_name` the check id, and `value`
    the unquoted `ETag` revision when it passes `isAdminRevision`, else `unknown`. `unknown`
    appends one row with `value` `unknown`. `refused` appends nothing, as for team changes. The
    local row is not atomic with the remote write; if its insert fails after `saved`, the page
    says `Saved in pulse-api. The People log row could not be written.` and logs `error`
    `check change not logged` with the error name only.
11. **Old apis.** If `GET /admin/config` passes `validateAdminConfigSummary` but fails
    `validateAdminConfigResponse`, the Checks pages show `This pulse-api is too old for the
    Checks pages. It needs check sources (pulse-api with #565).` and offer no write. Overview and
    setup keep working. A `404` from `/checks/:id/location-uptime` for an id that `/checks`
    lists shows `Location uptime needs a newer pulse-api.` in that panel only.
12. **Copy buttons.** `CONSOLE_JS` gains copy buttons for the probe host-binding line and the
    heartbeat example: a `<button type="button" data-copy="<element id>" hidden>` that the
    script unhides and that copies the `textContent` of that element. Without JavaScript the
    text stays selectable in a `<pre>`.
    **Shell text.** Both lines are meant to be pasted into a POSIX shell, and HTML escaping
    protects only the page, not the copied text. So every value from data (host names, the
    pulse-api URL, the heartbeat URL) reaches the line only through one pure helper in the new
    module `src/shell-line.ts`: `shellQuote(value)` returns `'` + `value` with each `'` replaced
    by `'\''` + `'`, always quoted, even for plain words. Nothing else (no double quotes, no
    backslash escaping, no allow-list that passes "safe" values unquoted) builds these lines.
    - Host binding: `hostBindingLine(bindings)` returns `PULSE_PROBE_HEADER_HOSTS=` +
      `shellQuote(JSON.stringify(object))`, where `object` is built with `Object.fromEntries`
      from the check's env headers in header order, each `[<VAR>, [<host>]]`. The whole JSON
      text is one quoted word; no part of it is spliced in by hand. `JSON.stringify` escapes
      `"`, `\` and every character below U+0020, so the text the shell assigns is valid JSON.
    - Heartbeat: `heartbeatLine(url)` returns `curl -fsS -X POST -H ` +
      `shellQuote("Authorization: Bearer <secret>")` + ` ` + `shellQuote(url)`, with `url` =
      saved pulse-api URL + `/heartbeat/` + `apiIdSegment(id)`. `<secret>` stays a placeholder
      (the secret is never shown); the user types the secret inside the quotes, which is safe
      because a secret has only `A-Z a-z 0-9 . _ ~ -` (R4).
    Why: Bun 1.4.0 parses `https://a';id;'b/` with `hostname` `a';id;'b` (verified with
    `new URL`, also in Node 24), the contract accepts that check URL (`contract/src/schema.ts:22-40`
    checks only that it parses, is `http:`/`https:` and has no user info), and the probe accepts
    that host entry
    (`probe/src/header-hosts.ts:11,25-40` forbids only whitespace, `/?#@\*%` and `:` outside
    IPv6), so the old template `'{"<VAR>":["<host>"]}'` would end the quote and run `id` when
    pasted. The `<pre>` holds `escapeHtml(line)`, so its `textContent` and the copied text are
    exactly `line`.
13. **Refused form tokens on check routes.** `renderForm` cannot read pulse-api (it is
    synchronous, Current behavior 15), so:
    - `/checks/new`: `renderForm` renders the create form of the posted `type` when it is one of
      the six (else the type choice page) with the kept non-secret input, the
      `Not kept for safety: enter it again.` text on write-only inputs, and the expired notice;
      `409` as today.
    - `/checks/edit` and `/checks/delete`: `renderForm` renders no form, only the expired notice
      `This form has expired. Nothing was sent. Open it again to see the current version.` and
      a link to the same route with `?id=<encodeURIComponent(id)>` from the query (no link when
      the query id is absent or repeated); `409`. The typed input is not kept: no trusted
      stored context exists in that step.
    - Replay (`Already submitted`): `ProtectedRoute` gains optional `reopenHrefOf(request)`; the
      dispatcher uses it instead of `ctx.path` when set. The check routes return their own path
      with the encoded query id (edit, delete) or `/checks/new`, so the link never drops the id.
      Routes without it keep today's link.
14. **Ids `.` and `..` are not addressable.** No URL path can carry them (Current behavior 14),
    and the api cannot be asked to change this here. The Console lists such a check, shows its
    detail and shadowed view from `/admin/config` and exports it (export reads only
    `/admin/config/export` and `/admin/config`), but never builds an api URL for it:
    `apiIdSegment` returns `undefined` and every per-id call site handles that before it calls
    `fetch` or `requestJson`. On the detail page the results, location-uptime and latency panels
    and the heartbeat usage say `pulse-api cannot address the id "<id>" in a URL path, so its
    results, per-location uptime and latency cannot be read. Rename the check to use them.`
    (heartbeat: `... so pulse-api cannot receive pings for it. Rename the check.`). The list row
    and the aggregate uptime (from `GET /uptime`, no per-id path) render as usual. Edit and Delete
    are not offered, and `GET` or `POST` of `/checks/edit` or `/checks/delete` for such an id
    answers `409` `pulse-api cannot address the id "<id>" in a URL path, so the Console cannot
    change or delete it.` without reading anything but `/admin/config` and without any write.
    (The api parses even a raw request path with `new URL`, so no client can reach these ids
    through `/admin/checks/:id`; a file check with such an id is changed in `checks.json`.) Create cannot
    produce such an id (R4 id rule). Every other id is sent as exactly one segment: the
    segment `encodeURIComponent(id)` contains no `/`, `?`, `#` or unencoded `%`, and is never a
    dot segment.

## Required behavior

### R1. List (`GET /checks`, Viewer+)

- Reads `GET /admin/config` (Bearer token, `validateAdminConfigResponse`) and `GET /checks`
  (no `authorization` header, `validateChecksResponse`) at the same time, 5000 ms each.
- Rows: every entry of `checks` in api order, then every entry of `shadowed`. Columns: name,
  id, type, target (HTTP: URL; TLS and TCP: `host:port`; DNS: `dnsName recordType`; domain:
  `domain`; heartbeat: `Heartbeat`), source (`checks.json (read-only)` or `Console`), state, last
  result time (UTC, `YYYY-MM-DD HH:MM:SS UTC`, or `No results yet`). State is the text of
  `/checks` (`Up`, `Degraded`, `Down`, `Unknown`, `Maintenance`); an effective check missing from
  `/checks` shows `Unknown`. A shadowed row shows `Shadowed by checks.json` instead of a state.
  State is never colour only.
- Counts above the table: `<n> checks` from `checks` only, plus `<m> shadowed definitions` when
  `m > 0`. Shadowed rows are never counted as checks.
- Row actions: View (all); Edit (Member+, database source, not shadowed); Export (Member+);
  Delete (Admin+, database source or shadowed); Edit and Delete never for the ids `.` and `..`
  (Decision 14). Hidden actions are presentation only (R9). Every link carries the id as
  `?id=<encodeURIComponent(id)>`.
- Filters (GET form, query names): `q` (case-insensitive substring of id, name or target after
  `trim()`, at most 200 characters), `type` (`http`, `tls`, `tcp`, `dns`, `domain`,
  `heartbeat`; a check without `type` is `http`), `state` (`up`, `degraded`, `down`, `unknown`,
  `maintenance`; never matches a shadowed row), `source` (`file`, `database` = effective
  database checks, `shadowed`). Filters combine with AND and round-trip in the URL. A parameter
  that is repeated, empty or outside its set is treated as absent, and the page says
  `Some filter values were not understood and were ignored.`; a `q` over 200 characters is the
  same. `Reset filters` links to `/checks`.
- Empty installation (no checks, no shadowed): `No checks yet` with `Add a check` for Member+ or
  `A member can add checks.` for a Viewer. No match: `No checks match these filters` with
  `Reset filters`. Member+ also sees `Add a check` (`/checks/new`) and `Export as checks.json`
  (`/checks/export`).
- A file status other than `ok` shows a banner: `checks.json is invalid` / `cannot be read` /
  `was written but not applied`, the api's `message` (escaped), `The last valid version from
  <time> stays in use.` from `lastAppliedAt`, and `Console checks can still be changed.` Database
  actions stay available.
- Failure: no token, rejected token (banner), unreachable, timeout, status, wire, invalid and
  old-api states through `src/states.ts`; the page answers `200` like the Overview.

### R2. Detail (`GET /checks/check?id=<id>`, Viewer+)

- `404` shell page when `checks` of `/admin/config` has no entry with that id.
- Round 1: `/admin/config` and `/checks`. Round 2, at the same time: `GET /uptime`,
  `GET /checks/<id>/results?limit=20[&before=<before>]`, `GET /checks/<id>/location-uptime`, and
  for an HTTP check only `GET /checks/<id>/latency`, where `<id>` is `apiIdSegment(id)`. For the
  ids `.` and `..` only `GET /uptime` is read and the other panels show the Decision 14 text. A
  failed round-2 read shows its state in its panel; the rest renders.
- Shows: settings of the view (no write-only value; `set` for kept header values and a body;
  env names as stored; for heartbeat `Secret: set`), source, state, `consecutiveDown`, last
  reason, maintenance window when present, certificate days left for TLS and domain.
- Locations table, one row per location from `/checks` `locations`, joined by name with the
  location-uptime answer (a name only in one of them still gets a row): status, time, latency
  (`latencyMs` ms; `Not applicable` for heartbeat), attempts, reason, `Stale` when `stale` is
  true, and 90-day uptime `formatPercent(uptime)` with `<good> of <results> results`, or
  `No results in 90 days`. The location `heartbeat` of a heartbeat check is labelled
  `Heartbeat pings`. A text above the table states the fixed rule: `Every probe runs this check.
  It is down when at least two locations report down; with one reporting location, that
  location decides.` (heartbeat: `Heartbeat checks are not run by probes; your job pings
  pulse-api.`).
- Aggregate uptime from `/uptime` for this id: `formatPercent(uptime)` over 90 days, with a
  `<details>` table of the 90 days (`date`, uptime or `No results`, results).
- HTTP latency: a table of the 90 days (`date`, p50, p95, count; `No results` when `count` is 0),
  newest first, the first 14 rows visible and the rest in `<details>`. Other types show no
  latency panel and never call `/latency`.
- SLO (from `/checks`): absent → `No availability objective`; `availability` null →
  `Objective <target> %: no results in the last 30 days`; else `Availability <formatPercent> %
  over 30 days, objective <target> %`, and `budgetRemaining` with one decimal: `x.x % of the
  error budget left` when the raw value is `>= 0`, `Error budget exceeded (x.x %)` when it is
  `< 0`. The sign comes from the raw value, not from the rounded text.
- Recent results: 20 per page, newest first: time, location, status, status code, latency,
  attempts, reason. `Older results` links to `before=<timestamp of the last row>`; a page with
  `before` also has `Newest results`. A `before` that is not `^[0-9]{1,16}$` is ignored (first
  page). The Console never asks for more than one page per view.
- Heartbeat usage (not for the ids `.` and `..`, Decision 14): `<pre>` with
  `heartbeatLine(<saved pulse-api URL>/heartbeat/<apiIdSegment(id)>)` (Decision 12), for
  example `curl -fsS -X POST -H 'Authorization: Bearer <secret>'
  'http://localhost:3000/heartbeat/nightly-backup'`; the URL is always one single-quoted word,
  and the note `Use the address under which
  your job reaches pulse-api. The secret is not shown again.` plus a copy button.
- Actions by role as in R1.

### R3. Shadowed definition (`GET /checks/shadowed?id=<id>`, Viewer+)

- `404` when `shadowed` has no entry with that id. Shows the stored definition (same rendering
  as R2 settings) with `Shadowed by checks.json: the check from checks.json runs instead. This
  definition is kept in the database.` No state, results, uptime, latency or SLO. Export and
  Delete only, by role. Links to the effective check's detail.

### R4. Create (`GET|POST /checks/new`, Member+)

- `GET /checks/new` without `type`: six choices (links to `?type=<t>`), each with a one-line
  explanation. With a known `type`: the form of that type with its defaults. Another `type`:
  the choice page.
- Fields per type (form names in brackets; empty optional field means absent):
  - all: id (`id`, `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, fixed afterwards), name (`name`,
    trimmed, 1 to 200 characters, no control character), availability target
    (`availability_target`, `^\d{1,2}(\.\d{1,3})?$`, `90 <= v < 100`), hidden `type`, `revision`.
  - HTTP: `url`; `method` (select, default GET); `interval_ms` (required); `timeout_ms`;
    `retries` (0 to 10, default 0); `retry_delay_ms` (0 to 60000); `latency_objective_ms`;
    `expected_status` (comma-separated codes or `lo-hi` ranges, at most 20, empty means the
    default `200-299`); `keyword` (non-empty or absent); `body` (textarea); header rows; JSON
    assertion rows.
  - TLS: `host`, `port` (default 443), `warn_days` (0 to 3650, default 14), `interval_ms`,
    `timeout_ms`. Text: `This check judges the certificate's expiry date only. It does not
    verify the certificate chain or the host name.`
  - TCP: `host`, `port`, `interval_ms`, `timeout_ms`, `retries`, `retry_delay_ms`.
  - DNS: `dns_name`, `record_type` (A, AAAA, CNAME, MX, TXT, NS), `expected` (textarea, one
    value per line, blank lines ignored, 1 to 20 values or absent), `resolver` (IPv4 or IPv6),
    `interval_ms`, `timeout_ms`, `retries`, `retry_delay_ms`.
  - Domain: `domain`, `warn_days` (default 30), `interval_ms` (at least 3600000, default
    86400000), `timeout_ms`, `retries`, `retry_delay_ms`.
  - Heartbeat: `period_ms` (1000 to 86400000), `grace_ms` (0 to 86400000, empty means 0),
    `secret` (required, 16 to 128 characters of `A-Z a-z 0-9 . _ ~ -`, not starting with
    `replace-with-`, `type="password"`, `autocomplete="new-password"`). No interval, retries or
    location fields.
  - Durations are integers in milliseconds (`^[0-9]{1,10}$`, then the contract bounds); the
    label says `ms`. Lossless: an api value such as 1500 round-trips.
- Header rows: 20 indexed rows (`header_<i>_name`, `header_<i>_kind` `plain`|`env`,
  `header_<i>_value`, `header_<i>_intent` for a stored literal), `i` 0 to 19, inside
  `<details>`; the first `max(existing + 3, 5)` rows are visible, the rest in a nested
  `<details>` `More rows`. A row with an empty name and value is ignored. A free row whose name
  is exactly `__proto__` is a field error on `header_<i>_name`: `422`, message `__proto__ is not
  an allowed header name.`, and nothing is sent. This matches the contract
  (`contract/src/validate-admin.ts:34-37,69`: `validateAdminCheckInput` rejects an own
  `__proto__` header) and the api file parser (`api/src/config.ts:225-228`).
  **Duplicate names.** Before any header object is built, the handler lists the used rows in
  index order: every stored literal row (R5, indexes `0` to `k - 1`) whose intent is `keep` or
  `replace`, then every free row that is not ignored. A stored row with intent `remove` is not
  used. If a used row's name, compared with `name.toLowerCase()` (the comparison of the
  contract's header rule, `contract/src/schema.ts:149-160`), equals the name of an earlier used
  row, that later row gets a field error on `header_<i>_name`. The later row is always a free
  row: stored rows come first, and the names of a view are already unique without case
  (`validateAdminConfigResponse` applies the same header rule to a view,
  `contract/src/admin.ts:89-108`). The answer is `422`, message `This header is already set in another row (names are compared without
  case).`, and nothing is sent. Without this check `Object.fromEntries` would keep only the last
  of two rows with the same exact name, so a free `X-Api-Key` row would silently overwrite the
  stored `{ "keep": true }` of `X-Api-Key` without the person choosing `Replace`; rows that
  differ only in case would reach the contract, which refuses them without naming a row. The
  `__proto__` check runs first, then this one. Every other header
  name keeps its case and becomes an own key (`Object.fromEntries`, never `obj[name] = value`),
  so the built input that `validateAdminCheckInput` sees is the one that is sent. For each env
  header the form and detail show the line to add on every probe:
  `hostBindingLine` (Decision 12) over all env headers of the check in one object, `<host>`
  being `new URL(url).hostname`; for `PULSE_HEADER_TOKEN` and `https://api.example.com/` it is
  `PULSE_PROBE_HEADER_HOSTS='{"PULSE_HEADER_TOKEN":["api.example.com"]}'`. The JSON text is
  serialized whole and shell-quoted whole; a host is never pasted into a quoted template. The
  line comes with `Merge this into the value that each probe already has, and set <VAR> in the
  probe environment.` and a copy button.
- JSON assertion rows: 10 indexed rows (`assert_<i>_pointer`, `assert_<i>_mode`
  `none`|`exists`|`equals`, `assert_<i>_equals` JSON text). A row is used when its mode is not
  `none`; `equals` must parse with `JSON.parse`, else `Enter a JSON value, for example "ok",
  200 or true.`
- Fixed quorum rule (#460 amendment, section 20: "the editor states the fixed rule"). Every
  create and edit form of the types HTTP, TLS, TCP, DNS and domain shows, above the submit
  button, the paragraph `Every probe runs this check. It is down when at least two locations
  report down; with one reporting location, that location decides. Choosing locations or a
  quorum per check is not available yet.` The heartbeat form shows instead `Heartbeat checks are
  not run by probes and have no quorum; your job pings pulse-api. With no ping for longer than
  the period plus the grace time, the check is down at once.` The rules are the api's
  `quorumStatus` (`api/src/state.ts:38-48`: one location decides alone; with two or more, down
  when at least two are down) and its heartbeat judge (`api/src/heartbeat.ts:23,55-70`,
  `api/docs/concepts.md:21`: overdue after `period + grace`, one `down` result, incident at
  once). No form has a quorum or location field (Non-goals). The detail page of R2 keeps its own
  text.
- Validation runs in the Console first with the contract (`validateAdminCheckInput`) plus the
  field rules above, and returns `422` with the form, an error summary and per-field messages.
  Only the fields of the chosen type are read; fields of other types in the POST are ignored and
  never sent.
- Commit order after the dispatcher (which already used the form token): field checks (`422`);
  JSON size (`422` `The check is larger than pulse-api accepts (1 MiB).`); read
  `GET /admin/config` (failure states, `502` page); id already in `checks` or `shadowed`
  (`409` form `A check with this id exists.`); session and stored-role recheck (R8); `POST
  /admin/checks` with `If-Match: "<revision of that read>"`; outcome per R8; for `saved` the
  People-log row and `303` to `/checks/check?id=<encoded id>&saved=1`, whose page says
  `Check saved.` A create needs no stored context, so its field checks may run before the read.

### R5. Edit (`GET|POST /checks/edit?id=<id>`, Member+)

- Shadowed membership is checked before the effective source. Every shadowed definition has an
  effective file check with the same id (`api/src/effective-checks.ts:32-43`: a database
  definition whose id is already a file id goes to `shadowed`), so a file test first would never
  reach the shadowed branch. Order: id in `shadowed` → `409` page `Shadowed by checks.json: only
  Delete and Export are possible.` with Delete (Admin+) and Export (Member+) links; else no entry
  in `checks` → `404`; else effective source `file` → `409` page `This check comes from
  checks.json. Edit the file to change it.` No form is rendered in these cases.
- The form is the R4 form of the stored type, filled from the view: env headers as name and
  variable; kept literal headers as fixed name, `set`, intent radio `Keep` / `Replace` /
  `Remove`; a kept body as `set` with the same radios and an empty textarea for `Replace`;
  heartbeat `Secret: set`, radio `Keep` / `Replace`. Hidden `revision` is the shown revision.
- Intent rules: `keep` sends `{ "keep": true }`; `remove` leaves the entry out; `replace` needs a
  non-empty new value (`Enter the new value, or choose Remove.`). A value typed while the intent
  is `keep` is refused (`Choose Replace to use the new value.`), so an empty or forgotten input
  never removes or overwrites a value. A kept body with a method of GET or HEAD is refused like
  any body (`A body needs POST, PUT, PATCH, DELETE or OPTIONS.`).
- Stored literal header rows come first, in the header order of the view, at indexes `0` to
  `k - 1`; their name is shown as text and is not a form input. On POST the handler takes the
  name of row `i < k` from the trusted entry and reads only `header_<i>_intent` and
  `header_<i>_value` for it; a posted `header_<i>_name` or `header_<i>_kind` for such a row is
  ignored. Rows `k` to `19` are free rows (name, kind, value), env headers of the view filled
  in first. The duplicate-name rule of R4 runs over the stored rows (intent `keep` or `replace`)
  and the free rows together: a free row named `x-api-key` next to a kept stored `X-Api-Key` is
  `422` and nothing is sent; with the stored row's intent `remove`, the free row is used and
  the PUT carries only it (an explicit switch from a literal to, for example, an env value).
- Commit order of a POST (the dispatcher has already checked Origin, size, CSRF, role and used
  the form token):
  1. Query id present once and non-empty, else `404`.
  2. Read `GET /admin/config` (Bearer, `validateAdminConfigResponse`). Failure: the R1 failure
     state (`502`, `401` banner etc. as on the list) with the heading `Not saved: the current
     version could not be read.`, the kept non-secret input as text (field label and value, no
     form), and a link to reopen the edit page; nothing is sent.
  3. Target, in this order: the id is in `shadowed` → `409` shadowed page (with its Delete and
     Export links); no entry in `checks` → `404`; the effective entry has source `file` → `409`
     file page; the id is `.` or `..` → `409` Decision 14 page. The shadowed test comes first
     because a shadowed id always also has an effective file entry
     (`api/src/effective-checks.ts:32-43`).
  4. Revision: the form's `revision` differs from the read's `revision` → `409` with `staleState`
     and the kept non-secret input as text (no form, so nothing stale can be sent again) and its
     `Reload` link to `/checks/edit?id=<encoded id>`. Nothing is sent.
  5. Field checks against the trusted entry of step 2 (its type, stored literal header names and
     order, kept body, `hasSecret`) → `422`, the form re-rendered from that entry with the kept
     non-secret input, the same hidden `revision`, a fresh form token and the summary.
  6. JSON size (`422` as in R4).
  7. Session and stored-role recheck (R8).
  8. `PUT /admin/checks/<apiIdSegment(id)>` with `If-Match: "<form revision>"` and the built body.
  9. Outcome per R8; for `saved` the People-log row and `303` to
     `/checks/check?id=<encoded id>&saved=1`.
- A `GET` reads `/admin/config` once and renders from that entry; its hidden `revision` is that
  read's revision.

### R6. Delete (`GET|POST /checks/delete?id=<id>`, Admin+)

- Typed confirmation (`typedConfirmPage`) of the check's `name`, with hidden `revision` and
  `target` (`database` or `shadowed`). Consequence text: database check: `The check stops
  running. Its results stay in pulse-api and its open incidents are resolved.`; shadowed:
  `Only the database definition is removed. The check from checks.json keeps running.` A file
  check: `409` page `This check comes from checks.json.`
- The name to type, the consequence text and `target` come from the server's read, never from
  the form. The posted `target` is only compared.
- Commit order of a POST:
  1. Query id present once and non-empty, else `404`.
  2. Read `GET /admin/config`. Failure: the R1 failure state with `Not deleted: the current
     version could not be read.` and a link to reopen; nothing is sent.
  3. Target from that read: in `shadowed` → `shadowed`; else effective with source `database` →
     `database`; effective file-only → `409` file page; none → `404`; id `.` or `..` → `409`
     Decision 14 page. A posted `target` that differs from the derived one → `409` stale.
  4. Revision: form `revision` differs from the read → `409` `staleState` with `Reload`; no
     confirmation form is rendered.
  5. Typed name: `confirm_name` checked with `typedNameError` / `isTypedNameConfirmed` against
     the `name` of the entry from step 2 → `422`, the confirmation re-rendered from that entry
     with the same hidden `revision` and a fresh form token. Nothing is sent.
     **Outer spaces of the stored name.** Today the helper trims only the typed value
     (`console/src/confirm.ts:36-37`), while pulse-api stores a check name with outer spaces as
     given: its rule only refuses a name that is blank after `trim()` and never trims the value
     (`api/src/config.ts:58-60`, `:82`; database writes go through the same `parseCheck`,
     `api/src/check-write.ts:149,159`; the contract name is any string,
     `contract/src/schema.ts:18`, `:271`). So a check named `" Checkout API "` could never be
     deleted. The helper changes to compare
     `typed.trim().normalize("NFC") === expected.trim().normalize("NFC")`: both sides are
     trimmed with `String.prototype.trim`, inner whitespace and case still count. The mismatch
     text names `expected.trim()` (`The name does not match. Type Checkout API exactly.`), and the
     check delete page passes `name.trim()` as `targetName`. For every name without outer
     whitespace, which includes every team member name the team routes pass today
     (`console/src/team-routes.ts:438`; names are stored trimmed by `checkName`,
     `console/src/forms.ts:77-85`), the result is unchanged, so the existing rows of
     `confirm.test.ts` keep their expected values. A stored name is never blank after `trim()`
     (api rule above), so the blank-typed text `Type the name to confirm.` stays the only
     answer to an empty input.
  6. Session and stored-role recheck (R8).
  7. `DELETE /admin/checks/<apiIdSegment(id)>` with `If-Match: "<form revision>"`.
  8. Outcome per R8; for `saved` the People-log row and `303` to `/checks?deleted=1`, whose page
     says `Check deleted.` No id is echoed from the query.
- A `GET` reads `/admin/config` once and renders the confirmation from that entry.

### R7. Export (`GET /checks/export`, Member+)

- No query: reads `GET /admin/config/export` with the token, validates it with
  `validateAdminConfigExport`, and answers `200` `application/json; charset=utf-8`,
  `content-disposition: attachment; filename="checks.json"`, `cache-control: no-store`, body
  `JSON.stringify(value, null, 2) + "\n"` (the api's own format, `config-export.ts:62-65`).
- `?id=<id>`: from the same export document: `checks` the entry with that id, `components` `[]`,
  `maintenance` the entries with that `checkId`, `redacted` the entries with that `checkId` (key
  absent when none), `filename="check.json"`. Unknown id `404`.
- `?id=<id>&shadowed=1`: built from the `shadowed` view of `/admin/config` with the api's rules:
  `source` and `hasSecret` dropped; `{keep: true}` header values left out and listed as
  `headers.<name>` (header order), an empty header object left out; a kept body left out and
  listed as `body`; a heartbeat lists `secret`. Validated with `validateAdminConfigExport`
  before it is sent. Unknown id `404`. Any other query shape `404`.
- The page above the download link says: `The export leaves out header values, bodies and
  heartbeat secrets and lists them in "redacted". Fill them in and remove "redacted" before you
  use the file as checks.json.` No keep marker is ever written into an export.

### R8. Write guard and failures

- Right before the outbound write, after the awaited read: the request's session row must still
  exist (`isCredentialGuardHeld`, else `409` `Not saved` as for team commits) and the user's
  stored role, read again, must still meet the route's role (else `403`). The write is sent
  after both pass.
- Every write uses `requestJson` with a 5000 ms timeout, `redirect: "manual"`, `content-type:
  application/json`, the Bearer token, and no retry.
- Answer mapping. The class comes from Decision 10; "form" means the form re-rendered from the
  trusted entry with the kept non-secret input (create: from the posted type), "text" means the
  kept non-secret input as text without a form. `<message>` is the api's `message` from
  `requestJson`, escaped, at most 1000 characters, or `pulse-api gave no reason.` when absent.

  | `requestJson` result | Class | Console answer | People log |
  | --- | --- | --- | --- |
  | `ok`, status `200`/`201`/`204`, wire `ok` | saved | `303` as in R4 to R6 | row, `value` revision |
  | not `ok`, `response.status` `200`/`201`/`204`, `response.wire` `ok` (error `too-large`, `invalid-json`, `validation`, or `timeout` while reading the body) | saved | `303` as in R4 to R6; one `warn` `api answer unreadable` with `call` `write` and `kind` | row, `value` revision from `response.etag`, else `unknown` |
  | `http` `401`, wire `ok` | refused | `502` with the token-rejected banner, text | none |
  | `http` `403`, wire `ok` | refused | `502` `The console token lacks the admin or checks scope. Saving checks needs both.`, text | none |
  | `http` `404`, wire `ok` | refused | `404` `This check no longer exists.` | none |
  | `http` `409`, wire `ok` | refused | `409` form with `<message>` | none |
  | `http` `412`, wire `ok` | refused | `412` `staleState`, text, `Reload` | none |
  | `http` `413` or `422`, wire `ok` | refused | `422` form with `<message>` in the summary | none |
  | `http` `429`, wire `ok` | refused | `503` `pulse-api is throttling the console. Try again in a minute.`, form | none |
  | `http` other `400`–`499` (400, 428), wire `ok` | refused | `502` `pulse-api refused the request (<status>): <message> Nothing was changed.`, text | none |
  | `http` `500`–`599`, wire `ok` | refused | `502` `pulse-api could not save the change (<status>). Nothing was changed.`, text | none |
  | `http` `300`–`399`, any wire | unknown | `502` `pulse-api answered with a redirect (<status>); redirects are not followed. The result is unknown: open the check to see whether the change was saved. Check that PULSE_API_URL points at pulse-api itself.`, text | row, `unknown` |
  | any response whose wire is `absent` or `mismatch`, any other status (`1xx`, `2xx` other than above) | unknown | `502` `The answer did not come from a matching pulse-api (<status>). The result is unknown: open the check to see whether the change was saved.`, text | row, `unknown` |
  | no response: `timeout` or `network` before the headers, `aborted` | unknown | `504` `The result is unknown. Open the check to see whether the change was saved.`, text | row, `unknown` |

  The rows are checked top to bottom; the first match wins. `<status>` is the number only. No
  row ever retries or sends a second request.
- Logs: one `info` `check change` with `action`, `actorId`, `checkId` and `outcome` (`saved`,
  `refused` with `status`, or `unknown`); a failed read logs one `warn` `api read failed` with
  `call`, `kind` and `status`. No log line, redirect, download, response header or `/metrics`
  label holds a header value, body, secret, the Console token, a form token or a CSRF token.
  Pages, error pages included, hold no header value, body, secret or Console token anywhere.
  Pages may hold the session CSRF token and form tokens only in their intended hidden controls:
  `csrfField` (`<input type="hidden" name="csrf" value="…">`, `console/src/html.ts:35-37`) and
  `formTokenField` (`<input type="hidden" name="form_token" value="…">`, `html.ts:40-42`), as
  in every page form and the shell's sign-out form (`console/src/shell.ts:49-53`). The session
  CSRF value is reused across pages, so it legitimately appears on every signed-in page. A
  token anywhere else in a page (text, a link, another attribute, a script) is a leak.

### R9. Roles and request guards

- `/checks`, `/checks/check`, `/checks/shadowed`: `routeRole("overview.view")` (Viewer+);
  `/checks/new`, `/checks/edit`, `/checks/export`: `routeRole("check.write")` (Member+);
  `/checks/delete`: `routeRole("check.delete")` (Admin+). Enforced by the dispatcher for `GET`,
  `HEAD` and `POST`; direct requests get the `403` page.
- All POSTs keep the protected order: Origin, content type, body size (route limit), repeated
  field, session CSRF, role, form token, then the handler. Roles, sources, ids and revisions
  from the form are never trusted over the server's own read.
- The navigation entry Checks becomes available.

## Risks

- The admin revision covers the whole configuration, so any change elsewhere makes an open edit
  stale. This is the api's documented behavior; the stale page keeps the input and offers
  Reload.
- A first read of `location-uptime` after the upgrade fills up to 89 closed days of that check
  from `results`, like the first `/uptime` read after migration 3 did. The hourly backfill fills
  them in small batches after start, so later reads use stored rows.
- A `4xx`/`5xx` after a successful commit is not possible in the api's write path (the audit
  entry commits in the same transaction), so a `4xx`/`5xx` that carries the wire header is
  reported as not saved. A proxy in front of pulse-api can answer `502`/`504` after it forwarded
  the write; such an answer has no wire header and is reported as unknown (Decision 10). A proxy
  that copies the upstream wire header onto its own error page would be misread as a refusal;
  the docs name this limit.
- The ids `.` and `..` stay unusable for per-id api routes (Decision 14); fixing that needs an
  api route that takes the id outside the path, which is out of scope.
- Textarea line breaks are sent as CRLF by browsers (HTML form encoding), so a body typed in the
  Console is stored with CRLF. The docs say so.
- Re-entering a write-only value after an unrelated validation error costs the user time; local
  validation catches most errors before the api is called.

## Performance impact

api `bench/budgets.json` keys:

- `startup_cpu_ms`, `startup_wall_ms`: one `CREATE TABLE IF NOT EXISTS` on an existing file;
  expected change below noise (< 1 ms).
- `load_cpu_s`, `p95_post_results_ms`, `rps`: an ingest adds one location upsert only when its
  `uptime_daily` bump changed a row (a late result for a filled closed day). The bench load posts
  current results, so expected change below noise (< 1 %).
- `p95_get_checks_ms`, `p95_get_latency_ms`, `p95_get_check_latency_ms`, `cold_*`, `eod_*`: the
  new route is not part of the bench load and no existing read changes; none expected.
- `idle_rss_mib`, `peak_rss_mib`: the new answers live in the existing 5 s cache per check id;
  expected below 1 MiB. The hourly backfill now also fills location days after the uptime days;
  on the 864,000-row seed this is one extra pass over the closed days in yields of one (check,
  day), done before the bench's settle step ends (`bench/README.md`, warm start waits for CPU to
  settle), so `load_cpu_s` should not see it.
- `test_cpu_s`: new api tests add a few hundred ms (budget 5.6 s); contract `test_cpu_s` and
  `build_cpu_s` grow slightly with two new modules' tests (budgets 9.0 s, 6.4 s).
- `image_mb`: no dependency change; none expected.
- Measure: `bun bench/run.ts --a main --b <branch>` from the api checkout (or at least
  `bun bench/cold-read.ts --api <worktree>` and `bun bench/eod-read.ts --api <worktree>` for a
  local check), and report the changed keys in the PR. Also time one cold
  `GET /checks/<id>/location-uptime` on the 864,000-row seed, before and after the backfill, and
  report both numbers.

## Security impact

Security impact: yes
The change adds admin-api writes from the Console, a larger form limit at a trust boundary, rendering of api error texts, file downloads, and a new public api read.

Checklist items that apply:

- Secrets in errors, logs and responses: literal header values, bodies, heartbeat secrets and
  the Console token never appear in HTML (also after a failed POST), redirects, downloads, log
  lines or metrics; the export never contains keep markers. The session CSRF token and form
  tokens appear only in their hidden `csrf` and `form_token` controls (R8 Logs), never in
  redirects, downloads, response headers other than the session's own cookies, logs or metrics.
- Auth order and status codes: dispatcher order unchanged; session and stored role are
  rechecked before each outbound write; Viewer/Member/Admin boundaries per route; edit and
  delete validate only against a server read whose revision equals the form's, never against
  hidden fields (Decision 8).
- Body and size limits: 524,288 bytes only on the two editor POSTs, 8192 elsewhere; built JSON at
  most 1 MiB; `requestJson` response cap (default 5 MiB); `fetchJson` caps unchanged.
- Input validation: every form field validated before use; contract validators on every api
  answer at the Console edge; query `id`, `before` and filter parameters validated.
- Output encoding for copied shell text: the host-binding and heartbeat lines are built only by
  `src/shell-line.ts` (`shellQuote` over the whole JSON text and the whole URL, Decision 12);
  HTML escaping is applied on top for the page and is not relied on for the clipboard. A host
  name such as `a';id;'b` (accepted by `new URL` and by the probe) never ends the quote.
- Accessor execution: header names become own keys via `Object.fromEntries`; the name
  `__proto__` is refused with `422` before anything is sent (contract and api reject it too);
  two used rows whose names are equal without case are refused with `422` before the object is
  built, so no row can silently overwrite a stored keep marker (R4, R5);
  `requestJson`
  parses JSON and reads only own data properties of the error body.
- SSRF and redirects: the Console calls only its saved pulse-api URL; every id goes through
  `apiIdSegment`, which yields exactly one percent-encoded segment and refuses `.` and `..`
  (which the URL parser would turn into another route, Current behavior 14); writes and reads
  never follow a redirect, and a `3xx` on a write is an unknown outcome; the host-binding line is
  text, never fetched.
- Atomic, path-safe writes: no file is written (downloads are responses); the People-log insert
  is one row in its own statement.
- Dependency pins: contract pinned to a full `main` SHA in api and console; no new package.

## Rollout order

1. contract: merge `requestJson` and `CheckLocationUptime` (2.2.0, wire version stays 1).
   Every consumer on an older pin (probe, status, notify, kit users, api, console) keeps working:
   the change is additive and `FetchJsonError` only gains an optional field.
2. api and console in parallel, each pinning the merged contract SHA.
   - api first in production: the new route and table are additive; status, notify and probes on
     old pins ignore them; a Console from before this spec does not call the route. A downgrade
     of the api keeps working without a restore (no `user_version` change); an older release
     ignores the new table and the sum rule repairs its days later.
   - console against an api without the route: detail shows `Location uptime needs a newer
     pulse-api.` (Decision 11); everything else works. Against an api without #565 config
     sources: the old-api state, no writes; Overview unchanged.
3. Release the api image before the Console image in a stack update, so the location panel is
   filled from the start; the reverse order is safe too.

## Counterexamples

- **Location uptime window.** now = 2026-11-05T12:00:00Z. A result at 2026-08-08T00:00:00.000Z
  (`(today - 89) * DAY_MS`) counts; one at 2026-08-07T23:59:59.999Z does not; one at
  2026-11-05T12:00:00.001Z (after `now`) does not. A wrong implementation that uses
  `now - 90 * DAY_MS` counts the 2026-08-07T12:00Z row.
- **Statistic.** Location `eu`: 3 up, 1 degraded, 1 down in the window gives `good 4`,
  `results 5`, `uptime 80`. Location `us`: only rows older than the window gives `good 0`,
  `results 0`, `uptime null` (listed, not missing, not `0`). Percentile methods do not apply;
  per-location values are never averaged into the aggregate: aggregate `/uptime` is computed
  from all rows. For every check, `sum(results)` over locations equals `sum(days[].results)` of
  `/uptime` at the same `now`; a wrong implementation that drops the `heartbeat` location
  breaks this.
- **Sorting and uniqueness.** Locations `b`, `B`, `a` are listed `B`, `a`, `b` (code units). A
  response with `a` twice fails `validateCheckLocationUptime`; so does `uptime 50` with
  `results 0`, `uptime null` with `results 3`, and `good 4` with `results 3`.
- **Complete-day rule.** A closed day with `uptime_daily.total = 10` and location rows summing to
  9 (a late result stored by an older release) is recomputed; a day summing to 10 is not read
  from `results`.
- **Status codes of the route.** `/checks/unknown/location-uptime` is `404`; an inactive
  (deleted) check is `404`; `/checks/%E0%A4%A/location-uptime` is `400` `bad check id`;
  `/checks/a%2Fb/location-uptime` addresses the id `a/b`.
- **Display percent.** `formatPercent`: `100` → `100 %`; `99.995` → `99.99 %` (rounding would
  wrongly show `100.00 %`); `99.9999999` → `99.99 %`; `12.345` → `12.34 %`; `0` → `0.00 %`;
  `null` → `No results`. Rule: `100` exactly prints `100 %`; otherwise
  `min(floor(v * 100 + 1e-6), 9999) / 100` with two decimals.
- **Budget sign.** `budgetRemaining -0.04` shows `Error budget exceeded (-0.0 %)`, not
  `0.0 % left`.
- **Form size.** A valid HTTP POST check with a 65,536-byte body of 32,768 `é` characters
  (196,608 bytes encoded) is accepted on `/checks/new`; a 524,289-byte form answers `413` and
  the fake api receives no request; a 9000-byte POST to `/team/invites` still answers `413`.
- **Field rules.** `expected_status` `200 , 204` → `[200, 204]`; `2xx` and `299-200` → `422`.
  `availability_target` `100` and `89.999` → `422`; `99.999` → `99.999`; `1e2` → `422`. Domain
  `interval_ms` `3599999` → `422`. Heartbeat `grace_ms` empty → `0`. Id `my check` and `a/b` →
  `422` on create. `keyword` empty → absent. A HEAD check with a JSON assertion → `422`.
- **Write-only intents.** Stored literal `X-Api-Key` and body: an edit that changes only the
  name sends `{"X-Api-Key":{"keep":true}}` and `"body":{"keep":true}`; `replace` with an empty
  value → `422`, nothing sent; a typed value with `keep` → `422`; `remove` drops only that
  entry. A heartbeat edit without `replace` sends no `secret`.
- **Header name.** A create or edit POST with a free header row named `__proto__` and value `x`
  answers `422` with `__proto__ is not an allowed header name.` at that row, and the fake api
  records no `POST` or `PUT` (literal empty write list). A wrong implementation using
  `obj[name] = value` drops the row silently and saves the check without it (`303`, one write);
  one that builds the own key but skips the field check sends it and gets the api's `422`. A row
  named `__Proto__` or `X-Proto` is an ordinary header and is sent as an own key.
- **Revision.** Two Members open the edit page of `web` at revision R1; the first save makes R2;
  the second POST carries R1 and gets `409` stale (Console-detected) or `412` (api), never an
  overwrite. A create opened at R1 and sent after R2 uses R2 and succeeds.
- **Shadowing during edit.** The file gains id `web` after the edit page opened, so the fake
  api's `/admin/config` lists `web` in `checks` with source `file` and in `shadowed`: the POST
  of an Admin answers `409` with `Shadowed by checks.json: only Delete and Export are possible.` and the
  links `/checks/delete?id=web` and `/checks/export?id=web&shadowed=1`, and the fake api records
  no PUT. A wrong implementation that tests the file source first answers the file page `This
  check comes from checks.json. Edit the file to change it.` instead. The same holds for
  `GET /checks/edit?id=web`.
- **Duplicate header names.** Edit of `web` with a stored literal `X-Api-Key` (row 0, intent
  `keep`) and a free row 1 `X-Api-Key`, kind `plain`, value `new`: `422` with `This header is
  already set in another row (names are compared without case).` on `header_1_name`, and the
  fake api records no `PUT`. A wrong implementation that builds the object first sends
  `{"X-Api-Key":"new"}`, replacing the stored value without `Replace`. The same with the free
  row named `x-api-key` → the same `422` and no `PUT` (a wrong implementation leaves it to the
  contract or the api, whose `422` names no row). Create with free rows `Accept` and `ACCEPT` →
  `422` on `header_1_name`, no `POST`. Row 0 with intent `remove` and the free row
  `X-Api-Key` = env `PULSE_HEADER_KEY` → one `PUT` whose headers are exactly
  `{"X-Api-Key":{"env":"PULSE_HEADER_KEY"}}`.
- **Delete.** Typed `checkout api` for the name `Checkout API` → `422`, no request. A database
  check stored with the name `" Checkout API "` (leading and trailing space; pulse-api accepts
  it) and typed `Checkout API` → `303` to `/checks?deleted=1` and exactly one
  `DELETE /admin/checks/<id>`; typed ` Checkout API ` → the same; typed `Checkout  API` (two
  spaces) → `422` with `The name does not match. Type Checkout API exactly.`, no `DELETE`. A
  wrong implementation that keeps today's helper answers `422` to every input, so the check can
  never be deleted. Delete of a
  shadowed `web` sends one `DELETE /admin/checks/web`; afterwards `/checks/check?id=web` still
  shows the file check with its results.
- **Roles.** A Viewer `GET /checks/new`, `GET /checks/export` and `POST /checks/delete` → `403`;
  a Member `GET /checks/delete?id=web` → `403`; an Admin passes; a forged `target=database` on a
  shadowed delete is decided by the server read.
- **Unknown outcome.** The fake api holds the PUT answer past 5000 ms: `504`, one People-log row
  with `value` `unknown`, and the fake api saw exactly one PUT (no retry).
- **Outcome classes.** Each case is one fake-api answer to one PUT, with the expected Console
  status and People-log rows written out in the test:
  - `200` with the wire header, `ETag: "sha256-` + 64 × `a` + `"`, and a body of
    `DEFAULT_MAX_BODY_BYTES + 1` bytes → `303`, one row with `value` `sha256-aaa…a` (64 `a`). A
    wrong implementation that maps `too-large` to "invalid answer, not saved" shows an error and
    writes no row.
  - `201` with the wire header and body `not json` → `303`, one row.
  - `200` with the wire header and `ETag: W/"x"` → `303`, one row with `value` `unknown`.
  - `302` with the wire header and `location: /admin/checks/web` → `502` redirect text, one
    `unknown` row, exactly one request (the redirect is not followed).
  - `502` without the wire header (proxy page) → `502` "did not come from a matching pulse-api",
    one `unknown` row. A wrong implementation that reads it as a refusal writes no row.
  - `502` with the wire header → `502` `pulse-api could not save the change (502)`, no row.
  - `200` with `x-pulse-contract: 2` (wire header name `contract/src/version.ts:8`, wire version
    `1`) → `502` unknown text, one `unknown` row.
  - `428` with the wire header and `{"error":"If-Match is required"}` → `502`
    `pulse-api refused the request (428): If-Match is required Nothing was changed.`, no row.
  - `422` with the wire header and an error body of 6 MiB → `422` form with
    `pulse-api gave no reason.` (the body is over the cap, so no `message`), no row.
- **Edit uses the trusted entry.** The page showed `web` at revision R1 with a stored literal
  header `X-Api-Key` at row 0. The POST carries R1, `header_0_name=X-Evil`, `header_0_intent=keep`
  and `type=tcp`: the PUT body has `"X-Api-Key":{"keep":true}`, no `X-Evil`, and the HTTP type
  of the stored entry. The same POST with R0 (stale) answers `409` stale with no form and no
  PUT; it never answers `422` for a field that only the old view had. A wrong implementation
  that validates before the read answers `422` "Choose Replace…" for a header that no longer
  exists.
- **Delete uses the trusted name.** The page showed `Checkout API` at R1; the file reload changes
  nothing of `web` but makes R2. POST with R1 and the right typed name → `409` stale, no
  `DELETE`. To prove the name comes from the read and not from the page, the fake api answers
  the POST-time read with the name `Shop API` and the unchanged revision R1: typed
  `Checkout API` → `422`, re-rendered asking for `Shop API`, no `DELETE`.
- **Expired and replayed tokens.** An edit POST with an expired form token answers `409` with
  `This form has expired. Nothing was sent.` and a link whose `href` is exactly
  `/checks/edit?id=a%2Fb` for the id `a/b`; the fake api records no request at all. A replayed
  token answers `409` `Already submitted` with `Open the page again` linking to
  `/checks/edit?id=a%2Fb`, not `/checks/edit`.
- **Ids `.` and `..`.** `apiIdSegment(".")` and `apiIdSegment("..")` are `undefined`;
  `apiIdSegment("...")` is `...`; `apiIdSegment("a/b")` is `a%2Fb`; `apiIdSegment("%2e")` is
  `%252e`; `apiIdSegment(".x")` is `.x`. With a database check `..` in the fixture: the detail
  page answers `200`, the fake api records `GET /admin/config`, `GET /checks` and `GET /uptime`
  and no other path (a wrong implementation requests `/results` or `/location-uptime`, the paths
  the URL parser makes of `/checks/../results` and `/checks/../location-uptime`); `POST
  /checks/delete?id=..` with a valid revision and typed name answers `409` and the fake api
  records no `DELETE` (a wrong implementation sends `DELETE /admin/`). A heartbeat check `.`
  shows no curl line. On the api, with a fixture check `.` that has results, a request sent
  with `node:http` `request` and the literal path `/checks/%2E/location-uptime` (so the client
  does not normalize it) answers `404` `{"error":"not found"}`: the api parses it as
  `/checks/location-uptime`, which is no read path (`api/src/server.ts:654`), and never answers
  the tallies of `.`. The same raw `GET /checks/../results` is parsed as `/results` and answers
  `405`, which is why the Console must never build such a path.
- **Shell lines (Decision 12).** Expected values are the literals below; they were checked by
  running them in `/bin/sh` (dash), an independent source, not by the helper under test.
  - HTTP check `https://a';id;'b/` with env header `PULSE_HEADER_TOKEN`: the host is
    `a';id;'b` and the line is exactly
    `PULSE_PROBE_HEADER_HOSTS='{"PULSE_HEADER_TOKEN":["a'\'';id;'\''b"]}'`. A wrong
    implementation that fills the old template prints
    `PULSE_PROBE_HEADER_HOSTS='{"PULSE_HEADER_TOKEN":["a';id;'b"]}'`, which runs `id` when
    pasted.
  - Two env headers `PULSE_HEADER_A` on `https://a$(id)b"c/` and `PULSE_HEADER_B` on
    `https://api.example.com/`: exactly
    `PULSE_PROBE_HEADER_HOSTS='{"PULSE_HEADER_A":["a$(id)b\"c"],"PULSE_HEADER_B":["api.example.com"]}'`.
    A wrong implementation that uses double quotes runs `$(id)`; one that builds the JSON by
    string concatenation leaves `"` unescaped and gives invalid JSON.
  - `shellQuote("")` is `''`; `shellQuote("plain")` is `'plain'` (always quoted);
    `shellQuote("'")` is `''\'''`.
  - Heartbeat with URL `http://localhost:3000/heartbeat/nightly-backup`: exactly
    `curl -fsS -X POST -H 'Authorization: Bearer <secret>' 'http://localhost:3000/heartbeat/nightly-backup'`.
    With URL `https://a';id;'b/heartbeat/x`: exactly
    `curl -fsS -X POST -H 'Authorization: Bearer <secret>' 'https://a'\'';id;'\''b/heartbeat/x'`.
    A wrong implementation leaves the URL unquoted or double-quoted.
  - Round trip: `/bin/sh -c "<line>; printf %s \"$PULSE_PROBE_HEADER_HOSTS\""` prints exactly
    `{"PULSE_HEADER_TOKEN":["a';id;'b"]}` for the first line (nothing else on stdout, so `id`
    did not run), and `set -- <heartbeat line without curl>` yields the six words
    `-fsS`, `-X`, `POST`, `-H`, `Authorization: Bearer <secret>`,
    `https://a';id;'b/heartbeat/x`.
- **Filters.** `?type=http&type=tcp` → filter ignored with the notice; `?state=shadowed` →
  ignored; `?source=shadowed&state=up` → no rows (state never matches a shadowed row).

## Contract fields

New names and the searches that show no collision (run from the meta checkout; each printed
nothing at the heads above):

| Name | Kind | Search |
| --- | --- | --- |
| `/checks/:id/location-uptime` | api route | `grep -rn 'location-uptime' .repos/contract/src .repos/config .repos/api/src` |
| `locationUptimeSchema`, `checkLocationUptimeSchema`, `LocationUptime`, `CheckLocationUptime` | contract schema and types | `grep -rn 'ocationUptime' .repos/contract/src .repos/config` |
| `validateCheckLocationUptime` | contract validator | `grep -rn 'validateCheckLocationUptime' .repos/contract/src .repos/config` |
| `requestJson`, `RequestJsonOptions`, `RequestJsonResult`, `RequestJsonResponse` | contract client | `grep -rn 'equestJson' .repos/contract/src .repos/config` |
| `response` (field of the failed `RequestJsonResult`) | field | `grep -n 'response' .repos/contract/src/client.ts` (only local variables named `response`, no exported field) |
| `good` (field of `LocationUptime`) | field | `grep -n 'good' .repos/contract/src/schema.ts` |
| `uptime_location_daily` | api table | `grep -rn 'uptime_location_daily' .repos/api/src` |

Reused names with the same meaning, not new: `location`, `results`, `uptime`, `checkId` (as in
`uptimeDaySchema` and `checkUptimeSchema`), `windowDays` (in `sloSchema` it is the literal 30;
here the literal 90, a separate schema, `grep -n windowDays .repos/contract/src/schema.ts` shows
only `:598`), `message` (an optional field added to the `http` variant of `FetchJsonError`;
other variants already have their own `message`, `.repos/contract/src/client.ts:16-18`).

Console-only names (not contract): routes `/checks`, `/checks/check`, `/checks/shadowed`,
`/checks/new`, `/checks/edit`, `/checks/delete`, `/checks/export`
(`grep -rn '"/checks' .repos/console/src` finds only the navigation path, `navigation.ts:26`);
`ProtectedRoute.maxFormBytes`, `ProtectedRoute.reopenHrefOf`, `PageResult` kind `download`,
`MAX_CHECK_FORM_BYTES`, `apiIdSegment`
(`grep -rn 'maxFormBytes\|reopenHrefOf\|"download"\|MAX_CHECK_FORM_BYTES\|apiIdSegment' .repos/console/src`
prints nothing); `shellQuote`, `hostBindingLine`, `heartbeatLine` and the module
`src/shell-line.ts`
(`grep -rn 'shellQuote\|hostBindingLine\|heartbeatLine\|shell-line' .repos/console/src .repos/console/e2e .repos/contract/src .repos/kit/src .repos/config`
prints nothing);
People-log actions `check.create`, `check.replace`, `check.delete` and target kind `check`
(`check.delete` is also a permission action id in `permissions.ts:43`; the two live in separate
types, `PeopleAction` and `Action`, and both name the same deed). Form field names are listed in
R4.

## Repository: contract

Files:
- `src/schema.ts` (`locationUptimeSchema`, `checkLocationUptimeSchema`, types)
- `src/validate.ts` (`validateCheckLocationUptime`)
- `src/client.ts` (`requestJson`, `RequestJsonOptions`, `RequestJsonResult`, optional
  `message` on the `http` error)
- `src/index.ts` (exports)
- `test/location-uptime.test.ts` (new)
- `test/request-json.test.ts` (new)
- `test/types.fixture.ts`
- `test/smoke.test.ts` (the literal runtime export list of "package entry exports the
  validators and the wire version", `test/smoke.test.ts:51-188`)
- `dist/` (rebuilt and committed)
- `package.json` (`version` 2.2.0)
- `README.md`, `docs/index.md`

Behavior change: yes
New exported schema, validator and write client.

Behavior:

- `locationUptimeSchema`: `z.object` with `location` (non-empty string), `good` and `results`
  (integers `>= 0`), `uptime` (`null` or number 0 to 100, unrounded). Refinements: `good <=
  results`; `uptime === null` exactly when `results === 0`.
- `checkLocationUptimeSchema`: `z.object` with `checkId` (non-empty), `windowDays`
  (`z.literal(90)`), `locations` (array of the above, names strictly ascending in UTF-16
  code-unit order, so also unique). JSDoc states Decision 1 (window, sample set, `good`).
- `validateCheckLocationUptime(value, path = "uptime")` like the other validators: never throws,
  returns the same object.
- `requestJson<T>(url, options)`: `options` = `fetch`, `method` (`"POST" | "PUT" | "DELETE"`),
  optional `body` (string, sent with `content-type: application/json`), `headers`,
  `timeoutMs`, `signal`, `maxBytes` (default `DEFAULT_MAX_BODY_BYTES`), `schedule`, `validate`.
  It always passes `redirect: "manual"`, never retries, and shares the timeout, abort, size cap
  and wire handling of `fetchJson`. Order: HTTP status, wire header, size, JSON, validation.
  Result: `{ ok: true, status, value, etag, wire }` (`value` is `undefined` for a `204` or an
  empty body; `etag` is the raw `etag` header or `null`; `wire` `"ok" | "absent"`) or
  `{ ok: false, error, response }` with the existing `FetchJsonError` and
  `response: RequestJsonResponse | null`, where `RequestJsonResponse` is
  `{ status: number; etag: string | null; wire: WireVersionCheck }`. `response` is set exactly
  when the response headers arrived: for `http`, `too-large`, `invalid-json`, `validation`,
  `wire-mismatch`, and for `timeout` or `aborted` during the body read; it is `null` for
  `timeout`, `aborted` and `network` before the headers. A non-`2xx` (including `1xx` and
  `3xx`) answer is `{ kind: "http", status, wire, message? }`; `message` is the `error` string
  of a JSON `ErrorResponse` body, cut to `MAX_REASON_LENGTH` (1000) characters, when that body
  fits `maxBytes`; an error body that is over `maxBytes`, not JSON or of another shape gives no
  `message` and still the `http` error, never `too-large`. A `2xx` with a wire mismatch is
  `wire-mismatch`; a `2xx` whose body is over `maxBytes` is `too-large` with `response.status`
  the `2xx`. `requestJson` never classifies an outcome as saved or not: that is the caller's
  rule (console Decision 10).
- `fetchJson` is unchanged (its `http` error never has `message`).
- Runtime exports of `src/index.ts`: exactly two new values, `requestJson` and
  `validateCheckLocationUptime`. The schemas `locationUptimeSchema` and
  `checkLocationUptimeSchema` stay module-internal, like `checkUptimeSchema` today (it is not
  in the runtime export list, `test/smoke.test.ts:51-188`, while `validateCheckUptime` is).
  The types `CheckLocationUptime`, `LocationUptime`, `RequestJsonOptions`, `RequestJsonResult`
  and `RequestJsonResponse` are type-only exports, which `Object.keys(mod)` does not list.

Checks:

- `test/smoke.test.ts`: the expected array of "package entry exports the validators and the
  wire version" gains exactly the two string literals `"requestJson"` and
  `"validateCheckLocationUptime"` and nothing else; no entry is removed. The test sorts both
  sides, so the position in the array does not matter. Without this edit the test fails as
  soon as the two exports exist, and with a schema exported by mistake it fails too. The
  `dist` freshness test of the same file needs no new module name: no new source module is
  added (`client.ts`, `schema.ts`, `validate.ts` and `index.ts` already exist).

- `test/location-uptime.test.ts`: accepts the Counterexamples' `eu`/`us` example; rejects
  duplicate and unsorted names, `uptime 50` with `results 0`, `uptime null` with `results 3`,
  `good 4` with `results 3`, `windowDays 30`, negative and fractional counts.
- `test/request-json.test.ts` with a hand-written fake `fetch` and fake `schedule`: method, body,
  content type and `redirect: "manual"` are passed; `201` with a valid body; `204` without one;
  `412` with `{"error":"the configuration changed: reload it and retry"}` gives that `message`;
  `500` with a non-JSON body gives no `message`; `302` with a `location` header is an `http`
  error with `status 302` and `response.status 302`, and the fake saw `redirect: "manual"`;
  timeout before the headers (`response` `null`), timeout during the body after a `201`
  (`response.status 201`), caller abort, network error (`response` `null`); a `200` with
  `etag: "sha256-…"` and a body of `maxBytes + 1` bytes is `too-large` with
  `response { status: 200, etag: "\"sha256-…\"", wire: { status: "ok" } }` (literal in the
  test); a `422` with an `ErrorResponse` body of `maxBytes + 1` bytes is `http` `422` without
  `message`; a `2xx` with wire `2` is `wire-mismatch` with `response.status`; missing wire
  header on a `201` is `ok` with `wire "absent"`; the fake is called exactly once in every
  case.
- `test/types.fixture.ts` uses `CheckLocationUptime`, `LocationUptime`, `RequestJsonOptions`,
  `RequestJsonResult`, `RequestJsonResponse`.
- Docs (`README.md`, `docs/index.md`): `requestJson`, its result and `response`, and the note
  that a `2xx` status with a body error means the server answered `2xx`.

Tool facts: `bun run check` is `bun run lint && bun run build && bun run typecheck && bun run
test` (`package.json:28`); tests use `bun test` with 80 % line coverage (`bunfig.toml:2-3`);
Biome `2.6.3` (`package.json:31`) extends `@lorenzh/pulse-config/biome.json` (`biome.json:2`) at
the pin `51e95b0` (`package.json:32`); CI runs `check.yml@51e95b0` with `build: true`
(`.github/workflows/ci.yml:17-19`), which runs lint, typecheck, build, `git diff --exit-code --
dist` and test (pinned `check.yml:27-38`). The pinned `check.yml` and `biome.json` at `51e95b0`
are identical to the config clone.

Completion evidence: `bun run check` output; `git diff --exit-code -- dist` after `bun run
build`; the new tests fail on `9ab7e24` (missing exports) and pass after.

## Repository: api

Files:
- `src/db.ts` (`uptime_location_daily`, `CREATE TABLE IF NOT EXISTS`)
- `src/service.ts` (location tallies: ingest upsert, read, fill, delete; `Service` methods)
- `src/uptime-rollup.ts` (backfill of location days)
- `src/retention.ts`, `src/start.ts` (delete expired and orphan location tallies)
- `src/server.ts` (route, metric route label)
- `src/location-uptime.test.ts` (new), `src/server.location-uptime.test.ts` (new),
  `src/uptime-rollup.test.ts`, `src/retention.test.ts`, `src/db.test.ts`,
  `src/server.allow.test.ts` (405 cases of the new path)
- `package.json`, `bun.lock` (contract pin to the merged contract SHA)
- `README.md`, `docs/rest-api.md`, `docs/concepts.md`, `docs/operation.md`

Behavior change: yes
A new public read route and a new stored tally.

Behavior:

- `GET /checks/:id/location-uptime` per Decisions 1 and 2, typed by `CheckLocationUptime`.
  Only `GET` is served: `HEAD`, `POST` and every other method answer `405` with `Allow: GET`,
  exactly like the other reads (`src/server.ts:654-655`; `src/server.allow.test.ts:78-93` pins
  it, `HEAD /checks` at `:93`). The body is `{"error":"method not allowed"}`, empty for `HEAD`
  (`server.allow.test.ts:67-68`). This
  follows from adding the path to `isReadPath` (`server.ts:607-609`); no `HEAD` handler is
  added. Errors `400` `bad check id`, `404` `unknown check`. Read cache
  and its clearing as `/checks/:id/latency` (`docs/rest-api.md:210-212`). Metric route label
  `/checks/:id/location-uptime` (`routeOf`, `src/server.ts:222-244`).
- Table `uptime_location_daily` per Decision 2, in `src/db.ts` with a comment like
  `latency_daily` (`db.ts:74-82`). Closed days: one indexed read of stored rows for
  `[today - 89, today)`, a per-day sum compared with `uptime_daily`, and a per-day
  recompute from `results` (`GROUP BY location`) in one transaction for each incomplete day,
  after `uptimeOf`'s own fill so `uptime_daily` is complete first. Today: one query
  `timestamp >= today * DAY_MS AND timestamp <= now` grouped by location. Locations: the loose
  index scan `locationsOf` (`service.ts:548-555`).
- `storeSample` (`service.ts:420-455`): when `bumpUptimeDay` changed a row, upsert
  `(check_id, day, location)` with `good + (status != down)`, `total + 1`.
- Backfill: after the uptime days of a run, fill incomplete location days, one (check, day) per
  batch with `await sleep(0)` after each, stopping when the runner stops
  (`uptime-rollup.ts:40-54`). The done log line counts location days too.
- Retention: delete location rows with `day < dayOf(cutoff)` and rows of check ids not in
  `checks`, next to `deleteUptimeRollups` (`retention.ts:52-54`, `start.ts:377-378`).
- Docs: `docs/rest-api.md` section `GET /checks/:id/location-uptime` with the window, sample
  set, `good`, null rule, location set, errors (including `405` with `Allow: GET` for any other
  method, `HEAD` too) and an example; the routes table
  (`rest-api.md:15`) and the cache list (`:212`); `docs/concepts.md` per-location uptime next
  to the aggregate; `docs/operation.md` the table (created on open, rebuilt from results, safe
  to restore without it, safe downgrade); `README.md` endpoint list.

Checks (`src/location-uptime.test.ts` on a `mkdtemp` database with an injected `now`, and
`src/server.location-uptime.test.ts` on the real server at `127.0.0.1:0`):

- Two locations `eu` and `us` with known histories over more than 100 rows (more than one
  results page): exact `good`, `results`, `uptime` per location; the window boundaries of the
  Counterexamples; a location with only older rows (`results 0`, `uptime null`); degraded
  counts as good; a heartbeat check lists `heartbeat`.
- Sum invariant against `/uptime` for the same fixture; existing `/uptime` and SLO answers are
  unchanged (existing tests keep passing).
- A late result for a filled closed day changes that location's numbers on the next read
  (after the cache TTL or clear); a day whose location rows were deleted by hand is recomputed;
  the backfill fills location days and `fillAllUptimeDays` stops when asked.
- Retention removes location rows before the cutoff day and of deleted check ids.
- HTTP: `200` typed with `validateCheckLocationUptime`; `404` unknown and inactive; `400` bad
  escape; a Bearer header is not required and not authenticated; metric label.
- Methods: `src/server.allow.test.ts` adds `/checks/a/location-uptime` to the `POST` list of
  "the read routes answer 405 with Allow: GET" and adds `expect405("HEAD",
  "/checks/a/location-uptime", "GET")`; the expected values are the literals of that helper:
  status `405`, `allow` `GET`, body `{"error":"method not allowed"}` or empty for `HEAD`. The
  method check runs before the id lookup, so the id `a` need not exist. A `HEAD` answering
  `200` is a defect. Both cases fail on `fb6f1a5`, where the path is no read path and answers
  `404`.
- Dot ids (Counterexamples, "Ids `.` and `..`"): with a fixture check `.` that has results, the
  raw `node:http` request to `/checks/%2E/location-uptime` answers `404`
  `{"error":"not found"}`. This pins current routing; no code is added for it. `docs/rest-api.md`
  states that per-id routes cannot address the ids `.` and `..`.
- These tests fail on `fb6f1a5` (route `404`, table missing) and pass after, except the dot-id
  test, which pins behavior that already holds.

Tool facts: `bun run check` is `bun run lint && bun run typecheck && bun run test`
(`package.json:20`); `bun test` with 80 % line coverage (`bunfig.toml:2-3`); Biome `2.6.3`
(`package.json:23`) extends `@lorenzh/pulse-config/biome.json` (`biome.json:2`) at the pin
`04108fa` (`package.json:24`); CI runs `check.yml@04108fa` (`.github/workflows/ci.yml:18`), which
runs install, lint, typecheck and test (pinned `check.yml:25-38`, build steps off). The pinned
files are identical to the config clone.

Completion evidence: `bun run check` output; the measurements of Performance impact; one manual
run: `bun start` with a temp `PULSE_DB` and `checks.json`, two `POST /results` from two probe
tokens, `curl localhost:3000/checks/<id>/location-uptime`, with the output in the PR.

## Repository: console

Files:
- `src/check-routes.ts` (new: the seven protected routes and their commit orders)
- `src/check-read.ts` (new: list and detail reads, export read, validators, old-api state)
- `src/check-write.ts` (new: `requestJson` writes, guard recheck, answer mapping, People-log row)
- `src/check-form.ts` (new: form fields to `AdminCheckInput` per type, field rules, intents)
- `src/check-editor-page.ts` (new: editor HTML per type, header and assertion rows, host-binding
  line)
- `src/check-pages.ts` (new: list, detail, shadowed, confirmation and export pages)
- `src/check-filters.ts` (new: filter parsing and matching)
- `src/check-export.ts` (new: single and shadowed export documents)
- `src/check-format.ts` (new: `formatPercent`, budget text, UTC time, target text)
- `src/check-outcome.ts` (new: Decision 10 classes from a `RequestJsonResult`)
- `src/api-path.ts` (new: `apiIdSegment`, Decision 14)
- `src/server.ts` (register `checkRoutes`, `pathLabel`, download answer, route form limit,
  `reopenHrefOf` for the replayed-token link)
- `src/protected-route.ts` (`maxFormBytes`, `reopenHrefOf`, `PageResult` kind `download`)
- `src/http-context.ts` (`readPostForm`/`readFormFields` take the byte limit)
- `src/forms.ts` (`MAX_CHECK_FORM_BYTES = 524288`)
- `src/navigation.ts` (Checks available)
- `src/api-failure.ts` (`ApiCall` gains `uptime`, `results`, `latency`, `location-uptime`,
  `export`, `write`; texts of R8)
- `src/people-log.ts` (actions `check.create`, `check.replace`, `check.delete`; target
  `{ kind: "check"; id: string }`)
- `src/metrics.ts` (path labels of the new routes)
- `src/styles.ts` (tables with their own horizontal scroll, filter bar, editor rows)
- `src/console-script.ts` (copy buttons, Decision 12)
- `src/shell-line.ts` (new: `shellQuote`, `hostBindingLine`, `heartbeatLine`, Decision 12)
- `src/confirm.ts` (`isTypedNameConfirmed` trims the expected name too; the mismatch text names
  the trimmed name, R6 step 5), `src/confirm.test.ts`
- `src/check-form.test.ts`, `src/check-filters.test.ts`, `src/check-export.test.ts`,
  `src/check-format.test.ts`, `src/check-outcome.test.ts`, `src/api-path.test.ts`,
  `src/shell-line.test.ts`,
  `src/server.checks.test.ts`, `src/server.checks-write.test.ts` (new);
  `src/server.form-token.test.ts`, `src/navigation.test.ts`, `src/people-log.test.ts`, `src/forms.test.ts`,
  `src/server.security.test.ts`
- `test/fake-api.ts` (replies per method and path with own status, headers (wire header present,
  absent or another value; `etag`; `location`), body bytes and a gate to hold the answer;
  records method, raw path, query, headers and body in order),
  `test/check-fixtures.ts` (new: config with all six types, file and database sources, a
  shadowed duplicate, all five states, results, uptime, latency, location uptime; the heartbeat
  check is `nightly-backup`; one HTTP check uses `https://a';id;'b/` with the env header
  `PULSE_HEADER_TOKEN`)
- `e2e/run.ts`
- `package.json`, `bun.lock` (contract pin to the merged contract SHA)
- `README.md`, `docs/configuration.md`, `docs/checks.md` (new), `docs/team.md`, `docs/index.md`,
  `docs/development.md` (the `confirm.ts` line, `docs/development.md:26`: both names trimmed),
  `AGENTS.md`

Behavior change: yes
New screens, api writes and People-log rows.

Every task cut from this section carries `behaviorChange: true`, the final browser, stack and
docs task included: it changes `e2e/run.ts` and ships the Checks navigation and pages as
documented behavior, so none of its tasks is a pure test or docs change.

Behavior: R1 to R9 and Decisions 4 to 14. Notes for the implementer:

- Edit and delete POST handlers follow the numbered commit orders of R5 and R6 exactly: the
  `/admin/config` read is step 2, before any field or typed-name check, and those checks take
  their context only from the entry of that read after its revision matched (Decision 8).
- `checkOutcome(result)` in `src/check-outcome.ts` is a pure function from a
  `RequestJsonResult` to `{ class: "saved"; revision: string | null } | { class: "refused";
  status: number; message?: string } | { class: "unknown"; status: number | null; isRedirect:
  boolean }`, following the R8 rows top to bottom; `check-write.ts` maps the class to the page
  and the People-log row. Every per-id api URL is built from `apiIdSegment`; a direct
  `encodeURIComponent` of an id in an api URL elsewhere is a review defect.
- `reopenHrefOf` (Decision 13): `isProtectedTokenAccepted` (`server.ts:941-966`) uses
  `route.reopenHrefOf?.(request)` before the `ctx.path` fallback at `:953`. Existing routes do not
  set it, so their links stay as they are.

- Routes are `ProtectedRoute`s from `checkRoutes(deps)`, added in `protectedRoutesOf`
  (`server.ts:1105-1107`), like `teamRoutes`. `knownFields` lists every editor field name of R4
  (all types, 20 header rows, 10 assertion rows); the handler reads only those of the type.
- `ProtectedRoute.maxFormBytes` defaults to `MAX_FORM_BYTES`; `handleProtected` passes it to
  `readPostForm` (`server.ts:993-998`). Only `/checks/new` and `/checks/edit` set
  `MAX_CHECK_FORM_BYTES`.
- `PageResult` `download` (`filename`, `body`) answers `200` with the R7 headers and the security
  headers; `HEAD` sends no body.
- Reads reuse the Overview pattern (`overview-read.ts:35-83`): manual redirect, wire header,
  5000 ms, one `warn` per failed read. Public reads send no `authorization` header.
- The guard recheck uses `isCredentialGuardHeld` (`factor-store.ts:17-29`) and the stored user
  row with `roleOf` when set (`server.ts:328-330`).
- People-log rows: `target_kind` `check`, `target_id` `NULL`, `target_name` the check id,
  `value` the revision or `unknown`.
- Docs: `docs/checks.md` (screens, sources and shadowing, write-only fields and intents, CRLF
  bodies, host-binding line and heartbeat usage (both single-quoted for a POSIX shell), export
  redaction, one row per header name (compared without case), the typed delete name (outer
  spaces ignored), fixed quorum rule as the editor states it, old-api
  states, the three write outcome classes and the proxy limit of Risks, ids `.` and `..`, and
  that an expired edit or delete form keeps no input); `README.md` endpoint rows and "What works now"; `docs/configuration.md` routes,
  the editor form limit in the POST order, log lines, metric path labels; `docs/team.md`
  People-log actions; `docs/index.md` link; `AGENTS.md` end-to-end test list and the check
  modules under "This repository".

Checks:

- `src/check-form.test.ts`, parameterised over the six types: valid input builds the exact
  `AdminCheckInput` (literal expected objects in the test); each field rule and counterexample
  of the Counterexamples section; wrong-type fields are not in the output; intents keep,
  replace, remove for headers and body; heartbeat secret rules; a `__proto__` header row is a
  field error with the literal message `__proto__ is not an allowed header name.` and no
  built input, while `__Proto__` and `X-Proto` build own keys; the "Duplicate header names"
  counterexample with the literal message on the literal field name (`header_1_name`) and no
  built input, for an exact-case and a different-case duplicate of a kept stored row and for
  two free rows, plus the `remove` case with its literal expected `headers` object.
- `src/confirm.test.ts`: the existing rows keep their expected values, and new rows
  `["Checkout API", " Checkout API ", true]`, `[" Checkout API ", " Checkout API ", true]`,
  `["Checkout  API", " Checkout API ", false]`, `["checkout api", " Checkout API ", false]`;
  `typedNameError("x", " Checkout API ")` is exactly
  `The name does not match. Type Checkout API exactly.` The first new row fails on `76dab43`.
- `src/check-filters.test.ts`, `src/check-format.test.ts`, `src/check-export.test.ts`:
  Counterexamples for filters, `formatPercent`, budget sign, single and shadowed export (literal
  expected documents written in the test).
- `src/check-outcome.test.ts`: one case per R8 row and per "Outcome classes" counterexample,
  with literal `RequestJsonResult` inputs and literal expected classes; row order (a `302`
  without wire header is a redirect, not a wire case).
- `src/api-path.test.ts`: the `apiIdSegment` literals of the "Ids `.` and `..`"
  counterexample.
- `src/shell-line.test.ts`: every literal of the "Shell lines" counterexample, written out in
  the test (apostrophe, `$(...)`, `"`, empty and plain values, both heartbeat URLs). Plus the
  round trip: `Bun.spawnSync(["/bin/sh", "-c", line + "\nprintf %s \"$PULSE_PROBE_HEADER_HOSTS\""])`
  prints exactly the literal JSON `{"PULSE_HEADER_TOKEN":["a';id;'b"]}`, and `set --` over the
  heartbeat arguments prints the six literal words, one per `printf '[%s]'`. The shell is
  the independent source; the test never compares the helper with itself. CI runs the tests
  on `ubuntu-24.04` (pinned `check.yml:16` at `04108fa`, verified with `gh api`), which has
  `/bin/sh`.
- `src/server.checks.test.ts` (real server on port 0, fake api with `test/check-fixtures.ts`):
  list with all six types, five states, both sources and a shadowed duplicate; counts `6 checks`
  and `1 shadowed definition` for the fixture; filters compose and round-trip; reset; empty
  installation; no match; file banners; detail with locations, stale, location uptime joined by
  name, aggregate uptime, HTTP latency only for HTTP (the fake api records no `/latency` call
  for the TLS fixture), SLO absent, null and negative; results paging with `before`; heartbeat
  usage text; an HTTP fixture check on `https://a';id;'b/` with env header `PULSE_HEADER_TOKEN`,
  whose detail and edit pages contain `escapeHtml` (from pulse-kit, not the code under test) of
  the literal line
  `PULSE_PROBE_HEADER_HOSTS='{"PULSE_HEADER_TOKEN":["a'\'';id;'\''b"]}'` and never the
  unescaped template form `["a';id;'b"]}'`; shadowed view without runtime data; `404` for unknown ids; old-api state; the
  location panel text for a `404` route; every failure state.
- `src/server.checks-write.test.ts` (stateful fake api): create and reopen each of the six types;
  edit preserving a stored literal header, an env header, a body and a heartbeat secret (the
  PUT body has keep markers and no `secret`), then replace and remove; `If-Match` values;
  stale `409` and api `412` show the kept non-secret input as text with no form and no
  write-only value; shadowing during edit (GET and POST answer `409` with the shadowed text and
  its Delete and Export links, never the file page, and the recorded request list has no PUT);
  a `__proto__` header row on create and on edit answers `422` and the recorded request list
  has no POST or PUT; the "Duplicate header names" counterexample over HTTP (each `422` case
  records no POST or PUT; the `remove` case records one PUT with the literal headers object);
  delete of database and shadowed
  checks; typed-name mismatch sends nothing; the "Delete" counterexample for the stored name
  `" Checkout API "` (fixture check with that name; typed `Checkout API` → `303` and the
  recorded request list ends with exactly one `DELETE`, typed `Checkout  API` → `422` and no
  `DELETE`); export bodies and headers; the R8 table row by row
  through HTTP, including every "Outcome classes" counterexample with its literal Console status
  and People-log rows (`200` with an oversized body, `302`, `502` with and without the wire
  header, `200` with wire `2`, `428`, `422` with an oversized error body); the "Edit uses the
  trusted entry" and "Delete uses the trusted name" counterexamples, asserting the recorded
  request list of the fake api (method and path, in order) as a literal; a failed POST-time
  `/admin/config` read on edit and delete answers the failure state and records no write; the
  "Expired and replayed tokens" counterexample with the literal `href`; the "Ids `.` and `..`"
  counterexample with the literal recorded path list; unknown outcome writes one `unknown` row
  and one request; session ended and role lowered
  between page and POST (`409` `Not saved`, `403`, nothing sent); roles: one allowed and one
  denied test per route (Viewer, Member, Admin, with Owner inherited); missing CSRF, foreign
  Origin, replayed form token never reach the fake api; the 524,288 and 524,289-byte forms and
  the unchanged 8192 limit on `/team/invites`; leak scan in the pattern of
  `src/server.security.test.ts:395-417`: sentinels are the fixture's literal header value, body,
  secret, the Console token, the session CSRF value and every form token issued in the test.
  For every answer (pages, error pages of each failure and expiry path, redirects, downloads):
  first assert that each page holding a form contains the literal hidden controls
  `<input type="hidden" name="csrf" value="<csrf>">` and
  `<input type="hidden" name="form_token" value="<token>">`; then remove exactly those
  controls from the body, keep the response headers apart from the session's own `Set-Cookie`
  lines, and assert each sentinel occurs `0` times in what remains. Every log line and the
  `/metrics` text contain each sentinel `0` times. A test that asserts the CSRF value is absent
  from the whole page cannot pass (the shell's sign-out form holds it) and is the wrong
  implementation.
- `e2e/run.ts` with the fake api: create and edit of each of the six types through the forms,
  filtering, detail, export download, stale recovery and typed delete, with JavaScript enabled
  and disabled; axe `0` violations on list, detail, shadowed view, each editor, delete
  confirmation; keyboard focus through the editor; no CSP violation; list and detail fit 390 px
  (`assertFits`), the editor at 1280 px; the copy button copies the host-binding line with
  JavaScript and is absent without it. Quorum text (R4, #460 amendment section 20): the create
  and the edit form of each of HTTP, TLS, TCP, DNS and domain contain the literal paragraph
  `Every probe runs this check. It is down when at least two locations report down; with one
  reporting location, that location decides. Choosing locations or a quorum per check is not
  available yet.`, and the heartbeat create and edit forms contain the literal
  `Heartbeat checks are not run by probes and have no quorum; your job pings pulse-api. With no
  ping for longer than the period plus the grace time, the check is down at once.` and not the
  probe text; no editor has an input whose name contains `quorum` or `location`. The same
  texts are asserted in `src/server.checks.test.ts` for the editor GET pages, so the check also
  runs without a browser. For the `https://a';id;'b/` fixture the `<pre>`
  `textContent` and the text the copy button writes (read back from the clipboard, or from
  the stubbed `navigator.clipboard.writeText` argument if the headless browser has no
  clipboard) equal the literal
  `PULSE_PROBE_HEADER_HOSTS='{"PULSE_HEADER_TOKEN":["a'\'';id;'\''b"]}'`; the heartbeat copy
  text equals `curl -fsS -X POST -H 'Authorization: Bearer <secret>' '` + the fake api's base
  URL (test input) + `/heartbeat/nightly-backup'`.
- New screen tests fail on `76dab43` (routes `404`) and pass after.

Tool facts: `bun run check` is `bun run lint && bun run typecheck && bun run test`
(`package.json:18`); `lint` runs `biome check .`, `pulse-eslint .` and `pulse-workflows`
(`package.json:15`); `typecheck` also checks `e2e` (`package.json:13`); `check:browser` is
`bun e2e/run.ts` (`package.json:19`); `bun test` with 80 % line coverage (`bunfig.toml:2-3`);
Biome `2.6.3` (`package.json:23`) extends `@lorenzh/pulse-config/biome.json` (`biome.json:2`) at
the pin `04108fa` (`package.json:24`); CI runs `check.yml@04108fa` (`.github/workflows/ci.yml:18`;
pinned `check.yml:25-38`: install, lint, typecheck, test), the `browser` job with Bun 1.4.0 and
`bun run check:browser` (`ci.yml:270-287`), and `deploy-dev` with the two-factor flow
(`ci.yml:210-268`). The pinned files are identical to the config clone.

Completion evidence: `bun run check` and `bun run check:browser` output; one manual exercise:
a local pulse-api from its clone (`bun start` with a temp `PULSE_DB`, a `checks.json` with one
file check and an `admin-tokens.json`) and `PULSE_API_URL=http://localhost:3000 bun start` in
the console: create an HTTP check with a literal header and a body, reopen, edit the name,
confirm the api still holds the header and body (`GET /probe/checks` with a probe token),
add the same id to `checks.json` and see `Shadowed by checks.json`, export, delete the shadowed
definition, and check the api audit log and the People-log rows. Report commands and results in
the PR. The deploy `deploy-dev` job stays green.
