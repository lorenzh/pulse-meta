# pulse-meta

pulse is an uptime monitor with a status page: a probe checks HTTP endpoints, an API stores the results and decides up or down, and a status page shows every check and its open incidents.

This repository is the meta repository of pulse. It holds no product code. Feature requests are issues here, and the specs for them are written here. The code lives in the repositories below.

pulse is built by Paragon Factory agents from the issues in this repository.

## Repositories

| Repository | Role | Depends on |
| --- | --- | --- |
| [pulse-contract](https://github.com/lorenzh/pulse-contract) | Shared TypeScript types (`Check`, `Result`, `Incident`, ...). Types only. | nothing |
| [pulse-probe](https://github.com/lorenzh/pulse-probe) | Worker that fetches the checks from the API, runs them over HTTP and posts the results. | pulse-contract; talks to pulse-api at run time |
| [pulse-api](https://github.com/lorenzh/pulse-api) | Loads the checks file, stores results in SQLite, computes state and incidents, serves REST. | pulse-contract |
| [pulse-status](https://github.com/lorenzh/pulse-status) | Status page that reads pulse-api. | pulse-contract; talks to pulse-api at run time |
| [pulse-meta](https://github.com/lorenzh/pulse-meta) | This repository: issues, specs, Factory configuration. | none |

Data flow at run time: pulse-probe gets `GET /checks` from pulse-api and sends `POST /results` to it. pulse-status reads pulse-api through its own `/api/*` proxy.

## Run all of pulse locally

You need Node 24 or newer, git, and network access to GitHub (pulse-contract is installed as a Git dependency). You need four terminals.

1. Clone the repositories next to each other:

   ```sh
   git clone https://github.com/lorenzh/pulse-api.git
   git clone https://github.com/lorenzh/pulse-probe.git
   git clone https://github.com/lorenzh/pulse-status.git
   ```

2. Install each service:

   ```sh
   (cd pulse-api && npm ci)
   (cd pulse-probe && npm ci)
   (cd pulse-status && npm ci)
   ```

3. Create the checks file. Only pulse-api reads it. Save this as `pulse-api/checks.json`:

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

   (This is `checks.example.json` of pulse-api. `timeoutMs` is optional and defaults to 5000.)

4. Terminal 1, the API (port 3000). Start it first, because it loads the checks file:

   ```sh
   cd pulse-api && npm start
   ```

   Node prints an experimental warning for `node:sqlite`. It is harmless.

5. Terminal 2, the probe. It fetches the checks from the API and runs them:

   ```sh
   cd pulse-probe && npm start
   ```

6. Terminal 3, the status page (port 8080):

   ```sh
   cd pulse-status && npm start
   ```

7. Terminal 4, something for the check to find on port 9000:

   ```sh
   node -e "require('node:http').createServer((q, r) => r.end('ok')).listen(9000)"
   ```

8. Open <http://localhost:8080>. The check "Example endpoint" is listed. Its state is `unknown` until the first result arrives, then `up` within about a second. Stop the terminal 4 process and the state turns `down`; the third consecutive down result opens an incident, which the page shows. Start it again and the first up result resolves the incident. Without terminal 4 the check is `down` from the start.

Settings (all optional; see each repository's README for details):

| Repository | Setting | Default |
| --- | --- | --- |
| pulse-api | `PORT` | `3000` |
| pulse-api | `PULSE_DB` | `./pulse.db` |
| pulse-api | `PULSE_CHECKS_FILE` | `./checks.json` |
| pulse-probe | `PULSE_API_URL` | `http://localhost:3000` |
| pulse-status | `PORT` | `8080` |
| pulse-status | `PULSE_API_URL` | `http://localhost:3000` |
| pulse-status | `POLL_MS` | `5000` |

## How a feature moves from an issue to merged pull requests

1. A person opens an issue here that describes the feature.
2. The `spec` workflow runs on the issue in this repository: `issue-review` checks the request for gaps, `plan` writes a spec with one section per affected repository (`.factory/work/<issue>/plan.md`) and the list of those repositories with their dependencies (`targets.json`), and `plan-review` reviews it. The result is a pull request in this repository.
3. A person merges the spec pull request. Merging approves the spec.
4. The fan-out opens one issue per repository that the spec lists and starts each one that waits for no other repository. A repository that depends on another starts after that one is done.
5. In each of those repositories the `build` workflow runs: `implement` carries out that repository's section of the spec, and `review` checks the change in a fresh agent session. The result is one pull request per repository, whose description says `Closes lorenzh/pulse-meta#<issue>`.
6. If a branch falls behind its base branch, the `merge` workflow merges the base and resolves conflicts, then returns to the interrupted workflow.
7. A person merges the pull requests. The issue here closes when they are merged.

The workflows and their prompts are defined in `.factory/config.yaml` and `.factory/prompts/`, and the GitHub Actions in `.github/workflows/`.
