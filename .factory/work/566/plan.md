# Spec #566: console tokens and probe locations screens

## Goal

An Admin or the Owner of pulse-console manages pulse-api credentials in the browser:

- **Tokens** (`/tokens`): list the admin-side tokens with scopes, source, state and last use;
  create one from a preset and see its secret once; rotate one with a 10-minute overlap; revoke
  one after typing its name. The console's own token is marked and cannot be rotated or revoked
  from the console.
- **Probes** (`/probes`): list probe locations with their state and last result; add a location,
  which creates a probe token bound to it and shows, once, a token file command plus a
  `docker run` line and a Compose file that start a probe for it; rotate a probe credential with
  overlap; revoke one.

pulse-api gains `GET /admin/tokens/self`, so the console knows which token row is its own. The
deploy end-to-end test proves that the generated snippets start a probe that reports within one
check interval.

## Sources and decisions this spec applies

| Source | Applied rule |
| --- | --- |
| Issue #566 | The two screens, show once, revoke, rotate with overlap, last use, last result, snippets for `docker run` and Compose. |
| [#460 decisions of 2 Nov](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362) s3 | Api scopes unchanged; create uses **presets only**: Read = `[read]`, Manage checks = `[read, checks, admin]`, Post incidents = `[read, incidents, admin]`, Full access = `[read, checks, incidents, admin]`. Admin presets show the sentence "Can also create, rotate and revoke tokens with the same or fewer scopes, and read the audit log." Rotation overlap is 10 minutes (`previousValidUntil`), shown as a countdown. Every row shows its source. Revoke is disabled on the last active admin token. New route `GET /admin/tokens/self`, used by setup and to protect the console's own row. No creator, no IP. |
| #460 s7 | The add-location snippets carry `PULSE_PROBE_BLOCK_PRIVATE_RANGES` with an explanation; no console switch. |
| #460 s9 | The People log records the change with the api action names (`token.create`, `token.rotate`, `token.revoke`). No "on behalf of" field in the api. |
| #460 s13 | Tokens and probe locations: Admin and Owner (`token.write`, `probe.write`, `src/permissions.ts:54-55`). |
| #460 s14 | Typed-name confirmation for "revoke token or probe"; confirmations work without JavaScript. |
| #460 s19, s20 | Probe version and results per minute are not shown (deferred). No new runtime package. Same-origin script only for copy buttons. |
| Issue review `.factory/work/566/issue-review.md` | Targets api, console, deploy; no contract and no probe change; `/self` before the generic id branch; own-row protection on the server; join of probe tokens and `GET /locations`; per-credential actions; snippets that really run; show-once and lost-answer rules. |

The design boards SH6/SH4 were not available to the review or this plan; the #460 decisions
override the boards anyway (#460 comment, last line).

### What this spec builds on (do not redo)

| Built by | What | Where |
| --- | --- | --- |
| #561 (closed, merged) | Token store, hashing, list/get/create/rotate/revoke routes, grant rule, last-admin rule, overlap 600000 ms, audit | api `src/token-routes.ts`, `src/token-store.ts`, `src/token-scopes.ts:38-63`; contract `src/tokens.ts`, `src/validate-tokens.ts` |
| #562 | Setup connection test (`GET /admin/config`, then `GET /admin/tokens`) | console `src/connection-test.ts:123-138` |
| #718 | Shell, navigation registry with `tokens` and `probes` entries (`isAvailable: false`), `ProtectedRoute`, shared states, confirmation pages, form tokens, copy buttons in `/console.js` | console `src/navigation.ts:42-43`, `src/protected-route.ts`, `src/states.ts`, `src/confirm.ts`, `src/form-tokens.ts`, `src/console-script.ts:38-52` |
| #564 | Roles, permission matrix, `routeRole`, People log | console `src/permissions.ts:54-55`, `:89`, `src/people-log.ts` |
| #751 (console check screens) | Outbound write pattern: live guard before the write, never retried, outcome classes, People log after the answer | console `src/check-write.ts:43-64`, `:191-214`, `src/check-outcome.ts` |

## Scope

- api: `GET /admin/tokens/self`, its tests and docs.
- console: the Tokens and Probes screens and their routes, the self lookup, the setup connection
  test on `/self`, the snippet builders, three optional prefill settings, People log rows,
  `/console.js` (countdown, secret clearing), browser checks, docs.
- deploy: the dev setup's prefill values, a console helper library for the e2e scripts, a new
  e2e scenario that runs the generated snippets, and the CI gate on its `ok:` line.

## Non-goals

- Any contract, kit, config, probe, status or notify change. No probe version, no results per
  minute, no per-check location choice.
- Expiry on create, expiry editing, renaming a token. The api has neither an edit route nor a
  rename route; this item adds none. Existing expiry is shown.
- Arbitrary scope checkboxes. Presets only.
- Durable location records in the api, deleting a location or its results.
- A console switch for private ranges or header host bindings (#460 s1, s7).
- The Activity page (item C). The People log rows are written, not shown.
- Updating the image pins in `common/services.yaml` (a release step, not this item).
- Showing a secret again, ever. Secret recovery.

## Required behavior

### 1. API: `GET /admin/tokens/self`

- `GET /admin/tokens/self` answers `200` with the `TokenMetadata` of the token that authenticated
  the request (the row `caller.id`), read from the store, with `cache-control: no-store`.
- It runs through the same admin auth path as every token route: throttle first, `404` before the
  first admin import, `401`/`403` in the documented order, permission `token-admin` (scope
  `admin`). A probe token gets `403`.
- Only `GET` (and so `HEAD` where the server already maps it). Any other method answers `405`
  with `Allow: GET`, after auth like the other token routes.
- The path is matched before the generic `:id` branch: exactly `/admin/tokens/self`. The literal
  `self` is never looked up as a token id. `/admin/tokens/self/rotate` and
  `/admin/tokens/self/revoke` keep answering `404 {"error":"token not found"}` after auth (a
  malformed id, as today).
- During a rotation overlap both the old and the new secret return the same row (same `id`,
  `rotatedAt` and `previousValidUntil` set).
- The metrics and auth-failure route label is `/admin/tokens/self`, not `/admin/tokens/:id`.
- The body never holds a secret or digest (it is validated by contract `validateTokenMetadata`
  in the test).

### 2. Console: setup connection test

`testConnection` (`src/connection-test.ts:130-138`) calls `GET /admin/tokens/self` (validated with
`validateTokenMetadata`) instead of `GET /admin/tokens`:

- `200` with a valid body: `adminScope: "confirmed"`.
- `404`: the api is older than this item. The test then calls `GET /admin/tokens` exactly as
  today: `200` → `confirmed`, `404` → `not-checked`, other failures → the existing texts.
- Other failures keep the existing texts of `statusText(call="tokens", …)`.
- The configured token is never sent to the browser; the body of `/self` is dropped after
  validation.

### 3. Console: self lookup and its failures

Every Tokens and Probes page and every mutation reads `GET /admin/tokens/self` fresh (no cache).

- Success: the row whose `id` equals the self `id` is "the console's own token".
- `404`, timeout, network failure, invalid body, wire mismatch: the page renders the lists that
  could be read and a banner: "The console cannot tell which token it uses (pulse-api answered
  <reason>). Changes are off until it can. pulse-api needs GET /admin/tokens/self." Every create,
  rotate and revoke link and button is absent, and every mutation POST answers `503` with that
  text and makes no write (fail closed).
- `401`: the existing `tokenRejectedBanner` (`src/states.ts:52`), mutations off.

### 4. Console: Tokens screen

Routes (all `ProtectedRoute`, `requiredRole: routeRole("token.write")`, `navId: "tokens"`; the
`tokens` navigation entry becomes `isAvailable: true`):

| Route | Methods | Purpose |
| --- | --- | --- |
| `/tokens` | GET | List |
| `/tokens/new` | GET, POST | Create form; POST creates and shows the secret once |
| `/tokens/rotate?id=<id>` | GET, POST | Plain confirmation; POST rotates and shows the new secret once |
| `/tokens/revoke?id=<id>` | GET, POST | Typed-name confirmation; POST revokes |

**List.** Reads `GET /admin/tokens` and `/self`. Shows only tokens whose scopes are not exactly
`["probe"]`; a line under the table says "Probe tokens are on the Probes page (<n>)." with a
link. Two tables in the api's order: "Active" (not revoked, and `expiresAt` null or later than
now) and "Revoked or expired". Columns: name; id (always shown, names may repeat); access (the
preset label when the scopes equal a preset, else the scopes joined with ", "); source
("Created in pulse-api" for `api`, "Imported from a token file" for `file`); created (UTC);
last used (`utcTime` style, `Never` for `null`); state. State texts:

- `Active`; `Active, expires <UTC>` when `expiresAt` is set;
- `Rotated: old secret valid until <UTC>` when `previousValidUntil` is later than now;
- `Revoked <UTC>`; `Expired <UTC>`.

The own row carries the marker "This console" and no actions, with the text "The console's own
token. Rotate or revoke it in pulse-api with its file or the API, then restart the console." Every
other active row links to Rotate and Revoke. The empty state has a "Create a token" action.

When exactly one active token holds `admin`, its Revoke is replaced by the text "Last active
admin token: it cannot be revoked." When that token has an `expiresAt`, a banner says "The last
active admin token expires at <UTC>. After that nobody can manage pulse-api tokens."

**Create.** Fields: `name` (required, trimmed 1 to 100 characters, no `\p{Cc}`), `preset`
(radio: `read`, `checks`, `incidents`, `full` with labels Read, Manage checks, Post incidents,
Full access; no default). The three admin presets show the #460 s3 sentence. A preset whose
scopes are not all held by the console token (from `/self`) is shown disabled with "The console
token lacks <scope>." and refused on POST with a field error (the grant rule of
`api src/token-scopes.ts:38-40`; the api's `403` remains authoritative). POST body to the api:
`{"name": <trimmed>, "scopes": <preset scopes in api order>}`, no `expiresAt`.

**Show once.** A successful create (`201`, wire ok, body passes `validateTokenSecretResponse`)
renders, directly as the POST answer (`200`, `cache-control: no-store` as every page,
`src/http-context.ts:94`), no redirect:

- heading "Token created", name, id, access;
- `<pre id="token-secret" data-secret>` holding the secret, a copy button
  `data-copy="token-secret"` (existing mechanism), and the text "Copy it now. pulse-api keeps only
  a hash: this is the only time it is shown.";
- a link "Back to Tokens".

A successful rotate renders the same block with the heading "Token rotated" and:
"The old secret keeps working until <UTC of previousValidUntil>
(`<time data-countdown datetime="<ISO>">mm:ss</time>` left). Replace it everywhere before then."
The server renders the remaining time from `now()` and `previousValidUntil`; it never assumes
10 minutes. When `previousValidUntil` is `null` or not later than now (expiry cut the overlap),
the text is "The old secret no longer works."

### 5. Console: Probes screen

Routes (`requiredRole: routeRole("probe.write")`, `navId: "probes"`; the `probes` entry becomes
`isAvailable: true`):

| Route | Methods | Purpose |
| --- | --- | --- |
| `/probes` | GET | Locations with their credentials |
| `/probes/new` | GET, POST | Add-location form; POST creates a probe token and shows the snippets once |
| `/probes/rotate?id=<id>` | GET, POST | Plain confirmation; POST rotates one credential |
| `/probes/revoke?id=<id>` | GET, POST | Typed-name confirmation (the location name); POST revokes one credential |

**List.** Reads `GET /admin/tokens` (rows with scopes exactly `["probe"]`), `GET /locations`
(public route, validated with `validateLocationsResponse`, no token sent) and `/self`. Groups by
exact location string (case-sensitive, as the api compares). One group per name in either source,
sorted by name (code-unit order). Group state:

| Observed in `/locations` | Active credentials | State text |
| --- | --- | --- |
| `reporting` | any | `Reporting`, last result `<UTC of lastResultAt>` |
| `silent` | ≥ 1 | `Silent since <UTC of lastResultAt>` |
| `silent` | 0 | `Silent, no active token` |
| not listed | ≥ 1 | `Awaiting first result` |
| not listed | 0 | `No active token` |

A `reporting` group with 0 active credentials adds "No active token: new results will be
refused." Under each group every credential is listed (never collapsed): name, id, source,
created, last used (`Never` for `null`), state (the token state texts of section 4), and for an
active credential the links "Rotate this token" and "Revoke this token". There is no
location-wide action. Revoking keeps the location's results; the page says so on the revoke
confirmation. Results of a location stay in pulse-api; a group with only revoked credentials and
no observed result is still listed (so it can be audited) in a "Revoked" table below the active
groups. When `GET /locations` fails, the groups show "Last result unknown (pulse-api answered
<reason>)" and the credentials still render. No version and no results-per-minute text.

**Add location.** Fields:

| Field | Rule | Prefill |
| --- | --- | --- |
| `location` | trimmed, 1 to 64 characters, no `\p{Cc}`, not `heartbeat` (the api's heartbeat pseudo location is never listed, `api src/service.ts:121`, `:432`) | empty |
| `name` | optional; trimmed 1 to 100, no `\p{Cc}`; default `probe <location>` | empty |
| `api_url` | required; the console's URL rules (`src/settings.ts:27`, `:32-42`): http or https, no whitespace or control character, no credentials, query or fragment, at most 2048 characters; one trailing `/` dropped | `PULSE_CONSOLE_PROBE_API_URL` |
| `image` | required; 1 to 255 characters of `[A-Za-z0-9._/:@-]`, first character `[A-Za-z0-9]` | `PULSE_CONSOLE_PROBE_IMAGE` |
| `network` | optional; `[A-Za-z0-9][A-Za-z0-9_.-]{0,127}` (Docker network name) | `PULSE_CONSOLE_PROBE_NETWORK` |
| `block_private` | checkbox, off by default | off |

Help texts: under `api_url` "The address the probe uses to reach pulse-api. The console reaches
it at <console's API URL>; a probe on another host needs an address it can reach." Under
`network` "For a probe on the same Docker host as pulse-api: the Compose network of the stack
(for example `pulse_default`). Leave empty for a remote probe." Under `block_private`:
"`PULSE_PROBE_BLOCK_PRIVATE_RANGES`: when on, this probe refuses private, loopback, link-local
and cloud metadata addresses. Off by default for self-hosted probes, so checks of internal
services work." The console token needs `checks` to mint a probe token (grant rule); without it
the form is replaced by "The console token lacks the checks scope, so it cannot create probe
tokens."

A location that already has an active credential is allowed (the api allows several tokens per
location, `api docs/concepts.md:76`): the form POST adds another credential and the result page
says "<location> now has <n> active tokens."

POST body to the api: `{"name": <name>, "scopes": ["probe"], "location": <trimmed location>}`.

**Snippets.** Built by a pure module from the validated fields, the created token id and the
secret. Names: `slug` = the location lowercased, every run of characters outside `[a-z0-9]`
replaced by `-`, leading and trailing `-` removed, cut to 32 characters, trailing `-` removed
again, `location` when empty; `base` = `pulse-probe-<slug>-<last 6 hex of the token id>`. Env
file `<base>.env`, Compose file `<base>.compose.yaml`, container and Compose project `<base>`.
The token id never changes on rotate, so the names stay stable.

Every shell word that holds data goes through `shellQuote` (`src/shell-line.ts:7`). YAML scalars
are `JSON.stringify(value)` with every `$` doubled to `$$` (Compose interpolation). HTML escaping
is separate and only at render. Exact shapes (`[…]` lines only when `network` is set; `<…>`
replaced by the quoted values):

`#probe-env-command` (holds the secret; `data-secret`):

```sh
(umask 077 && printf '%s\n' 'PULSE_PROBE_TOKEN=<secret>' > '<base>.env')
```

`#probe-docker-run`:

```sh
docker run -d --name '<base>' --restart unless-stopped \
  --security-opt no-new-privileges:true --cap-drop ALL \
  [--network '<network>' \]
  --env-file '<base>.env' \
  -e 'PULSE_API_URL=<api_url>' \
  -e 'PULSE_LOCATION=<location>' \
  -e 'PULSE_PROBE_BLOCK_PRIVATE_RANGES=<true|false>' \
  '<image>'
```

`#probe-compose-file`:

```yaml
name: "<base>"
services:
  probe:
    image: "<image>"
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    env_file: ["<base>.env"]
    environment:
      PULSE_API_URL: "<api_url>"
      PULSE_LOCATION: "<location>"
      PULSE_PROBE_BLOCK_PRIVATE_RANGES: "<true|false>"
    [networks: [pulse]]
[networks:
  pulse:
    external: true
    name: "<network>"]
```

`#probe-compose-command`: `docker compose -p '<base>' -f '<base>.compose.yaml' up -d`

The `-p` flag is required, not decoration: an inherited `COMPOSE_PROJECT_NAME` overrides the
file's top-level `name:` (verified with Docker Compose 2.40.3: `COMPOSE_PROJECT_NAME=pulse-e2e
docker compose -f p.compose.yaml config` prints `name: pulse-e2e`; with `-p pulse-probe-x-abc123`
it prints `name: pulse-probe-x-abc123`), so without `-p` a shell that has it set would recreate
the `probe` service of another project. `-f` likewise overrides an inherited `COMPOSE_FILE`.
Every Compose line the console renders (start, restart, stop) carries both `-p '<base>'` and
`-f '<base>.compose.yaml'`.

The page shows: 1. save the token (env command, with "Run it on the probe host in the directory
where the probe files live. It holds the token: it is shown only once."); 2a. `docker run` or 2b.
save the Compose file as `<base>.compose.yaml` and run the command; 3. "The location appears as
Awaiting first result until the probe posts its first result." Each `<pre>` has a copy button.
The secret is never put in an `-e` flag, a Compose file, a URL or a query string. A Console
admin token never appears in a snippet.

**Rotate (probe).** The result page shows the new `#probe-env-command` for the same `<base>.env`
(with `data-secret`), the overlap deadline as in section 4, and the restart lines:
`docker compose -p '<base>' -f '<base>.compose.yaml' up -d --force-recreate` and, for `docker run`,
`docker rm -f '<base>'` followed by "run your docker run line again". It says that the env file
is read when the container is created, so a plain `docker restart` keeps the old token.

### 6. Console: mutations (both screens)

Order in every mutation POST, after the dispatcher's session, form, CSRF, role and form-token
steps (`src/server.ts:1086-1101`, `src/protected-route.ts`):

1. Validate the form fields (`422` with field errors, input kept, secret fields: none).
2. Read `/self` (section 3: failure → `503`, no write).
3. For rotate and revoke: read `GET /admin/tokens/<id>` (id built with `apiIdSegment`). `404` →
   the not-found state; a token whose scope kind does not match the screen (a probe token on
   `/tokens/*`, an admin-side token on `/probes/*`) → `404` not-found state.
4. The target is the own token (`id` equals self `id`) → `409` page "This is the console's own
   token. Nothing was changed." No write. Also on GET of the confirmation pages, which then
   render no form.
5. The target is revoked or expired → `409` "This token is already revoked or expired."
6. The confirmation `revision` differs from the current one → the existing stale state (`409`,
   `src/states.ts:97`). `revision` = lowercase hex SHA-256 of the JSON array
   `[id, name, scopes, location, expiresAt, revokedAt, rotatedAt]`. `lastUsedAt` and
   `previousValidUntil` are not part of it, so a probe using the token does not make the
   confirmation stale.
7. Revoke only: typed name check (`typedNameError`, `src/confirm.ts:43`) against the token name
   on `/tokens/revoke`, the location on `/probes/revoke`; mismatch → `422` with the page again.
8. Revoke only: the target is the last active admin token (the rule of
   `api src/token-scopes.ts:56-63`, on the list read in this request) → `409`, no write.
9. Grant check against the self scopes (`probe` counts as `checks`) → `403` page "The console
   token lacks <scope>." No write.
10. `writeGuardProblem` (`src/check-write.ts:43-64`): session still there, stored role still at
    least `admin`.
11. One write, never retried, redirects not followed, timeout 5000 ms:
    `POST /admin/tokens`, `POST /admin/tokens/<id>/rotate` or `/revoke` with body `{}` (rotate,
    revoke) and `content-type: application/json`.

Outcome mapping (the outcome is decided by status and wire header first, as in
`src/check-outcome.ts:24-44`):

| Api answer | Console answer |
| --- | --- |
| create `201` / rotate `200`, wire ok, body passes `validateTokenSecretResponse` | show-once page (`200`) |
| revoke `200`, wire ok | `303` to the list with notice "Revoked <name> (<id>)." |
| `2xx` with wire ok but an invalid or unreadable body (create, rotate) | `502` "pulse-api made the change, but its answer could not be read, so the secret cannot be shown. Open the list: revoke the new token, or rotate it again after the overlap." No second write. |
| `400`/`422` | the form or confirmation again with the api message (truncated at 1000 characters, escaped) |
| `401` | the token-rejected state |
| `403` | `502` "pulse-api refused: the console token lacks a scope this token holds." |
| `404` | the not-found state |
| `409` | the confirmation again with the api message (overlap, revoked, expired, last admin). Never a success text. |
| `429` | `503` "pulse-api is throttling the console. Try again in a minute." |
| other `4xx`/`5xx` with wire ok | `502` "pulse-api refused the request (<status>). Nothing was changed." |
| timeout, network error after send, wrong or missing wire header, redirect | `504`/`502` "The result is unknown. Open the list to see whether the token was created, rotated or revoked." |

**People log.** After a saved or unknown outcome, one row with `appendPeopleEvent` semantics as in
`src/check-write.ts:172-188`: actor the person, action `token.create`, `token.rotate` or
`token.revoke`, target kind `token` (`target_kind = 'token'`, `target_name = <token id>` or
`unknown` for a create whose answer had no id, `target_id = NULL`), value `scopes=<comma list>`
for admin-side tokens and `location=<location>` for probe tokens; for an unknown outcome the
value ends with ` (unknown)`. A failed insert is logged as an error (`token change not logged`,
error name only, as `src/check-write.ts:183-185`) and never changes the outcome class:

- **Confirmed write** (create `201` / rotate `200` with a valid body, revoke `200`, all wire ok):
  the page or the revoke notice adds `SAVED_NOT_LOGGED_TEXT` ("Saved in pulse-api. The People log
  row could not be written.", `src/check-write.ts:16`).
- **Confirmed write with an unreadable body** (the `502` lost-answer row): the lost-answer text
  stays as it is and adds only "The People log row could not be written." (it already says that
  pulse-api made the change).
- **Unknown outcome** (timeout, network error after send, wire mismatch, redirect): the unknown
  text stays exactly as it is; nothing is added, and in particular never "Saved in pulse-api."
  This is the rule of `src/check-write.ts:205-208`, where the unknown branch ignores the result
  of the insert.

No secret, digest or snippet goes into the row, a log line or a metric.

**Show-once boundaries.**

- The secret exists only in the one POST answer. It is never stored in the console database, the
  form-token store, a log line, a metric, a cookie, a URL, a query string, a redirect, or
  `localStorage`/`sessionStorage`.
- A replayed POST (reload of the answer, Back then resubmit, a copied request) carries a used form
  token: the dispatcher answers `409` "Already submitted" (`src/server.ts:328-332`) with no api
  call, so no second token and no secret.
- `/console.js` clears every `[data-secret]` element on `pagehide` (text replaced by "Hidden: the
  secret was shown once.") and again on a `pageshow` with `persisted`, so a back/forward cache
  restore shows no secret. Without JavaScript the page is `no-store` and its URL is a POST
  answer, so Back re-requests it and gets "Already submitted".
- `/console.js` also updates every `time[data-countdown]` once a second (`mm:ss left`, at zero
  "ended"). No request, no storage. The CSP stays as it is. The timer exists only while at least
  one `time[data-countdown]` is above zero: the script starts no interval on a page without one,
  starts at most one interval per page for all of them, and clears it when every countdown has
  reached zero (at most 600 ticks after a fresh rotation) and on `pagehide`.

### 7. Console: settings

Three optional settings, read after `PULSE_CONSOLE_SECRET_KEY_FILE`, blank counts as unset,
invalid stops the start with exit code `2` and `pulse-console: <name>: <rule>` (value not
printed):

| Setting | Rule | Use |
| --- | --- | --- |
| `PULSE_CONSOLE_PROBE_API_URL` | the `api_url` field rule | prefill of `api_url` |
| `PULSE_CONSOLE_PROBE_IMAGE` | the `image` field rule | prefill of `image` |
| `PULSE_CONSOLE_PROBE_NETWORK` | the `network` field rule | prefill of `network` |

They are prefills only: the person sees and can change every value before the token is created.
The console never copies its own `PULSE_API_URL` into a snippet unasked.

## Performance impact

- api (`bench/budgets.json`, `api` block): one more string comparison on the token route path
  and one store read on the new route. `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`,
  `peak_rss_mib`, `startup_wall_ms`, the p95 latencies, `rps` and `image_mb`: none expected (the
  bench load never calls `/admin/tokens/self`, and no code on the result or read paths changes).
  `test_cpu_s`: up by well under 0.1 s (about ten HTTP tests on a server that the file already
  starts), against a budget of 5.6 s and a floor of 1.6 s (`bench/budgets.json:23-28`).
  How it is measured: the bench defines `test_cpu_s` as user + system CPU seconds of
  `bun run test` and its waited children (`bench/measure.ts:47-71`, `bench/run.ts:161-166`);
  plain `bun run test` prints no CPU time. The implementer reproduces that number with the bash
  builtin `times`, which prints the user and system time of waited children on its second line:
  `bash -c 'bun run test >/dev/null 2>&1; times'`, run 3 times on `main` and 3 times on the
  branch in the same checkout and machine; the value per run is user + system of the second line,
  the result per side is the median of its 3 values, and the PR reports both medians and their
  difference. A full `bun bench/run.ts --a main --b <branch>` A/B is not required for this change.
- console, deploy: no budget in `bench/budgets.json` (its blocks are `api`, `config`,
  `contract`, `kit`, `notify`, `probe`, `status`; the bench repositories are the same seven,
  `api bench/refs.ts:5`). So no gating or reported metric can move. The server-side cost: the
  console pages make up to three parallel api reads (tokens, self, locations), each with the
  existing 5000 ms timeout, only when an Admin or Owner opens these pages.
- Browser countdown (`/console.js`, client side only, not a bench metric): direction up, size
  negligible. It runs only on a rotate result page, as one 1000 ms interval for the whole page
  that rewrites the text of at most a few `<time>` elements, for at most 600 ticks (the 10-minute
  overlap), and is cleared at zero and on `pagehide`; no request, no layout-dependent read. Other
  pages start no timer. Measurement: the browser check (`e2e/run.ts`) adds an init script that
  wraps `window.setInterval` and `window.clearInterval` and keeps two numbers, `set` (calls of
  `setInterval`) and `active` (ids set and not yet cleared). It asserts the literal values
  `set = 0` on `/tokens` and on the create result page, `set = 1` on the rotate result page,
  that the countdown text changes after 1100 ms, and that on a rotate result whose
  `previousValidUntil` is now + 2000 ms the text reads "ended" and `active = 0` after 3500 ms.

## Security impact

Security impact: yes. A new admin route, new authenticated mutation routes that create and show
secrets, generated shell and YAML text, and a CI e2e change.

Checklist items that apply:

- **Secrets in errors, logs and responses.** The probe or admin secret appears only in the one
  POST answer. Never in a log line, error text, People log row, metric, URL, redirect, cookie,
  browser storage or the console database. The console's own admin token never reaches the
  browser (also not through `/self`, which returns metadata only). The deploy e2e never prints a
  secret and scans the console database and the logs for both created secrets.
- **Auth order and status codes.** api: `/self` uses the existing throttle and auth order, `405`
  after auth. console: dispatcher order unchanged; role checked on GET and POST; live guard
  before the write; own-token and last-admin refusals on the server, not only hidden links.
- **Body and size limits.** console form bodies keep the default `MAX_FORM_BYTES`; api token
  bodies keep 4096 bytes.
- **Input validation.** Location, name, URL, image and network rules of section 5 at the form;
  the contract validates every api answer (`validateTokenMetadata`, `validateTokensResponse`,
  `validateTokenSecretResponse`, `validateLocationsResponse`).
- **Injection into copied text.** Shell words through `shellQuote`; YAML scalars through JSON
  string encoding plus `$$`; HTML escaping separately. Names are derived, never the raw
  location. Every rendered Compose line carries `-p '<base>' -f '<base>.compose.yaml'`, so an
  inherited `COMPOSE_PROJECT_NAME` or `COMPOSE_FILE` in the person's shell cannot point the
  snippet at another project's `probe` service.
- **CI.** The new e2e step runs commands that the console rendered; it runs them in a temporary
  directory with throwaway tokens, with the parent's `COMPOSE_*` variables removed
  (`snippet_run`), checks that the stack's own probe container is untouched, and removes its
  containers and files on success and failure.

## Rollout order

1. **api** adds `/admin/tokens/self`. Older consumers: the console on its current pin calls
   `/admin/tokens` in setup and never `/self`, so it keeps working; no other service calls token
   routes.
2. **console** (in parallel with api; it does not need the api release to pass its checks: its
   tests use the fake api and its `deploy-dev` job's connection test falls back to
   `/admin/tokens` on `404`). Against an api without `/self` the Tokens and Probes pages list
   tokens and locations read-only with the section 3 banner; against an api without token routes
   (before #561) the lists show the existing "pulse-api answered 404" state. Setup keeps working
   with every api version (section 2).
3. **deploy** after both are on `main`: `e2e-dev` builds every service from `main`
   (`deploy .github/workflows/ci.yml:250-301`), so its new gate needs both merged. The `full`
   e2e on the published `0.1.0` images skips the new step (section of deploy). Old probes need no
   change: the snippets use only settings that probe `main` already reads.

No contract, kit or config pin changes. The published image pins stay at `0.1.0` until a release
bump with `scripts/bump-images.sh`; the new screens are accepted only on candidate sources
(`E2E_SETUP=dev`), never on the old images.

## Counterexamples

| Rule | Input a correct implementation rejects or handles; a wrong one gets wrong |
| --- | --- |
| `/self` before `:id` | `GET /admin/tokens/self` with a valid admin token: `200` with the caller's row. Current main answers `404 token not found`: the test must fail on main. |
| `/self` has no actions | `POST /admin/tokens/self/rotate` → `404`, not a rotation of the caller. `POST /admin/tokens/self` → `405` `Allow: GET`. |
| `/self` auth | Probe token → `403`; no token → `401` with `WWW-Authenticate: Bearer`; `read`-only token → `403`; before the admin import → `404`; after 10 failures in 60 s → `429` even with a valid token. |
| `/self` in overlap | After `POST /admin/tokens/<console id>/rotate` (test only, by another admin), both secrets get the same `id`. |
| Setup fallback | Api answers `404` on `/self` and `200` on `/admin/tokens` → `confirmed`; `404` on both → `not-checked`; `403` on `/self` → "The console token lacks the admin scope." |
| Own token | A forged `POST /tokens/revoke` with `id=<self id>`, a valid form token, CSRF and typed name → `409`, the fake api records 0 writes. Same for `/tokens/rotate`. |
| Own token by name | Another token with the same name as the console's token is not protected; the own token is matched by id only. |
| Last admin | The list holds one active admin token that is not the console's (console token expired in the fixture) → no Revoke link; a forged POST → `409`, 0 writes. An api `409 cannot revoke the last active admin token` (race) → confirmation again with that message, never "Revoked". |
| Grant | Console token `[read, admin]`: presets Manage checks, Post incidents, Full access are disabled; forged `preset=full` → field error, 0 writes. Add location → refused (needs `checks`). |
| Presets | `preset=checks` sends exactly `["read","checks","admin"]`; `preset=read` sends `["read"]`; `preset=admin` (not a preset) → `422`, 0 writes. |
| Stale confirmation | The token is revoked by someone else between GET and POST → `revokedAt` changed → stale `409`, 0 writes. A probe posts a result in between (only `lastUsedAt` changed) → not stale. |
| Typed name | Token name `ops ` typed as `ops` → confirmed (trim); typed `Ops` → mismatch (case-sensitive). |
| Show once | Reload of the create answer → `409 Already submitted`, the fake api records 1 create. GET `/tokens` afterwards holds no `pulse_` secret. |
| Lost answer | Api answers `201` with wire ok and body `{}` → `502` lost-answer text, People row value ends ` (unknown)`, no second create. |
| People log failure after an unknown outcome | The fake api never answers the create (the 5000 ms timeout fires) and the People insert throws → `504` with the unknown text only; the page holds neither "Saved in pulse-api." nor "could not be written"; one `error` log line `token change not logged`; 1 api write. A wrong implementation that reuses the saved branch shows "Saved in pulse-api.". The same with a wire-header mismatch → `502`, same assertions. |
| People log failure after a confirmed write | Create `201` with a valid body and a throwing insert → show-once page `200` with the secret and `SAVED_NOT_LOGGED_TEXT`; never an error page. |
| Last used | `lastUsedAt: null` → `Never`, not `1970-01-01`. |
| Location rule | `heartbeat` → field error; 65 characters → field error; `eu\u0007` → field error; `  eu  ` → stored and shown as `eu`. |
| Location grouping | Tokens with locations `eu` and `EU` are two groups. Two active tokens for `eu` show as two rows in one group, each with its own Rotate and Revoke. |
| Location state | A new credential with no result → `Awaiting first result`, not `Reporting`; token `lastUsedAt` set by a `GET /probe/checks` but no result → still `Awaiting first result`. |
| Shell quoting | location `it's` → `-e 'PULSE_LOCATION=it'\''s'`; `$(id)` stays literal inside single quotes. |
| YAML quoting | location `a"b$HOME` → `PULSE_LOCATION: "a\"b$$HOME"`; Compose resolves it to `a"b$HOME`. |
| Names | location `Ünïcode Zone/1` → slug `n-code-zone-1` (non-ASCII letters are outside `[a-z0-9]`); location `!!!` → slug `location`; base is `pulse-probe-<slug>-<6 hex>`. |
| Network | `network` empty → no `--network` flag and no `networks:` keys; `-net` → field error (first character). |
| Countdown | `previousValidUntil` = now + 600000 → `10:00 left`; = now + 59000 → `00:59 left`; `null` → "The old secret no longer works." Remaining time = `max(0, floor((previousValidUntil − now) / 1000))` seconds, shown as `mm:ss`. |
| Compose project | The Compose command is `docker compose -p '<base>' -f '<base>.compose.yaml' up -d`; a builder that drops `-p` fails the literal-string unit test. In deploy, the stack's `probe` container id (`docker compose ps -q probe` of `pulse-e2e`) is the same before and after the snippet starts, restarts and stops; a launch that inherited `COMPOSE_PROJECT_NAME=pulse-e2e` would recreate it and fail. |
| One interval (deploy) | Deadline `t0 + 10000` ms. A poll that starts at `t0 + 9500` ms and returns at `t0 + 10300` ms with the result fails the step, though the result may have been accepted before the deadline: only an observation that has finished by the deadline counts. A probe whose first result is accepted after the deadline fails even if it reports later. A poll that hangs is cut at the deadline by its `--max-time` and fails the step. The same rule holds for the Compose launch and the rotation restart. |

Statistics: none. The "within one interval" rule of the deploy check is defined in the deploy
section (deadline, request bounds, clock); it is a single deadline test, not a statistic.

## Contract fields

No contract or config name is added; the contract already exports every type and validator the
console uses (`contract src/index.ts:169-170`, `:197`, `:227-228`). New names in services:

| Name | Where | Collision search (run from the meta checkout) | Result |
| --- | --- | --- | --- |
| route `/admin/tokens/self` | api | `grep -rn 'tokens/self' .repos/contract/src .repos/config .repos/api/src` | 0 hits |
| `PULSE_CONSOLE_PROBE_API_URL` | console, deploy dev | `grep -rn 'PULSE_CONSOLE_PROBE_API_URL' .repos/contract/src .repos/config .repos/console/src` | 0 hits |
| `PULSE_CONSOLE_PROBE_IMAGE` | console, deploy dev | `grep -rn 'PULSE_CONSOLE_PROBE_IMAGE' .repos/contract/src .repos/config .repos/console/src` | 0 hits |
| `PULSE_CONSOLE_PROBE_NETWORK` | console, deploy dev | `grep -rn 'PULSE_CONSOLE_PROBE_NETWORK' .repos/contract/src .repos/config .repos/console/src` | 0 hits |
| People actions `token.create`, `token.rotate`, `token.revoke` | console People log | `grep -rn 'token\.\(create\|rotate\|revoke\)' .repos/contract/src` | 3 hits in `contract src/audit.ts:26-28`: the api audit actions. Reused on purpose with the same meaning (#460 s9 "using the api action names"); no new contract name. |
| People target kind `token` | console `people_events.target_kind` (no CHECK, `console src/database.ts:114`) | `grep -n "'token'" .repos/console/src/people-log.ts .repos/console/src/database.ts` | 0 hits |
| console routes `/tokens`, `/tokens/new`, `/tokens/rotate`, `/tokens/revoke`, `/probes`, `/probes/new`, `/probes/rotate`, `/probes/revoke` | console | `grep -rn '"/tokens\|"/probes' .repos/console/src` | only the navigation entries `src/navigation.ts:42-43` |
| element ids `token-secret`, `probe-env-command`, `probe-docker-run`, `probe-compose-file`, `probe-compose-command` | console pages, read by deploy e2e | `grep -rn 'token-secret\|probe-env-command\|probe-docker-run\|probe-compose' .repos/console/src .repos/deploy` | 0 hits |

The element ids are an interface between console (renders) and deploy (reads): each side
implements its half; deploy's e2e runs against console `main`.

## Repository: api

Files:
- `src/token-routes.ts`
- `src/server.tokens.test.ts`
- `src/token-routes.test.ts` (new, only if the path parser gets unit tests; otherwise leave out)
- `docs/rest-api.md`
- `docs/operation.md`

Behavior change: yes. A new admin route.

**Behavior.** Section 1. `tokenPathOf` (`src/token-routes.ts:37-46`) returns a self marker for
exactly `/admin/tokens/self` (for example `{ id: undefined, action: undefined, isSelf: true }`),
before the generic `([^/]+)` branch; `tokenRouteOf` (`:49-52`) returns `/admin/tokens/self` for
it, so the metrics label (`src/server.ts:238-239`) and the auth-failure route
(`src/admin-routes.ts:294`) name it. `dispatch` (`:147-192`) serves it: `GET` → read the body like
the other GETs (`:170`), `sendJson(200, store.get(caller.id))`; another method → `405`
`Allow: GET`. If `store.get(caller.id)` is `null` (cannot happen after a successful auth, but the
store is a separate read) answer `404 token not found`. The auth path stays
`createAdminHandler`'s `tokenRoute` (`src/admin-routes.ts:286-301`), permission `token-admin`,
`cache-control: no-store`.

**Checks.**

- `src/server.tokens.test.ts` (real server on port 0, as today): every row of the `/self`
  counterexamples (200 with the exact row validated by `validateTokenMetadata`, no `secret` or
  digest key; both overlap secrets give the same `id`; `401`, `403` for a probe token and for a
  `read`-only token, `404` before the admin import, `405` with `Allow: GET` for `POST`,
  `/self/rotate` and `/self/revoke` `404`, `429` after the throttle, `cache-control: no-store` on
  every answer). The `200` test must fail on current `main` (it answers `404`): state in the PR
  that it was run red first.
- `lastUsedAt` in the `/self` answer is not `null` after the request (authentication sets it in
  memory, `api docs/rest-api.md:484`).
- Docs: `docs/rest-api.md` route table (`:32`), the scopes table (`:451`), the Tokens table
  (`:477-481`) and the statuses get the `/self` row; `docs/operation.md` "Token rotation" says a
  client can confirm its identity with `/self`.

Tool facts (api `main` 32704fd; config pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`, read with
`gh api "repos/lorenzh/pulse-config/contents/<path>?ref=04108fa…"`; both pinned files below are
byte-identical to the config clone, checked with `diff -q`):

- Runtime: Bun 1.4.0 (`package.json:8-10` `engines.bun`, `package.json:35` `packageManager`).
- Scripts: `typecheck` = `bun node_modules/typescript7/bin/tsc --noEmit` (`package.json:14`),
  `test` = `bun test` (`package.json:15`), `lint` = `biome check . && pulse-eslint . &&
  pulse-workflows` (`package.json:16`), `check` = `bun run lint && bun run typecheck && bun run
  test` (`package.json:20`). Pins: `@biomejs/biome` 2.6.3 (`package.json:23`),
  `@lorenzh/pulse-config` at the pin (`package.json:24`), `typescript7` = `typescript@7.0.2`
  (`package.json:27`).
- Test runner: `[test]` with `coverage = true`, `coverageThreshold = { lines = 0.8, functions =
  0 }` and the ignore patterns `**/*.test.ts`, `test/**`, `**/test/**`, `dist/**`
  (`bunfig.toml:1-4`).
- CI: job `check` = `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`
  (`.github/workflows/ci.yml:17-18`), without the `build` input. The pinned `check.yml` sets up
  Bun 1.4.0 (`check.yml:22-24`), then runs `bun install --frozen-lockfile` (`:25-26`),
  `bun run lint` (`:27-28`), `bun run typecheck` (`:29-30`) and `bun run test` (`:37-38`); the
  build steps (`:31-36`) are skipped because `build` defaults to `false` (`:6-9`).
- Biome scope: `biome.json:1-3` only `extends` `@lorenzh/pulse-config/biome.json`; the pinned
  file includes `**` minus `**/dist`, `**/node_modules`, `**/bun.lock`, `**/*.html` and
  `**/test/fixtures` (`biome.json:10-17` of config), with `ignoreUnknown` (`:9`) and the
  `.gitignore` honoured (`:3-7`). So `src/token-routes.ts` and `src/server.tokens.test.ts` are
  in scope; `noNonNullAssertion` is off only in `**/*.test.ts` and `**/test/**` (`:53-64`).

**Completion evidence.** `bun run check` passes; the PR names the red-first run of the `/self`
test; `bun start` with an admin token and one `curl -sS "$API/admin/tokens/self" -H
"Authorization: Bearer $TOKEN"` answers `200` (report the status and the keys, not the body);
the two `test_cpu_s` medians of the Performance impact method (`bash -c 'bun run test
>/dev/null 2>&1; times'`, 3 runs per side).

## Repository: console

Files:
- `src/navigation.ts`
- `src/server.ts`
- `src/settings.ts`, `src/settings.test.ts`
- `src/main.ts` (only if the new settings need wiring there)
- `src/connection-test.ts`, `src/connection-test.test.ts`
- `src/api-failure.ts` (new `ApiCall` values `tokens`, `self`, `token`, `locations`)
- `src/token-read.ts` (new: list, get, self and locations reads)
- `src/token-write.ts`, `src/token-write.test.ts` (new: guard order, outbound create/rotate/revoke, outcome mapping, People row)
- `src/token-view.ts`, `src/token-view.test.ts` (new: state texts, presets, grouping, last-admin rule, revision)
- `src/token-routes.ts` (new: `/tokens*` routes)
- `src/token-pages.ts` (new)
- `src/probe-routes.ts` (new: `/probes*` routes)
- `src/probe-pages.ts` (new)
- `src/probe-snippet.ts`, `src/probe-snippet.test.ts` (new: names, env command, docker run, Compose file and command)
- `src/shell-line.ts` (doc comment: no longer "the only builders"; `shellQuote` is reused)
- `src/people-log.ts`, `src/people-log.test.ts` (actions `token.create`, `token.rotate`, `token.revoke`; target kind `token`)
- `src/console-script.ts` (countdown, `data-secret` clearing)
- `src/styles.ts` (only if the new tables need styles)
- `src/server.tokens.test.ts`, `src/server.probes.test.ts` (new, real server)
- `src/server.setup.test.ts` (the `/self` call and the fallback)
- `src/navigation.test.ts`
- `test/fake-api.ts`, `test/token-fixtures.ts` (new)
- `e2e/run.ts`
- `README.md`, `docs/configuration.md`, `docs/tokens.md` (new), `docs/index.md`, `AGENTS.md`

Behavior change: yes. Two new screens, new settings and a changed setup call.

**Behavior.** Sections 2 to 7. Route registration in `protectedRoutesOf`
(`src/server.ts:1117-1129`) next to `teamRoutes` and `checkRoutes`; every route's `requiredRole`
from `routeRole("token.write")` or `routeRole("probe.write")` (`src/permissions.ts:89`); the
navigation entries `tokens` and `probes` (`src/navigation.ts:42-43`) become available, and the
navigation test pins it. Reads follow `readApi`/`readFailureOf` (`src/api-read.ts:28-69`); the
writes follow the check write pattern (`src/check-write.ts:43-64`, `:135-214`) with a token
outcome classifier, since create and rotate need the answer body. The api base URL is the stored
instance URL as in `src/check-routes.ts:71-73`. Every page is rendered with `escapeHtml`; the
dispatcher's no-store header (`src/http-context.ts:94`) covers the secret pages. No new runtime
package; no change to the CSP.

Module boundaries: snippets are pure (`probe-snippet.ts`, no I/O); views are pure
(`token-view.ts`); I/O stays in the route modules through the injected `fetch`, `now` and
`schedule`. Clock-dependent texts (state, countdown, last admin) take `now` from the deps.

**Checks.**

- Unit: `probe-snippet.test.ts` covers every snippet and naming counterexample, with literal
  expected strings written in the test (not built with the code under test). It also checks that
  the docker-run text, Compose file and Compose command do not contain the secret, and that the
  env command contains it exactly once. `token-view.test.ts` covers presets (exact scope arrays
  as literals), state texts with an injected `now`, grouping by exact location, the last-admin
  rule, the revision (a change of `lastUsedAt` keeps it, a change of `revokedAt` changes it) and
  the countdown values of the counterexamples. The Compose start, restart and stop lines are
  compared with literals that hold `-p '<base>' -f '<base>.compose.yaml'` (the "Compose project"
  counterexample). `token-write.test.ts` covers every outcome row with a fake fetch, that
  nothing is retried, and the People-log rule of section 6 with a store whose `appendPeople`
  throws: timeout and wire mismatch keep the unknown text with neither "Saved in pulse-api." nor
  "could not be written" (one `error` log line, 1 write); a confirmed create, rotate and revoke
  add `SAVED_NOT_LOGGED_TEXT`; the lost-answer `502` adds only "The People log row could not be
  written.".
- HTTP (real server, port 0, fake api): `server.tokens.test.ts` and `server.probes.test.ts` cover,
  for Owner and Admin: list, create with each preset, show once, rotate, revoke with typed name;
  for Member and Viewer: `403` on every GET and forged POST, 0 api writes; own-token forged
  rotate/revoke `409` with 0 writes; last-admin; grant; stale; lost answer; replay `409` with 1
  api write; self `404` (banner, every mutation `503`, 0 writes); `GET /locations` failure; the
  role or session removed between GET and POST (`writeGuardProblem`) with 0 writes; People rows
  with no secret; and a scan of the test database file for the fake secrets (0 hits). The
  `/probes` tests cover every row of the location state table.
- `server.setup.test.ts`: the section 2 fallback rows.
- Browser (`bun run check:browser`, `e2e/run.ts`, Playwright and axe as today) against the fixture
  console and fake api: Tokens create → secret visible in `#token-secret`, copy button works where
  the clipboard is available, navigate away and Back → no `pulse_` text in the DOM; revoke with
  typed name; Probes add → the four `<pre>` blocks; rotate shows the countdown and the timer
  counts of the Performance impact section (`0` intervals on `/tokens` and the create result,
  `1` on the rotate result, `0` active after a 2000 ms countdown ended); no CSP violation;
  no horizontal scroll at 390 px and 1280 px; keyboard focus order through the forms; JavaScript
  off: create and revoke work and the snippet text is selectable.
- Manual `agent-browser` check (#566 acceptance), as in the #718 spec (check 13) against
  `bun e2e/run.ts --serve`: sign in, create a token (secret shown), reload the POST answer
  (`Already submitted`), revoke a token with its typed name, add a location (snippets shown), and
  try to revoke the console's own token (no form, `409` on a forged POST with `curl` and the
  session cookie). The PR lists the commands and the secret-free outcomes.
- AGENTS.md "End-to-end checks" lists the two new `server.*.test.ts` files; README and
  `docs/configuration.md` list the three settings in the order of section 7; `docs/tokens.md`
  describes both screens, the presets, show once, rotation overlap, the own-token rule, the
  location states, the snippets and their prerequisites (network, reachable API URL, image).

Tool facts (console `main` c78c9d5; config pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`;
the pinned `check.yml` and `biome.json` are byte-identical to the config clone, checked with
`diff -q`):

- Runtime: Bun 1.4.0 (`package.json:8-10`, `package.json:35`).
- Scripts: `typecheck` runs `tsc --noEmit` for the root and for `-p e2e` (`package.json:13`),
  so `e2e/run.ts` is type-checked; `test` = `bun test` (`package.json:14`); `lint` = `biome
  check . && pulse-eslint . && pulse-workflows` (`package.json:15`); `check` = `bun run lint &&
  bun run typecheck && bun run test` (`package.json:18`); `check:browser` = `bun e2e/run.ts`
  (`package.json:19`). Pins: `@axe-core/playwright` 4.14.0 (`package.json:22`),
  `@biomejs/biome` 2.6.3 (`:23`), `@lorenzh/pulse-config` at the pin (`:24`), `playwright`
  1.64.1 (`:28`), `typescript7` = `typescript@7.0.2` (`:29`).
- Test runner: `[test]` with `coverage = true`, 80 % line threshold and the ignore patterns
  `**/*.test.ts`, `test/**`, `**/test/**`, `dist/**` (`bunfig.toml:1-4`); so `test/fake-api.ts`
  and `test/token-fixtures.ts` are not counted.
- CI `check`: `.github/workflows/ci.yml:17-18` uses the pinned `check.yml` without `build`; it
  sets up Bun 1.4.0 (`check.yml:22-24`) and runs install (`:25-26`), `bun run lint`
  (`:27-28`), `bun run typecheck` (`:29-30`), `bun run test` (`:37-38`).
- CI `browser`: `.github/workflows/ci.yml:270-287`: Bun 1.4.0 (`:279-281`), `bun install
  --frozen-lockfile` (`:282-283`), `bunx playwright install --with-deps chromium` (`:284-285`),
  `bun run check:browser` (`:286-287`).
- CI `deploy-dev`: `.github/workflows/ci.yml:210-268` checks out deploy, api, probe, status and
  notify at `main` (`:220-249`), starts `dev/compose.yaml` with `--build` (`:252-253`), waits
  (`:254-255`) and runs `E2E_CONSOLE_FLOW=two-factor bash e2e/console-setup.sh
  dev/compose.yaml` (`:256-258`). It does not run `e2e/console-probes.sh`; that runs only in
  deploy's `e2e-dev`.
- Biome scope: `biome.json:1-3` only extends the config file; the pinned file includes `**`
  minus `**/dist`, `**/node_modules`, `**/bun.lock`, `**/*.html`, `**/test/fixtures`
  (config `biome.json:10-17`), so `src/`, `test/` and `e2e/` are all in scope;
  `noNonNullAssertion` is off only in `**/*.test.ts` and `**/test/**` (config `biome.json:53-64`).

**Completion evidence.** `bun run check` and `bun run check:browser` pass; the agent-browser
commands and outcomes in the PR; `PULSE_API_URL=http://localhost:3000 bun start` against a local
api built from api `main` with this spec's api change (or, before it is merged, the PR states that
mutations showed the section 3 banner against an api without `/self`).

## Repository: deploy

Files:
- `dev/compose.yaml`
- `dev/README.md`
- `e2e/console-lib.sh` (new: `req`, `location`, `csrf`, `form_token_args`, `expect`, `expect_location`, the TOTP wait, the setup-to-signed-in-owner flow; moved from `e2e/console-setup.sh`)
- `e2e/console-setup.sh` (sources the library; behavior unchanged)
- `e2e/console-probes.sh` (new: the scenario below)
- `e2e/snippet.mjs` (new: prints the decoded text of one `<pre id>` of an HTML file)
- `e2e/snippet.test.sh` (new: fixture HTML with `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`)
- `e2e/compose-e2e.sh`
- `.github/workflows/ci.yml` (`lint` job runs `bash e2e/snippet.test.sh`; `e2e-dev` requires the new `ok:` line)
- `README.md` ("End-to-end test"), `AGENTS.md` (commands table and the CI line)

Behavior change: yes. New dev settings and a new e2e step and CI gate.

**Task cut.** Every task of this section is a behavior change (`behaviorChange: true`, the
section's line). The helper extraction (item 2) is not a task of its own: it is a pure move, so
alone it would have to be `false` and contradict this section. It goes into the same task as the
dev prefills (item 1), which add new settings to `dev/compose.yaml`; `bash
e2e/console-setup.test.sh` guards the move inside that task. The scenario, the trap, the CI gate
and the docs (items 3 and 4) form the second task.

**Behavior.**

1. `dev/compose.yaml` console service (`:87-105`) gets
   `PULSE_CONSOLE_PROBE_API_URL: http://api:3000`, `PULSE_CONSOLE_PROBE_IMAGE: pulse-probe:dev`
   and `PULSE_CONSOLE_PROBE_NETWORK: pulse-dev_default` (the project is `name: pulse-dev`,
   `dev/compose.yaml:5`). `pulse-probe:dev` is the dev tag of `dev/compose.yaml:51`, which the
   rules allow in dev (`scripts/check-setup.sh:63`); no `ghcr.io/lorenzh/pulse-` text appears
   outside `common/services.yaml` (rule 4). `full`, `minimal` and `demo` stay unchanged; the
   `full/README.md` text is not required. `dev/README.md` lists the three variables.
2. `e2e/console-lib.sh`: the shared helpers of `e2e/console-setup.sh:51-97` (`req` to `expect_location`), `:201-230` (`totp_after`, `password_step`) and the
   two-factor setup flow, sourced by both scripts with `# shellcheck source=e2e/console-lib.sh`
   and `source e2e/console-lib.sh` from the repository root (the convention of
   `e2e/compose-e2e.sh:866-867`). `bash e2e/console-setup.test.sh` passes unchanged (it is the
   guard of this move).
3. `e2e/console-probes.sh`, called by `compose-e2e.sh` as a new step "Console probe locations"
   placed before "Persistence across down and up" (`e2e/compose-e2e.sh:1090`). Its stack
   commands (`docker compose ps`, `logs`, `exec`) use the caller's exported `COMPOSE_FILE` and
   `COMPOSE_PROJECT_NAME=pulse-e2e` (`e2e/compose-e2e.sh:12`, `:25`), so the stack network is
   `pulse-e2e_default`. On `E2E_SETUP=full` the step prints
   `skip: console probe locations (published images)` and does nothing else.

   **Isolation of the snippets.** The parent environment overrides a Compose file's `name:`
   (`e2e/compose-e2e.sh:316-317` relies on exactly that), so every command that comes from a
   snippet (env command, `docker run`, Compose start, the rotation restart lines, and the
   cleanup `docker compose -p '<base>' -f '<base>.compose.yaml' down`) runs through one helper
   `snippet_run <text>` = `(cd "$work" && env -u COMPOSE_PROJECT_NAME -u COMPOSE_FILE -u
   COMPOSE_PROFILES -u COMPOSE_ENV_FILES -u COMPOSE_PATH_SEPARATOR bash -c "$text")`, where
   `$work` is the `mktemp -d` directory, which holds no `.env`. The snippet itself also carries
   `-p '<base>'` (section 5), so the isolation is defence in depth, not the only guard. Before
   the first launch the step records `stack_probe=$(docker compose ps -q probe)`; after each
   launch, after the rotation restart and after the cleanup it requires the same id, and it
   requires `docker ps -q --filter label=com.docker.compose.project=<compose base>` to list
   exactly one running container while the Compose snippet runs. A mismatch fails with
   `FAIL: the snippet touched the pulse-e2e probe`.

   **The one-interval rule (all three timed waits).** `now_ms` = `${EPOCHREALTIME/./}` divided by
   1000 under `LC_ALL=C` (bash 5 builtin, microseconds; host clock, which the containers share;
   `api_port` is the published api port that `compose-e2e.sh` already uses in `api()`,
   `e2e/compose-e2e.sh:115`, passed to the script as an argument). For a wait that
   starts at `t0`: `deadline = t0 + 10000`. Loop: `left = deadline - now_ms`; if `left <= 0`,
   fail. Otherwise one request `curl -fsS --connect-timeout <s> --max-time <s>
   "http://127.0.0.1:${api_port}/locations"` with `<s>` = `min(2000, left)` ms written as
   seconds with three decimals (curl takes fractions), then `t_done = now_ms`. The wait passes
   only when that answer lists the location with `lastResultAt >= t0` and `t_done <= deadline`.
   An answer that holds the result but finished after the deadline fails (the "One interval"
   counterexample). If the answer does not hold it, sleep `min(1000, deadline - now_ms)` ms (skip
   when not positive) and loop. So no request runs past the deadline and the observation itself
   happens inside the interval. The step prints `t_done - t0` in its `ok:` line as
   `(<n> ms)`.

   On `dev`:
   1. Set up the console and sign in the Owner with TOTP through the library (fresh
      `console-data`: `compose-e2e.sh` runs `down -v` first, `:361`).
   2. `GET /probes` → `200`. Add location `e2e-run` with `api_url=http://api:3000`,
      `image=pulse-probe:dev`, `network=pulse-e2e_default`, `block_private` off → `200`; read
      `#probe-env-command`, `#probe-docker-run` with `e2e/snippet.mjs`. The env command matches
      `PULSE_PROBE_TOKEN=pulse_[A-Za-z0-9_-]{43}` (checked, never printed).
   3. `GET /probes` shows `e2e-run` with `Awaiting first result`.
   4. In `$work`: `snippet_run` the env command, take `t0 = now_ms`, `snippet_run` the
      docker-run text, then the one-interval wait for `e2e-run`. 10000 is a literal: the
      `intervalMs` of `status-page`, `e2e-tcp` and `e2e-dns` in `e2e/ro/checks.json`, the largest
      interval of the checks this probe runs (`e2e-post` is skipped by the probe because
      `PULSE_HEADER_SVC_TOKEN` is not set, `probe src/client.ts:164`, `:289`; the checks added
      by "Checks via the admin API" also use 10000 or 4000, `e2e/compose-e2e.sh:954`, `:977`,
      `:997`). A new check runs after a random delay below 1000 ms (`probe
      src/scheduler.ts:39-46`), so the bound leaves room for the container start. The image is
      already built by the dev e2e ("Build the dev images", `e2e/compose-e2e.sh:364`), so no
      pull is timed. Print `ok: docker run probe e2e-run reported within 10 s (<n> ms)`.
   5. `GET /probes` shows `e2e-run` with `Reporting`.
   6. Add location `e2e-compose` the same way; save `#probe-compose-file` in `$work` as the file
      the page names, take `t0`, `snippet_run` `#probe-compose-command`; the one-interval wait;
      print `ok: compose probe e2e-compose reported within 10 s (<n> ms)`.
   7. Rotate the `e2e-run` credential through `/probes/rotate`; during the overlap both the old
      and the new secret answer `200` on `GET /probe/checks` (curl with the header built from the
      env files, output discarded, `--max-time 5`); `snippet_run` the new env command, take
      `t0`, `snippet_run` the shown `docker rm -f` line and then the docker-run text again; the
      container's environment holds the new secret (`docker inspect` of `Config.Env` compared
      with `grep -qxF`, output discarded, never printed); the one-interval wait for a result of
      `e2e-run` with `lastResultAt >= t0`; print
      `ok: rotated probe e2e-run reported within 10 s (<n> ms)`.
   8. Revoke the `e2e-compose` credential through `/probes/revoke` with the typed location; its
      secret now answers `401` on `GET /probe/checks`; `GET /locations` still lists
      `e2e-compose` (history kept).
   9. Secret scan: neither created secret, nor the rotated one, appears in the step output, in
      `docker compose logs` of console and api, or in the console database files (the scan
      pattern of `e2e/console-setup.sh` step 13).
   10. Remove the probe containers (`docker rm -f '<run base>'`) and the Compose project
       (`snippet_run "docker compose -p '<compose base>' -f '<compose base>.compose.yaml' down"`),
       check the stack's probe id once more, then print `ok: console probe locations`.
   The `cleanup` trap of `compose-e2e.sh` (`:70-97`) also removes both containers and the
   snippet Compose project through `snippet_run` (so the inherited `pulse-e2e` project is never
   the target of that `down`), then the work directory, all before its own `docker compose down
   -v` (`:89`), so a failed step never blocks the network removal. The bases are recorded in
   shell variables as soon as the page shows them, so the trap knows them after a failure.
   No file under `e2e/` contains the text `image:` (rule 3 of `scripts/check-setup.sh:60-66`
   greps `e2e`): the Compose file is only ever read from the page, and the fixture of
   `e2e/snippet.test.sh` uses another YAML key.
4. `.github/workflows/ci.yml` `e2e-dev` (`:295-301`) also requires
   `grep -qx 'ok: console probe locations' e2e-dev.log` after the existing
   `grep -qx 'ok: manual incident privacy' e2e-dev.log` (`:301`).

**Checks.** `shellcheck -x` and `bash -n` of every tracked `.sh` (`.github/workflows/ci.yml:34-37`);
`node --check` of every tracked `.mjs` (`:38-39`); `bash e2e/console-setup.test.sh` (`:50-51`);
`bash e2e/snippet.test.sh` (expected decoded strings are literals in the test; it also feeds a
`<pre>` with `&#39;` and `&amp;` and requires the literal decoded line); `scripts/check-setup.sh`
and `bash scripts/check-setup.test.sh` (`:52-55`; the dev settings keep rules 3 and 4);
`E2E_SETUP=dev bash e2e/compose-e2e.sh` with every sibling at `main` (api and console with this
spec merged) ends with `==> All checks passed` and prints the four new `ok:` lines (`docker run`,
`compose`, `rotated`, `console probe locations`); `bash e2e/compose-e2e.sh` (full, published
images) prints the skip line and passes as before. Isolation check before CI: in a shell with
`COMPOSE_PROJECT_NAME=pulse-e2e` exported, `snippet_run "docker compose -p '<base>' -f
'<base>.compose.yaml' config"` prints `name: <base>` (the literal base the page showed), and the
same command without `-p` and without the helper prints `name: pulse-e2e`; the PR records both
outputs.

Tool facts (deploy `main` 770eae0; config pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`, whose
`check.yml` and `biome.json` are byte-identical to the config clone, checked with `diff -q`):

- CI `lint` (`.github/workflows/ci.yml:19-63`, `ubuntu-24.04`): "Tool versions (Compose >=
  2.23)" (`:26-33`); "shellcheck and bash -n" = `git ls-files -z '*.sh' | xargs -0 shellcheck
  -x` and `… | xargs -0 -n 1 bash -n` (`:34-37`), so a new `.sh` is checked once it is tracked;
  "node --check" of every tracked `.mjs` (`:38-39`); "jq empty" of every tracked `.json`
  (`:40-41`); the stub test `bash e2e/console-setup.test.sh` (`:50-51`); `scripts/check-setup.sh`
  (`:52-53`) and `bash scripts/check-setup.test.sh` (`:54-55`). The new step `bash
  e2e/snippet.test.sh` goes next to `:50-51`.
- CI `e2e-dev` (`.github/workflows/ci.yml:250-305`): checks out api, probe, status, notify and
  console at `main` (`:258-287`), prints their revisions (`:288-292`), runs `E2E_SETUP=dev bash
  e2e/compose-e2e.sh | tee e2e-dev.log` with `pipefail` (`:295-300`) and greps `ok: manual
  incident privacy` (`:301`); teardown `docker compose -p pulse-e2e … down -v` (`:302-305`).
- CI `check` (`.github/workflows/ci.yml:16-17`) uses the pinned `check.yml` (Bun 1.4.0
  `check.yml:22-24`; lint, typecheck, test `:27-30`, `:37-38`) on the CLI; `test` = `bun test
  --coverage cli` (`package.json:13`), `lint` = `biome check . && pulse-eslint . &&
  pulse-workflows` (`package.json:14`), Biome 2.6.3 (`package.json:21`). None of this section's
  files are in that job's test or Biome scope.
- Biome scope: deploy's `biome.json:3-28` replaces the inherited `files.includes` (config
  `biome.json:10-17`, `**` minus dist, node_modules, bun.lock, html, test fixtures) with
  `cli/**` and the root config files (`biome.json:5-11`) and excludes `!dev` (`:16`) and `!e2e`
  (`:17`), so no file of this section is linted by Biome; shellcheck, `bash -n` and `node
  --check` are its checks.

**Completion evidence.** The CI jobs `lint` and `e2e-dev` pass on the PR; the PR lists the new
`ok:` lines from `e2e-dev.log` and the service revisions it ran against (the job prints them,
`.github/workflows/ci.yml:288-292`), with no secret in the log.

## Acceptance evidence

1. **api** `/self`: the red-first `server.tokens.test.ts` case and `bun run check` (expected
   values are literals: status `200`, `401`, `403`, `404`, `405`, `429`; the row is compared with
   the row the test created through `POST /admin/tokens`, a separate call).
2. **console** create, show once and revoke: `server.tokens.test.ts`, `server.probes.test.ts`,
   `bun run check:browser` and the agent-browser record in the PR. Write counts in the fake api
   (`0`, `1`) and scopes (`["read","checks","admin"]`) are literals.
3. **deploy** snippet runs: `E2E_SETUP=dev bash e2e/compose-e2e.sh` in `e2e-dev` prints lines
   that start with `ok: docker run probe e2e-run reported within 10 s (`,
   `ok: compose probe e2e-compose reported within 10 s (` and
   `ok: rotated probe e2e-run reported within 10 s (`, and the exact line
   `ok: console probe locations` (the CI gate). The 10 s bound is the literal 10000 ms, the
   `intervalMs` of `status-page` in `e2e/ro/checks.json`; each pass needs an answer of pulse-api's
   `GET /locations` (an independent service, not the console under test) that finished by
   `t0 + 10000` ms on the host clock and holds `lastResultAt >= t0`. The stack's `probe`
   container id is unchanged across every snippet command (compared with the id read before the
   first launch, a separate `docker compose ps -q probe` call).

## Risks

- **bfcache with `no-store`.** Browsers may keep a `no-store` page in the back/forward cache.
  The `pagehide` clearing handles it with JavaScript; without JavaScript Back re-requests the POST
  and gets "Already submitted". The browser check tests the JavaScript path.
- **Network name.** `network` must be the real Compose network; the dev prefill
  `pulse-dev_default` only fits the default dev project. The help text and docs say how to find
  it (`docker network ls`).
- **Published images.** `full` stays on `0.1.0` until a release bump; its console has neither
  screen and its e2e skips the step. The probe image prefill is unset in `full`, so the person
  types the image (docs point to the pin in `common/services.yaml`).
- **Imported probe tokens** keep their file names (`probe <location> #<n>`); several credentials
  per location are normal and shown one by one.
- **lastUsedAt lag.** Persisted at most once a minute; after an api restart the shown value can
  be up to 60 s old. The Probes state uses `GET /locations`, not `lastUsedAt`.
