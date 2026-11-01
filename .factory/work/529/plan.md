# Spec #529: pulse CLI setup wizard (init, up, down, status)

## Goal

pulse-deploy gets a `pulse` command-line tool. `pulse init` asks a few questions, or reads flags, and writes a complete, portable installation into a directory: `compose.yaml`, `.env`, the checks file, the notify config, the helper scripts the Compose file mounts, an install description `pulse.json`, and `secrets/` with generated tokens. These are plain files: `docker compose up -d` in that directory works without the CLI. `pulse up` starts the stack and waits until every service is ready. `pulse status` shows each service, its version and its readiness. `pulse down` stops the stack and keeps the data.

The tool is written in Bun and strict TypeScript and ships as three single binaries (`bun build --compile`): linux x64, linux arm64 and macOS arm64, attached to a GitHub release of pulse-deploy.

Sources:

- the issue and its comments (the only comment says #528 is closed);
- `.factory/work/529/issue-review.md` (open points 1–9 and the derived acceptance check);
- the #528 spec (`.factory/work/528/plan.md`);
- the clones under `.repos/`, read in this run: deploy `f9d9eb3` (main), config `04108fa` (main, equal to the pin of the service repositories), and the service docs at their `v0.1.0` tags, read with `gh api …?ref=v0.1.0`, because the generated files must work with the pinned `0.1.0` images, not with source `main`:
  - api `docs/configuration.md` and `docs/rest-api.md`;
  - notify `docs/configuration.md`, `docs/channels/email.md`, `docs/channels/webhook.md` and `src/config.ts`;
  - console `docs/configuration.md`;
  - status `docs/configuration.md`.

## Scope

- **deploy:**
  - the `pulse` CLI under `cli/`, with the Bun and strict TypeScript toolchain (`package.json`, `bun.lock`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `eslint.config.js`, `lefthook.yml`);
  - two small extensions of `scripts/secrets-init.mjs` (several probe locations from host files, and an admin token), so generated installs wire both tokens;
  - an output path override in `demo/init.mjs` (default unchanged), so a test can compare the CLI's demo checks with the standalone demo;
  - CI jobs for the CLI in `ci.yml`, and a new `release.yml` that attaches the binaries and a checksum file to a GitHub release;
  - docs: `docs/cli.md` (install, walkthrough, flags, going on without the CLI), plus README and AGENTS.md updates.
- **meta (this spec PR):** `docs/approved-packages.md` gets `macos-15` as an approved GitHub-hosted runner for the macOS CLI binary of pulse-deploy only. The `oven-sh/setup-bun` and `actions/checkout` rows name the pulse-deploy CLI jobs and `release.yml`. pulse-config's `actions-policy.json` needs no change, because `setup-bun` and `checkout` have no `only` scope there (`config/actions-policy.json` lines 4–13).

## Non-goals

- `pulse token rotate`, `pulse upgrade`, `pulse logs` (#530). `--force` never rotates a valid token.
- Hosted or multi-tenant setups.
- Any change to a service image or its code. Everything works with the `0.1.0` images pinned in `common/services.yaml`.
- A version HTTP endpoint in any service. `status` reads versions from the image references.
- Heartbeat checks and HTTP header secrets in the wizard. Both need a secret per check; the docs show how to add them to the checks file by hand.
- Code signing or notarization of the binaries. Package managers (Homebrew, apt).
- A prompt or YAML library. None is approved, and none is needed (see decision 2).
- Changing the four standalone setups, their ports, project names or CI jobs. The `secrets-init.mjs` and `demo/init.mjs` changes are additive and keep the defaults.

## Decisions on the review's open points

1. **Toolchain and layout.**
   - The CLI lives in `cli/` of pulse-deploy. Entry point is `cli/main.ts`. The modules are split by job, for example `args.ts`, `prompt.ts`, `answers.ts`, `render-compose.ts`, `render-checks.ts`, `render-notify.ts`, `yaml.ts`, `write-install.ts`, `tokens.ts`, `docker.ts`, `ready.ts`, `status.ts`. The names are a guide, not a rule.
   - It has no runtime dependency. Dev dependencies are the ones of the service repositories, from the approved list: `@biomejs/biome` 2.6.3, `@lorenzh/pulse-config` `github:lorenzh/pulse-config#04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`, `@types/node` 26.6.6, `@types/bun` 1.4.0, `lefthook` 2.2.2, `typescript7` `npm:typescript@7.0.2`.
   - The existing shell, `.mjs` and JSON checks stay as they are.
2. **No prompt or YAML library.**
   - Prompts use `node:readline/promises` and flags use `parseArgs` from `node:util` (strict mode). Both are Bun built-ins.
   - YAML output comes from a small own emitter (`cli/yaml.ts`) for a closed data model: maps, lists, strings, integers and booleans. Every string is written double-quoted with JSON escapes, which is valid YAML. A `$` in a literal string is written as `$$`, so Compose never interpolates user text. The only `${…}` in the output are the CLI's own references to `.env` variables.
   - YAML input is only `common/services.yaml`, read with the built-in `Bun.YAML.parse` (pulse-config uses it: `config/src/workflow-policy.ts` line 219).
3. **One source of pins and hardening.**
   - `common/services.yaml` stays the only file in the repository that holds an image version or digest.
   - The CLI imports it as text (`with { type: "text" }`), so it is embedded in the binary, and parses it at run time.
   - Each generated service copies the common entry's `image`, `restart`, `security_opt`, `cap_drop`, `cap_add`, `user`, `network_mode`, `command`, `environment` and `healthcheck`. The setup-specific keys come from the CLI's model, as in the standalone setups.
   - A pin that does not match the shape rules of `scripts/check-setup.sh` rule 2 stops `pulse init` with exit code 1. That would be a broken build.
   - The CLI's TypeScript, tests and workflows hold no version or digest of a pinned image. The AGENTS.md rule applies to them too.
4. **Embedded assets.** The binary embeds, as text imports from their repository paths (one source, no copies):
   - `scripts/secrets-init.mjs`, `demo/targets.mjs`, `demo/tls.sh` and `demo/notify.json`;
   - `full/config/api/checks.json` and `minimal/config/checks.json` (the sample checks).

   `pulse init` needs no deploy checkout, no host Bun and no network.
5. **Generated layout** of an install directory `<dir>` (default: the current directory, or `pulse init <dir>`):

   | Path | Mode | Content |
   | --- | --- | --- |
   | `compose.yaml` | 0644 | Self-contained: no `extends`, no path outside `<dir>`. Top-level `name:` is the project name. |
   | `.env` | 0600 | Ports, public URLs, `PULSE_SRC_DIR` (dev only). No secret values. Single-quoted values. |
   | `pulse.json` | 0644 | Install description, see "pulse.json" below. No secret values. |
   | `config/api/checks.json` | 0644 | The checks. The api mounts the directory `./config/api:/config:ro`, so an editor's rename over the file is seen and hot reload works. |
   | `config/notify/notify.json` | 0644 | Only with notify. Mounted as the directory `./config/notify:/config:ro`. Holds env variable *names* only. |
   | `helpers/secrets-init.mjs` | 0644 | Copy of `scripts/secrets-init.mjs`. |
   | `helpers/demo-targets.mjs`, `helpers/demo-tls.sh` | 0644 | Demo only. |
   | `secrets/` | 0700 | Token files. |
   | `secrets/admin-token` | 0600 | 64 lowercase hex characters and a newline. |
   | `secrets/probe-token-<location>` | 0600 | One per probe location. Same format. |

   The issue's "checks.json" is `config/api/checks.json`. A top-level file would need either a single-file bind (no hot reload after an editor save) or a bind of `<dir>` itself (which would expose `secrets/` to the api). Directories are 0755 except `secrets/` and the backup directories.
6. **Setups and services.**
   - api and probe are always on. status, notify and console can each be turned on or off. Their defaults: off in minimal; on in full, demo and dev.
   - **demo** adds `demo-targets`, `demo-tls`, two probes `probe-eu` and `probe-us`, and `mailpit` when notify is on. Without notify there is no mailpit.
   - **dev** builds the enabled pulse services from `${PULSE_SRC_DIR}/pulse-<svc>` (`--src-dir`, default `..`, relative to `<dir>`) with the image `pulse-<svc>:dev`. `pulse init` refuses a dev install when `<src-dir>/pulse-<svc>/Dockerfile` is missing for an enabled service. The error names the service and the path, and nothing is written.
   - **Probe dependencies:** a probe depends on `secrets-init` (completed) and `api` (healthy); in demo also on `demo-targets` and `demo-tls` (started); on `status` (healthy) only when status is on.
   - **Sample checks:** with status on, the `full/config/api/checks.json` set (it targets status). With status off, the `minimal/config/checks.json` set. So no default check targets a disabled service.
7. **Ports, binds and public URLs.**

   | Service | Published | Bind | Public URL question | Effect of the URL |
   | --- | --- | --- | --- | --- |
   | api | minimal and dev only, `--api-port`, default 3000 | `127.0.0.1` | no | — |
   | status | `--status-port`, default 8080 | all interfaces in minimal, full and dev; `127.0.0.1` in demo | `--status-url`, default `http://localhost:<port>` | `PULSE_STATUS_PUBLIC_URL` of status (turns on `/feed.atom`); `statusUrl` of the email channel |
   | console | `--console-port`, default 8082 | `127.0.0.1` always | `--console-url`, default `http://127.0.0.1:<port>` | Written to `pulse.json` and printed by `init` and `status`. Console has no URL setting (`console/docs/configuration.md` at `v0.1.0`). |
   | mailpit (demo with notify) | `--mailpit-port`, default 8025 | `127.0.0.1` | no | — |
   | notify | never (a worker; its ops port stays internal) | — | no | — |

   - Ports reach `compose.yaml` as `${PULSE_<SVC>_PORT:-<default>}`, the same variables as the standalone setups. The chosen values are written to `.env`.
   - A port is an integer from 1 to 65535. Two published services with the same port are refused, whatever their bind address.
   - A public URL must be `http:` or `https:`, without user info, query, fragment, whitespace or `'`. These are status's own rules for `PULSE_STATUS_PUBLIC_URL` at `v0.1.0`, plus the `.env` quoting rule.
   - A public URL does not configure DNS, TLS or a reverse proxy. The docs say so.
8. **Checks.**
   - Wizard types: `http`, `tcp`, `dns`, `tls`, `domain`. `heartbeat` is a manual step (see Non-goals).
   - **Check sets**, `--checks <set>`: `sample` (default and only choice besides `none` in minimal, full and dev), `demo` (default and only choice besides `none` in demo), or `none`. Each `--check` adds one check to the set. `--checks demo` with another setup is refused, because the demo checks need `demo-targets` and `demo-tls`.
   - **`--check` syntax:** comma-separated `key=value` pairs. A value that contains a comma is refused; the docs say to edit the checks file for such a URL. The keys:

     | Type | Required | Optional (default) |
     | --- | --- | --- |
     | `http` (`type` absent or `http`) | `url` (http or https, no user info) | `name`, `id`, `interval` (60s), `timeout` (unset: probe default 5 s) |
     | `tcp` | `host`, `port` | `name`, `id`, `interval`, `timeout` |
     | `dns` | `dns` (the name to resolve) | `record` (`A`; one of `A AAAA CNAME MX TXT NS`), `name`, `id`, `interval`, `timeout` |
     | `tls` | `host` | `port` (443), `warn-days` (14), `name`, `id`, `interval`, `timeout` |
     | `domain` | `domain` | `warn-days` (30), `name`, `id`, `interval` (24h), `timeout` |

   - **Durations** are `<integer><s|m|h>`, written to the file in milliseconds.
     - `interval`: 10s to 24h; for `domain`, 1h to 7 days (the api requires at least 3 600 000 ms for domain checks).
     - `timeout`: 1s to 60s, and less than `interval`.
   - **Names and ids:** `name` defaults to the target (the URL, `host:port`, the DNS name or the domain). `id` defaults to a slug of `name`: lower case, runs of other characters become `-`, trimmed, at most 63 characters, pattern `^[a-z0-9][a-z0-9-]{0,62}$`. A slug that is already taken gets `-2`, `-3` and so on. An explicit `id` that is already taken is refused.
   - The generated file uses only keys that the `0.1.0` api documents (`api/docs/configuration.md` at `v0.1.0`, "checks.json"), because the api rejects unknown keys.
   - **Demo checks:** the seven checks and two maintenance windows of `demo/init.mjs`, with the windows computed at `pulse init` time, not at start. If more than about 90 minutes pass before `up`, both windows are over; the docs say to run `pulse init --setup demo --force` to refresh them (tokens are kept). Probes get `PULSE_LOCATION` `eu` and `us`.
9. **Notifications** (only with notify on).
   - `--channel <email|webhook>` can be repeated. A `file` channel `{"id":"log","type":"file","path":"/data/incidents.jsonl"}` is always written, as in `full/config/notify.json`.
   - **Email** (`id` `mail`):
     - `--smtp-host` (required), `--smtp-port` (587), `--smtp-tls` (`starttls`, `tls` or `none`; default `starttls`);
     - `--smtp-user` (optional, written as is: a user name is not a secret), `--smtp-password-env <NAME>` (required when `--smtp-user` is set);
     - `--mail-from` (required), `--mail-to` (required, repeatable), `--mail-subject-prefix` (default `[pulse]`);
     - `statusUrl` = the status public URL when status is on.
     - Login over `--smtp-tls none` to a host other than `localhost` or `127.0.0.1` is refused at `init`. notify would refuse it at start (`notify/docs/channels/email.md` at `v0.1.0`).
   - **Webhook** (`id` `hook`):
     - `--webhook-url` (required: http or https, no user info, no query string);
     - `--webhook-secret-env <NAME>` (optional: signing secret through `secretEnv`).
     - A generic webhook at `0.1.0` has no `urlEnv`, so its URL is clear text in the file. The prompt and the docs say: use a URL without credentials and sign with `secretEnv`.
   - **demo** defaults to the email channel of `demo/notify.json` (mailpit, no login), with `statusUrl` replaced by the status public URL, or removed when status is off. With `--yes` and no `--channel`, full and dev get the file channel only.
   - **Env names** match `^[A-Z_][A-Z0-9_]{0,63}$` and must not start with `PULSE_` or `COMPOSE_`, so they can never override a service or Compose setting.
     - The notify service lists each name as a bare key (`NAME:` with no value). Compose then copies the value from the caller's environment or from `.env`, and leaves the variable unset when neither has it. This was verified with Docker Compose v2.38.2 in this run: a bare key was filled from the shell and from `.env`, and stayed `null` otherwise.
     - `docker compose config`, `down` and `status` never fail on a missing secret.
     - The CLI never writes a value for such a name anywhere.
10. **Tokens.**
    - `crypto.getRandomValues` on 32 bytes, written as 64 lowercase hex characters (256 bits). One admin token and one token per probe location, all different. A collision is regenerated, and a test proves that check with an injected random source.
    - **Host files:**
      - `secrets/` is created with mode 0700. Each token file is created with `open(…, "wx", 0o600)` in a temp name and renamed into place.
      - `chmod 0600` is applied explicitly, so the umask cannot widen it.
      - Mode 0700 on an existing `secrets/` is checked: a wider mode is refused with a `chmod 700` hint.
    - **Runtime wiring (additive change to `scripts/secrets-init.mjs`, files mode):**
      - `PULSE_PROBE_LOCATIONS=<loc>[,<loc>…]`:
        - for each location, read `/in/probe-token-<loc>` with the existing checks (`lstat` regular file, no group or other bits, the token rules);
        - write `/out/probe-<loc>/probe-token`, and one `/out/api/tokens.json` with every location;
        - locations match the existing `LOCATION_PATTERN` (`scripts/secrets-init.mjs` line 13).
        - Unset keeps today's behavior exactly: one `/in/probe-token`, location `PULSE_LOCATION`, output `/out/probe/probe-token`.
      - `PULSE_SECRETS_ADMIN=on`:
        - read `/in/admin-token` with the same checks;
        - refuse it when it equals any probe token (`/in/admin-token: must differ from every probe token`);
        - write `/out/api/admin-tokens.json` = `{"tokens":[{"name":"admin","token":<token>}]}`;
        - when the directory `/out/console` exists, also write `/out/console/admin-token`.
        - Unset or `off` keeps today's behavior. Any other value is refused.
      - Every output keeps owner 1000:1000, mode 0400, temp file plus rename. No message holds a token.
    - **Generated compose:**
      - the api gets `PULSE_TOKENS_FILE` (from common) and `PULSE_API_ADMIN_TOKENS_FILE: /run/pulse/admin-tokens.json`, mounting `api-secrets:/run/pulse:ro`;
      - each probe gets its own `probe-<loc>-secrets` volume at `/run/pulse:ro`;
      - console (when on) gets `console-secrets:/run/pulse:ro` and `PULSE_CONSOLE_ADMIN_TOKEN_FILE: /run/pulse/admin-token`;
      - no other service mounts a secrets volume;
      - `secrets-init` binds `./secrets` read-only with `create_host_path: false` and `./helpers/secrets-init.mjs`, has `network_mode: none` (from common), and mounts only the output volumes of the enabled consumers.
    - The demo install uses this files mode with `eu,us` host files. The standalone demo keeps its generate mode and its "no host `secrets/`" CI assertion.
    - Admin routes stay read-only in effect: the checks directory is mounted `:ro`, so admin writes answer `503`, as in `full`. The docs show the writable mount from `full/README.md`.
11. **Overwrite, backup and token preservation (`--force`).**
    1. **Validate first.** All answers are validated and all files are rendered in memory before the first write. A bad flag, a bad answer, EOF or Ctrl-C before that point writes nothing.
    2. **Preflight every managed path:**
       - A symlink or a non-regular file at a managed path, or a symlink in a managed parent directory (`config/`, `config/api/`, `config/notify/`, `helpers/`, `secrets/`), is refused even with `--force`. The CLI never writes through a link.
       - Without `--force`, any existing managed file is a conflict. The CLI exits 1 with one line per conflicting path and the hint `pass --force to back up and replace them`. Nothing changes.
    3. **Lock.** `.pulse-init.lock` is created with `O_EXCL`. If it exists, the CLI exits 1 with `another pulse init is running in <dir> (or remove .pulse-init.lock)`. The lock is removed on every exit path.
    4. **Tokens with `--force`:** an existing token file that passes the secrets-init rules (regular file, mode without group or other bits, `^[\x21-\x7e]{16,}$`, no `replace-with-`) is kept as it is. An invalid one is backed up and replaced, and the output names the file and the rule, never the content.
    5. **Backup with `--force`:**
       - every managed file whose new content differs is copied first to `.pulse-backup/<UTC yyyymmddThhmmssZ>-<6 random hex>/<same relative path>`;
       - the backup directory is created with `mkdir` (not `-p` on the last level, so a collision fails and the CLI picks a new suffix) with mode 0700, and every backup file with mode 0600, because `.env` may hold a secret the user added;
       - identical files are neither backed up nor rewritten;
       - if any backup step fails, the CLI deletes that backup directory, replaces nothing and exits 1.
    6. **Write:** each file goes to `.<name>.tmp-<random>` in its own directory with `wx` and its final mode, then a rename. An interruption can leave some new files and the old rest. The next run reports conflicts and the user reruns with `--force`; the docs say so.
    7. **Unrelated files** in `<dir>` are never touched. Managed files that a new answer no longer uses (for example `config/notify/notify.json` after `--no-notify`) are kept and listed as `no longer used: <path>`.
12. **Interaction model.**
    - Prompts run when stdin is a TTY and `--yes` is absent, or when `--interactive` is given (this lets tests drive the real prompts through a pipe). `--yes` together with `--interactive` is a usage error.
    - With `--yes`, every unanswered question takes its documented default and nothing is asked.
    - Without a TTY, `--yes` or `--interactive`, a missing required answer exits 2 at once: `missing --setup (stdin is not a terminal; pass the flag or --yes)`. It never waits for input.
    - A flag always wins over the prompt: the question is skipped.
    - An invalid prompt answer is asked again with the rule. An invalid flag value exits 2.
    - EOF on a prompt exits 2 with `input ended before the setup was complete; nothing written`. SIGINT exits 130 and writes nothing.
    - **Prompt order:** setup; status, notify, console (yes/no); for each published service, its port, then its public URL where the table has one; probe location (non-demo); dev source directory (dev); check set; "add a check?" loop (type, then the type's fields); channels and their fields; a token step that only reports `generated` or `kept`; write; then "Start now? [Y/n]".
    - **`--start` / `--no-start`** answer the last question. With `--yes` and neither flag, nothing starts, so `pulse init --setup demo --yes` never needs Docker.
    - Defaults with `--yes`: setup `full`, services as in decision 6, ports and URLs as in decision 7, the setup's check set, channels as in decision 9, location `default`, project name as in decision 13.
13. **Compose lifecycle.**
    - **Invocation:** every Docker call is an argument array through `Bun.spawn`, never a shell string. Compose runs as `docker compose --project-directory <dir> …` with no `-f`. Compose then reads `compose.yaml`, `compose.override.yaml` and `.env`, exactly like a plain `docker compose` in `<dir>`.
    - **Project name:** `--project <name>`, default `pulse` for minimal and full, `pulse-demo` for demo and `pulse-dev` for dev. These are the names of the standalone setups, so a user can migrate data between them. The pattern is `^[a-z0-9][a-z0-9_-]{0,62}$`.
    - **Project guard:** `up`, `down` and `status` list the containers with the label `com.docker.compose.project=<name>`. If one of them has a `com.docker.compose.project.working_dir` label other than `<dir>` (compared after `realpath`), the command exits 1 with `project <name> is used by <other dir>; stop it there or set another name: in compose.yaml`. So the CLI never controls another installation, including the repository's `full/` stack.
    - **Docker preflight** (only `up`, `down`, `status`, and `init` when it starts the stack):
      - the `docker` binary is missing (spawn `ENOENT`): `Docker is not installed or not on PATH` and a link to the install docs;
      - `docker version --format '{{.Server.Version}}'` fails: `cannot reach the Docker daemon` and the first stderr line;
      - `docker compose version --short` fails: `Docker Compose v2 is missing (the docker compose plugin)`;
      - the version is below 2.23.0 (numeric compare, an optional leading `v` removed): `Docker Compose <v> is older than 2.23`.
      - All four exit 3.
    - **`pulse up [--dir <dir>] [--timeout <s>]`:**
      1. Read `pulse.json`. If it is missing or has an unknown `format`, exit 1 with `<dir> is not a pulse installation (no pulse.json); run pulse init`.
      2. Docker preflight and the project guard.
      3. **Env preflight:** for every `passwordEnv`, `secretEnv` and `urlEnv` name in `config/notify/notify.json`, the name must be set and non-empty in the CLI's environment or as a `KEY=` line of `.env`. Otherwise exit 1, before any container starts, with `notify: environment variable <NAME> is not set (channel "<id>" in config/notify/notify.json); export it or add it to .env`. The value is never printed.
      4. Dev only: every source directory exists.
      5. Run `docker compose … up -d`, with `--build` for dev. It is idempotent and detached.
      6. **Wait:** the default deadline is 300 s. `--timeout` takes 1 to 3600 s (dev docs suggest 900).
         - Each round checks every service in `pulse.json`:
           - a pulse service is ready when Docker reports `healthy` or no healthcheck, and `GET http://127.0.0.1:<port>/readyz` inside the container answers 200 with the body `ok`;
           - a one-shot is ready when it exited with code 0;
           - a helper is ready when it is running and `healthy` or has no healthcheck.
         - The `/readyz` request runs as `docker compose exec -T <svc> bun -e "fetch(…, {signal: AbortSignal.timeout(…)})"`, as in `scripts/wait-ready.sh`. The spawned process is killed after `min(remaining, 10 s)`.
         - The ports are `scripts/wait-ready.sh` lines 21–29: api 3000, probe 9100, status 8080, notify 9100, console 8082.
         - A one-shot that exited non-zero fails at once: `pulse up: secrets-init exited with code 1; see docker compose logs secrets-init`.
         - **Timeout:** exit 1 with `pulse up: not ready after <n> s: <svc> (<reason>), …`, where reason is one of `not running`, `unhealthy`, `readyz <status>`, `readyz no answer`.
         - On success it prints `pulse up: ready after <x.y> s` and the published URLs.
         - A failed `up` leaves the containers for diagnosis.
    - **`pulse down [--dir] [--volumes]`** runs `docker compose … down`. It removes the project's containers and networks, and keeps volumes, generated files and secrets. `--volumes` adds `-v` and prints `deleted the volumes of project <name> (database, notify ledger, runtime secrets)`. It is never the default.
14. **`pulse status [--dir] [--json]`.**
    - **Rows:** one per service in `pulse.json`, in that order, including stopped and missing services. Columns `SERVICE`, `STATE`, `READY`, `VERSION`.
    - **Data:** `docker compose … ps --all --format json` gives state, health, exit code and image. A `/readyz` call (5 s bound) runs for each running pulse service.
    - **READY values:** `ready`, `not ready (<reason>)`, `completed`, `failed (exit <n>)`, `running` (helpers), `stopped`, `missing`.
    - **VERSION:**
      - the tag of the image reference, for example `0.1.0` from `ghcr.io/lorenzh/pulse-api:0.1.0@sha256:…`;
      - `dev (local build)` for `pulse-<svc>:dev`;
      - `sha256:<first 12 hex>` for a digest-only reference;
      - else `unknown`.
    - **Exit code:** 0 when every row is `ready`, `completed` or `running`; 1 otherwise; 3 for the Docker preflight.
    - `--json` prints `[{"service","state","ready","version"}]` in the same order, for scripts and CI.
15. **Exit codes, help, output.**
    - Exit codes: 0 success; 1 operation failed (conflict, lock, not ready, Compose error, project guard, missing env); 2 usage or validation error; 3 Docker or Compose missing, too old or unreachable; 130 interrupted.
    - `pulse --help`, `pulse <cmd> --help` and `pulse --version` (`pulse <version>`, the version from `package.json`) exit 0.
    - An unknown flag exits 2 with `unknown option --<x>; see pulse <cmd> --help`.
    - **Output** never holds a token value or an env value. `init` prints the written, kept and backed-up paths, the URLs and the next command. Compose's own output of `up` and `down` is passed through.
16. **pulse.json** (format 1). Keys: `format` (1), `cliVersion`, `setup`, `project`, `services` (ordered list of `{"name", "kind": "pulse"|"oneshot"|"helper", "port"?}`; `port` only for kind `pulse`; order: `secrets-init`, then the helpers `mailpit`, `demo-targets`, `demo-tls` as enabled, then `api`, the probes (`probe`, or `probe-eu`, `probe-us`), `status`, `notify`, `console` as enabled), `urls` (`status`, `console`, `mailpit`, `api`, each present only when published), `createdAt` (ISO time of init). It holds no secret value. `up` and `status` read the service list from it. A service that `docker compose … config --services` does not know fails `up` with `pulse up: service <svc> from pulse.json is not in the Compose project`. So a stale or edited `compose.yaml` cannot pass as ready.
17. **Distribution.**
    - **Version and tag:** `package.json` `version` starts at `0.1.0`. A person releases by pushing the tag `v<version>`.
    - **Assets:** `pulse-linux-x64`, `pulse-linux-arm64`, `pulse-darwin-arm64` and `SHA256SUMS` (`sha256sum` format, the three binaries).
    - **Each binary is compiled natively** on its runner, so every released binary has been run on its own OS and CPU:
      - `ubuntu-24.04` for linux x64, `ubuntu-24.04-arm` for linux arm64, `macos-15` for darwin arm64 (`macos-15` approved in this spec PR);
      - `bun build --compile --minify cli/main.ts --outfile dist/pulse-<os>-<arch>`;
      - if the macOS binary does not run because it lacks a signature, the job applies an ad-hoc `codesign --sign -` (a built-in macOS tool), and the docs say so.
    - **`release.yml`** runs on `push: tags: ["v*"]`:
      - job `create`: `gh release create <tag> --draft --verify-tag`, with `contents: write`;
      - job `build` (matrix of the three runners, `contents: write`): checkout, `setup-bun`, `bun install --frozen-lockfile`, compile, the smoke test, a check that `pulse --version` prints `pulse ${GITHUB_REF_NAME#v}` (the expected value comes from the tag), and `gh release upload`;
      - job `publish` (`contents: write`): `gh release download`, `sha256sum` of the three binaries into `SHA256SUMS`, upload, `gh release edit --draft=false`.
      - Workflow-level `permissions: contents: read`. Actions only `actions/checkout` v7.0.1 (with `persist-credentials: false`) and `oven-sh/setup-bun` v2.2.0, by SHA. No upload-artifact and no release action.
    - **Install** (docs): download the asset and `SHA256SUMS`, run `sha256sum -c --ignore-missing` (`shasum -a 256 -c` on macOS), `chmod +x`, move it to a directory on `PATH` as `pulse`. Uninstall: delete the binary. The install directories stay theirs.

## Required behavior

Summary of the observable behavior. Details are in the decisions above.

- `pulse init [<dir>] [flags]` writes the layout of decision 5 for the answers of decisions 6–9. It never writes a secret value outside `secrets/`, and never prints one.
- Every question has a flag. With `--yes` it runs without prompts and needs no Docker.
- A second `pulse init` without `--force` exits 1, lists the conflicts and changes no byte, mode or file. `--force` backs up the replaced files and keeps valid tokens.
- `pulse up` starts and waits with a finite deadline, naming the services that are not ready. `pulse status` lists every service with state, readiness and version. `pulse down` keeps data unless `--volumes` is given.
- Docker or Compose missing, too old or unreachable gives a clear message and exit 3.
- The generated directory works with plain `docker compose` (`docs/cli.md`, "Without the CLI").

### Flags of `pulse init`

| Flag | Values | Default with `--yes` |
| --- | --- | --- |
| `--setup` | `minimal`, `full`, `demo`, `dev` | `full` |
| `--status` / `--no-status`, `--notify` / `--no-notify`, `--console` / `--no-console` | boolean | per setup (decision 6) |
| `--api-port`, `--status-port`, `--console-port`, `--mailpit-port` | 1–65535 | 3000, 8080, 8082, 8025 |
| `--status-url`, `--console-url` | http(s) URL | decision 7 |
| `--location` | `^[a-z0-9][a-z0-9-]{0,31}$`, not in demo | `default` |
| `--src-dir` | path, dev only | `..` |
| `--project` | `^[a-z0-9][a-z0-9_-]{0,62}$` | per setup (decision 13) |
| `--checks` | `sample`, `demo`, `none` | per setup (decision 8) |
| `--check` | repeatable, decision 8 | none |
| `--channel` | repeatable: `email`, `webhook` | demo: `email` (mailpit); else none |
| `--smtp-host`, `--smtp-port`, `--smtp-tls`, `--smtp-user`, `--smtp-password-env`, `--mail-from`, `--mail-to` (repeatable), `--mail-subject-prefix` | decision 9 | decision 9 |
| `--webhook-url`, `--webhook-secret-env` | decision 9 | — |
| `--start` / `--no-start` | boolean | no start |
| `--force` | boolean | off |
| `--yes`, `--interactive` | boolean, exclusive | — |

A flag that does not fit the setup (`--api-port` in full or demo, `--location` in demo, `--src-dir` outside dev, `--mailpit-port` outside demo, channel flags with `--no-notify`, `--smtp-*` without `--channel email`) exits 2 and names the flag and the reason. It is never silently ignored.

## Performance impact

- **api `bench/budgets.json`** (keys such as `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `startup_wall_ms`; verified in `.repos/api/bench/budgets.json`): none expected. No api file and no api image changes; the CLI generates Compose files for the already published `0.1.0` images.
- **The standalone setups:** no change in start time or RSS. The `secrets-init.mjs` additions are inactive unless their new variables are set.
- **Reported, new (no budget, as the issue asks):**
  - **Binary size:** the byte count of each of the three uncompressed binaries (`wc -c`), plus MiB rounded to 0.1. It is written to the job summary of the CI `cli-build` jobs and copied into the deploy PR. Expected order of magnitude: about 60–110 MiB each, almost all of it the embedded Bun runtime. This is a sanity guide, not a gate.
  - **`pulse init` time:**
    - **Method:** one warm-up run, then 11 timed runs of `pulse init --setup demo --yes`, each in a fresh empty temp directory, stdin `/dev/null`, from the compiled binary on the native runner of each target.
    - **Clock:** wall time of the process from spawn to exit, measured with `python3` `time.perf_counter()` around `subprocess.run` (so the same script works on Linux and macOS).
    - **Statistic:** the median of the 11 samples, which is the 6th smallest value (no averaging), rounded to 1 ms. The minimum and maximum are also reported.
    - **Report:** the runner label, the repetitions and the statistic go into the job summary and the PR. It excludes Docker, pulls and start. Expected: well under 1 s.

## Security impact

Security impact: yes. The change generates tokens, writes secret files, extends the secrets copy into containers, adds CI and a release workflow with `contents: write`, and passes user input into Compose files.

Checklist items that apply:

- **Secrets in errors, logs and responses:**
  - No CLI output, error, backup notice or `pulse.json` holds a token or a value of a referenced env variable.
  - Errors name the file and the rule.
  - `secrets-init.mjs` keeps its "never print a token" rule in the new code paths.
  - CI runs `docker compose config` only with `--quiet` (a full `config` prints resolved env values), and masks any token it reads.
- **Atomic, path-safe writes:**
  - temp file plus rename for every file;
  - `wx` creation;
  - explicit modes (0600 token files, 0700 `secrets/` and backup directories, 0600 `.env` and backup files);
  - refusal of symlinks and non-regular files at managed paths and in managed parent directories;
  - an exclusive lock file;
  - a backup before replacement, with the backup deleted when it fails;
  - no write outside `<dir>`.
- **Input validation:**
  - flags and answers are validated before any write (ports, URLs, env names, ids, durations, locations, project name);
  - values in `.env` are single-quoted, and `'`, newlines and NUL are refused;
  - YAML strings are JSON-escaped, and `$` becomes `$$`;
  - JSON files are built with `JSON.stringify`, never by concatenation;
  - check fields follow the `0.1.0` api rules, so the api never starts with a broken file.
- **Credentials in URLs:**
  - user info in check URLs, webhook URLs and public URLs is refused;
  - a query string in a webhook URL is refused;
  - the docs say literal URLs are clear text.
- **Process execution:** every Docker call is an argument array; no shell string ever holds user input.
- **Auth:** the generated admin and probe tokens are different 256-bit values. secrets-init refuses an admin token equal to a probe token (the api refuses it too). Probe tokens are per location and per volume; console sees only the admin token, and status and notify see no token.
- **Dependency pins:**
  - no runtime dependency;
  - dev dependencies exact from the approved list;
  - images only from `common/services.yaml`;
  - actions by SHA from the approved list;
  - `contents: write` only on the release jobs, workflow default `contents: read`;
  - `bun install --frozen-lockfile`;
  - the release publishes `SHA256SUMS`.

The security state after the review should try:

- a planted symlink at `secrets/admin-token` pointing to a file outside `<dir>`, and at `config/` pointing outside;
- a `secrets/` directory with mode 0755;
- `--force` with a 0644 or placeholder token file;
- `--status-url "http://user:pw@x"`, `--webhook-url "https://h/x?token=abc"`, a URL holding `${HOME}` or `'`;
- `--smtp-password-env PULSE_API_URL`, `COMPOSE_FILE` or `lower`;
- `--project` with `../` or upper case;
- a check name with a newline, `"` or `: #`;
- concurrent `pulse init` runs;
- `--location 'x","token":"y'`.

## Rollout order

One repository: deploy. All code and CI changes are in pulse-deploy. The meta change is in this spec PR.

1. **meta, this spec PR:** the approved-list rows for `macos-15` and the pulse-deploy use of `setup-bun`. No consumer reads them at run time; they authorize step 2.
2. **deploy:** the CLI, the `secrets-init.mjs` and `demo/init.mjs` additions, CI and `release.yml`.
   - Older consumers keep working. The standalone setups run with the unchanged default paths of `secrets-init.mjs` (`PULSE_PROBE_LOCATIONS` and `PULSE_SECRETS_ADMIN` unset), proven by the unchanged `minimal`, `full`, `demo`, `dev` and e2e jobs.
   - The services run the same `0.1.0` images.
3. **After merge:** a person pushes the tag `v0.1.0` to pulse-deploy. `release.yml` publishes the binaries and `SHA256SUMS`.
   - Until then, no release exists, and the docs' install section points to the releases page.
   - Generated installs embed the `common/services.yaml` of their CLI version. A later image bump needs a new CLI release for new installs. Existing installs keep their pins until the user edits `compose.yaml` (`pulse upgrade` is #530).

The api token store change of #561 (spec merged, in flight) is not a dependency. Each bump PR of `common/services.yaml` runs the CLI stack jobs below, so an incompatible token format fails there before a release.

## Counterexamples

- **Second init:** `pulse init --setup demo --yes` twice. The second run must exit non-zero, and the snapshot of `find . -printf '%p %m %s\n'` plus `sha256sum` of every file must be equal before and after. There must be no `.pulse-backup/` and no `.pulse-init.lock`. A wrong implementation that "skips existing files and writes the rest" exits 0 or creates new files.
- **Force keeps tokens:** after `init --force`, `secrets/admin-token` has the same bytes as before. A wrong implementation regenerates it (silent rotation) or backs it up and replaces it.
- **Force with a bad token:** `secrets/probe-token-default` with mode 0644 and `--force` is backed up (0600 in the backup) and replaced. With content `replace-with-x` it is replaced too.
- **Symlink:** `secrets/admin-token -> /tmp/outside` with or without `--force` exits 1, and `/tmp/outside` is unchanged. So is a symlinked `config` directory.
- **Backup failure:** a read-only `.pulse-backup/` (mode 0500) with `--force`: the CLI exits 1, and every managed file is unchanged.
- **Partial input:** `pulse init --setup full --status-port 99999` exits 2 and writes nothing, including no `secrets/`. stdin closed without `--yes` and without `--setup` exits 2 within 1 s, and does not hang.
- **Ports:** `--status-port 8082` with console on its default 8082 is refused (same port, different bind address). `--api-port 3000` with `--setup full` is refused (the api is not published in full).
- **URLs:** `--status-url ftp://x`, `--status-url "http://a:b@x"`, `--status-url "http://x/?q=1"` and `--status-url "http://x/#f"` are refused. `http://status.example.com/` is accepted, and the trailing slash is kept: status removes it itself.
- **Compose interpolation:** a check name `Cost $5` ends up in `checks.json` as `Cost $5`. A `--status-url` holding `$` (a valid URL character) appears in `docker compose config --format json` (run in a test directory with no secrets) as the same literal text, not as an interpolated value. A wrong emitter writes `$5`, and Compose warns and drops the value.
- **Env names:** `--smtp-password-env PULSE_API_URL`, `COMPOSE_PROJECT_NAME`, `smtp_password`, `1PASS` and a 65-character name are refused. `SMTP_PASSWORD` is accepted. `--smtp-user ops` without `--smtp-password-env` is refused. `--smtp-tls none --smtp-user ops --smtp-host mail.example.com` is refused.
- **Env preflight:** with `HOOK_SECRET` neither exported nor in `.env`, `pulse up` exits 1 naming `HOOK_SECRET`, and `docker compose ps -a` is still empty afterwards. With `HOOK_SECRET=` (empty) it fails too.
- **Checks:**
  - `type=domain,domain=example.com,interval=30m` is refused (below 1 h);
  - `interval=5s` is refused (below 10 s);
  - `interval=60s,timeout=60s` is refused (the timeout must be less than the interval);
  - `type=tcp,host=db` is refused (no port);
  - `type=dns,dns=example.com,record=a` is refused (upper case only);
  - `url=https://u:p@h/` is refused;
  - `type=heartbeat` is refused with a pointer to the docs;
  - `--checks demo --setup full` is refused;
  - two `--check url=https://example.com/` give the ids `https-example-com` and `https-example-com-2`;
  - an explicit duplicate `id=a` twice is refused.
- **Location injection:** `--location 'x","token":"y'` is refused by the location pattern. Even if it reached `secrets-init`, `LOCATION_PATTERN` would refuse it there. A test sets `PULSE_PROBE_LOCATIONS='a,x"y'` for `secrets-init.mjs` and expects exit 1 with no file written.
- **Admin token equal to a probe token:** both host files with the same content make secrets-init exit 1 with `/in/admin-token: must differ from every probe token`, and api does not start.
- **Default paths unchanged:** `secrets-init.mjs` with neither new variable and `/in/probe-token` present writes exactly `/out/api/tokens.json` and `/out/probe/probe-token`, as before. The existing `scripts/secrets-init.test.sh` cases still pass unchanged.
- **Readiness:**
  - a pulse container that is `healthy` while `/readyz` answers 503 is not ready;
  - a `secrets-init` that exited 1 fails `up` at once, not at the deadline;
  - a stopped `console` is reported as `console (not running)`;
  - a `docker compose exec` that hangs forever (stub `docker` that sleeps) with `--timeout 2` must end `up` within 5 s wall time and name the service;
  - a readiness list derived from `docker compose ps` would miss a service that was never created; the list comes from `pulse.json`, so the service shows as `missing`.
- **Compose version:** `2.22.9` and `v2.22.0` are refused; `2.23.0`, `v2.23.0`, `2.38.2` and `2.100.0` are accepted. A string compare would wrongly accept `2.3.0` and refuse `2.100.0`.
- **Project guard:** with the repository's `full/` stack running as project `pulse`, `pulse up` in a generated full install named `pulse` exits 1 and names the other directory. `pulse status` there also refuses instead of showing the other stack.
- **Status exit:** one service `not ready` makes `pulse status` exit 1 even when all others are ready. `completed` (secrets-init) and `running` (demo helpers) count as fine.
- **Down:** `pulse down` keeps the volume `pulse-demo_api-data`. `pulse down --volumes` removes it.
- **init time statistic:** with 11 samples 120…130 ms in some order, the median is the 6th smallest value, not the mean of the samples, and not the mean of two values.

## Contract fields

No contract or config names change. The new names live inside pulse-deploy:

- the `secrets-init` variables `PULSE_PROBE_LOCATIONS` and `PULSE_SECRETS_ADMIN`;
- the host files `secrets/admin-token` and `secrets/probe-token-<loc>`;
- the volumes `console-secrets` and `probe-<loc>-secrets`;
- the runtime files `/run/pulse/admin-tokens.json` and `/run/pulse/admin-token`;
- the install file `pulse.json` and the backup directory `.pulse-backup`;
- the CLI flags.

Collision search, run in this plan inside `.repos/` (the read-only clones):

```
for n in PULSE_PROBE_LOCATIONS PULSE_SECRETS_ADMIN pulse.json probe-token- admin-token console-secrets PULSE_SRC_DIR PULSE_STATUS_PORT pulse-backup PULSE_PROJECT; do
  printf '%s contract:%s config:%s\n' "$n" "$(grep -rn -- "$n" contract/src | wc -l)" "$(grep -rn --exclude-dir=node_modules -- "$n" config | grep -v '^config/.git' | wc -l)"
done
# every count: 0
```

In deploy, `admin-tokens` appears today only in the test-only e2e overlay and in `full/README.md` (the opt-in example). Those name a different path, `/run/pulse-admin/admin-tokens.json`, and stay unchanged.

Reused names with unchanged meaning:

- `PULSE_API_PORT`, `PULSE_STATUS_PORT`, `PULSE_CONSOLE_PORT`, `PULSE_MAILPIT_PORT` and `PULSE_SRC_DIR` (Compose host variables of #528);
- the service settings `PULSE_TOKENS_FILE`, `PULSE_PROBE_TOKEN_FILE`, `PULSE_API_ADMIN_TOKENS_FILE`, `PULSE_CHECKS_FILE`, `PULSE_NOTIFY_CONFIG`, `PULSE_STATUS_PUBLIC_URL`, `PULSE_STATUS_SHOW_CHECKS`, `PULSE_CONSOLE_ADMIN_TOKEN_FILE` and `PULSE_LOCATION`, all documented at the services' `v0.1.0` tags;
- the notify channel keys `passwordEnv`, `secretEnv` and `statusUrl`.

## Repository: deploy

Files:

- `cli/main.ts` and the CLI modules under `cli/` (decision 1), with `cli/*.test.ts` next to them
- `cli/test/` (fixtures, the stub `docker` script, the webhook receiver `hook-receiver.ts`, `smoke.sh`, `measure-init.py`, `up-timeout.test.sh`)
- `package.json`, `bun.lock`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `eslint.config.js`, `lefthook.yml` (new)
- `scripts/secrets-init.mjs`, `scripts/secrets-init.test.sh` (new modes and their cases)
- `demo/init.mjs` (output path from `PULSE_DEMO_CHECKS_FILE`, default `/shared/checks.json`)
- `.github/workflows/ci.yml` (new jobs), `.github/workflows/release.yml` (new)
- `docs/cli.md` (new), `README.md`, `AGENTS.md`, `dev/README.md` (a pointer to `pulse init --setup dev`), `.gitignore` (`node_modules/`, `dist/`)

Behavior change: yes. A new CLI, new `secrets-init` modes, new CI jobs and a release workflow.

### Tool facts (verified)

- **Bun:**
  - Bun 1.4.0 is the approved runtime (`docs/approved-packages.md`, "Runtime and CI").
  - deploy has no `package.json` today (`deploy/AGENTS.md` "Project": "There is no TypeScript and no `package.json`"). This change adds `packageManager: bun@1.4.0` and `engines.bun: 1.4.0`, as `api/package.json` lines 8–10 and 35.
- **Scripts** as in `config/package.json` lines 35–37 and `api/package.json` lines 14–20:
  - `typecheck`: `bun node_modules/typescript7/bin/tsc --noEmit`;
  - `test`: `bun test cli`;
  - `lint`: `biome check . && pulse-eslint . && pulse-workflows`;
  - `format`: `biome check --write .`;
  - `check`;
  - `build`: `bun build --compile --minify cli/main.ts --outfile dist/pulse`, with `--outfile` overridden per runner in CI;
  - `prepare`: `lefthook install || true`.
- **CI check:** `ci.yml` adds the job `check: uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`.
  - That workflow runs `setup-bun` with `bun-version: 1.4.0`, `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and `bun run test` on `ubuntu-24.04` (`config/.github/workflows/check.yml` lines 16–38).
  - The file at the pinned SHA is identical to the clone (`gh api …/check.yml?ref=04108fa…` diffed: no difference).
  - `pulse-workflows` (`config/src/workflow-policy.ts` lines 155–181) then requires that every `uses:` in deploy's workflows is in `config/actions-policy.json`, that `persist-credentials: false` is set on checkout, and that the reusable workflow ref equals the `package.json` config pin.
  - deploy's existing jobs use only `actions/checkout` v7.0.1 with `persist-credentials: false` (`deploy/.github/workflows/ci.yml`), so they pass.
- **TypeScript:** `tsconfig.json` extends `@lorenzh/pulse-config/tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`: `config/tsconfig.base.json` lines 8–11) and includes `cli`.
- **Biome:**
  - `biome.json` extends `@lorenzh/pulse-config/biome.json`. The shared `files.includes` is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures` (`config/biome.json` lines 10–16; identical at the pinned SHA).
  - deploy's own `biome.json` narrows `files.includes` to `cli/**`, `package.json`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `eslint.config.js`, `lefthook.yml`, keeping the shared negations. The existing `.mjs` helpers and setup JSON files keep their `node --check` and `jq empty` checks and are not reformatted in this change.
  - The implementer confirms the effective scope with `biome check --verbose` and states it in the PR.
- **ESLint:** `eslint.config.js` spreads the shared config with `ignores: [".repos/**", "dist/**"]`, as `api/eslint.config.js`. The shared rules apply to `**/*.ts` and `**/*.js` (`config/eslint.config.js` lines 11 and 20), so the `.mjs` helpers stay outside ESLint.
- **Coverage:** `bunfig.toml` `[test]` has `coverage = true` and `coverageThreshold = { lines = 0.8 }`, as `config/bunfig.toml`.
- **Docker in CI:** the deploy `lint` job already checks Compose ≥ 2.23 on `ubuntu-24.04` (`deploy/.github/workflows/ci.yml` lines 23–30). `macos-15` runners have no Docker, so jobs that need Docker run on `ubuntu-24.04` only.

### Behavior

Everything in "Decisions" 1–17 and "Required behavior". In particular:

- **Pure core, injected I/O.** The core never touches the clock, the RNG, files, `process.env` or Docker directly:
  - answers come from flags and prompts;
  - rendering produces a file map;
  - side effects come in as dependencies: `now`, `randomBytes`, the file system operations, `env`, `spawn`, `sleep`, `isTTY`, and the input and output streams.
  - `main.ts` wires the real ones.
- **Tests** use fakes, with no real Docker and no network. Each test writes to its own `mkdtemp` directory.
- **`scripts/secrets-init.mjs`:** the two additive modes of decision 10, with the existing output messages style. `scripts/secrets-init.test.sh` gets cases for:
  - two locations;
  - a missing location file;
  - a 0644 location file;
  - an admin token, with and without `/out/console`;
  - admin equal to a probe token;
  - a bad `PULSE_SECRETS_ADMIN` value;
  - a location with `"`.
- **`demo/init.mjs`:** reads the output path from `PULSE_DEMO_CHECKS_FILE`, default `/shared/checks.json`. The standalone demo is unchanged.
- **Docs:**
  - **`docs/cli.md`:**
    - install, checksum and uninstall;
    - prerequisites: Docker Engine with Compose ≥ 2.23; no Bun;
    - a walkthrough of every prompt;
    - every flag with its default, and the exit codes;
    - the generated layout and modes;
    - tokens: format, preservation, no rotation, and how to rotate by hand;
    - secret env references and how to provide them (export, or a line in `.env`, which is 0600);
    - backups and `--force`;
    - dev sources; readiness errors and what to run next;
    - what `down` keeps, and `--volumes`;
    - the demo maintenance refresh;
    - heartbeat and header secrets by hand;
    - **"Without the CLI":** `docker compose up -d`, `docker compose ps`, the readiness check command, `docker compose down`, editing `config/api/checks.json` (hot reload), editing `.env` ports, adding a second probe location by hand (a new `secrets/probe-token-<loc>` file, the `PULSE_PROBE_LOCATIONS` value and a probe service).
  - **README:** a "pulse CLI" section and a link.
  - **AGENTS.md:**
    - the Project paragraph (TypeScript now exists in `cli/`);
    - the Layout table (`cli/`, `docs/`);
    - the Commands table (`bun run check`, `bun run build`, the CLI CI scripts);
    - the CI job list;
    - the rule that `cli/` holds no image pin.
- **CI** (`.github/workflows/ci.yml`, new jobs; the existing jobs stay unchanged):
  - **`check`:** the reusable `check.yml` (above).
  - **`cli-build`** (matrix `ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`):
    - checkout, `setup-bun` 1.4.0, `bun install --frozen-lockfile`, compile the native binary;
    - copy it to `$RUNNER_TEMP/bin/pulse`;
    - run `cli/test/smoke.sh` with `env -i PATH=$RUNNER_TEMP/bin:/usr/bin:/bin HOME=$HOME`, so no Bun is on `PATH`.
    - **smoke.sh, in a fresh empty temp directory:**
      - `pulse --version`;
      - `pulse init --setup demo --yes </dev/null` exits 0;
      - the literal list of expected paths exists, with the literal modes 0700 for `secrets/` and 0600 for each token file and `.env` (`stat -c %a` on Linux, `stat -f %Lp` on macOS);
      - each token file matches `^[0-9a-f]{64}$`, and the three tokens differ;
      - a second `init` exits 1 and the snapshot (paths, modes, sha256) is unchanged;
      - `init --force` keeps the three token files byte-equal, and the backup directory is 0700 with 0600 files.
    - Then `cli/test/measure-init.py` (decision on performance). The binary size and the init time go to `$GITHUB_STEP_SUMMARY`.
  - **`cli-render`** (`ubuntu-24.04`): renders the variants below with the source CLI (`bun cli/main.ts init … --yes`) into temp directories, with no secret env set. For each variant:
    - `docker compose --project-directory <d> config --quiet`;
    - the published ports from `config --format json`, piped only into `jq` on ports and images, never printed in full, equal a literal table in the test script;
    - every image matches the pin shape of `check-setup.sh` rule 2, or `pulse-<svc>:dev` for dev;
    - the set of resolved pulse images of a generated full equals that of `docker compose -f full/compose.yaml config` (the standalone setup, an independent resolution of `common/services.yaml`);
    - no volume or config other than a `*-secrets` volume targets `/run/pulse` (rule 8 logic);
    - `network_mode` is only `none` (rule 9).

    The variants:

    1. minimal;
    2. minimal `--status --console --check type=tcp,host=example.com,port=443 --check type=dns,dns=example.com --check type=tls,host=example.com --check type=domain,domain=example.com`;
    3. full;
    4. full `--no-status` (the probe has no `status` dependency; the sample checks are the minimal set);
    5. demo;
    6. demo `--no-notify` (no mailpit service, no notify);
    7. dev with stub source directories (each with a `Dockerfile`), `config --quiet` only;
    8. full with custom ports `--status-port 18080 --console-port 18082` and `--status-url https://status.example.com`.

    **Secret grep:**
    - variants 3 and 8 add `--channel email --smtp-host mail.example.com --smtp-user ops --smtp-password-env SMTP_SENTINEL --channel webhook --webhook-url https://hooks.example.com/x --webhook-secret-env HOOK_SENTINEL`;
    - the job exports `SMTP_SENTINEL=smtp-sentinel-5f2a` and `HOOK_SENTINEL=hook-sentinel-9c1e` while it runs `init` and `config --quiet`;
    - it then runs `grep -rF` for both sentinels and for each generated token value over every generated file except `secrets/` and `.pulse-backup/`, and over the captured CLI stdout and stderr: no match.

    The expected file layout and port tables are literals in the test script.
  - **`cli-stack`** (`ubuntu-24.04`, matrix `demo`, `full`, `minimal`) builds the linux x64 binary. In an empty temp directory outside the checkout:
    - **demo** (the acceptance core):
      1. `pulse init --setup demo --yes`;
      2. `docker compose config --quiet`;
      3. `pulse up --timeout 300`;
      4. `pulse status --json`. Its `service` list equals the literal `["secrets-init","mailpit","demo-targets","demo-tls","api","probe-eu","probe-us","status","notify","console"]` (the order of `pulse.json` as specified here). Every `ready` is `ready`, `completed` or `running`, and `pulse status` exits 0.
      5. The demo job's assertions (a) open `down-on-purpose` incident and (b) `[pulse demo] DOWN:` mail, both within 300 s of `up`, reused from the `demo` job with `docker compose --project-directory`.
      6. **Admin auth with the generated file:** `docker compose exec -T api bun -e '<fetch GET /admin/config with Bearer from stdin>' < secrets/admin-token` answers 200. Without a token it answers 401. With `secrets/probe-token-eu` it answers 403. The literals come from `api/docs/rest-api.md` at `v0.1.0`.
      7. `pulse down`: `docker compose ps -a -q` is empty, `docker volume ls -q --filter label=com.docker.compose.project=pulse-demo` is not empty, and the generated files are unchanged (sha256 snapshot).
      8. `pulse down --volumes`: the volume list is empty.
    - **full:**
      - `pulse init --setup full --yes --channel email --smtp-host mail.invalid --smtp-user ops --smtp-password-env SMTP_SENTINEL --channel webhook --webhook-url http://host.docker.internal:9999/hook --webhook-secret-env HOOK_SENTINEL --check url=http://127.0.0.1:1/,name=Down`, plus a `compose.override.yaml` in the test directory that adds only `extra_hosts: ["host.docker.internal:host-gateway"]` to notify;
      - first `pulse up` without `HOOK_SENTINEL` set: exit 1 naming it, no container created;
      - then with both exported: up and ready. notify is ready only when both env names reached it, because notify stops at start without them;
      - `cli/test/hook-receiver.ts` (host Bun, port 9999) verifies `X-Pulse-Signature` with the sentinel and records an `opened` event for check `down` within 180 s;
      - the sentinel grep over generated files, CLI output and `docker compose logs`: no match.
    - **minimal:** `pulse init --setup minimal --yes --status --console`, `pulse up`, `pulse status` exits 0. `curl http://127.0.0.1:3000/checks` lists `status-page` with a state other than `unknown` within 90 s.
    - On failure: `docker compose ps --all` and `logs --no-color`. Teardown always: `pulse down --volumes`.
  - **`dev` job (existing):** after its teardown, add `pulse init --setup dev --yes --src-dir <workspace>` in a temp directory next to the checkouts, `pulse up --timeout 900`, `pulse status`, `pulse down --volumes`, using the source CLI (`bun cli/main.ts`). The images are already built, so this mostly reuses the cache.
  - **`cli-errors`** (`ubuntu-24.04`): `cli/test/up-timeout.test.sh` with a stub `docker` first on `PATH` and the compiled binary:
    - an `exec` that sleeps 600 s, with `--timeout 2`: exit 1 within 5 s, and the message names the service;
    - no `docker` binary: exit 3 and `Docker is not installed`;
    - stub `compose version --short` printing `2.22.0`: exit 3 and `older than 2.23`;
    - stub daemon failure: exit 3 and `cannot reach the Docker daemon`.
- **`release.yml`:** decision 17.

### Tests (bun test, no Docker, no network)

- **args:** every flag, every refusal in "Counterexamples" that does not need Docker, `--yes`/`--interactive` exclusivity, flags that do not fit the setup.
- **prompts:**
  - driven through injected streams (and once through the real process with `--interactive` and a piped stdin, spawned with `Bun.spawn`);
  - the whole full flow with status off, a `tcp` check, the email channel with a password env and the webhook with a secret env;
  - an invalid port answer that is re-asked;
  - EOF in the middle (exit 2, nothing written);
  - "Start now?" yes (the injected Docker runner receives `up`) and no;
  - the same answers as flags give byte-equal non-secret files (all files except `secrets/` and `pulse.json` `createdAt`).
- **yaml:** round trip `Bun.YAML.parse(emit(x))` deep-equals `x` for hostile strings (`: #`, newline, `"`, `\`, leading `-`, `true`, `null`, `0755`) with `$` turned into `$$`.
- **render:**
  - per variant, the service list, the dependencies (probe without status), the mounts (only consumers mount their secrets volume; console only when on);
  - notify env bare keys;
  - the sample check set by status;
  - the demo checks equal the output of `PULSE_DEMO_CHECKS_FILE=<tmp> bun demo/init.mjs` (an independent producer), with the same ids, names, targets and intervals, and the same maintenance offsets relative to each producer's `now` to within 5 s.
- **write-install:**
  - fresh write and modes;
  - the conflict list;
  - an exact snapshot after a refused second run;
  - `--force` backup content and modes;
  - kept valid tokens and replaced invalid ones;
  - symlink refusal at a file and at a parent;
  - backup failure rollback;
  - lock present;
  - "no longer used" listing.
- **tokens:** 32 bytes to 64 hex characters; a collision with an injected RNG is regenerated.
- **docker/ready/status** with a fake spawn:
  - preflight messages and exit codes;
  - the version compare cases;
  - the project guard;
  - the env preflight;
  - a failed one-shot fails fast;
  - healthy but `/readyz` 503 is not ready;
  - the deadline with a fake clock;
  - each spawned readiness call gets a kill bound ≤ the remaining time;
  - `pulse.json` service unknown to Compose;
  - status rows, versions, the JSON output and the exit codes.

### Completion evidence

1. The `check`, `lint`, `pins`, `minimal`, `full`, `demo`, `dev`, `cli-build` (three runners), `cli-render`, `cli-stack` (three variants) and `cli-errors` jobs are green on the PR.
2. The PR quotes the `cli-stack demo` lines:
   - `pulse status` output with every service and its version;
   - the admin auth 200, 401 and 403 lines;
   - `pulse down` keeping volumes.
3. The PR quotes the `cli-build` summary: the size of each binary in bytes and MiB, and the median, minimum and maximum `init` time per runner. It states that each binary ran natively on its own runner, and whether `codesign` was needed on macOS.
4. The PR names `bun run check` passing locally and the effective Biome scope.
5. `git grep -nE 'sha256:[0-9a-f]{64}|pulse-(api|probe|status|notify|console):[0-9]+\.[0-9]+\.[0-9]+' -- cli docs .github package.json` prints nothing. Only `common/services.yaml` holds pins, and `scripts/check-setup.sh` still passes unchanged.
6. The PR states the known limits:
   - the macOS binary is not signed or notarized;
   - the demo maintenance windows are relative to `init`;
   - the generic webhook URL is clear text;
   - an interrupted write needs `--force`;
   - no release exists until a person pushes `v0.1.0`.

## Risks

- **Bun compile on macOS:** a cross-built or unsigned macOS binary can be killed by the OS. Native compilation on `macos-15` plus an ad-hoc `codesign` fallback addresses it. The `cli-build` macOS run proves it.
- **Admin routes with a read-only checks mount** answer 503 for writes. This matches `full`. The docs show the writable mount; console makes no API call in `0.1.0`.
- **Future image bumps** (for example #561's token store) can change token file formats. The CLI stack jobs run on every bump PR and catch it before a release.
- **Project name `pulse`** is shared with the repository's `full/`. The project guard prevents control across directories, but two installs cannot run at once without `--project`.
- **Binary size** (~100 MiB) is the Bun runtime. Accepted: the issue asks only to report it.
- **The scope is large.** The breakdown should split it into the toolchain and CI skeleton, rendering, writing and backups, prompts, lifecycle commands, the secrets-init extension, the CLI CI jobs, the release, and docs.

## Acceptance evidence

Each check names where its expected value comes from.

1. **Empty dir, demo, no prompt** (`cli-build`, `cli-stack demo`):
   - `pulse init --setup demo --yes </dev/null` from the compiled binary, with no Bun on `PATH`, exits 0 (literal);
   - the files of the literal path list exist;
   - `docker compose config --quiet` exits 0 (Compose's own validation, independent of the CLI).
2. **Up, ready, status, down** (`cli-stack demo`):
   - `pulse up` exits 0 within 300 s;
   - `pulse status --json` lists the literal ten services, all `ready`, `completed` or `running`, and exits 0;
   - the open `down-on-purpose` incident and the `[pulse demo] DOWN:` mail to `ops@example.com` (literals from the #528 demo job);
   - `pulse down` leaves no containers (`docker compose ps -a -q` empty) and keeps volumes; `--volumes` removes them (Docker's own listing).
3. **No secret values; modes** (`cli-render`, `cli-stack full`):
   - `grep -rF` for the literal sentinels `smtp-sentinel-5f2a` and `hook-sentinel-9c1e`, and for each generated token, over the generated non-secret files, the CLI output and the container logs: zero matches;
   - token files are 0600 and `secrets/` is 0700 (literal modes, read with `stat`).
4. **Second init** (`cli-build` smoke, unit test):
   - exit status ≠ 0;
   - the snapshot of paths, modes and sha256 taken before the second run equals the one after (two independent listings of the file system).
5. **Interactive flow** (unit tests): the prompts are driven through injected input and through the real process with `--interactive`. The resulting non-secret files equal the files that the same answers produce as flags (two independent runs).
6. **Real wiring:**
   - admin `GET /admin/config` answers 200 with `secrets/admin-token`, 401 without a token and 403 with a probe token (status codes from `api/docs/rest-api.md` at `v0.1.0`);
   - the webhook receiver verifies the HMAC with the literal sentinel secret.
7. **Errors** (`cli-errors`, unit tests): exit 3 with the literal messages for missing Docker, an unreachable daemon and Compose `2.22.0`; a hanging readiness with `--timeout 2` ends within 5 s, measured by the test's own clock.
8. **Without the CLI:** the `docs/cli.md` "Without the CLI" commands run in the `cli-stack minimal` job after `pulse down`:
   - plain `docker compose up -d` in the directory;
   - the documented readiness command;
   - editing `config/api/checks.json` with `sed -i` to rename a check, after which `GET /checks` shows the new name within 30 s (the reload interval is 5000 ms by default, `api/docs/configuration.md` at `v0.1.0`);
   - `docker compose down -v`.
9. **Distribution:** after merge and the `v0.1.0` tag, the release has the four literal asset names. `sha256sum -c SHA256SUMS` passes on the downloaded assets, and `pulse --version` prints `pulse 0.1.0`, where the value comes from the tag.
10. **#528 is unchanged:** the `minimal`, `full` (with e2e), `demo`, `dev`, `pins` and `lint` jobs, including `scripts/check-setup.sh` and the existing `secrets-init.test.sh` cases, pass with no edit to their expected values.
