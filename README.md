# pulse-meta

pulse is an uptime monitor with a status page. Probes check HTTP endpoints and TLS certificates, cron jobs and workers ping heartbeat checks, an API stores the results and decides the state of each check, a status page shows every check with its open incidents, and a notifier reports incidents to webhooks, files, Slack, Teams or email.

This repository is the meta repository of pulse. It holds no product code. Feature requests are issues here, and the specs for them are written here. The code lives in the repositories below.

pulse is built by Paragon Factory agents from the issues in this repository. Developer and agent guidelines for this repository are in [AGENTS.md](AGENTS.md) (Claude Code reads it through [CLAUDE.md](CLAUDE.md)). Each code repository has its own `AGENTS.md`.

## Repositories

| Repository | Role | Depends on |
| --- | --- | --- |
| [pulse-contract](https://github.com/lorenzh/pulse-contract) | The wire contract: zod schemas for `Check`, `Result`, `Incident` and the API shapes, the TypeScript types and validators built from them, the wire version (`x-pulse-contract` header) and `fetchJson`, a JSON GET client with timeout, size cap, version check and validation. Library, no settings. | zod; pulse-config (dev) |
| [pulse-kit](https://github.com/lorenzh/pulse-kit) | Shared runtime helpers of the services: env settings with bounds, signal handling and bounded shutdown, the ops server for `/healthz`, `/readyz` and `/metrics`, a Prometheus registry, the JSON logger, small HTTP and timer helpers. Library, no settings. | pulse-config (dev) |
| [pulse-probe](https://github.com/lorenzh/pulse-probe) | Worker that fetches the checks from the API, runs HTTP and TLS certificate checks and posts the results. It reloads the checks every `PULSE_CHECKS_RELOAD_MS` and when the API answers 404 for a result. | pulse-contract, pulse-kit, pulse-config (dev); talks to pulse-api at run time |
| [pulse-api](https://github.com/lorenzh/pulse-api) | Loads the checks file, takes heartbeat pings, stores results in SQLite (`bun:sqlite`), computes state and incidents, serves REST. Holds the Docker Compose file for the whole stack. | pulse-contract, pulse-kit, pulse-config (dev) |
| [pulse-status](https://github.com/lorenzh/pulse-status) | Status page with an allow-listed `/api/*` proxy to pulse-api, an Atom feed and SVG badges. | pulse-contract, pulse-kit, pulse-config (dev); talks to pulse-api at run time |
| [pulse-notify](https://github.com/lorenzh/pulse-notify) | Notifier that polls pulse-api and sends a notification when an incident opens or resolves, and, when a channel sets `remindEverySeconds`, reminders while it stays open. Channels: webhook (optionally signed), file, Slack, Teams and email (SMTP through nodemailer). Failed events can be listed and resent with a CLI. | pulse-contract, pulse-kit, pulse-config (dev); talks to pulse-api at run time |
| [pulse-config](https://github.com/lorenzh/pulse-config) | Shared tooling configuration: Biome, tsconfig, ESLint with SonarJS (on its own nested TypeScript 6), Lefthook, and the reusable CI workflow `check.yml`. No product code. | nothing |
| [pulse-meta](https://github.com/lorenzh/pulse-meta) | This repository: issues, specs, Factory configuration. | none |

The code repositories use pulse-contract, pulse-kit and pulse-config as Git dependencies pinned to a commit SHA (`github:lorenzh/pulse-config#<sha>`). They extend the pulse-config files (`extends` for Biome, TypeScript and Lefthook, a one-line `eslint.config.js`) and call its CI workflow with `uses: lorenzh/pulse-config/.github/workflows/check.yml@<sha>`. A rule change is made in pulse-config and reaches a repository when its pin is updated. See the [pulse-config README](https://github.com/lorenzh/pulse-config#readme).

Data flow at run time: pulse-probe gets its checks from `GET /probe/checks` with its token (an older API that answers 404 gets the public `GET /checks` instead) and sends `POST /results`. A cron job or worker pings `GET|POST /heartbeat/<id>` with the check's secret. pulse-status reads pulse-api through its own `/api/*` proxy. pulse-notify polls `GET /incidents` and `GET /checks`. See [docs/architecture.md](docs/architecture.md).

In short:

- A check is `up`, `degraded` (slower than its latency objective), `down`, `unknown` (no results yet) or `maintenance` (inside a maintenance window).
- A check is `http` (the default), `tls` or `heartbeat`. An HTTP check can set `method`, `headers` (a value can be `{"env": "NAME"}`, which the probe resolves from its own environment), `body`, `expectedStatus`, `keyword` and `jsonAssert`, plus retries and a latency objective. A heartbeat check is never probed: the job pings the API, and the check is down when no ping arrives within `period + grace`. See the [checks file](https://github.com/lorenzh/pulse-api/blob/main/docs/configuration.md#checksjson).
- A check removed from the checks file becomes inactive at the next API start. It leaves `GET /checks`, its open incident is resolved, and its history stays.
- pulse-api keeps 90 days of raw results by default (`PULSE_RETENTION_DAYS`). Incidents are never deleted.
- The status page hides check targets, keywords, heartbeat period and grace, and failure reasons by default (`PULSE_STATUS_HIDE_DETAILS=true`). It serves an Atom feed of incidents at `/feed.atom` when `PULSE_STATUS_PUBLIC_URL` is set, and an SVG badge per check at `/badge/<check id>.svg`. See [what is public](https://github.com/lorenzh/pulse-status/blob/main/docs/operation.md#what-is-public).
- The status page uses the losoft design by default. An operator can white-label it (name, logo, colours, fonts) with settings and a theme file. See [theming](https://github.com/lorenzh/pulse-status/blob/main/docs/theming.md).
- All repositories are licensed under the MIT license. See [LICENSE](LICENSE).

## Documentation

Operator and developer documentation lives in each repository's `docs/` folder. Start at the index of the repository you need:

- [pulse-api docs](https://github.com/lorenzh/pulse-api/blob/main/docs/index.md): install, Compose quick start, `checks.json` and `tokens.json`, the [REST API](https://github.com/lorenzh/pulse-api/blob/main/docs/rest-api.md) (results, incidents, checks), operation and troubleshooting.
- [pulse-probe docs](https://github.com/lorenzh/pulse-probe/blob/main/docs/index.md)
- [pulse-status docs](https://github.com/lorenzh/pulse-status/blob/main/docs/index.md): includes [theming and white label](https://github.com/lorenzh/pulse-status/blob/main/docs/theming.md).
- [pulse-notify docs](https://github.com/lorenzh/pulse-notify/blob/main/docs/index.md): includes the [notification channels](https://github.com/lorenzh/pulse-notify/blob/main/docs/channels.md).
- [pulse-contract docs](https://github.com/lorenzh/pulse-contract/blob/main/docs/index.md): type reference, validators, wire version and the `fetchJson` client.
- [pulse-kit docs](https://github.com/lorenzh/pulse-kit/blob/main/docs/index.md): the shared runtime helpers.
- Cross-repository developer docs, in this repository: [docs/index.md](docs/index.md) (architecture, data flow, how a change runs through the Factory).

## Run all of pulse with Docker Compose

The Compose file lives in pulse-api. It starts `api`, one `probe`, `status` and `notify`. You need Docker Compose 2.23 or newer and access to github.com: the probe, status and notify images are built from `main` of their repositories.

```sh
git clone https://github.com/lorenzh/pulse-api.git
cd pulse-api
cp .env.example .env
# Put a random token into .env. The placeholder in .env.example is rejected at start.
sed -i.bak "s/^PULSE_PROBE_TOKEN=.*/PULSE_PROBE_TOKEN=$(openssl rand -hex 32)/" .env && rm .env.bak
docker compose up -d --build
```

Open <http://localhost:8080>. The example check `Status page` (`compose/checks.json`) probes the status page itself. The probe runs it right away and then every 10 s, so it turns `up` within seconds. A fresh start has no down check and no incident.

Only the status page is public. It serves the page and five read-only API paths through its proxy. The API listens on `127.0.0.1` only.

- `.env.example` has a placeholder token (`replace-with-...`) that the API rejects at start, so the `sed` line above writes a random one. Without a `.env` the API stops at start too.
- Change the host ports in `.env` with `PULSE_STATUS_PORT` (default 8080) and `PULSE_API_PORT` (default 3000, bound to 127.0.0.1).
- Add or remove checks in `compose/checks.json`, then run `docker compose restart api`. The API reads the file once at startup, and `up -d` does not recreate it for a changed checks file. The probe reloads the checks from the API on its own within `PULSE_CHECKS_RELOAD_MS` (default 60 s). A removed check becomes inactive: it leaves `GET /checks`, its open incident is resolved, and its history stays.
- notify writes incidents to `/data/incidents.jsonl` in the `notify-data` volume (`compose/notify.json`).
- Health: Docker checks `api` on `/readyz`, and `probe`, `status` and `notify` on `/healthz`. See [Health, readiness and metrics](#health-readiness-and-metrics).
- The end-to-end test fixtures are not part of this stack. They live in pulse-api's `compose.e2e.yaml` and `compose/e2e/`, used only by `scripts/compose-e2e.sh`.
- Stop with `docker compose down`. The volumes keep the database and the notify ledger. `docker compose down -v` deletes them.

Details: [pulse-api install, With Docker Compose](https://github.com/lorenzh/pulse-api/blob/main/docs/install.md#with-docker-compose).

### Demo: every status page state

The `demo` profile starts a self-contained pulse whose status page shows every state within five minutes: up, degraded, down with an open and then resolved incident, maintenance, an upcoming maintenance window and a TLS certificate check. It uses two probes (locations `eu` and `us`) and needs no `.env`.

```sh
cd pulse-api
docker compose --profile demo up demo-status
```

Open <http://localhost:8081>. The demo has its own volumes and ports, so it does not clash with the regular stack. The demo and the regular stack share the Compose project `pulse`, so `docker compose --profile demo down` also stops the regular stack, and `-v` also deletes its `api-data` and `notify-data` volumes. Stop and reset only the demo with:

```sh
docker compose --profile demo rm -sf demo-init demo-api demo-targets demo-tls demo-probe-a demo-probe-b demo-status
docker volume rm pulse_demo-api-data pulse_demo-config
```

The demo tokens are public example values: never use them for a real deployment. The [pulse-api install page](https://github.com/lorenzh/pulse-api/blob/main/docs/install.md#demo-profile) lists each demo check, when it appears, and how to try a white-label theme.

## Run all of pulse with Bun

You need Bun 1.4.0, git, and network access to GitHub (pulse-contract, pulse-kit and pulse-config are installed as Git dependencies). Every service runs in its own terminal.

1. Clone and install the services next to each other:

   ```sh
   for r in api probe status notify; do
     git clone https://github.com/lorenzh/pulse-$r.git && (cd pulse-$r && bun install --frozen-lockfile)
   done
   ```

2. Create `pulse-api/checks.json`. Only pulse-api reads it:

   ```json
   {
     "checks": [
       {
         "id": "example",
         "name": "Example endpoint",
         "url": "http://localhost:9000/",
         "intervalMs": 1000,
         "timeoutMs": 1000
       }
     ]
   }
   ```

   `checks.example.json` in pulse-api shows more check types and maintenance windows.

3. Create a token with `openssl rand -hex 32` and save `pulse-api/tokens.json`, with your token in place of `<token>`. Keep the file out of git. pulse-api refuses to start without a valid tokens file.

   ```json
   {
     "tokens": [
       { "location": "default", "token": "<token>" }
     ]
   }
   ```

   The location must equal the probe's `PULSE_LOCATION` (`default` when unset), otherwise the API rejects every result with 403.

4. Start the services, the API first, each in its own terminal:

   ```sh
   cd pulse-api && bun start                                  # port 3000
   cd pulse-probe && PULSE_PROBE_TOKEN='<token>' bun start   # replace <token> with your token
   cd pulse-status && bun start                               # port 8080
   ```

   To get notifications, also start pulse-notify with a channel config (see the [pulse-notify configuration](https://github.com/lorenzh/pulse-notify/blob/main/docs/configuration.md#channel-config-file)):

   ```sh
   cd pulse-notify
   echo '{ "channels": [{ "id": "log", "type": "file", "path": "./incidents.jsonl" }] }' > notify.json
   PULSE_NOTIFY_CONFIG=./notify.json bun start
   ```

5. Start something for the check to find on port 9000:

   ```sh
   bun -e "Bun.serve({ port: 9000, fetch: () => new Response('ok') })"
   ```

6. Open <http://localhost:8080>. The check "Example endpoint" is `unknown` until the first result arrives, then `up` within about a second. Stop the port 9000 process and the state turns `down`; the third consecutive down result opens an incident, which the page shows. Start it again and the first up result resolves the incident. With one probe, its location decides alone. When more than one location reports in, a check is down only when at least two of them report it down.

## Settings

Every service reads environment variables once at start. An invalid value stops the start with exit code 2 and one line that names the variable. An empty value counts as unset. The configuration page of each service is the source of truth:
[pulse-api](https://github.com/lorenzh/pulse-api/blob/main/docs/configuration.md),
[pulse-probe](https://github.com/lorenzh/pulse-probe/blob/main/docs/configuration.md),
[pulse-status](https://github.com/lorenzh/pulse-status/blob/main/docs/configuration.md),
[pulse-notify](https://github.com/lorenzh/pulse-notify/blob/main/docs/configuration.md).
pulse-contract and pulse-kit are libraries and have no settings.

| Repository | Setting | Default |
| --- | --- | --- |
| all four | `PULSE_LOG_LEVEL` | `info` (`debug`, `info`, `warn` or `error`) |
| pulse-api | `PORT` | `3000` |
| pulse-api | `PULSE_DB` | `./pulse.db` |
| pulse-api | `PULSE_CHECKS_FILE` | `./checks.json` |
| pulse-api | `PULSE_TOKENS_FILE` | `./tokens.json` (file required) |
| pulse-api | `PULSE_RETENTION_DAYS` | `90` (at least 90) |
| pulse-probe | `PULSE_API_URL` | `http://localhost:3000` |
| pulse-probe | `PULSE_LOCATION` | `default` |
| pulse-probe | `PULSE_PROBE_TOKEN` | none (required) |
| pulse-probe | `PULSE_CHECKS_RELOAD_MS` | `60000` (5000 to 2147483647) |
| pulse-probe | `PULSE_HEALTH_PORT` | unset, no listener (Docker image: `9100`) |
| pulse-probe | `PULSE_HEALTH_HOST` | `127.0.0.1` (Docker image: `0.0.0.0`) |
| pulse-status | `PORT` | `8080` |
| pulse-status | `PULSE_API_URL` | `http://localhost:3000` |
| pulse-status | `POLL_MS` | `5000` (at least 1000) |
| pulse-status | `PULSE_STATUS_NAME` | `pulse` |
| pulse-status | `PULSE_STATUS_LOGO` | none |
| pulse-status | `PULSE_STATUS_THEME` | none |
| pulse-status | `PULSE_STATUS_PUBLIC_URL` | none (turns on `/feed.atom`) |
| pulse-status | `PULSE_STATUS_HIDE_DETAILS` | `true` |
| pulse-status | `PULSE_STATUS_CACHE_MS` | `2000` (`0` turns the cache off) |
| pulse-status | `PULSE_STATUS_UPSTREAM_TIMEOUT_MS` | `4000` |
| pulse-notify | `PULSE_NOTIFY_CONFIG` | none (required) |
| pulse-notify | `PULSE_API_URL` | `http://localhost:3000` |
| pulse-notify | `PULSE_NOTIFY_STATE` | `./notify-state.json` |
| pulse-notify | `PULSE_NOTIFY_POLL_MS` | `5000` |
| pulse-notify | `PULSE_NOTIFY_RETRY_DELAY_MS` | `1000` (doubles per retry) |
| pulse-notify | `PULSE_NOTIFY_RETRY_MAX_DELAY_MS` | `60000` |
| pulse-notify | `PULSE_NOTIFY_RETRY_ATTEMPTS` | `12` (`0` retries without end) |
| pulse-notify | `PULSE_NOTIFY_TIMEOUT_MS` | `5000` |
| pulse-notify | `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` | `5` |
| pulse-notify | `PULSE_NOTIFY_LOCK_LEASE_SECONDS` | `60` (at least 30) |
| pulse-notify | `PULSE_NOTIFY_STATE_RETENTION_DAYS` | `30` |
| pulse-notify | `PULSE_NOTIFY_API_MAX_BYTES` | `5242880` (5 MiB) |
| pulse-notify | `PULSE_NOTIFY_SMTP_CLIENT_NAME` | the host name |
| pulse-notify | `PULSE_HEALTH_PORT` | unset, no listener (Docker image: `9100`) |
| pulse-notify | `PULSE_HEALTH_HOST` | `127.0.0.1` (Docker image: `0.0.0.0`) |

The Compose file in pulse-api has its own variables for `.env` (`PULSE_PROBE_TOKEN`, `PULSE_LOCATION`, `PULSE_API_PORT`, `PULSE_STATUS_PORT`, `PULSE_DEMO_API_PORT`, `PULSE_DEMO_STATUS_PORT`). See [Compose variables](https://github.com/lorenzh/pulse-api/blob/main/docs/configuration.md#compose-variables).

When you enable tokens on a running deployment, give the probes their tokens first (an older API ignores the header), then enable tokens on the API. Otherwise ingestion stops.

## Health, readiness and metrics

Every service answers `GET /healthz` (liveness), `GET /readyz` (readiness) and `GET /metrics` (Prometheus text). None of them needs a token. The `/metrics` of pulse-api and pulse-probe lists check ids, so keep those on a private network. pulse-status serves them on its public port; its `/metrics` carries no check ids.

| Service | Where | `/healthz` | `/readyz` | Docker `HEALTHCHECK` |
| --- | --- | --- | --- | --- |
| pulse-api | its main port (`PORT`, 3000) | `200` while the process answers, no database access | `200` when the database answers and the API is not shutting down | `/readyz` |
| pulse-status | its main port (`PORT`, 8080), next to the page | `200` while the server runs, never depends on the API | `200` after a successful API poll within `max(3 x POLL_MS, 30 s)` and no reported wire version mismatch | `/healthz` |
| pulse-probe | a separate listener on `PULSE_HEALTH_HOST:PULSE_HEALTH_PORT`, off by default; the image uses `0.0.0.0:9100` | `200` while the listener serves | `200` once the checks were fetched and the probe is not shutting down | `/healthz` |
| pulse-notify | a separate listener on `PULSE_HEALTH_HOST:PULSE_HEALTH_PORT`, off by default; the image uses `0.0.0.0:9100` | `503` while starting, shutting down, or after `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` failed polls in a row | same as `/healthz` | `/healthz` |

Do not publish port 9100 of the probe or notify: the listener has no authentication. Route traffic on `/readyz`. Use `/healthz` for restart-on-hang checks. In probe and status, `/healthz` used to mean readiness.

## How a feature moves from an issue to merged pull requests

1. A person opens an issue here that describes the feature. [AGENTS.md](AGENTS.md) says how to write one.
2. The `spec` workflow runs on the issue in this repository: `issue-review` checks the request for gaps, `plan` writes a spec with one section per affected repository (`.factory/work/<issue>/plan.md`) and the list of those repositories with their dependencies (`targets.json`), and `plan-review` reviews it. The result is a pull request in this repository.
3. A person merges the spec pull request. Merging approves the spec.
4. The fan-out (`factory-fan-out.yml`) opens one child issue here per repository that the spec lists, labelled `target/<name>`, and links them as "blocked by" along their dependencies. It starts each child that waits for no other.
5. Each child runs the `build` workflow in its repository: `implement` carries out that repository's section of the spec, and `review` checks the change in a fresh agent session. The result is one pull request per repository, whose description says `Closes lorenzh/pulse-meta#<child>`.
6. Before each run the base branch is merged into the issue branch. If that merge conflicts, a person starts the `merge` workflow on the child. It merges the base, resolves the conflicts, has the result reviewed, and returns to the interrupted workflow.
7. A person merges the pull requests. Each merge closes its child issue. `factory-unblock.yml` then starts the children that waited for it, and closes the feature issue when all its children are closed.

The workflows and their prompts are defined in `.factory/config.yaml` and `.factory/prompts/`, and the GitHub Actions in `.github/workflows/`. In `.factory/config.yaml` each target lists the repositories it may read as `context`. Every target reads `meta`. All targets except `config` itself also read `config`, the services also read `contract`, and status and notify also read `api`. The `meta` target reads all of them.
