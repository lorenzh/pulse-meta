# Issue review: #265 notify ledger races and missing state dir

All three errors are confirmed against `.repos/notify` on `main`.

- `src/ledger.ts` `#writeSnapshot` (~225-240): it compares `syncWrites` before the awaited `rename`, so a synchronous `claim`/`seed`/`resend` during the rename wait is overwritten by the older snapshot. `claim` is synchronous, so "claims wait for an in-flight batch" is not possible without changing its signature and its callers in `delivery.ts`/`notifier.ts`.
- `src/ledger-lock.ts` `acquireLock` (~166-190): the sequence is read holder, `isStale`, `removeFile`, `create`. The unlink is based on an old read, so it can delete a lock that a faster contender has just created and confirmed.
- `acquireLock` is called from `src/index.ts` (~184, ~347). The only `mkdirSync` is in the ledger (~171), which runs after the lock. `docs/operation.md` says the parent directory is created. It also says a stale takeover is confirmed by reading back the token.

## Open points (none block the spec)

1. Fix for error 1. The issue allows two designs.
   - Option A: a serialised writer where claims wait. This turns the synchronous `claim` into an async one and ripples into callers.
   - Option B: keep `claim` synchronous. After the rename, re-check the version. If it moved, rewrite the newer state synchronously, or have `claim` itself write after the batch's rename.
   - Assumption: plan prefers B (smaller API change) unless the plan finds a gap. A gap: the sync claim's own rename can also land before the batch rename, so the batch's rename must come first or be undone. The final state on disk must equal the in-memory state at the end. The plan must state which ordering guarantees that.
2. Dirty flag. After a discarded or superseded batch, `#isDirty` must stay true so pending settles are not lost. Today a discard returns without restoring it (a sync write may or may not persist the batched changes, since it writes the full `#data`). The plan should check this.
3. Temp file name. The batch uses `.batch.tmp` and the sync path uses another temp name. Both must stay distinct, and the stale temp must be removed on failure.
4. Fix for error 2.
   - Takeover marker: an atomic `rename` or `wx` create of e.g. `<state>.lock.takeover`, held only during takeover. Under it, re-read the holder, re-check `isStale`, and only then unlink and create.
   - A crashed takeover leaves a marker. The plan must define how a stale marker is handled, for example by pid/age, and must not deadlock startup. Unreadable content must still count as live, so startup exits 2.
   - Keep the read-back token confirmation and the `taking over a stale state lock` warn line (documented). Update `docs/operation.md`.
5. Fix for error 3. Create the state directory (`mkdirSync` recursive) before `acquireLock`, in `index.ts` or inside `acquireLock`.
   - "Unusable paths give the documented one-line startup error with exit 2": mkdir/lock failures such as EACCES, ENOTDIR (a parent is a file) or a directory at the state path must be mapped to `ConfigError`. Today `ENOENT ... state.json.lock` is an uncaught exit 1.
   - Assumption: the message form is `cannot use state file <path>: <reason>`. Check the existing wording in `docs/troubleshooting.md`.
6. Test hooks. Tests need injected interleavings. For the lock, `LockDeps` already allows injection; a hook between the read and the unlink is needed. For the ledger, hooks around the awaited steps. Prefer test-only optional deps, with no production behaviour change.
7. Scope. Only `notify` needs code changes. The spec adds a single target. `contract` and the other targets are not affected. It depends on #255 being merged, and it is.

## Acceptance check

In `pulse-notify`, `npm test` (and lint/typecheck) passes, with new regression tests that fail on the current `main`:

1. A batch write is in flight (rename delayed by a hook). A `claim` is issued during the delay. After everything settles, the file on disk and a fresh `Ledger` load both show the claimed key as `pending`, and the earlier settles are not lost.
2. Two contenders on one stale lock, with a hook that interleaves them between the read and the unlink. Exactly one `acquireLock` returns a held lock. The other throws `ConfigError`, and the winner's lock file is never removed by the loser.
3. `PULSE_NOTIFY_STATE=<tmp>/missing/state.json` starts. The directory and the lock are created. An unusable path (parent is a file) prints one line to stderr and exits 2.
4. `docs/operation.md` matches the behaviour: takeover serialisation and directory creation.
