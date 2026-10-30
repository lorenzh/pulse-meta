# Issue review: #431 Compose: mount the checks directory so hot reload sees atomic saves

Verdict: the feature can be specified. No blocking question. Single target: `api`.

## Findings from the clones (pulse-api `main`)

- `compose.yaml` (service `api`) mounts `./compose/checks.json:/config/checks.json:ro`; `PULSE_CHECKS_FILE=/config/checks.json`. A comment above the mount names the writable opt-in `- ./compose:/config`.
- `compose/` holds `checks.json`, `notify.json`, `demo/`, `e2e/`. Notify mounts `./compose/notify.json:/config/notify.json:ro` (a single file too, same inode limit, but out of scope: notify has no hot reload from this issue).
- `compose.e2e.yaml` overrides the api mount with `./compose/e2e/checks.json:/config/checks.json:ro` (kept for the "read-only file answers 503" test) and adds `./compose/e2e/rw:/config-rw` (writable dir; `PULSE_CHECKS_FILE=/config-rw/checks.json`).
- `scripts/compose-e2e.sh`: `checks_file=compose/e2e/rw/checks.json`; the existing hot-reload step (around line 583) edits in place (`cat new >"$checks_file"`), sends `HUP`, then restores with `cp`. The 503 test runs a second api in the same container with `PULSE_CHECKS_FILE=/config/checks.json`.
- Other mentions of the single-file mount: `docs/install.md` (line ~79-85, ~100 for the `docker run` example), `docs/operation.md` (`## Changing checks`, line ~100 says "It does not use `fs.watch`, because a rename over a bind mount loses the inode"), `docs/development.md`, `bench/compose.bench.yaml`.
- Hot reload code looks at mtime, size and inode, so once the container sees the new inode (directory mount) the reload works. No code change in `src/` is needed.

## Open points (not blocking)

1. Directory name. The issue says "for example `./config:/config:ro`". The repo has `compose/checks.json`, the docs, the e2e script and `.gitignore` refer to it, and the existing opt-in comment uses `./compose:/config`. Assumption: keep the host path `compose/checks.json` and mount `./compose:/config:ro`. Drawback: the container also sees `notify.json`, `demo/`, `e2e/` (read-only, harmless). The alternative (a new `config/` dir holding `checks.json`, with `docs/install.md` `cp checks.example.json` flow updated) is a bigger move. The spec must pick one; the plan should prefer the assumption (least churn) unless a dedicated dir is cheap. Whichever is chosen, `docs/install.md`, `docs/operation.md`, `compose.yaml` and the opt-in comment must agree.
2. The e2e override. `compose.e2e.yaml` mounts a file over `/config/checks.json`. With `/config` a directory mount in `compose.yaml`, a file mount inside it would overlay a path inside a read-only mount (Docker would need to create the mountpoint; fails on a read-only parent). The e2e override must change to a directory mount (e.g. `./compose/e2e/ro:/config:ro`, holding a copy of the e2e checks) or the 503 test must use another path. The plan must settle this and keep the 503 test.
3. The new e2e step. The atomic replace must target a directory that the api container sees with a changing inode. The existing e2e api reads `/config-rw/checks.json` (writable dir mount, already a directory), so the step can run there: write `${checks_file}.tmp` (same directory), `mv` over `checks_file`, send `HUP` (and/or wait the 2 s poll), assert `GET /checks` lists the change. Caveat: the existing admin-route tests also rename within that directory, so a pass there does not prove the regular read-only mount works. Better: also exercise the regular `:ro` directory mount, e.g. by the second api (as in the 503 test, `PULSE_CHECKS_FILE=/config/checks.json`, another port) after an atomic `mv` of the host file under the ro directory. The spec should say which mount the assertion uses; assumption: at least the read-only directory mount, since that is what the issue is about.
4. Permissions. The `mv`-created file keeps the temp file's mode and owner (host user); the container user (`bun`) must be able to read it. `mktemp` creates mode 600, which would break reading; the step must `chmod 644/666` or create the temp file with `cp`/redirect (umask). Mention in the plan.
5. Cleanup. The step must restore the original checks file (the cleanup trap copies `checks_backup` back with `cp`; with an atomic step the restore should keep working, and leave no stray temp file in the mounted dir).
6. Meta README. The issue says to remove the sentence that describes this limit next to hot reload (added in #420). In this repository's `README.md` (line 69) the text still says the API reads the file once at startup and `up -d` does not recreate it; no sentence about the inode/atomic-save limit exists on `main` of meta. Assumption: either #420's README change has not landed here or is worded differently. The spec must make the README change conditional: remove any sentence about the single-file bind mount/atomic-save limit if present, and flag a finding if not. Plan should also consider that line 69 is stale about hot reload, but fixing it is outside this issue unless #420 is the owner.
7. `docs/operation.md` line 100 explains why `fs.watch` is not used ("a rename over a bind mount loses the inode"). After the change the rationale stays true for single-file mounts; reword so it does not contradict the new directory mount (keep the polling design; do not add `fs.watch`).
8. `docs/install.md` `docker run` example (`-v "$PWD/checks.json:/config/checks.json:ro"`) has the same flaw. Assumption: change it to a directory mount, with a short note that single-file mounts do not see atomic replaces. Also `bench/compose.bench.yaml`: check whether it mounts the file; change only if it relies on hot reload.
9. Not in scope: notify's single-file mount, the demo profile (volume `demo-config` is already a directory), any change to `src/`, and changes to other targets.

## Assumptions

- Only `pulse-api` changes (plus the meta README sentence). `targets.json` lists `api` alone; no `dependsOn`.
- The read-only default stays; the writable directory mount stays documented as the opt-in (needs `PULSE_API_ADMIN_TOKENS_FILE`, directory writable by the container user).
- No new runtime dependency.

## Acceptance check (derived)

1. `compose.yaml` mounts a directory containing the checks file into `/config` read-only (`PULSE_CHECKS_FILE=/config/checks.json`); no single-file bind mount of the checks file remains in `compose.yaml`, `docs/install.md`, `docs/operation.md#changing-checks`. The writable opt-in is documented as a directory mount.
2. `scripts/compose-e2e.sh` has a step that writes a temp file in the same host directory as the checks file, `mv`s it over the checks file, triggers a reload (`docker compose kill -s HUP api`, and/or waits for the poll), and asserts with `GET /checks` that the change is served. Run against the old single-file mount, the step would fail (the reproduction in the issue).
3. The full `scripts/compose-e2e.sh` still passes, including the read-only mount answering `503` to an admin write.
4. Manual: edit the checks file with `sed -i` on the host, run `docker compose kill -s HUP api`, and `GET /checks` serves the new config.
5. Meta `README.md` no longer carries the sentence about the atomic-save/single-file limit (if present).
