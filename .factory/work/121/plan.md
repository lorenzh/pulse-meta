# Spec #121: Docker polish

## Goal
`docker compose up -d --build` on a clean checkout starts api, probe, status and notify; the first result of the example check is `up`; no image contains a test file; host ports are configurable.

## Scope
- `api`: `compose.yaml`, `.env.example`, `README.md`, `.dockerignore`, CI image check.
- `probe`, `status`, `notify`: `.dockerignore` and CI image check.
- Non-goals: `config` and `contract` (no image); service behaviour, in-container settings (Dockerfile `HEALTHCHECK`, `ENV`, `USER`), base image, Dockerfile content.

## Current state (main, verified)
- `.dockerignore` of api, probe, status and notify already lists `**/*.test.ts`. The issue's premise (tests shipped in probe/status images) is stale on `main`; each image only copies `src` and tests sit in `src/*.test.ts`. What is missing is the CI guard and the other test-helper patterns. Do not remove existing entries.
- Compose file is `api/compose.yaml`. Probe `depends_on` only api (healthy). Status has a Dockerfile healthcheck (interval 30 s, start-period 10 s). Ports are literal: api `127.0.0.1:3000:3000`, status `8080:8080`. README documents only `docker compose up --build`.
- Each repo's CI has a `docker` job that only builds the image.

## Required behavior
1. Every service's `.dockerignore` excludes `**/*.test.ts`, `**/*.spec.ts`, `**/test`, `**/__fixtures__`, `**/*.mock.ts` (keep the existing entries; add only what is missing). No test file may be excluded in a way that breaks `src` runtime files.
2. CI `docker` job in each of the four repos: after the build, run `docker run --rm --entrypoint sh <image> -c "find /app -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) -not -path '*/node_modules/*'"` and fail when the output is not empty. `node_modules` is excluded because third-party packages may ship such files. Use the same check shape in all four repos.
3. Compose: probe `depends_on` api and status, both `condition: service_healthy`.
4. Compose-level healthcheck override for `status` (only `interval: 5s`; the `test`, timeout and retries stay inherited from the image) so the stack does not wait up to 30 s for the first check. This changes no container setting and no Dockerfile. If Compose cannot merge a partial override with the image healthcheck, drop the override and accept the 30 s wait; do not edit the status Dockerfile.
5. Ports: api `"127.0.0.1:${PULSE_API_PORT:-3000}:3000"`, status `"${PULSE_STATUS_PORT:-8080}:8080"`. Container side unchanged.
6. `.env.example` gets commented lines `# PULSE_API_PORT=3000` and `# PULSE_STATUS_PORT=8080` (comments keep defaults in force).
7. README (api), section "Docker and Compose": say `docker compose up -d --build` runs the stack in the background; show how to change ports (`.env` or `PULSE_STATUS_PORT=8090 docker compose up -d --build`); the URL text refers to the configured status port (default 8080), and the api port stays bound to 127.0.0.1. Mention the probe waits for api and status to be healthy.

## Constraints
- Images stay non-root, no secrets in images, no base image change, no behaviour change.
- CI must keep passing: `docker compose config --quiet` in the api job must still work with `.env` copied from `.env.example`, and with no port variables set.

## Risks
- Probe, status and notify are built from `main` by Compose, so the end-to-end check in `api` is only meaningful after the other three PRs are merged. The api child's own CI check covers its image and `compose config`; the end-to-end run is done by a person after all merges.
- The first probe result could still precede status data; only status answering `GET /` is required, which the healthcheck wait ensures.

## Acceptance evidence
- Each repo's CI `docker` job fails when a `src/x.test.ts` is added to the image context and passes otherwise (show the step in the PR; a local run with `docker run ... find` printing nothing).
- `docker compose config` shows probe `depends_on` api and status as `service_healthy`, and ports `127.0.0.1:3000` and `8080` by default; with `PULSE_STATUS_PORT=8090` it shows `8090:8080`; with `PULSE_API_PORT=3001` it shows `127.0.0.1:3001:3000`.
- After merges: `PULSE_STATUS_PORT=8090 docker compose up -d --build` serves the page on 8090, the first example result is `up`, and containers run as non-root.

## Repository: probe
Files: `.dockerignore`, `.github/workflows/ci.yml`. Implement requirements 1 and 2 (image `pulse-probe:local`, app dir `/app`). Evidence: CI `docker` job with the content check green; `.dockerignore` diff.

## Repository: status
Files: `.dockerignore`, `.github/workflows/ci.yml`. Implement requirements 1 and 2 (image `pulse-status:local`; `public` is still copied). Evidence: same as probe. Do not touch the Dockerfile healthcheck.

## Repository: notify
Files: `.dockerignore`, `.github/workflows/ci.yml`. Implement requirements 1 and 2 (image `pulse-notify:local`). Keep `test` excluded. Evidence: same as probe.

## Repository: api
Files: `.dockerignore`, `.github/workflows/ci.yml`, `compose.yaml`, `.env.example`, `README.md`. Implement requirements 1 to 7 (image `pulse-api:local`); the CI also runs `docker compose config` with `PULSE_STATUS_PORT=8090` and checks that the output contains `published: "8090"`. Evidence: CI green, `docker compose config` outputs as listed under acceptance evidence, README diff.
