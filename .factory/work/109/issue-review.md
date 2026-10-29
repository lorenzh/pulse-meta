# Issue review: #109 Docker images and one-command start

Verdict: specifiable. No hold needed; open points below get a default in the plan.

## Findings from the repositories (current `main`)

- api, probe, status, notify run TypeScript directly (`node src/main.ts`, Node >= 24 type stripping). There is no build step and no `dist`, so an image copies `src` and runs it.
- Production dependencies:
  - api, probe, notify: `@lorenzh/pulse-contract` only. status: contract plus two `@fontsource-variable` packages (the fonts are served from `node_modules`).
  - `@lorenzh/pulse-contract` is a `github:` dependency (git URL in `package-lock.json`). `npm ci --omit=dev` in a build stage needs `git` (not in `node:24-slim` or `node:24-alpine`) and network access to github.com. `dist/` is committed in contract. `.npmrc` references `GITHUB_PACKAGES_TOKEN` for `@paragondata`, which no production dependency uses.
  - `@lorenzh/pulse-config` (devDependency, holds the SonarJS tooling) must not be installed. `--omit=dev` does that; also check the `.npmrc` `install-strategy=nested` mentioned in the api README.
- Source files that must not be in the image: `*.test.ts`, `test/`, lint and tooling configs (`biome.json`, `eslint.config.js`, `lefthook*.yml`, `tsconfig*.json`). The status server reads and serves `src/*.ts` modules to the browser at runtime (`/render.js`, `/poller.js`, `/theme.js`, `/validate.js`) and `public/`, so status needs `src` (without tests) and `public`. A `.dockerignore` per repository is needed.
- HTTP endpoints:
  - api (`PORT` 3000): no dedicated health route. `GET /checks` is public and cheap and can serve as the healthcheck.
  - status (`PORT` 8080): `GET /` works.
  - probe and notify: no HTTP endpoint, so no `HEALTHCHECK` (the issue says "where the service has an HTTP endpoint").
  - Slim Node images have no `curl` or `wget`; the healthcheck must use `node -e fetch(...)`.
- Settings (already documented per README): api `PORT`, `PULSE_DB`, `PULSE_CHECKS_FILE`, `PULSE_TOKENS_FILE`; probe `PULSE_API_URL`, `PULSE_LOCATION`, `PULSE_PROBE_TOKEN`; status `PORT`, `PULSE_API_URL`, `POLL_MS`, `PULSE_STATUS_THEME/NAME/LOGO`; notify `PULSE_NOTIFY_CONFIG` (required), `PULSE_API_URL`, `PULSE_NOTIFY_STATE`, `PULSE_NOTIFY_POLL_MS`, `PULSE_NOTIFY_RETRY_DELAY_MS`, `PULSE_NOTIFY_TIMEOUT_MS`.
- Probe tokens (#107, merged): the API requires `tokens.json` with at least one entry and exits at startup otherwise. Tokens must be at least 16 characters, and the placeholder values in `tokens.example.json` are rejected. Compose therefore cannot reuse `tokens.example.json` as is. The probe's `PULSE_LOCATION` must equal the token's location, or every result gets 403.
- The API reads tokens only from a file (`PULSE_TOKENS_FILE`), not from an env var. The probe reads its token from `PULSE_PROBE_TOKEN`. One value must reach both containers with no secret in the repository.
- `checks.example.json` uses `http://localhost:9000/` as the example check. Inside Compose `localhost` is the probe container, so the example check for Compose must target something reachable, such as the status service itself (`http://status:8080/`) or a public URL. Prefer an in-Compose target so that `docker compose up` works offline and the check is reliably up. The example checks file also contains a TLS check to `example.com:443` and a maintenance window; the Compose example should use its own smaller file.
- Probe fetches its checks from the API (`GET /checks`), so only the API needs the checks file.
- Quorum: the API declares a check down only when at least two locations report it down (probe README). One probe is what the issue asks for, so a single probe cannot open an incident. Document this; do not change it.
- CI: each target's `ci.yml` is only `uses: lorenzh/pulse-config/.github/workflows/check.yml@<sha>`. A docker build job must be a new job in each target's own `ci.yml` (`docker build`, no push, `permissions: contents: read`). Changing the shared workflow in pulse-config is not requested and would need a pin bump. Not touching pulse-config.
- Target list: `contract`, `probe`, `api`, `status`, `notify` are targets. `config` is cloned read-only as context only. The meta repository cannot hold the Compose file.

## Open points and defaults for the plan

1. **Where the Compose file lives.** The issue leaves it to the plan. Default: the `api` repository. Reasons: it owns the database volume, the checks file and the tokens file, and it is the service the others depend on. Compose cannot build the other services from their own repositories without relative paths, so it must either use build contexts from git URLs (`https://github.com/lorenzh/pulse-probe.git#main`) or `image:` names for locally built images. Default: git-URL build contexts, no registry. The plan must pick one and document it; with git-URL contexts the Compose file does not need sibling checkouts.
2. **Dependency order and ownership.** Compose in `api` depends on the other three Dockerfiles existing on their `main`. Default: the api child is blocked by probe, status and notify, so the others come first. They are independent of each other, and `dependsOn` should say so. (This is the reverse of the usual api-first order. Say it in the spec so the fan-out does not start api first.)
3. **Token handling in Compose.** Default: Compose reads `PULSE_PROBE_TOKEN` from an `.env` file or the environment, with an `.env.example` holding a clearly marked example value of at least 16 characters (for example `example-token-change-me-0000`). The API needs the same value as a file; options are an entrypoint step that writes `tokens.json` from `PULSE_PROBE_TOKEN` and `PULSE_LOCATION`, a Compose `configs:` entry, or a file mounted from the repository. Default: a Compose `configs`/mounted `tokens.example`-style file is not possible for the secret to be shared with the probe, so the spec must choose. Recommend: the Compose file generates the API's tokens file from the same two variables via `configs: content:` with interpolation (Compose 2.23+), or the API entrypoint reads a new `PULSE_TOKENS` env var. The second changes api behavior; the first does not. Default to the first and document the minimum Compose version.
   - The example token must pass the API validation (>= 16 characters and not one of the rejected placeholders) so that `docker compose up` works with the example configuration. Mark it as an example in the name and a comment.
4. **Port.** Default: status published on host port 8080 (documented). The API is not published by default, or only on 127.0.0.1:3000, since results tokens travel in clear.
5. **Volumes and non-root.** A named volume for the API database must be writable by the non-root user (create and `chown` `/data` in the image, set `PULSE_DB=/data/pulse.db`). notify needs a writable state path (`PULSE_NOTIFY_STATE`, and the `file` channel path); default a `/data` directory in its image, with its own named volume so the ledger survives restarts (otherwise the first-start seeding repeats). The issue asks only for the API volume; the notify volume is an assumption.
6. **notify configuration in Compose.** `PULSE_NOTIFY_CONFIG` is required. Default: an example config with one `file` channel (no webhook URL, no secret), mounted read-only.
7. **Base image.** Node 24 `slim` (Debian) or `alpine`. Default: `node:24-alpine`... except `git` is needed for the `github:` dependency in the build stage: install it in the build stage only (`apk add git`), multi-stage, copy only `node_modules` and `src` to the final stage. Pin by major tag; digest pinning is not required.
8. **`node:sqlite`.** Present in Node 24 (experimental warning expected). The warning is not a failure.
9. **CI build detail.** `docker build` needs outbound access to github.com for the contract dependency. GitHub-hosted runners have it. No `GITHUB_PACKAGES_TOKEN` is passed into the build and none must be baked in; build with `--no-cache`-agnostic settings and no secrets. Use a `docker build` step (`docker/build-push-action` with `push: false` is acceptable).
10. **README scope.** Each service README documents its image, build and run command and settings (settings tables exist already; the plan keeps them as the single source and adds image-specific defaults such as `PORT`, `PULSE_DB=/data/pulse.db`). The Compose repository's README documents the Compose file, all settings together, the token, ports, how to add checks (edit the checks file and restart api; probe picks them up on its start only, because it fetches checks at startup — check this against the probe code in the plan and document `docker compose restart probe`).
11. **Meta repository.** `README.md` of pulse-meta has a local run guide (last commit "Document probe tokens in the local run guide"). Docs there are only updated by a spec PR; not part of the target work. Mention a follow-up if the README should point to the Compose file.
12. **Contract and config targets.** Neither needs a Dockerfile (no service). The `contract` target is not listed in the issue: no changes.

## Assumptions

- "One probe" means a single probe with `PULSE_LOCATION=default`-style location matching its token; no multi-location setup in Compose.
- Image names are local only (for example `pulse-api:local`); nothing is tagged for a registry.
- The Compose file uses the `docker compose` v2 CLI.
- The healthcheck uses Node's `fetch`, not extra OS packages.
- Hardening beyond non-root (read-only root filesystem, dropped capabilities) is optional and not required.

## Derived acceptance check

On a clean machine with Docker and Compose v2, from a checkout of the repository that holds the Compose file:

1. `cp .env.example .env` (if the plan uses it) and `docker compose up --build` starts four containers (api, one probe, status, notify) without errors; none runs as root (`docker compose exec <svc> id -u` is not 0).
2. `docker compose ps` shows api and status `healthy`.
3. `http://localhost:8080` shows the example check, and after the first probe interval it has a state (not `unknown`).
4. API logs show a stored result; a result from the probe was accepted with the token (no "token rejected" log in the probe). Posting to `/results` without a token returns 401.
5. `docker compose down` followed by `up` keeps the database (named volume).
6. In every image: `npm ls --omit=dev` lists no dev dependencies, and there are no `*.test.ts`, `test/`, `eslint` or `sonarjs` files (`docker run --rm <image> sh -c 'find . -name "*.test.ts"'` is empty).
7. In each of api, probe, status, notify the CI runs `docker build` and fails when the Dockerfile is broken; no registry login or push step exists; `git grep` shows no real secret, only marked example tokens.
