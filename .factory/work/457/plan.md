# Spec #457: api: no probe results for heartbeat checks, no placeholder secrets, bounded certDaysLeft, admin audit logging

Based on `main` of pulse-api at `352ec49` and the issue review in
`.factory/work/457/issue-review.md`. This spec takes assumptions A1 to A9 of that review. Where
the review left a choice to the plan, the choice is written down below.

## Goal

Security audit M3, L3, L4 and the logging part of M4:

1. A heartbeat check changes only through its ping secret. A probe token can no longer post `up` or
   `down` for it with `POST /results`.
2. A checks file whose heartbeat `secret` is still the example placeholder (`replace-with-…`) is
   refused, like a placeholder token.
3. `certDaysLeft` in `POST /results` has a range.
4. Every manual-incident write and every failed admin authentication writes a log line. A metric
   counts admin authentication failures. Log lines carry names and kinds only, never token values,
   secrets, header values or bodies.

## Scope

Only `api` (`lorenzh/pulse-api`): `src/` code and tests, the docs and the quick-start lines.

## Non-goals

- No request rate limiting, no separate admin port, no entropy rule for admin tokens (the rest of
  M4).
- No change to `GET|POST /heartbeat/:id[/:secret]`. Its `401`s are not admin failures and are not
  logged by this feature (A9).
- No change to the status codes of manual-incident writes. A missing, unknown **or probe** token
  still gets `401` there (A1). This is documented in `docs/rest-api.md` and asserted in
  `scripts/compose-e2e.sh:459`. The log line tells the cases apart through a `token` kind field.
  The issue's "403 on manual-incident writes" means "probe token on a manual-incident write".
- No change to `/admin/*` status codes or their order (`docs/rest-api.md:325`).
- No contract change. The `certDaysLeft` range is enforced only in the api (A6). The contract's
  `optionalCertDaysLeft` stays `integer.nullable().optional()`, and the contract pin does not move.
- No change to the `config write` / `config write failed` lines or to
  `pulse_api_config_writes_total`.
- `checks.example.json` keeps its placeholder secret (A3). The `website` copy of the example is not
  a target and is not touched.
- No client-IP or `X-Forwarded-For` handling. The log rate limit has no "source" key (A2).
- No new pulse-kit helper. The rate-limited auth-failure log is specific to the api's admin routes
  and its metric, not a general logging helper.

## Required behavior

### 1. `POST /results` refuses heartbeat checks

- After authentication and body validation, and before the location check and ingest: if `checkId`
  names an **active** check with `type: "heartbeat"`, answer `403`
  `{"error":"heartbeat checks accept only pings"}`. Nothing is stored, the state, counters,
  `lastResultAt`, incidents and `pulse_api_results_ingested_total` do not change. The request is
  counted by the existing `pulse_api_http_requests_total{route="/results",code="403"}`. There is no
  new results counter (A4).
- The new status order of `POST /results`:
  `405` → `401` → `413` → `400` JSON → `400` field (contract, then api checks) →
  **`403` `heartbeat checks accept only pings`** → `403` `location does not match token` →
  `404` unknown or inactive check → `204`.
- An unknown or inactive id still gets `404` (`findActiveCheck` returns `undefined`, so there is no
  type to test).
- The check is looked up **once** per request. Reuse the `Check` that `validateResult`'s
  `findCheck` callback already fetches, for example by caching it in a local variable inside the
  callback passed from the handler. Do not add a second `service.findActiveCheck` call. The
  signature and behavior of the exported `validateResult` stay the same.
- The ping route still ingests with `isGenerated = true` through `service.ingest`, unchanged. The
  guard sits in the HTTP handler, not in `service.ingest`.

### 2. Heartbeat secret rules (`src/config.ts`)

- `MIN_SECRET_LENGTH` becomes `MIN_TOKEN_LENGTH` imported from `src/tokens.ts`, not a second
  literal `16`. `PLACEHOLDER_PREFIX` (`"replace-with-"`) is exported from `src/tokens.ts` and
  reused, not copied.
- `HEARTBEAT_SCHEMA.secret` gets one more rule after the existing length and charset rules:
  `.refine((v) => !v.startsWith(PLACEHOLDER_PREFIX), "still has the example placeholder secret")`.
  The check is case-sensitive, like the token rule.
- The resulting `ConfigError` message is exactly `checks[<i>].secret still has the example
  placeholder secret`. It names the path and never the value.
- The same parser runs for `POST`/`PUT /admin/checks` (A12 of the review). There, a placeholder
  secret answers `422` with `check.secret still has the example placeholder secret`, or whatever
  path prefix the admin parser already uses for secret messages. The value is never quoted. This
  needs no extra code, only a test.
- A checks-file reload with a placeholder secret is rejected like any invalid file. The API keeps
  the previous config and counts `pulse_api_config_reload_total{result="invalid"}`, unchanged.
- Start with such a file: `pulse-api: checks[<i>].secret still has the example placeholder secret
  (PULSE_CHECKS_FILE=<path>)`, or whatever the existing config-error wrapping prints, with exit
  code 2.

### 3. `certDaysLeft` range (`src/server.ts` `checkMeasurements`)

- New constant `MAX_CERT_DAYS = 3_000_000`, exported next to the other limits. Accepted values are
  absent, `null`, or an integer `n` with `-3000000 <= n <= 3000000`. Use the existing
  `isIntegerIn(v, -MAX_CERT_DAYS, MAX_CERT_DAYS)`.
- Why this bound and not ±36500 (the issue's example): the probe does not verify the chain
  (`probe/src/check.ts:38-47`, `rejectUnauthorized: false`) and posts
  `floor((valid_to - now) / day)` for any leaf certificate (`check.ts:446`). RFC 5280 4.1.2.5 makes
  `notAfter = 99991231235959Z` the standard value for a certificate with no expiry, which
  self-signed appliance and BMC certificates use. From 2026 that is about 2 912 000 days; even with
  a probe clock at the epoch it is about 2 932 900. X.509 and RDAP dates cannot go past year 9999,
  so 3 000 000 covers every real value and still rejects absurd input (`1e9`, `2^53 - 1`). The
  lower bound is symmetric: a real expired certificate is at most a few tens of thousands of days
  in the past, and a symmetric range keeps the rule and its message simple.
- Anything else answers `400` `certDaysLeft must be null or an integer from -3000000 to 3000000`.
  The message is built from the constant. If the contract validator rejects a non-integer first,
  its message wins, as today.
- A value in range (`30`, `-5`, `2912000`, `3000000`, `-3000000`) and `null` are stored and served
  as today.

### 4. Admin audit logging

#### 4a. Shared admin-token lookup (`src/tokens.ts`)

- Add one constant-time lookup that both admin paths use, for example
  `findByToken<T extends { token: string }>(entries, header): T | undefined`. It parses the header
  with the existing `BEARER` regex (`/^bearer (\S+)$/i`), compares the digest against **every**
  entry without an early exit, and returns the first match. `authenticate` becomes
  `findByToken(tokens, header)?.location`, so it keeps its behavior.
- `admin-routes.ts` stops using the `Map` keyed by token value plus the second
  `/^Bearer (.+)$/i` parse. `AdminRoutesDeps.adminTokens` becomes `readonly AdminToken[]`, and the
  name comes from `findByToken`. The `"admin"` fallback name is not needed any more.
- `ApiServerOptions.adminTokens` becomes `readonly AdminToken[]` (`{ name, token }`, from
  `src/admin-tokens.ts`), no longer `readonly string[]`. `undefined` still means the feature is off
  (`404` on writes, empty reads). `start.ts` passes the parsed list. Tests that pass `[ADMIN]`
  change to `[{ name: "ops", token: ADMIN }]`.

#### 4b. Auth-failure recorder (new `src/admin-auth-failures.ts`)

```ts
export type AdminAuthTokenKind = "missing" | "unknown" | "probe";
export const ADMIN_AUTH_LOG_WINDOW_MS = 60_000;
export function createAdminAuthFailures(deps: {
  now: () => number;
  warn: (message: string, fields: Record<string, string>) => void;
  metrics: Pick<Metrics, "recordAdminAuthFailure">;
}): { record(route: string, status: 401 | 403, token: AdminAuthTokenKind): void };
```

- **Kind**: `missing` means there is no `Authorization` header, or it does not match `BEARER`.
  `probe` means the presented token is a valid probe token (`authenticate(probeTokens, header) !==
  undefined`). `unknown` covers every other Bearer token. The kind is decided only after the admin
  lookup failed. The token value, its digest and its length are never logged.
- **Metric**: every call increments `pulse_api_admin_auth_failures_total{route,status}` by 1,
  including calls whose log line is suppressed.
- **Log**: one `warn` line `admin auth failed` with string fields `route` (pattern), `status`
  (`"401"`/`"403"`), `token` (the kind) and `suppressed` (decimal count).
- **Rate limit**, per key `(route, status, token)`. State per key: `lastLoggedAt`, `suppressed`.
  - Write a line when the key has no state yet, or when `now() - lastLoggedAt >= 60000`. The line
    carries `suppressed` = the count dropped for that key since its previous line (`"0"` for the
    first line). Then set `lastLoggedAt = now()` and `suppressed = 0`.
  - Otherwise write nothing and do `suppressed += 1`.
  - Keys are independent. A dropped count is only reported by the next line of the same key. With
    no later failure on that key it shows only in the metric. Document this.
  - Memory is bounded: routes are fixed patterns (at most 8 admin and 4 manual-incident patterns),
    times 2 statuses, times 3 kinds, so at most 72 entries. A raw path, id or method never becomes
    a key.
- **Route patterns**:
  - `/admin/<section>` and `/admin/<section>/:id` for `<section>` in `config`, `checks`,
    `components`, `maintenance`. This matches `routeOf` in `server.ts` and also applies to
    `/admin/config/<x>`, which authorizes before its `404`.
  - `/manual-incidents`, `/manual-incidents/:id`, `/manual-incidents/:id/updates`,
    `/manual-incidents/:id/resolve`.
  - Derive them the same way `routeOf` does, or share it. Never use the raw path.
- **Wiring**: `start.ts` creates **one** recorder with `now: deps.now ?? Date.now`,
  `warn: logger.warn` and the shared `metrics`, and passes it to both `createAdminHandler`
  (`AdminRoutesDeps.authFailures`) and `createApiServer` (`ApiServerOptions.adminAuthFailures`).
  Both paths then share one rate limit and one counter. When the option is absent,
  `createApiServer` builds its own recorder from `now`, a no-op `warn` and its `metrics`.
- **Where it is called**:
  - `admin-routes.ts` `authorize`: right before it throws `RouteError(403)` (kind `probe`) or
    `RouteError(401)` (kind `missing` or `unknown`).
  - `server.ts` `requireAdmin`: before it throws `401` (any kind). Not when the feature is off
    (`404`). `server.ts` already has the probe tokens to decide `probe`.
  - Status codes, headers (`WWW-Authenticate: Bearer`) and bodies do not change.

#### 4c. Manual-incident write lines (`src/server.ts`)

- New `ApiServerOptions.info` and `ApiServerOptions.warn`, with signature
  `(message: string, fields: Record<string, string>) => void` and no-op defaults. `start.ts` wires
  `logger.info` / `logger.warn`.
- After a successful `create`, `update`, `resolve` or `delete`: one `info` line
  `manual incident write` with fields `token` (the admin token's **name**), `action` (`create`,
  `update`, `resolve`, `delete`) and `id` (decimal; for `create` the id of the created incident).
  Exactly one line per write.
- A write that fails after authentication (`400`, `404`, `409`, `413`): one `warn` line
  `manual incident write failed` with `status`, `action` and, except for `create`, `id` (A5). No
  line for `405`, which is decided before auth, or for the feature-off `404`. A `500` is logged
  only by the existing `request failed`.
- No title, message, body, componentIds or header value goes into any of these lines.
- `pulse_api_manual_incidents_*` counters are unchanged.

#### 4d. Metric (`src/metrics.ts`)

- `Metrics.recordAdminAuthFailure(route: string, status: 401 | 403): void`, counter
  `pulse_api_admin_auth_failures_total` with help `Failed admin authentications, by route pattern
  and status.`, labels `route` and `status`. The series appear only after the first failure; no
  pre-initialization. Document that an alert should use `increase(...) > 0` with `or vector(0)` as
  needed.

### 5. Docs

- `docs/configuration.md`, heartbeat section:
  - In the `secret` row and the paragraph under it: not starting with `replace-with-`, and the
    message.
  - Replace "the secret cannot post to `/results`" with both directions: a probe token cannot ping,
    and `POST /results` for a heartbeat check answers `403` for every probe token, so only a ping
    changes a heartbeat check.
  - Next to `certDaysLeft` (TLS, line ~110, and domain, line ~172): the range
    −3000000..3000000 days, that it covers certificates and registrations that expire in year 9999
    ("no expiry"), and the `400` outside it.
- `docs/operation.md`:
  - `## Logs`: add `admin auth failed` (warn, fields, rate limit, `suppressed`),
    `manual incident write` (info) and `manual incident write failed` (warn). Change "The log never
    prints token values." to also cover secrets, header values and bodies, and say that admin token
    **names** do appear.
  - `## Manual incidents`: one sentence about the audit lines.
  - `## Heartbeat checks`: only a ping changes the check.
  - `### Upgrades`: a note that a checks file still carrying `replace-with-…` as a heartbeat secret
    stops the start after the upgrade, and how to replace it (`openssl rand -hex 32`).
- `docs/rest-api.md`:
  - `## POST /results`: the new step 6 (`403` heartbeat), renumber the rest; the `certDaysLeft`
    row gets the range.
  - `### Write routes`: the log lines, and that a probe token still answers `401` but is logged
    with kind `probe`.
  - `## Admin config routes`: `401`/`403` are logged as `admin auth failed`.
  - `## GET /metrics` table: a row for `pulse_api_admin_auth_failures_total` (`route`, `status`).
  - `## GET /locations` line 162 (rejected posts do not count): still true, no change needed.
- `docs/troubleshooting.md` `#400-on-post-results`: add the `certDaysLeft` message, plus a short
  entry for `403 heartbeat checks accept only pings` if the file has a status list for
  `POST /results`.
- Quick start (`README.md:23`, `docs/install.md:11`, `docs/development.md:11`, and the
  `bun start` line in `AGENTS.md:103`, which also says to copy `checks.example.json` to
  `checks.json`): say that the
  example's heartbeat `secret` (`nightly-backup`) must be replaced (or the check removed) before
  `bun start`, like the tokens.

## Risks

- **Existing deployments with the placeholder secret** stop at start (exit 2) after the upgrade.
  This is intended (the secret is public), but it is a breaking start. The upgrade note in
  `docs/operation.md` and the start message naming `checks[<i>].secret` make the fix obvious. An
  API that is already running only rejects the reload and keeps working.
- **TLS or domain check with a far expiry**: a certificate with `notAfter = 9999-12-31` (RFC 5280
  "no expiry", common on self-signed appliance and BMC certificates) gives about 2 912 000 days,
  and an RDAP registry may answer a far date too. With a ±36500 bound every post of such a check
  would get `400`, the probe would drop it (`dropping result for <id>: API answered HTTP 400`) and
  a check that is `up` today would go silent. The bound ±3 000 000 covers every date up to year
  9999 (the X.509 and RDAP maximum), even with a probe clock at the epoch, so no real value is
  rejected. Only values that no real date can produce (such as `1e9`) get `400`; that case is
  documented.
- **Silent heartbeat-result writers**: none known. The probe skips `type: "heartbeat"`
  (`probe/src/client.ts:263`), and compose-e2e and bench never post heartbeat results. The one test
  that does (`service.idempotent.test.ts`) is rewritten.
- **Log volume**: bounded by the rate limit, at most 72 keys and one line per key per minute.
- **Changed internal option types** (`adminTokens` shape, new deps): every test that builds
  `createApiServer` or `createAdminHandler` with admin tokens must be updated. `bun run typecheck`
  finds them all.

## Performance impact

None expected on the gating budgets of `bench/budgets.json` (api). The reasons:

- `POST /results`: the heartbeat guard reuses the `Check` that validation already loads (one
  `findActiveCheck` per request, as today) and adds one string comparison. `p95_post_results_ms`,
  `rps` and `load_cpu_s` stay within noise (< 1 %).
- `certDaysLeft`: two number comparisons, no change.
- Admin paths: one constant-time lookup instead of `matchesAnyToken` plus `Map.get`, and a few log
  lines. These routes are not in the bench load mix.
- `startup_cpu_ms`, `startup_wall_ms`, `idle_rss_mib`, `peak_rss_mib`: one small module and one
  `Map` of at most 72 entries, so no measurable change. `image_mb`: no new dependency.
- `test_cpu_s` (budget 2.8 s): the new tests (a few HTTP round trips, an injected clock, no sleeps)
  add an estimated 0.05–0.15 s. This is the only metric that may move noticeably. Check it against
  the budget.
- `build_cpu`: no change.

Measurement: the implementer runs `bun bench/run.ts --a 352ec49 --b HEAD` (or the current `main`
SHA as `--a`) and reports `test_cpu_s`, `p95_post_results_ms` and `load_cpu_s` from the A/B in the
PR. Every gating metric must stay within its budget.

## Security impact

Security impact: yes. The change touches admin route authentication and logging, the result
validator at the probe trust boundary, the checks-file parser for secrets, and log texts.

Checklist items that apply:

- **Secrets in errors, logs and responses**:
  - The placeholder message names `checks[<i>].secret` and never the value.
  - `admin auth failed`, `manual incident write` and `manual incident write failed` carry only
    route patterns, status, kind, token **name**, action and numeric id. No token value, digest,
    header value, heartbeat secret, body, title or message.
  - A sentinel test proves this for the admin token, the probe token and the heartbeat secret.
- **Auth order and status codes**:
  - `POST /results` puts the heartbeat `403` after `401` and the `400`s, so an unauthenticated
    caller still gets `401` and learns nothing about check types.
  - Admin and manual-incident statuses do not change.
  - Token comparison stays constant-time over all entries (`findByToken` has no early exit).
- **Input validation**: the `certDaysLeft` range, the heartbeat type guard and the placeholder
  rule.
- **Body and size limits**: unchanged. They are listed only so that the security state checks that
  logging happens after the limits and never reads a body to build a line.
- Not applicable: accessor execution (only parsed JSON is involved), SSRF and redirects, file
  writes (the config writer is unchanged), dependency pins (none added), Dockerfile, CI.

Hostile inputs for the security state are in Counterexamples. In addition:

- an `Authorization` header of 1 MB, or with CR/LF or control characters: logged only as kind
  `missing`/`unknown`, with the value never echoed;
- a path like `/admin/checks/%0Aevil` or `/manual-incidents/999999999999999/resolve`: the `route`
  field is a pattern, never the raw path;
- 10 000 failed requests in one minute: at most 72 log lines and an exact metric count.

## Rollout order

One repository (`api`). No contract, kit or config change.

Consumers that keep running:

- **Probes on any pin**: they never post heartbeat results. Every `certDaysLeft` they can compute
  from a real certificate or RDAP date (years up to 9999, about 2 912 000 days from 2026) is inside
  ±3 000 000 days, so no probe result that is accepted today is rejected.
- **status**: it proxies manual-incident writes. Its statuses do not change (`401`, `201`, …), so
  it keeps working, and its writes now also log the admin token's name.
- **notify**: it does not use these routes.

The only operator-visible break is a checks file that still carries the placeholder secret (see
Risks).

## Counterexamples

The setup:

- `HB = { id: "hb", type: "heartbeat", period: 60000, grace: 0, secret: "s3cr3t-sentinel-0123456789" }`
- `C1` is an http check.
- Probe token `P` = `"probe-sentinel-0123456789abcdef"` (location `default`).
- Admin token `A` = `"admin-sentinel-0123456789abcdef"`, name `ops`.

| # | Input | Must give | A wrong implementation would |
|---|-------|-----------|------------------------------|
| 1 | `POST /results` with `P`, `{checkId:"hb", status:"up", …valid}` | `403` `heartbeat checks accept only pings`; `listResults("hb")` empty; state, incidents and `/metrics` `results_ingested` unchanged | answer `204` (today's code) |
| 2 | same with `status:"down"` three times, as the old idempotent test did | `403` each; `consecutiveDown` stays `0`; no incident | open an incident |
| 3 | `POST /results` with no token, `checkId:"hb"` | `401` (not `403`) | check the type before auth |
| 4 | `POST /results` with `P`, `checkId:"hb"`, `status:"maybe"` | `400` (validation first) | answer `403` before validation |
| 5 | `POST /results` with `P`, `checkId:"hb"`, `location:"elsewhere"` | `403` `heartbeat checks accept only pings` (heartbeat guard comes before the location check) | answer `location does not match token` |
| 6 | `POST /results` with `P` for an inactive heartbeat id | `404` `unknown check "<id>"` | answer `403` and reveal the type |
| 7 | ping `GET /heartbeat/hb/<secret>` | `204`, stored as today | block pings through the new guard in `service.ingest` |
| 8 | checks file with `"secret":"replace-with-a-random-secret"` at `checks[6]` | `ConfigError` `checks[6].secret still has the example placeholder secret`; the message does not contain `replace-with-a-random-secret` | accept it, or quote the value |
| 9 | `"secret":"Replace-With-a-random-secret"` | accepted (case-sensitive, like tokens) | — (documents the rule) |
| 10 | `"secret":"my-replace-with-secret-x"` (prefix not at start) | accepted | reject with `includes` instead of `startsWith` |
| 11 | a 15-character secret | the existing length message (`is required: 16 to 128 …`) | — (the minimum is `MIN_TOKEN_LENGTH`) |
| 12 | `POST /admin/checks` with `A`, a valid `If-Match` and a heartbeat check whose secret is `replace-with-xxxxxxxxxxxxxxxx` | `422`, message names `secret`, no value | `201` |
| 13 | `certDaysLeft: 1e9` | `400` `certDaysLeft must be null or an integer from -3000000 to 3000000` | `204` (today) |
| 14 | `certDaysLeft: 3000001` / `-3000001` / `9007199254740991` | `400` | off-by-one with `<`, or no upper bound |
| 15 | `certDaysLeft: 3000000` / `-3000000` / `0` / `null` / absent | `204`, stored as sent (absent stays absent) | reject the bounds or `null` |
| 15a | `certDaysLeft: 2912000` (a TLS certificate with `notAfter` 9999-12-31, posted in 2026) | `204`, stored and served by `GET /checks` | `400` with a ±36500 bound, so the check goes silent |
| 15b | `certDaysLeft: 40000` (expiry about 110 years ahead) | `204` | `400` with a ±36500 bound |
| 16 | `certDaysLeft: 30.5` | `400` (contract or api message) | store it |
| 17 | `POST /manual-incidents` with `A` and a valid body, answering `201` with `id: 1` | exactly one info line `manual incident write` `{token:"ops", action:"create", id:"1"}` | log `token: <value>`, log the title, or log twice |
| 18 | `POST /manual-incidents/1/updates`, `/1/resolve`, `DELETE /manual-incidents/1` with `A` | one info line each, action `update`, `resolve`, `delete`, id `"1"` | skip `delete` |
| 19 | `POST /manual-incidents/999/resolve` with `A` | `404`; one warn `manual incident write failed` `{status:"404", action:"resolve", id:"999"}`; no info line | log an info line |
| 20 | `POST /manual-incidents` without a token | `401`; one warn `admin auth failed` `{route:"/manual-incidents", status:"401", token:"missing", suppressed:"0"}` | no line (today) |
| 21 | `POST /manual-incidents` with `P` | `401` (unchanged); warn line with `token:"probe"`; `P` not in the line | answer `403`, or log `unknown` |
| 22 | `POST /manual-incidents` with `Bearer not-a-real-token-123456` | `401`; `token:"unknown"`; the value not in the line | log the value |
| 23 | `PUT /admin/checks/c1` with `P` | `403`; warn `{route:"/admin/checks/:id", status:"403", token:"probe"}` | route `/admin/checks/c1` |
| 24 | `GET /admin/config` without a token | `401`; warn `{route:"/admin/config", status:"401", token:"missing"}` | no line (today) |
| 25 | admin feature off (`adminTokens` undefined): `POST /manual-incidents` without a token | `404`; no `admin auth failed` line; metric unchanged | log a `401` |
| 26 | rate limit, one key (`/admin/checks`, 401, missing), failures at t = 0, 1 000, 59 999, 60 000, 60 001, 200 000 | lines at t=0 (`suppressed:"0"`), t=60 000 (`"2"`), t=200 000 (`"1"`); metric `{route="/admin/checks",status="401"}` = 6 | log every failure, use `>` instead of `>=` at 60 000, or drop the suppressed count |
| 27 | at t = 0: a missing-token 401 and a probe-token 401 on `/manual-incidents`, then a missing-token 401 on `/admin/checks` | three lines (three keys) | one global limiter that hides the second and third |
| 28 | `/admin/checks/x` and `/admin/checks/y`, both 401 missing, at t = 0 | one line (same key `/admin/checks/:id`) and metric 2 | key on the raw path (unbounded) |
| 29 | sentinel run: the cases above with `A`, `P` and the HB secret, through `startApi` with a captured `write` | no captured line contains `A`, `P`, the HB secret or `replace-with-a-random-secret` | — |
| 30 | `POST /admin/checks` with `A`, a valid body and a write that succeeds | the `config write` info line is unchanged and there is no `admin auth failed` line | log auth success as a failure |

No statistics are introduced. The only counting rule is the `suppressed` count: the number of
`record` calls for the same key since that key's previous written line, excluding the call that
writes the line.

## Contract fields

No contract or config names are added or changed. These are the new api-internal names and texts,
each searched in the contract and config clones (and in api `src`/`docs` for collisions):

```
$ for n in pulse_api_admin_auth_failures_total recordAdminAuthFailure 'admin auth failed' \
    'manual incident write' 'accept only pings' MAX_CERT_DAYS 'placeholder secret' admin-auth-failures; do
    grep -rln -- "$n" .repos/contract/src .repos/config .repos/api/src .repos/api/docs | wc -l; done
0 0 0 0 0 0 0 0
```

- Metric `pulse_api_admin_auth_failures_total{route,status}`: new, no collision.
- `Metrics.recordAdminAuthFailure`: new, no collision.
- Log messages `admin auth failed`, `manual incident write`, `manual incident write failed`: new.
- Log fields `route`, `status`, `token`, `suppressed`, `action`, `id`: `status`, `token`, `action`
  and `id` are reused with the meanings they already have in the `config write` lines. The new
  value set of `token` is kind `missing|unknown|probe` on `admin auth failed`.
- Error text `heartbeat checks accept only pings`: new.
- Error text `certDaysLeft must be null or an integer from -3000000 to 3000000`: replaces
  `certDaysLeft must be an integer or null` (api only; the contract has no such text).
- Config message `still has the example placeholder secret`: new.
- Constants `MAX_CERT_DAYS`, `ADMIN_AUTH_LOG_WINDOW_MS`, module `src/admin-auth-failures.ts`: new.
- `PLACEHOLDER_PREFIX` (existing in `src/tokens.ts`): now exported.

## Repository: api

Files:

- `src/server.ts`: heartbeat guard in `POST /results`; `MAX_CERT_DAYS` and the range in
  `checkMeasurements`; `ApiServerOptions.adminTokens: readonly AdminToken[]`; new options `info`,
  `warn`, `adminAuthFailures`; the name lookup and auth-failure call in `requireAdmin`; info and warn
  lines in the create path and `writeManual`.
- `src/admin-routes.ts`: `adminTokens: readonly AdminToken[]` via `findByToken`; new dep
  `authFailures`; `record` before the `401`/`403` throws.
- `src/admin-auth-failures.ts` (new): the recorder from 4b.
- `src/admin-auth-failures.test.ts` (new): the rate limit with an injected clock (counterexamples
  26–28), the metric count and the field set.
- `src/tokens.ts`: export `PLACEHOLDER_PREFIX`; add `findByToken`; `authenticate` uses it.
- `src/config.ts`: `MIN_SECRET_LENGTH = MIN_TOKEN_LENGTH`; the placeholder refine on `secret`.
- `src/metrics.ts`: `recordAdminAuthFailure` and the counter.
- `src/start.ts`: one shared recorder; pass `adminTokens` (list), `info`, `warn` and the recorder to
  the server and the admin handler.
- `src/service.idempotent.test.ts`: rewrite "POST /results twice for a heartbeat check" as the
  same idempotency test on a non-heartbeat check (`down` twice → one row, `consecutiveDown`
  unchanged by the repeat), keeping its intent.
- `src/server.heartbeat.test.ts`: counterexamples 1–7 (the `403` for `up` and `down`, unchanged
  state, results, incidents, and the `/metrics` `code="403"` count of 2).
- `src/server.validation.test.ts` (or `server.test.ts`): counterexamples 13–16 (with 15a and 15b), and a spy showing
  `findActiveCheck` runs once per `POST /results`.
- `src/config.heartbeat.test.ts`: counterexamples 8–11.
- `src/config.examples.test.ts`: `checks.example.json` now throws
  `checks[6].secret still has the example placeholder secret`. A second assertion parses the
  example with the secret replaced in memory (`parseConfig` on the read JSON with a valid secret)
  and keeps the existing id, maintenance and component checks.
- `src/config-admin.test.ts`: counterexample 12.
- `src/server.manual-incidents.test.ts`: the `adminTokens` shape; counterexamples 17–22 and 25
  with captured `info`/`warn`.
- `src/server.auth.test.ts` or a new `src/admin-routes.audit.test.ts`: counterexamples 23, 24 and
  30 through `createAdminHandler` or the server.
- `src/start.test.ts` (or a new `src/start.audit-log.test.ts`): counterexample 29, the sentinel
  run through `startApi` with the captured `write`. It also checks that the real wiring writes
  `admin auth failed` and `manual incident write` as JSON lines at `warn`/`info`.
- Any other test that passes `adminTokens: [<string>]` or builds `AdminRoutesDeps` (found by
  `bun run typecheck`).
- `docs/configuration.md`, `docs/operation.md`, `docs/rest-api.md`, `docs/troubleshooting.md`,
  `README.md`, `docs/install.md`, `docs/development.md`, `AGENTS.md`: as in "5. Docs".

Not changed: `checks.example.json` (keeps the placeholder), `scripts/compose-e2e.sh` (its
assertions still hold: a probe-token manual write answers `401`, and its heartbeat secret
`e2e-throwaway-heartbeat-secret` is not a placeholder), `bench/`, `package.json` pins, Dockerfile,
compose files.

Behavior: Required behavior 1–5 above, exactly.

Checks:

- TDD: write the regression tests first and run them on unchanged code. Put the red output in the
  PR (mutation evidence) for:
  - counterexample 1/2 (heartbeat `403`; today `204`);
  - counterexample 8 (placeholder; today it loads);
  - counterexample 13 (`1e9`; today `204`);
  - counterexamples 17, 20 and 23 (no line today).
- Then revert only the guard, only the refine and only the range in turn, and show that each
  matching test fails.
- `bun run check` passes: typecheck, lint (cognitive complexity ≤ 15; the new `writeManual`
  logging must not push `handle` or `serveManualIncidents` over it, so extract helpers if needed),
  tests with ≥ 80 % coverage.
- `bun start` with a checks file that has a placeholder secret exits 2 with the path-named
  message.
- `bun start` with a valid file, then:
  - `curl -X POST /results` with a probe token for a heartbeat check gives `403`;
  - a manual-incident create with an admin token writes the `manual incident write` line;
  - a write without a token writes the `admin auth failed` line.
  Report the commands and the output in the PR, with tokens redacted.
- `bun bench/run.ts --a <main SHA> --b HEAD`: report `test_cpu_s`, `p95_post_results_ms` and
  `load_cpu_s`. The gating budgets must hold.

Completion evidence: CI green including `compose-e2e`; the PR names lorenzh/pulse-meta#457 (or its
child issue), the checks that ran, the red output of the regression tests on the old code, the
bench A/B numbers, and the known limits:

- the rate limit has no client-address key;
- a dropped count is reported only by the next line of that key;
- a probe token on a manual write stays `401`.
