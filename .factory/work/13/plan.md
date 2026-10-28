# Spec: Retries for failed probe attempts (#13)

## Goal
A single lost packet must not turn an HTTP check down. A check can ask the probe to repeat a failed attempt before it reports down, and the result says how many attempts it took.

## Scope
- Contract: new optional check fields `retries`, `retryDelayMs`; new `Result.attempts`.
- API: parse/validate/store/serve the check fields; accept/store/serve `attempts`.
- Probe: forward the fields from `GET /checks`; retry loop in `runCheck`; injectable sleep.

## Non-goals
- TLS checks (the probe has no TLS path). No retry fields on `TlsCheck`.
- Status page changes (none required). No change to API state/incident computation.

## Decisions (fixed here)
- Check fields on `HttpCheck`: `retries?: number` (integer 0..10, absent = 0) and `retryDelayMs?: number` (integer 0..60000, absent = 1000 when retries > 0; the API serves resolved values `retries` and `retryDelayMs` always set for HTTP checks).
- `Result.attempts: number` (integer >= 1). Required in the type; API treats a missing value on `POST /results` as 1; old DB rows read as 1.
- A retry follows any failed attempt (non-2xx, timeout, network error). Success on any attempt stops the loop and reports `up`.
- Result is that of the last attempt: `status`, `statusCode`, `reason` (no "after N attempts" suffix), `latencyMs` (last attempt only). `timestamp` = start of the first attempt. `attempts` = attempts made (1..retries+1).
- Waits use an injected `sleep(ms)` in `CheckDeps`; no wait before the first or after the last attempt. Time otherwise comes from the injected `now`.
- Overlap rule: the scheduler already awaits the whole `run` before arming the next timer, so retries never overlap the next run. Additionally (a) API config rejects a check whose worst case `(retries+1)*timeoutMs + retries*retryDelayMs` (timeoutMs default 5000) exceeds `intervalMs` with a `ConfigError`; (b) the probe stops retrying when `now() + retryDelayMs >= start + intervalMs` (deadline guard) and reports the last failure.

## Risks
- Contract is pinned by commit in api/probe/status; dependents must bump to the new contract commit after it merges, and `dist/` must be rebuilt and committed.
- Existing DBs need migration (ALTER TABLE) and the check upsert must update the new columns.
- `fetchChecks` currently drops unknown fields; must forward the new ones.

## Acceptance evidence
1. Contract types present, `dist` rebuilt, `npm run check` passes.
2. API: omitted retries = 0; invalid values and overlong worst case throw `ConfigError`; values appear in `GET /checks`; `POST /results` stores/returns `attempts` (missing = 1); old DB migrates.
3. Probe, local test server that fails the first request and answers 200 on the second: with `retries: 1` result is `up`, `statusCode` 200, `reason` null, `attempts` 2, server saw 2 requests; with no retries it is `down`, `attempts` 1, 1 request.
4. Probe, always-failing server with `retries: 1`: `down`, `attempts` 2, last reason; wait equals `retryDelayMs` via the fake sleep; deadline guard test with fake clock.
5. Scheduler test: next run is armed only after the retrying run finished.
6. `fetchChecks` forwards both fields. `npm run check` passes in every repo.

## Repository: contract
Files: `src/` types (add `retries?`, `retryDelayMs?` to `HttpCheck`; `attempts` to `Result` with doc comments describing semantics above), `test/` type/shape tests as the repo does, `README.md` if it documents types, rebuilt and committed `dist/`.
Behavior: types only.
Checks: `npm run check`.
Completion: merged commit SHA to which api and probe pin their dependency.

## Repository: api
Depends on the new contract commit (bump `package.json` and lockfile).
Files: `src/config.ts` (+tests): parse `retries`, `retryDelayMs` for HTTP checks, apply defaults, ConfigError on negative/non-integer/over-limit and on the worst-case-exceeds-interval rule; `src/db.ts`: `migrate()` ALTER adds `retries`, `retry_delay_ms` on `checks` and `attempts INTEGER NOT NULL DEFAULT 1` on `results`; upsert updates the new check columns; `src/service.ts`/`server.ts`: map rows to `Check` with the fields, `validateResult` accepts optional `attempts` (integer >= 1, else 400; missing = 1), stores and returns it in results endpoints; `checks.example.json` and `README.md`.
Behavior: state/incident computation unchanged.
Checks: tests for each point of acceptance 2; `npm run check`.
Completion: PR with passing checks.

## Repository: probe
Depends on the new contract commit (bump `package.json` and lockfile).
Files: `src/check.ts` (+`check.test.ts`): add `sleep: (ms:number)=>Promise<void>` to `CheckDeps`, retry loop per decisions; `src/client.ts` (+test): `fetchChecks` forwards `retries` and `retryDelayMs`; `src/main.ts`: wire a real sleep (setTimeout based) into deps; `src/scheduler.test.ts`: no-overlap test with fake timer/clock; `README.md`.
Behavior: scheduler logic unchanged; if `stop()` occurs mid-run the result is dropped as today.
Checks: tests use local in-test servers and fake sleep/clock only, no real timers; `npm run check`.
Completion: PR with passing checks.
