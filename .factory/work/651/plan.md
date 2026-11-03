# Spec #651: notify close guard on every ledger mutation, matching downgrade backup name

Source: issue #651, follow-up of the spot review of pulse-notify#41 (child #649 of #559). Issue review: `.factory/work/651/issue-review.md` (no open question; its six planning points are resolved below).

## Goal

1. After `Ledger.close()`, every public data mutation of the notify ledger throws `LedgerClosedError` and writes nothing. No early return, no-op path or entry-state error comes first.
2. The downgrade step in `docs/operation.md` names the backup the migration really created: `<state>.v1.bak` for a migrated format 1 file, `<state>.v2.bak` for format 2.

## Scope

- notify only: `src/ledger.ts`, ledger tests, `docs/operation.md`.

## Non-goals

- No change to the ledger format (SQLite, `user_version` 3, table shapes), the migration, the backup file name or its bytes.
- No change to `flush()` after close (it still resolves without work), to a repeated `close()` (still a no-op), or to queries (`hasChannel`, `status`, `entries`, `has`, `remindersFrom`, `manualFrom`, `checkRouting`, `componentRouting`, `pending`, `failed`). They keep reading the memory mirror after close.
- No change to open-ledger behavior: an equal reminder mark and a prune with no candidates stay no-ops; a duplicate `claim` returns `false`; `resend` still returns `not-failed` / `no-payload` / `resent`; `settle` and `setRecipients` keep their current generic `Error` texts for a missing or ineligible entry on an open ledger.
- No new public API, export or dependency. No downgrade converter, and no promise that every old binary reads both JSON formats.
- No change to the notifier, `src/index.ts` or the `failed` CLI.

## Current behavior (notify `main` at `757e78f`)

`src/ledger.ts` has seven public data mutations. Only `#transact` (`src/ledger.ts:487-488`) and the entry checks of `claim` (`:639`) and `resend` (`:742`) test `#isClosed`:

| Mutation | Path that skips the closed check today | Location |
| --- | --- | --- |
| `seed` | none: always reaches `#transact` | `:589-614` |
| `claim` | none: checks at entry | `:638-639` |
| `settle` | entry absent or not `pending` throws generic `Error("cannot settle …: not pending")` first | `:663-668` |
| `resend` | none: checks at entry | `:741-742` |
| `setRecipients` | entry absent or not `pending`/`failed` throws generic `Error("cannot store recipients of …: not pending")` first | `:689-693` |
| `setRemindersFrom` | `return` when the value equals the stored mark (also `undefined` for an absent channel) | `:557-558` |
| `prune` | `return 0` when no entry qualifies | `:773-789` |

`LedgerClosedError` (`src/ledger.ts:49-55`) has the fixed message `ledger is closed` and the doc comment "Nothing was written". `close()` (`:503-508`) says "Every later mutation throws `LedgerClosedError`".

`#migrateJson` (`src/ledger.ts:443-452`) writes the backup to `` `${path}.v${data.version}.bak` ``; `test/ledger.v2.test.ts:79-97` asserts `.v1.bak` for a format 1 file. `docs/operation.md:178` says `<state>.v<N>.bak`, but `docs/operation.md:181` (downgrade) says only `<state>.v2.bak`.

## Required behavior

### Ledger

- Each of `seed`, `claim`, `settle`, `resend`, `setRecipients`, `setRemindersFrom` and `prune` checks `#isClosed` as its first statement, before reading entries, comparing marks, computing prune candidates or deciding a no-op, and throws `new LedgerClosedError()` when closed. The implementer may use one small private helper (for example `#assertOpen()`) for that check; the check in `#transact` stays as defense in depth.
- After close a rejected call changes neither the memory mirror nor the database file or its sidecars (`<state>-wal`, `<state>-shm`). No `beforeCommit` hook runs.
- On an open ledger every path behaves as today (see Non-goals).
- Update the doc comments only where they would be wrong; `LedgerClosedError` and `close()` already state the contract.

### Docs

- `docs/operation.md` downgrade step names both files: restore `<state>.v1.bak` if the migration was from format 1, `<state>.v2.bak` if from format 2 (the `<state>.v<N>.bak` that the `ledger migrated` log line names as `backup`, N = the original JSON format). Keep the other steps: stop, restore to `<state>`, remove `<state>-wal` and `<state>-shm`, and the warning that events settled after the migration may be sent again.
- `README.md` needs no change: it does not describe the ledger close contract or the backup name (`grep -n -i "ledger\|closed\|\.bak" README.md` has no match at `757e78f`).

## Risks

- Lock loss (`src/index.ts:208-217`): `onLost` closes the ledger before `notifier.stop()`. A poll still in flight may now get `LedgerClosedError` from `prune` or `setRemindersFrom` where it returned silently before. Both callers already catch and log (`src/notifier.ts:399-405` "ledger prune failed, the next prune retries"; `src/notifier.ts:664-672` "ledger seed failed, the next poll retries"), and the process exits 2 right after. Effect: at most one extra error log line in that window; nothing is written, which is the purpose of the guard. Normal shutdown (`src/index.ts:144-152`) stops the notifier before close, so it is not affected.
- An implementer could put the guard after the candidate computation in `prune` or after the entry lookup in `settle`; the tests below catch both.
- Reopening a SQLite file for verification can itself create sidecars. Compare files before reopening.

## Acceptance evidence

1. A new test in `test/ledger.test.ts` (or `test/ledger.closed.test.ts`) builds a ledger in its own `mkdtemp` directory with an injected clock and, before `close()`, these states: channel `c` with a seeded key, a `pending` key, a `failed` key with payload (claim, then `settle(…, "failed")`), a `delivered` key, and a reminder mark set to a known time. The `failed` key without payload exists only after a migration (`claim` always stores the notification): write a format 1 JSON file such as `{"version":1,"channels":{"c":{"9:opened":"failed"}}}` before the first open, as `test/ledger.v2.test.ts:79-97` does. Advance the injected clock past the delivered key's time so a prune with a short `maxAgeMs` and `visible = new Set()` has it as a candidate. It then calls `close()`.
2. After `close()` it records the baseline: the public reads (`entries`, `pending`, `failed`, `remindersFrom`, `manualFrom`, `checkRouting`, `componentRouting`, `hasChannel`) and the bytes and existence of `<state>`, `<state>-wal`, `<state>-shm`.
3. It calls each case below and asserts `assert.throws(fn, LedgerClosedError)` and `name === "LedgerClosedError"` for every one. The expected error class and name are literals in the test. Cases (17):
   - `seed("c", ["new"])` and `seed("other", [])`;
   - `claim` of a new key and of the existing pending key (duplicate);
   - `settle` of the pending key, of an absent key, and of the delivered key;
   - `resend` of the failed key with payload, of the delivered key (`not-failed` when open), and of the failed key without payload (`no-payload` when open);
   - `setRecipients` of the pending key and of an absent key;
   - `setRemindersFrom("c", <same time>)`, `setRemindersFrom("absent", undefined)` and `setRemindersFrom("c", <other time>)`;
   - `prune(<maxAgeMs larger than the clock>, undefined)` with no candidate (every incident key stays while `visible` is `undefined`, `src/ledger.ts:812-814`) and `prune(1, new Set(), new Set())` with the delivered and seeded entries as candidates.
4. After the calls the public reads equal the baseline (`assert.deepEqual`), and the three files have the same bytes and existence as in the baseline. Then a reopened ledger shows the same entries, statuses, marks and payloads as the baseline, and is closed. The expected values come from the baseline taken after `close()`, i.e. from a separate earlier read of the same state, not from the code under test after the calls.
5. Red first: the cases `setRemindersFrom` (equal and absent), `prune` (no candidate), `settle` (absent, delivered) and `setRecipients` (absent) fail on `757e78f` (no throw, or a generic `Error` that is not `LedgerClosedError`). The PR states that these cases failed before the fix.
6. Existing tests stay green unchanged, among them `test/ledger.test.ts` "after close a claim throws LedgerClosedError and writes nothing", `test/ledger.race.test.ts` "a closed ledger after lock loss writes nothing, also during a flush", `test/ledger.v2.test.ts` migration and backup tests, and `test/prune.test.ts`. A test on an open ledger still sees `setRemindersFrom` with an equal value and `prune` with no candidate return without a write (existing coverage, or one added assertion if none exists).
7. `docs/operation.md`: `grep -c '<state>.v1.bak' docs/operation.md` ≥ 1 and `grep -c '<state>.v2.bak' docs/operation.md` ≥ 1 within the downgrade step, and the step still names `<state>-wal`, `<state>-shm` and the resend warning. The expected names come from the issue text and from the literal backup assertions in `test/ledger.v2.test.ts:91` (`.v1.bak`) and `test/ledger.v2.test.ts:102` (`.v2.bak`), which are independent of the doc.
8. `bun run check` passes.

## Performance impact

The notify metrics of `bench/budgets.json` in the api repository (`notify`: `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, `startup_wall_ms`, `image_mb`): none expected to move measurably. The change adds one boolean check per mutation call and one test with about 17 synchronous calls on a small temporary ledger; `test_cpu_s` (budget 3.4 s, floor 1.5 s) may grow by a few milliseconds, well inside noise. No startup, memory or image change. No A/B run is required; if the implementer wants a number, `bun bench/run.ts --a <api sha> --b <api sha> --others-ref <notify sha>` from the api repository compares notify refs.

## Security impact

Security impact: yes
The change touches the ledger's file write path (the guard that keeps a closed ledger, e.g. after lock loss, from writing the state file) and an error that the notifier logs.

Checklist items that apply:
- Atomic, path-safe writes: after close no mutation reaches SQLite; no file, sidecar or backup is created, changed or removed by a rejected call (acceptance 4). No write path, path name or permission changes otherwise.
- Secrets in errors and logs: the thrown error is `LedgerClosedError` with the fixed text `ledger is closed`; it carries no channel id, key, payload or path. The two notifier log lines that can now receive it (`src/notifier.ts:403`, `:667`) log `errorFields(err)` as today.

Not applicable: auth, contract parsers, probe HTTP client, body limits, dependencies, Dockerfile, CI.

## Rollout order

One repository: only notify changes, and the ledger API stays the same for all its callers in notify. No other repository imports the notify ledger, and the on-disk format does not change, so an older notify binary reads the state the new one writes.

## Counterexamples

- `setRemindersFrom("c", t)` after close where the stored mark is already `t`: must throw `LedgerClosedError`; today it returns.
- `setRemindersFrom("absent", undefined)` after close: must throw; today returns because `remindersFrom` is `undefined`.
- `prune(30 * DAY_MS, new Set([1]))` after close with no prunable entry: must throw; returning `0` is wrong.
- `prune` after close with an old delivered entry: must throw and the entry must remain in `entries` and on disk. A guard placed after the transaction would leave a deleted memory entry.
- `settle("c", "absent", "delivered")` after close: must throw `LedgerClosedError`, not `Error("cannot settle c/absent: not pending")`.
- `setRecipients("c", "<delivered key>", …)` after close: must throw `LedgerClosedError`, not the "not pending" `Error`.
- `claim` of an existing key after close: must throw, not return `false` (already true today; keep it).
- `resend` of a delivered key after close: must throw, not return `"not-failed"` (already true; keep it).
- Open ledger: `setRemindersFrom("c", t)` with stored `t` must not throw and must not write; `prune` with no candidate returns `0`. A guard that throws on an open ledger, or that turns these into writes, is wrong.
- `flush()` after close resolves; a second `close()` does not throw. A guard added to these is wrong.
- Docs: after a v1 migration the documented `cp <state>.v2.bak <state>` exits 1 (`cannot stat`). The fixed text must name `<state>.v1.bak` for that case.

No statistics are involved.

## Contract fields

No new names. The change adds no field, key, route, export or file name. `LedgerClosedError` and the `<state>.v<N>.bak` names already exist in notify (`src/ledger.ts:50`, `:446`). A private helper such as `#assertOpen` is local to the class. Searches of the contract and config clones (no match expected or found):

- `grep -rn 'LedgerClosedError' .repos/contract/src .repos/config` → no match.
- `grep -rn '\.v2\.bak\|\.v1\.bak' .repos/contract/src .repos/config` → no match.

## Repository: notify

Files:
- `src/ledger.ts` (change)
- `test/ledger.test.ts` (change) or `test/ledger.closed.test.ts` (new); the implementer picks one
- `docs/operation.md` (change)

Behavior change: yes
`setRemindersFrom`, `prune`, `settle` and `setRecipients` throw `LedgerClosedError` after close where they now return or throw a generic `Error`.

### Behavior

- Put the closed check first in all seven public mutations of `Ledger` (`src/ledger.ts:557`, `:589`, `:638`, `:663`, `:689`, `:741`, `:773`), as in "Required behavior". Keep the check in `#transact` (`:488`). Keep the class's synchronous API, one transaction per mutation, rollback, memory update after commit and SQLite format 3.
- Fix the downgrade line `docs/operation.md:181` to name `<state>.v1.bak` (from format 1) and `<state>.v2.bak` (from format 2), i.e. the `backup` of the `ledger migrated` log line; keep the other steps and the warning.
- Start with the failing test (TDD, notify `AGENTS.md` "Tests (TDD)"). Test through public methods only; do not export anything for the test. Use an injected `now` and a `mkdtemp` directory, and close every reopened ledger.

### Checks

Tool facts, verified in notify at `757e78f`:
- Runtime and test runner Bun 1.4.0: `package.json:8-10` (`engines.bun`), `package.json:35` (`packageManager`).
- `bun run check` runs `bun run lint && bun run typecheck && bun run test`: `package.json:17`. Lint is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`), typecheck is `tsc --noEmit` from `typescript7` 7.0.2 (`package.json:12`, `:27`), test is `bun test` (`package.json:13`), Biome 2.6.3 (`package.json:21`).
- `bunfig.toml:1-4`: `[test]` coverage on, line threshold 0.8, `test/**` ignored for coverage.
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:22`). The pinned `biome.json:10-17` includes `**` except `dist`, `node_modules`, `bun.lock`, `*.html`, `test/fixtures`, so `src/` and `test/` are linted. The pinned file equals the config clone (`diff` of `gh api …?ref=04108fa…` against `.repos/config/biome.json`: no difference).
- CI `.github/workflows/ci.yml:17-18` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`; that pinned file (`check.yml:22-38`) sets up Bun 1.4.0, then runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test` (build steps off by default). It equals the config clone's `check.yml`.

Run:
- `bun test test/ledger.test.ts` (or the new file): new cases fail before the fix (acceptance 5) and pass after.
- `bun test test/ledger.race.test.ts test/ledger.v2.test.ts test/prune.test.ts test/reminders.test.ts test/reminders.enable.test.ts`: green unchanged.
- `bun run check`: green.

### Completion evidence

- The PR shows the new test with all cases from acceptance 3, the baseline comparison of reads and files from acceptance 2 and 4, and the red run of acceptance 5.
- The `docs/operation.md` diff changes only the downgrade step and names `<state>.v1.bak` and `<state>.v2.bak`.
- `git diff --stat` touches only the files listed above; `package.json` and `bun.lock` are unchanged.
- `bun run check` output passes.
