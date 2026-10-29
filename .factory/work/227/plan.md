# Spec #227: health, metrics, clean shutdown and clean startup errors

## Goal
Give operators runtime visibility (`/healthz`, `/metrics`, structured logs) and make every service start and stop cleanly with predictable errors.

## Scope
Targets `probe`, `status`, `notify`, `api`. `contract` and `config` need no change: the `config` repo holds shared tooling only and does not lint `checks.json` or the notify config; helpers are small per-repo copies (no shared package, no cross-repo ordering). Prometheus text is hand-written; no new runtime dependency.

## Non-goals
No Grafana dashboards or alert rules in repos (a docs example is fine). No change to public status page content. No metric persistence (counters reset on restart).

## Decisions (shared interface, every repo implements its side)
1. **Health endpoint**: `GET /healthz` returns `200 ok` when ready, else `503` with a short reason (`text/plain`). No DB queries beyond in-memory flags (api: a flag set after the DB is open and checks are loaded; `SELECT 1` at most). Unauthenticated.
2. **Probe and notify listener**: opt-in HTTP listener serving `/healthz` and `/metrics`. `PULSE_HEALTH_PORT` (unset = no listener), `PULSE_HEALTH_HOST` (default `127.0.0.1`). The Dockerfile sets `PULSE_HEALTH_PORT=9100` and `PULSE_HEALTH_HOST=0.0.0.0` and a `HEALTHCHECK` that fetches `http://127.0.0.1:9100/healthz` with `node -e`. Compose does not publish the port.
3. **Readiness**: api = DB open and checks loaded. status = polled the API successfully within the last `max(3 x poll interval, 30 s)`. probe = fetched checks at least once and not shutting down (a failed post does not make it unhealthy; it is visible in metrics). notify = poll loop alive and not shutting down. While shutting down every service returns 503.
4. **Metric naming**: prefix `pulse_`; labels `check` (check id only), `location`, `channel` (channel id), `state`. Never a token, URL, host with credentials, or keyword. Latency is a histogram with buckets 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10 s.
5. **Log format**: JSON lines on stdout/stderr as in notify: `{"time":<ISO 8601>,"level":"debug|info|warn|error","msg":...,<fields>}`. `PULSE_LOG_LEVEL` (default `info`; invalid value = startup error). The probe logs each check result at `debug`.
6. **Exit codes**: `0` clean stop, `2` configuration/startup error (one line `pulse-<service>: <message>` naming the env var, or file path and key; no stack), `1` unexpected runtime failure. Notify already uses 2; api, probe, status move from 1 to 2 and document it.
7. **Shutdown**: handlers for SIGINT and SIGTERM are registered at the top of the entry point before config loading or network retries. On signal: stop accepting work, abort or finish in-flight work, bounded by 5 s (`SHUTDOWN_TIMEOUT_MS` as in notify), then exit 0 (also when the bound is hit, with a `warn` log). Second signal: no extra behavior.
8. **Strict keys**: unknown keys in `checks.json` (top level, per check including `maintenance` windows) and in the notify config (top level, channel, per-type keys) are rejected at startup: `<path>: unknown key "keywrod" in checks[2]`. Existing example files and docs must still load.

## Risks
- Strict keys break configs with extra keys; document in the release notes/docs. Mitigation: error names key and path.
- Exit code change 1 -> 2 for api/probe/status; documented.
- Compose-e2e builds probe/status/notify from `main`, so api's compose changes must come after those PRs are merged (hence `dependsOn`).

## Acceptance evidence
1. After `docker compose up` (compose-e2e) all services are healthy via `/healthz` (api healthcheck no longer calls `/checks`); `compose-e2e` asserts it.
2. `/metrics` on api, probe and notify (listener enabled) and status returns the series below; no token, credentialed URL or keyword appears (tests with URL userinfo, keyword, token).
3. `docker stop` on each service returns within the bound with exit 0, probe even while retrying `fetchChecks`; api closes the DB.
4. Bad checks file, `PULSE_RETENTION_DAYS=abc`, over-long `PULSE_LOCATION`, bad tokens file, bad notify config each exit with code 2 and one line, no stack.
5. `"keywrod"` in checks.json and `"check"` in notify config exit 2 naming the key.
6. Log lines carry ISO time and level; probe logs each result at debug.
7. Every change has a test that fails on old code; each repo's docs cover health, metrics series, shutdown, startup errors/exit codes, log format.

## Repository: probe
Files: `src/main.ts`, new `src/log.ts`, `src/metrics.ts`, `src/health.ts` (+ tests), `Dockerfile`, `docs/*`, `README.md`.
- Register SIGINT/SIGTERM first; during `fetchChecks` retries, abort the wait (AbortSignal on sleep/fetch) and exit 0. After startup, stop reloader and scheduler, abort in-flight checks and posts, wait up to the bound, exit 0.
- Wrap env parsing (`PULSE_LOCATION`, token, reload ms, log level, health port) so every error is one line with exit 2.
- JSON logger replacing `[probe]` console lines; per-check result at debug (check id, status, latency, location; no URL).
- Health listener per decision 2. Metrics: `pulse_up` (gauge 1), `pulse_probe_checks_configured`, `pulse_probe_check_status{check,state}` (1 for current state), `pulse_probe_check_duration_seconds{check}` histogram, `pulse_probe_results_posted_total{check,outcome}` (`ok|rejected|unknown-check|error`).
- Dockerfile HEALTHCHECK. Tests: SIGTERM during startup retries exits 0 quickly; each bad env var gives one line, code 2; metrics contain no token/URL; logs have time and level.

## Repository: status
Files: `src/main.ts`, `src/start.ts`, `src/server.ts`, `src/poller.ts`, new `src/log.ts`, `src/metrics.ts`, tests, `Dockerfile`, `docs/*`, `README.md`.
- `GET /healthz` and `GET /metrics` on the existing server, bypassing the render cache and API; not part of the public page content. Metrics: `pulse_up`, `pulse_status_polls_total{outcome}`, `pulse_status_last_poll_success_timestamp_seconds`, `pulse_status_http_requests_total{code}`. Hidden keywords/URLs never appear.
- Signal handlers first; `server.close()` plus closing idle connections, stop poller, bound 5 s, exit 0.
- Startup errors exit 2 with one line; JSON log format and `PULSE_LOG_LEVEL`.
- Update Dockerfile HEALTHCHECK (currently exists; confirm and point at `/healthz`). Tests per acceptance items.

## Repository: notify
Files: `src/index.ts`, `src/config.ts`, `src/log.ts`, `src/notifier.ts`, `src/delivery.ts`, new `src/health.ts`, `src/metrics.ts`, tests in `test/`, `Dockerfile`, `docs/*`, `README.md`.
- Shutdown from #165 stays; verify handlers are registered before `loadSettings`/config/ledger work (move them up if not) and keep exit 0 and the bound.
- Strict keys in `config.ts` (top level, channel, per-type), error names the path and key; `"check"` instead of `"checks"` rejected. `ConfigError` stays exit 2; make every settings error (env vars) go through it with one line.
- Health listener per decision 2; `PULSE_LOG_LEVEL`. Metrics: `pulse_up`, `pulse_notify_polls_total{outcome}`, `pulse_notify_deliveries_total{channel,outcome}` (`success|failure`), `pulse_notify_pending_deliveries`. Channel id only, never webhook URLs or secrets.
- Dockerfile HEALTHCHECK. Tests: unknown keys, signal-before-startup ordering, metrics content, no secrets.

## Repository: api
Depends on probe, status, notify (compose-e2e builds their `main`).
Files: `src/main.ts`, `src/config.ts`, `src/retention.ts`, `src/server.ts`, `src/service.ts`, new `src/log.ts`, `src/metrics.ts`, tests, `Dockerfile`, `compose.yaml`, compose-e2e script under `scripts/`, `docs/*`, `README.md`.
- Move startup into a `start` function with a top-level try/catch: `parseRetentionDays`, `loadConfig`, tokens, port, log level errors become one line `pulse-api: ...` with exit 2 (tokens error moves from 1 to 2).
- Unknown keys rejected in `config.ts` for checks.json (top level, check, maintenance); keep `checks.example.json` and `compose/*.json` valid.
- `GET /healthz` (no auth, no heavy queries) and `GET /metrics` (no auth; check id only, no URL/keyword). Metrics: `pulse_up`, `pulse_api_check_state{check,state}`, `pulse_api_results_ingested_total{location}`, `pulse_api_result_latency_seconds{check}` histogram (reported latency), `pulse_api_incidents_opened_total`, `pulse_api_incidents_resolved_total`, `pulse_api_http_requests_total{route,code}` (route pattern, not raw path). Update docs (`docs/operation.md`, `rest-api.md`) that `/metrics` exposes check ids and should not be published publicly.
- SIGINT/SIGTERM registered first: mark unready, `server.close()` + close idle connections, stop retention timer, close DB, bound 5 s, exit 0.
- Dockerfile HEALTHCHECK uses `/healthz`; `compose.yaml` healthchecks keep inheriting it, and compose-e2e asserts every service reports healthy, `/healthz` and `/metrics` respond, and `docker stop` exits 0.
- JSON logs replace `console.log`.
- Tests that fail on old code: each startup error, unknown key, healthz not hitting `/checks`, metrics series, shutdown closes DB, no keywords/URLs in metrics.
