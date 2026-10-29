# Issue review: heartbeat checks (#238)

Verdict: specifiable. No blocking question; open points are decided below as assumptions.

## Current state (inspected on `main` of the clones)
- contract: `Check = HttpCheck | TlsCheck` (`src/index.ts`); `HttpCheck.type` is optional, `TlsCheck.type` is `"tls"`. `Result` requires `statusCode`, `latencyMs`, `location`, `attempts`. `CheckStateFields` has `lastResultAt`, `locations`.
- api: `src/server.ts` has `/results` (probe bearer token via `tokens.ts`), `/checks`, `/uptime`, `/incidents`, `/maintenance`, `/healthz`, `/metrics`. Incidents are opened in `service.ts` from `applyResult` with quorum over locations and a `late` flag for stale results. The `checks` table has `type/url/host/port/...` columns.
- probe: `client.ts` maps wire checks (http/tls) and `check.ts` dispatches on `type === "tls"`; any other type would be run as HTTP.
- status: `render.ts` assumes non-TLS checks have `url` (`check.url ?? ""`).
- notify: reads incidents and checks via the API; no type dependence seen apart from channel config.

## Open points and decisions (assumptions)
1. Auth scheme. Assume a per-check secret in the checks file (`secret`, required, min length), sent in the ping URL path/query (`/heartbeat/<id>?secret=...` or `/heartbeat/<id>/<secret>`) and also accepted as `Authorization: Bearer`. Needed because `curl` in cron is the target use. Compare in constant time; the secret is a different credential from probe tokens, so a ping secret cannot call `/results` and probe tokens cannot ping. Alternative (secret from an env var reference, to keep it out of the file) is left to the plan; plan must decide and document.
2. Secret exposure: the secret must never be served by `GET /checks` (so not to status or probe), not logged (the request logger must redact path/query for `/heartbeat`), not in metrics labels, not in incident reasons. Docs: send via header, or use the path form with log redaction; note that proxies may still log URLs.
3. Wire shape: `HeartbeatCheck { id, name, type: "heartbeat", period, grace }` in ms (the issue says `period`/`grace`, other types use `intervalMs`; keep the issue names but the plan must confirm it and state bounds, e.g. integer, period >= 1000, grace >= 0, optional grace default). `lastResultAt` carries the "last ping" time.
4. A ping records an `up` result (`statusCode` null, `latencyMs` 0, `location` e.g. `heartbeat`, `attempts` 1). The evaluator writes a `down` result with reason like `no ping within <period+grace>ms`; the plan must choose between writing one down result per missed period or one per outage (assume once per outage, repeat metric per missed period). Quorum is bypassed because there is a single source.
5. Before the first ping: assume the clock starts at check creation/api start (state `unknown` until period+grace elapsed since first seen, then `down`). After api restart, the evaluator must use persisted last ping, and must not open a false incident from downtime of the api itself (grace from start time).
6. Config reload: changing period/grace/secret takes effect without losing last ping; removed or `inactive` checks are not evaluated and a ping to them returns 404 (unknown) or 409/204 (inactive) — plan decides; ping to an unknown id must not reveal existence (same 401/404 for wrong secret).
7. Maintenance: a ping during a window is recorded as for other types; a missed period in a window does not open an incident (match existing maintenance handling).
8. Ping methods: `POST` and `GET`; other methods 405. Responses are small (204 or `ok`), no body echo. Rate limiting is not required; mention body size limit.
9. `/metrics`: counters per check id for pings (`pulse_heartbeat_pings_total`) and missed periods (`..._missed_total`); names to be fixed in plan, in line with existing metric naming.
10. Probe: client mapping must drop heartbeat checks (and not crash on unknown types) with no per-reload log line. Probe is the only consumer that needs a change; the contract validator must accept the type so the probe's wire parse does not fail.
11. Status: render must not assume `url`; show "last ping <time>" (or "no ping yet"); hide-details hides period/grace too if other types hide target; the secret is never in served data anyway.
12. Contract versioning: `version.ts` has a wire-version check; adding a union member is a minor, but older probe/status that don't know `heartbeat` must be considered (deploy order contract -> api -> probe/status). Plan to state the dependency order for `targets.json` (`api` after `contract`; `probe`, `status` after `api`; `notify` verify only; e2e in compose repo/`config` as applicable).
13. `compose-e2e`: heartbeat check with a short period (e.g. 2 s + 1 s grace) goes down without ping, then a `curl` ping resolves it; the repository where compose-e2e lives (api `compose/`) needs the secret in its example checks file, which is a throwaway test value.
14. Existing `Check` consumers using `check.url`/`intervalMs` (uptime, retention, late-result logic, `quorum` window = 2x interval) need an explicit path for heartbeat (use period for the window or skip).

## Non-goals (confirmed from the issue)
No start/finish pings, no duration tracking, no cron expressions.

## Derived acceptance check
Using the compose e2e stack: with a heartbeat check `period=2s, grace=1s` and no pings, within ~5 s `GET /checks` shows state `down` and `/incidents` has one open incident, `/metrics` counts missed periods; `curl -fsS <api>/heartbeat/<id>` with the right secret returns success, the check becomes `up`, the incident resolves, ping counter increases; a wrong or missing secret gives 401/404 and records nothing; the probe's `/results` token cannot ping and the ping secret cannot post `/results`; `GET /checks` never contains the secret; status page shows "last ping <time>" and no secret, with hide-details on too; probe logs no line for heartbeat checks on reload; each new test fails on the old code.
