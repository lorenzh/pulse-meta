# Spec #431: Compose mounts the checks directory so hot reload sees atomic saves

## Goal

The Compose stack in pulse-api bind-mounts the single file `./compose/checks.json`. A single-file bind mount pins the inode, so after an atomic replace on the host (editor save-by-rename, `sed -i`) the container keeps the old content, and `SIGHUP` re-reads it. Mount the directory instead, so the container sees the new inode and hot reload works.

## Scope

- `compose.yaml`, `compose.e2e.yaml`, `scripts/compose-e2e.sh`, `docs/install.md`, `docs/operation.md`, `docs/development.md` (if it mentions the mount) in pulse-api.
- `bench/compose.bench.yaml`: only if the bench relies on hot reload (it does not need to change otherwise).
- Meta `README.md` line ~71 (see "Meta follow-up").

## Non-goals

- No change in `src/`: hot reload already compares mtime, size and inode.
- No `fs.watch`; the polling design stays.
- notify's single-file mount (`./compose/notify.json`), the demo profile, other targets.
- No new dependency.

## Required behavior

- `compose.yaml`: the `api` service mounts `./compose:/config:ro` (read-only by default) with `PULSE_CHECKS_FILE=/config/checks.json` unchanged. The host file stays `compose/checks.json`. No single-file bind mount of the checks file remains. The comment above the mount keeps the writable opt-in: replace `:ro` with a writable `./compose:/config` mount (needs `PULSE_API_ADMIN_TOKENS_FILE`; directory writable by the container user). Check that the read-only directory does not expose anything sensitive (`compose/` holds `notify.json`, `demo/`, `e2e/`; none are secrets); if it does, use a dedicated subdirectory instead and say so in the docs.
- `compose.e2e.yaml`: the override of `/config/checks.json` becomes a directory mount (for example `./compose/e2e/ro:/config:ro` holding the `checks.json` for the 503 test; move the file accordingly and update the script and `docs/development.md`). The read-only 503 test stays: a second api in the same container uses `PULSE_CHECKS_FILE=/config/checks.json` on the read-only directory and still answers 503 to a valid admin write. The writable `/config-rw` mount stays.
- `scripts/compose-e2e.sh`, new step next to the existing hot-reload step (which edits in place and stays):
  1. Create a temp file in the same host directory as the checks file (`mktemp "$dir/.checks.XXXXXX"`), write a changed config (a new check or a changed field), `chmod 644` it (`mktemp` makes mode 600, which the container user may not read), then `mv` it over the checks file.
  2. Run `docker compose kill -s HUP api`.
  3. Poll `GET /checks` until it serves the change, within the existing `E2E_TIMEOUT_*` style timeout; fail with a clear message otherwise.
  4. Run the step on the read-only directory mount as well as on the writable `/config-rw` one, or justify in the script comment which one it covers. The read-only mount is the default users run, so it must be covered.
  5. Restore the original file (atomically or with `cp`, as the existing cleanup does), leave no stray temp file in the mounted directory, and keep the cleanup trap working.
- `docs/install.md`: the `docker run` example mounts a directory (`-v "$PWD/config:/config:ro"` with `checks.json` and `tokens.json` inside), with a short note that a single-file mount does not see atomic replaces. The Compose section describes the directory mount.
- `docs/operation.md#changing-checks`: describes the directory mount; the line explaining why `fs.watch` is not used is reworded so it does not contradict it (a rename over a single-file bind mount loses the inode; the directory mount avoids this). The `503` paragraph for writes keeps saying a single-file mount or read-only mount answers 503 and names the writable directory mount as the opt-in.
- `bench/compose.bench.yaml`: leave unchanged unless a bench scenario reloads the file.

## Meta follow-up (not a child issue)

pulse-meta has no target, so the Factory opens no child for it. After the api PR merges, the person merging it edits `README.md` line ~71 in this repository:
- Remove the sentence starting `Limit: Compose bind-mounts the single file ...` through `A directory mount avoids this.`
- Fix the claim that admin routes with admin tokens enabled answer `503`: with tokens enabled, authenticated `GET /admin/config` answers `200`; only a write that is otherwise valid answers `503`, as long as the checks file is mounted read-only.
- Line 69 (API reads the file once at startup) may also be stale; check it against the final behavior.

## Risks

- Mounting the whole `compose/` directory read-only exposes sibling files to the api container; they hold no secrets today.
- File mode: a temp file from `mktemp` is 600; the e2e step must `chmod` it, else the container user cannot read it.
- Moving the e2e checks file breaks paths in the script and `docs/development.md` if missed.
- The e2e step could pass on the old mount if it only checks the in-place path; it must use `mv` and assert after `HUP`.

## Performance impact

none expected: only mount layout, docs and a test script change; nothing in `src/` or the image changes. Bench metrics (startup, load CPU, RSS, test, build, image size) are unaffected.

## Acceptance evidence

1. `grep` finds no single-file bind mount of the checks file in `compose.yaml`, `docs/install.md`, `docs/operation.md#changing-checks`.
2. `bash scripts/compose-e2e.sh` passes in full, including the new atomic-replace step and the 503 read-only test. Against the old single-file mount the new step fails (the reproduction from the issue).
3. Manual: `sed -i` on `compose/checks.json`, `docker compose kill -s HUP api`, `GET /checks` serves the new config.
4. `docker compose config --quiet` passes for `compose.yaml` and for `compose.yaml:compose.e2e.yaml`; the repo's lint/doc checks pass.

## Repository: api

Files: `compose.yaml`, `compose.e2e.yaml`, `compose/e2e/` (moved read-only fixture), `scripts/compose-e2e.sh`, `docs/install.md`, `docs/operation.md`, `docs/development.md`, optionally `bench/compose.bench.yaml`. Behavior, checks and completion evidence are as listed above. The PR description lists which e2e mount(s) the atomic step covers and states that the meta README follow-up is pending.
