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
   3. **Audit query.** `GET /admin/audit?action=check.create&targetId=e2e-api` with the `e2e` admin token answers `200`. Its `entries` hold at least one entry with `target.kind == "check"`, `target.id == "e2e-api"` and `actor.name == "e2e"`. Note that entry's `id` for step 2.4 and item 3. `GET /admin/audit?targetKind=token&targetId=<id of e2e-rotated>` holds the actions `token.create`, `token.rotate` and `token.revoke`, each with `actor.name == "e2e"`.
   4. **Audit export.** `GET /admin/audit/export` answers `200` with a non-empty body. Each line parses alone with `jq -e 'type == "object"'`. The noted `check.create` entry id is among the lines.
   5. **No secret anywhere.** Collect the secrets: the `e2e` admin token, the `e2e-read-checks` secret, A and B. None of them occurs (fixed-string match) in the audit query bodies, in the export or in `docker compose logs --no-color`. A failure names the place and the secret's role (for example `the audit export shows the rotated secret`), never the value. The script never echoes a secret or a whole response that holds one.
   6. **No throttle.** No series of `pulse_api_admin_auth_throttled_total` in `GET /metrics` has a value above 0 (see Risks: admin auth throttle).
3. **Persistence across down and up (lines 681-691).** After `docker compose up -d` and the api answers, also check:
   - `GET /admin/config` with the same `e2e` admin token answers `200`. The token now comes from the database: the admin file import is done, so the file is ignored (api `src/start.ts:149-150`).
   - The `check.create` entry for `e2e-api` with the noted id is still returned by `GET /admin/audit?action=check.create&targetId=e2e-api`.
   - After all services are healthy, `docker compose logs --no-color` of the new containers holds none of the collected secrets. `down` removed the old containers and their logs, which step 2.5 checked.
4. **Secret-safe failure output.** Today the `cleanup` trap prints `docker compose logs --no-color` raw on every non-zero exit (lines 59-66), and `assert_absent` prints the needle it found (`fail "$1 shows ${needle}"`, line 393). Both would print a credential exactly when a leak is detected, or when a step fails while a credential is in the logs. Change both:
   - **Redacted dump.** The trap still prints `==> Failure (exit <code>): stack state and logs`, `docker compose ps --all` and the logs. Before it prints the logs, it replaces every fixed-string occurrence of each known credential with `<redacted:<role>>`. There are six credentials, each with its role:

     | Variable | Role | Value comes from | Set at |
     |---|---|---|---|
     | `e2e_admin_token` | `e2e-admin-token` | `${E2E_ADMIN_TOKEN:-e2e-admin-token-sentinel-0123456789abcdef}`, the same default as `e2e/compose.e2e.yaml:61` | Already top level at line 227, before any container starts. Unchanged. |
     | `e2e_token` | `e2e-svc-token` | `${E2E_SVC_TOKEN:-e2e-svc-token-sentinel}`, the same default as `e2e/compose.e2e.yaml:41,54` | **Moves.** Today it is set at line 373, after the stack starts (line 335) and after "Health and metrics" and "First check result". Set it at top level next to `e2e_admin_token` (line 227) and delete the assignment at line 373. Its value does not change. |
     | `probe_token` | `probe-token` | first line of `$secrets_dir/probe-token` | **Moves.** Today it is read at line 484 ("Manual incidents"). Read it right after `scripts/init-secrets.sh --dir "$secrets_dir"` (line 315), before `docker compose up` (line 335). "Manual incidents" reuses the variable and does not read the file again. |
     | read-checks secret | `read-checks-secret` | `POST /admin/tokens` in step 2.1 | Declared empty at top level; set when the api returns it. |
     | secret A | `rotated-secret-a` | `POST /admin/tokens` in step 2.2 | Declared empty at top level; set when the api returns it. |
     | secret B | `rotated-secret-b` | `POST /admin/tokens/<id>/rotate` in step 2.2 | Declared empty at top level; set when the api returns it. |

     The rule: every credential the stack holds from its start (admin token, header secret, probe token) has its final value before the first command that starts a container (`docker compose up -d --pull missing`, line 335). The trap therefore redacts them on any failure during startup, health or the first checks. Only the three secrets that the api issues during the run can be empty when the trap runs. Use a literal replacement such as bash `${text//"$secret"/<redacted:role>}` with the pattern quoted, never `sed` or `grep` with the secret as a regex. Skip an empty variable: it holds nothing that can leak, and a replacement with an empty pattern is a no-op at best. All six variables exist before `trap cleanup EXIT` can fire with a container running, so `set -u` cannot abort the trap. The trap reads them with `${var:-}` anyway, because a failure in `init-secrets.sh` (line 315) exits before `probe_token` is read. Then the trap carries on with restore, `down -v --remove-orphans`, the removal of `e2e/rw` and the secrets cleanup, and exits with the original code. `e2e_body_sentinel` and `PULSE_HEADER_SVC_TOKEN` are markers, not credentials. They stay visible in the dump, so a reader can see where a body or env name leaked.
   - **Failure texts name the role.** `assert_absent` keeps its needle list and loop. Its failure text names the needle's role and never its value: `<place> shows the e2e svc token`, `<place> shows the body sentinel`, `<place> shows the header env name`. The new secret check from step 2.5 follows the same rule.
5. **Header host binding.** Keep the overlay's `PULSE_PROBE_HEADER_HOSTS` and the `e2e-post` scenario (lines 411-441) as they are. Do not add the fixture a second time. With the bumped probe, `e2e-post is up` (line 412) and `e2e-post is up again` (line 437) now prove that the bound host gets the header.
6. **Pins.** `scripts/bump-images.sh api=<x.y.z> probe=<x.y.z>` (usage: `scripts/bump-images.sh:3`) writes both pins into `common/services.yaml`. That is the only file with pins (deploy `AGENTS.md`, Rules). `scripts/bump-images.sh --verify` passes.
7. **README.** The "End-to-end test" paragraph (`README.md:119-121`) also says that the e2e covers token scopes, rotation and revocation, the audit query and export, and their survival across a restart. It names no image version.
8. **Unchanged.** Every other assertion of the script, the needle list of `assert_absent`, loopback-only publishing, the restore and teardown order of `cleanup`, and the clean stop.

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
- **Secrets in errors, logs and responses.** The script holds four live API secrets: the `e2e` admin token, the `e2e-read-checks` secret, A and B. It also holds the header secret `e2e_token` and the stack's probe token. It never prints any of them, and failure lines name only the rule and the secret's role (deploy `AGENTS.md`: "Scripts never print a token"). The audit query, the export and the compose logs before and after the restart are checked to contain none of them. The `cleanup` trap prints `docker compose logs` raw on failure (lines 62-66), and `assert_absent` prints the needle it matched (line 393). A detected leak, or any failure while a credential is in the logs, would put that credential into the CI log. Today `e2e_token` is set only at line 373, after the stack has started (line 335), so a redaction keyed on that variable would miss a header-secret leak during startup and health checks. Required behavior 4 sets every credential the stack holds from its start before line 335, redacts all six credentials from the failure dump, and makes every failure text name a role. Acceptance evidence 6 proves it with planted leaks at three points: during startup (before today's line 373), before the scan and at the scan. It also shows that teardown still runs.
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
- **Leak in the failure output:** a script that detects the leak correctly but then prints the raw `docker compose logs` in its trap, or prints the found needle in its `FAIL` line, is wrong: the credential lands in the CI log. A redaction built with `sed "s/$secret/.../"` is also wrong: it reads the secret as a regex and can miss the literal text or break on `/`. A trap that aborts on an unset secret variable under `set -u` and so skips `down -v` is wrong too. Teardown must run on every failure.
- **Leak before a credential variable is set:** an implementation that adds the redaction but keeps `e2e_token=` at line 373 is wrong. If "Health and metrics" times out (for example `wait_for "$T_UP" "probe is healthy"`), `e2e_token` is still unset, the trap skips it as empty, and a header secret that the probe or `e2e-target` wrote to its log is printed raw. The same holds for a `probe_token` that is read only in "Manual incidents". Run c of Acceptance evidence 6 fails on such an implementation.
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

Required behavior items 1-8 above. Implementation notes:

- `manual_code` (lines 232-237) already takes a token argument and can send any credential. `cfg_code` (lines 598-603) always sends the admin token. Add a helper that sends a given credential with the current revision (the revision is still read with the admin token via `cfg_etag`), or give `cfg_code` an optional token. Keep existing callers unchanged.
- Keep the collected secrets in shell variables only. Never write them to a file under the checkout, and never pass them to `echo`, `printf` or `fail`. Check them with a function in the style of `assert_absent` (lines 390-396) that takes the place, the role and the text.
- Read JSON with `jq -e`. On a mismatch, fail with the rule and not the body: token responses hold secrets.
- Do not change `assert_absent`'s needle list. Change only its failure text (Required behavior 4). The new secrets get their own check.
- Move the `e2e_token` assignment (line 373) to the top-level block at line 227, and the `probe_token` read (line 484) to just after line 315 (Required behavior 4 table). `assert_absent` (line 392) and the `e2e-post` steps keep using the same variable with the same value.
- The redaction in `cleanup` reads the logs once into a variable, applies one quoted-pattern replacement per non-empty credential, and prints the result. It does not change the exit code, and it runs before restore and `down -v`, as the raw dump does today.

### Checks (CI jobs touched)

Tool facts, from deploy `main` `621cbf0`:
- `lint` runs `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and `... bash -n` (`.github/workflows/ci.yml:34-37`), and `jq empty` over the JSON files (`:40-41`). It also runs the helper tests (`:42-49`), `scripts/check-setup.sh` and its test (`:50-53`), and the secrets-init, bump-images, wait-ready and init-secrets tests (`:54-61`).
- `pins` runs `scripts/bump-images.sh --verify` (`ci.yml:71`).
- `full` runs `scripts/measure.sh full` (`ci.yml:111`) and then `bash e2e/compose-e2e.sh` with `timeout-minutes: 30` (`ci.yml:118-120`). Its `Stack state and logs` step (`ci.yml:112-116`, `if: failure()`) covers only the measure stack, which is torn down before the e2e (`ci.yml:117`). Its `Teardown` step (`ci.yml:121-125`) runs `down -v` and prints no logs. So the e2e trap is the only place where e2e logs reach the CI log.
- `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`ci.yml:16-17`) without a `with:` block. The pinned `check.yml` (read with `gh api "repos/lorenzh/pulse-config/contents/.github/workflows/check.yml?ref=04108fa…" --jq .content | base64 -d`, identical to the config clone) declares the input `build`, `default: false` (`check.yml:6-9`). It runs `bun install --frozen-lockfile` (`:25-26`), `bun run lint` (`:27-28`), `bun run typecheck` (`:29-30`) and `bun run test` (`:37-38`). `Build` and `Check dist is up to date` have `if: ${{ inputs.build }}` (`:31-36`), so they are **skipped** for deploy.
  - deploy `package.json` defines these scripts. `lint` is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`). `typecheck` is `bun node_modules/typescript7/bin/tsc --noEmit` (`:12`). `test` is `bun test --coverage cli` (`:13`). Bun is `1.4.0` (`engines`, `:8-9`; `packageManager`, `:28`). `bunfig.toml:1-3` sets the coverage gate: `coverageThreshold = { lines = 0.8, functions = 0 }`, ignoring `**/*.test.ts`, `cli/test/**` and `dist/**`.
  - Biome excludes `*.md`, `common`, `e2e` and `scripts` (deploy `biome.json:13-14,17,20`), so lint does not read the changed files.
  - **The test step does read `common/services.yaml`.** `cli/services.ts:4` imports it as text, and `cli/services.ts:36-48` (`PULSE_IMAGE`, `assertPin`) enforces the pin shape `ghcr.io/lorenzh/pulse-<svc>:<x.y.z>@sha256:<64 hex>`. `cli/services.test.ts:31-66` parses the embedded file and checks its service keys and pins. A bump through `bump-images.sh` keeps that shape. The tests check the shape, never the value (deploy `AGENTS.md`, Rules), so no test changes.
- The CLI jobs also use the new pins. `cli-build` compiles `cli/main.ts`, which embeds `common/services.yaml` (`ci.yml:258`, `:282`), and runs `cli/test/smoke.sh` (`:296`). `cli-stack` builds the CLI and starts live `demo`, `full` and `minimal` stacks with the pinned images (`ci.yml:346-365`). In those stacks `cli/test/stack.sh:127-135` expects `200` for the admin token, `401` without a token and `403` for a probe token on `GET /admin/config`. #617 keeps all three codes (probe token: authenticated, no `admin` scope). If one changes, the implementer reports it in a hold and does not edit `stack.sh` silently.

The implementer runs from the repository root before handoff:
- `git ls-files -z '*.sh' | xargs -0 shellcheck -x` and `git ls-files -z '*.sh' | xargs -0 -n 1 bash -n`
- `bash e2e/metric-is.test.sh`, `bash e2e/manual-count.test.sh`, `bash e2e/published-port.test.sh`, `bash e2e/outage-history.test.sh`, `scripts/check-setup.sh`, `bash scripts/check-setup.test.sh`, `bash scripts/bump-images.test.sh`
- `scripts/bump-images.sh --verify`
- `bun install --frozen-lockfile && bun run check` (`package.json:18`: lint, typecheck, then `bun test --coverage cli` with the 0.8 line gate of `bunfig.toml:2`), then `bun run build && bash cli/test/stack.sh full` (the new pins through the CLI)
- `scripts/init-secrets.sh && scripts/measure.sh full`, then `bash e2e/compose-e2e.sh`

### Acceptance evidence (deploy PR)

Each expected value is a literal here, or comes from the independent source named.

1. **Release identity.** For api and probe: the tag, `gh api repos/lorenzh/pulse-<svc>/git/refs/tags/v<x.y.z> --jq .object.sha`, the compare status against the marker commit (`ahead` or `identical`, see Release prerequisites), and the digest that `bump-images.sh` wrote. `scripts/bump-images.sh --verify` prints `ok:` for all five services, and the expected digests come from ghcr.io. `git diff main -- common/services.yaml` changes exactly the api and probe `image:` lines.
2. **Red: old expectation, new api.** In a scratch copy of the branch (not committed), restore the issue's historical line, which expects `"401"` for the probe-token write, and run `bash e2e/compose-e2e.sh`. Expected: exit 1, with `FAIL: a probe token write was not refused` in the "Manual incidents" step. The PR says that deploy `main` accepted both `401` and `403` (lines 487-488), so `main` itself could not show this red.
3. **Red: new script, old api.** In a scratch copy, set the api pin back to the current `main` pin (`git show main:common/services.yaml`, api `0.1.0`), keep the new script and run it. Expected: exit 1, with `FAIL: a probe token write was not refused with 403`, because `0.1.0` answers `401`. This proves the strict check can fail. Restore the pin afterwards. The committed file keeps only the new pin.
4. **Green.** `bash e2e/compose-e2e.sh` on the branch exits 0. It prints `ok: a write without a token answers 401, a probe token write answers 403`, `==> Tokens and audit` with an `ok:` line for each of items 2.1-2.6, the new persistence lines, and ends with `==> All checks passed`. The CI `full` job on the PR is green.
5. **Binding deny run (not committed).** In a scratch copy, delete the `PULSE_PROBE_HEADER_HOSTS` line from `e2e/compose.e2e.yaml`, start the stack (`COMPOSE_PROJECT_NAME=pulse-e2e COMPOSE_FILE=full/compose.yaml:e2e/compose.e2e.yaml PULSE_SECRETS_DIR=$PWD/e2e/.secrets docker compose up -d` after `scripts/init-secrets.sh --dir e2e/.secrets`). Within 90 s, `GET /checks` shows `e2e-post` with `state == "down"` and `lastReason == "header Authorization env PULSE_HEADER_SVC_TOKEN is not bound to host e2e-target"` (probe `src/client.ts:160`). Tear down with `down -v`. With the line in place (Required behavior 5), `e2e-post` is up. The PR quotes both, which shows that the pinned probe enforces the binding.
6. **Planted leak runs (not committed).** These runs prove Required behavior 4. They use a scratch copy of the branch with three scratch-only additions:
   - Right after each credential gets its value, append it to a file outside the checkout (`umask 077; secrets_file=$(mktemp)` under `/tmp`, created before the first credential). This covers all six credentials of Required behavior 4, so the three set at top level are in the file before the stack starts. Append only non-empty values, one per line: an empty line would make `grep -Ff` match every line. The evidence uses this file only to grep the run log. It is deleted after the runs and never quoted.
   - A leak plant: `docker compose exec -T -e LEAK="<secret>" e2e-target sh -c 'printf "%s\n" "$LEAK" >/proc/1/fd/1'`. Writing to PID 1's stdout puts the secret into `docker compose logs`.
   - Each run is captured with `bash e2e/compose-e2e.sh >run-<x>.log 2>&1; echo "exit $?"`.

   Three runs:
   - **Run a, leak caught by the scan.** Plant A after the rotation lifecycle (step 2.2). Expected: `exit 1`, and a `FAIL:` line from step 2.5 that names the container logs and the role of A, not its value.
   - **Run b, failure before the scan.** Plant the `e2e-read-checks` secret right after it is created (step 2.1). On the next line, add `fail "planted failure before the scan"`. Expected: `exit 1` and `FAIL: planted failure before the scan`.
   - **Run c, failure during startup.** In step "Start the regular stack", right after the `wait_for ... is_running` loop (today lines 340-342) and before the stability window (`e2e-target` runs by then: the probe waits for it with `condition: service_started`, `e2e/compose.e2e.yaml:45-47`), plant `e2e_token` and `probe_token`. On the next line, add `fail "planted failure during startup"`. This point comes before line 351 ("Health and metrics") and before line 373, where `e2e_token` is set today. Expected: `exit 1` and `FAIL: planted failure during startup`. The output has no `==> Health and metrics` line, which proves the failure came before today's assignment.

   For each run, the PR shows these outputs, all with literal expected values:
   - `grep -cFf "$secrets_file" run-<x>.log` prints `0`. No credential is in the output.
   - `grep -c '<redacted:rotated-secret-a>' run-a.log` (run a), `grep -c '<redacted:read-checks-secret>' run-b.log` (run b), and `grep -c '<redacted:e2e-svc-token>' run-c.log` and `grep -c '<redacted:probe-token>' run-c.log` (run c) each print at least `1`. The planted leak reached the dump and was redacted.
   - `grep -c '^==> Health and metrics$' run-c.log` prints `0`.
   - `grep -c '^==> Teardown$' run-<x>.log` prints `1`.
   - After the run, `docker compose -p pulse-e2e ps -a -q | wc -l` and `docker volume ls -q --filter label=com.docker.compose.project=pulse-e2e | wc -l` each print `0`.

   The PR quotes the `FAIL:` lines and the redaction marker lines, never a secret.
7. **No secret in evidence.** The PR body holds no token, secret or full token response. A reviewer can check this with `gh pr view <pr> --json body --jq .body | grep -cF e2e-admin-token-sentinel`, which must print `0`.
8. **Checks.** Output of the commands in "Checks", all exit 0, including the `bun test` coverage summary above the `bunfig.toml:2` line gate (0.8). Green CI jobs: `check` (lint, typecheck and test; build and dist are skipped, see Checks), `lint`, `pins`, `minimal`, `full`, `demo`, `dev`, `cli-build`, `cli-render`, `cli-stack` (all three variants) and `cli-errors`.
