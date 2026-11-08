# Spec #833: notify exits 2 for a corrupt subscriber store in the subscribers CLI

## Goal

`pulse-notify subscribers delete <address>` exits 1 with an uncaught `SQLiteError` and a stack trace when the subscriber store file is not a SQLite database or is a damaged SQLite database. It must exit 2 with one diagnostic line that names the store file and holds no address. This is the same path the CLI already uses for the other store errors (held lock, unsupported `user_version`). The fix stays inside the CLI boundary `src/subscribers-cli.ts` of pulse-notify. This is a follow-up to the independent review of lorenzh/pulse-notify#48 (feature #573, child #820, merged). Do not redo the subscriptions feature.

## Decisions carried from the issue and its comments

- Manager decision (issue comment): "one more `subscribers` command" means a second **valid `subscribers delete` invocation**. It is not a new subcommand. Notify supports only `subscribers delete`. Unsupported commands (`subscribers list`, no arguments, wrong arity) and invalid addresses keep exit 1, also when the configured store is corrupt. The required pair is `subscribers delete probe@example.com` and `subscribers delete Absent@Example.com` (mixed case, a form the CLI accepts: `normalizeSubscriberEmail` lower-cases and trims). Both must exit 2 with the one-line diagnostic. An unreadable store cannot prove whether an address exists. The "existing/missing address" pair is therefore expressed by the two addresses: `probe@example.com` is a stored row in the damaged-SQLite fixtures and `Absent@Example.com` is never stored. Healthy-store deletion stays covered by the existing tests as a control.
- Issue review `.factory/work/833/issue-review.md` (no blockers). Its proposed file set is kept unchanged (see `## Repository: notify`).
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/833` answered `HTTP 404` on 2026-11-08, so this feature has no findings yet. No finding is cited.

## Current behavior (verified on notify `main` 3b000f2698c77a1f6cf72d7a8dcd81ecf46b9d7d)

Evidence comes from source reading and from runs in a disposable copy of the clone (`bun install --frozen-lockfile`, Bun 1.4.0). Nothing was committed to notify.

- `src/subscribers-cli.ts:21-39` `runSubscribers`: lines 22-24 validate the arguments (code 1) before any file is touched. Lines 28-30 acquire the lock, call `SubscriberStore.openExisting` and `deleteByEmail`. Line 33 rethrows every error that is not `ConfigError` or `StartupError`. Lines 35-38 (`finally`) call `store?.close()` and then `lock?.release()`.
- `src/subscriber-store.ts:165-187` `open`: `new Database(...)` (line 169) is outside the `try`. The pragmas (lines 171-173) and the `user_version` check (lines 174-181) are inside it. On error the connection is closed and the error is rethrown (lines 182-185). A `user_version` other than 1 throws `StartupError("PULSE_NOTIFY_SUBSCRIPTIONS_STATE: the store has an unknown format")`. `deleteByEmail` is at lines 308-317 and `close()` (checkpoint, then close) at lines 518-521.
- `src/index.ts:1076-1097` `runSubscribersCli` writes code-0 lines to stdout and other lines to stderr, and also catches only `ConfigError`/`StartupError`. The entry block at lines 1100-1115 rethrows other errors, so Bun prints the stack and exits 1.
- Service startup already maps any store open failure to `ConfigError("cannot use subscription store <path>: <error name>")`, which means exit 2 (`src/index.ts:517-532`, `openSubscriptions`). This stays unchanged.
- Reproduced on base (temporary files, no real data):
  - **Non-database file** (`"not a database sentinel@example.org\n"` × 100, 3600 bytes): `PULSE_NOTIFY_SUBSCRIPTIONS_STATE=<file> bun src/index.ts subscribers delete probe@example.com` prints `SQLiteError: file is not a database`, `errno: 26`, `code: "SQLITE_NOTADB"`, thrown from `open` at `subscriber-store.ts:171`. It exits **1**. The file bytes (sha256) are unchanged and no `<file>.lock` remains.
  - **Damaged SQLite, schema page**: a format-1 store built by `SubscriberStore.open(path).close()` plus 50 inserted rows, closed (WAL header bytes 18/19 = 2), then bytes `[100, pageSize)` of page 1 set to `0xFF`. Result: `SQLiteError: database disk image is malformed`, `code: "SQLITE_CORRUPT"` at `open` (line 171), for both addresses. Exit 1, bytes unchanged, lock released.
  - **Damaged SQLite, table page**: the same build, then bytes `[pageSize, pageSize + 100)` (the page-2 header, the `subscriptions` table root) set to `0xFF`. Deleting a stored address (`probe@example.com` stored as a row) gives `SQLITE_CORRUPT` from `deleteByEmail` (line 312), exit 1, bytes unchanged, lock released. Deleting an address that is not stored answers `deleted 0`, exit 0, because the email index lookup never reads page 2. That case is valid behavior and **not** a regression case.
  - **Store path is a directory**: `SQLITE_CANTOPEN` (errno 14) from `new Database` (line 169), exit 1. This is not corruption and must keep exit 1 (control).
- Caveat recorded during planning: a damaged store whose header still says rollback-journal mode (bytes 18/19 = 1) gets its header rewritten by `PRAGMA journal_mode = WAL`. That is store behavior, which this issue may not change. The damaged fixtures are therefore built in WAL mode, as the store itself writes them, so "bytes unchanged" holds and can be checked.
- `bun:sqlite` exports `class SQLiteError extends Error { name: "SQLiteError"; errno: number; code?: string }` (`node_modules/bun-types/sqlite.d.ts:1272-1304` under `@types/bun` 1.4.0). `errno` is the extended result code, and its low byte is the primary code (11 = `SQLITE_CORRUPT`, 26 = `SQLITE_NOTADB`).

## Scope

- notify only: `src/subscribers-cli.ts`, one new test file, `README.md`, `docs/operation.md`.
- Recognize a store that cannot be read (primary SQLite code `SQLITE_CORRUPT` 11 or `SQLITE_NOTADB` 26, from any step: open, delete or close) in `runSubscribers` and return the code-2 result.
- Make sure the lock is released even when closing the store throws.

## Non-goals

- No new `subscribers` subcommand. No change to the exit code or text of unsupported commands, wrong arity or invalid addresses.
- No change to `src/subscriber-store.ts` (store format 1, pragmas, open order, close/checkpoint), `src/index.ts` (service startup, `runSubscribersCli`, entry block), `src/failed-cli.ts`, the ledger or its CLI, settings, contract, kit, config pins or dependencies.
- No repair, integrity scan, schema validation, migration or recreation of a store.
- No mapping of other errors (for example `SQLITE_CANTOPEN`, `SQLITE_READONLY`, `SQLITE_BUSY`, programming errors) to exit 2.
- No change to `docs/troubleshooting.md`, `docs/configuration.md` or the service exit-code table in `docs/operation.md#exit-codes`.

## Required behavior

1. For `subscribers delete <valid address>` with an existing store file that SQLite reports as `SQLITE_NOTADB` or `SQLITE_CORRUPT` (any extended variant, decided by `errno & 0xff` ∈ {11, 26} on an `instanceof SQLiteError` from `bun:sqlite`), at open, during the delete transaction or at close, `runSubscribers` returns `code: 2` with exactly one line:
   `pulse-notify: cannot use subscription store <storePath>: the file is corrupt or not a database`
   `<storePath>` is `deps.storePath` as given. Through the executable this is stderr `<that line>\n`, empty stdout and exit 2. `src/index.ts` needs no change because `runSubscribersCli` already writes nonzero results to stderr. The prefix `cannot use subscription store <path>:` matches the service startup message (`src/index.ts:529`).
2. The line never holds the address argument, any byte of the store file, the raw SQLite message, `errno`/`code` or a stack.
3. The lock `<storePath>.lock` is released in every outcome: success, handled error, unhandled error, and a throw from `store.close()`. A `close()` that throws a corruption-class error after a handled corruption error still ends in code 2. The store file bytes stay unchanged: the CLI writes nothing to an unreadable store, and the fixtures above prove this.
4. Unchanged: argument checks run first (usage or invalid address, code 1, no lock and no open, also with a corrupt file present). A held lock gives code 2 with the lock message. `user_version = 2` gives code 2 with `pulse-notify: PULSE_NOTIFY_SUBSCRIPTIONS_STATE: the store has an unknown format`. A missing store gives `deleted 0`, code 0, and no file is created. A healthy store deletes normalized (`deleted 1` / `deleted 0`). Any other thrown error (for example `SQLITE_CANTOPEN` for a directory path) is rethrown as today, so the executable exits 1, and the lock is still released.
5. Suggested shape (prototyped; `bun run check` passed on it together with the test): a private `isUnreadableStore(err: unknown): boolean` and a private `deleteUnderLock(deps, email): number` that runs `acquireLock`, then `try { open; try { delete } finally { store.close() } } finally { lock.release() }`. `runSubscribers` keeps the argument checks and wraps `deleteUnderLock` in one `try/catch` that maps `ConfigError`/`StartupError` (unchanged text) and unreadable-store errors to code 2 and rethrows the rest. The implementer may choose another shape that meets 1-4. No new export is needed: do not export anything only for the test.

## Risks

- **Classifier too wide**: a check on the message, or on `instanceof SQLiteError` alone, would turn lock-free I/O errors or programming errors into exit 2. The `SQLITE_CANTOPEN` control guards this.
- **Classifier too narrow**: matching `code === "SQLITE_CORRUPT"` exactly misses extended variants (for example `SQLITE_CORRUPT_INDEX`). Use the primary code from `errno`.
- **Cleanup masking**: an exception from `close()` in a `finally` replaces the original error and, in today's shape, skips `lock.release()`. Requirement 3 handles this. No deterministic fixture makes `close()` throw, so the review checks it by reading the code (state it in the PR body as a known limit).
- **Path with a line break**: the diagnostic prints the operator path as given, as the service startup message and the lock messages do. A path with a newline would break the one-line form. This limit already exists and is out of scope. Tests use ordinary `mkdtemp` paths.
- **Per-file coverage**: Bun enforces `coverageThreshold.lines = 0.8` from `bunfig.toml:3` per file. In the prototype, the source change without its tests left `src/subscribers-cli.ts` at 76.32 % lines and `bun test` failed with 796 pass / 0 fail. The test file and the fix must land in the same commit, or the test commit must come first.
- **Isolated red runs**: `bunfig.toml:2` turns coverage on for every `bun test`, and `bun test --help` (1.4.0) has no flag to turn it off. Running a single file then fails on the coverage threshold of unrelated files. For the isolated red/green runs use `bun --config=<dir outside the checkout>/bunfig.toml test test/subscribers-cli.corrupt-store.test.ts`, where that bunfig holds only `[test]` and `coverage = false` (verified on base). Never edit the committed `bunfig.toml`.

## Performance impact

Metrics of `bench/budgets.json` (api repository, key `notify`): only `test_cpu_s` (budget 3.4 s, floor 1.5 s) can move. The new test file adds two subprocess runs of `src/index.ts` and a few small SQLite fixtures. The prototype file (five subprocesses) measured 0.85-0.88 s user+sys alone, including the runner start. The final file with two subprocesses should add about **+0.2 to +0.5 s** test CPU to `bun run test`. `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `startup_wall_ms` and `image_mb` cannot move: the service path, the image contents (test files are excluded from the image, `ci.yml` "Check the image has no test files") and the dependencies are unchanged. A one-line change on the CLI error path does not run in the service.

Measurement: no Docker bench (host port collision, #834). Measure `bun run test` in the notify checkout at the recorded base and at the branch head with the same `node_modules` (`bun install --frozen-lockfile`) and Bun 1.4.0. Use `/usr/bin/time -f '%U %S'`, which includes child processes. Run five interleaved pairs: base, branch, base, branch, … (ten runs, five per side). Report every user, sys and user+sys value, the median of each side (3rd smallest of five) and the branch-minus-base median delta. This is test CPU, not wall time or service performance. The machine is shared and noisy. No pass threshold beyond the existing budget is set; flag a delta above +1.0 s for review.

## Security impact

Security impact: yes. The change edits an error text at a trust boundary: the store file is external data, and the diagnostic must not carry addresses or file contents.

Checklist items that apply:
- **Secrets and personal data in errors and logs**: the diagnostic holds only the configured path and a fixed reason. It never holds the address argument, stored or corrupt file content, the raw SQLite message or a stack. Tests assert that the argument address and a sentinel address written into the fixture (`sentinel@example.org`, `sentinel<n>@example.org`) are absent from stdout and stderr.
- **Input validation and order**: argument and address validation stays before any lock or open (exit 1 with a corrupt file present).
- **Atomic, path-safe writes**: the CLI writes nothing to an unreadable store. Byte equality before and after each refused run is asserted. The lock file is removed.
- Not touched: auth/admin routes, the probe HTTP client, dependencies, Dockerfile, CI.

The hostile inputs for the security state: non-database bytes that contain an address and newline/control bytes; a damaged SQLite file whose rows hold addresses; an address argument with mixed case and whitespace; a corrupt file together with invalid arguments; a store path that is a directory.

## Rollout order

One repository: only pulse-notify changes. No contract, kit or config pin moves and no other service reads this CLI, so no older consumer is affected. Merge the notify PR. The service needs no release step beyond its normal image build.

## Counterexamples

- `subscribers delete Absent@Example.com` on a non-database file: must give exit 2 and the diagnostic. A fix that maps only the error from `deleteByEmail` would still exit 1 here, because the error comes from `open`.
- `subscribers delete probe@example.com` on the table-page fixture: the error comes from `deleteByEmail`, not `open`. A fix that wraps only `openExisting` exits 1 here.
- `subscribers list`, `subscribers` (no args), `subscribers delete` (1 arg), `subscribers delete a@example.com extra` on a corrupt file: must stay exit 1 with `usage: pulse-notify subscribers delete <address>`. A fix that opens the store before validating would answer 2.
- `subscribers delete not-an-address` on a corrupt file: must stay exit 1 with `pulse-notify: subscribers delete: invalid address`.
- Store path is a directory (`SQLITE_CANTOPEN`): must stay a rethrown error (executable exit 1). A fix that catches every `SQLiteError` would answer 2.
- An error with `code: "SQLITE_CORRUPT_INDEX"` (errno 779, low byte 11): must count as corrupt. A fix that compares `code === "SQLITE_CORRUPT"` would rethrow. This is checked by reading the code, because no deterministic fixture produces it.
- `user_version = 2`: must keep its existing line `pulse-notify: PULSE_NOTIFY_SUBSCRIPTIONS_STATE: the store has an unknown format`. A fix that rewrites every code-2 line to the new wording breaks this.
- A diagnostic such as `pulse-notify: cannot use subscription store <path>: file is not a database` built from `err.message` is wrong: it echoes a raw SQLite message.
- Statistics: the only statistic is the test-CPU median: per side, the 3rd smallest of five user+sys samples in seconds, rounded to 0.01 s. The delta is median(branch) − median(base). Averages of the samples may be reported in addition but are not the result.

## Contract fields

No new names in contract or config. The change adds no field, key, route, env var or exported name. The only new text is the diagnostic reason. Searches on the clones (2026-11-08):

- `grep -rn 'corrupt or not a database' .repos/contract/src .repos/config` → 0 matches.
- `grep -rn 'SQLiteError\|SQLITE_NOTADB\|SQLITE_CORRUPT' .repos/contract/src .repos/config .repos/kit/src` → 0 matches.
- `grep -rn 'cannot use subscription store' .repos/contract/src .repos/config .repos/notify/src .repos/notify/docs .repos/notify/README.md` → only `.repos/notify/src/index.ts:529` (service startup, reused prefix on purpose).

## Repository: notify

Files:
- `src/subscribers-cli.ts` (changed)
- `test/subscribers-cli.corrupt-store.test.ts` (new)
- `README.md` (changed)
- `docs/operation.md` (changed)

Behavior change: yes. A corrupt or non-database subscriber store makes `subscribers delete` exit 2 with a diagnostic instead of 1 with a stack.

If the recorded base already returns code 2 for both required invocations on a non-database file, request a hold. Do not open a review in that case.

### Tool facts (verified, cited)

- Bun 1.4.0: `package.json:9` (`engines.bun`), `package.json:35` (`packageManager`), `package.json:26` (`@types/bun` 1.4.0). The pinned CI installs `bun-version: 1.4.0` (pulse-config `check.yml:22-24` at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:17`). `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`). `typecheck` = `bun node_modules/typescript7/bin/tsc --noEmit` (`package.json:12`). `test` = `bun test` (`package.json:13`). Biome 2.6.3 (`package.json:21`).
- `bunfig.toml:1-4`: `[test] coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`, and `coveragePathIgnorePatterns` excludes `**/*.test.ts` and `test/**`. The threshold acts per file, as observed in the prototype (see Risks).
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. At pin `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:22`) its `files.includes` (lines 10-17) is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`, so the new test file (`test/subscribers-cli.corrupt-store.test.ts`, not under `test/fixtures`) is linted and formatted. The override at lines 53-63 allows non-null `!` only in `**/*.test.ts` and `**/test/**`. The pinned file is identical to the config clone (`diff` empty).
- CI: `.github/workflows/ci.yml:18` `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. That file (lines 25-38) runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and `bun run test`, and is identical to the config clone.
- The pre-commit hook comes from `lefthook.yml` → `node_modules/@lorenzh/pulse-config/lefthook.yml` (Biome and pulse-eslint on staged files). Never use `--no-verify`.
- `bun test --help` (1.4.0) lists `--coverage` but no switch to turn it off. Use the external `--config` bunfig described in Risks for isolated runs.

### Behavior

Implement Required behavior 1-5 in `src/subscribers-cli.ts` only. Keep `SUBSCRIBERS_USAGE` and `INVALID_ADDRESS_LINE` unchanged, add no export, and keep the doc comment of `runSubscribers` accurate (mention that an unreadable store is exit 2). A comment on the classifier constant naming the SQLite primary codes is allowed (an external rule). Respect cognitive complexity ≤ 15 (SonarJS via `pulse-eslint`).

### Tests: `test/subscribers-cli.corrupt-store.test.ts` (new)

The only comment allowed is one line at the top that names the class and the expected outcome (for example `// Corrupt subscriber store: subscribers delete exits 2 with one address-free line.`). Prefer no comment at all. Import only names that already exist on the base: `runSubscribers` (`src/subscribers-cli.ts`), `SubscriberStore` (`src/subscriber-store.ts`), `acquireLock` (`src/ledger-lock.ts`), `tempDir` and `testLockDeps` (`test/subscriptions-support.ts`), plus `bun:sqlite`, `bun:test` and `node:` built-ins. Each test uses its own `tempDir` fixture and cleans it up. Fixtures:

- **N (non-database)**: write `"not a database sentinel@example.org\n".repeat(100)` to `<dir>/<name>.db`.
- **S (damaged schema page)**: `SubscriberStore.open(path).close()`, then a raw `new Database(path)` without changing the journal mode. Insert 50 rows into `subscriptions` (`id<i>`, email `probe@example.com` for i = 0 and `sentinel<i>@example.org` otherwise, `state 'confirmed'`, `created_at 1`, `confirm_sends 0`) and close. Read the page size as `readUInt16BE(16)`, fill `[100, pageSize)` with `0xFF` and write the file back.
- **T (damaged table page)**: the same build as S, then fill `[pageSize, pageSize + 100)` with `0xFF`.

Regression cases (each fails on base for the reason given, and passes on the fix):

1. Executable, N, `subscribers delete probe@example.com`: spawn `process.execPath` with `src/index.ts subscribers delete probe@example.com` and env `{ PATH, PULSE_NOTIFY_SUBSCRIPTIONS_STATE: <file> }` only, so inherited `PULSE_*` settings cannot fail first. Expect status `2`, stdout `""` and stderr exactly `pulse-notify: cannot use subscription store <file>: the file is corrupt or not a database\n`. Stdout and stderr hold neither `probe@example.com` nor `sentinel@example.org`. File bytes are equal before and after, `<file>.lock` does not exist, and `acquireLock(<file>, testLockDeps()).release()` succeeds right after. Base: status `1` (`1 !== 2`), stderr holds `SQLiteError: file is not a database`.
2. Executable, a fresh N, `subscribers delete Absent@Example.com`: same assertions, plus neither `Absent@Example.com` nor `absent@example.com` appears. Base: status `1`.
3. `runSubscribers(["delete", "probe@example.com"], { storePath, lock: testLockDeps() })` on N: expect exactly `{ lines: ["pulse-notify: cannot use subscription store <path>: the file is corrupt or not a database"], code: 2 }`, plus bytes, lock and address absence as in 1. Base: throws `SQLiteError` `SQLITE_NOTADB`.
4. `runSubscribers` on S for `probe@example.com` and on a fresh S for `Absent@Example.com` (two tests or one loop): the same expected result and assertions, also no `sentinel` text. Base: throws `SQLiteError` `SQLITE_CORRUPT` from `open`.
5. `runSubscribers` on T for `probe@example.com` (a stored row): the same expected result and assertions. Base: throws `SQLiteError` `SQLITE_CORRUPT` from `deleteByEmail`.

Controls (each must pass on the recorded base **and** on the branch, as recorded runs):

6. Validation precedence on N: `["list"]`, `[]`, `["delete"]`, `["delete", "a@example.com", "extra"]` → `{ lines: ["usage: pulse-notify subscribers delete <address>"], code: 1 }`. `["delete", "not-an-address"]` → `{ lines: ["pulse-notify: subscribers delete: invalid address"], code: 1 }`. Bytes unchanged and no `.lock` after each.
7. `user_version = 2`: `SubscriberStore.open(path).close()`, set `PRAGMA user_version = 2` with a raw `Database`, close. `runSubscribers(["delete", "probe@example.com"], …)` → `{ lines: ["pulse-notify: PULSE_NOTIFY_SUBSCRIPTIONS_STATE: the store has an unknown format"], code: 2 }`, no `.lock` after.
8. Directory path (not corruption): `mkdirSync(<dir>/store.db)`. `runSubscribers(["delete", "probe@example.com"], …)` throws a `SQLiteError` whose `code` is `"SQLITE_CANTOPEN"`, and `<dir>/store.db.lock` does not exist afterwards.

The existing suites stay unchanged and keep covering: normalized deletion `deleted 1`/`deleted 0`, the missing store (`deleted 0`, nothing created), the held lock (code 2 with the lock message, test `test/subscribers-cli.test.ts`), executable usage/exit 1 and the lock held by a running service (`test/index.test.ts:926-…`), and `user_version=2` refusal in `test/subscriptions-store.test.ts`. They are part of the base controls: run `bun --config=<nocov>/bunfig.toml test test/subscribers-cli.test.ts test/index.test.ts test/subscriptions-store.test.ts` on base and branch and record pass counts (all pass, 0 fail).

### Docs

- `README.md` (line 64, the email subscriptions paragraph): add one short sentence. A store file that is corrupt or not a SQLite database makes `subscribers delete` exit 2 with `pulse-notify: cannot use subscription store <path>: the file is corrupt or not a database`. The line holds no address, and the file and lock are left as they were (the lock released).
- `docs/operation.md` (the `subscribers delete` bullet in `## Subscriber store`, line 78): add the same case next to the held-lock and invalid-address cases, with the exact line, exit 2, "no output line holds the address", the file unchanged, the lock released, and "restore the store from a backup; the CLI does not repair it". Do not document a new command, a repair or a startup change. Leave `## Exit codes` unchanged (it describes the service).

### Checks and completion evidence

Record `BASE=$(git rev-parse HEAD)` in the notify checkout before the first edit and put it in the PR body.

1. **Red on base, three times**: in a disposable worktree of `$BASE` outside the implementation checkout (`git worktree add /tmp/notify-base "$BASE"` and `bun install --frozen-lockfile` there), copy in only the new test file. Run `bun --config=<nocov>/bunfig.toml test test/subscribers-cli.corrupt-store.test.ts` three separate times. Each run must show cases 1-5 failing for the reasons stated above (status `1 !== 2`, or a thrown `SQLiteError` with `SQLITE_NOTADB`/`SQLITE_CORRUPT`) and controls 6-8 passing. Record the test names and reasons. A failure from a missing import, a setup error or coverage does not count. Expected counts on base: the regression tests fail and the control tests pass (literal counts from the file as written, stated in the PR).
2. **Green on the branch, three times**: the same command in the implementation checkout passes all tests, 0 fail.
3. **Base controls**: the existing-suite command above passes on base and on the branch (record pass/fail counts).
4. **Smoke run of the real CLI** (AGENTS.md "End-to-end checks"): `PULSE_NOTIFY_SUBSCRIPTIONS_STATE=<tmp>/store.db bun src/index.ts subscribers delete probe@example.com`, where `<tmp>/store.db` is a non-database file. Report exit `2` and the stderr line. Then delete on a healthy store (built with `SubscriberStore`) and report `deleted 1`, exit 0. Do not start the long-running service: the service path is unchanged.
5. **`bun run check`** passes in the implementation checkout (lint, typecheck, test with coverage; `src/subscribers-cli.ts` at or above 80 % lines). Report the Bun version (`bun --version` = `1.4.0`).
6. **Docs review**: `git diff "$BASE" HEAD -- README.md docs/operation.md` shows the new exit-2 case in both files, with the same diagnostic text as in the test, "no address", file unchanged and lock released, and nothing about a new command or repair.
7. **Test CPU**: five interleaved pairs as described in `## Performance impact`. The base runs use the `/tmp/notify-base` worktree after the copied test file has been **removed** (`git -C /tmp/notify-base status --porcelain` empty). Report the table and the median delta.
8. **Comments**: the PR body lists every comment line added in the diff (`git diff "$BASE" HEAD | grep -E '^\+\s*(//|/\*|\*)'`), or says "none".
9. **Scope** (after the last commit, in the implementation checkout):
   - `git diff --name-only "$BASE" HEAD | sort` equals exactly this list (literal, sorted): `README.md`, `docs/operation.md`, `src/subscribers-cli.ts`, `test/subscribers-cli.corrupt-store.test.ts`. No extra and no missing file.
   - `git diff --exit-code "$BASE" HEAD -- src/subscriber-store.ts src/index.ts src/failed-cli.ts src/ledger-lock.ts src/ledger.ts src/config.ts src/subscription-settings.ts test/subscribers-cli.test.ts test/index.test.ts test/subscriptions-store.test.ts test/subscriptions-support.ts package.json bun.lock bunfig.toml biome.json tsconfig.json eslint.config.js lefthook.yml Dockerfile .github AGENTS.md CLAUDE.md docs/troubleshooting.md docs/configuration.md` exits 0.
   - `git diff --name-only --cached` is empty, `git diff --name-only` is empty, and `git status --porcelain` is empty (untracked files included).
   - `git diff --check "$BASE" HEAD` passes.
   - Do not use `git diff "$BASE"` (base to worktree) as a substitute, and do not add ignore rules.
10. **Scope checker proof** in a disposable fixture repository outside the checkout (for example `/tmp/scope-fixture`: init, a base commit with an allowed file `a.txt` and a protected file `p.txt`, then a commit that changes only `a.txt`). Run the combined checker from 9, with the allowed list `a.txt` and the protected list `p.txt`. It must exit 0 on the clean allowed commit. Reset to that commit before each scenario; the checker must exit nonzero for each of:
    - (a) a worktree-only edit of `p.txt`;
    - (b) a staged edit of `p.txt`;
    - (c) a committed edit of `p.txt` with a clean status;
    - (d) an untracked file;
    - (e) a staged edit of `p.txt` whose worktree copy is then restored to the base content;
    - (f) a committed edit of `p.txt` whose worktree copy is then restored to the base content.

    For (e) and (f), also show that `git diff --exit-code "$BASE" -- p.txt` (base to worktree) exits 0, so that check alone misses the change, while the checker fails. Record every exit status in the PR body. Never make a forbidden edit in the real checkout.
11. **PR body**: names `Closes lorenzh/pulse-meta#<child>`, `BASE`, the commands and results of 1-10, the comment list, and the known limits: close-throw masking and `SQLITE_CORRUPT_*` variants checked by reading the code only, and paths with line breaks out of scope.
