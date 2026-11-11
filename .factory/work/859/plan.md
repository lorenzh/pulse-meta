# Spec #859: api, align the reload docs and remove unused config paths

## Goal

Two quality-audit findings for pulse-api, both in `src/config-reload.ts` and its neighbors:

- **quality-api-2026-11-06-1 (P2):** `docs/operation.md:228` says "fix it or send `SIGHUP` to log it again". The code does not do that. `poll()` and `reloadNow()` (SIGHUP) share one `lastWarning` (`src/config-reload.ts:172-185`), and `reloadNow()` does not clear it (`src/config-reload.ts:257-259`). The code is right and the doc is wrong, so the fix is the doc.
- **quality-api-2026-11-06-4 (P3):** `loadInitialConfig` (`src/config-reload.ts:153-158`), `loadConfig` and `loadChecks` (`src/config.ts:532-543`) have no production caller. The check-edit branches of the file writer (`src/config-write.ts`) are unreachable, because `src/admin-routes.ts:227-236` sends check writes to `deps.checks` (the database writer) and maintenance writes to `deps.maintenance` before it calls `deps.writer.apply`. Remove the dead paths. Move the file-read tests to the production entry point `readInitialConfig`.

Only `pulse-api` changes. It changes no behavior, metric, setting, endpoint, wire type, dependency or tooling.

## Inputs and decisions

- Issue review: `.factory/work/859/issue-review.md` (BASE `515031b`, no open product question). This spec follows it: the canonical replacement text, the nine-file scope, the document inventory, the 1000 ms / port 0 / fresh-token SIGHUP procedure and the scope gate.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/859` answered `HTTP 404` (no findings yet). No child exists yet. This spec has one repository section, so no question is shared between sections.
- Earlier comments on #859 record prior decisions: change the docs, not the code; keep `src/admin-routes.ts` out of scope; use literal backticks in structural searches; for the real-process check use valid fresh tokens, a 1000 ms interval, readiness checks and delivery controls. All are binding here.
- Recorded BASE: api `main` = `515031bd3fd2aa6b8993e325b24ab08f4a3510d6` (2026-11-07). Every line citation below refers to it. The implementer records its own BASE before the first edit. If that BASE differs, it repeats the baseline controls (A0) before it relies on these numbers.

## Scope

- R1: replace the paragraph `docs/operation.md:228` with the exact line in R1.
- R2: keep reload behavior, its log lines and its metrics byte-for-byte as they are.
- R3: remove `loadInitialConfig`, `loadConfig`, `loadChecks` and their private helpers `readJson` and `parseFile`.
- R4: narrow the file writer to components. Remove its check-edit branches.
- R5: move the loader tests to `readInitialConfig` with real files, with fixed expected values.
- R6: add characterization tests for warning deduplication across poll and forced reload.
- R7: documentation inventory. One document changes; eight stay byte-identical.

## Non-goals

- No change to `lastWarning` handling, `reloadNow()`, `poll()`, `startConfigPolling`, `adopt()` or the metric names and labels.
- No change to `src/admin-routes.ts`. Its `editOf(kind: FileKind, ...)` still compiles after the narrowing, because the two early returns at lines 227-230 narrow `kind` to `"component"`. A trial on BASE confirmed this (see "Evidence").
- No change to database check writes (`src/check-write.ts`, `src/check-store.ts`), maintenance writes, token loading (`loadTokens`, `loadAdminTokens`, `readTokensJson`), `parseConfig`, `parseChecks`, `parseConfigText`, `parseNamed`, `parseJsonText`, `checkView` or `configView`.
- No fix for the existing wording at `docs/troubleshooting.md:163`, which calls maintenance-window writes file writes (see R7). It does not touch the warning semantics. It needs its own issue.
- No new export only for tests. No test adapter that rebuilds a throwing loader.

## Required behavior

### R1. `docs/operation.md` line 228

Replace line 228, and only line 228, with exactly this one line (one paragraph, no line breaks, backticks literal):

```text
An invalid or unreadable file is not applied. The API keeps the running configuration, logs a `warn` line, `config reload rejected: <path>: <message>` (the message never quotes a value), and counts `pulse_api_config_reload_total{result="invalid"}`. Polling and `SIGHUP` share one memory of the last warning line: a rejection whose line equals it is not logged or counted again, even when the file's bytes change. A rejection with another message is logged and counted. A successful apply clears the memory, so the same rejection is logged and counted again after it. `SIGHUP` reads and validates the file at once but does not clear the memory. An unreadable file is read again at every look, so fixing its permissions applies it without a `SIGHUP`. Database check writes still work while the file is broken.
```

Code sources for each sentence: the rejection and its metric (`src/config-reload.ts:179-185`); one shared `lastWarning` for both entry points (`:172-177`, `:229-259`); the line contains only `path` and the safe message, so new bytes with the same message give the same line (`:181`); an apply clears it (`:187-193`, also used by `adopt()` at `:275`); a forced reload does not reset it (`:257-259`); an unreadable file is read at every poll (`:253-254`). This keeps the meaning of the canonical text in the issue review. The words differ in three places, and each makes it more exact: "line" instead of "message" for the memory, because the stored value is the full line; "logs a" instead of "logs one", because the line can repeat after an apply; "at once". The implementer copies the block above, with the file tools, into a pattern file outside the repository (for example `/tmp/r1-859.txt`). Check S6 reads that file. Its expected value comes from this spec, not from the file under test.

### R2. Unchanged behavior (constraint)

The order of the reload steps, the log texts `config reload rejected: …` and `config reload failed: …`, the counter `pulse_api_config_reload_total{result="ok"|"invalid"|"error"}` and the admin `file` status stay exactly as on BASE. Keep startup through `readInitialConfig` (`src/start.ts:240-264`, including the snapshot fallback and exit 2). Keep the SIGHUP wiring (`src/start.ts:433`, `src/main.ts:39-44`). The real-process table in A5 proves this. It must give the same values on BASE and on the branch.

### R3. Remove the unused loaders

- `src/config-reload.ts`: delete `loadInitialConfig` and its doc comment (lines 153-158). Keep `readInitialConfig`, `InitialConfig`, `RejectedInitial` and every other export.
- `src/config.ts`: delete `readJson` (505-513), `parseFile` with its comment (527-530), `loadConfig` (532-534) and `loadChecks` (541-543). Change the comment at line 536 ("like `loadConfig`") so it no longer names the removed function, for example ``/** Parse the text of the checks file `path`; throws ConfigError. */``. Keep the `readFileSync` import, because `readTokensJson` (545-560) still uses it. Keep every other import that lint and typecheck still need. On a trial, `Check` was still in use and lint passed.
- Delete the three loader tests and drop the imports they alone used: `config.test.ts` "config: loadChecks reads files and reports errors" (64-83), `config.maintenance.test.ts` "config: loadConfig reads a file" (62-69), `config.examples.test.ts` "checks.example.json is refused while its heartbeat secret is the placeholder" (9-17). Their cases move to R5. Every other test in these three files stays byte-identical.

### R4. File writer for components only (`src/config-write.ts`)

- Line 24: `export type FileKind = "component";`, and update the comments at 23 and 26 (checks and windows are written to the database; `ref` is a component id).
- Delete `keepSecret` (232-237) and `referenceOf` (250-259). Change `LIST_KEY` (240) to `{ component: "components" }` and the return type of `listKey` (242) to `"components"`.
- `replaceEntry`: line 300 becomes `list[at] = given;`.
- `deleteEntry`: delete the `kind === "check"` block (314-319). The incident guard (320-325) stays. Its `kind === "component" &&` part is now always true and may go.
- `entityOf` (345-361): delete `case "check"`. Do not keep a `switch` with only one case: the shared ESLint config enables `sonarjs.configs.recommended` (pinned `eslint.config.js:10,15`), and a trial on BASE failed `bun run lint` with `sonarjs/no-small-switch` at that `switch`. Return the component entity directly after the `delete` guard.
- `targetIdOf` comment (363): "the component id unchanged".
- Keep `ConfigKind` (used by `src/admin-routes.ts` for route classification), `checkView`, `configView`, `validated`, revision checks, the lock, pending audit, `writeTemp`, `fsyncDir`, rename, `adopt` and the failure handling (`src/config-write.ts:378-600`) unchanged.

### R5. Reader tests through the production entry point

New file `src/config-reload.initial.test.ts`. It uses `readInitialConfig(nodeConfigFs, path)` (`src/config-reload.ts:119-151`, `src/config-fs.ts:79-93`) on files in its own `mkdtemp` directory, removed in `onTestFinished`. It has one comment line at the top, naming the class and the expected outcome, and no other comments. The expected values are literals. They are never computed by the parser under test:

1. File `{checks:[{id:"a",name:"A",url:"http://localhost:1/",intervalMs:1000}], maintenance:[{checkId:"a",start:"2030-01-01T02:00:00Z",end:"2030-01-01T04:00:00+01:00",note:"Upgrade"}]}`: `ok === true`; `config.checks` deep-equals `[{ id:"a", name:"A", url:"http://localhost:1/", intervalMs:1000, retries:0, retryDelayMs:1000 }]`; the maintenance `[checkId,start,end]` equals `[["a",1893463200000,1893466800000]]`; `components` is `[]`; `revision` matches `/^sha256-[0-9a-f]{64}$/`.
2. Files with text `{` and `{"checks":[{"headers":{"X":HSEC},"body":BSEC}]}`: `ok === false`, `state === "invalid"`, `message === "checks file is not valid JSON"`, `error instanceof ConfigError`, the error message is the template literal ``` `checks file ${path} is not valid JSON` ```. Neither text contains `HSEC` or `BSEC`.
3. Missing file: `state === "unreadable"`, `message === "cannot read the file (ENOENT)"`, `error instanceof ConfigError`, the error message is the template literal ``` `cannot read checks file ${path}: ENOENT` ```, `stampKey === undefined`. This is the production text with the safe code. The removed loader quoted the OS message; production is not changed to match it.
4. `checks.example.json` (`new URL("../checks.example.json", import.meta.url)`): `state === "invalid"`, `message === "checks[6].secret still has the example placeholder secret"`, and `error.message` does not contain `replace-with-a-random-secret`.

Keep the other example and token tests in `config.examples.test.ts` (parsing after the secret is replaced, `tokens.example.json`, `admin-tokens.example.json`) unchanged.

### R6. Characterization of warning deduplication (`src/config-reload.test.ts`)

Add tests to the existing suite. They use a fake fs whose bytes and stamp the test can change, a fake `log`, a fake `metrics.recordConfigReload`, a counting `onApply` and `now: () => 0`. They use the existing `PATH = "/etc/pulse/checks.json"`, `VALID` and `INITIAL`. Expected lines are literals:

- `REJECT_URL = "config reload rejected: /etc/pulse/checks.json: checks[0].url: must be an http: or https: URL"` (file with url `file:///x`)
- `REJECT_INTERVAL = "config reload rejected: /etc/pulse/checks.json: checks[0].intervalMs must be an integer from 1 to 2147483647 (milliseconds)"` (file with `intervalMs: 0`)

Cases:

a. Invalid file (`file:///x`), then `poll()`, `reloadNow()`, `reloadNow()`: lines `[REJECT_URL]`, results `["invalid"]`, `revision() === INITIAL`, 0 applies. Then new bytes (`file:///y`) and a new stamp, `poll()`, `reloadNow()`: still `[REJECT_URL]` and `["invalid"]`.
b. From `REJECT_URL`, `reloadNow()` on the `intervalMs: 0` file gives `[REJECT_URL, REJECT_INTERVAL]` and `["invalid","invalid"]`. `reloadNow()` on `VALID` adds `"ok"`. `reloadNow()` on the `file:///x` file again gives `[REJECT_URL, REJECT_INTERVAL, REJECT_URL]`, `["invalid","invalid","ok","invalid"]`, and 1 apply.
c. Read error `EACCES`: `poll()`, then `reloadNow()`, then `reloadNow()`: one line `config reload rejected: /etc/pulse/checks.json: cannot read the file (EACCES)` and results `["invalid"]`. No line contains the error message text.

These tests describe behavior that exists on BASE. They pass on BASE (a trial ran a and b three times on BASE source: 12 pass, 0 fail). Do not call them regression tests, and do not change code to make one fail. The checks that fail on BASE are the structural checks S1-S7.

### R7. Documentation inventory

Search, run in the API root (README and every docs file; Factory's file search skips the clones):

```sh
git grep -n -i -E 'reload|sighup|loadinitialconfig|loadconfig|loadchecks|writer|atomic|checks.*(file|database)|components.*file|log(ged)? it again|reload_total' -- README.md docs
```

Every document it finds, with its disposition. The line numbers are BASE:

| Document | Disposition | Proof line(s) at BASE |
| --- | --- | --- |
| `docs/operation.md` | **changed**, line 228 only (R1) | 228 holds the wrong promise "send `SIGHUP` to log it again". Lines 7 (reload or SIGHUP), 219 (SIGHUP "always reads, hashes and applies the file"; true for a valid file, and the new line does not contradict it), 226, 230, 232, 234 ("a lasting failure logs the warn line only once"), 215, 249 and 263 (database check writes, component file writes) stay and agree with the new text. Line 128 (SIGHUP during a backup) is unrelated. |
| `README.md` | **unchanged and still true** | 58: the file is applied "every `PULSE_CHECKS_RELOAD_INTERVAL_MS` … and on `SIGHUP`". 11: "admin check writes are stored in the database … Components stay in the file". It promises no repeated warning. No README change is needed: behavior, settings, endpoints and types do not change; this corrects wrong prose and removes unused internal code. |
| `docs/concepts.md` | **unchanged and still true** | 46: file windows change "with every applied file, also at a reload". 124: two maintenance sources. |
| `docs/configuration.md` | **unchanged and still true** | 3: the checks file "is also reloaded while the API runs". 14: interval `0` or 1000-3600000. 44, 94, 200, 216, 231: validation at start and at reload. |
| `docs/install.md` | **unchanged and still true** | 47: mount the directory, because a single-file bind mount "does not see an atomic replace". |
| `docs/troubleshooting.md` | **unchanged and still true for this change** | 147: "wait for the API reload (5 s by default) or send `SIGHUP`" (applying a valid file, still true). 50: startup text `cannot read checks file <path>: ...`, made by `readInitialConfig` (`src/config-reload.ts:132`), which stays. 139: a changed secret works after apply. 163: "Fix the file, or send `SIGHUP`" before a retry: still true for `written-not-applied`, and it makes no promise about warnings. The existing inaccuracy at 163 (it calls maintenance-window writes file writes, against `docs/operation.md:215` and `docs/rest-api.md:473`) is out of scope and stays byte-identical. |
| `docs/rest-api.md` | **unchanged and still true** | 421: "A check write stores a database check …; a component write rewrites the checks file". 437, 441: same parsers and transactions. 473: database windows work with a broken file. Hits at 542, 569, 589 ("reload the …") concern clients, not the file reload. |
| `docs/development.md` | **unchanged and still true** | 27: `src/config.ts` is "Parsing of the checks file, the maintenance windows, the components and the tokens file" (still true; no loader named). |
| `docs/index.md` | **unchanged and still true** | No hit. It is listed so the inventory covers every file in `docs/` (lines 5-11 are only links). |

No document names `loadInitialConfig`, `loadConfig`, `loadChecks`, `keepSecret` or `referenceOf` (S1 covers `README.md` and `docs`). After the change, the implementer runs the search again, reads every hit against the new line 228 and lists any contradiction. The expected answer is none. The eight unchanged documents are protected paths in the gate (byte-identical to BASE).

## Risks

- **A doc that overpromises again.** Each sentence of R1 is tied to a code line above, and A5 checks it against the real process.
- **Dead-code removal that removes live code.** `checkView` and `configView` are live (`src/check-write.ts:14,264`, `src/config-write.ts` `view()`), and so is `ConfigKind` (`src/admin-routes.ts:25,74,163,169,179,219,471`). S8-S10 assert that they and the production parsers still exist.
- **Admin routes or callers that need the check branch.** The typecheck trial on BASE gave exactly three errors after narrowing `FileKind`, all in `src/config-write.ts` (300, 314, 348). After R4 and the test moves, `bun run check` passed (trial: 903 pass). `src/admin-routes.ts` stays protected.
- **Lost test coverage of file reads, secrets in errors, and the example placeholder.** R5 keeps each removed case through the production reader. Coverage stays above the 80 % threshold (trial: 97.97 % lines, against 97.82 % on BASE).
- **Lint.** A `switch` with one case fails `sonarjs/no-small-switch` (seen in the trial). R4 says what to do instead.
- **Noisy shared machine.** Performance numbers are information only (see "Performance impact").

## Performance impact

Metrics of `bench/budgets.json` (api): only `test_cpu_s` (budget 9.2 s, floor 1.6 s, gating) can move. The change removes three tests and adds about six small unit tests that use no server and no database. The expected change is under ±0.2 s, inside the noise. Startup CPU, load CPU, idle and peak RSS, cold and end-of-day reads, p95 latencies, rps and image size: none expected. Removing unused functions changes no code that runs, and no module is added to the startup import graph (`src/start.ts` stays unchanged).

Method: interleaved runs, `/usr/bin/time -f "%U %S" bun run test` in a BASE checkout and a branch checkout with the same `bun install --frozen-lockfile`: base, branch, base, branch, base, branch (at least three pairs). Report user+system per run, the medians and the delta, as information only. Do not run `bun bench/run.ts` or any Docker bench: the host port collides (#834). Trial sample from planning (BASE `515031b` against a trial implementation): base 7.98 / 7.71 / 7.92 s, trial 7.96 / 7.73 / 8.20 s, median delta +0.04 s.

## Security impact

Security impact: yes
The change edits the checks-file writer (file writes) and the tests that guard error texts built from file contents.

Checklist items that apply:
- **Secrets in errors, logs and responses:** R5 case 2 (no `HSEC`/`BSEC`), case 4 (no placeholder value), R6 case c (no error message text in a log line). The existing writer and admin tests for redaction and keep markers stay (`src/config-write.audit.test.ts`, `src/config-admin.test.ts` protected).
- **Atomic, path-safe writes:** the component write protocol (exclusive temp, data and directory fsync, rename, adopt, pending audit, `fault` points) is unchanged. `src/config-fs.ts` and the crash and audit suites are protected. The control suite C1 must still pass.
- **Input validation:** component bodies still run `validated()` before storage. A check body can no longer reach the file writer, by type (`FileKind = "component"`). At run time `src/admin-routes.ts:227-230` already sent checks to the database writer, which validates with the same parsers.
- **Auth order and status codes:** not changed (`src/admin-routes.ts` protected). Body and size limits, SSRF, accessor execution, dependency pins: not touched (`package.json`, `bun.lock` protected).

The security state should try hostile inputs: a component write whose body looks like a heartbeat check; a check `PUT`/`DELETE` on a file-only id (must still answer `409` from the database writer and never rewrite the file); a malformed checks file with secret-like tokens at startup and at SIGHUP.

## Rollout order

One repository: only `pulse-api` changes. No contract, kit or config pin moves. No wire shape, route, setting or metric changes, so probes, status, notify, console and deploy on any pin keep working against the new API.

## Counterexamples

- **Deduplication across poll and SIGHUP.** Invalid file, then poll, SIGHUP, SIGHUP. Correct: 1 log line, `invalid` = 1. Wrong (what the old doc promised, or an implementation that clears `lastWarning` in `reloadNow()`): 2 or 3 lines and counts. R6a and A5 steps 3-5 reject it.
- **Same message, new bytes.** `file:///x` replaced by `file:///y` gives the same line `…checks[0].url: must be an http: or https: URL`. Correct: no new line or count. Wrong (dedupe by revision or stamp): one more. R6a rejects it.
- **Different message.** `REJECT_URL` then `REJECT_INTERVAL`: correct is 2 lines and 2 counts. Wrong (dedupe by state `invalid`): 1. R6b rejects it.
- **After a valid apply.** `REJECT_URL`, valid, `REJECT_URL`: correct is the second `REJECT_URL` logged and counted. Wrong (a set of warnings seen in the process lifetime): not logged. R6b and A5 step 6 (the `ok` count rises) reject it.
- **Unreadable plus forced reload.** EACCES, then poll, SIGHUP, SIGHUP: 1 line, 1 count, read at every attempt. R6c.
- **Writer narrowing.** `{ kind: "check", … }` passed to `ConfigWriter.apply` must not compile (S7 plus typecheck). A component delete named by an open manual incident must still answer `conflict` (existing tests in the protected suites).
- **Missing file at start.** A wrong test expects the removed loader's OS text (`no such file or directory`). Correct: `cannot read the file (ENOENT)` and `cannot read checks file <path>: ENOENT` (R5 case 3).
- **Counted** means one call of `recordConfigReload(result)`, so one increment of the cumulative counter `pulse_api_config_reload_total{result}` since the process started. A5 reads it from `/metrics`. A series that is missing reads as 0. There are no percentiles or windows in this change.

## Contract fields

No new names. The change adds no field, key, route, metric or setting. It narrows the internal type `FileKind`, removes three exports and adds one test file. `grep -rn -E 'FileKind|loadInitialConfig|loadConfig|loadChecks' .repos/contract/src .repos/config/src` finds 0 lines. `src/config-reload.initial.test.ts` does not exist at BASE.

## Repository: api

Files:
- `docs/operation.md` (line 228 only)
- `src/config-reload.ts`
- `src/config.ts`
- `src/config-write.ts`
- `src/config.test.ts`
- `src/config.maintenance.test.ts`
- `src/config.examples.test.ts`
- `src/config-reload.test.ts`
- `src/config-reload.initial.test.ts` (new)

Behavior change: no
The change corrects one doc paragraph, removes code with no production caller, and moves or adds tests. Runtime behavior, logs and metrics stay the same (A5 gives the same table on BASE and on the branch).

### Tool facts (verified at BASE, with file and line)

- Bun 1.4.0: `package.json:8-10` (`engines.bun`), `:35` (`packageManager: bun@1.4.0`). CI uses `oven-sh/setup-bun` with `bun-version: 1.4.0` in the pinned `check.yml:22-24`.
- Scripts: `package.json:15` `test` = `bun test`; `:14` `typecheck` = `bun node_modules/typescript7/bin/tsc --noEmit` (TypeScript `typescript7` = `npm:typescript@7.0.2`, `:27`); `:16` `lint` = `biome check . && pulse-eslint . && pulse-workflows`; `:20` `check` = `bun run lint && bun run typecheck && bun run test`.
- Biome `2.6.3` (`package.json:23`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned at `package.json:24` to `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. The pinned `biome.json` includes `**` except dist, node_modules, bun.lock, `*.html` and `test/fixtures` (`:10-17`), has `lineWidth` 100 (`:23`), and errors on `noNonNullAssertion` and `noExplicitAny`, with non-null allowed in tests (`:41-63`).
- ESLint: `eslint.config.js:1,4` spreads `@lorenzh/pulse-config/eslint.config.js`. Pinned `eslint.config.js:10,15` enables `sonarjs.configs.recommended`, and `:16` sets `sonarjs/cognitive-complexity` to 15.
- Coverage: `bunfig.toml:1-4`, `[test] coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`, test files ignored. A focused `bun test` therefore exits 1 on the threshold. Disable it with `--config=/dev/null` (verified on BASE: `bun test src/config.test.ts` gives 9 pass and exit 1; the same with `--config=/dev/null` exits 0).
- CI: `.github/workflows/ci.yml:17-18` `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa…`. The pinned `check.yml:25-38` runs install (`--frozen-lockfile`), `bun run lint`, `bun run typecheck` and `bun run test`. Build steps are off.
- Pinned files read with `gh api "repos/lorenzh/pulse-config/contents/<path>?ref=04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7"`. `check.yml`, `biome.json` and `eslint.config.js` are byte-identical to the config clone at `bc87049`.
- `rg` is a shell function in some agent shells and is missing from script subshells. Every structural check below uses `git grep` or `grep`.

### Implementation steps

1. Record `BASE=$(git rev-parse HEAD)` on a clean `main`. Run A0.
2. R3 and R4 source edits, then R5 and R6 tests, then R1. Use the file tools for every edit.
3. Commit with Conventional Commit subjects (for example `refactor: remove unused config loaders and file check edits`, `docs: describe reload warning deduplication`). Never use `--no-verify`.
4. Run A1-A7 on the final commit and put the evidence in the PR body.

### Acceptance

Verification scripts, pattern files and data live outside the target checkout (for example `/tmp/v859/`). Write them with the file tools. The scripts below are the reference versions.

**A0. Baseline controls on BASE: each must pass three times before any edit.** Planning ran each one three times on `515031b`. Each passed the same way every time:

- C1 focused control: `bun test --config=/dev/null src/config.test.ts src/config.maintenance.test.ts src/config.examples.test.ts src/config-reload.test.ts src/config-fs.test.ts src/config-file-state.test.ts src/config-write.audit.test.ts src/config-write.crash.test.ts src/config-admin.test.ts src/config-db.test.ts src/config-export.test.ts` gives `194 pass`, `0 fail`, `Ran 194 tests across 11 files`, exit 0.
- C2 full: `bun run check` gives exit 0, `900 pass`, `0 fail`, `All files` line coverage `97.82`.
- C3 structural (`structural.sh` below): S1 16 lines, S2 2, S3 8, S4 1, S5 1 (all exit 0); S6 0 and S7 0 (exit 1); S8 3, S9 2, S10 5 (exit 0).
- C4 real process (`sighup.sh` below): the A5 table, the same values in all three runs.
- C5 gate fixture (`fixture.sh` below): F0 pass, F1-F8 fail.

If a control does not reproduce, stop and report it; do not adjust the expected values. No known-flaky file is in C1.

**A1. Structural checks.** `structural.sh <api> /tmp/r1-859.txt`. The expected values are literals from this spec:

```bash
#!/usr/bin/env bash
# Usage: structural.sh <api checkout> <r1 pattern file>. Prints count and exit of each search.
cd "$1" || exit 2
R1="$2"
run() {
  local name="$1"; shift
  local n
  n="$("$@" | wc -l)"
  "$@" > /dev/null; local rc=$?
  echo "$name lines=$n exit=$rc"
}
run S1 git grep -n -E '\b(loadInitialConfig|loadConfig|loadChecks)\b' -- src test bench scripts README.md docs
run S2 git grep -n -E '^function (readJson|parseFile)[<(]' -- src/config.ts
run S3 git grep -n -E 'keepSecret|referenceOf|kind === "check"|case "check"|check: "checks"|Exclude<ConfigKind, "maintenance">' -- src/config-write.ts
run S4 git grep -n -F 'The same bad file is not logged again at every look; fix it or send `SIGHUP` to log it again.' -- docs/operation.md
run S5 git grep -n -i -E 'log(ged)? it again' -- README.md docs
run S6 grep -nxFf "$R1" docs/operation.md
run S7 grep -n -x -F 'export type FileKind = "component";' src/config-write.ts
run S8 git grep -n -E '^export function (checkView|configView|createConfigWriter)\(' -- src/config-write.ts
run S9 git grep -n -E '^export function (readInitialConfig|createConfigReloader)\(' -- src/config-reload.ts
run S10 git grep -n -E '^export function (parseConfig|parseConfigText|parseChecks|loadTokens|loadAdminTokens)\(' -- src/config.ts
```

| Check | BASE (3 runs) | Branch, required |
| --- | --- | --- |
| S1 removed loaders: declarations, imports, calls, titles, comments | 16, exit 0 | 0, exit 1 |
| S2 private helpers | 2, exit 0 | 0, exit 1 |
| S3 check-edit surface of the writer | 8, exit 0 | 0, exit 1 |
| S4 old sentence | 1, exit 0 | 0, exit 1 |
| S5 "log it again" anywhere in README or docs | 1, exit 0 | 0, exit 1 |
| S6 exact R1 line | 0, exit 1 | 1, exit 0, at line `228` |
| S7 narrowed `FileKind` | 0, exit 1 | 1, exit 0 |
| S8 live writer views | 3 | 3 |
| S9 production reader and reloader | 2 | 2 |
| S10 production parsers and token loaders | 5 | 5 |

Also: `git diff --numstat "$BASE" HEAD -- docs/operation.md` prints `1	1	docs/operation.md`. A trial implementation gave exactly the branch column in three runs.

**A2. Tests.**
- Branch C1 plus `src/config-reload.initial.test.ts`, with `--config=/dev/null`: 0 fail, exit 0. The pass count equals 194 − 3 (the three loader tests removed in R3) + the number of added tests. List the added tests by name in the PR. All R5 cases (1-4) and R6 cases (a-c) are present, with the literal expected values above.
- `bun run check`: exit 0, 0 fail, coverage ≥ 80 % lines (the threshold stays in `bunfig.toml`). Report the `All files` line. The trial gave 903 pass and 97.97 %.
- Run the new and changed test files once more against BASE source (copy them into a scratch BASE checkout): they pass. That proves they characterize existing behavior (R6). The failing-on-BASE evidence is S1-S7.

**A3. Comments.** The new test file has exactly one comment line, naming the class and the expected outcome. Read every added line of the diff, inline comments included, and list every added comment in the PR body. Write "none" only after that full read.

**A4. Documentation.** Run the R7 search again on the branch. On BASE it finds 84 lines in 8 files, the same in three runs: README 3, concepts 2, configuration 15, development 2, install 3, operation 28, rest-api 21, troubleshooting 10. `docs/index.md` has none. The trial branch also gave 84, because line 228 still matches. On the branch the count must be 84, with the same files and counts. Most hits concern other topics (schema, probes, routes). Read every hit about the file reload, `SIGHUP`, the reload warning or counter, or file and database writes. Those are exactly the lines in the R7 table. Confirm that none contradicts the new line 228, and list the lines read in the PR. The eight unchanged documents are byte-identical to BASE (protected list, A6).

**A5. Real process, through `bun start`.** Run `sighup.sh <api>` after A2, three times on the branch. Expected per step (literal, the same as on BASE in three planning runs):

| Step | ok / invalid / error | rejected lines | ids |
| --- | --- | --- | --- |
| 1 ready (`listening` seen, `/readyz` 200) | 0 / 0 / 0 | 0 | api,web |
| 2 SIGHUP on the unchanged valid file (delivery control) | 1 / 0 / 0 | 0 | api,web |
| 3 invalid file put in place, poll | 1 / 1 / 0 | 1 | api,web |
| 4 first SIGHUP on the same invalid file | 1 / 1 / 0 | 1 | api,web |
| 5 second SIGHUP | 1 / 1 / 0 | 1 | api,web |
| 6 valid file restored, poll | 2 / 1 / 0 | 1 | api,web |
| 7 SIGHUP on the valid file (delivery control) | 3 / 1 / 0 | 1 | api,web |

The single rejected line is `config reload rejected: <T>/checks.json: checks[0].url: must be an http: or https: URL`. The token appears 0 times in the logs. TERM gives `exit=0` and `no leftover`. The service PID is the process that listens on the port, not the `bun run` wrapper (on BASE they differ). The tokens file holds a fresh `openssl rand -hex 32` token, never `tokens.example.json` (placeholder and example tokens are refused, `src/tokens.ts:6-14,30-33`). The interval is 1000, because 500 is refused at startup (`src/start.ts:112-123`). Report the commands and the sanitized output, without token values.

```bash
#!/usr/bin/env bash
# Usage: sighup.sh <api checkout>. Real-process SIGHUP check for #859.
set -u
API="$1"
T="$(mktemp -d /tmp/s859-run-XXXXXX)"
cd "$API" || exit 2
TOKEN="$(openssl rand -hex 32)"
printf '{"tokens":[{"location":"local","token":"%s"}]}\n' "$TOKEN" > "$T/tokens.json"
printf '%s\n' '{"checks":[{"id":"api","name":"API","url":"http://127.0.0.1:9/a","intervalMs":60000},{"id":"web","name":"Web","url":"http://127.0.0.1:9/w","intervalMs":60000}]}' > "$T/valid.json"
printf '%s\n' '{"checks":[{"id":"api","name":"API","url":"file:///x","intervalMs":60000},{"id":"web","name":"Web","url":"http://127.0.0.1:9/w","intervalMs":60000}]}' > "$T/invalid.json"
cp "$T/valid.json" "$T/checks.json"

env -i HOME="$HOME" PATH="$PATH" PORT=0 PULSE_DB="$T/pulse.db" PULSE_CHECKS_FILE="$T/checks.json" \
  PULSE_TOKENS_FILE="$T/tokens.json" PULSE_CHECKS_RELOAD_INTERVAL_MS=1000 \
  bun start > "$T/out.log" 2> "$T/err.log" &
WRAP=$!

PORT=""
for _ in $(seq 1 100); do
  PORT="$(grep -o '"port":[0-9]*' "$T/out.log" 2>/dev/null | head -1 | cut -d: -f2)"
  [ -n "$PORT" ] && break
  sleep 0.1
done
[ -n "$PORT" ] || { echo "FAIL no listening line"; cat "$T/err.log"; kill "$WRAP"; exit 1; }
READY="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/readyz")"
echo "ready=$READY port=set"
[ "$READY" = 200 ] || { echo "FAIL readyz"; kill "$WRAP"; exit 1; }

# The service PID is the process listening on the port, not the wrapper.
PID="$(ss -ltnpH "sport = :$PORT" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
echo "wrapper=$WRAP service=$PID same=$([ "$WRAP" = "$PID" ] && echo yes || echo no)"

val() {
  local v
  v="$(curl -s "http://127.0.0.1:$PORT/metrics" | grep "^pulse_api_config_reload_total{result=\"$1\"}" | awk '{print $2}')"
  echo "${v:-0}"
}
ids() { curl -s "http://127.0.0.1:$PORT/checks" | grep -o '"id":"[a-z]*"' | cut -d'"' -f4 | sort | tr '\n' ,; }
rejected() { grep -c 'config reload rejected' "$T/err.log" "$T/out.log" | awk -F: '{s+=$2} END {print s}'; }
state() { echo "$1 ok/invalid/error=$(val ok)/$(val invalid)/$(val error) rejected=$(rejected) ids=$(ids)"; }

state "1 ready"
kill -HUP "$PID"; sleep 1.5
state "2 hup-valid"
cp "$T/invalid.json" "$T/checks.tmp" && mv "$T/checks.tmp" "$T/checks.json"; sleep 2.5
state "3 poll-invalid"
kill -HUP "$PID"; sleep 1.5
state "4 hup1-invalid"
kill -HUP "$PID"; sleep 1.5
state "5 hup2-invalid"
cp "$T/valid.json" "$T/checks.tmp" && mv "$T/checks.tmp" "$T/checks.json"; sleep 2.5
state "6 restored"
kill -HUP "$PID"; sleep 1.5
state "7 hup-valid"
grep -h 'config reload rejected' "$T/err.log" "$T/out.log" | grep -o 'config reload rejected: [^"]*' | sed "s#$T#<T>#"
grep -c "$TOKEN" "$T/out.log" "$T/err.log" | sed 's/^/token-occurrences /'

kill -TERM "$PID"
wait "$WRAP"; echo "exit=$?"
sleep 0.5
if kill -0 "$PID" 2>/dev/null; then echo "LEFTOVER $PID"; else echo "no leftover"; fi
rm -rf "$T"
```

**A6. Scope gate: commits, index and worktree, against the recorded BASE.** After the last commit, `gate.sh <api> "$BASE" allowed.txt protected.txt` exits 0. The gate checks five things separately: `git diff --name-only "$BASE" HEAD` equals the allowed list exactly (sorted); `git diff --name-only --cached` is empty; `git diff --name-only` is empty; `git status --porcelain` is empty; `git diff --exit-code "$BASE" HEAD -- <protected>` exits 0.

`allowed.txt` (exactly the nine `Files:` above):

```text
docs/operation.md
src/config-reload.ts
src/config.ts
src/config-write.ts
src/config.test.ts
src/config.maintenance.test.ts
src/config.examples.test.ts
src/config-reload.test.ts
src/config-reload.initial.test.ts
```

`protected.txt` (each path exists at BASE; the eight unchanged documents of R7 first):

```text
README.md
docs/concepts.md
docs/configuration.md
docs/install.md
docs/troubleshooting.md
docs/rest-api.md
docs/development.md
docs/index.md
AGENTS.md
CLAUDE.md
src/admin-routes.ts
src/start.ts
src/main.ts
src/config-fs.ts
src/config-holder.ts
src/check-write.ts
src/check-store.ts
src/maintenance-write.ts
src/maintenance-store.ts
src/effective-checks.ts
src/effective-maintenance.ts
src/audit-log.ts
src/metrics.ts
src/tokens.ts
src/admin-tokens.ts
src/config-write.audit.test.ts
src/config-write.crash.test.ts
src/config-admin.test.ts
src/config-fs.test.ts
checks.example.json
tokens.example.json
admin-tokens.example.json
package.json
bun.lock
bunfig.toml
biome.json
tsconfig.json
eslint.config.js
lefthook.yml
.github/workflows/ci.yml
Dockerfile
bench/budgets.json
```

```bash
#!/usr/bin/env bash
# Usage: gate.sh <repo> <base sha> <allowed list file> <protected list file>
# Exit 0 only when commits, index and worktree all match the allowed scope.
set -u
cd "$1" || exit 2
BASE="$2"
ALLOWED="$3"
PROTECTED="$4"
rc=0
if ! diff <(git diff --name-only "$BASE" HEAD | sort) <(sort "$ALLOWED") > /dev/null; then
  echo "FAIL commits: changed paths differ from the allowed list"; rc=1
fi
if [ -n "$(git diff --name-only --cached)" ]; then echo "FAIL index not empty"; rc=1; fi
if [ -n "$(git diff --name-only)" ]; then echo "FAIL worktree not empty"; rc=1; fi
if [ -n "$(git status --porcelain)" ]; then echo "FAIL status not clean"; rc=1; fi
mapfile -t PROT < "$PROTECTED"
if ! git diff --quiet --exit-code "$BASE" HEAD -- "${PROT[@]}"; then
  echo "FAIL protected path changed against BASE"; rc=1
fi
echo "gate exit=$rc"
exit "$rc"
```

Prove the gate with disposable clones outside the target (`fixture.sh <api> "$BASE" gate.sh allowed.txt protected.txt`), three runs. Every line must start with `ok`. Planning results on BASE, the same in three runs: F0 gate 0; F1 commits+protected; F2 index+status; F3 worktree+status; F4 status; F5 index+worktree+status; F6 commits+worktree+status+protected; F7 commits; F8 commits (each gate 1).

```bash
#!/usr/bin/env bash
# Usage: fixture.sh <api source repo> <base sha> <gate.sh> <allowed> <protected>
# Builds disposable clones and expects the gate to pass or fail per state.
set -u
SRC="$1"; BASE="$2"; GATE="$3"; ALLOWED="$4"; PROTECTED="$5"
W="$(mktemp -d /tmp/s859-fixture-XXXXXX)"
fresh() {
  rm -rf "$W/r"
  git clone -q "$SRC" "$W/r"
  git -C "$W/r" checkout -q "$BASE"
  git -C "$W/r" config user.email fixture@example.invalid
  git -C "$W/r" config user.name fixture
  while read -r f; do printf '\n' >> "$W/r/$f"; done < "$ALLOWED"
  git -C "$W/r" add -A
  git -C "$W/r" commit -q -m "fixture: allowed change"
}
expect() {
  local want="$1" name="$2"
  bash "$GATE" "$W/r" "$BASE" "$ALLOWED" "$PROTECTED" > "$W/out.txt" 2>&1
  local got=$?
  local verdict=ok
  if [ "$want" = pass ] && [ "$got" -ne 0 ]; then verdict=WRONG; fi
  if [ "$want" = fail ] && [ "$got" -eq 0 ]; then verdict=WRONG; fi
  echo "$verdict $name want=$want gate=$got: $(grep FAIL "$W/out.txt" | tr '\n' ';')"
}
fresh; expect pass "F0 allowed change only"
fresh; printf 'x\n' >> "$W/r/README.md"; git -C "$W/r" commit -qam "p"; expect fail "F1 protected committed"
fresh; printf 'x\n' >> "$W/r/README.md"; git -C "$W/r" add README.md; expect fail "F2 protected staged"
fresh; printf 'x\n' >> "$W/r/README.md"; expect fail "F3 protected unstaged"
fresh; printf 'x\n' > "$W/r/note.txt"; expect fail "F4 untracked file"
fresh; printf 'x\n' >> "$W/r/README.md"; git -C "$W/r" add README.md; git -C "$W/r" show "$BASE:README.md" > "$W/r/README.md"; expect fail "F5 staged then worktree restored to BASE"
fresh; printf 'x\n' >> "$W/r/README.md"; git -C "$W/r" commit -qam "p"; git -C "$W/r" show "$BASE:README.md" > "$W/r/README.md"; expect fail "F6 committed then worktree restored to BASE"
fresh; printf 'x\n' >> "$W/r/src/server.ts"; git -C "$W/r" commit -qam "p"; expect fail "F7 unlisted path committed"
fresh; git -C "$W/r" checkout -q "$BASE" -- src/config.test.ts; git -C "$W/r" commit -qam "p"; expect fail "F8 one allowed path left unchanged"
rm -rf "$W"
```

F5 and F6 are the restored-worktree trick: the worktree bytes equal BASE, and the gate still fails on the index or the commits.

**A7. Performance (information).** Interleaved test CPU as in "Performance impact": at least three pairs, raw samples, medians, delta. No Docker bench.

### Completion evidence (PR body)

`Closes lorenzh/pulse-meta#<child>`; the recorded BASE; A0 results (three runs each); A1 table with the branch values; the A2 counts, the added test names and the coverage line; the A3 comment list (or "none" after a full read); the A4 hits read; the A5 output of three runs, sanitized; the A6 gate output and the fixture output of three runs; the A7 samples. Known limits: the troubleshooting line 163 wording stays (out of scope, R7); the performance numbers come from a shared, noisy machine.

## Evidence gathered while planning (BASE `515031b`, Bun 1.4.0, scratch clones in `/tmp`, deleted afterwards)

- C1 three times: 194 pass, 0 fail, exit 0. Without `--config=/dev/null`, `bun test src/config.test.ts` exits 1 (9 pass, coverage threshold).
- C2 three times: exit 0, 900 pass, 0 fail, 97.82 % lines (CPU user+sys 45.5 / 44.1 / 43.2 s, wall 26-29 s).
- C3 three times: the BASE column of A1.
- C4 three times: the A5 table, exactly. Wrapper PID ≠ service PID every time. TERM gave exit 0 and no leftover process. 0 token occurrences.
- C5 three times: F0-F8 as stated.
- Typecheck trial (only `FileKind` narrowed): exactly 3 errors, `src/config-write.ts(300,14)`, `(314,7)`, `(348,10)`.
- Full trial implementation of R1, R3-R6 in a scratch copy: the first `bun run check` failed lint on `sonarjs/no-small-switch` (the one-case `switch` in `entityOf`). After the R4 fix, `bun run check` exited 0 with 903 pass, 0 fail and 97.97 % lines. A1 gave the branch column three times. `git diff --numstat` showed `1 1` for `docs/operation.md`. Biome accepted the doc.
- The new R5 tests and R6 cases a and b, run on BASE source: 12 pass, 0 fail, three times. R6 case c, as a scratch test on BASE source: 1 pass, three times (one line, `["invalid"]`, 3 reads).
- R7 search on BASE: 84 lines in 8 files, three runs; the trial branch gave 84.
- Test CPU, interleaved base/trial: 7.98/7.96, 7.71/7.73, 7.92/8.20 s.
