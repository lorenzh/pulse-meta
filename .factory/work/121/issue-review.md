# Issue review #121: Docker polish

Verdict: specifiable, no hold needed.

## Findings in the repositories (main)
- The Compose file is `compose.yaml` in `api` (with `compose/checks.json`, `compose/notify.json`, README section "Docker and Compose"). It builds probe, status and notify from `https://github.com/lorenzh/pulse-<x>.git#main`. Meta has no Compose file.
- `.dockerignore` today: api, probe, status and notify already list `**/*.test.ts` (probe/status/notify also `test`, `**/test`). The issue's premise (probe/status ship `src/*.test.ts`) looks already fixed or stale; verify at plan time. Missing: test helpers (none found in `src/` of any repo; notify has `src/channels`, tests under `test/`), and the CI check.
- No repo CI builds the Docker image or checks its content (`.github/workflows/ci.yml` only).
- probe `depends_on: api: service_healthy`; status has a HEALTHCHECK (`GET /`, interval 30 s, start-period 10 s). The probe has no healthcheck and the example check targets `http://status:8080/` (10 s interval).
- Ports: api `127.0.0.1:3000:3000`, status `8080:8080`. README documents `docker compose up --build` only.

## Open points / assumptions
1. Target mapping: Compose changes (probe waits for status, port variables, `.env.example`, README) go to `api`. `.dockerignore` and image-content CI step go to `api`, `probe`, `status`, `notify` (issue says "every service"). `config` and `contract` have no image: out of scope. Assumed no `contract` change.
2. Status healthcheck interval is 30 s: with `condition: service_healthy` the first healthy state may take up to ~30 s after start-period (Compose runs the first check at start, then per interval; a pass on the first check after the server is up is likely, but the status container waits for api health first). Acceptable; do not change the healthcheck unless needed (it lives in the status Dockerfile, which is "settings in the container", so avoid). Plan should decide whether a Compose-level `healthcheck` override with `start_interval`/shorter interval is better.
3. Even after status is healthy, the first probe run may still land before status has data from api; "first result is `up`" only needs status to answer `GET /`. Assumed that is enough.
4. Status `depends_on` api healthy stays; probe gets `depends_on` api and status, both `service_healthy`.
5. Port variable names: `PULSE_STATUS_PORT` (default 8080) and `PULSE_API_PORT` (default 3000), keeping `127.0.0.1` for api. Status stays on all interfaces as today. Only the published (host) side changes; the container side stays 8080/3000. Document in `.env.example` (commented) and README. A Compose `${VAR:-default}` is enough.
6. Image test check: a CI step builds each image and fails if `find / -name '*.test.ts'` (excluding `/proc`, `node_modules`) in the image finds a file. Assumed to run per repo in `ci.yml` (docker build, then `docker run --rm --entrypoint sh <img> -c ...`), plus for the Compose-built set in `api`. Node `node_modules` may contain third-party `*.test.*` files; the check should be limited to `/app/src` and `/app` outside `node_modules`.
7. Because probe/status/notify are built from `main`, the Compose change in api can only be verified end-to-end after their `.dockerignore` changes are merged. Child ordering: independent builds, but api acceptance depends on the others being on main (noted; blocked-by from api to the three others would be reasonable, or accept that the final check happens after all merges).
8. "Test helpers" has no concrete file list; assumed patterns `**/*.test.ts`, `**/test/`, `**/*.spec.ts`, `**/*.fixture.*`/`**/__fixtures__`, `**/*.mock.ts` are harmless to add.
9. README must say `docker compose up -d --build` runs it in the background and how to set ports (`.env` or inline, e.g. `PULSE_STATUS_PORT=8090 docker compose up -d --build`); mention the README says "Open http://localhost:8080" so the text should refer to the configured port.

## Derived acceptance check
- On a clean checkout with `.env` from `.env.example`: `docker compose up -d --build` starts api, probe, status, notify; `docker compose ps` shows api and status healthy before probe starts.
- The first result of the example check (`GET /checks` on api, or the status page) is `up`; the page has no red bar and uptime is 100 %.
- For each of the four images, `docker run --rm --entrypoint sh <image> -c "find /app -name '*.test.ts' -not -path '*/node_modules/*'"` prints nothing; the CI step fails when a test file is added to the image.
- `PULSE_STATUS_PORT=8090 docker compose up -d --build` serves the status page on http://localhost:8090 and not on 8080; `PULSE_API_PORT` changes the api host port, still bound to 127.0.0.1; without variables ports are 8080 and 127.0.0.1:3000.
- Containers still run as non-root; no container settings, base image or service behaviour changed.
