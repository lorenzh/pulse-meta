# Issue review: #165 Notify: deliver at least once

Target: `notify` only (checked against `.repos/notify` main). No contract/api change needed.

## Findings verified
- 4 attempts, fixed `PULSE_NOTIFY_RETRY_DELAY_MS` (1000) => ~3 s (`delivery.ts`). Confirmed.
- `delivery.ts`: after `sleep`, `if (this.#stopped) return;` leaves the key `pending`, but start only logs it (`notifier.ts start()`), never resends. `index.ts` shutdown calls `process.exit(0)` right after `stop()`. Confirmed.
- `timeout.ts` `finally { cancel() }` runs when headers arrive; `api.ts` `res.json()` has no timeout; next poll is scheduled in `.finally` of `tick()`. Confirmed (also webhook sender should be checked for the same body-read issue).
- `#poll` has no try/catch around the detection/enqueue part: `new Date(NaN).toISOString()` throws RangeError; `ledger.seed/claim/settle` throw on write errors (`#deliver` is not guarded, `claim` is outside try). `tick()` doc says "Never throws". Rejection reaches `void this.tick().finally(...)` unhandled, and `#drain` rejection reaches `.finally` unhandled. Confirmed.
- Error logs use `err.message` only; Node fetch gives `fetch failed` with the real reason in `err.cause`. Confirmed.

## Open points (none block the spec)
1. **Ledger holds only status, not payload.** Resend on start needs the notification. Options: (a) persist the notification in the ledger entry (ledger format change, needs backward-compat with version 1 files and entries without payload), (b) rebuild it from the API at start/next poll from the incident id in the key (`<id>:<event>`). Plan must pick one; (b) avoids format change but needs the incident to still be returned by the API and a policy for pending keys whose incident is gone (log and settle `failed`/leave). Old `pending` entries written by the previous version have no payload either.
2. **Does retrying ever end?** "Cover minutes" with a cap suggests finite attempts, but at-least-once suggests never giving up. Assumption: keep a finite, configurable schedule (default e.g. 1s doubling, cap 60s, ~10 attempts, ~10 min); after exhaustion mark `failed` as today. Alternatively leave `pending` so restart resends. Plan decides and documents; docs currently say `failed` is never retried even after restart.
3. **Config shape.** `PULSE_NOTIFY_RETRY_DELAY_MS` exists. Plan decides whether it becomes the initial delay and adds `PULSE_NOTIFY_RETRY_MAX_DELAY_MS` and `PULSE_NOTIFY_RETRY_ATTEMPTS`, and whether jitter is used. Keep the old variable working (semantic: initial delay).
4. **Head-of-line blocking.** One FIFO per channel: a minutes-long retry blocks later events on that channel. Assumption: accepted (order preserved, as documented).
5. **SIGTERM semantics.** Stop must abort an in-flight sleep and in-flight send (abort signal), leave the key `pending`, then exit without `process.exit` racing the ledger. Need a bounded shutdown (no hang). SIGINT assumed to behave like SIGTERM.
6. **Malformed data policy.** Assumption: a malformed incident (non-finite time, missing fields) is skipped with an error log naming the incident id, and re-evaluated each poll (no ledger entry, so log may repeat; plan may dedupe logs). Ledger write error on claim: event not sent, stays unrecorded, retried next poll. Error on settle after a successful send: stays `pending`, so it is resent (at-least-once), logged.
7. **Resend and dedupe on start vs. queued set.** Resent pending events must not be double-enqueued with events found by the poll (`queued` set); resent order should be oldest first and before new events.
8. **Seeding interplay.** Pending resend must not apply to a newly seeded channel; unaffected, but state it.
9. **Webhook body.** The webhook response body is probably not read; ensure it is cancelled/consumed under the timeout so sockets do not leak. Timeout for the API must cover `res.json()` (keep the abort controller until the body is read; error text `timeout after <ms>ms` stays).
10. **Failure log cause.** Add `cause`/`code` (walk `err.cause` chain, include `code`, TLS reason) and ensure `channel` is in all failure logs (already present in delivery logs; api poll logs have no channel, not applicable). Plan defines new log field names and updates `docs/operation.md` and `troubleshooting.md`.
11. **Docs to update:** `channels.md` (guarantee, schedule), `configuration.md` (timeout covers body, new vars), `operation.md` (pending resend, shutdown, log fields), `troubleshooting.md` (rows "possibly lost", "delivery failed", "not resent"), possibly README.
12. **Tests** must fail on old code: fake `sleep`/`schedule`, stalled body stream, NaN time, throwing ledger, restart with pending ledger, SIGTERM stop mid-retry, `cause` in log. The `index.ts` signal handler needs to be testable (inject process/exit).

## Assumptions
- Single target `notify`, no `dependsOn`.
- Idempotency key format unchanged; duplicates after resend are acceptable.
- Incident filter semantics unchanged; no webhook signing.

## Acceptance check
With a webhook receiver down for several minutes then up, every event detected during the outage is delivered once the receiver returns (receiver sees the idempotency key); after `SIGTERM` during an outage and a restart, the unfinished events are delivered; a poll whose body stalls or contains a malformed incident, and a failing ledger write, log an error and polling continues without the process exiting; a failed delivery log shows the channel and the cause code (e.g. `ECONNREFUSED`); docs state the guarantee, the timeout covering the body and the retry schedule; each fix has a test that fails on current main.
