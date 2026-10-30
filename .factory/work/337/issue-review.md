# Issue review: #337 E2E fixtures leaked into the regular Compose stack

## Verdict
Specifiable. Only the `api` target changes (compose.yaml, compose/, scripts/compose-e2e.sh, docs/). The docs named in the issue (`docs/install.md`, `docs/development.md`, `docs/rest-api.md`) live in `pulse-api`, not in pulse-meta. `targets.json` therefore has one target, `api`, with no `dependsOn`.

## Verified current state (`.repos/api`)
- `compose/checks.json` has `status-page`, `e2e-post` and `heartbeat-e2e`.
- `compose.yaml` has the `e2e-target` service (node:24-alpine, mounts `compose/e2e/target.mjs`). `probe` has `SVC_TOKEN: Bearer ${E2E_SVC_TOKEN:-e2e-svc-token-sentinel}` and `depends_on: e2e-target`.
- `scripts/compose-e2e.sh` calls plain `docker compose ...` everywhere and edits `compose/checks.json` in place:
  - It takes a backup first and restores it in `cleanup`.
  - The reload step does `jq '.checks += [e2e-api]' "$checks_backup" > "$checks_file"`.
  - It runs `docker compose exec e2e-target`, so the target service must stay in the e2e stack.
- `docs/install.md:50` says the status healthcheck is `GET /`. The pulse-status image uses `/healthz` (verify in `.repos/status`; the issue states it).
- `docs/rest-api.md` overview table lacks `GET /probe/checks` (section exists at line 119) and `GET|POST /heartbeat/:id[/:secret]` (section at line 209).
- `docs/development.md:58-60` describes the e2e and says the heartbeat secret lives in `compose/checks.json`. `docs/install.md:42` and `:79` name `compose/checks.json` as the example check file.

## Assumptions
1. File names: `compose.e2e.yaml` (e2e-target, probe `SVC_TOKEN` env, the `depends_on` addition, and an api volume override mounting the e2e checks file at `/config/checks.json`) and `compose/e2e/checks.json` (status-page, e2e-post, heartbeat-e2e). Compose merges `volumes` by target path, so the override replaces the `/config/checks.json` mount. `depends_on` and `environment` merge additively.
2. `compose/checks.json` keeps only `status-page` (the issue says "example check(s)"). No new heartbeat example is added: an unpinged heartbeat would reproduce the bug.
3. The script selects the stack with `export COMPOSE_FILE=compose.yaml:compose.e2e.yaml` (or `-f` flags everywhere). The path separator is `:` on Linux. The `docker compose config | grep name:` check and all `ps`, `exec` and `logs` calls must see the merged stack.
4. `checks_file` in the script becomes `compose/e2e/checks.json`. The backup, restore and `e2e-api` append logic stays, but works on the e2e file. `compose/checks.json` is never modified.
5. The `E2E_SVC_TOKEN` default moves out of `compose.yaml`; the sentinel default lives only in `compose.e2e.yaml`.
6. The regression guard runs early, before `up`: `jq -e '[.checks[].id | select(startswith("e2e-"))] | length == 0' compose/checks.json`. It also covers `heartbeat-e2e`. `startswith("e2e-")` alone misses it, so the guard should also reject ids containing `e2e` (use `test("e2e")`). The issue only says "no `e2e-` ids"; the broader check is a superset.
7. The demo profile and the `down` and `--profile demo` calls stay as they are.

## Open points (non-blocking, for the spec)
- The e2e no longer starts the stack with the regular `compose/checks.json`. The "regular stack" coverage comes from the shared services plus `status-page` (kept in the e2e checks file). The spec should state this. Optionally add a `docker compose -f compose.yaml config` assertion that no `e2e-target` service exists.
- Duplicated `status-page` check between the two files could drift. Options: accept the duplication (simple), or build the e2e file with jq from the regular one plus the fixtures. The spec should choose; the simple copy is the assumed default.
- `docs/rest-api.md` rows to add: `GET /probe/checks` (Bearer probe token, `ProbeCheck[]`; confirm the exact type name from the section at line 119) and `GET|POST /heartbeat/:id[/:secret]` (check secret, `204`; confirm from line 209).
- The restore-on-exit logic must stay correct if the script is interrupted. With the e2e file as the edited one, `compose/checks.json` is no longer at risk, which is an improvement.
- CI workflow (`.github/workflows` in api, if it references `compose/checks.json`) was not checked; the implementer should grep for it.
- `docs/install.md:42` says the stack "works offline" because of `status-page`. This stays true.

## Derived acceptance check
1. `cp .env.example .env && docker compose up -d --build` (regular stack):
   - `docker compose config --services` lists exactly `api`, `probe`, `status`, `notify`, with no demo or e2e services.
   - `compose/checks.json` has only the `status-page` check and no id containing `e2e`.
   - After about 30 s, `GET /checks` shows no `down` check and `GET /incidents` is empty.
2. `bash scripts/compose-e2e.sh` exits 0:
   - It uses `compose.yaml` plus `compose.e2e.yaml` and the e2e checks file.
   - It covers heartbeat, the HTTP options (`e2e-post`), the reload, the volumes and the demo.
   - It fails if `compose/checks.json` holds an `e2e` id.
   - `git status` is clean afterwards.
3. Docs:
   - `docs/install.md` and `docs/development.md` describe the split.
   - The status healthcheck row reads `GET /healthz`.
   - The `docs/rest-api.md` overview lists `GET /probe/checks` and `/heartbeat/:id`.
4. No change under `src/`.
