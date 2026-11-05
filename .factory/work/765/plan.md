# Spec #765: maintenance windows in the database next to checks.json

## Goal

Maintenance windows created through the admin API are stored in the api database, next to the
windows of the checks file, with the ownership model that #565 introduced for checks: the file wins
on a shared id, the database copy is kept and reported as shadowed, file entries are read-only
through the admin API. The effective set (file windows plus unshadowed database windows) drives
`GET /maintenance`, the `maintenance` state of `GET /checks`, incident suppression and heartbeat
suppression exactly as file windows do today. This is the backend prerequisite of the console
Maintenance screen (#569). #460 (decision 10, item B; sections 8, 10, 19) is the source of the
decision.

Inputs: the issue, its review in `.factory/work/765/issue-review.md`, and the clones at
api `32704fd`, contract `66818a2`, console `c78c9d5`, deploy `770eae0`, status `8b6d431`,
probe `9490141`, notify `c79f0b7`. Shared findings: `factory/findings/765` does not exist yet
(`gh api .../git/ref/heads/factory/findings/765` answered HTTP 404), so no finding is cited.

## Scope

- contract: additive schemas, validators, types and constants for database windows, the admin
  maintenance list and the window id; minor bump `2.2.0` to `2.3.0`; `WIRE_VERSION` stays `1`.
- api: a numbered migration with a `maintenance_definitions` table; a window store and a window
  writer that never read or write the checks file; an optional `id` on file windows; the effective
  window projection in the config holder; `GET /admin/maintenance`; `POST /admin/maintenance` and
  `PUT`/`DELETE /admin/maintenance/:id` on database windows; docs, including the reload
  contradiction.

## Non-goals

- No console screen or console change (#569 builds the Maintenance page). No status, probe,
  notify, deploy, kit or config change.
- Components are **not** stored in the database by this feature. Decision and evidence:
  the console picks checks "by component" from the components that already exist:
  `GET /admin/config` serves `components` with their `checkIds` (contract `src/admin.ts:234-251`),
  and the window stores the resolved check ids, not component ids (see the reference rules
  below). Picking by component therefore needs no new storage. What database components would add
  is component *management* from the console (grouping database checks), which is a separate
  feature; it would also change `/admin/components` writes and the read-only-mount expectation of
  deploy `e2e/compose-e2e.sh:1061-1075` (`201 503`). Component routes, the file component writes
  and their 503 on a read-only mount stay exactly as they are. A follow-up issue can add database
  components with the same model.
- No multi-check form in the checks file. A named file window keeps exactly one `checkId`.
- No change to public read routes: `GET /maintenance`, `GET /checks`, `/components*` keep their
  shapes; only the windows they already show now include the projected database windows.
- No automatic purge of past windows, no replay or recomputation of stored results, no change to
  uptime or SLO math (maintenance is still not subtracted).
- No change to the shape of `GET /admin/config` or `GET /admin/config/export`.

## Decisions

### D1 Window identity

- A **window id** matches `^[a-z][a-z0-9._-]*$` and has 1 to 64 characters. It starts with a
  letter, so a decimal path segment (an old window index) is never a window id. Window ids are their
  own namespace, apart from check and component ids.
- A **database window** always has an id, chosen by the client on `POST` (like check ids).
- A **file window** may carry an optional `id` with the same syntax. Ids are unique among the file
  windows; a duplicate stops the load/reload with `maintenance[<i>].id: duplicate maintenance id
  "<id>"`. A file window without `id` (every existing file) loads and behaves exactly as today.
  The `id` adds no other rule to file windows: the file note keeps its current rule (non-empty
  string, no length cap), times keep the ISO-with-offset rule.
- Same id in the file and the database: the file window wins, the **whole** database window is
  suppressed (none of its check ids is projected), and the database definition is kept unchanged as
  *shadowed*. It becomes effective again as soon as the applied file no longer holds the id, also
  across a restart.
- Time overlap is not identity: windows with different ids may overlap on the same check.

### D2 Database window shape and validation (contract `adminMaintenanceWindowInputSchema`)

Strict object `{ id, checkIds, start, end, note }`:

- `id`: window id (D1).
- `checkIds`: array of 1 to 50 non-empty strings, without duplicates. Order is kept as sent.
- `start`, `end`: integer epoch milliseconds, `0 <= start < end <= 253402300799999`
  (`MAX_MAINTENANCE_TIME`, `9999-12-31T23:59:59.999Z`). Half-open `[start, end)` as today. Past,
  current and planned windows may be created, replaced and deleted.
  Why this limit: the export (D8) writes each database window time as `new Date(ms).toISOString()`
  and must pass the unchanged `adminConfigExportSchema`, whose times are
  `z.iso.datetime({ offset: true })` (contract `src/admin.ts:281-282`, Zod `4.6.7` pinned in contract
  `package.json:39`). That check takes only a four-digit year. Any time after year 9999 is written
  with an expanded year: the JavaScript maximum `8640000000000000` becomes
  `+275760-09-13T00:00:00.000Z`, and the export schema refuses it (the plan-review ran this with Zod
  4.6.7). `253402300800000` becomes `+010000-01-01T00:00:00.000Z` and is refused as well. So every
  value up to `253402300799999` exports in a valid form, and every value above it would break D8.
  File windows keep their current rule.
- `note`: plain text of 1 to 500 characters (UTF-16 code units, `String.prototype.length`, as the
  contract's existing `plainText` counts), no leading or trailing whitespace, no control character
  (`\p{Cc}`, so a note is one line). These rules apply only to database notes.
- api-side reference rule: every `checkIds` entry names an effective check (file or database) at
  write time; otherwise `422` `maintenance.checkIds[<j>] must reference a configured check`.
- api-side cap: at most 1000 stored database windows (effective plus shadowed). A create beyond
  that answers `409` `too many maintenance windows: delete past ones`.

### D3 Phase

Derived from the api clock at read time, never stored: `planned` when `now < start`, `current`
when `start <= now < end`, `past` when `end <= now`.

### D4 Admin routes

All under the existing admin gate (`404` when the admin import is off) and Bearer auth.

| Route | Permission | Answer |
| --- | --- | --- |
| `GET /admin/maintenance` | `config-read` (`read` or `checks`), as `GET /admin/config` | `200` `AdminMaintenanceList` with the admin revision as `ETag`; `cache-control: no-store`; any query parameter answers `400`; a body over `ADMIN_MAX_BODY_BYTES` answers `413` |
| `POST /admin/maintenance` | `config-write` (`admin` and `checks`) | `201`, body `AdminMaintenanceWindow` (`source: "database"`), `Location: /admin/maintenance/<id>`, new `ETag` |
| `PUT /admin/maintenance/:id` | `config-write` | full replacement; body `id` must equal the decoded path id (`400` otherwise); `200` with the view and new `ETag`; `id` is immutable |
| `DELETE /admin/maintenance/:id` | `config-write` | `204` with new `ETag` |
| other methods | | `405`; `Allow: GET, POST` on the collection, `Allow: PUT, DELETE` on an item |

`AdminMaintenanceList` is `{ revision, windows, shadowed }`:

- `windows`: the effective windows: every applied file window in file order (`source: "file"`,
  `index` = its position in the applied file's `maintenance` array, `id` = its file id or `null`,
  `checkIds: [checkId]`), then the unshadowed database windows in creation order
  (`source: "database"`, `index: null`). Past windows are included.
- `shadowed`: database windows whose id an applied file window holds, in creation order,
  `source: "database"`.
- Each entry: `{ id, index, source, checkIds, start, end, note, phase }`. A database entry shows its
  stored `checkIds`, also ids that are not effective right now.

Status order of a window write (first that applies): 404 feature off, 401, 403, 413, 400 (bad JSON,
bad or `*` If-Match, body/path id mismatch), 428 If-Match missing, 412 stale revision, 422 schema or
reference error, 409, 404 unknown id. Window writes never answer `503`.

409 cases: create of an id that the applied file or the store holds; create beyond the cap; `PUT`
or `DELETE` of an id that only the file holds (`maintenance "<id>" comes from the checks file; edit
the file`); `PUT` of a shadowed id (`... is shadowed by the checks file; only delete is allowed`);
`PUT`/`DELETE` of a decimal path segment `^\d{1,9}$` that is an index of the applied file windows
(`file maintenance windows are read-only; edit the checks file`). A decimal segment beyond the file
list, and any other unknown id, answers 404. A `DELETE` of a shadowed id deletes the database copy
and leaves the file and the effective file window unchanged.

The old file-window writes end: `POST /admin/maintenance` with the old body `{checkId, start, end,
note}` answers `422` (strict schema), an old `PUT /admin/maintenance/<index>` answers `400` (no body
id), an old `DELETE /admin/maintenance/<index>` answers `409` or `404` as above. No admin route
writes a window into the checks file any more. Component and check routes do not change.

### D5 Revision, concurrency, audit

- One admin revision for everything: `adminRevision(appliedFileRevision, database_generation)`
  (api `src/config-reload.ts:52-59`). Every successful window write raises
  `config_state.database_generation` by one, so it stales a revision held for a check, a
  component or a window, and a check write or a file reload stales a revision held for a window.
- Window writes run under the shared `WriteLock` (api `src/write-lock.ts`) with check and file
  writes. The revision check reads only the applied file revision and the generation; it never
  reads the file on disk, so an invalid, unreadable, read-only or written-not-applied disk file
  does not block a window write with a fresh revision, and the write never touches the file, its
  state or its `lastAppliedAt`.
- Missing `If-Match` = 428; malformed or `*` = 400; well-formed but stale = 412 (unchanged rules,
  api `src/admin-routes.ts:105-114`).
- Definition, generation and audit entry commit in one SQLite transaction; the holder is updated
  only after the commit; a failure answers `500` (`maintenance could not be stored` or `audit log
  could not be written`) and changes nothing (definitions, generation, effective set, audit).
- Audit: the existing actions `maintenance.create|replace|delete` (contract `src/audit.ts:13-15`),
  target `{kind: "maintenance", id: <window id>}`, actor, the new revision. Old entries keep their
  index text as id; a window id starts with a letter, so the two never look alike. The audit entry
  holds no note.
- Legacy `audit_pending` rows: component writes still use the file protocol, and the file writer's
  `resolvePending` still runs at start and before each file write (api `src/start.ts:432`,
  `src/config-write.ts:592`), so pending rows of an old window write are resolved as before.

### D6 Effective set and runtime

- The holder (api `src/config-holder.ts`) gains the database window definitions. On every
  `set` (file apply), `setDefinitions` (check write) and the new `setWindowDefinitions` it computes,
  once, the effective projected list `MaintenanceWindow[]`: the applied file windows in file order
  with any `id` key removed, then for each unshadowed database window in creation order one
  `{checkId, start, end, note}` per stored check id in stored order, keeping only check ids that are
  in the effective checks at that moment. `holder.get().maintenance` returns this array; the same
  array object is returned until the next change.
- The service (api `src/service.ts:414-426`) keeps reading `maintenance()` at every use. When the
  array object changes it re-sorts (start, then checkId, stable, so file windows stay before
  database windows on a tie) **and clears its read cache**, so an edit of `end` or `note` with the
  same `start` is visible at the next read (today the cache key is only `checkId@start`, api
  `src/service.ts:504-517`).
- Semantics are today's, applied to each projected entry: a `down` result with a timestamp in a
  window is stored but does not count in the quorum and does not advance failure counters or open
  an incident; pre-existing incidents stay open; `up`/`degraded` pass through the quorum;
  `GET /checks` shows `state: "maintenance"` with the earliest-start active window; heartbeats get
  `isInMaintenance`; `GET /maintenance` lists entries with `end > now`. Late results are judged by
  the effective set at the time they are processed; an edit or delete of a past window affects only
  results processed after it.
- Probe and notify are unchanged: the probe keeps running every check, notify reads incidents.
- Public JSON never carries `id`, `index`, `source`, `phase` or `checkIds`.

### D7 References

- A database window may name file and database checks. The writer requires every id to be
  effective at write time (D2).
- A check that disappears later (file reload removes it, a database check is deleted, a database
  check becomes shadowed and so the id stays effective as the file check) never blocks the reload
  or the delete. The stored definition is not rewritten; its missing ids are simply not projected
  and come back into effect when a check with that id is effective again. A `PUT` must name only
  effective ids, so a window with a missing id is edited by dropping or restoring it.
- Database windows do not block a database check delete or a file check delete through the file
  writer (that writer still checks only the file's own references, api
  `src/config-write.ts:266-276`).
- Component selection in a client resolves to concrete check ids before the save; the window does
  not follow later component membership changes.

### D8 Export and `GET /admin/config`

- `GET /admin/config` keeps its strict shape (contract `src/admin.ts:234-251`): `maintenance` lists
  only the applied file windows with `index`, without their `id`. Old consoles (contract pin
  `66818a2`, console `src/check-read.ts:54`) therefore keep validating it.
- `GET /admin/config/export` keeps `adminConfigExportSchema`: `maintenance` holds the effective
  projected windows (file windows, then the flattened database windows), each `{checkId, start,
  end, note}` with ISO 8601 UTC times. Window ids are not exported (deliberate loss of identity:
  loading the export as a checks file gives id-less file windows that run beside the database
  windows with the same times, with no change of behavior). Shadowed database windows are not
  exported. Check redaction is unchanged.

### D9 Storage

Migration 8 in api `src/migrations.ts` (append; `SCHEMA_VERSION` becomes 8):

```sql
CREATE TABLE maintenance_definitions (
  id TEXT PRIMARY KEY,
  check_ids_json TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Creation order is `created_at, rowid`. A replace keeps `created_at` and the order. The migration
copies nothing from the file, the snapshot or runtime rows. The file snapshot
(`config_state.file_snapshot_json`) keeps file windows with their optional `id`; snapshots written
before this feature (no `id`) load unchanged. A start from the snapshot (broken file) rebuilds the
same effective set and shadowed list.

## Required behavior (summary)

1. A window created through the admin API lives in the database and never in the file.
2. File windows are read-only through the admin API.
3. File id wins; the database copy is listed under `shadowed` and only deletable.
4. Planned, current and past windows are listed by `GET /admin/maintenance`.
5. Writes need `admin` and `checks`, `If-Match` with the current revision, and record the existing
   `maintenance.*` audit action.
6. The effective set drives public status, incident and heartbeat suppression as today.
7. A broken file does not block window writes.
8. Docs say the same thing about reloads everywhere.

## Risks

- Cache staleness after a note/end edit: covered by D6 (clear on new array) and a test.
- CPU on the ingest path: `maintenance()` is called per result; the projection must be computed once
  per change, not per call (D6). A unit test asserts the same array object between changes.
- Leaking `id` into public JSON through `{...window}` spreads (api `src/service.ts:863`, `:1331`):
  the projection removes it; a test asserts exact public keys.
- Old scripts that wrote file windows through the admin API now get 422/400/409. This is the
  requested behavior ("file entries stay read-only"); the docs say how to edit the file instead.
- Downgrade: migration 8 makes an older api refuse the database (api `AGENTS.md`: "A file from a
  newer program is refused"), as with every migration; restore a backup to downgrade.

## Performance impact

api `bench/budgets.json` keys, at api `32704fd`:

- `startup_cpu_ms` (325 ms budget): one extra `SELECT` of an empty or small table at start; expect
  under 1 ms, no measurable change.
- `load_cpu_s` (28.1 s): the bench seeds no windows (`grep -n maintenance bench/*.ts` finds none),
  so `maintenance()` returns one stable empty array; expect no change. A wrong implementation that
  rebuilds or re-sorts the projection per call would raise it, which the identity test guards.
- `idle_rss_mib`, `peak_rss_mib`: no change with no windows; at most about 4 MB with 1000 windows
  of 50 ids each (not part of the bench).
- `test_cpu_s` (5.6 s): new api tests add an estimated 0.2 to 0.5 s; must stay under the budget.
- contract `test_cpu_s` (9.0 s) and `build_cpu_s` (6.4 s): a few schemas more; expect under 0.2 s.
- Reported metrics (`startup_wall_ms`, `p95_*`, `rps`, `cold_*`, `eod_*`, `image_mb`): none
  expected; no new dependency, no change to read paths without windows.

Measurement: in api, `bun bench/run.ts --a 32704fd1e2217a109f51ea7ff41ccc7e8c73cfeb --b <branch
sha> --rounds 1 --others-ref main` when Docker is available (api `bench/README.md:76-81`); otherwise
compare the CPU of `bun run test` on both refs with `/usr/bin/time -f '%U %S' bun run test` and
report both numbers. contract: the same `/usr/bin/time` comparison of `bun run test` and
`bun run build`.

## Security impact

Security impact: yes. The change adds admin write and read routes, new validators at a trust
boundary (contract), and stores operator text that public routes serve.

Checklist items that apply:

- **Secrets in errors, logs and responses**: error texts and log lines name ids and field paths
  only, never a note or a body; the `config write` info line carries `kind`, `action`, the window
  id and the token name, as for checks. Audit entries hold no note.
- **Auth order and status codes**: the status order of D4; `GET` needs `read` or `checks`, writes
  need both `admin` and `checks` (api `src/token-scopes.ts`); a probe token gets 403; the admin
  auth throttle and failure recorder apply unchanged.
- **Body and size limits**: `ADMIN_MAX_BODY_BYTES` (1 MiB) on every method, including `GET` and
  `DELETE` (413).
- **Input validation**: strict schemas (unknown keys, `__proto__` and `constructor` keys refused),
  integer times in range, id pattern, note length and control characters, 1..50 distinct ids, the
  1000-window cap; path ids are decoded once, a malformed escape names nothing (404 after the
  earlier checks).
- **Accessor execution**: validators run on JSON from `readJsonBody`; the contract validators keep
  their rule of returning the same object and never calling accessors (contract
  `test/security-adversarial.test.ts` gets cases for the new schemas).
- **Atomic, path-safe writes**: the window writer has no file access at all; storage is one SQLite
  transaction.
- **Dependency pins**: api pins the merged contract commit by full SHA; no new runtime dependency.

Not applicable: probe HTTP client, SSRF, redirects, Dockerfiles, CI.

## Rollout order

1. **contract** `2.3.0` merges. It only adds exports and changes two descriptive texts of
   `ADMIN_STATUS_ORDER`; existing schemas and validators keep their behavior. Older consumers on
   pin `66818a2` (api, console, status, probe, notify) do not see it.
2. **api** pins the merged contract SHA and ships migration 8 and the routes. Consumers that keep
   running against it:
   - console on contract `66818a2`: reads `GET /admin/config` and `/admin/config/export`, whose
     shapes are unchanged (D8); it never wrote maintenance.
   - status, probe, notify on their current pins: public `GET /maintenance`, `GET /checks`,
     `/probe/checks` and `/incidents` keep their shapes; a database window appears as ordinary
     single-check entries.
   - deploy e2e at `770eae0`: it writes checks and components only; the component write on the
     read-only mount still answers 503 (`e2e/compose-e2e.sh:1061-1075`).
3. No further step in this feature; #569 then pins the new contract in console.

## Counterexamples

| Rule | Input | Required answer |
| --- | --- | --- |
| checkIds 1..50 | `checkIds: []` | 422 |
| checkIds 1..50 | 51 distinct effective ids | 422; 50 ids is 201 |
| no duplicates | `["web","web"]` | 422 |
| reference | `["web","nope"]` with no check `nope` | 422 `maintenance.checkIds[1] must reference a configured check` |
| reference | a database check id that is shadowed (so its id is the effective file check) | 201: the id is effective |
| note length | `""`, 501 × `a`, 251 × `😀` (502 code units) | 422; 1 and 500 × `a` are 201; 250 × `😀` is 201 |
| note text | `" x"`, `"x "`, `"a\nb"`, `"a\u0007b"` | 422 (database only); the same notes in a file window still load if non-empty (unchanged file rule) |
| times | `start: 1.5`, `start: -1`, `end: 253402300800000`, `end: 8640000000000000`, `start == end`, `end < start`, ISO string | 422 |
| time upper bound | `start: 253402300799998, end: 253402300799999` | 201; `GET /admin/config/export` then holds `end: "9999-12-31T23:59:59.999Z"` and passes `validateAdminConfigExport` (literal `ok: true`); a wrong limit of `8640000000000000` would export `+275760-09-13T00:00:00.000Z` and fail it |
| id syntax | `"0"`, `"12"`, `"Web"`, `"-a"`, 65 characters, `""` | 422 on POST; `"a"` and 64 characters are 201 |
| path/body id | `PUT /admin/maintenance/a` with body id `b` | 400 |
| old index paths | `DELETE /admin/maintenance/0` with one file window | 409, file unchanged; `/admin/maintenance/7` with one file window: 404 |
| old body | `POST {checkId, start, end, note}` | 422, file unchanged |
| precedence | file window `id: "w"` and database `w` for `[a, b]` | only the file window's check is in maintenance; `b` is not; `GET /admin/maintenance` lists `w` under `windows` with `source: "file"` and the file note, and the database `w` under `shadowed` |
| shadowed writes | `PUT /admin/maintenance/w` while shadowed | 409; `DELETE` is 204 and the file window stays effective |
| create collision | `POST` id `w` while the file holds `w` | 409; while the store holds `w`: 409 |
| file id duplicate | two file windows with `id: "w"` | reload rejected (`invalid`), running set unchanged; start without snapshot exits 2 |
| cap | 1001st stored database window | 409; the 1000th is 201 |
| revision | `If-Match` of before a check write, a file reload or another window write | 412, nothing changes; missing header 428; `If-Match: *` or `abc` 400 |
| race | two `POST`s with the same fresh revision | exactly one 201, one 412 |
| broken file | checks file replaced by `{` and reloaded | `POST` with the revision of `GET /admin/maintenance` is 201; file bytes and `file.lastAppliedAt` unchanged; `file.state` stays `invalid` |
| half-open | window `[1000, 2000)`, down results at `t=1999` and `t=2000` | `1999` does not count; `2000` counts |
| tie order | file window and database window for the same check with the same `start` | `GET /checks` shows the file window (stable sort, file first) |
| cache | prime `GET /checks` inside window `w`, then `PUT` with a new `note`, same `start` | the next `GET /checks` (within 5 s) shows the new note |
| public keys | any projected window in `GET /maintenance` and `GET /checks` | exactly `checkId, start, end, note` |
| phase | `now = start` | `current`; `now = end` is `past`; `now = start - 1` is `planned` |
| missing member | delete database check `b` named by window `w [a, b]` | delete is 204; `w` keeps `checkIds [a, b]` in the admin list, only `a` is in maintenance; recreating `b` puts it back in maintenance |

No statistic is introduced. Uptime, SLO and latency calculations do not change.

## Contract fields

New exported names in contract, each searched in the contract and config clones and in api `src`
before this spec (`grep -rn -- '<name>' contract/src`, `grep -rln -- '<name>' config` without
`node_modules`, `grep -rn -- '<name>' api/src`); every count was 0:

| Name | Kind |
| --- | --- |
| `MAINTENANCE_WINDOW_ID` | id regex `^[a-z][a-z0-9._-]*$` |
| `MAX_MAINTENANCE_WINDOW_ID` (64), `MAX_MAINTENANCE_CHECKS` (50), `MAX_MAINTENANCE_NOTE` (500), `MAX_MAINTENANCE_TIME` (253402300799999) | limits |
| `ADMIN_MAINTENANCE_PHASES`, `AdminMaintenancePhase` | `["planned","current","past"]` |
| `adminMaintenanceWindowInputSchema`, `AdminMaintenanceWindowInput`, `validateAdminMaintenanceWindowInput` | request body of `POST`/`PUT /admin/maintenance[/:id]` |
| `adminMaintenanceWindowSchema`, `AdminMaintenanceWindow`, `validateAdminMaintenanceWindow` | one list entry and the write response |
| `adminMaintenanceListSchema`, `AdminMaintenanceList`, `validateAdminMaintenanceList` | `GET /admin/maintenance` |
| field `phase` | in `AdminMaintenanceWindow` (`grep -rn '"phase"\|phase:'` 0 in contract/src, config, api/src) |

Changed, not new: `AdminWriteResponse` also admits `AdminMaintenanceWindow`; the `ADMIN_STATUS_ORDER`
texts of 503 (`checks file not writable (component writes)`) and 409 (adds `a file window`).
`adminCheckSourceSchema` (`"file" | "database"`) is reused for `source`.

api names: table `maintenance_definitions` and the `listening` log field
`databaseMaintenanceWindows` (both 0 hits in api `src`). Route `/admin/maintenance` already exists
(api `src/admin-routes.ts:56`, `src/server.ts:205`) and gains `GET`. The optional file key `id` in a
`maintenance` entry is new to the file format; the window key set today is `checkId, start, end,
note` (api `src/config.ts:411-425`), so it collides with nothing.

## Repository: contract

Files:
- `src/admin.ts`
- `src/schema.ts` (only if the window id constants and `plainText` are shared from here; export
  nothing else new from it)
- `src/validate-admin.ts`
- `src/index.ts`
- `test/admin.test.ts`
- `test/security-adversarial.test.ts`
- `test/smoke.test.ts`
- `test/types.fixture.ts`
- `docs/index.md`
- `README.md` (only if it lists the admin exports)
- `package.json` (`version` `2.3.0`)
- `dist/**` (rebuilt and committed)

Behavior change: yes. New schemas, validators and types that a validator returns verdicts for.

Behavior:

- Add the names of "Contract fields". `adminMaintenanceWindowInputSchema` is the strict object of
  D2 (without the api-side reference rule and cap). `adminMaintenanceWindowSchema` is strict:
  `id: windowId | null`, `index: int >= 0 | null`, `source: adminCheckSourceSchema`, `checkIds`
  (1..50 distinct non-empty strings), `start`/`end` finite numbers with `end > start`, `note`
  non-empty text (the lenient public rule, because file notes have no cap), `phase`. Refinements:
  `source === "database"` ⇒ `id !== null && index === null`; `source === "file"` ⇒
  `index !== null && checkIds.length === 1`. `adminMaintenanceListSchema` is strict
  `{ revision, windows, shadowed }`, every `shadowed` entry has `source: "database"`.
- Keep `adminMaintenanceInputSchema`, `adminMaintenanceViewSchema`, `adminConfigResponseSchema`
  and `adminConfigExportSchema` byte-for-byte in behavior. Update the doc comment of
  `adminMaintenanceInputSchema` to say that the api no longer accepts it as a request body (the
  file window shape); do not remove it.
- `WIRE_VERSION` stays `1` (`src/version.ts`).
- Validators follow the existing rules: never throw, return the same object, refuse unknown keys.

Checks (written first, failing on `66818a2` because the exports do not exist):

- input: accepts `{id:"a", checkIds:["web"], start:0, end:1, note:"x"}`; every counterexample row of
  D2 (ids, checkIds, times, note) is refused with a path in the error.
- time boundary: `MAX_MAINTENANCE_TIME === 253402300799999` (literal). The input schema accepts
  `end: 253402300799999` and refuses `end: 253402300800000` and `end: 8640000000000000` at path
  `end`. Compatibility proof: build an export object whose single maintenance entry has
  `start: new Date(253402300799998).toISOString()` and `end: new Date(253402300799999).toISOString()`.
  The test asserts the literal string `"9999-12-31T23:59:59.999Z"` for `end`, and
  `validateAdminConfigExport` returns literal `ok: true`. The same object with
  `end: "+275760-09-13T00:00:00.000Z"` returns `ok: false`. The literals come from ECMAScript
  `Date.prototype.toISOString` (four-digit year up to 9999, expanded `+YYYYYY` year after it), not
  from the code under test.
- view/list: accepts a file entry `{id:null,index:0,source:"file",checkIds:["web"],...}` and a
  database entry; refuses a database entry with `index: 0`, a file entry with two check ids, an
  unknown key, a `shadowed` entry with `source: "file"`.
- adversarial: `__proto__`/`constructor` keys and accessor properties in the new bodies are
  refused without calling the accessor.
- `validateAdminConfigResponse` and `validateAdminConfigExport` still refuse a maintenance entry
  with an extra `id` key (literal expectation `ok: false`), proving the old shapes did not widen.
- `test/types.fixture.ts` compiles with values of every new type.
- `ADMIN_STATUS_ORDER` statuses stay `[404, 401, 403, 413, 400, 428, 503, 412, 422, 409, 404]`
  (literal list in the test).

Tool facts: `bun run check` is `bun run lint && bun run build && bun run typecheck && bun run test`
(`package.json:28`); Bun `1.4.0` (`package.json:7-9`); Biome `2.6.3` (`package.json:31`) with
`biome.json` extending `@lorenzh/pulse-config/biome.json`, whose `includes` excludes `**/dist`
(pulse-config `biome.json:10-16` at the pin `51e95b0`, identical to the clone); CI uses
`lorenzh/pulse-config/.github/workflows/check.yml@51e95b0` with `build: true`
(`.github/workflows/ci.yml:16-19`), which runs `bun run build` and `git diff --exit-code -- dist`
(pulse-config `check.yml:32-36` at `51e95b0`, identical to the clone); coverage threshold lines 0.8
(`bunfig.toml:3`).

Completion evidence: `bun run check` passes; `git diff --exit-code -- dist` after `bun run build`
is clean; `package.json` version reads `2.3.0`; the PR lists the new exports.

## Repository: api

Files:
- `package.json`, `bun.lock` (contract pin to the merged contract SHA)
- `src/migrations.ts` (step 8)
- `src/maintenance-store.ts` (new: SQL of `maintenance_definitions`, in a caller's transaction)
- `src/maintenance-write.ts` (new: the window writer)
- `src/effective-maintenance.ts` (new: pure projection and shadow split)
- `src/config.ts` (optional file `id`, uniqueness)
- `src/config-holder.ts`
- `src/check-store.ts` (snapshot validation keeps the optional `id`)
- `src/config-write.ts` (config view strips `id`; the file writer no longer receives window edits)
- `src/config-export.ts` (exports the effective projected windows)
- `src/admin-routes.ts`
- `src/service.ts` (cache clear on a new window array)
- `src/start.ts`
- `src/metrics.ts` (only if the write metric needs a kind or result value)
- `src/maintenance-write.test.ts` (new: writer unit tests, revision, audit, cap, rollback)
- `src/server.maintenance-admin.test.ts` (new: HTTP tests of checks 1 to 5 on a real server)
- `src/effective-maintenance.test.ts` (new: projection, shadow split, array identity)
- `src/config.maintenance.test.ts` (existing: optional file `id`, duplicate id)
- `src/service.maintenance.test.ts` (existing: cache clear, tie order)
- `src/config-admin.test.ts` (existing: file-window write cases become read-only cases)
- `src/config-export.test.ts` (existing: projected windows, time boundary)
- `src/db.migrations.test.ts` (existing: step 8)
- `src/start.file-fallback.test.ts` (existing: windows after a start from the snapshot)
- `src/docs-claims.test.ts` (existing: reload sentence)
- docs: `README.md`, `docs/configuration.md`, `docs/operation.md`, `docs/rest-api.md`,
  `docs/concepts.md`

Behavior change: yes. New storage, routes and effective windows; admin file-window writes end.

Behavior: D1 to D9. Wiring in `src/start.ts`: create the window store after the check store,
pass its list to `createConfigHolder`, create the window writer with the shared `writeLock`,
`db`, `audit`, `holder`, `fileRevision: () => reloader.revision()` and `now`, hand it to
`createAdminHandler`, and add `databaseMaintenanceWindows` to the `listening` line. The reload's
`onApply` and the check writer keep their order (SQLite first, holder after commit); the holder
recomputes the projection on each of its setters.

Docs:

- The reload contradiction is in `docs/concepts.md:46` ("Windows come from the checks file at
  start, so a changed file applies from the next start"), against `docs/configuration.md:215` and
  `docs/operation.md:224` (applied at every reload; a removed window ends at once). Fix
  `concepts.md` to the reload behavior and add both sources; add a `src/docs-claims.test.ts` case
  that refuses the old sentence and requires the new one.
- Replace "windows live only in the file" and "may reference only file checks" for windows
  (`README.md:11`, `README.md:58`, `docs/operation.md:213`, `:215`, `:261`,
  `docs/configuration.md:230`, `docs/rest-api.md:31`, `:413`, `:423`, `:429`, `:433`, `:437`, `:498`)
  with the database model, the optional file `id`, `GET /admin/maintenance`, the status order and
  the export rule. Component statements stay.

Checks (written first; the four marked ★ are the issue's "Done when" and fail on `32704fd`):

1. ★ **Database window silences the named checks** (HTTP, real server on port 0): file check `a`,
   database check `b`, file check `c`; `POST /admin/maintenance` `{id:"w", checkIds:["a","b"],
   start, end, note:"db upgrade"}` → 201, `Location: /admin/maintenance/w`, new `ETag`, file bytes
   unchanged (compared with the bytes read before the request). With `now` inside the window,
   `GET /checks` shows `state: "maintenance"` and `maintenance.note === "db upgrade"` for `a` and
   `b`, not for `c`; three locations posting `down` for `b` open no incident and leave
   `consecutiveDown` at 0, while the same for `c` opens one; a heartbeat in the window is not
   expired. `GET /maintenance` has exactly two entries for `w` with keys
   `checkId,start,end,note`. On `32704fd` the POST answers 422 or 503.
2. ★ **Shadowed id reports the file version**: after (1), apply a file with window
   `{id:"w", checkId:"a", note:"file note"}`; `GET /admin/maintenance` lists `w` in `windows` with
   `source:"file"`, `note:"file note"`, `index:0`, and the database `w` (`checkIds ["a","b"]`, note
   `db upgrade`) in `shadowed`; `b` is no longer in maintenance. `PUT /admin/maintenance/w` → 409,
   `POST` id `w` → 409. Remove the file window, reload: the database `w` is effective again
   (`b` in maintenance), also after a restart on the same database. `DELETE` while shadowed → 204,
   file window stays.
3. ★ **Broken file still allows database writes**: apply a valid file, write `{` over it, poll;
   `GET /admin/config` shows `file.state: "invalid"`; with the revision of `GET /admin/maintenance`,
   `POST`, `PUT` and `DELETE` of a window answer 201/200/204; the file bytes, `file.state` and
   `file.lastAppliedAt` are unchanged. Repeat with a read-only directory fake (`assertWritable`
   throws `EROFS`): 201, never 503. Restart from the snapshot: the windows are there.
4. ★ **Wrong revision answers 412**: a window write with the `ETag` from before a check write, a
   file reload, or another window write answers 412 and changes nothing (list, generation, audit
   count); a check write with the `ETag` from before a window write answers 412; two concurrent
   `POST`s with one revision give one 201 and one 412; missing `If-Match` 428, `*` 400.
5. Validation and access: every counterexample row of D2/D4 with its literal status; a token with
   only `admin` or only `checks` gets 403 on a write; a `read` token gets 200 on `GET` and 403 on a
   write; a probe token 403; no credentials 401; a 1 MiB + 1 byte body 413; no error body or log
   line contains the note text (assert with a unique note string).
6. Audit: each successful create/replace/delete adds one entry with action `maintenance.<action>`,
   target `{kind:"maintenance", id:"w"}`, the actor and the response `ETag` revision; an injected
   audit failure answers 500 and leaves list, generation and effective set unchanged.
7. Cache and identity: prime `GET /checks` in window `w`, `PUT` a new `note` and a new `end` with
   the same `start`: the next read shows them; `DELETE`: the next read shows the stored state.
   `holder.get().maintenance` returns the same array object across two calls without a change, and a
   new one after a window write (unit test).
8. File compatibility: every existing `config.maintenance.test.ts` and
   `service.maintenance.test.ts` case passes unchanged; a file with a window `id` loads; a
   duplicate file id is rejected; a file note of 600 characters still loads; `checks.example.json`
   still loads.
9. References: the "missing member" counterexample; a file reload that removes check `a` applies
   (state `ok`) with database window `w` naming `a`.
10. Export and old console shapes: with database window `w` and a file window with `id`,
    `GET /admin/config` passes `validateAdminConfigResponse` and its `maintenance` holds only the
    file window, without `id`; `GET /admin/config/export` passes `validateAdminConfigExport`, holds
    the file window then one entry per effective check of `w` with ISO times, no `id`, and no
    shadowed window. Both validators are the ones of contract `66818a2`, whose behavior the
    contract task keeps; the expected `ok: true` is literal.
    Boundary: `POST` a window with `start: 253402300799998, end: 253402300799999` gets 201, its
    export entry has `end` equal to the literal `"9999-12-31T23:59:59.999Z"`, and the whole export
    passes `validateAdminConfigExport` of contract `66818a2` (literal `ok: true`). `POST` and `PUT`
    with `end: 253402300800000` or `end: 8640000000000000` get 422 and leave the list unchanged.
11. Migration: a database at `user_version` 7 opens, gets version 8 and an empty
    `maintenance_definitions`; a snapshot without window ids loads.
12. Docs claim test of the reload sentence.

Tool facts: Bun `1.4.0` (`package.json:9`, `packageManager` `package.json:35`); `bun run check` is
`bun run lint && bun run typecheck && bun run test` (`package.json:20`); `lint` is
`biome check . && pulse-eslint . && pulse-workflows` (`package.json:16`); Biome `2.6.3`
(`package.json:23`), `biome.json` extends `@lorenzh/pulse-config/biome.json` whose `includes` are
`**` minus dist, node_modules, bun.lock, html and test fixtures (pulse-config `biome.json:10-16`
at the pin `04108fa`, identical to the clone); `bunfig.toml:2-3` turns coverage on with lines 0.8;
CI `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa`
(`.github/workflows/ci.yml:17-18`), which runs install, lint, typecheck and test with Bun 1.4.0
(pulse-config `check.yml:24-38` at `04108fa`, identical to the clone); the contract pin is
`package.json:31`; `bun start` runs `bun src/main.ts` (`package.json:12`).

Completion evidence: `bun run check` passes; checks 1 to 4 shown failing on `32704fd` and passing
on the branch (the PR names the failing assertion of each); one `bun start` run with a checks file
and an admin token where `POST /admin/maintenance` answers 201 and `GET /maintenance` shows the
window, with the commands and answers in the PR; the performance measurement of
"Performance impact" with both numbers.
