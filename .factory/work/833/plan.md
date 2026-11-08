# Spec #833: notify exits 2 for a corrupt subscriber store in the subscribers CLI

## Goal

When the subscriber store file is not a SQLite database or is a damaged SQLite database, `pulse-notify subscribers delete <address>` exits 1 with an uncaught `SQLiteError` and a stack trace. It must exit 2 with exactly one diagnostic line that names the store file and holds no address. This is the same path the CLI already uses for the other store errors (held lock, unsupported `user_version`). The fix stays inside the CLI boundary `src/subscribers-cli.ts` of pulse-notify. This is a follow-up to the independent review of lorenzh/pulse-notify#48 (feature #573, child #820, merged). Do not redo the subscriptions feature.

## Decisions carried from the issue, its comments and the plan review

- Manager decision (issue comment): "one more `subscribers` command" means a second **valid `subscribers delete` invocation**. It is not a new subcommand. Notify supports only `subscribers delete`. Unsupported commands (`subscribers list`, no arguments, wrong arity) and invalid addresses keep exit 1, also when the configured store is corrupt. The required pair is `subscribers delete probe@example.com` and `subscribers delete Absent@Example.com`. The mixed case is a form the CLI accepts, because `normalizeSubscriberEmail` lower-cases and trims. Both must exit 2 with the one-line diagnostic through the real executable. An unreadable store cannot prove whether an address exists, so the two addresses stand for the "existing/missing" pair: `probe@example.com` is a stored row in the damaged-SQLite fixtures and `Absent@Example.com` is never stored. The existing tests keep covering healthy-store deletion as a control.
- Issue review `.factory/work/833/issue-review.md` has no blockers. Its proposed file set is kept unchanged (see `## Repository: notify`).
- Plan review, finding 1: the issue asks for one line and grants no exception, so the diagnostic must stay one line for **every** path. The path is shown with a defined escaping (Required behavior 2), and CR/LF paths get acceptance tests.
- Plan review, finding 2: an earlier draft promised unchanged bytes for every file. That is false for a file in rollback-journal mode, because the protected `SubscriberStore.open` rewrites its header. The guarantee is now stated per file kind (Required behavior 4), it matches the issue's "(as today)", and evidence covers the rollback case too.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/833` answered `HTTP 404` on 2026-11-08, so this feature has no findings yet. No finding is cited.

## Current behavior (verified on notify `main` 3b000f2698c77a1f6cf72d7a8dcd81ecf46b9d7d)

Evidence comes from source reading and from runs in a disposable copy of the clone (`bun install --frozen-lockfile`, Bun 1.4.0). Nothing was committed to notify.

- `src/subscribers-cli.ts:21-39` `runSubscribers`: lines 22-24 check the arguments (code 1) before any file is touched. Lines 28-30 acquire the lock, call `SubscriberStore.openExisting` and `deleteByEmail`. Line 33 rethrows every error that is not `ConfigError` or `StartupError`. Lines 35-38 (`finally`) call `store?.close()` and then `lock?.release()`.
- `src/subscriber-store.ts:165-187` `open`: `new Database(...)` (line 169) is outside the `try`. `PRAGMA journal_mode = WAL` (line 171), `synchronous` and `secure_delete` (172-173) and the `user_version` check (174-181) are inside it. On error the connection is closed and the error is rethrown (182-185). A `user_version` other than 1 throws `StartupError("PULSE_NOTIFY_SUBSCRIPTIONS_STATE: the store has an unknown format")`. `deleteByEmail` is at lines 308-317 and `close()` (checkpoint, then close) at lines 518-521.
- `src/index.ts:1076-1097` `runSubscribersCli` writes each result line plus `\n`, to stdout for code 0 and to stderr otherwise. It also catches only `ConfigError`/`StartupError`. The entry block at lines 1100-1115 rethrows other errors, so Bun prints the stack and exits 1.
- Service startup already maps any store open failure to `ConfigError("cannot use subscription store <path>: <error name>")`, so it exits 2 (`src/index.ts:517-532`, `openSubscriptions`). This stays unchanged.
- The lock messages in `src/ledger-lock.ts:133-141, 206-208, 308` print the path as given. They are existing texts and are out of scope (Non-goals).
- Reproduced on base with the real executable (`env -i PATH=… PULSE_NOTIFY_SUBSCRIPTIONS_STATE=<file> bun src/index.ts subscribers delete <address>`), temporary files only. "Bytes" compares the whole file before and after:

  | Fixture | Address | Failing step | Exit | Store bytes | Lock / sidecars |
  |---|---|---|---|---|---|
  | N: non-database (`"not a database sentinel@example.org\n"` × 100, 3600 bytes) | both | `open`, line 171, `SQLITE_NOTADB` (errno 26) | 1 | unchanged | no `.lock`, no `-wal`/`-shm` |
  | S: WAL store (header bytes 18/19 = 2), page 1 bytes `[100, pageSize)` = `0xFF` | both | `open`, line 171, `SQLITE_CORRUPT` | 1 | unchanged | none left |
  | T: WAL store, bytes `[pageSize, pageSize+100)` (page 2 header, `subscriptions` root) = `0xFF` | `probe@example.com` (stored) | `deleteByEmail`, line 312, `SQLITE_CORRUPT` | 1 | unchanged | none left |
  | T | `Absent@Example.com` | none (the email index never reads page 2) | 0, `deleted 0` | unchanged | none left |
  | S built in rollback-journal mode (bytes 18/19 = 1) | both | `open`, `SQLITE_CORRUPT` | 1 | unchanged | none left |
  | R: T built in rollback-journal mode (bytes 18/19 = 1) | `probe@example.com` | `deleteByEmail`, `SQLITE_CORRUPT` | 1 | **changed by `open`**: offsets 18, 19 (1 → 2, journal mode WAL) and the change counter at 24-27 and 92-95 (+1). No other byte. | none left |
  | R | `Absent@Example.com` | none | 0, `deleted 0` | changed the same way | none left |
  | store path is a directory | `probe@example.com` | `new Database`, line 169, `SQLITE_CANTOPEN` (errno 14) | 1 | — | no `.lock` |

  The R rewrite comes from `PRAGMA journal_mode = WAL` in the protected `SubscriberStore.open`. It happens before the CLI sees any error and on every open of such a file (also on a successful `deleted 0`). The CLI cannot prevent it without changing the store, which the issue forbids. Base and prototype branch leave **identical** bytes on the same R fixture (`cmp` of two copies, one run with each revision: equal).
  Notify itself never leaves a store in rollback mode: every `open` sets WAL. Only an outside tool (for example `sqlite3 <file> 'PRAGMA journal_mode=DELETE'`) makes such a file.
- Paths with control characters work on base: a healthy store at `<dir>/x\ny.db` deletes (`deleted 1`, exit 0), and N at `<dir>/a\nb.db`, `a\rb.db`, `a\r\nb.db`, `a<U+2028>b.db` and `a<ESC>b.db` fails as N above. A diagnostic that prints such a path as given would span two lines.
- `bun:sqlite` exports `class SQLiteError extends Error { name: "SQLiteError"; errno: number; code?: string }` (`node_modules/bun-types/sqlite.d.ts:1272-1304` under `@types/bun` 1.4.0). `errno` is the extended result code, and its low byte is the primary code (11 = `SQLITE_CORRUPT`, 26 = `SQLITE_NOTADB`).

## Scope

- notify only: `src/subscribers-cli.ts`, one new test file, `README.md`, `docs/operation.md`.
- In `runSubscribers`, recognize a store that cannot be read and return the code-2 result. "Cannot be read" means primary SQLite code `SQLITE_CORRUPT` 11 or `SQLITE_NOTADB` 26, from any step: open, delete or close.
- Show the store path in that diagnostic with the escaping of Required behavior 2.
- Release the lock even when closing the store throws.

## Non-goals

- No new `subscribers` subcommand. No change to the exit code or text of unsupported commands, wrong arity or invalid addresses.
- No change to `src/subscriber-store.ts` (store format 1, pragmas including `journal_mode = WAL`, open order, close/checkpoint), `src/index.ts` (service startup, `runSubscribersCli`, entry block), `src/ledger-lock.ts` (its messages keep printing paths as given), `src/failed-cli.ts`, the ledger or its CLI, settings, contract, kit, config pins or dependencies.
- No repair, integrity scan, header pre-check, read-only probe open, schema validation, migration or recreation of a store. Any of these would add a new read or write path. The rollback-mode header rewrite stays as today.
- No mapping of other errors (for example `SQLITE_CANTOPEN`, `SQLITE_READONLY`, `SQLITE_BUSY`, programming errors) to exit 2.
- No escaping change in any other message (lock messages, `user_version` line, service startup).
- No change to `docs/troubleshooting.md`, `docs/configuration.md` or the service exit-code table in `docs/operation.md#exit-codes`.

## Required behavior

1. **Classification and code.** `runSubscribers` returns `code: 2` for `subscribers delete <valid address>` with an existing store file when SQLite reports `SQLITE_NOTADB` or `SQLITE_CORRUPT` at open, during the delete transaction or at close. This includes any extended variant. The test is an `instanceof SQLiteError` from `bun:sqlite` with `errno & 0xff` ∈ {11, 26}. The result holds exactly one line:
   `pulse-notify: cannot use subscription store <shown path>: the file is corrupt or not a database`
   Through the executable this is stderr `<that line>\n`, empty stdout and exit 2. `src/index.ts` needs no change, because `runSubscribersCli` already writes nonzero results to stderr. The prefix `cannot use subscription store` matches the service startup message (`src/index.ts:529`).
2. **One line for every path.** `<shown path>` is `deps.storePath` with these replacements, applied per character, and nothing else changed:
   - a backslash `\` (U+005C) becomes the two characters `\\`;
   - each control character, meaning Unicode general category `Cc` (U+0000-U+001F, U+007F, U+0080-U+009F, including CR, LF, TAB, ESC and NEL U+0085), and the two line breaks U+2028 (`Zl`) and U+2029 (`Zp`), becomes `\u` followed by exactly four **lowercase** hex digits of its code point (LF → `\u000a`, CR → `\u000d`, U+2028 → `\u2028`).

   So a path without backslashes and without those characters prints unchanged. The encoding is reversible, so `a\nb` (with a backslash and the letter n) and `a<LF>b` print differently. The resulting line holds no CR, LF, U+0085, U+2028 or U+2029. This is the same character set that `cleanText` in `src/channels/message.ts:56-58` already handles (`[\p{Cc}\p{Zl}\p{Zp}]`). Use a `u`-flag regex with `\p{Cc}\p{Zl}\p{Zp}`, not `\u0000`-style ranges, which Biome's recommended `noControlCharactersInRegex` rejects (seen in the prototype).
3. **No address, no file content.** The line never holds the address argument (as given or normalized), any byte of the store file, the raw SQLite message, `errno`/`code` or a stack.
4. **Lock and bytes.**
   - The lock `<storePath>.lock` is released in every outcome: success, handled error, unhandled error, and a throw from `store.close()`. If `close()` throws a corruption-class error after a handled corruption error, the result is still code 2. No `<storePath>-wal` or `<storePath>-shm` file is left behind.
   - The CLI adds no write to the store file beyond what the unchanged `SubscriberStore.open` does today. It writes no rows, runs no repair, and runs no checkpoint before the failing step.
   - Byte guarantee per file kind, asserted by tests:
     - (a) a file that is not a SQLite database (N), and a damaged store in WAL mode, the format notify writes (S, T): the file is **byte for byte unchanged**.
     - (b) a damaged file in rollback-journal mode, which only an outside tool makes (R): `SubscriberStore.open` switches its header to WAL as on every open, today too. Offsets 18 and 19 go from 1 to 2, the 32-bit big-endian counters at offsets 24 and 92 grow by 1, and **no other byte changes**. The bytes after the run equal the bytes that the base revision leaves on the same input.
   - Docs state this distinction and promise nothing wider.
5. **Unchanged behavior.**
   - Argument checks run first: usage or invalid address gives code 1, with no lock and no open, also when a corrupt file is present.
   - A held lock gives code 2 with the lock message.
   - `user_version = 2` gives code 2 with `pulse-notify: PULSE_NOTIFY_SUBSCRIPTIONS_STATE: the store has an unknown format`.
   - A missing store gives `deleted 0`, code 0, and no file is created.
   - A healthy store deletes the normalized address (`deleted 1` / `deleted 0`).
   - Any other thrown error (for example `SQLITE_CANTOPEN` for a directory path) is rethrown as today, so the executable exits 1, and the lock is still released.
6. **Suggested shape** (prototyped; `bun run check` passed on it together with the test, 811 pass / 0 fail):
   - private `isUnreadableStore(err: unknown): boolean`;
   - private `escapePath(path: string): string` (`path.replace(/[\\\p{Cc}\p{Zl}\p{Zp}]/gu, …)`);
   - private `deleteUnderLock(deps, email): number`, which runs `acquireLock` and then `try { open; if undefined return 0; try { delete } finally { store.close() } } finally { lock.release() }`.

   `runSubscribers` keeps the argument checks and wraps `deleteUnderLock` in one `try/catch`. The catch maps `ConfigError`/`StartupError` (unchanged text) and unreadable-store errors to code 2 and rethrows the rest. The implementer may choose another shape that meets 1-5. Add no new export, and do not export anything only for the test.

## Risks

- **Classifier too wide**: a check on the message, or on `instanceof SQLiteError` alone, would turn I/O errors or programming errors into exit 2. The `SQLITE_CANTOPEN` control guards this.
- **Classifier too narrow**: `code === "SQLITE_CORRUPT"` misses extended variants (for example `SQLITE_CORRUPT_INDEX`, errno 779). Use the primary code from `errno`.
- **Cleanup masking**: in today's shape, an exception from `close()` in a `finally` replaces the original error and skips `lock.release()`. Requirement 4 handles this. No deterministic fixture makes `close()` throw, so the review checks it by reading the code. State it in the PR body as a known limit.
- **Escaping drift**: Biome `noControlCharactersInRegex` (recommended set, pulse-config `biome.json:44`) rejects `\u0000-\u001f` in a regex, so use `\p{Cc}`. Some editing tools turn the text `\u2028` in a source string into the raw character. A raw U+2028 inside a regex literal is a syntax error, and inside a string it is invisible. Check with `grep -nP '[^\x00-\x7f]' src/subscribers-cli.ts test/subscribers-cli.corrupt-store.test.ts`, which must print nothing. Test names hold only printable ASCII.
- **Over-promising bytes**: a test or doc claiming "unchanged" for R would be false. R asserts the exact header-only difference instead (Requirement 4b).
- **Store-dependent R test**: the R assertion encodes how the protected store opens a rollback-mode file. If a later change to the store's open stops rewriting the header, this test fails and must be updated with that change. That is intended: it is the evidence for the docs statement.
- **Per-file coverage**: Bun enforces `coverageThreshold.lines = 0.8` from `bunfig.toml:3` per file. In the first prototype, the source change without its tests left `src/subscribers-cli.ts` at 76.32 % lines and `bun test` failed. The test file and the fix land in the same commit, or the test commit comes first.
- **Isolated red runs**: `bunfig.toml:2` turns coverage on for every `bun test`, and `bun test --help` (1.4.0) has no flag to turn it off. Running a single file then fails on the coverage threshold of unrelated files. For isolated red/green runs, use `bun --config=<dir outside the checkout>/bunfig.toml test test/subscribers-cli.corrupt-store.test.ts`, where that bunfig holds only `[test]` and `coverage = false` (verified on base). Never edit the committed `bunfig.toml`.

## Performance impact

Metrics of `bench/budgets.json` (api repository, key `notify`): only `test_cpu_s` can move (budget 3.4 s, floor 1.5 s; `bench/README.md:13` defines it as the CPU time of `bun run test`).

- The new file runs two subprocesses of `src/index.ts` plus about a dozen small SQLite fixtures. In the prototype, the file alone took 0.73-0.77 s user+sys including runner start (three runs, `bun --config=<nocov> test <file>`). An existing small CLI file takes 0.17-0.18 s on the same machine. Expect about **+0.4 to +0.8 s** test CPU on `bun run test`.
- `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `startup_wall_ms` and `image_mb` cannot move. The service path, the dependencies and the image contents are unchanged; test files are excluded from the image (`ci.yml` "Check the image has no test files"). The change sits on a CLI error path that the service never runs.

Measurement: no Docker bench (host port collision, #834). Measure `bun run test` in the notify checkout at the recorded base and at the branch head. Use the same `node_modules` (`bun install --frozen-lockfile`) and Bun 1.4.0 for both.

- Use the bash keyword `time` with `TIMEFORMAT='%U %S'`. It counts waited-for child processes, and `/usr/bin/time` is not installed on every runner.
- Run five interleaved pairs: base, branch, base, branch, … (ten runs, five per side).
- Report every user, sys and user+sys value, the median of each side (3rd smallest of five user+sys values) and the delta median(branch) − median(base), rounded to 0.01 s.
- This is test CPU, not wall time or service performance. The machine is shared and noisy. No pass threshold beyond the existing budget is set; flag a delta above +1.0 s for review.

## Security impact

Security impact: yes. The change edits an error text that carries external data (an operator path) at a trust boundary next to a file holding personal data, and the diagnostic must hold neither addresses nor file contents.

Checklist items that apply:
- **Secrets and personal data in errors and logs**: the diagnostic holds only the escaped configured path and a fixed reason. It never holds the address argument, stored or corrupt file content, the raw SQLite message or a stack. Tests assert that these are absent from stdout and stderr: the argument address (as given and lower-cased), the sentinel addresses written into the fixtures (`sentinel@example.org`, `sentinel<n>@example.org`), the text `SQLite` and stack frames (`    at `).
- **Log injection / one line**: CR, LF, every other `Cc` character, U+2028 and U+2029 in the path are escaped (Requirement 2). A path cannot forge a second output line. Tests cover LF, CR, CRLF, backslash-n, U+2028, NEL, DEL and ESC.
- **Input validation and order**: argument and address checks stay before any lock or open (exit 1 with a corrupt file present).
- **Atomic, path-safe writes**: the CLI adds no write to an unreadable store (Requirement 4). Byte equality is asserted for N, S and T, and the exact header-only change for R. The lock file is removed and no sidecar remains.
- Not touched: auth/admin routes, the probe HTTP client, dependencies, Dockerfile, CI.

Hostile inputs for the security state:
- non-database bytes that contain an address and newline/control bytes;
- a damaged SQLite file whose rows hold addresses;
- a rollback-mode damaged file;
- an address argument with mixed case and surrounding whitespace;
- a corrupt file together with invalid arguments;
- a store path with CR, LF, ESC, NEL, U+2028 or a backslash;
- a store path that is a directory.

## Rollout order

One repository: only pulse-notify changes. No contract, kit or config pin moves, and no other service reads this CLI, so no older consumer is affected. Merge the notify PR. The service needs no release step beyond its normal image build.

## Counterexamples

- `subscribers delete Absent@Example.com` on N: must give exit 2 and the diagnostic. A fix that maps only the error from `deleteByEmail` still exits 1 here, because the error comes from `open`.
- `subscribers delete probe@example.com` on T: the error comes from `deleteByEmail`, not `open`. A fix that wraps only `openExisting` exits 1 here.
- `subscribers list`, `subscribers` (no args), `subscribers delete` (1 arg), `subscribers delete a@example.com extra` on N: must stay exit 1 with `usage: pulse-notify subscribers delete <address>`. A fix that opens the store before checking arguments answers 2.
- `subscribers delete not-an-address` on N: must stay exit 1 with `pulse-notify: subscribers delete: invalid address`.
- Store path is a directory (`SQLITE_CANTOPEN`): must stay a rethrown error (executable exit 1). A fix that catches every `SQLiteError` answers 2.
- An error with `code: "SQLITE_CORRUPT_INDEX"` (errno 779, low byte 11) must count as corrupt. A fix that compares `code === "SQLITE_CORRUPT"` would rethrow it. This is checked by reading the code, because no deterministic fixture produces it.
- `user_version = 2` must keep its existing line. A fix that rewrites every code-2 line to the new wording breaks this.
- A diagnostic built from `err.message` (for example `…: file is not a database`) is wrong: it echoes a raw SQLite message.
- Path escaping. `<dir>` is an ordinary `mkdtemp` directory, so it prints unchanged. The expected suffixes are literals in the test:
  - `<dir>/a<LF>b.db` → `<dir>/a\u000ab.db`. A fix that prints the path as given yields two lines.
  - `<dir>/a<CR>b.db` → `<dir>/a\u000db.db`. A fix that escapes only `\n` misses it.
  - `<dir>/a<CR><LF>b.db` → `<dir>/a\u000d\u000ab.db`.
  - `<dir>/a\nb.db` (a real backslash followed by `n`) → `<dir>/a\\nb.db`. A fix that does not escape the backslash makes this equal to the LF case.
  - `<dir>/a<U+2028>b<U+0085>c<U+007F>d<ESC>e.db` → `<dir>/a\u2028b\u0085c\u007fd\u001be.db`. A fix with only an ASCII range misses U+2028 and NEL. `JSON.stringify` is also wrong: it adds quotes, prints `\n` instead of `\u000a`, and leaves U+2028, NEL and DEL raw.
- R fixture: a test that asserts unchanged bytes for R fails on base and on any correct fix. The R test must assert the exact header-only difference.
- Statistics: the only statistic is the test-CPU median. Per side it is the 3rd smallest of five user+sys samples in seconds, rounded to 0.01 s. The delta is median(branch) − median(base). Averages may be reported in addition but are not the result.

## Contract fields

No new names in contract or config. The change adds no field, key, route, env var or exported name. The only new text is the diagnostic reason. Searches on the clones (2026-11-08):

- `grep -rn 'corrupt or not a database' .repos/contract/src .repos/config` → 0 matches.
- `grep -rn 'SQLiteError\|SQLITE_NOTADB\|SQLITE_CORRUPT' .repos/contract/src .repos/config .repos/kit/src` → 0 matches.
- `grep -rn 'cannot use subscription store' .repos/contract/src .repos/config .repos/notify/src .repos/notify/docs .repos/notify/README.md` → only `.repos/notify/src/index.ts:529` (service startup; the prefix is reused on purpose).

## Repository: notify

Files:
- `src/subscribers-cli.ts` (changed)
- `test/subscribers-cli.corrupt-store.test.ts` (new)
- `README.md` (changed)
- `docs/operation.md` (changed)

Behavior change: yes. A corrupt or non-database subscriber store makes `subscribers delete` exit 2 with a one-line, path-escaped diagnostic instead of exit 1 with a stack.

If the recorded base already returns code 2 for both required invocations on N, request a hold. Do not open a review in that case.

### Tool facts (verified, cited)

- Bun 1.4.0: `package.json:9` (`engines.bun`), `package.json:35` (`packageManager`), `package.json:26` (`@types/bun` 1.4.0). The pinned CI installs `bun-version: 1.4.0` (pulse-config `.github/workflows/check.yml:22-24` at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:17`).
  - `lint` = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`).
  - `typecheck` = `bun node_modules/typescript7/bin/tsc --noEmit` (`package.json:12`).
  - `test` = `bun test` (`package.json:13`).
  - Biome is 2.6.3 (`package.json:21`).
- `bunfig.toml:1-4`: `[test] coverage = true`, `coverageThreshold = { lines = 0.8, functions = 0 }`, and `coveragePathIgnorePatterns` excludes `**/*.test.ts` and `test/**`. The threshold acts per file, as observed in the prototype (see Risks).
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. Pinned at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:22`). The pinned file is identical to the config clone (`diff` empty, re-checked 2026-11-08).
  - `files.includes` (lines 10-17) is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`, so the new test file is linted and formatted.
  - `linter.rules.recommended: true` (line 44) includes `noControlCharactersInRegex` (the prototype hit it).
  - The override at lines 53-63 allows non-null `!` only in `**/*.test.ts` and `**/test/**`.
- `pulse-eslint` uses pulse-config `eslint.config.js:10-16`: `sonarjs.configs.recommended` plus `sonarjs/cognitive-complexity` ≤ 15. The pinned file is identical to the clone. The prototype hit `sonarjs/no-nested-template-literals` in the test, so build expected strings without nested templates (for example `join(dir, "a\\u000d\\u000ab.db")`).
- CI: `.github/workflows/ci.yml:18` `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. That file (lines 25-38) runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and `bun run test`. Build only runs `if: inputs.build`. It is identical to the config clone.
- The pre-commit hook comes from `lefthook.yml` (it extends `node_modules/@lorenzh/pulse-config/lefthook.yml`). Never use `--no-verify`.
- `bun test --help` (1.4.0) lists `--coverage` but no switch to turn it off. Use the external `--config` bunfig described in Risks for isolated runs.

### Behavior

- Implement Required behavior 1-6 in `src/subscribers-cli.ts` only.
- Keep `SUBSCRIBERS_USAGE` and `INVALID_ADDRESS_LINE` unchanged and add no export.
- Keep the doc comment of `runSubscribers` accurate: it must mention that a corrupt store is exit 2.
- Allowed comments:
  - one line on the classifier constant naming the SQLite primary codes;
  - one doc line on the escaping helper naming the escaped set.
- The source file holds only ASCII (see Risks).

### Tests: `test/subscribers-cli.corrupt-store.test.ts` (new)

Rules for the file:
- No comments. If one is wanted, use exactly one line at the top that names the class and the expected outcome (for example `// Corrupt subscriber store: subscribers delete exits 2 with one address-free line.`).
- Use `node:assert/strict`, as `test/subscribers-cli.test.ts` does.
- Import only names that already exist on the base:
  - `runSubscribers` (`src/subscribers-cli.ts`);
  - `SubscriberStore` (`src/subscriber-store.ts`);
  - `acquireLock` (`src/ledger-lock.ts`);
  - `tempDir` and `testLockDeps` (`test/subscriptions-support.ts`);
  - `bun:sqlite`, `bun:test` and `node:` built-ins.
- Each test uses its own `tempDir` fixture and cleans it up.
- Test names hold only printable ASCII.
- Write every non-ASCII character as a `\u` escape (see Risks).

Fixtures:

- **N (non-database)**: write `"not a database sentinel@example.org\n".repeat(100)` to `<dir>/<name>`, where `<name>` is `store.db` unless a path case names another.
- **S (damaged schema page, WAL)**:
  1. `SubscriberStore.open(path).close()`.
  2. Open a raw `new Database(path)` without changing the journal mode.
  3. Insert 50 rows into `subscriptions`: `id<i>`, email `probe@example.com` for i = 0 and `sentinel<i>@example.org` otherwise, `state 'confirmed'`, `created_at 1`, `confirm_sends 0`. Close.
  4. Read the page size as `readUInt16BE(16)`, fill `[100, pageSize)` with `0xFF` and write the file back.
- **T (damaged table page, WAL)**: the same build as S, then fill `[pageSize, pageSize + 100)` with `0xFF` instead.
- **R (damaged table page, rollback journal)**: the same build as T, but run `PRAGMA journal_mode = DELETE` on the raw connection before inserting. Header bytes 18/19 are then 1.

Shared assertions for the "clean" cases (call them C):
- the store bytes after the run equal the bytes before (`deepEqual` of the buffers);
- `<path>.lock` does not exist;
- `readdirSync(<dir>)` is exactly `[<file name>]`, so no `-wal`, `-shm` or lock file remains;
- `acquireLock(<path>, testLockDeps()).release()` succeeds right after;
- the combined output does not contain the argument address, its lower-cased form, `sentinel`, `SQLite` or `    at `.

Regression cases (12 tests). Each fails on base for the reason given and passes on the fix:

1. Executable, N, `subscribers delete probe@example.com`:
   - Spawn `process.execPath` with `src/index.ts subscribers delete probe@example.com`. Use env `{ PATH, PULSE_NOTIFY_SUBSCRIPTIONS_STATE: <file> }` only, so inherited `PULSE_*` settings cannot fail first.
   - Expect status `2`, stdout `""`, and stderr exactly `pulse-notify: cannot use subscription store <file>: the file is corrupt or not a database\n`.
   - Plus C.
   - Base: status `1` (`1 !== 2`), stderr holds `SQLiteError: file is not a database`.
2. Executable, a fresh N, `subscribers delete Absent@Example.com`: the same assertions. C covers `Absent@Example.com` and `absent@example.com`. Base: status `1`.
3. `runSubscribers(["delete", "probe@example.com"], { storePath, lock: testLockDeps() })` on N:
   - Expect exactly `{ lines: ["pulse-notify: cannot use subscription store <path>: the file is corrupt or not a database"], code: 2 }`.
   - Plus C.
   - Base: throws `SQLiteError` `SQLITE_NOTADB`.
4. `runSubscribers` on S for `probe@example.com`, and 5. on a fresh S for `Absent@Example.com`:
   - The same expected result, plus C.
   - Base: throws `SQLiteError` `SQLITE_CORRUPT` from `open`.
6. `runSubscribers` on T for `probe@example.com` (a stored row):
   - The same expected result, plus C.
   - Base: throws `SQLiteError` `SQLITE_CORRUPT` from `deleteByEmail`.
7. to 11. Path escaping. For each case, N is written at `<dir>/<name>`, `runSubscribers(["delete", "probe@example.com"], …)` runs, and the expected result is `{ lines: [<line with join(dir, <literal shown name>)>], code: 2 }`. Base: throws `SQLiteError` `SQLITE_NOTADB`. The names (TypeScript source form → expected shown name, also in source form) are:

   | Case | Name | Shown name |
   |---|---|---|
   | 7 | `"a\nb.db"` | `"a\\u000ab.db"` |
   | 8 | `"a\rb.db"` | `"a\\u000db.db"` |
   | 9 | `"a\r\nb.db"` | `"a\\u000d\\u000ab.db"` |
   | 10 | `"a\\nb.db"` | `"a\\\\nb.db"` |
   | 11 | `"a\u2028b\u0085c\u007fd\u001be.db"` | `"a\\u2028b\\u0085c\\u007fd\\u001be.db"` |

   The result line therefore holds no CR, LF, U+0085, U+2028 or U+2029.
12. `runSubscribers` on R for `probe@example.com`:
   - Expect the code-2 result.
   - Before: bytes 18/19 are `[1, 1]`. After: `[2, 2]`.
   - `after.readUInt32BE(24) === before.readUInt32BE(24) + 1` and the same at offset 92. The length is unchanged.
   - After copying back offsets 18, 19 and 24-27, 92-95 from `before`, `after` equals `before`.
   - `<path>.lock` does not exist.
   - Base: throws `SQLiteError` `SQLITE_CORRUPT` from `deleteByEmail`. The rewrite itself happens on base too.

Controls (3 tests). Each must pass on the recorded base **and** on the branch, as recorded runs:

13. Argument checks on N:
    - `["list"]`, `[]`, `["delete"]`, `["delete", "a@example.com", "extra"]` → `{ lines: ["usage: pulse-notify subscribers delete <address>"], code: 1 }`.
    - `["delete", "not-an-address"]` → `{ lines: ["pulse-notify: subscribers delete: invalid address"], code: 1 }`.
    - Bytes are unchanged and no `.lock` remains.
14. `user_version = 2`:
    - Build with `SubscriberStore.open(path).close()`, then set `PRAGMA user_version = 2` with a raw `Database` and close.
    - `runSubscribers(["delete", "probe@example.com"], …)` → `{ lines: ["pulse-notify: PULSE_NOTIFY_SUBSCRIPTIONS_STATE: the store has an unknown format"], code: 2 }`.
    - No `.lock` remains.
15. Directory path (not corruption):
    - `mkdirSync(<dir>/store.db)`.
    - `runSubscribers(["delete", "probe@example.com"], …)` throws a `SQLiteError` whose `code` is `"SQLITE_CANTOPEN"`.
    - `<dir>/store.db.lock` does not exist afterwards.

Expected counts, measured on the prototype with this exact layout:
- base: 12 fail, 3 pass, in three separate runs;
- branch: 15 pass, 0 fail;
- full suite on the branch: 811 pass, 0 fail (796 on base).

The existing suites stay unchanged and keep covering:
- normalized deletion `deleted 1`/`deleted 0`;
- the missing store (`deleted 0`, nothing created);
- the held lock (code 2 with the lock message), in `test/subscribers-cli.test.ts`;
- executable usage/exit 1 and the lock held by a running service (`test/index.test.ts:926-…`);
- `user_version=2` refusal in `test/subscriptions-store.test.ts`.

They are part of the base controls: run `bun --config=<nocov>/bunfig.toml test test/subscribers-cli.test.ts test/index.test.ts test/subscriptions-store.test.ts` on base and branch and record the pass counts (all pass, 0 fail).

### Docs

- `README.md`, line 64 (the email subscriptions paragraph): add one short sentence. It says that a store file that is corrupt or not a SQLite database makes `subscribers delete` exit 2 with one line `pulse-notify: cannot use subscription store <path>: the file is corrupt or not a database` (control characters in the path escaped), with no address and the lock released. It links to `docs/operation.md#subscriber-store` for details.
- `docs/operation.md`, the `subscribers delete` bullet in `## Subscriber store` (line 78): add the case next to the held-lock and invalid-address cases. It names:
  - the exact line and exit 2;
  - the escaping (backslash as `\\`, control characters, U+2028 and U+2029 as `\uXXXX`);
  - "no output line holds the address";
  - that the lock is released;
  - that the CLI does not repair or write rows to the file;
  - that a store in notify's own format (WAL) stays byte for byte unchanged, while a file that an outside tool switched to rollback-journal mode gets its journal-mode header set back to WAL on open, as on every open;
  - "restore the store from a backup".

  Do not document a new command, a repair or a startup change. Leave `## Exit codes` unchanged (it describes the service).
- The README and `docs/operation.md` must agree with the test literals (diagnostic text, escape form) and with Requirement 4. Neither may say "unchanged" without the WAL/rollback distinction.

### Checks and completion evidence

Record `BASE=$(git rev-parse HEAD)` in the notify checkout before the first edit and put it in the PR body.

1. **Red on base, three times**:
   - In a disposable worktree of `$BASE` outside the implementation checkout (`git worktree add /tmp/notify-base "$BASE"`, then `bun install --frozen-lockfile` there), copy in only the new test file.
   - Run `bun --config=<nocov>/bunfig.toml test test/subscribers-cli.corrupt-store.test.ts` three separate times.
   - Each run must show tests 1-12 failing for the reasons stated above (status `1 !== 2`, or a thrown `SQLiteError` with `SQLITE_NOTADB`/`SQLITE_CORRUPT`) and controls 13-15 passing: **12 fail, 3 pass** (literal).
   - Record the test names and reasons. A failure from a missing import, a setup error or coverage does not count.
2. **Green on the branch, three times**: the same command in the implementation checkout gives **15 pass, 0 fail**.
3. **Base controls**: the existing-suite command above passes on base and on the branch. Record the pass/fail counts.
4. **Rollback bytes, base vs branch** (independent artifacts):
   - Build one R file with the fixture recipe (in a scratch directory, with the branch's `SubscriberStore`) and copy it twice.
   - Run `env -i PATH="$PATH" PULSE_NOTIFY_SUBSCRIPTIONS_STATE=<copy A> bun src/index.ts subscribers delete probe@example.com` in `/tmp/notify-base`. Expect exit **1**.
   - Run the same with copy B in the implementation checkout. Expect exit **2** and the diagnostic.
   - `cmp <copy A> <copy B>` must exit 0, so the fix adds no write.
   - `cmp -l <orig> <copy B>` lists only offsets (1-based) 19, 20, 25-28 and 93-96, with 19/20 going `1 → 2`. Usually only 28 and 96 among the counter bytes change, unless a carry happens.
5. **Smoke run of the real CLI** (AGENTS.md "End-to-end checks"):
   - `env -i PATH="$PATH" PULSE_NOTIFY_SUBSCRIPTIONS_STATE=<tmp>/store.db bun src/index.ts subscribers delete probe@example.com`, where `<tmp>/store.db` is a non-database file. Report exit `2` and the stderr line.
   - Repeat with the file at `<tmp>/a<LF>b.db`. Report exit `2` and that stderr is exactly one line (`wc -l` = `1`) holding `a\u000ab.db`.
   - Then delete on a healthy store (built with `SubscriberStore`). Report `deleted 1`, exit 0.
   - Do not start the long-running service: the service path is unchanged.
6. **`bun run check`** passes in the implementation checkout: lint, typecheck, and test with coverage, with `src/subscribers-cli.ts` at or above 80 % lines. Report the Bun version (`bun --version` = `1.4.0`).
7. **ASCII only**: `grep -nP '[^\x00-\x7f]' src/subscribers-cli.ts test/subscribers-cli.corrupt-store.test.ts` prints nothing.
8. **Docs review**: `git diff "$BASE" HEAD -- README.md docs/operation.md` shows the new exit-2 case in both files. Check that it has:
   - the same diagnostic text as the test, and the escape rule;
   - "no address" and the released lock;
   - the WAL / rollback byte distinction of Requirement 4;
   - nothing about a new command or a repair.
9. **Test CPU**: five interleaved pairs as described in `## Performance impact`. The base runs use the `/tmp/notify-base` worktree after the copied test file has been **removed** (`git -C /tmp/notify-base status --porcelain` empty). Report the table and the median delta.
10. **Comments**: the PR body lists every comment line added in the diff (`git diff "$BASE" HEAD | grep -E '^\+\s*(//|/\*|\*)'`), or says "none".
11. **Scope** (after the last commit, in the implementation checkout):
    - `git diff --name-only "$BASE" HEAD | sort` equals exactly this list (literal, sorted): `README.md`, `docs/operation.md`, `src/subscribers-cli.ts`, `test/subscribers-cli.corrupt-store.test.ts`. No extra and no missing file.
    - `git diff --exit-code "$BASE" HEAD -- src/subscriber-store.ts src/index.ts src/failed-cli.ts src/ledger-lock.ts src/ledger.ts src/config.ts src/subscription-settings.ts src/channels/message.ts test/subscribers-cli.test.ts test/index.test.ts test/subscriptions-store.test.ts test/subscriptions-support.ts package.json bun.lock bunfig.toml biome.json tsconfig.json eslint.config.js lefthook.yml Dockerfile .github AGENTS.md CLAUDE.md docs/troubleshooting.md docs/configuration.md` exits 0.
    - `git diff --name-only --cached` is empty, `git diff --name-only` is empty, and `git status --porcelain` is empty (untracked files included).
    - `git diff --check "$BASE" HEAD` passes.
    - Do not use `git diff "$BASE"` (base to worktree) as a substitute, and do not add ignore rules.
12. **Scope checker proof** in a disposable fixture repository outside the checkout (for example `/tmp/scope-fixture`):
    - Set it up with `git init`, a base commit with an allowed file `a.txt` and a protected file `p.txt`, then a commit that changes only `a.txt`.
    - Run the combined checker from 11 with the allowed list `a.txt` and the protected list `p.txt`. It must exit 0 on the clean allowed commit.
    - Reset to that commit before each scenario. The checker must exit nonzero for each of:
      - (a) a worktree-only edit of `p.txt`;
      - (b) a staged edit of `p.txt`;
      - (c) a committed edit of `p.txt` with a clean status;
      - (d) an untracked file;
      - (e) a staged edit of `p.txt` whose worktree copy is then restored to the base content;
      - (f) a committed edit of `p.txt` whose worktree copy is then restored to the base content.
    - For (e) and (f), also show that `git diff --exit-code "$BASE" -- p.txt` (base to worktree) exits 0, so that check alone misses the change, while the checker fails.
    - Record every exit status in the PR body. Never make a forbidden edit in the real checkout.
13. **PR body** names:
    - `Closes lorenzh/pulse-meta#<child>` and `BASE`;
    - the commands and results of 1-12;
    - the comment list;
    - the known limits: close-throw masking and `SQLITE_CORRUPT_*` variants are checked by reading the code only; the rollback-mode header rewrite is store behavior that stays as today; lock messages keep printing paths as given.
