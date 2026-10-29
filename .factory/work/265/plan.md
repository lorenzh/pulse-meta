# Spec: notify ledger races and missing state directory (#265)

Follow-up to #255 (pulse-notify#22, merged). Spec `.factory/work/255/plan.md` (Ledger: durability, lock) stays valid. Only the three fixes below change; do not redo the ledger or lock design.

## Goal
Fix three P2 errors in `notify`: a batched write can erase a durable claim, two stale-lock contenders can both win, and a missing state directory stops startup.

## Scope / non-goals
- Only `notify` changes (`src/ledger.ts`, `src/ledger-lock.ts`, `src/index.ts`, tests, `docs/operation.md`, `docs/troubleshooting.md` if wording is touched). `contract` and the other targets are unaffected.
- `claim`, `seed`, `resend` stay synchronous and fsynced; no signature change, no ripple into `delivery.ts`/`notifier.ts` (the issue review shows "claims wait" would force that).
- No change of the lock file format, lease, heartbeat, or the staleness rules.

## Required behavior (notify)

### 1. Ledger: no write replaces a newer durable state (Option B)
- Invariant: when `#writeSnapshot` settles, the file on disk equals the in-memory state at that moment, and a synchronous write is never undone.
- Ordering that guarantees it: the batch writes its temp file, renames it, and then re-checks the sync-write counter (`#syncWrites`) after the awaited rename, not before. If the counter moved (a sync `claim`/`seed`/`resend` persisted state during the temp write or the rename wait), the batch rewrites the current `#data` synchronously (same code as the sync write: temp, fsync, rename) so the final file holds the newest memory state. Rename is atomic, so whichever of the two renames lands last, the post-rename check plus synchronous rewrite leaves the newest state. The pre-rename check and `unlink(tmp)` discard may stay as an optimisation, but the post-rename check is the correctness rule.
- Because the sync write serialises the whole `#data`, it already contains the batched settles; set `#isDirty = false` after a successful rewrite. On any failure (open, write, sync, rename, rewrite) set `#isDirty = true` and rethrow, so pending settles are not lost. A discard path that returns early must not clear `#isDirty` unless the file now holds the full memory state; otherwise keep it true.
- Temp names stay distinct: sync `<state>.tmp`, batch `<state>.batch.tmp`. Remove the batch temp file on every failure and discard (best effort, ignore ENOENT).
- Test hook: an optional, test-only dependency on `Ledger` (for example `hooks?: { beforeRename?: () => Promise<void> }`, or injected async `fs` ops) that lets a test pause between the temp write and the rename. No production behavior change when absent.

### 2. Lock: serialised stale takeover
- Takeover is guarded by a marker file `<state>.lock.takeover` created atomically with `wx` (content JSON `{pid, hostname, token, at}`), held only during the takeover and removed in a `finally`.
- Sequence in `acquireLock`: `create` with `wx`; on EEXIST read the holder; if live throw `inUse` (unchanged). If stale: take the marker with `wx`. If the marker exists, the contender loses: throw `ConfigError` through `inUse` (exit 2), except when the marker itself is stale (below). With the marker held: re-read the lock, re-check `isStale` on that fresh read (changed holder or now live: release the marker and throw `inUse`; missing: just `create`), then unlink and `create`, then confirm by token read-back as today, then release the marker.
- Stale marker (crashed takeover): a marker is stale when its `at` is older than a fixed short bound (for example 10 s, injectable via `LockDeps`), or, on the same hostname, its pid is not alive (reuse the existing pid-liveness dep). Removing a stale marker goes through the same rule: unlink only if the re-read content is still the one judged stale, then retry `wx` once. Unreadable or corrupt marker content counts as live (exit 2, never guess); the error text names the marker path so a person can remove it. Startup must never loop or hang.
- Keep the warn line `taking over a stale state lock` (emit it once, by the winner only) and the token read-back confirmation.
- Test hook: optional `LockDeps` hook called between the first holder read and the takeover decision (and one between the marker acquire and the unlink), so a test interleaves contender B fully inside A's window.
- Invariant: exactly one `acquireLock` returns a held lock; the loser throws `ConfigError`; the winner's lock file is never unlinked by the loser.

### 3. State directory before the lock
- `mkdirSync(dirname(statePath), { recursive: true })` runs before the lock is created. Put it in `acquireLock` (so the CLI, which takes the same lock, gets it too) or in one helper called by `index.ts` before both `acquireLock` call sites (~184, ~347); one place only.
- Unusable paths (EACCES, EROFS, ENOTDIR with a file as parent, EEXIST or EISDIR when the state path is a directory, any other mkdir or lock-create error) are mapped to `ConfigError` with one line `cannot use state file <path>: <reason>` (check the existing wording in `docs/troubleshooting.md` and keep it) and exit 2. No stack trace, no exit 1.
- `PULSE_NOTIFY_STATE=<tmp>/missing/state.json npm start` starts; directory and lock exist afterwards.

### Docs
`docs/operation.md`: the parent directory is created before the lock (the promise now holds); stale takeover is serialised by `<state>.lock.takeover`, a leftover marker clears itself after the bound or when its pid is dead, and how to remove it by hand. `docs/troubleshooting.md`: the unusable-path line and the marker error. Update `AGENTS.md` only if a convention changes.

## Risks
- Post-rename rewrite doubles I/O in the rare race only; acceptable.
- A crashed takeover leaves a marker: bounded by the staleness rule above; unreadable marker fails closed (exit 2).
- Mapping all mkdir/lock errors to exit 2 must not swallow programming errors: map only `NodeJS.ErrnoException` with a `code`.

## Acceptance evidence
`npm run check` passes in `notify`. New tests, each failing on current `main`:
1. Ledger: a batch write paused before its rename; a `claim` during the pause; after settle, the file and a fresh `Ledger` load show the claimed key `pending` and earlier settles are present. Also: a failed rewrite keeps `#isDirty` so a later `flush` persists.
2. Lock: two contenders on one stale lock interleaved by the hook; exactly one returns a held lock, the other throws `ConfigError`, the winner's lock file is intact. Stale marker (old `at`, dead pid) is cleared and takeover succeeds; corrupt marker exits 2; marker removed after success and after failure.
3. `PULSE_NOTIFY_STATE=<tmp>/missing/state.json` starts and creates directory and lock; a parent that is a file prints one line to stderr and exits 2 (unit test of the mapping plus a start-up test through `index.ts`).
4. `docs/operation.md` matches the behavior.
The PR `Closes lorenzh/pulse-meta#<child>` and lists tests 1-3 with the three errors.

## Repository: notify
Files: `src/ledger.ts`, `src/ledger-lock.ts`, `src/index.ts`, `test/` (ledger, lock, startup), `docs/operation.md`, `docs/troubleshooting.md`. Behavior, checks and completion evidence are as above. Write each test first and see it fail on the old code.
