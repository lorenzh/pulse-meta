# Spec #243: Notify reminders: stale and backlogged reminders after restart or outage

Follow-up to #239 (decision 8: latest-n-only). Open points and acceptance check: `.factory/work/243/issue-review.md`.

## Goal
Reminders never go out for incidents already resolved (also across a restart), never backlog after an outage (only the latest is delivered), and SMTP AUTH errors never carry server reply text. Two weak tests are made to fail without the SMTP sender.

## Scope
Only `notify` (`src/notifier.ts`, `src/delivery.ts`, `src/channels/smtp.ts`, tests). Default configs are unaffected (reminders are opt-in).

## Non-goals
No contract or API change; no new metric; no ledger format change (stays `version: 1`); no doc change except wording check against decision 8 of `.factory/work/239/plan.md`.

## Required behavior
1. **Startup.** Pending reminder entries in the ledger are held at startup (stay pending, not lost). Other pending events are resent at startup as now. After the first successful poll has filled the resolved set, held reminders are released: reminders of resolved incidents are settled as `dropped` (same path as the existing stale drop, no send, no failure metric); the others are sent (subject to rule 2). If the first poll fails, reminders stay held until a poll succeeds.
2. **Supersede.** Key `<incident>:reminder:<n>`. Evaluated at send time, including each retry: a reminder is settled as `dropped` without sending when a reminder of the same incident and the same channel with higher n is pending (queued, in retry, or ledger-pending) or already delivered. Channels are independent. A superseded reminder is not resurrected if the newer one fails. Only the latest is delivered.
3. **AUTH errors.** For every AUTH step (PLAIN, LOGIN username/password, including 334 challenge steps) the error message contains the code only, e.g. `SMTP AUTH failed: 535`, never reply text. Other commands keep the text. Check that the delivery log and `errorFields` carry no raw reply elsewhere.

## Risks
- Held reminders must still settle after the first poll (no leaks in the ledger).
- Supersede check must not drop a reminder because of a lower-n sibling (compare n numerically, not as strings).

## Acceptance evidence
- Restart with pending `1:reminder:1`, incident 1 resolved in the API: events `["1:resolved"]`.
- Four failed reminder intervals, then recovery: only `1:reminder:4` delivered; 1-3 `dropped`.
- SMTP AUTH failure whose reply echoes the base64 credentials: error and log hold the code, no reply text.
- `an SMTP error that never clears ends as failed` and `no secret, URL or password appears in logs or metrics` assert the SMTP stub was called (count > 0) and the failure ran (ledger `failed`, error log present); both fail when the SMTP sender is removed.
- New regression tests for 1, 2 and 3 fail on the current code; `npm test` and the repo's lint/typecheck pass.

## Repository: notify
Files: `src/notifier.ts` (hold reminders in `#resendPending()` until first successful poll, then release; supersede hook), `src/delivery.ts` (extend the drop hook so it can also decide supersession at send and retry time; reuse the `dropped` outcome), `src/channels/smtp.ts` (AUTH error without reply text), tests under `test/`.
Behavior: rules 1-3 above.
Checks: `npm test`, lint and typecheck as in the repo's `AGENTS.md`.
Done when: the acceptance evidence above holds, with the three regression tests failing on the old code and the two strengthened tests failing without the SMTP sender.
