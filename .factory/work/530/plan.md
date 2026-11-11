# Spec #530: pulse CLI day-2 commands (token rotate, upgrade, logs)

## Goal

The `pulse` CLI of pulse-deploy (#529) gets three day-2 commands for an installation that `pulse init` wrote:

- `pulse token rotate <admin|probe>` rotates a token through the api's token store. Consumers switch to the new secret while the old one is still valid, and only the consumers that need the new secret restart. An interrupted run resumes from a journal.
- `pulse upgrade [--to <version>]` moves the installation's pinned pulse images to a newer release. It shows the change, verifies the provenance of every new image digest, applies the change with `--yes`, waits for readiness, and restores images and data if the new release does not become ready.
- `pulse logs [service] [--follow]` wraps `docker compose logs` for the guarded project.

The commands get docs, unit tests with failure injection, and live CI jobs.

## Sources

- The issue #530 and its comments. The owner decided **D1-A and D2-A** on 2026-11-11 and confirmed the assumption: `pulse upgrade` requires an installed, authenticated `gh`, and there is no flag to skip provenance. Release A is `0.1.0`. Release B is `0.1.1` of all five services, pinned with `scripts/bump-images.sh api=0.1.1 probe=0.1.1 status=0.1.1 notify=0.1.1 console=0.1.1`.
- The plan review of the first spec (issue comment "Factory ran spec/plan-review"). This version fixes its four defects:
  - resumable probe handoff and lost-response replacement (decisions 7 and 8);
  - a durable snapshot-complete boundary (decision 13);
  - fixed release fixtures A and B for the upgrade test, independent of the pins (acceptance 2);
  - a quantified performance section and the corrected count of extra samples.
- The second plan review (the later issue comment "Factory ran spec/plan-review"). This version fixes its two defects:
  - the replacement recovery boundary between the secret-file write and the journal write (decisions 7 and 8): secrets are now staged in a file named by their token id, the host file changes only by a rename after the journal says `staged`, and no revoke ever targets the token that authenticates the call;
  - the extra-sample statistic and its bound: the statistic is now the surplus over a minimum gap-keeping subset, the two-probe window W is measured from Docker events instead of being assumed, and the gates follow from a stated lemma (Counterexamples "Extra samples", Performance impact item 2).
- `.factory/work/530/issue-review.md`: open points 1–9 and the derived acceptance checks 1–9.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/530` answered `HTTP 404` in this run (2026-11-11). There are no findings, which is normal for a feature without children.
- Clones read in this run (all `main`):
  - deploy `d47d8b9` (also the head of `lorenzh/pulse-deploy` `main` on GitHub today): `cli/*.ts`, `cli/test/*`, `scripts/secrets-init.mjs`, `scripts/bump-images.sh`, `scripts/check-setup.sh`, `common/services.yaml`, `docs/cli.md`, `.github/workflows/ci.yml`, `package.json`, `biome.json`, `bunfig.toml`, `AGENTS.md`.
  - api `8959e04`, which is the commit of tag `v0.1.1`: `docs/operation.md`, `docs/rest-api.md` (Tokens), `docs/configuration.md` (Token import), `src/migrations.ts`, `src/token-store.ts`, `Dockerfile`, `bench/budgets.json`. `src/migrations.ts` at tag `v0.1.0` was read with `gh api repos/lorenzh/pulse-api/contents/src/migrations.ts?ref=v0.1.0`.
  - probe `92f55df` (= `v0.1.1`): `src/scheduler.ts` and `src/main.ts`.
  - console `b6c737d` (= `v0.1.1`): `src/admin-token.ts` and `src/token-read.ts`.
  - contract `baf6aec`: `src/schema.ts`.
  - config `88996cb`: `.github/workflows/release.yml`.
- Issue #692 (deploy) is still open in `build/implement` with `needs-input` today. It waits for the same release and may bump the pins first.
- Registry and provenance, checked on 2026-11-11:
  - Each of the five images has the stable tags `0.1.0` and `0.1.1` on ghcr.io and no other `x.y.z` tag (anonymous `tags/list`).
  - For each of the five `0.1.1` index digests, this passed (exit 0) with gh 2.103.3:
    `gh attestation verify oci://ghcr.io/lorenzh/pulse-<svc>@<digest> --repo lorenzh/pulse-<svc> --signer-workflow lorenzh/pulse-config/.github/workflows/release.yml --source-ref refs/tags/v0.1.1 --deny-self-hosted-runners`.
  - The same call for the api `0.1.1` digest with `--source-ref refs/tags/v0.1.0` exits 1. So `--source-ref` ties a version to its digest.

## Facts the spec builds on

1. **Token store in `0.1.1`.** api `v0.1.1` has the database token store.
   - Routes (`docs/rest-api.md` "Tokens", lines 502–529): `GET /admin/tokens`, `GET /admin/tokens/self`, `GET /admin/tokens/:id`, `POST /admin/tokens` (answers `201`), `POST /admin/tokens/:id/rotate` (answers `200`) and `POST /admin/tokens/:id/revoke` (answers `200`, line 515).
   - Rotate and create answer `{token, secret, previousValidUntil}`. The `secret` is `pulse_` followed by 43 base64url characters, 49 characters in total. It is shown only in that answer and cannot be read again (line 517).
   - `TokenCreateInput` is `{name, scopes, location?, expiresAt?}`. `name` is 1 to 100 characters without control characters, and `expiresAt` must be later than now (line 516).
   - The old secret stays valid for 10 minutes. A second rotate during the overlap answers `409`. Revoked or expired tokens also answer `409`. A revoke invalidates every secret of the token at once (line 520).
   - Grant rule: a caller may create, rotate or revoke a token only when it holds every scope of that token, where `probe` counts as `checks` (line 498). Last-admin rule: revoking the last active admin answers `409` (line 500).
   - Token ids are `tok_` and 24 lower-case hex characters (`src/token-store.ts` line 23).
   - The token files are imported once and ignored afterwards (`docs/configuration.md` "Token import", lines 233–241). An imported admin token gets `["read","checks","incidents","admin"]` (line 238), so it may create, rotate and revoke probe and admin tokens. Imported probe tokens are named `probe <location> #<n>`. The admin token keeps the name from `admin-tokens.json`, which `secrets-init.mjs` writes as `admin` (line 223).
   - Admin-side secrets need 32 or more characters (`docs/operation.md` lines 94–110). The CLI-generated ones have 64.
2. **Schema versions.** api `v0.1.0` reads tokens from files: its `src/migrations.ts` has three steps, so `SCHEMA_VERSION` is 3 (line 76 at tag `v0.1.0`). `v0.1.1` has nine steps (`SCHEMA_VERSION` 9, `src/migrations.ts` line 225). The version is the SQLite `PRAGMA user_version` (`src/db.ts` lines 101–102) of `/data/pulse.db` (`Dockerfile` line 9). An older api refuses a newer schema with exit 2 (`docs/operation.md` lines 33–36).
3. **Probe cadence and stop.**
   - The probe reads `PULSE_PROBE_TOKEN_FILE` once at start and becomes ready only after `GET /probe/checks` succeeds (`src/main.ts` lines 128–155 and 249–251).
   - The first run of each check starts after a random delay below `min(intervalMs, 1000)` ms (`src/scheduler.ts` lines 36–42). After that it runs once per interval from the previous start. The result `timestamp` is the start of the run (`src/check.ts` line 149). Consecutive results of one probe are therefore one interval plus the timer lateness apart.
   - On SIGTERM the probe aborts its in-flight requests, stops the scheduler and flushes queued results (`stop()`, `src/main.ts` lines 264–271). It starts no run after the signal.
   - `intervalMs` is any integer from 1 (`timerMs = intBetween(1, MAX_TIMER_MS)`, contract `src/schema.ts` line 89). Only domain checks have a higher minimum (1 hour, line 351).
   - The console reads its admin token file at start and needs at least 32 characters (`src/admin-token.ts`).
4. **How deploy hands out secrets.**
   - `secrets-init` (files mode) copies `secrets/admin-token` and `secrets/probe-token-<loc>` into the per-consumer volumes: owner 1000:1000, mode 0400, written atomically (`scripts/secrets-init.mjs` lines 162–204).
   - It also rewrites `api/tokens.json` and `api/admin-tokens.json`, which a token-store api ignores after the import.
   - The CLI's install renders `PULSE_PROBE_LOCATIONS` and `PULSE_SECRETS_ADMIN: "on"` (`cli/render-compose.ts` lines 101–118).
5. **How the CLI writes and runs Compose today.**
   - The generated `compose.yaml` writes every string double-quoted (`cli/yaml.ts` lines 1–5). Each pulse service has an `image: "ghcr.io/lorenzh/pulse-<svc>:<x.y.z>@sha256:<64 hex>"` copied from `common/services.yaml` (`cli/render-compose.ts` lines 90–99, `cli/services.ts` lines 36–48).
   - In full and demo the api port is not published (`cli/render-compose.ts` lines 156–158). Readiness already runs `docker compose exec -T <svc> bun -e <script>` inside the container (`cli/ready.ts` lines 48–77).
   - The spawn seam has stdin `ignore`, and an abort sends SIGKILL to the client process (`cli/docker.ts` lines 52–83). Killing a `docker run` client does not stop its container. `parsePs` reads `Service`, `State`, `Health`, `ExitCode` and `Image`, no `ID` (`cli/ready.ts` lines 18–46).
   - The only lock is `.pulse-init.lock`, held by `pulse init` (`cli/write-install.ts` lines 28 and 345–400).
6. **Pins today.** `common/services.yaml` pins all five pulse images to `0.1.0` (lines 8, 16, 25, 35 and 44). The deploy rule is that no other file holds a version or digest of a pinned image, also not a script, test or workflow (`AGENTS.md` "Rules", first bullet). `scripts/check-setup.sh` checks the shape of each pin (line 36).

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
- Automatic resume of an upgrade that was killed hard (SIGKILL, power loss). The next run refuses and the docs give the manual steps (decision 13).
- Changes to api, probe, console or any other service.

## Decisions

1. **Supported installations.** The commands work on directories with `pulse.json` format 1 written by `pulse init`. They reuse the guard of `up`, `down` and `status` (`resolveProject`, `cli/docker.ts` lines 453–474), with the same `--dir` default `.` and the same exit codes (0 ok, 1 failed, 2 usage, 3 Docker missing, 130 interrupted). No new metadata goes into `pulse.json`.
   - The standalone repository setups (`minimal/`, `full/`, `demo/`, `dev/` with `scripts/init-secrets.sh`) are out of scope. The standalone `demo/` generates its tokens inside volumes (`PULSE_SECRETS_MODE=generate`). The docs say so.
2. **Pins.** The deploy child bumps the pins with `scripts/bump-images.sh api=0.1.1 probe=0.1.1 status=0.1.1 notify=0.1.1 console=0.1.1`. If `main` already pins `0.1.1` or later when the task starts (for example after #692), it skips the bump and records that in the PR. No other file gets a version or digest. The upgrade test does not depend on the pins (acceptance 2).
3. **One mutation lock.** `pulse init`, `pulse token rotate` and `pulse upgrade --yes` share the existing lock file `.pulse-init.lock`. Its owner and nonce rules stay the same.
   - The name stays, so an older CLI's `init` still excludes a running rotation or upgrade.
   - The refusal text becomes `another pulse command is running in <dir> (or remove .pulse-init.lock if none is)`.
   - `up`, `down`, `status` and `logs` take no lock.
4. **Private transport to the api.** Every api call runs `docker compose <operation prefix> exec -T api bun -e <API_SCRIPT>`.
   - `API_SCRIPT` is a constant text. Its stdin carries one JSON line `{"method","path","bearer","body"}`.
   - The script calls `http://127.0.0.1:3000<path>` with a 10 s timeout and `redirect: "error"`. It prints the status code on line 1 and the body, capped at 1 MiB, after it.
   - No bearer, secret or digest of a secret is ever in argv, the environment, `compose.yaml`, the journal, a diagnostic or normal output.
   - The spawn seam gets an `input` option that writes the text to stdin and closes it. stdin stays `ignore` when `input` is absent.
5. **Capability detection.**
   - `GET /admin/tokens/self` with `secrets/admin-token` must answer `200` with an object whose `id` matches `^tok_[0-9a-f]{24}$` and whose `scopes` include `admin`.
   - `404` means an api without the token store. The CLI refuses with `the api has no token store (pulse-api 0.1.1 or later); run pulse upgrade first`.
   - `401`, `403` and `429` are named as such.
   - This check runs before any token changes. A resume runs it too, with the bearer that decision 8 names for the item's state.
6. **Which tokens `admin` and `probe` mean.**
   - `admin` is the token that `secrets/admin-token` authenticates as, so its id comes from `/admin/tokens/self`.
   - `probe` means every locally managed probe location. The locations are the comma list `PULSE_PROBE_LOCATIONS` of the `secrets-init` service in the resolved Compose configuration. Each location needs exactly one pulse.json service whose resolved `environment.PULSE_LOCATION` equals it (`probe` in minimal/full, `probe-<loc>` in demo) and a host file `secrets/probe-token-<loc>`. Anything else refuses.
   - A `secrets-init` whose `PULSE_SECRETS_MODE` is set and not `files` refuses.
   - For each location, the CLI reads `GET /admin/tokens`. The candidates are tokens whose `scopes` are exactly `["probe"]`, whose `location` equals the location, with `revokedAt` null and `expiresAt` null or in the future.
     - Exactly one candidate is used.
     - None refuses.
     - Several candidates refuse and list each candidate's `id` and name (the name through `shown()`), unless `--location <loc> --id <tok_…>` selects one.
     - A candidate whose `previousValidUntil` is in the future refuses: `token <id> is still in its rotation overlap until <ISO time>; run again after it`. The exception is a resume from the journal (decision 8).
   - Every refusal happens before the first api write. Rotation keeps the id, scopes, location and expiry. It never revokes and recreates the token, except for the lost answer of decision 8.
7. **Order of one rotation item.** For one token, with consumer service C (admin: `console` when present, else none; probe: the location's probe service). Each step writes its journal state (decision 8) before its first side effect, so a rerun knows where it stopped.
   1. **Preflight of the whole command.** Lock, guard, file checks (decision 9), capability, the token and candidate selection for every item, and every consumer service running and ready with exactly one container. For a probe item, the id of that one container (`docker compose ps --all --no-trunc --format json`, field `ID`) is recorded as `oldContainerId`. Only then does the first api write go out.
   2. **Rotate.** Journal `requested` (token id and its `rotatedAt` as read in the preflight), then `POST /admin/tokens/<id>/rotate`.
   3. **Stage and save.** The host file changes only through a rename, and only after the journal names the token whose secret it gets:
      1. **Stage.** Write the received `secret` and a newline to the staging file `secrets/.pulse-next.<file>.<id>`. `<file>` is the host file name (`admin-token` or `probe-token-<loc>`) and `<id>` is the id of the token that the answer belongs to: `tokenId` after a rotate, the created id after a create. The write is the safe write (temp name `.<name>.tmp-<hex>` `wx` 0600 in `secrets/`, the `atomicWrite` pattern of `cli/write-install.ts` lines 279–296, then fsync, rename to the staging name, fsync of the directory).
      2. Journal `staged` with `activeTokenId := <id>`.
      3. **Install.** Rename the staging file over the host file and fsync the directory.
      4. Journal `saved`.
      - So the journal state alone says what the host file holds: in `requested` and `replacing` it holds the pre-rotation secret of `tokenId`; from `saved` on it holds the secret of `activeTokenId`. In `staged`, the existence of the staging file says whether step 3 ran (a rename is atomic, and nothing else removes a staging file). Decision 8 "Reconcile" uses exactly this.
   4. **Refresh.** Journal `refreshing`, then `docker compose <prefix> run --rm --no-deps -T secrets-init` must exit 0. Then journal `refreshed`.
   5. **Switch.**
      - **Probe**, start-new-then-stop-old:
        1. Journal `handoff` with `oldContainerId` and `newContainerId: null`.
        2. `docker compose <prefix> up -d --no-deps --no-recreate --scale <svc>=2 <svc>`.
        3. The new container is the one container of the service whose id is not `oldContainerId`. Journal `handoff` with its id as `newContainerId`.
        4. Wait (bounded by `--timeout`, default 120 s) until the new container answers `/readyz` 200 through `docker exec -i <id> bun -e <script>`.
        5. Check that its `/run/pulse/probe-token` equals the new secret. The check runs inside the container, the expected secret goes in on stdin, the script compares with `timingSafeEqual`, and it prints only `same` or `different`. The check has a 10 s kill bound.
        6. Keep the old container running for 2000 ms more. The new probe's first run starts within 1000 ms of its scheduler start (fact 3), so its first result is earlier than the old probe's stop.
        7. `docker stop --time 10 <old id>`, then `docker rm <old id>`.
        8. Afterwards the service has exactly one container, `newContainerId`.
      - **Admin**:
        1. Check that the new secret answers `GET /admin/tokens/self` `200` with `activeTokenId`.
        2. When the console exists: journal `handoff`, then `docker compose <prefix> up -d --no-deps --force-recreate console`, then wait for its readiness (reuse `waitReady` with that one service).
        3. Run the same in-container equality check on `/run/pulse/admin-token`. Then let the console container read its own file and call `GET http://api:3000/admin/tokens/self`. It must answer `200` with `activeTokenId`.
   6. **Revoke (only after a replacement, decision 8).** Journal `revoking`, then `POST /admin/tokens/<revokeTokenId>/revoke` with the new secret of the host file as bearer for `admin` and the admin secret for `probe`. The revoke guard (decision 8) runs first. The step is done when the answer is `200`, or when any other answer is followed by `GET /admin/tokens/<revokeTokenId>` showing a non-null `revokedAt`.
   7. **Done.** Journal `done`, and print `rotated <admin|probe <loc>> token <activeTokenId>; two probes ran for <ms> ms; the old secret works until <previousValidUntil ISO>` (the middle part only for a probe). `<ms>` is the two-probe window W of Performance impact item 2 as Docker records it: `State.FinishedAt` of the old container minus `State.StartedAt` of the new one, both read with `docker inspect` after `docker stop` and before `docker rm`. On a resume where the old container is already gone, the part reads `two probes ran for an unknown time`.
   - API, status and notify never restart for either kind. The probes do not restart for `admin`. The console does not restart for `probe`.
   - Probe locations rotate one after another, so at most one extra probe container runs at a time.
   - The command returns after the switch. It does not wait for the 10-minute overlap: expiry is the api's job.
8. **Journal and recovery.**
   - **File.** `secrets/.pulse-rotation.json` (0600, written atomically with fsync like the secret files) holds `{format:1, kind, items:[…]}`. Each item has `tokenId`, `location?`, `file`, `service?`, `name`, `scopes`, `expiresAt`, `rotatedAtBefore`, `oldContainerId?`, `newContainerId?`, `activeTokenId?`, `revokeTokenId?`, `replacementName?` and `state`. It never holds a secret. Token ids must match `^tok_[0-9a-f]{24}$`, container ids `^[0-9a-f]{64}$`, and `state` one of the states below; a journal that breaks a rule refuses with its path and the rule. The file is removed when every item is `done`.
   - **Staging files.** `secrets/.pulse-next.<file>.<id>` (decision 7 step 3) hold one secret each, never in the journal. The name must match `^\.pulse-next\.(admin-token|probe-token-[a-z0-9][a-z0-9-]{0,31})\.(tok_[0-9a-f]{24})$`. Items run one after another, so at most one staging file exists, and only for the item that is in `requested`, `replacing` or `staged`.
   - **States**, in order: `requested` → (`replacing` →) `staged` → `saved` → `refreshing` → `refreshed` → `handoff` → `switched` → (`revoking` →) `done`. Every state is written and fsynced before the side effect that it names. A state never moves back; in particular an item never returns to `replacing` once it was `staged`.
   - **Reconcile (first step of every resume, before any api write and before any bearer is read from a host file).** Its only api call is the read-only confirmation in the `replacing` row.
     1. Delete every leftover safe-write temp file in `secrets/` whose name is `.<name>.tmp-<hex>` for a host file, a staging file or the journal. Its content counts as not stored.
     2. List the staging files and act on the table. A staging file that the table does not allow refuses with exit 1, its path, and `docs/cli.md#token-recovery`; nothing is changed.

        | Journal state of the item | Staging file | Meaning | Action |
        | --- | --- | --- | --- |
        | `requested` | `.<file>.<tokenId>` | the rotate answer was stored, the `staged` write was lost | journal `staged` with `activeTokenId := tokenId`, then install and journal `saved` |
        | `replacing` | `.<file>.<X>`, X ≠ `tokenId`, and the api confirms X: for `admin`, `GET /admin/tokens/self` with the staged secret answers id X and name `replacementName` (this works also after the old secret's overlap); for `probe`, `GET /admin/tokens/<X>` with the admin secret shows name `replacementName` and `revokedAt` null | the create answer was stored, the `staged` write was lost | journal `staged` with `activeTokenId := X`, then install and journal `saved` |
        | `requested`, `replacing` | none | no answer was stored | the rules below (`rotatedAt` check, lost answer) |
        | `staged` | `.<file>.<activeTokenId>` | the install did not run | install, journal `saved` |
        | `staged` | none | the install ran, the `saved` write was lost | journal `saved` |
        | `saved` or a later state | none | normal | nothing; resume by state |
        | any state | a staging file that matches no row above (another id, another file, a second staging file, or any staging file from `saved` on) | inconsistent | refuse |

     - Only after the reconcile does the CLI read a bearer from a host file. The host file then holds what the state says (decision 7 step 3).
   - **Resume.** A rerun with a journal skips the overlap refusal for the items it names, rereads every item from the api, and resumes each item by its state:
     - `requested`: read `GET /admin/tokens/<tokenId>`.
       - If `rotatedAt` still equals `rotatedAtBefore`, the `POST` had no effect. Rotate as normal.
       - If it changed, the answer was lost. Go to `replacing`.
     - `replacing`: see "Lost answer" below.
     - `staged`: handled completely by the reconcile; the item continues as `saved`.
     - `saved`, `refreshing`: run the refresh again (it is idempotent), then switch.
     - `refreshed`: switch.
     - `handoff` (probe): look at the containers of the service with `docker compose <prefix> ps --all --no-trunc --format json` and act on what is there. "Running" is `State` `running`.
       | Containers found | Action |
       | --- | --- |
       | only `oldContainerId`, running | scale to 2 as in step 5.2 |
       | `oldContainerId` running and exactly one other container X | `newContainerId` := X (journal), then continue at step 5.4 |
       | `newContainerId` running, `oldContainerId` stopped or gone | continue at step 5.4, skip the 2000 ms wait, then remove `oldContainerId` if it still exists |
       | `newContainerId` recorded but gone or not running, `oldContainerId` running | `docker rm -f` the recorded new id if it exists, journal `newContainerId: null`, scale to 2 again |
       | no running container of the service | `docker compose <prefix> up -d --no-deps <svc>`, take the one container as `newContainerId`, continue at step 5.4 (results stop until it is ready; the docs say so) |
       | more than one container other than `oldContainerId` | refuse with exit 1, list the ids, and point to `docs/cli.md#token-recovery` (remove the extra containers, run again) |
       - A `different` token in the new container stops and removes that container and runs the refresh once more. A second `different` exits 1 with the journal kept.
     - `handoff` (admin): run step 5 of admin again (the console recreate is idempotent).
     - `switched`: go to `revoking` when `revokeTokenId` is set, else `done`.
     - `revoking`: step 6 again.
   - **Lost answer.** It applies on resume (state `requested` with a changed `rotatedAt` and no staging file) and inside the first run when the rotate `POST` ends without a parsed `200` (timeout, broken pipe, no JSON) or the staging write fails. A secret that is not in a staging file counts as lost, and a rotate `POST` is never repeated blindly.
     1. Journal `replacing` with `revokeTokenId := tokenId` and `replacementName`: the old name cut to 90 characters, a space, `r` and 6 random hex characters. The journal holds the name before the create, so a lost create answer can be found again.
     2. Look for orphans: tokens whose `name` equals `replacementName` and whose `revokedAt` is null. This step runs only in state `replacing` after the reconcile found no staging file. In that state no host file and no staging file holds a replacement's secret (decision 7 step 3), so every orphan is a replacement whose secret nobody holds. Revoke each of them, each through the revoke guard.
     3. `POST /admin/tokens` with `{name: replacementName, scopes, location?, expiresAt?}` of the lost token. For `admin` the bearer is the host file, which in `replacing` still holds the pre-rotation secret of `tokenId` (valid until the lost rotate's `previousValidUntil`). For `probe` it is the admin secret. If this answer is lost too, steps 2 and 3 run once more in the same run, and then the CLI exits 1 with the journal kept.
     4. Stage and save as in decision 7 step 3 with the created id, then refresh and switch, then step 6 revokes `revokeTokenId`.
     5. Print `the rotate answer was lost; replaced token <revokeTokenId> with <activeTokenId>`.
     - Revoking the lost admin is not refused by the last-admin rule, because the replacement is active by then.
     - For `admin` in state `replacing` after the old secret's `previousValidUntil`, the CLI cannot authenticate. It exits 1 and names the recovery in the docs: another admin token, or a database backup.
   - **Revoke guard.** Before every revoke (orphans in step 2, `revokeTokenId` in step 6), the CLI calls `GET /admin/tokens/self` with the bearer it is about to use. It refuses, exit 1 with the journal kept and `refusing to revoke the token that authenticates this call (<id>); see docs/cli.md#token-recovery`, when the answered id equals the target. It also never revokes `activeTokenId`. The api allows a token to revoke itself while another admin is active (Grant and Last-admin rules, api `docs/rest-api.md` lines 498–500), so only the CLI can prevent it.
   - **Interrupt.** SIGINT and SIGTERM are recorded and acted on only at the next step boundary. From writing `requested`, `replacing` or `revoking` until the api answer is handled, staged, installed and the next state after it (`saved`, or the next state after a revoke) is written, the signal waits. The CLI then exits 130 with `interrupted; run pulse token rotate <kind> again to finish`. The journal stays. A hard kill inside this section is covered by the reconcile.
   - While the journal exists, a plain run without it is impossible: `pulse token rotate` always resumes it first, and `pulse upgrade --yes` refuses.
9. **File checks for rotation.**
   - `secrets/` must be a directory, not a link, and no wider than 0700.
   - Each target file, staging file and the journal must be a regular file, not a link, with no group or other bits. Each target file and staging file must hold a valid token (`tokenContentValid`, `cli/tokens.ts` lines 40–43).
   - `secrets-init` reads only the named files `/in/admin-token` and `/in/probe-token-<loc>` (`scripts/secrets-init.mjs` lines 179 and 186; it never lists the directory), so a staging file in the bound `secrets/` directory is never copied to a consumer.
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
13. **Upgrade apply (`--yes`), the snapshot boundary and the rollback.**
    - **States** of `upgrade.json`: `snapshotting` → `applying` → `done`; or `snapshotting` → `aborted`; or `applying` → `rolling-back` → `rolled-back` | `rollback-failed`. Each state is written atomically with fsync of the file and the directory, before the step it names.
    - **Steps.**
      1. Preflight: lock, guard, no rotation journal, and no snapshot directory under `.pulse-upgrade/` whose `upgrade.json` is `snapshotting`, `applying`, `rolling-back` or `rollback-failed` (a directory without a readable `upgrade.json` counts as `snapshotting`). A refusal names that directory and `docs/cli.md#upgrade-recovery`.
      2. Selection and provenance, then a table of service, from version and 12-hex digest, to version and 12-hex digest, and `provenance verified`. Without `--yes`, print `run pulse upgrade --yes` (with the same `--to`) and exit 0 here. A preview writes no file and changes no container.
      3. `docker pull <ref>@<digest>` for every new image. A failure or an interrupt exits 1 or 130, and nothing is stopped.
      4. Create `.pulse-upgrade/<UTC stamp>-<6 hex>/` (0700, `mkdir` that fails if it exists). Write `upgrade.json` `{format:1, from:{svc:ref}, to:{svc:ref}, composeSha256, state:"snapshotting"}`. Print the start time; the downtime starts at the next step.
      5. `docker compose <prefix> stop`.
      6. For each declared top-level volume whose key ends in `-data` (`api-data`, `notify-data`, `console-data`):
         - Open `<key>.tar.part` (0600, `wx`) and give its fd to the spawn as stdout of `docker run --rm --name <project>-pulse-snapshot-<6 hex> --network none --user 0:0 --cap-drop ALL --cap-add DAC_OVERRIDE --security-opt no-new-privileges:true -v <project>_<key>:/from:ro <image of secrets-init from the resolved config> tar -C /from -cf - .`.
         - The helper must exit 0. Then fsync the file, compute its size and sha256, rename it to `<key>.tar`, and fsync the directory.
      7. Copy `compose.yaml` to `compose.yaml` in the snapshot (0600, fsync). Its sha256 must equal `composeSha256`.
      8. **Snapshot-complete boundary.** Write `upgrade.json` with `state:"applying"` and `tars:{<key>:{bytes, sha256}}`. The snapshot is complete only after this rename and the directory fsync. Print `snapshot <bytes> bytes in <ms> ms`.
      9. Edit `compose.yaml`:
         - Replace each old image string with the new one. The count of replacements must equal the number of services that used it.
         - Parse the new text again and check that it equals the old model with only those `image` values changed.
         - Write atomically with the old mode.
      10. `docker compose <prefix> up -d`, then `waitReady` with `--timeout` (default 300 s, 1–3600).
      11. On success: `upgrade.json` `done`, print `upgraded; the stack was down for <ms> ms; snapshot kept in <dir>`. The snapshot is the only way back to the older version. Exit 0.
    - **Abort before the boundary** (a failure or an interrupt in steps 4–8 before the `applying` rename):
      1. A running helper is ended with `docker rm -f <helper name>` and waited for. Killing only the `docker run` client is not enough (fact 5).
      2. Every `*.tar.part` and `*.tar` file in the snapshot directory is deleted.
      3. `compose.yaml` was not edited. Its sha256 must still equal `composeSha256`; if not, it is restored from the snapshot copy when that copy is complete, else the run goes to `rollback-failed`.
      4. `upgrade.json` becomes `aborted`. No volume is touched: no restore helper runs.
      5. `docker compose <prefix> up -d`, then `waitReady`. Print `upgrade aborted before the switch: <reason>; the previous images were started again`. Exit 1, or 130 after an interrupt.
    - **Rollback after the boundary** (a failed edit, a failed `up`, a failed one-shot, a timeout or an interrupt from step 9 on):
      1. `upgrade.json` `rolling-back`, then `docker compose <prefix> stop`.
      2. Verify every tar against `tars` (size and sha256) and the snapshot `compose.yaml` against `composeSha256` before any volume is changed. A mismatch restores nothing and goes to `rollback-failed`.
      3. For each tar: `docker run --rm -i --name <project>-pulse-restore-<6 hex> --network none --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --security-opt no-new-privileges:true -v <project>_<key>:/to <same image> sh -c 'find /to -mindepth 1 -delete && tar -C /to -xpf -'`, with the tar fd as stdin. It must exit 0.
      4. Restore `compose.yaml` atomically from the snapshot copy.
      5. `up -d`, then `waitReady` with the same timeout.
      - If the rollback is ready: state `rolled-back`, print `upgrade failed: <reason>; rolled back to the previous images and data; ready`, exit 1 (130 when an interrupt started it).
      - Otherwise: state `rollback-failed`, print `upgrade failed and the rollback failed: <reason>; snapshot in <dir>; see docs/cli.md#upgrade-recovery`, exit 1 (130 when an interrupt started it).
      - Signals during the rollback are recorded, not acted on. The rollback is bounded by its timeouts.
    - **Hard kill.** A run killed without a chance to act leaves `snapshotting`, `applying` or `rolling-back`. The next `upgrade --yes` refuses (step 1). `docs/cli.md#upgrade-recovery` gives the manual steps per state:
      - `snapshotting`: `compose.yaml` and the data volumes are unchanged. Remove the directory and run `pulse up`.
      - `applying`, `rolling-back`: the snapshot is complete. The docs give the restore commands of the rollback for each tar and for `compose.yaml`, then `pulse up`.
    - Data volumes are never deleted outside the restore. The `*-secrets` volumes are not in the snapshot: `secrets-init` rewrites them from `secrets/` at each start.
    - **Rollback boundary, as stated in the docs.**
      - The stack is down from step 5 until ready, so there are no results during an upgrade.
      - A rollback loses every write after the snapshot.
      - The snapshot needs free disk space for one copy of the data volumes. A full disk fails the snapshot before the boundary, which starts the old images again with untouched data.
      - The data restore is what makes a rollback across schema steps (api 3 → 9, console migrations) possible. Restoring the pins alone does not: api `0.1.0` refuses schema 9.
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
- With a journal, `<kind>` must equal the journal's kind and `--location`/`--id` must be absent or name a journal item; otherwise exit 2 with `a rotation of <kind> is unfinished; run pulse token rotate <kind>`.
- Output: one line per item and the overlap deadline. No secret, no secret digest, no bearer.
- Works in every setup with the token-store api, `dev` included.

### `pulse upgrade [--dir <dir>] [--to <x.y.z>] [--yes] [--timeout <s>]`

- Decisions 10–13 apply.

### `pulse logs [--dir <dir>] [--follow] [<service>]`

- Decision 14 applies.

### Help and docs

- `HELP` gets `token`, `upgrade` and `logs`. `pulse --help` lists them. `COMMANDS` includes `token`, `upgrade` and `logs`; `token` takes the sub-word `rotate`.
- `docs/cli.md` gets one section per command (`## pulse token rotate`, `## pulse upgrade`, `## pulse logs`), `### Token recovery` and `### Upgrade recovery`. It replaces the manual rotation bullets under "Tokens", updates the pin text (`0.1.0` → the pinned release), gives the manual Compose equivalents for each command, and states the known limits of the Performance impact section.
- `### Token recovery` explains the journal states, the staging files `secrets/.pulse-next.*` (they hold a secret; never delete one by hand while a journal exists, rerun the command instead), the refusals of the reconcile table and the revoke guard, extra probe containers, and the admin case after the overlap.

## Risks

- **Compose `--scale` behavior.** The live test proves the start-new-then-stop-old handoff. That includes one container per probe service afterwards, and `pulse up` and `pulse status` working after the rotation. If Compose renumbers or recreates the container in a way that breaks this, the implementer requests a hold and does not fall back to stop-then-start, which breaks the gap rule (see Counterexamples).
- **Extra samples.** During the handoff two probe containers post for the same location for the window W. The doubled runs per check are at most `floor(W / (I − e)) + 1` (Performance impact item 2): 2 at 5000 ms and 7 at 1000 ms for W = 6000 ms, and about W at the 1 ms minimum. It is documented as a known limit with the formula.
- **Interrupted rotation outside the overlap.** If a person does not rerun an interrupted rotation within the 10-minute overlap, a still-running old probe gets 401 and logs errors until the rerun removes it. The new probe keeps posting. The docs say to rerun at once.
- **0.1.0 → 0.1.1 upgrade needing manual steps.** If the live upgrade test shows a required config change, the implementer requests a hold. The upgrade must not grow config migrations.
- **#692 bumping the pins at the same time.** Decision 2 covers it.
- **`gh` on the runner.** GitHub-hosted runners ship `gh`. The job prints `gh --version` first and passes `GH_TOKEN: ${{ github.token }}`, with job permissions `contents: read` and `attestations: read`.
- **Overlap length in CI.** The rotation job waits for the real 10-minute overlap. The production overlap is not shortened.
- **New stable releases on ghcr.io.** The upgrade test picks its release pair by position (the two lowest stable tags), so later releases do not change it. Deleting tag `0.1.0` or `0.1.1` would break the test; that is intended.

## Acceptance evidence

Each check names where its expected value comes from.

1. **`cli-rotate` CI job** (`bash cli/test/rotate.sh`, binary from `bun run build`). It runs on a fresh `pulse init --setup demo --yes`, `pulse up`, with the pinned release (token store).
   - **Precondition.** `GET /checks` (through the api container) reports `always-healthy` with `intervalMs` 5000 (literal), and `GET /locations` reports exactly `eu` and `us` (literals).
   - **Baseline.** 60 s of results. Per location, the gap rule holds and the extra-sample count E is 0 (literal; Counterexamples, "Gap rule" and "Extra samples": one probe always gives 0).
   - **Docker events, an independent clock source.** Before T0 the test records the id of each probe service's one container (`docker compose ps --no-trunc --format json`), then starts `docker events --since <T0 − 5 s> --filter type=container --filter event=start --filter event=die --format '{{json .}}'` in the background into a file, and ends it after T1. For each probe service (event attribute `com.docker.compose.service`): T_s is the `timeNano` of the `start` event of the container that is not the recorded old one, T_d the `timeNano` of the `die` event of the old one, both in ms, and W = T_d − T_s. Result timestamps are `Date.now()` in the probe container, which reads the same host clock as the Docker daemon.
   - **Probe rotation.** The old secrets are copied into a private 0700 temp directory. Then `pulse token rotate probe` runs between host times T0 and T1 and must exit 0, and:
     - Its stdout and stderr contain none of the old or new secrets (`grep -F` against the files).
     - `secrets/probe-token-eu` and `-us` differ from the old copies. Each has mode 0600, starts with `pulse_` and is 49 characters long (literals from the api docs).
     - Inside each probe container, `/run/pulse/probe-token` equals the host file. The comparison runs in the container and prints only `same`.
     - The containers of api, status, notify, console, mailpit, demo-targets and demo-tls keep their ids and `StartedAt`.
     - `docker compose ps --all` shows exactly 1 container (literal) per probe service, and `secrets/.pulse-rotation.json` does not exist.
     - Per probe service, the events show exactly 1 `start` of a new container and exactly 1 `die` of the old one (literals), and 0 < W ≤ 20000 ms. The literal 20000 is the sum of generous limits for the steps in W (start and readiness 8 s against the probe's `startup_wall_ms` budget of 1027 ms, equality check 2 s, the fixed 2000 ms wait, stop 8 s); a CLI that keeps two probes up longer, for example until the overlap ends, fails it.
     - Per location over [T0 − 30000, T1 + 30000] ms: the gap rule holds, and E ≤ 2·floor(W / 4900) + 3. The constants are literals: 4900 is I − e with I = 5000 and e = 100 (Counterexamples "Extra samples", lemma bound 2). With W = 6000 the bound is 5.
     - Per location over [T_d, T1 + 30000] ms: E = 0 (literal). Only the new probe can post after T_d, and one probe always gives 0 (lemma part 1), so a second probe that keeps posting after the handoff fails this check. The window holds at least 5 samples (literal), or the check fails.
     - The PR quotes, per location, W from the events, the CLI's `two probes ran for <ms> ms`, and E.
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
   - **Interrupted handoff and resume.** After the overlap, `pulse token rotate probe --location eu` runs in the background. The test polls the journal until the eu item is `handoff` with a non-null `newContainerId`, then sends SIGINT. The expected values are literals:
     - The run exits 130, and the journal exists with that item in `handoff`.
     - A second `pulse token rotate probe` (no flags) exits 0 and does not refuse for the overlap. It sends no second rotate: `GET /admin/tokens/<id>` shows the same `rotatedAt` before and after the resume.
     - Afterwards `probe-eu` has exactly 1 container, its id is the journal's `newContainerId` read before the resume, its `/run/pulse/probe-token` is `same` as the host file, and the journal is gone.
     - The gap rule holds for eu over the window from the background start − 30000 ms to the resume end + 30000 ms.
     - With the same Docker-event recording around this case, E = 0 (literal) for eu over [T_d, resume end + 30000] ms, where T_d is the `die` event of the pre-rotation eu container.
   - **Persistence.** `pulse down && pulse up` exits 0, and each probe's `/run/pulse/probe-token` equals its host file again.
2. **`cli-upgrade` CI job** (`bash cli/test/upgrade.sh`).
   - **Release fixtures, independent of the pins and of the CLI.** The test reads the tags of each of the five images from ghcr.io with curl and jq. Release A is the lowest stable `x.y.z` tag and release B the next higher stable tag. The test requires A and B to be the same for all five images. The digests come from `HEAD …/manifests/<tag>` with curl. The script holds no version or digest literal (deploy `AGENTS.md` pin rule); the owner's decision names the expected pair (A = `0.1.0`, B = `0.1.1`), and the test prints it for the PR.
   - **Migration fixtures (literals from api `src/migrations.ts` at `v0.1.0` and `v0.1.1`, fact 2).** "Schema of the api" means `PRAGMA user_version` of `/data/pulse.db`, read inside the api container with `bun:sqlite` read-only.
     - On A: schema 3 and `GET /admin/tokens/self` answers 404.
     - On B: schema 9 and the same call answers 200.
     - These literals make the test fail if the pair is not "without token store, then with it", whatever `common/services.yaml` pins.
   - **Install release A.** `pulse init --setup demo --yes`. The test helper `cli/test/pin-release.sh <dir> <svc>=<version>@<digest> …` rewrites the five pulse image lines to release A. Then `pulse up`, results flowing, and the A migration fixture holds.
   - **Legacy refusal.** On A, `pulse token rotate probe` exits 1 with `has no token store` and every secret file's sha256 is unchanged.
   - **Preview.** `pulse upgrade --to <B>` exits 0 and lists every service A → B with B's registry digest (12 hex). The sha256 of `compose.yaml` and the container ids are unchanged, and `.pulse-upgrade/` does not exist.
   - **Interrupted snapshot.** With `cli/test/fail-ready-docker` first on PATH and `PULSE_TEST_HOLD_SNAPSHOT=1` (the shim sleeps 20 s inside each snapshot `tar -cf` run), `pulse upgrade --yes --to <B>` runs in the background. When the first `*.tar.part` exists, the test sends SIGINT. Then:
     - The run exits 130 and prints `upgrade aborted before the switch`.
     - `upgrade.json` is `aborted`, and the snapshot directory has no `*.tar.part` and no `*.tar`.
     - `compose.yaml`'s sha256 equals the pre-upgrade sha256, and no `docker ps --all` row has the name `*-pulse-snapshot-*` or `*-pulse-restore-*`.
     - `pulse status` exits 0 and the A migration fixture holds (schema 3, 404).
   - **Broken B.** With the shim first on PATH, `PULSE_TEST_FAIL_READY_SERVICE=console` and `PULSE_TEST_FAIL_READY_TAG=<B>`, `pulse upgrade --yes --to <B> --timeout 120` exits 1 with `rolled back to the previous images and data; ready`. Then:
     - `compose.yaml`'s sha256 equals the pre-upgrade sha256.
     - Every running pulse container's image is the A digest (`docker compose ps --format json`).
     - `pulse status` exits 0.
     - The A migration fixture holds: schema 3. The api migrated to 9 during the failed upgrade, so 3 proves the data restore.
     - `always-healthy` has a result older than the upgrade start, and a new result within 60 s after the rollback.
   - **Real B.** `pulse upgrade --yes --to <B>` exits 0. Then:
     - The running images are the B digests from the registry.
     - The B migration fixture holds (schema 9, 200).
     - `pulse status` exits 0.
     - `installId`, `secrets/*` sha256 and the `.env` sha256 are unchanged.
     - `always-healthy` still has a result older than the first upgrade start.
     - `pulse token rotate probe` now passes the capability check: it exits 0.
3. **Unit tests** (`bun run test`, coverage threshold from `bunfig.toml`). They cover every rule in Counterexamples, with literal inputs and expected values. Two failure-injection matrices are required:
   - **Rotation.** A fake api and `cli/test/fake-docker.ts` stop the run (simulated SIGINT, and separately a thrown spawn error) at every journal state of decision 8 for one probe and one admin item, plus a lost rotate answer and a lost create answer. Each case then reruns to the end, and asserts: exactly one rotate `POST` per token, at most one active replacement, every orphan and the lost token revoked, exactly one container of the service, the host secret equal to the container secret, and no journal left.
   - **Stage boundary.** For the rotate path and the replacement (create) path, each for `admin` and `probe`, a failing file seam (a thrown error, and separately a simulated hard kill that ends the run without cleanup) stops the run at each of these points: the staging temp write, the rename to the staging name, the `staged` journal write, the install rename, and the `saved` journal write. The rerun goes to the end. The fake api models the real auth rules: a revoked token's secrets answer `401`, a token may revoke itself, and the last-admin rule. Each case asserts:
     - no revoke call targets `activeTokenId` or the token that authenticates the call, and no api call answers `401`;
     - for the item, exactly one active token with the item's scopes and location remains: the one whose secret the host file holds (the fake api maps secrets to ids);
     - no staging file, no temp file and no journal is left;
     - exactly one rotate `POST` and at most one replacement whose secret was stored.
     - The case of the second plan review is one of them: a replacement admin secret installed, the `saved` write failing. The rerun must journal `saved`, keep the replacement and revoke only `revokeTokenId`.
   - **Upgrade.** Fake docker stops the run during each of the three archive writes, during the `compose.yaml` copy, just before and just after the `applying` write, during the edit and during `waitReady`. Before the boundary: no restore helper spawn, `compose.yaml` byte-equal, no tar left, state `aborted`, `up -d` called. After it: the rollback order of Counterexamples "Rollback".
4. **`cli-stack`** (demo, full, minimal) adds the logs checks:
   - `pulse logs secrets-init` is byte-equal to `docker compose <prefix> logs secrets-init`. A completed one-shot has fixed logs.
   - `pulse logs --follow api`, sent SIGINT after 3 s, exits 130, and `pgrep -f 'compose.*logs'` finds no process.
   - `pulse logs nosuch` exits 1, and `pulse logs 'a b'` exits 2.
5. **`cli-errors`** adds `logs`, `upgrade` and `token rotate` with the stub docker. Docker missing exits 3, and each refuses before any other call.
6. **Docs check.** `cli/docs.test.ts` asserts that `docs/cli.md` has a `## pulse <name>` heading for every entry of `COMMANDS`. The list in `args.ts` is the independent source for the docs file.

## Performance impact

**api `bench/budgets.json` metrics: none expected.** No service code changes. The file (api `8959e04`) has the targets `api`, `config`, `contract`, `kit`, `notify`, `probe` and `status`, and no deploy entry. The pin bump runs releases whose numbers are measured in their own repositories.

The commands do have runtime costs on an installation. They are not in `bench/budgets.json`, so they are reported, not gated. Each one has a bound and a measurement:

1. **Second probe during a probe rotation.**
   - What: one extra probe container per location for the two-probe window W. W runs from the Docker start of the new container (`State.StartedAt`, the `start` event) to the Docker end of the old one (`State.FinishedAt`, the `die` event). It holds the new probe's start, its first runs, the CLI's readiness polls, the equality check, the fixed 2000 ms wait and the old probe's stop. Locations rotate one after another, so at most one extra probe runs at a time.
   - Size, from the probe budgets in api `bench/budgets.json` (lines 121–157): up to `peak_rss_mib` 83 MiB extra memory, `startup_cpu_ms` 377 ms extra CPU, and `startup_wall_ms` 1027 ms of start.
   - W has no bound from the probe alone. Expected: 4–8 s. Upper bound by construction: `--timeout` (readiness) + 10 s (equality check timeout) + 2 s + 10 s (`docker stop --time 10`). CI gates W ≤ 20000 ms (Acceptance 1).
   - Each api call and each in-container check adds one short `bun -e` process in the api, probe or console container. They run one at a time.
   - Measured: the CLI prints `two probes ran for <W> ms` per location (decision 7 step 7). `rotate.sh` takes W independently from `docker events` and samples `docker stats --no-stream --format json` every second during the rotation. It reports the largest summed memory and CPU of the probe containers of one location, which the PR quotes against the single-probe baseline of the same run.
2. **Extra check traffic during the handoff.**
   - Extra load per check: the old probe's runs that start inside W, each one extra request to the target and one extra `POST /results`. The old probe starts no run after SIGTERM (fact 3), and the new one no run before its start, so every doubled run lies in W.
   - Bound: two runs of one probe and one check start at least I − e apart (fact 3: the next run is scheduled one interval after the previous start; e = 100 ms covers timer and clock earliness). So the old probe starts at most `floor(W / (I − e)) + 1` runs in W. With W = 6000 ms:
     - I = 5000 ms: at most 2;
     - I = 1000 ms: at most 7;
     - I = 1 ms (the contract minimum, fact 3): about W, so thousands. The docs state the formula and this limit.
   - The first spec's "at most one extra sample" and the second spec's "W ≤ 2000 ms plus signal latency" were both wrong: W also holds the readiness and the equality check.
   - The sample statistic E that the tests use (Counterexamples "Extra samples") is a different quantity: the surplus of samples over a minimum gap-keeping subset. Its lemma gives E = 0 for one probe and E ≤ 2·floor(W / (I − e)) + 3 for a handoff.
   - Measured in `rotate.sh` per location: W from Docker events, E in the baseline (must be 0), over the rotation window (must be within the lemma bound) and after the handoff (must be 0).
3. **Upgrade downtime and copy I/O.**
   - Downtime D runs from `stop` to ready: stop (≤ 10 s grace per service, in parallel), snapshot, edit, `up -d` and readiness. The pull runs before the stop and is not part of D.
   - The snapshot reads every data volume once and writes the same bytes as tar files. A rollback reads them again and rewrites the volumes. The kept snapshot uses one extra copy of the data volumes on disk.
   - Snapshot time is roughly the volume size divided by the disk throughput: a few MB on the demo (< 5 s), about 10 s per GiB at 100 MB/s.
   - Measured, three ways, all in `upgrade.sh`:
     - the CLI lines `snapshot <bytes> bytes in <ms> ms` and `the stack was down for <ms> ms`;
     - the size of the snapshot directory (`du -sb`);
     - the largest `always-healthy` result gap across the real upgrade (Counterexamples "Gap rule" statistic, without the bound). This is an api source, independent of the CLI.
   - The issue sets no downtime budget. The PR quotes the numbers.
4. **CLI binary size.** It grows by the new modules. The existing `cli-build` step "Binary size and init time" (`.github/workflows/ci.yml` lines 407–414) reports it. The PR quotes the size before and after.
5. **CI time.** `cli-rotate` takes about 20 min, because it waits the real 10-minute overlap and runs the resume case. `cli-upgrade` takes about 15 min. Both run in parallel with the existing jobs.

## Security impact

Security impact: yes
The change calls admin token routes, writes secret files, verifies image provenance, runs privileged one-shot containers on data volumes, and adds CI jobs with a token.

These checklist items apply:

- **Secrets in errors, logs and responses.**
  - Bearer tokens and new secrets travel only on stdin to `docker compose exec -T` or `docker exec -i`.
  - Argv, env, the journal and the output never carry them. The tests grep the captured output, the journal and the recorded spawn argv for every secret.
  - Api error bodies are not echoed. Only the status code and a fixed text are shown.
  - Token names from the api go through `shown()`.
  - `gh` and Docker stderr go through `firstLine` (`maskUserInfo`).
- **Auth order and status codes.**
  - The capability and identity checks run before the first api write.
  - Each api status gets a defined outcome: 401, 403, 404, 409 and 429 are named, and anything else is `unexpected status`.
  - A lost answer never leaves a usable token whose secret nobody holds: orphan replacements are found by their unique journal name and revoked, and the lost token is revoked after the switch.
  - A held secret is never revoked: the orphan sweep runs only when no host or staging file can hold a replacement (decision 8 "Reconcile"), and the revoke guard refuses a revoke of the calling token or of `activeTokenId`.
- **Body and size limits.** Api answers are capped at 1 MiB in `API_SCRIPT`. Registry bodies are capped at 1 MiB, and registry pagination at 10 pages.
- **Input validation.**
  - Token ids match `^tok_[0-9a-f]{24}$`. Container ids match `^[0-9a-f]{64}$`. Service names and versions are validated. The journal and `upgrade.json` are validated on read like external input.
  - Api and registry JSON goes through own-property readers (`own()` in `cli/docker.ts`), never trusted as typed.
  - Locations match `^[a-z0-9][a-z0-9-]{0,31}$`, as in `secrets-init.mjs`.
- **SSRF and redirects.** The registry host is fixed to `https://ghcr.io`, with `redirect: "error"`. The api URL is fixed to `127.0.0.1:3000` inside the api container. No user input builds a URL or a path beyond the validated token id.
- **Atomic, path-safe writes.**
  - Secret files, the journal, `compose.yaml`, `upgrade.json` and the snapshot files are written `wx` with temp names in their final directory, fsynced and renamed, with the directory fsynced.
  - A new secret goes first to a 0600 staging file in the 0700 `secrets/` directory and reaches the host file only by rename. Staging files are name-checked, never read by `secrets-init`, and never left behind after a finished run.
  - Links and non-regular files are refused, and directory modes are checked.
  - The snapshot directory is 0700 with 0600 files, because it holds the databases. Tars are checked against their recorded sha256 before a restore deletes anything.
- **Dependency pins.**
  - Images are verified by attestation (repository, signer workflow, source ref, no self-hosted runner) before they are pulled by digest.
  - The snapshot and restore containers use the pinned `oven/bun` image of `secrets-init`, with `--network none`, `--cap-drop ALL`, only the capabilities that `tar` needs, and `no-new-privileges`. They have fixed names so an abort can remove them.
  - No new package or action.
  - The CI jobs use `persist-credentials: false` and the existing SHA pins. `GH_TOKEN` is the job token with `attestations: read`.

## Rollout order

One repository (deploy). No service, contract, kit or config change.

Who still runs during the rollout:

- **Installations on `0.1.0`** (written by an older CLI, or by this one before an upgrade) keep working. `token rotate` refuses there with a pointer to `pulse upgrade`, and `upgrade` moves them to the pinned release.
- **Installations written by an older CLI binary.** They are format 1, so the new commands accept them.
- **An older CLI binary on a new installation.** It still sees `.pulse-init.lock`. `secrets/.pulse-rotation.json` and `.pulse-upgrade/` are not in its managed file list (`cli/write-install.ts` lines 33–44), so `pulse init --force` neither touches nor reports them.
- **A rotated secret** (49 characters, `pulse_` prefix) passes `tokenContentValid` and the `secrets-init.mjs` token rule (lines 22 and 36–42). So an older CLI's `pulse init --force` keeps it, and `secrets-init` copies it.
- No breaking change, so the release line does not take a major step.

## Counterexamples

Each rule comes with a case that it must reject or that a wrong implementation gets wrong. Unit tests use these literals.

- **Gap rule** (decision 15).
  - **Inputs.** The check is `always-healthy`, with interval I = 5000 ms and allowance A = 500 ms. The window is [W0, W1] in host epoch ms, given per check in Acceptance 1.
  - **Sample set.** All results of that check with that location whose `timestamp` lies in the window, read with `GET /checks/always-healthy/results?limit=1000` and paged with `before` until a result older than the window start is seen. The pages must reach past the window start; otherwise the check fails.
  - **Statistic.** Sort the sample timestamps, add W0 and W1 as edges, and take the differences of neighbors. Every difference must be ≤ I + A. No averaging and no percentile.
  - **Examples.**
    - Timestamps `[0, 5004, 10009, 13000, 18003]` in the window [0, 18003] pass (largest difference 5005).
    - `[0, 5004, 10009, 15600]` fails (5591).
    - A stop-then-start probe whose last run started 4000 ms before a 3000 ms restart, plus a 600 ms first delay, posts its next result 7600 ms after the previous one. It must fail.
    - Results only from `us` must not hide a missing `eu`: the rule runs per location.
- **Extra samples.**
  - **Constants.** I = 5000 ms (check interval), A = 500 ms (gap allowance, decision 15), e = 100 ms (earliness: two runs of one probe and one check start at least I − e apart, fact 3).
  - **Sample set.** As for the gap rule: the sorted timestamps s_1 ≤ … ≤ s_N of one check and one location in the window, N ≥ 2. The window edges W0 and W1 are not samples.
  - **Statistic E (surplus).** A chain is a subset that contains s_1 and s_N and whose neighbor differences are all ≤ I + A. C is the size of the smallest chain, computed greedily: start at s_1; from the current sample, go to the latest later sample that is at most I + A after it; stop at s_N. E = N − C. E is only computed when the gap rule holds for the window (then the whole set is a chain); otherwise the check has already failed on the gap rule. No averaging, no percentile, integers only.
  - **Lemma** (needs A + 2e < I, true for 500 + 200 < 5000):
    1. **One probe gives E = 0.** A sample s_i with 1 < i < N can be left out of a chain only if s_{i+1} − s_{i−1} ≤ I + A. For one probe that difference is at least 2(I − e) > I + A.
    2. **Handoff bound.** The old probe's samples are all before T_d, the new probe's all at or after T_s, W = T_d − T_s (Docker events, Acceptance 1), and the window holds at least 2 samples before T_s and at least 2 at or after T_d. Let K be the number of samples in [T_s, T_d). Then E ≤ K + 1 ≤ 2·floor(W / (I − e)) + 3.
       - Proof. Every sample before T_s is old. Each of them except the last one (o_a) has old neighbors on both sides, so by part 1 it is in every chain. The same holds after T_d for every sample except the first one at or after T_d (n_b). So only o_a, n_b and the K samples in [T_s, T_d) can be left out. The sample before o_a and the sample after n_b are in every chain and are at least 2(I − e) > I + A apart, so at least one sample between them stays. That gives E ≤ K + 1. Each probe has at most floor(W / (I − e)) + 1 samples in a span of W, so K ≤ 2·floor(W / (I − e)) + 2.
  - **Fixtures** (I = 5000, A = 500, e = 100; the self-test `cli/test/samples.test.sh` uses them as literals):
    - **Phase offset of the second plan review.** Old `[-5000, 0, 5000]`, new `[3500, 8500, 13500]`, T_s = 3000, T_d = 5500, W = 2500. Samples `[-5000, 0, 3500, 5000, 8500, 13500]`. The smallest chain is `[-5000, 0, 5000, 8500, 13500]`, so C = 5 and E = 1. K = 2 (3500 and 5000), so the bound K + 1 is 3 and 2·floor(2500/4900) + 3 is 3. The old statistic (count of neighbor differences below I − 100) gives 3 here and is wrong.
    - **Nearly in phase.** Old `[-5000, 0, 5000]`, new `[300, 5300, 10300]`, T_s = 200, T_d = 5100, W = 4900. Samples `[-5000, 0, 300, 5000, 5300, 10300]`. Greedy: −5000 → 300 → 5300 → 10300, so C = 4 and E = 2. The bound is K + 1 = 3 (K = 2) and 2·floor(4900/4900) + 3 = 5. A gate of `floor(W / I) + 1` = 1 on E would reject this correct handoff.
    - **One probe with lateness.** `[0, 5004, 10009, 15013]` gives E = 0. `[0, 4950, 9950]` (50 ms early) gives E = 0.
    - **Edges are not samples.** One probe `[0, 5004, 10009]` in the window [−400, 10009] gives E = 0. A chain that starts at the edge −400 would reach 5004 directly (5404 ≤ 5500), leave out 0 and give 1. That is wrong.
    - **Old probe never stopped.** Old `[0, 5000, 10000, 15000, 20000]`, new `[2500, 7500, 12500, 17500]`. Greedy keeps 0, 5000, 10000, 15000, 20000, so E = 4. Any window after the planned T_d with two posting probes gives E > 0 and fails the check "E = 0 after T_d".
    - **Gap failure first.** `[0, 5004, 10009, 15600]` fails the gap rule (5591), and E is not computed.
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
  - The host file changes only by the install rename, after the `staged` fsync: a fake that fails the fsync of `staged` must see the host file byte-equal and the staging file still there. Writing the secret straight into the host file is wrong.
  - The journal state must be on disk before its side effect: a fake that fails the fsync of `handoff` must see no `--scale` call.
  - The old probe container must stop only after the new one is ready, its token is `same`, and 2000 ms have passed.
  - For `admin`, the console restarts only after the new secret answers `/admin/tokens/self`.
- **Handoff resume** (journal `handoff`, old id `o…`, 64 hex each).
  - Containers `[o running]`, `newContainerId` null: exactly one `--scale` call follows.
  - Containers `[o running, n running]`, `newContainerId` null: no `--scale` call; `n` is recorded and checked. Repeating `--scale … =2` here is wrong: it creates nothing and leaves no new id.
  - Containers `[n running]`, `o` gone, `newContainerId` = `n`: no `--scale`, no 2000 ms wait, no `docker stop`; the item ends `switched`.
  - Containers `[o running]`, `newContainerId` = `n` (gone): `newContainerId` is cleared and one `--scale` call follows.
  - Containers `[o running, n1 running, n2 running]`: exit 1 and no `docker stop` or `docker rm`.
  - New container reports `different` twice: exit 1, the journal kept, the old container still running.
- **Lost answer.**
  - Rotate `POST` times out and `rotatedAt` changed: the CLI must journal `replacing`, create a replacement with the journal's `replacementName`, switch, then revoke the old id. A blind second `POST` rotate is wrong.
  - Rotate `POST` times out and `rotatedAt` did not change: one normal rotate follows.
  - Create `POST` times out, and the api holds a token named `replacementName`: the rerun revokes that token before it creates another one. Creating a second without the revoke is wrong (it leaves a usable token whose secret nobody holds).
  - A person's token with the same scopes and location but another name is not an orphan and must not be revoked.
  - State `switched` with `revokeTokenId` set: a rerun must revoke, not end. State `revoking` where the revoke answers 409 and `GET` shows `revokedAt` set: the item ends `done`.
- **Stage boundary** (token ids `tok_` + 24 hex; T = `tokenId`, R = a replacement).
  - **The case of the second plan review.** Admin, state `replacing`, R created, `.pulse-next.admin-token.R` installed over `secrets/admin-token`, then the `saved` write fails. The journal says `staged` (it was written before the install), and no staging file exists. The rerun must journal `saved`, keep R, and later revoke only T with R's secret. Treating R as an orphan and revoking it with the host file (which is R's own secret) is wrong: the next create would get `401`.
  - Admin, state `replacing`, `.pulse-next.admin-token.R` exists, the `staged` write failed. The rerun must journal `staged` with `activeTokenId` R and install it. Running the orphan sweep here is wrong: R's secret is held.
  - Probe, state `requested`, `.pulse-next.probe-token-eu.T` exists. The rerun must stage T and install it, with no second rotate and no replacement, even though `rotatedAt` changed.
  - State `requested`, a leftover `..pulse-next.probe-token-eu.T.tmp-<hex>` and no staging file. The rerun deletes the temp file and takes the lost-answer path (`rotatedAt` changed → `replacing`).
  - State `staged` with `activeTokenId` R and a staging file for another id: refuse with exit 1, no api write.
  - State `saved` and any staging file: refuse with exit 1.
  - A staging file named `.pulse-next.admin-token.tok_XYZ` or `.pulse-next.../x.tok_…`: refuse with exit 1 (name rule).
- **Revoke guard.** The fake api answers `GET /admin/tokens/self` with id R for the bearer, and the step would revoke R: no revoke call, exit 1, journal kept. A revoke of `activeTokenId` is refused the same way.
- **Journal resume.** State `saved` must not `POST` again. A journal with `tokenId` `tok_XYZ` or `state` `bogus` refuses with exit 1 and no api call.
- **409.** The api answers `409` on a token in overlap, and no journal names it. The CLI exits 1 with `still in its rotation overlap until`, and no file changes.
- **Legacy api.** `/admin/tokens/self` → 404: exit 1 before any write, and the journal is not created.
- **Files.**
  - `secrets/probe-token-eu` is a symlink: refuse before the `POST`.
  - `secrets/` with mode 0750: refuse.
  - A token file with mode 0640: refuse.
- **No secret in argv.** A test records every spawn and asserts that no argv element, no env value and no journal byte contains the fake bearer `pulse_` + `A`×43 or the fake new secret.
- **Upgrade versions.**
  - Tags `["0.1.0","0.1","0","0.1.1","sha256-…","0.10.0","0.2.0-rc.1"]` with current `0.1.0` select `0.10.0`: numeric, not text, and not `0.2.0-rc.1`.
  - `--to 0.2.0-rc.1` is a usage error, and so are `--to 01.2.3` and `--to 1.2`.
  - `--to v0.1.1` equals `--to 0.1.1`.
  - Current `0.2.0` with `--to 0.1.1` refuses (`no downgrades`).
  - One image without the tag refuses all of them.
- **Release fixtures of the live test.** Tags `["0.1.0","0.1.1","0.1.2","0.1","0"]` give A = `0.1.0` and B = `0.1.1`, not the highest pair. Tags that differ between two images fail the test.
- **Image shapes.**
  - `ghcr.io/lorenzh/pulse-api:0.1.0` without a digest refuses.
  - `pulse-api:dev` (dev) refuses.
  - `probe-eu` and `probe-us` with different refs refuse.
  - An override that sets `image:` for `api` refuses.
- **Compose edit.** A `compose.yaml` where the old api ref also appears in a comment or another key gives a replacement count unequal to the service count, so it refuses without a write (and, after the boundary, rolls back).
- **Provenance.**
  - A `gh` exit 1 refuses.
  - Missing `gh` (spawn ENOENT) exits 1 with the install hint, not 3.
  - The verified digest must be the pulled digest. Test: the fake registry answers a second `HEAD` with another digest. The CLI must not ask again, and the pulled ref equals the verified one.
- **Snapshot boundary.**
  - SIGINT while `notify-data.tar.part` is written (the second of three): `docker rm -f` of the helper, no `find … -delete` spawn, no `api-data.tar` or `*.part` left, `compose.yaml` byte-equal, `aborted`, exit 130. Restoring `api-data` from its finished tar here is wrong: the volumes were never changed.
  - The tar helper exits 1 for `console-data`: the same abort path, exit 1.
  - A crash between the last `rename` of a tar and the `applying` write leaves `snapshotting`; the next `upgrade --yes` refuses and names the directory.
  - SIGINT right after the `applying` write: a full rollback follows, even though `compose.yaml` is not edited yet.
- **Rollback.**
  - On failure after the boundary, the order must be stop → verify every tar → restore every tar → restore `compose.yaml` → `up -d`. Starting old images before the volume restore is wrong: api A exits 2 on schema 9.
  - A tar whose sha256 differs from `upgrade.json`: no restore helper runs for any volume, state `rollback-failed`.
  - A `rollback-failed` snapshot makes the next `upgrade --yes` refuse.
- **Logs.**
  - `pulse logs --follow` must not get a kill bound. A fake clock that advances 1 hour must not kill it.
  - SIGTERM to the CLI must end the child and exit 130.

## Contract fields

No new name in contract or config. The new names are CLI commands, flags, files, journal and snapshot keys, container names and test variables of deploy only. Each search was run in this run from `.repos/` and found nothing (0 matches each):

- `grep -rn -- 'pulse-rotation' contract/src config deploy`
- `grep -rn -- 'pulse-upgrade' contract/src config deploy`
- `grep -rn -- 'pulse-snapshot' contract/src config deploy`
- `grep -rn -- 'pulse-restore' contract/src config deploy`
- `grep -rn -- 'token rotate' contract/src config deploy`
- `grep -rn -- 'pulse upgrade' contract/src config deploy`
- `grep -rn -- 'pulse logs' contract/src config deploy`
- `grep -rn -- 'PULSE_TEST_FAIL_READY' contract/src config deploy`
- `grep -rn -- 'PULSE_TEST_HOLD_SNAPSHOT' contract/src config deploy`
- `grep -rn -- 'replacementName\|revokeTokenId\|newContainerId\|oldContainerId\|composeSha256' contract/src config deploy`
- `grep -rn -- 'pulse-next' contract/src config deploy` (the staging file prefix)
- `grep -rn -- 'activeTokenId' contract/src config deploy`
- `grep -rn -- '"staged"' contract/src config deploy` (the journal state). Without quotes, `staged` matches only the git-hook word `{staged_files}` in `config/lefthook.yml` lines 5 and 8, `config/lefthook-local.yml` line 5 and `config/AGENTS.md` line 22. Those are tooling texts, not names in a shape, so there is no collision.
- `grep -rn -- 'refusing to revoke' contract/src config deploy`

The new flags `--to`, `--follow`, `--location`, `--id` and `--yes` on these commands do not exist in `cli/args.ts` (lines 59–103 list every option). `--timeout` exists for `up` and keeps its meaning.

## Repository: deploy

Files:

- `common/services.yaml` (changed, only through `scripts/bump-images.sh`, decision 2)
- `cli/args.ts`, `cli/args.test.ts` (changed: `token`, `upgrade`, `logs`, HELP)
- `cli/main.ts`, `cli/main.test.ts` (changed: dispatch)
- `cli/docker.ts`, `cli/docker.test.ts` (changed: spawn options `input`, `stdinFd`, `stdoutFd`; generic missing-binary error)
- `cli/ready.ts`, `cli/ready.test.ts` (changed: `parsePs` reads `ID`; `readyz` for a service or a container id)
- `cli/write-install.ts`, `cli/write-install.test.ts` (changed: use the extracted lock and atomic write)
- `cli/lock.ts`, `cli/lock.test.ts` (new: the shared `.pulse-init.lock`, moved from `write-install.ts`)
- `cli/safe-write.ts`, `cli/safe-write.test.ts` (new: atomic write with fsync of file and directory, link and mode checks, moved from `write-install.ts`)
- `cli/api-call.ts`, `cli/api-call.test.ts` (new: `API_SCRIPT`, the equality script and the in-container api call)
- `cli/rotation-journal.ts`, `cli/rotation-journal.test.ts` (new: journal format, validation, states, staging file names, the reconcile table and the handoff resume table)
- `cli/token-rotate.ts`, `cli/token-rotate.test.ts` (new: selection, rotation, lost answer, switch, revoke; the rotation failure-injection matrix)
- `cli/registry.ts`, `cli/registry.test.ts` (new: ghcr.io tags and digests)
- `cli/provenance.ts`, `cli/provenance.test.ts` (new: the `gh` preflight and verify)
- `cli/snapshot.ts`, `cli/snapshot.test.ts` (new: `upgrade.json` states, archive write with `.part` and sha256, abort cleanup, verify and restore)
- `cli/upgrade.ts`, `cli/upgrade.test.ts` (new: selection, preview, apply, boundary and rollback; the upgrade failure-injection matrix)
- `cli/logs.ts`, `cli/logs.test.ts` (new)
- `cli/docs.test.ts` (changed: a section per command)
- `cli/test/fake-docker.ts` (changed: record `input`, fds and signals; container ids and states; a hook that stops the run at a named step)
- `cli/test/rotate.sh` (new: `cli-rotate` body)
- `cli/test/upgrade.sh` (new: `cli-upgrade` body)
- `cli/test/pin-release.sh` (new: rewrites an install's pulse image lines, test only)
- `cli/test/samples.sh`, `cli/test/samples.test.sh` (new: the gap rule, the surplus statistic E with its greedy chain, the lemma bound, and the Docker-event parsing for T_s, T_d and W, shared by `rotate.sh` and `upgrade.sh`; the self-test runs every fixture of Counterexamples "Gap rule" and "Extra samples" as literals)
- `cli/test/fail-ready-docker/docker` (new: test-only pass-through shim, decision D2-A; `PULSE_TEST_FAIL_READY_*` and `PULSE_TEST_HOLD_SNAPSHOT`)
- `cli/test/stack.sh`, `cli/test/errors.sh` (changed: logs and refusal paths)
- `.github/workflows/ci.yml` (changed: jobs `cli-rotate` and `cli-upgrade`)
- `docs/cli.md`, `README.md`, `AGENTS.md` (changed)

Behavior change: yes
The change adds three CLI commands, bumps the image pins and adds CI jobs.
Breaking: no
The commands and flags are new; `init`, `up`, `down`, `status`, their flags, `pulse.json` and the Compose output keep their documented behavior (only the lock refusal wording changes).

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
- **Pin rule.** `AGENTS.md` "Rules" forbids a version or digest of a pinned image in any script, test or workflow; `scripts/check-setup.sh` checks pin shapes (line 36). The live upgrade test therefore reads its release pair from ghcr.io (acceptance 2).
- **gh.** It is not referenced in the repository today. The local check in this run used gh 2.103.3. The new jobs print `gh --version` as their first step, and the implementer confirms the five flags of decision 12 on the runner's `gh`.

### Reuse (extract before the second use)

- **Project guard.** `resolveProject` and `guarded` (`cli/docker.ts` lines 453–474, `cli/lifecycle.ts` lines 81–95) for every new command. Do not write a second guard.
- **Lock.** Move the lock (`cli/write-install.ts` lines 299–309 and 352–394) into `cli/lock.ts`, with its tests, and use it in `writeInstall`, rotation and upgrade.
- **Atomic write.** Move `atomicWrite` and the link and mode refusals (`cli/write-install.ts` lines 164–187 and 279–297) into `cli/safe-write.ts`. Add fsync of the file and the directory. Then use it in init, the rotation (secret files, journal) and the upgrade (`compose.yaml`, `upgrade.json`, the tar rename).
- **State files.** The rotation journal and `upgrade.json` share one helper for "validate on read, write state with fsync before the side effect" in `cli/safe-write.ts`. Do not write two.
- **Readiness.** Extend `readyz` and `waitReady` (`cli/ready.ts`) to target a container id. Use them for the new probe container, the console restart, the upgrade and the rollback, not a second poller. The in-container equality check is a second constant script in `cli/api-call.ts`, next to `API_SCRIPT`.
- **Process rows.** `parsePs` (`cli/ready.ts` lines 18–46) gets `ID` (from `ps --no-trunc`). Container selection and the handoff resume use it.
- **Text safety.** `shown()` (`cli/args.ts` lines 140–152), `firstLine` and `maskUserInfo` (`cli/docker.ts` lines 104–114) for every external text. `tokenContentValid` (`cli/tokens.ts` lines 40–43) for the file check.
- **Pin shape.** `assertPin` and `PULSE_IMAGE` (`cli/services.ts` lines 36–48) are the image shape of decision 10. Export and reuse them; do not write a second regex.
- **Signals.** `processSignals` and the record-then-act pattern of `writeInstall` (`cli/write-install.ts` lines 50–71 and 366–399) for the critical sections of decisions 8 and 13.
- **Tests.**
  - `cli/test/fake-docker.ts` is the only fake spawn. Its stop-at-step hook serves both failure-injection matrices.
  - The file operations of `cli/safe-write.ts` (open, write, fsync, rename, unlink) go through one injected file seam, so the stage-boundary matrix can fail or "hard kill" at each named write. The fake api of the rotation tests is one test helper that maps secrets to token ids and enforces `401` for revoked secrets, self-revocation and the last-admin rule.
  - Registry and api answers in unit tests are literal fixtures.
  - Image refs in `cli/` tests use the fixture `example.invalid/fixture-svc:9.8.7` (`AGENTS.md` rule). A test that needs a pulse-shaped ref builds it at run time from parts, so no pin literal is in a file.
  - The gap and extra-sample statistics of `rotate.sh` and `upgrade.sh` live in one shell function file sourced by both, `cli/test/samples.sh`, with the self-test `cli/test/samples.test.sh` on the Counterexamples fixtures (phase offset, nearly in phase, one probe, edges, old probe never stopped, gap failure).
- **The `gh` call** is an argument array through the spawn seam (`gh` is a separate binary; `DockerMissing` handling becomes a generic "binary missing" with the binary name, which keeps exit 3 only for Docker).

### Checks

- `bun install --frozen-lockfile && bun run check`.
- `bun run build`, `bash cli/test/smoke.sh`, `bash cli/test/errors.sh dist/pulse`.
- `bash cli/test/stack.sh demo`, `bash cli/test/stack.sh full`, `bash cli/test/stack.sh minimal`.
- `bash cli/test/rotate.sh`.
- `GH_TOKEN=… bash cli/test/upgrade.sh`.
- `bash cli/test/samples.test.sh` (the self-test of the sample statistics).
- Shellcheck and `bash -n` from the repository root.
- `scripts/check-setup.sh` and `scripts/bump-images.sh --verify` after the bump.
- The existing `minimal`, `full`, `demo` and `cli-stack` jobs on the new pins.

### CI

- **`cli-rotate`.** ubuntu-24.04, `timeout-minutes: 40`, checkout with `persist-credentials: false`, setup-bun 1.4.0, `bun install --frozen-lockfile`, `bun run build`, `bash cli/test/samples.test.sh`, `bash cli/test/rotate.sh`. On failure, it prints `docker compose ps --all`. Teardown is `pulse down --volumes` in `always()`. It prints no secret.
- **`cli-upgrade`.** ubuntu-24.04, `timeout-minutes: 40`, job `permissions: {contents: read, attestations: read}`, `env: GH_TOKEN: ${{ github.token }}`. It runs `gh --version`, then the same build steps, then `bash cli/test/upgrade.sh`, with the same teardown.
- Update the CI paragraph and the Commands table of `AGENTS.md` with both jobs and scripts.

### Completion evidence

- The PR body carries `Breaking: no`.
- The PR links both new job runs and the green existing jobs on the bumped pins.
- It quotes:
  - the gap and extra-sample table per location: largest difference in ms; E with its bound; W from Docker events next to the CLI's printed W; for the baseline, the rotation window, the window after T_d, and the interrupted-resume window;
  - the overlap deadline and the 401 checks;
  - the handoff ms per location and the memory and CPU of the two probes against the baseline;
  - the release pair A and B printed by `upgrade.sh`, and the schema numbers on A, after the rollback and on B;
  - the abort, rollback and success lines of the upgrade job, the snapshot bytes and ms, the downtime ms and the largest result gap across the upgrade;
  - the binary size before and after.
- It names the known limits: extra samples during the handoff (the formula), the stack being down during an upgrade, post-snapshot writes lost on rollback, the snapshot disk space, and the manual recovery after a hard kill.

## Breakdown notes

- Order the tasks so that the shared seams come first: lock, safe write and state files, spawn options, `readyz` by container, `parsePs` ID, and the api call. Each command then builds on them.
- The pin bump can be its own first task. The existing CI jobs prove `0.1.1` on a fresh install.
- Suggested tasks:
  1. The seams.
  2. `pulse logs` with its stack and error checks.
  3. `pulse token rotate` with the journal, the staging files, the reconcile and resume tables, the revoke guard, the rotation failure-injection matrix and the stage-boundary matrix (Acceptance 3).
  4. `pulse upgrade` with registry, provenance, snapshot boundary, rollback and the upgrade failure-injection matrix.
  5. The live scripts `rotate.sh`, `upgrade.sh`, `pin-release.sh`, the sample statistics (surplus E, the lemma bound, Docker-event W) with their fixture self-test, the shim, the two CI jobs, and the docs.
- No task holds docs alone. Each command's docs section goes with its command task. The final task completes `README.md` and `AGENTS.md`.
