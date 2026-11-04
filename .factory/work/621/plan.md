# Spec #621: deploy e2e for scoped tokens, audit and header host binding

## Goal

pulse-deploy's compose e2e (`e2e/compose-e2e.sh`) covers the behavior that #617 (spec #561, hashed scoped tokens and audit) and #552 (probe header host binding) brought to the api and the probe. It does so when deploy bumps its pins to the first published images that contain them:

- A manual-incident write with a probe token answers exactly `403`. A write without a token still answers exactly `401`.
- A new step "Tokens and audit" ports the compose checklist of spec #561 api T6 (`.factory/work/561/tasks/api.json`, T6, `bash scripts/compose-e2e.sh` acceptance). That check was planned for pulse-api's own script, which moved to deploy (#543) while #617 was in build.
- "Persistence across down and up" also proves that tokens and audit entries survive a restart.
- Header host binding (#552) is exercised by a probe that enforces it. The deploy overlay already sets the binding (`e2e/compose.e2e.yaml:44`).

## Scope

- Repository `deploy` only: `e2e/compose-e2e.sh`, the api and probe pins in `common/services.yaml` (through `scripts/bump-images.sh`), and the e2e paragraph of `README.md`.
- Two release prerequisites, which a person carries out and which are not part of a repository section (see "Release prerequisites").

## Non-goals

- No change to api, probe, contract or any other repository. Token storage, scopes, audit and binding are implemented. This spec only tests them in Compose.
- No new header-binding denial scenario in the e2e. Spec #552 behavior 13 says so: a check that stays down would change the incident and notify counts of the script. Denial stays covered by probe tests. The deny run below is acceptance evidence only and is not committed.
- No test of the 10-minute overlap end, of expiry, or of the last-admin rule. Those are api tests (#561 T4).
- No rotation or revocation of the stack's bootstrap tokens (the imported probe token and the `e2e` admin token).
- No bump of status, notify or console. They stay on `0.1.0`.
- No change to `full/`, `minimal/`, `demo/`, `dev/`, the CLI or CI workflow files.

## Release prerequisites

A person creates these releases (a `v*` tag in the service repository; api `.github/workflows/ci.yml:6` and `:55-63` run the release on such a tag). The deploy child cannot be accepted without them.

| Image | Must contain | Marker commit | Today |
|---|---|---|---|
| `ghcr.io/lorenzh/pulse-api` | #617 (api PR #78, "hashed, scoped admin and probe tokens with rotation") | `e1153f99ba3466f6509d29760896e2cdf5061fb5` | Only `v0.1.0` exists. It points at `c00a375a1d78e17e9d01b8c25b5ae69b4fc3860e`, the #561 baseline before #617. api `main` `2d4a6b2` contains the marker (`gh api repos/lorenzh/pulse-api/compare/e1153f9...2d4a6b2` → `ahead`). |
| `ghcr.io/lorenzh/pulse-probe` | #552 probe change (`PULSE_PROBE_HEADER_HOSTS`, `src/header-hosts.ts`) | `a5dc88d5473a9c63cfd984988201da32cd15ec5c` ("feat: bind probe header secrets to hosts and cap reasons") | Only `v0.1.0` exists, at `50ec9cabe8aebe6164eff6cf2272b0a6c6c86605`. It has no `src/header-hosts.ts` (contents API answers 404 at `v0.1.0`). Probe `main` `89f1232` contains the marker. |

The implementer checks that each chosen tag contains its marker:

```sh
gh api repos/lorenzh/pulse-api/compare/e1153f99ba3466f6509d29760896e2cdf5061fb5...v<x.y.z> --jq .status    # ahead or identical
gh api repos/lorenzh/pulse-probe/compare/a5dc88d5473a9c63cfd984988201da32cd15ec5c...v<x.y.z> --jq .status  # ahead or identical
```

`behind` or `diverged` means the tag does not contain the change. If no qualifying api or probe tag exists, the implementer requests a `needs-input` hold that names the missing release. It does not merge new checks against old images, and it does not guard them with skips or version switches.

## Required behavior

All changes are in deploy's `e2e/compose-e2e.sh`. Line numbers refer to deploy `main` `621cbf0`.

1. **Manual incidents (lines 483-489).** Keep the `401` assertion for a write without a token (line 486). Replace the "401 or 403" allowance (lines 487-488) with exactly `403` for the stack's probe token. The failure text is `a probe token write was not refused with 403` and the success line is `ok: a write without a token answers 401, a probe token write answers 403`. This matches the branch diff in the issue body.
2. **New step `Tokens and audit`.** It comes after the read-only-mount check (after line 679) and before `step "Persistence across down and up"` (line 681). By then "Checks via the admin API and hot reload" has created and deleted `e2e-api` with the `e2e` admin token (lines 610-619). In this order:
   1. **Scope denial.** `POST /admin/tokens` with the `e2e` admin token and `{"name":"e2e-read-checks","scopes":["read","checks"]}` answers `201`. The body has `secret` (a string) and `token.id` (matches `^tok_[0-9a-f]{24}$`, contract `src/token-id.ts:2`). Note the `pulse_api_config_writes_total{kind="check",action="create",result="ok"}` line and the `ETag` of `GET /admin/config` (via `cfg_etag`). Then `POST /admin/checks` with the new secret, a valid body for the unused id `e2e-scope-denied`, `Content-Type: application/json` and `If-Match` set to the current revision answers exactly `403`. After that, `GET /checks` does not list `e2e-scope-denied`, the `ETag` is the same, and the create counter line is the same. A valid revision and body mean that the `403` comes from the missing `admin` scope, not from a body or revision error.
   2. **Rotation lifecycle.** `POST /admin/tokens` with `{"name":"e2e-rotated","scopes":["probe"],"location":"e2e-rotated"}` answers `201`. Its secret A gets `200` on `GET /probe/checks`. `POST /admin/tokens/<id>/rotate` with body `{}` answers `200` with a new secret B (different from A) and a numeric `previousValidUntil`. Within the overlap, A and B each get `200` on `GET /probe/checks`. B on `GET /admin/audit` gets exactly `403` (a probe token holds no `admin`). `POST /admin/tokens/<id>/revoke` answers `200`. After that, A and B each get exactly `401` on `GET /probe/checks`.
   3. **Audit query.** `GET /admin/audit?action=check.create&targetId=e2e-api` with the `e2e` admin token answers `200`. Its `entries` hold at least one entry with `target.kind == "check"`, `target.id == "e2e-api"` and `actor.name == "e2e"`. Note that entry's `id` for step 3. `GET /admin/audit?targetKind=token&targetId=<id of e2e-rotated>` holds the actions `token.create`, `token.rotate` and `token.revoke`, each with `actor.name == "e2e"`.
   4. **Audit export.** `GET /admin/audit/export` answers `200` with a non-empty body. Each line parses alone with `jq -e 'type == "object"'`. The noted `check.create` entry id is among the lines.
   5. **No secret anywhere.** Collect the secrets: the `e2e` admin token, the `e2e-read-checks` secret, A and B. None of them occurs (fixed-string match) in the audit query bodies, in the export or in `docker compose logs --no-color`. A failure names the place and the secret's role (for example `the audit export shows the rotated secret`), never the value. The script never echoes a secret or a whole response that holds one.
   6. **No throttle.** No series of `pulse_api_admin_auth_throttled_total` in `GET /metrics` has a value above 0 (see Risks: admin auth throttle).
3. **Persistence across down and up (lines 681-691).** After `docker compose up -d` and the api answers, also check:
   - `GET /admin/config` with the same `e2e` admin token answers `200`. The token now comes from the database: the admin file import is done, so the file is ignored (api `src/start.ts:149-150`).
   - The `check.create` entry for `e2e-api` with the noted id is still returned by `GET /admin/audit?action=check.create&targetId=e2e-api`.
   - After all services are healthy, `docker compose logs --no-color` of the new containers holds none of the collected secrets. `down` removed the old containers and their logs, which step 2.5 checked.
4. **Header host binding.** Keep the overlay's `PULSE_PROBE_HEADER_HOSTS` and the `e2e-post` scenario (lines 411-441) as they are. Do not add the fixture a second time. With the bumped probe, `e2e-post is up` (line 412) and `e2e-post is up again` (line 437) now prove that the bound host gets the header.
5. **Pins.** `scripts/bump-images.sh api=<x.y.z> probe=<x.y.z>` (usage: `scripts/bump-images.sh:3`) writes both pins into `common/services.yaml`. That is the only file with pins (deploy `AGENTS.md`, Rules). `scripts/bump-images.sh --verify` passes.
6. **README.** The "End-to-end test" paragraph (`README.md:119-121`) also says that the e2e covers token scopes, rotation and revocation, the audit query and export, and their survival across a restart. It names no image version.
7. **Unchanged.** Every other assertion of the script, the secret checks of `assert_absent`, loopback-only publishing, cleanup and the clean stop.

## Risks

- **Admin auth throttle.** api `README.md` "Tokens and audit": 10 failed admin authentications (`401` or `403`) from one client within 60 s make every admin request of that client answer `429`, also with a valid token. The budget covers `/admin/*` and manual-incident writes (`requireAdmin`, api `src/server.ts:429-445`). It does not cover `/probe/checks` (`requireProbe`, `src/server.ts:449-458`) or heartbeat routes. All host requests share one client address. This spec's failures on admin routes are: `401` and `403` in "Manual incidents", then `403` (scope denial) and `403` (B on `/admin/audit`) in "Tokens and audit". That is 4, below 10. The implementer adds no further failed admin calls. Step 2.6 turns an unexpected throttle into a clear failure.
- **A new probe location.** The `e2e-rotated` token has its own location. `GET /locations` comes from results (`service.listLocations()`, `src/server.ts:669-670`), and the lifecycle posts none. `locations_report` (line 577) runs earlier, in the outage step. So the extra token does not change a later assertion.
- **Newer probe image.** Probe `main` changed reason texts ("cap reasons" in `a5dc88d`). The script compares exact reasons (lines 431-435, 403). If the bumped probe changes one, the implementer reports the actual reason in a `needs-input` hold. It does not weaken the comparison.
- **Older images against the new api.** Status, notify and console stay on `0.1.0`. See Rollout order for why they keep working.
- **Release timing.** The child stays blocked until a person tags both releases.
- **Fixture validity.** #597 (api half of #552) tightened check validation. `e2e/ro/checks.json` uses `{"env":"PULSE_HEADER_SVC_TOKEN"}`, which matches `^PULSE_HEADER_[A-Za-z0-9_]{1,115}$`, and its URLs have no userinfo. If the new api still refuses a fixture, the implementer reports it in a hold and does not reshape the fixture silently.

## Performance impact

None expected for `bench/budgets.json` in the api repository (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `cold_read_cpu_ms`, `eod_read_cpu_ms`, and the reported wall-clock startup, p95 latency, requests per second and image size). This change edits a deploy test script and pins; it changes no api code. The api image's own numbers moved, if at all, with #617, and were measured in that PR against `c00a375`.

The deploy `full` job reports start time and RSS of the stack (`scripts/measure.sh full`, `ci.yml:111`). The new api and probe images can move these, in either direction. The implementer quotes that job's output before and after the bump in the PR, for information only. No budget gates it. The e2e gets about 10 to 20 s longer (a handful of curl calls, one extra `logs` read). That stays well inside its 30-minute step limit (`ci.yml:119`).

## Security impact

Security impact: yes
The change tests admin authentication and status codes, handles live credentials in a CI script and its logs, and changes image pins (dependencies).

Applicable checklist items:
- **Secrets in errors, logs and responses.** The script holds four live secrets. It never prints them, and failure lines name only the rule and the secret's role (deploy `AGENTS.md`: "Scripts never print a token"). The audit query, the export and the compose logs before and after the restart are checked to contain none of them. The `cleanup` trap prints `docker compose logs` on failure (lines 62-66). Because step 2.5 asserts no secret in those logs, that dump holds none either.
- **Auth order and status codes.** No token → `401`. Probe token on a manual-incident write → `403`. `["read","checks"]` on `POST /admin/checks` → `403`. Probe token on `GET /admin/audit` → `403`. Revoked credentials → `401`. Each is an exact literal, never a set.
- **Dependency pins.** The api and probe pins change only through `scripts/bump-images.sh` (tag plus digest from ghcr.io) and pass `--verify`. Each tag's source contains its marker commit (Release prerequisites).

Not applicable: body and size limits, input validation, accessor execution, SSRF and redirects, atomic and path-safe writes. No parser, validator, probe client, file write or Dockerfile changes.

## Rollout order

Several repositories are involved, but only deploy gets a code change:

1. **A person releases api** from a `main` that contains `e1153f9`. Running deploy (`api:0.1.0`) is unaffected until the bump.
2. **A person releases probe** from a `main` that contains `a5dc88d`. Order 1 and 2 freely.
3. **deploy merges** the bump and the e2e change. In that stack these older images keep working:
   - **probe** (new release): its wire is unchanged. It sends `Authorization: Bearer <token>` on `GET /probe/checks` and `POST /results` (probe `src/client.ts`). Its token from `tokens.json` is imported on first start.
   - **status `0.1.0`, notify `0.1.0`:** they read public routes and `GET /manual-incidents`, whose behavior #561 left unchanged (spec #561 Rollout order, step 2).
   - **console `0.1.0`:** it calls no admin route (spec #561 Rollout order, step 2). The `full` setup gives the api no admin file (`full/compose.yaml:28-40`), so nothing changes there.
   - **Users who upgrade an existing `full` volume:** the api migrates the database and imports the token files once (api `src/start.ts:133-162`). A downgrade to `0.1.0` refuses the newer database. Recovery is a backup restore, as api `docs/operation.md` documents for #561. Deploy docs gain no new claim about this.

## Counterexamples

- **Probe token on a manual write:** an implementation that keeps `== "401" || == "403"` passes against api `0.1.0`, which answers `401`. It must fail there. The new script run against `api:0.1.0` fails at "Manual incidents" with `a probe token write was not refused with 403`. The issue's historical line, which expects `401`, fails against the new api.
- **No token on a manual write:** `403` instead of `401` fails the step.
- **Scope denial must be about scope:** a request without `If-Match`, with a stale revision or with an invalid body could also be refused. The check must send the current revision and a valid body for an unused id. A wrong implementation that accepts `400`, `409`, `412` or `428` as "denied" is wrong. Only `403` passes.
- **The denied write must have no effect:** a `403` that still stored the check would leave `e2e-scope-denied` in `GET /checks` and change the `ETag` or the create counter. Each of these three fails the step.
- **Overlap:** after rotate, an implementation that checks only B misses a broken overlap. A must still get `200`. After revoke, A or B answering `200`, or answering `403` instead of `401`, fails.
- **Audit attribution:** an entry with `target.id == "e2e-api"` but `actor.name` other than `"e2e"` fails. An empty `entries` array fails. A match on `targetId` alone, without `action == "check.create"`, does not count.
- **Export:** an empty `200` body fails. So does a body that is one JSON array instead of one object per line, or a line that does not parse.
- **Secret leak:** any of the four secrets as a substring of the audit query, the export or the logs fails, including a secret inside a longer string. The match is fixed-string (`grep -F`), not a regex.
- **Restart:** an implementation that checks only `/checks` after `up` misses lost tokens. The `e2e` admin token must get `200` on `/admin/config`, and the noted audit entry id must still be returned.
- **Throttle budget:** a fifth failed admin call is not added. If a run shows a `pulse_api_admin_auth_throttled_total` series above `0`, it fails.
- **Binding:** a stack on `probe:0.1.0` passes the `e2e-post` steps whether or not `PULSE_PROBE_HEADER_HOSTS` is set, so it proves no binding. The deny run (Acceptance evidence) must show `e2e-post` down with the probe's reason `header Authorization env PULSE_HEADER_SVC_TOKEN is not bound to host e2e-target`. That text comes from probe `src/client.ts:160` (`header ${name} env ${raw.env} is not bound to host ${host}`). A run that stays `up` without the binding means the pinned probe does not enforce it.

No statistic is defined by this spec.

## Contract fields

No new names in the contract or config. The spec adds only test data: the token names `e2e-read-checks` and `e2e-rotated`, the location `e2e-rotated`, the check id `e2e-scope-denied` and the step title `Tokens and audit`. They do not collide with anything:

```sh
grep -rn -e 'e2e-rotated' -e 'e2e-read-checks' -e 'e2e-scope-denied' -e 'Tokens and audit' \
  .repos/contract/src .repos/config .repos/deploy
# no output
```

The routes and fields used already exist: `/admin/tokens`, `/admin/tokens/:id/rotate|revoke` (api `src/token-routes.ts:38`), `/admin/audit` and `/admin/audit/export` (api `src/audit-routes.ts:19-21`), and the audit actions `check.create`, `token.create`, `token.rotate`, `token.revoke` (contract `src/audit.ts:6-24`).

## Repository: deploy

Files:
- `e2e/compose-e2e.sh`
- `common/services.yaml` (api and probe pins, written by `scripts/bump-images.sh`)
- `README.md`

Behavior change: yes
The e2e asserts stricter and new status codes, adds a step, and the stack runs new api and probe images.

### Behavior

Required behavior items 1-7 above. Implementation notes:

- `manual_code` (lines 232-237) already takes a token argument and can send any credential. `cfg_code` (lines 598-603) always sends the admin token. Add a helper that sends a given credential with the current revision (the revision is still read with the admin token via `cfg_etag`), or give `cfg_code` an optional token. Keep existing callers unchanged.
- Keep the collected secrets in shell variables only. Never write them to a file under the checkout, and never pass them to `echo`, `printf` or `fail`. Check them with a function in the style of `assert_absent` (lines 390-396) that takes the place, the role and the text.
- Read JSON with `jq -e`. On a mismatch, fail with the rule and not the body: token responses hold secrets.
- Do not change `assert_absent`'s needle list. The new secrets get their own check.

### Checks (CI jobs touched)

Tool facts, from deploy `main` `621cbf0`:
- `lint` runs `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and `... bash -n` (`.github/workflows/ci.yml:34-37`), `jq empty` over JSON (`:40-41`), the helper tests and `scripts/check-setup.sh` (`:42-51`).
- `pins` runs `scripts/bump-images.sh --verify` (`ci.yml:71`).
- `full` runs `scripts/measure.sh full` (`ci.yml:111`) and then `bash e2e/compose-e2e.sh` with `timeout-minutes: 30` (`ci.yml:119-120`).
- `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`ci.yml:17`). At that pin it runs `bun run lint`, `typecheck`, `build`, `git diff --exit-code -- dist` and `test` (pinned `check.yml:26-38`, read with `gh api .../contents/.github/workflows/check.yml?ref=04108fa...`). It is identical to the config clone. Biome excludes `*.md`, `common`, `e2e` and `scripts` (deploy `biome.json:13-14,17,20`), so this job reads none of the changed files. It must still be green.

The implementer runs from the repository root before handoff:
- `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and `git ls-files -z '*.sh' | xargs -0 -n 1 bash -n`
- `bash e2e/metric-is.test.sh`, `bash e2e/manual-count.test.sh`, `bash e2e/published-port.test.sh`, `bash e2e/outage-history.test.sh`, `scripts/check-setup.sh`, `bash scripts/check-setup.test.sh`, `bash scripts/bump-images.test.sh`
- `scripts/bump-images.sh --verify`
- `scripts/init-secrets.sh && scripts/measure.sh full`, then `bash e2e/compose-e2e.sh`

### Acceptance evidence (deploy PR)

Each expected value is a literal here, or comes from the independent source named.

1. **Release identity.** For api and probe: the tag, `gh api repos/lorenzh/pulse-<svc>/git/refs/tags/v<x.y.z> --jq .object.sha`, the compare status against the marker commit (`ahead` or `identical`, see Release prerequisites), and the digest that `bump-images.sh` wrote. `scripts/bump-images.sh --verify` prints `ok:` for all five services, and the expected digests come from ghcr.io. `git diff main -- common/services.yaml` changes exactly the api and probe `image:` lines.
2. **Red: old expectation, new api.** In a scratch copy of the branch (not committed), restore the issue's historical line, which expects `"401"` for the probe-token write, and run `bash e2e/compose-e2e.sh`. Expected: exit 1, with `FAIL: a probe token write was not refused` in the "Manual incidents" step. The PR says that deploy `main` accepted both `401` and `403` (lines 487-488), so `main` itself could not show this red.
3. **Red: new script, old api.** In a scratch copy, set the api pin back to the current `main` pin (`git show main:common/services.yaml`, api `0.1.0`), keep the new script and run it. Expected: exit 1, with `FAIL: a probe token write was not refused with 403`, because `0.1.0` answers `401`. This proves the strict check can fail. Restore the pin afterwards. The committed file keeps only the new pin.
4. **Green.** `bash e2e/compose-e2e.sh` on the branch exits 0. It prints `ok: a write without a token answers 401, a probe token write answers 403`, `==> Tokens and audit` with an `ok:` line for each of items 2.1-2.6, the new persistence lines, and ends with `==> All checks passed`. The CI `full` job on the PR is green.
5. **Binding deny run (not committed).** In a scratch copy, delete the `PULSE_PROBE_HEADER_HOSTS` line from `e2e/compose.e2e.yaml`, start the stack (`COMPOSE_PROJECT_NAME=pulse-e2e COMPOSE_FILE=full/compose.yaml:e2e/compose.e2e.yaml PULSE_SECRETS_DIR=$PWD/e2e/.secrets docker compose up -d` after `scripts/init-secrets.sh --dir e2e/.secrets`). Within 90 s, `GET /checks` shows `e2e-post` with `state == "down"` and `lastReason == "header Authorization env PULSE_HEADER_SVC_TOKEN is not bound to host e2e-target"` (probe `src/client.ts:160`). Tear down with `down -v`. With the line in place (item 4), `e2e-post` is up. The PR quotes both, which shows that the pinned probe enforces the binding.
6. **No secret in evidence.** The PR body holds no token, secret or full token response. A reviewer can check this with `gh pr view <pr> --json body --jq .body | grep -cF e2e-admin-token-sentinel`, which must print `0`.
7. **Checks.** Output of the commands in "Checks", all exit 0, and green CI jobs `check`, `lint`, `pins`, `minimal`, `full`, `demo`, `dev`, `cli-*`.
