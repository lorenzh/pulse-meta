# Spec #859: api: align reload docs and remove unused config paths

## Goal

Make `docs/operation.md` describe the reload warning deduplication that the API already has, and
remove configuration code that no production path reaches:

- The rejection paragraph of `docs/operation.md` promises that `SIGHUP` logs a bad file again.
  It does not: polling and `reloadNow()` (the `SIGHUP` handler) share one `lastWarning`, so a poll
  followed by two `SIGHUP`s with the same invalid file gives one `warn` line and one
  `pulse_api_config_reload_total{result="invalid"}` increment (audit finding
  quality-api-2026-11-06-1, P2). The documentation is corrected; the runtime is not changed.
- `loadInitialConfig` (`src/config-reload.ts`), `loadConfig` and `loadChecks` (`src/config.ts`)
  have no production caller, and the check branches of the file writer (`src/config-write.ts`) are
  unreachable because `src/admin-routes.ts` sends check writes to the database writer (audit
  finding quality-api-2026-11-06-4, P3). They are removed; their file-read and validation tests
  move to the production reader `readInitialConfig`.

One child: `api`. Behavior, settings, endpoints, metrics and public types stay the same.

## Decisions carried from the issue, its comments and the issue review

- The issue review (`.factory/work/859/issue-review.md`) found no blocking question and resolved
  seven open points; this spec adopts all of them. The only issue comment is the Factory
  issue-review note. No shared findings exist: `gh api
  repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/859` answered `HTTP 404` on 2026-11-08.
- The fix is documentation, not runtime: SIGHUP keeps not repeating an unchanged warning.
- Deduplication identity is the full rendered warning line, not a file, stamp or byte sequence.
- No replacement loader exported only for tests. Migrated tests call `readInitialConfig` with
  `nodeConfigFs`.
- No README change (reason under "Repository: api"). `docs/operation.md` is the only doc that
  changes.
- `Security impact: yes` because parser and file-write code is touched, although behavior is kept.

## Current behavior (verified on api `main` 515031bd3fd2aa6b8993e325b24ab08f4a3510d6)

- `src/config-reload.ts:120-152` `readInitialConfig(fs, path)` returns
  `{ ok: true, initial }` or `{ ok: false, error: ConfigError, state: "invalid" | "unreadable",
  message, stampKey }`; `src/start.ts:240` is its production caller.
  `src/config-reload.ts:153-158` `loadInitialConfig` only wraps it and throws; `git grep -nw
  loadInitialConfig` finds only its declaration.
- `src/config-reload.ts:171-185`: `lastWarning` holds the last rendered warning line; `warnOnce`
  logs only a line that differs from it; `reject` counts `invalid` only when the line differs.
  `applied()` (`:187-193`) clears it; it runs after a successful file apply by a poll or `SIGHUP`
  (`tryApply`) and after a component write (`adopt`, `:260-277`, called from
  `src/config-write.ts:551`). `tryApply` (`:196-212`) counts `error` at every failed attempt but
  logs through `warnOnce`, so a failed-apply line also replaces `lastWarning`.
- `src/config-reload.ts:251-259`: `poll()` skips an unchanged stamp unless the state is
  `unreadable`; `reloadNow()` always reads and applies with `isForced = true` and does not touch
  `lastWarning`. `src/start.ts:433` binds `SIGHUP` to `reloader.reloadNow()`.
- `docs/operation.md:228` ends its second sentence with "fix it or send `SIGHUP` to log it again"
  — wrong for an unchanged rejection line.
- `src/config.ts:505-543`: `readJson` and `parseFile` are private and used only by `loadConfig`
  and `loadChecks`, whose only callers are `src/config.test.ts:64-83`,
  `src/config.maintenance.test.ts:62-69` and `src/config.examples.test.ts:9-17`.
  `readFileSync` (`src/config.ts:1`) stays in use by `readTokensJson` (`:545`). `parseNamed` and
  `parseJsonText` stay in use by `parseConfigText` (`:537-539`).
- `git grep -nwE 'loadInitialConfig|loadConfig|loadChecks'` on BASE prints 16 lines (1 in
  `src/config-reload.ts`, 3 in `src/config.ts`, 2 in `src/config.examples.test.ts`, 4 in
  `src/config.maintenance.test.ts`, 6 in `src/config.test.ts`).
- `src/admin-routes.ts:218-236` sends `kind === "check"` to `deps.checks` and `"maintenance"` to
  `deps.maintenance`; only components reach `deps.writer.apply(editOf(kind, ...))`. `editOf`
  (`:476-485`) is typed with `FileKind` imported from `src/config-write.ts`.
- `src/config-write.ts:24` `FileKind = Exclude<ConfigKind, "maintenance">` (`"check" |
  "component"`). Check-only code: `keepSecret` (`:232-237`), the `check` entry of `LIST_KEY`
  (`:240-244`), `referenceOf` (`:250-260`), the `kind === "check"` branch of `replaceEntry`
  (`:300`) and of `deleteEntry` (`:314-319`), and `case "check"` of `entityOf` (`:348-351`).
  `grep -cE 'keepSecret|referenceOf|LIST_KEY|kind === "check"|case "check"'
  src/config-write.ts` prints 8 on BASE. No test calls the file writer with `kind: "check"`
  (`grep -rn 'kind: "check"' src test` finds only audit records and `src/check-write.ts`).
- `checkView` and `configView` (`src/config-write.ts:133-184`) are live: `src/check-write.ts:14`
  imports `checkView`, and the writer's admin read view calls `configView`
  (`src/config-write.ts:583`). They stay.
- Planning trial (scratch clone, reverted): changing only line 24 to
  `export type FileKind = "component";` makes `bun run typecheck` fail with exactly three errors,
  all in `src/config-write.ts` (lines 300, 314, 348), and none in `src/admin-routes.ts`. So the
  narrowing forces removal of exactly the dead branches and the route needs no edit.

## Scope

- `docs/operation.md`: one paragraph (line 228) rewritten to the text given below.
- Remove `loadInitialConfig`, `loadConfig`, `loadChecks`, `readJson`, `parseFile`.
- Narrow `FileKind` to `"component"` and remove the check-only writer code listed above.
- Move the loader tests to `readInitialConfig(nodeConfigFs, path)`; add preservation tests for
  the poll + SIGHUP deduplication.

## Non-goals

- No change to reload, polling, `SIGHUP`, metrics, log texts, the startup fallback, the database
  check writer (`src/check-write.ts`), the window writer, admin routes, auth, or the atomic write
  protocol of component writes.
- No change to `checkView`, `configView`, `parseConfig`, `parseChecks`, `parseConfigText`, token
  loaders, `ConfigKind`, or file check parsing and reloading.
- No README, AGENTS.md, dependency, lockfile, schema, migration, contract, CI, tooling, coverage
  or bench change. No other target. No Docker bench (#834). No broader doc cleanup.

## Required behavior

### R1. Corrected rejection paragraph

Replace the whole line 228 of `docs/operation.md` with exactly this one line (one paragraph):

```text
An invalid or unreadable file is not applied. The API keeps the running configuration and logs one `warn` line, `config reload rejected: <path>: <message>` (the message never quotes a value), and counts `pulse_api_config_reload_total{result="invalid"}`. A rejection is logged and counted only when its line differs from the last reload warning. Looks and `SIGHUP` share that memory: a `SIGHUP`, or a look that sees a changed file, reads the bad file again, but while the line stays the same it logs nothing and counts nothing, also when the bytes changed. A rejection with another message is logged and counted. After a valid file is applied, the same bad file is logged and counted again. An unreadable file is read again at every look, so fixing its permissions applies it without a `SIGHUP`. Database check writes still work while the file is broken.
```

No other line of `docs/operation.md` changes: `git diff --numstat "$BASE" HEAD --
docs/operation.md` prints exactly `1	1	docs/operation.md`. The `error` paragraph (line 234) stays
as it is; it already says only the warn line is logged once and does not claim `error` is
counted once.

### R2. Reload behavior unchanged

The reload algorithm of `src/config-reload.ts` (`createConfigReloader`, `startConfigPolling`,
`readInitialConfig`, `withoutPath`, `revisionOf`, `stampKey`) keeps its bytes:
`git diff "$BASE" HEAD -- src/config-reload.ts` removes only the `loadInitialConfig` function
(its doc comment and body, 6 lines, plus at most one blank line) and adds nothing.

### R3. Removed loaders

After the change `git grep -nwE 'loadInitialConfig|loadConfig|loadChecks'` prints nothing and
exits 1 in the api repository (whole tree, including tests, comments and test titles).
`grep -cE '^function (readJson|parseFile)\b' src/config.ts` prints `0` (BASE: `2`). The doc
comment of `parseConfigText` no longer names `loadConfig`. No new exported function appears in
`src/config.ts` or `src/config-reload.ts`: `git diff "$BASE" HEAD -- src/config.ts
src/config-reload.ts | grep -cE '^\+export '` prints `0`.

### R4. File writer edits components only

`src/config-write.ts:24` becomes `export type FileKind = "component";`. `keepSecret`,
`referenceOf`, the `check` entry of the list key map and every `kind === "check"` /
`case "check"` branch of the edit path are removed; `listKey` (or what replaces it) returns only
`"components"`. `grep -cE 'keepSecret|referenceOf|LIST_KEY|kind === "check"|case "check"'
src/config-write.ts` prints `0` (BASE: `8`). If the implementer keeps a map named `LIST_KEY`
with only the component entry, the check is `grep -cE 'keepSecret|referenceOf|kind ===
"check"|case "check"|check: "checks"'` printing `0`; record which one was used.
Unchanged: `ConfigKind`, `ConfigAction`, `ConfigWriteError`, `WriteFs`, `WriterDeps`,
`createConfigWriter` step order (temp file, `fsync`, revision check, rename, directory `fsync`,
apply), the shared write lock, mode and owner handling, audit handling, `checkView`,
`configView`, `validated` (full `parseConfig` of the candidate file, so a component write still
validates the checks of the file), and the `412`, `422`, `409`, `404`, `503` and `500` paths of
component writes. `src/admin-routes.ts` is not edited and still typechecks.

### R5. Tests moved, not dropped

- `src/config.test.ts`: the `loadChecks` test becomes a `readInitialConfig(nodeConfigFs, path)`
  test with these literal expectations: a valid `{ checks: [ok] }` file gives `ok: true` and
  `initial.config.checks` deep-equal to `[withRetryDefaults(ok)]`; a file `{` gives `ok: false`,
  `state: "invalid"`, `error instanceof ConfigError`, `error.message ===
  \`checks file ${broken} is not valid JSON\`` and `message === "checks file is not valid JSON"`;
  the leaky file `{"checks":[{"headers":{"X":HSEC},"body":BSEC}]}` gives the same shape, and
  neither `error.message` nor `message` contains `HSEC` or `BSEC`; a missing file gives
  `ok: false`, `state: "unreadable"`, `error instanceof ConfigError`, `message === "cannot read
  the file (ENOENT)"`.
- `src/config.maintenance.test.ts`: the `loadConfig` test reads `{ checks: [check], maintenance:
  [win] }` through `readInitialConfig` (`ok: true`, `initial.config.maintenance.length === 1`)
  and a missing path (`ok: false`, `state: "unreadable"`, `error instanceof ConfigError`).
- `src/config.examples.test.ts`: `checks.example.json` through `readInitialConfig` gives
  `ok: false`, `state: "invalid"`, `error instanceof ConfigError`, `error.message` includes
  `checks[6].secret still has the example placeholder secret`, and neither `error.message` nor
  `message` includes `replace-with-a-random-secret`. The token example tests keep their meaning.
- Test titles no longer name the removed functions (R3 grep covers this).

### R6. Preservation tests of the documented behavior

- `src/config-reload.test.ts` (injected fs, clock and metrics; the harness may gain mutable
  bytes and stamp): from an applied valid file,
  1. invalid bytes A (`url: "file:///x"`) under a new stamp: one `poll()`, then `reloadNow()`
     twice: `lines.length === 1`, the line starts with `config reload rejected: `, `results`
     deep-equals `["invalid"]`, `applies() === 0`, revision equals the initial revision;
  2. then invalid bytes B with the same rejection text (`url: "ftp://y/"`) under another stamp:
     `poll()` and `reloadNow()` add no line and no result;
  3. then invalid JSON (`{`), a different text: one more line and `results` deep-equals
     `["invalid", "invalid"]`;
  4. then the valid file: `results` ends with `"ok"`; then bytes A again: one more rejection
     line and one more `"invalid"` (total lines 3, `invalid` count 3).
- `src/config-admin.test.ts`: extend the existing scenario "reload: an invalid edit keeps the
  config, logs one line and is not logged twice" (or add a sibling) with one `b.poll()` followed
  by `b.hup()` twice: exactly 1 `config reload rejected` line at level `warn`,
  `/^pulse_api_config_reload_total\{result="invalid"\} 1$/m` and
  `/^pulse_api_config_reload_total\{result="ok"\} 0$/m` on `/metrics`, and the check ids still
  `["api", "web"]`.
- All expected counts and texts are literals in the tests, not values read from the reloader.

## Risks

- Removing the writer branches could touch the shared atomic protocol by accident. Mitigation:
  R4 diff review; `src/config-write.audit.test.ts` and `src/config-write.crash.test.ts` are
  protected and must pass unchanged.
- Deleting `readJson` could tempt removing the `readFileSync` import; it is still needed by
  `readTokensJson`. Typecheck and lint catch either mistake.
- Migrated tests through `readInitialConfig` see a different missing-file text
  (`cannot read checks file <path>: ENOENT`, the error code, instead of the OS message). This is
  the production text already; the tests assert it, they do not change it.
- Coverage: removed code was covered only by tests; the gate is the full `bun run check` at 80 %
  lines (BASE total 97.82 % lines). Focused runs disable coverage (below).
- The doc text in R1 could be paraphrased; the acceptance greps the exact line, so it must be
  copied verbatim.

## Evidence from planning (BASE 515031bd3fd2aa6b8993e325b24ab08f4a3510d6, Bun 1.4.0, scratch clone)

- `bun install --frozen-lockfile`: 121 packages, exit 0.
- Focused baseline control, coverage disabled with an empty config:
  `bun test --config=/dev/null src/config.test.ts src/config.maintenance.test.ts
  src/config.examples.test.ts src/config-reload.test.ts src/config-admin.test.ts
  src/config-file-state.test.ts src/config-write.audit.test.ts src/config-write.crash.test.ts
  src/check-write.security.test.ts src/config-fs.test.ts src/config-db.test.ts`
  ran three times: exit 0, `191 pass`, `0 fail`, `Ran 191 tests across 11 files` each time, and
  no coverage table in the output. Per file: 9, 7, 4, 6, 62, 5, 17, 45, 3, 3, 30.
- Without `--config=/dev/null`, `bun test src/config.test.ts` exits 1 on the coverage threshold
  (`All files` 41.67 % lines) although 9 tests pass: this is why focused runs disable coverage.
- `bun run check` on BASE, three runs: exit 0 each, `900 pass`, `0 fail`, `Ran 900 tests across
  98 files`, `All files` 97.82 % lines; CPU (user + system, `/usr/bin/time`) 65.01 s, 62.22 s,
  63.13 s.
- R6 sequence trial on BASE (scratch test file, not shipped, run once with `--config=/dev/null`):
  poll + 2 × `reloadNow()` gave 1 line and `["invalid"]`, 0 applies, revision unchanged;
  `ftp://y/` added nothing; `{` added `config reload rejected: /etc/pulse/checks.json: checks file
  is not valid JSON`; valid then `file:///x` again ended at 3 lines and
  `["invalid", "invalid", "ok", "invalid"]`. 1 pass. The implementer's R6 tests must reproduce
  this on BASE (preservation control below).
- Structural reds on BASE (deterministic): R3 grep prints 16 lines, exit 0; `readJson|parseFile`
  count 2; R4 count 8; `grep -cF 'send \`SIGHUP\` to log it again' docs/operation.md` prints 1.

## Performance impact

Runtime: none expected. The change removes code that no production path calls and leaves the
reload loop byte-identical, so `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib` and
the reported `startup_wall_ms`, `p95_get_checks_ms`, `p95_post_results_ms`, requests per second and
image size (a few hundred bytes of source less) cannot move measurably. `test_cpu_s` (budget 9.2 s,
`bench/budgets.json`) can move slightly in either direction: about 3 tests are replaced and about
2 added, well under 0.1 s. There is no `build` script in `package.json`, so build CPU is not
affected.

Measurement: five interleaved pairs (BASE, candidate, BASE, candidate, ...) of the full
`bun test` with the tracked `bunfig.toml`, on the same machine, Bun 1.4.0 and installs, never
concurrently; record user + system CPU seconds including children (`/usr/bin/time -f "%U %S"`),
exit status and pass count of each run. Per side the median is the third of the five sorted
values; report candidate minus BASE in seconds (0.01 s) and in percent of the BASE median
(0.1 %). This is information on a noisy shared host, not a gate. Do not run the Docker bench
(`bench/run.ts` with compose; host port collision, #834).

## Security impact

Security impact: yes

The change touches the config file parser module, file-write code
(`src/config-write.ts`) and their error texts, although no behavior changes.

Checklist items that apply:

- Secrets in errors, logs and responses: migrated tests keep the header, body and heartbeat
  sentinel assertions (R5); `src/check-write.security.test.ts` (protected) keeps proving database
  check secret handling; `checkView` keep markers stay.
- Input validation: `validated()` still runs `parseConfig` on every candidate file; component
  bodies keep `mustBeObject`; the route still rejects a body id that differs from the path id.
- Auth order and status codes: `src/admin-routes.ts` is protected (unchanged), so auth, throttle,
  body limits and status order are unchanged.
- Atomic, path-safe writes: temp file in the same directory, `fsync`, revision check, rename,
  directory `fsync`, lock and mode/owner handling unchanged (R4 diff review plus protected
  crash/audit tests).
- Hostile inputs for the security state: a `kind: "check"` edit to the file writer must not
  compile; `POST /admin/checks` with a heartbeat secret still lands in the database, not the file
  (existing `src/config-admin.test.ts` precedence tests); a checks file with `{"X":HSEC}` raw
  tokens yields a rejection without `HSEC`.
- Dependency pins, Dockerfiles, CI: not touched (protected).

## Rollout order

One repository: only `api` changes, and no public type, route, metric or contract field
changes, so no consumer (probe, status, notify, console) is affected by its release.

## Counterexamples

- Poll, then `SIGHUP`, then `SIGHUP` on the same invalid file: correct is 1 warn line and
  `invalid` 1. The old doc text predicts 2 or 3 lines; an implementation that clears
  `lastWarning` in `reloadNow()` gives 3 lines and `invalid` 3 — rejected by R6.
- Invalid bytes `file:///x` then `ftp://y/` in the same field, new stamp: both render
  `checks[0].url: must be an http: or https: URL`; correct is no second line and no second
  `invalid`. A per-stamp or per-revision key would count twice.
- Invalid URL then `{`: different text; correct is a second line and `invalid` 2. A
  "one warning per bad state" key would miss it.
- Valid apply between two identical rejections: correct is the rejection logged and counted
  again. A never-reset key would miss it.
- Apply failure on three consecutive polls: `error` is counted at every failed attempt
  (`recordConfigReload("error")` in `tryApply`, `src/config-reload.ts:196-212`), so 3, while the
  warn line is logged once (existing `src/config-file-state.test.ts:218` asserts the single line). The doc must not say `error` is counted once; generalizing
  the `invalid` deduplication to `error` is wrong.
- Unreadable file on two polls: read twice, logged and counted once (existing test
  `src/config-reload.test.ts:146`).
- A replacement loader such as `export function readChecksFile` added for tests: rejected by R3
  (`^\+export ` count 0) and by the issue.
- `{ kind: "check", action: "delete", ref: "web" }` passed to `ConfigWriter.apply`: must fail to
  typecheck after R4.
- Statistics: the only statistic is the informational test-CPU delta, defined under Performance
  impact (five samples per side, median = third sorted value, no averaging of medians).

## Contract fields

No new names. The change adds no field, key, route, metric, env var or exported name; it only
removes the exports `loadInitialConfig`, `loadConfig` and `loadChecks` and narrows the internal
type `FileKind`. Collision check for the one kept-but-narrowed name: `grep -rn 'FileKind'
.repos/contract/src .repos/config` prints nothing, so it is internal to api.

## Repository: api

Files:
- `docs/operation.md` (changed: R1, one line)
- `src/config-reload.ts` (changed: remove `loadInitialConfig`)
- `src/config.ts` (changed: remove `loadConfig`, `loadChecks`, `readJson`, `parseFile`; fix the
  `parseConfigText` doc comment)
- `src/config-write.ts` (changed: R4)
- `src/config.test.ts` (changed: R5)
- `src/config.maintenance.test.ts` (changed: R5)
- `src/config.examples.test.ts` (changed: R5)
- `src/config-reload.test.ts` (changed: R6)
- `src/config-admin.test.ts` (changed: R6)

Behavior change: no

A removal of unreachable code, a documentation correction to the existing
behavior and test changes; reload, writes, metrics and responses stay the same.

README: no `README.md` change, because no behavior, setting, endpoint or type that README owns
changes (`AGENTS.md:87-88`); README line 58 already only says the API reloads on a look and on
`SIGHUP`, which stays true. `README.md` is protected below. `docs/operation.md` is the only
documentation file in the list.

### Tool facts (cited)

- Bun 1.4.0: `package.json` `engines.bun` and `packageManager: "bun@1.4.0"`; CI
  `bun-version: 1.4.0` in `lorenzh/pulse-config/.github/workflows/check.yml:24` at the pinned ref
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`.github/workflows/ci.yml:18` `uses:` that ref).
  The pinned `check.yml` and `biome.json` are identical to the config clone (`main`
  bc870498cc8e2539a132ce2aac35a09db1deabd8), checked with `gh api ... ?ref=<pin>` and `diff`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json`
  `scripts.check`); `lint` = `biome check . && pulse-eslint . && pulse-workflows`; `typecheck` =
  `bun node_modules/typescript7/bin/tsc --noEmit` (TypeScript 7.0.2 via `typescript7`); `test` =
  `bun test`. CI runs `bun run lint` (`check.yml:28`), `bun run typecheck` (`:30`) and
  `bun run test` (`:38`); the build steps (`:31-36`) run only with `inputs.build`.
- Biome 2.6.3 (`package.json` devDependency `@biomejs/biome`); `biome.json` extends
  `@lorenzh/pulse-config/biome.json`, whose `files.includes` (`biome.json:10-17` at the pin) is
  `**` minus `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures`; line width 100
  (`:23`). So all changed `src/*.ts` files are linted and formatted.
- Coverage: `bunfig.toml` `[test]` `coverage = true`, `coverageThreshold = { lines = 0.8,
  functions = 0 }`, test files ignored. Focused runs use `--config=/dev/null`, verified on BASE
  above (no coverage table, exit 0). The threshold is enforced only by the full
  `bun run check`.

### Baseline controls (must pass on BASE three times; verified at planning, re-run by the implementer)

- C1, focused: the 11-file `bun test --config=/dev/null ...` command above: exit 0, `191 pass`,
  `0 fail`, three runs.
- C2, full: `bun run check` with the tracked config: exit 0, lint and typecheck clean,
  `900 pass`, `0 fail`, `Ran 900 tests across 98 files`, `All files` lines ≥ 80 % (97.82 % at
  planning), three runs. If the implementer's BASE differs from
  515031bd3fd2aa6b8993e325b24ab08f4a3510d6, it re-records the counts; a test that fails on its
  BASE is reported, not made a mandatory control, and the scope is not widened to fix it.
- Structural reds S1–S4, three runs each on BASE, each must show the BASE value:
  S1 `git grep -nwE 'loadInitialConfig|loadConfig|loadChecks' | wc -l` → `16`;
  S2 `grep -cE '^function (readJson|parseFile)\b' src/config.ts` → `2`;
  S3 R4 grep count → `8`;
  S4 `grep -cF 'send \`SIGHUP\` to log it again' docs/operation.md` → `1`, and
  `grep -cxF '<R1 line>' docs/operation.md` → `0`.
- Preservation on BASE: copy the five candidate test files (`src/config.test.ts`,
  `src/config.maintenance.test.ts`, `src/config.examples.test.ts`, `src/config-reload.test.ts`,
  `src/config-admin.test.ts`) into a disposable BASE worktree and run C1 there three times: exit 0,
  all pass, the new count recorded. This proves the new and migrated tests describe the BASE
  behavior (they use only `readInitialConfig`, `nodeConfigFs` and existing harnesses), so no
  runtime fix is hidden in the change. These are preservation controls, not red tests; no test
  is written to fail on BASE.

### Acceptance (on the candidate HEAD)

1. S1 prints `0` and `git grep` exits 1; S2 `0`; S3 `0`; S4 `0` and `1`; `git diff --numstat
   "$BASE" HEAD -- docs/operation.md` prints `1	1	docs/operation.md`;
   `git diff "$BASE" HEAD -- src/config-reload.ts` has no `+` content line (R2);
   `git diff "$BASE" HEAD -- src/config.ts src/config-reload.ts | grep -cE '^\+export '` → `0`;
   `grep -cx 'export type FileKind = "component";' src/config-write.ts` → `1`.
2. C1 with the candidate files: exit 0, `0 fail`, pass count = 191 − removed + added, with each
   removed and added test named in the handoff; three runs.
3. `bun run check` with the unchanged `bunfig.toml`: exit 0, lint and typecheck clean, `0 fail`,
   `All files` lines ≥ 80 %. No `--no-verify`, no coverage or tooling change.
4. R4 diff review of `src/config-write.ts`: only removed check-only code, the `FileKind` line and
   the `listKey` narrowing; `createConfigWriter` body unchanged except where it calls the removed
   helpers (it calls none at BASE; record the diff hunk list). Protected
   `src/config-write.audit.test.ts` (17) and `src/config-write.crash.test.ts` (45) pass inside C1.
5. Local SIGHUP check with the real process (handoff evidence, AGENTS.md "Before handoff ...
   `bun start`"): in a temp dir, `PULSE_CHECKS_FILE`, `PULSE_DB` and `PULSE_TOKENS_FILE` pointing
   to temp files (tokens copied from `tokens.example.json`), `PULSE_CHECKS_RELOAD_INTERVAL_MS=500`,
   `PORT` a free loopback port, start `bun start` in the background and keep its PID (`$!`, or the
   `bun` child of that PID; never `pidof bun` or `pkill` on the shared machine). Record
   `GET /metrics` reload lines and `GET /checks` ids. Write invalid bytes (`url: "file:///x"`),
   wait for one look (≥ 1 s), record; `kill -HUP <pid>`, wait 1 s, record; `kill -HUP <pid>`
   again, wait 1 s, record. Expected literals: exactly 1 `config reload rejected` line in the log,
   `pulse_api_config_reload_total{result="invalid"} 1`, `result="ok"` unchanged, check ids
   unchanged. Then write a valid file, wait, and see `result="ok"` increased by 1. Stop with
   `kill -TERM <pid>` (exit 0), remove the temp dir. Report the commands, the observations and
   the exit status, without tokens. Then read R1 against them; they must agree.
6. Scope (commits, index and worktree separately, against the recorded implementation `BASE`,
   after the last commit of every task):
   - `git diff --name-only "$BASE" HEAD | sort` equals exactly the sorted Files list (or the
     task's subset of it);
   - `git diff --name-only --cached` and `git diff --name-only` print nothing;
   - `git status --porcelain` prints nothing;
   - `git diff --exit-code "$BASE" HEAD -- README.md AGENTS.md src/admin-routes.ts src/main.ts
     src/start.ts src/config-fs.ts src/config-holder.ts src/check-write.ts
     src/check-write.security.test.ts src/check-store.ts src/maintenance-write.ts src/metrics.ts
     src/config-file-state.test.ts src/config-db.test.ts src/config-fs.test.ts
     src/config-write.audit.test.ts src/config-write.crash.test.ts package.json bun.lock
     bunfig.toml biome.json tsconfig.json eslint.config.js .github bench` exits 0.
   Prove the gate in a disposable fixture repository (not shipped in api): a clean allowed
   commit passes; a protected change only in the worktree fails (worktree check); only in the
   index fails (index check); committed fails (commit check); a staged protected edit whose
   worktree is restored to BASE fails (index check), and a committed protected edit whose
   worktree is restored to BASE fails (commit check) although the bytes on disk equal BASE; an
   allowed but uncommitted edit fails; an untracked file fails (`git status --porcelain`). Record
   each state and which check caught it.
7. Comments: read every added line of the diff; list every added comment (inline and doc
   comments, including a rewritten `parseConfigText` doc comment) in the PR body, or write
   "none" only after that full read. No new test file is planned; if a scope revision adds one,
   it carries at most one comment line naming the class and expected outcome.
8. Test CPU delta from five interleaved pairs, reported as information (Performance impact).
9. Handoff lists BASE and HEAD SHAs, C1/C2/S1–S4 BASE runs with counts, the preservation run on
   BASE, the candidate results 1–8, and the security checklist items above with their evidence.
