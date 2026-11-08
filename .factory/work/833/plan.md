# Spec #833: notify exits 2 for a corrupt subscriber store in the subscribers CLI

## Goal

When the subscriber store file is not a SQLite database or is a damaged SQLite database, `pulse-notify subscribers delete <address>` exits 1 with an uncaught `SQLiteError` and a stack trace. It must exit 2 with exactly one diagnostic line that names the store file and holds no address. This is the same path the CLI already uses for the other store errors (held lock, unsupported `user_version`). The fix stays inside the CLI boundary `src/subscribers-cli.ts` of pulse-notify. This is a follow-up to the independent review of lorenzh/pulse-notify#48 (feature #573, child #820, merged). Do not redo the subscriptions feature.

## Decisions carried from the issue, its comments and the plan review

- Manager decision (issue comment): "one more `subscribers` command" means a second **valid `subscribers delete` invocation**. It is not a new subcommand. Notify supports only `subscribers delete`. Unsupported commands (`subscribers list`, no arguments, wrong arity) and invalid addresses keep exit 1, also when the configured store is corrupt. The required pair is `subscribers delete probe@example.com` and `subscribers delete Absent@Example.com`. The mixed case is a form the CLI accepts, because `normalizeSubscriberEmail` lower-cases and trims. Both must exit 2 with the one-line diagnostic through the real executable. An unreadable store cannot prove whether an address exists, so the two addresses stand for the "existing/missing" pair: `probe@example.com` is a stored row in the damaged-SQLite fixtures and `Absent@Example.com` is never stored. The existing tests keep covering healthy-store deletion as a control.
- Issue review `.factory/work/833/issue-review.md` has no blockers. Its proposed file set is kept unchanged (see `## Repository: notify`).
- Plan review, finding 1: the issue asks for one line and grants no exception, so the diagnostic must stay one line for **every** path. The path is shown with a defined escaping (Required behavior 2), and CR/LF paths get acceptance tests.
- Plan review, finding 2: an earlier draft promised unchanged bytes for every file. That is false for a file in rollback-journal mode, because the protected `SubscriberStore.open` rewrites its header. The guarantee is now stated per file kind (Required behavior 4), it matches the issue's "(as today)", and evidence covers the rollback case too.
- Plan review round 2, finding 1: `deleteByEmail` commits the delete and then checkpoints (`src/subscriber-store.ts:308-317`), and `close()` checkpoints before it closes the connection (`src/subscriber-store.ts:518-521`). When SQLite finds damage at one of those checkpoints, a committed delete stays committed, and the connection can stay open, so `-wal`/`-shm` can remain. The CLI cannot change this without editing the protected store. Preservation is therefore defined **relative to the base revision**: the fix makes the same store calls in the same order as base on every input (Requirement 4b), so the store file and its sidecars end as base leaves them. Byte-equality and no-sidecar claims are limited to the fixtures that prove them (N, S, T, R). Docs, Security impact and the checks say no more than that.
- Plan review round 2, finding 2: the Dockerfile copies `src` into the image (`Dockerfile:17`), so `image_mb` grows by the byte delta of `src/subscribers-cli.ts`. `## Performance impact` estimates it and names a non-Docker check. The Docker bench stays forbidden (#834).
- Plan review round 3: the docs bullet and check 8 still promised unchanged bytes for **every** damaged WAL store whose damage SQLite finds before the delete commits. That is false. Counterexample P (reproduced on base 3b000f2 with Bun 1.4.0, see Current behavior): a damaged WAL store whose `<store>-wal` still holds earlier committed frames fails in `deleteByEmail` before any commit, and then `close()` checkpoints those earlier frames into the main file, so the main-file bytes change and `-wal` is removed. Base does the same. So the docs, the doc comment and the PR body make **no** byte-equality claim for a class of inputs. They state only what the command can change, and that it makes the same SQLite calls as any other run (Requirement 4f). Byte claims stay in the tests and the check-4 evidence and name their fixtures (N, S, T, R, P). P is added to check 4. This still meets the issue's "the corrupt bytes stay unchanged (as today)": on every input the fix leaves the bytes exactly as base ("today") does (Requirement 4b), and check 4 proves it for all five fixtures. The test file and its counts (12 regression tests, 3 controls) are unchanged; P lives only in check 4.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/833` answered `HTTP 404` on 2026-11-08, so this feature has no findings yet. No finding is cited.

## Current behavior (verified on notify `main` 3b000f2698c77a1f6cf72d7a8dcd81ecf46b9d7d)

Evidence comes from source reading and from runs in a disposable copy of the clone (`bun install --frozen-lockfile`, Bun 1.4.0). Nothing was committed to notify.

- `src/subscribers-cli.ts:21-39` `runSubscribers`: lines 22-24 check the arguments (code 1) before any file is touched. Lines 28-30 acquire the lock, call `SubscriberStore.openExisting` and `deleteByEmail`. Line 33 rethrows every error that is not `ConfigError` or `StartupError`. Lines 35-38 (`finally`) call `store?.close()` and then `lock?.release()`.
- `src/subscriber-store.ts:165-187` `open`: `new Database(...)` (line 169) is outside the `try`. `PRAGMA journal_mode = WAL` (line 171), `synchronous` and `secure_delete` (172-173) and the `user_version` check (174-181) are inside it. On error the connection is closed and the error is rethrown (182-185). A `user_version` other than 1 throws `StartupError("PULSE_NOTIFY_SUBSCRIPTIONS_STATE: the store has an unknown format")`.
- `src/subscriber-store.ts:308-317` `deleteByEmail`: the `SELECT` and the `DELETE`s run in one transaction (`transaction`, line 209), which commits. Only when a row was deleted, `this.checkpoint()` (line 315, `PRAGMA wal_checkpoint(TRUNCATE)`, lines 503-515) runs **after** the commit. `close()` (lines 518-521) runs `this.checkpoint()` (line 519) and then `this.#db.close()` (line 520). If that checkpoint throws, line 520 is not reached: the connection stays open until the process exits, and SQLite can leave `<store>-wal`/`<store>-shm` behind. So damage that SQLite finds only at a checkpoint leaves a committed delete in place (in the WAL or the main file) and may leave sidecars, on base and on any CLI-only fix. No deterministic fixture triggers it: the damaged-page fixtures below fail before the commit.
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
  | P: T with pending WAL frames (recipe in check 4: after the T damage, a raw connection with `PRAGMA wal_autocheckpoint = 0` inserts `('k','v')` into `meta`; `store.db` and `store.db-wal` (8272 bytes) are copied while it is open, no `-shm`) | `probe@example.com` | `deleteByEmail`, line 312, `SQLITE_CORRUPT`; then `close()` checkpoints the earlier `meta` frames | 1 | **changed by `close()`**: the pending frames are written into the main file (22 bytes differ in the observed run, first at byte 36869). Same length. | `-wal` removed; `ls -A` = `store.db` |
  | P | `Absent@Example.com` | none | 0, `deleted 0` | changed the same way (`cmp` equal to the `probe@example.com` result) | `ls -A` = `store.db` |
  | store path is a directory | `probe@example.com` | `new Database`, line 169, `SQLITE_CANTOPEN` (errno 14) | 1 | — | no `.lock` |

  The R rewrite comes from `PRAGMA journal_mode = WAL` in the protected `SubscriberStore.open`. It happens before the CLI sees any error and on every open of such a file (also on a successful `deleted 0`). The CLI cannot prevent it without changing the store, which the issue forbids. Base and prototype branch leave **identical** bytes on the same R fixture (`cmp` of two copies, one run with each revision: equal).
  Notify itself never leaves a store in rollback mode: every `open` sets WAL. Only an outside tool (for example `sqlite3 <file> 'PRAGMA journal_mode=DELETE'`) makes such a file.
- Paths with control characters work on base: a healthy store at `<dir>/x\ny.db` deletes (`deleted 1`, exit 0), and N at `<dir>/a\nb.db`, `a\rb.db`, `a\r\nb.db`, `a<U+2028>b.db` and `a<ESC>b.db` fails as N above. A diagnostic that prints such a path as given would span two lines.
- `bun:sqlite` exports `class SQLiteError extends Error { name: "SQLiteError"; errno: number; code?: string }` (`node_modules/bun-types/sqlite.d.ts:1272-1304` under `@types/bun` 1.4.0). `errno` is the extended result code, and its low byte is the primary code (11 = `SQLITE_CORRUPT`, 26 = `SQLITE_NOTADB`).

## Scope

- notify only: `src/subscribers-cli.ts`, one new test file, `README.md`, `docs/operation.md`.
- In `runSubscribers`, recognize a store that cannot be read and return the code-2 result. "Cannot be read" means primary SQLite code `SQLITE_CORRUPT` 11 or `SQLITE_NOTADB` 26, from any step: open, the delete (its transaction or its checkpoint) or close.
- Show the store path in that diagnostic with the escaping of Required behavior 2.
- Release the lock even when closing the store throws, and classify on the first error (Requirement 4c).
- Keep the store call sequence of base (Requirement 4b). The store state after a failure is defined relative to base; byte guarantees hold only for the proven fixtures (Requirement 4e).

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
4. **Lock, store calls and bytes.**
   - (a) **Lock.** The lock `<storePath>.lock` is released in every outcome: success, handled error, rethrown error, and a throw from `store.close()`. This is the one cleanup the CLI owns. Base skips the release when `close()` throws; the fix does not.
   - (b) **Same store calls as base.** On every input, the fix makes exactly the store calls that base makes, in the same order: `SubscriberStore.openExisting(storePath)`; if that returned a store, `deleteByEmail(email)` once; then `close()` once, also when `deleteByEmail` threw. It adds no SQLite statement, pragma, second open, checkpoint, integrity check or repair, and no other file access to the store or its `-wal`/`-shm`/`-journal` files. So the store file and its sidecars end in the state that base leaves on the same input, whatever step fails. The fix changes only the result (code and line) and the lock release.
   - (c) **First error wins.** If `deleteByEmail` throws, `close()` is still called. An error from that `close()` is discarded, and the result is classified on the `deleteByEmail` error. If only `close()` throws (after a successful delete), the result is classified on the `close()` error. Example: delete throws `SQLITE_CORRUPT` and close throws `SQLITE_IOERR` → code 2. Delete throws `SQLITE_BUSY` and close throws `SQLITE_CORRUPT` → the `SQLITE_BUSY` error is rethrown (exit 1, as on base, where the close error was rethrown instead).
   - (d) **What exit 2 means.** It means that SQLite reported the store as corrupt or not a database at some step. It does **not** say whether the address was deleted. When SQLite finds the damage only at a checkpoint after the delete transaction committed (`deleteByEmail` line 315 or `close()` line 519), the committed delete stays in place, exactly as on base. When the checkpoint inside `close()` throws, the connection is not closed (line 520), and `-wal`/`-shm` can remain until the next open, exactly as on base. The CLI cannot change either without editing the protected store (Non-goals).
   - (e) **Byte and sidecar evidence, only for the named fixtures** (asserted by tests and by the base-vs-branch check 4). These are statements about these exact files, not about a class of inputs:
     - N (the non-database file of the recipe, no sidecars), S and T (damaged WAL stores built by the recipes, with no pending WAL frames and no sidecars; damage found at open or in the delete read, before any commit): the file is **byte for byte unchanged**, and no `-wal`, `-shm` or `.lock` file remains.
     - R (the damaged rollback-journal file of the recipe, which only an outside tool makes; damage found in the delete read): `SubscriberStore.open` switches its header to WAL as on every open, today too. Offsets 18 and 19 go from 1 to 2, the 32-bit big-endian counters at offsets 24 and 92 grow by 1, and **no other byte changes**. No `-wal`, `-shm` or `.lock` file remains.
     - P (T plus a `-wal` with earlier committed frames; damage found in the delete read, before the delete commits): `close()` checkpoints the earlier frames into the main file, so the main file **changes** and `-wal` is removed. The fix does not prevent this; base does the same.
     - For every fixture, the file bytes and the directory listing after the run equal what base leaves on the same input.
     - Every other input (other damage, other sidecar states, damage found at a checkpoint) is covered only by (b): the result equals what base leaves. The review checks (b) by reading the code.
   - (f) **What the texts may say.** The docs, the doc comment and the Security impact state (a)-(d) and the list of what a run can change, and make **no byte-equality claim for any class of inputs** (not "a non-database file stays unchanged", not "a WAL store whose damage is found before the commit stays unchanged"). The list of what a run can change, for any store, corrupt or not: opening sets the journal mode to WAL (a file that an outside tool switched to rollback-journal mode gets its header changed); closing checkpoints committed data that was still waiting in `<store>-wal` into the main file and removes `-wal`; when SQLite finds the damage only after the delete committed, the delete stays and `-wal`/`-shm` can remain. The PR body may cite the fixture evidence of (e), naming the fixtures. None of the texts says that exit 2 means "nothing was deleted", "the file is unchanged" or "no sidecar remains".
5. **Unchanged behavior.**
   - Argument checks run first: usage or invalid address gives code 1, with no lock and no open, also when a corrupt file is present.
   - A held lock gives code 2 with the lock message.
   - `user_version = 2` gives code 2 with `pulse-notify: PULSE_NOTIFY_SUBSCRIPTIONS_STATE: the store has an unknown format`.
   - A missing store gives `deleted 0`, code 0, and no file is created.
   - A healthy store deletes the normalized address (`deleted 1` / `deleted 0`).
   - Any other thrown error (for example `SQLITE_CANTOPEN` for a directory path) is rethrown as today, so the executable exits 1, and the lock is still released.
6. **Suggested shape.** An earlier variant (with `try { delete } finally { store.close() }`, where a close error replaced the delete error) was prototyped: `bun run check` passed on it with the test, 811 pass / 0 fail. The first-error-wins close of Requirement 4c is new and was not prototyped; `bun run check` in the task covers it.
   - private `isUnreadableStore(err: unknown): boolean`;
   - private `escapePath(path: string): string` (`path.replace(/[\\\p{Cc}\p{Zl}\p{Zp}]/gu, …)`);
   - private `deleteUnderLock(deps, email): number`, which runs `acquireLock` and then `try { open; if undefined return 0; let n; try { n = delete } catch (err) { try { store.close() } catch { /* first error wins */ } throw err } store.close(); return n } finally { lock.release() }`. (The inline comment is only for this sketch. In the source, put the swallowing close in a small private helper, for example `closeAfterError(store)`, and make sure `bun run lint` accepts it; this spec does not claim which lint rule an empty `catch` would hit.)

   This shape makes the same store calls as base (Requirement 4b). `runSubscribers` keeps the argument checks and wraps `deleteUnderLock` in one `try/catch`. The catch maps `ConfigError`/`StartupError` (unchanged text) and unreadable-store errors to code 2 and rethrows the rest. The implementer may choose another shape that meets 1-5. Add no new export, and do not export anything only for the test.

## Risks

- **Classifier too wide**: a check on the message, or on `instanceof SQLiteError` alone, would turn I/O errors or programming errors into exit 2. The `SQLITE_CANTOPEN` control guards this.
- **Classifier too narrow**: `code === "SQLITE_CORRUPT"` misses extended variants (for example `SQLITE_CORRUPT_INDEX`, errno 779). Use the primary code from `errno`.
- **Cleanup masking**: in today's shape, an exception from `close()` in a `finally` replaces the original error and skips `lock.release()`. Requirement 4a and 4c handle this. No deterministic fixture makes `close()` throw, so the review checks it by reading the code. State it in the PR body as a known limit.
- **Over-promising after a commit**: damage found at a checkpoint after the delete committed (`src/subscriber-store.ts:315` or `:519`) leaves the delete committed and can leave `-wal`/`-shm` (Current behavior). A doc, comment or PR text that says exit 2 means "nothing deleted", "file unchanged" or "no sidecar" in general would be false. Only the fixture-bound claims of Requirement 4e may be made.
- **Changed store call sequence**: a fix that adds a pre-check (header read, `PRAGMA quick_check`, a read-only probe open) or skips `close()` after a delete error would change what the store file and sidecars look like compared with base. Requirement 4b forbids both; check 4 compares base and branch artifacts for N, S, T, R and P.
- **Escaping drift**: Biome `noControlCharactersInRegex` (recommended set, pulse-config `biome.json:44`) rejects `\u0000-\u001f` in a regex, so use `\p{Cc}`. Some editing tools turn the text `\u2028` in a source string into the raw character. A raw U+2028 inside a regex literal is a syntax error, and inside a string it is invisible. Check with `grep -nP '[^\x00-\x7f]' src/subscribers-cli.ts test/subscribers-cli.corrupt-store.test.ts`, which must print nothing. Test names hold only printable ASCII.
- **Over-promising bytes**: a test or doc claiming "unchanged" for R would be false. R asserts the exact header-only difference instead (Requirement 4e). A doc claiming "unchanged" for a damaged WAL store whose damage is found before the commit is false too: P changes because `close()` checkpoints pending WAL frames. The docs therefore make no class-wide byte claim (Requirement 4f).
- **Store-dependent R test**: the R assertion encodes how the protected store opens a rollback-mode file. If a later change to the store's open stops rewriting the header, this test fails and must be updated with that change. That is intended: it is the evidence for the docs statement.
- **Per-file coverage**: Bun enforces `coverageThreshold.lines = 0.8` from `bunfig.toml:3` per file. In the first prototype, the source change without its tests left `src/subscribers-cli.ts` at 76.32 % lines and `bun test` failed. The test file and the fix land in the same commit, or the test commit comes first.
- **Isolated red runs**: `bunfig.toml:2` turns coverage on for every `bun test`, and `bun test --help` (1.4.0) has no flag to turn it off. Running a single file then fails on the coverage threshold of unrelated files. For isolated red/green runs, use `bun --config=<dir outside the checkout>/bunfig.toml test test/subscribers-cli.corrupt-store.test.ts`, where that bunfig holds only `[test]` and `coverage = false` (verified on base). Never edit the committed `bunfig.toml`.

## Performance impact

Metrics of `bench/budgets.json` (api repository, key `notify`): `test_cpu_s` moves measurably (budget 3.4 s, floor 1.5 s; api `bench/README.md:13` defines it as the CPU time of `bun run test`). `image_mb` moves by a few KB. The startup metrics are not expected to move measurably. Details:

- The new file runs two subprocesses of `src/index.ts` plus about a dozen small SQLite fixtures. In the prototype, the file alone took 0.73-0.77 s user+sys including runner start (three runs, `bun --config=<nocov> test <file>`). An existing small CLI file takes 0.17-0.18 s on the same machine. Expect about **+0.4 to +0.8 s** test CPU on `bun run test`.
- `image_mb` (reported, not gating; budget 126 MB; measured as `docker image inspect` `.Size` / 1e6 without rounding, api `bench/stack.ts:105-113`) grows by a negligible amount. The final stage copies `src` into the image (notify `Dockerfile:17`, `COPY src ./src`), so the larger `src/subscribers-cli.ts` (1683 bytes on base, `wc -c`) is in the image. `.dockerignore` excludes `test`, `**/test` and `**/*.test.ts`, and the Dockerfile copies only `package.json`, `node_modules` and `src` (lines 15-17), so the new test file, `README.md` and `docs/operation.md` are not in it. Rough estimate: the file grows by 1,000 to 3,500 bytes, so `image_mb` grows by about +0.001 to +0.0035 MB. No other image content changes: no dependency, lockfile or Dockerfile change.
- `startup_cpu_ms` and `startup_wall_ms`: `src/index.ts:60` imports `runSubscribers` statically, so the service parses the slightly larger module at startup. A few KB of TypeScript more is far below the noise of these metrics (expected change 0 within measurement error). The new code runs only in the `subscribers` CLI, never in the service.
- `load_cpu_s`, `idle_rss_mib` and `peak_rss_mib` cannot move: the service path and the dependencies are unchanged.

Measurement: no Docker bench (host port collision, #834). Measure `bun run test` in the notify checkout at the recorded base and at the branch head. Use the same `node_modules` (`bun install --frozen-lockfile`) and Bun 1.4.0 for both.

- Use the bash keyword `time` with `TIMEFORMAT='%U %S'`. It counts waited-for child processes, and `/usr/bin/time` is not installed on every runner.
- Run five interleaved pairs: base, branch, base, branch, … (ten runs, five per side).
- Report every user, sys and user+sys value, the median of each side (3rd smallest of five user+sys values) and the delta median(branch) − median(base), rounded to 0.01 s.
- This is test CPU, not wall time or service performance. The machine is shared and noisy. No pass threshold beyond the existing budget is set; flag a delta above +1.0 s for review.

Image size without Docker: after the last commit, report `git cat-file -s "$BASE":src/subscribers-cli.ts` (expected `1683`, a literal from the base) and `git cat-file -s HEAD:src/subscribers-cli.ts`, their difference in bytes and that difference / 1e6 as the `image_mb` estimate. The scope check (check 11) proves that no other file under `src`, no Dockerfile and no lockfile changed, so this file is the whole image content delta. Flag a delta above 10,000 bytes for review. Do not build the image and do not run the Docker bench.

## Security impact

Security impact: yes. The change edits an error text that carries external data (an operator path) at a trust boundary next to a file holding personal data, and the diagnostic must hold neither addresses nor file contents.

Checklist items that apply:
- **Secrets and personal data in errors and logs**: the diagnostic holds only the escaped configured path and a fixed reason. It never holds the address argument, stored or corrupt file content, the raw SQLite message or a stack. Tests assert that these are absent from stdout and stderr: the argument address (as given and lower-cased), the sentinel addresses written into the fixtures (`sentinel@example.org`, `sentinel<n>@example.org`), the text `SQLite` and stack frames (`    at `).
- **Log injection / one line**: CR, LF, every other `Cc` character, U+2028 and U+2029 in the path are escaped (Requirement 2). A path cannot forge a second output line. Tests cover LF, CR, CRLF, backslash-n, U+2028, NEL, DEL and ESC.
- **Input validation and order**: argument and address checks stay before any lock or open (exit 1 with a corrupt file present).
- **Atomic, path-safe writes**: the fix makes the same store calls as base and adds no write, repair or checkpoint (Requirement 4b). Byte equality and "no sidecar" are asserted for the fixtures N, S and T, the exact header-only change for R, and base-vs-branch equality for N, S, T, R and P (check 4). P shows that a run can change the main file without any delete (the close checkpoint of pending WAL frames), as on base. For every other input, including damage found at a checkpoint after a commit (a committed delete can stay; `-wal`/`-shm` can remain), the state stays as base leaves it; no wider claim is made. The lock file is released in every outcome, also when `close()` throws.
- Not touched: auth/admin routes, the probe HTTP client, dependencies, Dockerfile, CI.

Hostile inputs for the security state:
- non-database bytes that contain an address and newline/control bytes;
- a damaged SQLite file whose rows hold addresses;
- a rollback-mode damaged file;
- a damaged WAL store with pending committed frames in `<store>-wal` (fixture P);
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
- Docs or a doc comment saying "exit 2: nothing was deleted" are wrong: damage found at the checkpoint after a committed delete (`src/subscriber-store.ts:315`) leaves the delete in place, on base and on the fix.
- P (pending WAL): `subscribers delete probe@example.com` on P fails in `deleteByEmail` before the delete commits, and `close()` then checkpoints the earlier `meta` frames into the main file. A doc sentence "a damaged WAL store whose damage is found before the delete commits stays byte for byte unchanged" is false for P (main file changed, `-wal` removed; observed on base). A test or check that expects `cmp <orig> <B>/store.db` to exit 0 for P fails on base and on any correct fix. A fix that skips `close()` after the delete error to "keep the bytes" leaves P unchanged with its `-wal`, which differs from base in check 4 and breaks Requirement 4b.
- A fix that runs `PRAGMA quick_check` or reads the file header before opening, to detect corruption early, is wrong: it adds a store access that base does not make (Requirement 4b). A fix that skips `close()` when `deleteByEmail` threw is wrong for the same reason, and it leaves `-wal`/`-shm` on fixture T (check 4 then differs from base).
- First error wins: delete throws `SQLITE_BUSY` and close throws `SQLITE_CORRUPT`. A fix that lets the close error replace the first one answers exit 2; the correct result is the rethrown `SQLITE_BUSY` (exit 1). Checked by reading the code (no deterministic fixture).
- `image_mb` estimate: a value derived from `wc -c` of the working tree before the last commit is wrong; use `git cat-file -s` of the two commits.
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
   - `<path>.lock` does not exist, and `readdirSync(<dir>)` is exactly `[<file name>]` (no `-wal`, `-shm` or `-journal`).
   - The output holds no address and no `sentinel` (as in C).
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
  - that the command does not repair the file and makes the same SQLite calls as any delete (no extra check or write);
  - that exit 2 does **not** confirm whether the address was deleted: if SQLite finds the damage only after the delete committed (at the checkpoint), the delete stays, and `-wal`/`-shm` files can remain;
  - that the run can still change the file, as any run of the command does (Requirement 4f, the list of what a run can change): opening sets the journal mode to WAL, so a file that an outside tool switched to rollback-journal mode gets its header changed; closing writes committed data that was still waiting in `<store>-wal` into the main file and removes `-wal`;
  - "keep a copy of the damaged file and its `-wal`/`-shm` files before you run the command if you need them; restore the store from a backup, then run `subscribers delete <address>` again".

  Do not document a new command, a repair or a startup change. Leave `## Exit codes` unchanged (it describes the service).
- **No class-wide byte claim** (Requirement 4f). Neither the README nor `docs/operation.md` says that some kind of file "stays unchanged" or "byte for byte unchanged" (not for a non-database file, not for a WAL store whose damage is found before the commit), and neither says "no sidecar remains". The fixture evidence of Requirement 4e (N, S, T unchanged; R header only; P changed by the close checkpoint) belongs in the tests and the PR body only, each claim naming its fixture.
- The README and `docs/operation.md` must agree with the test literals (diagnostic text, escape form) and with Requirement 4. Neither may say or imply that exit 2 means nothing was deleted. The README sentence names only the exit code, the line, the escaping, "no address" and the released lock, and leaves the rest to `docs/operation.md`.
- The doc comment of `runSubscribers` follows the same rule: it may say "a corrupt store is exit 2", but no byte, "unchanged", "no sidecar" or "nothing deleted" promise.

### Checks and completion evidence

Record `BASE=$(git rev-parse HEAD)` in the notify checkout before the first edit and put it in the PR body.

1. **Red on base, three times**:
   - In a disposable worktree of `$BASE` outside the implementation checkout (`git worktree add /tmp/notify-base "$BASE"`, then `bun install --frozen-lockfile` there), copy in only the new test file.
   - Run `bun --config=<nocov>/bunfig.toml test test/subscribers-cli.corrupt-store.test.ts` three separate times.
   - Each run must show tests 1-12 failing for the reasons stated above (status `1 !== 2`, or a thrown `SQLiteError` with `SQLITE_NOTADB`/`SQLITE_CORRUPT`) and controls 13-15 passing: **12 fail, 3 pass** (literal).
   - Record the test names and reasons. A failure from a missing import, a setup error or coverage does not count.
2. **Green on the branch, three times**: the same command in the implementation checkout gives **15 pass, 0 fail**.
3. **Base controls**: the existing-suite command above passes on base and on the branch. Record the pass/fail counts.
4. **Store state, base vs branch** (independent artifacts; evidence for Requirement 4b and 4e):
   - Build one copy of each fixture N, S, T, R and P (in scratch directories outside both checkouts, with a script kept in its own directory; `SubscriberStore` is unchanged by the fix, so either checkout builds the same fixtures). N, S, T and R follow the recipes of the test section. **P** (pending WAL frames, the plan-review round 3 counterexample):
     1. Build T in a scratch directory W (`W/store.db`, WAL, page 2 damaged).
     2. Open a raw `new Database(W/store.db)`, run `PRAGMA wal_autocheckpoint = 0`, and run `INSERT INTO meta (key, value) VALUES ('k', 'v')`.
     3. While that connection is still open, copy `W/store.db` and `W/store.db-wal` (not `-shm`) into the original directory of P. Then `process.exit(0)` without closing.
     4. Check the original: `ls -A` is exactly `store.db store.db-wal` and `store.db-wal` is not empty (8272 bytes with page size 4096 in the planning run).
   - Keep each original, and copy each original directory into two fresh, separate directories A and B (`store.db`, plus `store.db-wal` for P).
   - In `/tmp/notify-base` run `env -i PATH="$PATH" PULSE_NOTIFY_SUBSCRIPTIONS_STATE=<A>/store.db bun src/index.ts subscribers delete probe@example.com` for each fixture. Expect exit **1** (literal) each time; for T, R and P stderr names `SQLITE_CORRUPT`.
   - In the implementation checkout run the same with `<B>/store.db`. Expect exit **2** (literal) and the diagnostic each time.
   - For each fixture: `cmp <A>/store.db <B>/store.db` exits 0, and `ls -A <A>` equals `ls -A <B>` and is exactly `store.db` (literal; no `-wal`, `-shm`, `-journal` or `.lock`; for P the `-wal` is gone after the run, observed on base).
   - For N, S and T: `cmp <orig>/store.db <B>/store.db` exits 0.
   - For R: `cmp -l <orig>/store.db <B>/store.db` lists only offsets (1-based) 19, 20, 25-28 and 93-96, with 19/20 going `1 → 2`. Usually only 28 and 96 among the counter bytes change, unless a carry happens.
   - For P: `cmp <orig>/store.db <B>/store.db` exits **1** (literal: the close checkpoint wrote the pending `meta` frames into the main file; 22 differing bytes in the planning run on base) and the length is unchanged. This is evidence that the texts must make no class-wide byte claim, not a defect of the fix.
   - Record all exit statuses, the `cmp -l | wc -l` counts and the listings in the PR body.
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
   - in `docs/operation.md`: that exit 2 does not confirm whether the address was deleted (damage found at the checkpoint after a commit leaves the delete, and `-wal`/`-shm` can remain), and the list of what a run can change (open sets WAL, so a rollback-journal file gets its header changed; close writes pending `-wal` data into the main file and removes `-wal`);
   - no class-wide byte claim: in the added README and `docs/operation.md` lines and in the doc comment, no sentence says that a kind of file "stays unchanged", "is not changed", "byte for byte" or "no sidecar remains". The edited lines already hold unrelated words (README line 64 says `/metrics` is "unchanged"), so count matches per file instead of grepping the diff: for each `f` in `README.md docs/operation.md src/subscribers-cli.ts`, `git show HEAD:$f | grep -oiE 'unchanged|not changed|byte for byte|no sidecar|nothing (was )?deleted' | wc -l` must print the base count, which is a literal measured on base 3b000f2: `1`, `3` and `0`. Also read the added sentences in context;
   - no sentence anywhere (README, `docs/operation.md`, doc comment, PR body) that says exit 2 means "nothing deleted"; the PR body cites byte evidence only per named fixture (N, S, T, R, P);
   - nothing about a new command or a repair.
9. **Test CPU and image size**:
   - Test CPU: five interleaved pairs as described in `## Performance impact`. The base runs use the `/tmp/notify-base` worktree after the copied test file has been **removed** (`git -C /tmp/notify-base status --porcelain` empty). Report the table and the median delta.
   - Image size estimate (no Docker): `git cat-file -s "$BASE":src/subscribers-cli.ts` must print `1683` (literal, measured on base 3b000f2); report `git cat-file -s HEAD:src/subscribers-cli.ts`, the byte delta and the delta / 1e6 as the `image_mb` change, as described in `## Performance impact`.
10. **Comments**: the PR body lists every comment line added in the diff (`git diff "$BASE" HEAD | grep -E '^\+\s*(//|/\*|\*)'`), or says "none".
11. **Scope** (after the last commit, in the implementation checkout):
    - `git diff --name-only "$BASE" HEAD | sort` equals exactly this list (literal, sorted): `README.md`, `docs/operation.md`, `src/subscribers-cli.ts`, `test/subscribers-cli.corrupt-store.test.ts`. No extra and no missing file.
    - `git diff --exit-code "$BASE" HEAD -- src/subscriber-store.ts src/index.ts src/failed-cli.ts src/ledger-lock.ts src/ledger.ts src/config.ts src/subscription-settings.ts src/channels/message.ts test/subscribers-cli.test.ts test/index.test.ts test/subscriptions-store.test.ts test/subscriptions-support.ts package.json bun.lock bunfig.toml biome.json tsconfig.json eslint.config.js lefthook.yml Dockerfile .dockerignore .github AGENTS.md CLAUDE.md docs/troubleshooting.md docs/configuration.md` exits 0.
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
    - the known limits:
      - close-throw handling (lock release, first error wins) and `SQLITE_CORRUPT_*` variants are checked by reading the code only;
      - "same store calls as base" (Requirement 4b) is checked by reading the code and by check 4 for N, S, T, R and P;
      - damage found at a checkpoint after a committed delete leaves the delete in place and can leave `-wal`/`-shm`, as on base; exit 2 does not confirm whether the address was deleted;
      - the rollback-mode header rewrite is store behavior that stays as today;
      - byte equality is shown only for the fixtures N, S and T; P (pending WAL frames) shows the main file can change through the close checkpoint, as on base; every other input is covered only by "same store calls as base";
      - lock messages keep printing paths as given;
      - `image_mb` grows by the source byte delta only (estimate from check 9; no Docker build).
