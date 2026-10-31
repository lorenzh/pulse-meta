# Spec #561: api: hashed, scoped admin and probe tokens with rotation

Source: [#561](https://github.com/lorenzh/pulse-meta/issues/561), decision 6 of [#460](https://github.com/lorenzh/pulse-meta/issues/460), and the issue review in `.factory/work/561/issue-review.md`. This spec settles every open point of that review. Inspected state: api `main` `c00a375a1d78e17e9d01b8c25b5ae69b4fc3860e`, contract `main` `ebcbbb613328494185833f7133f1242910986948`, probe `main` `50ec9cabe8aebe6164eff6cf2272b0a6c6c86605`, console `main` `11a3f5f`, config `main` `dc69a12`, deploy `2b2a355` (README and license only).

Revision after plan-review (the six corrections of the plan-review comment on #561):
1. Bootstrap order: the database is opened and migrated first, the bootstrap rows decide which files are read, and a done import never opens its file (D5, with missing, malformed and directory cases in `## Counterexamples`).
2. Audit target ids have no maximum, matching check ids; `targetId` queries too (D7, D9, regression case with a 300-character id).
3. Pending config entries are resolved by the existence of the api's own temp file, not by comparing file revisions, so an external restore A → B → A never erases a stored write (D8).
4. Pending entries live in a separate `audit_pending` table and get their `audit_log` id when they commit, so a cursor walk cannot skip them (D4, D9, interleaving case with literal ids).
5. Clock-dependent expiry rules are the api's; the contract checks only the clock-free form and its tests accept `expiresAt: 1` (`## Counterexamples`, contract section).
6. The collision search covers all 49 new names, and every tool fact cites file and line, including the pinned config files read with `gh api`.

Second revision after plan-review (the two D8 corrections of the second plan-review comment on #561):
1. The temp file's directory entry is made durable (`fsyncDir` after `writeTemp`) before the pending row is inserted, so a power loss before the rename cannot leave a durable pending row without its temp name (D8 step 3).
2. Every delete of a pending row on an abort or a resolver drop runs as a durable statement (`synchronous = FULL` in that revision, `EXTRA` since the fourth revision), and the temp file is removed only after that delete returned without error. A failed delete keeps the temp file as evidence (D8 "Rule for removing a temp file", "Durable abort").
3. A crash-model fault-injection suite checks both windows: every crash point, with the file system's un-synced changes either kept or dropped, and un-synced SQLite commits dropped (`## Counterexamples` "Power loss", api `src/config-write.crash.test.ts`). The guarantee and `## Risks` follow the corrected protocol.

Third revision after plan-review (the D8 correction of the third plan-review comment on #561):
1. **Rule for promoting.** A pending row is promoted only after an `fsyncDir(dir)` that started after the api saw the temp name missing returned without error. The write path already does this (step 7 runs only after step 6 succeeded). The resolver now does it too: one `fsyncDir(dir)` per resolution pass, before its first promote. If that sync fails, every row of the pass whose temp file is missing stays pending, and the request goes on. So the reviewer's case no longer gives an entry for an undone rename: a step-6 sync fails, then the next request's resolver sees `ENOENT`, then that request fails its revision check, then a power loss. The resolver either synced the rename to disk before it promoted, or it promoted nothing.
2. **Rename that throws.** When `rename` throws, the abort first checks the temp file with `lstat`. A missing temp file means the rename took effect even though it threw. The row then stays pending for the resolver and is not dropped (D8 step 5).
3. **Crash model.** `CrashPendingAudit` now keeps any prefix of the un-synced commit tail: every `k` from `0` to its length, not only `0`. `CrashFs` applies any subset of the un-synced directory changes. The suite runs every crash point against every combination of the two, so a retained SQLite commit is tested together with a lost file change. New rows cover the reviewer's interleaving and a process crash followed by a power loss. A fourth named mutation, a resolver that promotes without the sync, must turn the suite red (`## Counterexamples` "Power loss"). The guarantee, `## Risks`, `## Security impact` and the api section follow.

Fourth revision after plan-review (the two corrections of the fourth plan-review comment on #561):
1. **Durable in both journal modes.** The helper is now `withDurableCommit(db, fn)`. It raises `synchronous` to `EXTRA` (3), not `FULL`. SQLite documents that `FULL` "is not necessarily durable across a power loss in rollback mode" and that "EXTRA is no different from FULL in WAL mode" ([SQLite `synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous)). So a durable statement is on disk when it returns both on a WAL file and on the rollback-journal (`delete`) fallback of api `src/db.ts` lines 150-163. The crash model gets a journal-mode dimension (`wal`, `delete`) and a permanent negative control: in `delete` mode at level `FULL`, an abort delete can be lost while its unlink persists (the failing cell is `k = 1` since the fifth revision). The real-SQLite tests check level `3` inside the statement on a WAL file, on a `delete` file and on `:memory:` (D8 "Durable statement", `## Counterexamples` "Durability" and "Power loss", `## Risks`).
2. **Recovery-test counts.** Every recovery case that runs a later successful config write counts that write's own entry too. Its assertions name each entry by its revision and give the exact total after each response (`## Counterexamples` "Durability").

Fifth revision after plan-review (the correction of the fifth plan-review comment on #561):
1. **Negative-control cell.** With `{ journal: "delete", durableLevel: 2 }` the pending insert is not durable either, so the non-durable tail of the abort row is `[insert, delete]`. The failing cell is `k = 1` (insert kept, delete rolled back), not `k = 0` (both lost, which gives the correct File A with 0 entries). The negative control now asserts exactly the cell "mode `"delete"`, subset with the unlink, `k = 1`" and names the literal outcome of the other five cells. The explanation of the `FULL` mutation says the same, and it adds that this mutation also fails the "`rename`, subset with the rename" row at `k = 0` (File B with 0 entries). The model, the table, the protocol and the guarantee are unchanged (`## Counterexamples` "Power loss").

## Goal

The api keeps every admin and probe credential in its SQLite database as a SHA-256 digest only. Each credential has a name, scopes, a creation time, a last-used time, an optional expiry and a revocation time. Admins create, list, rotate and revoke credentials over HTTP. Rotation keeps the old credential valid for a fixed 10-minute overlap, so a probe or a script can switch without downtime. Every admin write is stored as a secret-free audit entry, and the entries can be queried and exported as JSON lines. The token files are read only once: they import the existing credentials on upgrade and seed the first admin on a fresh install.

## Scope

- contract: types, schemas, validators and constants for token metadata, scopes, token create input, the create/rotate response, audit entries and the audit page. Updated text of `ADMIN_STATUS_ORDER`.
- api: migration step 4, a token store with an in-memory index, a one-time file import, scope checks on every protected route, the `/admin/tokens*` and `/admin/audit*` routes, durable audit records for config, manual-incident and token writes, docs, and an updated Compose e2e.

## Non-goals

- Console screens, accounts, roles beyond the five scopes, multi-tenant (#561 non-goals).
- Pushing new credentials to probes, or reloading the probe token without a restart. The probe reads `PULSE_PROBE_TOKEN` at start (probe `src/token.ts`). An operator restarts each probe with its new token during the overlap.
- Auth on today's public read routes (`/checks`, `/uptime`, `/manual-incidents` GET, ...). They keep their current behavior.
- Audit retention, audit delete or edit routes, and tamper-proof external audit storage. The audit table only grows (see Risks).
- A recovery CLI for a lockout. The recovery path is restoring a database backup (`bun run backup`).
- Moving Compose or e2e files to `deploy` (#528). The deploy clone holds only `README.md` and `LICENSE`, so #528 has not landed. This spec changes api's own `compose.yaml`, `compose.e2e.yaml` and `scripts/compose-e2e.sh` where needed.
- The check-storage redesign of #460 decision 4.

## Decisions

### D1. Scopes and the permission matrix

Scopes: `read`, `checks`, `incidents`, `admin`, `probe` (the order of `TOKEN_SCOPES`).

- A **probe token** has exactly the scopes `["probe"]` and a `location` (1-64 characters after trim, the api's `MAX_LOCATION_LENGTH` in `src/service.ts:38`).
- An **admin-side token** has 1 to 4 distinct scopes out of `read`, `checks`, `incidents`, `admin`, and `location: null`. `probe` never combines with another scope.
- `admin` is the mutation capability. It always goes together with a resource scope, except for token and audit administration.

| Route | Passes when the token holds |
|---|---|
| `GET /probe/checks`, `POST /results` | `probe` (the location binding stays as today) |
| `GET /admin/config` | `read` or `checks` |
| `POST/PUT/DELETE /admin/checks`, `/admin/components`, `/admin/maintenance` | `admin` and `checks` |
| `POST /manual-incidents`, `POST .../updates`, `POST .../resolve`, `DELETE /manual-incidents/:id` | `admin` and `incidents` |
| `GET /admin/tokens`, `GET /admin/tokens/:id` | `admin` |
| `POST /admin/tokens`, `POST /admin/tokens/:id/rotate`, `POST /admin/tokens/:id/revoke` | `admin`, plus the grant rule below |
| `GET /admin/audit`, `GET /admin/audit/export` | `admin` |
| every other route | unchanged (public, or a heartbeat secret) |

**Grant rule** (no privilege escalation): a caller may create, rotate or revoke a token only when every scope of that token is one the caller holds, where the `probe` scope counts as `checks`. The reason is that `/probe/checks` serves check headers and bodies. Otherwise the api answers `403` with `{"error":"forbidden"}`.

**Last-admin rule:** revoking the last active token that holds `admin` answers `409` with `{"error":"cannot revoke the last active admin token"}`. A token is active when it is not revoked and `now < expiresAt` (or it has no expiry). Expiry can still lock everyone out. Docs say so and name backup restore as the recovery path.

Legacy admin tokens are imported with `["read","checks","incidents","admin"]`. That is exactly today's access: config read and writes, manual-incident writes, plus the new admin routes.

### D2. Authentication failures and status codes

- `401` with `www-authenticate: Bearer` and `{"error":"unauthorized"}`: no Bearer header, unknown credential, expired token, revoked token, or a rotated-out credential after its overlap. The response body does not say which case it was.
- `403` with `{"error":"forbidden"}`: a valid, active credential without the needed scope.
- Intentional changes against `main`:
  - A probe token on a manual-incident write answers `403` (was `401`, `server.ts` `requireAdmin`).
  - An admin-side token on `/probe/checks` or `POST /results` answers `403` (was `401`).
  - Config routes already answer `403` to a probe token, so they keep that.
- The order on admin routes stays as in `ADMIN_STATUS_ORDER`: `404` feature off, then `401`, then `403`, then the route's own statuses. On `POST /results`, auth comes before reading the body, as today.
- Auth-failure logging (`src/admin-auth-failures.ts`) keeps its rate limit and metric. The `token` label becomes `missing | unknown | inactive | probe | scope`:
  - `inactive`: expired, revoked or retired.
  - `probe`: a probe token on an admin-side route.
  - `scope`: an admin-side token without the scope.
  The line never carries the token, its digest, its length, its id or its name. The probe routes keep their current behavior of not logging.

### D3. Feature gate

"Admin enabled" means the database has a stored `admin` bootstrap row (D5). This replaces today's "`PULSE_API_ADMIN_TOKENS_FILE` is set" gate. Before the first admin bootstrap, `/admin/*` and the manual-incident writes answer `404` and the manual-incident reads are empty, as today. After it they exist for good, even when the admin file is removed and even when all admins are revoked (then `401`).

### D4. Credential format, hashing, store and caching

- Generated secret: `pulse_` + base64url without padding of 32 bytes from `node:crypto` `randomBytes`, 49 characters. It meets the api's legacy rules (`src/tokens.ts`: at least 16 characters, no whitespace, no placeholder) and the console's rule of printable ASCII (console `src/admin-token.ts`).
- Token id: `tok_` + 24 lower-case hex characters (12 random bytes). Ids are never reused.
- Digest: lower-case hex SHA-256 of the UTF-8 bytes of the full presented secret, without salt. Lookup by digest needs a deterministic hash, and generated secrets carry 256 bits. Legacy secrets keep their own entropy: Risks name this and the docs recommend rotating imported tokens. No plaintext, ciphertext or reversible form is stored anywhere.
- Tables (migration step 4, appended to `src/migrations.ts`, released steps untouched):
  - `api_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, scopes_json TEXT NOT NULL, location TEXT, source TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER, revoked_at INTEGER, rotated_at INTEGER)`.
  - `token_secrets (secret_sha256 TEXT PRIMARY KEY, token_id TEXT NOT NULL REFERENCES api_tokens(id), created_at INTEGER NOT NULL, retires_at INTEGER)`. `retires_at` is null for the current credential.
  - `token_bootstrap (kind TEXT PRIMARY KEY CHECK (kind IN ('probe','admin')), imported_at INTEGER NOT NULL, count INTEGER NOT NULL)`.
  - `audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_token_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, revision TEXT)`, with an index on `(at, id)`. Only committed entries live here. A row's `id` is assigned in the transaction that commits it, so `id` order is commit order (D9).
  - `audit_pending (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_token_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, revision TEXT NOT NULL, temp_path TEXT NOT NULL)`. It holds the intent of a config write between its temp file and its confirmation (D8). Its ids are never shown.
- Names are labels and need not be unique. API-created names are 1-100 characters after trim, with no control character (`\p{Cc}`). Imported names keep the legacy rule (non-empty after trim, no maximum), so upgrades never fail on a long name.
- In-memory index: at start the api loads all non-revoked tokens and their non-retired credentials into a `Map<digest, entry>`. Every token mutation in this process updates the map after its transaction commits. A request computes one SHA-256 of the presented secret and does one map lookup, then confirms with `timingSafeEqual` against the stored digest. The map key is a digest, not the secret: a lookup timing reveals nothing usable about the secret. Expiry, revocation and `retires_at` are checked against `now()` on every request, so they act at once without a cache flush. The database is the only writer's state (one api process per database file, as today).
- Last used: on each successful authentication the in-memory `lastUsedAt` becomes `now()`. It is persisted with `UPDATE api_tokens SET last_used_at` only when nothing is persisted yet or the persisted value is at least 60 000 ms older. Shutdown flushes unpersisted values before `db.close`. API responses show the in-memory value. After a crash the persisted value can be at most 60 000 ms behind the last real use.

### D5. Bootstrap and one-time import

Startup order changes against `main` (api `src/start.ts` lines 142-160 read both token files before `deps.openDb` today):

1. Read the settings and load the checks file, as today.
2. Open and migrate the database (`deps.openDb`).
3. Read the `token_bootstrap` rows. They decide which imports are pending.
4. Open and parse only the files of pending imports: the probe file when no `probe` row exists, the admin file when no `admin` row exists and `PULSE_API_ADMIN_TOKENS_FILE` is set. A file whose import is done is never opened, read or parsed, so a missing, unreadable or malformed file after its import cannot fail the start.
5. Run the pending imports in one transaction, before `listen`.

A fresh install with a missing or invalid probe file still fails the start with today's message, but after step 2, so the database file exists (empty, version 4) afterwards. That is harmless: the next start retries the import.

- **Probe import** (when no `probe` bootstrap row exists):
  - `PULSE_TOKENS_FILE` (default `./tokens.json`) must exist and be valid under today's `parseTokens` rules. A missing or invalid file is the same `StartupError` text as today.
  - Each entry becomes a probe token with `source: "file"`, `scopes: ["probe"]`, its location, `name: "probe <location> #<n>"` (n = 1-based position in the file), `createdAt = now()`, and no expiry.
  - The transaction inserts the row `probe` with the count.
- **Admin import** (when no `admin` bootstrap row exists and `PULSE_API_ADMIN_TOKENS_FILE` is set):
  - The file must be valid under today's `parseAdminTokens` rules.
  - Each entry becomes a token with `source: "file"`, its trimmed name, `["read","checks","incidents","admin"]`, and no expiry.
  - A digest that equals any stored or co-imported digest refuses the start. A probe digest gives the message `admin tokens[<i>] is also a probe token: use a separate token`. Any other duplicate gives `admin tokens[<i>] repeats a stored token`. Neither message carries a token.
  - The transaction inserts the row `admin`.
- Every imported token gets one `token.import` audit entry (actor `{tokenId: null, name: "bootstrap"}`).
- Any failure rolls back the whole import transaction. The start fails, and a later start retries from scratch.
- When a bootstrap row exists, the matching file is not opened. If the setting is set explicitly in the environment, the start logs once at info: `"<setting> ignored: tokens are stored in the database"`, with the setting name only. It does not check whether the path exists, so no file-system access happens for it. File edits after import never add, change or revive credentials. A revoked, expired or rotated-out credential stays dead even when its old file is still mounted.
- Probe-only installs keep working: no admin file, so no `admin` row. Setting `PULSE_API_ADMIN_TOKENS_FILE` on a later start bootstraps the first admins then.
- "Zero active admins" never reopens the admin bootstrap (D1 last-admin rule, Risks).
- After the probe import, `PULSE_TOKENS_FILE` may be missing. New probe tokens come from `POST /admin/tokens`.

### D6. Token management routes

All of these routes answer with `cache-control: no-store`. Request bodies are limited to `TOKEN_MAX_BODY_BYTES` = 4096 bytes (`413` beyond it). Bad JSON answers `400`. Unknown or malformed `:id` answers `404 {"error":"token not found"}` after auth.

- `GET /admin/tokens` → `200 TokensResponse` `{ tokens: TokenMetadata[] }`. It lists all tokens, revoked ones included, ordered by `createdAt` ascending and then `id` ascending.
- `GET /admin/tokens/:id` → `200 TokenMetadata`.
- `POST /admin/tokens`
  - Body: `TokenCreateInput`, a strict object with `name`, `scopes`, `location?` and `expiresAt?`.
  - It is validated with the contract's `validateTokenCreateInput` (→ `400` with its message). The api also checks the clock: `expiresAt` must be greater than `now()` and at most `now() + 3650 × 86 400 000` (→ `400`). Then the grant rule applies (→ `403`).
  - → `201 TokenSecretResponse` `{ token, secret, previousValidUntil: null }` with `location: /admin/tokens/<id>`.
- `POST /admin/tokens/:id/rotate`
  - Body: empty or `{}`. Anything else → `400`.
  - A revoked token → `409 {"error":"token is revoked"}`. An expired token → `409 {"error":"token is expired"}`. A credential still in an active overlap (`retires_at > now`) → `409 {"error":"a rotation is still in its overlap"}`. The grant rule applies.
  - On success, in one transaction:
    - It deletes the token's credentials whose `retires_at <= now`.
    - It sets `retires_at = now + TOKEN_ROTATION_OVERLAP_MS` on the current credential and inserts the new one.
    - It sets `rotated_at = now` and writes the audit entry.
  - Name, scopes, location, `createdAt` and `expiresAt` stay. The new credential inherits the token's expiry, and the old one stops at `min(retires_at, expiresAt)`.
  - → `200 TokenSecretResponse` with `previousValidUntil = now + 600 000`.
- `POST /admin/tokens/:id/revoke`
  - Body: empty or `{}`. Anything else → `400`.
  - Already revoked → `409 {"error":"token is revoked"}`. The grant rule and the last-admin rule apply.
  - On success it sets `revoked_at = now`, which invalidates every credential of the token at once, the overlapping one included.
  - → `200 TokenMetadata`.
- A caller may revoke its own token, unless it is the last active admin.
- Write logs: `info("token write", { token: <actor name>, action, id })`. They never carry the secret, the digest, the name of the target or the body.

`TokenMetadata`: `{ id, name, scopes, location: string|null, source: "api"|"file", createdAt, lastUsedAt: number|null, expiresAt: number|null, revokedAt: number|null, rotatedAt: number|null, previousValidUntil: number|null }`. All times are epoch ms. `previousValidUntil` is the `retires_at` of a retiring credential while it is still `> now()`, else `null`. `scopes` come in `TOKEN_SCOPES` order. There is no field for the secret or the digest.

### D7. Audit entries

- Entry (`AuditEntry`, strict): `{ id, at, actor: { tokenId: string|null, name }, action, target: { kind, id }, revision: string|null }`.
- `actor.name` is a snapshot at write time. It is never joined against `api_tokens`, so a later revocation, rotation or rename does not change it.
- `action` is one of:
  - `check.create`, `check.replace`, `check.delete`
  - `component.create`, `component.replace`, `component.delete`
  - `maintenance.create`, `maintenance.replace`, `maintenance.delete`
  - `manual-incident.create`, `manual-incident.update`, `manual-incident.resolve`, `manual-incident.delete`
  - `token.create`, `token.rotate`, `token.revoke`, `token.import`
- `target.kind` is one of `check`, `component`, `maintenance`, `manual-incident`, `token`.
- `target.id` is a non-empty string with no maximum length. Check and component ids have no maximum today (contract `src/schema.ts` line 241 `id: nonEmpty`, api `src/config.ts` line 84 `ID_NAME = { id: requiredText(), ... }`), so any id the config accepts must give a valid entry. The value is:
  - a check or component: its id, unchanged (no trimming or truncation).
  - maintenance: the window index as decimal text.
  - a manual incident: its numeric id as text.
  - a token: its token id.
- `revision` is the checks-file revision after a config write (`sha256-<hex>`, already served as `ETag`). It pins a maintenance index to one file version. Other actions store `null`.
- Nothing else is stored or returned: no body, title, message, header, heartbeat secret, check URL, bearer value, digest, raw path or query string.
- Rejected attempts are not audit entries. They stay in the existing auth-failure and `... write failed` logs.
- Automatic work is not audit: result ingest, heartbeat pings, file reloads, retention, rollups.
- Retention never deletes `audit_log` rows.

### D8. Durability

- **Database-only writes** (manual incidents, tokens): the change and its audit insert run in one SQLite transaction. The HTTP response is written only after the commit. For manual incidents this moves `sendJson`/`writeHead` out of `applyManualWrite` to after the transaction. If the audit insert throws, the whole change rolls back and the client gets `500`. Its logging stays as today's "request failed".
- **Config writes** (file-backed). Today's `store` in api `src/config-write.ts` lines 358-372 runs: write the temp file `${path}.${tempSuffix()}.tmp` (exclusive create and fsync), the second revision check, `rename`, `fsyncDir`. The new sequence runs inside the writer's existing lock (`apply` chains on `tail`, lines 403-408):
  1. Resolve pending entries (below).
  2. Read the file, check `If-Match`, build the new bytes and `revisionOf(data)`, as today.
  3. Make the temp file durable, name included:
     - `fs.writeTemp(temp, ...)`, as today. It fsyncs only the file's data (api `src/config-fs.ts` lines 31-51: `openSync(path, "wx")` at line 33, `fsyncSync(fd)` at line 47). The new directory entry is not yet on disk.
     - New: `fs.fsyncDir(dir)` right after it (the temp file sits in the checks file's directory, `${path}.<suffix>.tmp`, `src/config-write.ts` line 359, so the same `dir` of line 338 covers it). After this call a power loss can no longer lose the temp name.
     - If either call fails: remove the temp file quietly and map the error as today. No pending row exists yet.
  4. Durably insert one `audit_pending` row with `revision = revisionOf(data)` and `temp_path = temp` (the "durable statement" rule below). Its commit is on disk before the rename, also across a power loss, in WAL mode and in the rollback-journal fallback. If the insert throws: run the durable abort (below) and answer `500 {"error":"audit log could not be written"}`. The checks file stays untouched (metric result `error`).
  5. The second revision check and `rename`, as today. If the revision check throws: run the durable abort, then map the original error as today. If `rename` throws: `fs.lstat(temp)` first. If the temp file exists, the rename did not happen: run the durable abort, then map the original error. If it is missing (`ENOENT`), the rename took effect despite the error. The row stays pending, the temp is not removed, and the original error is mapped as today. The resolver promotes it under the rule for promoting below. Any other `lstat` error also leaves the row and the temp file as they are, so no evidence is removed.
  6. `fsyncDir(dir)`, as today. If it fails, the row stays pending and the error is mapped as today (today's `catch` in api `src/config-write.ts` lines 368-371 maps it through `mapFsError`). The write path never promotes after a failed step 6.
  7. Promote (only after step 6 returned without error): in one SQLite transaction, insert the entry into `audit_log` (new id, `at` from the pending row) and delete the `audit_pending` row. This transaction runs under the connection's normal setting: `NORMAL` on a WAL file, `FULL` on the rollback-journal fallback (which is atomic but can lose its last commit across a power loss). It needs no forced sync: a promote lost in a power loss loses its insert and its delete together, so the durable pending row comes back, its temp file is still absent, and the resolver promotes it again.
  8. `reloader.adopt`, as today.

  If step 7 fails, or the process dies after step 4, the row stays in `audit_pending`. When step 7 fails the response is `500 {"error":"checks file stored; its audit entry is pending and is resolved at the next write or restart"}`.
- **Durable statement.** A new helper `withDurableCommit(db, fn)` in api `src/db.ts`. It is called only outside a transaction (it throws when `db.inTransaction` is true, because SQLite ignores a `synchronous` change inside one). It reads `PRAGMA synchronous`, sets `PRAGMA synchronous = EXTRA` (3) when the value is lower, runs `fn` (one statement in autocommit), and restores the value it read in a `finally`, also when `fn` throws. The pending insert, the abort delete and the resolver's drop delete all go through it. Why `EXTRA` and not `FULL` ([SQLite `synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous)):
  - The api runs a file database in one of two journal modes. `setJournal` (api `src/db.ts` lines 150-163) asks for WAL (line 156). When the file system refuses WAL, it logs `journal mode stays <mode>` (line 159) and keeps SQLite's default rollback journal, `delete`, with the default `synchronous = FULL`. `NORMAL` is set at line 162 only when WAL is on. Only WAL is stored in the file, so no other mode comes from an existing database.
  - WAL mode: "EXTRA is no different from FULL in WAL mode". At level 3 the WAL file is synced at the commit, so the statement is on disk when `fn` returns without error.
  - Rollback-journal (`delete`) mode: a commit is the unlink of the journal. At `FULL` that unlink need not be on disk, and SQLite documents that `FULL` "is not necessarily durable across a power loss in rollback mode": the journal can come back as a hot journal and roll the last commit back. `EXTRA` also syncs the directory after the unlink, so the commit is durable. Without it, a power loss can keep the temp-file unlink of an abort and roll its delete back, and the resolver would promote the row of a rejected write.
  - `:memory:` (tests only) reads `2` before and after and `3` inside. Durability has no meaning there, and the helper behaves the same.
  - A durable statement makes every earlier commit of the connection durable too: in WAL mode it syncs the WAL up to its frame, and in `delete` mode its directory sync persists the earlier journal unlinks. The crash model of `## Counterexamples` relies on this.
- **Rule for removing a temp file.** The api removes a temp file of a config write only after a durable statement that names that `temp_path` returned without error, or when it knows that no pending row was ever inserted for it (the step-3 failure). A temp file named by a pending row is the only evidence that the rename did not happen, so it stays on disk until the database durably says that no row needs it. Without this rule, a power loss can keep the unlink (the file system may write it out at any time) and lose a delete that is not durable (`NORMAL` in WAL mode, `FULL` in `delete` mode), and the resolver would then promote a row for a rejected write.
- **Rule for promoting.** The api promotes a pending row only after `fs.fsyncDir(dir)` returned without error, where that call started after the api saw the row's temp name missing. The rename removes the temp name and replaces the checks file name in the same directory `dir`, so that sync puts the rename on disk ([fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html): "calling fsync() on a file descriptor for the directory is also needed" for its entries). After it, no power loss can undo the rename, so the promote can run without a forced sync (`NORMAL` in WAL mode, `FULL` in `delete` mode): whether the promote itself persists or not, the file is B and the entry for B ends in `audit_log`. Without this rule, a promote that persists can outlive a rename that a power loss undoes. A `NORMAL` commit can reach disk at any later WAL sync or checkpoint, and a `FULL` commit in `delete` mode is on disk unless the power loss brings its journal back ([SQLite `synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous)). The result would be file A with an entry for B. Step 7 meets the rule through step 6. The resolver meets it with its own sync (below).
- **Durable abort** (steps 4 and 5, and the resolver's drop):
  1. Durably run `DELETE FROM audit_pending WHERE temp_path = ?` with the stored temp path. It is keyed by `temp_path`, which is unique per write (`tempSuffix` is pid plus 6 random bytes, api `src/start.ts` line 246), so it also removes a row whose insert reported an error but was committed anyway, for example an I/O error after the WAL write.
  2. Only when that delete returned without error: remove the temp file. A failed removal logs `"config temp file not removed (<code>)"` at warn (code only, no path). The orphan file has no row, so it never changes the audit, as today's leftovers after a crash between `writeTemp` and `rename`.
  3. When the delete throws: keep the temp file and log `"audit pending entry kept (<code>)"` at warn (code only, no path). The row, if one exists, stays pending with its temp file on disk, and the next resolution drops both. The response is the one the step would give without this failure.
- **Resolving pending entries** happens at startup once the database is open and migrated (D5 step 2), before `listen`, and at step 1 of each config write. One resolution pass reads all rows in ascending pending id and `lstat`s each `temp_path`. The evidence is the temp file, not the checks file content:
  - `temp_path` exists (`lstat` succeeds) → the rename never happened. Run the durable abort for it: durable delete first, then the removal.
  - `temp_path` does not exist (`ENOENT`) → the rename happened. A row exists only after its temp name was on disk (step 3 before step 4). On every failure path the row was durably deleted before its temp file was removed. And a rename that a power loss undid brings the temp name back. Such a row is a promote candidate.
  - Any other `lstat` error → leave the row pending, log `"audit pending entry unresolved (<code>)"` at warn (code only, no path), and continue. A config write then still proceeds.
  - After the `lstat`s, if the pass has at least one promote candidate: call `fs.fsyncDir(dir)` once (the rule for promoting). All rows name temp files in the same `dir`, so one sync covers every candidate. If it returns without error, promote each candidate in ascending pending id, each in its own transaction as in step 7. If it throws, promote none: every candidate stays pending, one warn line `"audit pending entry unresolved (<code>)"` is logged (code only, no path), and the pass ends. A config write then still proceeds. Its own step 3 and step 6 syncs guard its own row, and the candidates are promoted by a later pass whose sync succeeds. A pass without candidates makes no extra sync.
  - The checks file content is not compared. An external writer that restores the old bytes after a stored write (A → B by the api, then A by someone else) does not erase the api's entry: the temp file is gone, so the entry is promoted. This is the conservative answer: a change that landed is never removed from the trail.
- **Guarantee.** Query and export read only `audit_log`. This protocol does not make the file and SQLite atomic together. It guarantees, for a process crash and for a power loss at any point of the sequence, the abort and the resolver, also after a failed directory sync, also when SQLite happens to persist commits that were not forced to disk before the power loss, and in both journal modes of the api (WAL, and the `delete` fallback):
  - an acknowledged config write always has an entry in `audit_log`;
  - a rename that is on disk after the restart ends in `audit_log`, at the latest at the next write or restart;
  - a write whose rename is not on disk after the restart (rejected, aborted, or undone by the power loss) never gets an entry.

  This holds on a local file system where `fsync` of a file and of its directory persists what it reports and where `rename` is atomic across a crash (ext4, xfs, btrfs), which the current writer already assumes ([fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html)). It also needs SQLite's own durability at `synchronous = EXTRA`, which SQLite lists as ACID in rollback mode and in WAL mode ([SQLite `synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous)). Not covered, and documented: a disk or a network file system that acknowledges `fsync` without persisting, and a third party that deletes the api's temp file between steps 3 and 5 while the api crashes (that gives an entry for a write that did not land).

### D9. Audit query and export

- `GET /admin/audit`. Query parameters, all optional:
  - `actor` (token id), `action` (one of `AUDIT_ACTIONS`), `targetKind`, `targetId` (non-empty, compared exactly; no own maximum, like the check ids it names, so only the server's request-line limit bounds it, as it already bounds `/admin/checks/:id`).
  - `since` (epoch ms, inclusive, applies to `at`) and `until` (exclusive).
  - `limit` (integer 1-1000, default 100) and `before` (a positive integer entry id, the cursor).
  - An unknown parameter, a malformed value or `since >= until` answers `400`, with a message that names the parameter but not its value.
  - Order: `id` descending. The response is `200 AuditPage` `{ entries, nextBefore }`. The api reads `limit + 1` rows. `nextBefore` is the id of the last returned entry when more rows match, else `null`.
  - Consistency during paging: `audit_log` ids are assigned in the transaction that commits the entry (D4, D8 step 7). There is one api process and one connection per database file, and `bun:sqlite` runs each transaction synchronously. So every entry that becomes visible after a page was read has an id larger than every id already visible then. A cursor walk (`before` descending) therefore never skips and never repeats an entry that was visible when the walk started. Entries committed during the walk, including promoted pending config writes, are not in the walk; they appear on a fresh first page. The same holds for the export (ascending, up to the largest id at its start).
  - `at` is the time of the write request. A pending entry promoted later keeps its original `at`, so `at` is not monotonic in `id`. `since`/`until` filter on `at`. Order and cursor use `id` only.
- `GET /admin/audit/export` takes the same filters except `limit` and `before`. Any of those two → `400`.
  - Response: `200` with `content-type: application/x-ndjson; charset=utf-8` and `cache-control: no-store`.
  - Body: one `JSON.stringify(entry)` plus `\n` per committed matching entry, ordered by `id` ascending, up to the largest id at the start of the export.
  - It reads batches of 500 rows by `id > lastId` and writes each batch to the response, so memory stays bounded. An empty result is an empty body.
- Neither route is reachable through the status proxy: status `src/api-filter.ts` `ALLOWED_API_PATHS` has no `/admin` path. Status needs no change.

## Performance impact

Metrics of api `bench/budgets.json` that this change can move:

- `startup_cpu_ms` (gating, budget 325): up by under 5 ms. The first start runs migration step 4 (five small tables and one index) and imports about 4 tokens (one SHA-256 each). Every start loads the token index and resolves pending audit rows (none in the bench). Startup no longer reads the token files after the first start, which saves two small file reads.
- `load_cpu_s` (gating, 28.1): flat or slightly down. Each `POST /results` (30/s) now does one SHA-256 and one map lookup instead of today's `findByToken`, which hashes the presented token plus every entry (4 bench tokens, so 5 hashes). Last-used persistence adds at most one `UPDATE` per token per 60 s, so 4 per minute in the bench. Expected change within ±1 %.
- `idle_rss_mib` and `peak_rss_mib` (gating): under 1 MiB more. The index holds a few entries.
- `test_cpu_s` (gating, 4.1): up. The new HTTP suites (tokens, scopes, rotation, audit, import, recovery) may add about 0.3-0.8 s. The suites must stay lean: shared servers per file, no sleeps, injected clocks.
- `cold_read_cpu_ms` (gating): unchanged. The cold reads are public routes.
- Config writes gain one directory fsync and one durable commit (D8), and an abort gains one more durable commit. A durable commit is one WAL fsync in WAL mode. In the `delete` fallback it is the usual `FULL` syncs plus one directory fsync. A resolution pass with a promote candidate gains one directory fsync, which happens only after a failed write or a crash. No bench key measures config writes (`grep -rln "admin/checks\|admin/config" bench` in api finds no file), so no key moves. The new crash-model suite runs on in-memory fakes without real fsyncs, so its share of `test_cpu_s` is small.
- Reported metrics:
  - `p95_post_results_ms`: flat or slightly down.
  - `p95_get_checks_ms`, `p95_get_latency_ms`, `p95_get_check_latency_ms`, `rps`: unchanged (public routes).
  - `startup_wall_ms`: under +5 ms.
  - `image_mb`: unchanged (no new dependency).
- `build_cpu_s` and `test_cpu_s` of contract: slightly up from the new schemas and tests, well inside 6.4 s and 9.0 s.

How the implementer measures it:

- `bun run bench:selftest`.
- A local A/B: `bun bench/run.ts --a c00a375a1d78e17e9d01b8c25b5ae69b4fc3860e --b <implementation sha> --rounds 3 --out .bench/561`.
- The upgrade start: `bun bench/cold-read.ts --api <implementation worktree> --seed-with <main worktree>`. This starts B on a version-3 database with the bench tokens file, so the first start includes migration and import.

The PR reports the medians of the gating keys against their budgets. Budgets and CI stay unchanged.

## Security impact

Security impact: yes
The change rewrites admin and probe authentication, adds admin routes that hand out secrets, adds parsers at a trust boundary (contract validators, query parameters), and changes a file-write path and the CI e2e script.

Checklist items that apply:

- **Secrets in errors, logs and responses.**
  - A secret appears only in the one `201`/`200` body of create/rotate, which has `cache-control: no-store`.
  - Metadata, lists, audit query and export, error bodies, startup lines, auth-failure lines and write logs never carry a secret, a digest, or a file token.
  - Import error messages name an index, never a value.
  - Tests use distinct sentinels and grep the responses and every captured log line.
- **Auth order and status codes.** D2. `404` feature off before `401`. `401` for missing, unknown, expired, revoked or retired credentials. `403` for scope. Auth before body reads on `/results`. The grant rule and the last-admin rule. Revocation overrides the overlap.
- **Body and size limits.** 4096 bytes on the token routes. The existing `ADMIN_MAX_BODY_BYTES` and `MANUAL_INCIDENT_MAX_BODY_BYTES` stay. `limit` at most 1000. `targetId` has no own maximum (it must match unbounded check ids); the request line limit of the server bounds it, and it is only used as a bound SQL parameter. The export runs in bounded batches.
- **Input validation.** Contract strict schemas for `TokenCreateInput`. The api checks `expiresAt` against the clock. Query parameters are checked one by one. Unknown scopes, mixed `probe` scopes, and a missing or extra `location` are refused.
- **Accessor execution.** The contract validators read own data properties only, as the existing validators do with `ownValue` in `src/validate.ts`. A getter on an input object never runs.
- **Atomic, path-safe writes.** The config write keeps its temp-file + rename + `fsyncDir` sequence. It adds an `fsyncDir` of the temp name before the durable pending insert, and the pending/promote protocol of D8 with durable deletes before any temp removal and a directory sync before any promote. Durable statements run at `synchronous = EXTRA`, so they hold in WAL mode and in the rollback-journal fallback. No new file paths are written. The resolver only `lstat`s and removes a `temp_path` that the api itself stored; the value never comes from a request.
- **Dependency pins.** The api moves its contract pin to the merged contract SHA. No new package. `randomBytes`, `createHash` and `timingSafeEqual` come from `node:crypto`.
- **CI.** `scripts/compose-e2e.sh` changes assertions only. The job and its pins in `.github/workflows/ci.yml` stay.

Not applicable: SSRF and redirects (the probe HTTP client is unchanged), Dockerfiles (unchanged).

## Rollout order

1. **contract** merges first: additive exports, version `1.6.0` → `1.7.0`, `WIRE_VERSION` stays `1`.
   - Every consumer stays on its old contract SHA pin until it updates. The new pin changes only the `meaning` text of `ADMIN_STATUS_ORDER`, and only contract's own tests read it (`grep -rn ADMIN_STATUS_ORDER` over the clones finds `contract/src/admin.ts`, `contract/src/index.ts`, `contract/test/admin.test.ts`, `contract/test/smoke.test.ts`).
2. **api** updates its contract pin and ships the feature. It releases as a new api image tag.
   - Probes on any pin keep working. Their wire is unchanged: `Authorization: Bearer <token>` on `GET /probe/checks` and `POST /results` (probe `src/client.ts`). The imported probe credentials stay valid, and the location binding is unchanged.
   - Status and notify read only public routes and `GET /manual-incidents`, whose behavior is unchanged. The manual-incident reads become non-empty only after the admin bootstrap, the same moment as today's "admin file set".
   - The console reads an admin token but does not call admin routes yet (console `src/main.ts` uses only `hasAdminToken`). Imported admin tokens keep its configured value valid.
   - Downgrade: an older api refuses the version-4 database ("A file from a newer program is refused", api `AGENTS.md`). Rollback means restoring the pre-upgrade backup. The operation docs say to run `bun run backup` before upgrading.

## Counterexamples

- **Hash-only storage:** an implementation that stores the secret, a base64 or reversible form, or a "last 4 characters" hint fails. The raw bytes of `pulse.db`, `pulse.db-wal` and `pulse.db-shm` after a create must not contain the returned secret string. A digest column equal to `sha256(secret)` computed in the test is the only allowed form.
- **One-time disclosure:**
  - `GET /admin/tokens/:id` after a create returns no `secret` key. The contract strict `tokenMetadataSchema` rejects `{...metadata, secret: "x"}` and `{...metadata, secretSha256: "..."}`.
  - A second `GET` cannot return the secret again.
- **Scopes:**
  - A token with `["read","checks"]` (no `admin`) doing `POST /admin/checks` with a valid `If-Match` → `403`. The checks file bytes, `GET /admin/config` revision and `audit_log` are unchanged.
  - `["read"]` on `PUT /admin/checks/x` → `403`.
  - `["admin"]` on `POST /admin/checks` → `403` (needs `checks`).
  - `["admin","checks"]` on `POST /manual-incidents` → `403` (needs `incidents`).
  - A probe token on `GET /admin/audit` → `403`.
  - An admin-side token on `GET /probe/checks` → `403`.
  - `["incidents"]` on `GET /admin/config` → `403`.
  - `["admin","checks"]` on `GET /admin/config` → `200` (`checks` passes).
- **Grant rule:**
  - A caller `["admin","incidents"]` creating `{"scopes":["checks"]}` → `403`.
  - The same caller creating `{"scopes":["probe"],"location":"eu"}` → `403` (`probe` counts as `checks`).
  - A caller `["admin","checks"]` revoking a token with `["read","checks","incidents","admin"]` → `403`.
- **Create validation, clock-independent (rejected by contract `validateTokenCreateInput` and therefore `400` from the api):**
  - `scopes: []`, `scopes: ["owner"]`, `scopes: ["read","read"]`, `scopes: ["probe","read"]`.
  - `scopes: ["probe"]` without `location`, `scopes: ["read"]` with `location: "eu"`, `location` of 65 characters after trim.
  - `name: "   "`, `name` of 101 characters, `name: "a\u0000b"`.
  - `expiresAt: 1.5`, `expiresAt: 0`, `expiresAt: -1`, `expiresAt: "1"`.
  - The unknown key `{"name":"x","scopes":["read"],"secret":"chosen-by-client-0000"}`. A client never chooses its secret.
- **Create validation, clock-dependent (accepted by contract, rejected by the api with `400`):** with the api's injected clock at `T = 1 800 000 000 000`:
  - `expiresAt: 1 800 000 000 000` (equal to now) → `400`; `expiresAt: 1 799 999 999 999` → `400`.
  - `expiresAt: 1 800 000 000 001` → `201`.
  - `expiresAt: 1 800 000 000 000 + 315 360 000 000` (exactly 3650 days) → `201`; one more millisecond → `400`.
  - The contract test asserts that `validateTokenCreateInput` accepts `expiresAt: 1` and `expiresAt: 9 007 199 254 740 991` (it has no clock), so the api is the only place that enforces the window.
- **Status order:**
  - Admin not bootstrapped + any token on `/admin/tokens` → `404`, not `401`.
  - A wrong token with an oversized body on `POST /admin/tokens` → `401`, not `413`.
  - A revoked token → `401` with the same body as an unknown one.
- **Rotation (`TOKEN_ROTATION_OVERLAP_MS` = 600 000, clock injected):**
  - Rotate at `T`. At `T + 599 999` the old and the new credential both authenticate. At `T + 600 000` the old one gets `401` and the new one works. An implementation using `<=` fails at exactly `T + 600 000`.
  - Restart at `T + 300 000` (same database): the old credential still works at `T + 599 999` and fails at `T + 600 000`. A restart must not reset the deadline.
  - A token with `expiresAt = T + 120 000` rotated at `T`: both credentials fail at `T + 120 000`. The new credential is not immortal.
  - A second rotate at `T + 1` → `409`. At `T + 600 000` → `200`.
  - Revoke at `T + 1`: both credentials get `401` at once.
  - Rotating a probe token: both credentials work on `/probe/checks` and `/results` during the overlap. A result with `location` of another location → `403 location does not match token` for both.
- **Import:**
  - The upgrade fixture has 2 admin entries, probe entries for `eu` (2 credentials) and `us` (1 credential), and an existing version-3 database. After the first start all 5 credentials work as before. A probe-file token on `/admin/config` → `403`.
  - A start with the files removed works, and so do the stored credentials and manual incidents. An implementation that still requires `PULSE_TOKENS_FILE` fails.
  - Revoke an imported admin, then restart with the unchanged admin file still mounted: the revoked credential → `401`. Re-import fails this.
  - Adding a new entry to `tokens.json` after the import has no effect (`401` for it) and logs the "ignored" line.
  - A malformed admin file (second entry without `name`) on the first start: the start fails and no `api_tokens` row, `token_bootstrap` row or `token.import` entry exists. The probe import of the same start is rolled back too.
  - An admin file whose entry equals a probe token → start fails with `admin tokens[0] is also a probe token: use a separate token`.
  - Probe-only start, then a restart with `PULSE_API_ADMIN_TOKENS_FILE` → admins bootstrapped. The routes go from `404` to working.
  - After both imports, a restart where `PULSE_TOKENS_FILE` and `PULSE_API_ADMIN_TOKENS_FILE` name paths that do not exist → the start succeeds, imported credentials work. An implementation that parses files before reading the bootstrap rows fails here.
  - After both imports, a restart where both files contain `{not json` → the start succeeds, imported credentials work, and the files' bytes are unchanged. The same with a directory in place of each file (an `open` would fail with `EISDIR`).
  - On a fresh database, `PULSE_TOKENS_FILE` naming a missing path → the start fails with today's message, and no `token_bootstrap` row exists afterwards.
- **Last admin:** revoking the only active admin token → `409`, and it stays valid. With two admins, revoking one works, then revoking the second → `409`.
- **Audit secrecy:**
  - A `POST /admin/checks` whose body holds the header value `audit-sentinel-header-0001`, the body `audit-sentinel-body-0002` and the URL `https://audit-sentinel-url-0003.invalid/` (and a heartbeat check with secret `audit-sentinel-hb-0004`).
  - The query, the export and the `audit_log` table cells contain none of the four sentinels, no Bearer value and no digest. A logged entry with an extra field fails `validateAuditEntry` (strict).
- **Audit target ids:**
  - A check with an id of 300 `x` characters (valid today, no maximum) created and then deleted over `/admin/checks` → two entries with `target.id` equal to that 300-character string, both `validateAuditEntry`-valid. `GET /admin/audit?targetId=<the 300 characters>` → `200` with exactly those 2 entries. A schema or query bound of 200 (or any bound) fails this.
  - The contract accepts an entry whose `target.id` has 10 000 characters, and rejects `target.id: ""`.
- **Audit paging (statistics-free, exact):**
  - With 250 committed entries (ids 1-250): `limit=100` → ids 250..151 and `nextBefore=151`. `before=151` → 150..51 and `nextBefore=51`. `before=51` → 50..1 and `nextBefore=null`.
  - Interleaving with a pending config write (the case the previous design got wrong): manual-incident writes commit entries with ids 1, 2, 3. A config write reaches D8 step 4 and its promote is forced to fail (`audit_pending` holds it). Manual-incident writes commit ids 4 and 5. `GET /admin/audit?limit=2` → ids `[5,4]`, `nextBefore=4`. Now the next config write resolves the pending row: it is promoted with id 6 and its own entry gets id 7. `GET /admin/audit?limit=2&before=4` → `[3,2]`, `nextBefore=2`; `before=2` → `[1]`, `nextBefore=null`. A fresh `GET /admin/audit?limit=2` → `[7,6]`. Over the walk plus the fresh page, every one of the 7 entries is seen exactly once. An implementation that keeps the pending row's original id (4 in the old design) fails because a committed id would appear below a cursor already passed.
  - An export started when the largest id is 5 returns exactly ids 1-5, even when id 6 is promoted while it streams (batch size forced to 2 in the test).
  - `limit=0`, `limit=1001`, `limit=1.5`, `before=0`, `since=10&until=10`, `action=check.drop`, `foo=1` → `400`.
  - The export of the same set has 250 lines, ids ascending, each `validateAuditEntry`-valid. `limit` on the export → `400`.
- **Durability:**
  - An audit recorder that throws on a manual-incident create → `500`, and `GET /manual-incidents` is unchanged. An implementation that sends `201` before commit fails.
  - An `audit_pending` insert failure on a config write → `500 {"error":"audit log could not be written"}`. The checks file bytes are unchanged and no temp file is left in the directory.
  - Count rule for every recovery case below: a later config write that answers `200` records its own entry too. So the assertions name each entry by its `revision` and state the exact total of `audit_log` after each response. "The original write" is the write to B whose entry is pending.
  - A forced failure of the promote step after the rename (write A → B) → `500` with the pending message. The file is stored. Then either:
    - a restart: `audit_log` has exactly `1` entry, with the revision of B, and `audit_pending` is empty; or
    - a next config write B → C with a fresh `If-Match` → `200`. After its response, `audit_log` has exactly `2` entries in id order: id 1 with the revision of B (promoted in its step 1), and id 2 with the revision of C (its own). `audit_pending` is empty.
  - The reviewer's ambiguity case: the api writes A → B, the promote fails, then a test writes the original bytes A back to the checks file directly. On restart the entry is promoted, not deleted: `GET /admin/audit` shows exactly `1` entry, with `revision` = revision of B. An implementation that compares file revisions and drops rows whose "before" revision matches fails.
  - A crash before the rename: the test builds that state as a fixture (a version-4 database with one `audit_pending` row whose `temp_path` names a temp file that the test created next to the checks file, the checks file still at A). Start → the row is deleted, the temp file is removed, `audit_log` has no entry, and the checks file is still A.
  - A crash after the rename: the same fixture without the temp file and with the checks file at B → start promotes the row; `audit_log` has one entry with `revision` = revision of B.
  - The failure-path order: a fake `WriteFs` whose `rename` throws `EIO` → the call log from `writeTemp` on is exactly `writeTemp(temp)`, `fsyncDir(dir)`, `pending.insert(durable)`, `readFile(path)` (second revision check), `rename`, `lstat(temp)`, `pending.deleteByTemp(durable)`, `remove(temp)`. The row count at the time of `remove` is `0`.
  - A `rename` that moves the file and then throws `EIO` (the fake renames, then throws) → the response maps `EIO` as today, `lstat(temp)` gives `ENOENT`, and `deleteByTemp` and `remove` are never called. The row is still pending, and `audit_log` has `0` entries. The next config write B → C (fresh `If-Match`) → `200`. Its step 1 promotes the row. After its response, `audit_log` has exactly `2` entries: id 1 with the revision of B, and id 2 with the revision of C. The checks file is C. An implementation that aborts on every `rename` error deletes the row of a write that landed, and this case fails it.
  - The resolver's order with a promote candidate: a pending row whose temp file is missing, then a config write → the call log of step 1 is exactly `pending.list`, `lstat(temp)` (`ENOENT`), `fsyncDir(dir)`, `pending.promote`. Two candidates give `lstat`, `lstat`, then one `fsyncDir`, then `promote`, `promote`. A row whose temp file exists gives `lstat`, `pending.deleteByTemp(durable)`, `remove(temp)` and no `fsyncDir`.
  - The resolver's sync fails. Fixture: checks file B, a pending row for B whose temp file is missing, `audit_log` empty. The fake `fsyncDir` throws `EIO` on its next call only, which is the resolver's call. A config write B → C (fresh `If-Match`) → `200`:
    - `pending.promote` is never called for B's row, and one warn line `audit pending entry unresolved (EIO)` is logged.
    - After the response: `audit_log` has exactly `1` entry, with the revision of C (the write's own; its step-3 and step-6 syncs succeed). No entry has the revision of B. `audit_pending` has exactly `1` row, B's.
    - A later config write C → D whose resolver sync succeeds → `200`. After its response, `audit_log` has exactly `3` entries in id order: id 1 revision C, id 2 revision B (promoted now), id 3 revision D. `audit_pending` is empty.
  - The reviewer's interleaving: write 1 (A → B) has its step-6 `fsyncDir` fail with `EIO` → `500`, and the row is pending. Write 2 then sends a stale `If-Match` → `412`. The call log of write 2 is `pending.list`, `lstat(temp)`, `fsyncDir(dir)`, `pending.promote`, `readFile(path)`. The promote never comes before the `fsyncDir`. Its power-loss outcomes are rows of the table in "Power loss".
  - The success order: the call log from `writeTemp` on is exactly `writeTemp(temp)`, `fsyncDir(dir)`, `pending.insert(durable)`, `readFile(path)`, `rename(temp, path)`, `fsyncDir(dir)`, `pending.promote`. An implementation that inserts before the first `fsyncDir` fails.
  - The abort delete throws: the fake `PendingAudit` throws `SQLITE_IOERR` on `deleteByTemp` after a forced `rename` failure → the response maps the `rename` error as today, `remove(temp)` is never called, the temp file and the row are both still there, and one warn line `audit pending entry kept (SQLITE_IOERR)` is logged. The next config write A → C (fresh `If-Match`) → `200`. Its step 1 drops both (no temp file of the failed write is left). After its response, `audit_pending` is empty, and `audit_log` has exactly `1` entry, with the revision of C. No entry has the revision of B.
  - The pending insert throws after committing (a fake that commits the row and then throws `SQLITE_IOERR`) → `500 {"error":"audit log could not be written"}`, the abort deletes the row by `temp_path`, then the temp file is removed. `audit_pending` and `audit_log` are empty and the checks file is still A. An implementation that removes the temp file without the keyed delete leaves a row without temp file, which a restart promotes: this case fails it.
  - A pending row whose temp path `lstat` fails with `EACCES` → stays pending, the warn line carries `EACCES` and no path, and the config write proceeds (`200`).
  - `withDurableCommit`, `PRAGMA synchronous` read from inside `fn` and after it (also after `fn` throws):
    - a file database opened with `openDb` (WAL, `PRAGMA journal_mode` reads `wal`): `3` inside, `1` after;
    - a rollback-journal file database, the `delete` fallback (`new Database(file)` with `PRAGMA journal_mode = DELETE`, as api `src/db.test.ts` line 88 builds one; `PRAGMA journal_mode` reads `delete`): `3` inside, `2` after;
    - `:memory:` opened with `openDb`: `3` inside, `2` after.
    - Called inside `db.transaction(...)` it throws, and `synchronous` is unchanged.
    - An implementation that raises only to `FULL` reads `2` inside and fails the WAL and the `delete` case. One that hardcodes `NORMAL` afterwards fails the `delete` and the `:memory:` case.
- **Power loss (crash-model fault injection, `src/config-write.crash.test.ts`):**
  - Model, file system. `CrashFs` implements `WriteFs` for one directory with a live view, a durable view of the directory entries, and a list of un-synced directory changes (create, rename, unlink) in call order. `writeTemp` adds the name to the live view with its data (the data counts as synced, since `writeTemp` fsyncs it) and records a create. `rename` and `remove` change the live view and record their change. `fsyncDir` copies the live view to the durable view and clears the list. It can be told to throw `EIO` on its next call without syncing. `powerLoss(subset)` applies the chosen subset of the un-synced changes, in their call order, to the durable view (a change whose source name is missing in that view is skipped), and makes the result the live view. Two named subsets are `"drop"` (none) and `"keep"` (all). Any subset is allowed because a file system can write out un-synced directory changes in any combination. That covers ext4, xfs and btrfs orderings, and more.
  - Model, SQLite. `CrashPendingAudit` implements the `PendingAudit` port. It is built with a journal mode, `"wal"` or `"delete"`, and the `synchronous` level that its `insert` and `deleteByTemp` run at, `durableLevel` (the test passes the literal `3`, the `EXTRA` of D8; `promote` always runs at the connection level, `1` in `"wal"` and `2` in `"delete"`). It keeps a log of committed operations with their level. An operation is durable when its level is at least `2` in `"wal"` mode, and at least `3` in `"delete"` mode (SQLite's matrix: `FULL` is ACID in WAL mode and "maybe not durable" in rollback mode, `EXTRA` is ACID in both). A durable operation makes every earlier operation durable too (D8 "Durable statement", last point). `powerLoss(k)` keeps the first `k` operations of the non-durable tail after the last durable one, and drops the rest. Every `k` from `0` to the tail length is allowed: an un-synced WAL tail can be lost, or can reach disk in part or in full through a later sync or a checkpoint, but always as a prefix. In `"delete"` mode only the last commit before a power loss can really roll back, so the prefix model allows more outcomes than SQLite can produce, never fewer.
  - Run. Start state: checks file A (durable), no rows. A scenario runs (a config write to B, or one of the multi-step scenarios named in the table), with an injected fault hook that throws a `PowerLoss` sentinel right after the named point. A "process crash" row stops the writer without a power loss: the live views stay. Then `CrashFs.powerLoss(subset)` and `CrashPendingAudit.powerLoss(k)`, and a new writer over the same fakes, with a working `fsyncDir`, runs the startup resolution (the restart). The suite runs every row in **both** journal modes, `"wal"` and `"delete"`, for **every** subset of the file system's un-synced changes and **every** `k` (at most 3 changes and 2 tail operations per row, so at most 2 × 8 × 3 = 48 combinations per row).
  - Expected after the restart, in every combination and in both journal modes: `audit_pending` has `0` rows, `audit_log` has at most `1` entry, and the checks file is B exactly when `audit_log` has an entry with the revision of B. These invariants are written in the test as literals. The literal outcomes per row hold for every subset and every `k` unless the row names a subset:

    | Crash right after | File | `audit_log` entries |
    |---|---|---|
    | `writeTemp` | A | 0 |
    | first `fsyncDir` (temp name) | A | 0 |
    | pending insert | A | 0 |
    | `rename`, subset without the rename | A | 0 |
    | `rename`, subset with the rename | B | 1 |
    | second `fsyncDir` | B | 1 |
    | promote (`k = 0`: the promote is lost; `k = 1`: it is kept) | B | 1 |
    | no crash, response `200`, then power loss | B | 1 |
    | abort after forced `rename` `EIO` (no move): the durable delete | A | 0 |
    | abort after forced `rename` `EIO` (no move): `remove(temp)` | A | 0 |
    | `rename` moves, then throws `EIO`: the write's `lstat(temp)`, subset without the rename | A | 0 |
    | `rename` moves, then throws `EIO`: the write's `lstat(temp)`, subset with the rename | B | 1 |
    | resolver drop (fixture: row and durable temp, file A): the durable delete | A | 0 |
    | resolver drop: `remove(temp)` | A | 0 |
    | resolver promote (fixture: row, no temp, file B durable): the resolver's `fsyncDir` | B | 1 |
    | resolver promote (same fixture): the promote | B | 1 |
    | interleaving I1: write 1's step-6 `fsyncDir` fails (`EIO`, `500`); write 2 with a stale `If-Match`; crash right after write 2's resolver `lstat`, subset without the rename | A | 0 |
    | I1, the same crash, subset with the rename | B | 1 |
    | I1, write 2's resolver `fsyncDir` succeeds; crash right after write 2's `412` | B | 1 |
    | interleaving I2: as I1, but write 2's resolver `fsyncDir` also fails (`EIO`); crash right after write 2's `412`, subset without the rename | A | 0 |
    | I2, the same crash, subset with the rename | B | 1 |
    | process crash right after `rename` (live views stay, no power loss); the restart's resolver syncs and promotes; power loss right after that promote | B | 1 |

  - What each window catches:
    - Window of plan-review point 1: an implementation without the `fsyncDir` before the insert gets File A with 1 entry at "pending insert", subset `"drop"`. The temp name is lost, the row is durable, and the resolver promotes it.
    - Window of plan-review point 2: an implementation whose abort delete is not durable gets File A with 1 entry at "abort: `remove(temp)`", subset with the unlink, `k = 0`. The insert is still durable at level `3`, so the non-durable tail is only `[delete]`. The unlink is kept, the delete is lost, and the resolver promotes the row.
    - An implementation that removes the temp file before the delete gets 1 entry when it crashes between the two, subset with the unlink.
    - Window of the third plan-review: a resolver that promotes without its `fsyncDir` gets File A with 1 entry at "I1, write 2's resolver ... crash right after write 2's `412`", subset `"drop"`, `k = 1`. The promote reached disk and the rename did not. It fails the "process crash ... power loss" row the same way. The old model, which always used `k = 0`, could not see this: at `k = 0` the promote is lost and the restart decides again.
    - Window of the fourth plan-review (the rollback-journal fallback): a durable statement at `FULL` instead of `EXTRA` is not durable in `"delete"` mode. Then the pending insert and the abort delete both run at level `2`, so neither is durable and the non-durable tail of the abort row is `[insert, delete]`. The mutation gets File A with 1 entry at "abort: `remove(temp)`", mode `"delete"`, subset with the unlink, `k = 1`: the unlink is kept, the insert is kept, the delete rolls back with its hot journal, and the resolver promotes the row. This `k = 1` is also the outcome that real SQLite can produce, because only the last commit (the delete) rolls back. At `k = 0` both operations are lost, no row is left, and the result is the correct File A with 0 entries. At `k = 2` both are kept and the result is correct too. The same mutation also fails the "`rename`, subset with the rename" row in `"delete"` mode at `k = 0`: the insert is lost, the rename persists, and the result is File B with 0 entries. In `"wal"` mode level `2` is durable and the mutation passes, which is why the suite runs both modes.
  - Permanent negative control, a separate test in the same file: the abort-`remove(temp)` row runs with `CrashPendingAudit` built as `{ journal: "delete", durableLevel: 2 }`, from the start state (checks file A, no rows). So its operation log is `[insert, delete]`, both at level `2`, both non-durable, and `k` runs over `0`, `1` and `2`. Its un-synced file system changes are only the unlink, because the first `fsyncDir` already synced the temp name. The test asserts that the invariant check reports exactly one failing cell, "mode `"delete"`, subset with the unlink, `k = 1`", with File A and `1` entry. The other five cells must pass with File A and `0` entries: subset without the unlink at `k = 0`, `1`, `2` (the temp file is there, so the resolver drops any row), and subset with the unlink at `k = 0` and `k = 2` (no row is left). So the model itself proves that `FULL` is not enough in the fallback. With `durableLevel: 3` the same row passes in both modes. That `durableLevel` `3` is the level the real code uses is proved against real SQLite in `db.test.ts` and `audit-log.test.ts` (the `withDurableCommit` case above and the api checks).
  - The implementer applies each of the first four mutations once by hand to the code, runs the suite, and quotes the red output in the PR. The fifth (`withDurableCommit` raising only to `FULL`) is applied by hand to `src/db.ts`, and the PR quotes the red `db.test.ts` and `audit-log.test.ts` runs; the negative control covers its crash-model side permanently. The fixed table values above are the expected values. They come from this spec, not from the code under test.
- **Last used:**
  - Authentications at `T` and `T + 59 999` → one persisted `UPDATE` (value `T`). At `T + 60 000` → a second one. `GET` shows `T + 59 999` in between.
  - A failed authentication never changes `lastUsedAt`.

## Contract fields

Every new name, with its collision search (run in the meta checkout; `0` hits means the name is free):

```
for n in TokenScope TOKEN_SCOPES tokenScopeSchema TokenMetadata tokenMetadataSchema validateTokenMetadata \
  TokensResponse tokensResponseSchema validateTokensResponse TokenCreateInput tokenCreateInputSchema \
  validateTokenCreateInput TokenSecretResponse tokenSecretResponseSchema validateTokenSecretResponse \
  TOKEN_ROTATION_OVERLAP_MS TOKEN_NAME_MAX TOKEN_MAX_BODY_BYTES TOKEN_SECRET_PREFIX TOKEN_ID_PREFIX \
  AuditEntry auditEntrySchema validateAuditEntry AuditAction AUDIT_ACTIONS AuditTargetKind \
  AUDIT_TARGET_KINDS AuditPage auditPageSchema validateAuditPage AUDIT_DEFAULT_LIMIT AUDIT_MAX_LIMIT \
  AUDIT_EXPORT_CONTENT_TYPE '/admin/tokens' '/admin/audit' previousValidUntil lastUsedAt revokedAt \
  expiresAt rotatedAt nextBefore tokenId targetKind targetId \
  api_tokens token_secrets token_bootstrap audit_log audit_pending; do
  echo "$n: $(grep -rn -- "$n" .repos/contract/src .repos/config | wc -l) | api/src: $(grep -rn -- "$n" .repos/api/src | wc -l)"
done
```

Result (run on contract `ebcbbb6`, config `dc69a12`, api `c00a375`): every one of the 49 names has `0` hits in contract `src`, `0` in the config clone and `0` in api `src`. As a control, the same loop finds `ADMIN_STATUS_ORDER` (2 hits in contract `src`), so the search works. `grep -rli audit .repos/contract/src .repos/config` finds no file. `CREATE TABLE` in api `src/db.ts` and `src/migrations.ts` names only `checks`, `results`, `incidents`, `manual_incidents`, `manual_incident_updates`, `latency_daily`, `checks_new` and `uptime_daily`.

New in contract (`src/tokens.ts` and `src/audit.ts`, exported from `src/index.ts`):

| Name | Kind | Value / shape |
|---|---|---|
| `TOKEN_SCOPES` | const | `["read","checks","incidents","admin","probe"] as const` |
| `TokenScope`, `tokenScopeSchema` | type, schema | one of `TOKEN_SCOPES` |
| `TOKEN_ROTATION_OVERLAP_MS` | const | `600_000` |
| `TOKEN_NAME_MAX` | const | `100` |
| `TOKEN_MAX_BODY_BYTES` | const | `4096` |
| `TOKEN_SECRET_PREFIX` | const | `"pulse_"` |
| `TOKEN_ID_PREFIX` | const | `"tok_"` (ids match `^tok_[0-9a-f]{24}$`) |
| `TokenMetadata`, `tokenMetadataSchema`, `validateTokenMetadata` | strict object | D6 fields |
| `TokensResponse`, `tokensResponseSchema`, `validateTokensResponse` | strict object | `{ tokens: TokenMetadata[] }` |
| `TokenCreateInput`, `tokenCreateInputSchema`, `validateTokenCreateInput` | strict object | `{ name, scopes, location?, expiresAt? }` with the D1 rules |
| `TokenSecretResponse`, `tokenSecretResponseSchema`, `validateTokenSecretResponse` | strict object | `{ token: TokenMetadata, secret: string, previousValidUntil: number \| null }` |
| `AUDIT_ACTIONS`, `AuditAction` | const, type | the 17 actions of D7 (no separate action schema export) |
| `AUDIT_TARGET_KINDS`, `AuditTargetKind` | const, type | `check`, `component`, `maintenance`, `manual-incident`, `token` |
| `AuditEntry`, `auditEntrySchema`, `validateAuditEntry` | strict object | D7 |
| `AuditPage`, `auditPageSchema`, `validateAuditPage` | strict object | `{ entries: AuditEntry[], nextBefore: number \| null }` |
| `AUDIT_DEFAULT_LIMIT`, `AUDIT_MAX_LIMIT` | const | `100`, `1000` |
| `AUDIT_EXPORT_CONTENT_TYPE` | const | `"application/x-ndjson"` |

Fields: `id`, `name`, `scopes`, `location`, `source`, `createdAt`, `lastUsedAt`, `expiresAt`, `revokedAt`, `rotatedAt`, `previousValidUntil`, `secret`, `token`, `tokens`, `actor`, `tokenId`, `action`, `target`, `kind`, `revision`, `at`, `entries`, `nextBefore`. They live only inside the new strict objects. `lastUsedAt`, `expiresAt`, `revokedAt`, `rotatedAt`, `previousValidUntil`, `nextBefore` and `tokenId` have `0` hits above. Query parameters `actor`, `action`, `targetKind`, `targetId`, `since`, `until`, `limit`, `before` exist only on the new audit routes (`targetKind` and `targetId` have `0` hits above). The others already exist as fields of unrelated objects (for example `name` and `location`), which cannot collide inside a new object.

Routes (api): `/admin/tokens`, `/admin/tokens/:id`, `/admin/tokens/:id/rotate`, `/admin/tokens/:id/revoke`, `/admin/audit`, `/admin/audit/export`. They have `0` hits above. They sit under the existing `/admin/` prefix, whose current sections are `config|checks|components|maintenance` (api `src/admin-routes.ts` `ADMIN_PATH`).

No new env vars. The existing `PULSE_TOKENS_FILE` and `PULSE_API_ADMIN_TOKENS_FILE` change meaning to "import once" (D5).

## Repository: contract

Files:
- `src/tokens.ts` (new): token constants, schemas and types.
- `src/audit.ts` (new): audit constants, schemas and types.
- `src/validate-admin.ts`: the new validators (`validateTokenMetadata`, `validateTokensResponse`, `validateTokenCreateInput`, `validateTokenSecretResponse`, `validateAuditEntry`, `validateAuditPage`).
- `src/admin.ts`: `ADMIN_STATUS_ORDER` texts.
- `src/index.ts`: exports.
- `dist/*` (rebuilt: `dist/tokens.*`, `dist/audit.*`, `dist/admin.*`, `dist/validate-admin.*`, `dist/index.*`).
- `test/tokens.test.ts` (new), `test/audit.test.ts` (new), `test/admin.test.ts`, `test/smoke.test.ts`, `test/types.fixture.ts`.
- `package.json` (version `1.7.0`).
- `README.md`, `docs/index.md`.

Behavior change: yes
New validators and constants are new public behavior of the package.

Behavior:
- Add everything in the contract table of `## Contract fields`, with the exact values given there. Schemas are Zod (`zod` 4.6.7 is the only runtime dependency, `package.json`). Types are inferred. Validators follow the existing non-throwing `Validation` pattern of `src/validate.ts`: they return the same object on success, read own data properties only, and report the first problem with a field path.
- `tokenCreateInputSchema`:
  - `name`: string, 1-`TOKEN_NAME_MAX` characters after trim, no `\p{Cc}`.
  - `scopes`: array of 1-4 distinct `TokenScope`. `probe` only as the single entry.
  - `location`: required iff `scopes` is `["probe"]`, 1-64 characters after trim.
  - `expiresAt`: optional positive safe integer (1 to 9 007 199 254 740 991). The contract has no clock, so it does not check "in the future" or "at most 3650 days": the api does (D6).
  - Unknown keys are rejected.
- `tokenMetadataSchema`:
  - `name` is non-empty with no maximum (imported legacy names).
  - `location` is `string | null`, and not null iff `scopes` is `["probe"]`.
  - `source` is `"api" | "file"`.
  - The times are finite numbers or `null` as in D6.
  - `scopes` has no duplicates.
  - Strict.
- `auditEntrySchema`:
  - `id` is a positive integer and `at` is finite.
  - `actor.tokenId` matches the token id pattern or is `null`, and `actor.name` is non-empty.
  - `action` comes from `AUDIT_ACTIONS` and `target.kind` from `AUDIT_TARGET_KINDS`.
  - `target.id` is a non-empty string with no maximum, like check ids (`src/schema.ts` line 241 `id: nonEmpty`).
  - `revision` matches `isAdminRevision` or is `null`.
  - The action prefix must match `target.kind` (`check.*` ↔ `check`, `manual-incident.*` ↔ `manual-incident`, `token.*` ↔ `token`, ...).
  - All objects are strict.
- `ADMIN_STATUS_ORDER`: change the `meaning` of the 401 entry to `"missing, unknown, expired, revoked or retired token"` and of the 403 entry to `"a valid token without the needed scope"`. Order and statuses stay.
- `WIRE_VERSION` stays `1`, because the change is additive.

Checks:
- `test/tokens.test.ts` covers acceptance and rejection:
  - Rejected: every case of "Create validation, clock-independent" in `## Counterexamples`.
  - Accepted: `{"name":"ci","scopes":["read","checks"]}`, `{"name":"probe eu","scopes":["probe"],"location":"eu"}`, a name of exactly 100 characters, and `expiresAt: 1` and `expiresAt: 9007199254740991` (the clock-dependent rules are the api's, see "Create validation, clock-dependent").
  - The strict rejection of `secret` and `secretSha256` on metadata.
  - A getter on an input object that must not run.
- `test/audit.test.ts`:
  - Accepted: an entry with `target.id` of 10 000 characters, an entry with `actor.tokenId: null`.
  - Rejected: `target.id: ""`, an extra key, the action/kind mismatch `{action:"token.revoke", target:{kind:"check",...}}`, `revision: "abc"`.
  - `validateAuditPage` with `nextBefore: 0` rejected and `nextBefore: null` accepted.
- `test/types.fixture.ts` assigns a literal of each new type.
- `test/smoke.test.ts` lists the new exports.

Tool facts:
All citations are contract `main` `ebcbbb6` unless they name the config repository.
- Version `1.6.0` today (`package.json` line 3), which this change makes `1.7.0`.
- Bun `1.4.0`: `package.json` line 7 (`packageManager: "bun@1.4.0"`) and lines 8-10 (`engines.bun`).
- Scripts (`package.json`): `build` = `bun node_modules/typescript7/bin/tsc -p tsconfig.build.json` (line 22), `typecheck` = `bun node_modules/typescript7/bin/tsc --noEmit` (line 23), `test` = `bun test` (line 24), `lint` = `biome check . && pulse-eslint .` (line 25), `check` = `bun run lint && bun run build && bun run typecheck && bun run test` (line 28).
- Pins (`package.json`): `@biomejs/biome` `2.6.3` (line 31), `@lorenzh/pulse-config` `github:lorenzh/pulse-config#51e95b0eb463b27a196a33b428607bd92443e4f0` (line 32), `typescript7` `npm:typescript@^7.0.2` (line 36), runtime dependency `zod` `4.6.7` (line 39, the only one).
- Tests: `bun:test` with coverage on and at least 80 % lines (`bunfig.toml` lines 1-3: `[test]`, `coverage = true`, `coverageThreshold = { lines = 0.8 }`), ignoring `**/*.test.ts`, `test/**`, `**/test/**`, `dist/**` (line 4).
- Biome scope: `biome.json` line 2 extends `@lorenzh/pulse-config/biome.json`. That file at the pinned `51e95b0` (read with `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=51e95b0eb463b27a196a33b428607bd92443e4f0"`) includes `**` and excludes `**/dist`, `**/node_modules`, `**/bun.lock`, `**/*.html`, `**/test/fixtures` (lines 10-17), with `vcs.useIgnoreFile: true` (line 6). It is byte-identical to the config clone (`diff -q` empty).
- CI: `.github/workflows/ci.yml` lines 16-19: job `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` with `build: true`. That workflow at the pinned ref (read with `gh api`, byte-identical to the config clone) runs on `ubuntu-24.04` (line 16):
  - Bun `1.4.0` via `oven-sh/setup-bun` (lines 22-24)
  - `bun install --frozen-lockfile` (lines 25-26)
  - `bun run lint` (lines 27-28)
  - `bun run typecheck` (lines 29-30)
  - `bun run build` when `build` is true (lines 31-33)
  - `git diff --exit-code -- dist` when `build` is true (lines 34-36)
  - `bun run test` (lines 37-38)

Completion evidence:
- `bun run check` passes.
- `git diff --exit-code -- dist` after `bun run build` is clean. That compares two independent artifacts: the committed `dist` and a fresh build.
- The PR lists the new exports and the counterexamples covered.

## Repository: api

Files:
- `src/migrations.ts`: step 4, the D4 tables.
- `src/token-store.ts` (new): store, in-memory index, create/rotate/revoke/authenticate/list, last-used coalescing, flush.
- `src/token-scopes.ts` (new): the pure D1 matrix, grant rule and last-admin check.
- `src/token-import.ts` (new): the D5 bootstrap import.
- `src/token-routes.ts` (new): `/admin/tokens*`.
- `src/audit-log.ts` (new): record in a transaction, query, batch iteration for export, and the `PendingAudit` port with its SQLite implementation: `insert` and `deleteByTemp` as durable statements through `withDurableCommit`, `promote` in one normal transaction, `list` in ascending id.
- `src/db.ts`: `withDurableCommit(db, fn)` (D8 "Durable statement", level `EXTRA` in both journal modes). `setJournal` is unchanged.
- `src/audit-routes.ts` (new): `/admin/audit`, `/admin/audit/export`.
- `src/admin-routes.ts`: store-based auth, scopes, dispatch of the new sections, audit of config writes.
- `src/admin-auth-failures.ts`: kinds of D2.
- `src/admin-tokens.ts`: keeps the parser for import, plus digest-based distinctness.
- `src/tokens.ts`: keeps `parseTokens` and the token rules, plus digest helper; drops the list-based `authenticate`/`findByToken` once unused.
- `src/config-write.ts`: the D8 protocol (the `fsyncDir` after `writeTemp`, the `lstat` after a failed `rename`, the durable abort, the rule for removing a temp file, the rule for promoting) and pending resolution with one `fsyncDir` per pass before its first promote. `WriteFs` gains `lstat(path): void` (throws with a Node `code`). `WriterDeps` gains `pending: PendingAudit` and an optional test-only `fault?: (point: string) => void` hook, called after each named step of D8 (a no-op in production).
- `src/config-fs.ts`: the real `lstat` for `WriteFs`.
- `src/manual-incidents.ts`: writes run inside a transaction with the audit insert.
- `src/server.ts`: probe-route and manual-write auth through the store; respond after commit; route patterns for metrics.
- `src/start.ts`: the D5 order (open the database, read bootstrap rows, then read only the files of pending imports); import; resolve pending audit entries once the database is open, before `listen`; feature gate; startup line; flush last-used on close.
- Tests:
  - new: `src/token-store.test.ts`, `src/token-scopes.test.ts`, `src/start.token-import.test.ts`, `src/server.tokens.test.ts`, `src/server.scopes.test.ts`, `src/server.rotation.test.ts`, `src/server.audit.test.ts`, `src/config-write.audit.test.ts`, `src/config-write.crash.test.ts`, `src/audit-log.test.ts`
  - updated: `src/db.test.ts` (`withDurableCommit` on WAL, `delete` and `:memory:`), `src/db.migrations.test.ts`, `src/server.auth.test.ts`, `src/server.manual-incidents.test.ts`, `src/server.manual-incidents.audit.test.ts`, `src/config-admin.test.ts`, `src/admin-tokens.test.ts`, `src/tokens.test.ts`, `src/start.test.ts`, `src/start.audit-log.test.ts`, `src/admin-auth-failures.test.ts`, `src/docs-claims.test.ts` if its claims change, and any other test that builds `createApiServer` with `adminTokens`.
  - fixture: `test/fixtures/pulse-v3.db` (new, binary, a version-3 database made with api `main` `c00a375`).
- `scripts/compose-e2e.sh`.
- `compose.yaml` (comment only), `compose.e2e.yaml` (comment only, if needed).
- `README.md`, `docs/rest-api.md`, `docs/configuration.md`, `docs/operation.md`.
- `package.json`, `bun.lock` (contract pin to the merged contract SHA).

Behavior change: yes
Authentication, storage, admin routes and audit are new behavior.

Behavior:
- Implement D1-D9 exactly. Contract types come in with `import type`, and contract validators and constants are runtime imports, as the api already does with `validatePostResultRequest`.
- The SQL lives in the store modules (`token-store.ts`, `audit-log.ts`), next to `manual-incidents.ts`, which already holds its own SQL. Rows map to contract types there.
- Side effects come in as dependencies: `now`, a `randomBytes`-backed `generateSecret`/`generateId` (tests pass fixed fakes), and an audit recorder (tests pass one that throws).
- `createApiServer` options change:
  - `tokens`/`adminTokens` lists give way to the token store.
  - `isAdminEnabled` comes from `token_bootstrap`.
  - Tests that pass lists today build a store on a temp database instead.
- The startup line keeps its keys, with values from the database:
  - `probeTokens`: active probe tokens.
  - `locations`: distinct locations of active probe tokens.
  - `adminTokens`: active admin-side tokens.
  - `manualIncidents`: `writable`/`off`.
  - `configWrites`: `on`/`off` after the gate.
  It adds `tokenStore: "database"`. `tokensFile` stays as the configured path.
- Docs:
  - `docs/rest-api.md` documents the routes, shapes, statuses, scopes table, overlap, paging and export.
  - `docs/configuration.md` states that both token files are imported once and then ignored.
  - `docs/operation.md` covers rotating a probe token (create the overlap, restart the probe with the new `PULSE_PROBE_TOKEN` within 10 minutes), backup before upgrade, lockout recovery by restore, audit growth, the advice to rotate imported tokens, the D8 guarantee with its storage assumptions (its WAL-fallback paragraph, today line 23, adds that the audit's durable statements run at `synchronous = EXTRA` in both modes), and that an orphan `<checks>.<suffix>.tmp` file can be deleted while the api is stopped.
  - `README.md` summarizes all of it.
- `scripts/compose-e2e.sh`:
  - Line 469 expects `403` for the probe token on a manual-incident write, and the echo text says so.
  - Add a step "Tokens and audit" after "Checks via the admin API and hot reload". With the e2e admin token it:
    - creates a `["read","checks"]` token and asserts `POST /admin/checks` with it → `403`;
    - creates a probe token for location `e2e-rotated` and asserts `GET /probe/checks` with it → `200`;
    - rotates it and asserts both credentials → `200`;
    - revokes it and asserts both → `401`;
    - asserts that `GET /admin/audit?action=check.create` holds an entry with `target.id == "e2e-api"` and `actor.name == "e2e"`;
    - asserts that `GET /admin/audit/export` parses line by line with `jq`;
    - asserts that neither the audit output nor `docker compose logs` contains any secret returned by the create/rotate calls or the e2e admin token.
  - The existing "Persistence across down and up" step also asserts that the e2e admin token still answers `200` on `/admin/config` and that the audit entry is still there after `up`. That covers bootstrap from mounted files and a restart with the persisted database.
  - The existing probe and status and notify assertions keep running unchanged. They prove that the imported probe token keeps working.

Checks:
- The four issue tests below, each in its own test with the name given here. Each one must fail on `main` `c00a375`. The PR shows the red run: write the tests first and run them before the implementation, with the failure output quoted. On `main`, all four fail because `POST /admin/tokens` or `GET /admin/audit` answers `404`.
  1. `server.tokens.test.ts` "a stored token is not readable in clear":
     - Create a token over HTTP. The response secret authenticates `GET /admin/tokens`.
     - The bytes of the db, `-wal` and `-shm` files contain no occurrence of the secret string.
     - `token_secrets.secret_sha256` equals `createHash("sha256").update(secret).digest("hex")` computed in the test from the HTTP response, not from the store.
     - A restart on the same file still authenticates it.
     - `GET /admin/tokens/:id` has no `secret`.
  2. `server.scopes.test.ts` "a token without admin cannot write checks":
     - A `["read","checks"]` token on `POST /admin/checks` with a valid `If-Match` → `403`.
     - The checks file bytes are equal before and after, and the audit query count is unchanged.
     - The full matrix of D1 runs as a table test, with the literal statuses from `## Counterexamples`.
  3. `server.rotation.test.ts` "both tokens work during rotation and only the new one after the overlap":
     - The literal times `T + 599 999` and `T + 600 000` from `## Counterexamples`.
     - The restart in the middle, the expiry cap, revoke during the overlap, the repeated rotate (`409`).
     - The probe variant on both probe routes, with the spoofed location.
  4. `server.audit.test.ts` "an admin write appears in the audit query without secret values":
     - The four sentinels from `## Counterexamples`.
     - The entry has `actor.name` equal to the creating token's name, `action: "check.create"` and `target.id` equal to the posted id.
     - `validateAuditEntry` passes.
     - The sentinels, the Bearer value and its digest are absent from the query, the export, the `audit_log` cells and every captured log line.
     - Paging with the literal ids of `## Counterexamples`. Export across more than one page, read after a restart. `403` for non-admin readers.
- `server.audit.test.ts` also holds, as separate tests:
  - "an audit walk never skips an entry committed later": the interleaving case of `## Counterexamples` with its literal ids `[5,4]`, `[3,2]`, `[1]`, `[7,6]`, and the export that returns exactly ids 1-5.
  - "audit entries keep check ids of any length": the 300-character id case of `## Counterexamples` (create, delete, `targetId` query → 2 entries).
- Upgrade test, `start.token-import.test.ts` "upgrade from file tokens keeps existing tokens working":
  - The version-3 database comes from outside the code under test: a committed fixture `test/fixtures/pulse-v3.db` (Biome excludes `**/test/fixtures`; the image copies only `src`, `Dockerfile` line 14, and `.dockerignore` excludes `test` and `*.db`), created once with api `main` `c00a375`'s own `openDb` and two manual incidents. The PR states the exact command used. The test copies it to its `mkdtemp` directory.
  - The fixture from `## Counterexamples`. All 5 credentials work.
  - Restart without files. Revoke and restart with the files still mounted: no resurrection. The malformed-file rollback, the probe-only then admin bootstrap, and the duplicate-digest refusal.
- Bootstrap order tests in `start.token-import.test.ts`, one per case of the `## Counterexamples` import list: after import with missing paths, with `{not json` files, with directories in place of the files (each → start succeeds and stored credentials work), and the fresh install with a missing probe file (→ start fails, no `token_bootstrap` row).
- Durability tests in `config-write.audit.test.ts` and `server.manual-incidents.audit.test.ts`: every D8 case of `## Counterexamples` "Durability" (pending insert failure, insert that commits and then throws, promote failure, the A → B → A restore, the crash-before-rename and crash-after-rename fixtures, the success and failure call orders, the abort delete that throws, the `EACCES` `lstat`, the `rename` that moves and then throws, the resolver's call order, the resolver's failing sync, and the reviewer's interleaving), with a fake `WriteFs`, a fake `PendingAudit` and a throwing audit recorder.
- Power-loss tests in `config-write.crash.test.ts`: the `CrashFs` and `CrashPendingAudit` model of `## Counterexamples` "Power loss", one table test over every row of its table with the literal outcomes, each row run in both journal modes (`"wal"`, `"delete"`) for every subset of the un-synced file system changes and every kept SQLite tail length `k`, plus the permanent negative control (`{ journal: "delete", durableLevel: 2 }` reports exactly its one named cell, "mode `"delete"`, subset with the unlink, `k = 1`"). The PR quotes the red runs of the five named mutations (no `fsyncDir` before the insert, a non-durable abort delete, removal before the delete, a resolver promote without its `fsyncDir`, and `withDurableCommit` raising only to `FULL`).
- `db.test.ts`: the `withDurableCommit` cases of `## Counterexamples` (WAL file, `delete` file, `:memory:`, inside a transaction). `audit-log.test.ts`: the SQLite `PendingAudit` runs `insert` and `deleteByTemp` through the injected `durable` wrapper exactly once each (a recording spy), and `promote` not at all. With the real `withDurableCommit`, `PRAGMA synchronous` reads `3` from inside the spy-wrapped statement of `insert` and of `deleteByTemp`, on a WAL file database opened with `openDb` and on a `delete`-mode file database. The `delete`-mode database is built directly, because `openDb` cannot be made to refuse WAL in a test; `setJournal` stays unchanged, so the fallback keeps its log line `journal mode stays <mode>` (api `src/db.ts` line 159).
- `token-store.test.ts`: last-used coalescing with the literal times `T`, `T + 59 999`, `T + 60 000`, and the flush on close.
- `db.migrations.test.ts`: a version-3 file migrates to 4. A version-5 file is refused.

Tool facts:
All citations are api `main` `c00a375` unless they name the config repository.
- Bun `1.4.0`: `package.json` lines 8-10 (`engines.bun`) and line 35 (`packageManager: "bun@1.4.0"`).
- Scripts (`package.json`): `typecheck` = `bun node_modules/typescript7/bin/tsc --noEmit` (line 14), `test` = `bun test` (line 15), `lint` = `biome check . && pulse-eslint .` (line 16), `bench:selftest` = the seven `bun bench/selftest/check-*.ts` scripts (line 18), `check` = `bun run lint && bun run typecheck && bun run test` (line 20). There is no `build` script.
- Pins (`package.json`): `@biomejs/biome` `2.6.3` (line 23), `@lorenzh/pulse-config` `github:lorenzh/pulse-config#dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (line 24), `typescript7` `npm:typescript@7.0.2` (line 27), `@lorenzh/pulse-contract` `github:lorenzh/pulse-contract#ebcbbb613328494185833f7133f1242910986948` (line 31, the pin this change moves), `zod` `4.6.7` (line 33).
- Tests: coverage on with at least 80 % lines and no function threshold (`bunfig.toml` lines 1-3: `[test]`, `coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`), ignoring test files, `test/**` and `dist/**` (line 4).
- Biome scope: `biome.json` line 2 extends `@lorenzh/pulse-config/biome.json`. That file at the pinned `dc69a12` (read with `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=dc69a126bebbe50d8a7339ea1325d51b2ea43d7d"`) includes `**` and excludes `**/dist`, `**/node_modules`, `**/bun.lock`, `**/*.html`, `**/test/fixtures` (lines 10-17). It is byte-identical to the config clone (`diff -q` empty).
- CI `.github/workflows/ci.yml`:
  - `check` (lines 17-18) uses `lorenzh/pulse-config/.github/workflows/check.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` without inputs. That workflow at the pinned ref (read with `gh api`, byte-identical to the config clone) runs Bun `1.4.0` via `oven-sh/setup-bun` (lines 22-24), `bun install --frozen-lockfile` (25-26), `bun run lint` (27-28), `bun run typecheck` (29-30) and `bun run test` (37-38). Its build and dist steps (31-36) run only with `build: true`, so they are skipped here.
  - `bench-selftest` (lines 20-31): Bun `1.4.0` (lines 26-28), `bun install --frozen-lockfile` (29), `bun run bench:selftest` (30), `docker compose -f bench/compose.bench.yaml config --quiet` (31).
  - `docker` (lines 33-54), on `ubuntu-24.04` and `ubuntu-24.04-arm` (line 37): `docker build --tag pulse-api:local .` (43), `cp .env.example .env && docker compose config --quiet` (44), "Image holds no test files" (45-48), "Status port override" (49-51), "Console port override" (52-54). This change touches none of the files these steps read except `compose.yaml` comments.
  - `compose-e2e` (lines 66-76): `bash scripts/compose-e2e.sh` (73) with a 25-minute timeout (68), then `docker compose --project-name pulse-e2e --profile demo down -v --remove-orphans` (74-76).
  - `release` (lines 56-64) runs only on tags and is unchanged.

Completion evidence:
- `bun run check` passes, and the red-then-green output of the four issue tests and the upgrade test is in the PR.
- `bun run bench:selftest` passes. The A/B of `## Performance impact` reports the gating keys under their budgets in `bench/budgets.json`, with the budgets unchanged.
- The CI `compose-e2e` job is green with the new step.
- `bun start` was exercised once with the example files (copy `tokens.example.json` and `admin-tokens.example.json`, replacing the placeholders):
  - `POST /admin/tokens` → `201` with a secret;
  - `GET /admin/audit` → `200` with the `token.import` and `token.create` entries;
  - a restart without the files → the secret still works.
  The PR reports the commands and the statuses.

## Risks

- **Unsalted SHA-256 of legacy secrets:** a leaked database lets an attacker brute-force short imported secrets offline (the minimum is 16 characters). Generated secrets have 256 bits. The docs advise rotating imported tokens after the upgrade. A slow KDF would cost one scrypt per probe request and rules out the digest lookup.
- **Lockout through expiry:** the last-admin rule covers revocation only. An expiring last admin locks the api, and recovery is a backup restore. The docs state this. No automatic re-bootstrap happens, because that would revive file credentials.
- **File-plus-SQLite gap:** D8 can leave an `audit_pending` row after a crash, a power loss, a failed promote, a failed abort delete, a failed directory sync (step 6 or the resolver's) or a `rename` that moved and then threw. That entry is invisible until the next config write or restart resolves it. Resolution uses only the temp file's existence. The temp name is on disk before the row (step 3), and it is removed only after a durable delete of the row. A row is promoted only after a directory sync that put its rename on disk (the rule for promoting), so a promote that SQLite persists can never outlive an undone rename. A failed sync only delays the entry until a later pass syncs. Durable statements run at `EXTRA`, which is durable in WAL mode and in the rollback-journal fallback alike; at `FULL` the fallback could roll back an abort delete whose unlink persisted. So a power loss at any point gives the outcome of the D8 guarantee, and a later external edit of the checks file (even back to the old bytes) never removes the entry. Wrong outcomes are left only outside the stated assumptions, and they are documented and accepted:
  - storage that acknowledges `fsync` without persisting (a volatile disk cache, some network file systems) can lose the temp name or the row;
  - a third party that deletes the api's temp file while the api crashes before its rename gives an entry for a write that did not land.
- **Orphan temp files:** an abort or a resolver drop whose `remove` fails, or a power loss that undoes the unlink after a durable delete, leaves a `<checks>.<suffix>.tmp` file without a row. It never changes the audit, and nothing reads it. Today's writer leaves the same file after a crash between `writeTemp` and `rename`. `docs/operation.md` says such files can be deleted while the api is stopped.
- **Extra syncs per config write:** one directory fsync (the temp name) and one durable commit (the pending insert) on the success path, plus one durable commit on an abort, plus one directory fsync in a resolution pass that promotes. A durable commit is one WAL fsync in WAL mode; in the `delete` fallback it is the usual `FULL` syncs plus one directory fsync after the journal unlink. Config writes are rare operator actions. Ingest, reads, the promote and every other statement keep the connection level (`NORMAL` in WAL mode, `FULL` in the fallback).
- **Journal modes beyond the two:** the guarantee is stated for WAL and the `delete` fallback, the only modes `setJournal` can leave a file database in (api `src/db.ts` lines 154-163; only WAL is stored in the file). A future change that sets another journal mode must recheck D8.
- **Audit growth:** about 200 bytes per entry and no retention. 100 admin writes a day give about 7 MB a year. The docs name this.
- **Probe rotation needs an operator:** a probe restarted after the 10-minute overlap with the old token gets `401` until it is restarted with the new token. Its result buffer (probe) keeps results across the gap, as in the existing outage test.
- **Order of ids and `at`:** `audit_log` ids follow commit order (D9). A config entry promoted late keeps the `at` of its request, so `at` is not strictly monotonic in `id`, and a `since`/`until` window can gain an older-`at` entry after it was read. Ordering and the cursor use `id` only. This is documented in `docs/rest-api.md`.
- **Test CPU budget:** the new HTTP suites can push `test_cpu_s` toward 4.1 s. Keep them to one server per file and no sleeps.

## Acceptance evidence

- contract PR: `bun run check` green in CI. Committed `dist` equals a fresh build (`git diff --exit-code -- dist`).
- api PR:
  - CI `check`, `bench-selftest`, `docker` and `compose-e2e` are green.
  - The PR body quotes the failing run on `c00a375` and the passing run for the four issue tests and the upgrade test.
  - The power-loss table of `## Counterexamples` passes in both journal modes, its negative control passes, and the PR quotes the red runs under each of the five named mutations.
  - The A/B bench medians for `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s` and `cold_read_cpu_ms` are under the literal budgets of `bench/budgets.json` (325, 28.1, 88, 115, 4.1, 390).
  - The expected values of every check are the literals written in `## Counterexamples` and above, or digests computed in the test from the HTTP response. None is read back from the code under test.
