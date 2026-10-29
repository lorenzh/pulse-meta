# Spec: Docker images and one-command start (#109)

## Goal
pulse runs with `docker compose up`: four small, non-root production images (api, probe, status, notify) and one Compose file that gives a working status page with an example check.

## Scope
- A `Dockerfile` and `.dockerignore` in probe, status, notify and api.
- A Compose file, example configuration (`.env.example`, example checks, example notify config) and Compose docs in the **api** repository (meta cannot hold it; api owns the database volume, checks file and tokens file).
- A `docker build` job in each of the four `ci.yml` files (no push).
- README updates in all four.

## Non-goals
- No registry push, tagging for a registry, or release workflow.
- No change to the shared workflow in `pulse-config`, to `contract`, or to service behavior (no new env vars such as `PULSE_TOKENS`).
- No multi-location probes, no change to the quorum rule (two locations must report down, so one probe cannot open an incident; document this).
- No read-only-root or capability hardening (optional).
- The pulse-meta README is not changed here; follow-up if it should point to the Compose file.

## Current behavior (from `main` of each repository)
- All four services run TypeScript directly (`node src/main.ts`, Node >= 24). No build step, no `dist`. Images copy `src`.
- Production dependency: `@lorenzh/pulse-contract` (a `github:` dependency; `npm ci` needs `git` and github.com access). status also has two `@fontsource-variable` packages. `@lorenzh/pulse-config` (SonarJS tooling) is a devDependency.
- status serves `src/*.ts` modules and `public/` to the browser at runtime, so its image needs `src` (without tests) and `public`.
- HTTP: api `PORT` 3000 (`GET /checks` is public), status `PORT` 8080 (`GET /`). probe and notify have none.
- The API exits at startup unless `PULSE_TOKENS_FILE` has at least one token (>= 16 characters, not a placeholder from `tokens.example.json`). The probe's `PULSE_LOCATION` must equal its token's location, else 403.
- The probe fetches its checks from the API once at startup, so check changes need `docker compose restart probe` after the API has the new file.
- notify requires `PULSE_NOTIFY_CONFIG`; it writes `PULSE_NOTIFY_STATE` and `file` channel paths.

## Required behavior
Images (all four):
- Multi-stage on `node:24-alpine`: build stage installs `git`, runs `npm ci --omit=dev` with no secrets and no `GITHUB_PACKAGES_TOKEN`; the final stage copies only `node_modules`, `package.json` and `src` (status also `public`). No dev dependencies, `*.test.ts`, `test/`, lint/tooling configs, SonarJS.
- `.dockerignore` excludes `.git`, `node_modules`, tests, `test/`, `biome.json`, `eslint.config.js`, `lefthook*.yml`, `tsconfig*.json`, `.env*`, local databases.
- Runs as the non-root `node` user; `CMD ["node","src/main.ts"]`.
- `HEALTHCHECK` for api (`GET /checks`) and status (`GET /`) using `node -e "fetch(...)"`; none for probe and notify.
- api image: `/data` created and owned by `node`, `ENV PULSE_DB=/data/pulse.db`, `EXPOSE 3000`. status: `EXPOSE 8080`. notify image: `/data` owned by `node`, `ENV PULSE_NOTIFY_STATE=/data/notify-state.json`.
- Local image names only (`pulse-<name>:local`).

Compose (api repo, `compose.yaml`):
- Services `api`, `probe` (one), `status`, `notify`. probe, status, notify build from git URL contexts (`https://github.com/lorenzh/pulse-<name>.git#main`), api builds from `.`; no sibling checkouts, no registry.
- Named volumes: `api-data` (mounted at `/data` in api), `notify-data` (notify state; assumption, so the ledger survives restarts).
- Token: `.env.example` holds `PULSE_PROBE_TOKEN=example-token-change-me-0000` and `PULSE_LOCATION=default` with a comment that they are examples; users `cp .env.example .env`. The API's tokens file is generated from the same two variables with a Compose `configs:` entry using `content:` interpolation (Compose >= 2.23; document the minimum version). The probe gets `PULSE_PROBE_TOKEN` and `PULSE_LOCATION` from the environment. No api behavior change.
- Example checks file (`compose/checks.json`): one HTTP check against `http://status:8080/` (reachable in Compose, works offline). Mounted read-only into api via `PULSE_CHECKS_FILE`.
- Example notify config (`compose/notify.json`): one `file` channel at `/data/incidents.jsonl`, no webhook, no secret. Mounted read-only.
- status published on host port 8080 (`8080:8080`); api not published, or only `127.0.0.1:3000:3000`. `depends_on` with `condition: service_healthy` for api; `PULSE_API_URL=http://api:3000` for the others.
- All settings overridable through environment/`.env`.

CI (each of the four repos): a new job in the repo's `ci.yml` alongside the existing `uses:` job: checkout, `docker build` (or `docker/build-push-action` pinned by SHA with `push: false`), `permissions: contents: read`, no login, no secrets. Pins follow the existing style in `ci.yml`.

READMEs: each service documents its image (build and run command, non-root user, healthcheck, image defaults such as `PORT` and `PULSE_DB=/data/pulse.db`) and keeps its existing settings table as the single source. The api README documents the Compose file, port, token flow, all settings together (by linking each service's table), example-token warning, how to add checks (edit `compose/checks.json`, `docker compose up -d` recreate api, then `docker compose restart probe`), the quorum note, and `docker compose down`/`up` keeping data.

## Risks
- Compose in api depends on the Dockerfiles on the other repos' `main`, so api is built last. The fan-out must not start api first.
- Git-URL contexts build `main` of the others, not in-flight branches.
- `npm ci` in docker build needs github.com; no `.npmrc` token must be copied into the image (`.npmrc` stays out of the final stage; verify it is not needed to install production dependencies).
- Experimental `node:sqlite` warning at api start is expected.
- Example token is public; the README says to change it.

## Acceptance evidence
On a clean machine with Docker and Compose v2, in an api checkout: `cp .env.example .env && docker compose up --build`:
1. Four containers start, none with uid 0; `docker compose ps` shows api and status healthy.
2. `http://localhost:8080` shows the example check, with a state other than `unknown` after the first interval.
3. The API stores a probe result; the probe logs no rejection; `POST /results` without a token returns 401.
4. `docker compose down` then `up` keeps the database.
5. In each image `npm ls --omit=dev` shows no dev dependencies and `find . -name "*.test.ts"` is empty; no eslint or sonarjs files.
6. Each repo's CI runs `docker build` with no push or login; `git grep` finds only marked example tokens.

## Repository: probe
- Files: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `README.md`.
- Image per "Images": no HEALTHCHECK, no EXPOSE; env `PULSE_API_URL`, `PULSE_LOCATION`, `PULSE_PROBE_TOKEN` documented and not set to a real value in the image.
- CI job builds the image. Checks: `npm run` checks of the repo still pass; `docker build` succeeds.
- Evidence: PR with Dockerfile, CI green including the build job, README section "Docker".

## Repository: status
- Files: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `README.md`.
- Image includes `src` (no tests) and `public`, production dependencies including the fontsource packages; `EXPOSE 8080`; HEALTHCHECK on `GET /`.
- Evidence: built image serves `/` and a font file; CI green with build job; README "Docker".

## Repository: notify
- Files: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `README.md`.
- Image per "Images": `/data` owned by `node`, `PULSE_NOTIFY_STATE=/data/notify-state.json`; no HEALTHCHECK; `PULSE_NOTIFY_CONFIG` required, no example secret in the image.
- Evidence: CI green with build job; README "Docker" including the `/data` path and mounting a config.

## Repository: api
Depends on probe, status and notify (their Dockerfiles must be on `main` for the Compose build contexts).
- Files: `Dockerfile`, `.dockerignore`, `compose.yaml`, `.env.example`, `compose/checks.json`, `compose/notify.json`, `.github/workflows/ci.yml`, `README.md`; `.gitignore` gets `.env`.
- Image per "Images" with `/data`, `PULSE_DB`, healthcheck on `GET /checks`, `EXPOSE 3000`.
- Compose per "Compose" above; add a CI step that runs `docker compose config` to validate it (no `up`).
- Evidence: CI green with image build and Compose validation; the acceptance run above documented in the PR description; README sections for Compose, settings, token, ports, adding checks.
