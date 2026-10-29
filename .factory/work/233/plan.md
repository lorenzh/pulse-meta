# Spec: startup errors for invalid URL and occupied ports (#233)

## Goal
Make every startup failure in status, notify and probe print exactly one line `pulse-<service>: <message>` on stderr naming the setting, exit 2, with no stack and no service work started before all listeners are bound. Follow decisions 6 and 7 of `.factory/work/227/plan.md`.

## Scope
- status: invalid `PULSE_API_URL` and listen errors on `PORT`; strengthen the `/healthz` and `/metrics` bypass test.
- notify: bind the health listener before starting the notifier; `warn` log when the 5 s shutdown bound is hit.
- probe: name `PULSE_HEALTH_PORT`/`PULSE_HEALTH_HOST` in the bind error.

## Non-goals
No new env vars or config changes. No change to `contract`, `api`, `config`. No behavior change for the status routes. Runtime errors after listening stay exit 1.

## Required behavior
- Messages never echo the raw `PULSE_API_URL` value (it may carry credentials); name the variable only.
- Bind errors read like `cannot listen on <host>:<port> (PULSE_HEALTH_HOST/PULSE_HEALTH_PORT): <reason>`; status names `PORT` for any listen error (`EADDRINUSE`, `EACCES`, ...).
- A signal arriving during bind still exits 0 (decision 7).
- stdout stays free of JSON on startup failure.

## Risks
- Reordering startup in notify could leave a half-bound listener on early signal; the shutdown path must close it.
- Regression tests must fail on the current code (spawn the real entry point).

## Acceptance evidence
- status: `PORT=0 PULSE_API_URL=not-a-url node src/main.ts` exits 2, stderr is one line `pulse-status: ... PULSE_API_URL ...`, no stack.
- status with an occupied `PORT`: exit 2, one line `pulse-status: ... PORT ...`.
- notify with an occupied `PULSE_HEALTH_PORT`: exit 2, one plain `pulse-notify: ...` line naming `PULSE_HEALTH_PORT`/`PULSE_HEALTH_HOST`, no `pulse-notify started` log, no polling.
- probe with an occupied health port: exit 2, one line naming both settings.
- notify with a stuck shutdown: a JSON `warn` line at the bound, exit 0.
- status health/metrics test fails when either route returns 404.
- Each new test fails on pre-fix code.

## Repository: status
Files: `src/main.ts` (+ config parsing), `src/server.health.test.ts`, a new process-level test, `docs/*`/`README.md` startup-error list.
- Parse and validate `PULSE_API_URL` (`new URL`) during config parsing before listening, inside the startup catch; error `pulse-status: PULSE_API_URL is not a valid URL` (no value echoed), exit 2.
- Do not start the poller until `listen` succeeded. Handle the server `error` event before listening as a startup error: `pulse-status: cannot listen on <host>:<port> (PORT): <reason>`, exit 2. After listening, later server errors stay runtime errors (exit 1).
- Fix the bypass test: `/healthz` is 200 with the expected body; `/metrics` is 200, body contains `pulse_up`, Prometheus content type.
- Process tests: spawn `node src/main.ts` with invalid URL, and with an occupied `PORT`; assert exit 2, exactly one stderr line, no stack, empty stdout.
- Done when: `npm test` and the repo's lint/typecheck pass; new tests fail on old code.

## Repository: notify
Files: `src/index.ts`, shutdown code, tests, docs.
- Bind the health listener first; only after it is listening start the notifier and poll loop. On bind error print plain `pulse-notify: cannot listen on <host>:<port> (PULSE_HEALTH_HOST/PULSE_HEALTH_PORT): <reason>` to stderr, exit 2, no `pulse-notify started` log. Keep the existing behavior when the listener is disabled.
- Verify that `shutdown` closes a half-bound listener and a signal during bind exits 0.
- When the 5 s shutdown bound is hit, log `warn` through the existing logger, then exit 0. Make the timeout injectable (e.g. env-independent parameter or existing `SHUTDOWN_TIMEOUT_MS` constant passed in) so a test can use a short bound with a stuck stop.
- Process tests: occupied health port (one line, exit 2, no JSON, no started log); stuck shutdown yields a `warn` line and exit 0.
- Done when: `npm test` and lint/typecheck pass; new tests fail on old code.

## Repository: probe
Files: `src/main.ts` (~90), tests, docs.
- Change the health bind `SettingsError` to name `PULSE_HEALTH_HOST/PULSE_HEALTH_PORT` in the same format as notify; remains one line, exit 2. The bind already precedes `fetchChecks` and scheduling; keep that.
- Process test: occupy the health port, spawn the entry point, assert exit 2, one stderr line naming both settings, no stack, no fetch to the API.
- Done when: `npm test` and lint/typecheck pass; the new test fails on old code.
