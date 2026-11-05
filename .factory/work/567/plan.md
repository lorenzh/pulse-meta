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
   when the body is one. Later Console items (tokens, maintenance, incidents) reuse it.
4. **Console routes use exact paths and a query id.** `GET /checks`, `GET /checks/check?id=`,
   `GET /checks/shadowed?id=`, `GET|POST /checks/new`, `GET|POST /checks/edit?id=`,
   `GET|POST /checks/delete?id=`, `GET /checks/export[?id=[&shadowed=1]]`. The `id` parameter
   must occur once and have 1 to 1024 UTF-16 code units, else the shell `404`. The id is compared
   with data from `GET /admin/config`; in an api path it is always `encodeURIComponent(id)`.
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
8. **Revision use.** Edit and delete send the revision that the page showed as `If-Match`. A
   create sends the revision of the read made just before it: a create cannot overwrite (an
   existing id is `409`). The Console never takes a fresh revision for an edit or delete.
9. **Form size.** `POST /checks/new` and `POST /checks/edit` accept a form body up to
   524,288 bytes (`MAX_CHECK_FORM_BYTES`); every other POST keeps 8192. 524,288 covers a
   65,536-byte body fully percent-encoded (196,608 bytes), 16 KiB of header names and literals
   percent-encoded (49,152), and the other fields with room. The built JSON must also be at most
   `ADMIN_MAX_BODY_BYTES` (1,048,576, `contract/src/admin.ts:23`) before it is sent.
10. **People log for check changes.** The action names are the api audit names `check.create`,
    `check.replace`, `check.delete`. A row is appended after pulse-api answered `2xx`, with
    target kind `check`, `target_name` the check id, and `value` the new revision from the
    `ETag`. A write whose answer did not arrive (timeout, network error after the request
    started, wire mismatch or an invalid `2xx` body) appends a row with `value` `unknown`. A
    definite refusal (`4xx`, `5xx`) appends nothing, as for team changes. The local row is not
    atomic with the remote write; if its insert fails after a `2xx`, the page says
    `Saved in pulse-api. The People log row could not be written.` and logs `error`
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
  Delete (Admin+, database source or shadowed). Hidden actions are presentation only (R9).
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
  for an HTTP check only `GET /checks/<id>/latency`. A failed round-2 read shows its state in its
  panel; the rest renders.
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
- Heartbeat usage: `<pre>` with `curl -fsS -X POST -H "Authorization: Bearer <secret>"
  <pulse-api URL>/heartbeat/<encodeURIComponent(id)>` and the note `Use the address under which
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
  `<details>` `More rows`. A row with an empty name and value is ignored. Header names keep their
  case and become own keys (`Object.fromEntries`), so `__proto__` stays a header. For each env
  header the form and detail show the line to add on every probe:
  `PULSE_PROBE_HEADER_HOSTS='{"<VAR>":["<host>"]}'` (all env headers of the check in one object,
  `<host>` is `new URL(url).hostname`), with `Merge this into the value that each probe already
  has, and set <VAR> in the probe environment.` and a copy button.
- JSON assertion rows: 10 indexed rows (`assert_<i>_pointer`, `assert_<i>_mode`
  `none`|`exists`|`equals`, `assert_<i>_equals` JSON text). A row is used when its mode is not
  `none`; `equals` must parse with `JSON.parse`, else `Enter a JSON value, for example "ok",
  200 or true.`
- Validation runs in the Console first with the contract (`validateAdminCheckInput`) plus the
  field rules above, and returns `422` with the form, an error summary and per-field messages.
  Only the fields of the chosen type are read; fields of other types in the POST are ignored and
  never sent.
- Commit order after the dispatcher (which already used the form token): field checks (`422`);
  JSON size (`422` `The check is larger than pulse-api accepts (1 MiB).`); read
  `GET /admin/config` (failure states, `502` page); id already in `checks` or `shadowed`
  (`409` form `A check with this id exists.`); session and stored-role recheck (R8); `POST
  /admin/checks` with `If-Match` of that read; People-log row; `303` to
  `/checks/check?id=<id>&saved=1`, whose page says `Check saved.`

### R5. Edit (`GET|POST /checks/edit?id=<id>`, Member+)

- `404` for an unknown id. A file check: `409` page `This check comes from checks.json. Edit the
  file to change it.` A shadowed id (in `shadowed`): `409` page `Shadowed by checks.json: only
  Delete and Export are possible.` with links. No form is rendered in both cases.
- The form is the R4 form of the stored type, filled from the view: env headers as name and
  variable; kept literal headers as fixed name, `set`, intent radio `Keep` / `Replace` /
  `Remove`; a kept body as `set` with the same radios and an empty textarea for `Replace`;
  heartbeat `Secret: set`, radio `Keep` / `Replace`. Hidden `revision` is the shown revision.
- Intent rules: `keep` sends `{ "keep": true }`; `remove` leaves the entry out; `replace` needs a
  non-empty new value (`Enter the new value, or choose Remove.`). A value typed while the intent
  is `keep` is refused (`Choose Replace to use the new value.`), so an empty or forgotten input
  never removes or overwrites a value. A kept body with a method of GET or HEAD is refused like
  any body (`A body needs POST, PUT, PATCH, DELETE or OPTIONS.`).
- Commit order: id format (`404`); field checks (`422`); JSON size; read `/admin/config`; target
  recheck (gone `404`, now a file check or shadowed `409` pages above); revision recheck (form
  revision differs from the read: `409` with `staleState`, the kept non-secret input, and the
  old revision kept in the form); session and role recheck (R8); `PUT /admin/checks/<encoded id>`
  with `If-Match` of the form; People-log row; `303` to `/checks/check?id=<id>&saved=1`.

### R6. Delete (`GET|POST /checks/delete?id=<id>`, Admin+)

- Typed confirmation (`typedConfirmPage`) of the check's `name`, with hidden `revision` and
  `target` (`database` or `shadowed`). Consequence text: database check: `The check stops
  running. Its results stay in pulse-api and its open incidents are resolved.`; shadowed:
  `Only the database definition is removed. The check from checks.json keeps running.` A file
  check: `409` page `This check comes from checks.json.`
- Commit order: id (`404`); typed name (`422`, nothing sent); read `/admin/config`; target
  recheck (gone `404`; file-only `409`; `target` no longer matches `409` stale); revision recheck
  (`409` stale); session and role recheck (R8); `DELETE` with `If-Match` of the form; People-log
  row; `303` to `/checks?deleted=1`, whose page says `Check deleted.` No id is echoed from the
  query.

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
- Answer mapping (form re-rendered with kept non-secret input where a form exists):

  | pulse-api answer | Console answer |
  | --- | --- |
  | `201`/`200`/`204` | `303` as in R4 to R6 |
  | `401` | `502` with the token-rejected banner |
  | `403` | `502` `The console token lacks the admin or checks scope. Saving checks needs both.` |
  | `404` | `404` `This check no longer exists.` |
  | `409` | `409` form with the api's message |
  | `412` | `412` `staleState` with the kept input |
  | `413`, `422` | `422` form with the api's message in the summary |
  | `429` | `503` `pulse-api is throttling the console. Try again in a minute.` |
  | other `4xx` (400, 428) | `502` `pulse-api refused the request (<status>). Nothing was changed.` |
  | `5xx` | `502` `pulse-api could not save the change (<status>). Nothing was changed.` |
  | timeout, network, wire mismatch or absent, invalid `2xx` body | `504` `The result is unknown` with `Open the check to see whether the change was saved.`; People-log row `unknown` |

- Logs: one `info` `check change` with `action`, `actorId`, `checkId` and `outcome` (`saved` or
  `unknown`); a failed read logs one `warn` `api read failed` with `call`, `kind` and
  `status`. No log line, error page, redirect or `/metrics` label holds a header value, body,
  secret, the Console token, a form token or a CSRF token.

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
  entry commits in the same transaction), so `5xx` is reported as not saved; only a lost answer
  is reported as unknown.
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
  lines or metrics; the export never contains keep markers.
- Auth order and status codes: dispatcher order unchanged; session and stored role are
  rechecked before each outbound write; Viewer/Member/Admin boundaries per route.
- Body and size limits: 524,288 bytes only on the two editor POSTs, 8192 elsewhere; built JSON at
  most 1 MiB; `requestJson` response cap (default 5 MiB); `fetchJson` caps unchanged.
- Input validation: every form field validated before use; contract validators on every api
  answer at the Console edge; query `id`, `before` and filter parameters validated.
- Accessor execution: header names become own keys via `Object.fromEntries`; `requestJson`
  parses JSON and reads only own data properties of the error body.
- SSRF and redirects: the Console calls only its saved pulse-api URL; ids are percent-encoded
  path segments; writes and reads never follow a redirect; the host-binding line is text, never
  fetched.
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
- **Header name.** A header named `__proto__` with value `x` is sent as an own key
  `{"__proto__":"x"}`; a wrong implementation using `obj[name] = value` drops it.
- **Revision.** Two Members open the edit page of `web` at revision R1; the first save makes R2;
  the second POST carries R1 and gets `409` stale (Console-detected) or `412` (api), never an
  overwrite. A create opened at R1 and sent after R2 uses R2 and succeeds.
- **Shadowing during edit.** The file gains id `web` after the edit page opened: the POST answers
  `409` `Shadowed by checks.json` and sends no PUT.
- **Delete.** Typed `checkout api` for the name `Checkout API` → `422`, no request. Delete of a
  shadowed `web` sends one `DELETE /admin/checks/web`; afterwards `/checks/check?id=web` still
  shows the file check with its results.
- **Roles.** A Viewer `GET /checks/new`, `GET /checks/export` and `POST /checks/delete` → `403`;
  a Member `GET /checks/delete?id=web` → `403`; an Admin passes; a forged `target=database` on a
  shadowed delete is decided by the server read.
- **Unknown outcome.** The fake api holds the PUT answer past 5000 ms: `504`, one People-log row
  with `value` `unknown`, and the fake api saw exactly one PUT (no retry).
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
| `requestJson`, `RequestJsonOptions`, `RequestJsonResult` | contract client | `grep -rn 'equestJson' .repos/contract/src .repos/config` |
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
`ProtectedRoute.maxFormBytes`, `PageResult` kind `download`, `MAX_CHECK_FORM_BYTES`
(`grep -rn 'maxFormBytes\|"download"\|MAX_CHECK_FORM_BYTES' .repos/console/src` prints nothing);
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
  empty body; `etag` is the raw `etag` header or `null`) or `{ ok: false, error }` with the
  existing `FetchJsonError`. A non-`2xx` (including `3xx`) answer is `{ kind: "http", status,
  wire, message? }`; `message` is the `error` string of a JSON `ErrorResponse` body up to
  `MAX_REASON_LENGTH` (1000) characters read within `maxBytes`, else absent. A `2xx` with a
  wire mismatch is `wire-mismatch`.
- `fetchJson` is unchanged (its `http` error never has `message`).

Checks:

- `test/location-uptime.test.ts`: accepts the Counterexamples' `eu`/`us` example; rejects
  duplicate and unsorted names, `uptime 50` with `results 0`, `uptime null` with `results 3`,
  `good 4` with `results 3`, `windowDays 30`, negative and fractional counts.
- `test/request-json.test.ts` with a hand-written fake `fetch` and fake `schedule`: method, body,
  content type and `redirect: "manual"` are passed; `201` with a valid body; `204` without one;
  `412` with `{"error":"the configuration changed: reload it and retry"}` gives that `message`;
  `500` with a non-JSON body gives no `message`; `302` is an `http` error; timeout, caller abort,
  network error, body over `maxBytes`, missing and mismatched wire header; the fake is called
  exactly once in every case.
- `test/types.fixture.ts` uses `CheckLocationUptime`, `LocationUptime`, `RequestJsonOptions`,
  `RequestJsonResult`.

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
  `src/uptime-rollup.test.ts`, `src/retention.test.ts`, `src/db.test.ts`
- `package.json`, `bun.lock` (contract pin to the merged contract SHA)
- `README.md`, `docs/rest-api.md`, `docs/concepts.md`, `docs/operation.md`

Behavior change: yes
A new public read route and a new stored tally.

Behavior:

- `GET /checks/:id/location-uptime` per Decisions 1 and 2, typed by `CheckLocationUptime`.
  `HEAD` like the other reads. Errors `400` `bad check id`, `404` `unknown check`. Read cache
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
  set, `good`, null rule, location set, errors and an example; the routes table
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
- These tests fail on `fb6f1a5` (route `404`, table missing) and pass after.

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
- `src/server.ts` (register `checkRoutes`, `pathLabel`, download answer, route form limit)
- `src/protected-route.ts` (`maxFormBytes`, `PageResult` kind `download`)
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
- `src/check-form.test.ts`, `src/check-filters.test.ts`, `src/check-export.test.ts`,
  `src/check-format.test.ts`, `src/server.checks.test.ts`, `src/server.checks-write.test.ts`
  (new); `src/navigation.test.ts`, `src/people-log.test.ts`, `src/forms.test.ts`,
  `src/server.security.test.ts`
- `test/fake-api.ts` (replies per method and path, records method, query, headers and body),
  `test/check-fixtures.ts` (new: config with all six types, file and database sources, a
  shadowed duplicate, all five states, results, uptime, latency, location uptime)
- `e2e/run.ts`
- `package.json`, `bun.lock` (contract pin to the merged contract SHA)
- `README.md`, `docs/configuration.md`, `docs/checks.md` (new), `docs/team.md`, `docs/index.md`,
  `AGENTS.md`

Behavior change: yes
New screens, api writes and People-log rows.

Behavior: R1 to R9 and Decisions 4 to 12. Notes for the implementer:

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
  bodies, host-binding line, heartbeat usage, export redaction, fixed quorum rule, old-api
  states); `README.md` endpoint rows and "What works now"; `docs/configuration.md` routes,
  the editor form limit in the POST order, log lines, metric path labels; `docs/team.md`
  People-log actions; `docs/index.md` link; `AGENTS.md` end-to-end test list and the check
  modules under "This repository".

Checks:

- `src/check-form.test.ts`, parameterised over the six types: valid input builds the exact
  `AdminCheckInput` (literal expected objects in the test); each field rule and counterexample
  of the Counterexamples section; wrong-type fields are not in the output; intents keep,
  replace, remove for headers and body; heartbeat secret rules; `__proto__` header.
- `src/check-filters.test.ts`, `src/check-format.test.ts`, `src/check-export.test.ts`:
  Counterexamples for filters, `formatPercent`, budget sign, single and shadowed export (literal
  expected documents written in the test).
- `src/server.checks.test.ts` (real server on port 0, fake api with `test/check-fixtures.ts`):
  list with all six types, five states, both sources and a shadowed duplicate; counts `6 checks`
  and `1 shadowed definition` for the fixture; filters compose and round-trip; reset; empty
  installation; no match; file banners; detail with locations, stale, location uptime joined by
  name, aggregate uptime, HTTP latency only for HTTP (the fake api records no `/latency` call
  for the TLS fixture), SLO absent, null and negative; results paging with `before`; heartbeat
  usage text; shadowed view without runtime data; `404` for unknown ids; old-api state; the
  location panel text for a `404` route; every failure state.
- `src/server.checks-write.test.ts` (stateful fake api): create and reopen each of the six types;
  edit preserving a stored literal header, an env header, a body and a heartbeat secret (the
  PUT body has keep markers and no `secret`), then replace and remove; `If-Match` values;
  stale `409` and api `412` keep input; shadowing during edit; delete of database and shadowed
  checks; typed-name mismatch sends nothing; export bodies and headers; the R8 table row by row;
  unknown outcome writes one `unknown` row and one request; session ended and role lowered
  between page and POST (`409` `Not saved`, `403`, nothing sent); roles: one allowed and one
  denied test per route (Viewer, Member, Admin, with Owner inherited); missing CSRF, foreign
  Origin, replayed form token never reach the fake api; the 524,288 and 524,289-byte forms and
  the unchanged 8192 limit on `/team/invites`; no HTML, redirect, download or log line contains
  the fixture's literal header value, body, secret or the Console token (sentinel strings).
- `e2e/run.ts` with the fake api: create and edit of each of the six types through the forms,
  filtering, detail, export download, stale recovery and typed delete, with JavaScript enabled
  and disabled; axe `0` violations on list, detail, shadowed view, each editor, delete
  confirmation; keyboard focus through the editor; no CSP violation; list and detail fit 390 px
  (`assertFits`), the editor at 1280 px; the copy button copies the host-binding line with
  JavaScript and is absent without it.
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
