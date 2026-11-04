# Spec #565: api checks created in the database next to checks.json

## Goal

Checks created through the admin API live in the api's SQLite database. `checks.json` stays a
second, read-only source. Both feed one effective set that public reads, probes, heartbeats and
metrics use. Three problems of today go away:

- a GET of the admin view followed by a PUT loses header values and bodies, because the view
  holds header names and `hasBody` only (api `src/config-write.ts:121-144`, contract
  `src/admin.ts:61-71`);
- a rejected hand edit of the file leaves every admin write on `412`, because a write compares
  `If-Match` with the hash of the bytes on disk (api `src/config-write.ts:388-394`,
  `docs/operation.md:229`, "Until then a write gets `412`");
- an invalid or unreadable file at start stops the api before SQLite opens (api
  `src/start.ts:209-219`, `docs/operation.md:212`, "A start with an invalid file still fails").

The api also gets an "Export as checks.json" of the effective set.

## Inputs and decisions

- Issue review `.factory/work/565/issue-review.md` (no blocking question). The owner decisions of
  #460 (decision 4 and the clarification of 2 November, sections 1 and 8) bind this spec:
  file checks win and are read-only; database checks stay stored when shadowed; env reference names
  are visible; literal header values, bodies and heartbeat secrets are write-only with keep
  markers; host bindings stay only in the probe's `PULSE_PROBE_HEADER_HOSTS`; a database create
  cannot reuse an id of the applied file; a shadowed database entry allows only delete and export;
  `GET /admin/config` reports the file state `ok`, `invalid`, `unreadable` or
  `written-not-applied`, a safe message and the last apply time; the export holds env names and no
  literal values or bodies. Import is after the MVP.
- The issue has no comment with a later decision (only the Factory run notes).
- Clone heads read for this spec: api `2d4a6b2`, contract `7ce23aa`, deploy `621cbf0`, config
  `main` (pinned files compared below), status and console for consumers.

The open points of the review are decided as follows.

1. **Storage.** A new table `check_definitions` holds the database-owned definitions, apart from
   the runtime table `checks`. The runtime table keeps its role: it holds the effective set
   (`active = 1`), state and history, and `upsertChecks` (api `src/service.ts:1003-1021`) stays
   the one way to reconcile it. A migration never copies runtime rows into `check_definitions`.
2. **Effective set.** Effective = every check of the applied file, in file order, then every
   database definition whose id is not in the applied file, in creation order. A database
   definition whose id is in the applied file is *shadowed*: it stays stored, unchanged, and is
   listed apart. Runtime identity and history stay keyed by check id. A shadow or unshadow
   transition is an upsert of the same id with another definition, so state and incidents behave
   as they do today for a check changed in the file. The id never becomes inactive at that
   transition.
3. **Addressing.** `POST /admin/checks`, `PUT /admin/checks/:id` and `DELETE /admin/checks/:id`
   act only on database definitions. A file check is never changed by these routes.
4. **Lossless save.** Views carry `{ "env": NAME }` for env headers and `{ "keep": true }` for a
   stored literal header value and for a stored body. A view of a database check is a valid write
   body as it is, so GET, edit, PUT never loses a value.
5. **Revision.** One admin revision covers the applied file and the database:
   `sha256-` + hex SHA-256 of the UTF-8 text `<applied file revision>\n<database generation>`.
   The applied file revision is today's `sha256-<hex>` of the applied bytes (api
   `src/config-reload.ts:39-41`); the generation is an integer that every database check write
   raises by one. A rejected or not yet applied file does not change the admin revision.
6. **File state and start.** The api stores a redacted snapshot of the last applied file in the
   database. A start with an invalid or unreadable file uses that snapshot. Without a snapshot the
   start fails as today (exit 2); then no database check can exist yet (see "Startup").
7. **Heartbeat credentials.** A database heartbeat check stores only the SHA-256 digest of its
   secret. The ping route compares digests for both sources. The snapshot holds digests of file
   secrets, never the plaintext.
8. **Components and maintenance.** They stay in the file, written by the existing file writer.
   File components and windows may reference only file check ids, as today
   (api `src/config.ts:399-447`). A reference to a database-only id is a `422`. Database storage of
   components and windows is the follow-up of #460 sections 10 and 19.
9. **Export.** `GET /admin/config/export` returns one checks.json-shaped document of the effective
   set plus the file's components and windows, with env names and without literal values, bodies
   and secrets. A non-empty top-level `redacted` list names what was removed. That key is unknown
   to the file parser (api `src/config.ts:306-314`), so a redacted export cannot be loaded by
   accident. No separate single-check export route: a shadowed database entry is served in full
   redacted form in `shadowed`, which a client can export.
10. **Compatibility.** The admin shapes change incompatibly (contract `2.0.0`). Only the api
    produces them and only api tests consume them (console `src/` has no admin config use; status
    serves the contract files but uses no admin shape). Public and probe shapes do not change, and
    `WIRE_VERSION` stays `1` (contract `src/version.ts:5`).
11. **Deploy.** The deploy E2E pins api `0.1.0` (`common/services.yaml:8`; `v0.1.0` is the only
    api tag). It must stay green on that pin and also pass with an api image built from `main`
    after this change. It detects the feature from the shape of `GET /admin/config` and runs the
    database scenario only then. No pin moves in this spec.

## Scope

- contract: admin view, input, config response, file status and export shapes, validators,
  status order text, docs, `dist/`, version `2.0.0`.
- api: migration, definition store, effective set, database check writes, file state, start
  fallback, heartbeat digests, export route, docs, contract pin.
- deploy: E2E that passes on api `0.1.0` and on an api with database checks; doc lines that say
  check writes need a writable mount.

## Non-goals

- No import of a checks file into the database, and no automatic move of file checks.
- No database storage for components or maintenance windows. No reference from the file to a
  database-only id.
- No Console screen, no status change, no probe change, no notify change.
- No change of the public `GET /checks`, `GET /probe/checks`, `POST /results` or heartbeat shapes,
  and no `WIRE_VERSION` bump.
- No change of token scopes, the auth throttle, the 1 MB body limit, metric names or labels.
- No new runtime dependency. No new contract module file (see Risks).
- No move of any image pin in deploy.
- No pause or test run of a check, no new check type.

## Required behavior

### Effective set and precedence

1. The effective set is built as in decision 2 on every file apply, every database check write and
   at start. Public reads, `GET /probe/checks`, `POST /results`, heartbeat pings, the heartbeat
   evaluator, `availabilityTarget` and the metrics read the effective set (today they read
   `holder.get()` and the runtime rows: api `src/start.ts:228-256`, `:354`).
2. A file apply that adds id D, while a database definition D exists, serves the file definition
   of D from then on. The database definition stays unchanged in `check_definitions`.
3. A file apply that removes D while a database definition D exists serves the database
   definition again, with its heartbeat secret. The runtime row of D stays active; its incidents are
   not resolved by that apply.
4. Ids that no source supplies any more become inactive, as today (api `src/service.ts:1003-1021`).

### Admin check routes (database)

5. `POST /admin/checks` creates a database definition. It needs no writable file and never
   changes the file. An id that is in the applied file or in `check_definitions` answers `409`.
   An id that is on disk but not yet applied is accepted; the later apply shadows it (item 2).
6. `PUT /admin/checks/:id` replaces the database definition `id`. An id only in the file answers
   `409` (`check "<id>" comes from the checks file; edit the file`). A shadowed database id
   answers `409` (`check "<id>" is shadowed by the checks file; only delete is allowed`). An id
   in neither answers `404`.
7. `DELETE /admin/checks/:id` deletes the database definition `id`, also when it is shadowed. An
   id only in the file answers `409` (same text as item 6). An id in neither answers `404`. A
   database id can never be referenced by a file component or window (decision 8), so a delete has
   no reference conflict. After the delete of a shadowed copy the file definition stays
   effective; after the delete of an unshadowed one the id becomes inactive (item 4).
8. Status order of the check routes: `404` feature off, `401`, `403`, `413`, `400` (bad JSON, bad
   `If-Match`, body `id` not equal to the path), `428`, `412` (If-Match not equal to the current
   admin revision), `422` (schema, marker or secret error), `409`, `404` unknown id, `500` when the
   transaction fails (`check could not be stored`; nothing changed). The check routes never answer
   `503`.
9. A database check write runs under the writer's lock and commits in one SQLite transaction: the
   definition change, the generation step, the runtime reconcile of the effective set
   (`upsertChecks`) and the audit entry. The in-memory effective set and caches change only after
   the commit. A failed commit leaves the definition, generation, runtime rows, audit log and
   admin revision as before.
10. The audit entry keeps today's form: action `check.create|check.replace|check.delete`, target
    `{kind: "check", id}`, `revision` = the new admin revision. The log line `config write` and
    `pulse_api_config_writes_total{kind,action,result}` keep their names and labels (api
    `src/admin-routes.ts:215-218`, `src/metrics.ts:10-20`); a `409` counts as `conflict`, a `422`
    as `invalid`, a `412` as `stale`, a `500` as `error`.
11. Every success returns the new admin revision as `ETag`. `POST` answers `201` with the view and
    `Location: /admin/checks/<id>`, `PUT` `200` with the view, `DELETE` `204`.

### Lossless save (write-only values)

12. View of an HTTP check (`AdminCheckView`): `headers` is an object from header name to either
    `{ "env": NAME }` (the stored reference) or `{ "keep": true }` (a stored literal value);
    `body` is `{ "keep": true }` when a body is stored. `hasBody` and the names array are gone.
    Every view has `source`: `"file"` or `"database"`. A heartbeat view keeps `hasSecret: true`.
13. Write body (`AdminCheckInput`): an HTTP header value is a string (new literal), `{ env }` or
    `{ "keep": true }`; `body` is a string or `{ "keep": true }`; `source` may be present and must
    be `"database"`; on a heartbeat check `hasSecret: true` may be present; `secret` stays
    write-only. So the view of a database check can be sent back unchanged.
14. Markers resolve only against the stored database definition with the same id, never against a
    file check or another id. `{ "keep": true }` for header `N` takes the stored literal value of
    the stored header whose name equals `N` case-insensitively; the stored name becomes the name
    as sent. A keep marker on `POST`, for a header that has no stored literal value (absent, or
    stored as `{ env }`), or for a body when none is stored answers `422`
    (`check.headers.<name>: has no stored value to keep`, `check.body: has no stored value to keep`).
15. PUT is a full replace after marker resolution: an omitted `headers` removes all headers, an
    omitted header removes that header, an omitted `body` removes the body.
16. The materialized check (markers resolved, `source` and `hasSecret` dropped) passes the same
    field rules as a file check (api `src/config.ts:86-287`, the contract limits behind them). So
    a body with `GET` or `HEAD`, more than 20 headers, a probe-controlled header name, a duplicate
    name or more than 16 KiB of names and literal values answers `422`. Markers exist only in
    admin views (item 12) and admin write bodies (item 13). They never reach a stored row,
    `GET /probe/checks`, a public read or the export (see "Where values may appear").
17. Heartbeat: `POST` needs `secret` with the file rules (16 to 128 characters from
    `A-Z a-z 0-9 . _ ~ -`, not starting with `replace-with-`: api `src/config.ts:43-45`,
    `:196-201`, `src/tokens.ts:8`). `PUT` without `secret` keeps the stored digest when the stored
    definition is a heartbeat check; otherwise it answers `422` (`check.secret is required`). `PUT`
    with `secret` rotates it: the old one fails at the next ping.
18. Messages never quote a header value, body or secret.

### Where values may appear

This table is the single rule for every surface; items 12, 16, 31, 33, the security checklist
and the sentinel test (api check 4) refer to it. "yes" means the value may or must appear there;
"no" means it must never appear there.

| Surface | Literal header value | Request body | `{ env }` name | `{ "keep": true }` marker | Heartbeat secret (plaintext) | Heartbeat secret digest |
|---|---|---|---|---|---|---|
| Public reads (`/checks`, `/checks/:id/*`, `/components*`, `/incidents`, `/maintenance`) | no | no | no | no | no | no |
| `GET /probe/checks` (probe token, unchanged from today, api `docs/rest-api.md:134`) | yes | yes | yes | no | no | no |
| Admin views: `GET /admin/config` (`checks`, `shadowed`) and admin write responses | no | no | yes | yes | no (`hasSecret: true`) | no |
| `GET /admin/config/export` | no | no | yes | no | no | no |
| Audit entries, log lines, `/metrics`, error bodies, `file.message` | no | no | no | no | no | no |
| Column `check_definitions.check_json` (database checks) | yes | yes | yes | no | no | no |
| Column `check_definitions.secret_sha256` | no | no | no | no | no | yes |
| Columns `checks.headers_json`, `checks.body` (runtime, as today) | yes | yes | yes | no | no | no |
| Column `config_state.file_snapshot_json` (file snapshot, item 31) | yes | yes | yes | no | no | yes |
| Every other column of the database file | no | no | no | no | no | no |

The plaintext heartbeat secret of a database check exists only in the request that sets it; the
plaintext of a file heartbeat secret exists only in the file and in memory, as today.

### Admin config view and revision

19. `GET /admin/config` (`read` or `checks`, unchanged) answers `AdminConfigResponse`:
    `{ revision, checks, shadowed, components, maintenance, file }`. `checks` is the effective set
    as views with `source`. `shadowed` is the list of shadowed database definitions as views with
    `source: "database"`, in creation order. `file` is `AdminFileStatus` (items 23-26).
20. The admin revision is the formula of decision 5. It is the same before and after a rejected
    file read, a restart with the same applied file and generation, and an idle poll.
21. Two writes with the same `If-Match`: the first that runs under the lock succeeds, the second
    answers `412`. A refetch gives a revision that succeeds, also while the file stays broken.
22. Component and maintenance writes keep the file protocol (temp file, audit pending, fsync,
    rename, apply: api `src/config-write.ts:396-556`) and `503` for a directory that cannot take a
    new file. Their `If-Match` must equal the admin revision, and the file on disk must still have
    the applied file revision; otherwise `412`. When the disk differs, the message names the file
    state: `the checks file on disk differs from the applied one (<state>): fix or reload it, then
    retry`. They never touch database definitions.

### File state

23. `file.state` is `ok` after a read that was applied; `invalid` when the last read did not parse
    or validate; `unreadable` when the last stat or read failed; `written-not-applied` when a
    valid file (read by a poll, `SIGHUP`, or stored by a component or maintenance write) could not
    be applied.
24. `file.message` is `null` for `ok`. Otherwise it is the safe text of today's warn line without
    the path: the parser message (it never quotes a value, api `src/config.ts:205-219`), or
    `cannot read the file (<CODE>)`, or `cannot apply the configuration: <name> <code>` (api
    `src/config-reload.ts:52-71`).
25. `file.lastAppliedAt` is the epoch ms of the last successful file apply (start, poll, `SIGHUP`
    or component/maintenance write). A database write never changes it. It survives a restart
    through the snapshot.
26. A failed read or apply keeps the last applied file set in use. Fixing the file and the next
    poll or `SIGHUP` applies it, sets `ok`, moves `lastAppliedAt` and keeps every database
    definition. The retry of a failed apply at every poll stays (api `src/config-reload.ts:100-135`),
    and the same bad file is still logged once, not at every poll.

### Startup

27. The api opens the database before it reads the file.
28. A valid file: apply it, write the snapshot when its revision differs from the stored one.
29. An invalid or unreadable file with a snapshot: start with the snapshot as the applied file
    set (checks with their options, heartbeat digests, components, windows, revision, apply time),
    set the file state, log one `warn` line `config load rejected at start: <message>; using the
    checks file applied at <ISO time>`, and serve database checks as usual.
30. An invalid or unreadable file without a snapshot: fail with exit 2 as today. A database check
    is created only by a running api, and every running api has applied a file once, which writes
    the snapshot. So no database definition can exist without a snapshot (a restore of an older
    backup aside, which brings its own snapshot or none and no newer definitions).
31. The snapshot lives in `config_state.file_snapshot_json`. It holds the parsed file checks with
    their literal header values, `{ env }` references and bodies (the same values that the
    runtime columns `checks.headers_json` and `checks.body` already store for file checks, so this
    adds no new class of plaintext at rest), the SHA-256 digests of the file heartbeat secrets, the
    components, the windows, the file revision and the apply time. It never holds a plaintext
    heartbeat secret or a keep marker. This storage is allowed by "Where values may appear" and
    the sentinel test (api check 4) expects it.

### Heartbeat pings

32. The ping route compares SHA-256 digests in constant time, for both sources: the digest of the
    sent secret against the digest of the effective check's secret (api `src/server.ts:297-302`
    today compares digests of the plaintext). An unknown id and a wrong secret still answer alike
    (`401`).

### Export

33. `GET /admin/config/export` needs the same permission as `GET /admin/config` (`config-read`:
    `read` or `checks`). Env names are already visible to that permission (item 12). It answers
    `200` with `content-type: application/json; charset=utf-8`,
    `content-disposition: attachment; filename="checks.json"`, `cache-control: no-store` and the
    admin revision as `ETag`. The body is `AdminConfigExport`, as JSON with two spaces and a final
    newline: `checks` (the effective set in effective order, as file checks: `{ env }` headers
    kept, literal headers, `body` and heartbeat `secret` left out), `components` and `maintenance`
    of the applied file (window times as ISO 8601 UTC strings, the file format), and `redacted`
    only when something was left out.
34. `redacted` is a list of `{ checkId, field }`, in check order: `field` is `headers.<name>` per
    removed literal header, `body`, or `secret` for every heartbeat check. Shadowed definitions are
    never in the export. Any query parameter answers `400`. Other methods answer `405`
    (`Allow: GET`).
35. Docs say plainly: an export with `redacted` cannot be loaded as a checks file until the
    operator puts the listed values back (heartbeat secrets new) and removes `redacted`.

## Risks

- **Status serves contract files by name.** Status allows only the listed contract `dist` modules
  (status `src/server.ts:189-205`). A new contract module file imported by `index.ts` would break
  the status browser bundle at its next contract pin. The contract change keeps every new export
  in `src/admin.ts` and `src/validate-admin.ts`.
- **Many existing api tests assume check writes go to the file** (`config-admin.test.ts`,
  `config-write.audit.test.ts`, `config-write.crash.test.ts`, the sentinel test at
  `config-admin.test.ts:770-791` that bans env names from admin output). Tests of the file
  protocol move to component or maintenance writes, so audit-pending and crash coverage stays.
  The sentinel test keeps banning literal values, bodies and secrets from admin output; env names
  become expected in admin views and the export, and stay expected in `GET /probe/checks` (see
  "Where values may appear").
- **Downgrade.** Migration step 6 makes an older api refuse the database (api `AGENTS.md`, "A file
  from a newer program is refused"). A rollback needs the backup taken before the upgrade. The
  operation docs say so.
- **An api `main` image in the deploy stack next to pinned `0.1.0` probe, status, notify and
  console** may fail at another step for another reason. The implementer of deploy records the
  step and holds with `needs-input`; it does not widen the change.
- **Runtime reconcile per database write** costs one `upsertChecks` of the whole effective set,
  like a file reload today. With 1,000 checks it is a few ms of SQLite work per admin write;
  admin writes are rare.
- **Literal values at rest.** Literal header values and bodies of database checks sit in
  `check_definitions.check_json` and in the runtime table; those of file checks sit in the runtime
  table (as today) and in `config_state.file_snapshot_json`. A database backup holds them. No new
  class of plaintext at rest; heartbeat secrets of both sources are stored only as digests.

## Performance impact

Metrics of api `bench/budgets.json`:

- `startup_cpu_ms` (gating, budget 325): slightly up, by under 10 ms. The start reads
  `check_definitions` and `config_state` and writes the snapshot only when the file revision
  changed. Opening the database before the file does not add work.
- `startup_wall_ms` (reported): same as above, plus one fsync of the snapshot write when the file
  changed; under 20 ms.
- `load_cpu_s`, `p95_post_results_ms`, `rps` (gating / reported): none expected. Ingest and the
  result route are unchanged; the effective set lives in memory and is rebuilt only on a write or
  an apply. The heartbeat ping already hashes the sent secret.
- `p95_get_checks_ms`, `p95_get_latency_ms`, `p95_get_check_latency_ms`, `cold_*`, `eod_*`,
  `cold_read_cpu_ms`, `eod_read_cpu_ms`: none expected. Reads still use the runtime table and the
  existing cache; no union is built per read.
- `idle_rss_mib`, `peak_rss_mib` (gating): none measurable. The effective set and snapshot are
  bounded by the configuration size (kilobytes for the bench fixtures). The idle poll stays one
  `stat`.
- `test_cpu_s` (gating, budget 5.6, floor 1.6): up by the new HTTP tests, expected under 0.8 s.
  The implementer keeps it under the budget.
- `image_mb`: none (no dependency).
- contract `test_cpu_s` (budget 9.0) and `build_cpu_s` (budget 6.4): up by the new schema tests and
  the larger `admin.ts`, under 0.3 s each.

How to measure: in the api repository, `bun bench/run.ts --a <main sha> --b <branch sha>`
(`bench/README.md:76`). Report `startup_cpu_ms`, `idle_rss_mib`, `peak_rss_mib`, `load_cpu_s`
and `test_cpu_s` of both sides in the pull request. A gating metric over its budget is a hold, not
a budget change.

## Security impact

Security impact: yes
The change touches admin routes, validators at a trust boundary (contract), heartbeat
authentication, storage of credentials, error texts, a dependency pin (contract) and CI (deploy
E2E).

Checklist items that apply:

- **Secrets in errors, logs and responses.** The table "Where values may appear" is the rule per
  surface. In short: literal header values, bodies and heartbeat secrets never appear in an admin
  view, the export, an audit entry, a log line, a metric or an error message. `GET /probe/checks`
  keeps serving literal values, bodies and env references to a probe token, as today, and never
  a marker or a heartbeat secret. Env names appear in admin views, the export and
  `GET /probe/checks`, never in public reads, audit entries, logs, metrics or errors. Keep
  markers appear only in admin views. The file state message never holds the path or a file value
  (item 24). The sentinel test (api check 4) proves each row.
- **Auth order and status codes.** Throttle and auth come first, unchanged (api
  `src/admin-routes.ts:170-189`). The export uses `config-read`. A probe token gets `403` on every
  admin route. Status order: item 8 and the contract `ADMIN_STATUS_ORDER`.
- **Body and size limits.** `ADMIN_MAX_BODY_BYTES` (1 MB) and all check limits stay; the materialized
  check is validated after marker resolution (item 16).
- **Input validation.** Strict input; `source` only `"database"`; `hasSecret` only `true` and only on
  heartbeat; markers only `{ "keep": true }` exactly (no extra keys); unknown fields `422`.
- **Accessor execution.** Request bodies come from `JSON.parse` (plain data). The contract
  validators keep their own-data rules (contract `src/validate-admin.ts:30-36`).
- **SSRF and redirects.** An admin can point a database check with an `{ env }` header at any URL,
  as with a file write today. The probe's `PULSE_PROBE_HEADER_HOSTS` stays the limit (api
  `docs/operation.md`, "Admin tokens and header secrets"); no probe change.
- **Atomic, path-safe writes.** Database writes are one transaction (item 9). The file writer keeps
  its protocol for components and windows and never rewrites a broken file as a side effect.
- **Credentials.** Database heartbeat secrets are stored as SHA-256 digests (like token secrets,
  api `src/token-digest.ts`); comparison stays constant-time.
- **Dependency pins.** The api moves its contract pin to the merged contract `main` SHA. No other
  dependency. Deploy changes no action, image or pin.

## Rollout order

1. **contract** merges `2.0.0`. No consumer moves: api, probe, status, notify and console stay on
   their pinned SHAs (`7ce23aa` in api) and keep working. Status, when it later bumps, still finds
   every module it serves, because no module file is added.
2. **api** pins the merged contract and merges. Probes (`0.1.0` and `main`), status and notify
   against this api keep working: `GET /checks`, `GET /probe/checks`, `POST /results`, heartbeat
   pings, `/components*`, `/incidents`, `/maintenance` and the wire header do not change. The
   console scaffold reads no admin config. Admin clients other than tests do not exist yet. An
   existing database migrates to step 6 on start; the first start applies the file and writes the
   snapshot.
3. **deploy** merges the version-tolerant E2E. CI still runs api `0.1.0` and the file path. Run B
   of its acceptance proves the database path with an image of the merged api `main`. A later
   bump with `scripts/bump-images.sh api=<x.y.z>` (a person, after an api release) switches CI to
   the database path without another deploy change.

## Counterexamples

| # | Rule | Input or case | Expected | A wrong implementation that fails it |
|---|---|---|---|---|
| 1 | precedence | DB check D (name "db"), then a file with D (name "file") is applied | `/checks` and `/probe/checks` show "file"; `shadowed` has D with name "db" | DB wins, or the DB row is overwritten by the file |
| 2 | unshadow | then D is removed from the file | D effective with name "db"; runtime row stays active; no incident of D resolved | apply deactivates D, then reactivates it |
| 3 | create collision | POST id that is in the applied file | `409` | creates it and shadows it at once |
| 4 | create on disk only | file on disk gains D but is not applied yet; POST D | `201`; after the apply, D is shadowed | rejects by reading the disk |
| 5 | file entry read-only | PUT or DELETE of a file-only id, file writable | `409`, file bytes unchanged | edits the file as today |
| 6 | shadowed | PUT of a shadowed DB id | `409`; DELETE of it `204`, file D stays effective | PUT succeeds and changes nothing visible |
| 7 | round trip | POST with literal `x-token: S1`, `x-env: {env: PULSE_HEADER_A}`, body `B1`, method POST; GET; set `name` only; PUT the view as it is | `/probe/checks` has `x-token: S1`, `x-env: {env: PULSE_HEADER_A}`, body `B1` | view without values, so PUT drops them |
| 8 | keep on create | POST with `x-token: {keep: true}` | `422` | stores the marker |
| 9 | keep without value | PUT `x-env: {keep: true}` where `x-env` is stored as `{env}` | `422` | keeps the env reference or stores the marker |
| 10 | keep case | stored `X-Token: S1`; PUT `x-token: {keep: true}` | stored `x-token: S1` | case-sensitive lookup answers `422` |
| 11 | keep from another source | file D has literal `x-token: F1`, DB D shadowed; DELETE file D; PUT DB D with `{keep: true}` | keeps the DB value | resolves against the file value |
| 12 | materialized validation | stored body `B1`, PUT with `method: "GET"`, `body: {keep: true}` | `422` | validates only the input shape |
| 13 | removal | PUT the view without `body` | stored body removed | omitted means keep |
| 14 | marker shape | `{keep: true, x: 1}`, `{keep: false}`, `{keep: "yes"}` | `422` | loose marker check |
| 15 | source field | PUT with `source: "file"` | `422` | ignores the field |
| 16 | heartbeat keep | PUT heartbeat without `secret` | old secret pings `200`/`204` as today | secret lost |
| 17 | heartbeat rotate | PUT with new `secret` | old secret `401`, new accepted | old one still valid |
| 18 | type change | PUT changes http to heartbeat without `secret` | `422` | heartbeat with no secret |
| 19 | revision stability | valid file applied, then a broken hand edit, then GET | same `revision` as before the edit | revision of the disk bytes |
| 20 | broken file writes | broken file; POST with the fresh revision | `201`; file bytes unchanged | `412` as today |
| 21 | lost update | two PUTs with the same `If-Match` | one `200`, one `412` | both succeed |
| 22 | stale after file apply | GET, then a valid file change is applied, then POST with the old revision | `412` | revision ignores the file |
| 23 | component write on broken file | broken file; POST /admin/components with the fresh revision | `412`, message names `invalid`, file unchanged | overwrites the operator's file |
| 24 | read-only mount | valid file on a read-only mount; POST /admin/checks | `201`; POST /admin/components `503` | `503` for checks |
| 25 | file state | invalid JSON / missing file / apply error / ok | `invalid` / `unreadable` / `written-not-applied` / `ok`, `message` `null` only for `ok` | one state for all failures |
| 26 | lastAppliedAt | a DB write at T2 after an apply at T1 | `lastAppliedAt` stays T1 | set at every write |
| 27 | restart with broken file | snapshot exists, file now invalid | start succeeds, file checks of the snapshot served, `invalid` reported | exit 2, or an empty file set that deactivates file checks |
| 28 | restart with no snapshot | fresh database, invalid file | exit 2 | start with an empty set |
| 29 | file heartbeat after fallback | restart with broken file; ping a file heartbeat with its secret | accepted | `401` because the plaintext is gone |
| 30 | no plaintext snapshot | file heartbeat secret `S` | `S` not in any column of the database file | stores the secret to support the fallback |
| 31 | export redaction | DB check with literal `x-token: S1`, env header, body `B1`; heartbeat with secret | export has the env header; `S1`, `B1`, the secret absent; `redacted` lists `headers.x-token`, `body`, `secret` | drops env names, or leaks values |
| 32 | export clean | only checks without literals, bodies or heartbeats | no `redacted` key; the document loads as a checks file | always adds `redacted` |
| 33 | export precedence | DB D shadowed by file D | export has file D only, once | lists both |
| 34 | upgrade | database of api `2d4a6b2` with 3 active file checks and history | after migration `check_definitions` is empty; results and incidents kept | imports runtime rows as editable checks |
| 35 | reference | POST /admin/components with `checkIds: ["db-only"]` | `422` | accepts a reference the file cannot hold |
| 36 | failed commit | the audit insert fails inside the transaction | `500`, definition, generation, runtime row and revision unchanged | definition stored without audit |
| 37 | marker never served to probes | PUT with `x-token: {keep: true}` over stored `S1`; GET /probe/checks | `x-token: "S1"`, no `keep` key anywhere in the response | the marker is stored or served |
| 38 | env names per surface | DB check with header `x-env: {env: PULSE_SENTINEL_DB_ENV}` | name present in GET /admin/config, the export and GET /probe/checks; absent from `/checks`, audit entries, logs and `/metrics` | strips env names from admin views (as today), or logs them |
| 39 | snapshot storage | file check with literal `x-token: F1` and heartbeat secret `S` applied | `F1` in `config_state.file_snapshot_json`; `S` in no column, its hex SHA-256 in the snapshot | snapshot without literals (fallback serves a broken check), or with `S` |

There are no statistics in this change. The admin revision is the exact formula of decision 5;
the generation starts at `0` and is raised by exactly `1` per committed database check write.

## Contract fields

New or changed names. Searches on the clones (run from `.repos/`); each prints nothing (count 0)
unless noted:

```
$ for n in ADMIN_CHECK_SOURCES adminCheckSourceSchema AdminCheckSource ADMIN_FILE_STATES \
    adminFileStatusSchema AdminFileStatus adminKeepSchema AdminKeep adminConfigExportSchema \
    AdminConfigExport validateAdminConfigExport adminExportRedactionSchema AdminExportRedaction \
    'config/export' check_definitions config_state database_generation file_snapshot_json \
    shadowed lastAppliedAt 'keep:' written-not-applied; do
    grep -rn -- "$n" contract/src config/src config/bin api/src | grep -v node_modules | wc -l; done
0 (for every name)
$ grep -rn redacted contract/src api/src | grep -v test
contract/src/admin.ts:162: * Body of a successful admin write: the redacted entity that was stored. ...
api/src/config-write.ts:80:  /** The stored entity, redacted; absent after a delete. */
$ grep -rn secret_sha256 api/src | grep -v test | head -2
api/src/token-store.ts:113:  secret_sha256: string;
api/src/token-store.ts:170:    .query("SELECT secret_sha256, token_id, retires_at FROM token_secrets")
$ grep -rn 'source' contract/src/admin.ts contract/src/tokens.ts
contract/src/admin.ts:51:  .regex(ADMIN_REVISION, { error: `must match ${ADMIN_REVISION.source}` });
contract/src/tokens.ts:106:      source: z.enum(["api", "file"], { error: 'must be one of "api", "file"' }),
$ grep -rn 'removed from the configuration\|PULSE_SENTINEL' api/src contract/src config/src | wc -l
0
```

- `redacted` appears only in comments, never as a key: no collision.
- `secret_sha256` is the column name of `token_secrets`; the new column of the same name in
  `check_definitions` has the same meaning (SHA-256 of a credential) in another table.
- `source` exists on the admin *token* view (`"api" | "file"`, contract `src/tokens.ts:106`). The
  new `source` on the admin *check* view is another schema (`"file" | "database"`); no shared type.

Contract (all in `src/admin.ts` and `src/validate-admin.ts`, exported from `src/index.ts`):

| Name | Kind | Shape |
|---|---|---|
| `ADMIN_CHECK_SOURCES`, `adminCheckSourceSchema`, `AdminCheckSource` | const, schema, type | `"file" \| "database"` |
| `adminKeepSchema`, `AdminKeep` | schema, type | strict `{ keep: true }` |
| `AdminCheckView` (changed) | type | every variant gets `source`; HTTP `headers` becomes `Record<string, {env} \| AdminKeep>`, `body?: AdminKeep`, `hasBody` removed |
| `AdminCheckInput` (changed) | type | HTTP `headers` values `string \| {env} \| AdminKeep`, `body?: string \| AdminKeep`; optional `source: "database"`; heartbeat optional `hasSecret: true` |
| `ADMIN_FILE_STATES`, `adminFileStatusSchema`, `AdminFileStatus` | const, schema, type | `{ state: "ok" \| "invalid" \| "unreadable" \| "written-not-applied", message: string \| null, lastAppliedAt: number }`; `message` is `null` exactly when `state` is `ok` |
| `AdminConfigResponse` (changed) | type | adds `shadowed: AdminCheckView[]` and `file: AdminFileStatus` |
| `adminExportRedactionSchema`, `AdminExportRedaction` | schema, type | strict `{ checkId: string, field: string }`, `field` is `body`, `secret` or `headers.<name>` |
| `adminConfigExportSchema`, `AdminConfigExport`, `validateAdminConfigExport` | schema, type, validator | strict `{ checks: Check[], components: Component[], maintenance: {checkId, start, end, note}[], redacted?: AdminExportRedaction[] }`; `start`/`end` ISO 8601 strings with offset; `redacted` has at least 1 item when present |
| `ADMIN_STATUS_ORDER` (changed text) | const | 503 `checks file not writable (component and maintenance writes)`; 409 `id exists, still referenced, a file check, or a shadowed database check` |

Api names: route `GET /admin/config/export`; tables `check_definitions` (`id`, `check_json`,
`secret_sha256`, `created_at`, `updated_at`) and `config_state` (one row: `id = 1`,
`database_generation`, `file_revision`, `file_applied_at`, `file_snapshot_json`); log line
`config load rejected at start`; changed log text `check "<id>" removed from the configuration:
incident resolved` (was `... removed from the checks file: ...`, api `src/service.ts:1016`,
`docs/operation.md:262`). Config (`.repos/config`) holds no admin or check names; nothing
there changes.

## Repository: contract

Files:
- `src/admin.ts`
- `src/validate-admin.ts`
- `src/index.ts`
- `test/admin.test.ts`
- `test/types.fixture.ts`
- `docs/index.md`
- `package.json`
- `dist/admin.js`
- `dist/admin.d.ts`
- `dist/validate-admin.js`
- `dist/validate-admin.d.ts`
- `dist/index.js`
- `dist/index.d.ts`

Behavior change: yes
The admin validators accept and reject new shapes; the admin types change incompatibly.

What changes in each file:
- src/admin.ts: check sources, keep marker, view and input headers and body, file status, config
  response, export shapes, status order text.
- src/validate-admin.ts: the check input accepts the source and hasSecret fields; new export
  validator.
- src/index.ts: the new names of "Contract fields" (the file lists its exports one by one).
- test/admin.test.ts and test/types.fixture.ts: new and changed cases and types.
- docs/index.md: section "Admin config api" (lines 285-317).
- package.json: version 1.7.0 becomes 2.0.0.
- dist: the six files above, regenerated by the build; no other dist file may change.
- The contract README names admin shapes only in its intro sentence (README line 5) and needs no
  change.

If `src/admin.ts` already has `source` on check views and `{ keep: true }` markers, hold instead
of a review.

Behavior:
- The shapes of "Contract fields". Reuse the existing check schemas and refinements
  (`httpCheckSchema`, `refineHttpCheck`, the header rules of `src/schema.ts:140-173`) so the input
  keeps every limit; a keep marker counts as 0 literal bytes in the 16 KiB total. The heartbeat
  input keeps `secret` optional and write-only (`src/admin.ts:99-100`).
- `validateAdminCheckInput` (`src/validate-admin.ts:26-61`): `source` is allowed on every type and
  only as `"database"`; `hasSecret` only on heartbeat and only as `true`; all other rules stay
  (own data properties only, `secret` only on heartbeat).
- A view of a database check passes `validateAdminCheckInput` unchanged (round-trip property,
  tested on every check type).
- `validateAdminConfigExport` validates each check with the existing `Check` rules
  (`validateCheck`, `src/validate.ts:137-139`) and rejects markers, `source`, `hasSecret` and
  `secret` in checks.
- No new module file under `src/` (status serves contract modules by name, status
  `src/server.ts:189-205`).
- `WIRE_VERSION` stays `1`. Docs: the revision is "of the applied configuration (file and
  database)", the redaction paragraph describes env names, keep markers and the export, and the
  status table gets the new texts. A short note says the change is breaking for admin clients only.

Tool facts (contract at `7ce23aa`):
- Bun 1.4.0: `package.json:7` (`packageManager`) and `:9` (`engines.bun`).
- `check` script: `bun run lint && bun run build && bun run typecheck && bun run test`
  (`package.json:28`); `lint` is `biome check . && pulse-eslint .` (`:25`).
- CI: `.github/workflows/ci.yml:17-19` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0`
  with `build: true`. At that ref (read with `gh api .../contents/...?ref=51e95b0`, byte-equal to
  the config clone) it runs `bun install --frozen-lockfile` (:26), `bun run lint` (:28),
  `bun run typecheck` (:30), `bun run build` (:33), `git diff --exit-code -- dist` (:36) and
  `bun run test` (:38), on Bun 1.4.0 (:24).
- Biome 2.6.3 (`package.json:31`); `biome.json:2` extends `@lorenzh/pulse-config/biome.json`,
  whose `files.includes` at `51e95b0` is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`,
  `test/fixtures` (lines 10-17; byte-equal to the clone). `src/` and `test/` are linted.
- `bunfig.toml:2-3`: coverage on, line threshold 0.8.

Checks:
1. `bun install --frozen-lockfile && bun run check` exits 0, with `dist/` committed and
   `git diff --exit-code -- dist` clean after the build.
2. `test/admin.test.ts` covers counterexamples 7-15, 18 and 31-33 at the schema level with literal
   inputs and literal expected verdicts: for example `{ keep: true, x: 1 }` rejected, a view with
   `source: "database"` accepted as input, `source: "file"` rejected as input, an `AdminFileStatus`
   with `state: "ok"` and a non-null `message` rejected, an export with `redacted: []` rejected,
   an export check with `secret` rejected.
3. `test/types.fixture.ts` compiles with values of every new type.
4. `git diff --name-only $(git merge-base origin/main HEAD) HEAD -- src` lists only
   `src/admin.ts`, `src/validate-admin.ts` and `src/index.ts`.

Completion evidence: the PR lists the new exports, the check output and the version `2.0.0`.

## Repository: api

Files:
- `package.json`
- `bun.lock`
- `src/migrations.ts`
- `src/check-store.ts`
- `src/effective-checks.ts`
- `src/check-write.ts`
- `src/config-export.ts`
- `src/config.ts`
- `src/config-reload.ts`
- `src/config-holder.ts`
- `src/config-write.ts`
- `src/admin-routes.ts`
- `src/start.ts`
- `src/server.ts`
- `src/service.ts`
- `src/config-db.test.ts`
- `src/config-file-state.test.ts`
- `src/config-export.test.ts`
- `src/start.file-fallback.test.ts`
- `src/config-admin.test.ts`
- `src/config-write.audit.test.ts`
- `src/config-write.crash.test.ts`
- `src/server.heartbeat.test.ts`
- `src/start.test.ts`
- `src/db.migrations.test.ts`
- `src/security-review.test.ts`
- `src/docs-claims.test.ts`
- `README.md`
- `docs/rest-api.md`
- `docs/operation.md`
- `docs/configuration.md`
- `docs/troubleshooting.md`

Behavior change: yes
Admin check writes move to the database, a broken file no longer blocks start or writes, and a new
export route exists.

What changes in each file (the new source and test files are new; all others exist at api
2d4a6b2):
- package.json and bun.lock: the contract dependency moves to the merged contract main SHA.
- src/migrations.ts: step 6 creates the tables check_definitions and config_state (one row,
  generation 0).
- src/check-store.ts (new): the SQL for definitions, generation and snapshot, in the way the token
  store and the audit log keep their own SQL.
- src/effective-checks.ts (new): the pure merge of file set and definitions into the effective
  checks, the shadowed list and the heartbeat digests.
- src/check-write.ts (new): database check writes, marker resolution, the transaction and the
  audit entry.
- src/config-export.ts (new): the pure builder of the export document.
- src/config.ts: exports a single-check parse that the database write reuses; the file rules stay.
- src/config-reload.ts: file state, admin revision input, start fallback.
- src/config-holder.ts: holds the effective configuration.
- src/config-write.ts: the file writer serves component and maintenance writes only; check views
  of the new shape; the precondition compares with the admin revision and checks the disk.
- src/admin-routes.ts: check routes go to the database writer; the export route; 503 only for
  file writes.
- src/start.ts: database before file, fallback, wiring.
- src/server.ts: heartbeat digests.
- src/service.ts: the reconcile can run inside the caller's transaction (today it opens its own
  BEGIN, src/service.ts:770-771 and :1006, and SQLite does not nest BEGIN), and its log line for a
  resolved incident reads `check "<id>" removed from the configuration: incident resolved`
  (today "removed from the checks file", src/service.ts:1016), because a database delete also
  ends a check.
- The four new test files hold the database, file state, export and start fallback tests; the
  changed tests move file-protocol coverage to component and maintenance writes (see Risks) and
  add the new cases.
- README.md and docs: docs/rest-api.md sections "Admin config routes" and "Audit log";
  docs/operation.md sections "Changing checks", "Audit log" and the log line list (line 262);
  docs/configuration.md where it says the file is the only source; docs/troubleshooting.md for a
  broken file.

If the code already stores admin-created checks in the database, hold instead of a review.

Behavior: items 1-35 of "Required behavior", with the decisions above. Details:

- Keep every guarantee of #380 that this spec does not change: auth and throttle order, strict
  input, size limit, audit of every acknowledged write, file write protocol for components and
  windows (temp file, pending audit, fsync, rename, `resolvePending` at start), redaction of
  literal values, bodies and secrets.
- `upsertChecks` (`src/service.ts:1003-1021`) gets the effective set on every change. The file
  reload `onApply` (`src/start.ts:293-297`) and `adopt` (`src/config-reload.ts:167-172`) build the
  effective set from the new file set and the stored definitions, reconcile, write the snapshot in
  the same transaction, then swap the holder.
- The database writer and the file writer share one lock (today `tail` in
  `src/config-write.ts:378`, `:567-572`). The reload runs synchronously, so a reload and a write
  never interleave.
- `GET /admin/config` builds views from the in-memory effective set and shadowed list; no SQL per
  read beyond today.
- The startup log line `listening` (`src/start.ts:384-399`) adds `fileState` and `databaseChecks`
  (a count). No path or value is added.
- Docs: replace "The checks file is the only source of truth" (`docs/operation.md:201`,
  `docs/rest-api.md:321`), the `503` paragraph for check writes (`docs/operation.md:229`), "A start
  with an invalid file still fails" (`docs/operation.md:212`), and the redaction paragraph of
  `docs/rest-api.md`. Document the effective set, precedence, keep markers with a GET-edit-PUT
  `curl`/`jq` example, file state, start fallback, export with `redacted`, the downgrade rule, and
  that components and windows may reference only file checks. `docs-claims.test.ts` gets claims for
  the removed sentences.

Tool facts (api at `2d4a6b2`):
- Bun 1.4.0: `package.json:9` (`engines.bun`) and `:35` (`packageManager`).
- `check`: `bun run lint && bun run typecheck && bun run test` (`package.json:20`); `lint` is
  `biome check . && pulse-eslint . && pulse-workflows` (`:16`); `test` is `bun test` (`:15`).
- `bunfig.toml:2-3`: coverage on, line threshold 0.8.
- CI `.github/workflows/ci.yml:17-18` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
  (also the `@lorenzh/pulse-config` pin, `package.json:24`). At that ref (read with `gh api`,
  byte-equal to the config clone) it runs `bun install --frozen-lockfile` (:26), `bun run lint`
  (:28), `bun run typecheck` (:30) and `bun run test` (:38); no build step (`build` input not set).
  Jobs `bench-selftest` (`ci.yml:20-33`: `bun run bench:selftest`, compose config of the bench)
  and `docker` (`ci.yml:35-53`: image build, no dotenv, no test files) also run.
- Biome 2.6.3 (`package.json:23`); `biome.json:2` extends the config file, which at `04108fa`
  includes `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures` (lines
  10-17, byte-equal to the clone).
- ESLint: `sonarjs/cognitive-complexity` 15 (config `eslint.config.js:16`).

Checks:
1. Red first: these tests fail on `main` (`2d4a6b2`) for the stated reason, shown in the PR:
   a. a check created by `POST /admin/checks` on a read-only checks file answers `201` and is in
      `GET /probe/checks` (on `main`: `503`);
   b. a database check D shadowed by a file D: `/checks` and `/probe/checks` show the file
      version, `GET /admin/config` has D in `shadowed` with `source: "database"` (on `main`: no
      `shadowed`, the POST goes to the file);
   c. GET then PUT of the view with only `name` changed keeps a literal header sentinel and a body
      sentinel in `/probe/checks` (on `main`: the view is not a valid body, or the values are
      lost);
   d. after a valid apply, an invalid file on disk; `POST /admin/checks` with the fresh revision
      answers `201` and the file bytes stay the broken bytes (on `main`: `412`).
   Expected values are literals in the tests (statuses, sentinel strings, names).
2. HTTP tests on `127.0.0.1:0` with temp files and a `mkdtemp` database, injected clock and
   reload calls, cover counterexamples 1-39, every response typed and checked with the contract
   validators (`validateAdminConfigResponse`, `validateAdminCheckView`,
   `validateAdminConfigExport`).
3. A reopen test: create database checks (one heartbeat), close, start again with the same
   database and the same file; definitions, revision, heartbeat secret and source are the same.
   Then start with a broken file: the snapshot's file checks are served, a file heartbeat ping with
   its secret is accepted, `file.state` is `invalid`.
4. Sentinel test, one assertion per cell of the table "Where values may appear". Fixture: one
   database HTTP check and one file HTTP check, each with a literal header sentinel
   (`lit-db-sentinel-1`, `lit-file-sentinel-1`), an env header (`PULSE_SENTINEL_DB_ENV`,
   `PULSE_SENTINEL_FILE_ENV`) and a body sentinel (`body-db-sentinel-1`, `body-file-sentinel-1`);
   one database and one file heartbeat check with the secrets `hb-db-sentinel-0123456789` and
   `hb-file-sentinel-0123456789`. The sentinels are literals of the test.
   - Responses and logs: each "no" cell holds for every public read, admin view, admin write
     response, the export, audit entries, captured log lines, `/metrics`, error bodies and
     `file.message`. `GET /probe/checks` with a probe token contains both literal sentinels, both
     body sentinels and both env names, and no `"keep"` key and no heartbeat secret. Admin views
     contain both env names and `{"keep":true}` for the literal headers and bodies. The export
     contains both env names and no `"keep"` key.
   - Storage, read from the column values and from the raw database file bytes after a
     checkpoint: the database literal and body sentinels are only in `check_definitions.check_json`
     and `checks.headers_json`/`checks.body`; the file literal and body sentinels are only in
     `checks.headers_json`/`checks.body` and `config_state.file_snapshot_json`; no column holds a
     `"keep"` marker. Neither heartbeat secret occurs anywhere in the file bytes;
     `check_definitions.secret_sha256` equals the hex SHA-256 of `hb-db-sentinel-0123456789`, and
     `file_snapshot_json` holds the hex SHA-256 of `hb-file-sentinel-0123456789`, both computed in
     the test with `node:crypto` from the literal (independent of the code under test).
5. The migration test: a database at step 5 with runtime rows and results migrates to step 6 with
   an empty `check_definitions`, generation `0`, and unchanged results and incidents.
6. `bun install --frozen-lockfile && bun run check` exits 0. Coverage stays at or above 0.8.
7. `bun run bench:selftest` exits 0 and `docker build --tag pulse-api:local .` succeeds.
8. `bun bench/run.ts --a 2d4a6b2 --b <branch sha>` as in "Performance impact"; gating metrics within
   budget.
9. `bun start` with a temp `PULSE_DB`, a copy of `checks.example.json` (placeholder secret
   replaced) and an admin token import: `POST /admin/checks`, GET-edit-PUT, a broken file, a
   `GET /admin/config` showing `invalid`, a `POST` with the fresh revision, repair, `GET
   /admin/config/export`. Report the commands and statuses.

Completion evidence: the PR names #565, shows the red runs of check 1, the green `bun run check`,
the bench numbers, the `bun start` session and the known limits (components and windows only in
the file; no import; rollback needs a backup).

## Repository: deploy

Files:
- `e2e/compose-e2e.sh`
- `e2e/compose.e2e.yaml`
- `full/compose.yaml`
- `full/README.md`
- `README.md`

Behavior change: yes
The E2E gains steps and accepts both api kinds; the read-only step changes for an api with
database checks.

What changes in each file:
- e2e/compose-e2e.sh: feature detection, the database scenario, the read-only step for both api
  kinds.
- e2e/compose.e2e.yaml: the comments at lines 10-12 that say the admin routes write the file.
- full/compose.yaml: the comment at lines 36-37.
- full/README.md: line 47.
- README.md: the e2e paragraph at line 121 names both paths.

If the E2E already detects database checks and runs the database scenario, hold instead of a
review.

Behavior:
1. After the first `cfg_etag` in step "Checks via the admin API and hot reload"
   (`e2e/compose-e2e.sh:609`), detect the api kind once: `GET /admin/config | jq -e 'has("file")
   and has("shadowed")'`. Print `ok: the api stores admin checks in the database` or
   `ok: the api writes admin checks to the file (older api)`. Nothing else selects a path: no
   environment variable, no pin value.
2. The existing create, repeat `409`, rename `PUT`, `DELETE` and status-page steps (`:610-620`) run
   for both kinds. The create counter check (`:621-622`) uses the exact count of creates the path
   made, as a literal per path.
3. Database path only, in this order:
   a. **File untouched**: `sha256sum` of `e2e/rw/checks.json` before the first `POST` equals the
      value after the `DELETE`.
   b. **Literal round trip**: `POST` `e2e-db-post`: `url` `http://e2e-target:8000/svc`, `method`
      `POST`, a *literal* `Authorization` value `Bearer ${E2E_SVC_TOKEN:-e2e-svc-token-sentinel}`,
      `Content-Type: application/json`, the body `{"ping":"e2e-body-sentinel"}`,
      `expectedStatus: [200]`, `jsonAssert` on `/status` `ok` (the request `e2e/target.mjs:20-27`
      accepts). Wait for an `up` result of `e2e-db-post` (the target answers `400` otherwise).
      `GET /admin/config`: the view of `e2e-db-post` has `headers.Authorization == {"keep":true}`
      and `body == {"keep":true}`, and the response does not contain the token text. Change only
      `.name` with `jq` and `PUT` the view as it is. Then read `GET /probe/checks` with the e2e
      probe token from the e2e secrets directory (`secrets_dir`, `e2e/compose-e2e.sh:16`) and check with `jq -e`, without printing, that
      `e2e-db-post` still has the literal `Authorization` value and the body. The expected values
      are the literals of this item, not values read back from the api.
   c. **Shadow**: with `atomic_replace` add a file check `e2e-db-post` named `E2E file shadow`
      (`url` `http://api:3000/checks`, `intervalMs` 10000, `timeoutMs` 2000). Wait until `/checks`
      shows `E2E file shadow` for `e2e-db-post` and `GET /admin/config` lists `e2e-db-post` in
      `shadowed` with `source == "database"`. `PUT /admin/checks/e2e-db-post` answers `409`. Restore
      the file from the backup; wait until `/checks` shows the renamed database name again.
   d. **Broken file**: write `{` to `e2e/rw/checks.json` (atomic replace). Wait until
      `.file.state == "invalid"`. `POST` `e2e-db-broken` with the fresh revision answers `201`, its
      `DELETE` `204`, and `cmp` shows the file still holds `{`. Restore the file; wait until
      `.file.state == "ok"`.
   e. **Persistence**: `POST` `e2e-db-keep` before step "Persistence across down and up"
      (`:681`). After `up`, `/checks` lists it and `GET /admin/config` shows it with
      `source == "database"`.
4. Read-only mount step (`:673-679`): older api: unchanged (`503`). Database path: the second api
   on port 3999 answers `201` to a valid `POST /admin/checks` with its own current revision, and
   `503` to a valid `POST /admin/components` with that revision. Print which case ran.
5. Logs: the existing "logs show no admin token" check (`:566-567`) gets a sibling for the svc
   token text on the database path. Scripts never print a token (deploy `AGENTS.md`, Rules).
6. Docs and comments: check writes need no writable mount on an api with database checks; the
   pinned `0.1.0` still answers `503` on a read-only mount; component and window writes still need
   a writable directory.
7. Change no pin, no image line, no other step.

Tool facts (deploy at `621cbf0`):
- CI job `lint` runs shellcheck and `bash -n` on every `*.sh` (`.github/workflows/ci.yml:34-37`),
  `node --check` (`:38-39`), `jq empty` (`:40-41`), the helper tests (`:42-49`),
  `scripts/check-setup.sh` (`:50-51`), its test (`:52-53`) and the other script tests (`:54-61`).
- CI job `full` runs `bash e2e/compose-e2e.sh` on the pinned images (`ci.yml:101-123`, step at
  `:118-120`).
- CI job `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`
  (`ci.yml:17`; `package.json:22` pins the same SHA; byte-equal to the config clone). It runs
  `bun run lint` (`biome check . && pulse-eslint . && pulse-workflows`, `package.json:14`),
  `bun run typecheck` and `bun run test` (`bun test --coverage cli`, `package.json:13`). Biome does
  not read `e2e/` (`biome.json:17` `!e2e`) or `.github/` (`:12`), so this change is not linted by
  Biome; shellcheck is the linter for it.
- The E2E sets `COMPOSE_FILE=full/compose.yaml:e2e/compose.e2e.yaml` (`e2e/compose-e2e.sh:14`) and
  starts with `--pull missing` (`:320`), so a local image named in `common/services.yaml` is used.

Checks:
1. `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and
   `git ls-files -z '*.sh' | xargs -0 -n 1 bash -n` from the repository root; every other step of
   job `lint` (the rows of deploy `AGENTS.md`, "Commands") exits 0.
2. `scripts/check-setup.sh` and `bash scripts/check-setup.test.sh` exit 0.
3. `bun install --frozen-lockfile && bun run check` exits 0 (unchanged by this change, run because
   `check` is a CI job).
4. No pin changed: with `base=$(git merge-base origin/main HEAD)`,
   `git diff --exit-code "$base" HEAD -- common/services.yaml` exits 0.

Completion evidence (acceptance):
- **Run A, pinned api `0.1.0`.** `bash e2e/compose-e2e.sh` exits 0 and ends with
  `==> All checks passed`; the log has `ok: the api writes admin checks to the file (older api)`
  and `ok: the read-only mount answers 503`. Version `0.1.0` comes from the pin; it predates this
  feature (api tag `v0.1.0`, the only tag).
- **Run B, api `main` after the api PR merged.** Record the api `main` SHA. Build
  `docker build -t pulse-api:e2e-<sha> <api checkout at sha>`. In a throwaway copy of the deploy
  branch replace only the api `image:` value of `common/services.yaml:8` with
  `pulse-api:e2e-<sha>`; show with `COMPOSE_FILE=full/compose.yaml:e2e/compose.e2e.yaml docker
  compose config --images` that it is selected. Run `bash e2e/compose-e2e.sh` there: exit 0,
  `==> All checks passed`, and the log has `ok: the api stores admin checks in the database` and
  the `ok:` lines of items 3a-3e and 4. An api `0.1.0` cannot serve `shadowed` or `file`, so these
  lines also prove which image ran. Delete the copy; nothing of it is committed.
- The PR lists the api SHA, the image ID, the `ok:` lines of both runs and checks 1-4. If Run B
  fails at a step outside this change, hold with `needs-input` and name the step (see Risks). If
  Docker is not available, say so; do not claim a pass.

## Acceptance evidence (feature)

The issue's acceptance criteria map to:
- "a database check is served to probes": api check 1a, deploy Run B item 3b and the probe result
  of the existing `e2e-api` step;
- "a shadowed id reports the file version": api check 1b, deploy item 3c;
- "a GET-then-PUT keeps header values": api check 1c, deploy item 3b;
- "a broken file still allows database writes": api check 1d, deploy item 3d;
- "CI and compose-e2e green": contract and api `bun run check` and CI; deploy CI (Run A on the pin)
  and Run B on the api `main` image.
