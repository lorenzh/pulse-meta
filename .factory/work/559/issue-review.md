# Issue review: #559 — notify delivery robustness

## Disposition and evidence

Ready for `plan`. No question requires a person to decide before specification. The open points below are implementation choices and recommended assumptions that the plan must resolve explicitly.

Read [issue #559 and its comments](https://github.com/lorenzh/pulse-meta/issues/559) on 2026-11-03. The only comment is the Factory claim for this run; there are no earlier decisions. Read meta `AGENTS.md`, `README.md`, approved packages and the issue-review prompt, plus notify instructions, implementation, relevant tests, operator documentation and CI. Inspected deploy instructions, Compose E2E and CI to identify the acceptance gate. All target clones remained read-only.

Notify HEAD is `3a0b4c8d340559e404c9e74b288aa3ea48492414`, newer than the issue's `c090a07`. The findings still apply, with these qualifications:

| Finding | Evidence in the inspected notify clone |
| --- | --- |
| Retry blocks the channel | `src/delivery.ts:87-105` awaits the complete delivery, including the retry sleeps at `:142-172`, before dequeuing another notification. `test/delivery.test.ts` explicitly expects FIFO completion. `docs/channels.md` promises ordering and documents unlimited retries blocking the channel. |
| Partial SMTP rejection loses recipient progress | The actual path is `src/channels/smtp-send.ts`. `assertAllAccepted` at `:122-130` throws after nodemailer has delivered to accepted recipients and classifies only the first rejection error. `src/channels/email.ts` builds every attempt with the complete `channel.to`; `SendMail` returns only `Promise<void>`. Retrying the notification therefore resends to accepted recipients. |
| Widened routing can replay history | `src/notifier.ts:451-459` seeds only unknown channels. Automatic initial seeding at `:498-503` already covers **all** visible automatic incidents, regardless of routing. Automatic incidents first seen later while excluded are not recorded by `#detectAutomatic` at `:525-544`; widening on restart can announce their history. Manual seeding filters by components, so widening component filters can replay even history present at initial seeding. There is no saved routing configuration in the ledger. |
| Whole-state write cost remains | The ledger is JSON version 2 and reads version 1 too. `src/ledger.ts:194-201` serializes and atomically rewrites all state for `seed`, `claim` and `resend`. Settlements and pruning are **already batched** for 100 ms, but `:233-271` still serialize whole snapshots, including additional comparisons. Merely adding batching does not meet the issue. |

The issue's named quality report is not present at `audits/quality/notify.md` in this checkout; the available audit paths were listed directly. Current-behavior conclusions above come from the cloned implementation, tests and documentation rather than assuming the older reports match main.

## Open points and planning assumptions

### 1. Scheduling, ordering and resource bounds

Interpret the requested isolation as per-notification retry eligibility: an event waiting for backoff cannot occupy the channel's sending capacity. Later ready events must get an attempt before that timer expires, including with `PULSE_NOTIFY_RETRY_ATTEMPTS=0`. A bounded scheduler can retain one active send per channel and release that slot during retry waits; unlimited concurrent sends are unnecessary. The plan must state fairness between newly ready events and due retries, and prevent a key from having simultaneous attempts.

Existing strict FIFO completion and the documented `resolved`-after-`opened` guarantee need an explicit reconciliation. Recommended default: preserve initial attempt order for ready events, but allow later events, including a resolution or manual update, to complete while an earlier event is retrying. Update the ordering documentation and tests accordingly. A plan choosing per-incident ordering instead must explain that restriction and still prove independent incidents on the same channel progress during an unlimited retry. Channel-wide FIFO completion is incompatible with the request.

Keep current backoff defaults, caps, finite attempt limits and immediate permanent-error handling. Keep keys protected against poll re-enqueue while queued, sending or waiting for retry. `idle()` must account for retry timers; `stop()` must cancel all timers and active sends, settle promptly, and leave unfinished durable claims pending. Preserve stale-reminder checks before every attempt, including after a retry wait, and exactly one final outcome/release per event. This work does not require durable preservation of elapsed backoff or attempt counts across process restarts unless the plan deliberately adds it.

### 2. SMTP partial success and mixed rejection classes

Define progress by SMTP envelope recipient, using normalized envelope addresses rather than display names. Only recipients whose delivery was confirmed by a successful DATA result count as accepted deliveries: RCPT acceptance followed by failed/unknown DATA is insufficient. Keep the notification's stable Message-ID and distinguish the retry envelope from any visible recipient header.

Recommended default: remove confirmed delivered recipients from subsequent automatic attempts of this event; retain retryable refused recipients; mark 5xx refusals terminal for those recipients. A mixed 2xx/4xx/5xx result must still retry the 4xx subset rather than allowing the first 5xx to terminate everyone. Record the event delivered only if all recipients succeed; otherwise record failed when all remaining work is terminal or the attempt limit is reached. With unlimited retries, permanently rejected recipients must not be retried indefinitely.

The plan must define a typed sender result/error and the owner of recipient progress; a mutable channel-wide recipient list would leak state between notifications, especially after scheduler changes. Use structured outcomes from the SMTP client, and keep raw SMTP reply text, addresses and credentials out of logs/metrics.

Recommended restart/resend assumption: persist confirmed recipient progress with the event, so pending recovery and `failed resend` retry only recipients still needing delivery. Explicit CLI resend may retry a previously permanent refusal, but must retain confirmed successes. Legacy entries with no recipient progress use the configured recipients. Document how a changed recipient list interacts with an existing event; default to keeping its recorded delivery scope rather than resetting its successes. Preserve at-least-once semantics: a crash between SMTP acknowledgment and durable progress can still duplicate a delivery. Exactly-once delivery after an unknown SMTP outcome is not required.

### 3. Filter-change scope and the history boundary

Configuration is read at process start; implement this across restarts using the same channel ID and state path, without adding hot reload. Cover `checks`, `excludeChecks`, `components` and `excludeComponents`, including glob widening and exclusion removal. Missing and empty lists have their existing meaning; reordered equivalent lists should not create a new baseline. Changing only a destination, secret or subject is not a routing change.

Recommended meaning of “old”: events already present in the first successful relevant incident snapshot used to apply the changed routing. Seed existing opening/resolution keys, manual updates, and the current due reminder for newly eligible history without sending. A later resolution/update or next reminder interval is a new event and must still notify. Preserve existing pending/failed/delivered entries; seeding must not overwrite delivery status or SMTP progress. Existing claimed work remains recoverable even if filters subsequently change; this feature is not cancellation of already claimed deliveries.

The plan must choose how to track routing history or excluded observations. Avoid blanket reseeding on every restart: an unchanged channel must still deliver unseen events that occurred during downtime. Prefer preserving catch-up for continuously eligible checks/components when filters change, while suppressing newly eligible history. Define the one-time baseline when migrating a ledger with no routing metadata, including any once-only suppression of unclaimed history; the old filter cannot be reconstructed from that ledger alone.

Persist baseline keys and the routing marker atomically. A failed write must leave initialization retryable and must not permit history to send. A failed feed must not count as an empty successful snapshot. Keep automatic and manual initialization independent where possible; manual 404 means absent, and its first later successful read still needs quiet seeding. Preserve existing independent feed recovery behavior. Filtering a manual incident by components differs from check routing and needs its own case.

### 4. Storage format, migration and operational compatibility

The plan must name the new on-disk format, version, path layout and transactions/durability boundaries. Built-in `bun:sqlite` is an allowed option under `docs/approved-packages.md`; an append journal is another option if the plan defines complete-record framing, torn-tail recovery and compaction. Prefer a built-in over introducing a new runtime package or custom generic storage framework. This remains notify work unless a concrete shared-library or deploy change is identified.

Each ordinary event mutation must persist only its affected data, not serialize/rewrite retained ledger history. Explicitly separate one-time migration, startup loading, retention scans and occasional checkpoint/compaction cost from ordinary claim/settle/resend cost. If compaction is used, bound and explain its amortized cost; moving a full rewrite into every flush does not satisfy the requirement.

Migrate both supported JSON versions under the existing state lease, preserving statuses, timestamps where present, pending/failed payloads, manual/reminder marks and channel identity. Preserve legacy pending entries without payloads and their rebuild behavior. State how migration is published atomically, how interruption is recovered, how an unsupported/corrupt format fails without replacing valid state, and how the original can be restored. No send before a durable claim; no half-applied seed, recipient-progress change or resend. At-least-once delivery and the existing bounded settlement-loss window may remain if documented; durability must not silently weaken.

Account for `flush()`, lock loss (`close()` must prevent later writes), CLI lock exclusion, retention, and concurrent mutation versus flushing/checkpointing. Tests that read raw JSON should move to the specified storage contract rather than being deleted along with their behavioral coverage. Update notify `README.md`, `AGENTS.md` ledger description and operator docs, especially backup/restore: copying one live file is currently documented as safe and may be false for a journal or SQLite WAL. Keep `PULSE_NOTIFY_STATE` usable at the existing path, including its `.json` name, or specify an automatic compatible transition. Keep secrets out of persisted routing metadata and migration diagnostics.

### 5. CI and Compose E2E provenance

Notify CI runs `bun run check` through pulse-config and Docker checks on amd64 and arm64. Compose E2E lives in **deploy**, at `e2e/compose-e2e.sh`, invoked by deploy CI's `full` job. It selects its own Compose files, rejects service `build` keys and starts with `--pull missing`; `common/services.yaml` supplies published image pins. A green run of unchanged published pins alone does not validate this notify change.

The plan must specify candidate validation. A feasible approach is to build the candidate notify image and run the existing E2E script in a disposable deploy fixture with only its notify image reference changed to that local image, keeping the other pins and existing assertions. Record the notify commit and image identity. Never edit the read-only deploy clone. No persistent deploy change is needed just for this test; reusable E2E tooling changes would require an explicitly scoped deploy target. Image release and production pin updates remain a separate release step.

## Derived acceptance check

Acceptance requires four regression groups that demonstrate the reported failures on the inspected notify baseline and pass after implementation, plus evidence of bounded incremental ledger write work, existing CI and candidate-image Compose E2E. The groups need the following observable checks:

| Requirement | Regression and controls |
| --- | --- |
| Retry isolation | Fail event A, hold its injected retry timer unresolved, enqueue an independent event B on the same channel and observe B delivered before releasing A's timer. A stays pending and makes no premature attempt. Release the timer and observe A retry alone. Cover unlimited retries, independent timer/attempt accounting, duplicate polls, chosen related-event ordering, stop while multiple events wait, and stale reminders after resolution. Existing FIFO assertions must reflect the specified policy. |
| Partial SMTP refusal | Use the real sender and a loopback SMTP fixture: A accepts DATA, B initially refuses with 451 then accepts. Drive notification retry and assert the next envelope contains B only and A receives the message once. Add mixed temporary/permanent refusals, all-refused and DATA-failure controls; separate events retain independent recipient sets. Reopen persisted state and exercise pending recovery and `failed resend` without replaying recorded successes. |
| Quiet filter changes | Start a restricted channel, then expose incidents while their checks are excluded; restart with widened include/exclude rules and the same state. The first successful snapshot sends no old openings/resolutions/due reminders, a repeated poll/restart remains quiet, and later new incidents/resolutions/reminder intervals deliver. Repeat for manual component widening and old updates. Test feed failure/recovery, failed baseline persistence, equivalent filters, unchanged-config downtime catch-up and migration without routing metadata. Initial automatic seeding already covers all visible incidents, so a test using only that initial history would not reproduce the bug. |
| Atomic incremental ledger | A fixed-size claim and settlement at large prepopulated state persist only affected records, while reopen recovers consistent state. Instrument bytes/records written and/or serialization work to demonstrate the old whole-file rewrite failing this check. Verify v1/v2 migration, restart idempotence, pending/failed payloads and recipient progress, seed/claim/resend failure rollback, interrupted write/migration recovery, pruning, flush races, shutdown and lock loss. |

For the cost check, compare fixed-size event operations against prepopulated ledgers of, for example, 100, 10,000 and 100,000 entries, excluding fixture setup and migration. Use a deterministic work/bytes bound or report repeated per-operation timing and write volume with an explicit pass criterion. The requirement is removal of work proportional to total ledger size for each event, not identical wall-clock times across machines or a ban on indexed database lookup. Batched full snapshots alone must fail the check; include the claim path, not just settlement throughput.

Implementation handoff must report `bun install --frozen-lockfile`, `bun run check`, notify's existing Docker CI gates, a `bun run start` exercise of changed behavior as required by notify instructions, and candidate-image `bash e2e/compose-e2e.sh` ending with `==> All checks passed`. Record baseline failures, candidate passes, commands and image identities. Report environmental failures honestly; an unchanged release image or skipped gate is not candidate validation.

## Review validation

This state inspected source/tests/docs and read the live issue/comments; it made no product changes and ran no product tests, benchmark or Compose stack. The checks above are requirements for later states, not claimed results. Initial GitHub connector argument errors were recovered by a successful comments read and `gh issue view 559 --repo lorenzh/pulse-meta --json title,body,comments`. Missing optional paths were resolved by listing available files; there is no unresolved tool failure blocking this review.
