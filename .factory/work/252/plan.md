# Spec #252: Notify reminders, a failed newer reminder lets an older one send

## Goal
A reminder is never sent when a newer reminder (same incident, same channel) exists in any ledger state except `dropped`. A newer reminder's failure must not resurrect an older one.

## Scope
`notify` only (`src/notifier.ts`, tests, doc comments). No contract, API, config or migration change; reminders are opt-in.

## Non-goals
- No edit to `.factory/work/243/plan.md` (merged feature); this spec amends its rule 2 (supersede: "pending or delivered" becomes "any status except dropped").
- No new metric, log or config. A superseded drop stays silent.
- Channel independence is unchanged: the check stays per channel.

## Required behavior
- `#isSuperseded` returns true when a reminder with the same incident id, a numerically higher n, exists on the same channel in `channel.queued` or in the ledger with any status except `dropped` (pending, in retry, delivered, failed).
- A `dropped` newer reminder does not supersede (harmless: it was dropped because the incident resolved or by an even newer one).
- Lower-n siblings never supersede a higher-n reminder. Other channels are not considered.

## Risks
- Ledger pruning (`src/ledger.ts` `pruneReminders`) removes older non-pending entries only when a newer one is written, and keeps pending ones, so a `failed` newer entry stays visible to `entries()` while an older pending/held one is evaluated. Verify with a test; no code change expected.
- A newer reminder's key must be in `queued` or the ledger at all times (no gap when it moves from queued to the ledger). Confirm by reading `ChannelDelivery`; adjust only if a gap exists.

## Acceptance evidence
- Regression test (`test/reminders.test.ts` or `notifier.test.ts`): restart with `1:reminder:1` pending in the ledger; the first successful poll queues `1:reminder:4` before releasing reminder 1; reminder 4 exhausts its attempts and ends `failed`; reminder 1 ends `dropped` and is never sent. It fails on the current code (reminder 1 ends `delivered`).
- Extra cases: newer reminder in retry or delivered also supersedes; a newer reminder on another channel does not; a lower-n sibling does not drop a higher-n reminder; a `dropped` newer one does not supersede.
- `npm test`, lint and typecheck pass as in the notify `AGENTS.md`.

## Repository: notify
- Files: `src/notifier.ts` (`#isSuperseded`), `src/ledger.ts` docs (`LedgerStatus`) if they state the old rule, tests under `test/`.
- Behavior: replace the `status === "pending" || status === "delivered"` condition with `status !== "dropped"`; queued keys count as before. Update the doc comment on `#isSuperseded` and the `LedgerStatus` docs to "any status except dropped".
- Checks: the tests above, plus `npm test`, lint and typecheck.
- Completion evidence: regression test fails before and passes after the change; all checks green.
