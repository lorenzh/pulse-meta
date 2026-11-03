# Spec #559: notify delivery robustness

## Goal

Fix four robustness gaps in pulse-notify:

1. A failing event waits for its retry on its own timer, so later events of the same channel are still sent.
2. When an SMTP server refuses some recipients, the retry goes only to the recipients that still need the message.
3. Widening a channel's routing filters does not announce old incidents that were hidden by the old filters.
4. A ledger write stores only the changed records. Its cost no longer grows with the size of the ledger.

All four changes are in the notify repository. The issue review (`.factory/work/559/issue-review.md`) asks the plan to settle its open points. This spec settles all of them (scheduling, recipient progress, routing baseline, storage format, candidate E2E) without a person's decision. Each chosen default is the one the review recommended, unless a section says otherwise.

## Evidence this spec builds on

Read on notify `main` `3a0b4c8d340559e404c9e74b288aa3ea48492414` (newer than `c090a07` in the issue), on 2026-11-03.

- **Head-of-line blocking.** `src/delivery.ts:51-103`: `ChannelDelivery` keeps one array `#queue` and one `#drain` loop. `#drain` awaits `#deliver`, and `#deliver` awaits `#attempts`. `#attempts` (`:129-156`) sleeps between attempts with `await Promise.race([sleep(...), this.#aborted])` (`:150-153`). Nothing else is dequeued while it sleeps. `test/delivery.test.ts:221` (`sends in FIFO order and continues after a failed event`) pins this order. `docs/channels.md:133` and `:135` document the blocking.
- **SMTP partial refusal.** `src/channels/smtp-send.ts:120-129` (`assertAllAccepted`) throws as soon as `info.rejectedErrors` has one entry, and classifies only the first one. By then nodemailer has already delivered the message to the accepted recipients. `src/channels/email.ts:53-69` sends every attempt to the whole `channel.to`. `SendMail` returns `Promise<void>` (`src/channels/mailer.ts:61`). So every retry sends the message again to the recipients that already have it.
- **nodemailer 10.3.1 behavior** (the pinned version, `package.json` `dependencies`; read from `npm pack nodemailer@10.3.1`, `dist/esm/smtp-connection/index.js`):
  - `_actionRCPT` (`:1796-1815`) puts each refused recipient into `envelope.rejected` and its error (with `recipient`, `responseCode`, `code: "EENVELOPE"`) into `envelope.rejectedErrors`.
  - With at least one accepted recipient, the send goes on, and the result carries `accepted`, `rejected` and `rejectedErrors` (`_actionDATA`, `:1903-1922`).
  - When all recipients are refused, `_envelopeError` (`:1857-1875`) rejects with `EENVELOPE` and attaches `rejected` and `rejectedErrors`. Its `responseCode` is that of the first temporary (< 500) refusal, if there is one.
  - A failed end-of-data reply rejects with `EMESSAGE` (`:1931-1935`). In that case no recipient is confirmed.
- **Routing replay.** `src/notifier.ts:451-459` seeds only a channel that is not in the ledger yet. `#seedChannel` (`:488-523`) seeds every visible automatic incident, whatever the filters say. After that, `#detectAutomatic` (`:525-544`) filters with `isRouted` first, so an incident of an excluded check leaves no key. When a restart widens `checks` or `excludeChecks`, `detectEvents` (`src/detector.ts:53-73`) yields `opened`, `resolved` and the due reminder of every such incident. Manual incidents are filtered by components even in the first seed (`src/notifier.ts:472`, `:502-504`), so widening `components` or `excludeComponents` replays manual history too. The ledger stores no routing configuration (`src/ledger.ts:35-44`).
- **Whole-file ledger writes.** `src/ledger.ts:195-202` (`#writeSync`) runs `JSON.stringify(this.#data)` on the whole state and rewrites the file atomically for each `seed`, `claim` and `resend`. `#writeSnapshot` (`:233-258`) does the same for every batched settle and prune, and `#hasChangedSince` (`:270-272`) serializes the whole state again for a comparison.
- **Candidate E2E.** In deploy `main` `15812a0`, `e2e/compose-e2e.sh:306-308` rejects a service with a `build` key, and `:320` runs `docker compose up -d --pull missing`. `common/services.yaml:35` pins `ghcr.io/lorenzh/pulse-notify:0.1.0@sha256:a63964aa…`. The deploy CI job `full` runs the script (`.github/workflows/ci.yml:99-118`). A green run on the published pin does not test this change.

## Scope

notify only:
- `src/delivery.ts`: a per-channel scheduler.
- `src/channels/smtp-send.ts`, `src/channels/email.ts`, `src/channels/mailer.ts`: recipient progress.
- `src/notifier.ts` with a routing fingerprint: quiet routing changes.
- `src/ledger.ts`: moves to SQLite (`bun:sqlite`) with a migration from JSON version 1 and 2.
- The docs and tests that go with these changes.

## Non-goals

- No hot reload of the config. A routing change takes effect at the next start, as before.
- No change to the retry defaults (`PULSE_NOTIFY_RETRY_DELAY_MS` 1000, `PULSE_NOTIFY_RETRY_MAX_DELAY_MS` 60000, `PULSE_NOTIFY_RETRY_ATTEMPTS` 12; `src/delivery.ts:6-8`), the backoff formula, or the immediate end of an event on a permanent error.
- No concurrent sends within one channel. There is still at most one send in flight per channel.
- No durable backoff state. A restart does not keep the elapsed delay or the attempt count of a pending event. Its attempts start again at 1, as today.
- No exactly-once delivery. Delivery stays at-least-once. A crash between an SMTP acknowledgement and the write of the recipient progress can still send the message twice.
- No new runtime package, no new env variable, no new HTTP route, no contract, kit, config or deploy change. `bun:sqlite` is a Bun built-in, and `docs/approved-packages.md:3` allows it.
- No change to the deploy pin of the notify image. Releasing and pinning the image is a separate release step.

## Required behavior

### R1. Retry isolation (`src/delivery.ts`)

- Each event of a channel is a job. A job is in exactly one state: `ready` (in a FIFO queue), `sending`, or `waiting` (a retry timer runs).
- A channel has at most one job in `sending`. When an attempt fails with a retryable error and attempts are left, the job moves to `waiting`, with its own timer of `retryDelay(attempt, initial, max)`. That timer is the injected `sleep(ms, signal)`. The channel then starts the next `ready` job at once, without waiting for the timer.
- When the timer resolves, the job goes to the **end** of the `ready` queue. A due retry does not jump ahead of jobs that were ready before it.
- First attempts run in the order the jobs were enqueued. When an event retries, it may complete after events enqueued later, and that includes a `resolved` after its `opened`. Each job counts its own attempts.
- `PULSE_NOTIFY_RETRY_ATTEMPTS=0` (no limit) keeps retrying the failing event, but no longer blocks the channel.
- A key has at most one job. The notifier's `queued` set (`src/notifier.ts:101`) keeps the key from being queued again while it is `ready`, `sending` or `waiting`. `release(key)` runs exactly once, when the job ends: delivered, failed, dropped, or stopped.
- Before every attempt, including one after a wait, `isStale` is checked. A stale reminder is settled `dropped` and not sent.
- `idle()` resolves only when no job is `ready`, `sending` or `waiting`.
- `stop()` aborts the send in flight and every retry timer (through the shared `AbortSignal`), and drops `ready` jobs. Then `idle()` resolves without waiting for any timer. Jobs that did not end stay `pending` in the ledger.
- Permanent errors and the last attempt end the job as `failed`, as today, with the same log lines and the same `onOutcome` calls.

### R2. SMTP partial refusal (`src/channels/*`, `src/errors.ts`, `src/types.ts`, `src/delivery.ts`)

- **Recipient identity.** A recipient's id is `envelopeAddress(entry)` (`src/channels/mailer.ts:34-38`) with its domain part (after the last `@`) in lower case. The display name is not part of the id, and the local part is kept as it is.
- **Progress type.** Add to `src/types.ts`:
  `interface RecipientProgress { delivered: string[]; refused: string[] }`. Both lists hold recipient ids. `delivered` holds recipients for whom the end-of-data reply was 2xx and who were accepted at RCPT. `refused` holds recipients that got a 5xx at RCPT.
  `Sender` becomes `(notification, signal?, progress?: RecipientProgress) => Promise<void>`. Non-email senders ignore `progress`.
- **Error type.** Add `PartialDeliveryError` (name `"PartialDeliveryError"`) to `src/errors.ts`. Its fields:
  - `progress: RecipientProgress`: cumulative, including this attempt.
  - `isPermanent: boolean`: true when no recipient is left to try.
  - its message: fixed text with counts and reply codes only, for example `SMTP refused 1 of 3 recipients: 451`. It carries no addresses and no server reply text.
- **One attempt** of the email sender:
  - `remaining` = the ids of the current `channel.to` that are not in `progress.delivered` or `progress.refused`.
  - If `remaining` is empty, the attempt connects to nothing. It resolves when `refused` is empty, and throws `PartialDeliveryError` with `isPermanent: true` when it is not.
  - Otherwise it sends with nodemailer's `envelope: { from: envelopeAddress(from), to: remaining }`. The `To` header still lists the whole `channel.to`, and the Message-ID stays the one derived from the key (`src/channels/email.ts:35-40`).
- **Mapping the result** (in `src/channels/smtp-send.ts`; `SendMail` returns `Promise<SendMailResult>` with `accepted: string[]` and `refused: { recipient: string; responseCode: number | undefined }[]`):
  - nodemailer resolves: each `accepted` entry that matches a `remaining` id is added to `delivered`. Match it exactly, or else after the domain is lowercased.
  - Each `rejectedErrors` entry with a 5xx `responseCode` adds its recipient to `refused`. Every other refused recipient (4xx, or no code) stays remaining.
  - An accepted or refused address that matches no remaining id is ignored. Its recipient stays remaining, so delivery stays at-least-once.
  - nodemailer rejects with `EENVELOPE` and `rejectedErrors` (all recipients refused): the same per-recipient mapping, with nothing delivered.
  - Any other failure (connect, TLS, AUTH, `MAIL FROM`, DATA command, end-of-data reply `EMESSAGE`, timeout, abort) keeps today's classification (`classify`, `src/channels/smtp-send.ts:96-118`) and changes no progress.
  - After mapping: nothing remaining and nothing refused means the attempt resolves. Otherwise it throws `PartialDeliveryError` with `isPermanent = (remaining is empty)`.
  - One exception keeps today's behavior: when all recipients were refused, all with 4xx, and progress did not change, the attempt throws today's retryable `SmtpError`.
- **Delivery owns the progress of each job** (`src/delivery.ts`). Each job keeps its own `RecipientProgress` and passes it to `send`. No progress is stored in the channel or the sender.
  - On `PartialDeliveryError`, delivery stores `error.progress` in the job and writes it with `ledger.setRecipients(channelId, key, progress)`.
  - A failed write is logged (`ledger recipient write failed`, with `channel`, `key`, `error`). The job keeps the progress in memory, so the next attempt in this process still skips the delivered recipients.
  - `isPermanent: true` ends the job as `failed`, like a `PermanentDeliveryError`. Otherwise the job retries within the attempt limit, and with limit 0 it retries until nothing is left.
  - The event counts as `delivered` only when an attempt resolves.
- **Persistence and resend.**
  - `ledger.pending()` and `ledger.failed()` return the stored `recipients` of each entry, and pending recovery at start passes them to the job.
  - `ledger.resend()` (CLI `failed resend`) keeps `delivered` and clears `refused`, so a resend tries the permanently refused recipients once more.
  - An entry without stored progress (legacy, or nothing partial yet) uses `{ delivered: [], refused: [] }`.
  - A recipient added to `channel.to` after the event was claimed gets the message. A recipient removed from the config does not.
- **Logs and metrics.** A partial attempt logs `warn` `delivery attempt partly refused` with `channel`, `key`, `attempt`, `delivered`, `refused` and `remaining` (all counts) and `codes` (a sorted list of distinct numeric reply codes). It logs no addresses and no reply text. Metrics stay one outcome per event.

### R3. Quiet routing changes (`src/notifier.ts`, `src/channels/routing.ts`, `src/ledger.ts`)

- **Fingerprints.** `checkRouting(config)` is `JSON.stringify({ checks, excludeChecks })`. `componentRouting(config)` is `JSON.stringify({ components, excludeComponents })`. In both, each list is sorted, without duplicates, and an absent list becomes `[]`. So an absent list and an empty list mean the same, as `isRouted`/`isManualRouted` already treat them (`src/channels/routing.ts:22-40`). Both functions are pure and live in `src/channels/routing.ts`. Destination, secret, subject, `remindEverySeconds` and type are not part of either fingerprint.
- **Ledger.** Each channel stores both fingerprints (nullable). `ledger.checkRouting(id)` and `ledger.componentRouting(id)` read them. `seed(channelId, keys, marks)` accepts `marks.checkRouting` and `marks.componentRouting`, and writes keys and marks in one transaction.
- **Initial seed.** `#seedChannel` sets `checkRouting`. It also sets `componentRouting` when the manual feed was present. The first manual seed in `#pollManual` (no `manualFrom` yet) sets `componentRouting` in the same `seed`.
- **Automatic path.** This runs on an existing channel when the incidents feed answered, before `#syncReminderMark`, legacy rebuild and detection.
  - Stored fingerprint equals the current one: nothing is written.
  - Stored fingerprint is `null` (a ledger from before this change): `seed(id, [], { checkRouting: current })`. The current filters become the baseline, and nothing is seeded (see the once-only limit below).
  - Stored fingerprint differs: let `old` be the stored filters. `newly` = the visible incidents with `isRouted(current, checkId) && !isRouted(old, checkId)`. Then `seed(id, seedKeys(newly, reminders), { checkRouting: current })`, and log `info` `routing changed: history of newly routed checks skipped` (`channel`, `incidents`: count).
  - If that write fails: log `ledger seed failed, the next poll retries`, and run no automatic detection, reminder sync or legacy rebuild for this channel in this poll. The next good poll tries again.
- **Manual path.** This runs only on a present manual read (not on a 404, and not when the read failed), for a channel with `manualFrom`. It follows the same three cases with `componentRouting`, `isManualRouted` and `seedManualKeys(newlyManual)`, and logs `info` `routing changed: history of newly routed manual incidents skipped`. A failed write skips manual detection for this poll.
- **Unaffected.** Incidents that were routed under both the old and the current filters go through normal detection, so events that happened while notify was down are still sent. `seed` skips keys that already exist, so `pending`, `failed` and `delivered` entries and their payloads and recipient progress stay as they are. Claimed work is never cancelled.
- **Later events still notify.** A newly routed incident's next event is sent normally: a `resolved`, a manual `update` or `resolved`, or a reminder of a later interval.
- **Once-only limit.** A ledger without a stored fingerprint (a migrated v1/v2 ledger, or a channel from before this change) adopts the current filters without seeding. A filter widening made in the same restart as this upgrade can still replay old history once. Document it in the upgrade note, with the advice to upgrade first and change the filters in a later restart.

### R4. Incremental, atomic ledger (`src/ledger.ts`, `src/index.ts`, `src/failed-cli.ts`)

- **Format 3.** A SQLite database (`bun:sqlite`) at the existing path `PULSE_NOTIFY_STATE` (default `./notify-state.json`; `/data/notify-state.json` in the image, `Dockerfile:9`). The `.json` name stays, so existing settings and volumes keep working.
  - `PRAGMA user_version = 3`.
  - `journal_mode = WAL`, `synchronous = FULL`: each commit is on disk before it returns, as today's fsync of a claim.
  - Sidecar files: `<state>-wal` and `<state>-shm`. The lock stays `<state>.lock`.
- **Schema** (STRICT tables):
  ```sql
  CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    reminders_from INTEGER,
    manual_from INTEGER,
    check_routing TEXT,
    component_routing TEXT
  ) STRICT;
  CREATE TABLE entries (
    channel_id TEXT NOT NULL,
    key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('seeded','pending','delivered','failed','dropped')),
    at INTEGER NOT NULL,
    payload TEXT,
    recipients TEXT,
    PRIMARY KEY (channel_id, key)
  ) STRICT;
  ```
  - `payload` is the JSON of the `Notification`, kept for `pending` and `failed` as today. `recipients` is the JSON of `RecipientProgress`, or `NULL`.
  - Entries are never replaced, only updated, so `rowid` keeps the claim order that `pending()` returns. No secondary index.
  - `hasChannel(id)` means that a `channels` row exists. `seed` and `claim` create the row.
- **Transactions.** Every public mutation is exactly one transaction that writes only the rows it changes: `seed`, `claim` (including pruning older reminder keys of the incident), `settle`, `resend`, `setRecipients`, `setRemindersFrom`, `prune`.
  - The in-memory view (reads may be served from a mirror loaded at open) changes only after the commit succeeds.
  - A failed transaction rolls back, throws, and leaves memory unchanged. This is today's "a sync write that fails throws and undoes its own change", now for every mutation.
  - `settle`, `prune` and `setRemindersFrom` are no longer batched. `WRITE_BATCH_MS`, the snapshot chain and `#hasChangedSince` go. The settlement-loss window shrinks to the crash window between send and commit.
  - Callers that relied on batching now catch:
    - `#syncReminderMark` catches a failed `setRemindersFrom(undefined)` like a failed seed and returns false.
    - `#pruneLedger` logs `error` `ledger prune failed, the next prune retries` (`error`) and goes on.
- **Not part of the per-event cost:**
  - Opening loads all rows once.
  - `prune` scans in memory and deletes only the removed rows in one transaction.
  - SQLite's automatic WAL checkpoint (at 1000 pages, the SQLite default) copies only changed pages.
- **`flush()`** stays async. It runs `PRAGMA wal_checkpoint(TRUNCATE)` and rejects if that fails. Shutdown (`src/index.ts:145-152`) and the CLI (`src/index.ts:348-350`) call it, then close the ledger.
- **`close()`** closes the database. Every later mutation throws `LedgerClosedError` (name `"LedgerClosedError"`) and writes nothing. This covers lock loss (`src/index.ts:213-217`): no write after `close()`, also not a sync one, which today's `#writeSync` does not prevent.
- **Opening** (`new Ledger(path, opts)`, still synchronous; errors become `cannot use state file <path>: <reason>`, exit 2, through `openLedger`, `src/index.ts:113-122`):
  1. Remove a leftover `<state>.migrating`.
  2. No file at `path`: build an empty format-3 database at `<state>.migrating`, close it, rename it to `path`, fsync the directory.
  3. The first 16 bytes are `SQLite format 3\0`:
     - Open without create. Read `user_version` **before** any pragma that writes. If it is not 3, fail `ledger <path> has an unsupported format` and do not change the file.
     - Load and validate every row: `status` in the set, `at` an integer, `payload` `NULL` or a JSON object, `recipients` `NULL` or `{delivered: string[], refused: string[]}`, fingerprints `NULL` or the shape of R3. Any violation fails with the same message.
     - Then set `journal_mode = WAL` and `synchronous = FULL`.
  4. Otherwise the file is JSON:
     - Parse it with today's `migrate` (v1 and v2, `src/ledger.ts:60-99`). Errors are unchanged: an unsupported or invalid file stops startup and is not modified.
     - Build `<state>.migrating` with all channels, entries, payloads and marks in one transaction. v1 entries get the load time, as today. Fingerprints are `NULL`, and recipients are `NULL`.
     - Write a byte-for-byte copy of the original to `<state>.v<N>.bak` (N = 1 or 2) with `writeFileAtomicSync` from pulse-kit, replacing an older backup.
     - Rename `.migrating` over `path`, and fsync the directory.
     - Log `info` `ledger migrated` (`from`: N, `entries`: count, `backup`: path).
  - An interruption before the rename leaves the JSON file in place, and the next start migrates again. After the rename the file is format 3.
  - Test-only hooks in `LedgerOptions.hooks`:
    - `beforeCommit` runs inside each write transaction; a throw rolls it back.
    - `beforePublish` runs after the backup and before the rename; a throw simulates a crash.
  - They replace `hooks.beforeRename` and `fs`.
- **CLI.** `failed list|resend` opens the same ledger under the lock, so running it on a JSON ledger migrates it. Document this.
- **Backup and restore** (`docs/operation.md:51`, which today says a copy of the live file is always whole; that is no longer true).
  - Backup: stop pulse-notify, then copy `<state>`. A clean stop checkpoints, so `<state>-wal` is empty.
  - Restore: stop pulse-notify, remove `<state>-wal` and `<state>-shm`, put the file back, start.
  - Downgrade to a JSON version: stop, restore `<state>.v2.bak` to `<state>`, remove the sidecars. Events settled after the migration may then be sent again.
  - Do not put the state on a network file system (WAL needs shared memory).

## Risks

- **Ordering change.** Receivers can now see a `resolved` before its `opened`, when the `opened` is still retrying. Documented in `docs/channels.md`. Receivers already deduplicate by key and must not rely on order.
- **More fsyncs.** Each settle now commits on its own, instead of one batch per 100 ms. Notification rates are low (one poll every 5 s by default), and a WAL commit is one fsync of a few pages.
- **Live backup.** Copying the state file while pulse-notify runs is no longer safe. Operators need the new procedure. It is called out in the upgrade note.
- **Once-only replay at upgrade** (R3). Documented. Avoided by upgrading before changing filters.
- **Test CPU budget.** notify `test_cpu_s` has about 0.3 s headroom (see Performance impact). Large fixtures can break the nightly bench.
- **nodemailer internals.** The result fields `accepted`, `rejected` and `rejectedErrors[].recipient`/`responseCode` are part of nodemailer's typed result (`dist/esm/smtp-connection/index.d.ts:219`, `:234`) in the pinned 10.3.1. A loopback test pins the behavior.

## Acceptance evidence

Each item's regression test is written first and must fail on notify `main` `3a0b4c8` for the stated reason. The PR records that failing run (command and failing assertion) and the passing run on the branch.

1. **Retry isolation** (`test/delivery.test.ts`).
   - Event A's sender rejects with a retryable error. The fake `sleep` returns a promise that the test holds. Then enqueue independent event B.
   - Expected: B is sent and settled `delivered` while A's timer is still held. A has made exactly 1 attempt and is `pending`.
   - Release A's timer, then: A's attempt 2 runs, and B is not sent again.
   - On `main`, B is never attempted before the timer is released: it fails.
   - Controls:
     - the same with `retryAttempts: 0`;
     - two failing events with independent attempt counts, each with exactly `retryAttempts` attempts;
     - a duplicate enqueue of a waiting key sends nothing extra;
     - `stop()` while two jobs wait: `idle()` resolves without releasing any timer, both keys stay `pending`, `release` is called once per key;
     - a reminder whose incident resolves during its wait is settled `dropped` with 1 send;
     - a due retry goes behind jobs already ready (ready order `B, C`, then A's timer fires, so the send order is `B, C, A`).
   - The old FIFO test (`:221`) is rewritten to this policy, not deleted.
2. **Partial SMTP refusal** (`test/email-smtp.test.ts`, real `sendMail` against `test/smtp-stub.ts` on `127.0.0.1` port 0).
   - Recipients `a@example.test` and `b@example.test`. The stub answers the first `RCPT TO:<b@example.test>` with `451 4.2.0 try later` (a one-shot reply, `test/smtp-stub.ts:140-143`), then accepts it.
   - Drive it through `ChannelDelivery` with a ledger and a fake sleep.
   - Expected:
     - the second transaction has exactly one `RCPT TO`, `<b@example.test>`;
     - the stub received exactly 2 messages (literal 2: one per transaction);
     - both have the same `Message-ID` header, and both `To` headers list both addresses;
     - the event is `delivered` after 2 attempts.
   - On `main`, the second transaction has 2 `RCPT TO` lines: it fails.
   - Controls:
     - **4xx + 5xx + 2xx** (`a` accepted, `b` 451 then accepted, `c` 550): attempt 2 has only `b`, no later transaction contains `c`, and the event ends `failed`, with `recipients` `{delivered: [a, b], refused: [c]}` in the reopened ledger;
     - **all refused with 4xx**: retryable and unchanged progress;
     - **all refused with 5xx**: `failed` after 1 attempt;
     - **end-of-data `451`** (`endOfDataReply`): nobody is delivered, and the next transaction has both recipients;
     - **two events** on one channel keep separate progress;
     - **restart:** settle nothing, reopen the ledger, run pending recovery, and only `b` is sent;
     - **`failed resend`** of the 2xx/4xx/5xx event sends only to `c`.
3. **Quiet routing change** (`test/routing.test.ts` or a new `test/routing-change.test.ts`, with the fake API of `test/support.ts`).
   - Start channel `checks: ["api"]` on a ledger seeded with no incidents.
   - The API then lists incident 7 of check `db`, opened, then resolved, and incident 8 of `api`. Run polls.
   - Restart with `checks: ["api", "db"]` on the same state path.
   - Expected: the first good poll sends 0 notifications for incident 7 (literal 0), and the ledger has `7:opened` and `7:resolved` as `seeded`. A second poll and a second restart send 0 too.
   - Then a new incident 9 of `db` opens: `9:opened` is sent.
   - On `main`, `7:opened` and `7:resolved` are sent: it fails.
   - Controls:
     - `excludeChecks` removal;
     - a glob widening (`api*` → `*`);
     - a due reminder of an open newly routed incident is seeded, and the next interval's reminder is sent;
     - manual: widening `components` seeds `manual:<id>:opened` and old updates, and a later update is sent;
     - a failed incidents feed in the first poll after the restart sends nothing and writes no fingerprint, and the next good poll seeds;
     - a `beforeCommit` failure of the baseline write sends nothing, and the next poll seeds;
     - reordered or duplicate lists (`["db","api","api"]`) write nothing;
     - an unchanged config restart still sends an incident of `api` that opened during the downtime (catch-up);
     - a migrated v2 ledger adopts the current filters without seeding (the documented limit).
4. **Ledger write cost** (`test/ledger-cost.test.ts`). Uses only the public API, which exists on `main` too: `new Ledger`, `seed`, `claim`, `settle`, `flush`, `resend`.
   - **Setup** (not measured): a ledger in a `mkdtemp` directory, seeded with N keys `i:opened` (N = 100 and N = 10,000) in one channel.
   - **Measured ops** at each N, 5 times each with fresh keys:
     - (a) `claim` of one notification;
     - (b) `settle(…, "delivered")` followed by `await flush()`;
     - (c) `resend` of a key that was settled `failed`;
     - (d) `seed` of 5 new keys.
   - **Counter:** `wchar` from `/proc/self/io` before and after each op. That is bytes passed to `write` by the whole process, an OS counter independent of the code under test.
   - **Statistic:** the median (3rd smallest) of the 5 deltas per op and N.
   - **Pass, per op:**
     - median at N = 10,000 ≤ 65,536 bytes (literal);
     - median at N = 10,000 minus median at N = 100 ≤ 16,384 bytes (literal).
   - On `main`, (a) at N = 10,000 rewrites the whole JSON file, about 50 bytes per seeded entry, so about 500,000 bytes: it fails.
   - The test runs where `/proc/self/io` exists (`test.skipIf` otherwise). The CI log of the PR must show it ran, not skipped, on `ubuntu-24.04`.
   - **Controls** in `test/ledger.test.ts` and `test/ledger.v2.test.ts`, rewritten to the storage contract by reopening a `Ledger` instead of reading raw JSON:
     - v1 and v2 migration keeps statuses, `at`, payloads, `remindersFrom`, `manualFrom` and legacy pending entries without payload;
     - the backup file is byte-equal to the original input (compare it with the fixture bytes the test wrote);
     - a `beforePublish` crash leaves the JSON in place, and the next open migrates;
     - a second open does not migrate again;
     - a `user_version` of 4 and a bad status row are refused, and the file is unchanged (same bytes before and after);
     - a `beforeCommit` failure in `seed`, `claim`, `resend` and `setRecipients` leaves memory and disk unchanged;
     - prune removes only old settled rows;
     - after `close()`, `claim` throws `LedgerClosedError` and a reopen shows no new key;
     - `flush()` after shutdown leaves `<state>-wal` at 0 bytes.
5. **Gates.** `bun install --frozen-lockfile` and `bun run check` pass, and the notify CI (`check` and both `docker` jobs) is green on the PR.
6. **`bun run start`.** Start with a file channel and a v2 JSON state file. Observe `ledger migrated` and a `<state>.v2.bak`. Stop with SIGTERM, and observe exit 0 and an empty `<state>-wal`. Report the commands and output.
7. **Candidate Compose E2E.**
   - Build `docker build --tag pulse-notify:candidate .` on the PR head.
   - In a throwaway clone of deploy `main` (`git clone https://github.com/lorenzh/pulse-deploy.git /tmp/deploy-559`, never the read-only `.repos/deploy`), replace only the notify `image:` line of `common/services.yaml:35` with `pulse-notify:candidate`.
   - Run `scripts/init-secrets.sh` and `bash e2e/compose-e2e.sh`. Expected last line: `==> All checks passed`.
   - Record the notify commit SHA, the candidate image ID (`docker image inspect -f '{{.Id}}' pulse-notify:candidate`), the deploy commit, and the result. An E2E run on the published `0.1.0` pin does not count.

## Performance impact

Metrics in api `bench/budgets.json` (`notify` block) that this change can move:

| Metric | Budget (`bench/budgets.json`) | Direction | Expected size | Why |
| --- | --- | --- | --- | --- |
| `test_cpu_s` (gating) | 2.5 s, floor 0.6 s | up | +0.1 to +0.25 s | new tests: a loopback SMTP fixture, a 10,000-entry ledger, routing restarts |
| `startup_cpu_ms` (gating) | 455 ms | up, small | +0 to +15 ms | loading `bun:sqlite` and opening an empty database instead of parsing a small JSON |
| `idle_rss_mib`, `peak_rss_mib` (gating) | 86 MiB | up, small | +1 to +3 MiB | SQLite library and page cache; the mirror replaces the JSON object |
| `load_cpu_s` (gating) | 0.5 s | none measurable | — | the bench config has one file channel (`bench/fixtures/notify.json:2`); per-event work drops from whole-file to row writes |
| `startup_wall_ms`, `image_mb` (reported) | 978 ms, 126 MB | none measurable | — | `bun:sqlite` is in the Bun binary; no new package |
| p95 latency, requests per second | api only | none | — | notify serves no measured routes |

**Test CPU headroom.** The notify budget is 2.5 s with floor 0.6 s. The README notes A 1.900 s and B 2.205 s (api `bench/README.md:120-122`). The regression rule fails when B − A > max(10 % of A, 0.6), so B may be at most about 2.5 s. That leaves about 0.29 s for the whole change.

**Measuring.** The bench always measures notify `main` as B (`bench/README.md:79`; `--others-ref` pins every repository), so a notify branch cannot be A/B'd through `bench/run.ts`. The implementer measures `test_cpu_s` locally instead, with the same quantity as `runCommand` in api `bench/measure.ts:52-71` (user + system CPU of `bun run test` and its children):

```sh
bun -e 'const p = Bun.spawn(["bun", "run", "test"], { stdout: "ignore", stderr: "ignore" }); const code = await p.exited; const u = p.resourceUsage(); console.log(code, ((Number(u.cpuTime.user) + Number(u.cpuTime.system)) / 1e6).toFixed(2))'
```

Take 5 samples on `main` and 5 on the branch in the same session, alternating, and use the median (3rd smallest) of each. Pass when branch median − main median ≤ 0.25 s (literal). If it is more, shrink the fixtures (for example N = 5,000) as long as the cost test still fails on `main`. Startup, RSS and load are confirmed by the next nightly `Bench` after merge, and the PR states that.

## Security impact

Security impact: yes

The change rewrites the state file writer and adds a migration that publishes files (file writes). It reads a SQLite file and nodemailer results, which are external data at a trust boundary. It adds log lines about SMTP refusals (error and log texts with external data).

Checklist items that apply:
- **Atomic, path-safe writes.**
  - Every path comes from `PULSE_NOTIFY_STATE` by a fixed suffix (`.migrating`, `.v1.bak`, `.v2.bak`, and SQLite's `-wal`/`-shm`). No path comes from file content or the config.
  - The JSON is replaced only by `rename` of a fully built and closed database, followed by a directory fsync.
  - The backup is written with `writeFileAtomicSync` before the rename.
  - A refused or corrupt file (bad JSON, unsupported version, `user_version` ≠ 3, a bad row) is never modified, renamed or deleted.
  - Every write is a transaction. No write after `close()`.
- **Input validation.** The SQLite file is validated row by row at open (R4). `user_version` is read before any pragma that writes. nodemailer's `accepted`, `rejected` and `rejectedErrors` are read as `unknown` and narrowed. An address that matches no remaining id is ignored, never added.
- **Secrets in errors, logs and responses.**
  - `PartialDeliveryError` messages and the `delivery attempt partly refused` log carry counts and numeric reply codes only. They carry no recipient address, server reply text, SMTP credential or host.
  - `classify` keeps not storing the nodemailer error as `cause` (`src/channels/smtp-send.ts:96-99`).
  - Persisted fingerprints hold filter lists only, never secrets, URLs or SMTP settings.
  - Migration logs carry the version, count and backup path only.
- **Dependency pins.** No new package. `bun:sqlite` is built in (`docs/approved-packages.md:3`). nodemailer stays `10.3.1`.
- Not applicable: admin routes and auth, body and size limits, accessor execution, SSRF and redirects, the probe HTTP client, Dockerfiles, CI files. None of them change.

Hostile inputs for the security state:
- a state file that starts with `SQLite format 3\0` but has `user_version` 4, a missing `entries` table, a `status` of `'sent'`, a `payload` of `[1]`, or `recipients` of `{"delivered":"x"}`: each one must give exit 2 with `cannot use state file`, and the bytes must stay unchanged;
- a symlink at `<state>.migrating` pointing outside the directory: it must be removed, not written through;
- an SMTP stub that refuses a recipient with a reply text holding a marker secret and CR/LF: the marker must not appear in logs, errors or the ledger;
- a stub whose 250 answers name an address that was never sent: it must not be recorded as delivered.

## Rollout order

One repository: notify alone changes. No other repository reads the state file or calls the changed functions. The contract, kit and config pins stay. Deploy keeps running the published `0.1.0` image until a separate release step updates `common/services.yaml`. When that image starts on an existing `notify-data` volume, it migrates `/data/notify-state.json` once and keeps `/data/notify-state.json.v2.bak`.

## Counterexamples

- **Blocking.** Ready `[A, B]`, A fails retryably, its timer is held. An implementation that awaits A's sleep before B fails test 1. So does one that runs A's retry and B at the same time: at most one send per channel.
- **Fairness.** A's timer fires while `[B, C]` are ready: the order is `B, C, A`. `A, B, C` (retry jumps ahead) is wrong.
- **Unlimited retries.** With `retryAttempts: 0` and A failing forever, B must still be delivered. Waiting for A to end is wrong.
- **Stop.** `stop()` with 2 waiting jobs and timers that never resolve must resolve `idle()`. An `idle()` that awaits the timers hangs, which is wrong. Calling `release` twice for one key is wrong.
- **Stale after wait.** A reminder waiting for its retry whose incident resolves meanwhile ends `dropped`. Sending it after the wait is wrong.
- **Recipient id.** `"Ops <Alice@Example.TEST>"` has the id `Alice@example.test`. Lowercasing the local part (`alice@example.test`) or keeping the display name is wrong.
- **Mixed refusal.** `a` 250, `b` 451, `c` 550 in one transaction:
  - attempt 2 is to `b` only;
  - ending the whole event as permanent because of `c` (today's first-error rule when `c`'s error comes first) is wrong;
  - retrying `c` is wrong;
  - recording the event `delivered` is wrong, because `c` never got it.
- **DATA failure.** RCPT `a` 250 and `b` 250, then the end-of-data reply `451`: nobody is delivered, so both go into the next attempt. Counting `a` and `b` as delivered because RCPT accepted them is wrong.
- **Resend.** `failed resend` of `{delivered: [a, b], refused: [c]}` sends only to `c`. Sending to `a` or `b` is wrong. Not retrying `c` is wrong too.
- **Fingerprint equality.** `checks: ["db","api"]` and `checks: ["api","db","api"]` are equal. `checks: []` and no `checks` are equal. `checks: ["*"]` and no `checks` are **not** equal (different strings), so the change runs, but `newly` is empty, so nothing is seeded. Comparing the matched check sets instead of the fingerprint strings is allowed only if it gives the same seeds.
- **Newly routed.** Old `excludeChecks: ["db"]`, new none: incident 7 of `db` is seeded. Incident 8 of `api` (routed before and after) is **not** seeded, and its `resolved` from the downtime is sent. Seeding all visible incidents (blanket reseed) is wrong.
- **Failed feed.** The first poll after a widening restart has the incidents feed failing (HTTP 500). Writing the fingerprint then, or treating it as an empty snapshot, is wrong.
- **Existing keys.** Incident 7 has `7:opened` `failed` with a payload. A widening seed must leave it `failed` with its payload. Overwriting it to `seeded` is wrong.
- **Cost test.** One `claim` at N = 10,000: about 4 pages × (4,096 + 24) bytes ≈ 16,480 bytes of WAL is expected and passes. A whole-file rewrite (about 500,000 bytes) fails the 65,536-byte bound. Batching N claims into one snapshot still writes 500,000 bytes per flush, and the settle-plus-flush op fails too. A mean of the 5 deltas instead of the median is wrong.
- **Atomic migration.** A crash after the backup and before the rename: the path still holds the JSON, and the next start migrates again. Writing the database directly at `path`, or deleting the JSON before the database is complete, is wrong.
- **Unsupported file.** A JSON `{"version":3,…}` or a SQLite `user_version` of 4 must fail without changes. Setting `journal_mode=WAL` before checking `user_version` changes the file header, which is wrong.

## Contract fields

No contract, config, env-variable or route names. All new names are local to notify. Searches on 2026-11-03:

- `grep -rn '<name>' .repos/contract/src .repos/config` gave no match for any of: `PartialDeliveryError`, `RecipientProgress`, `LedgerClosedError`, `checkRouting`, `componentRouting`, `setRecipients`, `beforeCommit`, `beforePublish`, `user_version`, `.bak`.
- The same names in `.repos/notify/src` and `.repos/notify/test`: no match. So nothing in notify collides either.

New local names:
- types `RecipientProgress`, `SendMailResult`;
- errors `PartialDeliveryError`, `LedgerClosedError`;
- `Ledger` methods `setRecipients`, `checkRouting`, `componentRouting`; seed marks `checkRouting`, `componentRouting`;
- `PendingEntry.recipients`, `FailedEntry.recipients`;
- routing functions `checkRouting(config)` and `componentRouting(config)` in `src/channels/routing.ts`;
- SQLite tables `channels` and `entries` and their columns (R4);
- files `<state>.migrating`, `<state>.v1.bak`, `<state>.v2.bak`, `<state>-wal`, `<state>-shm`;
- log messages `delivery attempt partly refused`, `ledger recipient write failed`, `ledger prune failed, the next prune retries`, `routing changed: history of newly routed checks skipped`, `routing changed: history of newly routed manual incidents skipped`, `ledger migrated`.

Removed:
- `WRITE_BATCH_MS`, `LedgerOptions.hooks.beforeRename` and `LedgerOptions.fs`;
- `LedgerOptions.onError`, if nothing uses it after batching goes; then the `ledger write failed, pending keys are resent` row of `docs/operation.md:100` goes too.

## Repository: notify

Files:
- `src/delivery.ts`: scheduler with per-job retry timers and per-job recipient progress.
- `src/types.ts`: `RecipientProgress`, the extended `Sender`.
- `src/errors.ts`: `PartialDeliveryError`.
- `src/channels/mailer.ts`: `SendMailResult`, the `SendMail` return type, the recipient id helper.
- `src/channels/smtp-send.ts`: envelope `to`, result mapping, replaces `assertAllAccepted`.
- `src/channels/email.ts`: remaining recipients, short-circuit when nothing remains.
- `src/channels/routing.ts`: `checkRouting`, `componentRouting`.
- `src/notifier.ts`: routing baseline, pending progress, catching the writes that are no longer batched.
- `src/ledger.ts`: format 3 on `bun:sqlite`, migration, `setRecipients`, fingerprints, `LedgerClosedError`.
- `src/index.ts`: close after flush, the `onError` wiring.
- `src/failed-cli.ts`: only if resend output needs it.
- `test/delivery.test.ts`, `test/email-smtp.test.ts`, `test/smtp-stub.ts` (only if a needed reply is missing), `test/routing-change.test.ts` (new), `test/ledger-cost.test.ts` (new), `test/ledger.test.ts`, `test/ledger.v2.test.ts`, `test/ledger.race.test.ts`, `test/security-atomic-errors.test.ts`, `test/failed-cli.test.ts`, `test/support.ts`, and every other test in `test/` that reads or writes the state file as raw JSON (today: `grep -ln 'readFileSync\|JSON.parse\|writeFileSync' test/*.ts`). Each one moves to the `Ledger` API or to JSON fixtures that go through migration, and keeps its behavioral assertion.
- `README.md`, `AGENTS.md` (the "Ledger" line: format 3, SQLite, no batching), `docs/channels.md` (`:133`, `:135` ordering and blocking; partial SMTP; routing change), `docs/operation.md` (`:5-12` durability, `:51` backup and restore, the log table, the upgrade note), `docs/troubleshooting.md` (`:31`, `:39` state file errors, the new log lines), `docs/configuration.md:11` (the `PULSE_NOTIFY_STATE` description), `docs/development.md:25`.

Behavior change: yes
Delivery order, SMTP retries, routing seeding and the on-disk format all change.

### Behavior

Implement R1–R4 exactly as written above.

Design rules from `AGENTS.md` that apply:
- inject `sleep` and `now`, no real timers in tests;
- typed errors with a `name`;
- no addresses or secrets in log text;
- exhaustive `switch` over the job state;
- cognitive complexity ≤ 15 per function.

Splitting the scheduler into its own module (for example `src/channel-queue.ts`) is allowed if `delivery.ts` gets a second responsibility. Use `bun:sqlite` directly in `src/ledger.ts`. Add no generic storage layer.

The public `Ledger` method names and signatures used by acceptance test 4 (`seed`, `claim`, `settle`, `flush`, `resend`, constructor `(path, opts)`) stay, so that test runs unchanged against `main` and the branch.

### Tool facts (verified)

- **Runtime and package manager.** Bun 1.4.0: `package.json:9` (`engines.bun`), `:35` (`packageManager`). The test runner is `bun test` (`package.json:13`).
- **`bun run check`** = `bun run lint && bun run typecheck && bun run test` (`package.json:17`).
  - lint = `biome check . && pulse-eslint . && pulse-workflows` (`:14`), with Biome `2.6.3` (`:21`).
  - typecheck = `tsc --noEmit` from `typescript7` (`:12`).
- **Coverage.** `bunfig.toml:2-3` (`[test]`) enforces `coverage = true` and line coverage ≥ 0.8. `test/**` is ignored for coverage (`:4`).
- **Biome scope.** `biome.json:2` extends `@lorenzh/pulse-config/biome.json`. At the pinned `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:22`), that file's `files.includes` is `**` without `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`. Read with `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=04108fa…"`. So `src/` and `test/` are linted.
- **CI.**
  - `.github/workflows/ci.yml:17-18` uses `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`. That pinned file sets up Bun `1.4.0` (`:22-24`) and runs `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck` and `bun run test` on `ubuntu-24.04` (`:16`, `:25-38`). It is identical to the config clone (`diff` gave no output).
  - The `docker` job builds the image on `ubuntu-24.04` and `ubuntu-24.04-arm` (`ci.yml:20-32`) and runs the dotenv, no-test-files and healthcheck checks (`:33-98`). The healthcheck job starts the image with a file channel and no state volume, so it also exercises creating a new format-3 ledger at `/data/notify-state.json` (`Dockerfile:9`, `:12`).

### Checks

- Acceptance tests 1–4, each first red on `main` for the stated reason, then green.
- `bun run check` green. Coverage stays ≥ 80 % lines, with no threshold change.
- The test CPU A/B under Performance impact: branch median − main median ≤ 0.25 s.
- `bun run start` exercise (acceptance 6).
- Candidate Compose E2E (acceptance 7).

### Completion evidence

The PR description lists:
- the red runs on `main` (test name and failing assertion for each of the four groups);
- the green runs;
- `bun run check` output;
- the 5 + 5 test CPU samples and medians;
- the `bun run start` transcript;
- the candidate E2E record (notify SHA, image ID, deploy SHA, final line `==> All checks passed`);
- the known limits: the once-only replay at upgrade (R3), backup now needs a stopped service, completion order is no longer FIFO, and at-least-once after a crash.
