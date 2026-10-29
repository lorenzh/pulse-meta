# Issue review: #252 Notify reminders, a failed newer reminder lets an older one send

Target: `notify` only. No contract, API or config change.

## Current behavior (checked in `.repos/notify`)
- `src/notifier.ts` `#isSuperseded` (~151-165): a newer reminder counts only with ledger status `pending` or `delivered`, or when its key is in `channel.queued`. Ledger status `failed` is ignored, so the older reminder is sent.
- Reproduction fits: `#pollChannel` queues `1:reminder:4`, then `#releaseHeld` releases `1:reminder:1`. Reminder 4 ends `failed`, and the later send-time check lets reminder 1 through.
- Spec `.factory/work/243/plan.md` rule 2 lists only "pending or delivered". This issue widens it, so the old rule text is superseded.

## Required change
- A newer reminder (same incident, same channel, higher n compared numerically) supersedes an older one in every ledger state except `dropped`: queued, pending, in retry, delivered or failed.
- A newer reminder's failure must never resurrect an older one.

## Open points (none block the spec)
1. `dropped` newer reminder. A newer reminder dropped because its incident resolved does not supersede. This is harmless, because the older one is dropped too (the incident is in `#resolved`). A newer reminder dropped as superseded by an even newer one is covered by that one. Assumption: keep `dropped` excluded, as the issue says.
2. Ledger pruning (`src/ledger.ts` ~40) deletes older non-pending entries when a newer one exists. Check that a `failed` newer entry is not pruned before the older held or pending one is evaluated. The `entries()` lookup must still see it. The plan should verify this and add a test.
3. Failed older entries. The older reminder in `failed` or `delivered` state is never re-sent, so only pending or held ones are affected.
4. In-flight newer reminder. A newer reminder in its first attempt is in `queued` or `pending`, which is already covered. The plan should confirm that the key leaves `queued` and moves to the ledger at the same step, with no gap where neither source sees it.
5. Doc comment on `#isSuperseded` and the `LedgerStatus` docs should say "any status except dropped".
6. The spec `.factory/work/243/plan.md` is not edited (it belongs to a merged feature). The new spec states the amended rule.

## Assumptions
- Reminders are opt-in, so there is no migration or config change.
- Channel independence is unchanged: the check stays per channel.
- No new metric or log is needed. A superseded drop stays silent, as for existing drops.

## Acceptance check
- Regression test in `test/reminders.test.ts` (or `notifier.test.ts`): restart with `1:reminder:1` pending in the ledger. The first successful poll queues `1:reminder:4`, then releases reminder 1. Reminder 4 exhausts its attempts and ends `failed`. Reminder 1 ends `dropped` and is never sent. The test fails on the current code (reminder 1 `delivered`).
- Extra cases: a newer reminder in retry, delivered or failed on another channel does not affect this channel. A lower-n sibling never drops a higher-n reminder.
- `npm test`, lint and typecheck pass as in the notify `AGENTS.md`.
