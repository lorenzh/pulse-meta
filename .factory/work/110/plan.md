# Spec: Demo profile showing every status page state (#110)

## Goal
One local command starts a self-contained demo of pulse whose status page shows, within five minutes: up, degraded, down with an open incident, a resolved incident, maintenance, an upcoming maintenance window, a TLS check and two probe locations.

## Scope
Only `api` changes: it holds the only Compose file (`compose.yaml`), the `compose/` directory and the README. `contract`, `probe`, `status`, `notify` need no change; their existing images are reused. No new product code or service image.

## Non-goals
Public hosting; a demo notify service; changes to API, probe or status behavior; running the five-minute demo in CI.

## Required behavior
- Compose profile `demo` in `compose.yaml`. Every demo service has `profiles: [demo]` and the `demo-` prefix, with its own volumes and host ports so it never clashes with the regular stack: `demo-status` on `${PULSE_DEMO_STATUS_PORT:-8081}`, `demo-api` on `127.0.0.1:${PULSE_DEMO_API_PORT:-3001}`.
- Services:
  - `demo-init`: one-shot (`node:24-alpine`, inline script from a Compose `configs:` entry or a file under `compose/demo/`). Writes `checks.json` into a shared volume with maintenance windows relative to the start time, then exits. `demo-api` depends on it with `service_completed_successfully`.
  - `demo-api`: image `pulse-api:local` (same build), own data volume, checks file from the shared volume, tokens from a demo `configs:` entry with two public demo tokens for locations `eu` and `us` (documented as public example values, never for real use).
  - `demo-status`: image `pulse-status:local`, default losoft theme, healthcheck as the regular `status`.
  - `demo-probe-a` (`PULSE_LOCATION=eu`) and `demo-probe-b` (`us`): image `pulse-probe:local`, same targets. They depend on `demo-api` healthy (and the init done), because probes read checks once at startup.
  - `demo-targets`: `node:24-alpine` with the inline script mounted from `compose/demo/`; no build, not in any product image. Serves HTTP by path, driven by its own start time: `/up` always 200; `/slow` answers 200 after a delay above the check's `latencyObjectiveMs` and below `timeoutMs`; `/flaky` returns 500 from about t+30 s to about t+150 s, otherwise 200; `/maintenance` always fails (500).
  - `demo-tls`: serves HTTPS with a self-signed leaf certificate generated at start with `openssl` (valid 5 days) and no package install at runtime if avoidable (if the node image lacks `openssl`, use a small image that has both; pin it).
- Demo checks (intervals 5–10 s so every state shows quickly; the implementer checks the evaluation rule in the API README, window `2 * intervalMs`, three consecutive down evaluations with at least two locations down, resolve on the first up/degraded):
  - `Always healthy` → `/up`: up.
  - `Slow endpoint` → `/slow` with `latencyObjectiveMs` below the delay: degraded.
  - `Flaky service` → `/flaky`, `retries` 0: both locations down from about t+30 s, incident opens after three evaluations, recovers about t+150 s, incident resolved and listed under resolved incidents. Whole cycle ends well before minute 5.
  - `Database upgrade` → `/maintenance`: maintenance window from `now - 1 min` to `now + 15 min` with a note, so it is current for the whole demo and the failing target never opens an incident.
  - `Scheduled upgrade` → `/up`: window from `now + 30 min` to `now + 90 min`, upcoming for the whole demo.
  - `TLS certificate` → type `tls`, host `demo-tls`, `warnDays` 3, short interval: up with "5 days left". (The API README says the check is down when `warnDays` or fewer days are left; use a value that keeps this check up so no extra incident appears. The implementer confirms in the code and README which word the status page shows.)
- The regular stack stays as is: `docker compose config` without the profile is unchanged except as required below, and the regular stack still works with `.env`.
- Clean machine without `.env`: Compose interpolates the whole file, so the `${PULSE_PROBE_TOKEN:?...}` guards in the regular `probe` service and the `tokens` config would abort the demo. Replace them so the demo parses without `.env` (`:-` with empty default) and keep a clear failure for the regular stack (for example a clear error from the API on an empty token, verified by the implementer; otherwise a README note). The regular services have no profile, so plain `docker compose --profile demo up` also starts them. Document and use as the demo command `docker compose --profile demo up demo-status` (the dependencies start via `depends_on`, the regular services do not). Make sure the plain `docker compose --profile demo up` does not fail the demo services either; say in the README what it additionally starts.
- Themes: the demo uses the default losoft theme. Add an example `compose/demo/theme-white-label.json` in the theme file format of the pulse-status README (read it in `.repos/status`), not mounted by default. The README shows how to apply it (mount it into `demo-status` and set `PULSE_STATUS_THEME`), for example through a documented override line or an env-selected path.
- README: a "Demo" section: requirements (Docker Compose >= 2.23, access to GitHub for the probe/status builds), the command, ports, a table of each check with its expected state and the time it appears, how to refresh the maintenance windows (`docker compose --profile demo down -v` then up, windows are computed at start and read only at API startup), the white-label theme, `docker compose --profile demo down -v` to clean up, and that the tokens are public examples.

## Risks
- Time-relative windows depend on `demo-init` running at each start; stale volumes keep old windows, hence `down -v` in the docs.
- Changing the `:?` guards can weaken the regular setup's error message; verify.
- Probe/status builds come from `main` of their repositories and need network access.

## Acceptance evidence
- `docker compose --profile demo config` and plain `docker compose config` (with a `.env`) are valid.
- A manual run on a machine without `.env`: `docker compose --profile demo up demo-status`, then within five minutes the status page on the demo port shows all states listed in Goal (record the observations or screenshots in the PR). The regular stack still starts with `.env`.
- Any deterministic helper (the schedule or window function in `demo-init`) has `node:test` tests if it lives under `src/`; otherwise it stays inside `compose/demo/` and is exercised by the manual run. `npm run check` passes.

## Repository: api
Files: `compose.yaml` (profile `demo` services, configs, volumes, relaxed token guards), `compose/demo/` (init script, targets script, TLS setup, `theme-white-label.json`), `README.md` (Demo section). Behavior and checks as above. Do not add `.factory/` or note files; do not touch `src/` unless a tested helper is needed. Completion: `npm run check` passes, both `config` commands are valid, and the PR records the manual run showing every state.
