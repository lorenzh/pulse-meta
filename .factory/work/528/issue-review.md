# Issue review #528: pulse-deploy Compose setups (minimal, full, demo, dev)

Targets named by the issue: deploy, api, meta. All facts below were read from the clones under
`.target/.repos/` (main as of 31 Oct) or checked on GitHub and ghcr.io on 31 Oct.

## Resolved hold: published images (decision A)

In the first run the images did not exist yet: no `v*` tags, and an anonymous ghcr.io pull token was
denied. The hold offered A (publish `v0.1.0` first), B (write the spec now and resolve digests later)
and C (another option). The lead answered on 31 Oct: **A is done.** Pin these literals:

| Service | Pin |
| --- | --- |
| api | `ghcr.io/lorenzh/pulse-api:0.1.0@sha256:71d623fb9e51bccdfd1f235882c69c48908960ec39e1c9b565fa700777009b18` |
| probe | `ghcr.io/lorenzh/pulse-probe:0.1.0@sha256:c5cb30ec6efecd34e37a6047ba165e2eba57b95bbb2e8775c9c77753c6736871` |
| status | `ghcr.io/lorenzh/pulse-status:0.1.0@sha256:0347481776e1d511dd3bffc7c21d646b6661192e11f08997ffe54eb745e84fa4` |
| notify | `ghcr.io/lorenzh/pulse-notify:0.1.0@sha256:a63964aa2a2b728849f76b416ac5cc90b5a95306a375c028c3d4d11afe1c9e78` |
| console | `ghcr.io/lorenzh/pulse-console:0.1.0@sha256:ddadc5e1eef198861731b334bee3a593e1ef29700252212a7dba9ac81087bce3` |

Verified in this run (31 Oct):

- An anonymous token from `https://ghcr.io/token?scope=repository:lorenzh/pulse-<svc>:pull` is
  issued for all five packages, so they are public.
- `HEAD /v2/lorenzh/pulse-<svc>/manifests/0.1.0` answers `200` with an OCI image index. Its
  `Docker-Content-Digest` equals the digest above for every service.
- Each index has `linux/amd64` and `linux/arm64`.
- The registry tags of each package are `0.1.0`, `0.1`, `0` and the `sha256-…` attestation tag.
- The `v0.1.0` git tag of each service points at the commit that is `main` HEAD of its clone under
  `.repos/`:

  | Service | Commit |
  | --- | --- |
  | api | `c00a375` |
  | probe | `50ec9ca` |
  | status | `2e3067d` |
  | notify | `c090a07` |
  | console | `11a3f5f` |

  So every fact below about service behavior (health endpoints, file secrets, SMTP rules, the e2e
  script's needs) describes exactly the code in the pinned images.

Consequence for the plan:

- The spec records these five pins as literals.
- The deploy CI pulls them anonymously, with no registry login.
- The floating `0.1`/`0` tags exist, but the setups use only the full `version@digest` form.

## Current state (facts)

- **pulse-deploy** holds only `README.md` (2 lines) and `LICENSE` (MIT). It has no `AGENTS.md` or
  `CLAUDE.md`, no CI, no `.gitignore`, no Renovate config and no pulse-config usage.
- **pulse-api** Compose material:
  - `compose.yaml` (197 lines, `name: pulse`) has these services:
    - `api` builds from `.`. It mounts `./compose:/config:ro` and is published on
      `127.0.0.1:${PULSE_API_PORT:-3000}`. The probe token reaches its tokens file through
      `configs.content`, filled from `.env` `PULSE_PROBE_TOKEN`.
    - `probe`, `status`, `notify` and `console` build from `https://github.com/lorenzh/pulse-<svc>.git#main`.
      `status` is published on all interfaces at `${PULSE_STATUS_PORT:-8080}`. `console` is published
      on `127.0.0.1:${PULSE_CONSOLE_PORT:-8082}`.
    - The `demo` profile has `demo-init`, `demo-api`, `demo-targets`, `demo-tls`, `demo-probe-a`,
      `demo-probe-b` and `demo-status`. It uses public demo tokens, two locations, every status-page
      state and a TLS check. It has no notify and no console.
  - Other files:
    - `compose.e2e.yaml`: admin tokens, a writable checks dir, the `e2e-target` service, a feed URL
      and a header env.
    - `compose/`: `checks.json`, `notify.json`, `demo/*`, `e2e/*`.
    - `.env.example` (placeholder token, which the API rejects).
  - `scripts/compose-e2e.sh` (689 lines) sources `scripts/outage-history.sh`. That script has its own
    bun test, `src/outage-history.test.ts`.
  - CI (`.github/workflows/ci.yml`):
    - The job `compose-e2e` runs the script.
    - The job `docker` runs `cp .env.example .env && docker compose config --quiet` and two port
      override checks (status and console) on both architecture legs.
  - `bench/compose.bench.yaml` is api's own bench and is validated in `bench-selftest`. It builds from
    sibling dirs and stays in api.
  - `.dockerignore` lists `compose` and `compose.yaml`.
  - Docs that describe the Compose stack: README "Docker Compose", `docs/install.md` ("With Docker
    Compose", demo profile), `docs/configuration.md` ("Compose variables"), `docs/development.md`
    (compose-e2e), `docs/operation.md` and `docs/troubleshooting.md` (`docker compose …` examples).
- **What the e2e script depends on** that matters after the move:
  - It curls the api on the host port.
  - It runs `docker compose exec api bun src/main.ts` (a read-only checks test inside the api image).
  - It stops and starts api and status, restarts notify, and reloads with `kill -s HUP api`.
  - It hard-codes the service lists of the regular stack and of the demo profile.
  - It runs the demo profile and its documented cleanup.
  - It starts with `docker compose up -d --build`.
- **Health and readiness of each service**:

  | Service | Image HEALTHCHECK | `/readyz` |
  | --- | --- | --- |
  | api | `/readyz` on 3000 | 3000 |
  | probe | `/healthz` on ops port 9100 | ops port 9100, kit ops server |
  | notify | `/healthz` on ops port 9100 | ops port 9100, kit ops server |
  | status | `/healthz` on 8080 | 8080 |
  | console | `/healthz` on 8082 | 8082 |

  Every image runs as the non-root user `bun` and has `bun` but no curl.
- **File-based secrets that exist today**:

  | Service | File setting |
  | --- | --- |
  | api | `PULSE_TOKENS_FILE`, `PULSE_API_ADMIN_TOKENS_FILE` |
  | probe | `PULSE_PROBE_TOKEN_FILE` |
  | console | `PULSE_CONSOLE_ADMIN_TOKEN_FILE` |
  | notify | `smtp.passwordFile` in its channel config |

  status has no secret.
- **notify SMTP**: `tls: "none"` is allowed to a non-loopback host as long as no login is set. Only a
  login over `tls: "none"` to a remote host is refused (`notify/src/config.ts:139`,
  `channels/smtp-send.ts:48`). A mail catcher without auth on the Compose network therefore works
  without code changes. notify has no "send test notification" command.
- **Approved list** (`docs/approved-packages.md`): no mail catcher image, no Renovate, no
  `docker/*` action. Container images are listed under "Runtime and CI" (`oven/bun`, `moby/buildkit`).
- **Other repos that still point to pulse-api's Compose file** (not targets of this issue):
  - `status/README.md:47`
  - `console/README.md:39`
  - `console/docs/configuration.md:51`
  - `website/src/content/facts.ts` and test fixtures. The website pins api docs by SHA in
    `docs.config.json`, so it does not break, but it goes stale.
- **Meta**:
  - README "Run all of pulse with Docker Compose" and its "Demo" subsection describe pulse-api's file.
  - The README repository table (pulse-api row "Holds the Docker Compose file", pulse-deploy row "No
    code yet") and `docs/architecture.md:12` describe the old state.
  - The `deploy` target already exists in `.factory/config.yaml` (context: meta, api, probe, status,
    notify, console, config).

## Open points for the spec (not blocking)

1. **Layout.** `docker compose -f <setup> up -d` in the acceptance criteria implies one entry file per
   setup, for example `minimal/compose.yaml` or `compose.minimal.yaml`. Shared service definitions
   could come from one base file through `include:` (Compose 2.20+) or `extends`. Profiles alone do not
   fit `-f <setup>`. The plan picks one and sets the minimum Compose version; it is at least 2.23
   today because of `configs.content`.
2. **One place to bump versions.** Candidates:
   - one file of `x-` anchors or one `.env`-style `images.env` read through `--env-file`;
   - one included `images.yaml` that every setup uses.

   For each candidate, the plan must make sure that `docker compose -f <setup> up -d` works without
   extra flags. An `--env-file` that the user has to pass breaks the acceptance command, while a
   project `.env` next to each file works.
3. **Keeping pins current.**
   - Renovate (GitHub App) understands Compose digests but is not on the approved list. The owner
     would also have to install the app. That is an owner step, and Factory must not change repository
     settings.
   - A scripted bump (scheduled workflow that queries ghcr and opens a PR) needs a token that can open
     PRs. A PR opened with `GITHUB_TOKEN` starts no CI.

   The plan decides and adds any new tool to `docs/approved-packages.md` in the spec PR.
4. **Secrets as files and the container user.**
   - Compose `secrets: file:` outside swarm is a bind mount that keeps the host owner and mode.
   - A `0600` file owned by the host user (uid 1001 on GitHub runners) is not readable by the
     container user `bun` (uid 1000). The e2e script already works around this for the rw checks dir.
   - The plan must pick a mechanism that CI proves on a runner. Options:
     - an init container that copies the secrets into a volume with the right owner;
     - `user:` overrides;
     - Compose secret `uid`/`gid`/`mode`, but check whether Compose honours them for file secrets in
       non-swarm mode.
   - The plan also needs a script that creates the secrets (`openssl rand` or `bun`), because no
     default passwords are allowed.
   - The probe token must appear in both `secrets/probe-token` and the api `tokens.json`. Either the
     script writes both, or an init step derives `tokens.json`.
5. **Network exposure per setup.** The issue: "only status (and console) published", api on the
   Compose network.
   - minimal has no status, so with that rule nothing is reachable from the host. The plan should say
     whether minimal publishes api on `127.0.0.1` ("unless the setup says otherwise").
   - Today the console is bound to `127.0.0.1` and status to all interfaces. I assume that stays.
6. **Demo content vs the existing api demo profile.** The issue's demo is "`full` + seeded checks + a
   target that goes down + mail catcher". The api demo profile shows every status-page state: two
   probes, TLS, maintenance and degraded.
   - I assume the deploy demo replaces it and keeps its content: the `demo-init`, `demo-targets` and
     `demo-tls` scripts move along, and notify, console and a mail catcher are added.
   - The plan states whether the "every state within five minutes" guarantee and the second probe
     stay.
7. **Demo secrets.** "Needs no secret input" and "no default passwords" conflict with today's public
   demo tokens.
   - Assumption: the demo generates its tokens at start (an init container writing to a volume).
   - Alternatively, the plan keeps public tokens and says why: the demo is loopback-only and
     throwaway.

   Either way, the demo publishes nothing to all interfaces beyond what the plan names.
8. **"Delivered test notification".** notify has no test-send command.
   - Assumption: this means an incident-open email from the notify email channel, found in the mail
     catcher's message list through its HTTP API within 5 minutes.
   - If the owner meant a separate test-send feature, that is a notify change and outside the named
     targets.
9. **Mail catcher.**
   - The image (for example `axllent/mailpit`, MIT) must be added to `docs/approved-packages.md`,
     pinned by digest, in the spec PR.
   - Its web UI port: loopback-only or not published. This is a decision for the plan.
10. **CI per setup.**
    - `/readyz` of probe and notify is only on the in-container ops port 9100. The CI waits with
      `docker compose exec -T <svc> bun -e 'fetch(...)'` or a similar command, not with curl from the
      host.
    - The e2e assertions need the full stack plus an e2e overlay. They cannot run against minimal (no
      status or notify).
    - Assumption: the full e2e (moved `compose-e2e.sh` with `compose.e2e.yaml`) runs on `full`. minimal
      gets the readiness checks plus a first-result check. demo gets readiness plus the incident and
      mail assertions. dev gets readiness and builds from sibling checkouts of `main` (five extra
      `actions/checkout` steps, laid out so `../pulse-<svc>` resolves).
    - The e2e overlay must publish api on `127.0.0.1` for the host-side curls.
    - `--build` becomes a pull.
    - The hard-coded service lists, the demo step and the demo cleanup in the script must be rewritten
      for the new layout.
    - `exec api bun src/main.ts` still works on the published image (`/app/src` is in the image).
11. **The `outage-history.sh` test.** It is a bun test in api (`src/outage-history.test.ts`).
    - If the script moves to deploy, deploy needs a test runner, or the gate is tested in shell.
    - If it stays in api, deploy copies it.

    The plan decides. pulse-deploy has no Bun or pulse-config setup today.
12. **Repo conventions for pulse-deploy.** The deploy implementer creates the repo's base files:
    `AGENTS.md`, `CLAUDE.md`, `.gitignore` (with `secrets/` and `.env`), CI and docs layout. The plan
    states:
    - whether deploy uses pulse-config `check.yml`; it has no TypeScript today, except the demo
      `.mjs` scripts;
    - which checks run on shell, YAML and JSON (for example `docker compose config --quiet` per setup,
      `bash -n`);
    - that every action is pinned by SHA from the approved list.
13. **Coverage loss in api.** After the move, a pulse-api PR is no longer e2e-tested in Compose before
    a release, because deploy tests released images.
    - api keeps `check`, `docker` and `bench-selftest`. Its `docker` job drops the `compose config` and
      port-override steps.
    - The plan should name this trade-off. It could also have deploy's dev setup job run on a schedule
      against `main`.
14. **Order.** deploy must merge before api removes its Compose files, so that pulse-deploy exists
    when api docs link to it: `api` dependsOn `deploy`. Meta README changes go in the spec PR or after
    deploy. Since the spec PR merges first, the README links must point to paths that deploy will
    create, or be a follow-up.
15. **Other repos' stale Compose references** (status README, console README and docs, website facts)
    are outside the named targets. The plan lists them as a follow-up issue, or the owner adds those
    targets.
16. **Performance.** "Start time and total RSS of minimal and full". Assumption:
    - start time is the wall-clock time from `up -d` (images already pulled) until every `/readyz`
      answers 200;
    - RSS is the sum of `docker stats --no-stream` memory usage after readiness;
    - both are measured in the CI job on `ubuntu-24.04` and reported in the deploy PR.

## Assumptions

- Version `0.1.0` of all five images is the first pin, with the digests listed under "Resolved hold".
- Images are multi-arch (amd64 and arm64) per #527. CI runs on `ubuntu-24.04` only, unless the plan
  adds arm64.
- The project name stays `pulse` for the user setups and a separate name for e2e, so the `down -v`
  of e2e never touches user volumes.
- The `dev` setup is the only one allowed to have `build:`. Its contexts are local sibling
  directories, not `git#main`.
- The meta README section becomes a short pointer to pulse-deploy with the one-command demo, and its
  "Demo" subsection moves there.

## Derived acceptance check

In pulse-deploy CI on a PR, all green:

1. For each of `minimal`, `full`, `demo` and `dev`, a job runs `docker compose -f <setup> up -d`, and
   then each service's `/readyz` answers `200` within the timeout:
   - minimal: api and probe;
   - full: api, probe, status, notify and console;
   - demo: the full set plus its demo services.
2. `demo`, started without any secret input:
   - within 300 s `GET /incidents` shows at least one open incident;
   - the mail catcher's HTTP API lists at least one message from notify for that incident.
3. The moved `compose-e2e.sh` runs against `full` with the e2e overlay and passes every assertion that
   ran in pulse-api, except the steps replaced by the new layout: the service-list guards and the demo
   step.
4. `grep -rnE 'build:|git#|\.git#main' <non-dev setup files>` finds nothing.
5. Every `image:` in a non-dev setup matches
   `ghcr.io/lorenzh/pulse-(api|probe|status|notify|console):[0-9]+\.[0-9]+\.[0-9]+@sha256:[0-9a-f]{64}`
   or an approved digest-pinned third-party image. The pinned version appears in exactly one file.
   The first pins are the five `0.1.0` literals under "Resolved hold".
6. `docker compose -f <setup> config --format json` shows host ports only:
   - for status, and for console on `127.0.0.1`;
   - for api only where the setup documents it;
   - for nothing else.

   `secrets/` is gitignored, and the secret files created by the script have mode `0600`.

In pulse-api after its PR:

- `compose.yaml`, `compose.e2e.yaml`, `compose/`, `.env.example` and `scripts/compose-e2e.sh` are gone.
- CI (`check`, `docker`, `bench-selftest`) is green, with no `compose-e2e` job.
- README and docs link to pulse-deploy.

In meta, README "Run all of pulse with Docker Compose" points to pulse-deploy, and so do the
repository table and `docs/architecture.md`.

Reported in the deploy PR: start time and total RSS of `minimal` and `full`.
