# Spec #571: notify error-budget and expiry alerts

## Goal

pulse-notify sends only incident events today (`opened`, `update`, `resolved`, `reminder`;
`notify/src/types.ts:1`). The Console design names two more notification routes: "Error budget
below 25%" and "Certificate or domain expires soon". This spec adds three routable warning events
to notify:

- `budget-low`: the error budget of a check SLO or a component SLO is below a threshold
  (default 25), at most once per 24 hours per SLO.
- `tls-expiry` and `domain-expiry`: a TLS certificate or a domain registration expires soon,
  with one warning at 14 days and one at 3 days, and not again in the same expiry episode.

A channel opts in with a new `alerts` list. Channels without it behave exactly as today.

This revision answers the second plan-review: the format-3 migration checkpoints the WAL into
the main file before it deletes any sidecar, so a crash at any point loses no committed row and
never writes a backup without them (R9). The start-time drop of incident deliveries for
`sendIncidents: false` is one transaction, and if it fails, startup fails. So notify never runs
with incidents off while old incident keys are still pending (R1). New files are marked `(new)`
in `Files:`.

## Decisions

The issue review (`.factory/work/571/issue-review.md`) lists twelve open points. No issue comment
decides any of them. This spec decides them as follows.

1. **Budget, not burn rate.** The alert reads the existing `slo.budgetRemaining` of `GET /checks`
   and `GET /components` (percent of the error budget left; contract `src/schema.ts:593-611`).
   It fires when `budgetRemaining < threshold` (strict). `null` budgets and subjects without
   `slo` never fire. No multi-window burn-rate ratio, no SLO CRUD, no recovery event.
2. **Threshold.** One notify-wide setting, `PULSE_NOTIFY_BUDGET_THRESHOLD`, an integer from 0 to
   100, default 25. No per-channel or per-SLO threshold.
3. **Which SLOs.** Check SLOs (subject kind `check`) and component SLOs (kind `component`).
   A check and a component with the same id are two SLOs with separate state.
4. **"Once per day" means 24 elapsed hours**, not a UTC calendar day. A new `budget-low` event
   for an SLO is due when its budget is low and no event for that SLO was generated in the last
   `86 400 000` ms (`nowMs - lastEventMs >= 86400000`). Recovery and a new drop in that time do
   not bypass it. Missed days during downtime give one event, not one per day.
5. **Expiry milestones and catch-up.** The milestones are fixed at 14 and 3 days, independent of a
   check's `warnDays`. The first used observation in `4..14` gives the 14-day warning; the first
   in `0..3` gives the 3-day warning. When the 14-day warning was never sent (first observation
   already `0..3`, or a jump from above 14 to 3 or below), only the 3-day warning is sent.
   Negative values (expired) send nothing.
6. **Expiry episode.** Suppression is per check and episode, not per day. An episode starts with
   its first warning and ends (rearms) only with a used observation above 14 days. A used
   observation is fresh and strictly newer than every observation already used for that check,
   and that "newest used" time is stored durably on every use (R6), so restarts, `null`, stale
   or reordered observations never rearm. Small increases inside `0..14` do not rearm. Known
   limit: a renewal that keeps the remaining days at 14 or below (for example a new certificate
   valid for 10 days) is not recognized; that episode gets no new warnings. The current wire
   data has no exact expiry time or certificate identity, so this spec does not promise more.
7. **One observation per check.** The observation of a check is `certDaysLeft` of `GET /checks`
   (the api takes it from the newest result over all locations, `api/src/service.ts:791-796`) and
   its time is the largest `locations[].result.timestamp`. No warning per location.
8. **Evaluator and state owner: notify only.** One evaluation per notify installation, after the
   incident processing of a poll. Its state is a new ledger table, separate from the prunable
   per-channel delivery history. The api already serves every input (see "Unchanged
   repositories"), so no api, contract or probe change is made.
9. **Opt-in routing.** `alerts` selects the warning kinds of a channel; check filters route check
   subjects, component filters route component subjects. A new `sendIncidents: false` makes a
   warning-only channel. Old channel files keep their behavior.
10. **No replay to late subscribers.** Evaluation is global. A channel that subscribes, or whose
    filters widen, receives the next event that becomes due; past warnings are not sent to it.
    The first evaluation of a kind (no stored state) sends every warning that is due at that time,
    once.
11. **Compose evidence** comes from deploy's unchanged `e2e/compose-e2e.sh`, run by the notify
    implementer against a locally built candidate notify image in a scratch copy of deploy. No
    committed image pin changes. Timing rules are proven by fake-clock tests, not by Compose.
12. **Incident deliveries of a warning-only channel are dropped, not kept for later.** When a
    channel runs with `sendIncidents: false`, its stored pending incident deliveries are settled
    `dropped` at start (R1). Re-enabling incidents later sends no old incident event.

## Scope

- notify: channel config (`alerts`, `sendIncidents`), the threshold setting, reading check state
  and `GET /components`, the budget and expiry evaluation, ledger format 4 with the alert state
  table, three new payload variants for all five channel types, docs.

## Non-goals

- No change to api, contract, probe, status, console, deploy, kit or config.
- No Console UI, no route-management API, no config reload.
- No burn-rate windows, no recovery ("budget back above threshold") event, no per-SLO threshold.
- No expiry warning for plain HTTP checks (they publish no `certDaysLeft`).
- No exact expiry time, no certificate or registration identity, no new probe behavior. The
  probe's `warnDays` status and incident behavior stay as they are.
- No shared state across independent notify installations.
- No change to incident, manual incident or reminder events, their keys or payloads.

## Required behavior

### R1 Channel config

- New optional key `alerts` on every channel type: an array of the strings `"budget-low"`,
  `"tls-expiry"`, `"domain-expiry"`. Absent or empty means no warnings (today's behavior).
  Duplicates are allowed and ignored. Any other value fails startup with
  `channel "<id>": alerts must be an array of "budget-low", "tls-expiry" or "domain-expiry"`.
  The message never repeats the bad value.
- New optional key `sendIncidents`: a boolean, default `true`. Another type fails startup with
  `channel "<id>": sendIncidents must be true or false`.
- `sendIncidents: false` with an absent or empty `alerts` fails startup with
  `channel "<id>": sendIncidents false needs alerts`.
- `sendIncidents: false` with `remindEverySeconds` fails startup with
  `channel "<id>": remindEverySeconds needs sendIncidents`.

A channel with `sendIncidents: false` sends no `opened`, `update`, `resolved` or `reminder`
event, also none that is already stored:

- **At start, before the pending resend** (`#resendPending`, `notify/src/notifier.ts:254` and
  `:279-290`): the drop covers every `pending` entry of such a channel whose stored payload has an
  incident event (`opened`, `update`, `resolved`, `reminder`, automatic or manual), and every
  `pending` entry without a payload (a legacy key; all of them are incident keys). Held reminders
  are included. Warning entries (`budget-low`, `tls-expiry`, `domain-expiry`) of that channel stay
  `pending` and are resent.
- **The drop is all or nothing, and startup depends on it.** A new ledger mutation settles all
  those entries of all warning-only channels as `dropped` in **one** transaction (status
  `dropped`, `at` = now, payload and recipients cleared, as `settle` does for `dropped`,
  `notify/src/ledger.ts:669-694`). It runs when the notifier is constructed, before `start()`, so
  `main` in `notify/src/index.ts` sees a failure before the ops server binds or anything is sent
  (`notify/src/index.ts:204`, `:221-223`). If the transaction fails (the existing
  `hooks.beforeCommit` lets a test throw), no entry changes and the constructor throws a named
  error with the fixed text `cannot drop pending incident notifications of channels with
  sendIncidents false`. `main` then closes the ledger, releases the lock and rethrows, so startup
  fails as it does when the ledger cannot be opened (`notify/src/index.ts:173-178`). Nothing is
  sent and no poll runs.
  Result: **every start that runs with `sendIncidents: false` has already committed the drop.**
  After a failed start the ledger is unchanged, as if the switch had never been made. A restart
  with `sendIncidents: true` then sends the incident keys that were pending before the switch.
  They were owed before the switch took effect, so this is not a re-enable. A restart with
  `sendIncidents: false` tries the drop again.
  After a successful drop, the start logs `incident notifications dropped: channel sends no
  incidents` with `channel` and `count`, once per channel with `count > 0`. With nothing to drop,
  no transaction runs.
- **Legacy rebuild** (`#rebuildLegacyPending`) is skipped for such a channel.
- **Each poll:** routing and seeding stay as today: the first-poll seeding of a new channel
  (`#seedChannel`), the routing-change seeding and the manual first-read seeding run unchanged.
  Instead of enqueuing, the keys that automatic and manual detection would enqueue for the
  channel are recorded as `seeded` with `ledger.seed` (which adds only keys without an entry,
  `notify/src/ledger.ts:595-621`). So an incident that opens while incidents are off is never
  sent later. A failed seed is logged with the fixed text `incident seed failed, the next poll
  retries` and enqueues nothing. The next poll seeds the key again, because detection still
  derives it. If the channel is switched back before any seed succeeds, the key is new at that
  start and is sent, as if the incident had opened after the switch.
- `failed` incident entries of such a channel stay `failed` (they are a record for the operator)
  and `failed list` shows them. `failed resend` still sets them `pending` (the CLI does not read
  channel config); the next start drops them by the first rule.
- **Re-enabling** (`sendIncidents` back to `true` at a restart after a start that ran with
  `false`): `dropped` and `seeded` keys count as handled (`ledger.has`), so nothing old is sent.
  Only events whose key is new after the restart are sent (for example the `resolved` of an
  incident whose `opened` was seeded).

### R2 Threshold setting

- `PULSE_NOTIFY_BUDGET_THRESHOLD`: integer from 0 to 100, default `25`, read with the pulse-kit
  `readInt` (`{ fallback: 25, min: 0, max: 100 }`). Another value stops startup with
  `PULSE_NOTIFY_BUDGET_THRESHOLD: must be an integer from 0 to 100` (the existing format,
  `notify/docs/configuration.md:28`).
- Changing it takes effect at the next start. It does not reset any stored state: an SLO that got
  an event 2 hours ago gets no new one before its 24 hours end, whatever the new threshold.

### R3 Feeds

- `GET /checks`: each item is still validated with `validateCheck` for names (unchanged). An item
  that is a valid `Check` is also validated with `validateCheckWithState` (contract pin
  `7ce23aaf…`, `src/validate.ts:142`). Only items that pass both enter alert evaluation. A failure
  of the second check is counted with the existing `pulse_notify_skipped_items_total{feed="checks"}`
  and logged once per index with the existing fixed text (`check skipped: malformed data`,
  `reason: "invalid"`). The second validation runs only when at least one channel has an
  `alerts` entry, so a config without alerts does no extra work.
- `GET /components`: read only when at least one channel has `budget-low` in `alerts`. It uses the
  same client as the other feeds (no redirects, `PULSE_NOTIFY_API_MAX_BYTES`, wire version check,
  timeout). Each item is validated with `validateComponentWithState` (pin `7ce23aaf…`,
  `src/validate.ts:270`); an invalid item is skipped, counted under a new feed label
  `components` and logged once per index with a fixed text. A `404` means "no components" (an
  older api): no component budget is evaluated and the poll is not failed. Any other failure
  fails only this feed: it is logged and counted like the others (`api poll failed`,
  `pulse_notify_feed_polls_total{feed="components",outcome="error"}`), counts as a failed poll
  for `/readyz` like any other feed, and never stops incident or manual detection.
- The feeds are read in parallel, as today. When `/components` is not read, the poll outcome is
  computed from the three existing feeds only.

### R4 When alert evaluation runs

In each poll, after the per-channel incident and manual processing:

- Budget evaluation of check SLOs runs when `/checks` answered; of component SLOs when
  `/components` answered with data. It runs only when at least one channel has `budget-low`.
- Expiry evaluation of a check of type `tls` runs only when at least one channel has
  `tls-expiry`; of type `domain` only when at least one has `domain-expiry`. It needs `/checks`.
- **Seeding gate.** An evaluation of a kind is skipped for the whole poll while any channel that
  subscribes to that kind has no ledger record yet (`ledger.hasChannel` false). Reason: claiming
  a warning entry creates the channel record (`#upsertChannel` in `ledger.claim`,
  `notify/src/ledger.ts:645-668`), and a channel with a record is no longer seeded on its first
  poll (`notify/src/notifier.ts:465-468`), so its old incidents would be sent as new. The gate
  also makes sure that no subscribed channel misses an event. Seeding happens earlier in the same
  poll, so a channel seeded in poll `n` lets the evaluation run in poll `n`.
- A failed or skipped evaluation changes no state, so the next poll evaluates again.

### R5 Budget rule

For each subject (check or component) with `slo` present, in one poll at `nowMs = now()`:

- `low` is `slo.budgetRemaining !== null && slo.budgetRemaining < threshold`. No rounding before
  the comparison.
- With no stored state, or `nowMs - lastEventMs >= 86400000`, a low subject generates one event at
  `nowMs` and stores `lastEventMs = nowMs`. Otherwise nothing.
- `nowMs < lastEventMs` (clock went back) generates nothing.
- A subject that is not low changes nothing (no recovery reset).

### R6 Expiry rule

Per check of type `tls` or `domain`, the observation is `(days, observedMs)`:
`days = check.certDaysLeft`, `observedMs = max(locations[].result.timestamp)`. The observation is
**used** only when all hold:

- `days` is an integer (not `null`, not absent) and `locations` is not empty;
- fresh: `nowMs - observedMs <= 2 * intervalMs + 60000` and `observedMs <= nowMs + 60000`
  (`intervalMs` of the check; factor 2 as the api's `WINDOW_INTERVALS`, `api/src/service.ts:49`);
- newer: `observedMs > observed_at`, where `observed_at` is the stored time of the newest
  observation ever used for this check (none stored: any fresh observation is newer). Equal is
  not newer.

**Restart-safe ordering.** Every used observation stores its `observedMs` as the new
`observed_at` of the check, also when the stage does not change. There is no in-memory-only
ordering state: the evaluator reads `observed_at` from the ledger mirror, which changes only
after a commit (R9). So an observation that is older than any observation used before a restart
is never used after it. The writes of one poll are one transaction (R9); a poll without a newer
observation writes nothing.

A used observation moves the per-check state `stage ∈ {none, 14, 3}` (start `none`):

| `days`   | stage `none`                     | stage `14`                   | stage `3`           |
| -------- | -------------------------------- | ---------------------------- | ------------------- |
| `> 14`   | nothing                          | rearm: stage `none`          | rearm: stage `none` |
| `4..14`  | event milestone 14, stage `14`   | nothing                      | nothing             |
| `0..3`   | event milestone 3, stage `3`     | event milestone 3, stage `3` | nothing             |
| `< 0`    | nothing                          | nothing                      | nothing             |

- The event kind is `tls-expiry` for a `tls` check and `domain-expiry` for a `domain` check, at
  the time of the event. A check that changes between `tls` and `domain` keeps its row.
- The episode start `episodeMs` is the `observedMs` of the observation that left stage `none`.
  A rearm clears it.
- An observation that is not used (null, stale, future, not newer) changes nothing, also not
  `observed_at`.

### R7 Event keys

Keys never contain a raw id from the api (api text must not reach a log line,
`notify/docs/operation.md:165`). `<h>` is the first 32 hex characters of the SHA-256 of the
subject id (UTF-8), as `manualUpdateKey` does (`notify/src/detector.ts:107-113`).

- `budget:check:<eventMs>:<h>` and `budget:component:<eventMs>:<h>`
- `expiry:<episodeMs>:<milestone>:<h>` (milestone `14` or `3`; the same key form for TLS and
  domain)

Neither form matches the incident key pattern `^(\d+):` or `^manual:(\d+):`
(`notify/src/ledger.ts:403-404`), so their delivery entries are pruned after
`PULSE_NOTIFY_STATE_RETENTION_DAYS` like other old entries. Suppression does not depend on these
entries: it lives in the alert state (R9).

### R8 Payloads

`Notification` becomes a union discriminated by `event`. The incident variant keeps its exact
fields and JSON. The two new variants (webhook body and file line):

```json
{
  "key": "budget:check:1767268800000:<32 hex>",
  "event": "budget-low",
  "time": "2026-01-01T12:00:00.000Z",
  "timeMs": 1767268800000,
  "subject": { "kind": "check", "id": "api-health", "name": "API health" },
  "budget": {
    "remaining": 18.4,
    "threshold": 25,
    "target": 99.9,
    "availability": 99.8816,
    "windowDays": 30
  }
}
```

```json
{
  "key": "expiry:1767268800000:14:<32 hex>",
  "event": "tls-expiry",
  "time": "2026-01-01T12:00:05.000Z",
  "timeMs": 1767268805000,
  "subject": { "kind": "check", "id": "site-tls", "name": "Site TLS" },
  "expiry": { "daysLeft": 13, "milestone": 14, "observedMs": 1767268800000 }
}
```

- `time`/`timeMs` is the poll time of the event. `subject.kind` is `check` or `component`
  (`component` only for `budget-low`). `subject.name` is the check or component `name` from the
  api. `budget.*` are the raw api values (no rounding) plus the threshold in force.
- The webhook `idempotency-key` header is the key; signing and `x-pulse-timestamp` are unchanged.
- Chat and email (slack, teams, email): a state label `BUDGET LOW`, `TLS EXPIRES SOON` or
  `DOMAIN EXPIRES SOON`, the cleaned subject name (`cleanText`, escaped per channel as today), the
  time and the status link. Budget messages add `Error budget left: <r>% (alert below <t>%)` and
  `Availability: <a>% (target <target>%, 30 days)`; `<r>` is `budgetRemaining` rounded down to
  one decimal (`Math.floor(x * 10) / 10`, printed with `toFixed(1)`), `<a>` is `availability`
  rounded down to three decimals, or `no data` when null. Expiry messages add
  `Expires in: <n> days` (`1 day` for 1, `less than 1 day` for 0) and
  `Kind: TLS certificate` or `Kind: domain registration`. `hideReason` does not apply. The email
  subject is `<prefix><label>: <name>` as today; the Message-ID derives from the key as today.
- Persisted pending and failed payloads of the new variants are resent like others. Pending
  payloads written by an older version are incident payloads and stay readable.
- The stale-reminder check (`isStale`, `notify/src/notifier.ts:222-224`) narrows on the event
  first; a warning is never stale.

### R9 Ledger format 4 and alert state

- `LEDGER_VERSION` becomes 4. The schema adds one table:

  ```sql
  CREATE TABLE alert_state (
    kind TEXT NOT NULL CHECK (kind IN ('budget-check','budget-component','expiry')),
    subject_id TEXT NOT NULL,
    last_event_at INTEGER,
    stage INTEGER CHECK (stage IN (14, 3)),
    episode_at INTEGER,
    observed_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (kind, subject_id)
  ) STRICT;
  ```

  Budget rows use `last_event_at`; expiry rows use `stage` (NULL = `none`), `episode_at` and
  `observed_at`. Rows are loaded into the in-memory mirror and validated at open like the other
  tables; a bad row, or a format-4 file without this table, refuses the file as an unsupported
  format. `updated_at` is the commit time of the last change of the row.
- **One transaction per poll evaluation.** All alert changes of one poll are one ledger
  mutation: every `alert_state` upsert (budget events, expiry events, rearms, `observed_at`
  advances) and a `pending` entry with the payload for every routed channel that has no entry
  with that key. Memory changes only after the commit, as for every ledger mutation
  (`notify/src/ledger.ts:406-415`). Then the notifications are enqueued on each of those
  channels; `ChannelDelivery` sees the key as `pending` and sends it (`notify/src/delivery.ts:153-157`).
- A failed transaction (the existing `hooks.beforeCommit` lets a test throw) changes no row and
  no memory; it is logged with a fixed text (`alert state write failed, the next poll retries`),
  nothing is enqueued, and the next poll evaluates again from the old state.
- A crash after the commit resends the pending entries at start (`#resendPending`), and the next
  evaluation generates no new event, because the state was committed with the entries.
- Channels are independent: a failure, retry or `failed` status on one channel does not change
  another channel's delivery or the alert state.
- **Format-3 migration** at open. The hazard: the existing publish path removes the sidecars of
  the target path (`removeDatabaseFiles(path, false)`, `notify/src/ledger.ts:397`) before it
  renames the new file over it (`:398`). A format-3 ledger in WAL mode can hold committed rows
  only in `<state>-wal`. If the process crashed between those two lines, those rows would be lost,
  and the next migration would copy the smaller file over a good backup. The migration therefore
  runs in this order, and no step deletes or replaces a file that holds the only copy of a
  committed row:
  1. **Validate, read-only.** The format-3 file is read and validated on the read-only
     connection, as today (`#validate`, `notify/src/ledger.ts:471-483`, which reads committed
     WAL frames without checkpointing them). A file that fails is refused as unsupported. Its
     main file, `-wal` and `-shm` keep their bytes, and no backup is written.
  2. **Checkpoint into the main file.** Only a validated file is opened read/write.
     `PRAGMA wal_checkpoint(TRUNCATE)` runs with `synchronous = FULL`, and then the connection is
     closed. The step succeeds only when the checkpoint reports `busy = 0` and `log` equal to
     `checkpointed`, and after the close `<state>-wal` is absent or 0 bytes long. Otherwise the
     open throws `ledger checkpoint was blocked` (the text of `flush`,
     `notify/src/ledger.ts:505`), deletes nothing, writes no backup, and startup fails. After
     this step the main file alone holds every committed row, and the WAL holds none.
  3. **Re-read.** The rows are read and validated again on a read-only connection. Only these rows
     are used for the backup and the new file. The service's lease lock
     (`notify/src/ledger-lock.ts`) is held, so no other writer exists.
  4. **Backup.** An existing `<state>.v3.bak` is removed with `unlink`, which does not follow a
     symlink. Then the bytes of the checkpointed main file are written with the pinned kit's
     `writeFileAtomicSync(backup, bytes, { mode: 0o600 })`: a temp file beside it with `wx`,
     fsync, rename, directory fsync (kit `src/atomic-write.ts:216-256` at pin `236df214…`).
     The old backup must be removed first because that helper takes the mode and owner of an
     existing destination, and it `stat`s through a symlink (`:151-158`, `:226`).
  5. **Publish.** The format-4 file is built from the rows of step 3 plus an empty
     `alert_state` through the existing publish path: `<state>.migrating` created with mode
     `0600` and `wx`, the sidecars of `<state>` removed (now empty or absent), then the rename
     and a directory fsync (`notify/src/ledger.ts:380-400`). Every channel, mark and entry is
     kept. A new test-only hook `afterSidecars` in `LedgerOptions.hooks` runs after the sidecars
     are removed and before the rename. A throw from it simulates a crash in that window, as
     `beforePublish` does for the window before it (`notify/src/ledger.ts:118-124`).
  6. The open logs `ledger migrated` with `from: 3` and `backup`, as the JSON migration does.

  What a crash leaves at each point. Each case starts from a format-3 file whose rows are only in
  its WAL:

  | Crash after | Files left | Next open |
  | --- | --- | --- |
  | step 1 | format-3 file, WAL unchanged | migrates from the start |
  | step 2 or 3 | format-3 main file with every row, no WAL | migrates again; same rows |
  | the backup `unlink` | as above, no backup | migrates again and writes the backup |
  | step 4 | as above plus a full backup | migrates again and replaces the backup with the same rows |
  | sidecar removal, before the rename | format-3 main file with every row, no WAL, no `-shm` | migrates again; same rows |
  | the rename | format-4 file | opens without migration |

  A leftover `.migrating` is removed by the constructor, as today
  (`notify/src/ledger.ts:430`). A leftover backup temp file (`<state>.v3.bak.<suffix>.tmp`, mode
  `0600`) can stay after a crash in step 4, as with the JSON migration today; it is not read.
  A JSON ledger (format 1 or 2) is published directly as format 4. Any other `user_version`
  stays refused.
- **Alert-state pruning** (with the existing hourly prune): an `alert_state` row is removed only
  when its `updated_at` is older than `PULSE_NOTIFY_STATE_RETENTION_DAYS` and its subject was
  absent from the last good read of its feed in this run (`/checks` for `budget-check` and
  `expiry`, `/components` for `budget-component`). Before a good read of that feed in this run,
  nothing of that kind is pruned. A `404` on `/components` is not a good read.
- The `failed list` and `failed resend` subcommands work for the new keys unchanged; `list` shows
  the event name from the stored payload (`budget-low`, `tls-expiry`, `domain-expiry`).

### R10 Routing

A channel gets an event when the kind is in its `alerts` and:

- check subject (`budget-low` of a check, `tls-expiry`, `domain-expiry`): `isRouted` with
  `checks`/`excludeChecks` (globs, exclusion wins), as for incidents;
- component subject: `isManualRouted(channel, [componentId])` with
  `components`/`excludeComponents`, as for manual incidents. Component events are never expanded
  to member checks, and check filters do not apply to them.
- `sendIncidents` does not affect warnings. A warning needs no incident and creates none.
- An event with no routed channel still advances the alert state (routing decides recipients,
  not whether an event exists).

### R11 Docs

README (what notify sends, the new setting), `docs/configuration.md` (setting and channel keys),
`docs/channels.md` (triggers, keys, payloads, routing, a new "Warnings" section with the rules R5,
R6 and the known limits), `docs/channels/*.md` (message content per type), `docs/operation.md`
(ledger format 4, `alert_state`, pruning, upgrade and downgrade, the `sendIncidents: false`
drop at start), `docs/troubleshooting.md` (the `cannot use state file` row at line 31 says
"a `user_version` other than 3": it becomes "other than 3 or 4", and a format-3 file is
migrated, not refused) and `docs/development.md` (code map). The package description in `package.json`
may say "incident and warning notifications".

## Risks

- **Downgrade after the format-4 migration.** An older notify refuses a format-4 file and does not
  start. Mitigation: `<state>.v3.bak` and a documented downgrade (stop, restore the backup, remove
  `-wal`/`-shm`; events settled after the upgrade may be sent again).
- **Renewal inside 14 days is not seen** (Decision 6). Documented as a known limit.
- **Long check intervals.** Freshness is `2 * intervalMs + 60 s`. A domain check every 24 h can
  use a count up to 48 h old, so a warning can come up to two days late. A count is never counted
  down by notify.
- **Ledger writes with expiry alerts on.** Every poll in which a TLS or domain check has a newer
  result writes one transaction (R6). With `synchronous = FULL` that is one fsync per such poll,
  at most one per `PULSE_NOTIFY_POLL_MS` (default 5 s). See "Performance impact".
- **`test_cpu_s` of notify.** The budget is 3.4 s with a measured 3.095 s (`api/bench/README.md:122`).
  The new tests must use fake clocks and in-memory or temp-dir ledgers, few real servers, and no
  sleeps. See "Performance impact".
- **Late subscribers miss the current warning** (Decision 10). Documented.
- **Dropped incident deliveries** of a channel switched to `sendIncidents: false` are not sent
  when it is switched back (Decision 12). Documented.
- **Startup can now fail for two new reasons:** the drop transaction of R1 fails, or the
  format-3 checkpoint of R9 is blocked or fails. Both cases change no data, log a fixed text, and
  succeed on a later start once the cause (disk error, another open connection) is gone. This
  matches today's behavior for a ledger that cannot be opened.

## Performance impact

The api does not change, so no api metric of `api/bench/budgets.json` can move. The notify
section (`api/bench/budgets.json`, key `notify`) can move:

- `test_cpu_s` (gating, budget 3.4 s, floor 1.5 s): up. Expected about +0.1 to +0.3 s for the
  new tests. This is the tight one: keep the new tests on fake time and in-memory/temp ledgers.
- `startup_cpu_ms` (gating, 455 ms): for a format-4 file, loading `alert_state` into the mirror
  adds well under 1 ms for a few hundred rows. One-time cost of the format-3 migration on the
  first start: one WAL checkpoint, a second read-only validation, one byte copy of the main file
  as the backup, and one publish of all rows. That is a few ms on a small ledger, about twice the
  cost of today's JSON migration. No new dependency, so module load is the same.
- `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib` (gating): none expected in the bench, because the
  bench config of notify (`api/bench/fixtures/notify.json`) has one file channel without
  `alerts`. Then no `/components` read, no second validation (R3), no evaluation and no alert
  write runs.
- Reported: `startup_wall_ms` none expected; `image_mb` none (no new dependency or file type).
  p95 latency and requests per second are api metrics: none.

Cost with alerts on (not in the bench; estimates per poll with 200 checks of which 100 are TLS or
domain checks, and 50 components):

| Cost | Estimate |
| --- | --- |
| `/components` read and JSON parse (about 20 KB) | about 0.2 ms CPU, one more HTTP request per poll |
| `validateCheckWithState` on 200 checks and `validateComponentWithState` on 50 components | about 1 to 2 ms CPU |
| Budget and expiry evaluation (one linear pass, a SHA-256 per event only) | under 0.5 ms CPU |
| Alert transaction when observations advanced (up to 100 row upserts) | about 0.5 ms CPU and one fsync |
| Alert mirror in memory (300 rows) | under 0.1 MiB; the parsed components body is transient |

That is about 3 ms CPU per poll: about 0.04 s per minute at the default 5 s poll, about 0.18 s per
minute at a 1 s poll. RSS: under 1 MiB more.

How to measure:

1. `test_cpu_s`: `bun bench/run.ts` takes api refs, and `--others-ref` pins all other
   repositories to one ref on both sides (`api/bench/README.md:76-81`), so it cannot compare a
   notify branch alone. The notify implementer runs five times each
   `/usr/bin/time -f "%U %S" bun run test` on `origin/main` and on the branch, on the same
   machine, and reports the median of user + system seconds of both and the difference. The
   difference must be below 0.3 s (literal limit from this spec: the headroom between 3.095 s
   and 3.4 s).
2. Startup CPU: start once with a format-3 ledger copy and once with format 4 and report both,
   read from `/proc/<pid>/stat` (utime + stime) at the first `200` of `/readyz`.
3. Runtime cost with alerts on: a short `Bun.serve` script outside the repository serves `/checks`
   with 200 checks (100 HTTP checks with `slo.budgetRemaining` 50, 50 TLS and 50 domain checks
   with `certDaysLeft` 30, every location timestamp set to the request time so every poll has
   newer observations), 50 components with `slo.budgetRemaining` 50, empty `/incidents` and
   `/manual-incidents`. Notify runs with `PULSE_NOTIFY_POLL_MS=1000` and a temp state dir in
   three runs: main with a file channel; branch with the same channel; branch with the channel
   plus `alerts: ["budget-low","tls-expiry","domain-expiry"]`. After 20 s of warm-up, read
   utime + stime from `/proc/<pid>/stat` at the start and end of a 60 s window, and `VmRSS` and
   `VmHWM` from `/proc/<pid>/status` at its end. Literal limits from this spec: branch without
   alerts minus main at most 0.1 s CPU and 3 MiB `VmHWM`; branch with alerts minus main at most
   0.3 s CPU (about 1.5 × the estimate) and 3 MiB `VmHWM` (the bench's MiB floor). The PR
   reports the raw numbers of all three runs.

## Security impact

Security impact: yes
The change parses new config keys and an env var, validates new JSON from the api at a trust
boundary, puts api-sourced names into chat and email text, and writes a new file (the ledger
backup) during a format migration.

Checklist items that apply:

- **Secrets in errors, logs and responses:** config errors never repeat the bad value; no api
  text (names, ids, bodies) reaches a log line: keys use the SHA-256 prefix of the subject id
  (R7), skipped items are logged with fixed texts and indexes only, and new log lines carry only
  fixed texts, channel ids from the config and counts. Webhook URLs and SMTP passwords stay out of
  logs as today.
- **Input validation:** check state and components are validated with the contract validators
  before use; `budgetRemaining` must be finite or null (contract `finite.nullable()`),
  `certDaysLeft` an integer or null, timestamps integers; stale, future and not-newer
  observations are rejected (R6). Config values are validated by the zod `strictObject` schemas.
- **Body and size limits:** `/components` uses the same capped, no-redirect reader as the other
  feeds (`PULSE_NOTIFY_API_MAX_BYTES`).
- **SSRF and redirects:** no new outbound target; `/components` follows no redirect.
- **Atomic, path-safe writes:** the migration first checkpoints the validated format-3 WAL into
  its main file. It then removes an old backup with `unlink`, writes the new backup beside the
  ledger with mode `0600` through the kit's temp-file-and-rename write, and publishes the
  format-4 file with the existing `wx`/rename path. A crash leaves a self-contained format-3 file
  or a format-4 file, never a mix, and never loses a committed row (R9 crash table). A refused
  file is not checkpointed and keeps its bytes.
- **Output escaping:** subject names pass `cleanText` and the per-channel escaping (Slack `& < >`,
  Teams markdown) as incident names do; a name with `<!channel>` or `**` must not render as markup.
- Dependency pins: no change (contract `7ce23aaf…`, kit `236df214…` stay).

Hostile inputs for the security state: a component or check name of 10 000 characters with
control characters and `<!channel>`; an id with `:` and newlines (the key must still be
`budget:check:<ms>:<32 hex>`); `budgetRemaining` given as a string, `NaN` text or `1e999`
(validator rejects); `certDaysLeft: 3.5`; a `/components` body over the byte cap; a `302` on
`/components`; `alerts: ["budget-low", {"x":1}]`; `PULSE_NOTIFY_BUDGET_THRESHOLD=25abc`; a
pre-existing `<state>.v3.bak` symlink to a file outside the state dir (the migration must remove
the link and leave the target's bytes and mode unchanged); a format-3 file with a hostile row
only in its committed WAL (refused without a checkpoint: main file and `-wal` bytes unchanged);
a format-4 file with an `alert_state` row of
`stage` 7 or `kind` `x` (refused).

## Rollout order

One repository: only notify changes. It keeps its contract pin `7ce23aaf…`, which already
exports `validateCheckWithState` and `validateComponentWithState` and carries `slo` and
`certDaysLeft` in the read models (`src/validate.ts:142` and `:270`, `src/schema.ts:593-627` and
`:769` at that ref, read with `gh api …?ref=7ce23aaf…`).

Older peers keep working:

- api on an older version without `/components`: `404` is "no components" (R3); check budgets and
  expiry still work.
- api without `slo` or `certDaysLeft` on a check: no warning for that check.
- Webhook and file receivers: new event values reach only channels that opt in with `alerts`.
  Existing channels get the same payloads as before.
- deploy: `e2e/notify.json` and the full/demo channel files have no new keys and stay valid; the
  published image pins do not change in this feature.
- Downgrade of notify after the first start of the new version needs the backup (Risks).

## Counterexamples

Sources of the expected values: literals in this spec (the request's 25 %, 14 and 3 days, and
the decisions above). No test may derive an expected value from the code under test.

### Budget (threshold 25, check `a` with `slo.target` 99.9 unless said)

| Input | Expected | A wrong implementation that fails it |
| --- | --- | --- |
| `budgetRemaining` 25 | 0 events | `<=` instead of `<` |
| 24.999 | 1 event | rounding to an integer before comparing |
| `null` (availability null) | 0 events | treating null as 0 |
| no `slo` field | 0 events | default target |
| 0 and -50 | 1 event each (separate checks) | `0 < x < threshold` range check |
| event at `t0`; still low at `t0 + 86399999` | 0 more | calendar-day bucket (if `t0` is 23:59 UTC) |
| still low at `t0 + 86400000` | exactly 1 more | `>` instead of `>=` |
| low at `t0`, 80 at `t0+1h`, 10 at `t0+2h` | 0 more before `t0+24h` | reset on recovery |
| ledger closed and reopened at `t0+1h`, still low | 0 more | in-memory suppression only |
| check `a` and component `a` both low at `t0` | 2 events, 2 different keys | state keyed by id only |
| threshold changed 25 → 50 at restart, `t0+2h` | 0 more | state keyed by threshold |
| `now()` steps back to `t0 - 1000` | 0 events | `Math.abs` of the difference |
| notify down from `t0+1h` to `t0+72h`, low on return | exactly 1 event | one event per missed day |
| `budget-low` on two channels | 1 alert row, 1 entry per channel with the same key | one evaluation per channel |

### Expiry (TLS check, `intervalMs` 60 000, each observation newer than the last and fresh)

| Observations in order | Expected events (milestones) |
| --- | --- |
| `15, 14, 14, 13, 4, 3, 3, 2, 0, -1` | `[14, 3]` (at the first 14 and the first 3) |
| same, then `90`, `14`, `3` | two more: `[14, 3]` with a new `episodeMs` |
| `15, 13` | `[14]` once |
| `13, 2` (13 first) | `[14, 3]` |
| first observation `2` | `[3]` only, never `[14, 3]` together |
| first observation `0` | `[3]` |
| first observation `-1` | `[]` |
| `14, null, 13` | `[14]`; null does not rearm or count as 0 |
| `14, 13, 14, 12` | `[14]`; a small increase does not rearm |
| `14` then a restart (reopen ledger) then `14`, `13` | `[14]` total |
| `14` then delivery prune with retention 1 day at `+2 days`, then `13` | `[14]` total |
| `3` used at `observedMs` 1000, then `20` at `observedMs` 900 | no rearm (older) |
| `3` at `observedMs` 1000, then `20` at `observedMs` 1000 | no rearm (not newer) |
| `14` with `nowMs - observedMs = 180001` (2 × 60 000 + 60 000 + 1) | ignored (stale) |
| `14` with `nowMs - observedMs = 180000` | used |
| `14` with `observedMs = nowMs + 60001` | ignored (future) |
| domain check, same sequence as row 1 | `[14, 3]` as `domain-expiry` |
| two locations, newest at t=2000 with check `certDaysLeft` 10, other at t=1000 | one event, observedMs 2000 |

Restart-safe ordering (R6), the case of the plan-review, with the ledger closed and reopened
between steps 2 and 3:

| Step | `nowMs` | Observation (`days` @ `observedMs`) | Expected |
| --- | --- | --- | --- |
| 1 | `t0` | `2 @ t0` | event milestone 3; stored `stage 3`, `observed_at t0` |
| 2 | `t0+120000` | `2 @ t0+120000` | 0 events; stored `observed_at t0+120000` |
| restart | | | |
| 3 | `t0+150000` | `90 @ t0+60000` (fresh: 90 000 ≤ 180 000) | 0 events, no rearm: stage stays `3` |
| 4 | `t0+160000` | `13 @ t0+125000` | 0 events (stage `3`) |
| 5 | `t0+300000` | `90 @ t0+290000` | rearm: stage `none` |
| 6 | `t0+360000` | `14 @ t0+350000` | exactly 1 event milestone 14 |

A wrong implementation that keeps the newest time in memory and stores it only on a stage change
rearms at step 3 and sends a duplicate milestone at step 4.

### Seeding gate and subscription changes (R4, Decision 10)

| Case | Expected |
| --- | --- |
| Old channel `A` with `budget-low` (seeded) and new channel `B` with `budget-low` (no ledger record); poll 1: `/incidents` fails, check `a` low | `B` not seeded; budget evaluation skipped: 0 events to `A` and `B`, no `alert_state` row |
| Poll 2: all feeds answer, `a` still low; one open incident `7` | `B` seeded first (key `7:opened` `seeded`), then evaluation: exactly 1 `budget-low` to `A` and 1 to `B`, same key; 0 incident events to `B` |
| A wrong implementation that evaluates in poll 1 | `B` gets a record from the claim, is never seeded, and gets `7:opened` in poll 2 |
| `A` got `budget-low` for `a` at `t0`; restart at `t0+2h` where `B` adds `budget-low` | 0 events to `B` before `t0+24h`; at `t0+24h` exactly 1 to `A` and 1 to `B`, same key |
| `A` with `tls-expiry` got milestone 14 for `x`; restart with no channel subscribed to `tls-expiry`; `x` reads `2`; restart with `A` subscribed again | evaluation skipped while unsubscribed; after re-subscribing exactly 1 milestone-3 event, then none |
| `A` with `checks: ["a"]` and `tls-expiry`; `x` at milestone 14 (generated, routed to nobody); restart with `checks: ["a","x"]`; `x` reads `13`, then `3` | 0 events at `13`; exactly 1 milestone-3 event at `3` |

### Transaction failure and crash recovery (R9)

| Case | Expected |
| --- | --- |
| `beforeCommit` throws in the poll at `t0` with `a` low, two channels | 0 `alert_state` rows, 0 entries, 0 requests at the receiver; log `alert state write failed, the next poll retries` once |
| Next poll at `t0+5000`, hook removed | exactly 1 request per channel, key `budget:check:<t0+5000>:<h>` |
| Poll at `t0+10000` | 0 requests |
| Commit at `t0`, then `stop()` while the receiver holds the request; reopen the ledger and start a new notifier | the receiver gets the same key once more (resent from `pending`); a poll at `t0+60000` with `a` still low gives 0 new keys |
| `beforeCommit` throws in an expiry poll that would advance `observed_at` from `t0` to `t0+60000` | stored `observed_at` stays `t0`; the next poll uses the observation again |

### Alert-state pruning (R9, retention 1 day)

| Case at `nowMs = t0 + 2 days` | Expected |
| --- | --- |
| `budget-check` row `gone` with `updated_at t0`; last good `/checks` read lacks `gone` | row removed |
| same row, `/checks` lists `gone` | row kept |
| same row, `/checks` has not answered in this run | row kept |
| `budget-component` row `web` with `updated_at t0`; `/components` answered `404` | row kept |
| `expiry` row `x` with `updated_at t0`, `x` absent from the last good `/checks` | row removed; if `x` later returns with `13`, exactly 1 milestone-14 event |
| delivery entry of a `budget:` key older than 1 day | entry pruned; the `alert_state` row stays and no new event before 24 h |

### `sendIncidents: false` (R1, Decision 12)

| Case | Expected |
| --- | --- |
| Channel `H` (webhook) has `pending` `7:opened` with payload, `manual:3:…` with payload, a held `7:reminder:2`, a legacy `8:opened` without payload, and `pending` `budget:check:…`; restart with `sendIncidents: false`, `alerts: ["budget-low"]` | at start the four incident keys are `dropped`, log `incident notifications dropped: channel sends no incidents` with `count: 4`; the receiver gets exactly 1 request, the `budget:` key; 0 incident requests over 10 polls |
| Incident `9` opens while `H` has `sendIncidents: false` | `9:opened` is `seeded` on `H`, 0 requests |
| `H` has `failed` `5:opened`; `failed resend 5:opened`; restart with `sendIncidents: false` | `5:opened` becomes `dropped` at start, 0 requests |
| Restart of `H` with `sendIncidents: true` | 0 requests for `7:opened`, `8:opened`, `9:opened`, `5:opened`; when `9` resolves, exactly 1 `9:resolved` |
| A wrong implementation that only skips enqueue on poll | `#resendPending` sends `7:opened` at start |

Failed drop, then re-enable. This is the case from the second plan-review. Run it in this order
with a fresh `H`, a local receiver and the same ledger file reopened at each restart:

| Step | Expected |
| --- | --- |
| `H` (webhook, `sendIncidents: true`) has `pending` `7:opened` with payload and `pending` `budget:check:<t0>:<h>`; the notifier is stopped, the ledger closed | 2 pending entries |
| Restart with `sendIncidents: false`, `alerts: ["budget-low"]`, and a ledger whose `beforeCommit` throws | constructing the notifier throws `cannot drop pending incident notifications of channels with sendIncidents false`; 0 requests; `7:opened` and the `budget:` key are both still `pending` |
| Restart with `sendIncidents: true`, no hook | the receiver gets exactly 2 requests: `7:opened` once and the `budget:` key once (the switch never took effect, so `7:opened` was still owed) |
| Same first two steps again, then restart with `sendIncidents: false`, no hook | `7:opened` `dropped`, exactly 1 request (the `budget:` key); then restart with `sendIncidents: true`: 0 more requests over 10 polls |
| A wrong implementation that settles key by key and logs failures | the first restart runs with `7:opened` still pending and partly dropped entries; a re-enable after that run sends `7:opened` |
| `main` with a notifier constructor that throws | `main` throws; the lock is released (a second `main` on the same state path acquires it) |
| `ledger.seed` of `9:opened` fails in one poll on `H` with `sendIncidents: false` (hook throws once) | log `incident seed failed, the next poll retries`; 0 requests; the next poll stores `9:opened` as `seeded` |

### Routing and config

- Channel `{ alerts: ["budget-low"], checks: ["api-*"] }`: check `api-1` low → event;
  check `web-1` low → none; component `web` low → event (component filters absent).
- Channel `{ alerts: ["budget-low"], components: ["web"], excludeComponents: ["web"] }`:
  component `web` → none (exclusion wins).
- Channel with `alerts: ["tls-expiry"]`: a domain check at 14 → none.
- Channel without `alerts`: no warning at all, and incident payloads byte-identical to main.
- Rejected configs: `alerts: ["budget"]`, `alerts: "budget-low"`, `alerts: [1]`,
  `sendIncidents: "no"`, `sendIncidents: false` without `alerts`,
  `sendIncidents: false` with `remindEverySeconds: 60`.
- `PULSE_NOTIFY_BUDGET_THRESHOLD`: `101`, `-1`, `25.5`, `abc` stop startup; `0` and `100` start.
  With `0`, budget `0` → none, `-0.1` → event.

### Ledger format

- A format-3 file with an entry of status `sent` → refused as unsupported, bytes unchanged, no
  `<state>.v3.bak` written.
- A format-3 file with schema and `PRAGMA user_version = 4` (no `alert_state`) → refused.
- `user_version` 5 → refused.
- A valid format-3 file → format 4, all channels, marks and entries equal; second open logs no
  migration.

Migration crash with committed WAL data (R9). The fixture follows the existing pattern in
`notify/test/ledger.v2.test.ts:259-270`: a writer with `journal_mode = WAL` and
`wal_autocheckpoint = 0` writes the format-3 schema with channel `c` and the three entries
`1:opened` (`delivered`), `2:opened` (`failed` with payload) and `3:opened` (`pending` with
payload). The main file and `-wal` are copied while the writer is still open, so the rows are
only in the copied WAL. Precondition, checked in the test: a copy of the main file without its
`-wal` opened on its own has 0 rows in `entries`.

| Case | Expected |
| --- | --- |
| Open with `afterSidecars` throwing (crash between sidecar removal and the rename) | the open throws; `<state>-wal` absent or 0 bytes; `<state>` opened on its own has `user_version` 3 and exactly the 3 entries; `<state>.v3.bak` has `user_version` 3 and exactly the 3 entries |
| Then open again with no hook | format 4 (`user_version` 4) with exactly the 3 entries and their statuses; `<state>.v3.bak` still has exactly the 3 entries; log `ledger migrated` with `from: 3` |
| Open with `beforePublish` throwing (crash after the backup), then open with no hook | same final state as the row above |
| A pre-existing `<state>.v3.bak` that holds the 3 entries, and the first case run twice before a clean open | the backup still has exactly the 3 entries after each attempt |
| A wrong implementation that publishes without the checkpoint | first case: `<state>` alone has 0 entries; the clean open gives format 4 with 0 entries, and the backup is overwritten with 0 entries |
| A refused format-3 file (an entry of status `sent`) only in the WAL | refused; main file and `-wal` bytes unchanged (no checkpoint ran); no backup |
| A second read/write connection holds a read transaction open on the format-3 file during the open (the checkpoint is blocked) | the open throws `ledger checkpoint was blocked`; `<state>` and `<state>-wal` still give the 3 entries; no backup and no `.migrating` remain |

Statistics: notify computes no statistic. `budgetRemaining` and `availability` are the api's
values (30 UTC calendar days, result-weighted, `api/src/slo.ts:11-21`, unrounded). Display
rounding is only in chat and email text: round down (`Math.floor`) to 0.1 for the budget and to
0.001 for availability; examples: `24.96` → `24.9`, `-3.25` → `-3.3`, `99.8816` → `99.881`.
The comparison with the threshold always uses the unrounded value.

## Contract fields

No contract or api name is added or renamed. New names local to notify, each searched in the
contract source, the config clone and notify's source on the inspected commits (contract
`2c4e0e0`, config `bc87049`, notify `227fd6d`):

| Name | Where | Search | Result |
| --- | --- | --- | --- |
| `alerts` | channel key | `grep -rn 'alerts' .repos/contract/src .repos/config .repos/notify/src` | no match |
| `sendIncidents` | channel key | `grep -rn 'sendIncidents' …same paths` | no match |
| `budget-low` | event, alert kind | `grep -rn 'budget-low' …` | no match |
| `tls-expiry` | event, alert kind | `grep -rn 'tls-expiry' …` | no match |
| `domain-expiry` | event, alert kind | `grep -rn 'domain-expiry' …` | no match |
| `PULSE_NOTIFY_BUDGET_THRESHOLD` | env var | `grep -rn 'BUDGET_THRESHOLD' …` | no match |
| `alert_state` | ledger table | `grep -rn 'alert_state' …` | no match |
| `subject` | payload field | `grep -rn 'subject' .repos/contract/src .repos/notify/src` | contract: none; notify: only the email `subject` header (`src/channels/email.ts`), a different layer |
| `budget`, `expiry` | payload fields | `grep -rn '"budget"\|expiry' .repos/contract/src` | only doc comments in `schema.ts` (lines 516, 933, 950, 985); no field |
| `daysLeft`, `milestone`, `observedMs` | payload fields | `grep -rn 'daysLeft\b\|milestone\|observedMs' …` | no match (`certDaysLeft` is a different, contract name and is not reused) |
| `components` | metric feed label | `FEED_NAMES` in `notify/src/metrics.ts:6-8` | not a label yet; `/components` is the existing api route |
| `afterSidecars` | test-only ledger hook | `grep -rn 'afterSidecars' .repos/contract/src .repos/config .repos/notify/src .repos/notify/test` | no match (existing hooks: `beforeCommit`, `beforePublish`, `notify/src/ledger.ts:118-124`) |
| keys `budget:…`, `expiry:…` | event keys | ledger patterns `notify/src/ledger.ts:402-404` | do not match `^(\d+):`, `^(\d+):reminder:`, `^manual:` |

## Unchanged repositories

api: the issue names api, but every input exists on api `main` `2bc5910`:
`GET /checks` returns `CheckWithState` with `slo` (`api/src/service.ts:993-998`) and, for `tls` and
`domain` checks, `certDaysLeft` of the newest result (`api/src/service.ts:791-796`);
`GET /components` returns `slo` per component (`api/src/server.ts:675-682`,
`api/src/components.ts:37`); `buildSlo` computes `budgetRemaining` (`api/src/slo.ts:15-21`).
No api task is opened.

## Repository: notify

Files:
- `src/types.ts`
- `src/channel-schema.ts`
- `src/config.ts`
- `src/index.ts`
- `src/api.ts`
- `src/metrics.ts`
- `src/budget-alerts.ts` (new)
- `src/expiry-alerts.ts` (new)
- `src/notifier.ts`
- `src/ledger.ts`
- `src/channels/routing.ts`
- `src/channels/message.ts`
- `src/channels/slack.ts`
- `src/channels/teams.ts`
- `src/channels/email.ts`
- `test/support.ts`
- `test/budget-alerts.test.ts` (new)
- `test/expiry-alerts.test.ts` (new)
- `test/alerts.test.ts` (new)
- `test/send-incidents.test.ts` (new)
- `test/ledger.v4.test.ts` (new)
- `test/index.test.ts`
- `test/config.test.ts`
- `test/message.test.ts`
- `test/routing.test.ts`
- `test/webhook.test.ts`
- `test/failed-cli.test.ts`
- `test/prune.test.ts`
- `test/security-ledger-permissions.test.ts`
- `test/ledger.test.ts`
- `test/ledger.v2.test.ts`
- `test/metrics.test.ts`
- `test/reminders.test.ts`
- `README.md`
- `docs/configuration.md`
- `docs/channels.md`
- `docs/channels/webhook.md`
- `docs/channels/file.md`
- `docs/channels/slack.md`
- `docs/channels/teams.md`
- `docs/channels/email.md`
- `docs/operation.md`
- `docs/troubleshooting.md`
- `docs/development.md`
- `package.json`

Behavior change: yes
New config keys, a new setting, a new feed read, new events and a new ledger format.

What each file holds (plain words, no paths beyond the list above):

- types: the notification union with an incident variant, a budget variant and an expiry
  variant; the two new channel keys on the channel base.
- channel schema and config: the two channel keys with the cross-field rules of R1, the threshold
  setting; index wires the threshold into the notifier and, when constructing the notifier
  throws, closes the ledger, releases the lock and rethrows (R1).
- api client: the checks read also returns the validated check states; a new components read with
  404 as absent. metrics: the new feed label.
- budget alerts and expiry alerts: new pure modules for R5, R6 (observation selection and stage
  machine) and the keys of R7, with `nowMs` and stored state passed in.
- notifier: feed reads, the evaluation order and seeding gate of R4, the R1 drop at construction
  (one ledger transaction, a throw on failure) and per-poll seeding for warning-only channels,
  enqueue after the alert commit, alert pruning, the narrowed stale check.
- ledger: format 4, the alert table and its mirror, the format-3 migration of R9 (validate,
  checkpoint, re-read, backup, publish) with the `afterSidecars` test hook, the one-transaction
  drop of pending incident entries, the per-poll alert transaction, alert pruning.
- routing: whether a channel wants a warning event (R10). message, slack, teams, email: the labels
  and lines of R8. The failed CLI needs no change (it reads the event from the stored payload); its tests get cases for the new keys.
- tests: the new suites and new cases named below; docs as in R11; package description text only
  (no dependency or pin change).

Behavior: R1-R11. Module split: the budget and expiry rules are pure functions over parsed
contract types and stored state, with `nowMs` passed in (notify `AGENTS.md`, "Keep logic pure");
the notifier does I/O and wiring; the ledger owns persistence. Names of new modules and functions
may differ if the responsibility split stays. Keep cognitive complexity per function at most 15
(see tool facts). Do not change existing tests' expectations, except these, which the PR names:

- `test/ledger.test.ts:95-114` asserts the exact format-3 schema and `user_version` 3: update it
  to the format-4 schema (with `alert_state`) and `user_version` 4.
- `test/metrics.test.ts:36-48` lists the feed labels of the exposition: add the `components`
  lines with value 0.
- `test/ledger.v2.test.ts:211` and `test/index.test.ts:188` refuse a format-3 schema with
  `user_version` 4. They must keep passing unchanged (that file has no `alert_state`, so it is
  still refused). Add a `user_version` 5 case in `test/ledger.v2.test.ts`.
- `test/reminders.test.ts:149` asserts `assert.equal(state.version, 3)`, where `state.version`
  is `PRAGMA user_version` of the saved ledger (`savedState()`, lines 51-61). Its ledger is
  created by the code under test, so after R9 it is format 4: change only the literal `3` on
  line 149 to `4`. The key list asserted on lines 145-148 stays unchanged. This belongs to the
  ledger task (the same change that bumps the format), so the full suite stays green after it.
  A search of notify `test/` at `227fd6d` (`grep -rn 'user_version' test`) finds
  `user_version` only in `ledger.test.ts`, `ledger.v2.test.ts`, `index.test.ts` and
  `reminders.test.ts`; no other test asserts the format number.
- Existing format-3 tests that now see a migration keep their assertions on rows and refusals.
  Only a direct assertion of `user_version` 3 after a successful open changes to 4, and the PR
  names each such line.

TDD order (red first): config rejection of `alerts` (fails on main: `strictObject` rejects the
unknown key), budget once per 24 h, expiry `[14, 3]`, the restart-safe ordering table, then the
rest. Record the failing run of the budget and expiry tests on `main` in the PR (test names and
the failure line).

Tool facts (verified at notify `227fd6d649bc71b5291b7cb47eb3adc08f6ff42d`):
- Bun 1.4.0: `package.json:9` (`engines.bun`) and `package.json:35` (`packageManager`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:17`);
  lint is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`), Biome `2.6.3`
  (`package.json:21`); typecheck is `tsc --noEmit` of `typescript7` = `npm:typescript@7.0.2`
  (`package.json:12`, `:27`); test is `bun test` (`package.json:13`).
- `bunfig.toml:1-4`: `[test]` coverage on, line threshold 0.8, `test/**` excluded from coverage.
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned at
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:22`). The pinned file, read with
  `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=04108fa…"`, is identical to the
  config clone (`bc87049`); `files.includes` (lines 10-17) covers `**` except `dist`,
  `node_modules`, `bun.lock`, `*.html` and `test/fixtures`, so new `src/` and `test/` files are
  linted.
- ESLint: `eslint.config.js:1-4` spreads `@lorenzh/pulse-config/eslint.config.js` (ignoring only
  `.repos/**`). The pinned file at `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`, read with
  `gh api "repos/lorenzh/pulse-config/contents/eslint.config.js?ref=04108fa…"`, sets
  `"sonarjs/cognitive-complexity": ["error", 15]` at line 16 for `**/*.ts` and `**/*.js`
  (lines 10-17); it is identical to the config clone (`bc87049`, `diff` empty).
- CI: `.github/workflows/ci.yml:18` uses `check.yml@04108fa…` without `build`; the pinned
  `check.yml` is identical to the clone and runs install, lint, typecheck and test (lines 25-38).
  The `docker` job builds the image (`ci.yml:32`), checks dotenv files (`:34`), the absence of
  test files (`:35-42`) and the healthcheck (`:43-…`).
- Contract pin `7ce23aaf3fa3e038f65ecfed755188b83bde143f` (`package.json:30`) exports
  `validateCheckWithState` and `validateComponentWithState` (that ref's `src/validate.ts:142`,
  `:270`). Kit pin `236df214f9df8658f2992dd6f7c100952c07102b` (`package.json:31`) has
  `readInt` with `max` (that ref's `src/settings.ts:55-61`) and `writeFileAtomicSync` (that
  ref's `src/atomic-write.ts:216-256`: temp file with `wx`, fsync, rename, directory fsync; the
  mode of an existing destination is kept, `:122-130`). That file was read with
  `gh api "repos/lorenzh/pulse-kit/contents/src/atomic-write.ts?ref=236df214…"` and is
  identical to the kit clone. No pin changes.

Checks and completion evidence:
1. `bun run check` exits 0.
2. `bun test test/budget-alerts.test.ts test/expiry-alerts.test.ts test/alerts.test.ts test/send-incidents.test.ts test/ledger.v4.test.ts`
   passes and covers every row of "Counterexamples" with the literal inputs and expected values
   of this spec. The same budget and expiry behavior tests fail on `origin/main` (shown in the PR:
   names and the failing assertion or the startup error for the unknown `alerts` key).
3. End to end over HTTP (`test/alerts.test.ts`): the fake api (`test/support.ts`) serves
   `/checks` with a check `api-1` of `slo.budgetRemaining` 24 and a TLS check with
   `certDaysLeft` 13; two webhook channels on a local receiver (`startReceiver`) subscribe; the
   receiver gets exactly 1 `budget-low` and 1 `tls-expiry` request per channel, each with an
   `idempotency-key` equal to the body `key`; a channel without `alerts` gets 0. A receiver that
   answers 500 twice and then 204 gets the same key 3 times and no new key. A 404 on
   `/components` leaves incident delivery and check budgets working.
4. `sendIncidents` over HTTP (`test/send-incidents.test.ts`): the `sendIncidents: false` table
   of "Counterexamples", with a ledger reopened across the restarts and a local receiver; the
   receiver's request log shows 0 incident keys across the restart, the re-enable and 10 polls,
   and exactly the literal keys of that table. The "Failed drop, then re-enable" table runs step
   by step against one ledger file and the receiver log. After the failed start: 0 requests and
   2 `pending` entries. After the restart with `sendIncidents: true`: exactly `7:opened` once and
   the `budget:` key once. On the second path: exactly 1 request, then 0 more after the
   re-enable. The `main` lock-release row is in `test/index.test.ts`.
5. Ledger: a format-3 file made by the `main` code path (or a fixture built with the format-3
   schema in the test) opens as format 4 with every entry and mark kept, `PRAGMA user_version`
   is `4`, `<state>.v3.bak` exists with mode `0600` and `user_version` `3`; a second open does
   not migrate again; the "Ledger format" counterexamples hold; a `<state>.v3.bak` symlink is
   replaced by a regular file with mode `0600` and its target keeps its bytes and mode. The
   "Migration crash with committed WAL data" table runs in `test/ledger.v4.test.ts`. The fixture
   has 3 entries only in its WAL, and the test first checks that the main file alone has 0. The
   expected counts are the literal 3 and 0 from that table, read from the files with a separate
   `bun:sqlite` connection, not through `Ledger`. The PR shows this test failing on a branch
   state without the checkpoint step (the publish path of `main`): 0 entries after the clean
   open.
6. Incident behavior unchanged: the existing suites (`notifier`, `reminders*`, `manual-*`,
   `routing-change`, `ledger*`, `prune`, `webhook`, `channels`) pass without changed
   expectations, except the cases named above.
7. Performance: the three measurements of "Performance impact" with their literal limits
   (`test_cpu_s` A/B difference below 0.3 s; startup CPU of a format-3 and a format-4 start;
   the runtime runs with at most 0.1 s / 0.3 s CPU and 3 MiB `VmHWM` above main), with the raw
   numbers in the PR.
8. Run once by hand: `bun run start` with `PULSE_NOTIFY_CONFIG` pointing at a file channel with
   `alerts: ["budget-low","tls-expiry"]`, `PULSE_API_URL` at a local fake api (for example a
   short `Bun.serve` script outside the repository serving the `/checks`, `/incidents`,
   `/manual-incidents`, `/components` bodies of check 3), and `PULSE_NOTIFY_POLL_MS=1000`. Report
   the command and the file lines: exactly one `budget-low` and one `tls-expiry` line after 10
   polls.
9. Compose: build `docker build -t pulse-notify:candidate .` from the branch. In a scratch copy
   of `lorenzh/pulse-deploy` `main` (not committed), replace the notify `image:` line of
   `common/services.yaml` (line 35 at deploy `c3e340a`) with `pulse-notify:candidate` and run
   `bash e2e/compose-e2e.sh` to completion with exit 0. Report the deploy SHA, the notify commit
   SHA, the candidate image id and the last lines of the output. The api image stays the pinned
   one (api is unchanged). The PR also shows the notify CI `check` and `docker` jobs green.
10. The PR names the issue, the checks that ran and the known limits: renewal inside 14 days is
    not seen; late subscribers get the next due event only; incident deliveries of a
    warning-only channel are dropped; downgrade needs `<state>.v3.bak`; warnings can be up to
    `2 × intervalMs` late.
