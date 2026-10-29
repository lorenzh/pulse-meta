# Spec: End-to-end test of the Docker Compose stack in CI (#148)

## Goal
A CI job in pulse-api starts the real Compose stack and proves end to end that it works. It runs on every pull request and on main. A developer runs the same test locally with one command.

## Scope
Only `api` changes: a new script, a new CI job, and the docs. Details and assumptions: `issue-review.md`.

## Non-goals
- No change to service code, and none to the build sources of probe, status and notify in `compose.yaml` (they stay built from `main`).
- No new test framework. Bash with `curl` and `jq`.
- A change to `compose.yaml` or `docs/install.md` is allowed only if the test proves a documented command wrong (as in #132 and #133). Then fix it in this issue.

## Required behavior
Script `scripts/compose-e2e.sh` (bash, `set -euo pipefail`, step headings, timeouts overridable by environment):
1. Setup: `COMPOSE_PROJECT_NAME` defaults to `pulse-e2e` so a local run never touches a developer's `pulse_*` volumes. Verify with `docker compose config` that the variable overrides `name: pulse`; otherwise pass `-p`. Derive volume names from the project name. Create `.env` from `.env.example` only if missing, and remove it at the end only when the script created it. Read ports from `.env` with the compose defaults (3000, 8080, 8081) as fallback.
2. Regular stack: `docker compose up -d --build`. Poll until api, probe, status and notify are `running` in `docker compose ps --format json`, then observe a 10 to 15 s polled window with no restart or state change.
3. Poll `GET /checks` until `status-page` has a state other than `unknown` (90 s).
4. `GET /` on the status port returns 200 and contains `Status page`.
5. Incident: `docker compose stop status`, poll `GET /incidents` for an open incident (no `resolvedAt`; about 30 s with a 10 s interval, timeout 120 s), `docker compose start status`, poll until that incident has `resolvedAt` (120 s). Poll `incidents.jsonl` in the `notify-data` volume (read with `docker compose exec notify cat /data/incidents.jsonl`) for `<id>:opened` and `<id>:resolved` (60 s). This phase comes after the status page checks, because it takes the status service down.
6. Reload: back up `compose/checks.json`, add a second check that targets an always reachable URL (`http://api:3000/checks`), run `docker compose restart api` then `docker compose restart probe`, poll `GET /checks` for the new check. Restore the file in the trap, even on failure.
7. Persistence: record the resolved incident id, run `docker compose down` (no `-v`), assert both volumes still exist, run `up -d`, poll until api answers, and assert the incident id is still in `GET /incidents`.
8. Demo: run `docker compose --profile demo up -d demo-status`, poll the demo status port until it returns 200 (use a generous timeout, 300 s). Then run exactly the documented cleanup `docker compose --profile demo down -v` and assert that the demo volumes (`demo-api-data`, `demo-config`) are gone and `api-data` and `notify-data` remain. If the documented behavior is wrong, fix the docs (`docs/install.md` line about `down -v` next to the demo cleanup) and the command in the same change.
9. Teardown: an `EXIT` trap prints `docker compose ps` and `docker compose logs` (also with the demo profile) when the exit code is not 0, restores `checks.json`, removes a self-created `.env`, and runs `docker compose --profile demo down -v --remove-orphans`.
10. All waits use one polling helper `wait_for <timeout> <description> <command...>` with a short sleep inside. No fixed sleeps as assertions.

CI (`.github/workflows/ci.yml`): new job `compose-e2e` next to `check` and `docker`: `runs-on: ubuntu-latest`, `timeout-minutes: 25`, `permissions: contents: read`, pinned `actions/checkout` with the same SHA as the other job, a step that runs `bash scripts/compose-e2e.sh`, and a final step with `if: always()` that runs `docker compose --profile demo down -v --remove-orphans` as a safety net. Triggers stay the existing `push: main` and `pull_request`.

Docs (`docs/development.md`, CI section): change "two jobs" to three, describe `compose-e2e` (what it proves, that it builds probe, status and notify from `main`, so a break there fails the job), and name the local command `bash scripts/compose-e2e.sh` with its requirements (Docker Compose >= 2.23, network, `curl`, `jq`, a few minutes) and the project name `pulse-e2e`. Keep to the docs rules in that file.

## Risks
- Builds from `main` of other repositories make the job depend on them. Accepted by the issue.
- Timing flakiness: use generous, env-overridable timeouts and polling.
- A local run uses ports 3000, 8080 and 8081; say so in the docs.
- The test may reveal a wrong documented command; the fix then belongs here.

## Acceptance evidence
`bash scripts/compose-e2e.sh` exits 0 where Docker is available and the CI job `compose-e2e` is green on the PR and on main. A forced failure prints `docker compose ps` and logs and leaves no containers. `npm run check` still passes (lint covers the script via shellcheck if configured; keep the script clean). `docs/development.md` names the job and the command.

## Repository: api
Files: `scripts/compose-e2e.sh` (new, executable), `.github/workflows/ci.yml`, `docs/development.md`; `docs/install.md` and `compose.yaml` only if the test finds a documented error.
Behavior: as in "Required behavior" above.
Checks: `npm run check`; `docker compose config --quiet` with `.env.example`; run the script when Docker is available, otherwise rely on the CI job and state in the PR that it ran only there.
Completion evidence: PR with the `compose-e2e` job green, and the working tree clean after a run (`compose/checks.json` restored, no `.env` left behind if the script created it).
