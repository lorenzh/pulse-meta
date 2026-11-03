# Issue review: #651 — notify ledger close guard and downgrade backup

## Disposition

Ready for `plan`. No question blocks the spec. The implementation target is `notify` only: enforce the existing closed-ledger contract across all seven public data mutations, add regression coverage, and correct the downgrade instructions.

## Request, comments and repository evidence

- Read [#651](https://github.com/lorenzh/pulse-meta/issues/651) and all issue comments. The only comment is this run's Factory claim; there are no earlier decisions or unanswered questions.
- Read meta `AGENTS.md`, `README.md`, the Factory issue-review prompt and notify `AGENTS.md`. Inspected the notify clone directly at `757e78f27cfdbb89109c216dcba829158ea7b5c3` (`Merge pull request #41 from lorenzh/factory/649-notify-notify-delivery-robustness`). The prerequisite work from #559 / child #649 is already present; retain it rather than implementing the SQLite migration again.
- `.factory/work/559/plan.md:138-152` identifies the seven public data mutations separately from lifecycle operations `flush()` and `close()`, and already requires every later mutation to throw `LedgerClosedError` and write nothing after close.
- `src/ledger.ts:486-494`: `#transact` checks `#isClosed` before starting a transaction and applies memory changes only after commit. This protects only paths that reach it.

| Public mutation | Current path before the transaction guard |
| --- | --- |
| `seed` | Computes keys, time and marks, then always reaches `#transact`. |
| `claim` | Already checks closed at entry, including duplicate-key calls. |
| `settle` | Throws a generic error for an absent or non-pending entry before reaching the guard (`:663-668`). |
| `resend` | Already checks closed at entry, including `not-failed` and `no-payload` paths. |
| `setRecipients` | Throws a generic error for an absent entry or one outside pending/failed before reaching the guard (`:689-693`). |
| `setRemindersFrom` | Returns when the value equals the stored mark, including absent/`undefined`, before checking closed (`:557-558`). |
| `prune` | Computes candidates and returns zero when none qualify before checking closed (`:773-789`). |

- `src/ledger.ts:496-508`: `flush()` resolves without work after close, and repeated `close()` is a no-op. Queries read the memory mirror. These are existing behaviors distinct from the data mutation contract.
- `src/ledger.ts:443-452` creates the backup using the source JSON version: `<state>.v1.bak` or `<state>.v2.bak`. `docs/operation.md:175-181` correctly uses `<state>.v<N>.bak` for migration but incorrectly specifies only `.v2.bak` for downgrade. The downgrade paragraph already requires stopping, restoring the backup, removing WAL/SHM files and accepting possible event replay.
- `test/ledger.test.ts:117-127` covers closed `claim` and `seed`; `test/ledger.race.test.ts:71-84` covers closed settlement of a pending entry during flush/shutdown. Neither checks every mutation or the early-return/error paths above. `test/ledger.v2.test.ts:79-126` already verifies both migration backup names and preserved source bytes.

## Open points and assumptions for planning

1. **Define “every public mutation” explicitly.** Use the seven methods in the table. Lifecycle operations `flush()` and `close()`, queries, construction and migration are outside this phrase. Preserve post-close flush, repeated close and query behavior; changing those would conflict with the constraint against other behavior changes. This interpretation follows the original #559 spec as well as the current class.
2. **Closed errors take precedence over entry-state errors.** Cover `settle` and `setRecipients` on missing or ineligible entries, in addition to the two reported early returns. These are type-correct calls that must throw `LedgerClosedError` after close even though they fail differently on an open ledger. Put the closed check before no-op decisions and entry-state validation. The planner may choose a small private guard helper; retain the transaction guard as appropriate. No public API expansion is needed.
3. **Preserve open-ledger behavior.** Equal reminder marks and a prune with no candidates remain no-ops while open. Preserve duplicate claims, resend result values, normal invalid-state errors, synchronous mutations, row transactions, rollback, memory updates and SQLite format 3. Do not fix unrelated ledger behavior or introduce dependencies.
4. **Make “write nothing” observable.** A typed throw alone is insufficient. Use a temporary ledger and deterministic clock; capture its memory view and persisted state after closing and before attempts. Verify rejected calls change neither. Check file contents/existence before reopening, since reopening SQLite can itself create sidecars. Existing `beforeCommit` hooks can also show that rejected calls reach no commit. Tests should use public methods, clean up temporary files and close reopened ledgers.
5. **Name the backup by its source format.** Explicitly document `.v1.bak` for migrated format 1 and `.v2.bak` for migrated format 2, with `<state>.v<N>.bak` meaning N is the original JSON format. Restore the matching backup that was actually created. This is a documentation correction, not a backup rename, a new downgrade converter or a promise that every old binary reads both JSON versions. Preserve the existing stop, restore, WAL/SHM removal and event-replay instructions. Keep any README update required by notify's instructions limited to this behavior.
6. **Keep the follow-up bounded.** Only notify needs implementation work; no contract, API, deployment, package, benchmark or Factory configuration change is required. The merged prerequisite requires no new waiting target. No target file was edited during this review.

## Derived acceptance check

1. A regression test or table-driven suite invokes every public data mutation after `close()`: `seed`, `claim`, `settle`, `resend`, `setRecipients`, `setRemindersFrom`, and `prune`. Each throws the exported `LedgerClosedError`, with name `LedgerClosedError`.
2. Coverage includes both paths that would mutate an open ledger and paths that would otherwise return or reject before writing: an unchanged reminder timestamp, an absent/undefined reminder mark, pruning with no candidates, a duplicate claim, resend of a non-failed entry and of a failed entry without payload, and missing/ineligible entries for settlement and recipient progress. Include pruning with eligible settled entries so a misplaced guard cannot permit deletion. These checks expose all known guard bypasses and error-precedence gaps.
3. After the rejected calls, public reads show the same channels, entries, marks, pending/failed payloads and recipient progress. The database and any sidecars retain their post-close contents/existence. Reopening shows the same persisted data, with no added/changed/removed records. Baseline comparison starts after `close()` to exclude its legitimate database checkpoint/cleanup.
4. Existing open-ledger tests remain green, including migration/backup, transaction rollback, pruning and flush/shutdown coverage. Notify's implementation passes `bun run check`; the focused ledger tests demonstrate the new regressions fail before the fix and pass afterward. This issue-review state performed source inspection only, not product test execution.
5. The downgrade section in `docs/operation.md` explicitly names `<state>.v1.bak` and `<state>.v2.bak`, explains choosing the original JSON version's backup (N = 1 or 2), and preserves the other recovery steps and replay warning. The documented filename agrees with existing migration tests for each version; migration code and on-disk formats remain unchanged.

Only this artifact was created in meta. The initially absent issue work directory is created with this file. A search with no nested `.factory/AGENTS.md` matches was rechecked successfully; there are no additional instructions there. No provider labels or comments were changed.
