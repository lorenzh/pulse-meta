# Issue review: #565 — database checks alongside checks.json

## Outcome

Ready for `plan`. No unanswered product question blocks the spec. The decisions in #460 settle several ambiguities in the issue body; the remaining points below need explicit choices in the plan. This review changes no target repository.

## Inputs and decisions already made

- Read the repository `AGENTS.md`, `README.md`, and issue-review prompt, and the api, contract and deploy instructions.
- [#565 comments](https://github.com/lorenzh/pulse-meta/issues/565): at review time there is only the Factory claim for this run, with no earlier review decision.
- [#460, decision 4](https://github.com/lorenzh/pulse-meta/issues/460): file and database sources coexist; file checks win and are read-only; database checks remain stored when shadowed.
- [#460 clarification of 2 November, sections 1 and 8](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362) explicitly extends #565:
  - Expose header env reference names. Stored literal header values and bodies are write-only, shown as set and kept on save unless replaced. Return keep markers.
  - Host bindings remain solely in the probe's `PULSE_PROBE_HEADER_HOSTS`. Neither api nor Console reads or edits them.
  - A database create cannot reuse an id in the file. A later file collision shadows the existing database check; only Delete and Export are available for that database entry.
  - `GET /admin/config` reports file state `ok`, `invalid`, `unreadable` or `written-not-applied`, a safe api message, last successful file-apply time, and source/shadowed metadata per check. Last valid file configuration remains in use; database writes do not depend on a broken file.
  - Export the effective set with env names and without literal header values or bodies. Import into the database is after the MVP.
- [#380](https://github.com/lorenzh/pulse-meta/issues/380) is closed. Its file-only admin writes are the baseline being extended, not a reason to retain file writes for checks. Preserve its validation, authentication, history and secrecy guarantees unless this feature explicitly changes them.
- The named design/quality artifacts were not found in the local repository or the accessible Pages search results. No claim here depends on unseen boards. #460's clarification explicitly overrides older board content.

## Current implementation inspected

Read-only clone heads: api `2d4a6b23d532e66ad30840a778ac21ab465647dc`, contract `7ce23aaf3fa3e038f65ecfed755188b83bde143f`, deploy `621cbf0ecbd98b7dca1424055fba12f657827410`.

| Area | Evidence and implication |
| --- | --- |
| Current source of definitions | `api/src/start.ts` calls `loadInitialConfig` before opening SQLite, then `service.upsertChecks(initial.config.checks)`. Reload calls the same upsert and swaps the config holder. An invalid/unreadable startup file currently prevents even opening the database. |
| SQLite already contains checks | `api/src/db.ts`, `src/migrations.ts` and `src/service.ts` contain runtime check rows, including request options, state and history. `upsertChecks` clears request options, deactivates all rows, then upserts the supplied file checks. There is no independent editable definition or origin to recover after a collision. “Only in checks.json” means authoritative definitions, not absence of a checks table. Reusing these runtime rows alone would lose shadowed data and deactivate database checks at reload. |
| File write protocol | `api/src/admin-routes.ts` checks directory writability for every config write. `src/config-write.ts` reads current disk bytes, checks their hash against `If-Match`, edits and validates the document, then writes/fsyncs/renames/fsyncs and applies it. A rejected external edit leaves the applied revision unchanged, so a newly read admin revision still fails the disk comparison with 412. |
| Admin redaction | `api/src/config-write.ts:checkView` and `contract/src/admin.ts` return header names as an array and `hasBody`, without values or env references. `PUT` replaces the check, preserving only an omitted heartbeat secret. Sending the view directly is not a valid write body; reconstructing a write without the hidden HTTP fields drops them. |
| Runtime consumers | `api/src/service.ts:listProbeChecks` and `src/server.ts` serve full active request options to authenticated probes; public reads omit sensitive request fields. Availability targets come from the config holder. Heartbeat authentication reads the holder's separate secret map. All these paths need the effective union, not just an extra admin listing. `probe/src/client.ts` already fetches `/probe/checks`, resolves env references and skips heartbeat checks. |
| Cross-reference validation | `api/src/config.ts:parseConfig` validates components/windows against the checks in the same file. `config-write.ts` rejects deletion of checks referenced by components or windows. The plan must account for database ids without accidentally depending on successful parsing of the current broken file. |
| Durability and audit | `api/src/migrations.ts` has numbered migrations through step 5. File writes use `audit_pending` and fsync recovery in `config-write.ts`; `audit-log.ts` records admin writes. Database writes must preserve the acknowledged-write/audit guarantee with an appropriate transaction, not reuse file-temp-file recovery blindly. |
| Contract | `contract/src/admin.ts`, `src/validate-admin.ts`, `src/revision.ts`, `src/version.ts` define strict admin views/inputs, a file-hash revision, status order and wire version 1. Changes need validators, exported types, type fixtures, generated `dist/` and docs. |
| Compose test ownership | `deploy/e2e/compose-e2e.sh` owns the admin CRUD/probe/status scenario. It explicitly expects 503 for check writes on a read-only mount. `e2e/compose.e2e.yaml` and `full/compose.yaml` document file-writing behavior. `deploy/.github/workflows/ci.yml` runs this test; api CI no longer owns it. |
| Other clients | `console/src/page.ts` is still a scaffold. `status/src/api-filter.ts` has a public-read allow-list and strips request secrets. No Console screen or status/probe protocol change is needed to deliver the api feature. |

## Open points for the plan

### 1. Definitions, precedence and identity

Choose a durable representation of database-owned definitions separate from the effective runtime rows, including enough data for a shadowed check to return unchanged when its file override disappears. Do not turn existing runtime rows into database-owned definitions on upgrade: they originated from the file and may be inactive history.

Specify the admin representation of both entries with the same id. A single effective entry with only a `shadowed` flag cannot let a client identify the hidden database version. Select stable source values and an unambiguous address for deleting/exporting that database entry without touching the file. Reject creates against ids in the last applied file as well as duplicate database ids. Define the error/status for attempts to replace/delete a file entry, and to replace a shadowed database entry, even when the file is writable.

Keep runtime identity and historical results keyed by check id unless the plan documents a necessary change. Specify what happens to state/incidents when the effective definition changes type or target at a shadow/unshadow transition. A file override disappearing must not accidentally deactivate an id still supplied by the database.

### 2. Lossless save semantics

Define exact read and write shapes for literal-header keep markers, visible `{env}` references, body keep/replace/remove, and heartbeat secret keep/rotate. Sections 1 and 8 of #460 require env names and keep markers even if partial updates are also offered. Preserve ordinary full-replacement behavior where practical, but make a normal read/edit/save preserve hidden fields.

Specify omitted versus explicit removal for the header collection, one header and the body. Resolve markers only against the same existing database definition, never against a file override or another id. Define invalid keep-on-create/missing-value behavior, header-name case handling, and check-type/method changes. Validate the materialized check after resolving markers so that GET/HEAD body restrictions and all current bounds still apply. Markers must never reach probes or be stored as actual request values.

Define the projection from an admin row to a write request: source/shadowed metadata should not become freely writable fields. Test the documented GET-to-PUT flow, not a replacement built with remembered plaintext values.

### 3. Revision and 412 recovery

The current ETag is only a hash of raw file bytes. Choose a revision scheme that also detects database edits and relevant applied-file changes; every success returns a usable next revision. Keep missing `If-Match` (428), malformed (400), and genuine stale-edit (412) protection, including two simultaneous writes based on the same read.

A bad file must not make every fresh database write stale. Base concurrency on the applied state and the database revision, or explicitly expose separate revisions with documented use. Decide how races between a valid file reload and a database create/update are serialized, especially a new file collision. Re-read after a genuine 412 must provide a revision that can succeed while the file remains invalid/unreadable. Do not repair or overwrite the operator's bad file as a side effect.

### 4. File state, failure and startup

Define fields, timestamp units/nullability and safe messages for the four owner-decided states. Distinguish parse/validation failure, read failure and valid-but-not-applied failure; the latter can still occur through the existing component/window file writer. Track last successful file apply separately from database writes. Fixing the file and polling or SIGHUP must clear the failure state and apply it without losing database changes. Keep retry-on-apply-failure behavior and avoid repeating invalid-file logs on each idle poll.

Cover startup and restart explicitly: today startup fails before SQLite opens. The review assumes “a broken file never blocks database checks” includes an existing database starting with a bad/missing file. Choose whether a last-valid file snapshot is available across restart, and how the api starts with database checks when no snapshot exists. State the effect on file-only checks and shadowing in that fallback. Do not silently treat a broken hot reload as a valid empty file or discard the running last-valid file.

No new file-repair UI is required: safe file-state metadata plus documented repair/reload and fresh-revision retry can make the failure visible and recoverable. File writability and file validity are different: valid read-only files are normal and must not prevent database CRUD.

### 5. Heartbeat credentials and other check types

The issue does not restrict types, so cover HTTP, TLS, TCP, DNS, domain and heartbeat checks with their existing defaults/refinements. #380 kept raw heartbeat secrets only in the file and memory; the current runtime table has no heartbeat credential column. Specify durable authentication for database heartbeat checks, preferably a verifier rather than storing the raw credential. Preserve write-only create/keep/rotate behavior and file precedence for the credential as well as the check fields. Do not persist file heartbeat plaintext merely to support a fallback snapshot.

Only env reference names, never resolved header secrets or probe host bindings, belong in stored definitions/admin views. Literal header values and bodies may be stored as the existing request configuration, but remain write-only to admin clients.

### 6. Components and maintenance boundaries

The database redesign for components/windows is a separate follow-up in #460 sections 10 and 19. Keep their current storage model here, with only integration changes needed for effective checks and revisions. Specify whether file components/windows may reference database-only ids; the existing self-contained file validation cannot do so. A minimal assumption is to keep that rule for this issue and document it, rather than introduce database components implicitly.

Run deletion/reference checks against the resulting effective set. Deleting a shadowed database copy should remain possible when the winning file copy still satisfies references; deleting the last effective definition must preserve existing reference conflict rules. Keep component/window file writes from dropping or modifying database checks when they reload the file.

### 7. Export is redacted configuration

Choose the authenticated route, scope, filename/content headers and contract schema. The bulk export contains exactly one effective definition per id, with the file version winning, and preserves env reference names. It excludes literal request-header values, bodies and heartbeat secrets; “without literal values” does not mean removing normal ids, URLs or timing numbers.

Reconcile that redaction with the `checks.json` file format: required heartbeat credentials cannot be exported, and admin keep markers have no meaning in a standalone file. Specify omissions/placeholders and document what the operator must supply before use. Do not claim a fully runnable or lossless backup where values were removed, or leak plaintext to make it runnable. Decide whether effective file components/windows are included in the document; retain existing file timestamp formats if included.

#460 also allows Export on a shadowed database row. Define whether a source-selected single-check export is provided here alongside bulk effective export, or how that later client action is supported. A source-selected export must not change the rule that the bulk effective export excludes shadowed definitions. Import and automatic file-to-database migration are out of scope.

### 8. Compatibility, permissions and observability

Choose an additive admin extension or a documented migration of existing admin shapes. Do not silently change global wire version behavior in a way that makes otherwise unchanged probes/status/notify reject responses. If an incompatible wire bump is necessary, enumerate consumer work and rollout explicitly; the preferred scope keeps public/probe check shapes unchanged.

Reuse current bootstrapped database token/scopes and shared throttle. `GET /admin/config` currently needs `read` or `checks`; check writes need `admin` plus `checks`. Choose export permission consciously because env names become visible. Keep size limits, strict unknown-field rejection, redaction, bounded metrics labels and audit action names. Database mutation, revision and audit entry should commit consistently; rejected writes change none of them. Keep existing file-audit recovery for component/window operations.

### 9. Targets, rollout and performance

Expect `contract` first, then `api`, plus a narrow `deploy` section after api for the actual compose test, affected mount documentation/comments, and rollout. Recheck clone main at planning time; do not assume unmerged follow-up features. Console UI, token management, imports, pause/test-run, new check types, multi-tenancy and notify/status configuration stores are outside this issue.

The deploy test uses released images pinned in `common/services.yaml`, not sibling api source. Specify how the test executes the new api: release then bump with the existing script, respecting deploy's image rules. Merely running the old pinned image does not validate the feature. Keep read-only config mounts; database CRUD should require only the existing writable database volume. Any remaining 503 file-writer test belongs on a still-file-backed component/window route with a valid body/revision.

Include performance impact in the plan: preserve stat-only idle file polling, avoid rebuilding the union or scanning results on every read, bound merge work by configuration size on changes, retain cache invalidation, and describe write/reload transaction cost and startup cost.

## Derived acceptance check

Use real API HTTP tests with contract-validated responses, temp files/SQLite, injected clocks/reload callbacks, and sentinel values. The observable end-to-end flow is: **create a database check while checks.json is read-only, see a real probe report it, edit it from its redacted admin view without losing request configuration, shadow it with a file edit, break the file while continuing database CRUD, repair it, export the effective set, and restart without losing database ownership or data.**

1. **Database ownership/persistence.** POST with a fresh revision returns 201 without changing file bytes. The check appears in `/checks` and authenticated `/probe/checks`; ingest works. PUT and DELETE operate on the database and invalidate caches. A file reload does not remove it. It survives reopening the same database. A deleted check leaves history readable and uses current inactive/incident-resolution semantics when no other source supplies its id. An upgrade preserves old results/incidents and does not import historical file rows as editable checks.
2. **Precedence and administration.** Create database id D, then apply a valid file containing a different D. Public/probe reads return exactly the file definition. Admin config identifies both origins and the shadowed database copy; forbidden edits cannot alter either source. Creating another database D or using an existing file id returns conflict. Remove the file D: the original database definition and credential work again, including after restart. Separately delete the shadowed database copy and prove file D remains effective.
3. **Lossless read/edit/save.** Create a POST check with a literal-header sentinel, an env-header reference and a body sentinel. GET exposes the env name and keep metadata, never the literal/body. Project the view as documented, change only the name and PUT it with a fresh revision. `/probe/checks` still contains the exact stored request values and env reference. Repeat save after restart; test explicit replacement and removal and invalid keep markers. The materialized result still obeys HTTP/type validation.
4. **Broken/read-only file independence.** After a successful load, introduce invalid JSON/schema content, then an unreadable/missing file. Each keeps the last applied file set in use and reports the correct safe state, message and unchanged last-applied time. With the latest admin revision, database create/edit/delete succeed throughout and do not modify the bad file. Existing database checks continue accepting results. Restart against the bad file and demonstrate the plan's documented database-serving fallback. Repair the file and poll/SIGHUP: state becomes ok, last-applied time advances and database changes remain.
5. **Apply failure and concurrency.** Force a valid file apply to fail and check `written-not-applied`, unchanged effective state and eventual retry/recovery. A database save does not falsely mark the file applied. Two writes with the same revision yield one success and one 412; refetch/retry succeeds. Missing/bad/stale revisions retain their documented statuses. A collision racing with a file reload never overwrites the winning file definition or loses the database definition. Failed storage/audit commits leave no partial acknowledged change.
6. **All types and credentials.** Validate existing types/refinements/defaults for database checks. A database heartbeat accepts the configured secret after restart; omitted secret on update keeps it, rotation rejects the old one, and shadow/unshadow uses the correct source's secret. Raw heartbeat secrets never appear in admin/export/public responses, logs, metrics or audit. File heartbeat plaintext is not newly persisted as a side effect.
7. **References and file-backed operations.** Preserve rejection of deleting the last effective check when a component/window requires it; allow deletion of a shadowed copy when the file still supplies the reference. A component/window file write does not erase database checks, their request options, source metadata or revision protection. Exercise the documented rule for references to database-only ids.
8. **Export.** Authorized download is a checks.json-shaped redacted document with one definition per effective id, the winning file version and env reference names. Shadowed database definitions are excluded from the bulk result. Check the documented selected-row export if provided. Assert absence of literal-header/body/heartbeat sentinels and admin-only metadata/keep markers. Validate the documented omission/placeholder policy, including what must be supplied before loading an exported heartbeat check.
9. **Security/contract regression.** Preserve feature-off, unauthenticated, insufficient-scope/probe-token, throttle, body-limit, malformed-input and reference-error behavior. New views, writes and export conform to the chosen contract; public/probe shapes remain usable by existing consumers. Update the existing sentinel test that currently bans env names from admin reads: env names are now intentionally visible only in the authorized views/export, while actual values remain hidden. Public status paths gain no admin/export proxy.
10. **CI and stack proof.** During implementation, add regressions and show their expected failure against current main for database persistence/probe delivery, file precedence, GET-to-PUT preservation and broken-file writes. Run contract/api `bun run check`, rebuild contract `dist/`, exercise the changed api through `bun start`, and run deploy checks appropriate to its changes. Updated `bash e2e/compose-e2e.sh` against the new api must prove admin-created database check → real probe result → status visibility → update/delete, file override and failure recovery, plus database persistence across restart. Document the tested image/version and keep the full CI/compose gate green.

## Verification of this review

This is a specification input, not an implementation. Findings above come from source/docs and issue comments; no product test or compose run is claimed. Later states must choose the remaining details and execute the acceptance checks. Keep this artifact in `.factory/work/565/`; do not add it to ignore rules.
