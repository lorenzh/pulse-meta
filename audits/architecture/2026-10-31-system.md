# Architecture audit: pulse (2026-10-31)

## Scope

Issue: lorenzh/pulse-meta#501. Kind `architecture`, scope `system`. Every repository at its newest `main`:

| Repository | Examined commit |
| --- | --- |
| meta | `96504d36ac3d5c627888c640a186d88fe498bfcd` |
| contract | `ebcbbb613328494185833f7133f1242910986948` |
| kit | `6a06ec25d26d90be12eba133972b59077dd0e17d` |
| config | `01a57a7e3f7c61aaa2a65f54d8b780a51efe58dc` |
| api | `11f555598831ef61f13de40bef5f2da620230c97` |
| probe | `9674e518f9d60db4a816e8c694b782a616b30dff` |
| status | `3f80bda9d7ed17127a43bcf51b71cd1e05add9b0` |
| notify | `584eabd05abcadc8f5a1035307e2c09a7a84c933` |
| website | `dcb616275ef3ed87c2ff8588d00b98d46b8294d6` |

This run updates the report of the first run of #501. That run ended before "Docs against code" was done. The eight code repositories are at the same commits as in the first run. meta moved from `b8d8e3d` to `96504d3`; the change touches `.factory/`, `.github/`, `audits/` and `docs/factory.md`, and not `README.md` or `docs/architecture.md` (`git diff --stat b8d8e3d 96504d3`).

Commands run from the meta root unless a path says otherwise. `.repos/<name>` is the read-only clone. Code was run only in copies under `mktemp -d`, which were removed at the end.

Re-run in this run: the pin and compare commands, the contract rule at each pin, the file sizes, the cognitive-complexity scan, the TSX config check, the greps behind findings 1, 2, 6, 15 and 16, the earlier-audit search, and the whole docs comparison.

Taken from the first run at the same code commits (the inputs are unchanged): the function lengths from the TypeScript AST, the function body hash listing (`functions.mjs`), the `PULSE_API_URL` run (`api-url.ts`) and the dependency graph (`deps.py`). Those scripts were kept outside the repository and are described with each item.

## Checklist

### Pin drift: checked

```sh
grep -rnoE 'github:lorenzh/pulse-[a-z]+#[0-9a-f]{7}' .repos/*/package.json
grep -rnoE 'check.yml@[0-9a-f]{7}' .repos/*/.github/workflows/ci.yml
gh api "repos/lorenzh/pulse-<name>/compare/<pin>...main" --jq '"status=\(.status) ahead_by=\(.ahead_by)"'
gh api "repos/lorenzh/pulse-contract/contents/src/schema.ts?ref=<pin>" --jq .content | base64 -d | grep -c 'must be an http: or https: URL'
```

All exit 0. The pins in `package.json` match the `bun.lock` entries. Output of the compare: contract `61f7bf8` ahead_by=2, `9fe5e80` ahead_by=6, `ebcbbb6` identical. kit `fa79ba8` ahead_by=2. config `51e95b0` ahead_by=4, `86896e9` ahead_by=2.

| Library | Pin | Pinned by | Behind `main` | Missing changes |
| --- | --- | --- | --- | --- |
| contract | `ebcbbb6` | api, probe | 0 | none |
| contract | `61f7bf8` | notify | 2 commits (1 merge, #42) | `src/schema.ts`: check `url` must be `http:`/`https:` (wire validation, issue #467) |
| contract | `9fe5e80` | status | 6 commits (3 merges, #40 to #42) | the same `src/schema.ts` change. Also own-property checks for admin input in `src/validate-admin.ts` and `src/validate.ts` (#452; status does not use admin validation), and a test-only change (#442) |
| kit | `fa79ba8` | api, probe, status, notify | 2 commits (1 merge, #3) | `bun.lock`, `package.json` devDependency pins only: no shared behavior |
| config | `51e95b0` (package and `check.yml@`) | contract, kit, api, probe, status, notify | 4 commits (2 merges, #7, #8) | `bun.lock`, `package.json`, `src/hook.test.ts`, `src/index.test.ts`. No rule file changed: `git diff --stat 51e95b0 origin/main -- .github/workflows/check.yml biome.json eslint.config.js tsconfig.base.json lefthook.yml bin/pulse-eslint.js` is empty |
| config | `86896e9` (package and `check.yml@`) | website | 2 commits (1 merge, #8) | the same, no rule change |

The http/https rule is in `src/schema.ts` at `ebcbbb6` only (count 1, against 0 at `9fe5e80` and `61f7bf8`). `version` in `package.json` is `1.6.0` at all three pins. `WIRE_VERSION` is `1` at all three pins. The only drift that changes wire validation is contract `ebcbbb6`, which status and notify do not have yet: finding 4.

### Size: checked

Files over 800 lines, every tracked file of every repository:

```sh
for r in .repos/*; do (cd $r && git ls-files -z | xargs -0 wc -l | awk -v r=${r#.repos/} '$2!="total" && $1>800 {print r"/"$2, $1}'); done; git ls-files -z | xargs -0 wc -l | awk '$2!="total" && $1>800'
```

Exit 0. Output: `api/src/service.ts 1122`, `status/src/poller.test.ts 1046`, `website/src/styles/components.css 1005`, `contract/src/schema.ts 993`, and meta `package-lock.json 1910`. The lockfile is generated and is not counted as a finding.

Complexity budget: `sonarjs/cognitive-complexity` 15 per function. It is set in config `eslint.config.js:16` and named in every repository's `AGENTS.md`.

How it was measured: pulse-config `01a57a7` was copied and installed (`bun install --frozen-lockfile`). Every tracked `*.ts`, `*.tsx`, `*.js`, `*.mjs` and `*.jsx` outside `dist/` of the eight code repositories was copied (414 files, 19 of them `.tsx`). That ESLint and eslint-plugin-sonarjs then ran with a scan config: the TypeScript parser with JSX, only the rule at 15, and `noInlineConfig: true` so that disable comments hide nothing:

```sh
eslint --config scan.config.js --no-warn-ignored --format json --output-file scan.json .
bun summarize.mjs scan.json
```

ESLint exit 1 (one rule error). Output: `api/src/server.ts:527 Refactor this function to reduce its Cognitive Complexity from 52 to the 15 allowed.`, `files scanned: 414`, `total over budget: 1`, `parse errors: 0`. That function carries `// eslint-disable-next-line sonarjs/cognitive-complexity` at `api/src/server.ts:526`: finding 1. The highest `.tsx` function is 6 (`website/src/components/ButtonLink.tsx:22`, first run).

Longest functions, from the TypeScript AST of the non-test source (first run, same commits):

| Function | Lines |
| --- | --- |
| `api/src/service.ts:352 createService` | 771 |
| `status/src/poller.ts:155 createPoller` | 261 |
| `api/src/start.ts:122 run` | 240 |
| `website/src/content/hosted.tsx:223 HostedContent` | 202 |
| `status/src/server.ts:539 createStatusServer` | 194 |
| `api/src/server.ts:527 handle` | 174 |

The shared ESLint config gives no config to `.tsx` files, so the website's 19 `.tsx` files are not linted: finding 11.

### Duplicated helpers: checked

Every named function in the non-test source of the eight code repositories was listed with a whitespace-normalized body hash (`functions.mjs`, 1134 functions, first run at the same commits). Names that occur in two or more repositories, and equal bodies across repositories, were compared. Then the candidates were read. Helpers that belong in pulse-kit:

- `isObject`/`isRecord` type guard: 11 copies in api, probe, status and notify, plus a private one in contract (finding 2). The grep was re-run in this run: 11 lines.
- Atomic file write (temp file, then rename) in api and notify, in three variants with different fsync behavior (finding 3).
- `PULSE_API_URL` parsing: status has its own reader, while probe and notify use kit's `readUrl`. The three accept different values (finding 5).
- The 2^31-1 timer cap is defined five times. kit's `safeSetTimeout` and `MAX_TIMER_DELAY_MS` have no consumer (finding 6). The grep was re-run in this run: no consumer, exit 1.
- Bounded reading of a response body stream: once in contract, twice in probe (finding 12).
- Reading a JSON config file, with error mapping for read and parse: api, status, notify (finding 13).
- `isHttpUrl` (private in contract, and in notify) and `messageOf` (private in kit, and in notify), each identical (finding 14).

Checked and not counted:

- `readBody` in probe reads a fetch response stream with a keyword stop. `readBody` in kit reads a request body. They do different jobs.
- `isHostName` in api and in notify validates different things.
- `createMetrics`, `loadSettings`, `parseConfig` and the like are service-specific.

### Docs against code: checked

Compared claim by claim:

- meta: `README.md` (245 lines) and `docs/architecture.md` (47 lines).
- `README.md` of contract, kit, config, api, probe, status, notify and website.
- `docs/development.md` of api, probe, status and notify.

Not applicable, because the files do not exist (`ls .repos/*/docs docs`): meta has no `docs/development.md`. No code repository has a `docs/architecture.md`. contract, kit, config and website have no `docs/development.md`.

Each claim was checked with `grep -n`/`sed -n` against the code. The main commands:

```sh
grep -H '"packageManager"' .repos/*/package.json; grep -Hn '^FROM' .repos/*/Dockerfile
for r in api probe status notify; do grep -rhoE '"(PULSE_[A-Z0-9_]+|PORT|POLL_MS)"|env\.(PULSE_[A-Z0-9_]+|PORT|POLL_MS)' .repos/$r/src --include=*.ts --exclude=*.test.ts | sort -u; done
grep -nE 'fallback|DEFAULT_[A-Z_]+ *=|\?\? ' .repos/{api/src/start.ts,probe/src/settings.ts,status/src/settings.ts,notify/src/config.ts}
awk '/^jobs:/{f=1;next} f && /^  [a-zA-Z0-9_-]+:/{print NR": "$0}' .repos/{api,status}/.github/workflows/ci.yml
grep -nE '^\s+[a-z-]+:$|build:|ports:|PULSE_LOCATION|HEALTHCHECK' .repos/api/compose.yaml .repos/*/Dockerfile
```

All exit 0.

These match the code:

- meta `docs/architecture.md`, every line from 3 to 47:
  - Roles of the repositories.
  - `bun@1.4.0` in all eight `package.json`. `oven/bun:1.4.0-alpine@sha256:…` in all four Dockerfiles.
  - `PRAGMA user_version` with numbered migrations (`api/src/db.ts:90`, `api/src/migrations.ts:2`).
  - `SIGHUP` reload (`api/src/start.ts:238`).
  - `/probe/checks` with a fallback on 404 (`probe/src/client.ts:212-223`).
  - The `PULSE_HEADER_` prefix (`probe/src/client.ts:117`).
  - Reload default 60000 (`probe/src/reload-interval.ts:5`), and a reload on `unknown-check` (`probe/src/main.ts:172`).
  - The probe skips heartbeat checks (`probe/src/client.ts:263`).
  - `reporting`/`silent` (`api/src/service.ts:963`).
  - The `x-pulse-contract` header: set by api (`server.ts:55`), checked by probe (`client.ts:322`), status (`poller.ts:219`, `server.ts:307`) and notify (through `fetchJson`, `api.ts:127`).
  - `PULSE_HEALTH_PORT=9100` in the probe and notify images.
  - Bench: test CPU of seven repositories (`bench/refs.ts:5`) and build CPU of contract and kit (`bench/run.ts:31`).
- The meta README settings table: the names are exactly the set that each service reads (api 8, probe 8 plus the `PULSE_HEADER_` prefix, status 11, notify 15, `PULSE_LOG_LEVEL` through kit `readLogLevel`). Every default matches.
- The meta README Compose section: project `pulse`, services, ports, the `:ro` mount, demo locations `eu`/`us`, volumes, and the health check paths. `DOWNS_TO_OPEN = 3` and a quorum of 2 when several locations report (`api/src/state.ts:3`, `:43-47`). The Factory `context` paragraph matches `.factory/config.yaml`.
- The READMEs of kit, config, probe, notify and website, and `docs/development.md` of probe and notify: no contradiction found. For example: the kit `exports` subpaths, the `check.yml` input `build`, the target `lefthook.yml` extends, `tsconfig.base.json` options, RDAP in `check-domain.ts`, the website scripts and exact pins, the six repositories in `docs.config.json`, and `siteUrl`.

These contradict the code (all P3, details under Notes):

| Finding | Repository | Claim | Code |
| --- | --- | --- | --- |
| 17 | api | `docs/development.md:57` "`ci.yml` has three jobs" | `ci.yml:16,19,32,48`: four jobs, `check`, `bench-selftest`, `docker`, `compose-e2e` |
| 18 | api | `docs/development.md:47` the bench measures "the test and build CPU time of all seven repositories" | `bench/run.ts:31` `BUILD_REPOS = ["contract", "kit"]`; `bench/budgets.json` has `build_cpu_s` only for contract and kit |
| 19 | api | `docs/development.md:22` `src/main.ts` "Reads the environment"; `:26` `src/db.ts` "Schema (current version only)" | `src/start.ts:129-132` reads `PORT`, `PULSE_DB`, `PULSE_CHECKS_FILE`, `PULSE_TOKENS_FILE`; `src/db.ts:4` "The schema at `user_version` 0 … Later changes are migrations" (`src/migrations.ts`). The table names 10 of 26 modules |
| 20 | status | `docs/development.md:26` `src/validate.ts` runs in the browser; the browser modules "import only types, with one exception: `poller.ts` imports `validate.ts`" | `src/validate.ts` does not exist (`ls`, exit 2). `src/poller.ts:1-21` imports `fetchJson` and nine validators from `@lorenzh/pulse-contract`, and `:22` `RESOLVED_WINDOW_MS` from `./render.ts`. `src/render.ts:19-20` imports `escapeHtml` and `formatDuration` from pulse-kit |
| 21 | status | `README.md:55` the server serves the contract runtime files `index.js`, `schema.js`, `validate.js`, `version.js`, `client.js` | `src/server.ts:188-197` also serves `components.js`, `admin.js`, `validate-admin.js` |
| 22 | contract | `README.md:7` "pulse-contract depends on no other pulse repository" | `package.json:32` devDependency `github:lorenzh/pulse-config#51e95b0…`; `.github/workflows/ci.yml:17` `uses: lorenzh/pulse-config/.github/workflows/check.yml@51e95b0…`. The meta README lists "zod; pulse-config (dev)" |

Not counted, because the docs leave something out but say nothing false:

- meta `README.md:3` names only HTTP and TLS checks.
- meta `README.md:65` names one of the three checks in `compose/checks.json`.
- notify `docs/development.md:26` names two of the 13 channel modules.

### Earlier findings: checked

```sh
gh issue list --repo lorenzh/pulse-meta --state all --label architecture --json number,title
gh issue list --repo lorenzh/pulse-meta --state all --search "Architecture audit in:title" --json number,title
ls audits/*; git log --oneline --diff-filter=A -- 'audits/architecture/*'
```

Exit 0. Both lists show only #501. `audits/architecture/` holds only this report, which the first run of #501 added (`e56da3f`). There is no earlier architecture audit.

The nearest predecessor is the shared-code plan in the tracking issue #166. Its step S4 (#298) says "probe, status, notify and api adopt [the kit helpers] and delete their copies" (`.factory/work/298/plan.md:3`). Items still true:

- The safe timer helper is in kit, but no service uses it, and api and probe keep their own caps (finding 6).
- status still reads `PULSE_API_URL` with its own parser (finding 5).

The "Still open (30 Oct 2026)" items of #166 are closed: #369 (2026-10-30T21:35Z), #380 (2026-10-30T19:47Z) and #408 (2026-10-30T22:25Z) (`gh issue view <n> --json state,closedAt`, first run).

### Dependency direction: checked

The intended direction comes from meta `docs/architecture.md` and the meta README table:

- api, probe, status and notify depend on contract and kit.
- Every code repository depends on config.
- contract and kit depend only on config (dev). config depends on nothing.
- probe, status and notify talk to api at run time.

`python3 -I deps.py .repos` builds the graph from these sources:

- `package.json` (dependencies and devDependencies)
- workflow `uses:`
- Compose `build:` URLs
- `api/bench/refs.ts` `REPOS`
- `website/docs.config.json`
- `PULSE_API_URL` reads in the service sources

It then searches for cycles. Exit 0. Output:

```text
api -> config: bench,ci,dev          probe -> api: runtime        status -> api: runtime
api -> contract: bench,code          probe -> config: ci,dev      status -> config: ci,dev
api -> kit: bench,code               probe -> contract: code      status -> contract: code
api -> notify: bench,deploy          probe -> kit: code           status -> kit: code
api -> probe: bench,deploy           notify -> api: runtime       website -> config: ci,dev
api -> status: bench,deploy          notify -> config: ci,dev     website -> api|contract|kit|notify|probe|status: docs
contract -> config: ci,dev           notify -> contract: code
kit -> config: ci,dev                notify -> kit: code
cycles over code+dev+ci (build-time library pins): 0
cycles over code+dev+ci+runtime: 0
cycles over all kinds: 3
  api -> notify -> api
  api -> probe -> api
  api -> status -> api
```

The pins and the Compose `build:` lines behind these edges were re-checked in this run (see Pin drift and finding 15).

No library depends on a service, and kit and contract do not depend on each other. The library layer matches the intended direction.

The three cycles come from two sources:

- api's `compose.yaml` builds probe, status and notify from their unpinned `main` (finding 15).
- The api bench builds them too, which `docs/architecture.md` documents.

The website reads the docs of six repositories at SHAs pinned in `docs.config.json`. Nothing depends on the website.

probe calls the API, but its Factory `context` does not list api (finding 16).

## Issue candidates

| Id | Severity | Repositories | Title |
| --- | --- | --- | --- |
| architecture-system-2026-10-31-1 | P3 | api | `handle` in `src/server.ts` has cognitive complexity 52 against a budget of 15, and an inline disable hides it |
| architecture-system-2026-10-31-4 | P3 | status, notify, contract | status and notify pin an older contract that still accepts non-http check URLs; all three pins say version 1.6.0 |
| architecture-system-2026-10-31-15 | P3 | api, probe, status, notify | api's Compose file builds probe, status and notify from unpinned `main`: a repository cycle outside the SHA-pin rule |
| architecture-system-2026-10-31-3 | P3 | api, notify | Atomic file write implemented four times in api and notify with three different durability guarantees |
| architecture-system-2026-10-31-20 | P3 | status | status `docs/development.md` names a missing `src/validate.ts` and a browser import rule that the code no longer follows |

### 1. `handle` in api `src/server.ts` is over the complexity budget (P3)

- Location: `api/src/server.ts:527` (disable comment at `:526`).
- Command: the cognitive-complexity scan described under Size (pulse-config `01a57a7` ESLint and eslint-plugin-sonarjs, threshold 15, `noInlineConfig: true`, 414 files). Then `grep -rn 'eslint-disable-next-line sonarjs/cognitive-complexity' .repos/*/src`.
- Exit code: 1 (ESLint reports one rule error). The grep exits 0.
- Output: `api/src/server.ts:527 Refactor this function to reduce its Cognitive Complexity from 52 to the 15 allowed.`, `total over budget: 1`, `.repos/api/src/server.ts:526:// eslint-disable-next-line sonarjs/cognitive-complexity -- splitting this validator/handler would be a behaviour-risking refactor`.
- This is the only function over budget in the whole system, at 3.5 times the budget. The function spans 174 lines. `AGENTS.md` of api says "never lower either to pass".

### 4. status and notify run an older contract validator (P3)

- Location: `status/package.json:34`, `notify/package.json:30`. The missing change is at `contract/src/schema.ts:13-22` and `:245`.
- Commands:
  - This run: `gh api "repos/lorenzh/pulse-contract/contents/src/schema.ts?ref=<pin>" --jq .content | base64 -d | grep -c 'must be an http: or https: URL'`, the same for `package.json` `version`, and `gh api repos/lorenzh/pulse-contract/compare/<pin>...main`.
  - First run: `bun pin-wire.ts <copies>` validates `{ id, name, url: "ftp://files.example/", intervalMs: 60000, timeoutMs: 5000 }` with `validateCheck` from the contract that each service has installed (`bun install --frozen-lockfile` in copies).
- Exit code: 0.
- Output:

  ```text
  contract 9fe5e80: version=1.6.0 http-rule-lines=0   compare: ahead_by=6
  contract 61f7bf8: version=1.6.0 http-rule-lines=0   compare: ahead_by=2
  contract ebcbbb6: version=1.6.0 http-rule-lines=1   compare: identical
  probe (contract 1.6.0 ebcbbb6): rejected: {"ok":false,"error":"check.url: must be an http: or https: URL"}
  status (contract 1.6.0 9fe5e80): accepted
  notify (contract 1.6.0 61f7bf8): accepted
  ```

- status is 6 commits behind contract `main`, and notify 2. Both miss the http/https rule of #456/#467.
- The `version` field stays 1.6.0 across three commits with different validation, so a pin can be told apart only by its SHA.
- Nothing breaks today, because api applies the stricter rule when it loads checks.

### 15. api's Compose file builds the other services from unpinned `main` (P3)

- Location: `api/compose.yaml:28`, `:41`, `:56`, `:113`, `:131`, `:149`.
- Command: `grep -nE 'build: https://github.com/lorenzh/pulse-[a-z]+\.git#[a-z0-9]+' .repos/api/compose*.yaml`, and the cycle search under Dependency direction.
- Exit code: 0.
- Output: six lines:
  - `compose.yaml:28:    build: https://github.com/lorenzh/pulse-probe.git#main`
  - `:41 ... pulse-status.git#main`
  - `:56 ... pulse-notify.git#main`
  - `:113 ... pulse-probe.git#main`
  - `:131 ... pulse-probe.git#main`
  - `:149 ... pulse-status.git#main`

  The cycle search prints `api -> probe -> api`, `api -> status -> api` and `api -> notify -> api`.
- probe, status and notify depend on api at run time, and api depends on their `main` at build time (Compose, `scripts/compose-e2e.sh`).
- So one api commit builds a different stack over time, and an api change is tested against whatever is on `main` of the others.
- `docs/architecture.md` describes only SHA pins and does not mention this edge. The meta README mentions it.

### 3. Atomic file write implemented four times (P3)

- Location: `api/src/config-write.ts:357` with `api/src/config-fs.ts:31`; `notify/src/ledger.ts:176`; `notify/src/ledger.ts:228`; `notify/src/ledger-lock.ts:108`.
- Command: `grep -rnE '\b(writeFileSync|writeTemp)\(|\brename(Sync)?\(|fsync(Sync)?\(|\.sync\(\)' .repos/{api,notify}/src --include=*.ts | grep -v '\.test\.ts'`
- Exit code: 0.
- Output (excerpt), grouped by variant:
  - api: `config-write.ts:362: fs.writeTemp(temp, data, path);`, `:365: fs.rename(temp, path);`, `config-fs.ts:47: fsyncSync(fd);`, `:56: fsyncSync(fd);`. This fsyncs the file and the directory.
  - notify `ledger.ts`: `:181: fsyncSync(fd);`, `:185: renameSync(tmp, this.#path);`. This fsyncs the file only, with no directory fsync. The async variant is `:230: await file.sync();`, `:240: await rename(tmp, this.#path);`.
  - notify `ledger-lock.ts`: `:111: writeFileSync(tmp, ...)`, `:112: renameSync(tmp, this.#path);`. This has no fsync.
- One job, three durability levels. It belongs in pulse-kit as one helper.

### 20. status `docs/development.md` contradicts the browser modules (P3)

- Location: `status/docs/development.md:26`. Code: `status/src/poller.ts:1-22`, `status/src/render.ts:19-20`, `status/src/server.ts:176-185`.
- Command: `grep -n 'src/validate.ts' .repos/status/docs/development.md; ls .repos/status/src/validate.ts; sed -n 19,20p .repos/status/src/render.ts; sed -n 1,22p .repos/status/src/poller.ts`
- Exit code: 2 (`ls`: no such file). The other commands exit 0.
- Output: `26:- src/poller.ts, src/render.ts, src/theme.ts and src/validate.ts run in the browser. … They import only types, with one exception: poller.ts imports validate.ts.`, `ls: cannot access '.repos/status/src/validate.ts': No such file or directory`, `import { escapeHtml } from "@lorenzh/pulse-kit/escape";`, `import { formatDuration } from "@lorenzh/pulse-kit/format-duration";`, `fetchJson,` … `validateUptimeResponse,` `WIRE_VERSION_HEADER,` `} from "@lorenzh/pulse-contract";`, `import { type PollerErrorKind, RESOLVED_WINDOW_MS } from "./render.ts";`.
- The browser module map (`tsModules`, `server.ts:176-185`) has eight modules: `render`, `poller`, `theme`, `sections`, `components-view`, `patch`, `bars` and `announce`.
- The page states a rule that the code no longer follows. Agents read this page before they change the browser code. status `AGENTS.md` describes the runtime imports correctly.

## Notes

All notes are P3, and none is an issue candidate.

- **2. `isObject`/`isRecord` copied 11 times** (api, probe, status, notify, contract). Location `api/src/config.ts:31`. Command: `grep -rnE 'function (isObject|isRecord)\(' .repos/{api,probe,status,notify}/src --include=*.ts | grep -v '\.test\.ts'` (exit 0, 11 lines):
  - api: `config-write.ts:94`, `tokens.ts:58`, `config.ts:31`
  - probe: `check-domain.ts:73`, `check.ts:237`
  - status: `api-filter.ts:49`, `poller.ts:106`, `syndication.ts:50`, `hidden-checks.ts:14`
  - notify: `ledger.ts:43`, `config.ts:34`

  Each body is `typeof value === "object" && value !== null && !Array.isArray(value)`. contract has the same `isObject` at `src/validate.ts:57`, but its package exports only `.`, and `isObject` is not in `src/index.ts`.
- **5. `PULSE_API_URL` parsed three ways** (status, probe, notify, kit). Location `status/src/settings.ts:48`. Command: `bun api-url.ts <copies>` feeds the same values to `readSettings` (status) and `loadSettings` (probe, notify). Exit 0. Output:
  - `ftp://api.example:21/`: status accepted, probe rejected (`must be an http(s) URL without credentials, query or fragment`), notify rejected (`must be a valid http(s) url`).
  - `http://user:secret@api.example:3000`: status accepted, probe rejected, notify accepted.

  status uses `readString` with `URL.canParse` (`settings.ts:49-52`, re-read in this run) instead of kit's `readUrl`.
- **6. Timer cap defined five times; kit's timer helper unused** (contract, kit, api, probe). Location `kit/src/timer.ts:5`. Commands:
  - `grep -rnE 'MAX_TIMER_MS\s*=|MAX_TIMER_DELAY_MS\s*=|MAX_RELOAD_MS\s*=' .repos --include=*.ts --exclude-dir=node_modules --exclude-dir=dist` (exit 0) prints `probe/src/settings.ts:20`, `api/src/location-silence.ts:3`, `probe/src/reload-interval.ts:3`, `kit/src/timer.ts:5` and `contract/src/schema.ts:7`.
  - `grep -rn 'safeSetTimeout\|MAX_TIMER_DELAY_MS' .repos/{api,probe,status,notify}/src` finds no line (exit 1, re-run in this run).
- **7. `api/src/service.ts` has 1122 lines** (api). Location `api/src/service.ts:352`, where the closure `createService` spans 771 lines. Command: the file size command under Size (exit 0).
- **8. `contract/src/schema.ts` has 993 lines** (contract). Location `contract/src/schema.ts:1`. Command as under Size (exit 0).
- **9. `status/src/poller.test.ts` has 1046 lines** (status). Location `status/src/poller.test.ts:1`. Command as under Size (exit 0).
- **10. `website/src/styles/components.css` has 1005 lines** (website). Location `website/src/styles/components.css:1`. Command as under Size (exit 0).
- **11. The shared ESLint config does not cover `.tsx`** (config, website). Location `config/eslint.config.js:11`, where the rule applies to `files: ["**/*.ts", "**/*.js"]`.
  - Command, in a copy of website: `<config copy>/node_modules/.bin/eslint --config <config copy>/eslint.config.js --print-config src/site.tsx`. Exit 0, output `undefined` (re-run in this run). The same command for `src/lib/commands.ts` prints a config with `sonarjs/cognitive-complexity`.
  - The 19 `.tsx` files (1643 lines) get neither SonarJS nor the type-aware rules. Yet `website/AGENTS.md:7` names ESLint (SonarJS) and says pages are TSX.
  - No `.tsx` function is over budget today; the highest is 6.
- **12. Bounded body-stream read implemented three times** (contract, probe). Location `probe/src/check-domain.ts:47`. Command: `grep -rnE 'getReader\(\)' .repos/{api,probe,status,notify,contract,kit}/src --include=*.ts | grep -v '\.test\.ts'` (exit 0) prints `probe/src/check.ts:195`, `probe/src/check-domain.ts:50` and `contract/src/client.ts:88`. Each loop counts bytes against a cap and cancels the reader. contract's copy is private to `fetchJson`.
- **13. JSON config file read and parse with error mapping, three times** (api, status, notify). Location `status/src/theme-config.ts:107`. Command: `sed -n 466,474p .repos/api/src/config.ts; sed -n 107,121p .repos/status/src/theme-config.ts; sed -n 295,309p .repos/notify/src/config.ts` (exit 0). Each one has `readFileSync(path, "utf8")` in a try, `JSON.parse` in a try, and its own error class and text.
- **14. `isHttpUrl` and `messageOf` copied** (contract, kit, notify). Location `notify/src/channel-schema.ts:7`.
  - The normalized-body hash shows that `notify/src/channel-schema.ts:7 isHttpUrl` has the same logic as `contract/src/schema.ts:13` (private).
  - `kit/src/run-service.ts:24 messageOf` is identical to `notify/src/errors.ts:40` (hash `0270766a9d`).
  - The same expression, `err instanceof Error ? err.message : String(err)`, also appears inline in api, probe, status, notify and contract (`grep -rn 'instanceof Error ? e[a-z]*\.message' .repos/*/src`).
- **16. probe's Factory context lacks api** (meta, probe). Location `.factory/config.yaml:72`. Meta `AGENTS.md` says a target's context lists `api` "when it calls the API". Commands (re-run in this run):
  - `grep -n 'context' .factory/config.yaml` (exit 0) prints `72: context: [ meta, contract, config, kit ]` for probe.
  - `grep -n '/probe/checks\|/results' .repos/probe/src/client.ts` prints `219: ... join(baseUrl, "/probe/checks")` and `311: ... join(baseUrl, "/results")`.
- **17. api `docs/development.md` counts three CI jobs; there are four** (api). Location `api/docs/development.md:57`. Command: `grep -n 'has three jobs' .repos/api/docs/development.md; awk '/^jobs:/{f=1;next} f && /^  [a-zA-Z0-9_-]+:/{print NR": "$0}' .repos/api/.github/workflows/ci.yml` (exit 0). Output: `57:.github/workflows/ci.yml has three jobs:`, then `16: check:`, `19: bench-selftest:`, `32: docker:`, `48: compose-e2e:`. The list under it omits `bench-selftest`, although line 47 of the same page says the self-tests run "also in CI".
- **18. api `docs/development.md` says the bench measures build CPU of all seven repositories** (api). Location `api/docs/development.md:47`. Command: `grep -n 'build CPU time of all seven' .repos/api/docs/development.md; grep -n 'BUILD_REPOS' .repos/api/bench/run.ts` (exit 0). Output: `47: … and the test and build CPU time of all seven repositories`, and `31:const BUILD_REPOS: readonly RepoName[] = ["contract", "kit"];`. `bench/budgets.json` has `build_cpu_s` only under `contract` and `kit`. Meta `docs/architecture.md:37` states this correctly.
- **19. api `docs/development.md` code layout no longer matches** (api). Location `api/docs/development.md:22`, `:26`. Command: `grep -nE '^\| .src/(main|db)\.ts.' .repos/api/docs/development.md; sed -n 4p .repos/api/src/db.ts; grep -n 'readString(env' .repos/api/src/start.ts; ls .repos/api/src | grep -v test | wc -l` (exit 0). Output:
  - `22: src/main.ts | Reads the environment, wires the parts and starts the server.`
  - `26: src/db.ts | Schema (current version only).`
  - `/** The schema at user_version 0, as the first release created it. Later changes are migrations. */`
  - `130: const dbPath = readString(env, "PULSE_DB") …`, `131: … "PULSE_CHECKS_FILE" …`, `132: … "PULSE_TOKENS_FILE" …`
  - `26`

  `src/main.ts` passes `process.env` to `startApi` in `src/start.ts`, which reads it. The table names 10 of the 26 modules. Missing are `start.ts`, `migrations.ts`, `config-write.ts`, `config-reload.ts`, `admin-routes.ts`, `manual-incidents.ts`, `slo.ts`, `latency.ts` and others.
- **21. status README lists five of the eight contract files the server serves** (status). Location `status/README.md:55`. Command: `sed -n 55p .repos/status/README.md | grep -o 'runtime files ([^)]*)'; sed -n 188,197p .repos/status/src/server.ts` (exit 0). Output: ``runtime files (`index.js`, `schema.js`, `validate.js`, `version.js`, `client.js`)``, and `contractModules = new Set(["index.js", "schema.js", "validate.js", "version.js", "client.js", "components.js", "admin.js", "validate-admin.js"])`. The README names what is public under `/pulse-contract/`, and three served files are missing from it.
- **22. contract README says it depends on no other pulse repository** (contract). Location `contract/README.md:7`. Command: `grep -n 'depends on no other pulse repository' .repos/contract/README.md; grep -n 'pulse-config' .repos/contract/package.json .repos/contract/.github/workflows/ci.yml` (exit 0). Output: `7:pulse-contract depends on no other pulse repository.`, `package.json:32: "@lorenzh/pulse-config": "github:lorenzh/pulse-config#51e95b0…"` and `ci.yml:17: uses: lorenzh/pulse-config/.github/workflows/check.yml@51e95b0…`. The same README, at lines 60-63, describes that pin. The meta README table lists contract as "zod; pulse-config (dev)". The statement holds only for runtime dependencies.
