# Spec: E2E fixtures leaked into the regular Compose stack (#337)

## Goal
`cp .env.example .env && docker compose up -d --build` starts only the four services (`api`, `probe`, `status`, `notify`) with the user-facing example check, and shows no down check and no incident. The e2e fixtures move to files used only by `scripts/compose-e2e.sh`.

## Scope
Only the `api` target changes: `compose.yaml`, new `compose.e2e.yaml`, `compose/checks.json`, new `compose/e2e/checks.json`, `scripts/compose-e2e.sh`, `docs/install.md`, `docs/development.md`, `docs/rest-api.md`. The docs named in the issue live in `pulse-api`.

## Non-goals
- No change under `src/` or in any other target.
- No new heartbeat example in the regular checks file (an unpinged heartbeat would recreate the bug).

## Required behavior
- Regular stack: `compose/checks.json` holds only `status-page`; `compose.yaml` has no `e2e-target`, no `depends_on: e2e-target`, no `SVC_TOKEN` and no `E2E_SVC_TOKEN`.
- `compose.e2e.yaml` (merged after `compose.yaml`) holds: the `e2e-target` service (`node:24-alpine`, mounts `compose/e2e/target.mjs`, `SVC_TOKEN: ${E2E_SVC_TOKEN:-e2e-svc-token-sentinel}`), the probe's `SVC_TOKEN: Bearer ${E2E_SVC_TOKEN:-e2e-svc-token-sentinel}` and `depends_on: e2e-target (service_started)`, and an `api` volume override mounting `./compose/e2e/checks.json` at `/config/checks.json:ro` (Compose merges volumes by target path, so it replaces the regular mount).
- `compose/e2e/checks.json` holds `status-page` (a plain copy of the regular one; accepted duplication), `e2e-post` and `heartbeat-e2e`, unchanged from today.
- `scripts/compose-e2e.sh`:
  - `export COMPOSE_FILE=compose.yaml:compose.e2e.yaml` so every `docker compose` call (`config`, `ps`, `exec e2e-target`, `logs`, `down`, `--profile demo`) sees the merged stack.
  - `checks_file=compose/e2e/checks.json`; the backup, restore and `e2e-api` reload logic work on that file. `compose/checks.json` is never modified.
  - Guard, early in Setup before `up`: fail unless `jq -e '[.checks[].id | select(test("e2e"))] | length == 0' compose/checks.json`. This covers `e2e-` ids and `heartbeat-e2e`. Also assert with `COMPOSE_FILE=compose.yaml docker compose config --services` that neither `e2e-target` is listed and the services are exactly the four plus the demo ones under `--profile demo`.
  - All existing steps (heartbeat, HTTP options, reload, persistence, clean stop, demo) keep passing; the demo cleanup stays as is.
- Docs:
  - `docs/install.md`: describe that the example checks file is `compose/checks.json` (only `status-page`), and that e2e fixtures live in `compose.e2e.yaml` and `compose/e2e/`; fix the status healthcheck row to `GET /healthz` (confirm in `.repos/status`).
  - `docs/development.md`: describe the split, the merged `COMPOSE_FILE`, the guard, and that the heartbeat secret lives in `compose/e2e/checks.json`.
  - `docs/rest-api.md`: add `GET /probe/checks` and `GET|POST /heartbeat/:id[/:secret]` to the overview table, taking auth, response type and status from the existing sections.

## Risks
- Compose volume merge semantics: verify with `docker compose -f compose.yaml -f compose.e2e.yaml config` that `/config/checks.json` maps to the e2e file only.
- Other references to `compose/checks.json` or `e2e-target` (grep `.github/workflows`, README, docs, `lefthook.yml`, `package.json`) must be updated.
- The e2e no longer runs against the regular checks file; the guard plus the shared services cover that.

## Acceptance evidence
1. Regular stack: `docker compose config --services` lists exactly `api`, `probe`, `status`, `notify`; `compose/checks.json` has only `status-page`; about 30 s after start `GET /checks` shows no `down` and `GET /incidents` is empty.
2. `bash scripts/compose-e2e.sh` exits 0, uses both Compose files, fails when an `e2e` id is added to `compose/checks.json`, and leaves `git status` clean.
3. Docs updated as above; `git diff --stat` shows no change under `src/`.

## Repository: api
Files: `compose.yaml`, `compose.e2e.yaml` (new), `compose/checks.json`, `compose/e2e/checks.json` (new), `scripts/compose-e2e.sh`, `docs/install.md`, `docs/development.md`, `docs/rest-api.md`.
Behavior and checks: as in "Required behavior". Run `npm` lint/check scripts that the repo's AGENTS.md lists, and `bash scripts/compose-e2e.sh` when Docker is available.
Completion evidence: the acceptance items 1 to 3 above.
