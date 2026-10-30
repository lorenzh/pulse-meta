# Architecture

pulse has four services and three shared libraries.

| Repository | Role |
| --- | --- |
| pulse-api | Loads the checks file, takes heartbeat pings, stores results in SQLite (`bun:sqlite`), decides the state of each check, serves REST. |
| pulse-probe | Fetches the checks, runs HTTP and TLS checks, posts the results. One probe is one location. |
| pulse-status | Status page. Reads pulse-api through its own allow-listed `/api/*` proxy. Serves an Atom feed and SVG badges. |
| pulse-notify | Polls pulse-api and sends a notification when an incident opens or resolves, and, when a channel sets `remindEverySeconds`, reminders while it stays open. Channels: webhook, file, Slack, Teams and email. |
| pulse-contract | The wire contract: zod schemas, the types and validators built from them, the wire version and the `fetchJson` client. Used by api, probe, status and notify. |
| pulse-kit | Shared runtime helpers: env settings, shutdown, the ops server for `/healthz`, `/readyz` and `/metrics`, metrics and the JSON logger. Used by api, probe, status and notify. |
| pulse-config | Shared Biome, tsconfig, ESLint and Lefthook configuration and the reusable CI workflow `check.yml`. |

The four services and three libraries run on Bun 1.4.0 (`packageManager: bun@1.4.0`, `bun.lock`). Install with `bun install --frozen-lockfile`, test with `bun test` (`bun:test`), and run scripts with `bun run <script>`; the services start with `bun start`. The Docker images build on `oven/bun:1.4.0-alpine`, pinned by digest. pulse-api creates its SQLite schema at start and has no database migrations: a database file of an older version is not upgraded. pulse-website still runs on Node 24 until [#367](https://github.com/lorenzh/pulse-meta/issues/367) moves it to Bun.

## Data flow

```text
checks.json --> pulse-api <--GET /probe/checks--- pulse-probe
                  ^ ^ ^   <--POST /results-------
                  | | |
                  | | +--GET|POST /heartbeat/<id>-- cron job or worker
                  | |
                  | +--GET /incidents, GET /checks--> pulse-notify --> webhook, file, Slack, Teams, email
                  |
                  +--/api/* proxy-- pulse-status --> browser, feed reader, badge
```

1. pulse-api reads `checks.json` and `tokens.json` at start. A check that left the file becomes inactive: it leaves `GET /checks`, its open incident is resolved, and its history stays.
2. Each probe gets its checks from `GET /probe/checks` with its token. That answer holds request headers and bodies. An older API answers 404, and the probe then uses the public `GET /checks`. The probe resolves header values of the form `{"env": "NAME"}` from its own environment, so secrets never reach the API.
3. The probe runs the checks on their interval and sends `POST /results` with its token. It reloads the checks every `PULSE_CHECKS_RELOAD_MS` (default 60 s), and at once when the API answers 404 for a result. It skips heartbeat checks.
4. A cron job or worker pings `/heartbeat/<id>` with the check's secret. The API marks a heartbeat check down when no ping arrives within `period + grace`.
5. pulse-api stores the result and evaluates the check. The rules for quorum and incidents are in the [pulse-api concepts page](https://github.com/lorenzh/pulse-api/blob/main/docs/concepts.md#quorum-and-incidents).
6. pulse-status and pulse-notify read the state and the incidents from pulse-api. pulse-status serves only an allow-listed subset and hides targets and reasons by default.

Every response of pulse-api carries the wire version in the `x-pulse-contract` header. The probe, the status page and the notifier check it.

## Health, readiness and metrics

Every service answers `GET /healthz`, `GET /readyz` and `GET /metrics` through the pulse-kit ops server. pulse-api and pulse-status answer on their main port. pulse-probe and pulse-notify answer on a separate listener (`PULSE_HEALTH_PORT`), which is off by default and on port 9100 in the Docker images. Details per service are in the [meta README](../README.md#health-readiness-and-metrics).

## pulse-contract, pulse-kit and pulse-config

The other repositories depend on them as Git dependencies pinned to a commit SHA (`github:lorenzh/<name>#<sha>`). A wire change goes into pulse-contract, and a shared runtime change into pulse-kit. It reaches a service when its pin is updated. A tooling rule change goes into pulse-config and reaches a repository the same way, including the CI workflow (`uses: lorenzh/pulse-config/.github/workflows/check.yml@<sha>`). The pins can differ between services.
