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
- The third plan review (the latest issue comment "Factory ran spec/plan-review"). This version fixes its three defects:
  - a failure inside the stage step of a first run (for example the directory fsync after the staging rename) no longer jumps to the lost-answer path. Any error in step 3 of decision 7 runs the reconcile of decision 8 in the same process, from the journal on disk, before anything else. An item enters `replacing` only after a reconcile found no staging file for it (decision 8 "Stage errors").
  - the reconcile now has a fixed validation order. It also names the one bearer it may read from a host file: `secrets/admin-token` in a `probe` journal. No item owns that file and the reconcile never changes it. It is read only after the staging check, the file checks of decision 9 and the capability check (decision 8 "Reconcile", step 4).
  - the Files list of the deploy section now holds `cli/services.ts` and `cli/services.test.ts`. `PULSE_IMAGE` is private today (deploy `cli/services.ts` line 36, `const` without `export`), and Reuse exports it.
- The fourth plan review (the latest issue comment "Factory ran spec/plan-review"). This version fixes its four defects:
  - **State-file write errors at the snapshot boundary** (decision 13 "State-write errors"). An error while `upgrade.json` is written is never read as "the write landed" or "it did not". The CLI reads the file back from disk and follows the state that is there. If the `applying` rename landed and only the directory fsync failed, the state on disk is `applying` and the rollback runs. Archives are deleted only after `aborted` is durable, and the abort runs only when the file on disk still reads `snapshotting`. So `applying` never points to deleted archives. The rollback gets a durable state `restored` before it starts containers. The manual recovery is decided by facts on disk.
  - **One rotate outcome table** for the first run and the resume (decision 8 "Rotate outcome"). Every rotate `POST` that does not end in a parsed `200` is followed by a readback of the token. The answer class (explicit rejection or ambiguous) and the readback decide the row together. An explicit rejection such as `409` never leads to `replacing` while `rotatedAt` is unchanged. A timeout with no change on the server leads to one more normal rotate, not to `replacing`.
  - **The bearer read order** is the same in decision 8, Acceptance 3 and the Counterexamples: the staging checks of reconcile step 3, then the link and mode checks of `secrets/admin-token`, then its read and content check, then the capability call `GET /admin/tokens/self` with it, then the confirmation `GET /admin/tokens/<X>`.
  - **The doubled-runs formula has a stated domain.** `floor(W / (I − e)) + 1` is a bound only for I ≥ 200 ms. Below that the spec gives a separate estimate from the run duration (the probe never overlaps runs of one check), and the docs and `cli/test/samples.sh` follow it (Performance impact item 2).
- The fifth plan review (the latest issue comment "Factory ran spec/plan-review"). This version fixes its three defects:
  - **Late landing of an ambiguous create** (the fifth version's decision 8 "Settle" and "Lost answer"). Token names are not unique in the api (fact 7), so a create that lands after the sweep makes a second token. Every create `POST` is now *settled* before the CLI sends another create or reads the token list for a sweep: the in-container api-call process has ended (it ends itself at most 11 s after its start, decision 4), which the CLI proves with a process scan in the api container. A sweep follows every ambiguous or lost create, and a final sweep in `switched` revokes every token named `replacementName` except `activeTokenId` before the journal can be removed. T4 gets delayed-mutation cases. (The sixth version replaces the settle and its process scan by the barrier; the sweeps stay.)
  - **The snapshot covers the stores that are really mounted** (decision 10 "Data mounts", decision 13 step 6). The snapshot set is no longer "top-level keys ending in `-data`". It is read from the effective mounts of the pulse services, and layouts the CLI cannot snapshot (a bind, a tmpfs or an anonymous volume, no writable volume at `/data`, a data path moved by an environment variable) refuse before anything stops. T5 gets fixtures for a bind at the api's `/data` and a volume key without the `-data` suffix.
  - **Security impact matches decision 8.** A replacement follows exactly the two cases of "Lost answer": a readback that shows a changed `rotatedAt`, and an `ok` rotate answer whose secret the stage-error reconcile found in no staging file.
- The sixth plan review (the latest issue comment "Factory ran spec/plan-review"). This version fixes its four defects:
  - **A server barrier for unanswered writes** (decision 8 "Barrier"). The process scan of the fifth spec only proved that the client had gone. The api awaits the request body (api `src/token-routes.ts` line 232) and gives no order across connections, so a create could still land after the scan. The settle and its scan are removed. Each rotate or create `POST` is now marked in the journal (`inFlight`) before it is sent. Before any readback, sweep or new `POST` that follows an unanswered write, the CLI stops the api container, checks with `docker inspect` that no process of it is left, and starts it again. Then every earlier write is committed or never will be. The tests let the fake api apply a held write at any later event, including after the final sweep and after the run, unless the api was stopped first (Acceptance 3 "Unanswered writes").
  - **Surviving helper containers** (decision 13 "Helpers"). Snapshot and restore helpers carry labels. A helper sweep removes every helper of the install with `docker rm -f` and lists again until none is left. It runs in the preflight of every `upgrade --yes`, after the lock is taken, and before any restore, start or final state. Every manual recovery starts with it. T5 and the live test kill the CLI hard during the deletion and the extraction of a restore.
  - **`restored` means the data is on disk** (decision 13 step "Rollback" 3 and 5). Every restore helper ends with `sync -f /to`, which flushes the volume's filesystem and exits non-zero on an error (busybox 1.37.0 in the pinned helper image, checked in this run). `restored` is written only after every helper exited 0 and the `compose.yaml` restore is durable. A failed sync leads to `rollback-failed` with `restored: false`.
  - **Stale-lock recovery** (decision 3). The lock records the host and the start time of its process. A lock written on this host by a process that no longer runs is removed under a second lock file `.pulse-init.lock.break`, before any journal or `upgrade.json` is read. Any doubt refuses with the manual steps. `docs/cli.md` "A stale `.pulse-init.lock`" (line 217–219, today only about `pulse init`) is rewritten for all three commands. The hard-kill cases of the test matrices leave the lock behind and assert the break.
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
   - When the api does not take a result, the probe keeps it in a buffer and retries with a backoff from 1 s up to 30 s (`BACKOFF_START_MS` and `BACKOFF_MAX_MS`, `src/buffer.ts` lines 4–5 and 113–128). The result keeps its `timestamp`. The buffer drops results only above `bufferMaxResults` or `bufferMaxAgeMs` (`src/main.ts` lines 195–196).
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
   - The only lock is `.pulse-init.lock`, held by `pulse init` (`cli/write-install.ts` lines 28 and 345–400). It is an exclusive create (`openSync(lockPath, "wx", 0o600)`, line 356) with the content `pid <pid>\nnonce <hex>\n` (line 353). On `EEXIST` it refuses (lines 358–362). Nothing removes a lock that a killed process left, so after a SIGKILL every later lock holder refuses. `docs/cli.md` lines 217–219 tell a person to check for a running `pulse init` and delete the file.
   - `pulse down` runs `docker compose <prefix> down` (`cli/lifecycle.ts` lines 148–154). It only acts on Compose containers of the project, never on a container started with `docker run`.
   - Volumes carry the label `io.github.lorenzh.pulse.install` with the install id (`INSTALL_LABEL`, `cli/render-compose.ts` line 9).
   - The helper image of `secrets-init` is `oven/bun:1.4.0-alpine@sha256:0723…437eb` (`common/services.yaml` line 66). Its busybox 1.37.0 has `sync [-df] [FILE]...`. `sync -f /to` exits 0 on a directory and 1 on a missing path (checked in this run with `docker run --rm --network none` of that digest). `sync -f` calls `syncfs(2)` on the filesystem of the path; Linux 5.8 and later return writeback errors from it.
6. **Pins today.** `common/services.yaml` pins all five pulse images to `0.1.0` (lines 8, 16, 25, 35 and 44). The deploy rule is that no other file holds a version or digest of a pinned image, also not a script, test or workflow (`AGENTS.md` "Rules", first bullet). `scripts/check-setup.sh` checks the shape of each pin (line 36).
7. **How the api applies a create.**
   - Token names are not unique: `api_tokens.name` is `TEXT NOT NULL` with no unique index (api `src/migrations.ts` lines 75–85). Two creates with the same name make two tokens.
   - Creates are not serialized like rotates. A rotate meets the overlap rule (`409`, fact 1), a create meets no such rule.
   - `create` awaits the whole body (`await readText(req)`, api `src/token-routes.ts` line 232), validates it and then calls `store.create` (lines 225–259). The api reads a body when its event loop gets to that connection. Nothing orders that read against requests on other connections. So a create whose client process has already ended can still be applied after the api has answered a later request on another connection, for example the token list of a sweep. Only the end of the api process ends that possibility (decision 8 "Barrier").
   - Only the api process writes the token store, `/data/pulse.db` on the `api-data` volume (fact 8). The api runs as the container's main process (api `Dockerfile` line 19, `CMD ["bun", "--no-env-file", "src/main.ts"]`). A stopped container has no process left, including every `docker compose exec` process in it. SQLite rolls back a transaction that was not committed when the database is opened again.
8. **Where the services keep their data.**
   - The images set the data paths: api `PULSE_DB=/data/pulse.db` (api `Dockerfile` line 9), notify `PULSE_NOTIFY_STATE=/data/notify-state.json` (notify `Dockerfile` line 9), console `PULSE_CONSOLE_DB=/data/console.db` (console `Dockerfile` line 9). Probe and status keep no data.
   - The CLI renders `api-data:/data` (`cli/render-compose.ts` line 153), `notify-data:/data` (line 207) and `console-data:/data` (line 220). Every other mount of a pulse service is read-only: the `*-secrets` volumes at `/run/pulse` and the `./config/*` binds (lines 153, 175, 207, 220).
   - `compose.override.yaml` may change mounts. Compose merges service volumes by target, so an override entry for `/data` replaces the rendered one while the top-level `api-data` stays declared.
   - The guard requires every top-level volume to be named `<project>_<key>` and not external (`checkNames`, `cli/docker.ts` lines 326–345). It does not look at service mounts.

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
3. **One mutation lock.** `pulse init`, `pulse token rotate` and `pulse upgrade --yes` share the existing lock file `.pulse-init.lock` (exclusive create `wx` 0600, fact 5). The release rule stays: the holder removes the file only when its content is still the content it wrote.
   - The name stays, so an older CLI's `init` still excludes a running rotation or upgrade.
   - `up`, `down`, `status` and `logs` take no lock.
   - **Content.** Five lines: `pid <pid>`, `nonce <32 hex>`, `host <hostname>`, `started <text>` and `command <init|token rotate|upgrade>`. `<hostname>` is `os.hostname()`. `<text>` is the trimmed output of `ps -o lstart= -p <pid>` for the CLI's own pid. On Linux (procps) it prints for example `Wed Nov 11 11:33:39 2026` and exits 1 with no output for a missing pid (checked in this run). macOS `ps` documents the same `lstart` keyword; the implementer confirms it on the `macos-15` runner and quotes the output in the PR. When it differs, the lock stays correct: a lock whose `started` cannot be compared is never stale. When `ps` fails or prints nothing, the line is `started -`.
   - **Order.** The lock is taken first, before the guard and before the rotation journal or `upgrade.json` is read. The reconcile (decision 8), the barrier, the helper sweep (decision 13) and every recovery run only under the lock, also after a stale lock was broken.
   - **Stale lock.** On `EEXIST` the CLI reads the lock (`lstat`: a regular file, not a link, at most 1 KiB). The lock is *stale* only when all of these hold:
     1. it has all five lines in that order, and `started` is not `-`;
     2. `host` equals `os.hostname()`;
     3. the process is gone: `process.kill(pid, 0)` throws `ESRCH`; or it runs, but `ps -o lstart= -p <pid>` prints a text other than `started` (the pid was reused).
     - `EPERM` from `process.kill` means the process runs. A failing `ps` while the pid exists means "not stale". Any doubt means "not stale".
   - **Break.** A stale lock is removed only under the second lock file `.pulse-init.lock.break` (`wx` 0600, content `pid` and `nonce`):
     1. Create `.pulse-init.lock.break`. `EEXIST` refuses with `another pulse command is starting in <dir> (or remove .pulse-init.lock.break if none is)`.
     2. Read `.pulse-init.lock` again. It must be byte-equal to the content that was judged stale; otherwise remove the break file and refuse as "not stale".
     3. Unlink `.pulse-init.lock`, create the own lock with `wx` (an `EEXIST` here means another command took it in between: remove the break file and refuse), fsync the directory.
     4. Remove `.pulse-init.lock.break` and print `removed a stale .pulse-init.lock (pid <pid>, <command>)`.
     - So at most one process holds the lock: every holder created it with `wx`, and a breaker only unlinks the exact content it judged stale, while it holds the break file.
   - **Refusal.** A lock that is not stale refuses with exit 1 and `another pulse command is running in <dir> (or remove .pulse-init.lock if none is)`. When the lock has the five lines, a second line names `pid <pid>, <command>, host <host>`. An old two-line lock of an older CLI is never stale; the refusal is the same.
   - **Docs.** `docs/cli.md` "A stale `.pulse-init.lock`" (lines 217–219 today, only about `pulse init`) is rewritten: the three commands that hold the lock, the automatic break with its conditions, the manual way when the CLI refuses (`ps -ef | grep -E 'pulse (init|token|upgrade)'` must print no such command for this directory, on this host and any other host that shares it; then delete `.pulse-init.lock` and a left `.pulse-init.lock.break`), and that the interrupted command is then run again: a rotation resumes from its journal, an upgrade refuses and names the recovery (decision 13).
4. **Private transport to the api.** Every api call runs `docker compose <operation prefix> exec -T api bun -e <API_SCRIPT>`.
   - `API_SCRIPT` is a constant text. Its stdin carries one JSON line `{"method","path","bearer","body"}`.
   - The script calls `http://127.0.0.1:3000<path>` with a 10 s timeout and `redirect: "error"`. It prints the status code on line 1 and the body, capped at 1 MiB, after it.
   - The script ends itself. Besides the fetch timeout it starts an `unref`'d timer that calls `process.exit(70)` 11 s after the script starts. So the process in the container ends within 11 s even when the client was killed (killing `docker compose exec` does not end it, fact 5). The end of this client process says nothing about the api server: an unanswered write is settled only by the barrier of decision 8.
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
   2. **Rotate.** Journal `requested` (token id and its `rotatedAt` as read in the preflight) with `inFlight: "rotate"`, then `POST /admin/tokens/<id>/rotate`. Its outcome goes through the table of decision 8 "Rotate outcome", which is the same for the first run and the resume. Only the row `ok` continues straight to step 3.
   3. **Stage and save.** The host file changes only through a rename, and only after the journal names the token whose secret it gets:
      1. **Stage.** Write the received `secret` and a newline to the staging file `secrets/.pulse-next.<file>.<id>`. `<file>` is the host file name (`admin-token` or `probe-token-<loc>`) and `<id>` is the id of the token that the answer belongs to: `tokenId` after a rotate, the created id after a create. The write is the safe write (temp name `.<name>.tmp-<hex>` `wx` 0600 in `secrets/`, the `atomicWrite` pattern of `cli/write-install.ts` lines 279–296, then fsync, rename to the staging name, fsync of the directory).
      2. Journal `staged` with `activeTokenId := <id>` and `inFlight: null` (the `POST` was answered, decision 8 "Barrier").
      3. **Install.** Rename the staging file over the host file and fsync the directory.
      4. Journal `saved`.
      - So the journal state alone says what the host file holds: in `requested` and `replacing` it holds the pre-rotation secret of `tokenId`; from `saved` on it holds the secret of `activeTokenId`. In `staged`, the existence of the staging file says whether step 3 ran (a rename is atomic, and nothing else removes a staging file). Decision 8 "Reconcile" uses exactly this.
      - **Errors in this step.** The CLI never decides from the error which write did or did not land. Any error from the first write of step 1 to the end of step 4 is handled as decision 8 "Stage errors" says: the in-process reconcile, from the files on disk. Example: the rename to the staging name succeeds and the directory fsync after it throws. The staging file exists, so the reconcile takes the `requested` row and the item goes to `staged`, not to `replacing`.
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
   - **File.** `secrets/.pulse-rotation.json` (0600, written atomically with fsync like the secret files) holds `{format:1, kind, items:[…]}`. Each item has `tokenId`, `location?`, `file`, `service?`, `name`, `scopes`, `expiresAt`, `rotatedAtBefore`, `oldContainerId?`, `newContainerId?`, `activeTokenId?`, `revokeTokenId?`, `replacementName?`, `inFlight` (`null`, `"rotate"` or `"create"`; decision 8 "Barrier") and `state`. It never holds a secret. `inFlight` `"rotate"` is valid only in `requested`, `"create"` only in `replacing`, and every other state has `null`. Token ids must match `^tok_[0-9a-f]{24}$`, container ids `^[0-9a-f]{64}$`, and `state` one of the states below; a journal that breaks a rule refuses with its path and the rule. The file is removed when every item is `done`.
   - **Staging files.** `secrets/.pulse-next.<file>.<id>` (decision 7 step 3) hold one secret each, never in the journal. The name must match `^\.pulse-next\.(admin-token|probe-token-[a-z0-9][a-z0-9-]{0,31})\.(tok_[0-9a-f]{24})$`. Items run one after another, so at most one staging file exists, and only for the item that is in `requested`, `replacing` or `staged`.
   - **States**, in order: `requested` → (`replacing` →) `staged` → `saved` → `refreshing` → `refreshed` → `handoff` → `switched` → (`revoking` →) `done`. Every state is written and fsynced before the side effect that it names. A state never moves back; in particular an item never returns to `replacing` once it was `staged`. An item enters `replacing` only after a reconcile of that item found no staging file for it (from `requested` through the lost-answer rule; never straight from an error).
   - **Owned files.** The host file of an item (its `file`) is owned by the journal. In an `admin` journal that is `secrets/admin-token`. In a `probe` journal it is each item's `secrets/probe-token-<loc>`, and `secrets/admin-token` is owned by no item: no step of a probe rotation writes, stages or renames it.
   - **Reconcile.** It is the first step of every resume and of every stage error (below). It runs before any api write and before any owned host file is read as a bearer. Its only api calls are the read-only confirmations of the `replacing` row. It reads the journal from disk, never from memory, so the in-process run and a rerun take the same path. Validation order:
     1. Read and validate the journal (decision 8 "File"). A bad journal refuses before anything else.
     2. Delete every leftover safe-write temp file in `secrets/` whose name is `.<name>.tmp-<hex>` for a host file, a staging file or the journal. Its content counts as not stored. Then fsync `secrets/`. If that fsync fails, exit 1 with the journal as it is on disk; nothing else is done.
     3. List the staging files. Match each one against the table below **without any api call**, by the journal state of its item, its `<file>` and its id only. Each staging file must pass the name rule and the file checks of decision 9. It must also belong to an item of the journal: in a `probe` journal an `admin-token` staging file, and in an `admin` journal a `probe-token-*` staging file, match no row. A staging file that matches no row refuses with exit 1, its path, and `docs/cli.md#token-recovery`; nothing is changed and no api call is made.
     4. Only the `replacing` row with a staging file needs a confirmation from the api. The bearer depends on the kind:
        - **admin.** The bearer is the staged secret itself, read from the staging file that passed step 3. A staging file is not a host file.
        - **probe.** The bearer is `secrets/admin-token`. It is the one host file that the reconcile may read, because no item of a probe journal owns it (see "Owned files"), so no earlier or later reconcile action changes it. The order is fixed, and a failed step refuses before the next one:
          1. the staging checks of step 3 have passed (no api call so far);
          2. `lstat` of `secrets/admin-token`: a regular file, not a link, no group or other bits (decision 9);
          3. the read of `secrets/admin-token`, then `tokenContentValid` on its content;
          4. the capability call of decision 5 with that content as bearer: `GET /admin/tokens/self` answers `200` with the `admin` scope;
          5. the confirmation `GET /admin/tokens/<X>` with the same bearer.
          The file must be read before the capability call, because that call needs its content.
        - A confirmation that does not answer as the row says (another status, another id or name, `revokedAt` set) refuses with exit 1 and nothing changed.
     5. Act on the matched rows, one item after another, in journal order.

        | Journal state of the item | Staging file | Meaning | Action |
        | --- | --- | --- | --- |
        | `requested` | `.<file>.<tokenId>` | the rotate answer was stored, the `staged` write was lost | journal `staged` with `activeTokenId := tokenId`, then install and journal `saved` |
        | `replacing` | `.<file>.<X>`, X ≠ `tokenId`, and the api confirms X (step 4): for `admin`, `GET /admin/tokens/self` with the staged secret answers id X and name `replacementName` (this works also after the old secret's overlap); for `probe`, `GET /admin/tokens/<X>` with `secrets/admin-token` shows name `replacementName` and `revokedAt` null | the create answer was stored, the `staged` write was lost | journal `staged` with `activeTokenId := X`, then install and journal `saved` |
        | `requested`, `replacing` | none | no answer was stored | the rules below (`rotatedAt` check, lost answer) |
        | `staged` | `.<file>.<activeTokenId>` | the install did not run | install, journal `saved` |
        | `staged` | none | the install ran, the `saved` write was lost | journal `saved` |
        | `saved` or a later state | none | normal | nothing; resume by state |
        | any state | a staging file that matches no row above (another id, another file, a second staging file, or any staging file from `saved` on) | inconsistent | refuse |

     - "Install" in the table is the rename of decision 7 step 3.3 and the fsync of `secrets/`. Each journal write in the table is fsynced like every state. If any of them fails, the reconcile exits 1. It does not retry and does not move to another row. The journal on disk then names the row that the next reconcile takes.
     - Only after the reconcile does the CLI read an owned host file as a bearer. That file then holds what the state says (decision 7 step 3). The one host file that the reconcile itself reads is `secrets/admin-token` in a `probe` journal (step 4), which no item owns.
   - **Stage errors (first run and resume).** An error anywhere in decision 7 step 3 (a thrown write, fsync, rename or directory fsync, or a journal write) is not a lost answer by itself. The CLI drops the copy of the answer's secret that it holds in memory and runs the reconcile for the journal at once, in the same process.
     - The reconcile finds a staging file for the answer's id: the `requested` or `replacing` row moves the item to `staged` and installs. The run then goes on at the refresh.
     - The reconcile finds no staging file: no answer is stored. From `requested`, the lost-answer rule applies (`replacing`). From `replacing`, the created token is unheld: "Lost answer" goes back to its step 2, within the limit of two create `POST`s per item and run. The journal on disk still names `inFlight: "create"` (only the `staged` write clears it), so the barrier runs first, and then the sweep revokes the token. The barrier is not needed for an answered create, but the CLI decides from the journal on disk, as a rerun would.
     - The item is `staged` or later: the rows `staged` or `saved` apply.
     - The reconcile itself fails (for example the fsync of `secrets/` throws again): exit 1, journal kept. The rerun's reconcile decides from the same files.
     - Going from an error in step 3 straight to `replacing` is wrong (Counterexamples "Stage boundary"). The staging file may exist, and the table refuses `replacing` with a staging file of `tokenId`.
   - **Resume.** A rerun with a journal skips the overlap refusal for the items it names, rereads every item from the api, and resumes each item by its state:
     - `requested`: the class `none` of "Rotate outcome" below. When the journal names `inFlight: "rotate"`, the barrier runs first; then the CLI reads back the token and decides from that.
     - `replacing`: see "Lost answer" below. It starts at step 2, whose barrier runs when the journal names `inFlight: "create"`.
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
     - `switched`: run the final sweep of "Lost answer" step 5 when `replacementName` is set, then go to `revoking` when `revokeTokenId` is set, else `done`. No barrier is needed here: `inFlight` is `null` from `staged` on.
     - `revoking`: step 6 again.
   - **Rotate outcome (one table for the first run and the resume).** The item is in `requested` and the reconcile found no staging file for it. The CLI never decides from the transport error alone whether the api rotated.
     - **Answer classes** of a rotate `POST`:
       - `ok`: `API_SCRIPT` printed status `200` and the body parses: `token.id` equals `tokenId`, `secret` matches `^pulse_[A-Za-z0-9_-]{43}$`, and `previousValidUntil` is a number later than the request start.
       - `rejected`: `API_SCRIPT` printed a complete answer with status `400`, `401`, `403`, `404`, `405`, `409`, `413` or `429` and a JSON body. These are the api's refusals. The api checks auth, the grant rule and the token state before it changes anything, and the rotate itself is one database transaction (api `docs/rest-api.md` lines 498–520, `src/token-store.ts` lines 266–294).
       - `ambiguous`: anything else. That includes a timeout, a broken pipe, a non-zero exit of `docker compose exec` without a status line, a `5xx`, any other status, and a `200` whose body does not parse.
       - `none`: no answer is known. This is the resume of a `requested` item, where the previous run may or may not have sent the `POST`.
     - **Barrier before the readback.** After `ambiguous`, and after `none` when the journal names `inFlight: "rotate"`, the barrier ("Barrier" below) runs before the readback. So the readback is final: a rotate that it does not show was not applied and never will be. After `rejected` the api has answered the `POST`, so no barrier is needed; the CLI writes `inFlight: null` with the next journal write of the item.
     - **Readback.** For every class except `ok`, the CLI reads `GET /admin/tokens/<tokenId>`. For `admin` the bearer is the host file `secrets/admin-token`. The reconcile has ended, and in `requested` that file holds the pre-rotation secret, which still works during the overlap of a rotation that landed. For `probe` the bearer is `secrets/admin-token` after its file checks (decision 9). The readback is one of:
       - `same`: `200`, `rotatedAt` equals `rotatedAtBefore`, `revokedAt` null, and `expiresAt` null or in the future;
       - `changed`: `200` and `rotatedAt` differs from `rotatedAtBefore`;
       - `gone`: `200` with `revokedAt` set or `expiresAt` past and `rotatedAt` unchanged, or `404`;
       - `unknown`: anything else, including a timeout.
     - **Table.**

       | Class | Readback | Meaning | Action |
       | --- | --- | --- | --- |
       | `ok` | not read | rotated, secret held | stage and save (decision 7 step 3) |
       | `rejected` | `same` or `gone` | the api refused and changed nothing | drop the item and every later item that is still `requested` from the journal (remove the journal when no item is left that is not `done`). Exit 1 with the status and a fixed text per status: `409` uses the api's reason from the readback (`in its rotation overlap until <ISO>`, `revoked`, `expired`). The host file is unchanged. |
       | `ambiguous` or `none` | `same` | the rotate did not happen and, after the barrier, cannot happen later | one more `POST` in this run (the first one after a `none`), again with `inFlight: "rotate"` written first, whose outcome goes through this table again. A second `ambiguous` + `same` in the same run exits 1 with the journal kept in `requested` and `inFlight: null` (its barrier has run). |
       | `ambiguous` or `none` | `gone` | the token was revoked or expired by someone else | as `rejected` + `gone`: drop, exit 1, the docs say to create a probe or admin token by hand |
       | `rejected`, `ambiguous` or `none` | `changed` | the api rotated and the answer is not held, or another client rotated it | the lost answer below (`replacing`) |
       | any | `unknown` | not known | exit 1, journal kept in `requested` (with `inFlight: null` when the barrier ran or the class was `rejected`); the rerun reads back again |
     - A `rejected` + `changed` row means that another client rotated the token after the preflight read. An earlier `POST` of this item cannot be the cause: the barrier ran after every unanswered `POST` before the next one was sent. The lost-answer path recovers either way, because the CLI holds no secret of the new rotation.
     - The overlap refusal of decision 6 is skipped for a journal item. The table's `409` row is the only way an item in overlap ends the run.
     - A `POST` is sent at most twice per item and run.
   - **Lost answer.** It applies only in two cases. One is the row "→ `changed`" of "Rotate outcome", in the first run and on resume alike. The other is a stage error whose reconcile found no staging file for an `ok` answer ("Stage errors"): the api rotated and the secret is not stored. A staging error alone never triggers it, and neither does a transport error without a readback. A secret that is not in a staging file counts as lost, and a rotate `POST` is never repeated blindly.
     1. Journal `replacing` with `revokeTokenId := tokenId`, `replacementName` and `inFlight: null`: the name is the old name cut to 90 characters, a space, `r` and 6 random hex characters. `inFlight` is `null` because both entry cases follow an answered rotate or a barrier. The journal holds the name before the create, so a create that landed can be found again. The name stays the same for every create of the item.
     2. **Barrier, then sweep.** When the journal on disk names `inFlight: "create"`, the barrier ("Barrier" below) runs first. Then read `GET /admin/tokens`. Every token whose `name` equals `replacementName` and whose `revokedAt` is null is an orphan: this step runs only in state `replacing` after the reconcile found no staging file, and in that state no host file and no staging file holds a replacement's secret (decision 7 step 3). Revoke each orphan through the revoke guard. A revoke is confirmed by `200`, or by a readback `GET /admin/tokens/<id>` with `revokedAt` set. An orphan that is not confirmed revoked exits 1 with the journal kept in `replacing` and sends no create.
     3. **Create.** Journal `replacing` with `inFlight: "create"` (durable), then `POST /admin/tokens` with `{name: replacementName, scopes, location?, expiresAt?}` of the lost token. For `admin` the bearer is the host file, which in `replacing` still holds the pre-rotation secret of `tokenId` (valid until the lost rotate's `previousValidUntil`). For `probe` it is the admin secret. The answer is classed like a rotate answer: `ok` is a `201` whose body parses (`token.name` equals `replacementName`, the secret rule), `rejected` is a complete answer with a status from the `rejected` list, and anything else is `ambiguous`.
        - `ok`: step 4 (its `staged` write sets `inFlight: null`). If a stage error's reconcile then finds no staging file for the created id, the created token is unheld: back to step 2, whose barrier and sweep revoke it.
        - `rejected`: the api answered and made no token (fact 1: it refuses before any change). Journal `replacing` with `inFlight: null`, then exit 1 with the status, no second create in this run. No earlier create of the item can be pending, because a barrier ran after every unanswered one.
        - `ambiguous`: back to step 2. Its barrier ends the api process, so this create is then committed or never will be, and its sweep revokes the token if it was committed.
        - **Limit.** A create `POST` is sent at most twice per item and run. When step 3 is reached a third time, the CLI does not create. It has just run step 2 with its barrier, so it exits 1 with the journal kept in `replacing` and `inFlight: null`, no create pending and no unheld replacement active. The rerun starts at step 2.
        - **Order rule.** While the journal on disk names `inFlight` for the item, the CLI sends no `POST`, reads no token list for a sweep and reads back no token of the item until the barrier has run. This holds across runs, because the rerun reads `inFlight` from disk. The one exception is the reconcile's confirmation of a staging file (decision 8 "Reconcile" step 4): a staging file exists only for a `POST` whose answer was parsed, so that `POST` is not pending. When the confirmed row moves the item to `staged`, that write clears `inFlight`; when the confirmation refuses, nothing is written or sent.
     4. Stage and save as in decision 7 step 3 with the created id, then refresh and switch.
     5. **Final sweep** (state `switched`, also on resume). Read `GET /admin/tokens` and revoke, through the revoke guard, every token whose `name` equals `replacementName`, whose `revokedAt` is null and whose id is not `activeTokenId`. With the barrier it finds none; it is the backstop for a defect in that rule. When it revokes, it prints `revoked <n> unheld replacement token(s)`. An unconfirmed revoke exits 1 with the journal kept in `switched`; the rerun runs this step again. Then step 6 of decision 7 revokes `revokeTokenId`, and the journal can only be removed after both.
     6. Print `the rotate answer was lost; replaced token <revokeTokenId> with <activeTokenId>`.
     - Revoking the lost admin is not refused by the last-admin rule, because the replacement is active by then.
     - For `admin` in state `replacing` after the old secret's `previousValidUntil`, the CLI cannot authenticate. It exits 1 and names the recovery in the docs: another admin token, or a database backup.
   - **Barrier (unanswered writes).** A rotate or create `POST` without a parsed answer may still be pending in the api server after its client has ended (fact 7). Creates make a second token with the same name, and a late rotate would invalidate a secret the CLI already handed out. So the CLI treats the api state as final only after the api process has ended.
     1. **Marker.** Before each rotate `POST` the item's journal state (`requested`) is written with `inFlight: "rotate"`, before each create `POST` (`replacing`) with `inFlight: "create"`, durable. A parsed answer of class `ok` or `rejected` means the api has finished the request. `inFlight` is cleared by the next journal write of the item: `staged` after `ok`, the drop or the `inFlight: null` write after `rejected`, the barrier's own write after it ran. An `ambiguous` answer, a stage error before `staged` and a killed run leave it set on disk.
     2. **When.** Whenever the journal on disk names `inFlight` for the item, the barrier runs before any readback, sweep or `POST` of that item, in the first run and on every resume. It never runs while `inFlight` is `null`, so a rotation whose every answer was parsed restarts no api.
     3. **Steps.**
        1. `docker compose <prefix> ps --all --no-trunc --format json api` must show exactly one container. Record its id.
        2. `docker compose <prefix> stop --timeout 10 api` must exit 0.
        3. `docker inspect --format json <id>` must show `State.Running` false and `State.Pid` 0. Then no process of the container is left: not the api server, and not any `API_SCRIPT` process that `exec` started in it (fact 7). Only that server writes the token store, so every earlier write of the item is committed or never will be.
        4. `docker compose <prefix> start api`, then `waitReady` for `api` with `--timeout`.
        5. Journal the same state with `inFlight: null` (durable).
        6. Print `restarted the api to settle an unanswered token <rotate|create> (<ms> ms)`.
     4. **Failure.** A failure in steps 1–4 exits 1 with the journal kept and `inFlight` still set, and prints `the api may be stopped; run pulse token rotate <kind> again (or pulse up)`. The rerun runs the barrier again: `stop` of a stopped container exits 0. The api service has `restart: unless-stopped` (`common/services.yaml` line 9, copied by `pulseBase`), which Docker does not apply after a `stop`, so the api stays down until the rerun or `pulse up`.
     5. **Effect.** The api is down for its stop, start and readiness, a few seconds. The probes keep their results in their buffer and deliver them afterwards with their original `timestamp` (fact 3). Status and console answer errors meanwhile. Only the recovery paths reach the barrier.
     6. **Why no weaker rule.** The end of the client process (the settle scan of the fifth spec) does not prove that the api has read and handled the body. The api gives no order across connections (fact 7), so a create could still be applied after a sweep or after the final sweep. The final sweep (step 5) stays as a backstop.
   - **Revoke guard.** Before every revoke (orphans in step 2, `revokeTokenId` in step 6), the CLI calls `GET /admin/tokens/self` with the bearer it is about to use. It refuses, exit 1 with the journal kept and `refusing to revoke the token that authenticates this call (<id>); see docs/cli.md#token-recovery`, when the answered id equals the target. It also never revokes `activeTokenId`. The api allows a token to revoke itself while another admin is active (Grant and Last-admin rules, api `docs/rest-api.md` lines 498–500), so only the CLI can prevent it.
   - **Interrupt.** SIGINT and SIGTERM are recorded and acted on only at the next step boundary. From writing `requested`, `replacing` or `revoking` until the api answer is handled, staged, installed and the next state after it (`saved`, or the next state after a revoke) is written, the signal waits. The in-process reconcile after a stage error is part of this section, and so are every barrier, the readback and the second `POST` of "Rotate outcome", every sweep of "Lost answer" (steps 2 and 5) and the second create. So a signal never ends a run between an unanswered `POST` and its barrier, except through a failure of the barrier, which keeps `inFlight` on disk. The barrier is bounded by its timeouts (10 s stop, `--timeout` readiness). The CLI then exits 130 with `interrupted; run pulse token rotate <kind> again to finish`. The journal stays. A hard kill inside this section is covered by the reconcile.
   - While the journal exists, a plain run without it is impossible: `pulse token rotate` always resumes it first, and `pulse upgrade --yes` refuses.
9. **File checks for rotation.**
   - `secrets/` must be a directory, not a link, and no wider than 0700.
   - Each target file, staging file and the journal must be a regular file, not a link, with no group or other bits. So must `secrets/admin-token` whenever it is used as a bearer, also in a `probe` rotation and in the reconcile (decision 8 step 4). Each of these token files must hold a valid token (`tokenContentValid`, `cli/tokens.ts` lines 40–43).
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
    - **Data mounts.** The snapshot must hold every store that the pulse services write (fact 8). The CLI reads the effective model of the guard's resolution call (`docker compose config --format json`, `cli/docker.ts` lines 294–307, with the override). For every pulse.json service of kind `pulse` it looks at the service's `volumes` list, in the long form that Compose prints:
      - Each entry must be either a `volume` entry whose `source` is a top-level volume key, or a `bind` entry with `read_only: true`. Anything else refuses: a writable `bind`, a `tmpfs`, a `volume` entry without `source` (anonymous), and any other type.
      - A `volume` entry is *writable* when `read_only` is absent or false. The snapshot set is the sorted, de-duplicated list of the sources of all writable `volume` entries of all pulse services. The key name does not matter: no `-data` suffix is needed, and a declared volume that no pulse service mounts writable is not in the set.
      - api, notify and console must each have exactly one writable `volume` entry whose `target` is exactly `/data`, the directory of their image's data path (fact 8). A missing or read-only `/data` volume refuses.
      - The data path variable of the service (`PULSE_DB`, `PULSE_NOTIFY_STATE`, `PULSE_CONSOLE_DB`) must be absent from the effective `environment` or equal the image default literally (`/data/pulse.db`, `/data/notify-state.json`, `/data/console.db`). Any other value, also one with `${…}` (the resolution call does not interpolate), refuses.
      - Each volume of the set is mounted by the snapshot helper under its name `<project>_<key>`. The guard has already checked that name (fact 8).
      - Refusal texts: `<svc> keeps <target> in a <type> mount; pulse upgrade can snapshot only named volumes; see docs/cli.md#upgrade`, `<svc> has no writable volume at /data; see docs/cli.md#upgrade` and `<svc> sets <VAR> to another path; see docs/cli.md#upgrade`.
      - The check runs in step 2 of decision 13, before provenance, so the preview refuses too. Nothing is pulled or stopped before it passes.
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
    - **States** of `upgrade.json`:
      - `snapshotting` → `applying` → `done`;
      - `snapshotting` → `aborted`;
      - `applying` → `rolling-back` → `restored` → `rolled-back` | `rollback-failed`;
      - `rolling-back` → `rollback-failed`.
      - Each state is written atomically (temp file `wx`, fsync, rename, fsync of the directory) before the step it names. `rollback-failed` carries `restored: true|false`: `true` when it follows `restored`.
    - **Durable state.** A state write is *durable* when all four parts of the write returned without error. A write that throws in any part is resolved by "State-write errors" below and never counts as durable.
    - **Truthful state before start.** The CLI runs `docker compose up -d` only after one of these:
      - the `aborted` write of the abort path, durable or not. The abort path is entered only while the file on disk reads `snapshotting`, so the file then reads `snapshotting` or `aborted`, and the CLI has changed neither `compose.yaml` nor a volume;
      - a durable `applying` (the switch, step 10). A read-back `applying` after a failed write is not enough for the switch: it leads to the rollback;
      - a durable `restored` (the rollback).
      So a stack that runs while `upgrade.json` is not terminal always matches the manual recovery of that state (below).
      - In addition, every `up -d` of the upgrade, the abort and the rollback comes after a helper sweep (below) that ended with no helper left.
    - **Helpers.** The snapshot and restore containers are *helpers*. A helper runs as a standalone `docker run` container, so killing its client or the CLI does not end it (fact 5), and `pulse down` does not see it (fact 5).
      - **Labels.** Every helper is started with `--label io.github.lorenzh.pulse.install=<installId>` (the existing `INSTALL_LABEL` with the install id of `pulse.json`) and `--label io.github.lorenzh.pulse.helper=<snapshot|restore>`, besides its name.
      - **Helper sweep.**
        1. List: `docker ps --all --quiet --no-trunc --filter label=io.github.lorenzh.pulse.helper --filter label=io.github.lorenzh.pulse.install=<installId>`.
        2. For each id: `docker rm -f <id>`. Docker returns from it after the container has been killed and removed, so no process of it changes a volume afterwards.
        3. List again. It must print nothing. Up to 3 rounds within 30 s; otherwise exit 1 with the ids left and `docs/cli.md#upgrade-recovery`, with no state write, no restore and no start.
        - It prints `removed <n> leftover helper container(s)` when n > 0.
      - **When it runs.**
        - In step 1 of every `upgrade --yes`, after the lock and the guard and before the refusal for a non-terminal snapshot directory. The lock is held, so a helper that exists now belongs to a run that has ended. A refused run has therefore still removed every leftover helper.
        - In step 1 of the abort, instead of a removal by name.
        - In the rollback before the first restore helper, and after every restore helper that exits non-zero or whose spawn throws, before the next state write.
        - Before every `up -d` of the upgrade, the abort and the rollback.
      - A restore helper exists only between the durable `rolling-back` and the durable `restored`. So a helper found by a sweep means the state on disk is `rolling-back` (or a failed write after it), and the volumes must be restored again.
    - **Steps.**
      1. Preflight: lock (with the stale-lock break of decision 3), guard, the helper sweep, no rotation journal, and no snapshot directory under `.pulse-upgrade/` whose `upgrade.json` is `snapshotting`, `applying`, `rolling-back`, `restored` or `rollback-failed` (a directory without a readable `upgrade.json` counts as `snapshotting`). A refusal names that directory and `docs/cli.md#upgrade-recovery`.
      2. Selection, the data-mount check (decision 10 "Data mounts") and provenance, then a table of service, from version and 12-hex digest, to version and 12-hex digest, and `provenance verified`. Without `--yes`, print `run pulse upgrade --yes` (with the same `--to`) and exit 0 here. A preview writes no file and changes no container.
      3. `docker pull <ref>@<digest>` for every new image. A failure or an interrupt exits 1 or 130, and nothing is stopped.
      4. Create `.pulse-upgrade/<UTC stamp>-<6 hex>/` (0700, `mkdir` that fails if it exists). Write `upgrade.json` `{format:1, from:{svc:ref}, to:{svc:ref}, composeSha256, snapshotVolumes:[<key>…], state:"snapshotting"}`. `snapshotVolumes` is the snapshot set of decision 10 "Data mounts". Print the start time; the downtime starts at the next step.
      5. `docker compose <prefix> stop`.
      6. For each key of `snapshotVolumes`, in its order (for the rendered layout: `api-data`, `console-data`, `notify-data`):
         - Open `<key>.tar.part` (0600, `wx`) and give its fd to the spawn as stdout of `docker run --rm --name <project>-pulse-snapshot-<6 hex> <helper labels> --network none --user 0:0 --cap-drop ALL --cap-add DAC_OVERRIDE --security-opt no-new-privileges:true -v <project>_<key>:/from:ro <image of secrets-init from the resolved config> tar -C /from -cf - .`.
         - The helper must exit 0. Then fsync the file, compute its size and sha256, rename it to `<key>.tar`, and fsync the directory.
      7. Copy `compose.yaml` to `compose.yaml` in the snapshot (0600, fsync). Its sha256 must equal `composeSha256`.
      8. **Snapshot-complete boundary.** Write `upgrade.json` with `state:"applying"` and `tars:{<key>:{bytes, sha256}}`. The keys of `tars` must equal `snapshotVolumes`; reading a file where they differ is a validation failure. The boundary is crossed when the file on disk reads `applying` with these `tars`: after a durable write, or after a failed write whose read-back shows them (for example the rename landed and the directory fsync threw). Print `snapshot <bytes> bytes in <ms> ms`.
      9. Edit `compose.yaml`:
         - Replace each old image string with the new one. The count of replacements must equal the number of services that used it.
         - Parse the new text again and check that it equals the old model with only those `image` values changed.
         - Write atomically with the old mode.
      10. `docker compose <prefix> up -d`, then `waitReady` with `--timeout` (default 300 s, 1–3600).
      11. On success: `upgrade.json` `done`, print `upgraded; the stack was down for <ms> ms; snapshot kept in <dir>`. The snapshot is the only way back to the older version. Exit 0.
    - **Abort before the boundary** (a failure or an interrupt in steps 4–8 while the file on disk reads `snapshotting`):
      1. The helper sweep ends every snapshot helper. Killing only the `docker run` client is not enough (fact 5). A failed sweep exits 1 with the state left as it is on disk and no start.
      2. `compose.yaml` was not edited. Its sha256 must still equal `composeSha256`. If not (only a person or another program can have changed it, as the lock excludes the CLI), the run stops: no start, no deletion, the state stays `snapshotting`, exit 1 with the recovery link.
      3. Write `upgrade.json` `aborted`. No volume is touched: no restore helper runs.
      4. Only after a durable `aborted`: delete every `*.tar.part` and `*.tar` file in the snapshot directory and fsync it. If the `aborted` write fails, every archive stays, and the message adds `snapshot directory kept: <dir>`. A failed delete is printed with the file names and does not stop the abort.
      5. `docker compose <prefix> up -d`, then `waitReady`. Print `upgrade aborted before the switch: <reason>; the previous images were started again`. Exit 1, or 130 after an interrupt.
      - So archives are deleted only while the file on disk reads `aborted`, and the abort path is entered only while it reads `snapshotting`. An `applying` file never points to deleted archives.
    - **State-write errors.** An error in any part of a state write (temp write, temp fsync, rename, directory fsync) does not by itself say whether the new state landed. The CLI reads `upgrade.json` back from disk, validates it, and acts on what it reads:

      | Write that failed | Read back | Action |
      | --- | --- | --- |
      | `snapshotting` (step 4) | anything | nothing is stopped yet. Remove the files the run created in the new directory and the directory, then exit 1. If that removal fails too, the next run refuses for the directory (counts as `snapshotting`). |
      | `applying` (step 8) | `snapshotting` as written in step 4 | the rename did not land: abort before the boundary |
      | `applying` | `applying` with the `tars` just computed | the rename landed, for example the directory fsync threw: the boundary is crossed, so roll back. The volumes and `compose.yaml` are still unchanged here, so the restore writes the same data. The archives stay, because the file on disk says the snapshot is complete. |
      | `aborted` | anything | step 4 of the abort: keep every archive, start the old images, exit 1 |
      | `rolling-back` | anything | `docker compose <prefix> stop` (new images may be running after a failed readiness; a stop changes no file and no volume), then no restore and no start. Exit 1 with `upgrade stopped: the state file could not be written; the stack is stopped; see docs/cli.md#upgrade-recovery`. |
      | `restored` | anything | the same stop. The volumes and `compose.yaml` are restored but no container is started. |
      | `done`, `rolled-back`, `rollback-failed` | anything | the stack is in its final shape. Print the result line, then `the state file could not be written; see docs/cli.md#upgrade-recovery`, exit 1. |
      | `applying` | unreadable, invalid, or another content | stop: no deletion, no restore and no start, exit 1 with the recovery link |

      - The read-back is a plain read after the error. It is not repeated, and the write is not retried.
      - Signals that arrive while a state write is resolved are recorded and acted on after the row's action, as in the rollback.
    - **Rollback after the boundary** (a failed edit, a failed `up`, a failed one-shot, a timeout, an interrupt from step 9 on, or the `applying` row of "State-write errors"):
      1. `upgrade.json` `rolling-back` (durable), then `docker compose <prefix> stop`.
      2. Verify every tar against `tars` (size and sha256) and the snapshot `compose.yaml` against `composeSha256` before any volume is changed. A mismatch restores nothing and goes to `rollback-failed` with `restored: false`. The stack stays stopped.
      3. The helper sweep. Then for each tar: `docker run --rm -i --name <project>-pulse-restore-<6 hex> <helper labels> --network none --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --security-opt no-new-privileges:true -v <project>_<key>:/to <same image> sh -c 'find /to -mindepth 1 -delete && tar -C /to -xpf - && sync -f /to'`, with the tar fd as stdin. It must exit 0.
         - `sync -f /to` flushes the filesystem that holds the volume (`syncfs`, fact 5) and exits non-zero when that fails. So exit 0 of the helper means the restored files of this volume are on disk. A tar extraction without the sync is not enough: the `upgrade.json` fsync does not flush the volume.
         - A non-zero exit or a spawn error: the helper sweep, then `rollback-failed` with `restored: false`, and the stack stays stopped.
      4. Restore `compose.yaml` atomically from the snapshot copy (the safe write: fsync of the file and of the directory). A failure goes to `rollback-failed` with `restored: false`.
      5. `upgrade.json` `restored` (durable), written only after every restore helper of step 3 exited 0, including its sync, and step 4 returned without error. From here the volumes and `compose.yaml` hold the old version on disk, also after a power loss.
      6. `up -d`, then `waitReady` with the same timeout.
      - If the rollback is ready: state `rolled-back`, print `upgrade failed: <reason>; rolled back to the previous images and data; ready`, exit 1 (130 when an interrupt started it).
      - Otherwise: state `rollback-failed` with `restored: true`, print `upgrade failed and the rollback failed: <reason>; snapshot in <dir>; see docs/cli.md#upgrade-recovery`, exit 1 (130 when an interrupt started it).
      - Signals during the rollback are recorded, not acted on. The rollback is bounded by its timeouts.
    - **Hard kill and manual recovery.** A run killed without a chance to act, or stopped by a state-write error, can leave any non-terminal state, a stale lock (decision 3) and running helpers. The next `upgrade --yes` breaks the stale lock, removes the helpers, then refuses (step 1). `docs/cli.md#upgrade-recovery` gives the steps per state. Each step follows from facts on disk, and the "Truthful state before start" rule makes them hold:
      - **First, in every state: stop the helpers.** With the install id from `pulse.json`: `docker ps --all --quiet --filter label=io.github.lorenzh.pulse.helper --filter label=io.github.lorenzh.pulse.install=<installId>`, `docker rm -f` each id, and list again until it prints nothing. (A refused `pulse upgrade --yes` has already done this under the lock; the docs still give the commands, because a person may reach this page without that run, and they do not suggest `pulse upgrade --yes` as a recovery step, since in a terminal state it would start an upgrade.) Only then run `pulse down`, a restore or `pulse up`. A restore helper that still runs can delete or extract files while a manual restore or a started api uses the same volume. `pulse down` does not stop it.
      - The manual restore command is the one of rollback step 3, including `sync -f /to`.
      - no readable `upgrade.json`, or `snapshotting`: the CLI changed neither `compose.yaml` nor a volume. Remove the directory and run `pulse up`.
      - `aborted`: nothing to recover. The directory may be removed. It can still hold archives when the `aborted` write failed.
      - `applying`:
        - `compose.yaml` byte-equal to the snapshot copy: the new images never started. The edit is the only change and it is atomic, and a rollback writes a durable `rolling-back` before it restores anything. Do not restore. Remove or move the directory and run `pulse up`.
        - `compose.yaml` holds the `to` refs and `pulse status` exits 0: the upgrade worked and only `done` was not written. Remove or move the directory.
        - Otherwise: `pulse down`. Check every tar against `tars` with `sha256sum`. Restore each tar and `compose.yaml` with the commands of the rollback, then run `pulse up`.
      - `rolling-back`: the volumes may be partly restored. Do not start the stack first. Run `pulse down`, check the tars, restore every tar and `compose.yaml`, then run `pulse up`.
      - `restored`: the volumes and `compose.yaml` hold the old version. Do not restore again. Run `pulse up`.
      - `rollback-failed`: with `restored: true`, as `restored`, then find out why the old images are not ready. With `restored: false`, as `rolling-back` when every tar matches. Otherwise use a backup.
      - In every case, remove or move the directory before the next `pulse upgrade --yes`.
    - Data volumes are never deleted outside the restore. The `*-secrets` volumes are not in the snapshot set: the pulse services mount them read-only (fact 8), and `secrets-init` rewrites them from `secrets/` at each start.
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
- `### Token recovery` explains the journal states, the staging files `secrets/.pulse-next.*` (they hold a secret; never delete one by hand while a journal exists, rerun the command instead), the refusals of the reconcile table and the revoke guard, the rows of "Rotate outcome" that drop an item or keep the journal, the barrier (why the api restarts on a recovery path, and that `pulse up` starts it when a barrier failed), the two sweeps of a replacement (and how to list tokens named `replacementName` by hand), extra probe containers, the admin case after the overlap, and the stale lock after a hard kill (decision 3).
- `## pulse upgrade` names the supported data layout of decision 10 "Data mounts" (named volumes only, one writable volume at `/data` for api, notify and console, the default data paths) and how to move a bind-mounted store back into its volume before an upgrade.
- `### Upgrade recovery` gives the steps per state of decision 13 "Hard kill and manual recovery" (including `restored` and the two kinds of `rollback-failed`), with the commands for the tar check and the restore (`… && sync -f /to`). Its first step, before `pulse down`, is the removal of the helper containers by label, with the commands. It also names the stale lock (decision 3).
- `## A stale .pulse-init.lock` (today lines 217–219) is rewritten as decision 3 "Docs" says.
- The known limits name the doubled runs during a probe handoff with the bound for I ≥ 200 ms and the separate estimate for shorter intervals (Performance impact item 2).

## Risks

- **Compose `--scale` behavior.** The live test proves the start-new-then-stop-old handoff. That includes one container per probe service afterwards, and `pulse up` and `pulse status` working after the rotation. If Compose renumbers or recreates the container in a way that breaks this, the implementer requests a hold and does not fall back to stop-then-start, which breaks the gap rule (see Counterexamples).
- **Extra samples.** During the handoff two probe containers post for the same location for the window W. For I ≥ 200 ms the doubled runs per check are at most `floor(W / (I − e)) + 1` (Performance impact item 2): 2 at 5000 ms and 7 at 1000 ms for W = 6000 ms. Below 200 ms that formula is not used. The estimate there is `floor(W / max(I, R)) + 1` with R the run time of the check, about 600 to 3000 at the 1 ms minimum for W = 6000 ms. Both are documented as a known limit.
- **The api restarts on a recovery path.** The barrier (decision 8) stops and starts the api after every unanswered rotate or create. Status and console show errors for a few seconds, and probe results arrive late from the probe buffer (fact 3). A normal rotation never reaches it. If the barrier fails after the stop, the api stays down until a rerun or `pulse up`; the message says so.
- **Stale lock on another host.** A lock written on another host, or by a CLI whose `ps` failed, is never broken automatically (decision 3). The person removes it after checking; the docs say how.
- **Volume sync.** `sync -f` flushes the whole filesystem that holds the volume, which can take longer on a busy host. It runs only in a rollback. If the docker daemon's data root does not report writeback errors (Linux before 5.8), a lost write can stay unnoticed; the docs name the kernel requirement.
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
     - Per location over [T0 − 30000, T1 + 30000] ms: the gap rule holds, and E ≤ 2·floor(W / 4900) + 3. The constants are literals: 4900 is I − e with I = 5000 and e = 100 (Counterexamples "Extra samples", lemma bound 2). With W = 6000 the bound is 5. I = 5000 is inside the lemma's domain (I > 700) and inside the doubled-runs domain (I ≥ 200). The precondition check above fails the job when the demo check has another interval, so a bound is never applied outside its domain.
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
   - **Unsupported data layout.** The test writes a `compose.override.yaml` that mounts a fresh 0700 temp directory as a writable bind at `/data` of `api`. `pulse upgrade --to <B>` and `pulse upgrade --yes --to <B>` each exit 1 with `pulse upgrade can snapshot only named volumes` (literal from decision 10). The sha256 of `compose.yaml`, the container ids and `StartedAt` are unchanged, no image of B is present locally (`docker image inspect` fails for each B digest), and `.pulse-upgrade/` does not exist. The test then removes the override, which leaves the stack as before (no `pulse up` is needed, because the override was never applied).
   - **Interrupted snapshot.** With `cli/test/fail-ready-docker` first on PATH and `PULSE_TEST_HOLD_SNAPSHOT=1` (the shim sleeps 20 s inside each snapshot `tar -cf` run), `pulse upgrade --yes --to <B>` runs in the background. When the first `*.tar.part` exists, the test sends SIGINT. Then:
     - The run exits 130 and prints `upgrade aborted before the switch`.
     - `upgrade.json` is `aborted`, and the snapshot directory has no `*.tar.part` and no `*.tar`.
     - `compose.yaml`'s sha256 equals the pre-upgrade sha256, no `docker ps --all` row has the name `*-pulse-snapshot-*` or `*-pulse-restore-*`, and none has the label `io.github.lorenzh.pulse.helper`.
     - `pulse status` exits 0 and the A migration fixture holds (schema 3, 404).
   - **Broken B.** With the shim first on PATH, `PULSE_TEST_FAIL_READY_SERVICE=console` and `PULSE_TEST_FAIL_READY_TAG=<B>`, `pulse upgrade --yes --to <B> --timeout 120` exits 1 with `rolled back to the previous images and data; ready`. Then:
     - `compose.yaml`'s sha256 equals the pre-upgrade sha256.
     - Every running pulse container's image is the A digest (`docker compose ps --format json`).
     - `pulse status` exits 0.
     - The A migration fixture holds: schema 3. The api migrated to 9 during the failed upgrade, so 3 proves the data restore.
     - `always-healthy` has a result older than the upgrade start, and a new result within 60 s after the rollback.
     - No container with the label `io.github.lorenzh.pulse.helper` exists (`docker ps --all --filter label=…` prints nothing).
   - **Hard kill during a restore.** The shim gets `PULSE_TEST_HOLD_RESTORE=1`: it rewrites the restore helper's script to `find /to -mindepth 1 -delete && sleep 60 && tar -C /to -xpf - && sync -f /to`, so the helper holds after the deletion. With the Broken-B variables too, `pulse upgrade --yes --to <B> --timeout 120` runs in the background. When `docker ps --filter label=io.github.lorenzh.pulse.helper=restore` shows a running container, the test sends SIGKILL to the `pulse` process. The expected values are literals:
     - Right after the kill, the helper container still runs (1 row), `upgrade.json` reads `rolling-back`, and `.pulse-init.lock` exists. This shows the race that the helper sweep closes.
     - `pulse upgrade --yes --to <B>` runs at once. It exits 1, prints `removed a stale .pulse-init.lock`, `removed 1 leftover helper container(s)` and refuses with the snapshot directory and `docs/cli.md#upgrade-recovery`. Afterwards no helper container exists, `.pulse-init.lock` does not exist, and no pulse service container was started by that run (the container ids and `StartedAt` of the stopped services are unchanged).
     - The test then follows `### Upgrade recovery` for `rolling-back` with a shell function that runs the documented commands in their documented order: helper removal by label, `pulse down`, `sha256sum` of every tar against `tars`, the restore command with `sync -f /to` per volume, the `compose.yaml` copy, `pulse up`. Afterwards `pulse status` exits 0 and the A migration fixture holds (schema 3). Then it removes the snapshot directory.
   - **Real B.** `pulse upgrade --yes --to <B>` exits 0. Then:
     - The running images are the B digests from the registry.
     - The B migration fixture holds (schema 9, 200).
     - `pulse status` exits 0.
     - `installId`, `secrets/*` sha256 and the `.env` sha256 are unchanged.
     - `always-healthy` still has a result older than the first upgrade start.
     - `pulse token rotate probe` now passes the capability check: it exits 0.
3. **Unit tests** (`bun run test`, coverage threshold from `bunfig.toml`). They cover every rule in Counterexamples, with literal inputs and expected values. Two failure-injection matrices are required:
   - **Rotation.** A fake api and `cli/test/fake-docker.ts` stop the run (simulated SIGINT, and separately a thrown spawn error) at every journal state of decision 8 for one probe and one admin item, plus a lost rotate answer and a lost create answer. Each case then reruns to the end, and asserts: exactly one rotate that the fake api applied per token, at most two rotate `POST`s per item and run, at most one active replacement, every orphan and the lost token revoked, exactly one container of the service, the host secret equal to the container secret, and no journal left.
   - **Stage boundary.** For the rotate path and the replacement (create) path, each for `admin` and `probe`, a failing file seam hits each of these points: the staging temp write, the temp file fsync, the rename to the staging name, the directory fsync after that rename, the `staged` journal write, the install rename, the directory fsync after the install, and the `saved` journal write. Each point is hit in two ways:
     - **A thrown error.** The same run must go on through the in-process reconcile (decision 8 "Stage errors"). It ends with exit 0, or with exit 1 and the journal kept when the reconcile's own fsync of `secrets/` is made to fail too. In that case a rerun goes to the end.
     - **A simulated hard kill** that ends the run without cleanup. It leaves `.pulse-init.lock` with the killed run's content, and the lock seam reports that pid as gone. The rerun prints `removed a stale .pulse-init.lock` before it reads the journal and goes to the end.
     - The fake api models the real auth rules: a revoked token's secrets answer `401`, a token may revoke itself, and the last-admin rule.
     - Each case asserts:
     - no revoke call targets `activeTokenId` or the token that authenticates the call, and no api call answers `401`;
     - the journal never shows `replacing` while a staging file of the item exists. The test checks this after each journal write. This covers the post-rename directory-fsync case of the third plan review: the run journals `staged` with `activeTokenId` = `tokenId`, never `replacing`, and sends no create;
     - read order: the file seam and the fake api write one shared event log (every `lstat` and read of a token file, every api call). Before the reconcile ends, no owned host file (decision 8 "Owned files") is read. In a `probe` case with a `replacing` row the log shows exactly this order: the staging checks of reconcile step 3, the `lstat` of `secrets/admin-token`, its read, `GET /admin/tokens/self` with its content, then `GET /admin/tokens/<X>`. No api call comes before that read. In an `admin` case, the only token file read inside the reconcile is the staging file;
     - for the item, exactly one active token with the item's scopes and location remains: the one whose secret the host file holds (the fake api maps secrets to ids);
     - no staging file, no temp file and no journal is left;
     - exactly one rotate that the fake api applied, and at most one replacement whose secret was stored.
   - **Rotate outcome.** Every row of the table in decision 8 "Rotate outcome", for `admin` and `probe`, in the first run (class `ok`, `rejected`, `ambiguous`) and on resume (class `none`). The fake api decides the class and the readback independently. Required cases, with literal expectations:
     - **Timeout, no change on the server.** The first `POST` times out and the fake api holds it; at the barrier's stop it drops it. The readback shows `rotatedAt` = `rotatedAtBefore`. Expected event order: `requested` with `inFlight: "rotate"` → `POST` → barrier (`stop api`, `inspect`, `start api`, ready) → `inFlight: null` → readback → `inFlight: "rotate"` → `POST` (`ok`). Exactly 2 `POST`s, 1 barrier, 1 applied rotate, the journal never `replacing`, no `POST /admin/tokens`, exit 0.
     - **Timeout, applied at the barrier.** The fake api holds the rotate and applies it at the barrier's stop. Expected: 1 `POST`, 1 barrier, readback `changed`, the journal goes `requested` → `replacing`, 1 create, the old token revoked after the switch, exit 0.
     - **Timeout, applied on the server before the answer was lost.** The fake api applies the rotate at once and drops the answer. Expected: the same, with the barrier before the readback.
     - **Explicit `409`, nothing changed.** The fake api answers `409` `token is revoked` and the readback shows `revokedAt` set and `rotatedAt` unchanged. Expected: exit 1 naming `revoked`, no second `POST`, no create, no revoke, the host file byte-equal, the item dropped (no journal left when it was the only item).
     - **Explicit `409` after another client rotated.** The second `POST` gets `409` `a rotation is still in its overlap` and its readback shows `changed` (the fake api rotated the token for another caller between the barrier's readback and that `POST`). Expected: no barrier for the `409`, `replacing`, 1 create, exit 0.
     - **`ambiguous` twice with `same`.** Expected: 2 barriers, exit 1, the journal kept in `requested` with `inFlight: null`. A rerun runs no barrier and ends with exit 0.
     - **Readback `unknown`.** Expected: exit 1, the journal kept in `requested`, no create.
     - **Hard kill after the rotate `POST`.** The journal is `requested` with `inFlight: "rotate"`. The rerun runs the barrier before its readback.
     - **Barrier fails.** `docker compose stop api` exits 1, and separately `inspect` shows `State.Running` true. Expected: exit 1, the journal keeps `inFlight`, no readback, no `POST`, no `GET /admin/tokens`. A rerun runs the barrier again and ends with exit 0.
     - **Create `rejected`** (`403`): exit 1, the journal kept in `replacing` with `inFlight: null`, no second create, no barrier.
     - The case of the second plan review is one of them: a replacement admin secret installed, the `saved` write failing. The rerun must journal `saved`, keep the replacement and revoke only `revokeTokenId`.
   - **Unanswered writes (barrier).** The fake api models the server side of fact 7. It can *hold* a rotate or create `POST`: the client side ends (the fake `API_SCRIPT` exits with a timeout or no status line) while the server still has the request. A held write is applied or dropped at a chosen later event: after any later api call, after the run's exit, or at the api stop of a barrier. A held write is never applied after an api stop: the stop resolves every held write first (apply or drop, chosen per case), because the server process ends. After the run has exited, the test lets the fake apply every write it still holds, then checks the invariants again. Each case runs for `admin` and `probe`, the create cases start in `replacing` (after a `changed` readback), and R1, R2, R3 are the created ids. The expected values are literals:
     - **The case of the fifth and sixth plan reviews.** Create 1 times out and is held. The fake would apply R1 after the next api call on another connection. Expected event order: create 1 → barrier (stop: the fake applies R1) → `inFlight: null` → `GET /admin/tokens` → revoke R1 → `inFlight: "create"` → create 2 (`ok`, R2). At the end: R2 is the only active token with the item's scopes and location, the host file holds R2's secret, R1 and T are revoked, 2 create `POST`s, 1 barrier, exit 0.
     - **Held, dropped at the stop.** The sweep finds no token named `replacementName`, create 2 makes R2. Exactly 1 token created, exit 0.
     - **Late landing after the client has gone.** Create 1's client ends, and the fake holds the body to apply it after the next `GET /admin/tokens`. A CLI that sweeps without a barrier (for example after a client process scan) leaves R1 active after create 2 and after the final sweep; this case must catch that by the post-run apply. With the barrier, R1 is applied at the stop and revoked by the sweep.
     - **Hard kill with a create held.** The run is killed after create 1 was sent and held; the journal reads `replacing` with `inFlight: "create"`, and the lock stays. The rerun breaks the stale lock, its reconcile finds no staging file, the barrier's stop applies R1, the sweep revokes R1, create 2 makes R2, exit 0.
     - **Two ambiguous creates.** Both are held and applied at their barriers. Expected: R1 and R2 revoked, 2 barriers, exit 1 with the journal in `replacing` and `inFlight: null`, no active token named `replacementName`, and no held write left. A rerun runs no barrier, makes R3 and exits 0.
     - **Barrier broken on purpose.** A test-only variant of the fake does not resolve held writes at the stop and applies R1 after create 2 returned `ok` (R2) and before the item reaches `switched`. Expected: the final sweep revokes R1 and prints `revoked 1 unheld replacement token(s)` before `revoking` T. At the end R2 is the only active token, exit 0. This case proves the backstop; the real api cannot do it (fact 7).
     - **Final sweep on resume.** A run is killed in `switched` before the final sweep, with R1 active and R2 held by the host file. The rerun runs no barrier, revokes R1, never R2, then T.
     - Each case asserts:
       - no `POST`, no readback of the item and no `GET /admin/tokens` of a sweep while the journal on disk names `inFlight` and no barrier has run since;
       - no held write at exit 0;
       - after the run and after the post-run apply of every held write: every active token named `replacementName` is the one whose secret the host file or a staging file holds. After an exit 1 that keeps `inFlight` set, this is checked after the rerun;
       - no revoke of `activeTokenId` or of the calling token, at most 2 create `POST`s and at most 2 rotate `POST`s per item and run.
   - **Lock.** `cli/lock.test.ts` with an injected seam for `process.kill`, `ps`, the hostname and the file operations. The expected values are literals:
     - the lock content has the five lines of decision 3;
     - pid gone (`ESRCH`), same host, five lines: broken, `removed a stale .pulse-init.lock (pid 4242, token rotate)`, the own lock written;
     - pid alive with the same `started`: refused, the lock byte-equal;
     - pid alive with another `started` (reused pid): broken;
     - `EPERM` from `process.kill`: refused;
     - another host: refused; `started -`: refused; the old two-line content `pid 1\nnonce …\n`: refused;
     - `ps` fails for a living pid: refused;
     - `.pulse-init.lock.break` exists: refused with `another pulse command is starting`, the lock unchanged;
     - the lock changes between the judgement and the re-read under the break file: refused, the break file removed;
     - another process creates the lock between the unlink and the own `wx`: refused, the break file removed, the other lock unchanged;
     - two breakers interleaved by the seam at every step: exactly one holds the lock afterwards;
     - a link at `.pulse-init.lock`: refused;
     - the journal, `upgrade.json` and the rotation are read only after the lock is held (event log of the file seam).
   - **Data mounts.** Effective-model fixtures (literal JSON of `docker compose config --format json`) for decision 10 "Data mounts", each through preview and `--yes`. A refusal must come before any `docker pull`, `stop` or `gh` spawn, with `compose.yaml` byte-equal and no `.pulse-upgrade/`:
     - the rendered layout: `snapshotVolumes` is `["api-data","console-data","notify-data"]`;
     - an override `{"type":"bind","source":"/srv/pulse","target":"/data"}` on `api` while the top-level `api-data` stays declared: refuse with `pulse upgrade can snapshot only named volumes`. Snapshotting `api-data` here is wrong: the api's database is not in it;
     - `api` with `{"type":"volume","source":"pulsedb","target":"/data"}` and a top-level `pulsedb`: no refusal, `snapshotVolumes` is `["console-data","notify-data","pulsedb"]`, a helper runs with `-v <project>_pulsedb:/from:ro`, `api-data` gets no helper, and a rollback restores `pulsedb`. A suffix rule that skips `pulsedb` is wrong;
     - `api` `/data` as `{"type":"tmpfs","target":"/data"}`, or as a `volume` entry without `source`: refuse;
     - `api-data` at `/data` with `read_only: true`: refuse with `has no writable volume at /data`;
     - `api` with `PULSE_DB` `/tmp/pulse.db`, or `${DB}`: refuse with `sets PULSE_DB to another path`. `PULSE_DB` `/data/pulse.db`: no refusal;
     - `status` with a writable bind `./x:/x`: refuse. `probe` with a writable volume `probe-cache:/cache`: `probe-cache` is in `snapshotVolumes`;
     - an `upgrade.json` whose `tars` keys differ from `snapshotVolumes`: refused as invalid on read, no restore.
   - **Upgrade.** Fake docker stops the run during each of the three archive writes, during the `compose.yaml` copy, just before and just after the `applying` write, during the edit and during `waitReady`. Before the boundary: no restore helper spawn, `compose.yaml` byte-equal, no tar left, state `aborted`, `up -d` called. After it: the rollback order of Counterexamples "Rollback".
   - **Upgrade state writes.** The injected file seam of `cli/safe-write.ts` makes each part of each state write fail (temp write, temp fsync, rename, directory fsync) for `snapshotting`, `applying`, `aborted`, `rolling-back`, `restored` and `done`. Each case is checked against its row of decision 13 "State-write errors" and also run as a simulated hard kill at the same point. The expected values are literals:
     - **`applying` rename lands, directory fsync throws.** The read-back is `applying` with the `tars`. Expected: the rollback runs, every `*.tar` file still exists with its recorded sha256, no `*.tar` or `*.tar.part` delete call is made, `rolling-back` and then `restored` are written, `up -d` comes after `restored`, the final state is `rolled-back`, exit 1.
     - **`applying` rename throws** (the file still reads `snapshotting`). Expected: the abort path, the deletes come only after `aborted`, no restore helper, `up -d` once, exit 1.
     - **`applying` temp write and temp fsync throw.** Expected as for the rename case.
     - **`aborted` write throws.** Expected: no delete call, every archive kept, `up -d` once, exit 1, `snapshot directory kept`.
     - **`rolling-back` or `restored` write throws.** Expected: no `up -d` after the throw, exit 1, the stack stopped. For `rolling-back`, a `stop` call follows the throw and no restore helper is spawned. This is checked once with the throw from a failed `waitReady` of the new images.
     - **`done` write throws.** Expected: the stack keeps running, exit 1 with `the state file could not be written`.
     - **Invariant, checked after every write and every delete in the whole matrix:** whenever the file on disk reads `applying`, `rolling-back` or `restored`, every archive named in `tars` exists with its recorded size.
   - **Surviving helpers.** `cli/test/fake-docker.ts` models a helper as a container that keeps running, with its labels, after its client spawn was killed or the run was hard-killed, until `docker rm -f` removes it. The fake records each restore helper's phase (`delete`, `extract`, `sync`) and lets a case kill the run in any phase. The expected values are literals:
     - **Hard kill during the deletion, during the extraction and during the sync** of the second of three volumes, and **during a snapshot helper**. The rerun of `upgrade --yes` breaks the stale lock, lists the helpers, calls `docker rm -f` for each, lists again (empty), prints `removed 1 leftover helper container(s)`, then refuses with the snapshot directory. Between the rerun's start and the refusal there is no `up`, `start`, `stop`, restore or snapshot spawn and no state write. The killed helper never runs again after its `rm -f` (the fake fails the test when a removed helper would act).
     - **`rm -f` fails**, and separately **the second list still shows the helper after 3 rounds**: exit 1 with the ids, no refusal text for the directory, and no other spawn after it.
     - **Rollback with a restore helper that exits 1** for the second volume: the helper sweep runs before `rollback-failed` (with `restored: false`) is written, and no `up -d` follows.
     - **Abort during a snapshot helper**: the sweep removes it by label before `aborted` is written; a removal by name only is wrong when the name is unknown after a spawn error.
     - **Order:** in every upgrade, abort and rollback case, every `up -d` and every restore helper spawn comes after a helper sweep whose last list was empty (spawn log).
     - Every helper argv carries both labels with the fixture install id.
   - **Durable restore.** The restore helper argv ends with the literal script `find /to -mindepth 1 -delete && tar -C /to -xpf - && sync -f /to`. Cases:
     - the helper exits 1 for the third volume (as a failed sync would): no `restored` write, state `rollback-failed` with `restored: false`, no `up -d`;
     - the `compose.yaml` restore throws at its directory fsync: no `restored` write, `rollback-failed` with `restored: false`;
     - `restored` is written only after the last helper's exit 0 and the `compose.yaml` restore returned (event log of spawn and file seam).
   - **Docs.** `cli/docs.test.ts` asserts that `### Upgrade recovery` names the helper label `io.github.lorenzh.pulse.helper` before its first `pulse down`, that the restore command in it contains `sync -f /to`, and that "A stale `.pulse-init.lock`" names `pulse token rotate` and `pulse upgrade`.
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
   - The barrier (decision 8) runs only after an unanswered rotate or create `POST`: one stop and start of the api, a few seconds of api downtime per barrier, at most 4 per item and run (2 rotate and 2 create `POST`s). A rotation whose answers all parse runs none. Measured: the CLI prints `restarted the api … (<ms> ms)`; the unit tests count the barriers. The api's start cost is the api's own `startup_wall_ms` and `startup_cpu_ms` in `bench/budgets.json`.
   - Measured: the CLI prints `two probes ran for <W> ms` per location (decision 7 step 7). `rotate.sh` takes W independently from `docker events` and samples `docker stats --no-stream --format json` every second during the rotation. It reports the largest summed memory and CPU of the probe containers of one location, which the PR quotes against the single-probe baseline of the same run.
2. **Extra check traffic during the handoff.**
   - Extra load per check: the old probe's runs that start inside W, each one extra request to the target and one extra `POST /results`. The old probe starts no run after SIGTERM (fact 3), and the new one no run before its start, so every doubled run lies in W.
   - How the probe spaces runs: one check never overlaps itself. The next run is scheduled only after the previous run and its `onResult` have finished, with the delay `max(0, I − elapsed)` on the monotonic clock (probe `src/scheduler.ts` lines 46–72 at `92f55df`). So two starts of one check are `max(I, R_k)` apart, where R_k is the run time of the earlier run, from its start to the end of its `onResult`. Result timestamps are wall-clock times (fact 3), and e = 100 ms covers timer and clock earliness between them.
   - **Bound, valid domain I ≥ 200 ms.** Two runs of one probe and one check start at least I − e apart, so the old probe starts at most `floor(W / (I − e)) + 1` runs in W. The domain makes I − e ≥ I / 2 > 0, so the bound is at most `2W / I + 1`. With W = 6000 ms:
     - I = 5000 ms: at most 2;
     - I = 1000 ms: at most 7;
     - I = 200 ms: at most 61.
   - **Below 200 ms the bound is not used.** At I = 100 it divides by zero and below that it is negative. The contract allows I from 1 ms (fact 3).
   - **Estimate for I < 200 ms.** It is not a bound and nothing gates it. The old probe starts about `floor(W / max(I, R)) + 1` runs in W, where R is the shortest run time of that check during W (the request to the target plus `onResult`). At I = 1 ms, R decides: for a local target with R between 2 and 10 ms and W = 6000 ms, that is about 600 to 3000 doubled runs.
     - R is measured, not assumed: the result field `latencyMs` is a lower bound for R. So `floor(W / max(I, min latencyMs)) + 1` is an upper estimate from the api's own data.
   - The docs state the domain, the bound and the estimate as a known limit, and advise against a probe rotation on checks with I < 200 ms during busy times.
   - The first spec's "at most one extra sample" and the second spec's "W ≤ 2000 ms plus signal latency" were both wrong: W also holds the readiness and the equality check.
   - The sample statistic E that the tests use (Counterexamples "Extra samples") is a different quantity: the surplus of samples over a minimum gap-keeping subset. Its lemma gives E = 0 for one probe and E ≤ 2·floor(W / (I − e)) + 3 for a handoff.
   - Measured in `rotate.sh` per location: W from Docker events, E in the baseline (must be 0), over the rotation window (must be within the lemma bound) and after the handoff (must be 0). It also reports K, the samples in [T_s, T_d), next to the doubled-runs bound. Both formulas live in `cli/test/samples.sh` with their domains:
     - `doubled_runs_bound I W` prints `floor(W / (I − 100)) + 1` for I ≥ 200. Below 200 it exits 2 with `no bound below 200 ms`, so it can never divide by zero or print a negative count.
     - `extra_samples_bound I W` prints `2·floor(W / (I − 100)) + 3` only when the lemma condition A + 2e < I holds, that is I > 700. Otherwise it exits 2.
     - The CI check interval of 5000 ms (a literal in Acceptance 1) is inside both domains. `samples.test.sh` checks both domains with literals (Counterexamples "Extra samples").
3. **Upgrade downtime and copy I/O.**
   - Downtime D runs from `stop` to ready: stop (≤ 10 s grace per service, in parallel), snapshot, edit, `up -d` and readiness. The pull runs before the stop and is not part of D.
   - The snapshot reads every data volume once and writes the same bytes as tar files. A rollback reads them again and rewrites the volumes. The kept snapshot uses one extra copy of the data volumes on disk.
   - A rollback adds one `sync -f` per restored volume, which flushes the dirty pages of that filesystem; on an idle CI host this is well under a second. The helper sweep is one or two `docker ps` calls per use. Both are inside the rollback time that `upgrade.sh` reports.
   - Snapshot time is roughly the volume size divided by the disk throughput: a few MB on the demo (< 5 s), about 10 s per GiB at 100 MB/s.
   - Measured, three ways, all in `upgrade.sh`:
     - the CLI lines `snapshot <bytes> bytes in <ms> ms` and `the stack was down for <ms> ms`;
     - the size of the snapshot directory (`du -sb`);
     - the largest `always-healthy` result gap across the real upgrade (Counterexamples "Gap rule" statistic, without the bound). This is an api source, independent of the CLI.
   - The issue sets no downtime budget. The PR quotes the numbers.
4. **CLI binary size.** It grows by the new modules. The existing `cli-build` step "Binary size and init time" (`.github/workflows/ci.yml` lines 407–414) reports it. The PR quotes the size before and after.
5. **CI time.** `cli-rotate` takes about 20 min, because it waits the real 10-minute overlap and runs the resume case. `cli-upgrade` takes about 18 min (the hard-kill case adds a third failed upgrade and a manual restore). Both run in parallel with the existing jobs.

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
  - A lost answer does not leave an active token whose secret nobody holds. Replacements carry the journal's random `replacementName` (the api does not make names unique, fact 7). Every rotate and create `POST` is marked `inFlight` in the journal before it is sent. When it is not answered, the barrier ends the api process before any readback, sweep or further `POST`, so no earlier write can be applied later. Every ambiguous or lost create is followed by a sweep, and the final sweep in `switched` revokes every token of that name except `activeTokenId` before the journal can be removed. The lost token is revoked after the switch (decision 8 "Barrier" and "Lost answer").
  - A held secret is never revoked: the sweep of "Lost answer" step 2 runs only when no host or staging file can hold a replacement (decision 8 "Reconcile"), the final sweep (step 5) leaves out `activeTokenId`, the only replacement whose secret a file holds from `saved` on, a stage error always goes through the reconcile before it can count as a lost answer (decision 8 "Stage errors"), and the revoke guard refuses a revoke of the calling token or of `activeTokenId`.
  - Reconcile bearer: no owned host file is used as a bearer before the reconcile ends. In a probe journal the order is: the staging checks, the `lstat` checks of `secrets/admin-token`, its read and content check, the capability call with it, and only then the confirmation (decision 8 "Reconcile" step 4).
  - A replacement is created in exactly the two cases of decision 8 "Lost answer": (1) a readback that shows a changed `rotatedAt` after a `rejected`, `ambiguous` or `none` class ("Rotate outcome"), and (2) an `ok` rotate answer whose secret the stage-error reconcile found in no staging file ("Stage errors"). In both the api has rotated the token and the new secret is not stored. A rotate that the api refused with `rotatedAt` unchanged, or whose readback is `same`, `gone` or `unknown`, never leads to a replacement.
- **Body and size limits.** Api answers are capped at 1 MiB in `API_SCRIPT`. Registry bodies are capped at 1 MiB, and registry pagination at 10 pages.
- **Input validation.**
  - Token ids match `^tok_[0-9a-f]{24}$`. Container ids match `^[0-9a-f]{64}$`. Service names and versions are validated. The journal and `upgrade.json` are validated on read like external input.
  - Api and registry JSON goes through own-property readers (`own()` in `cli/docker.ts`), never trusted as typed.
  - Locations match `^[a-z0-9][a-z0-9-]{0,31}$`, as in `secrets-init.mjs`.
  - The effective mounts of the pulse services are validated before an upgrade stops anything (decision 10 "Data mounts"). An override that moves data out of a named volume refuses, so a rollback never "restores" a volume that does not hold the data.
- **SSRF and redirects.** The registry host is fixed to `https://ghcr.io`, with `redirect: "error"`. The api URL is fixed to `127.0.0.1:3000` inside the api container. No user input builds a URL or a path beyond the validated token id.
- **Atomic, path-safe writes.**
  - Secret files, the journal, `compose.yaml`, `upgrade.json` and the snapshot files are written `wx` with temp names in their final directory, fsynced and renamed, with the directory fsynced.
  - A new secret goes first to a 0600 staging file in the 0700 `secrets/` directory and reaches the host file only by rename. Staging files are name-checked, never read by `secrets-init`, and never left behind after a finished run.
  - Links and non-regular files are refused, and directory modes are checked.
  - The snapshot directory is 0700 with 0600 files, because it holds the databases. Tars are checked against their recorded sha256 before a restore deletes anything.
  - A restored volume is flushed (`sync -f /to`) before `restored` is written, so the state never claims data that is not on disk.
  - Helper containers carry labels, and the helper sweep removes every leftover one before any restore or start, so a killed run's helper cannot write into a volume that a later step uses.
  - The lock file is read as untrusted input (`lstat`, size limit, fixed line shape). A stale lock is broken only on the same host, for a gone or reused pid, under a second exclusive file, and only when its bytes are unchanged (decision 3). The lock and break files hold no secret.
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
- **An older CLI binary on a new installation.** It still sees `.pulse-init.lock` and refuses while it exists, whatever its content. A new CLI never breaks the two-line lock of an older CLI (decision 3), so a running older `pulse init` is never interrupted. `secrets/.pulse-rotation.json` and `.pulse-upgrade/` are not in its managed file list (`cli/write-install.ts` lines 33–44), so `pulse init --force` neither touches nor reports them.
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
  - **Domains of the two bounds** (literals for `samples.test.sh`; `doubled_runs_bound I W` and `extra_samples_bound I W`, Performance impact item 2):
    - `doubled_runs_bound 5000 6000` prints 2, `1000 6000` prints 7, `200 6000` prints 61.
    - `doubled_runs_bound 199 6000`, `100 6000` and `1 6000` exit 2 with `no bound below 200 ms`. A function that evaluates the formula there is wrong: at I = 100 it divides by zero, at I = 1 it gives `floor(6000 / −99) + 1` = −60.
    - `extra_samples_bound 5000 6000` prints 5 and `extra_samples_bound 4900 4900` prints 5 (floor(4900 / 4800) = 1). `extra_samples_bound 701 6000` prints 2·floor(6000 / 601) + 3 = 2·9 + 3 = 21. `extra_samples_bound 700 6000` exits 2: the lemma needs A + 2e < I.
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
  - **First run**, the rotate `POST` times out, and the readback shows `rotatedAt` unchanged: one more normal rotate follows in the same run, and the journal never shows `replacing`. Going to `replacing` straight from the timeout is wrong. It would create a second token of the same location and revoke a token whose rotation never happened. The resume of `requested` takes the same row.
  - **Explicit `409`** (`token is revoked`, readback `revokedAt` set, `rotatedAt` unchanged): exit 1, the item is dropped, there is no create and no revoke, and the host file is byte-equal. Treating every non-`200` as a lost answer is wrong: it would create a replacement for a token that a person revoked on purpose.
  - **`409` with `rotatedAt` changed** (another client rotated the token): the lost answer, `replacing`. Reading `409` alone as "nothing changed" is wrong here, because a rotation happened and its secret is not held.
  - **`503` or a `200` with a body that does not parse**: class `ambiguous`, never `ok` or `rejected`. The readback decides.
  - **Readback `401`**: `unknown`. Exit 1 with the journal kept in `requested`, no second `POST` and no create.
  - Create `POST` times out, and the api holds a token named `replacementName`: the rerun revokes that token before it creates another one. Creating a second without the revoke is wrong (it leaves a usable token whose secret nobody holds).
  - **Late landing (the case of the fifth and sixth plan reviews).** Create 1 times out, a sweep finds nothing, create 2 makes R2, then create 1 lands as R1. Both are active with the same name. Sweeping right after the timeout is wrong. Sweeping after the client process has ended is wrong too: the api can still hold the body and apply it after the sweep, even after the final sweep (fact 7). With the barrier the api process ends before the sweep, so R1 is committed before it or never.
  - **Barrier proof.** `docker compose stop api` exits 0 but `docker inspect` shows `State.Running` true (a fake): the CLI must not sweep or `POST`. Treating the exit code of `stop` alone as proof is wrong.
  - **Barrier scope.** A rotation whose every answer parses must run no barrier (no `stop api` in the spawn log). Restarting the api on every rotation is wrong: the issue requires that only what needs it restarts.
  - **Marker before the send.** A fake that fails the journal write of `inFlight: "create"` must see no create `POST`. Writing the marker after the `POST` is wrong: a hard kill in between leaves a pending create that no rerun settles.
  - The final sweep must not revoke `activeTokenId`, even though it carries `replacementName`.
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
  - **The first case of the third plan review.** Probe, first run, state `requested`. The rename to `.pulse-next.probe-token-eu.T` succeeds and the directory fsync after it throws. The in-process reconcile fsyncs `secrets/` (it succeeds), finds the staging file, journals `staged` with `activeTokenId` T and installs it. There is no create call and no revoke. Moving to `replacing` from the error is wrong: it creates a replacement while T's new secret is held, and the next reconcile refuses `replacing` with a staging file of T.
  - The same, but the reconcile's own fsync of `secrets/` throws too: exit 1, the journal still `requested`, the staging file still there, no api write. The rerun takes the `requested` row.
  - Probe, first run, state `replacing`. The create of R answers `201`, and the staging temp write throws. The in-process reconcile deletes the temp file and finds no staging file. R is an orphan: the sweep revokes it by `replacementName` through the revoke guard, and one more create follows. Keeping R active is wrong: nobody holds its secret.
  - Admin, state `staged` with `activeTokenId` R. The install rename succeeds and the directory fsync after it throws. The reconcile finds no staging file and journals `saved`. Treating the error as a lost answer is wrong: the item is past `replacing` and never returns there.
- **Reconcile bearer order** (the second case of the third plan review).
  - Probe journal, item eu in `replacing`, `.pulse-next.probe-token-eu.R` exists. The event log must read, in this order: the staging checks, the `lstat` of `secrets/admin-token` (regular file, not a link, 0600), the read of `secrets/admin-token` and `tokenContentValid`, `GET /admin/tokens/self` with that content (200, `admin` scope), then `GET /admin/tokens/R`. Expecting the capability call before the read is wrong: the call has no bearer without the read. An api call before the `lstat` is also wrong. Reading `secrets/probe-token-eu` as a bearer here is wrong: an owned host file is read only after the reconcile.
  - The same journal with `secrets/admin-token` as a symlink: refuse with exit 1 before any api call, journal and staging file unchanged.
  - The same journal with `/admin/tokens/self` for the admin secret answering `401`: refuse with exit 1, no `GET /admin/tokens/R`, nothing changed.
  - Probe journal with a staging file `.pulse-next.admin-token.tok_…`: refuse with exit 1 in step 3, before `secrets/admin-token` is read or any api call is made.
  - Admin journal, item in `replacing`, `.pulse-next.admin-token.R` exists: the confirmation uses the staged secret, never `secrets/admin-token` (the owned host file).
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
- **Data mounts** (decision 10; the fixtures are in Acceptance 3 "Data mounts").
  - An override bind at the api's `/data` with `api-data` still declared must refuse. Snapshotting the declared `api-data` is wrong: after a failed upgrade the rollback would restore a volume the api never used, and api A would meet schema 9 in the bound directory.
  - A writable volume `pulsedb` at the api's `/data` must be snapshotted. Choosing volumes by the `-data` suffix is wrong.
  - `PULSE_DB=/tmp/pulse.db` must refuse, although the `/data` volume is there: the database is not in it.
- **Provenance.**
  - A `gh` exit 1 refuses.
  - Missing `gh` (spawn ENOENT) exits 1 with the install hint, not 3.
  - The verified digest must be the pulled digest. Test: the fake registry answers a second `HEAD` with another digest. The CLI must not ask again, and the pulled ref equals the verified one.
- **Snapshot boundary.**
  - SIGINT while `console-data.tar.part` is written (the second of three, `snapshotVolumes` is sorted): `docker rm -f` of the helper, no `find … -delete` spawn, no `api-data.tar` or `*.part` left, `compose.yaml` byte-equal, `aborted`, exit 130. Restoring `api-data` from its finished tar here is wrong: the volumes were never changed.
  - The tar helper exits 1 for `console-data`: the same abort path, exit 1.
  - A crash between the last `rename` of a tar and the `applying` write leaves `snapshotting`; the next `upgrade --yes` refuses and names the directory.
  - SIGINT right after the `applying` write: a full rollback follows, even though `compose.yaml` is not edited yet.
  - **The case of the fourth plan review.** The `applying` rename succeeds and the directory fsync throws. The read-back shows `applying` with the `tars`, so the rollback runs and every archive stays. Taking the abort path is wrong: it deletes the archives while `upgrade.json` may say `applying`. A power loss then leaves `applying` pointing to deleted archives, and the manual recovery for `applying` restores from them.
  - The `applying` rename throws and the file still reads `snapshotting`: abort. Rolling back here is wrong: the file on disk has no `tars`, so no archive can be verified before a restore.
  - Abort with a failing `aborted` write: the archives must stay. Deleting them first and writing `aborted` second is wrong. That was the order of the third spec.
  - `restored` write fails: no `up -d`. Starting the old images while the file says `rolling-back` is wrong: the manual recovery for `rolling-back` restores again and loses the writes made since the start.
  - `done` write fails after a ready upgrade: exit 1 with the stack running. Rolling back is wrong: the upgrade worked.
- **Rollback.**
  - On failure after the boundary, the order must be stop → verify every tar → restore every tar → restore `compose.yaml` → `up -d`. Starting old images before the volume restore is wrong: api A exits 2 on schema 9.
  - A tar whose sha256 differs from `upgrade.json`: no restore helper runs for any volume, state `rollback-failed` with `restored: false`, and no `up -d`.
  - A `rollback-failed` snapshot makes the next `upgrade --yes` refuse.
  - **Durable restore.** A restore helper script `find /to -mindepth 1 -delete && tar -C /to -xpf -` without `&& sync -f /to` is wrong: `restored` could be durable while the volume data is still in the page cache, and the recovery for `restored` forbids a second restore. Writing `restored` after a helper exit 1 is wrong too.
- **Helpers.**
  - A rerun after a hard kill during the restore of `console-data` (state `rolling-back`, the helper still deleting): `docker rm -f` of the helper must come before any `pulse down`, restore or `up`. Starting a second restore while the first helper runs is wrong: both write the same volume.
  - Finding helpers by the name prefix `<project>-pulse-restore-` alone is wrong when another install uses the same project name on the host; the sweep filters by the install-id label.
  - The manual recovery that begins with `pulse down` is wrong: `pulse down` leaves a standalone helper running (fact 5).
- **Lock.**
  - A lock `pid 999999\nnonce …\nhost <this host>\nstarted Wed Nov 11 10:00:00 2026\ncommand upgrade\n` with pid 999999 gone: broken. Refusing here is wrong after a hard kill: the issue's resume and the upgrade recovery need the rerun.
  - The same lock with `host other-host`: refused. Breaking it is wrong: the pid says nothing about a process on another host.
  - The same lock where pid 999999 runs and `ps` prints `Wed Nov 11 10:00:00 2026`: refused. Breaking a lock because the process "looks old" is wrong.
  - Two reruns that both judge the same lock stale: one breaks it, the other refuses. A break by plain `unlink` and `wx` without `.pulse-init.lock.break` and the byte-equal re-read is wrong: the second breaker can delete the first one's new lock.
  - A run that reads `secrets/.pulse-rotation.json` before it holds the lock is wrong: two reruns could reconcile the same journal at once.
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
- `grep -rn -- 'inFlight' contract/src config deploy` (the journal key)
- `grep -rn -- 'io.github.lorenzh.pulse.helper' contract/src config deploy` (the helper label; the existing `io.github.lorenzh.pulse.install` of `cli/render-compose.ts` line 9 is reused, not new)
- `grep -rn -- 'pulse-init.lock.break' contract/src config deploy` (the break file)
- `grep -rn -- 'stale .pulse-init.lock' contract/src config deploy` (the break message; `docs/cli.md` line 217 has the heading "A stale `.pulse-init.lock`" with backticks, which this pattern does not match and which the docs task rewrites)
- `grep -rn -- 'leftover helper' contract/src config deploy`
- `grep -rn -- 'PULSE_TEST_HOLD_RESTORE' contract/src config deploy`
- `grep -rn -- 'to settle an unanswered' contract/src config deploy`
- `grep -rn -- 'snapshotVolumes' contract/src config deploy` (the `upgrade.json` key)
- `grep -rn -- 'unheld replacement' contract/src config deploy`
- `grep -rn -- 'only named volumes' contract/src config deploy`

The new flags `--to`, `--follow`, `--location`, `--id` and `--yes` on these commands do not exist in `cli/args.ts` (lines 59–103 list every option). `--timeout` exists for `up` and keeps its meaning.

## Repository: deploy

Files:

- `common/services.yaml` (changed, only through `scripts/bump-images.sh`, decision 2)
- `cli/args.ts`, `cli/args.test.ts` (changed: `token`, `upgrade`, `logs`, HELP)
- `cli/services.ts`, `cli/services.test.ts` (changed: export `PULSE_IMAGE`, which is a private `const` today at line 36, next to the exported `assertPin`; a test of the exported pattern with fixture parts built at run time, no pin literal)
- `cli/main.ts`, `cli/main.test.ts` (changed: dispatch)
- `cli/docker.ts`, `cli/docker.test.ts` (changed: spawn options `input`, `stdinFd`, `stdoutFd`; generic missing-binary error; `Project` carries the parsed effective model)
- `cli/ready.ts`, `cli/ready.test.ts` (changed: `parsePs` reads `ID`; `readyz` for a service or a container id)
- `cli/write-install.ts`, `cli/write-install.test.ts` (changed: use the extracted lock and atomic write)
- `cli/lock.ts`, `cli/lock.test.ts` (new: the shared `.pulse-init.lock`, moved from `write-install.ts`, with the five-line content, the stale-lock judgement and the break under `.pulse-init.lock.break` of decision 3, behind an injected seam for `process.kill`, `ps`, the hostname and the files)
- `cli/safe-write.ts`, `cli/safe-write.test.ts` (new: atomic write with fsync of file and directory, link and mode checks, moved from `write-install.ts`)
- `cli/api-call.ts`, `cli/api-call.test.ts` (new: `API_SCRIPT` with its self-exit, the equality script, and the in-container api call)
- `cli/rotation-journal.ts`, `cli/rotation-journal.test.ts` (new: journal format, validation, states, staging file names, owned files, the reconcile with its validation order and table, stage errors, and the handoff resume table)
- `cli/token-rotate.ts`, `cli/token-rotate.test.ts` (new: selection, rotation, the rotate outcome table with its readback, the `inFlight` marker and the api barrier, lost answer with sweeps and the final sweep, switch, revoke; the rotation failure-injection matrix, the rotate-outcome cases and the unanswered-write cases)
- `cli/registry.ts`, `cli/registry.test.ts` (new: ghcr.io tags and digests)
- `cli/provenance.ts`, `cli/provenance.test.ts` (new: the `gh` preflight and verify)
- `cli/snapshot.ts`, `cli/snapshot.test.ts` (new: the data-mount check and the snapshot set `snapshotVolumes` from the effective model with its fixtures, `upgrade.json` states including `restored`, the state-write error table with its read-back, archive write with `.part` and sha256, abort cleanup after a durable `aborted`, the helper labels and the helper sweep, verify, and the restore with `sync -f /to` before `restored`)
- `cli/upgrade.ts`, `cli/upgrade.test.ts` (new: selection, preview, apply, boundary and rollback, the truthful-state-before-start rule, the helper sweep in the preflight; the upgrade failure-injection matrix, the state-write matrix, the surviving-helper cases and the durable-restore cases)
- `cli/logs.ts`, `cli/logs.test.ts` (new)
- `cli/docs.test.ts` (changed: a section per command)
- `cli/test/fake-docker.ts` (changed: record `input`, fds and signals; container ids and states; labels; helper containers that keep running after their client or the run was killed, with their restore phase; `stop`, `start` and `inspect` of the api for the barrier; a hook that stops the run at a named step)
- `cli/test/rotate.sh` (new: `cli-rotate` body)
- `cli/test/upgrade.sh` (new: `cli-upgrade` body)
- `cli/test/pin-release.sh` (new: rewrites an install's pulse image lines, test only)
- `cli/test/samples.sh`, `cli/test/samples.test.sh` (new: the gap rule, the surplus statistic E with its greedy chain, the lemma bound `extra_samples_bound` and the doubled-runs bound `doubled_runs_bound`, each with its domain check, and the Docker-event parsing for T_s, T_d and W, shared by `rotate.sh` and `upgrade.sh`; the self-test runs every fixture of Counterexamples "Gap rule" and "Extra samples" as literals)
- `cli/test/fail-ready-docker/docker` (new: test-only pass-through shim, decision D2-A; `PULSE_TEST_FAIL_READY_*`, `PULSE_TEST_HOLD_SNAPSHOT` and `PULSE_TEST_HOLD_RESTORE`)
- `cli/test/stack.sh`, `cli/test/errors.sh` (changed: logs and refusal paths)
- `.github/workflows/ci.yml` (changed: jobs `cli-rotate` and `cli-upgrade`)
- `docs/cli.md` (changed: the command sections, `### Token recovery`, `### Upgrade recovery`, and the rewritten "A stale `.pulse-init.lock`" of decision 3), `README.md`, `AGENTS.md` (changed)

Behavior change: yes
The change adds three CLI commands, bumps the image pins and adds CI jobs.
Breaking: no
The commands and flags are new; `init`, `up`, `down`, `status`, their flags, `pulse.json` and the Compose output keep their documented behavior (only the lock refusal wording and the content of the internal lock file change; an older CLI only creates the lock with `wx` and never reads it).

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
- **Effective model.** `checkConfig` (`cli/docker.ts` lines 347–375) already parses the resolution call. Return the parsed document in `Project`, so the image check and the data-mount check of decision 10 and the location lookup of decision 6 use it instead of a second `docker compose config` call. Read it with `isObj` and `own`, as `checkNames` does.
- **Lock.** Move the lock (`cli/write-install.ts` lines 299–309 and 352–394) into `cli/lock.ts`, with its tests, add the stale-lock break of decision 3, and use it in `writeInstall`, rotation and upgrade. `pulse init` gets the break too, so a crashed `init` no longer needs a manual delete on the same host.
- **Install label.** The helper labels reuse `INSTALL_LABEL` (`cli/render-compose.ts` line 9); do not write the label text a second time.
- **Atomic write.** Move `atomicWrite` and the link and mode refusals (`cli/write-install.ts` lines 164–187 and 279–297) into `cli/safe-write.ts`. Add fsync of the file and the directory. Then use it in init, the rotation (secret files, journal) and the upgrade (`compose.yaml`, `upgrade.json`, the tar rename).
- **State files.** The rotation journal and `upgrade.json` share one helper for "validate on read, write state with fsync before the side effect" in `cli/safe-write.ts`. Do not write two.
- **Readiness.** Extend `readyz` and `waitReady` (`cli/ready.ts`) to target a container id. Use them for the new probe container, the console restart, the upgrade and the rollback, not a second poller. The in-container equality check is a second constant script in `cli/api-call.ts`, next to `API_SCRIPT`.
- **Process rows.** `parsePs` (`cli/ready.ts` lines 18–46) gets `ID` (from `ps --no-trunc`). Container selection and the handoff resume use it.
- **Text safety.** `shown()` (`cli/args.ts` lines 140–152), `firstLine` and `maskUserInfo` (`cli/docker.ts` lines 104–114) for every external text. `tokenContentValid` (`cli/tokens.ts` lines 40–43) for the file check.
- **Pin shape.** `assertPin` and `PULSE_IMAGE` (`cli/services.ts` lines 36–48) are the image shape of decision 10. Export and reuse them; do not write a second regex.
- **Signals.** `processSignals` and the record-then-act pattern of `writeInstall` (`cli/write-install.ts` lines 50–71 and 366–399) for the critical sections of decisions 8 and 13.
- **Tests.**
  - `cli/test/fake-docker.ts` is the only fake spawn. Its stop-at-step hook serves both failure-injection matrices.
  - The file operations of `cli/safe-write.ts` (open, read, write, fsync of a file, fsync of a directory, rename, unlink) go through one injected file seam. The stage-boundary matrix uses it to fail or "hard kill" at each named point, and it writes every `lstat` and read of a token file into one event log that the fake api also writes its calls into, for the read-order assertion. The same seam fails each part of an `upgrade.json` state write for the state-write matrix. The fake api of the rotation tests is one test helper that maps secrets to token ids and enforces `401` for revoked secrets, self-revocation and the last-admin rule. It also holds rotate and create `POST`s on its server side after the client has ended, and resolves every held write at an api stop of the fake docker (Acceptance 3 "Unanswered writes").
  - The lock seam (`process.kill`, `ps`, the hostname) is injected in `cli/lock.ts`. The simulated hard kill of every matrix leaves the lock file behind and marks its pid as gone.
  - Registry and api answers in unit tests are literal fixtures.
  - Image refs in `cli/` tests use the fixture `example.invalid/fixture-svc:9.8.7` (`AGENTS.md` rule). A test that needs a pulse-shaped ref builds it at run time from parts, so no pin literal is in a file.
  - The gap and extra-sample statistics of `rotate.sh` and `upgrade.sh` live in one shell function file sourced by both, `cli/test/samples.sh`, with the self-test `cli/test/samples.test.sh` on the Counterexamples fixtures (phase offset, nearly in phase, one probe, edges, old probe never stopped, gap failure, and the domains of the two bounds).
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
  - the release pair A and B printed by `upgrade.sh`, the refusal of the unsupported data layout, and the schema numbers on A, after the rollback and on B;
  - the abort, rollback and success lines of the upgrade job, the snapshot bytes and ms, the downtime ms and the largest result gap across the upgrade;
  - the hard-kill case: the helper row right after the kill, the rerun's `removed a stale .pulse-init.lock` and `removed 1 leftover helper container(s)` lines, and the schema after the documented manual restore;
  - the `ps -o lstart=` output on the `macos-15` runner (decision 3);
  - the binary size before and after.
- It names the known limits: extra samples during the handoff (the bound for I ≥ 200 ms and the estimate below it), the api restart of the barrier on a recovery path, a stale lock from another host that needs manual removal (Risks), the supported data layout of an upgrade, the stack being down during an upgrade, post-snapshot writes lost on rollback, the snapshot disk space, and the manual recovery after a hard kill.

## Breakdown notes

- Order the tasks so that the shared seams come first: lock, safe write and state files, spawn options, `readyz` by container, `parsePs` ID, and the api call. Each command then builds on them.
- The pin bump can be its own first task. The existing CI jobs prove `0.1.1` on a fresh install.
- Suggested tasks:
  1. The seams, including the lock with its stale-lock break and its tests.
  2. `pulse logs` with its stack and error checks.
  3. `pulse token rotate` with the journal, the staging files, the reconcile (validation order, the `secrets/admin-token` bearer of a probe journal, and the in-process run after a stage error) and resume tables, the rotate outcome table (first run and resume alike), the revoke guard, the `inFlight` marker with the api barrier, the sweeps and the final sweep, the rotation failure-injection matrix, the rotate-outcome cases, the unanswered-write cases and the stage-boundary matrix with the shared event log for the read order (Acceptance 3).
  4. `pulse upgrade` with registry, provenance, the data-mount check and its fixtures, snapshot boundary, the state-write error table with read-back and the `restored` state, the helper labels and sweep, rollback with the synced restore, the upgrade failure-injection matrix, the state-write matrix, the surviving-helper cases and the durable-restore cases (Acceptance 3).
  5. The live scripts `rotate.sh`, `upgrade.sh`, `pin-release.sh`, the sample statistics (surplus E, the lemma bound and the doubled-runs bound with their domains, Docker-event W) with their fixture self-test, the shim, the two CI jobs, and the docs.
- No task holds docs alone. Each command's docs section goes with its command task. The final task completes `README.md` and `AGENTS.md`.
