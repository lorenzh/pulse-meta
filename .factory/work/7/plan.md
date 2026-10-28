# Spec #7: TLS certificate expiry check

## Goal
pulse warns before the TLS certificate of a watched HTTPS endpoint expires. A new check type `tls` is probed, stored, evaluated and shown on the status page with the days left.

## Scope
- New check type `tls` (host, port default 443, `warnDays` default 14).
- Probe reads the leaf certificate and reports days until expiry.
- API accepts and stores it; status page shows it.

## Non-goals
Chain or hostname verification reporting, multi-certificate chains, STARTTLS, alerting, config reload, a default `intervalMs` (stays required).

## Decisions (defaults from the issue review)
1. **Contract shape**: `Check = HttpCheck | TlsCheck`. `HttpCheck` is today's shape plus optional `type?: "http"` (absent means http). `TlsCheck` is `{id, name, type: "tls", host, port, warnDays, intervalMs, timeoutMs?}`. `port` and `warnDays` are always set in the served data; the api config parser applies the defaults. No fake `url` for TLS.
2. **Days left**: new optional `certDaysLeft?: number | null` on `Result` and on `CheckWithState`. It is the floored whole days `floor((validTo - now) / 86400000)`, negative when expired, null when no certificate was read. Backwards compatible: absent or null for HTTP.
3. **Evaluation**: `daysLeft <= warnDays` is down with reason `certificate expires in N days` (literal "N days" for every N). `validTo <= now` is down with reason `certificate expired`. A handshake or connect error is down with the same `errorReason` style as HTTP (error code, or `timeout after Nms`). Otherwise up with `reason` null. `statusCode` is null for TLS results.
4. **No chain verification**: `tls.connect` with `rejectUnauthorized: false`, `servername = host`; only the leaf's `valid_to` is judged. Document this. `timeoutMs` (default 5000) bounds connect plus handshake. The clock is injectable (`deps.now`).
5. **Incident rule**: unchanged. `applyResult` works on `status` only (3 consecutive downs open an incident, an up resolves it). Quorum and maintenance apply as for HTTP; verify they use no HTTP-only fields.
6. **Status page**: a TLS check shows `host:port` instead of the url, and a `.cert-days` span with the days left (`certificate expires in 5 days` via `lastReason` when down, otherwise `N days`). HTTP output stays byte-identical.
7. **Tests**: a local `tls.createServer` with certificates generated in test setup by the `openssl` CLI (`openssl req -x509 -newkey ec ... -days N`), written to a temp dir; the injectable clock covers boundaries. No test reaches the internet. Each repository's own helper; do not add runtime dependencies.

## Required behavior
- A cert expiring in 5 days with default `warnDays` 14 is down, `certificate expires in 5 days`, `certDaysLeft` 5. A cert with 90 days is up, `certDaysLeft` about 90.
- Exactly `warnDays` left is down; `warnDays + 1` is up.
- Expired cert is down `certificate expired`; a closed port is down with a connection error reason.
- 3 consecutive downs open an incident; an up resolves it.
- Existing HTTP config, data and tests are unchanged and pass.

## Risks
- Probe pins an older contract SHA than api/status; bump all three to the new contract commit.
- New SQLite column requires a migration for existing databases.
- The probe's `fetchChecks` whitelists fields and would drop the new ones.
- Threshold warning shows `down` on the first result, the incident follows after 3 results.

## Acceptance evidence
With a local TLS server whose certificate expires in 5 days and one with 90 days, `GET /checks` and the status page show the first down with `certificate expires in 5 days` and 5 days, the second up with about 90 days. `npm run check` passes in contract, probe, api and status.

## Repository: contract
Files: `src/` types, `test/`, `dist/` (rebuilt and committed), README.
- Add `HttpCheck`, `TlsCheck`, the `Check` union, `certDaysLeft?: number | null` on `Result` and `CheckWithState` (`CheckWithState` must be an intersection or distributed type over the union).
- Type tests (existing style) for both variants and an HTTP check without `type`.
- Done when: `npm run check` passes, `dist/` is up to date and the existing consumers' HTTP shapes still compile. Its merge commit SHA is what the other repos pin.

## Repository: probe
Files: `src/check.ts`, `src/client.ts`, `src/main.ts`, tests, `package.json` pin, README.
- Bump the contract pin. `runCheck` branches on `check.type`; HTTP path unchanged.
- TLS path per decisions 2–4, with a `tlsConnect` member added to `CheckDeps` for tests, returning `certDaysLeft` in the `Result`.
- `fetchChecks` passes through `type`, `host`, `port`, `warnDays` for TLS checks and keeps HTTP rebuilding as is; validate the shape.
- Tests with a local TLS server and openssl certificates: up, within threshold, boundary, expired, refused, timeout, SNI.
- Done when: `npm run check` passes and the HTTP tests are unchanged.

## Repository: api
Files: `src/config.ts`, `src/db.ts`, `src/service.ts`, `src/server.ts` (if it validates results), tests, `checks.example.json`, README, `package.json` pin.
- `parseChecks` branches on `type`: absent or `http` as today; `tls` requires a non-empty `host` without scheme or path, `port` integer 1–65535 (default 443), `warnDays` positive integer (default 14), `intervalMs` required, `timeoutMs` optional; no `url` needed. Unknown `type` throws `ConfigError`.
- Store checks and results of type tls: add a nullable `cert_days_left` column to `results` (new schema plus `ALTER TABLE ... ADD COLUMN` migration for existing DBs; old rows read as null); accept `certDaysLeft` in `POST /results`; persist the check's type fields as needed so `GET /checks` returns the full `TlsCheck`.
- `GET /checks` sets `certDaysLeft` from the latest result; `GET /checks/:id/results` includes it.
- `state.ts` unchanged; add a test that TLS results open and resolve incidents and work with quorum and maintenance.
- Bump the contract pin. Done when `npm run check` passes with the HTTP tests unchanged and a migration test on an old DB.

## Repository: status
Files: `src/render.ts`, `public/` CSS if needed, tests, README, `package.json` pin.
- `renderChecks` renders TLS checks per decision 6, with `escapeHtml`; HTTP output byte-identical.
- Tests in `render.test.ts` for tls up, down within threshold, expired, and HTTP unchanged; a server test where the poller serves a TLS check through the proxy.
- Bump the contract pin. Done when `npm run check` passes.
