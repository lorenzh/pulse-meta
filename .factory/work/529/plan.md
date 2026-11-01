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
- Docker Compose v2.38.2, run locally in this revision for the project selection rules of decision 13 (no pulse image was started).

### Revision after the plan review

The first plan review found six defects. This revision resolves them:

1. **Project guard:** Compose calls now use an explicit project name and file set, without the caller's `COMPOSE_*` variables. A guard resolves the effective project before every `up`, `down` and `status`. It refuses on foreign containers, foreign volumes (install label), `COMPOSE_` keys in `.env`, or a `name:` that differs from `pulse.json` (decision 13).
2. **Cancellation:** EOF and signals are defined for each phase: before, during and after the write, and during the start. There is a test for EOF at "Start now?" (decision 12).
3. **Email commands:** they now pass `--mail-from` and `--mail-to`. The missing-secret check exports `SMTP_SENTINEL`, so only `HOOK_SENTINEL` is missing.
4. **Install check:** the check picks the asset's own line of `SHA256SUMS`, works on Linux and macOS, and is tested on all three runners and against the published release (decision 17).
5. **Lock:** only the run that created the lock removes it, and only while the lock still holds that run's nonce (decision 11.3).
6. **`Files:` list:** it holds only real repository paths, each marked new or changed. The explanations are in a table below the list.

The review's task notes are in "Breakdown notes": the live Compose checks go to the final task, and no task holds docs alone.

### Revision after the second plan review

The second plan review found four defects. This revision resolves them:

1. **Volume ownership:** the guard no longer trusts the project label alone. Step 3 requires every top-level volume and network of the effective configuration to have the literal name `<project>_<key>` and no `external`. Step 5 inspects each declared volume by its resolved name, plus every volume that carries the project label. Verified with Docker Compose v2.38.2 in this run: an override `volumes: {api-data: {name: victim_api-data}}` shows up as that `name` in `config --no-interpolate --format json`, and `down --volumes` with `--project-name pulse-other` then removed `victim_api-data`, although the volume carried `com.docker.compose.project=victim` and no container existed. The guard now refuses that case before any Compose call that acts (decision 13, counterexample, `cli-stack demo` step 9).
2. **Compose arguments:** there are now two named forms. The *resolution call* is the single `config` call of step 3 and has no `--project-name`. Every other Compose call uses the *operation prefix* with `--project-name`. The tests assert exactly that (decision 13, Tests).
3. **Comparing two init runs:** in-process comparisons inject the same literal `now` and the same deterministic random source into both runs, so the complete file sets are byte-equal, with no field excluded. Comparisons of two real processes use setup `full`, which has no time-dependent content, and a defined normalization that replaces every occurrence of each run's `installId` (in `pulse.json` and in the `compose.yaml` volume labels) and the `createdAt` value ("Comparing two init runs" under Tests).
4. **Image fixtures:** fixtures under `cli/` use synthetic image references that the no-pin gate cannot match, and digests built at run time. The positive pin-shape case reads the embedded `common/services.yaml` (decision 3, "Fixtures").

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
   - The CLI lives in `cli/` of pulse-deploy. Entry point is `cli/main.ts`. The modules are split by job; the `Files:` list of the deploy section names each one and what it holds.
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
   - **Fixtures.** The no-pin gate (Completion evidence 5) matches `sha256:[0-9a-f]{64}` and `pulse-(api|probe|status|notify|console):<x.y.z>` anywhere under `cli`, `docs`, `.github` and `package.json`, test files included. So:
     - tests of the VERSION rule (decision 14), the stub `docker` and any fake `docker compose ps` output use the synthetic reference `example.invalid/fixture-svc:9.8.7`, and, where a digest is needed, `example.invalid/fixture-svc:9.8.7@` followed by a digest built at run time (`"sha256:" + "0".repeat(64)` in TypeScript, `printf 'sha256:%064d' 0` in shell). The expected VERSION values are the literals `9.8.7` and `sha256:000000000000`. The VERSION rule is generic (the tag of any reference), so a non-pulse name tests it fully;
     - the positive pin-shape case reads the embedded `common/services.yaml`, the real file, and expects no error;
     - the negative pin-shape fixtures are literals that the gate does not match: `ghcr.io/lorenzh/pulse-api:latest`, `ghcr.io/lorenzh/pulse-api:0.1` (two-part version) and `docker.io/library/nginx:1.2.3`, each followed by the run-time digest, plus `ghcr.io/lorenzh/pulse-api` with neither tag nor digest. Each must stop with exit 1;
     - `docs/cli.md` writes image references as `ghcr.io/lorenzh/pulse-<svc>:<version>@sha256:<digest>` and shows VERSION values only as bare versions, never as `pulse-<svc>:<x.y.z>`.
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
    3. **Lock and its ownership.**
       - Just before the preflight under lock and the first write, the CLI creates `<dir>/.pulse-init.lock` with `open(…, "wx", 0o600)` and writes `pid <pid>` and `nonce <32 random hex>` into it. Only that successful exclusive create makes this invocation the lock's owner.
       - If the create fails with `EEXIST`, the CLI exits 1 with `another pulse init is running in <dir> (or remove .pulse-init.lock if none is)`. That invocation never removes, rewrites or touches the existing lock, on any exit path.
       - **Release:** the owner releases the lock after its last write, after a failed write and its backup rollback, and in the deferred-signal path of decision 12. Release re-reads the file and unlinks it only when it still holds this invocation's nonce. A missing or changed lock is left as it is, with the warning `pulse init: .pulse-init.lock changed during the run; left in place`.
       - No stale-lock stealing: a lock left by a killed run stays until a person removes it. The docs say how to check that no `pulse init` runs and remove it.
    4. **Tokens with `--force`:** an existing token file that passes the secrets-init rules (regular file, mode without group or other bits, `^[\x21-\x7e]{16,}$`, no `replace-with-`) is kept as it is. An invalid one is backed up and replaced, and the output names the file and the rule, never the content. The `installId` of an existing `pulse.json` with a known `format` and a valid id (`^[0-9a-f]{32}$`) is kept too (decision 13). Otherwise a new one is generated; when that replaces an invalid `pulse.json`, the output says `new installId: volumes of an earlier install of this directory will be refused by pulse up; restore installId from the backup to keep them`.
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
    - **Prompt order:** setup; status, notify, console (yes/no); for each published service, its port, then its public URL where the table has one; probe location (non-demo); dev source directory (dev); check set; "add a check?" loop (type, then the type's fields); channels and their fields; a token step that only reports `generated` or `kept`; write; then "Start now? [Y/n]".
    - **Early conflict check:** before the first question, the CLI runs the conflict and symlink preflight of decision 11.2 once, so a person does not answer every question and then meet a conflict. The preflight under the lock (decision 11.3) still decides.
    - **Cancellation**, by phase. EOF means stdin ended while a prompt waits; SIGINT and SIGTERM are the signals. Every message names what exists on disk afterwards.

      | Phase | EOF | SIGINT / SIGTERM | On disk afterwards |
      | --- | --- | --- | --- |
      | A. Questions, rendering in memory (before the lock) | exit 2, `input ended before the setup was complete; nothing written` | exit 130, `interrupted; nothing written` | nothing new, no lock |
      | B. Write (from lock create to lock release) | cannot occur (no reads) | **deferred:** the handler only records the signal. The write finishes, or fails and rolls back its backup as in decision 11.5. Then the lock is released and the CLI exits 130 with `interrupted after the files were written; nothing started` (exit 1 with the write error if the write failed) | the complete new file set; after a failed write, the state that decisions 11.5 and 11.6 define; no lock |
      | C. "Start now?" (files written, lock released) | exit 2, `input ended at "Start now?"; the files are written, nothing started; run pulse up` | exit 130, `interrupted; the files are written, nothing started` | the complete new file set; no Docker call was made |
      | D. Start (`--start` or the answer yes) | — (no reads) | as `pulse up`: the readiness subprocess is killed, containers are left running, exit 130 with `interrupted; containers keep running; see pulse status or pulse down` | files, plus whatever Compose already created |

      - Phase B is bounded: it does only local file operations, with no prompt and no network. A second SIGINT during phase B is also deferred; SIGKILL and power loss are the partial-write case of decision 11.6.
      - The answer "n" in phase C exits 0 and prints `pulse up` as the next command.
    - **`--start` / `--no-start`** answer the last question. With `--yes` and neither flag, nothing starts, so `pulse init --setup demo --yes` never needs Docker.
    - Defaults with `--yes`: setup `full`, services as in decision 6, ports and URLs as in decision 7, the setup's check set, channels as in decision 9, location `default`, project name as in decision 13.
13. **Compose lifecycle.**
    - **Project name:** `--project <name>`, default `pulse` for minimal and full, `pulse-demo` for demo and `pulse-dev` for dev (the names of the standalone setups, which users know). The pattern is `^[a-z0-9][a-z0-9_-]{0,62}$`. It is written as the top-level `name:` of `compose.yaml` and as `project` in `pulse.json`. Data is never shared with another installation of the same name: the volume guard below refuses that.
    - **Install id and volume labels:** `pulse init` creates `installId` (16 random bytes, 32 lowercase hex, not a secret) in `pulse.json`. Every top-level volume of the generated `compose.yaml` gets the label `io.github.lorenzh.pulse.install: "<installId>"`. `--force` keeps the `installId` of a valid existing `pulse.json`, so the labels never change for an install. A changed volume label would make Compose ask `Volume … exists but doesn't match configuration in compose file. Recreate (data will be lost)?` (verified with Docker Compose v2.38.2 in this run). The guard below stops before Compose could ask.
    - **Invocation:** every Docker call is an argument array through `Bun.spawn`, never a shell string, with stdin `/dev/null`, so no Compose prompt can be answered. There are exactly two forms of a Compose call:
      - the **operation prefix**, used by every Compose call except the resolution call:

        `docker compose --project-directory <dir> --project-name <project from pulse.json> --file <dir>/compose.yaml [--file <dir>/compose.override.yaml] [--env-file <dir>/.env]`

      - the **resolution call**, the single `config` call of guard step 3, once per `up`, `down` or `status` and before any other Compose call. It is the operation prefix without `--project-name`, because it must find the project that a plain `docker compose` in `<dir>` would use:

        `docker compose --project-directory <dir> --file <dir>/compose.yaml [--file <dir>/compose.override.yaml] [--env-file <dir>/.env] config --no-interpolate --format json`

      - in both forms, the override file is passed when it exists as a regular file, and `.env` when it exists;
      - the child environment is the CLI's environment minus every variable whose name starts with `COMPOSE_`. When it removes any, the CLI prints `pulse: ignoring COMPOSE_FILE, COMPOSE_PROJECT_NAME from the environment; using project <p> and <dir>/compose.yaml` (names only, never values) to stderr;
      - verified with Docker Compose v2.38.2 in this run: `COMPOSE_PROJECT_NAME`, `COMPOSE_FILE` and `COMPOSE_ENV_FILES` in the environment, and `COMPOSE_PROJECT_NAME` and `COMPOSE_FILE` lines in `.env`, each change the project or the file set of a plain `docker compose`; an explicit `--project-name` and `--file` win over all of them.
    - **Project resolution and guard.** `up`, `down` (with or without `--volumes`) and `status` run these steps, in this order, after the Docker preflight and before any Compose call that creates, stops, removes or reports containers. Any failure exits 1 and names the cause, and no container, network or volume is touched:
      1. **`pulse.json`:** missing or unknown `format` → `<dir> is not a pulse installation (no pulse.json); run pulse init`.
      2. **`.env`:** a line whose key starts with `COMPOSE_` → `.env sets <KEY>; remove it: it would make docker compose in <dir> act on another project or file`. The CLI never writes such a key, and decision 9 forbids such env names.
      3. **Effective configuration of the files:** the resolution call above, with the stripped environment, parsed in memory and never printed (`--no-interpolate` leaves secret references unresolved; verified in this run).
         - **Project:** its `name` is the project a plain `docker compose` in `<dir>` uses. If it differs from `pulse.json` `project` → `compose.yaml (or compose.override.yaml) sets project <x>, pulse.json says <p>; fix name: or rerun pulse init --force --project <x>`.
         - **Services:** every `pulse.json` service must be a key of its `services` → else `service <svc> from pulse.json is not in the Compose project`.
         - **Volume and network names:** for every key `<k>` of the top-level `volumes` and of the top-level `networks` (Compose lists the implicit `default` network there too), the entry must have no `external: true` and a `name` that equals the literal string `<p>_<k>`, which is the name Compose derives when no `name:` is set and the only one the CLI generates. Else → `volume <k> of compose.yaml (or compose.override.yaml) is named <name>, not <p>_<k>; remove its name: or external:` (for a network: `network <k> …`). Compose removes declared non-external volumes by their resolved name in `down --volumes`, whatever their labels (verified in this run: an override `name: victim_api-data` made `down --volumes` of project `pulse-other` remove a volume labelled for project `victim`). A `name` that holds `${…}` is not equal to `<p>_<k>` in the uninterpolated output, so it is refused too, and interpolation at run time cannot change a name.
      4. **Containers:** `docker ps --all --filter label=com.docker.compose.project=<p> --format '{{.Label "com.docker.compose.project.working_dir"}}'`. Every value must equal `realpath(<dir>)` after `realpath`. Else → `project <p> is used by <other dir>; stop it there or choose another name (pulse init --force --project <name>)`.
      5. **Volumes:** the guard checks the union of two sets of volume names:
         - the **declared** volumes: the resolved `name` of every top-level volume from step 3, so the check covers what Compose will create, mount or remove, whatever label it carries;
         - the **labelled** volumes: `docker volume ls --quiet --filter label=com.docker.compose.project=<p>`, so a volume of the project that the files no longer declare is seen too.

         For each name, `docker volume inspect --format '{{json .Labels}}' <name>` (one call per name, argument array). A declared volume that does not exist yet (inspect exits non-zero with `no such volume`) is fine: `up` creates it with this install's labels. Every existing volume must carry `io.github.lorenzh.pulse.install` equal to this install's `installId` and `com.docker.compose.project` equal to `<p>`. Else → `volume <name> of project <p> belongs to another installation; choose another name (pulse init --force --project <name>)`. Any other inspect failure exits 1 with its first stderr line. This covers a stopped standalone stack whose volumes remain, a volume created by hand under the project's name, and keeps `down --volumes` from deleting another installation's data.

      So `up`, `down` and `status` act only on the project of this directory and its own volumes, never on the repository's `full/` stack, another install of the same name, or a volume that an override points at.
    - **Docker preflight** (only `up`, `down`, `status`, and `init` when it starts the stack):
      - the `docker` binary is missing (spawn `ENOENT`): `Docker is not installed or not on PATH` and a link to the install docs;
      - `docker version --format '{{.Server.Version}}'` fails: `cannot reach the Docker daemon` and the first stderr line;
      - `docker compose version --short` fails: `Docker Compose v2 is missing (the docker compose plugin)`;
      - the version is below 2.23.0 (numeric compare, an optional leading `v` removed): `Docker Compose <v> is older than 2.23`.
      - All four exit 3.
    - **`pulse up [--dir <dir>] [--timeout <s>]`:**
      1. Docker preflight (exit 3 on failure).
      2. Project resolution and guard, steps 1–5 above (exit 1 on failure).
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
    - **`pulse down [--dir] [--volumes]`** runs the Docker preflight and the project resolution and guard, then `docker compose <prefix> down`. It removes the project's containers and networks, and keeps volumes, generated files and secrets. `--volumes` adds `-v` and prints `deleted the volumes of project <name> (database, notify ledger, runtime secrets)`. It is never the default.
14. **`pulse status [--dir] [--json]`.**
    - **Rows:** one per service in `pulse.json`, in that order, including stopped and missing services. Columns `SERVICE`, `STATE`, `READY`, `VERSION`.
    - **Order:** Docker preflight, then the project resolution and guard of decision 13, then the rows.
    - **Data:** `docker compose <prefix> ps --all --format json` gives state, health, exit code and image. A `/readyz` call (5 s bound) runs for each running pulse service.
    - **READY values:** `ready`, `not ready (<reason>)`, `completed`, `failed (exit <n>)`, `running` (helpers), `stopped`, `missing`.
    - **VERSION:**
      - the tag of the image reference, for example `0.1.0` from `ghcr.io/lorenzh/pulse-api:0.1.0@sha256:…` (this example is for this spec only; tests and docs under the no-pin gate use the fixtures of decision 3);
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
16. **pulse.json** (format 1). Keys: `format` (1), `cliVersion`, `setup`, `project`, `services` (ordered list of `{"name", "kind": "pulse"|"oneshot"|"helper", "port"?}`; `port` only for kind `pulse`; order: `secrets-init`, then the helpers `mailpit`, `demo-targets`, `demo-tls` as enabled, then `api`, the probes (`probe`, or `probe-eu`, `probe-us`), `status`, `notify`, `console` as enabled), `urls` (`status`, `console`, `mailpit`, `api`, each present only when published), `installId` (decision 13), `createdAt` (ISO time of init). It holds no secret value. `up`, `down` and `status` read the project, the install id and the service list from it. A service that the files do not define fails step 3 of the project resolution (decision 13). So a stale or edited `compose.yaml` cannot pass as ready.
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
      - job `verify` (after `publish`; matrix of the three runners; `contents: read`): checkout (for the script only), then in an empty directory `gh release download <tag> --pattern <asset> --pattern SHA256SUMS`, `cli/test/verify-download.sh <asset>` (the documented check below), `chmod +x`, and `./<asset> --version` must print `pulse ${GITHUB_REF_NAME#v}`. So the documented install path runs on each OS against the published files.
      - Workflow-level `permissions: contents: read`. Actions only `actions/checkout` v7.0.1 (with `persist-credentials: false`) and `oven-sh/setup-bun` v2.2.0, by SHA. No upload-artifact and no release action.
    - **Install** (docs): download one asset and `SHA256SUMS`, check the one asset, `chmod +x`, move it to a directory on `PATH` as `pulse`. Uninstall: delete the binary. The install directories stay theirs.
      - **Checksum of one asset.** `SHA256SUMS` lists all three binaries and the user downloads one, so a plain `sha256sum -c SHA256SUMS` or `shasum -a 256 -c SHA256SUMS` fails on the two missing files. The docs and `cli/test/verify-download.sh` therefore use the same lines, which pick the asset's own entry and compare it:

        ```sh
        expected=$(awk -v f="$asset" '$2 == f { print $1 }' SHA256SUMS)
        if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$asset"); else actual=$(shasum -a 256 "$asset"); fi
        actual=${actual%% *}
        test -n "$expected" && test "$expected" = "$actual" && echo "$asset: OK"
        ```

        The docs set `asset=` first (one of the three names) and say: go on only when it prints `<asset>: OK`. The script sets `asset` from its first argument, and its exit status is that of the last line. It uses `sha256sum` where it exists and falls back to `shasum -a 256` (which ships with macOS) otherwise; both print `<hash>  <file>`. An asset with no entry fails, because `expected` is empty.
      - **Test of the documented command:**
        - in each `cli-build` runner, `verify-download.sh` runs in a directory that holds only the native binary and a three-line `SHA256SUMS`: the binary's own line plus the two other asset names with the literal hash of empty input `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Expected (literals): exit 0 and the line `<asset>: OK`; exit 1 after one byte of a copy of the binary is changed; exit 1 for an asset name that is not listed;
        - the release `verify` job runs it against the published files;
        - `cli/docs.test.ts` checks that the fenced block between `<!-- verify-download:start -->` and `<!-- verify-download:end -->` in `docs/cli.md` equals the block between the same markers (as comments) in `cli/test/verify-download.sh`. That compares two separately written files.

## Required behavior

Summary of the observable behavior. Details are in the decisions above.

- `pulse init [<dir>] [flags]` writes the layout of decision 5 for the answers of decisions 6–9. It never writes a secret value outside `secrets/`, and never prints one.
- Every question has a flag. With `--yes` it runs without prompts and needs no Docker.
- A second `pulse init` without `--force` exits 1, lists the conflicts and changes no byte, mode or file. `--force` backs up the replaced files and keeps valid tokens.
- `pulse up` starts and waits with a finite deadline, naming the services that are not ready. `pulse status` lists every service with state, readiness and version. `pulse down` keeps data unless `--volumes` is given.
- Docker or Compose missing, too old or unreachable gives a clear message and exit 3.
- `up`, `down` and `status` resolve the project from `pulse.json` and the files of `<dir>`, ignore `COMPOSE_*` variables of the caller, and refuse to act when the project's containers or volumes belong to another directory or installation, or when the files give a volume or network a name other than `<project>_<key>`.
- Ending `pulse init` with EOF, SIGINT or SIGTERM leaves either nothing new or the complete file set, never a lock of its own, and says which (decision 12).
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
- **Process execution:** every Docker call is an argument array with stdin `/dev/null`; no shell string ever holds user input. The child environment drops `COMPOSE_*`, and the project name and files are passed explicitly.
- **Acting on the wrong project:** the project resolution and guard (decision 13) runs before every `up`, `down` and `status`, so a caller's `COMPOSE_PROJECT_NAME` or `COMPOSE_FILE`, a `.env` line, an edited `name:`, another directory's containers, another installation's volumes, or an override that renames a volume or marks it `external` can never make `down --volumes` delete foreign data. The guard inspects every declared volume by its resolved name, not only the volumes that carry the project label.
- **Lock ownership:** only the invocation that created `.pulse-init.lock` removes it, and only while it holds that invocation's nonce.
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
- concurrent `pulse init` runs, and a foreign `.pulse-init.lock`;
- `--location 'x","token":"y'`;
- `COMPOSE_PROJECT_NAME=pulse COMPOSE_FILE=/elsewhere/compose.yaml pulse down --volumes`, a `.env` line `COMPOSE_PROJECT_NAME=pulse`, and `name: pulse` edited into a demo install's `compose.yaml`, each while another `pulse` project has volumes;
- a `compose.override.yaml` that sets `volumes: {api-data: {name: <another project>_api-data}}`, `name: "${X:-pulse_api-data}"`, or `external: true`, then `pulse down --volumes`;
- a tampered or unlisted asset for `cli/test/verify-download.sh`.

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
- **Email channel flags:** `--channel email --smtp-host mail.example.com` without `--mail-from` or without `--mail-to` exits 2 and names the missing flag. Every acceptance command with `--channel email` below passes `--mail-from pulse@example.com --mail-to ops@example.com`.
- **Env preflight:** with `SMTP_PASSWORD` exported and `HOOK_SECRET` neither exported nor in `.env`, `pulse up` exits 1, names `HOOK_SECRET` and does not name `SMTP_PASSWORD`, and `docker compose ps -a` is still empty afterwards. With `HOOK_SECRET=` (empty) it fails too. A wrong implementation that checks only the first referenced name, or stops at the first channel, fails one of these.
- **Lock ownership:**
  - a pre-existing `.pulse-init.lock` with the content `pid 1\nnonce foreign\n`: `pulse init --setup demo --yes` exits 1, and the lock's bytes and mtime are unchanged afterwards. A wrong implementation that removes "the lock" in a `finally` deletes it;
  - two concurrent runs (injected barrier after the winner's lock create): the loser exits 1 while the winner still holds the lock, the lock is still present right after the loser exits, and it is gone after the winner finishes;
  - the winner's lock replaced by other content during its run: the winner leaves it in place and prints the `changed during the run` warning.
- **Cancellation:**
  - EOF at the setup question: exit 2, the directory is still empty;
  - SIGINT (injected) at the third question: exit 130, the directory is still empty;
  - SIGINT (injected) between two renames of phase B: every managed file of the new set exists with its final mode, there is no `.pulse-init.lock`, exit 130, and the message says `interrupted after the files were written`. A wrong implementation exits at once and leaves a half set and its lock;
  - EOF at "Start now?": exit 2, the full file set exists and is byte- and mode-equal to a `--no-start` run with the same answers, the same injected `now` and the same deterministic random source ("Comparing two init runs" under Tests; no field is excluded), no Docker call was made (the fake spawn records none), and the message says `the files are written, nothing started`. A wrong implementation reports `nothing written` or treats EOF as yes.
- **Project resolution and guard** (each must exit 1 and leave every container, network and volume as it was):
  - the caller exports `COMPOSE_PROJECT_NAME=other` and `COMPOSE_FILE=/elsewhere/compose.yaml`: the Compose calls still carry `--project-name <pulse.json project>` and `--file <dir>/compose.yaml`, the child environment has neither variable, and stderr names both (names only). This one succeeds;
  - `.env` with `COMPOSE_PROJECT_NAME=pulse`: refused, naming the key;
  - `compose.yaml` `name:` edited to `pulse` in a `pulse-demo` install: refused with both names;
  - the repository's `full/` stack stopped with `docker compose -f full/compose.yaml stop` (containers and volumes of project `pulse` remain) and a generated full install named `pulse` in another directory: `pulse up`, `pulse status` and `pulse down --volumes` are refused, naming the other directory; `full/`'s volumes still exist;
  - the same with `full/` fully down (`down` without `-v`, only volumes remain): `pulse up` and `pulse down --volumes` are refused, naming a `pulse_*` volume. A wrong implementation that checks only containers lets `down --volumes` delete them;
  - an install with project `pulse-other` and a `compose.override.yaml` with `volumes: {api-data: {name: pulse-demo_api-data}}`, while the volume `pulse-demo_api-data` of another install exists: `pulse down --volumes` is refused at step 3 (`volume api-data … is named pulse-demo_api-data, not pulse-other_api-data`), and `pulse-demo_api-data` still exists. A wrong implementation that lists only volumes labelled `com.docker.compose.project=pulse-other` finds none and lets Compose delete it;
  - the same override with `name: "${X:-pulse-other_api-data}"`, and with `external: true`: refused at step 3;
  - a volume `pulse-other_api-data` created by hand without labels (`docker volume create pulse-other_api-data`) and a correct install `pulse-other`: refused at step 5, naming that volume, because the declared name is inspected even though the volume carries no project label;
  - a declared volume that does not exist yet: accepted (fresh install before the first `up`);
  - the resolution call is the only Compose call without `--project-name`: a wrong implementation that drops `--project-name` from every call, or adds it to the resolution call, fails the argument assertions of the tests (with `--project-name` the resolution call would always report the `pulse.json` project, and the `name:` edit above would pass).
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
- **Download check:** a `SHA256SUMS` that lists all three assets while only `pulse-darwin-arm64` is present passes `verify-download.sh pulse-darwin-arm64` (a wrong `shasum -a 256 -c SHA256SUMS` fails here); a changed byte, or an asset missing from `SHA256SUMS`, exits 1.
- **Image fixtures:** a status test that writes `ghcr.io/lorenzh/pulse-api:0.1.0` into a file under `cli/` fails the no-pin gate. The VERSION tests use `example.invalid/fixture-svc:9.8.7@<run-time digest>` → `9.8.7`, `example.invalid/fixture-svc@<run-time digest>` → `sha256:000000000000`, `pulse-api:dev` → `dev (local build)`, `example.invalid/fixture-svc` → `unknown` (decision 3, "Fixtures").
- **Status exit:** one service `not ready` makes `pulse status` exit 1 even when all others are ready. `completed` (secrets-init) and `running` (demo helpers) count as fine.
- **Down:** `pulse down` keeps the volume `pulse-demo_api-data`. `pulse down --volumes` removes it.
- **init time statistic:** with 11 samples 120…130 ms in some order, the median is the 6th smallest value, not the mean of the samples, and not the mean of two values.

## Contract fields

No contract or config names change. The new names live inside pulse-deploy:

- the `secrets-init` variables `PULSE_PROBE_LOCATIONS` and `PULSE_SECRETS_ADMIN`;
- the host files `secrets/admin-token` and `secrets/probe-token-<loc>`;
- the volumes `console-secrets` and `probe-<loc>-secrets`;
- the runtime files `/run/pulse/admin-tokens.json` and `/run/pulse/admin-token`;
- the install file `pulse.json` with its key `installId`, the backup directory `.pulse-backup` and the lock file `.pulse-init.lock`;
- the Docker volume label `io.github.lorenzh.pulse.install`;
- the CLI flags.

Collision search, run in this plan inside `.repos/` (the read-only clones; deploy at `f9d9eb3`):

```
for n in PULSE_PROBE_LOCATIONS PULSE_SECRETS_ADMIN pulse.json probe-token- admin-token console-secrets pulse-backup pulse-init.lock io.github.lorenzh installId verify-download; do
  printf '%s contract:%s config:%s deploy:%s\n' "$n" "$(grep -rn -- "$n" contract/src | wc -l)" \
    "$(grep -rn --exclude-dir=node_modules --exclude-dir=.git -- "$n" config | wc -l)" \
    "$(grep -rn --exclude-dir=.git -- "$n" deploy | wc -l)"
done
# every contract and config count: 0; every deploy count: 0 except admin-token (12, see below)
```

In deploy, `admin-tokens` appears today only in the test-only e2e overlay and in `full/README.md` (the opt-in example). Those name a different path, `/run/pulse-admin/admin-tokens.json`, and stay unchanged.

Reused names with unchanged meaning:

- `PULSE_API_PORT`, `PULSE_STATUS_PORT`, `PULSE_CONSOLE_PORT`, `PULSE_MAILPIT_PORT` and `PULSE_SRC_DIR` (Compose host variables of #528);
- the service settings `PULSE_TOKENS_FILE`, `PULSE_PROBE_TOKEN_FILE`, `PULSE_API_ADMIN_TOKENS_FILE`, `PULSE_CHECKS_FILE`, `PULSE_NOTIFY_CONFIG`, `PULSE_STATUS_PUBLIC_URL`, `PULSE_STATUS_SHOW_CHECKS`, `PULSE_CONSOLE_ADMIN_TOKEN_FILE` and `PULSE_LOCATION`, all documented at the services' `v0.1.0` tags;
- the notify channel keys `passwordEnv`, `secretEnv` and `statusUrl`.

## Repository: deploy

Files:

- new: `package.json`, `bun.lock`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `eslint.config.js`, `lefthook.yml`
- new: `cli/main.ts`
- new: `cli/args.ts`, `cli/args.test.ts`
- new: `cli/answers.ts`, `cli/answers.test.ts`
- new: `cli/prompt.ts`, `cli/prompt.test.ts`
- new: `cli/services.ts`, `cli/services.test.ts`, `cli/embedded.d.ts`
- new: `cli/yaml.ts`, `cli/yaml.test.ts`
- new: `cli/render-compose.ts`, `cli/render-compose.test.ts`
- new: `cli/render-checks.ts`, `cli/render-checks.test.ts`
- new: `cli/render-notify.ts`, `cli/render-notify.test.ts`
- new: `cli/render-files.ts`, `cli/render-files.test.ts`
- new: `cli/tokens.ts`, `cli/tokens.test.ts`
- new: `cli/write-install.ts`, `cli/write-install.test.ts`
- new: `cli/init.ts`, `cli/init.test.ts`
- new: `cli/docker.ts`, `cli/docker.test.ts`
- new: `cli/ready.ts`, `cli/ready.test.ts`
- new: `cli/lifecycle.ts`, `cli/lifecycle.test.ts`
- new: `cli/status.ts`, `cli/status.test.ts`
- new: `cli/docs.test.ts`
- new: `cli/test/smoke.sh`, `cli/test/render-variants.sh`, `cli/test/stack.sh`, `cli/test/errors.sh`, `cli/test/verify-download.sh`
- new: `cli/test/stub-docker/docker`
- new: `cli/test/hook-receiver.ts`, `cli/test/measure-init.py`
- changed: `scripts/secrets-init.mjs`, `scripts/secrets-init.test.sh`
- changed: `demo/init.mjs`
- changed: `.github/workflows/ci.yml`
- new: `.github/workflows/release.yml`
- new: `docs/cli.md`
- changed: `README.md`, `AGENTS.md`, `dev/README.md`, `.gitignore`

Behavior change: yes. A new CLI, new `secrets-init` modes, new CI jobs and a release workflow.

What each file holds:

| File | Content |
| --- | --- |
| `package.json` … `lefthook.yml` | the toolchain ("Tool facts" below); `tsconfig.json` and `biome.json` are plain JSON, because the existing `lint` job runs `jq empty` on every tracked `*.json` (`deploy/.github/workflows/ci.yml` line 38) |
| `cli/main.ts` | entry point: wires the real dependencies, help, version, exit codes (decision 15) |
| `cli/args.ts` | `parseArgs` (strict) for every command and flag |
| `cli/answers.ts` | the answer model, defaults and every validation rule of decisions 6–10 |
| `cli/prompt.ts` | the question flow over injected streams, re-asking, EOF and signal handling (decision 12, phase A and C) |
| `cli/services.ts`, `cli/embedded.d.ts` | the embedded text assets of decisions 3–4, the parse of `common/services.yaml` and the pin-shape check; the `.d.ts` types the text imports |
| `cli/yaml.ts` | the YAML emitter (decision 2) |
| `cli/render-compose.ts`, `cli/render-checks.ts`, `cli/render-notify.ts`, `cli/render-files.ts` | answers → file map: `compose.yaml` (with volume labels), `config/api/checks.json`, `config/notify/notify.json`, `.env`, `pulse.json`, helpers |
| `cli/tokens.ts` | token and `installId` generation (decision 10, 13) |
| `cli/write-install.ts` | preflight, lock ownership, backup, atomic write, deferred signals during the write (decisions 11, 12 phase B) |
| `cli/init.ts` | `pulse init`: the phases of decision 12 in order, and "Start now?" |
| `cli/docker.ts` | Docker preflight, the two Compose forms (operation prefix and resolution call), the stripped environment, the project resolution and guard with the volume and network name checks (decision 13) |
| `cli/ready.ts`, `cli/lifecycle.ts`, `cli/status.ts` | readiness, `up`, `down`, `status` (decisions 13–14) |
| `cli/docs.test.ts` | the docs/script equality of the download check (decision 17) |
| `cli/test/smoke.sh` | the compiled-binary smoke test of `cli-build` |
| `cli/test/render-variants.sh` | the `cli-render` job body |
| `cli/test/stack.sh` | the `cli-stack` job body (argument: `demo`, `full` or `minimal`) and the `dev` job addition |
| `cli/test/errors.sh` | the `cli-errors` job body |
| `cli/test/stub-docker/docker` | the stub `docker` executable that `errors.sh` puts first on `PATH` |
| `cli/test/hook-receiver.ts` | the webhook receiver of `cli-stack full` |
| `cli/test/measure-init.py` | the `pulse init` timing (Performance impact) |
| `cli/test/verify-download.sh` | the documented checksum check of one asset (decision 17) |
| `scripts/secrets-init.mjs`, `scripts/secrets-init.test.sh` | the two additive modes of decision 10 and their cases |
| `demo/init.mjs` | the output path from the variable `PULSE_DEMO_CHECKS_FILE`, default the existing path `/shared/checks.json` |
| `.gitignore` | adds the build output directories `node_modules/` and `dist/` |
| `dev/README.md` | a pointer to `pulse init --setup dev` |

Module names are fixed by this list. The implementer may add a module next to them and names it in the PR.

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
  - The file at the pinned SHA is identical to the clone (`gh api …/check.yml?ref=04108fa…` diffed: no difference, rechecked in this run).
  - Its `build` input defaults to `false` (`config/.github/workflows/check.yml` lines 6–9). deploy does not set it, so the reusable job never runs `bun run build` or `git diff --exit-code -- dist`; the binaries are built in `cli-build` and `release.yml` and are never committed.
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
    - the project name, `installId` and the guard messages of decision 13: what to do when another directory or installation uses the name, and how to restore `installId` from a backup;
    - a stale `.pulse-init.lock`: how to check that no `pulse init` runs (`ps`), then remove it;
    - what EOF and Ctrl-C leave behind at each phase (decision 12);
    - **"Without the CLI":** `cd <dir>` with no `COMPOSE_PROJECT_NAME`, `COMPOSE_FILE` or `COMPOSE_ENV_FILES` exported (they would select another project or file; the docs show `env | grep ^COMPOSE_`), then `docker compose up -d`, `docker compose ps`, the readiness check command, `docker compose down`, editing `config/api/checks.json` (hot reload), editing `.env` ports, adding a second probe location by hand (a new `secrets/probe-token-<loc>` file, the `PULSE_PROBE_LOCATIONS` value and a probe service).
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
    - `cli/test/verify-download.sh` against the native binary, with the three cases of decision 17 ("Test of the documented command").
    - Then `cli/test/measure-init.py` (decision on performance). The binary size and the init time go to `$GITHUB_STEP_SUMMARY`.
  - **`cli-render`** (`ubuntu-24.04`, body `cli/test/render-variants.sh`): renders the variants below with the source CLI (`bun cli/main.ts init … --yes`) into temp directories, with no secret env set. For each variant:
    - `docker compose --project-directory <d> config --quiet`;
    - the published ports from `config --format json`, piped only into `jq` on ports and images, never printed in full, equal a literal table in the test script;
    - every image matches the pin shape of `check-setup.sh` rule 2, or `pulse-<svc>:dev` for dev;
    - the set of resolved pulse images of a generated full equals that of `docker compose -f full/compose.yaml config` (the standalone setup, an independent resolution of `common/services.yaml`);
    - no volume or config other than a `*-secrets` volume targets `/run/pulse` (rule 8 logic);
    - `network_mode` is only `none` (rule 9);
    - every top-level volume has the label `io.github.lorenzh.pulse.install`, all with one value matching `^[0-9a-f]{32}$` (a literal pattern).

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
    - variants 3 and 8 add `--channel email --smtp-host mail.example.com --smtp-user ops --smtp-password-env SMTP_SENTINEL --mail-from pulse@example.com --mail-to ops@example.com --channel webhook --webhook-url https://hooks.example.com/x --webhook-secret-env HOOK_SENTINEL` (every required email flag of decision 9 is given, so `init` must exit 0);
    - the job exports `SMTP_SENTINEL=smtp-sentinel-5f2a` and `HOOK_SENTINEL=hook-sentinel-9c1e` while it runs `init` and `config --quiet`;
    - it then runs `grep -rF` for both sentinels and for each generated token value over every generated file except `secrets/` and `.pulse-backup/`, and over the captured CLI stdout and stderr: no match.

    The expected file layout and port tables are literals in the test script.
  - **`cli-stack`** (`ubuntu-24.04`, matrix `demo`, `full`, `minimal`, body `cli/test/stack.sh <variant>`) builds the linux x64 binary. In an empty temp directory outside the checkout:
    - **demo** (the acceptance core):
      1. `pulse init --setup demo --yes`;
      2. `docker compose config --quiet`;
      3. `pulse up --timeout 300`;
      4. `pulse status --json`. Its `service` list equals the literal `["secrets-init","mailpit","demo-targets","demo-tls","api","probe-eu","probe-us","status","notify","console"]` (the order of `pulse.json` as specified here). Every `ready` is `ready`, `completed` or `running`, and `pulse status` exits 0.
      5. The demo job's assertions (a) open `down-on-purpose` incident and (b) `[pulse demo] DOWN:` mail, both within 300 s of `up`, reused from the `demo` job with `docker compose --project-directory`.
      6. **Admin auth with the generated file:** `docker compose exec -T api bun -e '<fetch GET /admin/config with Bearer from stdin>' < secrets/admin-token` answers 200. Without a token it answers 401. With `secrets/probe-token-eu` it answers 403. The literals come from `api/docs/rest-api.md` at `v0.1.0`.
      7. **Environment override ignored:** `COMPOSE_PROJECT_NAME=other COMPOSE_FILE=/nonexistent/compose.yaml pulse status --json` exits 0 with the same service list as step 4, and stderr names both variables.
      8. **Project guard, live:** a second `pulse init --setup demo --yes` in another empty directory (same default project `pulse-demo`, another `installId`). There, `pulse status`, `pulse up` and `pulse down --volumes` each exit 1, and the message names the first directory. Afterwards the first stack's `pulse status` still exits 0, and `docker volume ls -q --filter label=com.docker.compose.project=pulse-demo` lists the same names as before step 8.
      9. **Override pointing at a foreign volume, live:** a third `pulse init --setup demo --yes --project pulse-other` in another empty directory, plus a `compose.override.yaml` there with the literal content `volumes: {api-data: {name: pulse-demo_api-data}}`. `pulse down --volumes` there exits 1, and the message holds the literal `is named pulse-demo_api-data, not pulse-other_api-data`. Afterwards `docker volume inspect pulse-demo_api-data` exits 0 and the `pulse-demo` volume list equals the one before step 8. Without the guard, Compose would delete that volume (verified in this run, decision 13 step 3).
      10. `pulse down` in the first directory: `docker compose ps -a -q` is empty, `docker volume ls -q --filter label=com.docker.compose.project=pulse-demo` is not empty, and the generated files are unchanged (sha256 snapshot).
      11. **Volume guard, live:** with only the first install's volumes left, `pulse up` in the second directory exits 1 naming a `pulse-demo_` volume, and that volume list is unchanged.
      12. `pulse down --volumes` in the first directory: the volume list is empty.
    - **full:**
      - `pulse init --setup full --yes --channel email --smtp-host mail.invalid --smtp-user ops --smtp-password-env SMTP_SENTINEL --mail-from pulse@example.com --mail-to ops@example.com --channel webhook --webhook-url http://host.docker.internal:9999/hook --webhook-secret-env HOOK_SENTINEL --check url=http://127.0.0.1:1/,name=Down` exits 0, plus a `compose.override.yaml` in the test directory that adds only `extra_hosts: ["host.docker.internal:host-gateway"]` to notify;
      - first `pulse up` with `SMTP_SENTINEL=smtp-sentinel-5f2a` exported and `HOOK_SENTINEL` unset (and not in `.env`): exit 1, the message names `HOOK_SENTINEL` and does not contain `SMTP_SENTINEL`, and `docker compose ps -a -q` is empty. So only the missing webhook secret causes the failure;
      - then with both exported (`HOOK_SENTINEL=hook-sentinel-9c1e`): up and ready. notify is ready only when both env names reached it, because notify stops at start without them;
      - `cli/test/hook-receiver.ts` (host Bun, port 9999) verifies `X-Pulse-Signature` with the sentinel and records an `opened` event for check `down` within 180 s;
      - the sentinel grep over generated files, CLI output and `docker compose logs`: no match.
    - **minimal:** `pulse init --setup minimal --yes --status --console`, `pulse up`, `pulse status` exits 0. `curl http://127.0.0.1:3000/checks` lists `status-page` with a state other than `unknown` within 90 s.
    - On failure: `docker compose ps --all` and `logs --no-color`. Teardown always: `pulse down --volumes`.
  - **`dev` job (existing):** after its teardown, add `cli/test/stack.sh dev`: `pulse init --setup dev --yes --src-dir <workspace>` in a temp directory next to the checkouts, `pulse up --timeout 900`, `pulse status`, `pulse down --volumes`, using the source CLI (`bun cli/main.ts`). The images are already built, so this mostly reuses the cache. The job's existing steps stay unchanged.
  - **`cli-errors`** (`ubuntu-24.04`): `cli/test/errors.sh` with the stub `cli/test/stub-docker/docker` first on `PATH` and the compiled binary:
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
  - the four cancellation cases of "Counterexamples" (EOF and SIGINT in phase A, SIGINT in phase B, EOF at "Start now?"), with an injected signal source and the exact messages and exit codes of decision 12;
  - SIGINT in phase D: the fake readiness call is killed, no `down` is spawned, exit 130;
  - "Start now?" yes (the injected Docker runner receives `up`) and no;
  - the same answers as flags give the same files, compared as defined in "Comparing two init runs" below: in process, byte- and mode-equal with no field excluded; for the spawned `--interactive` run, after the normalization.
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
  - lock ownership: a foreign lock is left byte- and mtime-equal; the concurrent-run case with a barrier; a lock changed during the run is left with the warning; the owner's lock is gone after success, after a failed write, and after a deferred signal;
  - `installId` kept with `--force`, new for an invalid `pulse.json`;
  - "no longer used" listing.
- **tokens:** 32 bytes to 64 hex characters; a collision with an injected RNG is regenerated.
- **docker/ready/status** with a fake spawn:
  - preflight messages and exit codes;
  - the version compare cases;
  - the two Compose forms of decision 13, for `up`, `down`, `down --volumes` and `status`: the first spawned Compose call is the resolution call, it is the only Compose call without `--project-name`, and it ends in `config --no-interpolate --format json`; every later Compose call starts with the full operation prefix including `--project-name <pulse.json project>`; in both forms the override file and `.env` appear only when they exist. The expected argument arrays are literals in the test;
  - a child environment without `COMPOSE_*` while other variables (for example `SMTP_PASSWORD`, `DOCKER_HOST`) pass through;
  - the project resolution and guard steps 1–5 and their order: each failing step stops before any `up`, `down` or `ps` call is spawned (the fake spawn records the calls);
  - step 3 names: a resolved config with `volumes.api-data.name: pulse-demo_api-data` for project `pulse-other`, with `name: "${X:-pulse-other_api-data}"`, with `external: true`, and with `networks.default.name: other_default` each exit 1 with the step 3 message, and no `down` is spawned;
  - step 5 sets: the fake `docker volume ls` returns nothing while the declared `pulse-other_api-data` exists with no labels → exit 1 naming it; a declared volume whose inspect answers `no such volume` → accepted; a labelled but undeclared volume with another `installId` → exit 1; every declared and every labelled name is inspected exactly once;
  - the env preflight;
  - a failed one-shot fails fast;
  - healthy but `/readyz` 503 is not ready;
  - the deadline with a fake clock;
  - each spawned readiness call gets a kill bound ≤ the remaining time;
  - `pulse.json` service unknown to Compose;
  - status rows, versions (with the synthetic fixtures of decision 3, "Fixtures"), the JSON output and the exit codes.
- **docs:** `cli/docs.test.ts` (decision 17).

#### Comparing two init runs

Two runs of `pulse init` differ by design in the tokens, the `installId` (in `pulse.json` and in every volume label of `compose.yaml`), `createdAt`, and, for demo, the maintenance windows of `config/api/checks.json`. Every check that compares two runs uses one of these two methods, and no other:

1. **In process (unit tests):** both runs get the same injected `now`, the literal `2026-11-01T12:00:00.000Z`, and each gets a fresh instance of the same deterministic random source: a byte stream from a literal seed, for example SHA-256 in counter mode over the seed `"pulse-test"`, so the stream does not depend on the code under test. The CLI draws from the random source in a fixed order that does not depend on how the answers were collected (tokens, then `installId`, then the lock nonce and temp names). The expected result is that the complete file sets, including `secrets/`, `pulse.json`, the volume labels and demo maintenance windows, are byte- and mode-equal. Nothing is excluded or rewritten. This method covers flags against prompts, EOF at "Start now?" against `--no-start`, and any setup including demo.
2. **Two real processes** (the spawned `--interactive` run against a spawned flags run): the randomness and the clock are real, so:
   - the setup is `full`, whose checks file has no maintenance windows and no time-dependent value (the sample set of `full/config/api/checks.json` has only `checks`); demo is never compared this way;
   - `secrets/` is compared by file names and modes only, and each token is checked against `^[0-9a-f]{64}$`;
   - in each run, the `installId` is read from that run's `pulse.json` and must match `^[0-9a-f]{32}$`; every occurrence of that string in every file outside `secrets/` is replaced with `<install-id>`, and the number of occurrences in `compose.yaml` must equal the number of top-level volumes (a literal count of the variant in the test);
   - the value of `createdAt` in `pulse.json` is replaced with `<created-at>` after it is checked to parse as an ISO time;
   - then every file outside `secrets/` must be byte- and mode-equal.

   The normalization touches only these two values; any other difference fails.

### Breakdown notes

- Step tasks are checked with `bun test` and the fake spawn only. One exception: `scripts/secrets-init.test.sh` already needs Docker for single `docker run` containers, with no Compose stack (its header, lines 2–3, and the `lint` job step at `deploy/.github/workflows/ci.yml` lines 49–50). It runs locally in a few minutes, so it can stay the acceptance of the task that changes `scripts/secrets-init.mjs`. The jobs that need a live Docker daemon (`cli/test/stack.sh` for `demo`, `full`, `minimal` and `dev`, `cli/test/errors.sh` against the compiled binary, `cli/test/render-variants.sh`), `release.yml`, the security hostile inputs and the PR evidence belong to the final task.
- Task acceptance that compares two `pulse init` runs uses the methods of "Comparing two init runs", never "equal except some fields". Task acceptance about Compose arguments names the two forms of decision 13 (the resolution call without `--project-name`, the operation prefix with it). Task acceptance about image references uses the fixtures of decision 3; no task acceptance or fixture writes a literal that the no-pin gate matches.
- The section says `Behavior change: yes`. The docs (`docs/cli.md`, `README.md`, `AGENTS.md`, `dev/README.md`) go into the final task with the CI jobs that run their commands ("Without the CLI" in `cli-stack minimal`, the download check in `cli-build`), so no task holds docs alone and every task is a behavior change.

### Completion evidence

1. The `check`, `lint`, `pins`, `minimal`, `full`, `demo`, `dev`, `cli-build` (three runners), `cli-render`, `cli-stack` (three variants) and `cli-errors` jobs are green on the PR.
2. The PR quotes the `cli-stack demo` lines:
   - `pulse status` output with every service and its version;
   - the admin auth 200, 401 and 403 lines;
   - the three refusals of the second install (project guard), the refusal of the override that names a foreign volume, and the volume-guard refusal;
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
- **Project name `pulse`** is shared with the repository's `full/`. The project resolution and guard (containers and volumes) prevents acting across directories or installations, but two installs with the same name cannot coexist, even stopped with kept volumes; the second needs `--project`. A user who ran the standalone setup first meets that refusal on the first `pulse up`; the message names the fix.
- **Compose behavior** that the guard relies on (`--project-name` and `--file` over `COMPOSE_*`, `config --no-interpolate` with the resolved `name` of every volume and network, the recreate prompt on changed volume labels, `down --volumes` removing declared volumes by name) was verified with Compose v2.38.2 only. The `cli-stack demo` steps 7, 8, 9 and 11 recheck it on the runner's Compose in every run.
- **Binary size** (~100 MiB) is the Bun runtime. Accepted: the issue asks only to report it.
- **The scope is large.** The breakdown should split it at the seams of the `Files:` table: the secrets-init extension, the toolchain and argument parsing, rendering, writing and backups, lifecycle commands, prompts, and a final task with the CI jobs that need Docker, the release, the docs and the evidence ("Breakdown notes").

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
5. **Interactive flow** (unit tests): the prompts are driven through injected input and through the real process with `--interactive`. The resulting files equal the files that the same answers produce as flags (two independent runs), compared as "Comparing two init runs" defines: in process with the literal `now` and the same seeded random source, byte- and mode-equal with nothing excluded; as two real processes with setup `full`, after replacing only each run's own `installId` and `createdAt`, with `secrets/` compared by names and modes.
6. **Real wiring:**
   - admin `GET /admin/config` answers 200 with `secrets/admin-token`, 401 without a token and 403 with a probe token (status codes from `api/docs/rest-api.md` at `v0.1.0`);
   - the webhook receiver verifies the HMAC with the literal sentinel secret.
7. **Errors** (`cli-errors`, unit tests): exit 3 with the literal messages for missing Docker, an unreachable daemon and Compose `2.22.0`; a hanging readiness with `--timeout 2` ends within 5 s, measured by the test's own clock.
8. **Without the CLI:** the `docs/cli.md` "Without the CLI" commands run in the `cli-stack minimal` job after `pulse down`:
   - plain `docker compose up -d` in the directory;
   - the documented readiness command;
   - editing `config/api/checks.json` with `sed -i` to rename a check, after which `GET /checks` shows the new name within 30 s (the reload interval is 5000 ms by default, `api/docs/configuration.md` at `v0.1.0`);
   - `docker compose down -v`.
9. **Distribution:**
   - on the PR (`cli-build`, each runner): `cli/test/verify-download.sh` prints `<asset>: OK` and exits 0 for the native binary listed in a three-line `SHA256SUMS` whose other two files are absent; it exits 1 for a changed byte and for an unlisted asset (literal exit codes). `cli/docs.test.ts` passes, so the docs show the same lines;
   - after merge and the `v0.1.0` tag: the release has the four literal asset names. The `release.yml` `verify` job on each of the three runners downloads one asset plus `SHA256SUMS`, passes `verify-download.sh`, and `pulse --version` prints `pulse 0.1.0`, where the value comes from the tag.
10. **Project guard and environment** (`cli-stack demo` steps 7, 8, 9 and 11, unit tests): with `COMPOSE_PROJECT_NAME` and `COMPOSE_FILE` exported, `pulse status --json` exits 0 with the literal ten services; a second install of the same project name gets exit 1 from `status`, `up` and `down --volumes`; an install `pulse-other` whose override names the volume `pulse-demo_api-data` gets exit 1 from `down --volumes` with the literal message part `is named pulse-demo_api-data, not pulse-other_api-data`, and `docker volume inspect pulse-demo_api-data` still exits 0 (literal exit codes); the first install's volume names are the same before and after (Docker's own listing, compared with itself before the step).
11. **Lock and cancellation** (unit tests, the cases of "Counterexamples"): a foreign `.pulse-init.lock` is byte- and mtime-equal after a refused run; EOF at "Start now?" exits 2 with every managed file present and no spawned Docker call; SIGINT in phase B exits 130 with the complete file set and no lock (literal exit codes and literal path list).
12. **#528 is unchanged:** the `minimal`, `full` (with e2e), `demo`, `dev`, `pins` and `lint` jobs, including `scripts/check-setup.sh` and the existing `secrets-init.test.sh` cases, pass with no edit to their expected values.
