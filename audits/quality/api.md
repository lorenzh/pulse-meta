# Quality audit: pulse-api (2026-10-31)

## Scope

- Issue: lorenzh/pulse-meta#518, periodic code quality audit of `main` of pulse-api. The issue has no comments with decisions or review feedback. No earlier quality report existed at this path, so this report is new.
- Audit date: 2026-10-31 (UTC).
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-api | `6e238dea0ece835eb27f7af80d584be508a8930f` | `main`, all of `src/`, `bench/`, `README.md`, `docs/`, `AGENTS.md`. Installed, linted, typechecked, tested and run in a temporary copy. |
| pulse-config | `01a57a7e3f7c61aaa2a65f54d8b780a51efe58dc` | `main`. pulse-api pins `51e95b0eb463b27a196a33b428607bd92443e4f0`; the audit used the pinned copy that `bun install` put in `node_modules` (`eslint.config.js`, `biome.json`, `tsconfig.base.json`). |
| pulse-contract | `ebcbbb613328494185833f7133f1242910986948` | `src/validate.ts`, `src/schema.ts`, `src/components.ts` (the same commit that pulse-api pins). |
| pulse-kit | `6a06ec25d26d90be12eba133972b59077dd0e17d` | `src/`. pulse-api pins `fa79ba8cd93949fc0cf87f7b41bdaf261dbe4dc6`; `diff -rq` of the installed `src/` against the clone's `src/` found no difference. |
| pulse-probe | `85720d384a7e146c47d4436b14b3e85379e3deb4` | `src/`, for duplication. |
| pulse-status | `3f80bda9d7ed17127a43bcf51b71cd1e05add9b0` | `src/`, for duplication. |
| pulse-notify | `584eabd05abcadc8f5a1035307e2c09a7a84c933` | `src/`, for duplication. |
| pulse-meta | `62cfe4c8a89dfe842837997803d55236491ece94` | this repository |

- Method: `rsync` of the pulse-api clone into `mktemp -d`, `bun install --frozen-lockfile` (Bun 1.4.0, exit 0, 121 packages), then the repository's own scripts under `timeout 600`. Extra measurements used only tools that the install brings: the shared ESLint setup (through `pulse-eslint`) with a lowered complexity threshold, `tsc` with extra flags, `bun test` with the lcov reporter, `grep`, and short Bun scripts that import the copy's own modules. The scratch scripts lived outside the copy and are described with each finding. A local `bun start` on `127.0.0.1` used `checks.example.json` with a replaced heartbeat secret, and throwaway tokens. The copy and the scripts were removed at the end.
- Results: 13 findings, all `P3`. No `P1` or `P2`. 5 are issue candidates. No item is blocked.

## Checklist

### 1. Lint and typecheck: `checked`

- `bun run lint` (`biome check . && pulse-eslint .`): exit 0. Biome: `Checked 136 files in 174ms. No fixes applied. Found 2 infos.` ESLint (SonarJS and typescript-eslint from pulse-config): no output, exit 0.
  - Info `lint/style/useTemplate` at `bench/compare.ts:239:59` (string concatenation in a template literal). Style only: note.
  - Info `lint/complexity/noUselessSwitchCase` at `src/service.ts:671:7` (`case "http":` directly before `default:`). Style only: note.
  - Biome also reports `deserialize DEPRECATED` at `node_modules/@lorenzh/pulse-config/biome.json:41:13`: the shared config uses the `recommended` field, which the next Biome major removes. That belongs to pulse-config: note.
- `bun run typecheck` (`tsc --noEmit`, TypeScript 7.0.2): exit 0, no output.
- `bun run check`: exit 0 (lint, typecheck and 407 tests).
- `pulse-eslint --no-inline-config` (same shared config, inline directives ignored) shows what the `eslint-disable` comments hide in production code: `sonarjs/cognitive-complexity` at `src/server.ts:527` (finding 3), `sonarjs/function-return-type` at `src/server.ts:139` and `src/admin-routes.ts:102`, `sonarjs/no-nested-conditional` at `src/service.ts:372`. Each has a reason comment. In tests, 53 directives silence `no-clear-text-protocols`, `no-hardcoded-ip`, `no-unused-vars`, `no-os-command-from-path` and `void-use` on fixtures.

### 2. Complexity: `checked`

The shared budget is `"sonarjs/cognitive-complexity": ["error", 15]` (`node_modules/@lorenzh/pulse-config/eslint.config.js`). To read the value of every function, the audit ran the shared config with the threshold set to 0, in the copy only:

```js
// eslint.cc.config.js (audit copy only)
import base from "@lorenzh/pulse-config/eslint.config.js";
export default [
  { ignores: [".repos/**", ".bench/**", "bench-out/**"] },
  ...base.map((e) => e.rules && "sonarjs/cognitive-complexity" in e.rules
    ? { ...e, rules: { ...e.rules, "sonarjs/cognitive-complexity": ["error", 0] } } : e),
];
```

`./node_modules/.bin/pulse-eslint --no-inline-config --config eslint.cc.config.js -f json src bench`, exit 1 (every function with a value above 0 is reported; 453 functions in the audit-review re-run, 452 in the audit run). Highest values against the budget of 15:

| Value | Function | Against 15 |
| --- | --- | --- |
| 52 | `handle`, `src/server.ts:527` | over by 37, silenced by `eslint-disable-next-line` at `src/server.ts:526` (finding 3) |
| 15 | `runLoad`, `bench/load.ts:176` | at the budget |
| 15 | admin request handler (returned closure), `src/admin-routes.ts:221` | at the budget |
| 15 | `tick`, `src/heartbeat.ts:35` | at the budget |
| 15 | ingest transaction callback, `src/service.ts:881` | at the budget |
| 13 | `write`, `src/admin-routes.ts:162` | under |
| 12 | `uptimeOf`, `src/service.ts:750` | under |
| 12 | `run`, `src/start.ts:122` | under |
| 11 | `parseProbed`, `src/config.ts:150` | under |
| 11 | `checkMeasurements`, `src/server.ts:108`; `validateResult`, `src/server.ts:139` | under |

Without `--no-inline-config` the same run lists 15 as the highest value: the disable comment also hides `handle` from the measurement.

### 3. Duplicated logic: `checked`

Read and `grep` over `src/` of api, probe, status, notify, kit and contract (`grep -rnE "function isRecord|/\^bearer|/\^Bearer|timingSafeEqual\(|createHash\(\"sha256\"\)|function (codeOf|errorCode|messageOf)\b|isStopped|handle = deps\.setTimeout" */src`).

- Contract validation done twice: `validateResult` re-checks the object shape, `checkId`, `status`, the `statusCode` range and the `reason` type (`src/server.ts:146-156`, `109-110`, `113`) after `validatePostResultRequest` of pulse-contract has checked the same (`src/server.ts:144`). The api branches never answer (finding 9).
- `isRecord` three times in api (`src/config.ts:31`, `src/config-write.ts:94`, `src/tokens.ts:58`), twice in probe (`src/check.ts:237`, `src/check-domain.ts:73`), once in status (`src/poller.ts:106`). pulse-contract exports the same guard as `isObject` (`src/validate.ts:57`). Note.
- Reading `err.code` three times in api with three different fallbacks: `codeOf` returns `undefined` (`src/backup.ts:25`), `codeOf` returns `"unknown"` (`src/config-write.ts:77`), `errorCode` returns `"unknown error"` (`src/config-reload.ts:47`). Also in probe (`src/attempt.ts:20`) and notify (`src/channels/smtp-send.ts:91`). `messageOf` / `errorText` in api `src/backup.ts:21` and `src/start.ts:72`, notify `src/errors.ts:40`, kit `src/run-service.ts:24` (private). Note.
- HTTP error plumbing twice in api: `HttpError` and `sendError` in `src/server.ts:58` and `68`, `RouteError` and `sendError` in `src/admin-routes.ts:62` and `128`. The kit `BodyError` is mapped twice, with different text for the same `aborted` code: `request body could not be read` (`src/server.ts:83`) and `body is not valid JSON` (`src/admin-routes.ts:97`). A client that aborted does not read the answer, so: note.
- Bearer header parsing twice with different rules: `/^bearer (\S+)$/i` (`src/tokens.ts:99`) and `/^Bearer (.+)$/i` (`src/server.ts:253`, heartbeat pings). SHA-256 digest helper twice (`src/server.ts:243`, `src/tokens.ts:101`). Note.
- The self-rescheduling timer with stop (`isStopped`, `handle = deps.setTimeout(run, ...)`, `clearTimeout`) four times in api: `src/heartbeat.ts:89`, `src/config-reload.ts:154`, `src/retention.ts:80`, `src/latency-rollup.ts:60`. The same pattern exists in status (`src/api-poll.ts:16`) and probe (`src/reloader.ts`). pulse-kit has no periodic runner; AGENTS.md asks to propose such infrastructure to pulse-kit. Note.
- `MAX_TIMER_MS = 2 ** 31 - 1` is defined locally in `src/location-silence.ts:3`, while `src/config.ts:9` imports `MAX_TIMER_MS` from pulse-contract and pulse-kit exports `MAX_TIMER_DELAY_MS`. Same value. Note.
- No duplication found for the SLO, uptime and component state math: api uses `combineStates` and `aggregateUptime` of pulse-contract (`src/components.ts:1-11`), status renders the served values.

### 4. Dead code: `checked`

- `bun node_modules/typescript7/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters`: exit 0, no output. No unused local or parameter.
- Export scan: a Bun script listed every `export` of `src/*.ts` (non-test) and the files that name it (word match over `src/`, `bench/`, `scripts/`). Exit 0. Exports that no production file uses: see finding 10. Type-only exports of dependency interfaces (`MetricsDeps`, `WriterDeps`, ...) are left out as harmless.
- Reachability: a Bun script followed the relative imports from `src/main.ts`, `src/backup-main.ts`, `bench/run.ts` and `bench/selftest/*.ts`. Only `bench/seed.ts` was not reached by an import; `bench/run.ts:117` runs it as a subprocess (`bun <BENCH_DIR>/seed.ts`). No file is unreached.
- Unreachable branches: finding 9. An unused getter: `LatencyRollupRunner.done` (`src/latency-rollup.ts:26`, `92-94`) has no caller (`grep -n "\.done\b" src/*.ts` finds only `src/retention.test.ts:137,180`, which await the retention runner); coverage lists `src/latency-rollup.ts` lines 92-93 as uncovered.

### 5. Test quality: `checked`

- `bun run test`: exit 0, `407 pass, 0 fail, 81 expect() calls, Ran 407 tests across 57 files. [3.17s]`. 53 of 57 test files assert with `node:assert`, so the `expect()` count is low by design. Coverage (threshold `lines = 0.8` in `bunfig.toml`): `All files | 96.99 % funcs | 99.19 % lines`. Uncovered lines: `src/config-fs.ts` 40-42, `src/config-reload.ts` 112-113 and 122, `src/latency-rollup.ts` 92-93, `src/service.ts` 68.
- The coverage table leaves out `src/main.ts` and `src/backup-main.ts` (Bun lists only files that a test loads; `src/main.test.ts` starts the process). The lcov output (`bun test --coverage --coverage-reporter=lcov`) marks `src/server.ts:147` as run 38 times, although finding 9 shows that this `return` cannot run. Bun's line coverage overstates. Note.
- Tests without an assertion: a Bun script extracted each `test(...)` body (375 found by the pattern) and looked for `assert`, `expect`, `throws` or `rejects`, or a call of a file-local helper that asserts. It found none. No `test.skip`, `test.todo` or `test.only`.
- Tests that mirror the implementation: finding 4 (bound tests import the bounds from `src/server.ts`).
- Risky branches without a test: finding 13, and the untested retry of finding 1.
- Real clock: `src/uptime.test.ts:125` asserts `performance.now() - started < 1000` and `src/db.wal.test.ts:61` asserts `elapsed < 50` ms. AGENTS.md forbids a real clock in tests; `db.wal.test.ts:50` documents an exception, `uptime.test.ts` does not. Timing assertions can fail on a slow runner. Note.
- `src/docs-claims.test.ts` asserts the wording of `docs/` and `bench/README.md` (regex over the files), not behavior; its comment names the behavior tests. Note.
- `src/uptime.test.ts:120-121`: `void add` with an `eslint-disable` keeps an unused destructured helper. Note.

### 6. Error handling: `checked`

- `grep -nE -A4 "catch( \(\w+\))? \{|\.catch\(" src/*.ts` (non-test) and reading each block:
  - Catches that drop the caught error (empty, or a fallback value or a new error without `cause`), all with a reason comment: `src/backup.ts:110` and `116` (empty), `src/config-write.ts:415` (empty), `src/main.ts:13`, `src/server.ts:206`, `273`, `520`, `src/service.ts:68`, `1116`, `src/admin-routes.ts:108`. `src/service.ts:63-71` turns a JSON column that no longer parses into "not set" (for example `headers_json` of a check served to the probe): deliberate, note.
  - Log-only catches in the background loops: `src/heartbeat.ts:95`, `src/retention.ts:95`, `src/latency-rollup.ts:84`, `src/config-reload.ts:161`. They keep the loop alive by design. Two of them log at `info` (finding 2). `src/config-reload.ts:162` and `100` log only `err.name`, without the message (finding 1).
  - Not logged at all: an error after the answer was sent (finding 6).
  - `src/config-write.ts:406` (`tail = result.catch(() => undefined)`) keeps the write queue going; the caller still gets `result`. Fine.
- Ignored promise rejections: `@typescript-eslint/no-floating-promises` and `no-misused-promises` pass. `void run()` (`src/retention.ts:104`) and `() => void fn()` (`src/start.ts:203`, `319`) discard promises whose bodies catch everything. Fine.
- Different error shapes for the same failure: finding 11 (missing tokens file against missing checks file), finding 5 (`405` with or without `Allow`), finding 12 (`Error` subclasses without `name`). Also `404` `unknown check` on `/checks/:id/latency` (`src/server.ts:639`) against `unknown check "<id>"` on `/checks/:id/results`, `/maintenance` and `POST /results` (`src/server.ts:596`, `686`, `698`). That one is documented (`docs/rest-api.md:184`): note.
- A failure inside the heartbeat tick (`src/heartbeat.ts:63`) ends the tick for the remaining checks; the next tick runs 1 s later. Note.

### 7. Consistency: `checked`

Against pulse-api `AGENTS.md` and the layout of probe, status and notify:

- Complexity budget bypassed with a disable comment: finding 3.
- "Throw only `Error` subclasses with a `name`": finding 12.
- "Never swallow an error silently": finding 6.
- "Do not export a function only for a test": finding 10.
- "SQL queries stay in `src/service.ts`": `src/manual-incidents.ts:89-112` prepares 12 SQL statements of its own (`grep -cE "\.(prepare|query)\(|db\.run\(" src/*.ts`: `db.ts` 14, `backup.ts` 4, `manual-incidents.ts` 12, `service.ts` 43). The docs claim is in finding 8.
- "Keep logic pure. I/O stays in `main.ts` and the server or client modules": `src/config.ts:469` and `509` call `readFileSync` (checks file and tokens files), while the hot-reload path reads the checks file through the injected `ReloadFs` (`src/config-fs.ts`). The tokens files cannot be faked in a start test. Note.
- "Use `as` only right after a check": `(err as Error).message` without a check at `src/config.ts:471` and `511`. Note.
- "Wrap with `{ cause }`": `src/config.ts:471` throws a `ConfigError` without `cause`. Only test-only code reaches it (finding 10). Note.
- Booleans start with `is`, `has`, `can`: `stopped` at `src/heartbeat.ts:90` (the three other loops use `isStopped`), `fresh` and `checkForeignKeys` at `src/db.ts:113-114`. Style only: note.
- Explicit return types on exported functions: a scan flagged 9 signatures; reading them showed that all 9 have a return type (false positives on `=>` in default parameters). No deviation.
- Imports: `grep` found no relative import without `.ts`, no built-in without `node:`, no default export, no barrel.
- Configuration handling: probe and status read their environment in one `src/settings.ts`. pulse-api spreads it over `src/start.ts:79` (`PULSE_CHECKS_RELOAD_INTERVAL_MS`), `src/retention.ts:9` (`PULSE_RETENTION_DAYS`, read with the millisecond reader `readMs`) and `src/location-silence.ts:6`. The messages are correct (checked by starting with bad values, see finding 11). Note.
- Pins: contract `ebcbbb6` is `main` of pulse-contract. kit `fa79ba8` is behind kit `main` (`6a06ec2`), but the `src/` trees are identical. probe, status and notify pin the same kit commit. Fine.

### 8. Docs against code: `checked`

Read `README.md` and every page of `docs/`, then checked the claims with the code, the local server and the scratch scripts. Contradictions: findings 5, 7 and 8, and the complexity claim of `docs/development.md:51` in finding 3. Further mismatches, all notes:

- `docs/troubleshooting.md:115`: "`method not allowed`: use `POST` on `/results` and `GET` on every other path". `POST` is also valid on `/heartbeat/:id`, `/manual-incidents` and `/admin/*`, `PUT` and `DELETE` on `/admin/*` (`src/server.ts:269`, `386-393`, `src/admin-routes.ts`).
- `docs/operation.md:195` lists the fields of the `listening` line as `port, checks, maintenanceWindows, checksFile, db, retentionDays, probeTokens, locations, tokensFile`. The code adds `components`, `manualIncidents`, `adminTokens`, `locationSilentMs`, `reloadIntervalMs` and `configWrites` (`src/start.ts:295-311`; seen in the local run).
- `docs/concepts.md:107`: latency rollups are removed "when their check is no longer in the database". The API never deletes a check (`docs/operation.md:152`), so only a manual delete reaches that case.

Claims checked and correct: start errors and exit code 2 for `PULSE_RETENTION_DAYS`, `PULSE_LOCATION_SILENT_MS`, `PULSE_CHECKS_RELOAD_INTERVAL_MS`, `PULSE_LOG_LEVEL`, `PORT`, a missing tokens file and a missing checks file (`docs/configuration.md:17-23`, exit-code table); exit 0 on `SIGTERM`; `POST /results` idempotence; the `POST /results` check order; the 400 messages in `docs/troubleshooting.md`; the nearest-rank rule, the 5 s backfill delay and the 5 s read cache; the environment table against the names in `src/`.

## Issue candidates

Ranked by how much a fix is worth; all are `P3`.

### quality-api-2026-10-31-1 (P3): a checks file that fails to apply once is reported as invalid and is not retried

- Location: `src/config-reload.ts:97-101` (apply failure goes to `reject`), `src/config-reload.ts:107-108` (`lastKey` is set before the apply), commit `6e238de`.
- What happens: when `onApply` throws (in production `service.upsertChecks` in `src/start.ts:223`, a SQLite write), the reloader logs `config reload rejected: <path>: cannot apply the configuration (<err.name>)`, drops the error message, and counts `pulse_api_config_reload_total{result="invalid"}`. The file is valid. Because `lastKey` already holds the new stamp, the next looks see no change and do not try again. The new configuration stays unapplied until the file changes again or `SIGHUP`. `docs/operation.md:150` describes this behavior only for an invalid or unreadable file; `README.md` says that a changed file is applied without a restart.
- Test gap: `src/config-admin.test.ts:612` checks only the rejection after a failing upsert. No test lets the database recover and runs another look; the write path has such a test (`src/config-admin.test.ts:622-643`, the next look applies the stored file).
- Command: a Bun script imported `createConfigReloader` and `loadInitialConfig` from the copy, used a fake `ReloadFs`, changed the file once (new bytes, new `mtimeMs`), made the first `onApply` throw an `Error` named `SQLiteError`, then called `poll()` three times. Exit code 0.

```text
{
 "applyCalls": 1,
 "applied": "A",
 "logs": [
  "config reload rejected: /x/checks.json: cannot apply the configuration (SQLiteError)"
 ],
 "metrics": [
  "invalid"
 ]
}
```

- Direction: count an apply failure apart from an invalid file (for example `result="error"`), log the message, and leave `lastKey` unchanged on an apply failure so that the next look retries.

### quality-api-2026-10-31-2 (P3): failed retention and latency rollup runs log at `info` and disappear at `PULSE_LOG_LEVEL=warn`

- Location: `src/start.ts:205` (retention `log: (line) => logger.info(line)`) and `src/start.ts:321` (latency rollup, same); the failure lines come from `src/retention.ts:96` and `src/latency-rollup.ts:85`. Commit `6e238de`.
- What happens: both loops share one `log` for progress and for failures. A failed cleanup or rollup is an `info` line on stdout; with `PULSE_LOG_LEVEL=warn` or `error` it is not written at all. The other two background loops log their failures at `warn` (`src/start.ts:214` heartbeat, `src/start.ts:236` config poll). `docs/operation.md:197` documents `retention failed` as `(info)`, so this is consistent with the docs but hides the only signal of a failing cleanup.
- Command: a Bun script ran the real `startApi` of the copy twice, with `PULSE_LOG_LEVEL=info` and `warn`, an in-memory database with two results of one check (one 400 days old) and a trigger `BEFORE DELETE ON results` that raises `database or disk is full`, then closed the API and printed the log lines that contain `retention`. Exit code 0.

```text
PULSE_LOG_LEVEL=info: 2 retention line(s) ["{\"time\":\"2026-10-31T00:00:00.000Z\",\"level\":\"info\",\"msg\":\"retention failed: database or disk is full\"}","{... \"msg\":\"listening\", ... \"retentionDays\":90, ...}"]
PULSE_LOG_LEVEL=warn: 0 retention line(s) []
```

- Direction: give the loops a separate failure logger at `warn` (as heartbeat and config poll have) and update `docs/operation.md:197`.

### quality-api-2026-10-31-3 (P3): `handle` has cognitive complexity 52 against the budget of 15, hidden by a disable comment

- Location: `src/server.ts:526-527`, commit `6e238de`.
- What happens: `// eslint-disable-next-line sonarjs/cognitive-complexity -- splitting this validator/handler would be a behaviour-risking refactor` silences the rule for the whole router (`/results`, every read route, dispatch to ops, heartbeat, admin and manual incidents). `AGENTS.md:77` says that `bun run lint` limits cognitive complexity to 15 and never to lower it to pass; `docs/development.md:51` says the same. The disable comment also hides the function from the measurement. It is the only complexity suppression in the repository.
- Command: `./node_modules/.bin/pulse-eslint --no-inline-config --config eslint.cc.config.js -f json src bench` (the shared config with the threshold at 0, see item 2). Exit code 1.

```text
52 src/server.ts:527:16
15 bench/load.ts:176:23
15 src/admin-routes.ts:221:27
15 src/heartbeat.ts:35:5
15 src/service.ts:881:22
```

- Direction: split the router into one handler per route group (the probe write, the read routes) as was done for ops, heartbeat and manual incidents, then remove the disable comment.

### quality-api-2026-10-31-4 (P3): the `POST /results` bound tests import the bounds from the code, so a changed documented limit passes every test

- Location: `src/server.validation.test.ts:6-16` (imports `MAX_ATTEMPTS`, `MAX_CERT_DAYS`, `MAX_FUTURE_SKEW_MS`, `MAX_LATENCY_MS`, `MAX_REASON_LENGTH`, `MAX_RESULT_AGE_MS` from `./server.ts`) and `43-58`; the constants at `src/server.ts:39-45`. Commit `6e238de`.
- What happens: the tests build their inputs from the implementation's constants, so they move with them. `docs/rest-api.md:43-50` documents the limits as numbers (`reason` 1000, `attempts` 1 to 100, `latencyMs` 0 to 86400000). Lowering a limit is caught by unrelated tests that use longer reasons; raising one is not caught.
- Command: in the copy, `sed` changed `src/server.ts` to `MAX_REASON_LENGTH = 2000`, `MAX_ATTEMPTS = 1000`, `MAX_LATENCY_MS = 864_000_000`, then `bun test`; afterwards `git checkout -- src/server.ts`. Exit code 0.

```text
-export const MAX_REASON_LENGTH = 1000;
-export const MAX_ATTEMPTS = 100;
-export const MAX_LATENCY_MS = 86_400_000;
+export const MAX_REASON_LENGTH = 2000;
+export const MAX_ATTEMPTS = 1000;
+export const MAX_LATENCY_MS = 864_000_000;
test exit=0
 407 pass
 0 fail
```

- Direction: assert the documented numbers in the tests (literal 1000, 100, 86400000, ...) or through `POST /results` over HTTP, and stop exporting the constants for the test (see finding 10).

### quality-api-2026-10-31-5 (P3): `docs/operation.md` says every route answers `405` with `Allow`, but most routes send no `Allow` header

- Location: claim `docs/operation.md:224` ("the header `Allow: GET`, like every other API route"); code `src/server.ts:564` (`/results`), `src/server.ts:605` (every read route), `src/server.ts:269` (`/heartbeat/:id`), `src/admin-routes.ts:242` (`GET /admin/checks` and the other unsupported admin methods). Commit `6e238de`.
- What happens: only `/healthz`, `/readyz`, `/metrics` (`src/server.ts:322`), `/manual-incidents` (`src/server.ts:500`), `/admin/config` (`src/admin-routes.ts:234`) and the collection/item mismatch on admin paths (`src/admin-routes.ts:249`) send `Allow`. `docs/rest-api.md:28` names only the three ops paths, so the two pages contradict each other. RFC 9110 requires `Allow` on a `405`.
- Command: `bun start` of the copy on `127.0.0.1` (`PORT=38517`, example checks, throwaway tokens), `curl -sS -i -X <method> <url>`, filtered to the status line, `Allow` and the body; then `SIGTERM` (server exit 0). Exit code 0.

```text
### -X GET http://127.0.0.1:38517/results
HTTP/1.1 405 Method Not Allowed
{"error":"method not allowed"}
### -X DELETE http://127.0.0.1:38517/checks
HTTP/1.1 405 Method Not Allowed
{"error":"method not allowed"}
### -X POST http://127.0.0.1:38517/probe/checks
HTTP/1.1 405 Method Not Allowed
{"error":"method not allowed"}
### -X POST http://127.0.0.1:38517/healthz
HTTP/1.1 405 Method Not Allowed
Allow: GET
{"error":"method not allowed"}
### -X PUT http://127.0.0.1:38517/manual-incidents
HTTP/1.1 405 Method Not Allowed
Allow: GET, POST
{"error":"method not allowed"}
```

- Direction: send `Allow` on every `405` (from the route table) or correct `docs/operation.md:224`.

## Notes

Findings that are not issue candidates (all `P3`):

### quality-api-2026-10-31-6 (P3): an error after the answer was sent is dropped without a log line

- Location: `src/server.ts:776-778` (`if (res.headersSent) { res.destroy(); return; }`); `src/admin-routes.ts:255` rethrows into it. Commit `6e238de`.
- `logError` is not called and there is no comment that explains the ignore (`AGENTS.md:63`). `docs/rest-api.md:30` says the cause of an unexpected failure is written to stderr.
- Command: a Bun script started `createApiServer` of the copy on `127.0.0.1:0` with an `admin` handler that answers `204` and then throws, sent `GET /admin/config`, and counted `logError` calls. Exit code 0. Output: `{"status":204,"logErrorCalls":0,"logged":[]}`.

### quality-api-2026-10-31-7 (P3): `docs/rest-api.md:145` says a retried submission can store several rows for one location and timestamp

- Claim: "A retried submission can store several rows for one location and timestamp, so a page can hold more rows than the number of locations (5 rows for `limit=1`)."
- Code: migration 2 creates `UNIQUE INDEX results_by_sample ON results (check_id, location, timestamp)` (`src/migrations.ts:56`) and the insert ends in `ON CONFLICT (check_id, location, timestamp) DO NOTHING` (`src/service.ts:483`). `docs/rest-api.md:68` itself says a repeat stores no row. `src/docs-claims.test.ts:18` already removed the same old sentence from `bench/README.md`.
- Command: local `bun start` as in finding 5; `POST /results` five times with the same body and token, then `GET /checks/example/results?limit=1` and without `limit`. Exit code 0. Output: `post 1: 204` ... `post 5: 204`, `GET /checks/example/results?limit=1 -> rows: 1`, `GET /checks/example/results -> rows: 1`.

### quality-api-2026-10-31-8 (P3): the code layout table of `docs/development.md` does not match the code

- `docs/development.md:22`: "`src/main.ts` | Reads the environment, wires the parts and starts the server." `src/main.ts:21-50` only passes `process.env` and the real clock, timers and writers to `startApi`; `src/start.ts:122-311` reads every setting and wires the parts. `src/start.ts` is not in the table.
- `docs/development.md:26`: "`src/db.ts` | Schema (current version only)." `src/db.ts:4`: "The schema at `user_version` 0, as the first release created it. Later changes are migrations." (`src/migrations.ts`, not in the table; `AGENTS.md:102` says the same as the code).
- `docs/development.md:24`: "`src/service.ts` | All SQL ...". `src/manual-incidents.ts:89-112` holds 12 SQL statements.
- Command: `grep -n "Schema (current version only)\|Reads the environment, wires\|All SQL, row mapping" docs/development.md; sed -n 4p src/db.ts; grep -cE "\.(prepare|query)\(|db\.run\(" src/manual-incidents.ts`. Exit code 0. Output: the three table rows (lines 22, 24, 26), `/** The schema at user_version 0, as the first release created it. Later changes are migrations. */`, `12`.

### quality-api-2026-10-31-9 (P3): `validateResult` re-implements checks of the contract validator; those branches never answer

- Location: `src/server.ts:146-148` (object shape), `150-151` (`checkId`), `154-156` (`status`), `109-110` (`statusCode` range), `113` (`reason` type); the contract call at `src/server.ts:144`. Commit `6e238de`.
- Command: a Bun script called `validateResult` of the copy with one body per rule. Exit code 0. Every answer is the contract message, none the api message:

```text
array body (server.ts:146) -> "result: must be an object"
empty checkId (server.ts:150) -> "result.checkId: must be a non-empty string"
bad status (server.ts:154) -> "result.status: must be one of \"up\", \"degraded\", \"down\""
statusCode 600 (server.ts:109) -> "result.statusCode: must be an integer 100..599"
reason number (server.ts:113) -> "result.reason: must be a string"
```

- The lcov report still marks `src/server.ts:147` as run (`DA:147,38`). The bound checks in `checkMeasurements` that the contract does not cover (`latencyMs` maximum, `reason` length, `certDaysLeft`, `attempts` maximum) are live.

### quality-api-2026-10-31-10 (P3): production code and exports that only tests use

- `src/config.ts:466-504`: `readJson`, `parseFile`, `loadConfig` and `loadChecks` read the checks file with `readFileSync`; no production file imports `loadConfig` or `loadChecks`. Production reads the file through `loadInitialConfig` (`src/config-reload.ts:63`). The two readers word the same failure differently (`src/config.ts:471` with the Node message and without `cause`, `src/config-reload.ts:70` with the code). `src/config.examples.test.ts:11` and `src/config.maintenance.test.ts:62` test the unused reader.
- Exports that no production file uses: `parseChecks` (`src/config.ts:300`), `INITIAL_STATE` (`src/state.ts:13`), `SCHEMA_VERSION` (`src/migrations.ts:64`), `validateResult` and `maxFutureSkewMs` (`src/server.ts:139`, `95`), the bound constants `src/server.ts:39-45`, `nearestRank` (`src/latency.ts:19`), `fillAllRollups` (`src/latency-rollup.ts:40`), `cleanupResults` and `retentionCutoff` (`src/retention.ts:35`, `17`). Unused by anything: the type `ConfigAction` (`src/config-write.ts:15`) and the getter `LatencyRollupRunner.done` (`src/latency-rollup.ts:26`). `AGENTS.md:72`: "Do not export a function only for a test."
- Command: the export scan of item 4 (`bun exports.ts <copy>`). Exit code 0. Excerpt:

```text
src/config.ts:300 parseChecks | other prod files: 0 | own-file uses: 1 | tests: 7 (src/degraded.test.ts, src/keyword.test.ts, src/config.bounds.test.ts)
src/config.ts:493 loadConfig | other prod files: 0 | own-file uses: 1 | tests: 2 (src/config.examples.test.ts, src/config.maintenance.test.ts)
src/config.ts:502 loadChecks | other prod files: 0 | own-file uses: 0 | tests: 1 (src/config.test.ts)
src/config-write.ts:15 ConfigAction | other prod files: 0 | own-file uses: 0 | tests: 0
src/migrations.ts:64 SCHEMA_VERSION | other prod files: 0 | own-file uses: 0 | tests: 1 (src/db.migrations.test.ts)
src/state.ts:13 INITIAL_STATE | other prod files: 0 | own-file uses: 0 | tests: 2 (src/degraded.test.ts, src/state.test.ts)
src/server.ts:139 validateResult | other prod files: 0 | own-file uses: 2 | tests: 5 (src/degraded.test.ts, src/tls.test.ts, src/server.test.ts)
```

(The one own-file use of `loadConfig` is the doc comment at `src/config.ts:497`.)

### quality-api-2026-10-31-11 (P3): a missing tokens file and a missing checks file fail with differently shaped messages

- Location: `src/config.ts:511` (tokens files: Node's full message) against `src/config-reload.ts:70` (checks file: the code only); `src/start.ts:146` then appends the setting. Commit `6e238de`.
- Command: `bun src/main.ts` in the copy with one bad setting at a time (`PORT=0 PULSE_DB=:memory:`, example files), stderr and exit code. Exit code 2 each:

```text
PULSE_TOKENS_FILE=<run>/missing.json -> exit 2: pulse-api: cannot read tokens file <run>/missing.json: ENOENT: no such file or directory, open '<run>/missing.json' (PULSE_TOKENS_FILE=<run>/missing.json)
PULSE_CHECKS_FILE=<run>/missing.json -> exit 2: pulse-api: cannot read checks file <run>/missing.json: ENOENT
```

- The tokens message names the path three times. Both match the prefix in `docs/troubleshooting.md:23` and `46`.

### quality-api-2026-10-31-12 (P3): `HttpError` and `UnknownCheckError` have no `name`

- Location: `src/server.ts:58`, `src/service.ts:107`. Every other error class sets `override name` (`grep -nE "class \w+ extends \w*Error|override name" src/*.ts`). `AGENTS.md:60`: "Throw only `Error` subclasses with a `name`."
- Command: `bun -e 'const { UnknownCheckError } = await import("<copy>/src/service.ts"); const e = new UnknownCheckError("x"); console.log(JSON.stringify({ name: e.name, isError: e instanceof Error, str: String(e) }))'`. Exit code 0. Output: `{"name":"Error","isError":true,"str":"Error: x"}`. Log lines that print `err.name` (`src/config-reload.ts:100`, `162`) would show `Error`.

### quality-api-2026-10-31-13 (P3): documented failure branches without a test

- `src/config-reload.ts:112-113` (the file cannot be read during a look: `config reload rejected: <path>: cannot read the file (<code>)`) and `122` (`stat` fails). `docs/operation.md:150` documents the unreadable case.
- `src/config-fs.ts:40-42`: an admin write keeps the file owned by the API when `fchown` fails with `EPERM`, and fails on any other error.
- `src/service.ts:68`: a JSON column that no longer parses is treated as not set.
- Command: `bun run test`. Exit code 0. Excerpt:

```text
 src/config-fs.ts           |  100.00 |   88.57 | 40-42
 src/config-reload.ts       |  100.00 |   95.51 | 112-113,122
 src/latency-rollup.ts      |   91.67 |   96.23 | 92-93
 src/service.ts             |   97.83 |   99.72 | 68
```

### Other notes

- Style-only lint infos: `bench/compare.ts:239` (`useTemplate`), `src/service.ts:671` (`noUselessSwitchCase`), and the deprecated `recommended` field in the shared `biome.json:41` of pulse-config.
- The duplicated helpers listed in item 3 (`isRecord`, error-code readers, HTTP error classes, Bearer parsing, the timer loop, `MAX_TIMER_MS`) are candidates for pulse-kit or for the contract's `isObject`.
- `src/service.ts:971-972`: `listCheckStates` calls `db.prepare` on every call (`/metrics`, `/components`), while the other queries are prepared once. Performance, not quality: outside this audit.
- The wall-clock assertions, `docs-claims.test.ts` and the coverage remarks of item 5.
- The documentation mismatches of item 8 (`troubleshooting.md:115`, `operation.md:195`, `concepts.md:107`).
