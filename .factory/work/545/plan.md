# Spec #545: api quality audit follow-up (reload retry, background failure level, router complexity, literal bounds, `Allow` on every 405)

## Goal
Fix the five findings of the pulse-api quality audit (`audits/quality/api.md`, #518, report PR #522). The owner decided that all five become work:

1. A checks file whose apply fails once (for example a SQLite error in `upsertChecks`) is never retried, is logged with only `err.name` and is counted as `invalid`.
2. Failed retention and rollup runs log at `info`, so `PULSE_LOG_LEVEL=warn` hides them.
3. The router `handle` in `src/server.ts` has cognitive complexity 52, and an inline disable comment hides it.
4. The `POST /results` bound tests import the bounds they check, so if a limit is raised, every test still passes.
5. Several routes answer `405` without an `Allow` header, but `docs/operation.md` says every route sends one.

All findings were confirmed on pulse-api `main` at `c00a375` (see `.factory/work/545/issue-review.md`). The audit looked at `6e238de`. The only reference that moved is `docs/operation.md:224`, which is now `:235`.

## Scope
Only `pulse-api`: `src/config-reload.ts`, `src/metrics.ts`, `src/start.ts`, `src/retention.ts`, `src/latency-rollup.ts`, `src/uptime-rollup.ts`, `src/server.ts`, `src/admin-routes.ts`, their tests, and the docs `docs/operation.md`, `docs/rest-api.md` and `docs/troubleshooting.md`.

## Non-goals
- No change to contract, probe, status, notify, console, deploy, config or kit.
- No new route. No change to any status code, error body, check order (405 against auth against validation) or the `route` label of the request metric. The only wire change is the added `Allow` header on `405` answers.
- Read failures of the checks file (`cannot read the file (<code>)`) and content rejections (invalid JSON or schema) keep today's behavior: they are counted as `invalid`, logged once per stamp, and not retried until the stamp changes or `SIGHUP` arrives.
- `SIGHUP` (`reloadNow`) and admin writes (`adopt`) keep their behavior.
- The `config poll failed` and heartbeat lines are not changed.
- No `HEAD` support is added. `HEAD` keeps answering `405`.

## Decisions on the open points of the issue review
1. **What the reload remembers.** The stamp (`lastKey`) is recorded after a successful apply, after an unchanged revision (same bytes, nothing to apply), after a content rejection and after a read failure. These are today's cases. A failed apply leaves the stamp unrecorded, so the next `poll()` loads and applies the same bytes again. A failed apply also leaves `revision` unchanged, as it does today. Implementation rule: a failed apply sets `lastKey = undefined`. `currentKey()` never returns `undefined` (a `stat` error gives `error:<code>`), so the next poll always retries. This also covers a forced `SIGHUP` reload that fails when the stamp has not changed.
2. **Repeated apply failures.** Every failed attempt logs one `warn` line and counts once. A lasting failure therefore gives one line per poll (default 5 s). This is accepted, because heartbeat and config poll failures behave the same way.
3. **Metric value.** A failed apply counts `pulse_api_config_reload_total{result="error"}`. `CONFIG_RELOAD_RESULTS` becomes `["ok", "invalid", "error"]`, so the `error` series starts at `0` like the other two. `invalid` keeps meaning an invalid or unreadable file.
4. **Apply-failure line.** At `warn`: `config reload failed: <path>: cannot apply the configuration: <message>`. `<message>` is `err.message` when `err instanceof Error`, otherwise `unknown error`. Every run of `\r` and `\n` in it is replaced by one space, and it is cut to at most 200 UTF-16 code units. The message comes only from the thrown error, never from the bytes or the parsed values of the file. bun:sqlite messages name constraints and columns, not bound values.
5. **Level per line.** In the retention, latency rollup and uptime rollup runners, only the `... failed: <message>` line moves to `warn`. The success and progress lines stay `info`. These are `retention: deleted N results`, `... rollup: backfill started/done ...` and `... rollup: stored N days ...`. Mechanism: the `log` dependency of the three runners gets a second parameter, `log(message: string, level: "info" | "warn")`. Every call passes the level, and `start.ts` wires `(line, level) => logger[level](line)`. Existing runner tests pass `(m) => logs.push(m)`, which still type-checks, so they stay unchanged and green.
6. **Complexity check.** This is a lint result, not a `bun test` case (see Acceptance evidence).
7. **Bound constants.** The test uses literals. `MAX_FUTURE_SKEW_MS`, `MAX_RESULT_AGE_MS`, `MAX_REASON_LENGTH`, `MAX_ATTEMPTS`, `MAX_LATENCY_MS` and `MAX_CERT_DAYS` lose their `export`. Only `src/server.validation.test.ts` imports them today (`grep -rln MAX_ATTEMPTS src bench scripts` lists only `server.ts` and that test), and `AGENTS.md` says "Do not export a function only for a test". `maxFutureSkewMs` and `validateResult` stay exported.
8. **`Allow` values** (no `HEAD` anywhere):
   - `/results`: `POST`.
   - `/checks`, `/probe/checks`, `/uptime`, `/latency`, `/components`, `/components/uptime`, `/incidents`, `/locations`, `/maintenance`, `/checks/:id/results`, `/checks/:id/latency`: `GET`.
   - `/heartbeat/:id` and `/heartbeat/:id/:secret`: `GET, POST`.
   - `/admin/{checks,components,maintenance}` (list path), unsupported method: `POST`. `/admin/{checks,components,maintenance}/:id` (item path), unsupported method: `PUT, DELETE`. These match the existing create/item mismatch branch (`admin-routes.ts:249-251`). The defensive branch in `editOf` (`admin-routes.ts:269`) is only reachable on the list path, so it also sends `Allow: POST`.
   - `/healthz`, `/readyz`, `/metrics`, `/manual-incidents*` and `/admin/config` keep the values they send today.
   - The order stays: `/results` and `/probe/checks` answer 405 before auth, the heartbeat 405 comes before the id and secret check, and admin answers 405 after auth.
9. **Concurrent work.** pulse-api PR #68 (meta #526) also edits `docs/operation.md` and `docs/rest-api.md`. If both change the same lines, a person resolves the conflict with the `merge` workflow. The two changes don't depend on each other.

## Required behavior
1. **Reload.** A failed `onApply` logs the line from decision 4 at `warn`, counts `result="error"` (not `invalid`), keeps the running configuration and revision, and leaves the stamp unrecorded. The next `poll()` reads and applies the same file. If that apply succeeds, it counts `ok`, changes `revision()` and records the stamp. After that, an idle poll does a `stat` only. An invalid or unreadable file still logs one `config reload rejected` line and counts `invalid` once per stamp.
2. **Background failures.** `retention failed: <message>`, `latency rollup failed: <message>` and `uptime rollup failed: <message>` log at `warn`. All other lines of these runners stay at `info`.
3. **Router.** `handle` in `src/server.ts` is split into functions that each have a cognitive complexity of 15 or less. One possible split: a function per route family (POST `/results`, `/probe/checks`, the plain GET reads, `/incidents`, `/maintenance`, `/checks/:id/results`, `/checks/:id/latency`) plus a small dispatcher. The `eslint-disable-next-line sonarjs/cognitive-complexity` comment at `server.ts:526` is removed. No `sonarjs/cognitive-complexity` disable may remain anywhere in `src/`. Every route keeps its status codes, bodies, check order and metric label.
4. **Bound tests.** `src/server.validation.test.ts` uses the literal values from `docs/rest-api.md:43-50`: future skew `60000`, age `604800000` (7 days), reason `1000`, attempts `100`, latencyMs `86400000`, certDaysLeft `3000000` (and `-3000000`). For each bound there is a test at the limit (accepted, `204`) and one past it (`400`). Raising any of these constants in `server.ts` makes a test fail.
5. **`Allow`.** Every `405` answer carries the `Allow` value from decision 8, with the body `{"error":"method not allowed"}`.
6. **Docs.**
   - `docs/operation.md:161`: name the apply failure (the `config reload failed` line, `result="error"`, retried at the next look).
   - `:208`: `retention failed` becomes `(warn)`.
   - `:58` and `:67`: say the rollup failure lines are `warn`.
   - `:235`: the `Allow` sentence holds for every route.
   - `docs/rest-api.md:28`: every `405` carries `Allow` with the allowed methods.
   - `docs/troubleshooting.md:113`: list the methods per path family (heartbeat `GET`/`POST`, admin as in decision 8), or point to the `Allow` header.

## Risks
- **Router refactor.** Splitting `handle` can change the check order (for example auth against 405 on `/probe/checks`). The existing route tests in `src/server*.test.ts`, `src/config-admin.test.ts` and `src/admin-auth-failures.test.ts` are the safety net and stay unchanged. The new `Allow` test also pins the 405-before-auth order on `/results` and `/probe/checks`.
- **Log noise.** A lasting apply failure logs every poll (accepted, decision 2).
- **Docs merge conflict** with pulse-api PR #68 (decision 9).
- **Dashboards.** No repository refers to `pulse_api_config_reload_total`. The new `error` series is additive.

## Performance impact
`bench/budgets.json` exists in pulse-api `main` (`api` keys). Expected effect:
- `startup_cpu_ms`, `idle_rss_mib`, `peak_rss_mib`, `load_cpu_s`: none expected beyond noise. The router split adds at most one function call per request, and the metrics registry gets one more series (`result="error"`).
- `p95_get_checks_ms`, `p95_post_results_ms`, `p95_get_latency_ms`, `p95_get_check_latency_ms`, `rps` (reported only): unchanged within noise. The handlers do the same work.
- `test_cpu_s` (gating, budget 4.1 s): it can rise slightly from the added tests: one reload unit file, three runner level tests, one start-level warn test, one HTTP test of about 25 wrong-method requests on one server, and the literal-bound tests. These should add well under 0.2 s. Each test must use the fake clock and an in-memory or `mkdtemp` database, with no real timers.
- `build_cpu_s`, `image_mb`, `startup_wall_ms`, cold metrics: none expected. There is no new dependency or file in the image.
- Measure: `bun bench/run.ts --a c00a375 --b <branch head>` locally (see `bench/README.md`). All gating metrics must be within `bench/budgets.json`.

## Security impact
Security impact: yes. The change touches admin routes (`Allow` on admin 405) and a log text that carries an external error message (reload apply failure).

Checklist items that apply:
- **Secrets in errors, logs and responses.** The `config reload failed` line must hold no value from the checks file: no header value, body, URL or heartbeat secret. The message comes only from `err.message`, has newlines removed and is capped at 200 code units (decision 4). The heartbeat 405 must not echo the path or the secret.
- **Auth order and status codes.** Admin still answers `401`/`403` before `405`. The heartbeat 405 still comes before the id and secret check, so it reveals nothing about which ids exist. `/results` and `/probe/checks` keep 405 before auth (today's order). The `Allow` value depends only on the path shape, never on whether an id exists or on the token.
- **Input validation.** The `POST /results` bounds keep their values (decision 7). The tests now pin them as literals.

## Rollout order
One repository: only pulse-api changes. No contract, kit or config pin moves. Status, probe, notify and console call routes whose status codes and bodies don't change. An extra `Allow` response header on a `405` is ignored by existing clients.

## Counterexamples
- **Reload retry.** `onApply` throws `new Error("SQLITE_BUSY: database is locked")` on the first call and succeeds on the second. The stamp stays the same between polls.
  - Correct: poll 1 logs one `warn` line `config reload failed: <path>: cannot apply the configuration: SQLITE_BUSY: database is locked`, `error`=1, `invalid`=0, `revision()` unchanged. Poll 2 applies, `ok`=1, `revision()` = `revisionOf(new bytes)`.
  - Wrong (today): poll 2 does nothing, so `revision()` stays old, and the counter shows `invalid`=1.
- **Over-eager retry.** An invalid file (`url: "file:///x"`) polled three times with the same stamp logs exactly one `config reload rejected` line and counts `invalid`=1. An implementation that records the stamp only after success logs three lines.
- **Unreadable file.** `readFile` throws `EACCES` with the same stamp across two polls. Exactly one `rejected` line, `invalid`=1, and `readFile` is called once.
- **Secret in the message.** The file holds a header value `SENTINEL-HEADER-VALUE` and a heartbeat secret, and `onApply` throws `new Error("CHECK constraint failed: checks\nline2")`. The log line contains neither the header value nor the secret, and holds no `\n`. A thrown non-`Error` (`throw "x"`) gives `unknown error`. A 1000-character message gives at most 200 characters after `apply the configuration: `.
- **Level.** A retention run whose delete throws `new Error("disk full")` must reach the sink with level `warn`. A run that deleted 5 rows must log `retention: deleted 5 results` at `info`. With `PULSE_LOG_LEVEL=warn`, `retention failed: disk full` is printed and `retention: deleted ...` is not. A wrong implementation that moves the whole runner to `warn` fails the `info` assertion.
- **Bounds.**
  - `reason` with 1000 code units is accepted, 1001 gives `400`.
  - `attempts` 100 is accepted, 101 gives `400`.
  - `latencyMs` 86400000 is accepted, 86400001 gives `400`.
  - `timestamp` = now + 60000 is accepted, now + 60001 gives `400` (a check with `intervalMs` ≥ 60000, or a heartbeat id).
  - `timestamp` = now − 604800000 is accepted, now − 604800001 gives `400`.
  - `certDaysLeft` 3000000 and −3000000 are accepted, 3000001 and −3000001 give `400`.
  - If `MAX_REASON_LENGTH` is raised to 2000, the 1001 case must fail.
- **`Allow`.**
  - `GET /results` gives 405 with `Allow: POST`, also without a token (405 before 401).
  - `POST /probe/checks` without a token gives 405 with `Allow: GET` (not 401).
  - `HEAD /checks` gives 405 with `Allow: GET`.
  - `DELETE /heartbeat/x` gives 405 with `Allow: GET, POST` for an unknown id as well as a known one.
  - `GET /admin/checks` with a valid admin token gives 405 with `Allow: POST`. `PATCH /admin/checks/a` with a valid token gives 405 with `Allow: PUT, DELETE`. Without a token the answer is still `401`, not 405.
  - `POST /checks/x/results` for an unknown id gives 405, not 404 (today's order).
  - No `Allow` value contains `HEAD`.
- **Complexity.** Splitting `handle` but leaving one helper at complexity 16 must fail `bun run lint`. So must leaving the disable comment on a function that no longer needs it, because `reportUnusedDisableDirectives: "error"` is set in the pinned `eslint.config.js:13`.

There is no statistic in this change.

## Contract fields
No new field, key or route in the contract or config. The new names are internal to pulse-api:
- Metric label value `result="error"` on the existing `pulse_api_config_reload_total`. `grep -rn 'config_reload_total\|result="error"' .repos/contract/src .repos/config` gives no hit. The value already exists on `pulse_api_config_writes_total` in pulse-api (`src/metrics.ts:9`), with the same meaning.
- Log line `config reload failed:`. `grep -rn 'config reload' .repos/contract/src .repos/config .repos/deploy .repos/website` gives no hit.
- Response header `Allow` on 405. This is a standard HTTP header and is already sent by pulse-api (`src/server.ts:322`, `:500`; `src/admin-routes.ts:234`, `:250`). `grep -rn 'Allow' .repos/contract/src` gives no hit.

## Repository: api
Files:
- `src/config-reload.ts`
- `src/config-reload.test.ts` (new)
- `src/metrics.ts`
- `src/start.ts`
- `src/start.test.ts`
- `src/retention.ts`
- `src/retention.test.ts`
- `src/latency-rollup.ts`
- `src/latency.test.ts`
- `src/uptime-rollup.ts`
- `src/uptime-rollup.test.ts`
- `src/server.ts`
- `src/server.validation.test.ts`
- `src/server.allow.test.ts` (new)
- `src/admin-routes.ts`
- `docs/operation.md`
- `docs/rest-api.md`
- `docs/troubleshooting.md`

Behavior change: yes. Reload retries a failed apply and counts a new metric value, three log lines change level, and every 405 gains an `Allow` header.

### Tool facts (verified)
- Lint is `biome check . && pulse-eslint .` (`package.json:16`). `pulse-eslint` is the pulse-config bin, pinned at `dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (`package.json:24`). It passes its arguments through to ESLint (`bin/pulse-eslint.js:19`, `:26`) and uses the local `eslint.config.js`, which spreads the pulse-config base (`eslint.config.js:1-4`).
- The pinned `eslint.config.js` sets `reportUnusedDisableDirectives: "error"` at `:13` and `"sonarjs/cognitive-complexity": ["error", 15]` at `:16`. The pinned `eslint.config.js`, `biome.json`, `bin/pulse-eslint.js` and `.github/workflows/check.yml` were read with `gh api ...?ref=dc69a126...` and are identical to the config clone (`main`).
- `bun run check` = lint, typecheck, test (`package.json:20`). `bun test` (`package.json:15`) enforces 80 % line coverage (`bunfig.toml:2-3`).
- CI: `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@dc69a126...` (`ci.yml:17-18`). It runs `bun run lint` (`check.yml:27-28`), `bun run typecheck` (`:29-30`) and `bun run test` (`:37-38`). `bench-selftest` (`ci.yml:20`) and `compose-e2e` (`ci.yml:66`) are separate jobs.

### Tasks
1. **`src/config-reload.ts`**
   - Restructure `load`/`apply` so the stamp is recorded as in decision 1, and a failed `onApply` sets `lastKey = undefined`.
   - On a failed apply, log the decision 4 line through `deps.log` (already wired to `logger.warn`) and call `recordConfigReload("error")`.
   - Add a small helper for the safe message (Error check, newline collapse, 200-unit cap).
   - Keep the `reject` path (`invalid`, `config reload rejected: ...`) for parse and read failures.
2. **`src/metrics.ts`:** `CONFIG_RELOAD_RESULTS = ["ok", "invalid", "error"]`.
3. **Runners**
   - `src/retention.ts`, `src/latency-rollup.ts`, `src/uptime-rollup.ts`: `log: (message: string, level: "info" | "warn") => void`. The failure line passes `"warn"`, every other line passes `"info"`.
   - `src/start.ts:206`, `:323` and `:332` wire `log: (line, level) => logger[level](line)`.
4. **`src/server.ts`**
   - Split `handle` as in required behavior 3 and remove the disable comment at `:526`.
   - Each 405 throws `HttpError(405, "method not allowed", { Allow: ... })` with the decision 8 value: `/results` at `:564`, the read routes at `:605`, the heartbeat at `:269`.
   - Remove `export` from the six `MAX_*` bound constants (`:39-45`). Keep `DEFAULT_LIMIT`, `MAX_LIMIT` and the incident limits as they are.
5. **`src/admin-routes.ts`:** the 405 at `:242` sends `Allow: match[2] === undefined ? "POST" : "PUT, DELETE"`. The 405 in `editOf` (`:269`) sends `Allow: "POST"`. Auth stays before both.
6. **Docs** as in required behavior 6.

### Tests (each must fail on `c00a375` and pass after the change)
- **`src/config-reload.test.ts` (new)**
  - Fixture: `createConfigReloader` with a hand-written fake `fs` (fixed stamp, bytes of a valid changed file) and a fake `onApply` that throws once.
  - Poll 1: assert exactly one log line matching `^config reload failed: <path>: cannot apply the configuration: SQLITE_BUSY: database is locked$`. Assert `recordConfigReload` was called with `"error"` and never with `"invalid"`, and `revision()` is still the initial value.
  - Poll 2, same stamp: assert `onApply` ran a second time, `recordConfigReload("ok")` was called, and `revision()` equals `revisionOf(bytes)`. The expected revision comes from the hash of the fixture bytes, which is independent of the reloader state.
  - Poll 3: assert `readFile` was not called again.
  - Also cover the counterexamples:
    - an invalid file over three polls gives one `rejected` line;
    - a read failure over two polls gives one line and one read;
    - the line holds no header or secret sentinel and no newline;
    - a non-`Error` throw gives `unknown error`;
    - a 1000-character message is cut to 200.
- **Runner tests.** In `src/retention.test.ts`, `src/latency.test.ts` and `src/uptime-rollup.test.ts`, add one test each with a sink that records `(message, level)`. A failing run gives `[<name> failed: boom, "warn"]`, and a success or progress line gives `"info"`.
- **`src/start.test.ts`.** One test starts the API with `PULSE_LOG_LEVEL=warn` and a captured `write`. It makes the retention delete fail, for example by creating a SQLite trigger through the `openDb` dependency: `CREATE TRIGGER ... BEFORE DELETE ON results BEGIN SELECT RAISE(FAIL, 'boom'); END`, with an expired row inserted. Assert that a line with level `warn` containing `retention failed: boom` is written.
- **`src/server.validation.test.ts`.** Replace the imported bounds with the literals from required behavior 4 and the at/past pairs from Counterexamples. Remove the `MAX_*` imports. Leave the other tests in the file unchanged.
- **`src/server.allow.test.ts` (new).** One HTTP server on `127.0.0.1:0`, with probe tokens and admin tokens configured as in the existing admin tests. For each row of decision 8 and each `Allow` counterexample, assert:
  - status `405`;
  - body `{"error":"method not allowed"}`;
  - the exact `Allow` value, written as a literal in the test;
  - `401` without an admin token on the admin rows.
- All other existing tests stay unedited and green.

### Checks
- `bun run check` passes. This is lint (Biome and ESLint with `sonarjs/cognitive-complexity` at 15), typecheck and tests with coverage.
- `grep -rn "sonarjs/cognitive-complexity" src` prints nothing. Expected value: empty output, written here.
- `bunx pulse-eslint --no-inline-config src/server.ts src/admin-routes.ts 2>&1 | grep -c "sonarjs/cognitive-complexity"` prints `0`. On `c00a375` it prints `1` (`handle`). The other inline disables in these files (`server.ts:138`, `admin-routes.ts:101`) are a different rule and are not counted.
- CI jobs `check`, `docker`, `bench-selftest` and `compose-e2e` are green.
- `bun bench/run.ts --a c00a375 --b HEAD`: all gating metrics within `bench/budgets.json`.

### Completion evidence
A PR in pulse-api with `Closes lorenzh/pulse-meta#<child>`. It contains:
- the new tests above; the PR text names, for each finding, the test that fails on `c00a375`;
- the green CI run;
- the empty `grep` output and the `0` from the `--no-inline-config` count;
- a bench A/B summary within budgets.

## Acceptance evidence
1. **Reload retry.** `src/config-reload.test.ts` fails on `c00a375`, because poll 2 doesn't apply and the counter is `invalid`, and passes after the change. Expected values are literals (`"error"`, line text) and the hash of the fixture bytes.
2. **Warn level.** The runner tests and the `start.test.ts` warn test fail on `c00a375`: today the level is `undefined`, and at `PULSE_LOG_LEVEL=warn` no `retention failed` line is printed. They pass after the change.
3. **Complexity.** `grep -rn "sonarjs/cognitive-complexity" src` gives empty output, `bun run lint` passes, and the `--no-inline-config` count is `0` (it is `1` on `c00a375`).
4. **Literal bounds.** `src/server.validation.test.ts` contains `1000`, `100`, `86400000`, `60000`, `604800000` and `3000000` as literals and no `MAX_*` import. Raising `MAX_REASON_LENGTH` to `2000` in a scratch edit makes the suite fail.
5. **`Allow`.** `src/server.allow.test.ts` fails on `c00a375` (no header on `/results`, read routes, heartbeat, admin) and passes after. The expected header values are literals in the test.
6. Existing route tests are unedited and green. CI `check`, `docker`, `bench-selftest` and `compose-e2e` are green. Bench gating metrics are within `bench/budgets.json`.
