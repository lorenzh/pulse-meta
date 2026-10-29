# Issue review: #148 Compose end-to-end test in CI

Verdict: specifiable. Only `api` changes (script, `ci.yml` job, `docs/development.md`, maybe a test-only compose override). No hold needed.

## Facts checked in the clones
- `api/compose.yaml`: services api, probe, status, notify. The example check `status-page` (`compose/checks.json`) probes `http://status:8080/` every 10 s, timeout 2 s. Only api and status have healthchecks (api image: 10 s interval, 10 s start period). Probe and notify have none, so "stay up" must be checked via `docker compose ps` state (running, not restarting/exited).
- Ports: api `127.0.0.1:${PULSE_API_PORT:-3000}`, status `${PULSE_STATUS_PORT:-8080}`. The `.env.example` has both commented out.
- Incident rule (api `docs/concepts.md`): the third consecutive `down` evaluation opens an incident, then one `up` resolves it. With a 10 s interval the incident opens about 30 s after the target stops.
- notify polls every 5 s (default) and writes `/data/incidents.jsonl` in `notify-data`, with events `opened` and `resolved`, key `<incidentId>:<event>`.
- Documented reload: `docker compose restart api`, then `restart probe` (`docs/install.md`, `docs/operation.md`). `up -d` is documented as not a reload.
- Documented demo cleanup: `docker compose --profile demo down -v`. `docs/install.md` also says `down -v` deletes `api-data` and `notify-data`, which is only true without the profile.
- probe, status and notify are built from `main` via Git URL. The job needs network and takes a few minutes to build. The `docker` job already uses `docker build --tag pulse-api:local`.

## Open points (decided by assumption, none block)
1. **Which target goes down.** The example check targets the `status` service. Stopping `status` (`docker compose stop status`, then `start`) needs no extra target and no change to `compose.yaml`. The cost: status is then down during the incident, so the status-page checks must run before or after it. Probe `depends_on` status only applies at start. Assumption: use that. The alternative is a separate test-only target service in an override file, which is more moving parts.
2. **Reload test edits a tracked file.** `compose/checks.json` is bind-mounted. The test must change it (add a second check or rename one) and restore it on exit, even on failure (`trap`), so the working tree stays clean. Assumption: back up and restore in the trap. The added check should target something that is always reachable (for example `http://api:3000/checks`) so it does not open incidents.
3. **Restart persistence.** After the reload, the check list is also reloaded again on restore. The test should only assert the change is visible in `GET /checks` (new check id or name present), and restore at teardown.
4. **"Stay up" definition.** Assumption: all four services are `running` in `docker compose ps --format json` and stay so after a fixed observation window (for example no restarts, `RestartCount` 0 or state unchanged across the test). Pick a short window (about 10 to 15 s) polled, not slept.
5. **Port and `.env`.** The test runs `cp .env.example .env` as the issue says. Locally this would overwrite a developer's `.env`. Assumption: the script creates `.env` only if missing and removes it afterwards only when it created it. In CI it is always created. It reads the ports from `.env` (with the compose defaults as fallback).
6. **Volume persistence after `down`/`up`.** "Database still holds the results" is checked by comparing: a result or incident id seen before `down` is still in `GET /incidents` or `/checks` (for example the resolved incident id and the check's `lastResultAt`) after `up -d`. Use the incident, since it is monotonic. Do not use `down -v` in the regular phase.
7. **Demo volume assertion.** After `docker compose --profile demo down -v`, `docker volume ls` must lack `pulse_demo-api-data` and `pulse_demo-config` and must still have `pulse_api-data` and `pulse_notify-data`. Compose project name is `pulse` (`name: pulse`), so the volume names are `pulse_*`. This requires the regular stack to have created its volumes first, so the demo phase runs while the regular stack is up (or after `down`, since volumes are kept). Note the documented cleanup is the command that is under test, so the script must run exactly that string. It may find that the documented behavior is wrong (the issue #132 case). If so the fix is a docs change in this same issue.
8. **Demo start time.** `demo-status` pulls in demo-init, demo-api, demo-targets, demo-tls and two probes. Builds are shared with the regular images through `image:` tags. Port clash: demo api 3001 and demo status 8081 differ from the regular ones, so both can run together. Demo needs no `.env`.
9. **Timeouts.** Proposed (env-overridable): build and start 600 s, first check result 90 s, incident open 120 s, resolve 120 s, notify file lines 60 s, page checks 60 s. Total job timeout 20 min (`timeout-minutes`).
10. **Tooling.** `bash` with `curl` and `jq` (both on `ubuntu-latest`). No Node needed. The script must run with `set -euo pipefail` and print step headings. A local command is documented, for example `bash scripts/compose-e2e.sh`. Needs Docker Compose >= 2.23 (already required).
11. **Failure and teardown.** `trap` on EXIT prints `docker compose ps` and `logs` (only when the exit code is non-zero) and runs `docker compose --profile demo down -v` to finish. In CI "always tear down" can also be an `if: always()` step. Teardown with `-v` is fine in the test (the stack is disposable), but locally it deletes the developer's real volumes. Assumption: use a dedicated project name through `COMPOSE_PROJECT_NAME`/`-p pulse-e2e`, so that a local run does not touch a developer's `pulse_*` volumes. This conflicts with item 7 (volume names) unless the script derives the names from the project name. Decision: the script sets `COMPOSE_PROJECT_NAME=pulse-e2e` (overridable) and derives the volume names. Note that `name: pulse` in `compose.yaml` is overridden by the env var? It is not: the top-level `name:` has lower priority than `COMPOSE_PROJECT_NAME` and `-p`; the plan must check with `docker compose config`. If it does not hold, use `-p`.
12. **Image caching.** The `docker` job builds `pulse-api:local`. A new job can build through compose itself. The plan decides between a new job `compose-e2e` and extending `docker`. The issue says "a CI job", so add a separate job.
13. **Flakiness vs. the `main` builds.** The probe, status and notify images follow `main`, so a break in another repo fails this job. Accepted by the issue (non-goal to pin).
14. **Doc inconsistency to fix or note.** `docs/install.md` line 42 (`down -v` deletes the volumes) next to the demo cleanup text. The new test can show it. Docs change is limited to `docs/development.md` unless the test finds a real error.

## Contradictions / risks
- "Stop the target and start again" vs. the status page needing to be up: handled by order (item 1).
- "Required on every pull request" while the other repos' `main` builds need no secrets: public clones, fine (public Git URLs).
- No change to service code and no change to the `compose.yaml` build sources: respected. A compose change is only allowed if the test finds a documented command to be wrong.

## Derived acceptance check
`bash scripts/compose-e2e.sh` on a machine with Docker exits 0, and CI job `compose-e2e` (PR and main) runs it and is green. Specifically:
1. After `up -d --build`: api, probe, status, notify are running and stay running.
2. `GET /checks` shows `status-page` with a state other than `unknown` within the timeout.
3. `GET /` on the status port is 200 and contains the check name `Status page`.
4. After `stop status`: an open incident (no `resolvedAt`) appears in `GET /incidents`. After `start status`: it has `resolvedAt`. `incidents.jsonl` in `notify-data` holds `<id>:opened` and `<id>:resolved` lines.
5. After editing `compose/checks.json`, `restart api`, `restart probe`: `GET /checks` shows the change. The file is restored afterwards.
6. `down` then `up -d`: the earlier incident is still in `GET /incidents`, and both volumes still exist.
7. `--profile demo up -d demo-status`: the page on 8081 returns 200. `--profile demo down -v` removes the demo volumes, and `api-data` and `notify-data` remain.
8. On a forced failure the output includes `docker compose ps` and `logs`, and no containers remain afterwards.
9. `docs/development.md` CI section lists the three jobs including the new one, and the local command.
