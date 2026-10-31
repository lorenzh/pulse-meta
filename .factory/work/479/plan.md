# Spec #479: api: SQLite WAL mode and a hot backup command

## Goal

Writes no longer block readers on a second connection to the database. An operator can take a
consistent backup of a running api with one command and restore it by following the docs. No new
network route.

## Current behavior (`main` of pulse-api)

- `src/db.ts` `openDb(path, steps = MIGRATIONS, log)` runs `new Database(path)` and then
  `migrate()`. It sets only `foreign_keys` and `user_version`. It sets no `journal_mode`, no
  `synchronous` and no `busy_timeout`. SQLite therefore uses the rollback journal (`delete`).
- `migrate()` always writes: `BEGIN IMMEDIATE`, `CREATE TABLE IF NOT EXISTS ...`. So `openDb`
  cannot open a live file read-only. A backup must use its own connection.
- `src/start.ts` reads `PULSE_DB` (default `./pulse.db`). `src/main.ts` wires
  `openDb(path, undefined, log)`, and `start.ts` sends `log` lines to `logger.info`.
- The Dockerfile sets `PULSE_DB=/data/pulse.db`, runs as user `bun`, owns `/data` as `bun:bun`,
  and copies `package.json` and `src/`. A new `src/*.ts` file and a new `package.json` script
  ship in the image without a Dockerfile change.
- `docs/operation.md` line 19 says the API sets no journal mode. Lines 25, 56 and 60 say "back
  up first" or "restore the backup". "Backup and restore" (lines 64-73) documents only `cp` with
  the API stopped and says that "the API has no backup command".
- `bench/seed.ts` seeds through each side's own `openDb`, already runs
  `PRAGMA wal_checkpoint(TRUNCATE)` and closes. `bench/stack.ts` copies only `pulse.db` into an
  `api-data` directory with mode 0777.
- `src/outage-history.test.ts` already runs a subprocess with `spawnSync` in a test.

Measured in the issue review (Bun 1.4.0, bundled SQLite 3.53.2):

- In rollback mode a writer in `BEGIN IMMEDIATE` (RESERVED lock) does not block a second
  connection's read. Only `BEGIN EXCLUSIVE`, the commit, or a cache spill does
  (`database is locked`). In WAL mode a read succeeds even while another connection holds
  `BEGIN EXCLUSIVE`. So the concurrency test must hold the writer in `BEGIN EXCLUSIVE`;
  a `BEGIN`/`BEGIN IMMEDIATE` writer would pass on today's code and prove nothing.
- A `{ readonly: true }` connection to a WAL file can run `VACUUM INTO` while another connection
  holds `BEGIN EXCLUSIVE`. The copy holds the last committed state.
- A file written by `VACUUM INTO` reports `journal_mode = delete`. `openDb` switches it to WAL.
- `close()` of the last read-write connection checkpoints and removes `-wal` and `-shm`.
- A read-only connection on a WAL file whose `-wal`/`-shm` do not exist (api stopped) creates
  both and leaves them after `close()`. This needs a writable directory and is harmless.

## Scope

api only: `src/db.ts`, a new backup command, tests, `package.json`, docs.

## Non-goals

- No admin backup route, no scheduled backups, no remote upload, no point-in-time recovery, no
  litestream.
- No change to the auto-checkpoint, the Dockerfile, the Compose files, the volume or file modes.
- No `busy_timeout` on the api's own connection (see Required behavior 1.5).
- No bench harness change.
- No new dependency (only `bun:sqlite` and `node:` modules).

## Required behavior

### 1. Journal settings in `openDb`

1. For a file database, `openDb` runs, in this order, before `migrate()` and outside any
   transaction: `PRAGMA journal_mode = WAL`, then `PRAGMA synchronous = NORMAL`.
2. In-memory databases keep today's settings: the path `":memory:"` and the empty path `""`
   (SQLite's temporary database) get neither pragma. A `file:` URI or any other string counts as
   a file.
3. `synchronous = NORMAL` is a per-connection setting and is set on every open.
   `journal_mode = WAL` is stored in the file; it is set on every open anyway (a no-op on a WAL
   file, and it converts a restored `delete`-mode backup).
4. If `PRAGMA journal_mode = WAL` returns a mode other than `wal` (a file system without shared
   memory, such as some network mounts), `openDb` does not fail. It sends exactly one line to its
   `log` callback: `journal mode stays <mode>: WAL is not available for this file`, and continues
   with `synchronous = NORMAL` not set (`NORMAL` is only crash-safe with WAL; the connection
   keeps the default `FULL`). The start goes on as today.
5. The api's own connection gets no `busy_timeout`. Reason: the api is the only writer; a
   read-only backup connection in WAL mode never blocks its writes. A `busy_timeout` would block
   the event loop synchronously.
6. Checkpoints: the default auto-checkpoint (1000 pages, run on commit) stays. No measurement
   suggests otherwise; the bench A/B is the check. While a backup holds its read snapshot, a
   checkpoint cannot move past it, so `-wal` grows for the length of the backup and is reset by a
   later checkpoint. A clean shutdown (close of the connection) checkpoints and removes
   `pulse.db-wal` and `pulse.db-shm`.
7. `-wal` and `-shm` now sit next to `pulse.db` while the api runs. They are created by the
   process user (`bun` in the image) in the same directory, so the volume and modes stay as they
   are.

### 2. Backup command

Files: `src/backup.ts` (logic, exports the function the entry calls) and `src/backup-main.ts`
(entry: argv, `process.env`, stdout/stderr, exit code). `package.json` gets the script
`"backup": "bun src/backup-main.ts"`. The implementer may merge the two files if the logic stays
testable through the subprocess, but must not export a function only for a test.

Usage: `bun run backup <target-file>`; in the image
`docker compose exec api bun run backup /data/<name>.db`.

1. Source: `PULSE_DB`, default `./pulse.db`, read like `start.ts` (trimmed string; empty counts
   as unset).
2. Arguments: exactly one positional argument, the target path. No argument, more than one, or an
   empty string is a usage error.
3. The target must not exist (`lstat`; a dangling symlink also counts as existing). Its parent
   directory must exist; it is not created.
4. The source must exist as a file. The source connection is opened with
   `new Database(source, { readonly: true })`, which never creates the file. It sets
   `PRAGMA busy_timeout = 5000` (a short lock such as WAL recovery does not fail the backup at
   once). It never migrates and never writes to the source; any schema version is accepted,
   including one newer than the program.
5. It runs `VACUUM INTO '<temp>'` with `<temp>` = `<target-dir>/.<target-name>.tmp-<pid>` in the
   target's directory. The path is passed as a bound parameter (`VACUUM INTO ?`), never spliced
   into SQL text.
6. Publish: `link(temp, target)` (fails with `EEXIST` if the target appeared after step 3, so an
   existing target is never overwritten), then `unlink(temp)`. If the file system does not
   support hard links (`EPERM`, `ENOTSUP`, `EXDEV`), fall back to a second `lstat` check and
   `rename(temp, target)`; the docs name this small race. The temp file is removed on every
   error path, also when `VACUUM INTO` fails part-way.
7. Report: the command opens the **target** read-only, reads `COUNT(*)` of `checks`, `results`,
   `incidents` and `PRAGMA user_version`, closes it, and prints one line to stdout:
   `backup <target>: schema version <v>, checks <n>, results <n>, incidents <n>`.
   These are the snapshot's numbers. The source is not counted.
8. Exit codes, errors as one line `pulse-api backup: <message>` on stderr, no stack:
   - `0`: backup written and reported.
   - `2`: usage error (argument count) or target exists.
   - `1`: any other error: missing source, missing target directory, open, `VACUUM`, link or
     rename, or report failure.
   Error text names the paths and the SQLite message, never file contents.
9. It works while the api serves traffic (WAL snapshot). With the api stopped it also works; then
   the source directory must be writable (SQLite creates `-wal`/`-shm` and a read-only connection
   leaves them). The docs say this.

### 3. Docs

`docs/operation.md`:

- Replace line 19's journal text with the WAL facts: journal mode WAL, `synchronous = NORMAL`
  (a crash or power loss can lose the last committed transactions, never corrupt the file),
  `pulse.db-wal` and `pulse.db-shm` next to `pulse.db` while the api runs, the default
  auto-checkpoint, removal on a clean shutdown, the fallback log line of 1.4.
- Rewrite "Backup and restore":
  - The command (`bun run backup <file>`, `docker compose exec api bun run backup
    /data/backup-<date>.db`, then `docker compose cp api:/data/backup-<date>.db ./`), its output
    line, exit codes, that it refuses an existing target, that it needs free space for a full
    copy in the target's file system, and that it runs as the image's default user (no `-u root`,
    which could leave root-owned `-wal`/`-shm` when the api is stopped).
  - A cold copy is safe only after a clean stop (no `pulse.db-wal` left). After a crash or
    `SIGKILL`, use the command, or copy `-wal` with the file.
  - Restore: stop the api; replace `pulse.db` with the backup; delete `pulse.db-wal` and
    `pulse.db-shm` if present (a stale WAL must not be applied to another file); start. A backup
    from an older version is migrated at start; a file with a newer schema version is refused
    with exit code 2 (link to Schema). With Compose: the file is in the `api-data` volume.
  - The `-wal` growth during a long backup (1.6).
- Lines 25, 56 and 60 link to "Backup and restore".
- README.md: one line for the `backup` script under the run/usage text if README lists scripts.
- `AGENTS.md` (repository): add `bun run backup <file>` to the commands table.
- `src/docs-claims.test.ts`: pin that `docs/operation.md` no longer matches
  `/does not set a journal mode/` nor `/the API has no backup command/`, and matches
  `/bun run backup/` and `/pulse\.db-wal/`.

## Risks

- WAL on an unsupported file system: handled by 1.4 (log and continue).
- A stale `-wal` applied to a restored file: prevented by the restore steps (delete first).
- `synchronous = NORMAL` can lose the last transactions after power loss. Accepted by the issue.
  Probes re-send buffered results and `POST /results` is idempotent, so lost results are mostly
  re-sent.
- Disk: the backup is a full copy; `-wal` grows while a backup runs.
- Subprocess tests are slower and use real time. They add to `test_cpu_s` (budget 4.1 s). Keep
  the load test small (see the tests below).
- Concurrency test flakiness on slow CI: the 50 ms bound is on one read of a few rows; it is
  generous for an in-process read and not based on a timer.

## Acceptance evidence

Tests (all in `mkdtemp` directories, cleaned up):

1. `src/db.test.ts`: `openDb(<temp>/pulse.db)` gives `PRAGMA journal_mode` = `wal` and
   `PRAGMA synchronous` = `1`. `openDb(":memory:")` gives `journal_mode` = `memory` and
   `synchronous` = `2` (unchanged). A file made in `delete` mode is `wal` after `openDb`.
2. `src/db.wal.test.ts` (concurrency): two connections from `openDb` on one temp file. The
   writer runs `BEGIN EXCLUSIVE` and inserts results through `createService(writer).ingest` or
   plain `INSERT`s, and stays open. The reader sets `PRAGMA busy_timeout = 0` and calls
   `createService(reader).listChecks()` (default options: no availability targets, so the read
   path only runs `SELECT`s; if it is found to write, run the same `SELECT`s directly) and
   `listCheckStates()`. Assert: no error, the reader sees the last committed rows (not the open
   transaction's), and the time measured with `performance.now()` around the reads is under
   50 ms. This test reads the clock only to measure, never waits on it: the documented exception
   to the no-real-clock rule, stated in a comment.
3. `src/backup.test.ts` runs `bun src/backup-main.ts` as a subprocess (`Bun.spawn`/`spawnSync`
   with `process.execPath`, `PULSE_DB` set in its env). Real processes are needed because
   `bun:sqlite` is synchronous: a writer in the test thread cannot run during `VACUUM INTO`.
   This is the second documented exception (real processes; waits are event-driven, never a
   fixed sleep):
   - Quiet point: seed a file with `openDb` (checks, some results, one incident), close nothing.
     Run the backup. Exit 0; the backup opens with `openDb`, `PRAGMA integrity_check` = `ok`,
     its counts of `checks`, `results`, `incidents` and `user_version` equal the source's and the
     printed line. No temp file is left in the target directory.
   - Under load: spawn a writer subprocess (a small script written to the test's temp dir, or a
     fixture file next to the test) that inserts results in small transactions in a loop and
     prints one line after each commit. Wait until it reports at least N rows (event-driven: read
     its stdout). Record `before` = source count. Run the backup. Stop the writer (kill, then
     await exit), record `after`. Assert exit 0, `integrity_check` = `ok`, and
     `before <= backup results <= after`. Keep it small: at most about 1 s of writer time.
   - Errors: an existing target gives exit 2 and is unchanged (byte-equal); no argument gives
     exit 2; a missing source gives exit 1 and the source is not created; a missing target
     directory gives exit 1. No temp file is left in any case.
4. Mutation evidence in the PR: with the two pragmas removed, test 1 and test 2 fail
   (test 2 with `database is locked`). Paste both outputs.
5. Docs claims test (3) passes.
6. `bun run check` green, `bench:selftest` green, `compose-e2e` green.
7. Manual check: run the stack (or `bun start`), run `bun run backup /tmp/b.db` while it serves,
   paste the output line.
8. Bench A/B numbers in the PR (see Performance impact).

## Performance impact

Metrics of `bench/budgets.json` (api) the change can move:

- `load_cpu_s` (gating, budget 28.1): expected equal or lower. WAL with `synchronous = NORMAL`
  syncs on checkpoints, not on every commit; 30 `POST /results` per second are 30 commits per
  second. Checkpoints add some work. Expected change: within ±5 %.
- `startup_cpu_ms` (gating, budget 325): two pragmas and, on the first start of an existing
  file, the conversion to WAL. Expected: no measurable change (< 5 ms).
- `idle_rss_mib`, `peak_rss_mib` (gating, 88 / 115): the `-shm` wal-index is a small shared
  mapping (32 KiB per 4096 frames). Expected: below 1 MiB more.
- `test_cpu_s` (gating, budget 4.1): goes up. The subprocess tests start two or three Bun
  processes per case (~50-100 ms CPU each). Expected: +0.5 to +1.0 s. The implementer measures
  `bun run test` CPU before and after (`/usr/bin/time -v bun run test`, user + sys) and keeps the
  increase under 1 s by keeping the subprocess cases few (combine the error cases into one
  spawned run where possible). If it would cross the budget, report it in the PR instead of
  loosening the budget.
- Reported: `p95_post_results_ms` expected lower (fewer fsyncs); `p95_get_checks_ms`,
  `p95_get_latency_ms`, `p95_get_check_latency_ms` and `rps` unchanged or better (one process,
  one connection: no in-process reader/writer overlap); `startup_wall_ms` unchanged; `image_mb`
  unchanged (one small source file).

Measurement: `bun bench/run.ts --a <main sha> --b <branch sha>` (a local run is fine; it warns
that numbers compare on one machine only). Side A seeds a rollback-journal file and side B a WAL
file through their own `openDb`; `seed.ts` checkpoints with `TRUNCATE` and closes, so
`stack.ts` copying only `pulse.db` stays correct. The `api-data` directory is 0777, so the
container user can create `-wal`/`-shm`. No harness change. The PR states the A/B medians of
`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib` and `test_cpu_s`.

## Security impact

Security impact: yes. The backup command writes a file at an operator-given path and prints
error text with paths and SQLite messages; no route, auth, dependency, Dockerfile or CI change.

Checklist items that apply:

- Atomic, path-safe writes: temp file in the target's directory, never overwrite an existing
  target (`link` with `EEXIST`; `lstat` so a symlink at the target counts as existing), temp
  removed on every error, the target path bound as an SQL parameter (a path with `'` cannot
  inject SQL).
- Secrets in errors and logs: error lines carry paths and SQLite messages only, never env values
  or file contents; no stack.
- Input validation: argument count, empty argument, missing source (not created), missing
  directory.
- The source is opened read-only; the command can never write to or migrate the live database.

## Rollout order

One repository: only the api changes. Probes, status and notify talk to it over HTTP and see no
change. An older api binary opening a WAL file works (SQLite 3.7+ reads WAL; the mode is in the
file), so a rollback to the previous image keeps working on the same volume.

## Counterexamples

- `openDb(":memory:")` or `openDb("")` set WAL: wrong; `journal_mode` must stay `memory`
  (or the temp default) and `synchronous` 2.
- Setting `journal_mode = WAL` inside `migrate()`'s transaction: SQLite refuses the change
  there; the pragma must run before `BEGIN IMMEDIATE`.
- A concurrency test whose writer uses `BEGIN` or `BEGIN IMMEDIATE`: it passes in rollback mode
  too and proves nothing. It must use `BEGIN EXCLUSIVE` with the reader at `busy_timeout = 0`.
- A reader with a default or non-zero `busy_timeout` in that test: in rollback mode it would
  wait instead of failing, and the 50 ms bound would be the only signal. Use 0.
- `bun run backup /data/pulse.db` (the live file as target): the target exists, exit 2, nothing
  changes.
- Target `/backups/b.db` exists as a symlink to `/data/pulse.db`: exit 2 (`lstat`), the link and
  the live file are unchanged.
- Target appears between the existence check and the publish: `link` fails with `EEXIST`,
  exit 2, the other file is unchanged, temp removed. A plain `rename` would overwrite it.
- Target `/nope/b.db` with `/nope` missing: exit 1, nothing created.
- `PULSE_DB=/data/missing.db`: exit 1 and `/data/missing.db` is not created (a default
  read-write open would create an empty database and "back it up").
- Target path `it's.db`: works; a spliced `VACUUM INTO 'it's.db'` would be a syntax error.
- Backup counts printed from the source after the copy: wrong under load (the writer has moved
  on); the counts come from the backup file.
- Load test assertion `backup results == source results`: wrong; under load the rule is
  `before <= backup <= after`. Equality is required only at the quiet point.
- Using `openDb` on the live source for the backup: wrong; it migrates (writes) and would refuse
  a newer schema. The backup opens read-only and accepts any schema version.
- Restore without deleting `pulse.db-wal`: SQLite may replay the old WAL frames onto the
  restored file. The docs must order: stop, replace, delete `-wal`/`-shm`, start.
- Restoring a backup with `user_version` above the program's steps: start refused, exit 2.
- Exit codes: usage and existing target 2; everything else 1; success 0. A `VACUUM` failure that
  exits 2, or a refused target that exits 1, is wrong.
- Statistics: none beyond the 50 ms bound in test 2, which is one measured duration
  (`performance.now()` after minus before) of one `listChecks()` plus one `listCheckStates()`
  call, not a percentile.

## Contract fields

No new contract fields, keys or routes. New names are local to the api: the `package.json`
script `backup`, the files `src/backup.ts` and `src/backup-main.ts`. `PULSE_DB` is reused.

Search of the contract and config clones:

```text
$ grep -rni 'backup' .repos/contract/src
(no output)
$ grep -rni 'backup' .repos/config --include=*.ts --include=*.json
(no output)
$ grep -rn '"backup"' .repos/api/package.json
(no output)
```

## Repository: api

Files:

- `src/db.ts` (change: journal settings before `migrate()`)
- `src/backup.ts` (new: backup logic)
- `src/backup-main.ts` (new: command entry)
- `package.json` (change: `backup` script)
- `src/db.test.ts` (change: WAL and synchronous assertions)
- `src/db.wal.test.ts` (new: concurrency test)
- `src/backup.test.ts` (new: backup tests; a writer fixture script if not generated in the temp
  dir)
- `src/docs-claims.test.ts` (change: pinned doc claims)
- `docs/operation.md` (change: Database text, Backup and restore, links)
- `README.md` (change only if it lists scripts or backup text)
- `AGENTS.md` (change: commands table)

Behavior: Required behavior 1, 2 and 3 above.

Checks: Acceptance evidence 1-7, with TDD order: write tests 1 and 2 first and show them failing
on `main` (mutation output in the PR), then implement.

Completion evidence in the PR: the mutation outputs, `bun run check` result, the manual backup
output line, the `test_cpu_s` before/after, the bench A/B medians of `startup_cpu_ms`,
`load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, CI and `compose-e2e` green. An optional
compose-e2e step that runs `docker compose exec -T api bun run backup /data/e2e-backup.db` and
checks exit 0 may be added if it costs under 5 s; it is not required.
