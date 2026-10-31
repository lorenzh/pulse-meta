# Spec #528: pulse-deploy Compose setups (minimal, full, demo, dev)

## Goal

Put every way to run pulse with Docker Compose into one place, pulse-deploy. It gets four ready-made setups, each started with `docker compose -f <setup>/compose.yaml up -d`:

| Setup | Services |
| --- | --- |
| `minimal` | api, probe |
| `full` | api, probe, status, notify, console |
| `demo` | full, plus seeded demo checks, a target that goes down on purpose, and a mail catcher |
| `dev` | full, built from sibling checkouts |

Every setup except `dev` uses the published images (#527), pinned by version and digest in one file. CI tests each setup. The Compose end-to-end test moves from pulse-api to pulse-deploy. pulse-api then keeps only what its own CI needs.

Sources: the issue, the lead's decision in the issue comments (A is done, with five literal `0.1.0` pins), and `.factory/work/528/issue-review.md`. The review's facts were re-read in the clones under `.repos/` (main as of 31 Oct). The `v0.1.0` tag of each service is that `main` HEAD.

## Scope

- **deploy:**
  - the four setups and one shared service file that holds every image pin;
  - a secrets mechanism with `0600` host files;
  - per-setup `.env.example`, config files and a README;
  - scripts: secret creation, readiness wait, image bump and verify;
  - the moved e2e test;
  - CI with one job per setup;
  - the repository's base files (`AGENTS.md`, `CLAUDE.md`, `.gitignore`).
- **api:**
  - remove `compose.yaml`, `compose.e2e.yaml`, `compose/`, `.env.example`, `scripts/compose-e2e.sh`, `scripts/outage-history.sh` and `src/outage-history.test.ts`;
  - drop the `compose-e2e` job and the Compose steps of the `docker` job;
  - point the docs to pulse-deploy.
- **meta (this spec PR):**
  - add the two new third-party images to `docs/approved-packages.md`;
  - point README "Run all of pulse with Docker Compose", the repository table and `docs/architecture.md` to pulse-deploy.

## Non-goals

- The `pulse` CLI wizard (#529).
- Kubernetes or any other orchestrator.
- Renovate. See "Keeping pins current" for why.
- Any change to a service image or its code. Everything below works with the `0.1.0` images as published.
- Wiring an admin token into `full`. The console makes no API call yet (`console/docs/configuration.md`, "Admin token"). The api admin routes stay off by default. The full README explains how to opt in.
- Updating the stale Compose references in status, console and website. Those repositories are not targets of this issue, so they go to a follow-up issue (see Risks).

## Decisions on the review's open points

1. **Layout:**
   - One directory per setup, each with its own `compose.yaml`: `minimal/`, `full/`, `demo/`, `dev/`.
   - Shared service definitions live in `common/services.yaml`. Each setup service reuses them through `extends: { file: ../common/services.yaml, service: <name> }`.
   - Profiles are not used. `-f <setup>/compose.yaml` alone must select the setup.
   - Verified on Docker Compose v2.38.2 in this run:
     - `extends` from another file carries `image`, `security_opt`, `cap_drop` and `depends_on`.
     - A relative host path in an override file (`-f full/compose.yaml -f e2e/compose.e2e.yaml`) resolves from the directory of the first file (`full/`).
     - A long-syntax bind with `bind.create_host_path: false` and a missing source fails `up` with `bind source path does not exist`.
2. **One place to bump versions:**
   - `common/services.yaml` holds every `image:` line of the non-dev setups. That covers the five pulse images and the third-party images: `oven/bun`, `alpine/openssl`, `axllent/mailpit`.
   - No other file in the repository holds a version or digest of these images: not `check-setup.sh`, not `bump-images.sh`, not CI. The static checks test the *shape* of a pin (regex plus an allowed image name), never its value. So a bump edits exactly one file and every check stays green without a second edit.
   - The check that the first pins equal the lead's five literals is a one-time check of the deploy PR (completion evidence 6), not a permanent rule.
   - No setup file has an `image:` line, except `dev` with its local `pulse-<svc>:dev` tags.
   - This needs no `--env-file` or extra flag.
   - `common/services.yaml` has no host paths, so its relative-path resolution never matters.
3. **Keeping pins current: a scripted bump, no Renovate.**
   - Renovate is not approved, and it needs a GitHub App install, which is an owner step.
   - A scheduled workflow that opens PRs with `GITHUB_TOKEN` would start no CI.
   - So the bump is `scripts/bump-images.sh <svc>=<version> ...`. A person runs it, or a later Factory issue does. It resolves the digest anonymously from ghcr.io and rewrites the line in `common/services.yaml`.
   - `scripts/bump-images.sh --verify` runs in PR CI. It checks that every pinned digest equals the registry's digest for that tag.
   - `scripts/bump-images.sh --check-latest` runs in a weekly scheduled job with `contents: read` only. It fails when a higher `x.y.z` release exists for a service, which notifies the maintainer through the failed run.
4. **0600 secrets vs the container user `bun` (uid 1000):**
   - A one-shot `secrets-init` service reads the host directory and copies the secrets into per-consumer named volumes. Each copy is owned by `1000:1000` with mode `0400`.
   - The host directory is `${PULSE_SECRETS_DIR:-../secrets}`, a read-only bind with `create_host_path: false`.
   - `secrets-init` runs with the `oven/bun` image as root, `network_mode: none`, `cap_drop: [ALL]` and `cap_add: [CHOWN, DAC_OVERRIDE, FOWNER]`.
   - It derives the api `tokens.json` from `secrets/probe-token` and `PULSE_LOCATION`, so the token is written by hand in exactly one place.
   - Compose `secrets:` with `uid`/`mode` is not used, because the host file's owner and mode survive a bind mount (review point 4).
5. **Network exposure:** "Host ports" below lists every published port per setup.
   - minimal publishes the api on loopback, because it has no status page. That is the documented exception.
   - full publishes the api nowhere.
6. **Demo content:**
   - The deploy demo replaces pulse-api's `demo` profile and keeps all its content: two probes (`eu`, `us`), the TLS check, maintenance, degraded and flaky checks, and every status-page state within five minutes.
   - It adds notify, console, the mail catcher and one new check, `down-on-purpose`, whose target stays down. So an incident stays open for as long as the demo runs.
7. **Demo secrets:**
   - Generated at start. `secrets-init` in generate mode writes a random 32-byte hex token per demo location into the volumes.
   - It keeps existing valid tokens on a rerun, so `up` again changes nothing.
   - The demo has no host secret file, no public token and no prompt.
8. **"Delivered test notification":**
   - An incident `DOWN` email from the notify email channel, found in the mail catcher's HTTP API.
   - notify has no test-send command, and this needs no notify change. An SMTP channel with `tls: "none"` and no login to a non-loopback host is allowed (`notify/src/config.ts:139`).
9. **Mail catcher:**
   - `axllent/mailpit:v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498`.
   - MIT licence, released 22 Oct 2026, a multi-arch index with linux/amd64 and linux/arm64. Digest read from Docker Hub in this run.
   - Its UI and API are published on `127.0.0.1:${PULSE_MAILPIT_PORT:-8025}` in the demo only.
   - It is added to `docs/approved-packages.md` in this spec PR. `alpine/openssl` (already used by pulse-api's demo) is added there too.
10. **CI per setup:**
    - minimal: readiness plus a first check result.
    - full: readiness plus the moved e2e.
    - demo: readiness plus the incident and mail assertions.
    - dev: built from sibling checkouts of each service's `main`, then readiness. It also runs on a daily schedule, which partly makes up for the coverage api loses (point 13).
11. **`outage-history.sh`:**
    - It moves to deploy as `e2e/outage-history.sh`.
    - Its five bun cases become a bash test, `e2e/outage-history.test.sh`, so deploy needs no Bun toolchain on the host.
    - api deletes the script and `src/outage-history.test.ts`.
12. **deploy base files:**
    - No pulse-config `check.yml` and no `package.json`. deploy has no TypeScript.
    - Checks:
      - `shellcheck -x` and `bash -n` on every `*.sh`;
      - `node --check` on every `*.mjs`;
      - `jq empty` on every `*.json`;
      - `docker compose -f <setup>/compose.yaml config --quiet` per setup.
    - Every action is pinned by SHA from the approved list (`actions/checkout` `3d3c42e5…` v7.0.1, `persist-credentials: false`).
13. **Coverage loss in api:**
    - A pulse-api PR is no longer e2e-tested in Compose. deploy tests released images.
    - Mitigations:
      - deploy's `dev` job runs daily against each service's `main`;
      - the `full`/e2e job runs on every deploy PR and on the image bump PR.
    - Accepted trade-off.
14. **Order:** deploy first, then api (`api` dependsOn `deploy`). The meta changes are in this spec PR (see Rollout order).
15. **Stale references** in `status/README.md:47`, `console/README.md:39`, `console/docs/configuration.md:51` and `website/src/content/facts.ts`: a follow-up issue after the api child merges. These are not targets here.
16. **Performance:** measured in the deploy CI jobs. The exact method is under "Performance impact".

## Required behavior

### Layout of pulse-deploy

```
common/services.yaml          every image pin; shared env, healthcheck, hardening; no host paths
secrets/                      gitignored; created by scripts/init-secrets.sh (0700 dir, 0600 files)
minimal/{compose.yaml,.env.example,README.md,config/checks.json}
full/{compose.yaml,.env.example,README.md,config/checks.json,config/notify.json}
demo/{compose.yaml,.env.example,README.md,init.mjs,targets.mjs,tls.sh,notify.json,theme-white-label.json}
dev/{compose.yaml,.env.example,README.md}
e2e/{compose.e2e.yaml,compose-e2e.sh,outage-history.sh,outage-history.test.sh,notify.json,target.mjs,ro/checks.json}
scripts/{init-secrets.sh,secrets-init.mjs,wait-ready.sh,bump-images.sh,check-setup.sh,measure.sh}
.github/workflows/ci.yml
README.md, AGENTS.md, CLAUDE.md, .gitignore, LICENSE (kept)
```

### Images (`common/services.yaml`)

- The first pins are the lead's literals. Each one appears exactly once in the repository, in `common/services.yaml` (no script, test or workflow repeats it):
  - `ghcr.io/lorenzh/pulse-api:0.1.0@sha256:71d623fb9e51bccdfd1f235882c69c48908960ec39e1c9b565fa700777009b18`
  - `ghcr.io/lorenzh/pulse-probe:0.1.0@sha256:c5cb30ec6efecd34e37a6047ba165e2eba57b95bbb2e8775c9c77753c6736871`
  - `ghcr.io/lorenzh/pulse-status:0.1.0@sha256:0347481776e1d511dd3bffc7c21d646b6661192e11f08997ffe54eb745e84fa4`
  - `ghcr.io/lorenzh/pulse-notify:0.1.0@sha256:a63964aa2a2b728849f76b416ac5cc90b5a95306a375c028c3d4d11afe1c9e78`
  - `ghcr.io/lorenzh/pulse-console:0.1.0@sha256:ddadc5e1eef198861731b334bee3a593e1ef29700252212a7dba9ac81087bce3`
- Third-party pins, also only in `common/services.yaml`. A third-party bump is a hand edit of that one line, using a digest from the approved list (`docs/approved-packages.md` in pulse-meta, updated first):
  - `oven/bun:1.4.0-alpine@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb`
  - `alpine/openssl@sha256:1c361a204e9791bec6202bccbd1065eafaa65cb5a1a9a06ae000238569fba6a2`
  - `axllent/mailpit:v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498`

  The `oven/bun` and `alpine/openssl` values are the ones in pulse-api's `compose.yaml` today.
- Shared definitions in `common/services.yaml`: `api`, `probe`, `status`, `notify`, `console`, `secrets-init`, `bun-tools`, `openssl`, `mailpit`.
- Hardening for the five pulse services: `security_opt: ["no-new-privileges:true"]` and `cap_drop: [ALL]`. They listen on ports above 1024 and run as `bun`.
- The five pulse services get `restart: unless-stopped`. `secrets-init` and `demo-init` get `restart: "no"`.
- `depends_on`, `ports` and `volumes` are written in the setup files, not in `common/`.

### Secrets

- **`scripts/init-secrets.sh [--dir <dir>]`:**
  - The default directory is `secrets/` at the repository root. It is created with mode `0700`.
  - It writes `probe-token` only if the file is missing. It never overwrites.
  - The token is 32 random bytes from `/dev/urandom` as 64 hex characters, written under `umask 077`, so the mode is `0600`.
  - It prints the path, never the value.
  - It needs only POSIX tools: `od`, `tr`, `head`.
- **`scripts/secrets-init.mjs`** runs in the `secrets-init` service.

  Files mode (minimal, full, dev, e2e):
  1. Reads `/in/probe-token`. `lstat` must show a regular file, not a symlink.
  2. Refuses a mode with any group or other bit set (`mode & 0o077 != 0`).
  3. Drops one trailing newline. The content must match `^[\x21-\x7e]{16,}$` and must not start with `replace-with-`.
  4. Writes, through a temp file and a rename, both with owner `1000:1000` and mode `0400`:
     - `/out/api/tokens.json` = `{"tokens":[{"location":<PULSE_LOCATION or "default">,"token":<token>}]}`;
     - `/out/probe/probe-token`.
  5. Each failure exits non-zero with one stderr line that names the file and the rule, never the content. For example `secrets-init: /in/probe-token: mode 0644 allows group or other access; run chmod 600`.

  Generate mode (demo, `PULSE_SECRETS_MODE=generate`, locations from `PULSE_DEMO_LOCATIONS`, default `eu,us`):
  - For each location it keeps an existing valid `/out/probe-<loc>/probe-token`, or writes a new 64-hex token from `crypto.getRandomValues`.
  - It then writes `/out/api/tokens.json` with every location.
  - It has no `/in` mount.
- **Volumes and mounts:**
  - The volumes are `api-secrets` → `/out/api` and `probe-secrets` → `/out/probe`. The demo has `probe-eu-secrets` and `probe-us-secrets`.
  - The api mounts `api-secrets:/run/pulse:ro` with `PULSE_TOKENS_FILE=/run/pulse/tokens.json`.
  - The probe mounts its volume at `/run/pulse:ro` with `PULSE_PROBE_TOKEN_FILE=/run/pulse/probe-token`.
  - A probe never sees `tokens.json` of another location, and nothing else sees the probe volume.
  - api and probe have `depends_on: secrets-init: condition: service_completed_successfully`.
- **`.gitignore`:** `secrets/`, `.env`, `*/.env`, `e2e/.secrets/`, `e2e/rw/`.
- **No default passwords:** no setup contains a literal token, password or secret. The e2e overlay keeps its throwaway admin token and header sentinels, as in pulse-api today. It is marked as test-only and is never part of a user setup.

### Host ports (complete list per setup; nothing else is published)

| Setup | Published |
| --- | --- |
| minimal | api `127.0.0.1:${PULSE_API_PORT:-3000}` → 3000 |
| full | status `${PULSE_STATUS_PORT:-8080}` → 8080 on all interfaces; console `127.0.0.1:${PULSE_CONSOLE_PORT:-8082}` → 8082 |
| demo | status `127.0.0.1:${PULSE_STATUS_PORT:-8080}` → 8080; console `127.0.0.1:${PULSE_CONSOLE_PORT:-8082}` → 8082; mailpit `127.0.0.1:${PULSE_MAILPIT_PORT:-8025}` → 8025 |
| dev | as full, plus api `127.0.0.1:${PULSE_API_PORT:-3000}` → 3000 |
| e2e overlay on full | adds api `127.0.0.1:${PULSE_API_PORT:-3000}` → 3000 (test only) |

The demo binds status to loopback: it is a throwaway with generated tokens and must not be reachable from the LAN.

### Project names and volumes

| Setup | Project name | Volumes |
| --- | --- | --- |
| `minimal` | `pulse` | `api-data` |
| `full` | `pulse` | `api-data`, `notify-data`, same as pulse-api's `compose.yaml` today |
| `demo` | `pulse-demo` | its own |
| `dev` | `pulse-dev` | its own |
| e2e | `pulse-e2e` (forced by the script, as today) | its own |

- Each setup's `compose.yaml` sets its project name with a top-level `name:`, so `docker compose …` run inside the setup directory (`cd full && docker compose ps`) and `docker compose -f full/compose.yaml …` from the root address the same project.
- An existing pulse-api Compose user who switches to `full` keeps the database and the notify ledger.
- The demo's documented reset is `docker compose -f demo/compose.yaml down -v`. It touches only `pulse-demo_*`.

### Setups

- **minimal:**
  - `secrets-init`, `api` and `probe`.
  - The api mounts `./config:/config:ro` (a directory, for the hot reload) with `PULSE_CHECKS_FILE=/config/checks.json`.
  - `config/checks.json` checks only targets inside the setup: `api-health` (HTTP `http://api:3000/healthz`, 10 s) and `dns-api` (as today).
  - The probe depends on api `service_healthy`.
- **full:** pulse-api's regular `compose.yaml` on the published images:
  - same env, same `config/checks.json` and `config/notify.json` content as pulse-api's `compose/`;
  - `PULSE_STATUS_SHOW_CHECKS: "true"`, healthcheck interval 5 s for status and console;
  - the probe depends on api and status `service_healthy`;
  - the secrets come from `secrets-init` instead of `configs.content`.
- **demo:** one command, `docker compose -f demo/compose.yaml up -d`, with no `.env` and no secret input. Services:
  - `secrets-init` in generate mode.
  - `demo-init` (bun-tools): `init.mjs` writes the checks to the `demo-config` volume, the same as today plus the check below.
  - `demo-targets`: `targets.mjs`, plus the path `/down`. It answers `200` for the first 60 s after its start, then `500` for good.
  - `demo-tls` (openssl, `tls.sh` unchanged).
  - `mailpit`.
  - `api`: checks from `demo-config`.
  - `probe-eu` and `probe-us`.
  - `status`: `PULSE_STATUS_SHOW_CHECKS: "true"`.
  - `notify` with `demo/notify.json`, which has two channels:
    - a `file` channel to `/data/incidents.jsonl`;
    - an `email` channel `{"id":"mail","type":"email","smtp":{"host":"mailpit","port":1025,"tls":"none"},"from":"pulse demo <pulse@example.com>","to":["ops@example.com"],"subjectPrefix":"[pulse demo]","statusUrl":"http://localhost:8080"}`.
  - `console`.

  The new check is `{"id":"down-on-purpose","name":"Down on purpose","url":"http://demo-targets:8000/down","intervalMs":5000,"timeoutMs":3000,"retries":0}`. Three `down` results open an incident (`api/docs/concepts.md`, "Quorum and incidents"), so it opens about 75 s after start and stays open.

  The other demo checks keep the timings documented in `api/docs/install.md` "Demo profile". The README per setup moves that table over, with the new row added.
- **dev:**
  - Like full. Each pulse service has `build: { context: ${PULSE_SRC_DIR:-../..}/pulse-<svc> }` and `image: pulse-<svc>:dev`.
  - The only remote images are the third-party pins from `common/`.
  - The api is also published on loopback.
  - No `git#` context anywhere.

### Readiness (`scripts/wait-ready.sh <compose-file> <timeout-s>`)

- For each long-running pulse service it polls `/readyz` until it answers `200` with body `ok`. The service list and ports are hard-coded per setup in the script:
  - api: 3000
  - probe, probe-eu, probe-us: 9100
  - notify: 9100
  - status: 8080
  - console: 8082
- pulse services are polled from inside the container: `docker compose exec -T <svc> bun -e "fetch('http://127.0.0.1:<port>/readyz')…"`. Their images have no curl.
- mailpit is polled from the host at `http://127.0.0.1:${PULSE_MAILPIT_PORT:-8025}/readyz` until it answers `200`; its body is not checked (mailpit v1.32.0 answers with an empty body).
- It also requires `State.Health.Status == healthy` for each service that has a healthcheck, and exit code `0` for `secrets-init` and `demo-init`.
- It prints the elapsed seconds since its start.

### e2e (moved)

- `e2e/compose-e2e.sh` is pulse-api's `scripts/compose-e2e.sh`. It keeps every assertion except those listed here.
- Changes:
  - `cd` to the repository root.
  - `COMPOSE_FILE=full/compose.yaml:e2e/compose.e2e.yaml`, `COMPOSE_PROJECT_NAME=pulse-e2e`.
  - Secrets:
    - `PULSE_SECRETS_DIR=$PWD/e2e/.secrets`, created with `scripts/init-secrets.sh --dir`;
    - the probe token for the "probe token write is refused" test is read from that file instead of `.env`;
    - no `.env` handling.
  - Paths in `compose.e2e.yaml` are relative to `full/`: `../e2e/ro:/config:ro`, `../e2e/rw:/config-rw`, `../e2e/notify.json:/config/notify.json:ro`, `../e2e/target.mjs`. `regular_checks=full/config/checks.json`, `e2e_checks=e2e/ro/checks.json`, `rw_dir=e2e/rw`.
  - The service-list guard is hard-coded: `docker compose -f full/compose.yaml config --services` sorted equals `api console notify probe secrets-init status`. The demo-profile guard and the "Demo profile" step are removed, because the demo has its own job.
  - Start:
    - `docker compose up -d --build` becomes `docker compose up -d --pull missing`;
    - the script fails if `docker compose config --format json` has a `build` key in any service.
  - `docker compose --profile demo …` calls become plain `docker compose …` (ps, logs, down).
  - The overlay publishes the api on loopback and adds `e2e-target` (extends `bun-tools`). It keeps the admin-token `configs.content` (throwaway), `PULSE_CHECKS_RELOAD_INTERVAL_MS`, `PULSE_STATUS_PUBLIC_URL` and `PULSE_HEADER_SVC_TOKEN`, as today.
  - The admin-token config moves out of `/run/pulse`. In `full`, `/run/pulse` is the read-only `api-secrets` volume, and Docker cannot place a config file inside a read-only mount (`open /run/pulse/admin.json: read-only file system`, reproduced by the plan review on Docker 28.0.4; today's pulse-api overlay uses `target: /run/pulse/admin-tokens.json`, `compose.e2e.yaml` lines 7 and 15). The overlay uses:
    - `configs: [{source: admin-tokens, target: /run/pulse-admin/admin-tokens.json}]`;
    - `PULSE_API_ADMIN_TOKENS_FILE: /run/pulse-admin/admin-tokens.json` (the api setting read at `api/src/start.ts:134`).
  - Rule for every setup and override: no mount, config or secret targets a path inside `/run/pulse/`, which belongs to the secrets volume alone.
  - `source scripts/outage-history.sh` becomes `source e2e/outage-history.sh`, and the directive above it (`# shellcheck source=scripts/outage-history.sh`, pulse-api `scripts/compose-e2e.sh:544`) becomes `# shellcheck source=e2e/outage-history.sh` in the same edit, so shellcheck in the `lint` job (run from the repository root) can follow the source.
- `e2e/outage-history.test.sh`:
  - It ports the five cases of `api/src/outage-history.test.ts` with the same constants (start 100000, end 135000, interval 10000) and the same inputs.
  - Expected results: steady 85000..175000 passes; no result inside the outage fails; a gap above 1.5× inside the window fails; a history that stops before the window end fails; a repeated timestamp fails.
  - It exits non-zero on the first mismatch.

### CI (`.github/workflows/ci.yml` in deploy)

- Triggers: `pull_request`, `push` to `main`, `workflow_dispatch`, and `schedule` (daily). The weekly `pins-latest` step runs only from the schedule, on Mondays.
- `permissions: contents: read` at the top.
- Every job: `runs-on: ubuntu-24.04`, `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` with `persist-credentials: false`.
- Jobs:

  | Job | Steps |
  | --- | --- |
  | `lint` | `docker compose version`; fail if older than 2.23; `shellcheck -x` (run from the repository root, so `source=` paths resolve) + `bash -n` on `**/*.sh`; `node --check` on `**/*.mjs`; `jq empty` on `**/*.json`; `bash e2e/outage-history.test.sh`; `scripts/check-setup.sh` (static checks below) |
  | `pins` | `scripts/bump-images.sh --verify` (anonymous ghcr.io, no login) |
  | `minimal` | `init-secrets.sh`; `docker compose -f minimal/compose.yaml pull`; `measure.sh minimal` (runs `up -d`, `wait-ready.sh` with 300 s, records the numbers); then the check `api-health` has a state other than `unknown` within 90 s via `curl 127.0.0.1:3000/checks` |
  | `full` | `init-secrets.sh`; pull; `measure.sh full`; `down -v`; then `bash e2e/compose-e2e.sh` (timeout 30 min) |
  | `demo` | pull; `up -d` with no other step before it; `wait-ready.sh` 300 s; demo assertions below, deadline 300 s from `up` |
  | `dev` | checkouts of `pulse-deploy`, `pulse-api`, `pulse-probe`, `pulse-status`, `pulse-notify` and `pulse-console` (`main`, public, read-only) into sibling `path:`s; `init-secrets.sh`; `docker compose -f dev/compose.yaml up -d --build`; `wait-ready.sh` 900 s |
  | `pins-latest` | schedule only: `scripts/bump-images.sh --check-latest` |

- Every setup job:
  - ends with an `if: always()` step that runs `docker compose -f <setup>/compose.yaml down -v --remove-orphans`;
  - on failure, prints `ps --all` and `logs --no-color` first.
- `scripts/check-setup.sh` (static, no containers):
  1. `grep -rnE 'build:|git#' common minimal full demo` finds nothing.
  2. Every `image:` value in `common/services.yaml` matches one of two regexes, and nothing else:
     - pulse: `^ghcr\.io/lorenzh/pulse-(api|probe|status|notify|console):[0-9]+\.[0-9]+\.[0-9]+@sha256:[0-9a-f]{64}$`;
     - third-party: `^(oven/bun|alpine/openssl|axllent/mailpit)(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$`.

     The script holds image *names* only (the approved ones), never a version or digest. Each of the five pulse names occurs exactly once. The digest values are checked against the registry by `bump-images.sh --verify` (pulse images) and by `docker compose pull`, which verifies the content of a digest reference (all images).
  3. `grep -rn 'image:' minimal full demo e2e` finds nothing. In `dev`, only `image: pulse-<svc>:dev`.
  4. `ghcr.io/lorenzh/pulse-` appears in no `*.yaml` outside `common/services.yaml`.
  5. For each setup, `docker compose -f <setup>/compose.yaml config --format json` gives exactly the host-port set of the table above. The script writes the expected `(service, host_ip, published, target)` tuples literally.
  6. `secrets/` is listed in `.gitignore` (`git check-ignore -q secrets/probe-token`).
  7. After `init-secrets.sh --dir <tmp>`, `stat -c %a` reads `700` for the directory and `600` for `probe-token`. A second run leaves the file's content unchanged (compare `sha256sum` before and after).
  8. In `docker compose -f full/compose.yaml -f e2e/compose.e2e.yaml config --format json` and in each setup's own config, the only mount of any service whose target is `/run/pulse` or starts with `/run/pulse/` is the secrets volume mounted exactly at `/run/pulse`. A config, secret or volume targeting `/run/pulse/<file>` fails.
- Demo assertions:
  - (a) Within 300 s of `up`:
    - `docker compose exec -T api bun -e "…fetch('http://127.0.0.1:3000/incidents')…"` returns at least one incident with `resolvedAt == null`;
    - there is one with `checkId == "down-on-purpose"` and `resolvedAt == null`.
  - (b) Within the same deadline, `curl 127.0.0.1:8025/api/v1/messages` has at least one message whose `Subject` matches `^\[pulse demo\] DOWN: ` and whose `To[].Address` holds `ops@example.com`. The subject format `<prefix> DOWN: <name>` is taken from `notify/docs/channels/email.md` (the "Sample message").
  - (c) No `secrets/` directory exists in the checkout after the demo run, which proves the demo used no host secret.
  - (d) `curl -fsS 127.0.0.1:8080/` answers 200.

### Pins tooling (`scripts/bump-images.sh`)

- `<svc>=<x.y.z> ...`:
  - for each argument it gets an anonymous pull token from `https://ghcr.io/token?scope=repository:lorenzh/pulse-<svc>:pull`;
  - it sends `HEAD /v2/lorenzh/pulse-<svc>/manifests/<x.y.z>` with the OCI index Accept header;
  - it takes `Docker-Content-Digest` and replaces that service's `image:` line in `common/services.yaml`.
- It refuses:
  - a version that is not `x.y.z`, such as `0.1`, `latest` or `0.2.0-rc.1`;
  - an unknown service;
  - a non-200 answer;
  - an answer whose media type is not an OCI index or a Docker manifest list.

  On a refusal it changes no file.
- `--verify`: for each of the five pulse images in `common/services.yaml`, the ghcr.io digest of its tag must equal the pinned digest. It reads the pins from `common/services.yaml` and the expected digest from ghcr.io (independent source); it holds no pin itself. Third-party images are not covered (`alpine/openssl` has no tag); `docker compose pull` verifies their digest content.
- `--check-latest`: reads `/v2/.../tags/list`, keeps the tags matching `^[0-9]+\.[0-9]+\.[0-9]+$`, compares them by SemVer, and fails when the highest is above the pin. It prints `svc pinned → available`.

### Docs in deploy

- `README.md`: what pulse-deploy is, the four setups, prerequisites (Docker Engine with Compose ≥ 2.23), a quick start for each, the secrets model, host ports, how to bump images, migrating from pulse-api's `compose.yaml` (same project name and volumes in `full`), and the e2e test.
- One `README.md` per setup: services, ports, config files with every key explained, the variables of its `.env.example`, start, stop and reset.
  - The full README also covers opting in to admin tokens with a `compose.override.yaml`. Its example mounts a host directory `../secrets/admin` read-only at `/run/pulse-admin`. The file `admin-tokens.json` (`{"tokens":[{"name":…,"token":…}]}`) must be readable by the container user `bun` (uid 1000) and by nobody else, so the README tells the reader to make it with `umask 077`, then `sudo chown 1000:1000` on the file and the directory (mode `0400` file, `0500` directory), and explains why: the host owner and mode survive a bind mount (decision 4) and sets `PULSE_API_ADMIN_TOKENS_FILE=/run/pulse-admin/admin-tokens.json`. It never targets `/run/pulse`, and it shows no literal token (the README tells the reader to generate one with `openssl rand -hex 32`).
  - The demo README covers the demo checks table and the white-label theme.
- `.env.example` per setup: every variable that the setup's compose file reads, each with a comment line, all commented out with the default value.
- `AGENTS.md`:
  - repository purpose and layout;
  - the rules: pins only in `common/services.yaml`; no `build:` outside `dev`; no published api port outside minimal, dev and e2e; secrets only through `secrets-init`; actions only from the approved list, pinned by SHA;
  - the commands table with the CI checks.
- `CLAUDE.md`: points to `AGENTS.md`, as in the other targets.

## Performance impact

- **api `bench/budgets.json`** (keys verified in `.repos/api/bench/budgets.json`):
  - `test_cpu_s` can go down slightly, by about 0.05 s or less. Removing `src/outage-history.test.ts` drops five `bash` spawns.
  - No other key can move:
    - the api image is unchanged, since `.dockerignore` already excludes `compose` and `compose.yaml`;
    - `src/` runtime code is unchanged;
    - `bench/compose.bench.yaml` builds from sibling directories and stays.
  - The implementer measures it with `bun bench/run.ts --a main --b HEAD` only if `test_cpu_s` is reported over budget; otherwise no A/B is needed.
- **deploy (new, reported):** start time and total RSS of `minimal` and `full`, written by `scripts/measure.sh` to the job summary and copied into the deploy PR description:
  - **Start time:**
    - wall-clock seconds from the start of `docker compose up -d` to the moment `wait-ready.sh` saw every `/readyz` answer `200`;
    - images are already pulled in a separate step before the clock starts;
    - one sample per CI run, rounded to 0.1 s.
  - **Total RSS:**
    - taken 30 s after readiness, in one `docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'` call;
    - it sums the first value of `MemUsage` (cgroup usage without page cache, as docker stats reports it) over the setup's running containers;
    - each value is converted to MiB (KiB/1024, GiB×1024) and the total is rounded to 0.1 MiB;
    - exited one-shot containers (`secrets-init`) are not counted.
  - The PR reports both numbers per setup, plus the per-container values. No budget gates them in this issue.
  - Expected order of magnitude, from api's own `idle_rss_mib` budget (88 MiB for api alone): minimal under 200 MiB, full under 450 MiB. This is a sanity guide only, not a gate.

## Security impact

Security impact: yes. The issue sets the default secrets handling and network exposure, adds CI, a new third-party image and file writes of secrets.

Checklist items that apply:

- **Secrets in errors, logs and responses:**
  - `secrets-init.mjs`, `init-secrets.sh` and `bump-images.sh` never print a token. Their error lines name the file and the rule only.
  - The moved e2e keeps its `assert_absent` checks of the header token, body sentinel and admin token in responses and logs.
  - Every CI log step that prints `logs` runs only after secrets are generated per run, and those secrets are throwaway.
- **Atomic, path-safe writes:**
  - `secrets-init` writes through a temp file and a rename in the target volume, with owner `1000:1000` and mode `0400`.
  - It refuses a symlinked or non-regular input file and an input that is readable by group or other.
  - The host secrets directory is a read-only bind with `create_host_path: false`, so a missing directory is never created as root.
  - `init-secrets.sh` never overwrites.
- **Input validation:**
  - The token charset and length are checked before they are written into JSON, which is built with `JSON.stringify`, never by string concatenation.
  - `PULSE_LOCATION` is passed through `JSON.stringify`, and the api validates it.
- **Auth order and status codes:** unchanged service code. The moved e2e keeps the `401` assertions (no token, probe token on a write, wrong heartbeat secret).
- **Dependency pins:**
  - every image is pinned by digest in one file;
  - `bump-images.sh --verify` compares each pin with the registry in CI;
  - the mail catcher image is added to the approved list in this spec PR;
  - every action is pinned by SHA from the approved list;
  - CI has `contents: read` only and no registry login.
- **Network exposure:**
  - the complete published-port table is enforced by `check-setup.sh`;
  - the api is not published in full or demo;
  - mailpit is loopback-only and demo-only;
  - containers run with `no-new-privileges` and `cap_drop: ALL`;
  - `secrets-init` has `network_mode: none` and only CHOWN, DAC_OVERRIDE and FOWNER.

The security state after the review should try:

- a 0644, symlinked, empty, placeholder or whitespace-containing `probe-token`;
- a `PULSE_LOCATION` with `"` or a newline;
- a missing `secrets/` directory;
- an `image:` with a tag only or a floating tag;
- a published api port slipped into `full`.

## Rollout order

1. **meta, this spec PR:** approved-packages entries for `axllent/mailpit` and `alpine/openssl`, plus the README and architecture pointers to pulse-deploy.
   - pulse-api's `compose.yaml` still exists and works, so a reader who follows the old api docs is not broken.
   - The README pointer names pulse-deploy's setups. They exist once step 2 merges (hours to days), and the pulse-deploy repository and its README exist already.
2. **deploy:**
   - It needs only the published `0.1.0` images (public since the lead's comment) and the approved-list entries from step 1.
   - Nothing consumes it yet.
   - The images it runs are the exact `v0.1.0` commits, so it does not depend on any unmerged service work.
3. **api** (dependsOn deploy) removes its Compose files and points the docs to pulse-deploy. It waits for step 2 so that:
   - the links it writes resolve;
   - the e2e assertions it drops already run green in pulse-deploy.

   Older consumers still work:
   - the published api `0.1.0` image is unchanged;
   - website docs pin pulse-api docs by SHA (`docs.config.json`), so they keep rendering the old Compose text until the follow-up;
   - status and console READMEs keep a link to a file that no longer exists on api `main` (stale, not broken at runtime). This is the follow-up issue.
4. **Follow-up (not in this issue):** update `status/README.md:47`, `console/README.md:39`, `console/docs/configuration.md:51` and the website facts and fixtures to point to pulse-deploy.

## Counterexamples

- **Secret file mode:**
  - `secrets/probe-token` with mode `0644` must make `secrets-init` exit non-zero, and api and probe must not start.
  - `0640` must fail too, because it has a group bit.
  - `0600` and `0400` pass.
  - A wrong implementation checks only "other" bits and accepts `0640`.
- **Symlink:** a `secrets/probe-token` that is a symlink to `/etc/passwd` (or any file) is refused, even with mode `0600` on the target.
- **Missing directory:** with no `secrets/` directory, `docker compose -f full/compose.yaml up -d` fails with `bind source path does not exist`. It must not create a root-owned `secrets/`. A short-syntax bind `../secrets:/in:ro` would create it, so that is wrong.
- **Token content:** each of these is refused:
  - `replace-with-a-random-token` (placeholder);
  - a 15-character token;
  - `abc def…` (space);
  - an empty file;
  - a file holding only `\n`.

  A 64-hex token followed by exactly one `\n` is accepted. With two trailing newlines, the second one makes the content fail the charset rule.
- **Location injection:** `PULSE_LOCATION='x","token":"y'` must give a `tokens.json` whose single entry has that literal location string (JSON-escaped), not a second token.
- **Image pins (`check-setup.sh` rule 2):** each of these is rejected:
  - `ghcr.io/lorenzh/pulse-api:0.1.0` (no digest);
  - `ghcr.io/lorenzh/pulse-api@sha256:…` (no version);
  - `ghcr.io/lorenzh/pulse-api:0.1@sha256:…` (floating tag);
  - `ghcr.io/lorenzh/pulse-api:latest@sha256:…`;
  - `ghcr.io/lorenzh/pulse-api:0.1.0@sha256:ABC…` (upper-case or short digest);
  - a `build: https://github.com/lorenzh/pulse-probe.git#main` in `full`.
- **One place:** a copy of the api pin in `demo/compose.yaml` fails rule 4, even though the value is identical. A `check-setup.sh` (or any other file) that holds a literal `sha256:` digest of a pinned image is wrong: after `bump-images.sh api=0.1.1` the checks must still pass with only `common/services.yaml` changed. A third-party image not in the allowed names (for example `busybox@sha256:…`) fails rule 2, and so does `axllent/mailpit:latest` (no digest).
- **`bump-images.sh --verify`:** if `common/services.yaml` pins `pulse-api:0.1.0@sha256:<probe's digest>`, verify fails, because the registry's `0.1.0` digest for pulse-api is `71d623fb…`.
- **`--check-latest`:** tags `0.1.0`, `0.1`, `0`, `0.2.0-rc.1` and `sha256-…` give "up to date" for a `0.1.0` pin. Prerelease, floating and attestation tags are ignored. A `0.10.0` tag beats `0.9.0`, since the comparison is numeric, not string.
- **Ports:** `check-setup.sh` must fail for each of these:
  - `ports: ["3000:3000"]` on api in full;
  - `"8080:8080"` on status in demo (all interfaces instead of `127.0.0.1`);
  - mailpit published in full (mailpit is not in full at all);
  - console on all interfaces in any setup.
- **Mount under the secrets volume:** an e2e overlay or override with `target: /run/pulse/admin-tokens.json` (today's pulse-api value) makes the api container fail to start with `read-only file system`. The `full` e2e job then fails at "Start the regular stack". `/run/pulse-admin/admin-tokens.json` is correct.
- **Readiness:** `/healthz` is not `/readyz`. A wait that accepts the image's `healthy` state alone passes while the api answers `503 database unavailable` on `/readyz`. Both are required.
- **Demo incident:**
  - The `flaky-service` incident resolves about 150 s after start. An implementation without `down-on-purpose` can pass "≥1 open incident" at 60 s and still show none at 5 min. That is why assertion (a) also requires the open `down-on-purpose` incident.
  - A resolved incident (`resolvedAt` set) never counts.
- **Demo mail:**
  - A message that mailpit received from anything other than notify (none expected) would not match the subject `^\[pulse demo\] DOWN: `.
  - A `RESOLVED:` mail alone does not satisfy (b).
  - If notify started after the incident opened, its first poll seeds the incident without an `opened` event and no mail comes. The `/down` target goes down at 60 s, after notify's first poll (notify starts after api is healthy and polls every 5000 ms by default, `notify/src/config.ts:367`).
- **Start time:**
  - The clock starts at `up -d`, not at `pull`. A measurement that includes the pull is wrong.
  - It stops at the last `/readyz` 200 across all services, not the first.
- **Total RSS:** a single sample 30 s after readiness, summed over containers. Not an average over time, not a maximum, not including the exited `secrets-init`. `1.5GiB` converts to 1536.0 MiB, `512KiB` to 0.5 MiB.
- **api docs token scan:** keeping `assert.ok(checked > 0)` fails once the Compose section is gone (0 counted tokens). Dropping it without the self-check is also wrong: a broken pattern (for example `/Bearer ([A-Z]{16,})/g`) would then pass on any docs. With the self-check, that broken pattern fails because it does not capture `0123456789abcdef0123` from the literal sample.
- **api docs grep:** a line `See [full](https://github.com/lorenzh/pulse-deploy/blob/main/full/compose.yaml)` passes check 3. A line `docker compose -f full/compose.yaml ps` fails it, and so does a leftover `cp .env.example .env`.
- **Outage gate:** the five cases above, with the expected results written in the test. A replayed history `85000, 95000, …, 175000` plus a repeated `115000` fails.

## Contract fields

No contract or config names change. The new names are Compose variables, service and volume names, and a demo check id, all inside pulse-deploy. Collision search, run in this plan:

```
for n in PULSE_SECRETS_DIR PULSE_SRC_DIR PULSE_MAILPIT_PORT PULSE_SECRETS_MODE PULSE_DEMO_LOCATIONS down-on-purpose secrets-init; do
  grep -rn "$n" .repos/contract/src .repos/config .repos/kit/src .repos/api/src .repos/probe/src .repos/notify/src .repos/status/src .repos/console/src | grep -v node_modules | wc -l
done
# every count: 0
```

Reused existing names, with unchanged meaning:

- `PULSE_API_PORT`, `PULSE_STATUS_PORT`, `PULSE_CONSOLE_PORT` and `PULSE_LOCATION`, as Compose host variables, as in pulse-api's `compose.yaml`.
- The service settings `PULSE_TOKENS_FILE`, `PULSE_PROBE_TOKEN_FILE`, `PULSE_CHECKS_FILE`, `PULSE_NOTIFY_CONFIG` and `PULSE_STATUS_SHOW_CHECKS`.
- `PULSE_CONSOLE_PORT` is also a console setting. As today, Compose does not pass the host variable into the container (`console/docs/configuration.md`, "In the pulse Compose stack").

Dropped: `PULSE_PROBE_TOKEN` as a Compose `.env` variable, replaced by `secrets/probe-token`, and `PULSE_DEMO_API_PORT` and `PULSE_DEMO_STATUS_PORT`, since the demo is its own project.

## Repository: deploy

Files (every file below is new, except `README.md`, which exists and is rewritten, and `LICENSE`, which exists and is kept unchanged; `ls -a .repos/deploy` shows only `LICENSE`, `README.md` and `.git`):

- `README.md` (rewrite); `LICENSE` (kept, unchanged)
- `AGENTS.md`, `CLAUDE.md`, `.gitignore` (new)
- `common/services.yaml` (new)
- `minimal/compose.yaml`, `minimal/.env.example`, `minimal/README.md`, `minimal/config/checks.json` (new)
- `full/compose.yaml`, `full/.env.example`, `full/README.md`, `full/config/checks.json`, `full/config/notify.json` (new)
- `demo/compose.yaml`, `demo/.env.example`, `demo/README.md`, `demo/init.mjs`, `demo/targets.mjs`, `demo/tls.sh`, `demo/notify.json`, `demo/theme-white-label.json` (new)
- `dev/compose.yaml`, `dev/.env.example`, `dev/README.md` (new)
- `e2e/compose.e2e.yaml`, `e2e/compose-e2e.sh`, `e2e/outage-history.sh`, `e2e/outage-history.test.sh`, `e2e/notify.json`, `e2e/target.mjs`, `e2e/ro/checks.json` (new)
- `scripts/init-secrets.sh`, `scripts/secrets-init.mjs`, `scripts/wait-ready.sh`, `scripts/bump-images.sh`, `scripts/check-setup.sh`, `scripts/measure.sh` (new)
- `.github/workflows/ci.yml` (new)

Behavior change: yes. A new repository content: runnable Compose setups, scripts and CI.

Sources to copy from (read-only, `.repos/api` at `c00a375` = `v0.1.0`):

| Source in pulse-api | Destination in deploy | Change |
| --- | --- | --- |
| `compose/checks.json`, `compose/notify.json` | `full/config/` | none |
| `compose/demo/init.mjs` | `demo/` | adds `down-on-purpose` |
| `compose/demo/targets.mjs` | `demo/` | adds `/down` |
| `compose/demo/tls.sh`, `compose/demo/theme-white-label.json` | `demo/` | none |
| `compose/e2e/{notify.json,target.mjs,ro/checks.json}` | `e2e/` | none |
| `compose.e2e.yaml` | `e2e/compose.e2e.yaml` | paths relative to `full/`, adds the api port and `e2e-target` extends |
| `scripts/compose-e2e.sh` | `e2e/compose-e2e.sh` | changes listed under "e2e (moved)" |
| `scripts/outage-history.sh` | `e2e/` | none |
| `src/outage-history.test.ts` | `e2e/outage-history.test.sh` | ported to bash |

Tool facts. deploy has no tooling today: `ls -a .repos/deploy` shows only `LICENSE`, `README.md` and `.git`. This task defines the following, and the CI file is their source:

- No `package.json`, Biome, bunfig or pulse-config. There is no TypeScript to check.
- The CI uses `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1), the target pin in `docs/approved-packages.md` ("Runtime and CI"), with `persist-credentials: false`.
- The tools on the GitHub `ubuntu-24.04` runner image: `docker compose`, `shellcheck`, `jq`, `curl` and `node`. They were present on this Factory runner: Docker Compose v2.38.2, `/usr/bin/shellcheck`, `/usr/bin/jq`, node 24. The `lint` job prints their versions as its first step and fails on Compose below 2.23.
- No new action and no new package. Images only from the approved list after this spec PR.

Checks and completion evidence (all in the deploy PR's CI, green):

1. `lint`, `pins`, `minimal`, `full`, `demo` and `dev` pass on the PR.
2. `minimal`:
   - `api` and `probe` `/readyz` answer 200;
   - `api-health` gets a state other than `unknown` within 90 s.
3. `full`:
   - all five `/readyz` answer 200;
   - `e2e/compose-e2e.sh` ends with `==> All checks passed`;
   - the log shows every pulse-api step heading except "Demo profile": Setup, Start the regular stack, Health and metrics, First check result, Status page, TCP and DNS checks, HTTP check…, Heartbeat check, Incident, Manual incidents, Probe outage, Checks via the admin API and hot reload, Persistence across down and up, Clean stop.
4. `demo`:
   - started with `docker compose -f demo/compose.yaml up -d` and nothing before it except `pull`;
   - assertions (a)–(d) pass within 300 s of `up`.
5. `dev`: all five `/readyz` answer 200 on images built from the sibling checkouts.
6. `check-setup.sh` passes:
   - no `build:` or `git#` in `common`, `minimal`, `full` or `demo`;
   - every pin matches one of the two regexes of rule 2;
   - the host-port sets equal the literal table above;
   - the secret modes are `700`/`600`.

   One-time check in the deploy PR (not part of `check-setup.sh`, so a later bump does not break CI): the PR description pastes the output of `grep -n 'ghcr.io/lorenzh/pulse-' common/services.yaml`. Its five lines must equal, character for character, the five literals in "Images" above. The expected values come from the lead's comment in the issue, not from the file. The reviewer compares them.
7. `pins` passes. The registry's digest for each `0.1.0` tag equals the pin. The expected value comes from ghcr.io, an independent source.
8. The PR description:
   - pastes `grep -rnE 'build:|git#' common minimal full demo` with no output;
   - reports start time and total RSS of `minimal` and `full` (method above), with per-container values.
9. A negative proof in `lint`: `check-setup.sh` runs against a copy of `full/compose.yaml` with `ports: ["3000:3000"]` added to api, and against an `image:` without a digest. Both must fail. The test asserts the non-zero exit.

## Repository: api

Files:

- deleted: `compose.yaml`, `compose.e2e.yaml`, `compose/` (all files), `.env.example`, `scripts/compose-e2e.sh`, `scripts/outage-history.sh`, `src/outage-history.test.ts`
- `.github/workflows/ci.yml`
- `.gitignore`, `.dockerignore`
- `src/tokens.test.ts`
- `bench/compose.bench.yaml` (comment only), `bench/README.md`
- `README.md`, `docs/index.md`, `docs/install.md`, `docs/configuration.md`, `docs/development.md`, `docs/operation.md`, `docs/troubleshooting.md`

Behavior change: yes. CI jobs and steps are removed, and the repository no longer ships a runnable stack.

Tool facts, cited:

- **CI** (`.github/workflows/ci.yml`):
  - `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (line 18). That file at that SHA runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and `bun run test` (pinned `check.yml` lines 25–38, read with `gh api …?ref=dc69a12…`). It is identical to the config clone.
  - `bench-selftest` (lines 20–31) includes `docker compose -f bench/compose.bench.yaml config --quiet` (line 31). It stays.
  - `docker` (lines 33–54) runs `cp .env.example .env && docker compose config --quiet` (line 44), "Status port override" (lines 49–51) and "Console port override" (lines 52–54).
  - `release` needs `[check, docker, bench-selftest]` (line 58).
  - `compose-e2e` (lines 66–76) is not a release gate.
- **package.json:** `test` is `bun test` (line 15), `lint` is `biome check . && pulse-eslint .` (line 16), `packageManager` is `bun@1.4.0` (line 35).
- **`bunfig.toml`** `[test]`: coverage threshold `lines = 0.8` (line 3). It is unaffected: the removed test covers a shell script, not TS lines.
- **`src/tokens.test.ts`:** the test "docs and .env.example only show tokens that the API accepts" (line 105) lists `.env.example` (line 107). It would fail with `ENOENT` once the file is deleted. It ends with `assert.ok(checked > 0)` (line 134). Today exactly one match is counted, on `docs/install.md:38` inside "With Docker Compose" (lines 31–94), which this task replaces; the `.env.example` placeholder is skipped (plan review, checked with the test's own regexes). After the change no `docs/*.md` line is counted, so the assert as written would fail.

Required changes:

1. Delete the files listed. pulse-api must keep no `compose.yaml` and no `compose/` directory.
2. In `ci.yml`:
   - remove the `compose-e2e` job (lines 66–76);
   - remove lines 44 and 49–54 from `docker`;
   - keep `docker build`, the "Image holds no test files" step, `check`, `bench-selftest` and `release` (still `needs: [check, docker, bench-selftest]`).
3. In `src/tokens.test.ts`:
   - drop `.env.example` from the file list and rename the test to "docs only show tokens that the API accepts";
   - remove `assert.ok(checked > 0)`. The docs must not be required to show a literal token: a copyable working token in public docs is what the security model avoids;
   - so the scan cannot silently match nothing, add an in-test self-check before the docs loop: run the same `patterns` over a fixed string written in the test, `"Authorization: Bearer 0123456789abcdef0123 and PULSE_PROBE_TOKEN=replace-with-x"`, and assert that the Bearer pattern captures `0123456789abcdef0123` and that the `PULSE_PROBE_TOKEN=` capture is skipped by the placeholder rule. The expected values are these literals in the test, not the docs.
   - The rest of the test (every counted doc token must pass `parseTokens`) stays unchanged.
4. In `.gitignore`, remove `!compose/checks.json`, `!compose/e2e/ro/checks.json` and `compose/e2e/rw/`. In `.dockerignore`, remove `compose` and `compose.yaml` (no longer present). `.env*` stays.
5. In `bench/compose.bench.yaml` line 3 and the `bench/README.md` text "Keep `compose.bench.yaml` in step with the environment names of `compose.yaml`", name pulse-deploy's `common/services.yaml` (`https://github.com/lorenzh/pulse-deploy/blob/main/common/services.yaml`) instead.
6. Docs:
   - In `README.md` "Docker Compose" and `docs/install.md` "With Docker Compose", "The `.env` file" and "Demo profile":
     - replace them with a short section that links to pulse-deploy (`https://github.com/lorenzh/pulse-deploy`) and its `full` and `demo` setups;
     - keep the plain-Docker install;
     - move nothing else.
   - In `docs/configuration.md`, replace "Compose variables" with a link to pulse-deploy's setup READMEs.
   - In `docs/development.md`:
     - remove the `compose-e2e` paragraphs (lines 63–67);
     - change line 61 (the `docker` job no longer validates `compose.yaml` or the port overrides) and line 81;
     - add one sentence: the Compose end-to-end test runs in pulse-deploy against released images and, daily, against `main` (its `dev` job).
   - In `docs/operation.md` and `docs/troubleshooting.md`:
     - keep the `docker compose …` examples (the service name `api` is the same in pulse-deploy);
     - replace the references to `compose.yaml`, `./compose:/config:ro`, `.env` and `PULSE_PROBE_TOKEN` with pulse-deploy's `full/config` and `secrets/probe-token`.
   - In `docs/index.md`, update the Install and Configuration lines.

Checks and completion evidence:

1. CI is green on the PR with exactly the jobs `check`, `bench-selftest` and `docker` (both legs). No `compose-e2e` job.
2. `git ls-files | grep -E '^(compose|compose\.e2e\.yaml|compose\.yaml|\.env\.example|scripts/compose-e2e\.sh|scripts/outage-history\.sh|src/outage-history\.test\.ts)'` prints nothing.
3. `grep -rnE 'compose\.yaml|compose\.e2e|compose/|compose-e2e|\.env\.example|--profile demo' README.md docs src .github .gitignore .dockerignore | grep -v 'https://github\.com/lorenzh/pulse-deploy'` prints nothing. `scripts` is not in the path list: required change 1 deletes both files in it (`ls .repos/api/scripts` shows only `compose-e2e.sh` and `outage-history.sh`), so grep would exit 2 on the missing directory; check 2 covers that deletion. Hits in `bench/` are allowed only for `compose.bench.yaml`.
   - Allowed link form for a pulse-deploy file: a full URL `https://github.com/lorenzh/pulse-deploy/...` (for example `https://github.com/lorenzh/pulse-deploy/blob/main/full/compose.yaml`). A line holding such a URL is excluded from the grep, whatever else it holds.
   - Command examples in api docs never name a setup file path (`-f full/compose.yaml` is not used). They are plain `docker compose …` commands, introduced once per page with "run inside your pulse-deploy setup directory, for example `cd pulse-deploy/full`". This works because each setup sets its project `name:` (see "Project names and volumes").
4. `grep -rn 'pulse-deploy' README.md docs/install.md docs/configuration.md docs/development.md` finds at least one link in each of those four files.
5. `bun run check` passes locally (CI `check` job). `src/tokens.test.ts` holds no `checked > 0` assert and holds the self-check with the literal sample of required change 3.

## Meta (this spec PR, no child issue)

Files changed in this PR next to the spec:

- `docs/approved-packages.md`, "Runtime and CI":
  - `axllent/mailpit` `v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498` (MIT; demo mail catcher in pulse-deploy only);
  - `alpine/openssl` `@sha256:1c361a204e9791bec6202bccbd1065eafaa65cb5a1a9a06ae000238569fba6a2` (TLS demo target, moved from pulse-api to pulse-deploy);
  - the `oven/bun` row extended to pulse-deploy's helper services;
  - the target `actions/checkout` row extended to pulse-deploy CI.
- `README.md`:
  - "Run all of pulse with Docker Compose" and its "Demo" subsection become a pointer to pulse-deploy with the one-command `full` and `demo` starts;
  - the repository table rows of pulse-api (no longer "Holds the Docker Compose file") and pulse-deploy;
  - the "Compose variables" sentence below the configuration table (line 227 before this PR);
  - the pulse-api docs bullet, which no longer names a "Compose quick start".
- `docs/architecture.md:12`: the pulse-deploy row.

## Risks

- **Compose `extends` across files** must carry everything the setups need. This was verified with `docker compose config` and `up --no-start` on v2.38.2 in this run. Users on Compose below 2.23 get an error, and the README states the minimum.
- **Bind mounts under SELinux** (Fedora, RHEL) may need `:z` on `../secrets` and `./config`. The README mentions it. CI on Ubuntu does not cover it.
- **The demo timing** depends on notify polling before `down-on-purpose` goes down at 60 s. On a slow host the first email can come from the next incident only. `down-on-purpose` never resolves, so then no mail comes. The CI asserts it within 300 s, and if it turns out flaky, the implementer moves the down time later (≤ 120 s) and reports it.
- **The dev job** builds five images from `main`, so a break on any `main` fails it. That is intended, but it is a red that deploy cannot fix. The job is not required for merging the bump PR.
- **Image bump PRs** come from a person or a Factory issue. Nothing opens them automatically. The weekly `pins-latest` failure is the signal.
- **Stale references** in status, console and website until the follow-up issue.
- **mailpit runs as root** inside its container (no `USER` in its Dockerfile at v1.32.0). It is demo-only, loopback-only, with `no-new-privileges`.

## Acceptance evidence

- **deploy PR:**
  - the CI jobs `lint`, `pins`, `minimal`, `full`, `demo` and `dev` are green;
  - the description holds the `build:`/`git#` grep with no output and the start time and RSS numbers of `minimal` and `full`.
- **api PR:**
  - CI is green with `check`, `bench-selftest` and `docker` only;
  - the file and grep checks of its section print nothing;
  - the pulse-deploy links are present.
- **meta (this PR):**
  - `docs/approved-packages.md` lists mailpit and openssl with the digests above;
  - README and `docs/architecture.md` point to pulse-deploy.
