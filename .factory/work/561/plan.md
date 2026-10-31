# Spec #561: api: hashed, scoped admin and probe tokens with rotation

Source: [#561](https://github.com/lorenzh/pulse-meta/issues/561), decision 6 of [#460](https://github.com/lorenzh/pulse-meta/issues/460), and the issue review in `.factory/work/561/issue-review.md`. This spec settles every open point of that review. Inspected state: api `main` `c00a375a1d78e17e9d01b8c25b5ae69b4fc3860e`, contract `main` `ebcbbb613328494185833f7133f1242910986948`, probe `main` `50ec9cabe8aebe6164eff6cf2272b0a6c6c86605`, console `main` `11a3f5f`, config `main` `dc69a12`, deploy `2b2a355` (README and license only).

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
  - `audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_token_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, revision TEXT, before_revision TEXT, state TEXT NOT NULL CHECK (state IN ('pending','committed')))`, with an index on `(at, id)`.
- Names are labels and need not be unique. API-created names are 1-100 characters after trim, with no control character (`\p{Cc}`). Imported names keep the legacy rule (non-empty after trim, no maximum), so upgrades never fail on a long name.
- In-memory index: at start the api loads all non-revoked tokens and their non-retired credentials into a `Map<digest, entry>`. Every token mutation in this process updates the map after its transaction commits. A request computes one SHA-256 of the presented secret and does one map lookup, then confirms with `timingSafeEqual` against the stored digest. The map key is a digest, not the secret: a lookup timing reveals nothing usable about the secret. Expiry, revocation and `retires_at` are checked against `now()` on every request, so they act at once without a cache flush. The database is the only writer's state (one api process per database file, as today).
- Last used: on each successful authentication the in-memory `lastUsedAt` becomes `now()`. It is persisted with `UPDATE api_tokens SET last_used_at` only when nothing is persisted yet or the persisted value is at least 60 000 ms older. Shutdown flushes unpersisted values before `db.close`. API responses show the in-memory value. After a crash the persisted value can be at most 60 000 ms behind the last real use.

### D5. Bootstrap and one-time import

At startup the api parses the files first, as today. Then it opens and migrates the database. Then it runs the pending imports in one transaction, before `listen`:

- **Probe import** (when no `probe` bootstrap row exists):
  - `PULSE_TOKENS_FILE` (default `./tokens.json`) must exist and be valid under today's `parseTokens` rules. A missing or invalid file is the same `StartupError` as today.
  - Each entry becomes a probe token with `source: "file"`, `scopes: ["probe"]`, its location, `name: "probe <location> #<n>"` (n = 1-based position in the file), `createdAt = now()`, and no expiry.
  - The transaction inserts the row `probe` with the count.
- **Admin import** (when no `admin` bootstrap row exists and `PULSE_API_ADMIN_TOKENS_FILE` is set):
  - The file must be valid under today's `parseAdminTokens` rules.
  - Each entry becomes a token with `source: "file"`, its trimmed name, `["read","checks","incidents","admin"]`, and no expiry.
  - A digest that equals any stored or co-imported digest refuses the start. A probe digest gives the message `admin tokens[<i>] is also a probe token: use a separate token`. Any other duplicate gives `admin tokens[<i>] repeats a stored token`. Neither message carries a token.
  - The transaction inserts the row `admin`.
- Every imported token gets one `token.import` audit entry (actor `{tokenId: null, name: "bootstrap"}`).
- Any failure rolls back the whole import transaction. The start fails, and a later start retries from scratch.
- When a bootstrap row exists, the matching file is not opened. If the setting names an existing path, the start logs once at info: `"<setting> ignored: tokens are stored in the database"`, with the setting name only. File edits after import never add, change or revive credentials. A revoked, expired or rotated-out credential stays dead even when its old file is still mounted.
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
- `target.id`:
  - a check or component: its id.
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
- **Config writes** (file-backed), all inside the writer's existing lock (`createConfigWriter`, `src/config-write.ts`):
  1. Resolve stale pending entries (below).
  2. Read the file and check `If-Match`, then build the new bytes and `revisionOf(data)`.
  3. Insert a `pending` audit row with `revision = revisionOf(data)` and `before_revision = ifMatch`. If this insert fails → `500 {"error":"audit log could not be written"}`, and the file is untouched (metric result `error`).
  4. Run today's steps: temp file, the revision check again, rename, `fsyncDir`. If one of them fails before the rename, delete the pending row and map the error as today.
  5. Mark the row `committed`.
  6. `reloader.adopt` as today.

  If step 5 fails, or the process dies between the rename and step 5, the row stays `pending`. Then the response is `500 {"error":"checks file stored; its audit entry is pending and is resolved at the next write or restart"}`.
- **Resolving pending entries** happens at startup after the initial config load, and at the start of each config write. The current file revision decides:
  - It equals the row's `revision` → `committed`.
  - It equals the row's `before_revision` → the row is deleted, because the write never landed.
  - Anything else → `committed`. This is conservative: a change that may have landed must not vanish.
- Query and export return only `committed` rows. This protocol does not claim that the file and SQLite are atomic together. It guarantees that an acknowledged config write always has a committed audit row, and that a stored file change is never silently left without one.

### D9. Audit query and export

- `GET /admin/audit`. Query parameters, all optional:
  - `actor` (token id), `action` (one of `AUDIT_ACTIONS`), `targetKind`, `targetId` (1-200 characters).
  - `since` (epoch ms, inclusive, applies to `at`) and `until` (exclusive).
  - `limit` (integer 1-1000, default 100) and `before` (a positive integer entry id, the cursor).
  - An unknown parameter, a malformed value or `since >= until` answers `400`, with a message that names the parameter but not its value.
  - Order: `id` descending. The response is `200 AuditPage` `{ entries, nextBefore }`. The api reads `limit + 1` rows. `nextBefore` is the id of the last returned entry when more rows match, else `null`.
  - Newer writes during paging get larger ids, so pages already read never shift.
- `GET /admin/audit/export` takes the same filters except `limit` and `before`. Any of those two → `400`.
  - Response: `200` with `content-type: application/x-ndjson; charset=utf-8` and `cache-control: no-store`.
  - Body: one `JSON.stringify(entry)` plus `\n` per committed matching entry, ordered by `id` ascending, up to the largest id at the start of the export.
  - It reads batches of 500 rows by `id > lastId` and writes each batch to the response, so memory stays bounded. An empty result is an empty body.
- Neither route is reachable through the status proxy: status `src/api-filter.ts` `ALLOWED_API_PATHS` has no `/admin` path. Status needs no change.

## Performance impact

Metrics of api `bench/budgets.json` that this change can move:

- `startup_cpu_ms` (gating, budget 325): up by under 5 ms. The first start runs migration step 4 (four small tables and one index) and imports about 4 tokens (one SHA-256 each). Every start loads the token index and resolves pending audit rows (none in the bench).
- `load_cpu_s` (gating, 28.1): flat or slightly down. Each `POST /results` (30/s) now does one SHA-256 and one map lookup instead of today's `findByToken`, which hashes the presented token plus every entry (4 bench tokens, so 5 hashes). Last-used persistence adds at most one `UPDATE` per token per 60 s, so 4 per minute in the bench. Expected change within ±1 %.
- `idle_rss_mib` and `peak_rss_mib` (gating): under 1 MiB more. The index holds a few entries.
- `test_cpu_s` (gating, 4.1): up. The new HTTP suites (tokens, scopes, rotation, audit, import, recovery) may add about 0.3-0.8 s. The suites must stay lean: shared servers per file, no sleeps, injected clocks.
- `cold_read_cpu_ms` (gating): unchanged. The cold reads are public routes.
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

Security impact: yes. The change rewrites admin and probe authentication, adds admin routes that hand out secrets, adds parsers at a trust boundary (contract validators, query parameters), and changes a file-write path and the CI e2e script.

Checklist items that apply:

- **Secrets in errors, logs and responses.**
  - A secret appears only in the one `201`/`200` body of create/rotate, which has `cache-control: no-store`.
  - Metadata, lists, audit query and export, error bodies, startup lines, auth-failure lines and write logs never carry a secret, a digest, or a file token.
  - Import error messages name an index, never a value.
  - Tests use distinct sentinels and grep the responses and every captured log line.
- **Auth order and status codes.** D2. `404` feature off before `401`. `401` for missing, unknown, expired, revoked or retired credentials. `403` for scope. Auth before body reads on `/results`. The grant rule and the last-admin rule. Revocation overrides the overlap.
- **Body and size limits.** 4096 bytes on the token routes. The existing `ADMIN_MAX_BODY_BYTES` and `MANUAL_INCIDENT_MAX_BODY_BYTES` stay. `limit` at most 1000. `targetId` at most 200 characters. The export runs in bounded batches.
- **Input validation.** Contract strict schemas for `TokenCreateInput`. The api checks `expiresAt` against the clock. Query parameters are checked one by one. Unknown scopes, mixed `probe` scopes, and a missing or extra `location` are refused.
- **Accessor execution.** The contract validators read own data properties only, as the existing validators do with `ownValue` in `src/validate.ts`. A getter on an input object never runs.
- **Atomic, path-safe writes.** The config write keeps its temp-file + rename + `fsyncDir` sequence and adds the pending/commit protocol of D8. No new file paths are written.
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
- **Create validation (`400`):**
  - `scopes: []`, `scopes: ["owner"]`, `scopes: ["read","read"]`, `scopes: ["probe","read"]`.
  - `scopes: ["probe"]` without `location`, `scopes: ["read"]` with `location: "eu"`, `location` of 65 characters after trim.
  - `name: "   "`, `name` of 101 characters, `name: "a\u0000b"`.
  - `expiresAt: now()` (not greater than now), `expiresAt: 1.5`, `expiresAt: now() + 3651 × 86 400 000`.
  - The unknown key `{"name":"x","scopes":["read"],"secret":"chosen-by-client-0000"}`. A client never chooses its secret.
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
- **Last admin:** revoking the only active admin token → `409`, and it stays valid. With two admins, revoking one works, then revoking the second → `409`.
- **Audit secrecy:**
  - A `POST /admin/checks` whose body holds the header value `audit-sentinel-header-0001`, the body `audit-sentinel-body-0002` and the URL `https://audit-sentinel-url-0003.invalid/` (and a heartbeat check with secret `audit-sentinel-hb-0004`).
  - The query, the export and the `audit_log` table cells contain none of the four sentinels, no Bearer value and no digest. A logged entry with an extra field fails `validateAuditEntry` (strict).
- **Audit paging (statistics-free, exact):**
  - With 250 committed entries (ids 1-250): `limit=100` → ids 250..151 and `nextBefore=151`. `before=151` → 150..51 and `nextBefore=51`. `before=51` → 50..1 and `nextBefore=null`.
  - `limit=0`, `limit=1001`, `limit=1.5`, `before=0`, `since=10&until=10`, `action=check.drop`, `foo=1` → `400`.
  - The export of the same set has 250 lines, ids ascending, each `validateAuditEntry`-valid. `limit` on the export → `400`.
- **Durability:**
  - An audit recorder that throws on a manual-incident create → `500`, and `GET /manual-incidents` is unchanged. An implementation that sends `201` before commit fails.
  - An audit insert failure on a config write → `500`, and the checks file bytes are unchanged.
  - A forced failure of the "mark committed" step after the rename → `500`. The file is stored, and the next config write (or a restart) shows the entry as committed.
  - A pending row whose `before_revision` equals the current file → deleted on resolve, not shown.
- **Last used:**
  - Authentications at `T` and `T + 59 999` → one persisted `UPDATE` (value `T`). At `T + 60 000` → a second one. `GET` shows `T + 59 999` in between.
  - A failed authentication never changes `lastUsedAt`.

## Contract fields

Every new name, with its collision search (run in the meta checkout; `0` hits means the name is free):

```
for n in TokenScope TOKEN_SCOPES TokenMetadata TokensResponse TokenCreateInput TokenSecretResponse \
  TOKEN_ROTATION_OVERLAP_MS TOKEN_NAME_MAX TOKEN_MAX_BODY_BYTES TOKEN_SECRET_PREFIX TOKEN_ID_PREFIX \
  AuditEntry AuditAction AuditTargetKind AuditPage AUDIT_ACTIONS AUDIT_TARGET_KINDS AUDIT_MAX_LIMIT \
  AUDIT_DEFAULT_LIMIT AUDIT_EXPORT_CONTENT_TYPE validateToken validateAudit tokenScopeSchema \
  auditEntrySchema '/admin/tokens' '/admin/audit' previousValidUntil lastUsedAt revokedAt expiresAt \
  rotatedAt nextBefore; do
  echo "$n: $(grep -rn -- "$n" .repos/contract/src .repos/config | grep -v node_modules | wc -l)"; done
```

Result: every name above has `0` hits. `grep -rln audit .repos/contract/src .repos/config` finds no file. In api, `grep -rn 'api_tokens\|token_secrets\|audit_log\|token_bootstrap' .repos/api/src .repos/contract/src` finds nothing, and `CREATE TABLE` in `src/db.ts` and `src/migrations.ts` names only `checks`, `results`, `incidents`, `manual_incidents`, `manual_incident_updates`, `latency_daily`, `checks_new` and `uptime_daily`.

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
| `AUDIT_ACTIONS`, `AuditAction` | const, type | the 17 actions of D7 |
| `AUDIT_TARGET_KINDS`, `AuditTargetKind` | const, type | `check`, `component`, `maintenance`, `manual-incident`, `token` |
| `AuditEntry`, `auditEntrySchema`, `validateAuditEntry` | strict object | D7 |
| `AuditPage`, `auditPageSchema`, `validateAuditPage` | strict object | `{ entries: AuditEntry[], nextBefore: number \| null }` |
| `AUDIT_DEFAULT_LIMIT`, `AUDIT_MAX_LIMIT` | const | `100`, `1000` |
| `AUDIT_EXPORT_CONTENT_TYPE` | const | `"application/x-ndjson"` |

Fields: `id`, `name`, `scopes`, `location`, `source`, `createdAt`, `lastUsedAt`, `expiresAt`, `revokedAt`, `rotatedAt`, `previousValidUntil`, `secret`, `token`, `tokens`, `actor`, `tokenId`, `action`, `target`, `kind`, `revision`, `at`, `entries`, `nextBefore`. They live only inside the new strict objects. `lastUsedAt`, `expiresAt`, `revokedAt`, `rotatedAt`, `previousValidUntil` and `nextBefore` have `0` hits above. The others already exist as fields of unrelated objects (for example `name` and `location`), which cannot collide inside a new object.

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

Behavior change: yes. New validators and constants are new public behavior of the package.

Behavior:
- Add everything in the contract table of `## Contract fields`, with the exact values given there. Schemas are Zod (`zod` 4.6.7 is the only runtime dependency, `package.json`). Types are inferred. Validators follow the existing non-throwing `Validation` pattern of `src/validate.ts`: they return the same object on success, read own data properties only, and report the first problem with a field path.
- `tokenCreateInputSchema`:
  - `name`: string, 1-`TOKEN_NAME_MAX` characters after trim, no `\p{Cc}`.
  - `scopes`: array of 1-4 distinct `TokenScope`. `probe` only as the single entry.
  - `location`: required iff `scopes` is `["probe"]`, 1-64 characters after trim.
  - `expiresAt`: optional positive integer.
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
  - `target.id` is 1-200 characters.
  - `revision` matches `isAdminRevision` or is `null`.
  - The action prefix must match `target.kind` (`check.*` ↔ `check`, `manual-incident.*` ↔ `manual-incident`, `token.*` ↔ `token`, ...).
  - All objects are strict.
- `ADMIN_STATUS_ORDER`: change the `meaning` of the 401 entry to `"missing, unknown, expired, revoked or retired token"` and of the 403 entry to `"a valid token without the needed scope"`. Order and statuses stay.
- `WIRE_VERSION` stays `1`, because the change is additive.

Checks:
- `test/tokens.test.ts` and `test/audit.test.ts` cover acceptance and rejection, with every create-validation counterexample of `## Counterexamples` as a rejected case. They also cover the strict rejection of `secret`/`secretSha256` on metadata, the action/kind mismatch (`{action:"token.revoke", target:{kind:"check",...}}` rejected), and a getter on an input that must not run.
- `test/types.fixture.ts` assigns a literal of each new type.
- `test/smoke.test.ts` lists the new exports.

Tool facts:
- `bun run check` = `bun run lint && bun run build && bun run typecheck && bun run test` (`package.json` `scripts.check`).
- Tests are `bun:test` with coverage at least 80 % lines (`bunfig.toml` `[test]` lines 1-4).
- Biome `2.6.3` (`package.json` devDependencies). `biome.json` line 2 extends `@lorenzh/pulse-config/biome.json`. At the pinned `51e95b0eb463b27a196a33b428607bd92443e4f0` (`package.json` devDependency `@lorenzh/pulse-config`), that file includes `**` and excludes `**/dist`, `**/node_modules`, `**/bun.lock`, `**/*.html` and `**/test/fixtures` (`biome.json` lines 8-18). It is identical to the config clone.
- CI: `.github/workflows/ci.yml` line 17 uses `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` with `build: true`. At that ref (identical to the clone), the steps are:
  - install `bun install --frozen-lockfile` (line 26)
  - `bun run lint` (28)
  - `bun run typecheck` (30)
  - `bun run build` (33)
  - `git diff --exit-code -- dist` (36)
  - `bun run test` (38)
  - Bun `1.4.0` via `oven-sh/setup-bun` (lines 22-24)

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
- `src/audit-log.ts` (new): record in a transaction, pending/commit/resolve, query, batch iteration for export.
- `src/audit-routes.ts` (new): `/admin/audit`, `/admin/audit/export`.
- `src/admin-routes.ts`: store-based auth, scopes, dispatch of the new sections, audit of config writes.
- `src/admin-auth-failures.ts`: kinds of D2.
- `src/admin-tokens.ts`: keeps the parser for import, plus digest-based distinctness.
- `src/tokens.ts`: keeps `parseTokens` and the token rules, plus digest helper; drops the list-based `authenticate`/`findByToken` once unused.
- `src/config-write.ts`: the D8 protocol and pending resolution.
- `src/manual-incidents.ts`: writes run inside a transaction with the audit insert.
- `src/server.ts`: probe-route and manual-write auth through the store; respond after commit; route patterns for metrics.
- `src/start.ts`: open the database before import; import; feature gate; startup line; flush last-used on close.
- Tests:
  - new: `src/token-store.test.ts`, `src/token-scopes.test.ts`, `src/start.token-import.test.ts`, `src/server.tokens.test.ts`, `src/server.scopes.test.ts`, `src/server.rotation.test.ts`, `src/server.audit.test.ts`, `src/config-write.audit.test.ts`
  - updated: `src/db.migrations.test.ts`, `src/server.auth.test.ts`, `src/server.manual-incidents.test.ts`, `src/server.manual-incidents.audit.test.ts`, `src/config-admin.test.ts`, `src/admin-tokens.test.ts`, `src/tokens.test.ts`, `src/start.test.ts`, `src/start.audit-log.test.ts`, `src/admin-auth-failures.test.ts`, `src/docs-claims.test.ts` if its claims change, and any other test that builds `createApiServer` with `adminTokens`.
- `scripts/compose-e2e.sh`.
- `compose.yaml` (comment only), `compose.e2e.yaml` (comment only, if needed).
- `README.md`, `docs/rest-api.md`, `docs/configuration.md`, `docs/operation.md`.
- `package.json`, `bun.lock` (contract pin to the merged contract SHA).

Behavior change: yes. Authentication, storage, admin routes and audit are new behavior.

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
  - `docs/operation.md` covers rotating a probe token (create the overlap, restart the probe with the new `PULSE_PROBE_TOKEN` within 10 minutes), backup before upgrade, lockout recovery by restore, audit growth, and the advice to rotate imported tokens.
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
- Upgrade test, `start.token-import.test.ts` "upgrade from file tokens keeps existing tokens working":
  - Build a version-3 database with today's `openDb` path: use migrations up to step 3, or a fixture database made by a pinned older checkout. The test must not build it with the code under test.
  - The fixture from `## Counterexamples`. All 5 credentials work.
  - Restart without files. Revoke and restart with the files still mounted: no resurrection. The malformed-file rollback, the probe-only then admin bootstrap, and the duplicate-digest refusal.
- Durability tests in `config-write.audit.test.ts` and `server.manual-incidents.audit.test.ts`: the D8 cases of `## Counterexamples`, with a fake `WriteFs` and a throwing audit recorder.
- `token-store.test.ts`: last-used coalescing with the literal times `T`, `T + 59 999`, `T + 60 000`, and the flush on close.
- `db.migrations.test.ts`: a version-3 file migrates to 4. A version-5 file is refused.

Tool facts:
- Bun `1.4.0`: `package.json` `engines.bun` and `packageManager`, lines 8-10 and 35.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json` `scripts.check`).
- `lint` = `biome check . && pulse-eslint .` (`scripts.lint`).
- Typecheck with `typescript7` (`npm:typescript@7.0.2`, `scripts.typecheck`).
- Coverage at least 80 % lines (`bunfig.toml` `[test]` lines 1-4).
- Biome `2.6.3` (`devDependencies`). `biome.json` extends `@lorenzh/pulse-config/biome.json`. At the pinned `dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` that file includes `**` and excludes `**/dist`, `**/node_modules`, `**/bun.lock`, `**/*.html` and `**/test/fixtures` (lines 8-18). It is identical to the config clone.
- CI `.github/workflows/ci.yml`:
  - `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (line 18). At that ref (identical to the clone) it runs install, `bun run lint`, `bun run typecheck` and `bun run test` on Bun 1.4.0 (lines 22-38). `build` stays false, so the dist steps are skipped.
  - `bench-selftest` runs `bun run bench:selftest` and `docker compose -f bench/compose.bench.yaml config --quiet` (lines 20-31).
  - `compose-e2e` runs `bash scripts/compose-e2e.sh` (lines 66-73).
  - `docker` builds the image and runs `docker compose config` checks.

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
- **File-plus-SQLite gap:** D8 can leave a `pending` row after a crash between the rename and the commit. That row is invisible until the next write or restart resolves it. A third-party edit of the file in that window resolves to `committed` (conservative).
- **Audit growth:** about 200 bytes per entry and no retention. 100 admin writes a day give about 7 MB a year. The docs name this.
- **Probe rotation needs an operator:** a probe restarted after the 10-minute overlap with the old token gets `401` until it is restarted with the new token. Its result buffer (probe) keeps results across the gap, as in the existing outage test.
- **Order of ids and `at`:** a pending config row takes its id before a manual-incident commit that lands earlier, so `at` is not strictly monotonic in `id`. Ordering and the cursor use `id` only. This is documented.
- **Test CPU budget:** the new HTTP suites can push `test_cpu_s` toward 4.1 s. Keep them to one server per file and no sleeps.

## Acceptance evidence

- contract PR: `bun run check` green in CI. Committed `dist` equals a fresh build (`git diff --exit-code -- dist`).
- api PR:
  - CI `check`, `bench-selftest`, `docker` and `compose-e2e` are green.
  - The PR body quotes the failing run on `c00a375` and the passing run for the four issue tests and the upgrade test.
  - The A/B bench medians for `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s` and `cold_read_cpu_ms` are under the literal budgets of `bench/budgets.json` (325, 28.1, 88, 115, 4.1, 390).
  - The expected values of every check are the literals written in `## Counterexamples` and above, or digests computed in the test from the HTTP response. None is read back from the code under test.
