# Issue review: #233 startup errors (invalid URL, occupied ports)

Verdict: specifiable, no blocking question. Targets: `status`, `notify`, `probe`. No `dependsOn` is needed; the three fixes are independent. `contract`, `api`, `config` are untouched.

## Verified against clones
- status `src/main.ts`: `new URL(apiUrl)` sits inside the `server.listen` callback (~46), outside the startup catch (~48). The listen error handler (~41) logs JSON.
- notify `src/index.ts`: the health `error` handler (~113) logs JSON `health listener failed` and calls `exit(2)`. The reporter says the notifier is already started by then.
- probe `src/main.ts` (~90): the bind error becomes a `SettingsError` `cannot listen on host:port: ...`. The message names neither `PULSE_HEALTH_PORT` nor `PULSE_HEALTH_HOST`.
- Decisions 6 and 7 of `.factory/work/227/plan.md` are the reference: one line `pulse-<service>: <message>`, exit 2, shutdown bound 5 s with exit 0 and a `warn`.

## Open points (non-blocking)
1. status ordering: "no service work starts before all listeners are bound" means the URL must be validated and the poller must not start before `listen` succeeds. Spec: parse `PULSE_API_URL` during config parsing, before listening, in the startup catch.
2. status listen failure: the message should name `PORT` for any listen error, not only `EADDRINUSE` (for example `EACCES`). After the server is listening, a later server error stays a runtime error (exit 1).
3. notify: the health bind must happen before the notifier or poll loop starts. A signal arriving during the bind must still exit 0 (decision 7). Spec: check that the `shutdown` path closes a half-bound listener.
4. Message naming: the bind error names both `PULSE_HEALTH_PORT` and `PULSE_HEALTH_HOST` in notify and probe, for example `cannot listen on <host>:<port> (PULSE_HEALTH_HOST/PULSE_HEALTH_PORT): <reason>`. The exact wording is left to the plan; it must be one line with no stack.
5. Invalid-URL message: it must not echo credentials that the URL may contain. Name `PULSE_API_URL` only, and do not print the raw value.
6. notify shutdown warn: the log is a JSON `warn` line through the existing logger. Testing needs an injectable or short timeout, or a stuck stop; the plan decides how. The exit code stays 0.
7. status bypass test: assert `/healthz` is 200 with the expected body, and `/metrics` is 200 with `pulse_up` in the body and the Prometheus content type. This is the test fix only; there is no behavior change.
8. "Process-level regression test" means spawning the real entry point (`node src/main.ts`, or `index.ts` for notify), asserting exit code, stderr (exactly one line, no stack) and no stdout JSON. For the occupied-port cases the test occupies a port first. It must fail on the current code. Item 6 of the issue is a test-only fix whose test must fail against a 404 response.
9. Docs: each target's startup-error docs list the new messages (decision 6 required docs). Minor.

## Assumptions
- Probe's health bind already happens before `fetchChecks` and before scheduling, so only the message changes.
- stdout stays free of JSON on startup failure; the line goes to stderr like the existing startup errors.
- No new env vars or config changes.

## Derived acceptance check
- `PORT=0 PULSE_API_URL=not-a-url node src/main.ts` in status: exit 2, stderr is exactly one line `pulse-status: ... PULSE_API_URL ...`, no stack.
- status with `PORT` already occupied: exit 2, one line `pulse-status: ... PORT ...`.
- notify with `PULSE_HEALTH_PORT` occupied: exit 2, one plain line `pulse-notify: ... PULSE_HEALTH_PORT/PULSE_HEALTH_HOST ...`, and no `pulse-notify started` log and no poll.
- probe with an occupied health port: exit 2, one line naming `PULSE_HEALTH_PORT`/`PULSE_HEALTH_HOST`.
- notify with a stuck shutdown: a `warn` log is written at the 5 s bound and the exit code is 0.
- status health/metrics test fails if either route returns 404.
- Each new test fails on the pre-fix code.
