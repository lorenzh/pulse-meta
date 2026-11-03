# Spec #558: api 400 for unparseable request targets, admin auth throttling and 32-character admin tokens

## Goal
Close three api findings of the security audit (`audits/security/api.md`, finding 1) and the quality review (top-10 #2), re-checked on api `main` `c9e23af16e95494311cdbc8cc57f1f94c75b3af7` (newer than the issue's `c00a375`; it already contains the hashed and scoped token store of #561):

1. A request target that the runtime HTTP parser accepts but the WHATWG `URL` constructor rejects (for example `GET //[ HTTP/1.1`) makes `handle` throw at `src/server.ts:582`, before ops routing and auth. The outer handler (`src/server.ts:804-815`) answers `500 internal error` and calls `logError`, which `start.ts:354-355` wires to an `error` line with the full stack. Verified on Bun 1.4.0 with a raw socket: `//[`, `//%zz`, `http://[` and `//:99999` all reach a `node:http` handler and make `new URL(req.url, "http://localhost")` throw.
2. Admin tokens use the probe minimum of 16 characters: `src/admin-tokens.ts:18` uses `tokenSchema` of `src/tokens.ts:27-32` with `MIN_TOKEN_LENGTH = 16` (`src/tokens.ts:6`).
3. Failed admin authentications are only counted and log-suppressed (`src/admin-auth-failures.ts:52-74`); nothing slows a client down.

After this change the api answers an unparseable target with `400`, requires 32 characters for every admin-side secret, and throttles repeated admin auth failures per client, with a metric.

## Scope
- **kit**: one additive module with a generic failure limiter and a client-key helper. No change to an existing export.
- **api**: the three behaviors, the kit pin bump, docs and an upgrade note.
- **console**: its client-side admin token check follows the new api minimum (its docs say the rules match the api's, `console/docs/configuration.md:33`).
- **deploy**: e2e fixture defaults of at least 32 characters, an e2e assertion that works with both the old and the new api, a docs fix for admin token rotation, and a run of `compose-e2e` against a candidate image of the changed api.

## Non-goals
- Moving admin routes to their own port or prefix (owner decision).
- Another token store or a token-store migration (#561 is done; this feature adds no migration step).
- Settings for the throttle limits, trusted-proxy handling (`Forwarded`, `X-Forwarded-For`), or limiting across several api processes.
- Throttling public reads, ops endpoints, `POST /results`, `GET /probe/checks` or heartbeat pings.
- A minimum change for probe tokens or heartbeat secrets (stay 16).
- Raising the 16-character rule of deploy's `secrets-init` and of `pulse init --force`: after the import the api ignores the host file, so refusing a short file there would stop the whole stack (api and probe wait for `secrets-init`) for installs that already rotated over the API. The api is the authority.
- A deploy image pin bump or any release tag. Tags and pin bumps are owner actions after this feature.
- A contract change: the `400` and `429` bodies use the existing `ErrorResponse` `{error}`.

## Required behavior

### R1. Unparseable request target (api)
1. `handle` parses the target once. When `new URL(req.url ?? "/", "http://localhost")` throws, it throws `HttpError(400, "invalid request target")`. This happens first, before `serveOps`, the heartbeat, admin and manual routes. No auth runs, no body is read.
2. The response is the usual error: status `400`, body exactly `{"error":"invalid request target"}`, `content-type` JSON from `sendJson`, the four `SECURITY_HEADERS` (`src/server.ts:56-61`) including the wire-version header. The body never holds the target, a header, a credential or the `URL` error text.
3. `logError` is not called for it, and no line at level `error` is written. `pulse_api_http_requests_total` counts it as `{route="unmatched",code="400"}` (`routeOf` already maps a parse failure to `unmatched`, `src/server.ts:220-227`); no `code="500"` sample grows.
4. Only the `URL` constructor failure maps to 400. Every other unexpected error keeps the 500 path with `logError` (one `request failed` line with the stack).
5. Parseable targets keep their behavior: `/healthz`, `/checks?x`, `//host/x` (parses to path `/x` and answers like today), a bad percent escape in a check id (`400 bad check id`), query validation, `405` with `Allow`, and `404` for unknown paths.
6. The second parse in the admin handler (`src/admin-routes.ts:296`) gets the same target only after the first parse succeeded, so it cannot throw for this reason; it stays.

### R2. Admin-side secrets of at least 32 characters (api)
1. A new constant `ADMIN_MIN_TOKEN_LENGTH = 32` in `src/admin-tokens.ts`. Length is JavaScript string length (UTF-16 code units), the same convention as `MIN_TOKEN_LENGTH`. Probe tokens keep `MIN_TOKEN_LENGTH = 16` and their messages.
2. **Import.** `parseAdminTokens` refuses an entry whose `token` is shorter than 32 characters. The message names the entry and the rule, for example `tokens[0].token token must be a string of at least 32 characters`; it must contain `tokens[<i>]` and `at least 32 characters` and never the token. The whitespace, placeholder (`replace-with-`), public example, duplicate and cross-role checks stay. A 32-character token that passes the other rules is accepted.
3. **Startup.** The error reaches the user as today: `withFile` (`src/start.ts:111-119`) appends ` (PULSE_API_ADMIN_TOKENS_FILE=<path>)`, `startApi` turns it into `StartupError` (`src/start.ts:187`), and kit's `runService` writes `pulse-api: <message>` to stderr and exits `2` (`kit/src/run-service.ts:102-104`). Nothing is imported: no `api_tokens`, `token_secrets`, `audit_log` or `token_bootstrap` row is added (the import is one transaction, `src/token-import.ts:68-108`, and the parse fails before it).
4. This applies to the first startup and to a first admin import on a database that already holds the probe import. A completed admin import never reopens its file (`src/start.ts:148-149`): a short, missing or broken file is still only logged as `ignored`.
5. **Authentication.** Imported digests carry no length, so the rule also runs where the plaintext is presented. In `adminAccess` (`src/admin-auth-failures.ts:17-31`), after `authenticate` returned `ok`:
   - a token with the `probe` scope keeps `403` kind `probe` (probe tokens may be 16 to 31 characters);
   - otherwise, a presented secret shorter than 32 characters is denied with `401`, `www-authenticate: Bearer`, body `{"error":"unauthorized"}`, and the new `AdminAuthTokenKind` `"short"`;
   - then the scope check (`403` kind `scope`) as today.
   The rule covers every non-probe scope (`read`, `checks`, `incidents`, `admin`), on every route that calls `adminAccess`: `/admin/config|checks|components|maintenance[/:id]`, `/admin/tokens*`, `/admin/audit*` and the manual-incident writes. A secret generated by the store is 49 characters (`src/token-store.ts:18-21`) and always passes. A short old secret is refused also during a rotation overlap.
6. Docs and the upgrade note (see the api section) tell operators to rotate short imported admin-side secrets on the old version before the upgrade, and how to roll back if they did not.

### R3. Admin auth throttling (api, with the kit limiter)
Policy (fixed constants, no settings):
- **Limit** `ADMIN_AUTH_FAILURE_LIMIT = 10` failures per client and window. **Window** `ADMIN_AUTH_WINDOW_MS = 60_000`, a fixed window that starts at the client's first failure while it has no live window. **Capacity** `ADMIN_AUTH_MAX_CLIENTS = 10_000` tracked clients.
- **Client** is the key `clientKeyOf(req.socket.remoteAddress)` (kit, below): an IPv4 address; an IPv4-mapped IPv6 address as its IPv4 address; any other IPv6 address as its `/64` prefix; a missing or non-IP address as the one shared key `unknown`. `Forwarded`, `X-Forwarded-For` and other headers are ignored. The key is the same for every connection and port of that peer.
- **Scope.** Every request that reaches an admin auth decision: the `authorize` of `createAdminHandler` (`src/admin-routes.ts:158-168`) for config, token and audit routes, and `requireAdmin` (`src/server.ts:432-440`) for the manual-incident writes. All share one limiter instance, created once in `start.ts` next to `authFailures` (`src/start.ts:327-348`), so `/admin/config`, `/admin/tokens`, `/admin/audit` and `POST /manual-incidents` draw from one budget per client. Requests answered before the auth point keep their answers and are neither blocked nor counted: feature-off `404` (`src/server.ts:434`, `:590`), manual-incident `405` and bad-id `404` (`src/server.ts:530-535`), unknown `/admin/*` paths (`404`), public reads, ops, probe and heartbeat routes.
- **Order at the auth point** (all synchronous, no `await` between the steps):
  1. `check(key)`. Blocked → `429`, no `authenticate` call, no body read, no write, no `last-used` update.
  2. Otherwise `adminAccess` as in R2.
  3. Denied (any `401` or `403`, every kind including `short` and `scope`) → `recordFailure(key)`, then `authFailures.record` and the `401`/`403` answer as today.
  4. `ok` → no change to the limiter (a success neither counts nor resets the window).
- **Boundary.** With window start `t0`: failures 1 to 10 of a client inside `[t0, t0 + 60000)` get their normal `401`/`403`. Any later request of that client at the auth point at a time `t < t0 + 60000` gets `429`, also with a valid credential. At `t = t0 + 60000` the window has ended; the request is evaluated normally, and a failure then opens a new window at `t` with count 1. Blocked requests never extend the window.
- **429 answer**: status `429`, body exactly `{"error":"too many requests"}`, header `Retry-After` = `ceil(retryAfterMs / 1000)` seconds as an integer, where `retryAfterMs = t0 + 60000 - t`, clamped to `1..60`. The security headers stay; token and audit routes keep `cache-control: no-store` (set before `authorize`, `src/admin-routes.ts:243`, `:261`). No `www-authenticate` header.
- **Metric**: new counter `pulse_api_admin_auth_throttled_total{route}`, `route` = the same route pattern that `authFailures.record` gets (never a raw path, client address or token data), `+1` per `429`. No series before the first `429` (like `pulse_api_admin_auth_failures_total`, `src/metrics.ts:112-116`). A `429` does not add to `pulse_api_admin_auth_failures_total`. `pulse_api_http_requests_total` counts it with `code="429"`.
- **Log**: at most one `warn` line `admin auth throttled` per route pattern and 60 s (`ADMIN_AUTH_LOG_WINDOW_MS`), fields `route` and `suppressed` (blocked requests not logged since the previous line of that route). No client address, header, token value, digest or length. No `error` line and no stack.
- **Capacity and overflow** are defined by the kit limiter: entries live for their window only; when 10 000 clients have live windows, further clients share one overflow budget of 10 failures per window. No entry is evicted before its window ends, so evicting cannot give a blocked client fresh attempts. Upper bound: at most `(10 000 + 1) × 10` evaluated admin auth failures per 60 s per process.
- State is per process and resets on restart. Clients behind one proxy or NAT share a budget.

### R4. Kit limiter (kit)
Module `src/failure-limiter.ts`, exported from the package root:
- `createFailureLimiter({ limit, windowMs, maxKeys, now }): FailureLimiter`. `limit` and `maxKeys` are integers from 1 to 1 000 000, `windowMs` an integer from 1 to `MAX_TIMER_DELAY_MS`; otherwise `RangeError` at creation. `now` returns epoch ms.
- `FailureLimiter.check(key: string): { isBlocked: false } | { isBlocked: true; retryAfterMs: number }`. A key with a live window (`now() < windowStart + windowMs`) is blocked when its count is at least `limit`; `retryAfterMs = windowStart + windowMs - now()`, clamped to `1..windowMs`. A key without a live window is checked against the overflow budget when the table holds `maxKeys` live keys, else it is not blocked.
- `FailureLimiter.recordFailure(key: string): void`. Drops ended windows first (oldest first). A key with a live window adds 1 (the count may stop at `limit`). A key without one gets a new window `{ windowStart: now(), count: 1 }` when fewer than `maxKeys` keys are live, else the failure goes to the overflow budget, which follows the same window rule and is not counted in `maxKeys`.
- `clientKeyOf(address: string | undefined): string`: trims, drops brackets and a `%zone` (reuse `normalizeAddress`, `kit/src/ip-classifier.ts:26-31`), then: IPv4 → the address; IPv6 whose first 80 bits are 0 and next 16 bits are `ffff` (`::ffff:127.0.0.1`, `::ffff:7f00:1`) → the dotted IPv4 address; other IPv6 → the first four groups as lower-case hex without leading zeros, joined with `:`, plus `::/64` (`2001:DB8:0:1:aa::1` → `2001:db8:0:1::/64`, `::1` → `0:0:0:0::/64`); `undefined`, empty or not an IP → `unknown`.
- No timers, no I/O, no auth or token concepts. Memory is bounded by `maxKeys + 1` entries.

### R5. Console
`MIN_TOKEN_LENGTH` of `console/src/admin-token.ts:5` becomes 32; messages read `must hold at least 32 characters`. All other rules and their order stay.

### R6. Deploy
- e2e admin token default `e2e-admin-token-sentinel-0123456789abcdef` (41 characters) in both places: `e2e/compose-e2e.sh:227` and `e2e/compose.e2e.yaml:58`. `E2E_ADMIN_TOKEN` still overrides both.
- The manual-incident write with a probe token (`e2e/compose-e2e.sh:472-473`) accepts `401` (published api `0.1.0`) or `403` (api `main`, kind `probe`), and the ok line says so. The unauthenticated write stays exactly `401`.
- `docs/cli.md:163` no longer says that writing `secrets/admin-token` rotates the admin token: after the first import the api ignores the file. Rotation is `POST /admin/tokens/<id>/rotate`; then write the new secret into `secrets/admin-token` so the console gets it at the next start. `full/README.md` "Opting in to admin tokens" says that an admin token needs at least 32 characters (the shown `openssl rand -hex 32` gives 64).

## Performance impact
api `bench/budgets.json` (keys verified at `c9e23af`):
- `api.startup_cpu_ms` (gating, budget 325) and `api.idle_rss_mib` (gating, 88) / `api.peak_rss_mib` (gating, 115): the kit bump from `236df21` to kit `main` adds the address-guard, guarded-fetch and ip-classifier modules to the root entry that the api imports (`gh api repos/lorenzh/pulse-kit/compare/236df21...main`: 13 commits, additive only), plus the limiter module. Expected up by at most a few ms of CPU and well under 1 MiB. The limiter holds no entries without admin auth failures; bench sends none (`grep -n admin bench/*.ts` finds nothing).
- `api.load_cpu_s` (gating), `p95_*`, `rps`, `cold_*`, `eod_*` (reported or gating): none expected. The hot path gains one `try` around the existing `URL` parse; `POST /results` and reads do not touch the limiter.
- `api.test_cpu_s` (gating, budget 5.6, floor 1.6): up by roughly 0.1 to 0.3 s for the new tests (raw-socket, throttle and import tests). Existing tests must not use real timers or sleeps.
- `startup_wall_ms`, `image_mb` (reported): none expected beyond noise; the kit `dist` grows by a few KB.
- kit, console and deploy have no rows that this change can move beyond noise (`kit.test_cpu_s` up slightly for the new test file).
- Measure: a local A/B `bun bench/run.ts --a <api main sha> --b <branch sha>` (`bench/README.md:76`), plus one hosted `Bench` run dispatched on the api branch (`gh workflow run bench.yml -R lorenzh/pulse-api --ref <branch>`). Budgets are not changed in this feature; a gating failure is a hold with the run link.

## Security impact
Security impact: yes. It changes admin authentication (length rule, throttle, `429`), the request-target error path and its log text, a dependency pin (kit) and a CI fixture (console CI sentinel, deploy e2e).

Checklist items that apply:
- **Secrets in errors, logs and responses**: startup messages name the entry, rule, setting and path, never the token; `400`/`429` bodies are fixed strings; log lines and metric labels carry no client address, raw path, token, digest, length or header value.
- **Auth order and status codes**: R1 (400 before any auth), R2.5 (`403 probe` before `401 short` before `403 scope`), R3 (throttle check before authenticate; feature-off and method/id answers before the throttle).
- **Body and size limits**: a blocked or denied request never reads its body.
- **Input validation**: the request target at the trust boundary; the admin tokens file.
- **Dependency pins**: kit pinned to the full merged SHA on kit `main`; `bun.lock` updated with `bun install`, frozen-lockfile in CI.
- Not applicable: accessor execution, SSRF and redirects (no probe change), atomic writes (no file write).

## Rollout order
1. **kit** merges first. Only additions: probe, status, notify, console and the api on their current kit pins keep working, because no export changes.
2. **api** pins the merged kit SHA and changes behavior. Who still runs:
   - probes on any version: probe tokens keep the 16-character rule, `POST /results` and `GET /probe/checks` are not throttled.
   - status and notify: they read public routes only; the only visible change for them is `400` instead of `500` for a malformed target, which they never send.
   - console: makes no api call yet (`console/docs/configuration.md:31`).
   - deploy: its pins stay on api `0.1.0` until a person tags a release and bumps the pin; nothing changes for deployed stacks before that.
   - operators: an admin-side secret shorter than 32 characters stops working after the upgrade. The upgrade note says to rotate first; rollback to the previous image is safe because this feature adds no migration step.
3. **console** can merge in parallel to the api. A console with a 16 to 31 character token refuses to start; that token would get `401` from the new api anyway. A console on the old rule keeps working against the new api with a token of at least 32 characters.
4. **deploy** merges after the api, because its acceptance runs `compose-e2e` against a candidate image built from api `main` with this change. Its committed changes work against the pinned api `0.1.0` (a 41-character token is valid there; `401` is accepted) and against the new api (`403` is accepted). A later pin bump to an api release with this change then needs no fixture change.

## Counterexamples
- **Malformed target via fetch.** `fetch("http://127.0.0.1:<port>//[")` may normalize or reject the URL before sending, so such a test proves nothing. The test writes the request line `GET //[ HTTP/1.1` on a raw `node:net` socket.
- **Catch-all 400.** Mapping every non-`HttpError` to 400 hides real faults. A handler that throws `new Error("boom")` from a fake service on `GET /checks` must still give `500 internal error` and one `logError` call.
- **Ops-looking target.** `GET //[/healthz HTTP/1.1` must answer `400`, not `200` from the ops handler. An implementation that runs `serveOps` before the parse answers it with whatever `handleOps` decides.
- **Echo.** A body like `{"error":"Invalid URL: //["}` leaks the target; the body must be exactly `{"error":"invalid request target"}`.
- **Admin length boundary.** A 31-character admin token is refused at import, a 32-character one is accepted. `example-token-0123456789abcdef` (30 characters, a public example) as an admin token is refused by the length rule now; `replace-with-openssl-rand-hex-32` (32 characters) is still refused as a placeholder.
- **Probe rule unchanged.** A 16-character probe token in `tokens.json` still imports; an implementation that changes `tokenSchema` itself breaks it.
- **Ignored file.** A database with a completed admin import and an admin tokens file now holding a 20-character token starts normally and logs `PULSE_API_ADMIN_TOKENS_FILE ignored: tokens are stored in the database`; startup that re-reads the file fails wrongly.
- **Short stored secret.** A database imported by the old version with a 20-character admin secret: `GET /admin/config` with it answers `401` (kind `short`), and a rotated 49-character secret of the same token answers `200`. An implementation that checks only at import lets the 20-character secret in.
- **Short probe on admin route.** A 16-character probe token on `POST /manual-incidents` answers `403` (kind `probe`), not `401 short`.
- **Throttle boundary.** One peer, fake clock at `t0`: 10 requests with a wrong token answer `401`; the 11th at `t0` answers `429` with `Retry-After: 60`; at `t0 + 59001` it answers `429` with `Retry-After: 1`; at `t0 + 60000` a request with a valid token answers `200`. An implementation that unblocks at `t0 + 61000` or blocks at the 10th request is wrong.
- **Retry-After rounding.** Remaining 59 001 ms → `60`; remaining 1 ms → `1`; never `0`, never above `60`, also when the clock jumped backwards.
- **Valid token in penalty.** A blocked peer with a valid admin token gets `429`; `authenticate` is not called (the token's `lastUsedAt` does not change).
- **Success does not reset.** 9 failures, 1 success (`200`), 1 failure (`401`, the 10th), then a request → `429`. An implementation that resets on success answers `401` or `200` instead.
- **Mixed routes and kinds.** 4 failures on `/admin/config` (no header, kind `missing`), 3 on `/admin/tokens` (unknown token), 3 on `POST /manual-incidents` (a `read`-only token, `403 scope`), then `GET /admin/audit` → `429`. Per-route or per-kind budgets would answer `401`.
- **Reconnect and spoofing.** 10 failures on 10 separate connections, then an 11th connection with `X-Forwarded-For: 203.0.113.9` → `429`. Keying on the socket, the port or the header is wrong.
- **Independent peers.** Peer `127.0.0.1` blocked; a request from `127.0.0.2` (a second loopback address, or a fake `remoteAddress` in a unit test) is evaluated normally.
- **Burst.** 50 concurrent requests with wrong tokens from one peer: exactly 10 answer `401` and 40 answer `429`. An implementation that awaits between `check` and `recordFailure` lets more than 10 through.
- **Not throttled.** A blocked peer still gets `200` from `GET /checks`, `/healthz`, `/metrics`, `204` from a valid `POST /results` and a valid heartbeat ping, and `404` from `POST /manual-incidents` when the feature is off.
- **Blocked request writes nothing.** A blocked `POST /admin/checks` with a valid token and a valid body leaves the checks file revision and the audit log unchanged.
- **Overflow.** `maxKeys = 3`, `limit = 2`: keys a, b, c get one failure each; d's two failures go to the overflow budget, then `check("e")` is blocked while `check("a")` is not. After `windowMs`, `check("e")` is not blocked. Evicting `a` to make room for `d` is wrong.
- **IPv6 key.** `2001:db8::1` and `2001:db8::2` share a key (`2001:db8:0:0::/64`); `2001:db8:0:1::1` does not. `::ffff:127.0.0.1` and `127.0.0.1` share `127.0.0.1`.
- **Metrics.** After the 13 requests of the boundary case before the window end (10 `401`, 3 `429`): `pulse_api_admin_auth_failures_total{route="/admin/config",status="401"}` is 10, `pulse_api_admin_auth_throttled_total{route="/admin/config"}` is 3. Counting `429` as a failure gives 13.
- **Statistics.** The only statistic is the per-client failure count: window = fixed 60 000 ms from the first failure without a live window; sample set = admin auth denials (401 and 403) from one client key in that window; no percentile; `Retry-After` rounds the remaining ms up to whole seconds, clamped to `1..60`.

## Contract fields
New names, each searched in the contract and config clones (and kit and api `src`); every search prints nothing:
- metric `pulse_api_admin_auth_throttled_total`: `grep -rn 'admin_auth_throttled' .repos/contract/src .repos/config/src .repos/kit/src .repos/api/src`
- api constant `ADMIN_MIN_TOKEN_LENGTH`: `grep -rn 'ADMIN_MIN_TOKEN_LENGTH' .repos/contract/src .repos/config/src .repos/api/src`
- api module `src/admin-auth-throttle.ts` and metric method `recordAdminAuthThrottled`: `grep -rn 'admin-auth-throttle\|recordAdminAuthThrottled' .repos/contract/src .repos/config/src .repos/api/src`
- api auth kind `"short"` in `AdminAuthTokenKind`: `grep -rn '"short"' .repos/contract/src .repos/config/src` prints nothing; in api `src` it only appears as test fixture values (`admin-tokens.test.ts:26`, `tokens.test.ts:36`, `start.test.ts:458`, `config.heartbeat.test.ts:20`), never as a kind.
- error texts `invalid request target`, `too many requests`: `grep -rn 'invalid request target\|too many requests' .repos/contract/src .repos/config/src .repos/kit/src .repos/api/src`
- kit exports `createFailureLimiter`, `FailureLimiter`, `clientKeyOf` and module `failure-limiter`: `grep -rn 'createFailureLimiter\|FailureLimiter\|clientKeyOf\|failure-limiter' .repos/contract/src .repos/config/src .repos/kit/src`
- response header `Retry-After`: `grep -rn -i 'retry-after' .repos/contract/src .repos/config/src` prints nothing; it is a standard HTTP header, not a contract field.
No route is added or renamed.

## Risks
- **Lockout on upgrade.** An install whose only admin-side secrets are short imported ones loses admin access after the upgrade. Mitigation: the upgrade note (rotate on the old version first) and rollback (no migration in this feature). Accepted by the issue's rule; no grandfathering.
- **Shared budgets.** Admins behind one NAT or reverse proxy share a budget; a misconfigured script there can lock out a human for up to 60 s. Documented.
- **Overflow DoS.** An attacker with more than 10 000 IPv4 addresses or `/64` prefixes in one minute can exhaust the overflow budget, so new clients get `429` for up to 60 s. Clients with live windows and the public routes are unaffected. Documented as a known limit.
- **Unrelated e2e drift.** The candidate `compose-e2e` run tests api `main`, which also holds #561 and other changes newer than the pinned `0.1.0`. If it fails in a step that this feature did not change, the deploy child holds with the log and the step; it does not fix unrelated drift or weaken an assertion beyond R6.
- **Raw request tests.** Bun may close the connection without reading the whole response. The test reads until `close` with a timeout from an injected fake, not a real sleep.

## Acceptance evidence
Expected values come from literals in this spec (status codes 400/401/403/429/500, the bodies, limit 10, window 60 000 ms, capacity 10 000, `Retry-After` values, exit code 2, the lengths 16, 31, 32) and from independent runs (CI, Bench, the candidate e2e run). No check reads its expected value from the code under test.

1. **Red then green, one test per finding** (api): the R1 raw-socket test, the R2 import test (31 vs 32 characters) and the R3 throttle boundary test each fail on api `main` `c9e23af` and pass on the branch. The PR shows the failing run (test name and assertion) and the passing run.
2. kit: `bun run check` (lint, build, typecheck, test) green; `git diff --exit-code -- dist` after `bun run build` is clean; CI green.
3. api: `bun run check`, `bun run bench:selftest`, `docker compose -f bench/compose.bench.yaml config --quiet` exit 0; CI jobs `check`, `bench-selftest`, `docker` green; one complete hosted `Bench` run on the branch without a gating failure (link in the PR).
4. api `bun start` exercise (see the api section) with the commands and outputs in the PR.
5. console: `bun run check` and CI green, including the docker job with the new sentinel.
6. deploy: CI green on the PR (the `full` job runs `compose-e2e` against the pinned api `0.1.0`), and one `bash e2e/compose-e2e.sh` run against a candidate image built from api `main` that contains the merged api change, ending with `==> All checks passed`, with the api SHA and the image ID in the PR.

## Repository: kit
Files:
- `src/failure-limiter.ts` (new)
- `src/index.ts`
- `dist/failure-limiter.js`, `dist/failure-limiter.d.ts` (new, built), `dist/index.js`, `dist/index.d.ts` (rebuilt)
- `test/failure-limiter.test.ts` (new)
- `test/smoke.test.ts`
- `docs/index.md`
- `README.md`

Behavior change: yes. New exported runtime helpers.

Tool facts (kit clone at `739188a87a177c0e8b5a8938e3f54c2bdaf19df4`):
- Bun 1.4.0: `package.json:8` (`engines`), `package.json:49` (`packageManager`).
- `bun run check` = `bun run lint && bun run build && bun run typecheck && bun run test` (`package.json:39`); build is `tsc -p tsconfig.build.json` via `typescript7` (`package.json:33`); test is `bun test` (`package.json:35`); `bunfig.toml:1-4` enforces 80 % line coverage.
- Biome 2.6.3 (`package.json:42`); `biome.json` extends `@lorenzh/pulse-config/biome.json` at pin `51e95b0eb463b27a196a33b428607bd92443e4f0` (`package.json:43`); the pinned file (read with `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=51e95b0…"`) is identical to the config clone and includes `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures` (`biome.json:10-17`).
- CI: `.github/workflows/ci.yml:17-19` uses `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0…` with `build: true`; at that pin (identical to the clone) `check.yml:25-38` runs install, lint, typecheck, build, `git diff --exit-code -- dist`, test.
- `dist/` is committed and `test/smoke.test.ts:8-25` lists every module for the dist test; `:50-` checks the root exports (`AGENTS.md`, "This repository").

Behavior: R4 exactly. Reuse `normalizeAddress` from `src/ip-classifier.ts` and `MAX_TIMER_DELAY_MS` from `src/timer.ts`. Keep the insertion order of the key map equal to window start order, so dropping ended windows is cheap. Add `failure-limiter` to `ALL_MODULES` and `clientKeyOf`, `createFailureLimiter` to the export list of `test/smoke.test.ts`. Document the module in `docs/index.md` (exports table with the rules of R4) and add it to the README list of helpers.

Checks (`test/failure-limiter.test.ts`, fake `now`, no timers):
- the boundary of the Counterexamples (limit 10, window 60 000): not blocked after 9 failures, blocked after 10 with `retryAfterMs` 60000 at `t0` and 999 at `t0 + 59001`, not blocked at exactly `t0 + 60000`, and a failure then starts a new window with count 1;
- a success path does not exist in the limiter: `check` alone never changes state (100 `check` calls, then 10 failures still needed);
- the overflow counterexample (`maxKeys = 3`, `limit = 2`), and that ended windows free capacity;
- `retryAfterMs` clamp when `now` goes backwards (never above `windowMs`, never below 1);
- `RangeError` for `limit` 0, `maxKeys` 1.5, `windowMs` `MAX_TIMER_DELAY_MS + 1`;
- `clientKeyOf`: `127.0.0.1`, `::ffff:127.0.0.1`, `::FFFF:7f00:1`, `[2001:db8::1]`, `2001:DB8:0:1:aa::1`, `fe80::1%eth0` → `fe80:0:0:0::/64`, `::1`, `undefined`, `""`, `not-an-ip` → literal results of R4.

Completion evidence: `bun run check` output, a clean `git diff --exit-code -- dist` after `bun run build`, CI link, and the merged commit SHA (the api pins it).

## Repository: api
Files:
- `package.json` (kit pin), `bun.lock`
- `src/server.ts`
- `src/admin-routes.ts`
- `src/admin-auth-failures.ts`
- `src/admin-auth-throttle.ts` (new)
- `src/admin-tokens.ts`
- `src/tokens.ts` (only if the length becomes a parameter of the shared token rules; probe behavior unchanged)
- `src/metrics.ts`
- `src/start.ts`
- Tests: `src/server.target.test.ts` (new), `src/server.throttle.test.ts` (new), `src/admin-auth-throttle.test.ts` (new), `src/admin-tokens.test.ts`, `src/admin-auth-failures.test.ts`, `src/start.token-import.test.ts`, `src/start.test.ts`, `src/server.auth.test.ts`, and the admin token fixtures shorter than 32 characters in `src/config-admin.test.ts`, `src/config.examples.test.ts`, `src/server.allow.test.ts`, `src/server.scopes.test.ts`, `src/server.audit.test.ts`, `src/server.rotation.test.ts`, `src/server.tokens.test.ts`, `src/security-review.test.ts`, `src/start.audit-log.test.ts`, `src/server.manual-incidents.test.ts`, `src/server.manual-incidents.audit.test.ts`, `src/config-write.audit.test.ts`, `src/docs-claims.test.ts` (only where a fixture or a doc claim changes)
- `README.md`, `docs/configuration.md`, `docs/rest-api.md`, `docs/operation.md`, `docs/troubleshooting.md`

Behavior change: yes. New status codes (400, 429), a stricter admin token rule and a new metric.

Tool facts (api clone at `c9e23af16e95494311cdbc8cc57f1f94c75b3af7`):
- Bun 1.4.0: `package.json:8-10` (`engines`), `package.json:35` (`packageManager`); `ci.yml:28-30` sets `bun-version: 1.4.0` for `bench-selftest`.
- Scripts: `check` = `bun run lint && bun run typecheck && bun run test` (`package.json:20`); `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`:16`); `test` = `bun test` (`:15`); `bench:selftest` (`:18`). `bunfig.toml:1-4`: coverage on, 80 % lines.
- kit pin `github:lorenzh/pulse-kit#236df214f9df8658f2992dd6f7c100952c07102b` (`package.json:32`); kit `main` is 13 commits ahead, additive only. Contract pin unchanged (`package.json:31`).
- Biome 2.6.3 (`package.json:23`); `biome.json` extends `@lorenzh/pulse-config/biome.json` at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:24`); the pinned file is identical to the config clone (`biome.json:10-17` includes, 2-space indent and line width 100 at `:19-24`).
- CI: `ci.yml:17-18` uses `check.yml@04108fa…` (identical to the clone: `check.yml:16` ubuntu-24.04, `:22-24` Bun 1.4.0, `:25-26` frozen install, `:27-28` lint, `:29-30` typecheck, `:37-38` test; build steps off). `ci.yml:20-33` job `bench-selftest` (`bun run bench:selftest`, `docker compose -f bench/compose.bench.yaml config --quiet`); `ci.yml:35-53` job `docker` (build, dotenv and test-file checks). Bench workflow `bench.yml` (dispatch inputs `a`, `b`, `others`).

Behavior:
- R1 in `handle` (`src/server.ts:576-602`): one guarded parse at the top, before `serveOps`.
- R2: `ADMIN_MIN_TOKEN_LENGTH` and the admin schema in `src/admin-tokens.ts` (built from the shared token rules with the higher minimum, so the other checks stay one definition); the `short` check in `adminAccess`; the new kind in `AdminAuthTokenKind` (`src/admin-auth-failures.ts:10`) and in its log lines.
- R3: `src/admin-auth-throttle.ts` owns the policy constants, the client key (`clientKeyOf(req.socket.remoteAddress)` from kit), the order check → `adminAccess` → record, the `429` decision with `Retry-After`, the throttled metric call and the suppressed `admin auth throttled` line. It takes `now`, `warn`, `metrics` and the kit limiter as dependencies. `authorize` (`src/admin-routes.ts:158-168`) maps a throttle result to `RouteError(429, "too many requests", { "retry-after": "<s>" })`; `requireAdmin` (`src/server.ts:432-440`) to `HttpError(429, …)`. `start.ts` creates one instance and passes it to both (like `authFailures`, `src/start.ts:327-348`); `createApiServer` and `createAdminHandler` get a default instance when none is passed, as `adminAuthFailures` does (`src/server.ts:793-794`).
- `src/metrics.ts`: `recordAdminAuthThrottled(route)` and the counter `pulse_api_admin_auth_throttled_total` (help text `Admin requests refused with 429 by the auth throttle, by route pattern.`).
- Docs:
  - `README.md`: the 400 and 429 answers, the admin minimum, the new metric (section "Health and metrics", `README.md:60`).
  - `docs/configuration.md:252-262` (`admin-tokens.json`): `token` rule "32 or more characters, no whitespace, not a placeholder or public example"; the startup error text and exit 2; the note that a completed import ignores the file.
  - `docs/rest-api.md`: overview error list (400 `invalid request target`), admin routes, tokens, audit and manual-incident writes: `429 {"error":"too many requests"}` with `Retry-After`, the policy (10 failures per client per 60 s from the first failure, shared across these routes, valid tokens blocked too, IPv4 / IPv6 `/64` key, forwarding headers ignored), the `401` for a short admin-side secret; `GET /metrics` lists the new counter.
  - `docs/operation.md`: "Upgrades" (`:73`) gets the upgrade note: (1) before upgrading, rotate every admin-side token whose secret is shorter than 32 characters with `POST /admin/tokens/<id>/rotate` on the old version, give clients the new secret within the 10-minute overlap; (2) after the upgrade a short secret answers `401`, also in an overlap; (3) a pending admin tokens file needs 32+ character tokens or the start fails with exit 2; (4) editing an already imported file changes nothing; (5) if no admin-side token works after the upgrade, run the previous image again (no migration in this release), rotate, then upgrade; restoring a backup also works. "Token rotation" (`:147-157`): replace "Imported tokens keep the secret from the old file, with that secret's own strength" with the 32-character rule for admin-side secrets. "Health and metrics" (`:273`): the throttled counter and an alert example `increase(pulse_api_admin_auth_throttled_total[5m]) > 0`; the limits: per process, reset on restart, shared behind NAT or a proxy, the overflow behavior.
  - `docs/troubleshooting.md`: entries for `token must be a string of at least 32 characters` (admin tokens file), for `429 too many requests` on admin routes, and for `400 invalid request target`.

Checks:
- `src/server.target.test.ts` (real server on `127.0.0.1:0`, raw `node:net` socket): `GET //[ HTTP/1.1`, `GET //%zz HTTP/1.1` and `GET //[/healthz HTTP/1.1` answer `400` with body `{"error":"invalid request target"}`, JSON content type, `x-content-type-options: nosniff` and the wire-version header; an injected `logError` fake records no call; `/metrics` then shows `pulse_api_http_requests_total{route="unmatched",code="400"}` and no `code="500"`. A fake service that throws on `listChecks` still gives `500` and one `logError` call. `GET /healthz` still `200`. Red on `main`: the first case gets `500` and a `logError` call.
- `src/admin-tokens.test.ts`: 31 characters refused (message contains `tokens[0]` and `at least 32 characters`, not the token), 32 accepted, placeholder, whitespace, public example, duplicate kept; `src/tokens.test.ts` unchanged and green (16-character probe token accepted). Red on `main`: the 31-character case is accepted.
- `src/start.token-import.test.ts` / `src/start.test.ts`: a pending admin file with a 31-character token makes `startApi` reject with `StartupError` whose message contains `at least 32 characters` and `PULSE_API_ADMIN_TOKENS_FILE=<path>` and not the token; the database then has 0 rows in `api_tokens` and `token_bootstrap` (first start) or only the probe rows (probe import done earlier). A 32-character token starts and authenticates on `GET /admin/config`. A completed import with the file replaced by a short or broken one still starts.
- Upgrade fixture: insert an admin token with a 20-character secret through the token store (`source: "file"`, as the old import did); `GET /admin/config` with it → `401`, `www-authenticate: Bearer`, failure counted with kind `short`; after `rotate`, the 49-character secret → `200`, the old one → `401` also inside the overlap. A 16-character probe token on `POST /manual-incidents` → `403`.
- `src/admin-auth-throttle.test.ts` (fake `now`, fake metrics and `warn`): the boundary, `Retry-After`, success-does-not-reset, mixed kinds, metrics (10 / 3) and log suppression counterexamples.
- `src/server.throttle.test.ts` (real server, `127.0.0.1:0`, injected `now`): the boundary over HTTP; shared budget across `/admin/config`, `/admin/tokens`, `/admin/audit` and `POST /manual-incidents`; reconnects and `X-Forwarded-For`; valid token blocked with no `lastUsedAt` change; a blocked `POST /admin/checks` leaves the revision and audit unchanged; the burst of 50 concurrent requests (10 × `401`, 40 × `429`); public, ops, probe and heartbeat routes and feature-off `404` unaffected; no client address, token or digest in captured log lines or `/metrics`. Independent peers are covered in the unit test with two `remoteAddress` values. Red on `main`: the 11th request gets `401`.
- Tests that need many failures use their own server or limiter instance; no test disables the throttle in production code.
- `bun run check`, `bun run bench:selftest`, `docker compose -f bench/compose.bench.yaml config --quiet`, `docker build --tag pulse-api:local .` then `bash scripts/image-dotenv.sh pulse-api:local`.
- `bun start` exercise (from `AGENTS.md`): copy `checks.example.json` and `tokens.example.json`, replace placeholders, write an admin tokens file with a 31-character token and start with `PULSE_API_ADMIN_TOKENS_FILE` set (expect `pulse-api: … at least 32 characters (PULSE_API_ADMIN_TOKENS_FILE=…)`, exit 2); then with a 64-character token: `printf 'GET //[ HTTP/1.1\r\nHost: x\r\n\r\n' | nc 127.0.0.1 3000` (expect `400`), 11 × `curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer wrong' http://127.0.0.1:3000/admin/config` (expect ten `401`, then `429`), and `curl -s http://127.0.0.1:3000/metrics | grep admin_auth_throttled`.
- Bench: a local `bun bench/run.ts --a <main sha> --b <branch sha>` and one hosted `Bench` dispatch on the branch; no gating failure. A gating failure is a hold with the run link; budgets stay.

Completion evidence (PR body): the three red-then-green test runs (test names and the failing assertions on `main`), `bun run check` and bench selftest output, the `bun start` commands and outputs, the hosted Bench run link and its table, the kit SHA pinned, and the known limits (per-process state, shared budgets behind NAT, overflow).

## Repository: console
Files:
- `src/admin-token.ts`
- `src/admin-token.test.ts`
- `src/settings.test.ts`
- `.github/workflows/ci.yml`
- `docs/configuration.md`

Behavior change: yes. The console refuses admin tokens of 16 to 31 characters at start, and a CI fixture changes.

Tool facts (console clone at `c93f61cee3568e23e35233927f1aa1e3e015312a`):
- Bun 1.4.0: `package.json:9` (`engines`), `package.json:31` (`packageManager`). `check` = `bun run lint && bun run typecheck && bun run test` (`package.json:18`), `test` = `bun test` (`:14`); `bunfig.toml:1-4` 80 % line coverage.
- Biome 2.6.3 (`package.json:21`); `biome.json` extends `@lorenzh/pulse-config/biome.json` at `04108fa…` (`package.json:22`), identical to the config clone.
- CI: `ci.yml:17-18` uses `check.yml@04108fa…` (identical to the clone; lint, typecheck, test, no build); the docker job starts the image with `PULSE_CONSOLE_ADMIN_TOKEN=console-ci-sentinel-token-0123` (`ci.yml:54`, 30 characters, which the new rule refuses).

Behavior: R5. `MIN_TOKEN_LENGTH = 32` at `src/admin-token.ts:5`; both messages (env and file) say `must hold at least 32 characters`. Change the CI sentinel at `ci.yml:54` to `console-ci-sentinel-token-0123456789ab` (38 characters). `src/main.startup.test.ts:57` already uses 33 characters and stays. In `docs/configuration.md:41` the rule row reads "at least 32 characters" with the new messages.

Checks:
- `src/admin-token.test.ts`: a 31-character token (env and file) is refused with `PULSE_CONSOLE_ADMIN_TOKEN must hold at least 32 characters` / `PULSE_CONSOLE_ADMIN_TOKEN_FILE=<path>: must hold at least 32 characters`; a 32-character token (also with surrounding whitespace that is trimmed) is accepted; `exactly-16-chars` is now refused. Red on `main`: the 31-character token is accepted.
- `src/settings.test.ts:119-125`: fixtures and the expected message use 32.
- `bun run check`; the docker job of CI green with the new sentinel.

Completion evidence: `bun run check` output, the red-then-green test, CI link.

## Repository: deploy
Files:
- `e2e/compose-e2e.sh`
- `e2e/compose.e2e.yaml`
- `docs/cli.md`
- `full/README.md`

Behavior change: yes. The e2e test fixture and one assertion change (CI behavior).

Tool facts (deploy clone at `15812a0870d2bc461e38b30d83fcbd1877a5f0c7`):
- Bun 1.4.0 (`package.json:9`, `:28`); `check` = `bun run lint && bun run typecheck && bun run test` (`package.json:18`), `test` = `bun test --coverage cli` (`:13`); Biome 2.6.3 (`:21`), config pin `04108fa…` (`:22`), identical to the clone. Biome does not read `.sh` or `.yaml` (`ignoreUnknown`, pinned `biome.json:9`).
- CI: `ci.yml:16-17` uses `check.yml@04108fa…`; job `lint` (`ci.yml:19-`) runs `shellcheck -x` and `bash -n` on every `*.sh` (`:34-37`) and `jq empty` on JSON; job `full` (`ci.yml:99-118`) starts `full` on the pinned images and runs `bash e2e/compose-e2e.sh` (`:118`). The api pin is `ghcr.io/lorenzh/pulse-api:0.1.0@sha256:71d623fb…` (`common/services.yaml:8`). The script sets `COMPOSE_FILE=full/compose.yaml:e2e/compose.e2e.yaml` (`e2e/compose-e2e.sh:14`) and starts with `docker compose up -d --pull missing` (`:320`).

Behavior: R6.
- `e2e/compose-e2e.sh:227` and `e2e/compose.e2e.yaml:58`: default `e2e-admin-token-sentinel-0123456789abcdef`, the same literal in both.
- `e2e/compose-e2e.sh:472-473`: the probe-token write passes when the status is `401` or `403`; the message becomes `ok: writes without a token answer 401, with a probe token 401 or 403`. Line 471 stays exactly `401`.
- The e2e script makes 2 failed admin authentications (`:471-472`), below the throttle limit of 10, so the throttle does not change any later step. Do not add requests that fail admin auth.
- `docs/cli.md:163`: split the rotation line: probe tokens as today; the admin token is rotated over the api (`POST /admin/tokens/<id>/rotate`, link to the pulse-api operation docs), then the new secret goes into `secrets/admin-token` so the console gets it; writing the file alone does not change the api after the first import. Keep `:161` (`pulse init --force` keeps files of at least 16 characters) and say that the api needs at least 32 characters for an admin token at its first import.
- `full/README.md` "Opting in to admin tokens" (`:72-`): one sentence that each token needs at least 32 characters.
- No image pin, `build:` or `image:` line is committed (`AGENTS.md`, "Rules").

Checks:
- `git ls-files -z '*.sh' | xargs -0 shellcheck -x`, `git ls-files -z '*.sh' | xargs -0 -n 1 bash -n`, `git ls-files -z '*.json' | xargs -0 -n 1 jq empty`, `scripts/check-setup.sh`, `bun run check`.
- `grep -c 'e2e-admin-token-sentinel-0123456789abcdef' e2e/compose-e2e.sh e2e/compose.e2e.yaml` prints `1` for each file, and `grep -rn 'e2e-admin-token-sentinel-0123}' e2e` prints nothing.
- CI `full` job green on the PR (against the pinned api `0.1.0`).
- Candidate run against the changed api (needs the merged api change; the deploy context has the api clone at `.repos/api`): record `API_SHA=$(git -C .repos/api rev-parse HEAD)` and check that it contains the api merge commit of this feature; `docker build --tag pulse-api:candidate .repos/api`; make a scratch worktree of the deploy branch (`git worktree add /tmp/deploy-candidate HEAD`), and only there replace the `image:` value of the `api` service in `common/services.yaml` with `pulse-api:candidate` (never committed); run `bash e2e/compose-e2e.sh` in it. It must end with `==> All checks passed`. Then remove the worktree. If a step fails that this feature does not touch, hold with the log and the step name.

Completion evidence (PR body): the shell and JSON checks, the CI link, and the candidate run: `API_SHA`, `docker image inspect pulse-api:candidate --format '{{.Id}}'`, and the last 20 lines of the run including `==> All checks passed`.
