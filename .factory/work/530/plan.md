# Spec #530: pulse CLI day-2 commands (token rotate, upgrade, logs)

## Goal

The `pulse` CLI of pulse-deploy (#529) gets three day-2 commands for an installation that `pulse init` wrote:

- `pulse token rotate <admin|probe>` rotates a token through the api's token store. Consumers switch to the new secret while the old one is still valid, and only the consumers that need the new secret restart.
- `pulse upgrade [--to <version>]` moves the installation's pinned pulse images to a newer release. It shows the change, verifies the provenance of every new image digest, applies the change with `--yes`, waits for readiness, and restores images and data if the new release does not become ready.
- `pulse logs [service] [--follow]` wraps `docker compose logs` for the guarded project.

The commands get docs, unit tests and live CI jobs.

## Sources

- The issue #530 and its comments. The owner decided **D1-A and D2-A** on 2026-11-11 and confirmed the assumption: `pulse upgrade` requires an installed, authenticated `gh`, and there is no flag to skip provenance. Release A is `0.1.0`. Release B is `0.1.1` of all five services, pinned with `scripts/bump-images.sh api=0.1.1 probe=0.1.1 status=0.1.1 notify=0.1.1 console=0.1.1`.
- `.factory/work/530/issue-review.md`: open points 1–9 and the derived acceptance checks 1–9.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/530` answered `HTTP 404` in this run. There are no findings, which is normal for a feature without children.
- Clones read in this run (all `main`):
  - deploy `d47d8b9`: `cli/*.ts`, `cli/test/*`, `scripts/secrets-init.mjs`, `scripts/bump-images.sh`, `common/services.yaml`, `docs/cli.md`, `.github/workflows/ci.yml`, `package.json`, `biome.json`, `bunfig.toml`, `AGENTS.md`.
  - api `8959e04`, which is the commit of tag `v0.1.1`: `docs/operation.md` (Upgrades, Token rotation, Backup), `docs/rest-api.md` (Tokens, `GET /checks/:id/results`), `docs/configuration.md` (Token import), `src/migrations.ts` and `src/token-store.ts`.
  - probe `92f55df` (= `v0.1.1`): `src/scheduler.ts` and `src/main.ts`.
  - console `b6c737d` (= `v0.1.1`): `src/admin-token.ts` and `src/token-read.ts`.
  - config `88996cb`: `.github/workflows/release.yml`.
- Registry and provenance, checked on 2026-11-11:
  - Each of the five images has tags `0.1.0` and `0.1.1` on ghcr.io (anonymous `tags/list`).
  - For each of the five `0.1.1` index digests, this passed (exit 0) with gh 2.103.3:
    `gh attestation verify oci://ghcr.io/lorenzh/pulse-<svc>@<digest> --repo lorenzh/pulse-<svc> --signer-workflow lorenzh/pulse-config/.github/workflows/release.yml --source-ref refs/tags/v0.1.1 --deny-self-hosted-runners`.
  - The same call for the api `0.1.1` digest with `--source-ref refs/tags/v0.1.0` exits 1. So `--source-ref` ties a version to its digest.

## Facts the spec builds on

1. **Token store in `0.1.1`.** api `v0.1.1` has the database token store.
   - Routes (`docs/rest-api.md` "Tokens", lines 502–529): `GET /admin/tokens`, `GET /admin/tokens/self`, `GET /admin/tokens/:id` and `POST /admin/tokens/:id/rotate`.
   - Rotate answers `{token, secret, previousValidUntil}`. The `secret` is `pulse_` followed by 43 base64url characters, 49 characters in total.
   - The old secret stays valid for 10 minutes. A second rotate during the overlap answers `409`. Revoked or expired tokens also answer `409`.
   - Token ids are `tok_` and 24 lower-case hex characters (`src/token-store.ts` line 23).
   - The token files are imported once and ignored afterwards (`docs/configuration.md` "Token import"). Imported probe tokens are named `probe <location> #<n>`. The admin token keeps the name from `admin-tokens.json`, which `secrets-init.mjs` writes as `admin` (line 223).
   - Admin-side secrets need 32 or more characters (`docs/operation.md` lines 94–110). The CLI-generated ones have 64.
2. **No token store in `0.1.0`.** api `0.1.0` reads tokens from files (schema 3). `v0.1.1` has `SCHEMA_VERSION` 9: nine steps in `src/migrations.ts` `MIGRATIONS`. An older api refuses a newer schema with exit 2 (`docs/operation.md` lines 33–36).
3. **Consumers read their secret only at start.**
   - The probe reads `PULSE_PROBE_TOKEN_FILE` once at start and becomes ready only after `GET /probe/checks` succeeds (`src/main.ts` lines 128–155 and 249–251).
   - The probe runs each check after a random first delay below 1000 ms (`MAX_FIRST_DELAY_MS`, `src/scheduler.ts` line 36). After that it runs once per interval from the previous start. The result `timestamp` is the start of the run (`src/check.ts` line 149). Consecutive results are therefore one interval plus the timer lateness apart, so slightly more than one interval.
   - The console reads its admin token file at start and needs at least 32 characters (`src/admin-token.ts`).
4. **How deploy hands out secrets.**
   - `secrets-init` (files mode) copies `secrets/admin-token` and `secrets/probe-token-<loc>` into the per-consumer volumes: owner 1000:1000, mode 0400, written atomically (`scripts/secrets-init.mjs` lines 162–204).
   - It also rewrites `api/tokens.json` and `api/admin-tokens.json`, which a token-store api ignores after the import.
   - The CLI's install renders `PULSE_PROBE_LOCATIONS` and `PULSE_SECRETS_ADMIN: "on"` (`cli/render-compose.ts` lines 101–118).
5. **How the CLI writes and runs Compose today.**
   - The generated `compose.yaml` writes every string double-quoted (`cli/yaml.ts` lines 1–5). Each pulse service has an `image: "ghcr.io/lorenzh/pulse-<svc>:<x.y.z>@sha256:<64 hex>"` copied from `common/services.yaml` (`cli/render-compose.ts` lines 90–99, `cli/services.ts` lines 36–48).
   - In full and demo the api port is not published (`cli/render-compose.ts` lines 156–158). Readiness already runs `docker compose exec -T <svc> bun -e <script>` inside the container (`cli/ready.ts` lines 48–77).
   - The spawn seam has stdin `ignore` (`cli/docker.ts` lines 52–83). The only lock is `.pulse-init.lock`, held by `pulse init` (`cli/write-install.ts` lines 28 and 345–400).
6. **Pins today.** `common/services.yaml` pins all five pulse images to `0.1.0` (lines 8, 16, 25, 35 and 44). Issue #692 (deploy, in `build/implement`) waits for the same release and may bump these pins first.

## Scope

- **deploy only**:
  - the pin bump to the `0.1.1` releases;
  - the three commands in `cli/`, with shared seams extracted from existing code;
  - live test scripts in `cli/test/` and two new CI jobs;
  - docs (`docs/cli.md`, `README.md`, `AGENTS.md`).
- **meta (this spec PR):** only the spec files. No change to `docs/approved-packages.md`:
  - no new runtime package, image or action;
  - `gh` is an external tool like `docker`, not a dependency;
  - the snapshot helper reuses the already pinned `oven/bun` image of `secrets-init`.

## Non-goals

- `pulse backup` (a later item). The upgrade's internal safety snapshot is not a public backup command.
- Self-update of the CLI binary.
- Rotating tokens that the installation does not manage itself: remote probe tokens, the `status` and `notify` service tokens, and tokens created in the console.
- Upgrading third-party images (`oven/bun`, `alpine/openssl`, `axllent/mailpit`) and `dev` source builds.
- Downgrades through `pulse upgrade`. Prereleases are never chosen.
- Changes to api, probe, console or any other service.

## Decisions

1. **Supported installations.** The commands work on directories with `pulse.json` format 1 written by `pulse init`. They reuse the guard of `up`, `down` and `status` (`resolveProject`, `cli/docker.ts` lines 453–474), with the same `--dir` default `.` and the same exit codes (0 ok, 1 failed, 2 usage, 3 Docker missing, 130 interrupted). No new metadata goes into `pulse.json`.
   - The standalone repository setups (`minimal/`, `full/`, `demo/`, `dev/` with `scripts/init-secrets.sh`) are out of scope. The standalone `demo/` generates its tokens inside volumes (`PULSE_SECRETS_MODE=generate`). The docs say so.
2. **Pins.** The deploy child bumps the pins with `scripts/bump-images.sh api=0.1.1 probe=0.1.1 status=0.1.1 notify=0.1.1 console=0.1.1`. If `main` already pins `0.1.1` or later when the task starts (for example after #692), it skips the bump and records that in the PR. No other file gets a version or digest.
3. **One mutation lock.** `pulse init`, `pulse token rotate` and `pulse upgrade --yes` share the existing lock file `.pulse-init.lock`. Its owner and nonce rules stay the same.
   - The name stays, so an older CLI's `init` still excludes a running rotation or upgrade.
   - The refusal text becomes `another pulse command is running in <dir> (or remove .pulse-init.lock if none is)`.
   - `up`, `down`, `status` and `logs` take no lock.
4. **Private transport to the api.** Every api call runs `docker compose <operation prefix> exec -T api bun -e <API_SCRIPT>`.
   - `API_SCRIPT` is a constant text. Its stdin carries one JSON line `{"method","path","bearer","body"}`.
   - The script calls `http://127.0.0.1:3000<path>` with a 10 s timeout and `redirect: "error"`. It prints the status code on line 1 and the body, capped at 1 MiB, after it.
   - No bearer, secret or digest of a secret is ever in argv, the environment, `compose.yaml`, a diagnostic or normal output.
   - The spawn seam gets an `input` option that writes the text to stdin and closes it. stdin stays `ignore` when `input` is absent.
5. **Capability detection.**
   - `GET /admin/tokens/self` with `secrets/admin-token` must answer `200` with an object whose `id` matches `^tok_[0-9a-f]{24}$` and whose `scopes` include `admin`.
   - `404` means an api without the token store. The CLI refuses with `the api has no token store (pulse-api 0.1.1 or later); run pulse upgrade first`.
   - `401`, `403` and `429` are named as such.
   - This check runs before any token changes.
6. **Which tokens `admin` and `probe` mean.**
   - `admin` is the token that `secrets/admin-token` authenticates as, so its id comes from `/admin/tokens/self`.
   - `probe` means every locally managed probe location. The locations are the comma list `PULSE_PROBE_LOCATIONS` of the `secrets-init` service in the resolved Compose configuration. Each location needs exactly one pulse.json service whose resolved `environment.PULSE_LOCATION` equals it (`probe` in minimal/full, `probe-<loc>` in demo) and a host file `secrets/probe-token-<loc>`. Anything else refuses.
   - A `secrets-init` whose `PULSE_SECRETS_MODE` is set and not `files` refuses.
   - For each location, the CLI reads `GET /admin/tokens`. The candidates are tokens whose `scopes` are exactly `["probe"]`, whose `location` equals the location, with `revokedAt` null and `expiresAt` null or in the future.
     - Exactly one candidate is used.
     - None refuses.
     - Several candidates refuse and list each candidate's `id` and name (the name through `shown()`), unless `--location <loc> --id <tok_…>` selects one.
     - A candidate whose `previousValidUntil` is in the future refuses: `token <id> is still in its rotation overlap until <ISO time>; run again after it`. The exception is a resume from the journal (decision 8).
   - Every refusal happens before the first `POST`. Rotation keeps the id, scopes, location and expiry. It never revokes and recreates the token (the one exception is decision 8, lost response).
7. **Order of one rotation item.** For one token, with consumer services C (admin: `console` when present, else none; probe: the location's probe service):
   1. **Preflight of the whole command.** Lock, guard, file checks (below), capability, the token and candidate selection for every item, and every consumer service running and ready. Only then does the first `POST` go out.
   2. **Journal.** Write `requested` with the token id and its `rotatedAt` as read in the preflight.
   3. **Rotate.** `POST /admin/tokens/<id>/rotate`.
   4. **Save.** Write the new `secret` atomically into the host file: temp file `wx` 0600 in `secrets/`, fsync, rename, fsync of the directory. Then set the journal to `saved`.
      - Signals are recorded and not acted on from step 2 until step 4 ends, as `writeInstall` does (`cli/write-install.ts` lines 366–399).
   5. **Refresh.** `docker compose <prefix> run --rm --no-deps -T secrets-init` must exit 0.
   6. **Switch.**
      - **Probe**, start-new-then-stop-old:
        1. `docker compose <prefix> up -d --no-deps --no-recreate --scale <svc>=2 <svc>`.
        2. The new container is the one whose id was not in `ps --all --format json` before.
        3. Wait (bounded by `--timeout`, default 120 s) until the new container answers `/readyz` 200 through `docker exec -i <id> bun -e <script>`.
        4. Check that its `/run/pulse/probe-token` equals the new secret. The check runs inside the container, the expected secret goes in on stdin, the script compares with `timingSafeEqual`, and it prints only `same` or `different`.
        5. Keep the old container running for 2000 ms more. The new probe's first run starts within 1000 ms of becoming ready (fact 3), so its first result is earlier than the old probe's stop.
        6. `docker stop --time 10 <old id>`, then `docker rm <old id>`.
        7. Afterwards the service has exactly one container.
      - **Admin**:
        1. Check that the new secret answers `GET /admin/tokens/self` `200` with the same id.
        2. When the console exists: `docker compose <prefix> up -d --no-deps --force-recreate console`, then wait for its readiness (reuse `waitReady` with that one service).
        3. Run the same in-container equality check on `/run/pulse/admin-token`. Then let the console container read its own file and call `GET http://api:3000/admin/tokens/self`. It must answer `200` with the same id.
   7. **Done.** Set the journal to `switched`, and print `rotated <admin|probe <loc>> token <id>; the old secret works until <previousValidUntil ISO>`.
   - API, status and notify never restart for either kind. The probes do not restart for `admin`. The console does not restart for `probe`.
   - Probe locations rotate one after another.
   - The command returns after the switch. It does not wait for the 10-minute overlap: expiry is the api's job.
8. **Journal and recovery.**
   - `secrets/.pulse-rotation.json` (0600, atomic writes) holds `{format:1, kind, items:[{tokenId, location?, file, service?, rotatedAtBefore, state}]}`. It never holds a secret. It is removed when every item is `switched`.
   - A rerun with a journal resumes each item by its state:
     - `switched`: skip.
     - `saved`: steps 5–7, with the secret from the host file.
     - `requested`: read `GET /admin/tokens/<id>`.
       - If `rotatedAt` still equals `rotatedAtBefore`, the `POST` had no effect. Rotate as normal.
       - If it changed, the response was lost. Handle it as below.
   - **Lost response.** The same handling runs inside the first run when the `POST` fails without a parsed `200` (timeout, broken pipe, no JSON).
     - Create a replacement token: `POST /admin/tokens` with the same `name`, `scopes`, `location` and `expiresAt`.
     - Save, refresh and switch as above.
     - Then revoke the lost token id. Revoking the last admin is refused by the api; it is not the last here, because the replacement exists.
     - Print `the rotate answer was lost; replaced token <old id> with <new id>`.
     - For `admin` this needs the old admin secret while it is still valid. After `previousValidUntil` the CLI exits 1 and names the recovery in the docs: another admin token, or a database backup.
   - Never: retry a `POST` rotate blindly, throw away a received secret, or restore the old secret file and report success.
   - **Interrupt.** An interrupt outside steps 2–4 stops before the next step. The CLI exits 130 with `interrupted; run pulse token rotate <kind> again to finish`. The journal stays.
   - `pulse upgrade --yes` refuses while the journal exists.
9. **File checks for rotation.**
   - `secrets/` must be a directory, not a link, and no wider than 0700.
   - Each target file must be a regular file, not a link, with no group or other bits, and must hold a valid token (`tokenContentValid`, `cli/tokens.ts` lines 40–43).
   - The directory must be writable.
   - Refusals name the path and the rule only.
10. **Upgrade selection.**
    - The installed pulse images come from the parsed `compose.yaml` (`Bun.YAML.parse`, not the effective model). There is one per pulse.json service of kind `pulse`. The image name is `probe` for every service whose name starts with `probe`.
    - The command refuses before any change when:
      - an image is not `ghcr.io/lorenzh/pulse-<api|probe|status|notify|console>:<x.y.z>@sha256:<64 hex>`;
      - the probe services differ in image;
      - the effective image of a service in `docker compose config` (with the override) differs from the one in `compose.yaml` (`compose.override.yaml sets the image of <svc>; remove it to use pulse upgrade`);
      - the setup is `dev` (`dev builds from source; update the clones and run pulse up`).
    - Versions are full stable SemVer `(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)`, the stable core of `config/.github/workflows/release.yml` lines 34–37. They are compared numerically per part.
    - Without `--to`, each image moves to the highest stable tag on ghcr.io that is greater than its current version. With none, it stays.
    - `--to X.Y.Z` (a leading `v` is accepted and removed; anything else, including prereleases and leading zeros, is a usage error, exit 2) wants exactly that tag for every installed pulse image:
      - an image without that tag refuses the whole command;
      - an image whose current version is greater refuses (`no downgrades`);
      - an equal one stays.
    - When nothing changes, print `already up to date` and exit 0 without touching anything.
11. **Registry.**
    - Anonymous `https://ghcr.io/token?scope=repository:lorenzh/pulse-<svc>:pull`.
    - `tags/list?n=1000`, following `Link: <…>; rel="next"` for at most 10 pages.
    - `HEAD /v2/lorenzh/pulse-<svc>/manifests/<tag>`, with the media types and checks of `scripts/bump-images.sh` lines 32–50 (OCI index or Docker manifest list, `Docker-Content-Digest` `sha256:<64 hex>`).
    - Each request: 20 s timeout, `redirect: "error"`, body capped at 1 MiB.
    - The fetch is an injected dependency. `scripts/bump-images.sh` stays the repository's pin tool. The CLI has its own TypeScript client (`cli/registry.ts`), because the binary cannot run the bash script.
12. **Provenance (no bypass).**
    - Preflight: `gh --version` must run. `gh auth status` must exit 0, or `GH_TOKEN` or `GITHUB_TOKEN` must be set. Otherwise exit 1 with `pulse upgrade needs the GitHub CLI gh, signed in (gh auth login); see docs/cli.md#upgrade`.
    - For every image that changes, this must exit 0 within 120 s:
      `gh attestation verify oci://ghcr.io/lorenzh/pulse-<svc>@<digest> --repo lorenzh/pulse-<svc> --signer-workflow lorenzh/pulse-config/.github/workflows/release.yml --source-ref refs/tags/v<version> --deny-self-hosted-runners`
    - The digest that is verified is the digest that is pulled and written. Nothing resolves a tag again after this step.
    - A failure prints the image, the version and the first stderr line (through `firstLine`, which masks user info), and exits 1.
    - There is no flag, env variable or setting that skips the check. The preview (without `--yes`) runs it too.
13. **Upgrade apply (`--yes`) and the rollback boundary.**
    1. Preflight: lock, guard, no rotation journal, and no earlier snapshot whose `upgrade.json` state is `applying` or `rollback-failed`. A refusal names that directory.
    2. Selection, then a table of service, from version and 12-hex digest, to version and 12-hex digest, and `provenance verified`. Without `--yes`, print `run pulse upgrade --yes` (with the same `--to`) and exit 0 here. A preview writes no file and changes no container.
    3. `docker pull <ref>@<digest>` for every new image. A failure exits 1, and nothing is stopped.
    4. `docker compose <prefix> stop`.
    5. Snapshot into `.pulse-upgrade/<UTC stamp>-<6 hex>/` (0700, created `wx`).
       - `compose.yaml` is copied byte for byte (0600).
       - Each declared top-level volume whose key ends in `-data` (`api-data`, `notify-data`, `console-data`) becomes `<key>.tar` (0600, the file opened `wx`, its fd given to spawn as stdout). The source is `docker run --rm --network none --user 0:0 --cap-drop ALL --cap-add DAC_OVERRIDE --security-opt no-new-privileges:true -v <project>_<key>:/from:ro <image of secrets-init from the resolved config> tar -C /from -cf - .`.
       - `upgrade.json` holds `{format:1, from:{svc:ref}, to:{svc:ref}, state:"applying"}`.
       - A failure here starts the old images again (`up -d` with the unchanged `compose.yaml`), waits for readiness and exits 1.
    6. Edit `compose.yaml`.
       - Replace each old image string with the new one. The count of replacements must equal the number of services that used it.
       - Parse the new text again and check that it equals the old model with only those `image` values changed.
       - Write atomically with the old mode.
    7. `docker compose <prefix> up -d`, then `waitReady` with `--timeout` (default 300 s, 1–3600).
    8. On success: set `upgrade.json` to `done` and print `upgraded; snapshot kept in <dir>`. The snapshot is the only way back to the older version. Exit 0.
    9. On a failed `up`, a failed one-shot, a timeout or an interrupt after step 4, roll back:
       1. `stop`.
       2. For each tar: `docker run --rm -i --network none --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --security-opt no-new-privileges:true -v <project>_<key>:/to <same image> sh -c 'find /to -mindepth 1 -delete && tar -C /to -xpf -'`, with the tar fd as stdin.
       3. Restore `compose.yaml` atomically.
       4. `up -d`, then `waitReady` with the same timeout.
       - If the rollback is ready: state `rolled-back`, print `upgrade failed: <reason>; rolled back to the previous images and data; ready`, exit 1.
       - Otherwise: state `rollback-failed`, print `upgrade failed and the rollback failed: <reason>; snapshot in <dir>; see docs/cli.md#upgrade-recovery`, exit 1 (130 when an interrupt started it).
       - Signals during the rollback are recorded, not acted on. The rollback is bounded by its timeouts.
    - Data volumes are never deleted. The `*-secrets` volumes are not in the snapshot: `secrets-init` rewrites them from `secrets/` at each start.
    - **Rollback boundary, as stated in the docs.**
      - The stack is down from step 4 until ready, so there are no results during an upgrade.
      - A rollback loses every write after the snapshot.
      - The snapshot needs free disk space for one copy of the data volumes.
      - This is what makes a rollback across schema steps (api 3 → 9, console migrations) possible. Restoring the pins alone does not: api `0.1.0` refuses schema 9.
14. **Logs.** `pulse logs [--dir <dir>] [--follow] [<service>]` runs `docker compose <prefix> logs [--follow] [<service>]` with stdout and stderr inherited and no kill bound.
    - `<service>` must match `^[a-z0-9][a-z0-9_.-]{0,62}$`; otherwise usage error, exit 2.
    - It must also be a service of the resolved project; otherwise exit 1, `unknown service <name>; services: <list>`.
    - The exit code is Compose's exit code (0 or 1).
    - On SIGINT or SIGTERM to the CLI, the child gets SIGTERM. The CLI waits for it and exits 130. No child stays behind.
    - The command adds no text of its own to the log stream.
15. **Continuity rule for the acceptance (needs approval at spec merge).** The issue asks for "no gap longer than one interval". The probe's own cadence is one interval plus timer lateness (fact 3), so a strict `<= interval` fails even with no rotation at all.
    - This spec gates on **gap <= interval + 500 ms** (10 % of the 5000 ms demo interval).
    - The same rule must also hold in a 60 s baseline before the rotation in the same run. That shows the 500 ms covers only normal lateness.
    - Merging this spec approves the allowance. A reviewer who wants another bound changes this line, not the test after a failure.

## Required behavior

### `pulse token rotate <admin|probe> [--dir <dir>] [--location <loc>] [--id <tok_…>] [--timeout <s>]`

- Decisions 3–9 apply.
- `--location` applies only to `probe` and limits the run to that location. `--id` needs `--location` and must match `^tok_[0-9a-f]{24}$`. `--timeout` is 1–3600, default 120, and bounds each readiness wait. Any other combination is a usage error, exit 2.
- Output: one line per item and the overlap deadline. No secret, no secret digest, no bearer.
- Works in every setup with the token-store api, `dev` included.

### `pulse upgrade [--dir <dir>] [--to <x.y.z>] [--yes] [--timeout <s>]`

- Decisions 10–13 apply.

### `pulse logs [--dir <dir>] [--follow] [<service>]`

- Decision 14 applies.

### Help and docs

- `HELP` gets `token`, `upgrade` and `logs`. `pulse --help` lists them. `COMMANDS` includes `token`, `upgrade` and `logs`; `token` takes the sub-word `rotate`.
- `docs/cli.md` gets one section per command (`## pulse token rotate`, `## pulse upgrade`, `## pulse logs`) and `### Upgrade recovery`. It replaces the manual rotation bullets under "Tokens", updates the pin text (`0.1.0` → the pinned release), and gives the manual Compose equivalents for each command.

## Risks

- **Compose `--scale` behavior.** The live test proves the start-new-then-stop-old handoff. That includes one container per probe service afterwards, and `pulse up` and `pulse status` working after the rotation. If Compose renumbers or recreates the container in a way that breaks this, the implementer requests a hold and does not fall back to stop-then-start, which breaks the gap rule (see Counterexamples).
- **Duplicate results.** For about 2–3 s per location, two probe containers post for the same location. This gives at most one extra sample per check. It is documented as a known limit.
- **0.1.0 → 0.1.1 upgrade needing manual steps.** If the live upgrade test shows a required config change, the implementer requests a hold. The upgrade must not grow config migrations.
- **#692 bumping the pins at the same time.** Decision 2 covers it.
- **`gh` on the runner.** GitHub-hosted runners ship `gh`. The job prints `gh --version` first and passes `GH_TOKEN: ${{ github.token }}`, with job permissions `contents: read` and `attestations: read`.
- **Overlap length in CI.** The rotation job waits for the real 10-minute overlap. The production overlap is not shortened.

## Acceptance evidence

Each check names where its expected value comes from.

1. **`cli-rotate` CI job** (`bash cli/test/rotate.sh`, binary from `bun run build`). It runs on a fresh `pulse init --setup demo --yes`, `pulse up`, with the pinned release (token store).
   - **Precondition.** `GET /checks` (through the api container) reports `always-healthy` with `intervalMs` 5000 (literal), and `GET /locations` reports exactly `eu` and `us` (literals).
   - **Baseline.** 60 s of results. The gap rule (Counterexamples, "Gap rule") holds per location.
   - **Probe rotation.** The old secrets are copied into a private 0700 temp directory. Then `pulse token rotate probe` runs between host times T0 and T1 and must exit 0, and:
     - Its stdout and stderr contain none of the old or new secrets (`grep -F` against the files).
     - `secrets/probe-token-eu` and `-us` differ from the old copies. Each has mode 0600, starts with `pulse_` and is 49 characters long (literals from the api docs).
     - Inside each probe container, `/run/pulse/probe-token` equals the host file. The comparison runs in the container and prints only `same`.
     - The containers of api, status, notify, console, mailpit, demo-targets and demo-tls keep their ids and `StartedAt`.
     - `docker compose ps` shows exactly 1 container (literal) per probe service.
     - The gap rule holds per location over [T0 − 30000, T1 + 30000] ms.
   - **Overlap.** A second `pulse token rotate probe` before the deadline exits 1 with `still in its rotation overlap` and changes no secret file (sha256 before and after).
   - **Admin rotation.** `pulse token rotate admin` exits 0, and:
     - The new admin secret answers `GET /admin/tokens/self` 200 with the id recorded before the rotation.
     - The console container's `/run/pulse/admin-token` equals the host file.
     - The console answers `/readyz` 200.
     - The probe and api container ids are unchanged.
   - **During the overlap.** The old probe secret answers `GET /probe/checks` 200 and the old admin secret answers `GET /admin/tokens/self` 200.
   - **After the overlap.** The test waits until each token's `previousValidUntil` (read from `GET /admin/tokens/<id>`, an api source, not CLI output) plus 5 s. Then:
     - The old probe secrets answer `GET /probe/checks` 401 (literal).
     - The old admin secret answers `GET /admin/tokens/self` 401 (literal).
     - The new secrets answer 200.
     - Each location has a result of `always-healthy` newer than 10 s.
   - **Persistence.** `pulse down && pulse up` exits 0, and each probe's `/run/pulse/probe-token` equals its host file again.
2. **`cli-upgrade` CI job** (`bash cli/test/upgrade.sh`). Both releases come from ghcr.io, read by the test with curl and jq:
   - Release B per service is the highest stable tag.
   - Release A is the highest stable tag below the version pinned in `common/services.yaml`.
   - The digests come from `HEAD …/manifests/<tag>`.
   - No version or digest literal is in the script.

   Steps:
   - **Install release A.** `pulse init --setup demo --yes`. The test helper `cli/test/pin-release.sh <dir> <svc>=<version>@<digest> …` rewrites the five pulse image lines to release A. Then `pulse up`, with results flowing.
   - **Legacy refusal.** On A, `pulse token rotate probe` exits 1 with `has no token store` and every secret file's sha256 is unchanged.
   - **Preview.** `pulse upgrade` exits 0 and lists every service A → B. The sha256 of `compose.yaml` and the container ids are unchanged, and `.pulse-upgrade/` does not exist.
   - **Broken B.** With `cli/test/fail-ready-docker` first on PATH, `PULSE_TEST_FAIL_READY_SERVICE=console` and `PULSE_TEST_FAIL_READY_TAG=<B console version>`, `pulse upgrade --yes --timeout 120` exits 1 with `rolled back to the previous images and data; ready`. Then:
     - `compose.yaml`'s sha256 equals the pre-upgrade sha256.
     - Every running pulse container's image is the A digest (`docker compose ps --format json`).
     - `pulse status` exits 0.
     - The api answers `/readyz` 200. api A refuses schema 9, so this proves the data restore.
     - `always-healthy` has a result older than the upgrade start, and a new result within 60 s after the rollback.
   - **Real B.** `pulse upgrade --yes` exits 0. Then:
     - The running images are the B digests.
     - `pulse status` exits 0.
     - `installId`, `secrets/*` sha256 and the `.env` sha256 are unchanged.
     - `always-healthy` still has a result older than the first upgrade start.
     - `pulse token rotate probe` now passes the capability check: it exits 0.
3. **Unit tests** (`bun run test`, coverage threshold from `bunfig.toml`). They cover every rule in Counterexamples, with literal inputs and expected values.
4. **`cli-stack`** (demo, full, minimal) adds the logs checks:
   - `pulse logs secrets-init` is byte-equal to `docker compose <prefix> logs secrets-init`. A completed one-shot has fixed logs.
   - `pulse logs --follow api`, sent SIGINT after 3 s, exits 130, and `pgrep -f 'compose.*logs'` finds no process.
   - `pulse logs nosuch` exits 1, and `pulse logs 'a b'` exits 2.
5. **`cli-errors`** adds `logs`, `upgrade` and `token rotate` with the stub docker. Docker missing exits 3, and each refuses before any other call.
6. **Docs check.** `cli/docs.test.ts` asserts that `docs/cli.md` has a `## pulse <name>` heading for every entry of `COMMANDS`. The list in `args.ts` is the independent source for the docs file.

## Performance impact

None expected for the api `bench/budgets.json` metrics. The api `bench/budgets.json` has the targets `api`, `config`, `contract`, `kit`, `notify`, `probe` and `status`, and no deploy entry. No service code changes. The pin bump changes which service builds run, but those builds are measured in their own repositories. The CLI binary grows by the new modules. The existing `cli-build` step "Binary size and init time" (`.github/workflows/ci.yml` lines 407–414) reports it. The PR quotes the size before and after; no budget applies.

## Security impact

Security impact: yes

The change calls admin token routes, writes secret files, verifies image provenance, runs privileged one-shot containers on data volumes, and adds CI jobs with a token.

These checklist items apply:

- **Secrets in errors, logs and responses.**
  - Bearer tokens and new secrets travel only on stdin to `docker compose exec -T` or `docker exec -i`.
  - Argv, env and output never carry them. The tests grep the captured output and the recorded spawn argv for every secret.
  - Api error bodies are not echoed. Only the status code and a fixed text are shown.
  - Token names from the api go through `shown()`.
  - `gh` and Docker stderr go through `firstLine` (`maskUserInfo`).
- **Auth order and status codes.**
  - The capability and identity checks run before the first `POST`.
  - Each api status gets a defined outcome: 401, 403, 404, 409 and 429 are named, and anything else is `unexpected status`.
- **Body and size limits.** Api answers are capped at 1 MiB in `API_SCRIPT`. Registry bodies are capped at 1 MiB, and registry pagination at 10 pages.
- **Input validation.**
  - Token ids match `^tok_[0-9a-f]{24}$`. Service names and versions are validated.
  - Api and registry JSON goes through own-property readers (`own()` in `cli/docker.ts`), never trusted as typed.
  - Locations match `^[a-z0-9][a-z0-9-]{0,31}$`, as in `secrets-init.mjs`.
- **SSRF and redirects.** The registry host is fixed to `https://ghcr.io`, with `redirect: "error"`. The api URL is fixed to `127.0.0.1:3000` inside the api container. No user input builds a URL or a path beyond the validated token id.
- **Atomic, path-safe writes.**
  - Secret files, the journal, `compose.yaml` and the snapshot files are written `wx` with temp names in their final directory, fsynced and renamed.
  - Links and non-regular files are refused, and directory modes are checked.
  - The snapshot directory is 0700 with 0600 files, because it holds the databases.
- **Dependency pins.**
  - Images are verified by attestation (repository, signer workflow, source ref, no self-hosted runner) before they are pulled by digest.
  - The snapshot container uses the pinned `oven/bun` image of `secrets-init`, with `--network none`, `--cap-drop ALL`, only the capabilities that `tar` needs, and `no-new-privileges`.
  - No new package or action.
  - The CI jobs use `persist-credentials: false` and the existing SHA pins. `GH_TOKEN` is the job token with `attestations: read`.

## Rollout order

One repository (deploy). No service, contract, kit or config change.

Who still runs during the rollout:

- **Installations on `0.1.0`** (written by an older CLI, or by this one before an upgrade) keep working. `token rotate` refuses there with a pointer to `pulse upgrade`, and `upgrade` moves them to the pinned release.
- **Installations written by an older CLI binary.** They are format 1, so the new commands accept them.
- **An older CLI binary on a new installation.** It still sees `.pulse-init.lock`. `secrets/.pulse-rotation.json` and `.pulse-upgrade/` are not in its managed file list (`cli/write-install.ts` lines 33–44), so `pulse init --force` neither touches nor reports them.
- **A rotated secret** (49 characters, `pulse_` prefix) passes `tokenContentValid` and the `secrets-init.mjs` token rule (lines 22 and 36–42). So an older CLI's `pulse init --force` keeps it, and `secrets-init` copies it.

## Counterexamples

Each rule comes with a case that it must reject or that a wrong implementation gets wrong. Unit tests use these literals.

- **Gap rule** (decision 15).
  - **Inputs.** The check is `always-healthy`, with interval I = 5000 ms and allowance A = 500 ms. The window is [T0 − 30000, T1 + 30000] in host epoch ms.
  - **Sample set.** All results of that check with that location whose `timestamp` lies in the window, read with `GET /checks/always-healthy/results?limit=1000` and paged with `before` until a result older than the window start is seen. The pages must reach past the window start; otherwise the check fails.
  - **Statistic.** Sort the sample timestamps, add the window start and end as edges, and take the differences of neighbors. Every difference must be ≤ I + A. No averaging and no percentile.
  - **Examples.**
    - Timestamps `[0, 5004, 10009, 13000, 18003]` in the window [0, 18003] pass (largest difference 5005).
    - `[0, 5004, 10009, 15600]` fails (5591).
    - A stop-then-start probe whose last run started 4000 ms before a 3000 ms restart, plus a 600 ms first delay, posts its next result 7600 ms after the previous one. It must fail.
    - Results only from `us` must not hide a missing `eu`: the rule runs per location.
- **Selection.**
  - Two active `["probe"]` tokens for `eu` must refuse without `--id`.
  - A token with scopes `["probe","read"]` is no candidate.
  - A revoked one, or one with `expiresAt` in the past, is no candidate.
  - `--id tok_ABC` must be a usage error (upper case).
  - `--id` without `--location` must be a usage error.
  - `rotate admin --location eu` must be a usage error.
- **Order.**
  - A run where the `POST` happens before every location's preflight is wrong. Test: location `us` has two candidates, so no `POST` happens for `eu` either.
  - The host file must be saved before `secrets-init` runs.
  - The old probe container must stop only after the new one is ready, its token is `same`, and 2000 ms have passed.
  - For `admin`, the console restarts only after the new secret answers `/admin/tokens/self`.
- **Lost response.**
  - `POST` times out and `rotatedAt` changed: the CLI must create a replacement, switch, then revoke the old id. A blind second `POST` rotate is wrong.
  - `POST` times out and `rotatedAt` did not change: one normal rotate follows.
- **Journal resume.** State `saved` must not `POST` again.
- **409.** The api answers `409` on a token in overlap, and no journal names it. The CLI exits 1 with `still in its rotation overlap until`, and no file changes.
- **Legacy api.** `/admin/tokens/self` → 404: exit 1 before any write, and the journal is not created.
- **Files.**
  - `secrets/probe-token-eu` is a symlink: refuse before the `POST`.
  - `secrets/` with mode 0750: refuse.
  - A token file with mode 0640: refuse.
- **No secret in argv.** A test records every spawn and asserts that no argv element and no env value contains the fake bearer `pulse_` + `A`×43 or the fake new secret.
- **Upgrade versions.**
  - Tags `["0.1.0","0.1","0","0.1.1","sha256-…","0.10.0","0.2.0-rc.1"]` with current `0.1.0` select `0.10.0`: numeric, not text, and not `0.2.0-rc.1`.
  - `--to 0.2.0-rc.1` is a usage error, and so are `--to 01.2.3` and `--to 1.2`.
  - `--to v0.1.1` equals `--to 0.1.1`.
  - Current `0.2.0` with `--to 0.1.1` refuses (`no downgrades`).
  - One image without the tag refuses all of them.
- **Image shapes.**
  - `ghcr.io/lorenzh/pulse-api:0.1.0` without a digest refuses.
  - `pulse-api:dev` (dev) refuses.
  - `probe-eu` and `probe-us` with different refs refuse.
  - An override that sets `image:` for `api` refuses.
- **Compose edit.** A `compose.yaml` where the old api ref also appears in a comment or another key gives a replacement count unequal to the service count, so it refuses without a write.
- **Provenance.**
  - A `gh` exit 1 refuses.
  - Missing `gh` (spawn ENOENT) exits 1 with the install hint, not 3.
  - The verified digest must be the pulled digest. Test: the fake registry answers a second `HEAD` with another digest. The CLI must not ask again, and the pulled ref equals the verified one.
- **Rollback.**
  - On failure, the order must be stop → restore every tar → restore `compose.yaml` → `up -d`. Starting old images before the volume restore is wrong: api A exits 2 on schema 9.
  - A failed snapshot must not edit `compose.yaml`.
  - A `rollback-failed` snapshot makes the next `upgrade --yes` refuse.
- **Logs.**
  - `pulse logs --follow` must not get a kill bound. A fake clock that advances 1 hour must not kill it.
  - SIGTERM to the CLI must end the child and exit 130.

## Contract fields

No new name in contract or config. The new names are CLI commands, flags, files and test variables of deploy only. Each search was run in this run and found nothing (0 matches each):

- `grep -rn -- 'pulse-rotation' contract/src config deploy`
- `grep -rn -- 'pulse-upgrade' contract/src config deploy`
- `grep -rn -- 'token rotate' contract/src config deploy`
- `grep -rn -- 'pulse upgrade' contract/src config deploy`
- `grep -rn -- 'pulse logs' contract/src config deploy`
- `grep -rn -- 'PULSE_TEST_FAIL_READY' contract/src config deploy`

The new flags `--to`, `--follow`, `--location`, `--id` and `--yes` on these commands do not exist in `cli/args.ts` (lines 59–103 list every option). `--timeout` exists for `up` and keeps its meaning.

## Repository: deploy

Files:

- `common/services.yaml` (changed, only through `scripts/bump-images.sh`, decision 2)
- `cli/args.ts`, `cli/args.test.ts` (changed: `token`, `upgrade`, `logs`, HELP)
- `cli/main.ts`, `cli/main.test.ts` (changed: dispatch)
- `cli/docker.ts`, `cli/docker.test.ts` (changed: spawn options `input`, `stdinFd`, `stdoutFd`; ps rows with container `ID`)
- `cli/ready.ts`, `cli/ready.test.ts` (changed: `readyz` for a service or a container id)
- `cli/write-install.ts`, `cli/write-install.test.ts` (changed: use the extracted lock and atomic write)
- `cli/lock.ts`, `cli/lock.test.ts` (new: the shared `.pulse-init.lock`, moved from `write-install.ts`)
- `cli/safe-write.ts`, `cli/safe-write.test.ts` (new: atomic write with fsync, link and mode checks, moved from `write-install.ts`)
- `cli/api-call.ts`, `cli/api-call.test.ts` (new: `API_SCRIPT` and the in-container api call)
- `cli/token-rotate.ts`, `cli/token-rotate.test.ts` (new: selection, journal, rotation and switch)
- `cli/registry.ts`, `cli/registry.test.ts` (new: ghcr.io tags and digests)
- `cli/provenance.ts`, `cli/provenance.test.ts` (new: the `gh` preflight and verify)
- `cli/upgrade.ts`, `cli/upgrade.test.ts` (new: selection, preview, apply, snapshot and rollback)
- `cli/logs.ts`, `cli/logs.test.ts` (new)
- `cli/docs.test.ts` (changed: a section per command)
- `cli/test/fake-docker.ts` (changed: record `input`, fds and signals; container ids)
- `cli/test/rotate.sh` (new: `cli-rotate` body)
- `cli/test/upgrade.sh` (new: `cli-upgrade` body)
- `cli/test/pin-release.sh` (new: rewrites an install's pulse image lines, test only)
- `cli/test/fail-ready-docker/docker` (new: test-only pass-through shim, decision D2-A)
- `cli/test/stack.sh`, `cli/test/errors.sh` (changed: logs and refusal paths)
- `.github/workflows/ci.yml` (changed: jobs `cli-rotate` and `cli-upgrade`)
- `docs/cli.md`, `README.md`, `AGENTS.md` (changed)

Behavior change: yes

The change adds three CLI commands, bumps the image pins and adds CI jobs.

### Tool facts (verified in this run)

- **Bun.** Bun `1.4.0`: `package.json` line 9 (`engines`) and line 28 (`packageManager`). CI installs it with `oven-sh/setup-bun` `bun-version: 1.4.0` (`.github/workflows/ci.yml` lines 443–445, 461–462).
- **Scripts** (`package.json` lines 11–19):
  - `test` = `bun test --coverage cli` (line 13);
  - `lint` = `biome check . && pulse-eslint . && pulse-workflows` (line 14);
  - `typecheck` = `tsc --noEmit` through `typescript7` (line 12);
  - `build` = `bun build --compile --minify cli/main.ts --outfile dist/pulse` (line 16);
  - `check` = lint + typecheck + test (line 18).
- **Coverage** (`bunfig.toml` lines 1–3): `[test]` `coverageThreshold = { lines = 0.8, functions = 0 }`. `cli/test/**` is excluded from coverage.
- **Biome.** `@biomejs/biome` `2.6.3` (`package.json` line 21). `biome.json` extends `@lorenzh/pulse-config/biome.json` (line 2) and includes `cli/**` (line 5). It excludes `!.github`, `!*.md`, `!scripts` and the setup directories (lines 12–26). So the new `cli/*.ts` and `cli/test/*.ts` files are linted, and `cli/test/*.sh` is covered by shellcheck only.
- **pulse-config pin.** `@lorenzh/pulse-config` is pinned at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json` line 22). The CI job `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0…` (`ci.yml` lines 16–17). That pinned file (read with `gh api …?ref=04108fa…`) runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and `bun run test` (lines 25–38); build is off unless `inputs.build`, and deploy passes none. The pinned `check.yml` and `biome.json` are byte-equal to the config clone (`88996cb`, `diff -q`).
- **Shell lint.** The `lint` job runs shellcheck and `bash -n` on every tracked `*.sh` (`ci.yml` lines 34–37). The new scripts, including `cli/test/fail-ready-docker/docker` (start it with a bash shebang and add it to the shellcheck call when it has no `.sh` suffix, as `cli/test/stub-docker/docker` is handled today), must pass.
- **Existing jobs.** `cli-stack` (`ci.yml` lines 432–451) and `cli-errors` (lines 453–466) build the binary with `bun run build` and run the scripts. The new jobs follow the same shape.
- **gh.** It is not referenced in the repository today. The local check in this run used gh 2.103.3. The new jobs print `gh --version` as their first step, and the implementer confirms the five flags of decision 12 on the runner's `gh`.

### Reuse (extract before the second use)

- **Project guard.** `resolveProject` and `guarded` (`cli/docker.ts` lines 453–474, `cli/lifecycle.ts` lines 81–95) for every new command. Do not write a second guard.
- **Lock.** Move the lock (`cli/write-install.ts` lines 299–309 and 352–394) into `cli/lock.ts`, with its tests, and use it in `writeInstall`, rotation and upgrade.
- **Atomic write.** Move `atomicWrite` and the link and mode refusals (`cli/write-install.ts` lines 164–187 and 279–297) into `cli/safe-write.ts`. Add fsync of the file and the directory. Then use it in init, the rotation (secret files, journal) and the upgrade (`compose.yaml`, snapshot metadata).
- **Readiness.** Extend `readyz` and `waitReady` (`cli/ready.ts`) to target a container id. Use them for the new probe container, the console restart and the upgrade, not a second poller. The in-container equality check is a second constant script in `cli/api-call.ts`, next to `API_SCRIPT`.
- **Process rows.** `parsePs` (`cli/ready.ts` lines 18–46) gets `ID`. Container selection uses it.
- **Text safety.** `shown()` (`cli/args.ts` lines 140–152), `firstLine` and `maskUserInfo` (`cli/docker.ts` lines 104–114) for every external text. `tokenContentValid` (`cli/tokens.ts` lines 40–43) for the file check.
- **Pin shape.** `assertPin` and `PULSE_IMAGE` (`cli/services.ts` lines 36–48) are the image shape of decision 10. Export and reuse them; do not write a second regex.
- **Signals.** `processSignals` and the record-then-act pattern of `writeInstall` (`cli/write-install.ts` lines 50–71 and 366–399) for the critical sections.
- **Tests.**
  - `cli/test/fake-docker.ts` is the only fake spawn.
  - Registry and api answers in unit tests are literal fixtures.
  - Image refs in `cli/` tests use the fixture `example.invalid/fixture-svc:9.8.7` (`AGENTS.md` rule). A test that needs a pulse-shaped ref builds it at run time from parts, so no pin literal is in a file.
- **The `gh` call** is an argument array through the spawn seam (`gh` is a separate binary; `DockerMissing` handling becomes a generic "binary missing" with the binary name, which keeps exit 3 only for Docker).

### Checks

- `bun install --frozen-lockfile && bun run check`.
- `bun run build`, `bash cli/test/smoke.sh`, `bash cli/test/errors.sh dist/pulse`.
- `bash cli/test/stack.sh demo`, `bash cli/test/stack.sh full`, `bash cli/test/stack.sh minimal`.
- `bash cli/test/rotate.sh`.
- `GH_TOKEN=… bash cli/test/upgrade.sh`.
- Shellcheck and `bash -n` from the repository root.
- `scripts/check-setup.sh` and `scripts/bump-images.sh --verify` after the bump.
- The existing `minimal`, `full`, `demo` and `cli-stack` jobs on the new pins.

### CI

- **`cli-rotate`.** ubuntu-24.04, `timeout-minutes: 35`, checkout with `persist-credentials: false`, setup-bun 1.4.0, `bun install --frozen-lockfile`, `bun run build`, `bash cli/test/rotate.sh`. On failure, it prints `docker compose ps --all`. Teardown is `pulse down --volumes` in `always()`. It prints no secret.
- **`cli-upgrade`.** ubuntu-24.04, `timeout-minutes: 40`, job `permissions: {contents: read, attestations: read}`, `env: GH_TOKEN: ${{ github.token }}`. It runs `gh --version`, then the same build steps, then `bash cli/test/upgrade.sh`, with the same teardown.
- Update the CI paragraph and the Commands table of `AGENTS.md` with both jobs and scripts.

### Completion evidence

- The PR links both new job runs and the green existing jobs on the bumped pins.
- It quotes the gap table per location (largest difference in ms, baseline and rotation), the overlap deadline, the 401 checks, the rollback and success lines of the upgrade job, and the binary size before and after.
- It names the known limits: duplicate results during the handoff, the stack being down during an upgrade, post-snapshot writes lost on rollback, and the snapshot disk space.

## Breakdown notes

- Order the tasks so that the shared seams come first: lock, safe write, spawn options, `readyz` by container, `parsePs` ID, and the api call. Each command then builds on them.
- The pin bump can be its own first task. The existing CI jobs prove `0.1.1` on a fresh install.
- Suggested tasks:
  1. The seams.
  2. `pulse logs` with its stack and error checks.
  3. `pulse token rotate` with unit tests.
  4. `pulse upgrade` with registry, provenance and unit tests.
  5. The live scripts `rotate.sh`, `upgrade.sh`, `pin-release.sh` and the shim, the two CI jobs, and the docs.
- No task holds docs alone. Each command's docs section goes with its command task. The final task completes `README.md` and `AGENTS.md`.
