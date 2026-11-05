# Security audit: pulse-api (2026-11-05)

## Scope

- Issue: lorenzh/pulse-meta#758, a periodic security audit of `main` of pulse-api.
- Earlier runs: none. The issue has only the Factory claim comment. The previous report (issue #505, 2026-10-31, commit `11f5555`) was read for context only. Every item below was checked again on the commits listed here.
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-api | `fb6f1a554055cc22f2f5036c8e7e2a321a62aa4c` | `main`. Run, tested and attacked in a temporary copy. |
| pulse-contract | `9ab7e2492a2cec91789fba7c742bdba900a800a9` | The pin in `package.json` and `bun.lock`: validators, called from the installed copy. It is an ancestor of contract `main` `66818a24b81f5d0d86eee939dad64fa126617ba2` (2 commits behind). |
| pulse-kit | `c6d2cba7d90c981b884dcac2a9288dd9eccad8b5` | The pin: `readBody`, `readJsonBody`, `createFailureLimiter`, `clientKeyOf`. It is an ancestor of kit `main` `536133f3e8b708179fa01feeb02395a0e1961e07` (4 commits behind). |
| pulse-config | `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` | The pin in `package.json` and `ci.yml`: `pulse-workflows`. It is an ancestor of config `main` `bc870498cc8e2539a132ce2aac35a09db1deabd8` (2 commits behind). |
| pulse-meta | `1463761750cef5ffa446950e3e831073c9595a10` | `docs/approved-packages.md` |

- Method:
  - `bun install --frozen-lockfile` in a copy (`mktemp -d`). Then `bun --no-env-file src/main.ts` on port 38451 with throwaway probe and admin tokens and a checks file with a literal header value, a request body, an `{"env": ...}` header reference and a heartbeat secret. Each secret had a unique marker. Over the run, admin writes added database checks with literal headers, a body and a heartbeat secret, two API-created tokens, and public, internal and draft manual incidents with notes.
  - A second instance ran without `PULSE_API_ADMIN_TOKENS_FILE` (feature off). 19 more processes started with broken files or settings.
  - Requests came from `curl` and small Bun scripts over `node:net`. Each request used its own source address in `127.0.0.0/8`, so the admin auth throttle did not block the tests, except in the throttle test.
  - Every marker was searched for in every response, in stdout and in stderr.
- Test suite of the copy: `bun test` reported `741 pass, 0 fail` (exit 0).
- Cleanup: both instances were stopped with `SIGTERM` (log line `stopped`), and the copies and scripts were deleted.
- Results: 3 findings, all `P3`. 1 is an issue candidate and 2 are notes. No item is blocked.
- The 3 findings of the previous report are fixed on this commit (see Notes).

## Checklist

### 1. Secrets and server texts (tokens, header values, SMTP or upstream replies, file contents) in errors, logs and responses: `checked`

- **Public reads.** 16 routes were fetched and each body was searched with `grep -Eoc` for every marker and the env name: `/checks`, `/uptime`, `/latency`, `/components`, `/components/uptime`, `/incidents`, `/locations`, `/maintenance`, `/manual-incidents`, `/manual-incidents/1`, `/metrics`, `/readyz`, `/healthz`, `/checks/api-secret/results`, `/checks/db-secret/results` and `/checks/api-secret/latency`.
  - Result: `leaks=0 envname=0` on 15 routes.
  - `/metrics` gave `leaks=2`. Both hits were the metric name `pulse_api_location_last_result_timestamp_seconds`, which matched the pattern for API secrets (`pulse_` and 40 characters). No secret was among them, and `envname=0`.
- **Admin views** (`GET /admin/config`, `/admin/config/export`, `/admin/tokens`, `/admin/audit`, `/admin/audit/export`): no marker.
  - `GET /admin/config` shows each literal header value and each body as `{"keep":true}`, and env references as written. Heartbeat checks show `hasSecret: true`.
  - The export lists the withheld values in `redacted`: `[{"checkId":"api-secret","field":"headers.X-Api-Key"},{"checkId":"api-secret","field":"body"},{"checkId":"backup","field":"secret"},{"checkId":"db-secret","field":"headers.X-Db"},{"checkId":"db-secret","field":"body"},{"checkId":"db-hb","field":"secret"}]`.
  - A token create answers with the secret once (by design). Token lists and audit entries hold ids and names only.
- **Probe view.** `GET /probe/checks` with a probe token serves the literal header values and bodies (4 markers), as documented. An admin token gets `403` there.
- **Private incidents** (new since the last audit).
  - Draft, internal and note texts appear only on `/admin/manual-incidents` (3 draft, 2 internal and 1 note marker).
  - The public reads hold none of them. `GET /manual-incidents/2` (internal) and `/manual-incidents/3` (draft) give `404 manual incident not found`.
  - Legacy writes on those ids give `404`.
- **Write errors.** `422` answers name the field and the rule, never the value. Examples:
  - `check.headers.X-K: must be at most 4096 visible ASCII/obs-text characters or spaces`
  - `check.secret is required: 16 to 128 characters from A-Z a-z 0-9 . _ ~ -`
  - `check.url: must not contain a username or password`
  - `check.headers.A.env: must match ^PULSE_HEADER_[A-Za-z0-9_]{1,115}$`
- **Startup.** 19 broken files and settings were tried, each with a marker in the bad value. Every one printed one line `pulse-api: <message>`, exited with code 2, and gave `leaks=0`.
  - The cases: invalid JSON (with a bare token or secret) in the tokens, admin tokens and checks files; a token with whitespace; a short admin token; an admin token equal to a probe token; a bad header value; a bad secret; bad UTF-8; an array; a public example token; a directory; a missing file; a text file as `PULSE_DB`; bad `PORT`, `PULSE_LOG_LEVEL`, `PULSE_RETENTION_DAYS`, `PULSE_CHECKS_RELOAD_INTERVAL_MS` and `PULSE_LOCATION_SILENT_MS`.
  - Examples: `tokens file <path> is not valid JSON (PULSE_TOKENS_FILE=<path>)`, `cannot open database <path> (PULSE_DB): file is not a database`, `PORT: must be an integer from 0 to 65535`.
- **Hot reload.** 3 hostile checks files were applied with `SIGHUP`, all rejected. The lines name only the path and the rule, for example `config reload rejected: <path>: checks file is not valid JSON` and `... checks[0].headers.X.env: must match ^PULSE_HEADER_...`. The log held 0 hits for these markers.
- **Logs.** At the end, stdout and stderr held 134 lines. A search for every marker, both API-created token secrets and the internal placeholder secret returned `0`. There were 0 `error`-level lines.
  - Auth failures log only the route pattern, status, token kind and suppressed count (`"msg":"admin auth failed","route":"/admin/checks","status":"403","token":"scope","suppressed":"0"`).
  - Writes log names, the action and the id.
- **Tests.** The `security sentinels: every cell of the table of where values may appear` test passed in the full suite.
- **SMTP replies:** not applicable, because the API sends no mail.
- **Upstream replies:** not applicable, because the API makes no outbound request (item 6). The probe's `reason` text is stored as received (Notes).

### 2. Authentication before any other check; status codes and their order on admin routes: `checked`

The auth script sent 78 requests:

- **Auth comes first.** 9 admin paths were tried: `/admin/config`, `/admin/config/export`, `/admin/checks`, `/admin/components`, `/admin/maintenance`, `/admin/tokens`, `/admin/audit`, `/admin/audit/export` and `/admin/manual-incidents`. Each gives `401 {"error":"unauthorized"}` with no token, with `Basic` auth or with an unknown bearer, and `403 {"error":"forbidden"}` with a probe token.
- **Auth before `405`.**
  - `PATCH /admin/checks`, `POST /admin/config`, `DELETE /admin/tokens` and `POST /admin/audit` give `401` without a token and `405` with the admin token.
  - `POST /admin/tokens/<bad id>/rotate` gives `401` without a token and `404 token not found` with one.
  - On `/admin/manual-incidents`, the wrong method (`405`) and a bad id (`404`) come before auth. This is the documented order.
- **Auth before the body.**
  - A 2 MB body on `POST /admin/checks` gives `401` without a token, `403` with a probe token and `413` with the admin token.
  - It gives `401` on `POST /admin/tokens`, `POST /admin/manual-incidents` and `POST /manual-incidents` without a token.
  - `POST /results` gives `401` without a token, `413` with a probe token and `403` with an admin token.
- **Remaining order of an admin write** (admin token): `400` bad JSON, `428` without `If-Match`, `400` for `If-Match: *`, `400` id mismatch, `412` stale revision, `422` invalid body, `409` existing id, `404` unknown id.
- **Scopes and the grant rule.**
  - A `read` token gets `200` on `GET /admin/config` and on the export, and `403` on `GET /admin/tokens` and `POST /admin/checks`.
  - An `incidents`+`admin` token gets `403` when it creates a `probe` token or a `checks`+`admin` token.
- **Feature off** (no admin import): 24 requests went to `/admin/config`, `/admin/tokens`, `/admin/audit`, `GET`/`POST /admin/manual-incidents`, `POST /manual-incidents`, `DELETE /manual-incidents/1` and `POST /admin/checks`, each with no token, a probe token and an admin bearer. All got `404`, with 0 log lines. `GET /manual-incidents` gives `[]`.
- **Throttle.** From one source address with varying `X-Forwarded-For` and `Forwarded` headers:
  - The 10th failure gives `401` and the 11th gives `429 {"error":"too many requests"}` with `retry-after: 60`.
  - After that, a valid admin token gets `429` on `/admin/config` and on the legacy `POST /manual-incidents` from that address. `/checks` and `/probe/checks` still answer `200`.
  - Another source address with the admin token gets `200`. `pulse_api_admin_auth_throttled_total{route="/admin/config"} 2`. This is as documented.
- **Heartbeat.** A wrong secret, an unknown id, a probe token and no token all give the same `401 {"error":"unauthorized"}`.
- **Two `Authorization` headers:** the first one counts (bad then good gives `401`; good then bad gives `200`).
- **Path tricks.** A request target that the URL parser rejects gives `400 {"error":"invalid request target"}` on every path, before auth (50 of 50, 0 stderr lines). Encoded dot-segments toward an admin path give `401`.

### 3. Body and size limits on every method, also before any write: `checked`

- **Over-limit bodies are refused before the write, and the state stays the same afterwards:**
  - `DELETE /admin/checks/db-secret` with 2 MB gives `413`, and the check is still listed.
  - With 20 KB: `DELETE /admin/manual-incidents/3`, `POST .../3/publish`, `DELETE .../1/draft` and `POST .../1/notes` give `413`. Afterwards, incident 3 is still a draft, and incident 1 keeps its draft and 1 note.
  - With 2 MB: `POST /admin/tokens/<id>/revoke` and `.../rotate` give `413`. `revokedAt` and `rotatedAt` stay `null`.
  - `POST /heartbeat/backup` with the right secret and 20 KB gives `413`, and no ping is stored.
  - `POST /admin/maintenance` and `PUT /admin/components/svc` with 2 MB give `413`.
  - `POST /manual-incidents/<id>/resolve` with 2 MB gives `413`, and `resolvedAt` stays `null`.
- **Admin `GET` routes with a 2 MB body:**
  - `/admin/config`, `/admin/config/export`, `/admin/tokens`, `/admin/tokens/<id>` and both audit routes give `413`.
  - `/admin/manual-incidents` and `/admin/manual-incidents/<id>` answer without reading it (`security-api-2026-11-05-2`, note). The public reads ignore a body, as before.
- **300 MB chunked streams:**
  - `POST /admin/tokens`, `POST /admin/manual-incidents`, `PUT /admin/manual-incidents/3` and `POST /results` (with tokens) give `413` in at most 0.004 s.
  - `POST /admin/checks` without a token gives `401` in 0.001 s.
  - `GET /admin/manual-incidents` gives `200` in 0.18 s.
  - API RSS was 77,412 KB before and 79,176 KB after.
- **Keep-alive.** A body that the server does not read and that holds a whole second request was sent to `GET /checks`, `/healthz`, `/admin/manual-incidents` (admin), `/manual-incidents`, an unknown path and the legacy `DELETE /manual-incidents/<id>`. Each gave `responses=1`. The control case (two pipelined requests) gave `responses=2`.
- **Parser.** `Content-Length` with `Transfer-Encoding`, two `Content-Length` headers or a negative `Content-Length` gives `400`. A 64 KB header gives `431`.
- **Deep nesting.**
  - 800 KB of nested arrays gives `400` on `/results` and 4 KB gives `400` on `/admin/tokens`.
  - A 14 KB nested value in a draft incident gives `400`.
  - `jsonAssert[].equals` nested 10,000 or 100,000 levels gives `422`.
  - 0 error lines.
- **Slow requests.** Partial headers were closed by the server after 12.0 s, an idle connection after 12.0 s, and a partial body without a token after 6.0 s. A body that drips 1 byte per second with a valid probe token was still open after 70 s (Notes).
- **Finding `security-api-2026-11-05-1`:** the legacy `DELETE /manual-incidents/:id` deletes the incident without reading the body. It answers `204` to a 2,000,000-byte body.

### 4. Input validation at every trust boundary; validators never throw on any input type: `checked`

- **Fuzz script:** 523 cases. Inputs: `undefined`, `null`, `NaN`, `Infinity`, BigInt, Symbol, a function, `Date`, a string, arrays (also sparse), a null-prototype object, `__proto__` and `constructor` keys, 5,000-deep arrays, a throwing `Proxy`, a 5 MB string, each type as a field value, and an accessor on every field of a valid input.
  - Targets: `validateResult` of the API, the contract validators `validatePostResultRequest`, `validateManualIncidentInput`, `validateManualIncidentUpdateInput`, `validateManualIncidentDraftInput`, `validateManualIncidentNoteInput`, `validateTokenCreateInput`, `validateCheck`, `validateComponent`, `validateAdminCheckInput`, `validateAdminMaintenanceInput` and `isAdminRevision`, the parsers `parseConfig`, `parseCheck`, `parseTokens` and `parseAdminTokens`, and `bearerSecret`.
  - Result: the contract validators never threw and never ran a getter. `Object.prototype polluted: false`.
  - Unexpected throws came only from the throwing `Proxy` (in `validateResult`, `parseConfig`, `parseCheck`, `parseTokens` and `parseAdminTokens`) and from `bearerSecret` on non-string input. Its parameter is typed `string | undefined`, and Node's header values are strings. None of these inputs can come from `JSON.parse` or an HTTP header (`security-api-2026-11-05-3`, note).
- **Query and path parameters:**
  - `limit=99999999999999999999`: `400 limit must be a positive integer`
  - `before=-1`, `since=1e3`: `400 ... must be a non-negative integer`
  - a bad escape in a check id: `400 bad check id`
  - `status=x` on `/incidents`, `/manual-incidents` and `/admin/manual-incidents`: `400`
  - audit `limit=99999`: `400 limit is out of range`; a repeated `since`: `400 since is given more than once`; an unknown key: `400 unknown query parameter x`
  - `limit` on the audit export: `400`; any query on the config export: `400`
  - a bad note id or token id: `404`
- **Probe input:**
  - another location than the token's: `403 location does not match token`
  - a result for a heartbeat check: `403`
  - 1 h ahead: `400 timestamp is more than 10000 ms in the future`; 8 days old: `400`
  - an unknown check: `404`
  - `latencyMs` `1e309`, `statusCode` 99, a 10,000-character `reason`, an array or `null` body: `400` with the field rule
  - A `__proto__` key changes nothing: the result is stored under the token's location.
- **Admin and token input:**
  - a probe token without a location: `400 token.location: is required`; probe with admin: `400 token.scopes: probe must be the only scope`
  - `expiresAt` in the past: `400`; a 3,000-character name: `400`; an unknown scope: `400`; a `secret` key: `400 token: has an unknown field: secret`
  - a rotate body `{"a":1}`: `400 body must be empty or {}`
  - an unknown key in a draft: `400 manualIncident: has an unknown field: x`; a control character in a title: `400`
  - a 3,000-character note: `400`
  - `visibility` on the legacy create: `400 visibility: not accepted here; use /admin/manual-incidents`
  - a `__proto__` key on a check, component or window write: `422`
- **Environment settings:** see item 1. Each bad value gives one line and exit 2.

### 5. No accessor or getter of untrusted input runs: `checked`

- Every untrusted body and file goes through `JSON.parse` (`readJsonBody` of pulse-kit, `src/server.ts:404`, `src/token-routes.ts:88`, `src/config.ts:474`, `src/config.ts:530`). `JSON.parse` never creates accessors (`JSON.parse makes accessors? false`). Queries go through `URLSearchParams`, and headers are strings.
- `validateResult` now refuses a body with an accessor before any read (`src/server.ts:157-163`, test `security: result validation never invokes optional-field accessors`). The fuzz run counted 0 getter runs for all accessor cases of `validateResult` and of every contract validator.
- `parseConfig`, `parseCheck`, `parseTokens` and `parseAdminTokens` run a getter once when called directly with an accessor input. This cannot happen with parsed JSON (`security-api-2026-11-05-3`, note).

### 6. SSRF: allowed targets, environment lookups, redirects (cross-origin, https to http), forwarded headers: `checked`

- A search of the non-test sources for `fetch(`, `http(s).request`, `net.connect`, `createConnection`, `dns.`, `lookup(`, `Bun.connect`, `WebSocket`, `x-forwarded`, `forwarded`, `headers.host` and `process.env` hits only `process.env` in `src/main.ts:12`, `src/main.ts:27` and `src/backup-main.ts:10` (settings).
- During the run, `ss -tanp` showed only the listener of the API process (`LISTEN *:38451`). The API follows no redirect and resolves no name.
- Forwarded headers are ignored. The throttle test above shows this: varying `X-Forwarded-For` and `Forwarded` headers did not change the client key.
- Environment lookups: the API never resolves an `{"env": NAME}` reference. Names must match `^PULSE_HEADER_[A-Za-z0-9_]{1,115}$`, so a reference to `PULSE_TOKEN` gives `422`. The env value marker never appeared in any response or log.
- Allowed targets:
  - A `gopher:` URL gives `422 check.url: must be an http: or https: URL`.
  - A URL with userinfo gives `422 check.url: must not contain a username or password`.
  - A link-local `http` URL and a loopback `tcp` target are accepted (`201`). The probe fetches these targets, so a target policy belongs to the pulse-probe audit (Notes).

### 7. File writes atomic and path-safe: `checked`

- **What the API writes.** Besides SQLite, the API writes the checks file (component and window writes, `src/config-fs.ts`, `src/config-write.ts`) and the backup copy (`src/backup.ts`). Check writes now go to the database only.
- **Checks file write steps:** a temp file `<path>.<suffix>.tmp` opened with `wx` (exclusive create), write, mode and owner copied from the original, `fsync`, a second revision check, `rename`, then `fsync` of the directory.
- **Live checks:**
  - The mode stayed the same (`644` before and after). Through a symlink the new file took the target's `600`.
  - 6 parallel component creates with the same `If-Match` gave one `201` and five `412`. The file was valid JSON with exactly 1 new component.
  - 6 parallel database check creates gave one `201` and five `412`.
  - A read-only directory gave `503 checks file is read-only (EACCES)` for a component write, while a database check write still gave `201`.
  - No `.tmp` file was left after any write.
- **Symlinked checks file.** It was replaced by a regular file, and the link target was not changed (`link target has sym: 0`, Notes).
- **Backup command:**
  - Success: exit `0`, mode `600`.
  - Existing target: exit `2`.
  - Dangling symlink as the target: exit `2`, and the link target was not created.
  - Missing directory: exit `1`. No argument or two arguments: exit `2`.
  - No temp directory was left.
- **Paths** come only from settings and the command line, never from a request.

### 8. Dependencies, Docker base images and CI actions pinned and approved (`docs/approved-packages.md`): `checked`

- **Runtime:** `zod` `4.6.7`, `@lorenzh/pulse-contract` `#9ab7e24…` and `@lorenzh/pulse-kit` `#c6d2cba…`, all exact pins in `package.json` and `bun.lock` with integrity hashes, and all on the approved list. `gh api repos/lorenzh/<repo>/compare/<pin>...main` gives `ahead` with `behind_by=0` for contract, kit and config, so every pin is on `main`.
- **Dev dependencies:** Biome `2.6.3`, Lefthook `2.2.2`, `@types/node` `26.6.6`, `typescript7` `7.0.2`, `@types/bun` `1.4.0` and pulse-config `#04108fa…`, the same SHA as both reusable workflow refs in `ci.yml`. All match the dev table.
- **Audit:** `bun audit` exited with 1 because of one moderate advisory (`minimatch@10.2.6`, GHSA-g3hv-75wg-m249). `bun why` shows that it is reached only through `eslint` of pulse-config (dev). `bun audit --prod`: `No vulnerabilities found`, exit 0.
- **Docker:** both `Dockerfile` stages and the bench helper image use `oven/bun:1.4.0-alpine@sha256:07235578…437eb`, the approved digest. The final stage runs as `bun`. The repository no longer has a `compose.yaml`.
- **CI:**
  - `actions/checkout@3d3c42e5…` (v7.0.1), `oven-sh/setup-bun@0c5077e5…` (v2.2.0) and `actions/upload-artifact@cf430e03…` (v7.0.2) are all on the approved list for target repositories.
  - Every checkout sets `persist-credentials: false`.
  - The workflows have `contents: read`, and only the tag-only `release` job gets `packages`, `id-token` and `attestations: write`.
  - `pulse-workflows` printed `ok (2 files, 8 uses)` (exit 0).

## Issue candidates

### security-api-2026-11-05-1 (P3): the legacy `DELETE /manual-incidents/:id` deletes without enforcing the body limit

- **Location:** `src/server.ts:515-516`, in `applyManualWrite`. The `delete` case calls `store.remove(id, actor)` and answers `204` without reading the body. The private route reads and drops the body first (`skipBody`, `src/manual-incident-routes.ts:135` and `:209`).
- **Class:** missing body limit before a write.
- **Check:** a Bun script against the local instance, with the admin token:
  1. Create a public incident, send the legacy `DELETE` with a 2,000,000-byte body, then `GET` the incident.
  2. Do the same with the private `DELETE /admin/manual-incidents/:id`.
  3. Send the legacy `DELETE` with a body that holds a whole second request, and count the responses.
  4. Send the legacy resolve with a 2 MB body.

  Script exit code: `0`.
- **Output:**

  ```text
  legacy DELETE 2MB body: 204; GET after: 404
  private DELETE 2MB body: 413; GET after: 200
  legacy DELETE with a request in its body: responses=1 statuses=204
  legacy resolve 2MB body: 413; resolvedAt after: null
  ```

  A 20 KB body (limit 16 KiB) also gives `204`, and the log line is `manual incident write` with `action: delete`. No `413` failure line is written.
- **Why it matters:**
  - `docs/rest-api.md:40` says that a body over 1,000,000 bytes gives `413`. `docs/rest-api.md:288` sets 16 KiB for manual incidents (`413` above). The checklist asks for the limit before any write.
  - The test `security HTTP: oversized bodies across methods cannot reach a write` covers `/results`, `/admin/checks` and `/heartbeat`, but not this route.
- **Impact:** small. The route needs an admin token with `incidents`, and the unread body did not desync the connection (`responses=1`). It is the only write route that answers `204` to an over-limit body, so the documented limit fails there.
- **Fix direction:** read and drop the body with `MANUAL_INCIDENT_MAX_BODY_BYTES` before `store.remove`, as the private route does, and add the route to the oversized-bodies test. The same fix can cover the two private `GET` routes (`security-api-2026-11-05-2`).

## Notes

### security-api-2026-11-05-2 (P3, note): the private `GET /admin/manual-incidents[/:id]` routes ignore the body limit

- **Location:** `src/manual-incident-routes.ts:247-255`. The `list` and `get` actions answer without reading the body.
- **Check:** the limits script sent `GET` with a 2 MB body and the admin token to every admin read route, and then a 300 MB chunked stream. Exit code `0`.
- **Output:**

  ```text
  GET /admin/manual-incidents 2MB body ... 200
  GET /admin/manual-incidents/1 2MB body ... 404 {"error":"manual incident not found"}
  GET /admin/config 2MB body ... 413 {"error":"request body too large"}
  GET /admin/tokens 2MB body ... 413 {"error":"request body too large"}
  GET /admin/audit 2MB body ... 413 {"error":"request body too large"}
  chunked 300MB GET /admin/manual-incidents admin 200 0.179363s
  ```

- **Why it is only a note:**
  - Every other admin `GET` route reads and limits the body (`discardBody`, `readText`).
  - `docs/rest-api.md:330` lists the body check (`413` over 16 KiB, "also for ignored bodies") in the order of every private route. The route table gives these two `GET` routes the body "none".
  - Nothing is written, the body is not buffered (RSS rose by 1.8 MB over the whole stream test), and there was no desync (`responses=1`).

### security-api-2026-11-05-3 (P3, note): direct calls with non-JSON inputs throw or run getters

- **Location:**
  - `src/server.ts:157-163`: `Object.getOwnPropertyDescriptors` runs the traps of a `Proxy`.
  - `src/config.ts:325-331` (`raw.type`) and the Zod parsers behind `parseConfig`, `parseTokens` and `parseAdminTokens`: one getter run on an accessor field.
  - `src/tokens.ts`, `bearerSecret`: a `TypeError` on non-string input.
- **Check:** a fuzz script that imports the functions from the copy and counts throws and getter runs (523 cases). Exit code `0`.
- **Output:**

  ```text
  getter ran: config.parseConfig <- accessor checks (runs 1)
  getter ran: config.parseCheck <- accessor id (runs 1)
  getter ran: tokens.parseTokens <- accessor tokens (runs 1)
  getter ran: adminTokens.parseAdminTokens <- accessor tokens (runs 1)
  cases: 523, unexpected throws: 9, getter runs: 8
    throw: server.validateResult <- throwing Proxy: Error: trap
    throw: config.parseConfig <- throwing Proxy: Error: trap
    throw: tokens.bearerSecret <- symbol: TypeError: Cannot convert a symbol to a string
  JSON.parse makes accessors? false
  ```

- **Why it is only a note:** every input of these functions comes from `JSON.parse` or from a header string, which can hold neither an accessor nor a `Proxy`. The contract validators passed all cases. This is not an issue candidate.

### Findings of the previous report (2026-10-31), checked again

- `security-api-2026-10-31-1` (a bad request target gave `500` and an error line): **fixed.**
  - `parseTarget` (`src/server.ts:612-617`) now answers `400 {"error":"invalid request target"}`. 50 such requests gave 50 `400`, 0 stderr lines, and `pulse_api_http_requests_total{route="unmatched",code="400"}`.
  - The same target with an ops path also gives `400`.
- `security-api-2026-10-31-2` (unapproved CI pins and demo image): **fixed.**
  - The checkout and upload-artifact pins are now approved, and every checkout sets `persist-credentials: false`.
  - The demo `compose.yaml` left the repository.
- `security-api-2026-10-31-3` (getters of optional result fields): **fixed.** `validateResult` refuses accessor bodies, and the fuzz run counted 0 getter runs there.

### Other notes (no finding)

- **Probe target policy.** Admin writes accept link-local and loopback targets (`201` for an `http` URL on `169.254.169.254` and a `tcp` check on `127.0.0.1`). The API itself never connects. A target policy, if wanted, belongs to pulse-probe.
- **Kept header values.** A token with `admin` and `checks` cannot read literal header values or bodies. It can, however, `PUT` a database check with a new `url` and `{"keep": true}` markers, so the probe sends the stored values to the new target. This was read from `src/check-write.ts:89-130` and `docs/rest-api.md:405` and not tested. The grant rule already treats `checks` as access to header values (`src/token-scopes.ts`, "`probe` counts as `checks`"), so this follows the design. The docs could say it.
- **Credentials in URLs.** `GET /checks` is public and serves the `url` of every check, also of database checks. Userinfo is now refused (`422`). A credential in the query string would still be public.
- **Backups hold secrets.** A backup holds the literal header values and bodies of database checks (`strings bk1.db | grep -c DBHEADERSECRET0008` gave `2`), next to the token digests. The file has mode `600`. `docs/operation.md` (Backup and restore) does not say that a backup holds secrets.
- **Symlinked checks file.** A component or window write replaces the link with a regular file, in the link's directory, with the target's mode, and leaves the target unchanged. This is path-safe, but the link is lost. `docs/operation.md` does not say this.
- **Control characters in `reason`.** `POST /results` accepts unknown top-level keys and stores control characters in `reason` as sent: a stored `\u0000` came back from `/checks/web/results`. Manual incidents and drafts refuse control characters. Consumers of `reason` must escape it.
- **Brute force on probe and heartbeat routes.** These routes are not throttled (documented in `docs/rest-api.md:440`). Probe tokens from the tokens file need 16 or more characters and API-created secrets have 49. A valid probe token reads the literal header values on `GET /probe/checks`.
- **Shared throttle budget.** Clients behind one NAT or proxy share a budget, and more than 10,000 addresses or `/64` prefixes can use up the overflow budget (documented in `docs/operation.md`, Admin auth throttle).
- **Slow body.** An authenticated slow body (1 byte per second with a probe token) kept its connection open for at least 70 s. Unauthenticated slow or idle connections were closed after 6 to 12 s. The source sets no request timeout.
- **Deep `jsonAssert` values.** `jsonAssert[].equals` nested 1,000 levels deep is accepted (`201`). `jq` with its default depth limit then fails on `GET /admin/config` and `GET /probe/checks`. 10,000 levels or more get `422 check: is not a valid value`.
- **`.dockerignore`.** It does not list `admin-tokens.json`. The `Dockerfile` copies only `package.json`, `bun.lock` and `src/`, so the file never reaches the image, only the build context.
- **Unpinned `git` in the build stage.** The build stage of the `Dockerfile` runs `apk add --no-cache git` without a version. Only that stage uses it.
- **Dev advisory.** `bun audit` reports `minimatch@10.2.6` (moderate) in the dev-only lint toolchain of pulse-config. It is not in the image.
