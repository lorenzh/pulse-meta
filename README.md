# pulse-meta

pulse is an uptime monitor with a status page. Probes check HTTP endpoints and TLS certificates, cron jobs and workers ping heartbeat checks, an API stores the results and decides the state of each check, a status page shows every check with its open incidents, and a notifier reports incidents to webhooks, files, Slack, Teams or email.

This repository is the meta repository of pulse. It holds no product code. Feature requests are issues here, and the specs for them are written here. The code lives in the repositories below.

pulse is built by Paragon Factory agents from the issues in this repository. Developer and agent guidelines for this repository are in [AGENTS.md](AGENTS.md) (Claude Code reads it through [CLAUDE.md](CLAUDE.md)). Each code repository has its own `AGENTS.md`.

The [Factory report](https://lorenzh.github.io/pulse-meta/) shows the cost, duration and quality of every Factory run. It is rebuilt daily from the public issues and pull requests (`report/`).

## Repositories

| Repository | Role | Depends on |
| --- | --- | --- |
| [pulse-contract](https://github.com/lorenzh/pulse-contract) | The wire contract: zod schemas for `Check`, `Result`, `Incident` and the API shapes, the TypeScript types and validators built from them, the wire version (`x-pulse-contract` header) and `fetchJson`, a JSON GET client with timeout, size cap, version check and validation. Library, no settings. | zod; pulse-config (dev) |
| [pulse-kit](https://github.com/lorenzh/pulse-kit) | Shared runtime helpers of the services: env settings with bounds, signal handling and bounded shutdown, the ops server for `/healthz`, `/readyz` and `/metrics`, a Prometheus registry, the JSON logger, small HTTP and timer helpers. Library, no settings. | pulse-config (dev) |
| [pulse-probe](https://github.com/lorenzh/pulse-probe) | Worker that fetches the checks from the API, runs HTTP, TLS certificate, TCP, DNS and domain-expiry checks and posts the results. It buffers results in memory while the API cannot be reached and delivers them later. It reloads the checks every `PULSE_CHECKS_RELOAD_MS` and when the API answers 404 for a result. | pulse-contract, pulse-kit, pulse-config (dev); talks to pulse-api at run time |
| [pulse-api](https://github.com/lorenzh/pulse-api) | Loads and hot-reloads the checks file (also writable through admin routes), takes heartbeat pings, stores results in SQLite (`bun:sqlite`), computes state, incidents, latency history and availability objectives, serves REST. | pulse-contract, pulse-kit, pulse-config (dev) |
| [pulse-status](https://github.com/lorenzh/pulse-status) | Status page with an allow-listed `/api/*` proxy to pulse-api, an Atom feed and SVG badges. | pulse-contract, pulse-kit, pulse-config (dev); talks to pulse-api at run time |
| [pulse-notify](https://github.com/lorenzh/pulse-notify) | Notifier that polls pulse-api and sends a notification when an incident opens or resolves, and, when a channel sets `remindEverySeconds`, reminders while it stays open. Channels: webhook (optionally signed), file, Slack, Teams and email (SMTP through nodemailer). Failed events can be listed and resent with a CLI. | pulse-contract, pulse-kit, pulse-config (dev); talks to pulse-api at run time |
| [pulse-console](https://github.com/lorenzh/pulse-console) | Admin web UI ([#460](https://github.com/lorenzh/pulse-meta/issues/460)): the fifth container of the Compose stack, for one organisation. Today it serves one page and its ops routes and validates `PULSE_API_URL` and an optional admin token; managing checks through the pulse-api admin API comes in later items. | pulse-kit, pulse-config (dev); will talk to the pulse-api admin API |
| [pulse-deploy](https://github.com/lorenzh/pulse-deploy) | Docker Compose setups for the whole stack (#528): `minimal`, `full`, `demo` and `dev`, on the published images pinned by version and digest, each tested in CI with the Compose end-to-end test. A `pulse` CLI setup wizard is planned (#529). Not a running service. | composes the images of the services |
| [pulse-config](https://github.com/lorenzh/pulse-config) | Shared tooling configuration: Biome, tsconfig, ESLint with SonarJS (on its own nested TypeScript 6), Lefthook, and the reusable CI workflow `check.yml`. No product code. | nothing |
| [pulse-meta](https://github.com/lorenzh/pulse-meta) | This repository: issues, specs, Factory configuration. | none |

The code repositories use pulse-contract, pulse-kit and pulse-config as Git dependencies pinned to a commit SHA (`github:lorenzh/pulse-config#<sha>`). They extend the pulse-config files (`extends` for Biome, TypeScript and Lefthook, a one-line `eslint.config.js`) and call its CI workflow with `uses: lorenzh/pulse-config/.github/workflows/check.yml@<sha>`. A rule change is made in pulse-config and reaches a repository when its pin is updated. See the [pulse-config README](https://github.com/lorenzh/pulse-config#readme).

Data flow at run time: pulse-probe gets its checks from `GET /probe/checks` with its token (an older API that answers 404 gets the public `GET /checks` instead) and sends `POST /results`. A cron job or worker pings `GET|POST /heartbeat/<id>` with the check's secret. pulse-status reads pulse-api through its own `/api/*` proxy. pulse-notify polls `GET /incidents` and `GET /checks`. `POST /results` is idempotent on (check, location, timestamp), so a probe can re-send buffered results; `GET /locations` lists the probe locations as `reporting` or `silent`. See [docs/architecture.md](docs/architecture.md).

In short:

- A check is `up`, `degraded` (slower than its latency objective), `down`, `unknown` (no results yet) or `maintenance` (inside a maintenance window).
- A check is `http` (the default), `tls`, `tcp`, `dns`, `domain` or `heartbeat`. An HTTP check can set `method`, `headers` (a value can be `{"env": "PULSE_HEADER_NAME"}`, which the probe resolves from its own environment; the name must start with `PULSE_HEADER_`, see the [probe migration note](https://github.com/lorenzh/pulse-probe/blob/main/docs/configuration.md#migration)), `body`, `expectedStatus`, `keyword` and `jsonAssert`, plus retries and a latency objective. A heartbeat check is never probed: the job pings the API, and the check is down when no ping arrives within `period + grace`. See the [checks file](https://github.com/lorenzh/pulse-api/blob/main/docs/configuration.md#checksjson).
- The API applies a changed checks file without a restart (a look every `PULSE_CHECKS_RELOAD_INTERVAL_MS`, default 5 s, or `SIGHUP`). With `PULSE_API_ADMIN_TOKENS_FILE` set, operators can also change checks, components and maintenance windows through the [admin config routes](https://github.com/lorenzh/pulse-api/blob/main/docs/rest-api.md#admin-config-routes), which rewrite the file. See [changing checks](https://github.com/lorenzh/pulse-api/blob/main/docs/operation.md#changing-checks).
- A check removed from the checks file becomes inactive at the next reload. It leaves `GET /checks`, its open incident is resolved, and its history stays.
- pulse-api keeps 90 days of raw results by default (`PULSE_RETENTION_DAYS`). Incidents are never deleted.
- pulse-api serves 90 days of daily p50 and p95 latency per HTTP check (`GET /latency`), and a check or component with `availabilityTarget` carries a 30-day `slo` with the remaining error budget. See [latency history and availability objective](https://github.com/lorenzh/pulse-api/blob/main/docs/concepts.md#latency-history-and-availability-objective). The status page draws the latency chart with `PULSE_STATUS_SHOW_CHECKS=true` ([latency and availability](https://github.com/lorenzh/pulse-status/blob/main/docs/operation.md#latency-and-availability)).
- The status page hides check targets, keywords, heartbeat period and grace, and failure reasons by default (`PULSE_STATUS_HIDE_DETAILS=true`). It serves an Atom feed of incidents at `/feed.atom` when `PULSE_STATUS_PUBLIC_URL` is set, and an SVG badge per check at `/badge/<check id>.svg`. See [what is public](https://github.com/lorenzh/pulse-status/blob/main/docs/operation.md#what-is-public).
- The status page uses the losoft design by default. An operator can white-label it (name, logo, colours, fonts) with settings and a theme file. See [theming](https://github.com/lorenzh/pulse-status/blob/main/docs/theming.md).
- All repositories are licensed under the MIT license. See [LICENSE](LICENSE).

## Documentation

Operator and developer documentation lives in each repository's `docs/` folder. Start at the index of the repository you need:

- [pulse-api docs](https://github.com/lorenzh/pulse-api/blob/main/docs/index.md): install, `checks.json` and `tokens.json`, the [REST API](https://github.com/lorenzh/pulse-api/blob/main/docs/rest-api.md) (results, incidents, checks), operation and troubleshooting.
- [pulse-probe docs](https://github.com/lorenzh/pulse-probe/blob/main/docs/index.md)
- [pulse-status docs](https://github.com/lorenzh/pulse-status/blob/main/docs/index.md): includes [theming and white label](https://github.com/lorenzh/pulse-status/blob/main/docs/theming.md).
- [pulse-notify docs](https://github.com/lorenzh/pulse-notify/blob/main/docs/index.md): includes the [notification channels](https://github.com/lorenzh/pulse-notify/blob/main/docs/channels.md).
- [pulse-contract docs](https://github.com/lorenzh/pulse-contract/blob/main/docs/index.md): type reference, validators, wire version and the `fetchJson` client.
- [pulse-kit docs](https://github.com/lorenzh/pulse-kit/blob/main/docs/index.md): the shared runtime helpers.
- Cross-repository developer docs, in this repository: [docs/index.md](docs/index.md) (architecture, data flow, how a change runs through the Factory).

## Run all of pulse with Docker Compose

The Compose setups live in [pulse-deploy](https://github.com/lorenzh/pulse-deploy) (#528). They run the published images from ghcr.io, pinned by version and digest:

| Setup | Services |
| --- | --- |
| `minimal` | api, probe |
| `full` | api, probe, status, notify, console |
| `demo` | `full` plus seeded demo checks, a target that goes down on purpose and a mail catcher |
| `dev` | `full`, built from sibling checkouts (`../pulse-api` and so on) |

You need Docker Compose 2.23 or newer. Start `full`:

```sh
git clone https://github.com/lorenzh/pulse-deploy.git
cd pulse-deploy
scripts/init-secrets.sh            # writes secrets/probe-token (mode 0600), never overwrites
docker compose -f full/compose.yaml up -d
```

Open <http://localhost:8080>. Only the status page is published on all interfaces. The Console is on <http://127.0.0.1:8082>, and the API is not published. Each setup has a README with its config files, ports and variables. Users of pulse-api's former `compose.yaml` keep their data: `full` uses the same project name `pulse` and the same volumes.

The demo starts with one command and needs no secret input:

```sh
docker compose -f demo/compose.yaml up -d
```

Within five minutes its status page (<http://127.0.0.1:8080>) shows every state, including an open incident, and the mail catcher (<http://127.0.0.1:8025>) holds the incident email from notify. Reset it with `docker compose -f demo/compose.yaml down -v`.

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

   The Console is optional and has nothing to manage yet: clone `pulse-console`, install it the same way, and run `PULSE_API_URL=http://localhost:3000 bun start` (port 8082 on `127.0.0.1`).

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

Every service reads environment variables once at start. An invalid value stops the start with exit code 2 and one line that names the variable. An empty value counts as unset, except for four settings that stop the start with exit code 2: pulse-probe's `PULSE_API_URL` and `PULSE_PROBE_TOKEN`, pulse-notify's `PULSE_NOTIFY_CONFIG`, and pulse-console's `PULSE_API_URL`. The configuration page of each service is the source of truth:
[pulse-api](https://github.com/lorenzh/pulse-api/blob/main/docs/configuration.md),
[pulse-probe](https://github.com/lorenzh/pulse-probe/blob/main/docs/configuration.md),
[pulse-status](https://github.com/lorenzh/pulse-status/blob/main/docs/configuration.md),
[pulse-notify](https://github.com/lorenzh/pulse-notify/blob/main/docs/configuration.md),
[pulse-console](https://github.com/lorenzh/pulse-console/blob/main/docs/configuration.md).
pulse-contract and pulse-kit are libraries and have no settings.

| Repository | Setting | Default |
| --- | --- | --- |
| all five | `PULSE_LOG_LEVEL` | `info` (`debug`, `info`, `warn` or `error`) |
| pulse-api | `PORT` | `3000` |
| pulse-api | `PULSE_DB` | `./pulse.db` |
| pulse-api | `PULSE_CHECKS_FILE` | `./checks.json` |
| pulse-api | `PULSE_TOKENS_FILE` | `./tokens.json` (file required) |
| pulse-api | `PULSE_RETENTION_DAYS` | `90` (at least 90) |
| pulse-api | `PULSE_CHECKS_RELOAD_INTERVAL_MS` | `5000` (`0` turns the look off) |
| pulse-api | `PULSE_API_ADMIN_TOKENS_FILE` | unset (admin write routes off) |
| pulse-api | `PULSE_LOCATION_SILENT_MS` | derived from the check intervals (at least 180000) |
| pulse-probe | `PULSE_API_URL` | `http://localhost:3000` |
| pulse-probe | `PULSE_LOCATION` | `default` |
| pulse-probe | `PULSE_PROBE_TOKEN` | none (required) |
| pulse-probe | `PULSE_CHECKS_RELOAD_MS` | `60000` (5000 to 2147483647) |
| pulse-probe | `PULSE_BUFFER_MAX_RESULTS` | `10000` |
| pulse-probe | `PULSE_BUFFER_MAX_AGE_MS` | `3600000` (1 h) |
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
| pulse-status | `PULSE_STATUS_SHOW_CHECKS` | `false` (`true` lists checks and draws latency charts) |
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
| pulse-console | `PULSE_API_URL` | none (required) |
| pulse-console | `PULSE_CONSOLE_PORT` | `8082` |
| pulse-console | `PULSE_CONSOLE_HOST` | `127.0.0.1` (Docker image: `0.0.0.0`) |
| pulse-console | `PULSE_CONSOLE_ADMIN_TOKEN` or `PULSE_CONSOLE_ADMIN_TOKEN_FILE` | unset (optional, validated, not used yet; set only one) |

The Compose setups in [pulse-deploy](https://github.com/lorenzh/pulse-deploy) have their own variables for a `.env` file next to each setup's `compose.yaml` (for example `PULSE_LOCATION`, `PULSE_STATUS_PORT`, `PULSE_CONSOLE_PORT`). The probe token is a file, `secrets/probe-token`, not a variable. Each setup's README and `.env.example` list them.

When you enable tokens on a running deployment, give the probes their tokens first (an older API ignores the header), then enable tokens on the API. Otherwise ingestion stops.

## Health, readiness and metrics

Every service answers `GET /healthz` (liveness), `GET /readyz` (readiness) and `GET /metrics` (Prometheus text). None of them needs a token. The `/metrics` of pulse-api and pulse-probe lists check ids, so keep those on a private network. pulse-status serves them on its public port; its `/metrics` carries no check ids.

| Service | Where | `/healthz` | `/readyz` | Docker `HEALTHCHECK` |
| --- | --- | --- | --- | --- |
| pulse-api | its main port (`PORT`, 3000) | `200` while the process answers, no database access | `200` when the database answers and the API is not shutting down | `/readyz` |
| pulse-status | its main port (`PORT`, 8080), next to the page | `200` while the server runs, never depends on the API | `200` after a successful API poll within `max(3 x POLL_MS, 30 s)` and no reported wire version mismatch | `/healthz` |
| pulse-probe | a separate listener on `PULSE_HEALTH_HOST:PULSE_HEALTH_PORT`, off by default; the image uses `0.0.0.0:9100` | `200` while the listener serves | `200` once the checks were fetched and the probe is not shutting down | `/healthz` |
| pulse-notify | a separate listener on `PULSE_HEALTH_HOST:PULSE_HEALTH_PORT`, off by default; the image uses `0.0.0.0:9100` | `503` while starting, shutting down, or after `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` failed polls in a row | same as `/healthz` | `/healthz` |
| pulse-console | its main port (`PULSE_CONSOLE_PORT`, 8082), next to the page | `200` while the server runs | `200` while the server runs and is not shutting down; does not check the API yet | `/healthz` |

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
