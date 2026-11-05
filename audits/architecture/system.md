# Architecture audit: pulse (2026-11-05)

## Scope

Issue: lorenzh/pulse-meta#757. Kind `architecture`, scope `system`. Audit date 2026-11-05 (UTC). Every repository at its newest `main` (`git ls-remote` of each repository matched the clone):

| Repository | Examined commit |
| --- | --- |
| meta | `1463761750cef5ffa446950e3e831073c9595a10` |
| contract | `66818a24b81f5d0d86eee939dad64fa126617ba2` |
| kit | `536133f3e8b708179fa01feeb02395a0e1961e07` |
| config | `bc870498cc8e2539a132ce2aac35a09db1deabd8` |
| api | `fb6f1a554055cc22f2f5036c8e7e2a321a62aa4c` |
| probe | `8fd19c81f939937631fb2763d8e1704750101d1e` |
| status | `8b6d4315fcb989a7a8d74c063ab08d97c18a7d2d` |
| notify | `c79f0b7cb5e25ada96e6314220e69cf4f5279b32` |
| console | `9a3ef14fc8a0335f8bf70f56023868633a56525e` |
| deploy | `770eae0d8e843823140b4b6660d6e716ac35db62` |
| website | `d5e725f576922a99dfe7d0520059cb432032e673` |

This report replaces the audit of #501 (2026-10-31). Every finding below was checked again on the commits above. Since #501, console and deploy were added. Both are in scope.

Commands use Bash and run from the meta root unless a path says otherwise. All findings use the examined commits in Scope; each JSON finding also records its affected repository commits. `.repos/<name>` is the read-only clone. The clones of contract, kit and config are shallow, so the pin commands ran in full clones of those three under `mktemp -d` (`$T`). Code ran only in copies under `$T` (`cp -a` of the clone, then `bun install --frozen-lockfile`). The scripts `deps.py`, `functions.mjs`, `scan.config.js`, `summarize.mjs` and `api-url.ts` were kept outside the repository and are described with each item. All copies were removed at the end. No service was started, and no shared system was contacted.

## Checklist

### Pin drift: checked

```sh
grep -rnoE 'github:lorenzh/pulse-[a-z]+#[0-9a-f]+' .repos/*/package.json
grep -rnoE 'pulse-[a-z]+/\.github/workflows/[a-z.-]+@[0-9a-f]+' .repos/*/.github/workflows/*.yml
git -C $T/<lib> rev-list --count <pin>..HEAD; git -C $T/<lib> rev-list --no-merges --count <pin>..HEAD
git -C $T/<lib> merge-base --is-ancestor <pin> HEAD
git -C $T/<lib> diff --stat <pin> HEAD; git -C $T/<lib> log --no-merges --format='%h %s' <pin>..HEAD
```

All exit 0. Every pin is an ancestor of `main`. Every `package.json` pin equals its `bun.lock` entry (19 pairs, all `match`). Every `check.yml@` and `release.yml@` ref equals the `package.json` config pin of its repository.

| Library | Pin | Pinned by | Behind `main` (all / non-merge) | What the missing commits change |
| --- | --- | --- | --- | --- |
| contract `66818a2` (2.2.0) | `9ab7e24` (2.1.0) | api, status, notify | 2 / 1 | `405353f`: new `checkLocationUptime` schema and validator, new `requestJson` write client. `fetchJson` is refactored onto the same `interruptible` helper. The diff of `src/schema.ts` and `src/validate.ts` removes no line, so existing validators are unchanged. |
| contract | `176fb6e` (2.0.0) | console | 4 / 2 | `405353f` above and `af94ed4`: incident drafts, notes and the internal-incident schemas and validators. Also additive only, with no removed line in `schema.ts` or `validate.ts`. |
| contract | `7ce23aa` (1.7.0) | probe | 18 / 13 | The above plus `5fed69b` (`feat!`: admin check sources, the 2.0.0 major), `865dc26` (admin `__proto__` header), `0ebab8c` (`arrayProblem` reads list items as own data), and the validator fast path in `validate-core.ts` (`f3d0e10`, `fe79834`, `94e1348`) |
| kit `536133f` (0.1.0) | `536133f` | console | 0 | none |
| kit | `c6d2cba` | api | 4 / 2 | `7cec1f5`: a doc comment in `src/failure-limiter.ts` (bound for a clock that goes back) and 36 test lines. `ebc69c1`: docs. No code change. The limiter fix `66fb3d3` is already in the pin (`merge-base --is-ancestor 66fb3d3 c6d2cba` exits 0). |
| kit | `739188a` | probe | 7 / 4 | `d00521e` (failure limiter), `66fb3d3` (limiter fix), plus the two commits above. probe does not use the limiter. |
| kit | `236df21` | status, notify | 20 / 15 | `9f1d8b9` and 10 fixes add the guarded fetch, the address guard and the IP classifier. The limiter commits are also missing. `src/index.ts` only gains exports (0 removed lines). status and notify use none of these modules. |
| config `bc87049` | `04108fa` | api, probe, status, notify, console, deploy | 2 / 1 | `a054ecd`: test only (`src/hook.test.ts`) |
| config | `51e95b0` | contract, kit | 11 / 6 | `pulse-workflows` (action policy check), reusable `release.yml`, README, tests |
| config | `86896e9` | website | 9 / 5 | the same |

Wire and shared behavior:

- `WIRE_VERSION` is `1` at every contract pin (`git show <pin>:src/version.ts`).
- The rule files of config did not change since any pin. `git diff <pin> HEAD -- .github/workflows/check.yml biome.json eslint.config.js tsconfig.base.json lefthook.yml bin/pulse-eslint.js` is 0 lines for all three pins.
- probe uses `validateCheck`, `fetchJson`, `checkWireVersion` and `headerValueSchema`. `validateCheck` has the same body at `7ce23aa` and `main` (`diff` exit 0). Its `verdict` path is in `validate-core.ts`, which changed (the fast path, meant to be behavior-equal).
  - In a copy of probe, contract `main` was put in place of the pinned contract (`git archive HEAD package.json dist`).
  - `bun run typecheck` exits 0 at both contracts.
  - `bun test` exits 0 on contract `main`: `419 pass, 0 fail`.
  - No compatibility failure was observed in probe's typecheck and tests. This does not prove equivalence on every input; the lag includes validation implementation and edge-handling changes.
- api uses `createFailureLimiter` (`api/src/admin-auth-throttle.ts:1`). Its pin lacks only `7cec1f5` and `ebc69c1`. The limiter test file of kit `main`, which includes the 36 test lines of `7cec1f5`, was run against kit `src` at `c6d2cba`: `34 pass, 0 fail`. (`bun test` exits 1 only because of the coverage threshold of a single-file run.) No test shows a behavior difference.
- kit's `package.json` `version` is `0.1.0` at all four kit pins, so only the SHA tells them apart. The contract versions now differ (1.7.0, 2.0.0, 2.1.0, 2.2.0).

Result: no missing change was shown to break a consumer's supported JSON behavior. For the older probe pin, `git diff --numstat 7ce23aa HEAD -- src/schema.ts src/validate.ts` prints `279 0 src/schema.ts` and `52 1 src/validate.ts`: the removed validator line is the `arrayProblem` switch to `ownValue`. The zero-deletion claim applies only to the two newer contract pins. The pins have spread further since #501: three contract pins, four kit pins and three config pins. Nothing checks that they agree; the open issue #484 asks for such a check. These are findings 7 and 8.

### Size: checked

Files over 800 lines, every tracked file of every repository:

```sh
for r in .repos/*; do (cd $r && git ls-files -z | xargs -0 wc -l | awk -v r=${r#.repos/} '$2!="total" && $1>800 {print r"/"$2, $1}'); done
git ls-files -z | xargs -0 wc -l | awk '$2!="total" && $1>800'
```

Exit 0. Output, code repositories:

- Source:
  - `api/src/service.ts 1310`
  - `contract/src/schema.ts 1300`
  - `console/src/server.ts 1198`
  - `notify/src/ledger.ts 1197`
  - `deploy/e2e/compose-e2e.sh 1115`
  - `website/src/styles/components.css 1107`
  - `console/e2e/run.ts 1021`
  - `notify/src/notifier.ts 897`
  - `api/src/server.ts 897`
  - `status/src/server.ts 887`
- Generated: `contract/dist/admin.d.ts 1163`, `contract/dist/schema.js 951`.
- Tests:
  - `api/src/config-admin.test.ts 1659`
  - `console/src/server.team.test.ts 1251`
  - `contract/test/admin.test.ts 1211`
  - `status/src/poller.test.ts 1200`
  - `status/src/server.privacy.test.ts 1194`
  - `notify/test/email-smtp.test.ts 1128`
  - `console/src/server.setup.test.ts 844`
  - `probe/src/client.test.ts 833`

meta: `package-lock.json 2067`, `report/index.html 850` and these specs. They are a lockfile, a template and specs, so they are not counted as findings.

| Spec | Lines |
| --- | --- |
| `.factory/work/529/plan.md` | 890 |
| `.factory/work/552/plan.md` | 871 |
| `.factory/work/562/plan.md` | 1103 |
| `.factory/work/563/plan.md` | 1305 |
| `.factory/work/564/plan.md` | 1383 |
| `.factory/work/565/plan.md` | 1111 |
| `.factory/work/567/plan.md` | 1377 |
| `.factory/work/568/plan.md` | 1410 |
| `.factory/work/571/plan.md` | 958 |
| `.factory/work/718/plan.md` | 1172 |

Complexity budget: `sonarjs/cognitive-complexity` 15 per function. It is set in config `eslint.config.js` and named in the `AGENTS.md` of api, probe, status, notify and console.

How it was measured:

1. pulse-config `bc87049` was copied and installed (`bun install --frozen-lockfile`, exit 0).
2. Every tracked `*.ts`, `*.tsx`, `*.js`, `*.mjs` and `*.jsx` file outside `dist/` of the ten code repositories was copied into `$T/scan`: 691 files, 20 of them `.tsx` and 6 `.mjs`.
3. ESLint with eslint-plugin-sonarjs from that copy ran with `scan.config.js`. The config has the TypeScript parser with JSX, only the rule at 15, and `noInlineConfig: true`, so disable comments hide nothing:

```sh
eslint --config $T/cfg/scan.config.js --no-warn-ignored --format json --output-file $T/scan.json .
bun summarize.mjs $T/scan.json $T/scan
```

ESLint exits 1 (one rule error). Output: `deploy/scripts/secrets-init.mjs:107 Refactor this function to reduce its Cognitive Complexity from 22 to the 15 allowed.`, `files scanned: 691`, `total over budget: 1`, `parse errors: 0`.

- The function is `filesMode`, which spans 39 lines.
- deploy's own lint does not catch it: the shared config has no rules for `.mjs` (finding 1).
- `grep -rn 'eslint-disable' .repos/*/src` shows no `cognitive-complexity` disable left. The api `handle` function of #501 (52) is gone.

Longest named functions, from the TypeScript AST of the non-test source (`functions.mjs`, 2969 functions):

| Function | Lines |
| --- | --- |
| `api/src/service.ts:377 createService` | 934 |
| `api/src/manual-incidents.ts:153 createManualIncidentStore` | 443 |
| `api/src/start.ts:282 run` | 306 |
| `status/src/poller.ts:172 createPoller` | 287 |
| `api/src/admin-routes.ts:175 createAdminHandler` | 228 |
| `api/src/config-write.ts:405 createConfigWriter` | 224 |
| `website/src/content/hosted.tsx:233 HostedContent` | 209 |
| `status/src/server.ts:684 createStatusServer` | 204 |
| `api/src/token-store.ts:154 createTokenStore` | 203 |

Findings 1, 9 and 10.

Review supplement: meta has no adopted cognitive-complexity budget (`package.json` and `AGENTS.md`), so the target limit is not a meta policy. The same scanner also measured its ten tracked JS/MJS files against the reference value 15. `node "$T/../complexity.mjs" "$T" --meta` exits 1: 701 files, 11 rule errors (one deploy, ten meta), zero parse errors. Function lengths come from the TypeScript AST (exit 0).

| Meta function | Lines | Cognitive complexity |
| --- | --- | --- |
| `report/check.mjs:79 checkShape` | 48 | 17 |
| `report/check.mjs:133 check` | 56 | 70 |
| `report/data.mjs:86 build` | 302 | 45 |
| `report/data.mjs:416 mergeArchive` | 140 | 20 |
| `scripts/factory-findings.mjs:122 validateOutbox` | 57 | 45 |
| `scripts/factory-findings.mjs:387 publish` | 92 | 36 |
| `scripts/factory-tasks.mjs:39 anonymous callback` | 17 | 18 |
| `scripts/factory-tasks.mjs:74 checkDir` | 38 | 20 |
| `scripts/factory-tasks.mjs:114 events` | 24 | 22 |
| `scripts/factory-tasks.mjs:153 anonymous callback` | 27 | 18 |

### Duplicated helpers: checked

How they were found:

- Every named function of the non-test source of the ten code repositories was listed with a whitespace-normalized body hash (`functions.mjs`).
- Equal hashes across repositories were listed: 5 groups for bodies over 60 characters.
- Names defined in two or more repositories were listed and the candidates were read.
- The helpers of #501 were grepped again.

Helpers that two or more repositories implement and that belong in pulse-kit, or that kit already has:

- Atomic file write. kit has `writeFileAtomicSync` (`kit/src/atomic-write.ts:220`), and notify uses it. api keeps its own temp-file, fsync and rename code in `config-fs.ts`. notify's `syncDir` (`ledger.ts:462`) has the same body as api's `fsyncDir` (`config-fs.ts:69`, identical whitespace-normalized bodies). deploy's CLI writes files without fsync (`cli/write-install.ts:280`). Finding 5.
- `PULSE_API_URL` parsing: four services, three rule sets (finding 6).
- A bounded failure throttle: console `src/auth-throttle.ts` (194 lines) next to kit `src/failure-limiter.ts` (190 lines, used by api) (finding 11).
- A bounded read of a response body stream: twice in probe, once in contract (finding 12).
- Reading a JSON config file with error mapping for the read and the parse: api, status, notify (finding 13).
- `messageOf` three times, `isHttpUrl` twice, and the timer cap twice (finding 14).

Fixed since #501 (re-checked):

- `isRecord`/`isObject`: `grep -rnE 'function (isObject|isRecord|isPlainObject|isDict)\(|const (isObject|isRecord) *=' api/src probe/src status/src notify/src console/src contract/src deploy/cli` prints only `deploy/cli/services.ts:67` and contract's private `validate-core.ts:8`. The services import kit `isRecord` (status through `@lorenzh/pulse-kit/is-record`).
- Timer cap: probe and status import kit `MAX_TIMER_DELAY_MS`, and api's own cap is gone. contract `MAX_TIMER_MS` and kit `MAX_TIMER_DELAY_MS` remain.

Checked and not counted:

- The `isRecord` copies in `website/src/docs/config.ts:19`, `config/src/workflow-policy.ts:33` (`isDict`) and `api/bench/compare.ts:118`. website and config do not depend on kit, and config cannot (kit depends on config). The bench is a script.
- `redactUrl` in kit `guarded-fetch.ts:75` rewrites an error's message, while notify `redact.ts:2` strips user info for logs. Different jobs.
- `readTokenFile` in console and probe both call kit `readSecretFile` and add their own token rule.
- `createMetrics`, `readSettings` and `toCheck` are service-specific.

### Docs against code: checked

Compared claim by claim:

- meta: `README.md` (240 lines) and `docs/architecture.md` (49 lines).
- The `README.md` of all ten code repositories.
- The `docs/development.md` of api, probe, status, notify and console.

Not applicable, because the files do not exist (`ls .repos/*/docs docs`):

- meta has no `docs/development.md`, and no code repository has a `docs/architecture.md`.
- contract, kit, config, deploy and website have no `docs/development.md`.

Each claim was checked with `grep -n`, `sed -n` and `ls` against the code. The main commands:

```sh
grep -H '"packageManager"' .repos/*/package.json; grep -Hn '^FROM' .repos/*/Dockerfile
for r in api probe status notify console; do grep -rhoE '"(PULSE_[A-Z0-9_]+|PORT|POLL_MS)"' .repos/$r/src --include=*.ts --exclude=*.test.ts | sort -u; done
awk '/^jobs:/{f=1;next} f && /^  [a-zA-Z0-9_-]+:/{print NR": "$0}' .repos/<r>/.github/workflows/ci.yml
ls .repos/api/compose.yaml; grep -n 'REPOS\|SERVICES' .repos/api/bench/refs.ts .repos/api/bench/stack.ts
```

All exit 0, except `ls .repos/api/compose.yaml` (exit 2, no such file).

These match the code:

- meta `docs/architecture.md`:
  - `bun@1.4.0` in all ten `package.json`. `oven/bun:1.4.0-alpine@sha256:0723…` in all five Dockerfiles.
  - `/probe/checks` with the 404 fallback, the `PULSE_HEADER_` prefix and the reload default 60000.
  - The `x-pulse-contract` header, the ops routes and port 9100.
  - The roles of contract, kit and config, and the pins (`:49`).
  - The rest of `docs/architecture.md` is in findings 3, 4, 15 and 20.
- meta `README.md`:
  - The Compose section: setups, ports, the console on `127.0.0.1:8082`, the demo ports.
  - The defaults in the settings table. Every name in the table is read by its service.
  - The health table, including the console's `/readyz`, which checks only shutdown (`console/src/server.ts:1127`).
- The READMEs of kit, config, probe, notify, deploy and website.
- The `docs/development.md` of probe, notify and console. For example:
  - probe CI: three jobs `check`, `docker`, `release`.
  - console CI: five jobs, and its module map (every named file exists).
  - The notify ledger format 4 (`LEDGER_VERSION = 4`).
  - api `docs/development.md` CI: four jobs, which match `ci.yml:17,20,35,55`. That is finding 17 of #501, now fixed.
  - The status README list of served contract files, now "`index.js` and the modules it imports". That is finding 21 of #501, now fixed.

These contradict the code (finding 16 is P2; the rest are P3, detailed below):

| Finding | Repository | Claim | Code |
| --- | --- | --- | --- |
| 3 | meta | `docs/architecture.md:7`, `:32`, `README.md:18`, `:34`: the admin routes rewrite the checks file | api stores admin check writes in its database: `admin-routes.ts:217` → `check-write.ts:212` `store.create(...)`; api `docs/operation.md:245` |
| 4 | meta | `README.md:21` and `docs/architecture.md:11`: console "serves one page"; `README.md:21` it depends on "pulse-kit, pulse-config (dev)"; `README.md:210` the admin token is "not used yet" | console has setup, sign-in, 2FA, team pages and SQLite; `console/package.json:32` pins pulse-contract; `console/src/server.ts:369` sends the token to pulse-api, and `:388-390` blocks setup without it |
| 15 | meta | `README.md:22` and `docs/architecture.md:12`: "A `pulse` CLI setup wizard is planned (#529)" | deploy has the CLI: `cli/main.ts`, `package.json:16` builds `dist/pulse`, `README.md:45`; #529 closed on 2026-11-02 |
| 16 | status, console | status `README.md:49` "pulse-api's repository has a Compose file"; console `README.md:70` "(pulse-api `compose.yaml`)" | `ls .repos/api/compose.yaml`: exit 2, no such file. The Compose setups are in deploy |
| 17 | api | `docs/development.md:22` `src/main.ts` "Reads the environment"; `:24` `src/service.ts` "All SQL"; `:26` `src/db.ts` "Schema (current version only)"; `:47` "build CPU time of all seven repositories" | `src/start.ts:289-292` reads the env; SQL in `audit-log.ts` (9 calls), `manual-incidents.ts` (45), `check-store.ts` (7), `token-store.ts` (16); `src/db.ts:4` "the schema at `user_version` 0"; `bench/run.ts:48` `BUILD_REPOS = ["contract", "kit"]` |
| 18 | status | `docs/development.md:31` the browser modules import "from the kit only `@lorenzh/pulse-kit/escape` and `@lorenzh/pulse-kit/format-duration`" | `src/poller.ts:25` imports `@lorenzh/pulse-kit/is-record`; `src/server.ts:261` serves `escape.js`, `format-duration.js`, `is-record.js` |
| 19 | contract | `README.md:7` "pulse-contract depends on no other pulse repository" | `package.json:32` devDependency `github:lorenzh/pulse-config#51e95b0…`; `ci.yml:17` `uses: lorenzh/pulse-config/...check.yml@51e95b0…` |
| 20 | meta | `docs/architecture.md:39` the bench measures "CPU time and memory of every service, the test CPU time of all seven repositories" | `api/bench/stack.ts:17` `SERVICES = ["api", "probe", "status", "notify"]`: console is not measured. `bench/refs.ts:5` lists 7 of the 10 code repositories |

Not counted, because the docs leave something out but say nothing false:

- The consumer lists in meta `docs/architecture.md:13` and contract `README.md:7` omit console but do not claim to be exhaustive.

- The meta README settings table (`README.md:162-210`) does not list six settings that the code reads:
  - probe: `PULSE_PROBE_BLOCK_PRIVATE_RANGES`, `PULSE_PROBE_HEADER_HOSTS`.
  - notify: `PULSE_NOTIFY_BUDGET_THRESHOLD`.
  - console: `PULSE_CONSOLE_DB`, `PULSE_CONSOLE_PUBLIC_URL`, `PULSE_CONSOLE_SECRET_KEY_FILE`.
  - The README names each service's configuration page as the source of truth.
- meta `README.md:28` and `docs/architecture.md:27` name only `GET /incidents` and `GET /checks` for notify, which also reads `/manual-incidents` and `/components` (`notify/src/api.ts:259,287`).
- The data-flow diagram in `docs/architecture.md:21-30` has no console.
- meta `README.md:240` says "status and notify also read `api`". console and deploy do too (`.factory/config.yaml:133,140`).
- console `docs/development.md:107` names `check` and `docker` as the release gate; `ci.yml:291` also needs `browser`.

### Earlier findings: checked

```sh
gh issue list --repo lorenzh/pulse-meta --state all --search "Architecture audit in:title" --json number,title,state
git log --oneline -- audits/architecture/
gh issue view 555 --repo lorenzh/pulse-meta --json body,state,closedAt; gh issue view 484 ... ; gh issue view 509 ...
```

Exit 0. There is one earlier architecture audit: #501 (closed), report `audits/architecture/system.md` (`678821b`). Open follow-ups: #484 (version policy and pin check, open) and #509 (one item on the #501 report).

Each finding of #501 was re-checked on the commits above:

| #501 finding | State now | Evidence |
| --- | --- | --- |
| 1 api `handle` complexity 52 | fixed | scan: no api function over budget, no disable comment |
| 2 `isRecord` 11 copies | fixed | grep above: only deploy CLI and contract private |
| 3 atomic write four times | still true for api and deploy | finding 5; #555 (closed 2026-11-01) asked api and notify to adopt the kit helper, and only notify did |
| 4 older contract in status and notify | changed | status and notify now pin `9ab7e24`. probe is 18 commits behind, but its tests pass on `main`. Finding 7 |
| 5 `PULSE_API_URL` parsed three ways | still true | finding 6 (now four services) |
| 6 timer cap five times | mostly fixed | two library constants remain (finding 14) |
| 7 `api/src/service.ts` 1122 lines | still true, grew | 1310 lines, `createService` 934 lines (finding 9) |
| 8 `contract/src/schema.ts` 993 | still true, grew | 1300 (finding 10) |
| 9 `status/src/poller.test.ts` 1046 | still true | 1200 (test file, listed under Size) |
| 10 `website/src/styles/components.css` 1005 | still true | 1107 (finding 10) |
| 11 shared ESLint config skips `.tsx` | still true, wider | also skips `.mjs`, and a function over budget hides there (finding 1) |
| 12 bounded body read three times | still true | finding 12 |
| 13 JSON config read three times | still true | finding 13 |
| 14 `isHttpUrl`, `messageOf` copied | still true | finding 14 |
| 15 api Compose builds others from `main` | moved | api has no `compose.yaml` now. The unpinned `main` edges are now in the console and deploy CI, and they form a cycle (finding 2) |
| 16 probe Factory context lacks api | still true | finding 21 |
| 17 api dev doc counts three CI jobs | fixed | four jobs listed, four in `ci.yml` |
| 18 api dev doc build CPU of all seven | still true | finding 17 |
| 19 api dev doc code layout | still true | finding 17 |
| 20 status dev doc `validate.ts` | fixed; a new mismatch | finding 18 |
| 21 status README contract files | fixed | README now says "and the modules it imports" |
| 22 contract README "depends on no other pulse repository" | still true | finding 19 |

#509's item on the #501 report concerned the status `AGENTS.md` rule on relative imports. status `AGENTS.md` now allows a relative runtime import of a sibling browser module, so that item is resolved in the code.

### Dependency direction: checked

The intended direction comes from meta `docs/architecture.md` (`:5-15`, `:49`) and the meta README table:

- api, probe, status and notify depend on contract and kit. console depends on kit and talks to the pulse-api admin API, "its only upstream".
- Every code repository depends on config. contract and kit depend only on config (dev). config depends on nothing.
- probe, status, notify and console talk to api at run time.
- deploy "composes the images of the services" and is not a service.

`python3 -I deps.py .repos` builds the graph and searches for cycles. Its sources:

- `package.json` dependencies (`code`) and devDependencies (`dev`).
- Workflow `uses:` (`ci`), and workflow checkouts of another repository with their `ref` (`ci-checkout@<ref>`).
- Compose `image: ghcr.io/lorenzh/pulse-*` and `build:` contexts (`deploy-image`, `deploy-build-*`).
- The api bench `REPOS` and the bench Compose contexts (`bench`).
- `website/docs.config.json` (`docs`).
- `PULSE_API_URL` reads in `src` (`runtime`).

Exit 0. Output:

```text
api -> config: bench,ci,dev                     deploy -> api: ci-checkout@main,deploy-build-local,deploy-image
api -> contract: bench,code                     deploy -> config: ci,dev
api -> kit: bench,code                          deploy -> console: ci-checkout@main,deploy-build-local,deploy-image
api -> notify|probe|status: bench               deploy -> notify|probe|status: ci-checkout@main,deploy-build-local,deploy-image
console -> api: ci-checkout@main,runtime        kit -> config: ci,dev
console -> config: ci,dev                       notify|probe|status -> api: runtime
console -> contract: code                       notify|probe|status -> config: ci,dev
console -> deploy: ci-checkout@main             notify|probe|status -> contract: code
console -> kit: code                            notify|probe|status -> kit: code
console -> notify|probe|status: ci-checkout@main  website -> config: ci,dev
contract -> config: ci,dev                      website -> api|console|contract|deploy|kit|notify|probe|status: docs
cycles over code+dev+ci (library pins): 0
cycles over code+dev+ci+runtime: 0
cycles over code+dev+ci+runtime+ci-checkout: 1
  console -> deploy -> console
cycles over all kinds: 4
  api -> notify -> api
  api -> probe -> api
  api -> status -> api
  console -> deploy -> console
```

(The tool printed one edge per line. They are set in two columns here, and the `notify|probe|status` lines group equal edges. The api `deploy-build-local` label on the bench contexts is shown as `bench`, because they come from `bench/compose.bench.yaml`. The website's `deploy-build-git` edges come from the test fixture `test/fixtures/api-compose.yaml` and are left out.)

Result:

- The library layer matches the intended direction. No library depends on a service, kit and contract do not depend on each other, and config depends on nothing.
- The three api cycles come from the bench. It builds probe, status and notify from `main` or a given ref (`bench/refs.ts:60-65`), and `docs/architecture.md:39` documents this. They are not counted.
- The console ↔ deploy CI cycle exists, but console `AGENTS.md:85` explicitly requires it. The architecture's SHA-pin paragraph governs libraries and its "only upstream" claim concerns runtime HTTP. These checkouts do not demonstrate a forbidden runtime or library edge. Finding 2 records the CI cycle and reproducibility risk as a non-candidate P3 note.
- The Factory `context` of probe lacks api, though probe calls the API. The `context` of console lacks deploy, though its CI runs deploy `main` (finding 21).

## Issue candidates

| Id | Severity | Repositories | Title |
| --- | --- | --- | --- |
| architecture-system-2026-11-05-16 | P2 | status, console, api | The READMEs direct whole-stack startup to a Compose file that no longer exists in pulse-api |
| architecture-system-2026-11-05-1 | P3 | config, deploy, website, api | The shared ESLint config lints only `.ts` and `.js`: 26 `.mjs`/`.tsx` files get no rule, and deploy's `filesMode` (complexity 22) passes lint |
| architecture-system-2026-11-05-3 | P3 | meta, api | meta docs say the admin routes rewrite the checks file; api stores admin check writes in its database |
| architecture-system-2026-11-05-4 | P3 | meta, console | meta docs describe console as a one-page stub without contract and with an unused admin token |
| architecture-system-2026-11-05-5 | P3 | api, kit, notify, deploy | api keeps its own atomic file write next to kit's `writeFileAtomicSync`, although #555 asked it to adopt the kit helper |

## Finding details

### 1. The shared ESLint config lints only `.ts` and `.js` (P3)

Id: `architecture-system-2026-11-05-1`. Severity: `P3`. Candidate: `true`.

- Location: `config/eslint.config.js:11` (`files: ["**/*.ts", "**/*.js"]`), and `deploy/scripts/secrets-init.mjs:107` (`filesMode`).
- Commands:
  - The complexity scan under Size.
  - In installed copies of deploy and website: `node_modules/.bin/eslint --print-config scripts/secrets-init.mjs`, `node_modules/.bin/eslint scripts/secrets-init.mjs`, `node_modules/.bin/eslint --print-config src/content/hosted.tsx` and `node_modules/.bin/eslint src/content/hosted.tsx src/content/home.tsx`.
  - `git -C .repos/<r> ls-files '*.mjs' '*.tsx'` for every repository.
- Exit codes: scan 1. deploy `eslint` on the `.mjs` file 0. website `--print-config` 0 and `eslint` 0.
- Output:
  - Scan: `deploy/scripts/secrets-init.mjs:107 Refactor this function to reduce its Cognitive Complexity from 22 to the 15 allowed.`
  - deploy `--print-config` for the `.mjs` file: `"rules": {}`. The same for `cli/main.ts` lists the SonarJS rules.
  - deploy `eslint scripts/secrets-init.mjs`: no output, exit 0.
  - website `--print-config src/content/hosted.tsx`: `undefined`.
  - website `eslint` on two `.tsx` files: `File ignored because no matching configuration was supplied` (2 warnings, exit 0).
  - File count: api 1 `.mjs` (2 lines), deploy 5 `.mjs` (399 lines), website 20 `.tsx` (1872 lines).
- 26 files with 2273 lines get neither SonarJS nor the type-aware rules. The api, probe, status, notify and console `AGENTS.md` all say that `bun run lint` limits cognitive complexity to 15 per function, and website `AGENTS.md:7` names ESLint (SonarJS) for its TSX pages.
- The only function over the shared target budget among the ten code repositories sits in one of these files, so their normal check misses it. This is #501 finding 11, now with an actual miss.

### 2. console and deploy build each other from unpinned `main` (P3)

Id: `architecture-system-2026-11-05-2`. Severity: `P3`. Candidate: `false`.

- Location: `console/.github/workflows/ci.yml:210-268` (job `deploy-dev`, checkouts at `:222`, `:228`, `:234`, `:240`, `:246`), `deploy/.github/workflows/ci.yml:191-216` and `:260-285`, `deploy/common/services.yaml:44` (console image), `deploy/dev/compose.yaml:89`.
- Commands: `grep -nE '^\s+repository: lorenzh/pulse-[a-z]+$|^\s+ref: ' .repos/{console,deploy}/.github/workflows/ci.yml`, and the cycle search under Dependency direction.
- Exit code: 0.
- Output:
  - console `ci.yml`: `222: repository: lorenzh/pulse-deploy` / `223: ref: main`, and the same `ref: main` for pulse-api (`:228`), pulse-probe (`:234`), pulse-status (`:240`) and pulse-notify (`:246`).
  - deploy `ci.yml`: `ref: main` for pulse-api, pulse-probe, pulse-status, pulse-notify and pulse-console at `:191` to `:215` and at `:260` to `:284`.
  - Cycle search: `cycles over code+dev+ci+runtime+ci-checkout: 1` / `console -> deploy -> console`.
- console's `deploy-dev` job runs `docker compose -f dev/compose.yaml up -d --build` from the deploy `main` checkout, with this console checkout and the `main` of the four other services. Then it runs `e2e/console-setup.sh`.
- So a console pull request passes or fails depending on whatever is on `main` of five other repositories at that moment. console `AGENTS.md` already plans for this: "A failure in a two-factor step where the console follows the spec is a deploy defect: hold the issue".
- The CI cycle affects reproducibility, but does not contradict the library SHA-pin rule or the runtime upstream boundary. Console `AGENTS.md:85` explicitly requires this test; no architecture direction violation was reproduced.
- This replaces #501 finding 15 (the api Compose file), which is gone.

### 3. meta docs say the admin routes rewrite the checks file (P3)

Id: `architecture-system-2026-11-05-3`. Severity: `P3`. Candidate: `true`.

- Location: meta `docs/architecture.md:7` and `:32`, `README.md:18` and `:34`. Code: `api/src/admin-routes.ts:217`, `api/src/check-write.ts:212-213`, `api/src/start.ts:307`.
- Command: `grep -nE 'writable through admin routes|rewrite the file' docs/architecture.md README.md; grep -n 'if (kind === "check")' .repos/api/src/admin-routes.ts; sed -n 212,213p .repos/api/src/check-write.ts; sed -n 245p .repos/api/docs/operation.md`
- Exit code: 0.
- Output:
  - `docs/architecture.md:7: … Loads and hot-reloads the checks file (also writable through admin routes) …`
  - `docs/architecture.md:32: … the admin config routes rewrite the file and apply it at once.`
  - `README.md:18` (the same as `:7`), and `README.md:34: … operators can also change checks, components and maintenance windows through the admin config routes, which rewrite the file.`
  - `217: if (kind === "check") return deps.checks.apply(checkEditOf(action, ref, body), ifMatch, actor);`
  - `if (edit.action === "create") store.create(parsed.check, parsed.secretSha256);`
  - api `docs/operation.md:245`: `A database check is stored in the database, in one transaction with its audit entry; it needs no writable checks file.`
- api now has two check sources (api `README.md:11`, `docs/operation.md:211`): an admin check write goes to the database, and only component and window writes rewrite the file.
- Plans start from meta `docs/architecture.md`, and an operator who reads the meta README expects admin-made checks in `checks.json`.
- `docs/architecture.md:32` also says api "reads `checks.json` and `tokens.json` at start". api `README.md:60` says the token files "are imported once at the first start and then ignored".

### 4. meta docs describe console as a stub (P3)

Id: `architecture-system-2026-11-05-4`. Severity: `P3`. Candidate: `true`.

- Location: meta `README.md:21`, `:134`, `:210`, `docs/architecture.md:11`. Code: `console/package.json:32`, `console/src/server.ts:369`, `:388-390`, `console/src/database.ts`.
- Command: `grep -noE 'Today it serves one (server-rendered )?page[^.]*|pulse-kit, pulse-config \(dev\); will talk to the pulse-api admin API|optional, validated, not used yet; set only one' README.md docs/architecture.md; grep -n 'pulse-contract' .repos/console/package.json; sed -n 369p .repos/console/src/server.ts; sed -n 388,390p .repos/console/src/server.ts`
- Exit code: 0.
- Output:
  - `docs/architecture.md:11: Today it serves one server-rendered page and its ops routes, and validates PULSE_API_URL and an optional admin token`
  - `README.md:21: Today it serves one page and its ops routes …` and, in the "Depends on" column, `pulse-kit, pulse-config (dev); will talk to the pulse-api admin API`
  - `README.md:210: optional, validated, not used yet; set only one`
  - `console/package.json:32: "@lorenzh/pulse-contract": "github:lorenzh/pulse-contract#176fb6e…"`
  - `server.ts:369: token: deps.adminToken,` (the Overview reads `GET /admin/config` with it)
  - `server.ts:388: // Without a token no setup can complete, so the first owner page already says why.`
- console now has the first-run setup, password and TOTP sign-in, account pages, the team pages with roles, and a local SQLite database (console `README.md:5-15`).
- `README.md:134` says the console "has nothing to manage yet". The non-exclusive contract consumer list is not counted as a contradiction.
- Agents read the meta docs before they plan a console change.

### 5. api keeps its own atomic file write (P3)

Id: `architecture-system-2026-11-05-5`. Severity: `P3`. Candidate: `true`.

- Location: `api/src/config-fs.ts:50` (`writeTemp`), `:69` (`fsyncDir`), `:87` (`rename`); `notify/src/ledger.ts:462` (`syncDir`); `deploy/cli/write-install.ts:280` (`atomicWrite`); `kit/src/atomic-write.ts:220` (`writeFileAtomicSync`).
- Command (corrected paths; exit 0): `rg -n 'writeFileAtomicSync|fsyncSync|renameSync|function writeTemp' .repos/api/src/config-fs.ts .repos/notify/src/ledger.ts .repos/deploy/cli/write-install.ts .repos/kit/src/atomic-write.ts; sed -n 69,76p .repos/api/src/config-fs.ts; sed -n 462,469p .repos/notify/src/ledger.ts; sed -n 164,184p .repos/kit/src/atomic-write.ts; gh issue view 555 --repo lorenzh/pulse-meta --json body,state,closedAt`. The AST also confirms the two directory-sync bodies are identical.
- Exit code: 0.
- Output:
  - `api/src/config-fs.ts:46: fsyncSync(fd);`, `:50: function writeTemp(temp: string, data: Buffer, like: string): void {`, `:72: fsyncSync(fd);`, `:87: rename: (from, to) => renameSync(from, to),`.
  - `notify/src/ledger.ts:465: fsyncSync(fd);`, `:566: renameSync(building, path);`.
  - `deploy/cli/write-install.ts:292: renameSync(tmp, full);` (no fsync in `atomicWrite`).
  - AST body comparison: `api/src/config-fs.ts:69 fsyncDir` and `notify/src/ledger.ts:462 syncDir` have the same body.
  - Kit imports: notify imports `writeFileAtomicSync`, `nodeAtomicWriteSyncFs` and `AtomicWriteError` from kit. api imports none of them, although its kit pin `c6d2cba` has `atomic-write`.
- #555 ("kit: … shared helpers", closed 2026-11-01) required "one atomic-write helper" in kit and "adopt the atomic-write helper (api, notify)". Only notify adopted it.
- Both api and kit preserve existing file ownership: kit `src/atomic-write.ts:175` calls `f.fchown(fd, existing.uid, existing.gid)`, also at api's `c6d2cba` pin. A review call with an injected filesystem returned `written true owner calls [[123,456]]` (exit 0). The earlier explanation that kit lacks ownership support was incorrect; the duplication finding remains.
- deploy does not depend on kit. Its CLI writes install files by rename without fsync.

## Findings 6–21

Finding 16 is a P2 issue candidate. The other entries in this section are P3 notes.

- **6. `PULSE_API_URL` read with three rule sets in four services** (status, probe, notify, console, kit). Location `status/src/settings.ts:50`.
  - Id: `architecture-system-2026-11-05-6`. Severity: `P3`. Candidate: `false`.
  - Command: `bun "$T/../api-url.ts"` (source in the reproduction appendix). It feeds the same values to `readSettings` (status, console) and `loadSettings` (probe, notify) in installed copies. Exit 0.
  - `ftp://api.example:21/`: status accepted, probe, notify and console rejected (`must be an http(s) URL without credentials, query or fragment`, notify `must be a valid http(s) url`).
  - `http://<user>:<password>@api.example:3000`: status and notify accepted, probe and console rejected.
  - `http://api.example:3000/?q=1`: status and notify accepted, probe and console rejected.
  - status uses `readString` with `URL.canParse` (`settings.ts:50-57`). probe and console use kit `readUrl`. notify uses `readUrl` with options (`config.ts:358`). This is #501 finding 5, with console added.
- **7. Library pins spread across the services** (api, probe, status, notify, console, contract, kit). Location `probe/package.json:30`.
  - Id: `architecture-system-2026-11-05-7`. Severity: `P3`. Candidate: `false`.
  - Commands under Pin drift. Pin queries and probe commands exit 0; the isolated kit test command exits 1 on the aggregate coverage threshold.
  - contract: three pins (`9ab7e24` api/status/notify, `176fb6e` console, `7ce23aa` probe, 18 commits and one major version behind).
  - kit: four pins (`c6d2cba` api, `739188a` probe, `236df21` status/notify, 20 behind, `536133f` console), all with `version` `0.1.0`.
  - No compatibility failure was observed for supported JSON behavior. probe on contract `main`: typecheck 0, `419 pass, 0 fail`. kit `main`'s limiter tests on api's kit: `34 pass, 0 fail`, with command exit 1 because aggregate line coverage is 38.23%, below the 80% threshold. The probe commands exit 0.
  - Nothing in CI compares the pins, which the open #484 asks for.
- **8. contract, kit and website pin a config from before `pulse-workflows`** (contract, kit, website, config). Location `contract/package.json:32`, `kit/package.json:43`, `website/package.json:39`.
  - Id: `architecture-system-2026-11-05-8`. Severity: `P3`. Candidate: `false`.
  - Command: `grep -n 'pulse-workflows' .repos/*/package.json` (exit 0). It prints the `lint` script of api, probe, status, notify, console, deploy and config, and nothing for contract, kit and website.
  - `pulse-workflows` from config `main` run in copies of contract, kit and website prints `pulse-workflows: ok` (exit 0 each). Their workflows pass today, but no check keeps them passing.
- **9. `api/src/service.ts` has 1310 lines** (api). Location `api/src/service.ts:377`, where the closure `createService` spans 934 lines (771 on 2026-10-31). Command: the size commands under Size (exit 0).
  - Id: `architecture-system-2026-11-05-9`. Severity: `P3`. Candidate: `false`.
- **10. Other source files over 800 lines** (contract, console, notify, deploy, website, api, status). Command as under Size (exit 0).
  - Id: `architecture-system-2026-11-05-10`. Severity: `P3`. Candidate: `false`.
  - `contract/src/schema.ts 1300`, `console/src/server.ts 1198`, `notify/src/ledger.ts 1197`, `deploy/e2e/compose-e2e.sh 1115`, `website/src/styles/components.css 1107`.
  - `console/e2e/run.ts 1021`, `notify/src/notifier.ts 897`, `api/src/server.ts 897`, `status/src/server.ts 887`.
- **11. console has its own bounded failure throttle** (console, kit, api). Location `console/src/auth-throttle.ts:1`.
  - Id: `architecture-system-2026-11-05-11`. Severity: `P3`. Candidate: `false`.
  - Command: `grep -rnE 'createFailureLimiter|FailureLimiter|class [A-Za-z]*Limiter' .repos/{api,console,notify,status,probe}/src --include=*.ts`. Exit 0, only api lines.
  - `wc -l` gives `console/src/auth-throttle.ts 194` and `kit/src/failure-limiter.ts 190`.
  - console's throttle has a sliding window, a lockout, in-flight counts and several tables. kit's limiter is a fixed window. Both bound their key table (`THROTTLE_MAX_KEYS = 10_000`, `maxKeys`). console `AGENTS.md` says to propose an addition to pulse-kit instead of a local helper.
- **12. Bounded response-body read three times** (probe, contract). Location `probe/src/check.ts:270`.
  - Id: `architecture-system-2026-11-05-12`. Severity: `P3`. Candidate: `false`.
  - Command: `grep -rnE 'getReader\(\)' --include=*.ts .repos | grep -vE 'node_modules|/dist/|test'`. Exit 0.
  - Output: `probe/src/check-domain.ts:56`, `probe/src/check.ts:270`, `contract/src/client.ts:86` (private), and kit `guarded-fetch.ts:119` (a different job: it rewrites errors).
- **13. JSON config file read and parse with error mapping, three times** (api, status, notify). Location `status/src/theme-config.ts:107`.
  - Id: `architecture-system-2026-11-05-13`. Severity: `P3`. Candidate: `false`.
  - Command: `sed -n 480,492p .repos/api/src/config.ts; sed -n 107,122p .repos/status/src/theme-config.ts; sed -n 313,330p .repos/notify/src/config.ts`. Exit 0.
  - Each one has `readFileSync(path, "utf8")` in a try, `JSON.parse` in a try, and its own error text.
- **14. Small helpers copied** (api, notify, kit, contract). Location `notify/src/errors.ts:76`.
  - Id: `architecture-system-2026-11-05-14`. Severity: `P3`. Candidate: `false`.
  - `messageOf` is defined in `api/src/backup.ts:21`, `notify/src/errors.ts:76` and `kit/src/run-service.ts:25` (private).
  - `isHttpUrl` is defined in `contract/src/schema.ts:22` (private) and `notify/src/channel-schema.ts:7`.
  - The timer cap is `contract/src/schema.ts:7 MAX_TIMER_MS = 2_147_483_647` and `kit/src/timer.ts:5 MAX_TIMER_DELAY_MS = 2_147_483_647`.
  - Command: `grep -rnE 'function (messageOf|isHttpUrl)\(|const isHttpUrl|(MAX_TIMER_MS|MAX_TIMER_DELAY_MS)\s*=' --include=*.ts .repos` (exit 0).
- **15. meta docs call the `pulse` CLI planned** (meta, deploy). Location `README.md:22`, `docs/architecture.md:12`.
  - Id: `architecture-system-2026-11-05-15`. Severity: `P3`. Candidate: `false`.
  - Command: `grep -n 'planned (#529)' README.md docs/architecture.md; grep -n 'cli' .repos/deploy/package.json; gh issue view 529 --json state,closedAt`. Exit 0.
  - Output: both lines say `A pulse CLI setup wizard is planned (#529)`. `.repos/deploy/package.json:16: "build": "bun build --compile --minify cli/main.ts --outfile dist/pulse"`. #529 `CLOSED 2026-11-02T18:01:38Z`. deploy `README.md:45` documents `pulse init|up|status|down`.
- **16. status and console READMEs point to a Compose file in pulse-api (P2)** (status, console, api). Location `status/README.md:49`, `console/README.md:70`.
  - Id: `architecture-system-2026-11-05-16`. Severity: `P2`. Candidate: `true`.
  - Command: `ls .repos/api/compose.yaml .repos/api/compose.yml .repos/api/docker-compose.yml`. Exit 2: `No such file or directory` for all three.
  - status: `pulse-api's repository has a Compose file that starts the whole stack with docker compose up.` console: `In the pulse Compose stack (pulse-api compose.yaml) the console is published on host loopback only.`
  - api `README.md:34` and deploy `README.md:122` say the stack moved to pulse-deploy. This is P2: a normal operator following the status README's documented startup has no Compose definition in the named repository; no contrived input is needed.
- **17. api `docs/development.md` code layout, SQL and bench claims** (api). Location `api/docs/development.md:22`, `:24`, `:26`, `:47`.
  - Id: `architecture-system-2026-11-05-17`. Severity: `P3`. Candidate: `false`.
  - Commands: `grep -nE 'readString\(env, "(PULSE_DB|PULSE_CHECKS_FILE|PULSE_TOKENS_FILE)"|readPort\(env' .repos/api/src/start.ts`, `grep -cE '\.(query|prepare|run)\(' .repos/api/src/{audit-log,manual-incidents,check-store,token-store}.ts`, `sed -n 4p .repos/api/src/db.ts`, `grep -n BUILD_REPOS .repos/api/bench/run.ts`. Exit 0.
  - Output: `289: const port = readPort(env, "PORT" …`, `290: … "PULSE_DB" …`, `291: … "PULSE_CHECKS_FILE" …`, `292: … "PULSE_TOKENS_FILE" …`.
  - SQL calls: audit-log 9, manual-incidents 45, check-store 7, token-store 16.
  - `/** The schema at user_version 0, as the first release created it. Later changes are migrations. */`, and `48: const BUILD_REPOS: readonly RepoName[] = ["contract", "kit"];`.
  - The table names 10 of the 45 non-test modules. These are #501 findings 18 and 19, plus the SQL claim.
- **18. status `docs/development.md` lists two kit browser imports; there are three** (status). Location `status/docs/development.md:31`.
  - Id: `architecture-system-2026-11-05-18`. Severity: `P3`. Candidate: `false`.
  - Command: `grep -rn 'pulse-kit/is-record' .repos/status/src --include=*.ts | grep -v test; sed -n 261p .repos/status/src/server.ts`. Exit 0.
  - Output: `src/poller.ts:25:import { isRecord } from "@lorenzh/pulse-kit/is-record";` and `const kitModules = new Set(["escape.js", "format-duration.js", "is-record.js"]);`.
  - status `AGENTS.md` repeats the two-file rule ("serves only those two files from the kit").
- **19. contract README says it depends on no other pulse repository** (contract). Location `contract/README.md:7`.
  - Id: `architecture-system-2026-11-05-19`. Severity: `P3`. Candidate: `false`.
  - Command: `grep -n 'depends on no other pulse repository' .repos/contract/README.md; grep -n 'pulse-config' .repos/contract/package.json .repos/contract/.github/workflows/ci.yml`. Exit 0.
  - Output: `7:pulse-contract depends on no other pulse repository.`, `package.json:32: "@lorenzh/pulse-config": "github:lorenzh/pulse-config#51e95b0…"`, `ci.yml:17: uses: lorenzh/pulse-config/.github/workflows/check.yml@51e95b0…`.
  - The meta README lists contract as "zod; pulse-config (dev)". This is #501 finding 22.
- **20. meta `docs/architecture.md` says the bench measures every service** (meta, api, console). Location `docs/architecture.md:39`.
  - Id: `architecture-system-2026-11-05-20`. Severity: `P3`. Candidate: `false`.
  - Command: `grep -n 'export const SERVICES' .repos/api/bench/stack.ts; sed -n 5p .repos/api/bench/refs.ts`. Exit 0.
  - Output: `17:export const SERVICES = ["api", "probe", "status", "notify"] as const;` and `export const REPOS = ["api", "probe", "status", "notify", "contract", "kit", "config"] as const;`.
  - console is a service and is not measured. "All seven repositories" is now 7 of 10 code repositories.
- **21. Factory context: probe lacks api, console lacks deploy** (meta, probe, console). Location `.factory/config.yaml:84` (probe), `:133` (console).
  - Id: `architecture-system-2026-11-05-21`. Severity: `P3`. Candidate: `false`.
  - Command: `grep -n 'context' .factory/config.yaml; grep -n '/probe/checks\|/results' .repos/probe/src/client.ts`. Exit 0.
  - Output: `84: context: [ meta, contract, config, kit ]` (probe) and `133: context: [ meta, contract, api, config, kit ]` (console).
  - probe calls `/probe/checks` (`client.ts:287`) and `/results` (`client.ts:386`), and meta `AGENTS.md` says a context lists `api` "when it calls the API".
  - console's CI job `deploy-dev` runs deploy `main` (finding 2), but a console plan cannot read deploy.


## Audit review

Started 2026-11-05 at 15:13:21 UTC. The review retained 21 findings: **1 P2 and 20 P3**, with five candidates (16, 1, 3, 4, 5). All six checklist items remain checked. No whole finding was removed.

The fresh console clone was `a1b4497ad42ecfc280ecc607469f45847816b675`; it had moved beyond the report. A temporary copy was fetched and detached at the reported `9a3ef14fc8a0335f8bf70f56023868633a56525e`. Meta's copy was detached at `1463761`, before the audit commit `3263e2c`. All eleven reported snapshots were checked with `git rev-parse HEAD` (exit 0). The read-only clones were not changed.

Corrections made in both report files:

- Finding 16: P3 → P2, and made a candidate. The documented Compose startup has no definition to run in pulse-api. Its exact command was reproduced with exit 2.
- Finding 2: kept the CI cycle and unpinned-input observation, removed its candidate flag and the unsupported claim of a prohibited architecture direction. Console's instructions explicitly require this integration job.
- Finding 4: narrowed to meta's false console claims. Contract's non-exclusive consumer list is not a contradiction.
- Finding 5: removed the incorrect explanation that kit cannot preserve ownership. Code and an injected-filesystem call confirm it does; the local duplicate remains.
- Finding 7: recorded the limiter test's actual exit 1 on aggregate coverage despite 34 passing tests. The probe commands exit 0 with 419 passing tests. Compatibility claims now stay within that evidence.
- Filled missing affected-repository commits, made every finding id explicit here, listed all ten large specs and measured meta's functions separately from the adopted target budget.

| Review command/check | Exit | Output |
| --- | --- | --- |
| `jq . audits/architecture/system.json`; required fields and Markdown/JSON consistency | 0 | 21 findings, matching ids/severities/candidates; six checked items |
| `git rev-list --count`, `git merge-base --is-ancestor`; package/lock/workflow comparison | 0 | Reported behind counts; 19 matching pairs and matching workflow refs |
| `git ls-files`, `wc -l`, TypeScript AST | 0 | Reported file and function sizes reproduced |
| `node "$T/../complexity.mjs" "$T" --meta` | 1 | 701 files, 11 errors (one deploy, ten reference-only meta), zero parse errors |
| `python3 -I "$T/../deps.py" "$T"` | 0 | Cycles: libraries 0, runtime 0, with CI checkouts 1, all kinds 4 |
| `bun "$T/../api-url.ts"` | 0 | All three URL rule sets reproduced |
| `bun run typecheck && bun test` in probe with contract main | 0 | 419 pass, 0 fail |
| `bun test test/failure-limiter.test.ts --dots` in kit `c6d2cba`, with main's test | 1 | 34 pass, 0 fail; aggregate line coverage 38.23% |
| config main's `pulse-workflows` in contract, kit, website | 0 each | `ok (1 files, 1 uses)`, `ok (1 files, 1 uses)`, `ok (1 files, 3 uses)` |
| Finding 16's `sed`/`ls` command | 2 | Both claims and all three missing Compose paths reproduced |
| Other P3 finding commands in Bash, plus `gh issue list`/`gh issue view` for earlier findings | 0 | Evidence holds with the qualifications above |

Limitations: this review ran architecture scans and targeted tests, not the complete Docker integration suite or performance benchmarks. Passing probe tests do not prove equivalence on every input. No security finding or exploit detail is present. Temporary copies and review scripts were removed after validation; the probe tests closed their local test servers.

## Reproduction appendix

`T` is an **exported absolute path to temporary installed copies** named `contract`, `kit`, `config`, `api`, `probe`, `status`, `notify`, `console`, `deploy`, `website`, each checked out at Scope's SHA. Keep a meta copy at the sibling path `$T/../meta`, checked out at its Scope SHA. Install only in copies with `bun install --frozen-lockfile`. Save the following scripts beside that directory, outside the repository. The commands in the JSON use these scripts. Remove the temporary tree after reproducing.

For finding 7, after installing probe, substitute contract main's `dist/` and `package.json` in its installed `@lorenzh/pulse-contract` using `rsync -a`. For the limiter comparison, copy kit to `$T/../kit-pin`, detach it at `c6d2cba`, install, and copy only main's `test/failure-limiter.test.ts` over that test in the copy. These substitutions do not update the examined repository commits.

### complexity.mjs

```js
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
const root = process.argv[2]; // directory of installed copies at the reported SHAs
const require = createRequire(join(root, 'config/package.json'));
const { ESLint } = require('eslint');
const eslint = new ESLint({
  cwd: dirname(root), overrideConfigFile: true, ignore: false,
  overrideConfig: [{
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.jsx'],
    languageOptions: { parser: require('@typescript-eslint/parser'), parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { noInlineConfig: true },
    plugins: { sonarjs: require('eslint-plugin-sonarjs') },
    rules: { 'sonarjs/cognitive-complexity': ['error', 15] },
  }],
});
const repos = ['api', 'config', 'console', 'contract', 'deploy', 'kit', 'notify', 'probe', 'status', 'website'];
const files = repos.flatMap(repo => {
  const dir = join(root, repo);
  return execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' }).trim().split('\n')
    .filter(f => /\.(tsx?|jsx?|mjs)$/.test(f) && !f.startsWith('dist/')).map(f => join(dir, f));
});
if (process.argv.includes('--meta')) {
  const dir = join(dirname(root), 'meta');
  files.push(...execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' }).trim().split('\n')
    .filter(f => /\.(tsx?|jsx?|mjs)$/.test(f)).map(f => join(dir, f)));
}
const results = await eslint.lintFiles(files);
for (const r of results) for (const m of r.messages) if (m.severity === 2) console.log(`${r.filePath}:${m.line} ${m.message}`);
console.log('files scanned:', files.length, 'errors:', results.reduce((n,r) => n+r.errorCount,0), 'parse errors:', results.reduce((n,r) => n+r.fatalErrorCount,0));
process.exitCode = results.some(r => r.errorCount > 0) ? 1 : 0;
```

### api-url.ts

This script expects the installed copies in a sibling directory named `repos` (the review's `$T`); adjust its relative import prefix if the temporary directory has another name. Its read functions do not start services or contact the example addresses.

```ts
import { readSettings as status } from './repos/status/src/settings.ts';
import { readSettings as consoleSettings } from './repos/console/src/settings.ts';
import { loadSettings as probe } from './repos/probe/src/settings.ts';
import { loadSettings as notify } from './repos/notify/src/config.ts';
const readers = {
  status,
  console: (env: Record<string,string>) => consoleSettings(env, () => { throw new Error('unexpected read'); }),
  probe: (env: Record<string,string>) => probe(env, () => { throw new Error('unexpected read'); }),
  notify,
};
for (const url of ['ftp://api.example:21/', 'http://user:password@api.example:3000', 'http://api.example:3000/?q=1']) {
  for (const [repo, read] of Object.entries(readers)) {
    try {
      read({ PULSE_API_URL: url, PULSE_PROBE_TOKEN: 'test-token-00000000000000000', PULSE_NOTIFY_CONFIG: '/tmp/unused-notify-config.json' });
      console.log(url, repo, 'accepted');
    } catch (e) {
      console.log(url, repo, 'rejected:', (e as Error).message);
    }
  }
}
```

### deps.py

Requires Python's PyYAML. The graph deliberately excludes test fixtures; meta's Factory contexts and workflow token scopes are orchestration metadata, not runtime/library imports. Factory context gaps are checked separately in finding 21.

```python
import json
import pathlib
import re
import sys
import yaml

base = pathlib.Path(sys.argv[1])
names = sorted(p.name for p in base.iterdir() if (p / 'package.json').is_file())
edges = {}
def add(source, target, kind):
    if source != target and target in names:
        edges.setdefault((source, target), set()).add(kind)
def walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)
for source in names:
    repo = base / source
    package = json.loads((repo / 'package.json').read_text())
    for section, kind in [('dependencies','code'),('devDependencies','dev')]:
        for name, spec in package.get(section,{}).items():
            m = re.match(r'github:lorenzh/pulse-([a-z]+)#',spec)
            if m: add(source,m[1],kind)
    for path in (repo / '.github/workflows').glob('*.yml'):
        for item in walk(yaml.safe_load(path.read_text())):
            m = re.match(r'lorenzh/pulse-([a-z]+)/',str(item.get('uses','')))
            if m: add(source,m[1],'ci')
            checkout = item.get('with',{})
            if isinstance(checkout,dict):
                m = re.fullmatch(r'lorenzh/pulse-([a-z]+)',str(checkout.get('repository','')))
                if m: add(source,m[1],'ci-checkout@'+str(checkout.get('ref','default')))
    for path in repo.rglob('*.yaml'):
        rel = path.relative_to(repo)
        if any(x in rel.parts for x in ['.git','node_modules','test','tests']): continue
        if 'compose' not in path.name and not (source == 'deploy' and rel.as_posix() == 'common/services.yaml'): continue
        for item in walk(yaml.safe_load(path.read_text())):
            m = re.search(r'ghcr.io/lorenzh/pulse-([a-z]+)',str(item.get('image','')))
            if m: add(source,m[1],'deploy-image')
            build = item.get('build')
            context = build.get('context','') if isinstance(build,dict) else str(build or '')
            for m in re.finditer(r'pulse-([a-z]+)(?:\.git|[/$#}]|$)',context):
                add(source,m[1],'bench' if 'bench' in rel.parts else 'deploy-build-local')
    for path in (repo / 'src').rglob('*.ts'):
        if not path.name.endswith('.test.ts') and 'PULSE_API_URL' in path.read_text(): add(source,'api','runtime')
    if source == 'api':
        text = (repo/'bench/refs.ts').read_text()
        array = re.search(r'export const REPOS = \[([^\]]+)\]',text)[1]
        for name in re.findall(r'"([a-z]+)"',array): add(source,name,'bench')
    if source == 'website':
        for name in json.loads((repo/'docs.config.json').read_text())['repos']: add(source,name,'docs')
for (a,b),kinds in sorted(edges.items()): print(a,'->',b,','.join(sorted(kinds)))
def cycles(allowed):
    graph = {n:[] for n in names}
    for (a,b), kinds in edges.items():
        if any(allowed(k) for k in kinds): graph[a].append(b)
    found = set()
    def visit(start,path):
        for node in graph[path[-1]]:
            if node == start:
                rotations = [tuple(path[i:]+path[:i]) for i in range(len(path))]
                found.add(min(rotations))
            elif node not in path: visit(start,path+[node])
    for name in names: visit(name,[name])
    return sorted(found)
for label, allowed in [
 ('libraries',lambda k:k in {'code','dev','ci'}),
 ('runtime',lambda k:k in {'code','dev','ci','runtime'}),
 ('CI checkouts',lambda k:k in {'code','dev','ci','runtime'} or k.startswith('ci-checkout')),
 ('all',lambda k:True),
]:
    result=cycles(allowed)
    print(label, len(result))
    for path in result: print(' -> '.join([*path,path[0]]))
```
