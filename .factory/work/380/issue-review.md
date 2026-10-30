# Issue review: #380 Checks via API with admin token, and hot reload

Verdict: specifiable. No blocker for a hold. Blocker #384 is closed.

## Current state (api `main`)
- `startApi` (`src/start.ts`) calls `loadConfig(checksFile)` once. `checks`, `secrets`, `maintenance` and `components` are passed by value into `createService` (maintenance), `createApiServer` (`heartbeatSecrets`, `components`) and `createManualIncidentStore` (`componentIds` set). None can change at runtime today, so hot reload needs a mutable config holder (or getters) in all three places, not only a call to `upsertChecks`.
- Admin tokens: `loadAdminTokens`, checked to be distinct from probe tokens. Unset means manual incident routes answer 404. The new routes reuse this.
- Contract has `schema.ts`, `components.ts`, `client.ts`. The api's `config.ts` holds the file parsers (`parseConfig`, `parseChecksWithSecrets`), so the "same zod schemas as the file" live in the api, not the contract. Contract has to export schemas that the api can reuse, or the plan must say where the write-body schemas live.

## Open points (to settle in the plan)
1. Where the file schemas live: contract (request/response/`GET /admin/config`) vs api `config.ts` (file format incl. secrets, `{"env": NAME}` headers). Contract bodies must not carry secrets in responses. Request bodies do carry headers and heartbeat secrets (write-only). Suggest: write schemas in contract; file parse stays in api; contract response schemas have no header values.
2. Response shape "never header values": decide whether header names are returned (assumption: names yes, values and env refs no; `{"env": NAME}` reference also hidden, as the NAME is itself a lead on what the probe can read). Same for bodies, and for heartbeat secret (return only `hasSecret: true`).
3. Revision: ETag = hash (sha-256) of the raw file bytes. `GET /admin/config` returns it in the `ETag` header and in the body. Does a write require `If-Match`? Assumption: required, missing gives `428`. Alternative: optional. Decide in plan. `If-Match: *` not supported (assumption).
4. Write response: new `ETag`. Whether the write returns before or after reload is applied. Assumption: the write rewrites the file, then reloads in-process synchronously, so the response reflects applied state. The issue says "within one reload period"; in-process apply makes that immediate and probes still need up to 60 s.
5. Reload mechanism: assumption is `fs.stat` polling of mtime and size every 5 s (config via env, e.g. `PULSE_CHECKS_RELOAD_INTERVAL`, 0 disables) plus `SIGHUP`. Mtime and size alone can miss an edit that keeps both. Plan should decide whether to also compare content hash when stat changes, and whether to hash on every poll (cost vs correctness). Poll must not use `fs.watch` (a rename over a bind-mounted file loses the inode in Docker).
6. Bind mount and atomic rename: the temp file plus rename needs a writable directory mount. A single-file bind mount cannot be renamed over (EBUSY). Compose/docs must mount the directory. A write failing with EROFS/EACCES/EBUSY maps to 503 with the cause; check for it at write time, not only at startup.
7. Concurrency: write serialisation plus external edits. A hand edit between read and rename is detected via the revision compare done inside the lock just before rename (still a small race with an external writer; document it).
8. Reload semantics: what happens when a reloaded file removes a component still referenced by a manual incident, or a check with state (inactive as today). Maintenance windows already active at reload. Heartbeat evaluator state for a changed secret or interval. Plan must list per-field apply rules.
9. Delete semantics and referential checks: delete component also needs a check for manual incidents referencing it (409 or allowed?). Assumption: refuse with 409 if an unresolved manual incident references it; otherwise allowed. Deleting a check used by a maintenance window `checkIds`: 409 naming the window (issue only names components; consistency assumption).
10. PUT semantic: full replace with id in path; body id must match, else 400. Creation conflict with an existing id gives 409. PUT to an unknown id: 404 (no upsert). Assumption.
11. Routes naming: `/admin/checks`, `/admin/components`, `/admin/maintenance` with `POST`, `PUT /:id`, `DELETE /:id`, and `GET /admin/config`. Does not clash with `/probe/*` or manual incident routes. Plan to confirm against current `server.ts` paths.
12. Status codes order: 404 off, 401 no token, 403 probe token, 503 read-only (checked after auth, before body validation or after? Assumption: after auth and 412/validation do not mask 503), 413 oversized body, 415/400 bad JSON, 422 or 400 for schema failures (match existing routes), 412, 409.
13. Metrics names: `pulse_api_config_reload_total{result}`, `pulse_api_config_writes_total{kind,result}` (kind check|component|maintenance, result ok|invalid|conflict|stale|readonly|error). Label sets bounded.
14. Logging: one line per write with token name, kind, action, id. One line on invalid reload with path-named zod error. Zod error messages must not echo secret values (check zod error for header values, e.g. `received` fields). Sentinel test required.
15. Performance (#377): stat polling every 5 s is negligible; plan must cite the budgets in the perf section and add a measurement (idle CPU/RSS with polling on). Hashing only on stat change.
16. Docs "install docs": `compose.yaml` here is not in `.repos/api`; compose and `compose-e2e` live in another place (meta/config?). Issue targets only contract and api. Plan must locate where `compose.yaml` and `compose-e2e` live and whether a third target (config or kit) is needed; if it is outside contract/api, a meta/targets decision is needed. Assumption: the e2e and compose changes live in the api or contract repo's own CI, per the issue's "Targets: contract, api".
17. Contract version bump and compatibility: contract is consumed by probe/status; new schemas are additive (minor). Api depends on the new contract version; `dependsOn` api -> contract in `targets.json`.
18. Startup: invalid file at startup still fails fast (as today); only reload keeps the running config.
19. First write on a file that has no `components`/`maintenance` keys: write creates them; key order and formatting of the rewritten file (2-space JSON, trailing newline) is reformatted, so comments cannot exist (JSON). File mode and ownership of the temp file preserved from the original.

## Assumptions made
- #384 is complete (closed); no probe change here.
- Admin tokens file semantics unchanged; token names are used in logs.
- Probe fetches stay as they are (`GET /probe/checks`).

## Derived acceptance check
With `PULSE_API_ADMIN_TOKENS_FILE` set and a writable checks directory:
1. `GET /admin/config` with an admin token returns 200, an `ETag`, and no header values or secrets; with probe token 403; none 401; feature unset 404.
2. `POST /admin/checks` (valid body, correct `If-Match`) returns 201; `GET /checks` lists the check; `GET /probe/checks` includes it; file on disk is valid JSON and contains it; `PUT` changes it; `DELETE` makes it inactive.
3. Stale `If-Match` returns 412; component referencing a check blocks its delete with 409 naming the component; unknown key in body is rejected.
4. Hand edit of the file is applied within the poll interval; invalid edit keeps the old config, logs one line with the path, and `pulse_api_config_reload_total{result="invalid"}` increments; `kill -HUP` reloads at once.
5. Read-only file: every write route returns 503 naming the cause; reads work.
6. Sentinel test: no response, log line or metric contains a header value, body or heartbeat secret.
7. Each new test fails against the old code (mutation output in the PR); CI green in contract and api; `compose-e2e` creates, picks up in a probe, changes, deletes and asserts the page.
