# Spec #853: api writes the checks file through the kit atomic-write helper

## Goal

Issue #555 required the API to write its configuration file with the atomic-write helper of
pulse-kit. That part never landed. The API still has its own copy of the write: `fillTemp`,
`writeTemp` and `fsyncDir` in `src/config-fs.ts:25–76`, called through `WriteFs.writeTemp` and
`WriteFs.fsyncDir` in `src/config-write.ts:44–60,449–511`. This change makes the API's
checks-file writer call `writeFileAtomicSync` from the pinned kit. It removes the local write loop
and the local mode, owner and temp-file handling, and it keeps everything the protocol guarantees
today.

"Configuration files" means the checks file written by component writes, which is the only file
write path (`FileKind = "component"`, `src/config-write.ts:23–24`). Check and maintenance writes go
to SQLite. Token files are only read. Exports are HTTP responses. None of these change.

## Sources and recorded bases

- Issue #853, its one comment (the Factory issue-review run), and `.factory/work/853/issue-review.md`.
  The plan follows that review, including its six-file scope, its documentation inventory and its
  acceptance checks 1–7. It adds the concrete design and the checks below.
- Approved spec `.factory/work/555/plan.md`. Its API section describes a simpler store routine
  than current main. The API has since gained a durable pending-audit protocol, so that recipe is
  stale. This spec replaces it for the API part. Nothing else from #555 is redone (no kit, timer,
  logger, shutdown or other-service work).
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/853` returned
  `HTTP 404` on this run, which means no findings exist yet.
- API clone `.repos/api` at `a7e9c844f659b9ae536b60cca145cbd5b9d3efba` (main). I read `AGENTS.md`,
  `package.json`, `bunfig.toml`, `biome.json`, `eslint.config.js`, `.github/workflows/ci.yml`,
  `src/config-fs.ts`, `src/config-write.ts`, `src/config-reload.ts` (`ReloadFs`), `src/start.ts:85,306`
  and the four affected suites in full or in the relevant parts.
- Kit: the API pins `@lorenzh/pulse-kit` at `github:lorenzh/pulse-kit#c6d2cba7d90c981b884dcac2a9288dd9eccad8b5`
  (`package.json` `dependencies`, `bun.lock:9,81`). `bun install --frozen-lockfile` of the API base
  installed that pin. Its `dist/atomic-write.js` has git blob `979f71a70c66f407d9a13fe0e394bd87857e1c39`,
  which is identical to the kit clone at `536133f`. Its `dist/index.js:2` exports
  `AtomicWriteError, nodeAtomicWriteFs, nodeAtomicWriteSyncFs, writeFileAtomic, writeFileAtomicSync`,
  and `dist/index.d.ts:2` also exports the type `AtomicWriteSyncFs`. No newer kit pin is needed.
- Every implementation task records its own `BASE` (the API `main` SHA at its start). The SHAs above
  are evidence for this spec. They are not a promise that main will not move.

## What the pinned kit helper does (the facts the design relies on)

From `dist/atomic-write.js` at the pin (line numbers are from the clone, whose bytes are identical):

1. `stat(path)` of the destination (ENOENT means "new file", any other error throws
   `AtomicWriteError("write")`) (`:88–97,165`).
2. `open(temp, "wx", plan.mode)`, where `plan.mode` is the destination mode `& 0o7777`, or
   `opts.mode ?? 0o600` for a new file (`:70,170`). A failed open removes nothing (`:172–175`).
3. A write loop until all bytes are written, then `fchmod(fd, plan.mode)`, then
   `fstat`/`fchown` to the destination owner when it differs (only `EPERM` is tolerated), then
   `fsync(fd)`, then `close(fd)`. Any failure closes the fd, unlinks the temp and throws
   `AtomicWriteError("write")` (`:106–144`).
4. `beforeRename()`. If it throws, kit unlinks the temp and rethrows the same error unwrapped
   (`:177–184`). If it returns `false`, kit unlinks the temp and returns `false` (`:185–188`).
5. `rename(temp, path)`. If it throws, kit unlinks the temp and throws
   `AtomicWriteError("rename")` (`:189–195`).
6. Directory sync: `open(dirname(path), "r")`, `fsync`, `close`. A failure throws
   `AtomicWriteError("sync-dir")` (`:145–158,196`).
7. The temp name is `` `${path}.${opts.tempSuffix()}.tmp` `` (`:74–76`). That is the same formula
   the API uses today (`src/config-write.ts:501`).
8. `AtomicWriteError` keeps the original error as `cause` and sets `code` only for codes that
   match `/^E[A-Z0-9]+$/` (`:4–31`).

There are two gaps against the API protocol, and the design closes both through injection:

- Kit opens the temp with the destination mode, while the API creates it with `0600` and only
  then applies the final mode (`src/config-fs.ts:52`).
- Kit unlinks the temp whenever `beforeRename` throws or the rename fails. The API must keep the
  temp file while a pending audit row may name it, because the temp is the recovery evidence
  (`src/config-write.ts:383–401,488–496`).

## Scope

- Only the API repository changes, in exactly six files (see `## Repository: api`).
- Kit, contract, config and the other services do not change. No pin changes.

## Non-goals

- No change to file format (JSON with two-space indent and a trailing newline), precedence, reload,
  HTTP status codes, error texts, warn texts, metrics, audit rows or the crash model.
- No change to `src/backup.ts` (its publication rename is a separate mechanism), `src/start.ts`,
  `src/config-reload.ts`, `src/audit-log.ts`, the database writers or any document.
- No kit change. Kit exports no standalone directory-sync function, and the API needs two
  directory syncs that kit does not perform (see "Directory sync barriers"). The API composes them
  from the injected kit filesystem operations `open`/`fsync`/`close`. That is an ordering barrier
  for the audit protocol, not an atomic-write implementation.

## Required behavior (api)

### Filesystem surface

`WriteFs` (`src/config-write.ts`) becomes:

```ts
export interface WriteFs {
  readFile(path: string): Buffer;
  /** Throws (`ENOENT` and others) when `path` cannot be looked up. */
  lstat(path: string): void;
  /** Throws when `dir` is not writable. */
  assertWritable(dir: string): void;
  /** The low-level operations of the kit atomic writer; the writer's directory syncs use them too. */
  atomic: AtomicWriteSyncFs;
}
```

- `writeTemp`, `fsyncDir`, `rename` and `remove` are removed from `WriteFs`. The rename now
  happens through kit with `atomic.rename`, and every temp removal goes through `atomic.unlink`.
  So each file operation has exactly one injection point, and fault tests on `atomic.*` cover both
  kit's calls and the API's calls.
- The kit ops sit under `atomic` because their names collide with `ReloadFs` (`stat` returns a
  `FileStamp` there and a `{ mode, uid, gid }` in kit). `nodeConfigFs` is typed `ReloadFs & WriteFs`
  (`src/config-fs.ts:79`).
- `nodeConfigFs` becomes exactly `{ stat, readFile, lstat, assertWritable, atomic }`, with
  `atomic: nodeAtomicWriteSyncFs` imported from `@lorenzh/pulse-kit`. That is the same object
  reference, not a copy.
- `src/config-fs.ts` no longer defines `fillTemp`, `writeTemp`, `fsyncDir` or `codeOf`. From
  `node:fs` it imports only what the remaining members need (`accessSync`, `constants`,
  `lstatSync`, `readFileSync`, `statSync`).
- `src/start.ts`, `src/config-reload.initial.test.ts` and `src/server.maintenance-admin.test.ts`
  keep compiling unchanged. They use `ReloadFs & WriteFs` by type, `nodeConfigFs` by spread, and
  `assertWritable` by override (`src/start.ts:85,306`, `src/server.maintenance-admin.test.ts:462–467`).

### The store step

`store` in `src/config-write.ts` calls `writeFileAtomicSync(path, data, { fs: kitFs, tempSuffix, beforeRename })`
exactly once per write. `path` is `deps.path` as today, so it may be relative.

1. `const suffix = deps.tempSuffix()` is called once. Then `temp = ${path}.${suffix}.tmp`,
   `tempPath = resolve(temp)`, and `tempSuffix: () => suffix` is passed to kit, so kit and the API
   name the same file.
2. A per-write adapter `kitFs: AtomicWriteSyncFs` spreads `fs.atomic` and overrides exactly three
   operations:
   - `open(p, flags, mode)`: for `flags === "wx"` it calls `fs.atomic.open(p, "wx", 0o600)`.
     Otherwise it passes the call through unchanged. Kit's `fchmod` then sets the final mode, as
     the local code did.
   - `rename(from, to)`: it calls `fs.atomic.rename(from, to)` and then the fault point
     `rename`, only after the rename returned.
   - `unlink(p)`: it does nothing once a pending row may exist for this write, or once a fault
     hook has thrown during this write. Otherwise it calls `fs.atomic.unlink(p)`. From that moment
     the API's `abort` owns the temp removal, in its durable order (row deleted first).
   - The adapter does not re-implement `write`, `fchmod`, `fstat`, `fchown`, `fsync`, `close` or
     `stat`: they come from the spread.
3. `beforeRename` runs the API steps between "temp written" and "rename" in today's order. It
   either returns `true` or throws, and the boolean result of `writeFileAtomicSync` is not used.
   1. fault `writeTemp`
   2. directory sync of `dirname(path)` through `fs.atomic` (barrier 1). A throw here propagates
      raw. Kit then unlinks the temp, which is allowed because no row can exist yet. That
      reproduces today's "remove temp, report the mapped error" (`src/config-write.ts:458–466`).
   3. fault `fsyncDir.temp`
   4. mark "a pending row may exist" before calling `pending.insert(entry, tempPath)`, because
      an insert can commit and then throw. On a throw: `abort(temp, tempPath, "abort")`, then
      throw `ConfigWriteError("error", AUDIT_WRITE_FAILED, { cause })`.
   5. fault `pending.insert`
   6. `assertCurrent(ifMatch)`. On a throw: `abort(...)`, then rethrow the same error.
4. After `writeFileAtomicSync` returns: fault `fsyncDir`, then promote, adopt and the
   `AUDIT_PENDING` check, unchanged (`src/config-write.ts:512–525`).
5. On a throw from `writeFileAtomicSync`:
   - If a fault hook threw during this write (only test hooks throw), rethrow that hook's error
     unchanged, with no further filesystem or database step. A simulated power loss stays a crash.
   - Else, if it is an `AtomicWriteError` with `stage === "rename"`, run `lstatCode(fs, temp)`,
     then fault `lstat`, then `abort(...)` only when the temp is still present (code `undefined`),
     then throw the mapped error. This is today's `src/config-write.ts:490–496`.
   - Otherwise throw `mapFsError(err)`.
6. `mapFsError` passes a `ConfigWriteError` through unchanged, as today. For an `AtomicWriteError`
   it uses the error's `cause` for the code (with the existing `codeOf`) and as the new `cause`. So
   the message and status are byte-identical to base for every cause, including codes that kit's
   `/^E[A-Z0-9]+$/` filter would drop. Messages keep their two forms:
   `checks file is read-only (<code>)` (`readonly`, for EROFS, EACCES, EPERM, EBUSY, EXDEV) and
   `checks file could not be written (<code>)` (`error`). Neither message ever contains kit's text
   `atomic write failed at …`.
7. The fault hook names stay exactly: `writeTemp`, `fsyncDir.temp`, `pending.insert`, `rename`,
   `lstat`, `fsyncDir`, `promote`, `abort.delete`, `abort.remove`, `resolver.lstat`,
   `resolver.delete`, `resolver.remove`, `resolver.fsyncDir`, `resolver.promote`. A crash at a
   point has the same disk and database state as on base.

### Directory sync barriers

- The API keeps a small local `syncDir(f: AtomicWriteSyncFs, dir: string)` helper in
  `src/config-write.ts`: `open(dir, "r")`, `fsync`, `close` in `finally`. It has two uses: barrier 1
  above, and the resolver's sync before promoting (`promoteAll`, `src/config-write.ts:414–427`).
  Both use `fs.atomic`. Kit performs the post-rename sync (barrier 2). The API no longer calls a
  directory sync after the rename itself.
- `abort` removes the temp with `fs.atomic.unlink(temp)` (previously `fs.remove`), with the same
  order, warn texts and fault points.
- `resolvePending`, `promote`, `abort`, `assertWritable`, `view`, `apply` and the lock are
  otherwise unchanged.

### Invariants kept (from the issue review, points 3–7)

- Temp file: `<path>.<suffix>.tmp` in the same directory, exclusive create (`wx`), created at
  `0600`. The final mode is the destination mode `& 0o7777`. The owner is copied when it differs,
  and only `EPERM` is tolerated. Writes are full writes, followed by file `fsync` and `close`. A
  colliding name is never removed, because it may be another writer's file.
- Crash model and audit: everything in `docs/operation.md:193–201` and the existing audit and crash
  suites. That includes the absolute temp path in the pending row, delete-before-unlink, a kept
  temp when the delete fails, and a kept row when a rename moved the file and then threw.
- Timing: no early adoption, and nothing is applied before barrier 2 succeeds. After a
  post-rename sync failure, the new disk bytes, the old applied state, the old revision and the
  pending row stay.
- No `await` or other async gap inside the store, which stays synchronous under the lock.

## Performance impact

API `bench/budgets.json` keys:

- `test_cpu_s` (gating): the same number of filesystem syscalls per component write, plus a few
  function calls through the adapter and the kit wrapper, and the extra regression tests in
  `src/config-fs.test.ts` (a handful of real-directory writes, each well under 50 ms). The expected
  delta is under +0.1 s, which is within noise. It can only go up, and only slightly.
- `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `startup_wall_ms`, the p95 keys,
  `rps`, the cold-read keys and `image_mb`: none expected. Kit's `atomic-write` module is already
  loaded at startup through the kit root import (`import { isRecord } from "@lorenzh/pulse-kit"`
  in `src/config-write.ts:10`, and `dist/index.js:2` re-exports `./atomic-write.js`). The bench load
  makes no admin writes, the image already contains the kit, and no file is added.
- Measurement, reported as information and not as a gate: run interleaved `base, branch, base,
  branch, …` (5 pairs) on identical installs (`bun install --frozen-lockfile`, Bun 1.4.0), with
  `TIMEFORMAT='%U %S'; time bun test --config=/dev/null src/config-fs.test.ts src/config-admin.test.ts src/config-write.audit.test.ts src/config-write.crash.test.ts`
  and also `time bun run test`. Test CPU per run is user + system seconds of that command. Report
  all raw samples, the median per side and `median(branch) − median(base)`. Report the
  branch-only regression tests separately (their own `time bun test --config=/dev/null --test-name-pattern "<title>" src/config-fs.test.ts`).
  Do not run the Docker bench (`bun bench/run.ts`), because of the host port collision tracked in
  #834.

## Security impact

Security impact: yes
The change touches file writes: the atomic, exclusive, permission-preserving replace of the
checks file and its temp-file cleanup.

Checklist items that apply:

- **Atomic, path-safe writes.** The temp stays in the destination directory with the same name
  rule. `wx` (O_CREAT|O_EXCL) refuses an existing file or a symlink at the temp name and removes
  nothing. Kit's first syscall on the temp is the exclusive open, so no write follows a link. The
  temp is created at `0600` before any byte is written. The final mode and owner come from the
  destination. A failed write leaves the old bytes. The rename stays atomic within one directory.
- **Secrets in errors, logs and responses.** Response and log texts name only an error code: no
  path, no content and no kit message (`atomic write failed at <stage>` is never surfaced). Warn
  lines stay code-only (`audit pending entry kept (<code>)`, `config temp file not removed (<code>)`,
  `audit pending entry unresolved (<code>)`).
- **Dependency pins.** The kit pin stays `c6d2cba7d90c981b884dcac2a9288dd9eccad8b5`, and
  `package.json` and `bun.lock` are protected. No dependency is added.

Hostile inputs for the security state: a pre-existing regular file at the temp name, a symlink at
the temp name pointing at a file outside the directory, a destination with mode `0640` or `0444`,
a destination owned by another uid (with `fchown` returning `EPERM` and `EINVAL`), a read-only
directory (`EROFS`), `EXDEV` on rename, and a `stat` failure (`ENOTDIR`, `EACCES`) before anything
is created.

## Rollout order

One repository: only `api` changes. It already pins the kit commit that contains the helper. No
other service consumes `WriteFs` or `nodeConfigFs`, and nothing crosses an HTTP or contract
boundary.

## Counterexamples

Each line is an input, and what a wrong implementation would do.

1. **Insert commits, then throws.** A plain `beforeRename` throw would let kit unlink the temp
   while the row exists. The rule: the row is deleted first (`rowsAtRemove` stays `[0]`), then the
   temp is removed, and the answer is `error: audit log could not be written`.
2. **Abort delete fails** (`deleteByTemp` throws `SQLITE_IOERR` after a rename failure). Kit's
   default cleanup would delete the temp, and recovery would then promote a write that never
   happened. The rule: the temp `/d/checks.json.t1.tmp` stays, the row stays, the warn is
   `audit pending entry kept (SQLITE_IOERR)`, and the next write drops both.
3. **Rename moves the file, then throws EIO.** Kit's cleanup would try to unlink the (gone) temp,
   and a naive API would `abort`. The rule: no unlink and no `deleteByTemp`. The row stays, and the
   next write promotes it.
4. **Simulated power loss at `fsyncDir.temp` or `pending.insert`.** Kit's `beforeRename` cleanup
   would unlink the temp after the "crash". The rule: after the hook throws, no fs or db call
   happens. In the real-file case the row's absolute temp path survives, and a restart from
   another working directory drops it (`src/config-write.audit.test.ts:483–530` stays green).
5. **Power loss at `rename`.** The hook runs inside the adapter. Kit wraps it as a rename failure
   and the API must not `lstat`/`abort`. The rule: the hook's own error propagates
   (`attempt()` returns `"crashed"`).
6. **Foreign file at the temp name.** The rule: the answer is
   `error: checks file could not be written (EEXIST)`, the foreign bytes are unchanged, the
   checks file is unchanged, and no pending row is written. A symlink at the temp name gives the
   same answer, and its target's bytes are unchanged.
7. **Destination `0640`.** Final mode `0640`. The temp right after its creation is `0600`, not
   `0640`. That is observed by `fstat` on the created fd before any write, under the runner umask
   `0022` (verified on this run). A kit default open would show `0640` there.
8. **Stale ConfigWriteError from the second revision check** (hand edit between the temp and the
   rename). The rule: HTTP `412` with the stale message. It must not be remapped to `500` or
   `error`, and the edit stays on disk with no temp left.
9. **Error text.** A rename `EIO` answers exactly `checks file could not be written (EIO)`, and
   `EXDEV` answers `503` with `(EXDEV)`. Never `atomic write failed at rename (EIO)`.
10. **Local writer comes back.** Restoring `src/config-fs.ts` and `src/config-write.ts` from `BASE`,
    or adding back a `writeSync`/`fchmodSync`/`fsyncSync` loop to either file, makes the new
    regression tests fail.
11. **Unused import.** Importing `writeFileAtomicSync` without calling it, while a local loop still
    writes, fails the runtime delegation test: the injected `atomic` recorder sees no kit call
    sequence.
12. **A directory sync removed "to make the search empty".** Dropping barrier 1 or the resolver
    sync makes the audit order literals and the crash rows fail (for example "first fsyncDir
    (temp name)").

Statistics: the only number is the informational test-CPU delta, defined in `## Performance impact`
(user + system seconds per run, medians of 5 interleaved runs per side, the difference of the
medians). It is never a percentile and never gating.

## Contract fields

No new names in the contract, the config package or any HTTP shape. The only new identifier is
the internal TypeScript property `WriteFs.atomic` in the API. Searches on this run found no
collisions:

- `grep -rn "atomic" .repos/contract/src` → no output (contract `6370c25`).
- `grep -rn "atomic" .repos/config --include=*.ts --include=*.json` → no output (config `bc87049`).
- `grep -rn "\batomic\b" .repos/api/src` → no output (api `a7e9c84`).

## Repository: api

Files:
- `src/config-fs.ts`
- `src/config-write.ts`
- `src/config-fs.test.ts`
- `src/config-admin.test.ts`
- `src/config-write.audit.test.ts`
- `src/config-write.crash.test.ts`

Behavior change: no
This is an internal refactor. The writer delegates to kit, and every observable behavior (bytes,
modes, owner, statuses, messages, warn lines, audit rows, crash recovery) stays the same.

Because nothing documented changes, no README or docs change is needed. `README.md` and every
`docs/*.md` are protected paths (see the inventory below).

### Tool facts (verified)

- Bun `1.4.0`: `package.json` `engines.bun` and `packageManager: "bun@1.4.0"`. Locally,
  `bun --version` printed `1.4.0`. CI uses `bun-version: 1.4.0` in pulse-config
  `.github/workflows/check.yml:22–24`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json` `scripts.check`).
  `lint` = `biome check . && pulse-eslint . && pulse-workflows`. `typecheck` =
  `bun node_modules/typescript7/bin/tsc --noEmit`, with `typescript7` = `npm:typescript@7.0.2`.
  `@biomejs/biome` is `2.6.3`.
- Coverage: `bunfig.toml` `[test]` sets `coverage = true` and
  `coverageThreshold = { lines = 0.8, functions = 0 }`. Focused runs use `--config=/dev/null`.
  Three runs on base printed no coverage table and exited 0 (see the baselines below).
- Biome: `biome.json` only `extends` `@lorenzh/pulse-config/biome.json`. The pinned file at
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (the pin in `package.json` and in `ci.yml:19`) has
  `files.includes` `["**", "!**/dist", "!**/node_modules", "!**/bun.lock", …]` (`biome.json:8–14`),
  and an override for `**/*.test.ts` that turns `noNonNullAssertion` off (`:55–59`). It is
  byte-identical to the config clone.
- ESLint: `eslint.config.js` spreads `@lorenzh/pulse-config/eslint.config.js` and ignores `.repos/**`,
  `.bench/**` and `bench-out/**`. API `AGENTS.md` states the SonarJS cognitive-complexity limit of
  15 per function. Split `store` into helpers if needed, without weakening the rule.
- CI: `.github/workflows/ci.yml` job `check` `uses: lorenzh/pulse-config/.github/workflows/check.yml@04108fa0…`.
  The pinned `check.yml` (byte-identical to the clone) runs `bun install --frozen-lockfile`,
  `bun run lint`, `bun run typecheck` and `bun run test` (`:25–38`).
- Typecheck of the kit imports: a scratch module in a throwaway copy of the base, importing
  `AtomicWriteError, type AtomicWriteSyncFs, nodeAtomicWriteSyncFs, writeFileAtomicSync` from
  `@lorenzh/pulse-kit` and building an adapter with an `open` override, passed
  `bun run typecheck` (exit 0). The copy was deleted.

### Baselines on the recorded base `a7e9c84` (run three times each on this run, all exit 0)

Install: `bun install --frozen-lockfile` (121 packages, kit `c6d2cba`, contract `1b5e7d3`).

| Control | Command | Result (each of 3 runs) |
| --- | --- | --- |
| fs suite | `bun test --config=/dev/null src/config-fs.test.ts` | exit 0, 3 pass, 0 fail, 9 expect() calls |
| admin suite | `bun test --config=/dev/null src/config-admin.test.ts` | exit 0, 62 pass, 0 fail |
| audit suite | `bun test --config=/dev/null src/config-write.audit.test.ts` | exit 0, 17 pass, 0 fail, 78 expect() calls |
| crash suite | `bun test --config=/dev/null src/config-write.crash.test.ts` | exit 0, 45 pass, 0 fail, 180 expect() calls |
| initial read (unchanged file) | `bun test --config=/dev/null src/config-reload.initial.test.ts` | exit 0, 4 pass, 0 fail |
| maintenance admin (unchanged file) | `bun test --config=/dev/null src/server.maintenance-admin.test.ts` | exit 0, 18 pass, 0 fail |
| full check | `bun run check` | exit 0, 919 pass, 0 fail across 100 files, line threshold met |

The implementer repeats these on their own `BASE` (three runs each) before the first edit. If a
count differs because main moved, they record the new literal from that base run and use it in
place of the one above. None of these files is known to be flaky. If one is flaky on `BASE`, it is
reported and not made a mandatory control.

### Implementation

As in `## Required behavior (api)`. Code rules from API `AGENTS.md`: `import type` for types
(mixed imports mark the types inline), `.ts` relative imports, no `any`, no `!` in `src/`, named
exports, and comments only for non-obvious order. The adapter's `unlink` guard and the `0600` open
each need a one-line "why" comment.

### Tests

**`src/config-fs.test.ts`:** migrate the three tests and add the regressions.

- R1, runtime delegation (new, must fail on `BASE`). In a `mkdtemp` directory, write `checks.json`
  (a valid file with one check), `chmod 0640`, and run one component create through
  `createConfigWriter` with `fs: { ...nodeConfigFs, atomic: recorder }`. The recorder wraps
  `nodeAtomicWriteSyncFs` and logs each call. After an `open` with `"wx"` it records
  `fstatSync(fd).mode & 0o777`. Expected, with consecutive `write` entries collapsed:
  `["stat", "open wx 600", "write", "fchmod 640", "fstat", "fsync", "close", "open r", "fsync", "close", "rename", "open r", "fsync", "close"]`.
  The temp mode right after creation is `0o600`. The final file mode is `0o640` and its bytes are
  the new JSON. No `*.tmp` is left. Use an in-memory `PendingAudit` fake or SQLite in the temp
  directory.
- R2, structure guard (new, must fail on `BASE`).
  - `nodeConfigFs.atomic` is (`toBe`) kit's `nodeAtomicWriteSyncFs`.
  - `Object.keys(nodeConfigFs).sort()` equals `["assertWritable", "atomic", "lstat", "readFile", "stat"]`.
  - The sources of `src/config-fs.ts` and `src/config-write.ts` (read with
    `readFileSync(new URL("./<file>", import.meta.url))`) do not match
    `/\b(writeSync|fchmodSync|fchownSync|fsyncSync|openSync|unlinkSync|renameSync)\b/` or
    `/\.(write|fchmod|fchown|fstat)\(/`.
  - `src/config-write.ts` matches `/\bwriteFileAtomicSync\(/`.
  - No non-test `src/*.ts` matches `/\b(writeSync|fchmodSync|fchownSync|fsyncSync|openSync|unlinkSync)\b/`.
    `renameSync` is allowed there because `src/backup.ts:2,157` uses it for its separate
    publication rename.
  - Reading source text is the deliberate exception that the issue asks for ("a test that fails
    if the local writer comes back"). It is combined with R1, so neither an unused import nor a
    relocated loop passes.
- Migrated controls (replacing the old three tests, which call removed functions):
  1. Collision: a foreign file at the temp name (fixed `tempSuffix`) makes the write fail with
     code `error` and message `checks file could not be written (EEXIST)`. The foreign bytes and
     the checks file are unchanged, and no pending row is left. The same holds for a symlink at
     the temp name, whose target bytes are unchanged.
  2. A failure after the create (the recorder's `fchmod` throws `EIO`) fails with
     `checks file could not be written (EIO)`, leaves no temp, no row, and the old bytes.
  3. A `stat` failure before the create (the recorder's `stat` throws `ENOTDIR`) fails with
     `checks file could not be written (ENOTDIR)`, and no `open` is recorded. This keeps the old
     ENOTDIR coverage without relying on the old stat-after-open order.
  4. Owner: when `fstat` reports another uid, `fchown` is called with the destination uid/gid. An
     `EPERM` from it still writes (200 outcome). An `EINVAL` fails with
     `checks file could not be written (EINVAL)` and leaves no temp.
  5. `nodeConfigFs.lstat` throws `ENOENT` for a missing path and returns for a present one.

**`src/config-write.audit.test.ts`:** `MemFs` implements `WriteFs` with an `atomic` member that
logs low-level calls in this format: `stat(p)`, `open(p, wx, 600)` / `open(p, r)` (octal mode
only when one is passed), `write(p)`, `fchmod(p, <octal>)`, `fstat(p)`, `fchown(p, uid, gid)`,
`fsync(p)`, `close(p)`, `rename(a, b)` and `unlink(p)`, where `p` is the path the fd was opened
with. `stat(PATH)` returns `{ mode: 0o100644, uid: 1000, gid: 1000 }`, and `fstat` returns the
same uid/gid (so no `fchown`). `FakePending` counts rows at `atomic.unlink` instead of `remove`.
`fsyncFailures` applies to `fsync` of a directory fd.

- The success-order test asserts `from(log, "stat(")` equals exactly:
  `["stat(/d/checks.json)", "open(/d/checks.json.t1.tmp, wx, 600)", "write(/d/checks.json.t1.tmp)", "fchmod(/d/checks.json.t1.tmp, 644)", "fstat(/d/checks.json.t1.tmp)", "fsync(/d/checks.json.t1.tmp)", "close(/d/checks.json.t1.tmp)", "open(/d, r)", "fsync(/d)", "close(/d)", "pending.insert(durable)", "readFile(/d/checks.json)", "rename(/d/checks.json.t1.tmp, /d/checks.json)", "open(/d, r)", "fsync(/d)", "close(/d)", "pending.promote"]`.
- The rename-failure test asserts the same prefix up to and including the `rename(…)` entry,
  followed by exactly `["lstat(/d/checks.json.t1.tmp)", "pending.deleteByTemp(durable)", "unlink(/d/checks.json.t1.tmp)"]`.
  There is no `unlink` between `rename` and `lstat`, which proves kit's cleanup was suppressed.
  `rowsAtRemove` stays `[0]`.
- Resolver and interleaving tests: every former `"fsyncDir(/d)"` becomes the three entries
  `"open(/d, r)", "fsync(/d)", "close(/d)"`. All other expectations stay literally the same.
- Every other assertion stays the same, apart from the log-format change. Tests that searched
  for `remove(` search for `unlink(` instead. The section from the line
  `// ---- real files and SQLite ----` to end of file is byte-identical to `BASE`.

**`src/config-write.crash.test.ts`:** `CrashFs` implements `WriteFs` through `atomic`.

- `open(temp, "wx")` creates the file and records one `create` change, whose data is the bytes
  written up to `close`. An `EEXIST` is thrown when the file exists.
- `fsync` on a directory fd counts as a directory sync (`syncs`, `failingSyncs`) and makes `live`
  durable. `rename` and `unlink` record their changes as before.
- The section from the line `type Journal = "wal" | "delete";` to end of file is byte-identical to
  `BASE`. That includes every row of `ROWS`, the fault names, the negative control, and
  `expect(changes.length).toBeLessThanOrEqual(3)`.

**`src/config-admin.test.ts`:** move the real-fs overrides to `atomic`:

- `brokenFs`: `fsync-temp` throws `ENOSPC` from `fsync` of the fd opened with `wx`; `rename`
  throws from `atomic.rename`; `fsync-dir` throws on the second `fsync` of a fd opened with `"r"`.
- EXDEV: `atomic.rename` throws `EXDEV`.
- Hand edit: the edit runs in `atomic.close` of the `wx` fd.
- Apply failure: `dirSyncs` counts `fsync` calls on `"r"` fds, still expecting `2`.
- `READ_ONLY_FS`: `atomic.open` with `wx` and `atomic.rename` throw `EROFS`.
- All assertions and test titles stay the same.

### Acceptance (each check names where its expected value comes from)

`BASE` is the API `main` SHA recorded at the start of the task. Commands run in the API checkout
after the last commit, unless stated otherwise.

1. **Full check:** `bun run check` exits 0. Lint, typecheck and tests run, and the `bunfig.toml`
   line threshold (literal `0.8`) is enforced unchanged. Run it three times on the branch, each
   exit 0. The pass count equals the base full-check count (919 on `a7e9c84`, or the count from
   the implementer's `BASE` run) plus the number of tests added to `src/config-fs.test.ts`, minus
   the 3 migrated old tests replaced in that file. Report the arithmetic.
2. **Focused suites** (three runs each, `--config=/dev/null`, exit 0):
   - crash suite: 45 pass (literal; unchanged `ROWS` table).
   - audit suite: 17 pass (literal; same tests).
   - admin suite: 62 pass (literal; same tests).
   - `src/config-reload.initial.test.ts`: 4 pass.
   - `src/server.maintenance-admin.test.ts`: 18 pass.
   - `src/config-fs.test.ts`: exit 0, with at least R1, R2 and migrated controls 1–5 by title.

   If `BASE` differs from `a7e9c84`, the base-run literals from the implementer's baseline table
   apply.
3. **Unchanged regions and titles** (these compare independent artifacts: `BASE` blob against the
   branch file):
   - `diff <(git show "$BASE":src/config-write.crash.test.ts | sed -n '/^type Journal = "wal" | "delete";$/,$p') <(sed -n '/^type Journal = "wal" | "delete";$/,$p' src/config-write.crash.test.ts)`
     produces no output.
   - `diff <(git show "$BASE":src/config-write.audit.test.ts | sed -n '/^\/\/ ---- real files and SQLite ----$/,$p') <(sed -n '/^\/\/ ---- real files and SQLite ----$/,$p' src/config-write.audit.test.ts)`
     produces no output.
   - The test titles of `src/config-admin.test.ts`, `src/config-write.audit.test.ts` and
     `src/config-write.crash.test.ts` are unchanged. This loop produces no output:

     ```sh
     titles() { grep -oE '^ *test\((`[^`]*`|"[^"]*")'; }
     for f in src/config-admin.test.ts src/config-write.audit.test.ts src/config-write.crash.test.ts; do
       diff <(git show "$BASE:$f" | titles) <(titles < "$f")
     done
     ```
4. **Red on base for the stated reason** (new regressions R1 and R2):
   - In a disposable worktree at `BASE` (`git worktree add /tmp/red-853 "$BASE"`, then
     `bun install --frozen-lockfile` there), copy the branch's `src/config-fs.test.ts` in and run
     `bun test --config=/dev/null src/config-fs.test.ts` three times.
   - Each run exits non-zero. R1 fails because the recorder saw no kit sequence (the base writer
     calls `writeTemp`). R2 fails on `nodeConfigFs.atomic` being `undefined` and on the forbidden
     `writeSync` in `src/config-fs.ts`.
   - Report the failing titles and messages. Migrated controls may also fail there because the
     `atomic` surface is missing; say which.
   - Remove the worktree afterwards.
5. **Mutation: the local writer comes back.**
   - (a) On the branch, `git checkout "$BASE" -- src/config-fs.ts src/config-write.ts`, then run
     the focused fs suite: R1 and R2 fail (exit ≠ 0).
   - (b) Restore with `git checkout HEAD -- src/config-fs.ts src/config-write.ts`, then add an
     unused `function fill(fd: number, b: Buffer): void { writeSync(fd, b); }` (with its import)
     to `src/config-fs.ts`: R2 fails.
   - Restore again. `git status --porcelain` is empty afterwards.
6. **Documentation inventory** (rerun at `BASE` and at the final `HEAD`):
   - `grep -rnE "atomic|fsync|rename|temp file|\.tmp|mode|owner|read-only|precedence" README.md docs/*.md`.
   - Each hit is either "unchanged and still true" (proof line from the inventory below) or
     unrelated. Report the list.
   - All nine documents are protected by check 7.
7. **Scope** (allow-list literal: the six `Files:` above):

   ```sh
   ALLOWED='src/config-admin.test.ts
   src/config-fs.test.ts
   src/config-fs.ts
   src/config-write.audit.test.ts
   src/config-write.crash.test.ts
   src/config-write.ts'
   EXCLUDES=$(printf ":(exclude)%s\n" $ALLOWED)
   scope_check() {
     extra=$(git diff --no-renames --name-only "$BASE" HEAD | grep -vxF "$ALLOWED")
     [ -z "$extra" ] || { echo "outside allow-list: $extra"; return 1; }
     [ -z "$(git diff --name-only --cached)" ] || { echo "staged changes"; return 1; }
     [ -z "$(git diff --name-only)" ] || { echo "unstaged changes"; return 1; }
     [ -z "$(git status --porcelain)" ] || { echo "status not clean"; return 1; }
     git diff --quiet --exit-code "$BASE" HEAD -- . $EXCLUDES || { echo "protected path changed"; return 1; }
   }
   scope_check
   ```

   - On the branch it exits 0.
   - The protected set is every tracked path except the six. That explicitly includes
     `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/index.md`, `docs/install.md`,
     `docs/development.md`, `docs/configuration.md`, `docs/operation.md`, `docs/rest-api.md`,
     `docs/concepts.md`, `docs/troubleshooting.md`, `package.json`, `bun.lock`, `bunfig.toml`,
     `biome.json`, `tsconfig.json`, `eslint.config.js`, `lefthook.yml`, `.github/`, `Dockerfile`,
     `bench/`, `scripts/`, `test/`, `src/start.ts`, `src/main.ts`, `src/admin-routes.ts`,
     `src/audit-log.ts`, `src/db.ts`, `src/backup.ts`, `src/config.ts`, `src/config-reload.ts`,
     `src/check-write.ts`, `src/maintenance-write.ts`, `src/effective-checks.ts`,
     `src/effective-maintenance.ts`, `src/config-reload.initial.test.ts` and
     `src/server.maintenance-admin.test.ts`.
   - Fixture proof: in a disposable clone of the API at `BASE` (outside the target checkout, for
     example `git clone -q <api> /tmp/scope-853`), with the same function and `BASE`, each case
     starts from a fresh reset to `BASE`. The expected results are literals:
     - (a) a committed edit of `src/config-fs.ts` → exit 0.
     - (b) a committed edit of `README.md` → exit 1 ("outside allow-list").
     - (c) a staged, uncommitted edit of `README.md` → exit 1.
     - (d) an unstaged edit of `src/config-fs.ts` → exit 1.
     - (e) an untracked file `src/x.ts` → exit 1.
     - (f) stage an edit of `README.md`, then `git restore --worktree --source="$BASE" README.md` →
       exit 1 (the index still differs).
     - (g) commit an edit of `README.md`, then `git restore --worktree --source="$BASE" README.md` →
       exit 1 (the commits differ, and the worktree now differs from `HEAD`).
     - (h) a committed `git mv src/config-fs.ts src/config-fs2.ts` → exit 1.
     - A worktree-only diff is never used as proof. Fixture files stay outside the target change.
8. **Comments:** read every added line of the diff (`git diff "$BASE" HEAD`), inline comments
   included. List every added comment in the PR body, or write "none" only after that full read.
   No new test file is added, so the one-line-per-new-test-file rule does not apply.
9. **Performance:** the interleaved test-CPU report from `## Performance impact`, as information.
10. **Run once:** `bun start` with a writable checks file and an admin token, `POST /admin/components`
    with the current `ETag`. It answers `201`, the file has the new component, the mode of
    `checks.json` is unchanged and no `*.tmp` is left. Report the command and result. This is the
    AGENTS.md "exercise the change once" step, done on a copy in a temp directory.

### Documentation inventory (all "unchanged and still true"; protected)

These line numbers are on `a7e9c84`, verified by reading.

| Document:lines | Claim | Why it stays true |
| --- | --- | --- |
| `README.md:11,58,64` | Components live in the file, file precedence, hot reload and admin routes, audit entries | Only writer internals change |
| `docs/configuration.md:3,11,14,44,216` | Same file, formats, reload interval, precedence, file-window read-only rules | Parser, settings and maintenance code are protected |
| `docs/install.md:47` | Mount the directory, because writes replace the file atomically | Same-directory temp plus rename (kit step 5) |
| `docs/operation.md:23,25,27` | Journal mode, writable database directory, durable audit statements at EXTRA | Database code is protected |
| `docs/operation.md:193–201` | Pending entry before rename, recovery by temp presence, local-fs guarantee, leftover `<checks>.<suffix>.tmp` | Barrier 1, delete-before-unlink, unchanged name rule, crash suite region unchanged |
| `docs/operation.md:215,217,219` | Component file vs database writes, precedence, reload and mount | Unchanged |
| `docs/operation.md:249,251,261,263,265,269` | Mode and owner kept, JSON two spaces, order "temp file, `fsync`, revision check, rename, `fsync` of the directory, then apply", 500/503 after rename with old ETag, logs and metrics | Kit performs temp, `fsync`, rename and directory `fsync`; the API's check and apply are in the same places; messages are byte-identical |
| `docs/operation.md:317` | Warn codes without paths | Warn texts unchanged |
| `docs/rest-api.md:421,433,435,437,441,445,447` | Routing, revision, status precedence, sanitized errors, durable pending audit, exported bytes | Unchanged |
| `docs/rest-api.md:473,484,486,603` | Database maintenance independence, file windows, audit shapes | Protected code |
| `docs/concepts.md:46` | File windows change on apply | Unchanged |
| `docs/troubleshooting.md:162` | Stale component-write diagnosis | Unchanged. Its mention of maintenance writes is an existing, unrelated inaccuracy and stays out of scope |

`docs/index.md` and `docs/development.md` contain no writer claims and are protected anyway.

### Completion evidence for the PR

- The recorded `BASE`.
- The baseline table rerun.
- Acceptance 1–10 with commands, exit codes and pass counts.
- The red-on-base and mutation outputs.
- The scope fixture table.
- The comment list.
- The CPU samples.
- `Closes lorenzh/pulse-meta#<child>`.
