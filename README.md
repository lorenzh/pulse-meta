# pulse-meta

pulse is an uptime monitor with a status page. Probes check HTTP endpoints and TLS certificates, an API stores the results and decides the state of each check, a status page shows every check with its open incidents, and a notifier reports incidents to webhooks or files.

This repository is the meta repository of pulse. It holds no product code. Feature requests are issues here, and the specs for them are written here. The code lives in the repositories below.

pulse is built by Paragon Factory agents from the issues in this repository. Developer and agent guidelines for this repository are in [AGENTS.md](AGENTS.md) (Claude Code reads it through [CLAUDE.md](CLAUDE.md)). Each code repository has its own `AGENTS.md`.

## Repositories

| Repository | Role | Depends on |
| --- | --- | --- |
| [pulse-contract](https://github.com/lorenzh/pulse-contract) | Shared TypeScript types (`Check`, `Result`, `Incident`, ...). Types only. | pulse-config (dev) |
| [pulse-probe](https://github.com/lorenzh/pulse-probe) | Worker that fetches the checks from the API, runs them (HTTP or TLS certificate expiry) and posts the results. | pulse-contract, pulse-config (dev); talks to pulse-api at run time |
| [pulse-api](https://github.com/lorenzh/pulse-api) | Loads the checks file, stores results in SQLite, computes state and incidents, serves REST. Holds the Docker Compose file for the whole stack. | pulse-contract, pulse-config (dev) |
| [pulse-status](https://github.com/lorenzh/pulse-status) | Status page that reads pulse-api. | pulse-contract, pulse-config (dev); talks to pulse-api at run time |
| [pulse-notify](https://github.com/lorenzh/pulse-notify) | Notifier that polls pulse-api and sends a notification when an incident opens or resolves (webhook or file channel). | pulse-contract, pulse-config (dev); talks to pulse-api at run time |
| [pulse-config](https://github.com/lorenzh/pulse-config) | Shared tooling configuration: Biome, tsconfig, ESLint with SonarJS (on its own nested TypeScript 6), Lefthook, and the reusable CI workflow `check.yml`. No product code. | nothing |
| [pulse-meta](https://github.com/lorenzh/pulse-meta) | This repository: issues, specs, Factory configuration. | none |

The code repositories use pulse-contract and pulse-config as Git dependencies pinned to a commit SHA (`github:lorenzh/pulse-config#<sha>`). They extend the pulse-config files (`extends` for Biome, TypeScript and Lefthook, a one-line `eslint.config.js`) and call its CI workflow with `uses: lorenzh/pulse-config/.github/workflows/check.yml@<sha>`. A rule change is made in pulse-config and reaches a repository when its pin is updated. See the [pulse-config README](https://github.com/lorenzh/pulse-config#readme).

Data flow at run time: pulse-probe gets `GET /checks` from pulse-api and sends `POST /results` to it. pulse-status reads pulse-api through its own `/api/*` proxy. pulse-notify polls `GET /incidents` and `GET /checks`.

In short:

- A check is `up`, `degraded` (slower than its latency objective), `down`, `unknown` (no results yet) or `maintenance` (inside a maintenance window).
- pulse-api keeps 90 days of raw results by default (`PULSE_RETENTION_DAYS`). Incidents are never deleted.
- The status page uses the losoft design by default. An operator can white-label it (name, logo, colours, fonts) with settings and a theme file. See the [pulse-status README](https://github.com/lorenzh/pulse-status#white-label).
- All repositories are licensed under the MIT license. See [LICENSE](LICENSE).

## Documentation

Operator and developer documentation lives in each repository's `docs/` folder. Start at the index of the repository you need:

- [pulse-api docs](https://github.com/lorenzh/pulse-api/blob/main/docs/index.md): install, Compose quick start, `checks.json` and `tokens.json`, the [REST API](https://github.com/lorenzh/pulse-api/blob/main/docs/rest-api.md) (results, incidents, checks), operation and troubleshooting.
- [pulse-probe docs](https://github.com/lorenzh/pulse-probe/blob/main/docs/index.md)
- [pulse-status docs](https://github.com/lorenzh/pulse-status/blob/main/docs/index.md): includes [theming and white label](https://github.com/lorenzh/pulse-status/blob/main/docs/theming.md).
- [pulse-notify docs](https://github.com/lorenzh/pulse-notify/blob/main/docs/index.md): includes the [notification channels](https://github.com/lorenzh/pulse-notify/blob/main/docs/channels.md).
- [pulse-contract docs](https://github.com/lorenzh/pulse-contract/blob/main/docs/index.md)
- Cross-repository developer docs, in this repository: [docs/index.md](docs/index.md) (architecture, data flow, how a change runs through the Factory).

## Run all of pulse with Docker Compose

The Compose file lives in pulse-api. It starts `api`, one `probe`, `status` and `notify`. You need Docker Compose 2.23 or newer and access to github.com: the probe, status and notify images are built from `main` of their repositories.

```sh
git clone https://github.com/lorenzh/pulse-api.git
cd pulse-api
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:8080>. The example check (`compose/checks.json`) probes the status page itself. The probe runs it right away and then every 10 s, so its state leaves `unknown` within seconds.

- The token in `.env.example` is public. Replace `PULSE_PROBE_TOKEN` with `openssl rand -hex 32` before you expose the stack. Without a `.env` the API stops at start.
- Change the host ports in `.env` with `PULSE_STATUS_PORT` (default 8080) and `PULSE_API_PORT` (default 3000, bound to 127.0.0.1).
- Add checks in `compose/checks.json`, then run `docker compose restart api` and then `docker compose restart probe`. Both read the checks once at startup, and `up -d` does not recreate the API for a changed checks file.
- notify writes incidents to `/data/incidents.jsonl` in the `notify-data` volume (`compose/notify.json`).
- Stop with `docker compose down`. The volumes keep the database and the notify ledger. `docker compose down -v` deletes them.

Details: [pulse-api, Docker and Compose](https://github.com/lorenzh/pulse-api#docker-and-compose).

### Demo: every status page state

The `demo` profile starts a self-contained pulse whose status page shows every state within five minutes: up, degraded, down with an open and then resolved incident, maintenance, an upcoming maintenance window and a TLS certificate check. It uses two probes (locations `eu` and `us`) and needs no `.env`.

```sh
cd pulse-api
docker compose --profile demo up demo-status
```

Open <http://localhost:8081>. The demo has its own volumes and ports, so it does not clash with the regular stack. Stop it with `docker compose --profile demo down`. Do not add `-v`: the demo and the regular stack share the Compose project `pulse`, so `-v` also deletes the `api-data` and `notify-data` volumes of the regular stack. To reset only the demo, remove its volumes after `down`: `docker volume rm pulse_demo-api-data pulse_demo-config`. The demo tokens are public example values: never use them for a real deployment. The [pulse-api README](https://github.com/lorenzh/pulse-api#demo) lists each demo check, when it appears, and how to try a white-label theme.

## Run all of pulse with npm

You need Node 24 or newer, git, and network access to GitHub (pulse-contract and pulse-config are installed as Git dependencies). Every service runs in its own terminal.

1. Clone and install the services next to each other:

   ```sh
   for r in api probe status notify; do
     git clone https://github.com/lorenzh/pulse-$r.git && (cd pulse-$r && npm ci)
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
   cd pulse-api && npm start                                  # port 3000
   cd pulse-probe && PULSE_PROBE_TOKEN=<token> npm start
   cd pulse-status && npm start                               # port 8080
   ```

   Node prints an experimental warning for `node:sqlite`. It is harmless. To get notifications, also start pulse-notify with a channel config (see the [pulse-notify README](https://github.com/lorenzh/pulse-notify#configuration)):

   ```sh
   cd pulse-notify && PULSE_NOTIFY_CONFIG=./notify.json npm start
   ```

5. Start something for the check to find on port 9000:

   ```sh
   node -e "require('node:http').createServer((q, r) => r.end('ok')).listen(9000)"
   ```

6. Open <http://localhost:8080>. The check "Example endpoint" is `unknown` until the first result arrives, then `up` within about a second. Stop the port 9000 process and the state turns `down`; the third consecutive down result opens an incident, which the page shows. Start it again and the first up result resolves the incident. With one probe, its location decides alone. When more than one location reports in, a check is down only when at least two of them report it down.

Settings (optional unless the default says required; each repository's README has the details):

| Repository | Setting | Default |
| --- | --- | --- |
| pulse-api | `PORT` | `3000` |
| pulse-api | `PULSE_DB` | `./pulse.db` |
| pulse-api | `PULSE_CHECKS_FILE` | `./checks.json` |
| pulse-api | `PULSE_TOKENS_FILE` | `./tokens.json` (file required) |
| pulse-api | `PULSE_RETENTION_DAYS` | `90` (at least 90) |
| pulse-probe | `PULSE_API_URL` | `http://localhost:3000` |
| pulse-probe | `PULSE_LOCATION` | `default` |
| pulse-probe | `PULSE_PROBE_TOKEN` | none (required) |
| pulse-status | `PORT` | `8080` |
| pulse-status | `PULSE_API_URL` | `http://localhost:3000` |
| pulse-status | `POLL_MS` | `5000` |
| pulse-status | `PULSE_STATUS_NAME` | `pulse` |
| pulse-status | `PULSE_STATUS_LOGO` | none |
| pulse-status | `PULSE_STATUS_THEME` | none |
| pulse-notify | `PULSE_NOTIFY_CONFIG` | none (required) |
| pulse-notify | `PULSE_API_URL` | `http://localhost:3000` |
| pulse-notify | `PULSE_NOTIFY_STATE` | `./notify-state.json` |
| pulse-notify | `PULSE_NOTIFY_POLL_MS` | `5000` |
| pulse-notify | `PULSE_NOTIFY_RETRY_DELAY_MS` | `1000` |
| pulse-notify | `PULSE_NOTIFY_TIMEOUT_MS` | `5000` |

When you enable tokens on a running deployment, give the probes their tokens first (an older API ignores the header), then enable tokens on the API. Otherwise ingestion stops.

## How a feature moves from an issue to merged pull requests

1. A person opens an issue here that describes the feature. [AGENTS.md](AGENTS.md) says how to write one.
2. The `spec` workflow runs on the issue in this repository: `issue-review` checks the request for gaps, `plan` writes a spec with one section per affected repository (`.factory/work/<issue>/plan.md`) and the list of those repositories with their dependencies (`targets.json`), and `plan-review` reviews it. The result is a pull request in this repository.
3. A person merges the spec pull request. Merging approves the spec.
4. The fan-out (`factory-fan-out.yml`) opens one child issue here per repository that the spec lists, labelled `target/<name>`, and links them as "blocked by" along their dependencies. It starts each child that waits for no other.
5. Each child runs the `build` workflow in its repository: `implement` carries out that repository's section of the spec, and `review` checks the change in a fresh agent session. The result is one pull request per repository, whose description says `Closes lorenzh/pulse-meta#<child>`.
6. Before each run the base branch is merged into the issue branch. If that merge conflicts, a person starts the `merge` workflow on the child. It merges the base, resolves the conflicts, has the result reviewed, and returns to the interrupted workflow.
7. A person merges the pull requests. Each merge closes its child issue. `factory-unblock.yml` then starts the children that waited for it, and closes the feature issue when all its children are closed.

The workflows and their prompts are defined in `.factory/config.yaml` and `.factory/prompts/`, and the GitHub Actions in `.github/workflows/`. In `.factory/config.yaml` each target lists the repositories it may read as `context`. Every target reads `meta`. All targets except `config` itself also read `config`, the services also read `contract`, and status and notify also read `api`. The `meta` target reads all of them.
