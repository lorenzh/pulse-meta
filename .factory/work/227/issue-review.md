# Issue review #227: health, metrics, clean shutdown, clean startup errors

Verdict: specifiable. No blocking question; open points and assumptions below.

## Verified against the code (main of each clone)
- No `/healthz` or `/metrics` anywhere. api `Dockerfile` HEALTHCHECK fetches `/checks`. Compose healthchecks in api `compose.yaml` (services at ~l.41 and ~l.147) only set `interval`, so they inherit the Dockerfile check. probe/status/notify Dockerfiles: no HEALTHCHECK found (status to be confirmed by the plan).
- api `main.ts`: no SIGTERM/SIGINT handler; DB never closed explicitly. `parseRetentionDays` and `loadConfig(checksFile)` are called at top level without try/catch (stack trace). Only `TokensError` is caught (exit 1). `PULSE_LOCATION` is validated in probe (`location.ts`).
- probe `main.ts`: signal handlers registered at the end, after `fetchChecks` (retries until the API is up), so SIGTERM during startup is not handled. Logging is `console.error("[probe] ...")`, no timestamp or level; no per-check result log.
- notify: shutdown already exists (`index.ts`, SIGINT/SIGTERM via `once`, bounded wait, exit code 2 on config error). Its logger (`log.ts`) already writes JSON lines with ISO `time` and `level`. So #165 is done; this feature only needs to verify it registers handlers before startup work, add health/metrics, and strict keys.
- status: `main.ts` has a one-line error + exit 1 on startup; no signal handling found, no `/healthz`.
- Unknown keys: not rejected in api `config.ts` or notify `config.ts` (no key allow-list).
- Only runtime dependency in all targets is `@lorenzh/pulse-contract`; Prometheus text format can be hand-written.

## Targets and dependencies
Likely `api`, `probe`, `status`, `notify` (and `contract` only if shared types, e.g. a metrics helper or check-file schema, need to live there; the plan should prefer a small per-repo helper to avoid cross-repo ordering). Proposed order: api first (owns `compose.yaml`, healthcheck, checks.json strictness), then the others do not depend on it unless the plan adds a shared piece. `compose-e2e` lives in api, so healthchecks for probe/status/notify in Compose are an api-side change that must follow those targets' images (see open point 1).

## Open points (decide in the plan, not blocking)
1. Compose healthchecks for services in other repos: the api `compose.yaml` consumes images of probe/status/notify. If the healthcheck is defined in the Dockerfile of each repo, api's compose only needs to stay green; if in compose, it depends on the other targets' health endpoint/command being published. The plan must set `dependsOn` accordingly and say which image tag compose-e2e uses (main vs. PR build).
2. Probe/notify health: recommended assumption: a file- or command-based check (a heartbeat file touched on each loop/successful API contact, checked by `node -e` in HEALTHCHECK) avoids opening a port; alternative is an opt-in listener `PULSE_HEALTH_PORT`. `/metrics` on probe and notify requires an HTTP listener anyway, so a single opt-in listener (off by default, port env var, bind address documented) serving `/healthz` and `/metrics` is the simpler consistent choice. Plan must pick one.
3. Meaning of "ready": api = DB open and checks loaded; status = has polled the API successfully at least once (or stale threshold?); probe = has fetched checks and last post not failing for N intervals?; notify = poll loop alive. Define, and whether unhealthy returns 503.
4. Auth/exposure of `/metrics` and `/healthz` on api: api requires probe tokens on write routes; `/healthz` and `/metrics` should be unauthenticated but `/metrics` may leak check ids/names. Decide: label by check id only, never URL/keyword; optionally gate behind a token or separate port. The issue says metrics must hide keywords when the status page hides them; the api has no such flag today, so the rule is simplest as "never emit keywords or URLs".
5. Metric cardinality and naming: prefix (`pulse_`), label names (`check`, `location`, `channel`), histogram buckets for latency, how "check state per check" is encoded (gauge per state or numeric). Status metrics "if cheap": assume yes for `up`, polls and poll failures only.
6. Shutdown time bounds: one documented default (e.g. 10 s, below Docker's stop grace) and whether configurable. Probe: abort in-flight checks via AbortSignal and skip the final post, or finish the post. Api: `server.close()`, close idle connections, close DB. Exit 0 when the bound is hit? The issue says exit 0; a forced stop after a timeout should probably still be 0 and log a warning (assumption).
7. Startup exit code: one documented code across services. Today api uses 1 for tokens, notify 2 for config, probe 1, status 1. Assumption: unify on 2 for config errors (usage convention) and 1 for runtime failures, or keep 1; changing notify's 2 is a behavior change, so the plan must choose and document.
8. Strict unknown-key rejection: applies to top-level and per-check keys in `checks.json` (including maintenance windows) and to notify config top-level, channel and per-type keys. Risk: breaking existing configs that carry extra keys (e.g. `$schema`, comments), and `pulse-config`'s hook/lint and example files (`checks.example.json`, docs) must stay valid. Check the `config` repo (it lints these files) for a schema that must accept the same keys; may need a mirrored change there, which is not in the issue's repo list.
9. Log format: notify is already JSON; api uses plain `console.log`, probe plain text. Choose one format for all (JSON lines vs `ts level msg key=val`), and a log level env var (e.g. `PULSE_LOG_LEVEL`) so probe per-check results can be at debug and off by default. Assumption: JSON lines like notify, default level info, per-check result at debug.
10. "Tokens never in metrics/logs" needs a test: URLs with userinfo, keyword, token string.
11. Probe/api `/healthz` must not touch DB heavy queries: for api use at most a trivial `SELECT 1` or an in-memory flag.
12. Docs: each repo's `docs/` and README need health, metrics series list, shutdown, startup errors/exit code, log format; a Grafana/alert example is allowed in docs only.

## Assumptions made
- Hand-written Prometheus text exposition, no new dependency.
- Probe and notify get an opt-in health/metrics listener; `/healthz` returns 200 `ok` or 503 with a short reason.
- Handlers are registered at the top of each entry point, before config loading or network retries.
- Counters are per process (reset on restart); no persistence.
- The "wave 5 / #166" tracking issue and #165 are already merged; no rework of notify's shutdown beyond ordering checks.

## Derived acceptance check
With `docker compose up` (compose-e2e): all services become healthy via `/healthz` (or the file/command check) and api's healthcheck no longer calls `/checks`. Then:
1. `curl :3000/healthz` returns 200 quickly; `curl :3000/metrics` returns Prometheus text including `up`, per-check state, latency, results ingested, incidents opened/resolved; same for probe and notify (delivery success/failure per channel) when their listener is enabled; no token, credentialed URL or keyword appears.
2. `docker stop` on each service returns within the documented bound (well under 10 s) with exit code 0, including probe while still retrying `fetchChecks`; api closes the DB.
3. A bad `checks.json`, `PULSE_RETENTION_DAYS=abc`, an over-long `PULSE_LOCATION`, a bad tokens file and a bad notify config each exit with the documented code and a single line naming the file path/key or variable, with no stack trace.
4. `"keywrod"` in `checks.json` and `"check"` in the notify config exit at startup naming the key.
5. Log lines from every service carry an ISO timestamp and level; the probe logs each check result at the documented level.
6. Each behavior change has a test that fails on the old code; each repo's docs cover the five topics.
