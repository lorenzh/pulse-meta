# Quality audit: pulse-api (2026-11-06)

## Scope

- Issue: lorenzh/pulse-meta#802, periodic code quality audit of `main` of pulse-api. The issue comments hold only the Factory claim; there are no decisions and no review feedback. This report replaces the audit of 2026-10-31 (#518) at this path. Every finding below was checked again on the commits listed here; nothing was copied from the old report.
- Audit date: 2026-11-06 (UTC).
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-api | `4b3e9b1dcce5f4e362c6bc1f529375181fb49f9a` | `main`, all of `src/`, `bench/`, `README.md`, `docs/`, `AGENTS.md`. Installed, linted, typechecked, tested and run in a temporary copy. |
| pulse-config | `bc870498cc8e2539a132ce2aac35a09db1deabd8` | `main`. pulse-api pins `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (2 commits behind `main`). `diff` of `eslint.config.js`, `biome.json` and `tsconfig.base.json` between the installed pin and the clone of `main`: identical. |
| pulse-contract | `ebf6bbc895e54303a71852eb7fc10e4fb7c28aa3` | pulse-api pins `c4a2eb5214d48d40d0c1afbae5e3e49463185e15` (2 commits behind `main`). The installed `src/validate*.ts` and `src/schema.ts` were read. |
| pulse-kit | `536133f3e8b708179fa01feeb02395a0e1961e07` | `src/`. pulse-api pins `c6d2cba7d90c981b884dcac2a9288dd9eccad8b5` (4 commits behind `main`); `diff -rq` of the installed `src/` against the clone shows only `failure-limiter.ts`. |
| pulse-probe | `9490141ef9e92044808c70bb8200db3d497d1060` | `src/`, for duplication. |
| pulse-status | `8b6d4315fcb989a7a8d74c063ab08d97c18a7d2d` | `src/`, for duplication. |
| pulse-notify | `c79f0b7cb5e25ada96e6314220e69cf4f5279b32` | `src/`, for duplication. |
| pulse-console | `fc2c166de8237a841b5253cef99bb3fd17f85f2f` | `src/`, for duplication. |
| pulse-meta | `3eb48a8dd8edf0cf6d820f81555538531562b307` | this repository |

- Method: `rsync` of the pulse-api clone into `mktemp -d`, then `bun install --frozen-lockfile` (Bun 1.4.0). The first two installs failed: `error: GET https://api.github.com/repos/lorenzh/pulse-kit/tarball/c6d2cba - 504` (also for pulse-config `04108fa`). Unauthenticated tarball requests answered 504, authenticated ones 200. The audit downloaded the two pinned tarballs with the runner token, checked that their sha512 equals the `bun.lock` integrity (`sha512-o1oIlJPu...` for kit, `sha512-spdP32t+...` for config, both equal), put them into Bun's cache and ran `bun install --frozen-lockfile` again: exit 0. No other package or tool was added. Then the repository's own scripts ran under `timeout 600`. Extra measurements used only what the install brings: the shared ESLint setup (through `pulse-eslint`) with the complexity threshold at 0, `tsc` with extra flags, the TypeScript compiler API of the installed `typescript` package, `grep`, `diff`, `curl`, and short Bun scripts that import the copy's modules. The scripts lived outside the copy and are described with each finding. A local `bun src/main.ts` used port 38517 and 38518 with `checks.example.json` (placeholder heartbeat secret replaced) and a throwaway probe token. Both processes were stopped with `SIGTERM`. The copy and the scripts were removed at the end.
- Results: 14 findings: 1 `P2`, 13 `P3`. 5 are issue candidates. No item is blocked.
- Earlier findings (2026-10-31) checked again: 1 (a failed apply is not retried), 2 (failed loops log at `info`), 3 (`handle` at complexity 52), 4 (bound tests import the bounds) and 5 (`405` without `Allow`) are fixed on `4b3e9b1`; the evidence is in the checklist. The others still hold, checked again: 6 is finding 2 of this report, 7 is 5, 8 is 9, 9 is 3 (now with more dead re-checks), 10 is 4 and 11, 11 is 7, 12 is 8, and 13 (untested branches) is 12 with other lines.

## Checklist

### 1. Lint and typecheck: `checked`

- `timeout 600 bun run lint` (`biome check . && pulse-eslint . && pulse-workflows`): exit 0. Biome: `Checked 190 files in 212ms. No fixes applied. Found 5 infos.` ESLint: no output. `pulse-workflows: ok (2 files, 8 uses)`.
  - `lint/style/useTemplate` at `bench/compare.ts:261:59`, `src/config-admin.test.ts:180:18`, `src/config-write.audit.test.ts:23:63`, `src/config-write.crash.test.ts:25:63`. Style only: note.
  - `lint/complexity/noUselessSwitchCase` at `src/service.ts:800:7` (`case "http":` right before `default:`). Style only: note.
  - `deserialize DEPRECATED` at `node_modules/@lorenzh/pulse-config/biome.json:41:13`: the shared config uses the `recommended` field, which the next Biome major removes. Belongs to pulse-config: note.
- `timeout 600 bun run typecheck` (`tsc --noEmit`, TypeScript 7.0.2): exit 0, no output.
- `timeout 600 bun run check`: exit 0 (lint, typecheck, `821 pass`, `0 fail`).
- `pulse-eslint --no-inline-config` (same shared config, inline directives ignored) shows what the two `eslint-disable` comments in production code hide: `sonarjs/function-return-type` at `src/server.ts:152` and `sonarjs/no-nested-conditional` at `src/service.ts:429`. Both have a reason comment. In tests the directives hide 52 `no-clear-text-protocols`, 5 `no-hardcoded-ip`, 4 `no-unused-vars` and 1 `void-use`, all on fixtures. No `biome-ignore`, `@ts-ignore` or `@ts-expect-error` in the non-test files of `src/`, `bench/` or `scripts/` (`grep -rn "eslint-disable\|biome-ignore\|@ts-expect-error\|@ts-ignore" src bench scripts --include=*.ts | grep -v "\.test\.ts"`: the two ESLint directives only).

### 2. Complexity: `checked`

The shared budget is `"sonarjs/cognitive-complexity": ["error", 15]` (`node_modules/@lorenzh/pulse-config/eslint.config.js`). To read every value, the audit ran the shared config with the threshold at 0, in the copy only (`eslint.cc.config.js`: the base config mapped to `["error", 0]`, with the repository's own ignores), then removed that file:

`./node_modules/.bin/pulse-eslint --no-inline-config --config eslint.cc.config.js -f json src bench`: exit 1, because every function above 0 is reported (932 functions, 492 outside tests). Highest values outside tests:

| Value | Function | Against 15 |
| --- | --- | --- |
| 15 | `runLoad`, `bench/load.ts:181` | at the budget |
| 15 | `tick`, `src/heartbeat.ts:35` | at the budget |
| 15 | `ingest` transaction callback, `src/service.ts:1197` | at the budget |
| 14 | `fillTemp`, `src/config-fs.ts:25` | under |
| 14 | `fillAllUptimeDays`, `src/uptime-rollup.ts:50` | under |
| 13 | `validateResult`, `src/server.ts:152` | under |
| 13 | `routeOf`, `src/server.ts:224` | under |
| 12 | `filterOf`, `src/audit-routes.ts:62`; `parseHttp`, `src/config.ts:223`; `serveManualIncidentRoutes`, `src/manual-incident-routes.ts:234`; `handle`, `src/server.ts:628`; `queryRead`, `src/server.ts:753`; `dispatch`, `src/token-routes.ts:152` | under |

No test function is above 15. No function is over the budget, and no `eslint-disable` of `cognitive-complexity` is left (`grep -rn "eslint-disable" src bench scripts --include=*.ts | grep -v "\.test\.ts"` finds only the two directives of item 1). The router `handle` that had 52 on 2026-10-31 is now 12 (earlier finding 3 is fixed).

### 3. Duplicated logic: `checked`

Read and `grep` over `src/` of api, probe, status, notify, kit, contract and console: `grep -rnE "function isRecord|function isObject|/\^bearer|/\^Bearer|timingSafeEqual\(|function (codeOf|errorCode|messageOf|errorText)\b|class HttpError|function sendError|MAX_TIMER_MS =|MAX_TIMER_DELAY_MS" --include=*.ts */src`, plus `diff` of similar blocks.

- The hourly runner is written twice: `diff <(sed -n 79,107p src/latency-rollup.ts | sed 's/latency/X/g; s/LATENCY/X/g') <(sed -n 108,137p src/uptime-rollup.ts | sed 's/uptime/X/g; s/UPTIME/X/g')` differs only by one closing line (exit 1, `0a1 > };`). Together with `src/retention.ts:88-129`, `src/heartbeat.ts:89-108` and `src/config-reload.ts:291-310`, the self-rescheduling timer with stop is written five times. pulse-kit exports `safeSetTimeout` but no periodic runner; AGENTS.md asks to propose such infrastructure to pulse-kit. Finding 14.
- The kit `BodyError` is mapped to a status and a message four times: `bodyFailure` in `src/server.ts:87-92` and `src/manual-incident-routes.ts:119-124` (equal except the error class, `diff` exit 1 on the three class names only), `readBodyJson` in `src/admin-routes.ts:128-138`, `readText` in `src/token-routes.ts:79-88`. The `aborted` code gets two texts: `request body could not be read` (server, manual incidents) and `body is not valid JSON` (admin, tokens). Four HTTP error classes with `status` and `headers` (`HttpError` `src/server.ts:66`, `RouteError` `src/admin-routes.ts:96`, `TokenRouteError` `src/token-routes.ts:60`, `ManualRouteError` `src/manual-incident-routes.ts:20`) and three `sendError` (`src/server.ts:76`, `src/admin-routes.ts:164`, `src/token-routes.ts:142`). The kit `BodyError` already carries a `status` (`node_modules/@lorenzh/pulse-kit/src/http.ts:11`). Finding 14.
- Reading `err.code` four times with four fallbacks: `codeOf` returns `undefined` (`src/config-fs.ts:20`), `"unknown"` (`src/config-write.ts:112`), `unknown` as is (`src/backup.ts:25`); `errorCode` returns `"unknown error"` (`src/config-reload.ts:64`). Also in probe (`src/attempt.ts:20`), notify (`src/channels/smtp-send.ts:95`), console (`src/server.ts:1231`, `src/database.ts:128`, `src/secret-key.ts:6`) and twice privately in kit (`src/atomic-write.ts:7`, `src/secret-file.ts:4`). Note.
- The hex SHA-256 helper `sha256Hex` exists (`src/token-digest.ts:4`), but the heartbeat secret digest is computed inline twice: `src/config-holder.ts:41` (file checks) and `src/check-write.ts:161` (database checks). Both must give the same value for a ping to match. `src/server.ts:270` has a byte digest. Note.
- The rate-limited log line (one line per key per minute with a `suppressed` count) twice: `src/admin-auth-failures.ts:58-76` and `src/admin-auth-throttle.ts:60-76`. Note.
- Bearer parsing twice with different rules: `/^bearer (\S+)$/i` (`src/tokens.ts:96`, `bearerSecret`) and `/^Bearer (.+)$/i` (`src/server.ts:286`, heartbeat pings), although `src/server.ts:43` imports `bearerSecret`. Note.
- Contract validation done twice in `validateResult`: finding 3.
- Fixed since the last audit: `isRecord` now comes from pulse-kit (`src/check-write.ts:4`, `src/config-write.ts:10`); no local copy is left. `MAX_TIMER_MS` comes from pulse-contract everywhere (`src/config.ts:11`, `src/server.ts:9`, `src/service.ts:27`).

### 4. Dead code: `checked`

- `timeout 600 bun node_modules/typescript7/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters`: exit 0, no output. No unused local or parameter.
- Export scan: a Bun script listed every `export` of `src/*.ts` (non-test) and the files that name it (word match over `src/`, `bench/`, `bench/selftest/`, `scripts/`). Exit 0, 109 exports without a production user outside their own file; most are types and constants of the module's own interface. Unused by anything: `loadInitialConfig` (`src/config-reload.ts:154`). Used only by tests: see finding 4 and the note list of finding 4.
- Reachability: a Bun script followed the relative imports from `src/main.ts`, `src/backup-main.ts`, `bench/run.ts` and the eight `bench/selftest/*.ts` of `bench:selftest`. Exit 0: `files: 70; reached: 66; unreached: 4`. The four (`bench/seed.ts`, `bench/cold-read.ts`, `bench/today-parity.ts`, `bench/uptime-parity.ts`) are command-line scripts that `bench/README.md:40-71` documents and `bench/run.ts:134` runs as a subprocess. No file is dead.
- Unreachable branches: finding 4 (the check branches of the file writer), finding 3 (the api re-checks behind the contract validator). `src/admin-routes.ts:224-225` turns any non-`ConfigWriteError` of `assertWritable` into `503 checks file not writable`, but `assertWritable` (`src/config-write.ts:589-595`) always throws `mapFsError(err)`, a `ConfigWriteError`; the fallback cannot run. Note.
- Unused getters: `LatencyRollupRunner.done` (`src/latency-rollup.ts:97-99`) has no caller (`grep -n "\.done\b" src/*.ts` finds `src/retention.test.ts:137,180,341` and `src/uptime-rollup.test.ts:301` only); coverage lists `src/latency-rollup.ts` lines 97-98. Note.

### 5. Test quality: `checked`

- `timeout 600 bun run test`: exit 0, `821 pass`, `0 fail`, `1025 expect() calls`, `Ran 821 tests across 93 files. [6.66s]`. Coverage (threshold `lines = 0.8`, `bunfig.toml`): `All files | 97.59 | 98.99`. Uncovered lines: `src/config-export.ts` 16-19 and 33-36, `src/config-fs.ts` 38-40, `src/config-reload.ts` 154-156, `src/config-write.ts` 233-235 and 250-257, `src/latency-rollup.ts` 97-98, `src/service.ts` 79, `src/token-scopes.ts` 27-29.
- The test output also prints eight stack traces `error: audit log down` from `src/server.manual-incidents.audit.test.ts:33`: the fake audit log throws on purpose and the server's default `logError` (`src/server.ts:888`, `console.error`) prints it. The tests pass; the noise hides real errors in the output. Note.
- Tests without an assertion: a Bun script found 715 `test(...)` calls and looked in each body for `assert`, `expect(`, `.throws(` or `.rejects`, or a call of a file-local helper that asserts. It flagged 2 (`src/start.token-import.test.ts:227` and `240`); both call `restartAfterImport`, which calls `assertAllWork` (`src/start.token-import.test.ts:220`). So none. No `test.skip`, `test.todo` or `test.only`.
- Tests that mirror the implementation: the bound tests now use literal numbers (`src/server.validation.test.ts:145`: `[1e9, 3000001, -3000001, Number.MAX_SAFE_INTEGER]`) and import only `createApiServer`, `maxFutureSkewMs` and `validateResult` (`src/server.validation.test.ts:13`). Earlier finding 4 is fixed. `src/docs-claims.test.ts` (12 tests) asserts the wording of `docs/` and `bench/README.md`; its comment names the behavior tests. Note.
- Risky branches without a test: finding 12 (export of TLS, TCP, DNS and domain checks; the `fchown` `EPERM` fallback; an unreadable JSON column), and the `SIGHUP` claim of finding 1 (`grep -n "reloadNow\|SIGHUP" src/*.test.ts` finds `src/config-admin.test.ts:271` "SIGHUP reloads without a poll" and the retry test `src/config-reload.test.ts:118`, none for a repeated invalid file).
- Real clock: `src/uptime.test.ts:125-127` asserts `performance.now() - started < 1000`, `src/db.wal.test.ts:52-61` asserts `elapsed < 50` ms (documented exception at `src/db.wal.test.ts:50`). AGENTS.md forbids a real clock in tests. `src/main.test.ts:80` waits 20 ms with a real `setTimeout` while it polls a child process. Note.

### 6. Error handling: `checked`

- `grep -nE -A4 "catch( \(\w+\))? \{|\.catch\(" src/*.ts` (non-test, 92 sites) and reading each block:
  - Catches that drop the caught error, each with a reason comment: `src/backup.ts:110`, `116`, `src/config-fs.ts:62`, `src/config-write.ts:390`, `498`, `src/main.ts:13`, `src/manual-incident-routes.ts:94`, `src/server.ts:228`, `308`, `591`, `622`, `src/service.ts:79`, `1476`. Fine.
  - `src/admin-routes.ts:145`: `decodeRef` returns the raw text on a malformed escape; the comment above (`141-142`) says why. Fine.
  - Log-only catches in the background loops, all now at `warn`: `src/retention.ts:103-107`, `src/latency-rollup.ts:86-90`, `src/uptime-rollup.ts:116-120`, `src/heartbeat.ts:95-98`, `src/config-reload.ts:298-299`; `src/start.ts:384`, `560`, `569` pass the level to `logger[level]`. Earlier finding 2 is fixed.
  - `src/config-reload.ts:299` logs only `err.name` (`config poll failed: <name>`), without a comment; the apply path documents why it keeps only name and code (`src/config-reload.ts:81`). Only a non-`ConfigError` from the parser reaches it. Read, not reproduced: note.
  - Not logged at all: an error after the answer was sent (finding 2).
- Ignored promise rejections: `@typescript-eslint/no-floating-promises` and `no-misused-promises` pass (item 1). `void run()` (`src/retention.ts:115`) and `() => void fn()` (`src/start.ts:382`, `558`, `567`) discard promises whose bodies catch everything. Fine.
- Earlier finding 1 is fixed: an apply failure now counts `result="error"`, logs `config reload failed: ...` and leaves `lastKey` unset so the next poll retries (`src/config-reload.ts:196-212`); test `src/config-reload.test.ts:118`.
- Different error shapes for the same failure: finding 7 (missing tokens file against missing checks file), finding 8 (`Error` subclasses without `name`), the two `aborted` texts of item 3. `404` for an unknown check: `unknown check "nope"` on `/checks/:id/results` (`src/server.ts:781`, also `POST /results` `701` and `/maintenance?checkId=` `759`), `unknown check` on `/checks/:id/latency` and `/location-uptime` (`src/server.ts:766`, `772`), seen with `curl` on the local run. Documented (`docs/rest-api.md:162`, `199`, `205`): note.

### 7. Consistency: `checked`

Against pulse-api `AGENTS.md` and the layout of probe, status, notify and console:

- "Never swallow an error silently" (`AGENTS.md:63`): finding 2.
- "Throw only `Error` subclasses with a `name`" (`AGENTS.md:60`): finding 8.
- "Do not export a function only for a test" (`AGENTS.md:72`): finding 4.
- "SQL queries stay in `src/service.ts`" (`AGENTS.md:102`): `grep -cE "\.(prepare|query)\(|db\.run\(|\.exec\(\"" src/*.ts` (non-test) counts SQL in nine more modules: `manual-incidents.ts` 26, `db.ts` 17, `token-store.ts` 13, `audit-log.ts` 8, `check-store.ts` 5, `backup.ts` 4, `maintenance-store.ts` 3, `token-import.ts` 3, `audit-routes.ts` 1 (`service.ts` 57). The stores are one module per job, so the rule, not the code, looks out of date. Finding 9 covers the docs table.
- "Keep logic pure; I/O in `main.ts` and the server or client modules": `src/config.ts:508` and `548` call `readFileSync` (test-only checks reader, tokens files), `src/server.ts:888` defaults `logError` to `console.error`. Note.
- "Use `as` only right after a check": `(err as Error).message` without a check at `src/config.ts:510` and `550`. `src/config.ts:510` also throws without `cause`. Only test-only code reaches `510` (finding 4). Note.
- Booleans start with `is`, `has`, `can`: `grep -nE "(let|const) [a-z]\w* = (true|false)\b"` (non-test) finds only `stopped` at `src/heartbeat.ts:90`; the four other loops use `isStopped`. Style only: note.
- Explicit return types on exported functions: a Bun script with the installed TypeScript compiler API checked every exported function declaration and exported arrow function in `src/` (non-test): `exported functions: 107; without explicit return type: 0`. No deviation.
- `any`, non-null `!`, imports: `grep` found no `any` type, no non-null `!` in production code, no default export, no relative import without `.ts`, no built-in without `node:`.
- Configuration handling: probe and status read their environment in one `src/settings.ts`. pulse-api reads it in `src/start.ts:292-299`, with readers in `src/retention.ts:9`, `src/location-silence.ts` and `src/start.ts:109`. The messages and exit codes are correct (item 8). Note.
- Pins: contract, kit and config pins are on `main` of their repositories (`gh api repos/lorenzh/<repo>/compare/<pin>...main`: `status=ahead` for all three, 2, 4 and 2 commits). probe, status, notify and console each pin other kit and contract commits. Fine.

### 8. Docs against code: `checked`

Read `README.md` and every page of `docs/`, then checked the claims with the code, the local server and the scratch scripts. Contradictions: findings 1, 3, 5, 6, 9 and 10. Further mismatch, a note:

- `docs/rest-api.md:73` names `latencyMs` and `reason` length among "the api checks"; the contract answers both first (finding 3).

Claims checked and correct (local run, exit codes from `bun src/main.ts` with one bad setting at a time): `PULSE_RETENTION_DAYS=30` exit 2 `PULSE_RETENTION_DAYS: must be an integer >= 90`; empty `PULSE_RETENTION_DAYS` starts; `PULSE_LOCATION_SILENT_MS=0` exit 2; `PULSE_CHECKS_RELOAD_INTERVAL_MS=500` and `3600001` exit 2 with the documented rule; `PULSE_LOG_LEVEL=loud` exit 2; `PORT=70000` exit 2; an unopenable `PULSE_DB` exit 2 `cannot open database <path> (PULSE_DB): unable to open database file`. `405` with `Allow` on `GET /results` (`Allow: POST`), `DELETE /checks`, `POST /probe/checks`, `POST /healthz`, `POST /checks/example/results` (`Allow: GET`), `PUT /manual-incidents` and `DELETE /heartbeat/example` (`Allow: GET, POST`): earlier finding 5 is fixed and `docs/operation.md:336` is now true. `limit` capped at 1000; `limit=0` and `limit=abc` answer `400 limit must be a positive integer`; `POST /results` idempotent (five posts, one row); `SIGTERM` logs `shutting down` and `stopped`; `config reload rejected` at `warn` with the documented counter; the complexity claim of `docs/development.md:51` (no function over 15).

## Issue candidates

Ranked by how much a fix is worth.

### quality-api-2026-11-06-1 (P2): `SIGHUP` does not log an unchanged invalid checks file again, although the docs say it does

- Location: `src/config-reload.ts:174-185` (`warnOnce` drops a line equal to the last one; `reject` counts the metric only for a new line), `src/config-reload.ts:257-259` (`reloadNow` forces the load but not the log); claim `docs/operation.md:228`. Commit `4b3e9b1`.
- Claim: "The same bad file is not logged again at every look; fix it or send `SIGHUP` to log it again."
- What happens: after a look has logged `config reload rejected: ...`, `lastWarning` holds that line. Only a successful apply resets it (`src/config-reload.ts:192`). A `SIGHUP` runs `reloadNow`, which parses the file again, gets the same message, and `warnOnce` drops it; the `invalid` counter does not move either. An operator who follows the docs to see why a file is not in use gets no line. The state is still visible in `GET /admin/config` (`file.state`). No test covers the claim (item 5).
- Command (end to end): `bun src/main.ts` of the copy with `PORT=38518`, `PULSE_CHECKS_RELOAD_INTERVAL_MS=1000`, a valid checks file; then `sed` replaced its `"url": "https://` values with `ftp://` (the parser reports the first, `checks[1].url`), wait 2.5 s, `kill -HUP` twice with 1 s between, count `config reload rejected` lines on stderr, read `/metrics`, `SIGTERM`. Exit code 0.

```text
after poll: 1 rejected line(s)
after SIGHUP 1: 1 rejected line(s)
after SIGHUP 2: 1 rejected line(s)
pulse_api_config_reload_total{result="ok"} 0
pulse_api_config_reload_total{result="invalid"} 1
pulse_api_config_reload_total{result="error"} 0
process alive
```

- Command (module, independently re-run in audit-review): from the installed temporary copy, run the following. Exit code 0. Output: `{"logsAfterPoll":1,"logsAfterFirstSighup":1,"logsAfterSecondSighup":1,"metrics":["invalid"],"fileState":"invalid"}`.

```sh
bun -e 'import assert from "node:assert/strict";
import { createConfigReloader, readInitialConfig } from "./src/config-reload.ts";
let bytes = Buffer.from(JSON.stringify({ checks: [{ id: "example", name: "Example", url: "https://example.invalid/", intervalMs: 10000 }] }));
let version = 0;
const fs = { stat: () => ({ mtimeMs: version, size: bytes.length, ino: 1 }), readFile: () => bytes };
const read = readInitialConfig(fs, "checks.json");
if (!read.ok) throw read.error;
const logs = [], metrics = [];
const reload = createConfigReloader({ path: "checks.json", fs, now: () => 1000, onApply() {}, log: line => logs.push(line), metrics: { recordConfigReload: result => metrics.push(result) } }, read.initial);
bytes = Buffer.from(bytes.toString().replace("https://", "ftp://"));
version++;
reload.poll(); const logsAfterPoll = logs.length;
reload.reloadNow(); const logsAfterFirstSighup = logs.length;
reload.reloadNow(); const logsAfterSecondSighup = logs.length;
const result = { logsAfterPoll, logsAfterFirstSighup, logsAfterSecondSighup, metrics, fileState: reload.fileStatus().state };
assert.deepEqual(result, { logsAfterPoll: 1, logsAfterFirstSighup: 1, logsAfterSecondSighup: 1, metrics: ["invalid"], fileState: "invalid" });
console.log(JSON.stringify(result));'
```

- Direction: let a forced load (`reloadNow`) clear `lastWarning` before it loads, so `SIGHUP` logs and counts the result again, and add a test; or change `docs/operation.md:228`.

### quality-api-2026-11-06-2 (P3): an error after the answer was sent is dropped without a log line

- Location: `src/server.ts:897-901` (`if (res.headersSent) { res.destroy(); return; }`); `src/admin-routes.ts:319`, `415` and `src/token-routes.ts:131` rethrow into it. Commit `4b3e9b1`.
- What happens: `logError` is not called and no comment explains the ignore (`AGENTS.md:63`: "Never swallow an error silently. A deliberate ignore has a one-line comment that says why."). `docs/rest-api.md:45` says the cause of an unexpected failure is written to stderr, and `docs/operation.md:307` documents `request failed` (error). A failure while an export streams (`/admin/audit/export`) leaves only a cut connection.
- Command: a Bun script started `createApiServer` of the copy on `127.0.0.1:0` with an in-memory database and an `admin` handler that answers `204` and then throws, sent `GET /admin/config`, waited 50 ms and counted `logError` calls. Exit code 0. Output: `{"status":204,"logErrorCalls":0,"logged":[]}`.
- Direction: call `logError("request failed", err)` before `res.destroy()`.

### quality-api-2026-11-06-3 (P3): `validateResult` re-implements contract checks; those branches never answer, and the troubleshooting page lists a message the API never sends

- Location: api re-checks behind `validatePostResultRequest` (`src/server.ts:165`): object shape `src/server.ts:167-169`, `checkId` `171-172`, `status` `175-177`, timestamp type `105-106`, `statusCode` range `113-114`, `latencyMs` range `115-116`, `reason` type and length `117-119`, `location` type `134`. Claims: `docs/troubleshooting.md:87` lists `reason must be at most 1000 characters` among "the api bound checks below run after it"; `docs/rest-api.md:73` says the api checks `latencyMs` and `reason` length. Commit `4b3e9b1`.
- What happens: the pinned contract now checks the `reason` length (`MAX_REASON_LENGTH`, `node_modules/@lorenzh/pulse-contract/src/schema.ts:92`) and the `latencyMs` maximum before the api code runs, so a probe operator who searches for the documented message does not find it. The live api checks are the timestamp window, `attempts` maximum, `certDaysLeft` and `location` length.
- Command: a Bun script called `validateResult` of the copy with one body per api rule. Exit code 0. Excerpt:

```text
array body (server.ts:167) -> "result: must be an object"
empty checkId (server.ts:171) -> "result.checkId: must be a non-empty string"
bad status (server.ts:175) -> "result.status: must be one of \"up\", \"degraded\", \"down\""
statusCode 600 (server.ts:113) -> "result.statusCode: must be an integer 100..599"
reason number (server.ts:117) -> "result.reason: must be a string"
reason too long (server.ts:118) -> "result.reason: must be null or a string of at most 1000 characters"
latencyMs over max (server.ts:115) -> "result.latencyMs: must be an integer 0..2147483647"
timestamp string (server.ts:105) -> "result.timestamp: must be an integer"
location number (server.ts:134) -> "result.location: must be a string"
attempts 101 (server.ts:127) -> "attempts must be an integer from 1 to 100"
```

- Over HTTP on the local run (`curl -X POST /results` with a valid probe token), exit code 0: `reason` of 1001 characters → `{"error":"result.reason: must be null or a string of at most 1000 characters"} 400`; `latencyMs` 2147483648 → `{"error":"result.latencyMs: must be an integer 0..2147483647"} 400`.
- Direction: remove the re-checks that the contract covers, keep the live bounds, and list the contract `reason` message in `docs/troubleshooting.md` instead of the api one.

### quality-api-2026-11-06-4 (P3): dead code in the file writer and in the config readers

- Location: the check branches of the file writer, `keepSecret` (`src/config-write.ts:233-237`, called at `300`) and `referenceOf` (`src/config-write.ts:250-259`, called at `314-319`); `loadInitialConfig` (`src/config-reload.ts:154-158`); the test-only readers `readJson`, `parseFile`, `loadConfig`, `loadChecks` (`src/config.ts:505-543`). Commit `4b3e9b1`.
- What happens: every `/admin/checks` write goes to the database writer (`src/admin-routes.ts:218`), and maintenance to its own writer (`220`), so `deps.writer.apply` (`227`) only ever gets component edits. No test sends a check edit to the file writer either. The heartbeat-secret keeping and the "still used by" check of the file writer therefore cannot run, but read as if they protected file checks. `loadInitialConfig` has no caller at all; production uses `readInitialConfig` (`src/start.ts:234`). `loadConfig` and `loadChecks` read the file with a different message and without `cause` (`src/config.ts:510`); only `src/config.examples.test.ts`, `src/config.maintenance.test.ts` and `src/config.test.ts` use them. `AGENTS.md:72`: "Do not export a function only for a test."
- Command: `bun run test` (coverage), `grep -rnw loadInitialConfig src bench scripts`, `grep -n "deps.writer.apply\|deps.checks.apply\|deps.maintenance.apply" src/admin-routes.ts`, `grep -ln "createConfigWriter" src/*.test.ts | xargs grep -n 'kind: "check"'`, `grep -rnwE "loadConfig|loadChecks" src --include=*.ts | grep -v "\.test\.ts"`. Exit codes 0, 0, 0, 123 (no match), 0. Excerpt:

```text
 src/config-reload.ts       |   96.30 |   97.65 | 154-156
 src/config-write.ts        |   93.88 |   97.01 | 233-235,250-257
src/config-reload.ts:154:export function loadInitialConfig(fs: ReloadFs, path: string): InitialConfig {
218:    if (kind === "check") return deps.checks.apply(checkEditOf(action, ref, body), ifMatch, actor);
220:      return deps.maintenance.apply(windowEditOf(action, ref, body), ifMatch, actor);
227:    return deps.writer.apply(editOf(kind, action, ref, body), ifMatch, actor);
src/config.ts:532:export function loadConfig(path: string): Config {
src/config.ts:541:export function loadChecks(path: string): Check[] {
```

- Further exports that only tests use (export scan of item 4): `parseChecks` (`src/config.ts:309`), `parseChecksWithSecrets` (`346`), `INITIAL_STATE` (`src/state.ts:13`), `SCHEMA_VERSION` (`src/migrations.ts:180`), `validateResult` and `maxFutureSkewMs` (`src/server.ts:152`, `99`), `nearestRank` (`src/latency.ts:19`), `insertSorted` (`src/today.ts:58`), `fillAllRollups` (`src/latency-rollup.ts:40`), `fillAllUptimeDays` (`src/uptime-rollup.ts:50`), `cleanupResults` and `retentionCutoff` (`src/retention.ts:39`, `17`), `writeAuditExport` (`src/audit-routes.ts:123`).
- Direction: narrow `FileKind` to `component` and delete the check branches, delete `loadInitialConfig`, and move the file-based tests to `parseConfigText` or `readInitialConfig`.

### quality-api-2026-11-06-5 (P3): `docs/rest-api.md:160` says a retried submission can store several rows for one location and timestamp

- Claim: "A retried submission can store several rows for one location and timestamp, so a page can hold more rows than the number of locations (5 rows for `limit=1`)."
- Code: `CREATE UNIQUE INDEX results_by_sample ON results (check_id, location, timestamp)` (`src/migrations.ts:57`) and `ON CONFLICT (check_id, location, timestamp) DO NOTHING` (`src/service.ts:568`). `docs/rest-api.md:83` itself says a repeat "stores no row". `src/docs-claims.test.ts` ("bench README: the api no longer stores a repeated result twice") already removed the same sentence from `bench/README.md`. Commit `4b3e9b1`.
- Command: local run (port 38517); `curl -X POST /results` five times with the same body and token, then `GET /checks/example/results?limit=1` and without `limit`. Exit code 0. Output: `post 1: 204` ... `post 5: 204`, `GET /checks/example/results?limit=1 -> rows: 1`, `GET /checks/example/results -> rows: 1`.
- Direction: delete the sentence (keep the one about a group of results with the same timestamp, one per location).

## Notes

Findings that are not issue candidates (all `P3`):

### quality-api-2026-11-06-6 (P3): the `listening` line has five fields that `docs/operation.md:302` does not list

- Claim: `docs/operation.md:302` lists `port`, `checks`, `maintenanceWindows`, `databaseMaintenanceWindows`, `checksFile`, `db`, `fileState`, `databaseChecks`, `retentionDays`, `probeTokens`, `locations`, `adminTokens`, `tokensFile`, `tokenStore`.
- Code: `src/start.ts:532-550` also writes `components`, `manualIncidents`, `locationSilentMs`, `reloadIntervalMs` and `configWrites`. `docs/development.md:99` asks that every key in the code appears in the docs.
- Command: local run (port 38517), first line of stdout. Exit code 0. Excerpt: `"msg":"listening","port":38517,"checks":7,...,"components":2,...,"manualIncidents":"off","locationSilentMs":"auto","reloadIntervalMs":5000,"configWrites":"off","fileState":"ok","databaseChecks":0`.

### quality-api-2026-11-06-7 (P3): a missing tokens file and a missing checks file fail with differently shaped messages

- Location: `src/config.ts:550` (tokens files: Node's full message, then `src/start.ts:130` appends the setting) against `src/config-reload.ts:132` (checks file: the code only). Commit `4b3e9b1`.
- Command: `bun src/main.ts` in the copy with `PORT=0 PULSE_DB=:memory:` and one missing file at a time. Exit code 2 each:

```text
PULSE_TOKENS_FILE -> exit 2: pulse-api: cannot read tokens file <run>/missing.json: ENOENT: no such file or directory, open '<run>/missing.json' (PULSE_TOKENS_FILE=<run>/missing.json)
PULSE_CHECKS_FILE -> exit 2: pulse-api: cannot read checks file <run>/missing.json: ENOENT
```

- The tokens message names the path three times. Both match the documented prefix.

### quality-api-2026-11-06-8 (P3): `HttpError` and `UnknownCheckError` have no `name`

- Location: `src/server.ts:66`, `src/service.ts:118`. `grep -nE "class \w+ extends \w*Error" src/*.ts` (non-test) finds 21 classes, `grep -nE "override name"` 19. `AGENTS.md:60`: "Throw only `Error` subclasses with a `name`."
- Command: `bun -e 'const { UnknownCheckError } = await import("<copy>/src/service.ts"); const e = new UnknownCheckError("x"); console.log(JSON.stringify({ name: e.name, isError: e instanceof Error, str: String(e) }))'`. Exit code 0. Output: `{"name":"Error","isError":true,"str":"Error: x"}`.

### quality-api-2026-11-06-9 (P3): the code layout table of `docs/development.md` does not match the code

- `docs/development.md:22`: "`src/main.ts` | Reads the environment, wires the parts and starts the server." `src/main.ts:21-50` passes `process.env`, the clock, timers and writers to `startApi`; `src/start.ts:285-550` reads the settings and wires the parts. `src/start.ts` is not in the table.
- `docs/development.md:24`: "`src/service.ts` | All SQL, ...". Nine more modules hold SQL (item 7).
- `docs/development.md:26`: "`src/db.ts` | Schema (current version only)." `src/db.ts:4`: "The schema at `user_version` 0, as the first release created it. Later changes are migrations."
- The table names 10 of the 48 production modules (`ls src/*.ts | grep -v "\.test\.ts" | wc -l`: 48).
- Command: `grep -n "Schema (current version only)\|Reads the environment, wires\|All SQL" docs/development.md; sed -n 4p src/db.ts`. Exit code 0. Output: the three rows at lines 22, 24 and 26, then `/** The schema at `user_version` 0, as the first release created it. Later changes are migrations. */`.

### quality-api-2026-11-06-10 (P3): `retention: deleted <n> results` also counts rollup rows

- Claim: `docs/operation.md:303`: "A cleanup deleted rows (results and resolved manual incidents)."
- Code: `src/retention.ts:53-58` adds the deleted latency, uptime and location uptime rollup rows to the same total, which `src/retention.ts:102` logs as results.
- Command: `bun -e` with `cleanupResults` of the copy, a service that deletes no result and fakes that delete 0 manual incidents and 7, 5 and 3 rollup rows. Exit code 0. Output: `0 results, 0 manual incidents, 15 rollup rows -> logged as: retention: deleted 15 results`.

### quality-api-2026-11-06-11 (P3): exports that only tests use

See the list in finding 4. `AGENTS.md:72` asks not to export a function only for a test. Command and output: the export scan of item 4 (`bun exports.ts <copy>`, exit 0), for example `src/state.ts:13 INITIAL_STATE | other prod files: 0 | own-file uses: 0 | tests: 2 (src/degraded.test.ts, src/state.test.ts)` and `src/migrations.ts:180 SCHEMA_VERSION | other prod files: 0 | own-file uses: 0 | tests: 1 (src/db.migrations.test.ts)`.

### quality-api-2026-11-06-12 (P3): branches without a test

- `src/config-export.ts:16-20`: the export of `tls`, `tcp`, `dns` and `domain` checks returns the whole check; `grep -n '"tls"\|"tcp"\|"dns"\|"domain"' src/config-export.test.ts` finds nothing (exit 1). A new secret field on one of these types would be exported without a failing test.
- `src/config-fs.ts:38-43`: an admin write keeps the file owned by the API when `fchown` fails with `EPERM`, and fails on any other error.
- `src/service.ts:79`: a stored JSON column that no longer parses is treated as not set.
- `src/token-scopes.ts:27-29` and `src/config-export.ts:34-36` are `never` defaults (cannot run by design).
- Command: `bun run test`. Exit code 0. Excerpt:

```text
 src/config-export.ts          |  100.00 |   81.40 | 16-19,33-36
 src/config-fs.ts              |  100.00 |   92.59 | 38-40
 src/service.ts                |   97.66 |   99.79 | 79
 src/token-scopes.ts           |  100.00 |   89.66 | 27-29
```

### quality-api-2026-11-06-13 (P3): wall-clock assertions in tests

- `src/uptime.test.ts:125-127` (`performance.now() - started < 1000`, no exception documented) and `src/db.wal.test.ts:52-61` (`elapsed < 50` ms, exception documented at `50`). AGENTS.md: "No real clock and no real timers". Both can fail on a slow runner.
- Command: `grep -nE "performance\.now\(\)|elapsed <" src/*.test.ts`. Exit code 0. Output: `src/db.wal.test.ts:52`, `src/db.wal.test.ts:55`, `src/uptime.test.ts:125`, `src/uptime.test.ts:127`.

### quality-api-2026-11-06-14 (P3): duplicated scheduling code and HTTP error plumbing

- The hourly runner of `src/latency-rollup.ts:79-107` and `src/uptime-rollup.ts:108-137` is the same code after renaming; the self-rescheduling timer exists five times (item 3).
- The kit `BodyError` is mapped four times with two texts for `aborted`; four HTTP error classes and three `sendError` (item 3).
- Command: `diff <(sed -n 79,107p src/latency-rollup.ts | sed 's/latency/X/g; s/LATENCY/X/g') <(sed -n 108,137p src/uptime-rollup.ts | sed 's/uptime/X/g; s/UPTIME/X/g')`. Exit code 1. Output: `0a1` / `>   };` (only the closing line of the preceding function differs). `diff <(sed -n 87,92p src/server.ts) <(sed -n 119,124p src/manual-incident-routes.ts)`: exit 1, the three lines differ only in `HttpError` / `ManualRouteError`.
- Direction: one runner in pulse-kit (AGENTS.md asks to propose infrastructure there) and one body-error mapping.

### Other notes

- Style-only lint infos (item 1): four `useTemplate`, one `noUselessSwitchCase` (`src/service.ts:800`), and the deprecated `recommended` field in the shared `biome.json:41` of pulse-config.
- The duplicated helpers of item 3 (`err.code` readers, inline SHA-256 of heartbeat secrets, the rate-limited log line, two Bearer patterns) are candidates for pulse-kit or for the existing `sha256Hex` and `bearerSecret`.
- The unreachable `503` fallback at `src/admin-routes.ts:224-225` and the unused `LatencyRollupRunner.done` (item 4).
- `config poll failed` logs only the error name (`src/config-reload.ts:299`, item 6).
- The test output prints eight expected `audit log down` stack traces (item 5).
- AGENTS.md's "SQL queries stay in `src/service.ts`" no longer describes the store modules (item 7).
- Install: unauthenticated GitHub tarball downloads of the kit and config pins answered 504 on this runner; the install needed the cached, integrity-checked tarballs (Scope). Runner issue, not a repository defect.

## Audit review (2026-11-06)

Started at 15:50:11 UTC in a fresh session on meta report commit `f6b4bedd2fa094d6cc0a301de25e24546782770d`. Its parent is the recorded meta audit base `3eb48a8`; every target clone HEAD matches the scope table. The installed dependency pins are distinct from the main clone SHAs and were checked as recorded. The three shared configuration files are identical between the installed config pin and the config clone.

Both report files agree on the 14 finding IDs and severities, five issue candidates and all eight checklist statuses. Every finding has the required fields. No gate remains. All findings and severities are retained: one P2 and 13 P3. The sole P2 was independently reproduced at module level (the exact command is now in finding 1) and against a local `bun src/main.ts` process. The rejection log count stayed at 1 after a poll and each of two SIGHUPs; the invalid counter stayed at 1, the ok/error counters at 0, and the process remained alive. SIGTERM then exited 0.

The review used an `rsync -a` copy in `mktemp -d`. Commands below ran in that copy unless they validate the meta report. `<scratch>` denotes the temporary directory; its scripts import only installed dependencies or the copy's modules. The JSON `review.checks` records the outputs in more detail.

| Re-run | Exit | Evidence |
| --- | --- | --- |
| `jq empty audits/quality/api.json`; `bun <scratch>/validate-report.mjs` | 0 each | Required fields, IDs, severities, candidate membership, checklist statuses and examined SHAs match. |
| `BUN_INSTALL_CACHE_DIR=<scratch>/cache bun install --frozen-lockfile` | 0 | Bun 1.4.0; 121 packages installed; no added dependency or tool. |
| `timeout 600 bun run check` | 0 | Lint: 5 Biome infos, no ESLint findings, workflow policy passes. Typecheck: no diagnostics. Tests: 821 pass, 0 fail, 1025 expect calls across 93 files; 97.59% function and 98.99% line coverage. |
| `timeout 600 bun node_modules/typescript7/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters` | 0 | No diagnostics. |
| `timeout 60 bun <scratch>/reproduce.mjs` | 0 | Reproduces finding 1 at module and process level, plus the cited behavior of findings 2, 3, 5, 6, 8 and 10. |
| `timeout 30 bun <scratch>/missing-files.mjs` | 0 (both children 2) | Finding 7: tokens include the full ENOENT message and setting; checks include ENOENT only. |
| `timeout 600 bun <scratch>/complexity.mjs` | 0 | Installed ESLint API, same shared config at threshold 0, inline directives ignored: 932 functions with positive complexity, 492 outside tests, maximum 15. Top values and locations match. Lint diagnostics imply exit 1 at threshold 0. The two other production diagnostics match item 1. |
| Both `diff` commands of finding 14 | 1 each | Runner difference is one closing line; body-error mappings differ only in three error-class names. |
| Writer-test `grep` pipeline of finding 4 | 123 | No check edit in file-writer tests. Admin dispatch, source and coverage support the dead branches. |
| Export-type `grep` of finding 12 | 1 | No match. Coverage independently matches the cited uncovered lines. |

Every P3 finding was spot-checked with local probes, grep/diff, source reading or the coverage output; this review does not repeat every broad scan of the original audit. The layout claims, test-only exports and wall-clock assertions also match their cited source. No finding was removed or regraded. Finding 12's JSON primary command now names `bun run test` (exit 0); the separate grep exits 1 as already stated in its excerpt. Finding 1 now provides the exact standalone module command run in review.

All services started by the review were stopped; the copy, cache, fixtures and scratch scripts were removed. No target repository was edited. Review result: complete; verdict: ship.
