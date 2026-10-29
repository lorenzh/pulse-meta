# Issue review: #243 Notify reminders: stale and backlogged reminders

Scope: target `notify` only (`src/notifier.ts`, `src/delivery.ts`, `src/channels/smtp.ts`, tests). No contract/api change. Verified in `.repos/notify`:
- `isStale` at notifier.ts:134 uses `#resolved`, which is filled only in a poll (line 229); `start()` calls `#resendPending()` before the first poll.
- `isStale` is the only drop hook (delivery.ts:126); nothing compares reminder numbers.
- SMTP `command()` (smtp.ts:~163) puts `reply.lines[0]` into the error for every step, including the AUTH steps (lines 233-237).

## Open points (none blocks the spec)
1. Startup if the first poll fails (API down): assumption is that pending reminders stay held until the first successful poll. Other pending events (opened/resolved) are still resent at startup, as now.
2. Held reminders must not be lost: they stay in the ledger as pending, and settle or send after the first poll. The poll must populate `#resolved` before the release.
3. "Settled without sending": assumption is the same ledger outcome as the existing stale drop (`dropped`), not `failed`, and no failure metric. The plan should reuse that path.
4. Superseding: the key format `<incident>:reminder:<n>` is the basis. Supersede covers both in-flight/queued and ledger-pending items of the same incident and channel. Different channels are independent. Latest means highest n among those pending at send time. A reminder with a higher n that was already delivered also supersedes lower pending ones.
5. Superseding must be evaluated at send time, including retries, so a reminder in retry backoff is dropped when a newer one is queued. Plan must define behavior when the newer one then fails (assumption: the older one is not resurrected).
6. AUTH redaction: omit reply text for all AUTH steps (PLAIN, LOGIN username/password steps, including the 334 challenge steps), keep the code. Message shape e.g. `SMTP AUTH failed: 535`. Other commands keep text. Check that the log fields and `errorFields` do not carry the raw reply elsewhere.
7. Test item 4: the two tests must assert the SMTP stub was called (count > 0) and the failure outcome (ledger failed, error log present); verify by removing the sender.
8. Docs/spec: README/docs already promise latest-only; no doc change required, check wording against decision 8 in `.factory/work/239/plan.md`.

## Derived acceptance check
- Restart with pending `1:reminder:1`, incident 1 resolved in the API: events are `["1:resolved"]`.
- Four failed reminder intervals, then recovery: only `1:reminder:4` is delivered; 1-3 are settled without sending.
- An SMTP AUTH failure whose reply echoes the credentials gives an error and log with the code and no reply text.
- The two strengthened tests fail when the SMTP sender is removed; the new regression tests for 1, 2 and 3 fail on the current code; `npm test` passes in notify.
