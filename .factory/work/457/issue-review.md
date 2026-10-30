# Issue review: #457 api: no probe results for heartbeat checks, no placeholder secrets, bounded certDaysLeft, admin audit logging

Target: `api` only (`lorenzh/pulse-api`, `main` at `352ec49`). No contract change is needed (see A6).
There are no earlier decisions in the issue comments (only the Factory claim).

## Verified current behavior (pulse-api `main`)

- `POST /results` (`src/server.ts` ~508-537): auth by probe token → body → `validateResult` → location
  `403` → `service.ingest`. There is no check of the check type, so a probe token can post `up`/`down`
  for a heartbeat check. `src/service.idempotent.test.ts` ("POST /results twice for a heartbeat check")
  **asserts `204, 204`** for exactly this path. The probe never posts heartbeat results
  (`probe/src/client.ts:263` skips `type: "heartbeat"`), so closing the path breaks no real client.
- Heartbeat `secret` (`src/config.ts` ~190-209): 16..128 chars, `[A-Za-z0-9._~-]`. `MIN_SECRET_LENGTH`
  is already 16 = `MIN_TOKEN_LENGTH` (`src/tokens.ts`). No placeholder rule. Tokens use
  `PLACEHOLDER_PREFIX = "replace-with-"` with the message "still has the example placeholder token".
- `api/checks.example.json:78` has `"secret": "replace-with-a-random-secret"`, and
  `src/config.examples.test.ts` asserts that `checks.example.json` **loads** (7 checks, incl.
  `nightly-backup`). `compose/e2e/ro/checks.json` uses `e2e-throwaway-heartbeat-secret` (not affected).
  `compose/checks.json` (demo) has no heartbeat secret.
- `certDaysLeft` (`src/server.ts` ~109-111): any integer or `null`. The contract
  (`optionalCertDaysLeft = integer.nullable().optional()`) has no range either.
- Admin routes (`src/admin-routes.ts`): `authorize` throws 401 (missing/unknown) or 403 (valid probe
  token) before `target` is set, so `fail()` writes no log line for them. Success logs
  `config write` (info, token, kind, action, id); failures after auth log `config write failed` (warn).
- Manual incidents (`src/server.ts` `requireAdmin`, `serveManualIncidents`, `writeManual`):
  `Ops.adminTokens` is `readonly string[]` (values only, **no names**), there is no logger in `Ops`
  (only `logError`), no write is logged, and **a probe token answers `401`, never `403`**. This is
  documented (`docs/rest-api.md` "Write routes": "A missing, wrong or probe token answers `401`") and
  asserted in `scripts/compose-e2e.sh:459`.
- Metrics: no "rejected results" counter exists; rejected posts appear only in
  `pulse_api_http_requests_total{route,code}` (via `res.on("finish")`). The metrics table lives in
  `docs/rest-api.md` (`## GET /metrics`), the log line list in `docs/operation.md` (`## Logs`).
- No client-IP or `X-Forwarded-For` handling exists anywhere in the API. Manual-incident writes from the
  status page arrive through its proxy (`compose-e2e.sh` `proxy_manual`), i.e. from one source address.

## Open points (for the plan; none blocks the spec)

1. **403 on manual-incident writes does not exist.** The issue asks for a `warn` line on "a 401 and a 403
   … on manual-incident writes", but a probe token gets `401` there (documented, e2e-asserted). See A1.
2. **Rate limit key.** "One line per source and minute" has no defined "source": there is no IP
   handling and proxied writes share one address. See A2.
3. **Rate limit vs. the acceptance tests.** The first failure of a window must be logged immediately,
   and the tests need an injectable clock (`now`) so a 401 and a 403 each give one line and a burst gives
   one line plus a suppressed count.
4. **Token names in `server.ts`.** The manual-incident path needs admin token names and a logger: change
   `ApiServerOptions.adminTokens` to carry names (or a `Map`/lookup like `AdminRoutesDeps.adminTokens`)
   and add `info`/`warn` deps; `start.ts` wires both. Share the token-name lookup with `admin-routes.ts`
   instead of a second copy.
5. **Existing test that contradicts the goal.** `service.idempotent.test.ts` "POST /results twice for a
   heartbeat check" must be rewritten (same idempotency on a non-heartbeat check, or via
   `service.ingest` directly). Any other test posting `/results` for a heartbeat check must change too.
6. **Inactive / unknown heartbeat checks.** `validateResult` uses `findActiveCheck`; an inactive or
   unknown id has no type and answers `404` today. See A4.
7. **Status order of `POST /results`.** Where the new `403` sits relative to `400` (validation) and the
   location `403`. See A4.
8. **`certDaysLeft` range vs. the probe.** A domain check whose RDAP answer carries an absurd expiry date
   (> 100 years) would now get `400` on every post, and the probe drops the result; the check then looks
   silent instead of `up`. With ±36500 this is unlikely and acceptable; the doc should name the range
   and the reason for a `400`.
9. **Docs beyond the two named files.** `docs/rest-api.md` must change too: `POST /results` status list
   (new `403`, `certDaysLeft` range), the manual-incident write section (log lines), and the metrics table
   (new counter). `docs/configuration.md` line ~199 ("a probe token cannot ping, and the secret cannot
   post to `/results`") gets the reverse rule: a probe token cannot post results for a heartbeat check.
10. **Failed manual-incident writes after auth** (`400`, `404`, `409`, `413`). The issue requires a line
    for successful writes and for 401/403; whether failed writes also log is open. See A5.
11. **`website` copies the example.** `website/test/fixtures/api-checks.example.json` and
    `website/src/content/facts.ts` hold `replace-with-a-random-secret`. They are a pinned copy (not a
    target) and only check that sample ids exist in the fixture, so nothing breaks; a doc sample with a
    placeholder that users must replace is the intended use.
12. **Config writes through `/admin/checks`** use the same parser, so a placeholder secret there now
    answers `422` with the path-named message. Add one test so this is visible, no extra code.

## Assumptions

- **A1 (manual-incident status codes unchanged).** Manual-incident writes keep `401` for a missing,
  unknown **or probe** token; no new `403` there (not asked as a behavior change, documented and
  e2e-asserted). The `warn` line distinguishes the cause in a field (`token: "missing"`, `"unknown"`,
  `"probe"`), so "probe token on a manual write" is logged as `401` with kind `probe`. The acceptance
  item "403 on manual-incident writes" is read as "probe token on a manual-incident write". `/admin/*`
  keeps `401`/`403` as today.
- **A2 (rate limit key without IP).** Log rate limiting keys on `(route pattern, status, token kind)`,
  not on a client address: one `warn` line per key and minute, the first one immediately; the next line
  for that key carries a `suppressed` count of the lines dropped since. State is in memory, bounded by the
  fixed set of keys, and the clock is injected. The plan may choose a different key if it stays
  value-free and bounded.
- **A3 (example file).** `checks.example.json` keeps `replace-with-a-random-secret`, so a copied example
  cannot start with it. `config.examples.test.ts` changes to expect the path-named placeholder error
  (`checks[6].secret still has the example placeholder …`) and still verifies the rest of the example
  parses (for example by replacing the secret in memory and loading that). The plan may instead change
  the example; in both cases the example must not carry a usable secret.
- **A4 (`/results` heartbeat rule).** The `403` applies when the posted `checkId` names an active check
  of type `heartbeat`, after authentication and body validation (`400` first, as for every other rule)
  and before ingest; message `heartbeat checks accept only pings`. Inactive or unknown ids keep today's
  `404`. "Counts a metric label like other rejected results" means the existing
  `pulse_api_http_requests_total{route="/results",code="403"}`; no new results counter.
- **A5 (manual-incident log lines).** Success: one `info` line `manual incident write` with fields
  `token` (name), `action` (`create`, `update`, `resolve`, `delete`) and `id`, parallel to
  `config write`. A failed write after auth logs one `warn` line `manual incident write failed` with
  `status`, `action` and the id when known, parallel to `config write failed`. Never a body, title,
  message or header value.
- **A6 (no contract change).** The `certDaysLeft` range lives in the API's `checkMeasurements`
  (−36500..36500 or `null`, message `certDaysLeft must be null or an integer from -36500 to 36500`).
  The contract stays unchanged; a later contract tightening is out of scope.
- **A7 (secret rules).** Placeholder rule: a heartbeat secret starting with `replace-with-` is rejected
  with the token wording (`checks[i].secret still has the example placeholder …`, never the value). The
  length minimum already equals `MIN_TOKEN_LENGTH`; the plan ties the two constants together (import or
  shared constant) rather than adding a second rule.
- **A8 (admin auth metric).** New counter `pulse_api_admin_auth_failures_total{route,status}` with the
  route pattern (from the existing `routeOf` patterns, never a raw path or id) and `401`/`403`;
  unaffected by the log rate limit (every failure counts).
- **A9 (heartbeat ping route).** No change to `/heartbeat/:id`; its 401s are not admin failures and are
  not logged by this feature.

## Derived acceptance check

In pulse-api, `bun run check` passes with new or changed tests that show:

1. A probe token posting `up` and then `down` to `POST /results` for an active heartbeat check gets `403`
   `{"error":"heartbeat checks accept only pings"}` both times; `listResults`, the check state and
   `/incidents` are unchanged, and `pulse_api_http_requests_total{route="/results",code="403"}` counts 2.
   The test fails on current `main` (mutation/red output in the PR).
2. Loading a checks file with `"secret": "replace-with-a-random-secret"` throws a `ConfigError` whose
   message names `checks[<i>].secret` and does not contain the value; `checks.example.json` behaves per
   A3; `POST /admin/checks` with such a secret answers `422`.
3. `certDaysLeft: 1e9` (and −36501, 36501) answers `400`; `certDaysLeft: 30` and `null` are stored.
4. With a captured logger: each manual-incident create, update, resolve and delete writes exactly one
   `info` line with the token name, the action and the id; a missing token and a probe token on
   `/admin/checks` (`401`, `403`) and on `POST /manual-incidents` (`401`, `401` with kind `probe`) write
   one `warn` line each with route pattern, status and kind; a burst of failures within one minute writes
   one line, and the next line after the minute carries the suppressed count;
   `pulse_api_admin_auth_failures_total{route,status}` counts every failure. A sentinel admin token, probe
   token and heartbeat secret never appear in any captured line.
5. `docs/configuration.md`, `docs/operation.md` and `docs/rest-api.md` describe the heartbeat `403`, the
   placeholder rule, the `certDaysLeft` range, the new log lines and the new metric.
6. CI is green, including `compose-e2e` (its manual-incident probe-token `401` assertion still holds).
